import * as Tone from "tone";
import lamejs from "@breezystack/lamejs";
import type {
  BassPreset,
  DrumsPreset,
  GuitarPreset,
  PianoPreset,
  Project,
  Track,
  VocalsPreset,
} from "../../types";
import {
  buildBass,
  buildDrumKit,
  buildGuitar,
  buildPiano,
  triggerDrumPiece,
  type DrumKit,
  type DrumPiece,
} from "./engine";
import { findKit, buildKit, type KitVoice } from "./sounds/kits";
import { findPreset, buildPresetVoice } from "./sounds/presets";

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const TAIL_SEC = 2;

export type RenderPhase = "decoding" | "rendering" | "encoding";
export interface RenderProgress {
  phase: RenderPhase;
  progress: number;
}

export type ExportFormat = "wav" | "mp3";

export interface ExportResult {
  blob: Blob;
  extension: string;
  mimeType: string;
}

interface RenderVoice {
  channel: Tone.Channel;
  reverb: Tone.Reverb;
  delay: Tone.FeedbackDelay;
  filter: Tone.Filter;
  poly?: import("./engine").MelodicVoice;
  drums?: DrumKit;
  kit?: KitVoice;
}

export async function renderProjectToWav(
  project: Project,
  onProgress?: (p: RenderProgress) => void,
): Promise<Blob> {
  const result = await renderProject(project, "wav", onProgress);
  return result.blob;
}

export async function renderProject(
  project: Project,
  format: ExportFormat,
  onProgress?: (p: RenderProgress) => void,
): Promise<ExportResult> {
  const beatsPerSec = project.bpm / 60;
  const totalBeats = project.bars * 4;
  const projectSec = totalBeats / beatsPerSec;
  const renderSec = Math.max(0.5, projectSec + TAIL_SEC);

  onProgress?.({ phase: "decoding", progress: 0 });
  const decoded = await decodeAudioClips(project);
  onProgress?.({ phase: "decoding", progress: 1 });

  const buffer = await renderOffline(project, decoded, renderSec, (p) =>
    onProgress?.({ phase: "rendering", progress: p }),
  );

  onProgress?.({ phase: "encoding", progress: 0 });
  if (format === "mp3") {
    const mp3 = encodeMp3(buffer, (p) =>
      onProgress?.({ phase: "encoding", progress: p }),
    );
    onProgress?.({ phase: "encoding", progress: 1 });
    return {
      blob: new Blob([mp3.buffer as ArrayBuffer], { type: "audio/mpeg" }),
      extension: "mp3",
      mimeType: "audio/mpeg",
    };
  }
  const wav = encodeWav(buffer);
  onProgress?.({ phase: "encoding", progress: 1 });
  return {
    blob: new Blob([wav], { type: "audio/wav" }),
    extension: "wav",
    mimeType: "audio/wav",
  };
}

async function decodeAudioClips(project: Project): Promise<Map<string, AudioBuffer>> {
  const out = new Map<string, AudioBuffer>();
  const hasAny = project.tracks.some((t) => t.audioClips.some((c) => !!c.blob));
  if (!hasAny) return out;
  const ac = new AudioContext();
  try {
    for (const t of project.tracks) {
      for (const c of t.audioClips) {
        if (!c.blob) continue;
        try {
          const ab = await c.blob.arrayBuffer();
          const decoded = await ac.decodeAudioData(ab.slice(0));
          out.set(c.id, decoded);
        } catch {
          // skip undecodable clip
        }
      }
    }
  } finally {
    await ac.close();
  }
  return out;
}

async function renderOffline(
  project: Project,
  audioBuffers: Map<string, AudioBuffer>,
  durationSec: number,
  onProgress: (p: number) => void,
): Promise<AudioBuffer> {
  const originalContext = Tone.getContext();
  const offline = new Tone.OfflineContext(CHANNELS, durationSec, SAMPLE_RATE);
  Tone.setContext(offline);
  try {
    const masterDb = dbFromGain(project.masterVolume);
    Tone.getDestination().volume.value = masterDb;

    const transport = offline.transport;
    transport.bpm.value = project.bpm;
    transport.timeSignature = [4, 4];

    const anySolo = project.tracks.some((t) => t.solo);
    const reverbReady: Promise<unknown>[] = [];

    for (const track of project.tracks) {
      const audible = !track.muted && (!anySolo || track.solo);
      if (!audible) continue;

      const v = buildVoice(track);
      reverbReady.push(v.reverb.ready);

      v.reverb.wet.value = clamp01(track.fx.reverb);
      v.delay.wet.value = clamp01(track.fx.delay);
      const cutoff = 200 + clamp01(track.fx.filter) ** 2 * 17800;
      v.filter.frequency.value = cutoff;
      v.channel.volume.value = dbFromGain(track.volume);
      v.channel.pan.value = clampPan(track.pan);

      for (const clip of track.noteClips) {
        scheduleNoteClip(track, clip, v, transport);
      }
      for (const clip of track.audioClips) {
        const buf = audioBuffers.get(clip.id);
        if (!buf) continue;
        const player = new Tone.Player(buf).connect(v.channel);
        transport.schedule((time) => {
          try {
            player.start(time);
          } catch {
            // ignore
          }
        }, `0:${clip.start}:0`);
      }
    }

    await Promise.all(reverbReady);
    // Wait for any Tone.Sampler URL fetches (e.g. Salamander grand piano)
    // to finish loading before starting offline render — otherwise sampled
    // notes would silently drop out of the rendered mix.
    await Tone.loaded();
    transport.start(0);

    // Tone's OfflineContext.render does not expose progress, so we estimate
    // it with a timer that advances toward 95% based on the wall-clock time
    // we expect rendering to take (≈ realtime/4 as a coarse guess).
    const estimatedMs = Math.max(500, durationSec * 250);
    const startedAt = performance.now();
    onProgress(0);
    const tick = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      const p = Math.min(0.95, elapsed / estimatedMs);
      onProgress(p);
    }, 100);
    try {
      const toneBuffer = await offline.render(true);
      onProgress(1);
      return toneBuffer.get() as AudioBuffer;
    } finally {
      window.clearInterval(tick);
    }
  } finally {
    Tone.setContext(originalContext);
  }
}

function buildVoice(track: Track): RenderVoice {
  const channel = new Tone.Channel({ volume: 0 }).toDestination();
  const reverb = new Tone.Reverb({ decay: 2.5, wet: 0 });
  const delay = new Tone.FeedbackDelay({ delayTime: "8n", feedback: 0.35, wet: 0 });
  const filter = new Tone.Filter({ frequency: 18000, type: "lowpass", rolloff: -12 });
  filter.connect(delay);
  delay.connect(reverb);
  reverb.connect(channel);

  const v: RenderVoice = { channel, reverb, delay, filter };
  attachInstrument(v, track);
  if (track.kind === "vocals") {
    applyVocalPreset(v, track.preset as VocalsPreset);
  }
  return v;
}

function attachInstrument(v: RenderVoice, track: Track) {
  // v2 path — honor explicit kit/preset selection so exports match playback.
  if (track.kind === "drums" && track.kitId) {
    const def = findKit(track.kitId);
    v.kit = buildKit(def, v.filter, v.reverb, v.delay);
    return;
  }
  if (
    (track.kind === "piano" ||
      track.kind === "guitar" ||
      track.kind === "bass") &&
    track.presetId
  ) {
    const def = findPreset(track.presetId);
    if (def) {
      v.poly = buildPresetVoice(def);
      v.poly.connect(v.filter);
      return;
    }
  }
  switch (track.kind) {
    case "piano":
      v.poly = buildPiano(track.preset as PianoPreset);
      v.poly.connect(v.filter);
      break;
    case "guitar":
      v.poly = buildGuitar(track.preset as GuitarPreset);
      v.poly.connect(v.filter);
      break;
    case "bass":
      v.poly = buildBass(track.preset as BassPreset);
      v.poly.connect(v.filter);
      break;
    case "drums": {
      const drums = buildDrumKit(track.preset as DrumsPreset);
      v.drums = drums;
      (Object.keys(drums) as DrumPiece[]).forEach((k) => drums[k].connect(v.filter));
      break;
    }
    case "vocals":
      // No live mic in offline render; only pre-recorded audio clips contribute.
      break;
  }
}

function applyVocalPreset(v: RenderVoice, preset: VocalsPreset) {
  switch (preset) {
    case "clean":
      v.reverb.wet.value = 0.05;
      v.delay.wet.value = 0;
      v.filter.frequency.value = 18000;
      break;
    case "warm":
      v.reverb.wet.value = 0.45;
      v.delay.wet.value = 0.15;
      v.filter.frequency.value = 12000;
      break;
    case "lofi":
      v.reverb.wet.value = 0.2;
      v.delay.wet.value = 0.1;
      v.filter.frequency.value = 3500;
      break;
  }
}

function scheduleNoteClip(
  track: Track,
  clip: { start: number; notes: Array<{ time: number; note: string; duration: number; velocity: number }> },
  v: RenderVoice,
  transport: Tone.OfflineContext["transport"],
) {
  for (const ev of clip.notes) {
    const t = clip.start + ev.time;
    transport.schedule((time) => {
      if (track.kind === "drums") {
        if (v.kit) {
          const pv = v.kit.pieces.get(ev.note as DrumPiece);
          if (pv) pv.trigger(time, ev.velocity);
        } else if (v.drums) {
          triggerDrumPiece(v.drums, ev.note as DrumPiece, ev.velocity, time);
        }
      } else if (v.poly) {
        const dur = Math.max(0.05, (ev.duration * 60) / transport.bpm.value);
        try {
          v.poly.triggerAttackRelease(ev.note, dur, time, ev.velocity);
        } catch {
          // ignore invalid notes
        }
      }
    }, `0:${t}:0`);
  }
}

function dbFromGain(gain: number): number {
  if (gain <= 0.005) return -60;
  return 20 * Math.log10(gain);
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}
function clampPan(x: number) {
  return Math.max(-1, Math.min(1, x));
}

// ---------- WAV encoding ----------

function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const ab = new ArrayBuffer(totalSize);
  const view = new DataView(ab);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, "WAVE");
  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  let offset = headerSize;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channels[c][i];
      if (sample > 1) sample = 1;
      else if (sample < -1) sample = -1;
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }
  return ab;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

// ---------- MP3 encoding ----------

function encodeMp3(
  buffer: AudioBuffer,
  onProgress?: (p: number) => void,
): Uint8Array {
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const kbps = 192;
  const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, kbps);

  const left = floatTo16(buffer.getChannelData(0));
  const right =
    numChannels > 1 ? floatTo16(buffer.getChannelData(1)) : left;

  const blockSize = 1152;
  const numFrames = left.length;
  const chunks: Uint8Array[] = [];

  for (let i = 0; i < numFrames; i += blockSize) {
    const end = Math.min(i + blockSize, numFrames);
    const lChunk = left.subarray(i, end);
    const rChunk = right.subarray(i, end);
    const mp3buf =
      numChannels > 1
        ? encoder.encodeBuffer(lChunk, rChunk)
        : encoder.encodeBuffer(lChunk);
    if (mp3buf.length > 0) chunks.push(mp3buf);
    if (onProgress && i % (blockSize * 64) === 0) {
      onProgress(Math.min(0.99, i / numFrames));
    }
  }
  const flush = encoder.flush();
  if (flush.length > 0) chunks.push(flush);
  onProgress?.(1);

  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function floatTo16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    let s = input[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name: string): string {
  return name.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "song";
}
