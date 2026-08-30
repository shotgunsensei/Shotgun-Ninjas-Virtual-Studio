import * as Tone from "tone";
import type {
  BassPreset,
  DrumsPreset,
  GuitarPreset,
  NoteEvent,
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
import {
  loadSampleLayers,
  tryLoadMelodicSampler,
  type DecodedSampleLayer,
} from "./sounds/samples";
import {
  startPerfTimer,
  trackAudioResource,
} from "../../utils/performanceDiagnostics";
import { recordExportTrace } from "../performance/exportTrace";
import { safeFilename } from "../export/download";

export {
  downloadBlob,
  safeFilename,
  studioExportFilename,
  studioProjectFilename,
} from "../export/download";

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const TAIL_SEC = 2;

// ── export concurrency guard ─────────────────────────────────────────────
// Prevents a second export from launching while one is already rendering.
// The OfflineAudioContext render is CPU-intensive; stacking two would cause
// severe main-thread jank and likely page-unresponsive errors.
let _exportInProgress = false;

/** True while a renderProject call is still pending. */
export function isExportInProgress(): boolean {
  return _exportInProgress;
}

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
  clipping?: { clipped: boolean; peakDb: number };
  route?: "native-wav" | "tone-offline";
  warnings?: string[];
}

interface RenderVoice {
  channel: Tone.Channel;
  reverb: Tone.Freeverb;
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

export interface RenderOptions {
  /** When true, only the loop region [loopStartBeat..loopEndBeat) is rendered. */
  loopOnly?: boolean;
  /**
   * Custom render range in beats. When both are provided and customEndBeat >
   * customStartBeat, this takes precedence over loopOnly.
   */
  customStartBeat?: number;
  customEndBeat?: number;
}

export async function renderProject(
  project: Project,
  format: ExportFormat,
  onProgress?: (p: RenderProgress) => void,
  options: RenderOptions = {},
): Promise<ExportResult> {
  if (_exportInProgress) {
    throw new Error(
      "An export is already in progress. Please wait for it to complete before starting another.",
    );
  }
  const endTiming = startPerfTimer(format === "wav" ? "wav-export" : "mp3-export", {
    tracks: project.tracks.length,
    bars: project.bars,
    format,
  });
  _exportInProgress = true;
  try {
    return await _renderProjectInner(project, format, onProgress, options);
  } finally {
    _exportInProgress = false;
    endTiming();
  }
}

interface ExportRange {
  startBeat: number;
  endBeat: number;
  projectSec: number;
  renderSec: number;
}

interface ExportPlan extends ExportRange {
  audibleTracks: Track[];
  noteEvents: number;
  drumEvents: number;
  melodicEvents: number;
  audioClips: number;
  toneRequiredTracks: number;
  estimatedPcmBytes: number;
  estimatedWavBytes: number;
  route: "native-wav" | "tone-offline";
  warnings: string[];
}

async function _renderProjectInner(
  project: Project,
  format: ExportFormat,
  onProgress?: (p: RenderProgress) => void,
  options: RenderOptions = {},
): Promise<ExportResult> {
  const plan = createExportPlan(project, format, options);
  recordExportTrace("preflight", {
    format,
    route: plan.route,
    audibleTracks: plan.audibleTracks.length,
    noteEvents: plan.noteEvents,
    drumEvents: plan.drumEvents,
    melodicEvents: plan.melodicEvents,
    audioClips: plan.audioClips,
    toneRequiredTracks: plan.toneRequiredTracks,
    durationSec: Math.round(plan.renderSec * 100) / 100,
    estimatedPcmMB: Math.round((plan.estimatedPcmBytes / (1024 * 1024)) * 10) / 10,
    estimatedWavMB: Math.round((plan.estimatedWavBytes / (1024 * 1024)) * 10) / 10,
    warnings: plan.warnings,
  });

  if (plan.renderSec > 20 * 60 || plan.estimatedPcmBytes > 512 * 1024 * 1024) {
    const message =
      "WAV export range is too large for the in-browser renderer. Export a shorter range or split the project first.";
    recordExportTrace("error", { format, route: plan.route, message });
    throw new Error(message);
  }

  onProgress?.({ phase: "decoding", progress: 0 });
  const decoded = await decodeAudioClips(project, (p) =>
    onProgress?.({ phase: "decoding", progress: p * 0.5 }),
  );
  const nativeSampleBanks = await decodeNativeSampleBanks(plan.audibleTracks);
  onProgress?.({ phase: "decoding", progress: 1 });

  recordExportTrace("route", { format, route: plan.route });
  const buffer =
    format === "wav"
      ? await renderNativeWav(project, decoded, nativeSampleBanks, plan, (p) =>
          onProgress?.({ phase: "rendering", progress: p }),
        )
      : await renderOffline(project, decoded, plan.renderSec, plan.startBeat, plan.endBeat, (p) =>
          onProgress?.({ phase: "rendering", progress: p }),
        );
  const clipping = detectClipping(buffer);

  onProgress?.({ phase: "encoding", progress: 0 });
  if (format === "mp3") {
    const mp3 = await encodeMp3(buffer, (p) =>
      onProgress?.({ phase: "encoding", progress: p }),
    );
    onProgress?.({ phase: "encoding", progress: 1 });
    return {
      blob: new Blob([mp3.buffer as ArrayBuffer], { type: "audio/mpeg" }),
      extension: "mp3",
      mimeType: "audio/mpeg",
      clipping,
      route: "tone-offline",
      warnings: plan.warnings,
    };
  }
  const wav = await encodeWav(buffer, (p) =>
    onProgress?.({ phase: "encoding", progress: p }),
  );
  onProgress?.({ phase: "encoding", progress: 1 });
  recordExportTrace("result", {
    format,
    route: plan.route,
    wavBytes: wav.byteLength,
    warnings: plan.warnings,
  });
  return {
    blob: new Blob([wav], { type: "audio/wav" }),
    extension: "wav",
    mimeType: "audio/wav",
    clipping,
    route: plan.route,
    warnings: plan.warnings,
  };
}

function createExportPlan(
  project: Project,
  format: ExportFormat,
  options: RenderOptions,
): ExportPlan {
  const range = resolveExportRange(project, options);
  const anySolo = project.tracks.some((t) => t.solo);
  const audibleTracks = project.tracks.filter((t) => !t.muted && (!anySolo || t.solo));
  let noteEvents = 0;
  let drumEvents = 0;
  let melodicEvents = 0;
  let audioClips = 0;
  let toneRequiredTracks = 0;
  const warnings: string[] = [];

  for (const track of audibleTracks) {
    let trackNeedsToneFidelity = false;
    const preset = findPreset(track.presetId);
    const hasDecodedPresetPath = Boolean(preset?.layers?.length);
    if (
      format === "wav" &&
      track.kind !== "drums" &&
      !hasDecodedPresetPath &&
      track.noteClips.some((clip) => clip.notes.length > 0)
    ) {
      trackNeedsToneFidelity = true;
    }
    if (track.fxRack && Object.values(track.fxRack).some((fx) => fx?.enabled)) {
      trackNeedsToneFidelity = true;
    }
    if (trackNeedsToneFidelity) toneRequiredTracks += 1;
    for (const clip of track.noteClips) {
      for (const ev of clip.notes) {
        const absT = clip.start + ev.time + (ev.microTiming ?? 0);
        if (absT < range.startBeat || absT >= range.endBeat) continue;
        noteEvents += 1;
        if (track.kind === "drums") drumEvents += 1;
        else melodicEvents += 1;
      }
    }
    for (const clip of track.audioClips) {
      if (clip.start >= range.endBeat) continue;
      const clipEndBeat = clip.start + clip.durationSec * (project.bpm / 60);
      if (clipEndBeat <= range.startBeat) continue;
      audioClips += 1;
      if (clip.reversed) warnings.push(`Reversed audio clip "${clip.name ?? clip.id}" renders forward in the stabilized WAV path.`);
    }
  }

  if (format === "wav" && toneRequiredTracks > 0) {
    warnings.push(
      "WAV export used the stabilized native renderer; Tone-only melodic and advanced FX tracks are approximated to avoid browser stalls.",
    );
  }

  const frames = Math.ceil(range.renderSec * SAMPLE_RATE);
  return {
    ...range,
    audibleTracks,
    noteEvents,
    drumEvents,
    melodicEvents,
    audioClips,
    toneRequiredTracks,
    estimatedPcmBytes: frames * CHANNELS * 4,
    estimatedWavBytes: 44 + frames * CHANNELS * 2,
    route: format === "wav" ? "native-wav" : "tone-offline",
    warnings,
  };
}

function resolveExportRange(project: Project, options: RenderOptions): ExportRange {
  const beatsPerSec = project.bpm / 60;
  let startBeat: number;
  let endBeat: number;
  if (
    options.customStartBeat !== undefined &&
    options.customEndBeat !== undefined &&
    options.customEndBeat > options.customStartBeat
  ) {
    startBeat = Math.max(0, options.customStartBeat);
    endBeat = Math.min(project.bars * 4, options.customEndBeat);
  } else if (
    options.loopOnly &&
    project.loopEnabled &&
    project.loopEndBeat > project.loopStartBeat
  ) {
    startBeat = project.loopStartBeat;
    endBeat = project.loopEndBeat;
  } else {
    startBeat = 0;
    endBeat = project.bars * 4;
  }
  const projectSec = Math.max(0, (endBeat - startBeat) / beatsPerSec);
  return {
    startBeat,
    endBeat,
    projectSec,
    renderSec: Math.max(0.5, projectSec + TAIL_SEC),
  };
}

async function decodeAudioClips(
  project: Project,
  onProgress?: (p: number) => void,
): Promise<Map<string, AudioBuffer>> {
  const out = new Map<string, AudioBuffer>();

  // Collect all clips that need decoding up-front.
  const pending: Array<{ clipId: string; blob: Blob }> = [];
  for (const t of project.tracks) {
    for (const c of t.audioClips) {
      if (c.blob) pending.push({ clipId: c.id, blob: c.blob });
    }
  }
  if (pending.length === 0) return out;

  const ac = new AudioContext();
  try {
    // Decode in batches of 4 to prevent simultaneous decodeAudioData calls
    // from spiking memory/CPU and triggering page-unresponsive warnings on
    // projects with many large audio clips.
    const BATCH = 2;
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async ({ clipId, blob }) => {
          try {
            const ab = await blob.arrayBuffer();
            const decoded = await ac.decodeAudioData(ab.slice(0));
            out.set(clipId, decoded);
          } catch {
            // skip undecodable clip — continue export without it
          }
        }),
      );
      // Yield to the UI thread between batches so progress indicators
      // can update and the page remains interactive during long exports.
      if (i + BATCH < pending.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      onProgress?.(Math.min(1, (i + batch.length) / pending.length));
    }
  } finally {
    await ac.close();
  }
  return out;
}

interface NativeSampleZone {
  buffer: AudioBuffer;
  rootNote: string;
  minVelocity: number;
  maxVelocity: number;
}

interface NativeSampleBank {
  presetId: string;
  attackSec: number;
  releaseSec: number;
  zones: NativeSampleZone[];
}

type NativeSampleBanks = Map<string, NativeSampleBank>;

/**
 * Decode each audible sampled preset once before the OfflineAudioContext is
 * created. The shared resolver de-duplicates live-preview/export work and
 * limits decode concurrency; AudioBuffers can then be attached directly to
 * native offline buffer sources without routing WAV export through Tone.
 */
async function decodeNativeSampleBanks(tracks: Track[]): Promise<NativeSampleBanks> {
  const banks: NativeSampleBanks = new Map();
  const presets = new Map(
    tracks
      .map((track) => findPreset(track.presetId))
      .filter((preset): preset is NonNullable<ReturnType<typeof findPreset>> =>
        Boolean(preset?.layers?.length),
      )
      .map((preset) => [preset.id, preset]),
  );

  await Promise.all(
    Array.from(presets.values()).map(async (preset) => {
      const decoded: DecodedSampleLayer[] = await loadSampleLayers(preset.layers);
      const zones = decoded.flatMap(({ layer, buffer }) =>
        layer.rootNote
          ? [{
              buffer,
              rootNote: layer.rootNote,
              minVelocity: layer.minVelocity,
              maxVelocity: layer.maxVelocity,
            }]
          : [],
      );
      if (!zones.length) return;
      banks.set(preset.id, {
        presetId: preset.id,
        attackSec: Math.max(0.002, preset.synth.attack * 0.4),
        releaseSec: Math.max(0.08, preset.synth.release * 2),
        zones,
      });
      recordExportTrace("native-sample-bank", {
        presetId: preset.id,
        zones: zones.length,
      });
    }),
  );
  return banks;
}

interface NativeTrackGraph {
  input: GainNode;
  pan: StereoPannerNode;
  filter: BiquadFilterNode;
}

const DRUM_FREQ: Record<string, number> = {
  kick: 55,
  snare: 190,
  hat: 7600,
  ohat: 6200,
  clap: 1300,
  tomLow: 110,
  tomHigh: 210,
  crash: 4200,
  fx: 900,
};

const DRUM_DECAY: Record<string, number> = {
  kick: 0.36,
  snare: 0.16,
  hat: 0.045,
  ohat: 0.32,
  clap: 0.11,
  tomLow: 0.24,
  tomHigh: 0.18,
  crash: 0.8,
  fx: 0.48,
};

async function renderNativeWav(
  project: Project,
  audioBuffers: Map<string, AudioBuffer>,
  nativeSampleBanks: NativeSampleBanks,
  plan: ExportPlan,
  onProgress: (p: number) => void,
): Promise<AudioBuffer> {
  const untrackOfflineRender = trackAudioResource("native-wav-render");
  const frames = Math.max(1, Math.ceil(plan.renderSec * SAMPLE_RATE));
  const ctx = new OfflineAudioContext(CHANNELS, frames, SAMPLE_RATE);
  const master = ctx.createGain();
  const noiseBuffer = makeNativeNoiseBuffer(ctx);
  const cleanupNodes: AudioNode[] = [master];
  let scheduled = 0;

  master.gain.value = clamp01(project.masterVolume);
  master.connect(ctx.destination);
  onProgress(0);

  try {
    for (const track of plan.audibleTracks) {
      const graph = createNativeTrackGraph(ctx, track, master);
      cleanupNodes.push(graph.input, graph.pan, graph.filter);
      recordExportTrace("native-track", { trackId: track.id, kind: track.kind });

      for (const clip of track.noteClips) {
        for (const ev of clip.notes) {
          if (!shouldRenderNote(clip.start, ev, plan)) continue;
          const time = beatToSeconds(clip.start + ev.time + (ev.microTiming ?? 0), project.bpm, plan.startBeat);
          const velocity = Math.max(0, Math.min(1, ev.velocity * (ev.accent ? 1.18 : 1)));
          if (track.kind === "drums") {
            scheduleNativeDrumHit(ctx, graph.input, noiseBuffer, ev.note, time, velocity);
          } else {
            scheduleNativeMelodicNote(
              ctx,
              graph.input,
              track,
              ev,
              time,
              project.bpm,
              velocity,
              track.presetId ? nativeSampleBanks.get(track.presetId) : undefined,
            );
          }
          scheduled += 1;
          recordExportTrace("native-note", { trackId: track.id, kind: track.kind });
          if (scheduled % 256 === 0) {
            recordExportTrace("native-yield", { scheduled });
            onProgress(Math.min(0.15, scheduled / Math.max(1, plan.noteEvents) * 0.15));
            await yieldToMain();
          }
        }
      }

      for (const clip of track.audioClips) {
        scheduleNativeAudioClip(ctx, graph.input, audioBuffers.get(clip.id), clip, project.bpm, plan);
      }
    }

    const estimatedMs = Math.max(500, plan.renderSec * 120);
    const startedAt = performance.now();
    let progressError: unknown = null;
    const tick = window.setInterval(() => {
      if (progressError) return;
      try {
        const elapsed = performance.now() - startedAt;
        onProgress(Math.min(0.95, 0.15 + (elapsed / estimatedMs) * 0.8));
      } catch (err) {
        progressError = err;
      }
    }, 100);
    try {
      const buffer = await ctx.startRendering();
      if (progressError) throw progressError;
      onProgress(1);
      return buffer;
    } finally {
      window.clearInterval(tick);
    }
  } finally {
    for (const node of cleanupNodes) {
      try {
        node.disconnect();
      } catch {
        // ignore offline cleanup races
      }
    }
    untrackOfflineRender();
  }
}

function createNativeTrackGraph(
  ctx: OfflineAudioContext,
  track: Track,
  destination: AudioNode,
): NativeTrackGraph {
  const input = ctx.createGain();
  const pan = ctx.createStereoPanner();
  const filter = ctx.createBiquadFilter();
  input.gain.value = clamp01(track.volume);
  pan.pan.value = clampPan(track.pan);
  filter.type = "lowpass";
  filter.frequency.value = 200 + clamp01(track.fx.filter) ** 2 * 17800;
  filter.Q.value = 0.7;
  input.connect(pan);
  pan.connect(filter);
  filter.connect(destination);
  return { input, pan, filter };
}

function shouldRenderNote(
  clipStart: number,
  ev: NoteEvent,
  plan: ExportPlan,
): boolean {
  const absT = clipStart + ev.time + (ev.microTiming ?? 0);
  return absT >= plan.startBeat && absT < plan.endBeat && ev.velocity > 0.001;
}

function beatToSeconds(beat: number, bpm: number, startBeat: number): number {
  return Math.max(0, ((beat - startBeat) * 60) / bpm);
}

function makeNativeNoiseBuffer(ctx: OfflineAudioContext): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * 0.35));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function scheduleNativeDrumHit(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  noiseBuffer: AudioBuffer,
  piece: string,
  time: number,
  velocity: number,
): void {
  const decay = DRUM_DECAY[piece] ?? 0.12;
  const sourceGain = ctx.createGain();
  const pieceFilter = ctx.createBiquadFilter();
  sourceGain.gain.setValueAtTime(Math.max(0.0001, velocity), time);
  sourceGain.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  pieceFilter.type = nativeDrumFilterType(piece);
  pieceFilter.frequency.setValueAtTime(DRUM_FREQ[piece] ?? 800, time);
  pieceFilter.Q.value = piece === "kick" ? 0.7 : 1.2;
  pieceFilter.connect(sourceGain);
  sourceGain.connect(destination);
  recordExportTrace("native-drum-hit", { piece });

  if (nativeDrumUsesNoise(piece)) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.connect(pieceFilter);
    src.start(time);
    src.stop(time + decay);
    recordExportTrace("native-source", { kind: "AudioBufferSourceNode", piece });
    return;
  }

  const osc = ctx.createOscillator();
  const startFreq = DRUM_FREQ[piece] ?? 90;
  osc.type = piece === "kick" ? "sine" : "triangle";
  osc.frequency.setValueAtTime(startFreq, time);
  if (piece === "kick") {
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, startFreq * 0.45), time + 0.08);
  }
  osc.connect(pieceFilter);
  osc.start(time);
  osc.stop(time + decay);
  recordExportTrace("native-source", { kind: "OscillatorNode", piece });
}

function scheduleNativeMelodicNote(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  track: Track,
  ev: NoteEvent,
  time: number,
  bpm: number,
  velocity: number,
  sampleBank?: NativeSampleBank,
): void {
  const dur = Math.max(0.05, (ev.duration * 60) / bpm);
  if (sampleBank?.zones.length) {
    scheduleNativeSampledNote(ctx, destination, sampleBank, ev.note, time, dur, velocity);
    return;
  }
  const freq = noteToFrequency(ev.note);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = nativeOscillatorType(track);
  osc.frequency.setValueAtTime(freq, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, velocity * nativeTrackGainScale(track)), time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + dur + nativeReleaseSeconds(track));
  osc.connect(gain);
  gain.connect(destination);
  osc.start(time);
  osc.stop(time + dur + nativeReleaseSeconds(track));
  recordExportTrace("native-source", { kind: "OscillatorNode", trackKind: track.kind });
}

function scheduleNativeSampledNote(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  bank: NativeSampleBank,
  note: string,
  time: number,
  durationSec: number,
  velocity: number,
): void {
  const targetFrequency = noteToFrequency(note);
  const eligible = bank.zones.filter(
    (zone) => velocity >= zone.minVelocity && velocity <= zone.maxVelocity,
  );
  const candidates = eligible.length ? eligible : bank.zones;
  const zone = candidates.reduce((nearest, candidate) => {
    const nearestDistance = Math.abs(
      Math.log2(targetFrequency / noteToFrequency(nearest.rootNote)),
    );
    const candidateDistance = Math.abs(
      Math.log2(targetFrequency / noteToFrequency(candidate.rootNote)),
    );
    return candidateDistance < nearestDistance ? candidate : nearest;
  });
  const rootFrequency = noteToFrequency(zone.rootNote);
  const playbackRate = Math.max(0.125, Math.min(8, targetFrequency / rootFrequency));
  const naturalDuration = zone.buffer.duration / playbackRate;
  const audibleDuration = Math.max(
    0.03,
    Math.min(naturalDuration, durationSec + bank.releaseSec),
  );
  const attack = Math.min(bank.attackSec, audibleDuration * 0.2);
  const release = Math.min(bank.releaseSec, Math.max(0.01, audibleDuration * 0.4));
  const fadeAt = Math.max(time + attack, time + audibleDuration - release);

  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = zone.buffer;
  source.playbackRate.setValueAtTime(playbackRate, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, velocity * 0.8), time + attack);
  gain.gain.setValueAtTime(Math.max(0.0001, velocity * 0.8), fadeAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + audibleDuration);
  source.connect(gain);
  gain.connect(destination);
  source.start(time);
  source.stop(time + audibleDuration);
  recordExportTrace("native-source", {
    kind: "SampledAudioBufferSourceNode",
    presetId: bank.presetId,
    rootNote: zone.rootNote,
    note,
  });
}

function scheduleNativeAudioClip(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  buffer: AudioBuffer | undefined,
  clip: { id: string; start: number; durationSec: number; offsetSec?: number; reversed?: boolean },
  bpm: number,
  plan: ExportPlan,
): void {
  if (!buffer) return;
  const beatStart = clip.start - plan.startBeat;
  const offset = Math.max(0, clip.offsetSec ?? 0);
  const duration = Math.max(0, clip.durationSec);
  let when = Math.max(0, (beatStart * 60) / bpm);
  let sourceOffset = offset;
  let sourceDuration = duration;
  if (beatStart < 0) {
    const skipSec = (-beatStart * 60) / bpm;
    if (skipSec >= duration) return;
    sourceOffset += skipSec;
    sourceDuration -= skipSec;
    when = 0;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(destination);
  src.start(when, sourceOffset, sourceDuration);
  recordExportTrace("native-audio-clip", { clipId: clip.id, reversed: !!clip.reversed });
  recordExportTrace("native-source", { kind: "AudioBufferSourceNode", clipId: clip.id });
}

function nativeDrumUsesNoise(piece: string): boolean {
  return piece === "snare" || piece === "hat" || piece === "ohat" || piece === "clap" || piece === "crash" || piece === "fx";
}

function nativeDrumFilterType(piece: string): BiquadFilterType {
  if (piece === "kick" || piece === "tomLow" || piece === "tomHigh") return "lowpass";
  if (piece === "snare" || piece === "clap" || piece === "fx") return "bandpass";
  return "highpass";
}

function nativeOscillatorType(track: Track): OscillatorType {
  if (track.kind === "bass") return track.preset === "sub" ? "sine" : "sawtooth";
  if (track.kind === "guitar") return "triangle";
  return "sine";
}

function nativeTrackGainScale(track: Track): number {
  if (track.kind === "bass") return 0.8;
  if (track.kind === "guitar") return 0.45;
  return 0.55;
}

function nativeReleaseSeconds(track: Track): number {
  if (track.kind === "bass") return 0.04;
  if (track.kind === "guitar") return 0.08;
  return 0.12;
}

function noteToFrequency(note: string): number {
  const match = note.match(/^([A-Ga-g][#b]?)(-?\d+)$/);
  if (!match) return 440;
  const semitones: Record<string, number> = {
    C: 0,
    "C#": 1,
    Db: 1,
    D: 2,
    "D#": 3,
    Eb: 3,
    E: 4,
    F: 5,
    "F#": 6,
    Gb: 6,
    G: 7,
    "G#": 8,
    Ab: 8,
    A: 9,
    "A#": 10,
    Bb: 10,
    B: 11,
  };
  const pitch = match[1][0].toUpperCase() + match[1].slice(1);
  const octave = Number.parseInt(match[2], 10);
  const midi = (octave + 1) * 12 + (semitones[pitch] ?? 0);
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function renderOffline(
  project: Project,
  audioBuffers: Map<string, AudioBuffer>,
  durationSec: number,
  startBeat: number,
  endBeat: number,
  onProgress: (p: number) => void,
): Promise<AudioBuffer> {
  const untrackOfflineRender = trackAudioResource("offline-render");
  const originalContext = Tone.getContext();
  const offline = new Tone.OfflineContext(CHANNELS, durationSec, SAMPLE_RATE);
  Tone.setContext(offline);
  try {
    const masterDb = dbFromGain(project.masterVolume);
    Tone.getDestination().volume.value = masterDb;

    const transport = offline.transport;
    transport.bpm.value = project.bpm;
    transport.timeSignature = [4, 4];
    // shift so the requested startBeat plays at offline t=0
    const beatOffset = startBeat;

    const anySolo = project.tracks.some((t) => t.solo);

    for (const track of project.tracks) {
      const audible = !track.muted && (!anySolo || track.solo);
      if (!audible) continue;

      const v = await buildVoice(track);
      // Tone.Freeverb is instantaneous (algorithmic) — no .ready wait needed.

      v.reverb.wet.value = clamp01(track.fx.reverb);
      v.delay.wet.value = clamp01(track.fx.delay);
      const cutoff = 200 + clamp01(track.fx.filter) ** 2 * 17800;
      v.filter.frequency.value = cutoff;
      v.channel.volume.value = dbFromGain(track.volume);
      v.channel.pan.value = clampPan(track.pan);

      for (const clip of track.noteClips) {
        scheduleNoteClip(track, clip, v, transport, beatOffset, endBeat);
      }
      for (const clip of track.audioClips) {
        const buf = audioBuffers.get(clip.id);
        if (!buf) continue;
        // skip clips entirely outside the requested render window
        if (clip.start >= endBeat) continue;
        const player = new Tone.Player(buf).connect(v.channel);
        const beatStart = clip.start - beatOffset;
        const offset = Math.max(0, clip.offsetSec ?? 0);
        const duration = Math.max(0, clip.durationSec);
        if (beatStart < 0) {
          // clip already in progress at render start — skip the leading
          // portion so playback aligns to t=0
          const beatsPerSec = project.bpm / 60;
          const skipSec = (-beatStart) / beatsPerSec;
          if (skipSec >= duration) continue;
          transport.schedule((time) => {
            try {
              player.start(time, offset + skipSec, duration - skipSec);
            } catch {
              // ignore
            }
          }, "0:0:0");
        } else {
          transport.schedule((time) => {
            try {
              player.start(time, offset, duration);
            } catch {
              // ignore
            }
          }, `0:${beatStart}:0`);
        }
      }
    }

    // (No reverb IR to await — Freeverb is ready immediately.)
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
    untrackOfflineRender();
  }
}

async function buildVoice(track: Track): Promise<RenderVoice> {
  const channel = new Tone.Channel({ volume: 0 }).toDestination();
  const reverb = new Tone.Freeverb({ roomSize: 0.65, dampening: 3000, wet: 0 });
  const delay = new Tone.FeedbackDelay({ delayTime: "8n", feedback: 0.35, wet: 0 });
  const filter = new Tone.Filter({ frequency: 18000, type: "lowpass", rolloff: -12 });
  filter.connect(delay);
  delay.connect(reverb);
  reverb.connect(channel);

  const v: RenderVoice = { channel, reverb, delay, filter };
  await attachInstrument(v, track);
  if (track.kind === "vocals") {
    applyVocalPreset(v, track.preset as VocalsPreset);
  }
  return v;
}

async function attachInstrument(v: RenderVoice, track: Track): Promise<void> {
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
      v.poly = (await tryLoadMelodicSampler(def.layers, {
        release: Math.max(0.1, def.synth.release * 2),
        attack: Math.max(0, def.synth.attack * 0.4),
        volume: -8,
      })) ?? buildPresetVoice(def);
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
  beatOffset = 0,
  endBeat = Infinity,
) {
  for (const ev of clip.notes) {
    const absT = clip.start + ev.time;
    if (absT >= endBeat) continue;
    const t = absT - beatOffset;
    if (t < 0) continue;
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

async function encodeWav(
  buffer: AudioBuffer,
  onProgress?: (p: number) => void,
): Promise<ArrayBuffer> {
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
    if (i > 0 && i % 16384 === 0) {
      onProgress?.(Math.min(0.99, i / numFrames));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  onProgress?.(1);
  return ab;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

// ---------- MP3 encoding ----------

async function encodeMp3(
  buffer: AudioBuffer,
  onProgress?: (p: number) => void,
): Promise<Uint8Array> {
  const { default: lamejs } = await import("@breezystack/lamejs");
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const kbps = 192;
  const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, kbps);

  const blockSize = 1152;
  const leftInput = buffer.getChannelData(0);
  const rightInput = numChannels > 1 ? buffer.getChannelData(1) : leftInput;
  const left = new Int16Array(blockSize);
  const right = numChannels > 1 ? new Int16Array(blockSize) : left;
  const numFrames = leftInput.length;
  const chunks: Uint8Array[] = [];

  for (let i = 0; i < numFrames; i += blockSize) {
    const end = Math.min(i + blockSize, numFrames);
    const frameCount = end - i;
    for (let frame = 0; frame < frameCount; frame++) {
      left[frame] = floatSampleTo16(leftInput[i + frame]);
      if (numChannels > 1) right[frame] = floatSampleTo16(rightInput[i + frame]);
    }
    const lChunk = left.subarray(0, frameCount);
    const rChunk = right.subarray(0, frameCount);
    const mp3buf =
      numChannels > 1
        ? encoder.encodeBuffer(lChunk, rChunk)
        : encoder.encodeBuffer(lChunk);
    if (mp3buf.length > 0) chunks.push(mp3buf);
    if (onProgress && i % (blockSize * 64) === 0) {
      onProgress(Math.min(0.99, i / numFrames));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
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

function floatSampleTo16(sample: number): number {
  const bounded = Math.max(-1, Math.min(1, sample));
  return bounded < 0 ? bounded * 0x8000 : bounded * 0x7fff;
}

// ---------- Stems & DAW Pack export ----------

export interface StemProgress {
  trackIndex: number;
  trackCount: number;
  trackName: string;
  phase: RenderPhase | "packaging";
}

export type StemsProgressCallback = (p: StemProgress) => void;

/**
 * Render a single track in isolation and return a WAV Blob.
 * All other tracks are muted for this render pass.
 */
export async function renderStemForTrack(
  project: Project,
  trackId: string,
  options: RenderOptions = {},
): Promise<Blob> {
  const soloProject: Project = {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      muted: t.id !== trackId,
      solo: false,
    })),
  };
  const result = await renderProject(soloProject, "wav", undefined, options);
  return result.blob;
}

/**
 * Render each un-muted, non-vocals track as its own WAV file.
 * Returns an array of { name, wav } ready to zip.
 */
export async function renderStems(
  project: Project,
  options: RenderOptions = {},
  onProgress?: StemsProgressCallback,
): Promise<Array<{ name: string; wav: Blob }>> {
  const anySolo = project.tracks.some((t) => t.solo);
  const eligible = project.tracks.filter(
    (t) => !t.muted && (!anySolo || t.solo) && t.kind !== "vocals",
  );
  const out: Array<{ name: string; wav: Blob }> = [];
  for (let i = 0; i < eligible.length; i++) {
    const t = eligible[i];
    onProgress?.({
      trackIndex: i,
      trackCount: eligible.length,
      trackName: t.name,
      phase: "rendering",
    });
    const wav = await renderStemForTrack(project, t.id, options);
    out.push({ name: t.name, wav });
  }
  return out;
}

/**
 * Assemble a Stems ZIP: stems/<trackname>.wav for each eligible track.
 */
export async function exportStemsZip(
  project: Project,
  options: RenderOptions = {},
  onProgress?: StemsProgressCallback,
): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const stems = await renderStems(project, options, onProgress);
  for (const s of stems) {
    onProgress?.({
      trackIndex: stems.indexOf(s),
      trackCount: stems.length,
      trackName: s.name,
      phase: "packaging",
    });
    const safe = safeFilename(s.name);
    zip.file(`${safe}.wav`, s.wav);
  }
  return zip.generateAsync({ type: "blob" });
}

/**
 * Build the full DAW Pack ZIP containing:
 *   mix.wav, stems/<track>.wav, midi/<track>.mid,
 *   project.snproj.json, README.txt
 */
export async function exportDawPack(
  project: Project,
  projectJson: string,
  midiFiles: Array<{ name: string; bytes: Uint8Array }>,
  options: RenderOptions = {},
  onProgress?: StemsProgressCallback,
): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  // Full mix
  onProgress?.({ trackIndex: 0, trackCount: 1, trackName: "Full mix", phase: "rendering" });
  const mixResult = await renderProject(project, "wav", undefined, options);
  zip.file("mix.wav", mixResult.blob);

  // Stems
  const stems = await renderStems(project, options, (p) => {
    onProgress?.(p);
  });
  const stemsFolder = zip.folder("stems")!;
  for (const s of stems) {
    stemsFolder.file(`${safeFilename(s.name)}.wav`, s.wav);
  }

  // MIDI files
  const midiFolder = zip.folder("midi")!;
  for (const m of midiFiles) {
    midiFolder.file(`${safeFilename(m.name)}.mid`, m.bytes);
  }

  // Project file
  zip.file("project.snproj.json", projectJson);

  // README
  const anySolo = project.tracks.some((t) => t.solo);
  const trackLines = project.tracks
    .filter((t) => !t.muted && (!anySolo || t.solo))
    .map((t) => `  - ${t.name} (${t.kind})`)
    .join("\n");
  const now = new Date();
  const readme =
    `Shotgun Ninjas Virtual Studio — DAW Pack\n` +
    `=========================================\n\n` +
    `Project : ${project.name}\n` +
    `BPM     : ${project.bpm}\n` +
    `Bars    : ${project.bars}\n` +
    `Exported: ${now.toISOString()}\n\n` +
    `Tracks\n------\n${trackLines}\n\n` +
    `Contents\n--------\n` +
    `  mix.wav            — Full stereo mixdown\n` +
    `  stems/<name>.wav   — Individual track renders\n` +
    `  midi/<name>.mid    — MIDI data for melodic tracks\n` +
    `  project.snproj.json — Re-importable project file\n\n` +
    `Open mix.wav or any stems/*.wav in Ableton, Logic, FL Studio, Reaper, etc.\n` +
    `Import midi/*.mid into any DAW or notation app (MuseScore, Sibelius, Finale).\n` +
    `Import project.snproj.json back into Shotgun Ninjas Virtual Studio.\n\n` +
    `Made with Shotgun Ninjas Virtual Studio — https://shotgunninjas.com/studio\n`;
  zip.file("README.txt", readme);

  onProgress?.({ trackIndex: 0, trackCount: 1, trackName: "Packaging…", phase: "packaging" });
  return zip.generateAsync({ type: "blob" });
}

/**
 * Scan an AudioBuffer for samples above 0 dBFS. Returns the peak in dBFS
 * and a clipping flag, used to surface the master clipping warning in the
 * Export modal.
 */
export function detectClipping(buffer: AudioBuffer): { clipped: boolean; peakDb: number } {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
  }
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  return { clipped: peak >= 0.999, peakDb };
}
