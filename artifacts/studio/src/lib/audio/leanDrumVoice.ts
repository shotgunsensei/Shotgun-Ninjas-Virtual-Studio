import * as Tone from "tone";
import type { SoundParams, Track } from "../../types";
import type { DrumPiece } from "./voices";
import { cutoffNormToHz } from "./sounds/kits";
import { firstPlayMark, firstPlayMeasure } from "../performance/firstPlayTrace";
import { recordLeanDrumTrace } from "../performance/audioNodeTrace";

export type LeanDrumMode = "shell" | "lean" | "disposed";

export interface LeanDrumVoice {
  readonly mode: LeanDrumMode;
  readonly trackId: string;
  trigger: (piece: DrumPiece, time: number, velocity: number) => void;
  applyTrack: (track: Track) => void;
  applySoundParams: (partial: Partial<SoundParams>) => void;
  stopAll: () => void;
  dispose: () => void;
}

const PIECE_FREQ: Record<DrumPiece, number> = {
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

const PIECE_DECAY: Record<DrumPiece, number> = {
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

function getNativeInput(dest: Tone.InputNode): AudioNode {
  let current: unknown = dest;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    if (current instanceof AudioNode) return current;
    seen.add(current);
    const maybe = current as { input?: unknown; output?: unknown };
    current = maybe.input ?? maybe.output;
  }
  return dest as unknown as AudioNode;
}

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * 0.35));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function usesNoise(piece: DrumPiece): boolean {
  return piece === "snare" || piece === "hat" || piece === "ohat" || piece === "clap" || piece === "crash" || piece === "fx";
}

function filterType(piece: DrumPiece): BiquadFilterType {
  if (piece === "kick" || piece === "tomLow" || piece === "tomHigh") return "lowpass";
  if (piece === "snare" || piece === "clap" || piece === "fx") return "bandpass";
  return "highpass";
}

export function createLeanDrumVoice(track: Track, destination: Tone.InputNode): LeanDrumVoice {
  const started = performance.now();
  const ctx = Tone.getContext().rawContext as AudioContext;
  const output = ctx.createGain();
  const pan = ctx.createStereoPanner();
  const filter = ctx.createBiquadFilter();
  const noiseBuffer = makeNoiseBuffer(ctx);
  let disposed = false;
  let muted = false;
  let volume = 1;
  const activeSources = new Set<AudioScheduledSourceNode>();

  filter.type = "lowpass";
  filter.frequency.value = 18_000;
  output.connect(pan);
  pan.connect(filter);
  try {
    filter.connect(getNativeInput(destination));
  } catch (err) {
    firstPlayMark("lean-drum-voice:master-connect-fallback", {
      trackId: track.id,
      message: err instanceof Error ? err.message : String(err),
    });
    filter.connect(ctx.destination);
  }

  const applyTrack = (nextTrack: Track) => {
    muted = nextTrack.muted;
    volume = nextTrack.volume;
    output.gain.value = muted ? 0 : Math.max(0, Math.min(1, volume));
    pan.pan.value = Math.max(-1, Math.min(1, nextTrack.pan));
    if (nextTrack.sound) voice.applySoundParams(nextTrack.sound);
  };

  const voice: LeanDrumVoice = {
    mode: "lean",
    trackId: track.id,
    trigger: (piece, time, velocity) => {
      if (disposed || muted || velocity <= 0.001) return;
      recordLeanDrumTrace("hit-triggered", { trackId: track.id, piece });
      const decay = PIECE_DECAY[piece] ?? 0.12;
      const amp = Math.max(0, Math.min(1, velocity)) * Math.max(0, Math.min(1, volume));
      const sourceGain = ctx.createGain();
      const pieceFilter = ctx.createBiquadFilter();
      sourceGain.gain.setValueAtTime(Math.max(0.0001, amp), time);
      sourceGain.gain.exponentialRampToValueAtTime(0.0001, time + decay);
      pieceFilter.type = filterType(piece);
      pieceFilter.frequency.setValueAtTime(PIECE_FREQ[piece] ?? 800, time);
      pieceFilter.Q.value = piece === "kick" ? 0.7 : 1.2;
      pieceFilter.connect(sourceGain);
      sourceGain.connect(output);

      const cleanup = (source?: AudioScheduledSourceNode) => {
        if (source) activeSources.delete(source);
        try {
          source?.disconnect();
          sourceGain.disconnect();
          pieceFilter.disconnect();
          recordLeanDrumTrace("source-disconnected", { trackId: track.id, piece });
        } catch {
          // ignore one-shot cleanup races
        }
      };

      if (usesNoise(piece)) {
        const src = ctx.createBufferSource();
        activeSources.add(src);
        recordLeanDrumTrace("source-created", { trackId: track.id, piece, type: "AudioBufferSourceNode" });
        src.buffer = noiseBuffer;
        src.onended = () => {
          src.onended = null;
          recordLeanDrumTrace("source-ended", { trackId: track.id, piece, type: "AudioBufferSourceNode" });
          cleanup(src);
        };
        src.connect(pieceFilter);
        src.start(time);
        src.stop(time + decay);
        return;
      }

      const osc = ctx.createOscillator();
      activeSources.add(osc);
      recordLeanDrumTrace("source-created", { trackId: track.id, piece, type: "OscillatorNode" });
      osc.type = piece === "kick" ? "sine" : "triangle";
      const startFreq = PIECE_FREQ[piece] ?? 90;
      osc.frequency.setValueAtTime(startFreq, time);
      if (piece === "kick") {
        osc.frequency.exponentialRampToValueAtTime(Math.max(30, startFreq * 0.45), time + 0.08);
      }
      osc.onended = () => {
        osc.onended = null;
        recordLeanDrumTrace("source-ended", { trackId: track.id, piece, type: "OscillatorNode" });
        cleanup(osc);
      };
      osc.connect(pieceFilter);
      osc.start(time);
      osc.stop(time + decay);
    },
    applyTrack,
    applySoundParams: (partial) => {
      if (partial.cutoff !== undefined) {
        filter.frequency.setTargetAtTime(cutoffNormToHz(partial.cutoff), ctx.currentTime, 0.02);
      }
      if (partial.resonance !== undefined) {
        filter.Q.setTargetAtTime(Math.max(0.1, partial.resonance * 16), ctx.currentTime, 0.02);
      }
    },
    stopAll: () => {
      for (const source of Array.from(activeSources)) {
        try {
          source.onended = null;
          source.stop();
        } catch {
          // ignore sources that already ended
        }
        try {
          source.disconnect();
        } catch {
          // ignore disconnect races
        }
        activeSources.delete(source);
        recordLeanDrumTrace("source-disconnected", { trackId: track.id, forced: true });
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      voice.stopAll();
      try {
        filter.disconnect();
        pan.disconnect();
        output.disconnect();
      } catch {
        // ignore
      }
      recordLeanDrumTrace("voice-disposed", { trackId: track.id });
      Object.defineProperty(voice, "mode", { value: "disposed" satisfies LeanDrumMode });
    },
  };

  applyTrack(track);
  firstPlayMark("lean-drum-voice:create", { trackId: track.id, kitId: track.kitId });
  recordLeanDrumTrace("voice-created", { trackId: track.id, kitId: track.kitId });
  recordLeanDrumTrace("reused-track-nodes", { trackId: track.id, nodes: ["gain", "pan", "filter"] });
  firstPlayMeasure("lean-drum-voice:create", started, performance.now(), {
    trackId: track.id,
    kitId: track.kitId,
  });
  return voice;
}
