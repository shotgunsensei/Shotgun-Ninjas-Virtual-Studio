import * as Tone from "tone";
import type {
  AutomationParamId,
  DrumKitId,
  DrumPieceSettings,
  FxModuleId,
  FxModuleSettings,
  SendBusId,
  SoundParams,
  Track,
  TrackEq,
} from "../../types";
import { SEND_BUS_IDS } from "../../types";
import type { LevelMeter } from "./meterTypes";
import { DRUM_PIECES, type DrumPiece } from "./voices";
import { cutoffNormToHz, findKit } from "./sounds/kits";
import type { DrumPieceDef } from "./sounds/types";
import { firstPlayMark, firstPlayMeasure } from "../performance/firstPlayTrace";
import { recordLeanDrumTrace } from "../performance/audioNodeTrace";
import {
  connectToneCompatible,
  disconnectToneCompatible,
  resolveNativeAudioContext,
} from "./toneConnection";

export type LeanDrumMode = "shell" | "lean" | "disposed";

export interface LeanDrumVoice {
  readonly mode: LeanDrumMode;
  readonly trackId: string;
  readonly kitId: DrumKitId;
  /** Native input used by user-assigned drum-pad players. */
  readonly input: AudioNode;
  /** Piece-owned input for assigned samples so they inherit the same filter,
   * pan, volume and per-piece sends as the modeled recipe. */
  getPadInput: (piece: DrumPiece) => AudioNode;
  /** Apply modeled choke ownership when an external assigned sample fires. */
  chokeExternal: (piece: DrumPiece, time: number) => void;
  readonly meter: LevelMeter;
  isReady: () => boolean;
  trigger: (piece: DrumPiece, time: number, velocity: number) => void;
  applyTrack: (track: Track) => void;
  setKit: (kitId: DrumKitId) => void;
  setPieceSetting: (
    piece: DrumPiece,
    partial: Partial<DrumPieceSettings>,
    allSettings?: Partial<Record<string, Partial<DrumPieceSettings>>>,
  ) => void;
  setTrackEq: (eq: Partial<TrackEq>) => void;
  setEffectModule: (moduleId: FxModuleId, settings: Partial<FxModuleSettings>) => void;
  setSend: (busId: SendBusId, amount: number) => void;
  setVolume: (volume: number) => void;
  setPan: (pan: number) => void;
  applyAutomation: (
    param: AutomationParamId,
    value: number,
    rampEnd: number,
  ) => void;
  getMixSnapshot: () => {
    volumeDb: number;
    pan: number;
    hasEq: boolean;
    hasCompressor: boolean;
    sends: Partial<Record<SendBusId, number>>;
  };
  setAudible: (audible: boolean) => void;
  applySoundParams: (partial: Partial<SoundParams>) => void;
  stopAll: () => void;
  dispose: () => void;
}

const MAX_ACTIVE_HITS = 64;
const FLAT_EQ: TrackEq = {
  low: 0,
  mid: 0,
  high: 0,
  hpfOn: false,
  hpfHz: 80,
};

type SendDestinations = Partial<Record<SendBusId, Tone.InputNode>>;

function legacyKitId(track: Track): DrumKitId {
  if (track.kitId) return track.kitId;
  if (track.preset === "acoustic") return "garageband";
  if (track.preset === "electronic") return "cyberpunk";
  return "trap";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function volumeToGain(db: number | undefined, fallback = 1): number {
  return typeof db === "number" ? Math.pow(10, db / 20) : fallback;
}

function disconnectQuietly(node: AudioNode): void {
  try { node.disconnect(); } catch { /* already disconnected or context gone */ }
}

function linearToDb(value: number): number {
  return value <= 0.005 ? -Infinity : 20 * Math.log10(value);
}

/**
 * One fixed WaveShaper handles both saturation and bit-depth reduction. The
 * graph never changes while audio is running; only this bounded curve does.
 */
function makeDriveCurve(amount: number, bits: number): Float32Array<ArrayBuffer> {
  const size = 1024;
  const curve = new Float32Array(new ArrayBuffer(size * Float32Array.BYTES_PER_ELEMENT));
  const boundedAmount = clamp(amount, 0, 1);
  const boundedBits = Math.round(clamp(bits, 2, 16));
  const levels = Math.pow(2, boundedBits - 1);
  const drive = 1 + boundedAmount * 12;
  const normalizer = Math.tanh(drive);
  for (let index = 0; index < size; index += 1) {
    const input = (index / (size - 1)) * 2 - 1;
    const saturated = boundedAmount > 0
      ? Math.tanh(input * drive) / normalizer
      : input;
    curve[index] = boundedBits < 16
      ? Math.round(saturated * levels) / levels
      : saturated;
  }
  return curve;
}

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * 2));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function usesNoise(def: DrumPieceDef): boolean {
  return (
    def.synth.engine === "snare" ||
    def.synth.engine === "clap" ||
    def.synth.engine === "hat" ||
    def.synth.engine === "crash" ||
    (def.synth.engine === "fx" && Boolean(def.synth.noise))
  );
}

/** Replace pending smoothing automation on long-lived mixer parameters. Named
 * kit changes can touch dozens of piece controls in quick succession; keeping
 * only the latest target prevents an unbounded AudioParam event queue while
 * retaining a short click-safe transition. */
function setLatestTarget(
  param: AudioParam,
  value: number,
  time: number,
  timeConstant: number,
): void {
  const heldValue = param.value;
  try {
    param.cancelAndHoldAtTime(time);
  } catch {
    param.cancelScheduledValues(time);
    param.setValueAtTime(heldValue, time);
  }
  param.setTargetAtTime(value, time, timeConstant);
}

function configureRecipeFilter(
  node: BiquadFilterNode,
  def: DrumPieceDef,
  time: number,
): void {
  const recipe = def.synth;
  if (usesNoise(def) && recipe.highpass) {
    node.type = "highpass";
    node.frequency.setValueAtTime(clamp(recipe.highpass, 20, 18_000), time);
  } else {
    node.type = "lowpass";
    node.frequency.setValueAtTime(clamp(recipe.lowpass ?? 18_000, 40, 20_000), time);
  }
  node.Q.setValueAtTime(
    clamp(recipe.Q ?? (recipe.engine === "snare" ? 1.1 : 0.7), 0.1, 18),
    time,
  );
}

interface ActiveHit {
  sources: AudioScheduledSourceNode[];
  sourceGain: GainNode;
  recipeFilter: BiquadFilterNode;
  piece: DrumPiece;
  chokeGroup?: string;
  endedSources: number;
  cleaned: boolean;
  cleanupTimer?: ReturnType<typeof globalThis.setTimeout>;
}

interface PieceBus {
  input: GainNode;
  filter: BiquadFilterNode;
  pan: StereoPannerNode;
  reverbSend: GainNode;
  delaySend: GainNode;
}

/**
 * Bounded native drum instrument.
 *
 * Kit changes only replace data read by future hits; they never construct a
 * large Tone graph or disturb already-running audio. The destination is the
 * fixed-cost native mixer, so kit swaps never allocate or reconnect an effects
 * graph. User-assigned pad samples feed the same input and inherit the same
 * channel volume, pan, EQ, dynamics, drive, width, and sends.
 */
export function createLeanDrumVoice(
  track: Track,
  destination: Tone.InputNode,
  sendDestinations: SendDestinations = {},
): LeanDrumVoice {
  const started = performance.now();
  // Tone's `rawContext` can still be a standardized-audio-context proxy. A
  // transient source connected through that proxy recursively traverses the
  // entire downstream graph on every hit. Use the actual browser context so
  // dense hats remain constant-time after kit/sound-set changes.
  const ctx = resolveNativeAudioContext();
  const constructionNodes: AudioNode[] = [];
  const ownConstructionNode = <T extends AudioNode>(node: T): T => {
    constructionNodes.push(node);
    return node;
  };
  try {
  const mixInput = ownConstructionNode(ctx.createGain());
  const hpf = ownConstructionNode(ctx.createBiquadFilter());
  const lowShelf = ownConstructionNode(ctx.createBiquadFilter());
  const midPeak = ownConstructionNode(ctx.createBiquadFilter());
  const highShelf = ownConstructionNode(ctx.createBiquadFilter());
  const trackFilter = ownConstructionNode(ctx.createBiquadFilter());
  const compressor = ownConstructionNode(ctx.createDynamicsCompressor());
  const drive = ownConstructionNode(ctx.createWaveShaper());
  const driveDry = ownConstructionNode(ctx.createGain());
  const driveWet = ownConstructionNode(ctx.createGain());
  const driveSum = ownConstructionNode(ctx.createGain());
  const widthSplitter = ownConstructionNode(ctx.createChannelSplitter(2));
  const widthMerger = ownConstructionNode(ctx.createChannelMerger(2));
  const leftToLeft = ownConstructionNode(ctx.createGain());
  const leftToRight = ownConstructionNode(ctx.createGain());
  const rightToRight = ownConstructionNode(ctx.createGain());
  const rightToLeft = ownConstructionNode(ctx.createGain());
  const trackPan = ownConstructionNode(ctx.createStereoPanner());
  const trackFader = ownConstructionNode(ctx.createGain());
  const pieceReverbSum = ownConstructionNode(ctx.createGain());
  const pieceDelaySum = ownConstructionNode(ctx.createGain());
  const pieceReverbGate = ownConstructionNode(ctx.createGain());
  const pieceDelayGate = ownConstructionNode(ctx.createGain());
  const meterAnalyser = ownConstructionNode(ctx.createAnalyser());
  const meterData = new Float32Array(
    new ArrayBuffer(256 * Float32Array.BYTES_PER_ELEMENT),
  );
  const noiseBuffer = makeNoiseBuffer(ctx);
  const activeHits = new Set<ActiveHit>();
  const pieceSettings = new Map<DrumPiece, Partial<DrumPieceSettings>>();
  const pieceBuses = new Map<DrumPiece, PieceBus>();
  const sendGains = new Map<SendBusId, GainNode>();
  const baseSendLevels = new Map<SendBusId, number>();
  const effectSendLevels = new Map<SendBusId, number>();
  const sendLevels = new Map<SendBusId, number>();
  let currentKitId = legacyKitId(track);
  let currentKit = findKit(currentKitId);
  let anyPieceSolo = false;
  let disposed = false;
  let routingAvailable = false;
  let audible = true;
  let trackVolume = clamp(track.volume, 0, 1);
  let trackEq: TrackEq = { ...FLAT_EQ, ...(track.eq ?? {}) };
  let eqEnabled = true;
  let compressorEnabled = false;
  let saturationAmount = 0;
  let bitcrusherBits = 16;
  let stereoWidth = 0.5;
  let trackSound: Partial<SoundParams> = {};
  let lastDriveCurveKey = "";

  hpf.type = "highpass";
  hpf.frequency.value = 20;
  hpf.Q.value = 0.7;
  lowShelf.type = "lowshelf";
  lowShelf.frequency.value = 180;
  midPeak.type = "peaking";
  midPeak.frequency.value = 1_000;
  midPeak.Q.value = 0.8;
  highShelf.type = "highshelf";
  highShelf.frequency.value = 6_000;
  trackFilter.type = "lowpass";
  trackFilter.frequency.value = 20_000;
  trackFilter.Q.value = 0.1;
  compressor.threshold.value = 0;
  compressor.ratio.value = 1;
  compressor.knee.value = 0;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.12;
  drive.curve = makeDriveCurve(0, 16);
  drive.oversample = "none";
  driveDry.gain.value = 1;
  driveWet.gain.value = 0;
  meterAnalyser.fftSize = 256;
  meterAnalyser.smoothingTimeConstant = 0.7;

  // A fixed mid/side-like matrix provides mono-to-wide control without a
  // permanent Tone.StereoWidener graph. At 0.5 it is bit-for-bit natural;
  // below that it crossfeeds toward mono, above it increases separation.
  mixInput.connect(hpf);
  hpf.connect(lowShelf);
  lowShelf.connect(midPeak);
  midPeak.connect(highShelf);
  highShelf.connect(trackFilter);
  trackFilter.connect(compressor);
  compressor.connect(driveDry);
  compressor.connect(drive);
  drive.connect(driveWet);
  driveDry.connect(driveSum);
  driveWet.connect(driveSum);
  driveSum.connect(widthSplitter);
  widthSplitter.connect(leftToLeft, 0);
  widthSplitter.connect(leftToRight, 0);
  widthSplitter.connect(rightToRight, 1);
  widthSplitter.connect(rightToLeft, 1);
  leftToLeft.connect(widthMerger, 0, 0);
  rightToLeft.connect(widthMerger, 0, 0);
  rightToRight.connect(widthMerger, 0, 1);
  leftToRight.connect(widthMerger, 0, 1);
  widthMerger.connect(trackPan);
  trackPan.connect(trackFader);
  trackFader.connect(meterAnalyser);
  pieceReverbSum.connect(pieceReverbGate);
  pieceDelaySum.connect(pieceDelayGate);
  pieceReverbGate.gain.value = 0;
  pieceDelayGate.gain.value = 0;

  const reverbDestination = sendDestinations.roomReverb;
  const delayDestination = sendDestinations.tapeDelay;
  if (reverbDestination) {
    try { connectToneCompatible(pieceReverbGate, reverbDestination); } catch { /* optional */ }
  }
  if (delayDestination) {
    try { connectToneCompatible(pieceDelayGate, delayDestination); } catch { /* optional */ }
  }

  for (const piece of DRUM_PIECES) {
    const input = ownConstructionNode(ctx.createGain());
    const filter = ownConstructionNode(ctx.createBiquadFilter());
    const pan = ownConstructionNode(ctx.createStereoPanner());
    const reverbSend = ownConstructionNode(ctx.createGain());
    const delaySend = ownConstructionNode(ctx.createGain());
    filter.type = "lowpass";
    filter.frequency.value = 20_000;
    filter.Q.value = 0.5;
    reverbSend.gain.value = 0;
    delaySend.gain.value = 0;
    input.connect(filter);
    filter.connect(pan);
    pan.connect(mixInput);
    pan.connect(reverbSend);
    pan.connect(delaySend);
    reverbSend.connect(pieceReverbSum);
    delaySend.connect(pieceDelaySum);
    pieceBuses.set(piece, { input, filter, pan, reverbSend, delaySend });
  }

  try {
    connectToneCompatible(trackFader, destination);
    routingAvailable = true;
  } catch (error) {
    firstPlayMark("lean-drum-voice:master-connect-failed", {
      trackId: track.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  for (const busId of SEND_BUS_IDS) {
    const send = ownConstructionNode(ctx.createGain());
    send.gain.value = 0;
    trackFader.connect(send);
    const sendDestination = sendDestinations[busId];
    if (sendDestination) {
      try {
        connectToneCompatible(send, sendDestination);
      } catch (error) {
        firstPlayMark("lean-drum-voice:send-connect-failed", {
          trackId: track.id,
          busId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    sendGains.set(busId, send);
    baseSendLevels.set(busId, 0);
    effectSendLevels.set(busId, 0);
    sendLevels.set(busId, 0);
  }

  const applyFader = () => {
    const target = audible ? trackVolume : 0;
    setLatestTarget(trackFader.gain, target, ctx.currentTime, 0.008);
    setLatestTarget(pieceReverbGate.gain, target, ctx.currentTime, 0.008);
    setLatestTarget(pieceDelayGate.gain, target, ctx.currentTime, 0.008);
  };

  const applyEq = () => {
    const next = eqEnabled ? trackEq : FLAT_EQ;
    setLatestTarget(lowShelf.gain, clamp(next.low, -12, 12), ctx.currentTime, 0.01);
    setLatestTarget(midPeak.gain, clamp(next.mid, -12, 12), ctx.currentTime, 0.01);
    setLatestTarget(highShelf.gain, clamp(next.high, -12, 12), ctx.currentTime, 0.01);
    setLatestTarget(
      hpf.frequency,
      next.hpfOn ? clamp(next.hpfHz, 20, 2_000) : 20,
      ctx.currentTime,
      0.01,
    );
  };

  const applyWidth = () => {
    const width = clamp(stereoWidth, 0, 1);
    const main = 0.5 + width;
    const cross = 0.5 - width;
    setLatestTarget(leftToLeft.gain, main, ctx.currentTime, 0.01);
    setLatestTarget(rightToRight.gain, main, ctx.currentTime, 0.01);
    setLatestTarget(leftToRight.gain, cross, ctx.currentTime, 0.01);
    setLatestTarget(rightToLeft.gain, cross, ctx.currentTime, 0.01);
  };

  const applyDrive = () => {
    const curveAmount = Math.round(clamp(saturationAmount, 0, 1) * 32) / 32;
    const curveKey = `${curveAmount}:${bitcrusherBits}`;
    if (lastDriveCurveKey !== curveKey) {
      drive.curve = makeDriveCurve(curveAmount, bitcrusherBits);
      lastDriveCurveKey = curveKey;
    }
    const wet = bitcrusherBits < 16
      ? 1
      : curveAmount > 0
        ? Math.min(1, curveAmount * 1.8)
        : 0;
    setLatestTarget(driveDry.gain, 1 - wet, ctx.currentTime, 0.008);
    setLatestTarget(driveWet.gain, wet, ctx.currentTime, 0.008);
  };

  const rampParam = (param: AudioParam, value: number, rampEnd: number) => {
    const now = ctx.currentTime;
    const end = Math.max(now + 0.002, rampEnd);
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, end);
  };

  const applySendLevel = (busId: SendBusId) => {
    const bounded = Math.max(
      baseSendLevels.get(busId) ?? 0,
      effectSendLevels.get(busId) ?? 0,
    );
    sendLevels.set(busId, bounded);
    const sendGain = sendGains.get(busId);
    if (sendGain) setLatestTarget(sendGain.gain, bounded, ctx.currentTime, 0.01);
  };

  const setSendLevel = (busId: SendBusId, amount: number) => {
    baseSendLevels.set(busId, clamp(amount, 0, 1));
    applySendLevel(busId);
  };

  const setEffectSendLevel = (busId: SendBusId, amount: number) => {
    effectSendLevels.set(busId, clamp(amount, 0, 1));
    applySendLevel(busId);
  };

  const applyTrackEq = (partial: Partial<TrackEq>) => {
    trackEq = { ...trackEq, ...partial };
    applyEq();
  };

  const applyEffectModule = (
    moduleId: FxModuleId,
    settings: Partial<FxModuleSettings>,
  ) => {
    const enabled = settings.enabled !== false;
    const amount = clamp(settings.amount ?? 0.5, 0, 1);
    const params = settings.params ?? {};
    switch (moduleId) {
      case "eq":
        eqEnabled = enabled;
        applyEq();
        return;
      case "compressor": {
        compressorEnabled = enabled;
        if (!enabled) {
          setLatestTarget(compressor.threshold, 0, ctx.currentTime, 0.01);
          setLatestTarget(compressor.ratio, 1, ctx.currentTime, 0.01);
          setLatestTarget(compressor.knee, 0, ctx.currentTime, 0.01);
          return;
        }
        const threshold = clamp(params.threshold ?? amount, 0, 1);
        const ratio = clamp(params.ratio ?? amount, 0, 1);
        setLatestTarget(compressor.threshold, -6 - 24 * threshold, ctx.currentTime, 0.01);
        setLatestTarget(compressor.ratio, 1.5 + 8.5 * ratio, ctx.currentTime, 0.01);
        setLatestTarget(compressor.knee, 6, ctx.currentTime, 0.01);
        setLatestTarget(compressor.attack, 0.005 + 0.04 * (1 - amount), ctx.currentTime, 0.01);
        setLatestTarget(compressor.release, 0.08 + 0.4 * amount, ctx.currentTime, 0.01);
        return;
      }
      case "saturation":
        saturationAmount = enabled ? 0.05 + amount * 0.75 : 0;
        applyDrive();
        return;
      case "bitcrusher":
        bitcrusherBits = enabled
          ? Math.round(16 - 14 * clamp(params.bits ?? amount, 0, 1))
          : 16;
        applyDrive();
        return;
      case "delay":
        setEffectSendLevel("tapeDelay", enabled ? amount : 0);
        return;
      case "reverb":
        setEffectSendLevel("roomReverb", enabled ? amount : 0);
        return;
      case "chorus":
        // The global Neon Hall is the bounded shared modulation/spatial path;
        // drums avoid creating a per-track always-running LFO source.
        setEffectSendLevel("neonHall", enabled ? amount * 0.45 : 0);
        return;
      case "stereoWidth":
        stereoWidth = enabled ? amount : 0.5;
        applyWidth();
        return;
    }
  };

  const applySoundParams = (partial: Partial<SoundParams>) => {
    trackSound = { ...trackSound, ...partial };
    if (partial.cutoff !== undefined) {
      setLatestTarget(
        trackFilter.frequency,
        cutoffNormToHz(clamp(partial.cutoff, 0, 1)),
        ctx.currentTime,
        0.01,
      );
    }
    if (partial.resonance !== undefined) {
      setLatestTarget(
        trackFilter.Q,
        0.1 + clamp(partial.resonance, 0, 1) * 16,
        ctx.currentTime,
        0.01,
      );
    }
    if (partial.drive !== undefined) {
      saturationAmount = clamp(partial.drive, 0, 1) * 0.9;
      applyDrive();
    }
    if (partial.width !== undefined) {
      stereoWidth = clamp(partial.width, 0, 1);
      applyWidth();
    }
    if (partial.reverbSend !== undefined) {
      setSendLevel("roomReverb", partial.reverbSend);
    }
    if (partial.delaySend !== undefined) {
      setSendLevel("tapeDelay", partial.delaySend);
    }
    if (partial.chorusSend !== undefined) {
      setSendLevel("neonHall", partial.chorusSend * 0.45);
    }
  };

  const applyAutomation = (
    param: AutomationParamId,
    value: number,
    rampEnd: number,
  ) => {
    const bounded = clamp(value, 0, 1);
    switch (param) {
      case "volume":
        rampParam(trackFader.gain, audible ? bounded : 0, rampEnd);
        rampParam(pieceReverbGate.gain, audible ? bounded : 0, rampEnd);
        rampParam(pieceDelayGate.gain, audible ? bounded : 0, rampEnd);
        return;
      case "pan":
        rampParam(trackPan.pan, bounded * 2 - 1, rampEnd);
        return;
      case "filterCutoff":
        rampParam(trackFilter.frequency, 200 + bounded ** 2 * 17_800, rampEnd);
        return;
      case "reverbSend": {
        baseSendLevels.set("roomReverb", bounded);
        const target = Math.max(bounded, effectSendLevels.get("roomReverb") ?? 0);
        sendLevels.set("roomReverb", target);
        const gain = sendGains.get("roomReverb");
        if (gain) rampParam(gain.gain, target, rampEnd);
        return;
      }
      case "delaySend": {
        baseSendLevels.set("tapeDelay", bounded);
        const target = Math.max(bounded, effectSendLevels.get("tapeDelay") ?? 0);
        sendLevels.set("tapeDelay", target);
        const gain = sendGains.get("tapeDelay");
        if (gain) rampParam(gain.gain, target, rampEnd);
        return;
      }
      case "distortionAmount":
        saturationAmount = Math.round(bounded * 16) / 16;
        applyDrive();
        return;
      case "effectWetDry": {
        effectSendLevels.set("neonHall", bounded * 0.45);
        const target = Math.max(
          baseSendLevels.get("neonHall") ?? 0,
          effectSendLevels.get("neonHall") ?? 0,
        );
        sendLevels.set("neonHall", target);
        const gain = sendGains.get("neonHall");
        if (gain) rampParam(gain.gain, target, rampEnd);
        return;
      }
      case "pitch":
      case "sampleStart":
        return;
    }
  };

  const meter: LevelMeter = {
    getValue: () => {
      if (disposed || !routingAvailable) return -Infinity;
      meterAnalyser.getFloatTimeDomainData(meterData);
      let peak = 0;
      for (let index = 0; index < meterData.length; index += 1) {
        peak = Math.max(peak, Math.abs(meterData[index] ?? 0));
      }
      return peak <= 0.000_001 ? -Infinity : 20 * Math.log10(peak);
    },
  };

  const cleanup = (hit: ActiveHit, forced = false) => {
    if (hit.cleaned) return;
    hit.cleaned = true;
    if (hit.cleanupTimer !== undefined) {
      globalThis.clearTimeout(hit.cleanupTimer);
      hit.cleanupTimer = undefined;
    }
    activeHits.delete(hit);
    try {
      for (const source of hit.sources) {
        source.onended = null;
        source.disconnect();
      }
      hit.sourceGain.disconnect();
      hit.recipeFilter.disconnect();
      recordLeanDrumTrace("source-disconnected", {
        trackId: track.id,
        piece: hit.piece,
        forced,
        sources: hit.sources.length,
      });
    } catch {
      // A source can end between stop() and disconnect(); cleanup is idempotent.
    }
  };

  const stopHit = (hit: ActiveHit, time = ctx.currentTime) => {
    if (hit.cleaned) return;
    const stopAt = Math.max(ctx.currentTime, time);
    try {
      hit.sourceGain.gain.cancelScheduledValues(stopAt);
      hit.sourceGain.gain.setTargetAtTime(0.0001, stopAt, 0.004);
    } catch {
      // The authoritative stop below still releases the source.
    }
    for (const source of hit.sources) {
      try { source.stop(stopAt + 0.015); } catch { /* already stopped */ }
    }
    if (hit.cleanupTimer === undefined) {
      const delayMs = Math.max(0, (stopAt - ctx.currentTime) * 1_000) + 40;
      hit.cleanupTimer = globalThis.setTimeout(() => cleanup(hit, true), delayMs);
    }
  };

  const replacePieceSettings = (
    values: Partial<Record<string, Partial<DrumPieceSettings>>> | undefined,
  ) => {
    pieceSettings.clear();
    if (!values) return;
    for (const [piece, settings] of Object.entries(values)) {
      if (settings) pieceSettings.set(piece as DrumPiece, { ...settings });
    }
  };

  const updatePieceBuses = () => {
    currentKit = findKit(currentKitId);
    const now = ctx.currentTime;
    anyPieceSolo = false;
    for (const settings of pieceSettings.values()) {
      if (settings.solo) {
        anyPieceSolo = true;
        break;
      }
    }
    for (const piece of DRUM_PIECES) {
      const bus = pieceBuses.get(piece);
      const def = currentKit.pieces[piece];
      if (!bus || !def) continue;
      const settings = pieceSettings.get(piece);
      const enabled =
        !settings?.muted && (!anyPieceSolo || Boolean(settings?.solo));
      const volume = enabled
        ? clamp(settings?.volume ?? def.defaultVolume ?? 0.85, 0, 1)
        : 0;
      setLatestTarget(bus.input.gain, volume, now, 0.008);
      setLatestTarget(
        bus.filter.frequency,
        cutoffNormToHz(clamp(settings?.cutoff ?? def.defaultCutoff ?? 1, 0, 1)),
        now,
        0.008,
      );
      setLatestTarget(
        bus.pan.pan,
        clamp(settings?.pan ?? def.defaultPan ?? 0, -1, 1),
        now,
        0.008,
      );
      setLatestTarget(
        bus.reverbSend.gain,
        enabled
          ? clamp(settings?.reverbSend ?? def.defaultReverbSend ?? 0, 0, 1)
          : 0,
        now,
        0.008,
      );
      setLatestTarget(
        bus.delaySend.gain,
        enabled
          ? clamp(settings?.delaySend ?? def.defaultDelaySend ?? 0, 0, 1)
          : 0,
        now,
        0.008,
      );
    }
  };

  const applyTrack = (nextTrack: Track) => {
    const now = ctx.currentTime;
    currentKitId = legacyKitId(nextTrack);
    trackVolume = clamp(nextTrack.volume, 0, 1);
    setLatestTarget(trackPan.pan, clamp(nextTrack.pan, -1, 1), now, 0.008);
    trackEq = { ...FLAT_EQ, ...(nextTrack.eq ?? {}) };
    eqEnabled = true;
    compressorEnabled = false;
    saturationAmount = 0;
    bitcrusherBits = 16;
    stereoWidth = 0.5;
    trackSound = {};
    for (const [param, value] of [
      [compressor.threshold, 0],
      [compressor.ratio, 1],
      [compressor.knee, 0],
      [trackFilter.frequency, 200 + clamp(nextTrack.fx.filter, 0, 1) ** 2 * 17_800],
      [trackFilter.Q, 0.1],
    ] as const) {
      param.cancelScheduledValues(now);
      param.setValueAtTime(value, now);
    }
    for (const busId of SEND_BUS_IDS) {
      baseSendLevels.set(busId, 0);
      effectSendLevels.set(busId, 0);
      applySendLevel(busId);
    }
    applyEq();
    applyWidth();
    applyDrive();
    setSendLevel("roomReverb", nextTrack.fx.reverb);
    setSendLevel("tapeDelay", nextTrack.fx.delay);
    if (nextTrack.sound) applySoundParams(nextTrack.sound);
    if (nextTrack.sends) {
      for (const [busId, amount] of Object.entries(nextTrack.sends) as [
        SendBusId,
        number,
      ][]) {
        setSendLevel(busId, amount);
      }
    }
    if (nextTrack.fxRack) {
      for (const [moduleId, settings] of Object.entries(nextTrack.fxRack) as [
        FxModuleId,
        FxModuleSettings,
      ][]) {
        applyEffectModule(moduleId, settings);
      }
    }
    replacePieceSettings(nextTrack.pieceSettings);
    updatePieceBuses();
    applyFader();
  };

  const registerHit = (hit: ActiveHit) => {
    activeHits.add(hit);
    for (const source of hit.sources) {
      source.onended = () => {
        hit.endedSources += 1;
        recordLeanDrumTrace("source-ended", { trackId: track.id, piece: hit.piece });
        if (hit.endedSources >= hit.sources.length) {
          cleanup(hit);
        }
      };
    }
    while (activeHits.size > MAX_ACTIVE_HITS) {
      const oldest = activeHits.values().next().value as ActiveHit | undefined;
      if (!oldest) break;
      stopHit(oldest);
      activeHits.delete(oldest);
    }
  };

  const chokePieceGroup = (piece: DrumPiece, requestedTime: number) => {
    const def = currentKit.pieces[piece];
    if (!def?.chokeGroup) return;
    const time = Math.max(ctx.currentTime, requestedTime);
    for (const active of Array.from(activeHits)) {
      if (active.chokeGroup === def.chokeGroup) stopHit(active, time);
    }
  };

  const voice: LeanDrumVoice = {
    mode: "lean",
    trackId: track.id,
    get kitId() {
      return currentKitId;
    },
    input: mixInput,
    getPadInput: (piece) => pieceBuses.get(piece)?.input ?? mixInput,
    chokeExternal: (piece, time) => {
      if (disposed || !routingAvailable || !audible) return;
      const settings = pieceSettings.get(piece);
      if (settings?.muted || (anyPieceSolo && !settings?.solo)) return;
      chokePieceGroup(piece, time);
    },
    meter,
    isReady: () => !disposed && routingAvailable,
    trigger: (piece, requestedTime, velocity) => {
      if (disposed || !routingAvailable || !audible || velocity <= 0.001) return;
      const def = currentKit.pieces[piece];
      if (!def) return;
      const pieceBus = pieceBuses.get(piece);
      if (!pieceBus) return;
      const settings = pieceSettings.get(piece);
      if (settings?.muted || (anyPieceSolo && !settings?.solo)) return;

      const time = Math.max(ctx.currentTime, requestedTime);
      chokePieceGroup(piece, time);

      const recipe = def.synth;
      const pitchSemis = clamp(settings?.pitch ?? def.defaultPitch ?? 0, -24, 24);
      const spread = recipe.pitchSpread ?? 0;
      const jitter = spread > 0 ? (Math.random() * 2 - 1) * spread : 0;
      const midiPitch =
        (recipe.pitch ?? (recipe.engine === "kick" ? 40 : 56)) + pitchSemis + jitter;
      const decayMul = clamp(settings?.decay ?? 1, 0.05, 1);
      const decay = clamp(
        (recipe.decay ?? def.defaultDecay ?? 0.25) * decayMul,
        0.025,
        2.5,
      );
      const bodyGain = volumeToGain(recipe.bodyLevelDb, 1);
      const amp = clamp(velocity, 0, 1) * bodyGain;

      const sources: AudioScheduledSourceNode[] = [];
      let sourceGain: GainNode | null = null;
      let recipeFilter: BiquadFilterNode | null = null;
      try {
        sourceGain = ctx.createGain();
        recipeFilter = ctx.createBiquadFilter();
        configureRecipeFilter(recipeFilter, def, time);
        sourceGain.gain.setValueAtTime(Math.max(0.0001, amp), time);
        sourceGain.gain.exponentialRampToValueAtTime(0.0001, time + decay);
        recipeFilter.connect(sourceGain);
        sourceGain.connect(pieceBus.input);

        const addNoise = (duration = decay) => {
          const source = ctx.createBufferSource();
          // Own the source before any operation that can throw so the catch
          // path can stop/disconnect a partially scheduled hit.
          sources.push(source);
          source.buffer = noiseBuffer;
          source.loop = true;
          source.playbackRate.setValueAtTime(Math.pow(2, pitchSemis / 12), time);
          source.connect(recipeFilter!);
          source.start(time);
          source.stop(time + duration);
          recordLeanDrumTrace("source-created", {
            trackId: track.id,
            piece,
            type: "AudioBufferSourceNode",
          });
        };
        const addOscillator = (duration = decay) => {
          const source = ctx.createOscillator();
          sources.push(source);
          source.type =
            recipe.engine === "kick"
              ? "sine"
              : recipe.engine === "fx"
                ? "sawtooth"
                : "triangle";
          const frequency = clamp(midiToHz(midiPitch), 24, 12_000);
          source.frequency.setValueAtTime(frequency, time);
          if (recipe.engine === "kick") {
            const octaves = clamp(recipe.octaves ?? 4, 0, 10);
            source.frequency.setValueAtTime(
              clamp(frequency * Math.pow(2, octaves / 2), 30, 16_000),
              time,
            );
            source.frequency.exponentialRampToValueAtTime(
              Math.max(24, frequency),
              time + clamp(recipe.pitchDecay ?? 0.06, 0.015, Math.min(0.3, decay)),
            );
          }
          source.connect(recipeFilter!);
          source.start(time);
          source.stop(time + duration);
          recordLeanDrumTrace("source-created", {
            trackId: track.id,
            piece,
            type: "OscillatorNode",
          });
        };

        if (usesNoise(def)) addNoise();
        else addOscillator();
        // A short tonal body prevents synthetic snares from becoming a thin
        // noise click without expanding every piece into a permanent voice pool.
        if (recipe.engine === "snare") addOscillator(Math.min(decay, 0.16));

        registerHit({
          sources,
          sourceGain,
          recipeFilter,
          piece,
          chokeGroup: def.chokeGroup,
          endedSources: 0,
          cleaned: false,
        });
        recordLeanDrumTrace("hit-triggered", {
          trackId: track.id,
          piece,
          kitId: currentKitId,
          sources: sources.length,
        });
      } catch (error) {
        for (const source of sources) {
          try { source.stop(); } catch { /* never started or already ended */ }
          disconnectQuietly(source);
        }
        if (sourceGain) disconnectQuietly(sourceGain);
        if (recipeFilter) disconnectQuietly(recipeFilter);
        recordLeanDrumTrace("hit-failed", {
          trackId: track.id,
          piece,
          sourcesOwned: sources.length,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    applyTrack,
    setKit: (kitId) => {
      if (currentKitId === kitId) return;
      currentKitId = kitId;
      updatePieceBuses();
      recordLeanDrumTrace("kit-selected", { trackId: track.id, kitId });
    },
    setPieceSetting: (piece, partial, allSettings) => {
      if (allSettings) replacePieceSettings(allSettings);
      pieceSettings.set(piece, {
        ...(pieceSettings.get(piece) ?? {}),
        ...partial,
      });
      updatePieceBuses();
    },
    setTrackEq: applyTrackEq,
    setEffectModule: applyEffectModule,
    setSend: setSendLevel,
    setVolume: (volume) => {
      trackVolume = clamp(volume, 0, 1);
      applyFader();
    },
    setPan: (pan) => {
      setLatestTarget(trackPan.pan, clamp(pan, -1, 1), ctx.currentTime, 0.008);
    },
    applyAutomation,
    getMixSnapshot: () => ({
      volumeDb: audible ? linearToDb(trackVolume) : -Infinity,
      pan: trackPan.pan.value,
      hasEq:
        eqEnabled &&
        (trackEq.hpfOn ||
          Math.abs(trackEq.low) > 0.001 ||
          Math.abs(trackEq.mid) > 0.001 ||
          Math.abs(trackEq.high) > 0.001),
      hasCompressor: compressorEnabled,
      sends: Object.fromEntries(sendLevels.entries()) as Partial<
        Record<SendBusId, number>
      >,
    }),
    setAudible: (nextAudible) => {
      audible = nextAudible;
      applyFader();
      updatePieceBuses();
    },
    applySoundParams,
    stopAll: () => {
      for (const hit of Array.from(activeHits)) stopHit(hit);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      voice.stopAll();
      for (const hit of Array.from(activeHits)) cleanup(hit, true);
      if (routingAvailable) {
        try { disconnectToneCompatible(trackFader, destination); } catch { /* gone */ }
        routingAvailable = false;
      }
      for (const [busId, send] of sendGains) {
        const sendDestination = sendDestinations[busId];
        if (sendDestination) {
          try { disconnectToneCompatible(send, sendDestination); } catch { /* gone */ }
        }
        disconnectQuietly(send);
      }
      sendGains.clear();
      baseSendLevels.clear();
      effectSendLevels.clear();
      sendLevels.clear();
      if (reverbDestination) {
        try {
          disconnectToneCompatible(pieceReverbGate, reverbDestination);
        } catch { /* gone */ }
      }
      if (delayDestination) {
        try {
          disconnectToneCompatible(pieceDelayGate, delayDestination);
        } catch { /* gone */ }
      }
      for (const bus of pieceBuses.values()) {
        disconnectQuietly(bus.input);
        disconnectQuietly(bus.filter);
        disconnectQuietly(bus.pan);
        disconnectQuietly(bus.reverbSend);
        disconnectQuietly(bus.delaySend);
      }
      pieceBuses.clear();
      for (const node of [
        mixInput,
        hpf,
        lowShelf,
        midPeak,
        highShelf,
        trackFilter,
        compressor,
        drive,
        driveDry,
        driveWet,
        driveSum,
        widthSplitter,
        leftToLeft,
        leftToRight,
        rightToRight,
        rightToLeft,
        widthMerger,
        trackPan,
        trackFader,
        pieceReverbSum,
        pieceDelaySum,
        pieceReverbGate,
        pieceDelayGate,
        meterAnalyser,
      ]) {
        disconnectQuietly(node);
      }
      recordLeanDrumTrace("voice-disposed", { trackId: track.id });
      Object.defineProperty(voice, "mode", { value: "disposed" satisfies LeanDrumMode });
    },
  };

  applyTrack(track);
  firstPlayMark("lean-drum-voice:create", { trackId: track.id, kitId: currentKitId });
  recordLeanDrumTrace("voice-created", { trackId: track.id, kitId: currentKitId });
  recordLeanDrumTrace("reused-track-nodes", {
    trackId: track.id,
    nodes: ["native-eq", "native-compressor", "native-width", "send-buses"],
  });
  firstPlayMeasure("lean-drum-voice:create", started, performance.now(), {
    trackId: track.id,
    kitId: currentKitId,
  });
  return voice;
  } catch (error) {
    for (let index = constructionNodes.length - 1; index >= 0; index -= 1) {
      disconnectQuietly(constructionNodes[index]);
    }
    firstPlayMark("lean-drum-voice:create-failed", {
      trackId: track.id,
      message: error instanceof Error ? error.message : String(error),
      nodesOwned: constructionNodes.length,
    });
    recordLeanDrumTrace("voice-create-failed", {
      trackId: track.id,
      nodesOwned: constructionNodes.length,
    });
    throw error;
  }
}
