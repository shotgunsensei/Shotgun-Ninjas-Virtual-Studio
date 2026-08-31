import { studioAudioContext } from "./toneContext";
import * as Tone from "tone";
import type {
  AnyPreset,
  AutomationInterpolation,
  AutomationLane,
  AutomationParamId,
  DrumKitId,
  DrumPadSamplePiece,
  DrumPieceSettings,
  FxModuleId,
  FxModuleSettings,
  GrooveSettings,
  InstrumentKind,
  MasterBusSettings,
  ModulationRouting,
  ModulationSource,
  NoteClip,
  Project,
  SampleLibraryItem,
  SendBusId,
  SoundParams,
  Track,
  TrackEq,
  VocalsPreset,
} from "../../types";
import { SEND_BUS_IDS } from "../../types";
import { MasterChain } from "./master";
import { describeError, workletManager } from "./worklet-manager";
import {
  getWorkletPlayerEnabled,
  setWorkletPlayerEnabled,
} from "./worklet-sample-player";
import { lookaheadScheduler } from "./lookahead-scheduler";
import {
  announceSamplerLoadIfNeeded,
  buildDrumKit,
  buildMelodicVoice,
  releaseAllNotes,
  type DrumKit,
  type DrumPiece,
  type MelodicVoice,
} from "./voices";
import {
  cutoffNormToHz,
  type KitVoice,
} from "./sounds/kits";
import { buildPresetVoice, findPreset } from "./sounds/presets";
import { getSampleCacheStats, tryLoadMelodicSampler } from "./sounds/samples";
import { applyGroove, getGroove, shouldFlam, shouldGhost } from "./sounds/groove";
import {
  configureChopEngineOutput,
  disconnectChopEngineOutput,
  disposeChopEngine,
  getChopEngine,
  stopChopEngine,
} from "./chopEngine";
import { createLeanDrumVoice, type LeanDrumVoice } from "./leanDrumVoice";
import { connectToneCompatible, resolveToneContextInput } from "./toneConnection";
import { LeanDrumTrackSettingsCache } from "./leanDrumTrackSettings";
import type { LevelMeter } from "./meterTypes";
import { DrumPadSampleManager } from "./drumPadSamples";
import {
  startPerfTimer,
  trackAudioResource,
  trackTransportEvent,
  untrackTransportEvent,
} from "../../utils/performanceDiagnostics";
import {
  firstPlayMark,
  firstPlayMeasure,
  getFirstPlayFlags,
  isFirstPlayTraceEnabled,
} from "../performance/firstPlayTrace";
import { recordLeanDrumTrace, trackToneCreate, trackToneDispose } from "../performance/audioNodeTrace";
import { markStartupSound } from "../performance/startupSoundTrace";
import { jamCapture } from "../performance/jamCapture";

const AUDIO_WORKLETS_ENABLED = import.meta.env?.VITE_STUDIO_ENABLE_AUDIO_WORKLETS === "1";
const AUDIO_START_TIMEOUT_MS = 5_000;
const FIRST_PLAY_WATCHDOG_MS = 2_000;

// Re-export voice primitives so existing call sites that import from
// `./engine` (export.ts, components) keep compiling without churn.
export {
  DRUM_PIECES,
  PolyPluck,
  buildBass,
  buildDrumKit,
  buildGuitar,
  buildPiano,
  triggerDrumPiece,
} from "./voices";
export type { DrumKit, DrumPiece, DrumVoice, MelodicVoice } from "./voices";

/**
 * AudioEngine facade.
 *
 * Singleton that owns Tone.Transport, the master safety chain, and a
 * per-track voice. Every UI-visible knob in the studio maps to a method
 * here. Voice construction, drum kits, and preset factories live in
 * `voices.ts`; the master bus + limiter/compressor live in `master.ts`.
 * The rest of the app only imports from this file.
 *
 * The public surface is intentionally additive: later v2 tasks (mixer,
 * sequencer, recording, export) extend this facade with new methods
 * rather than reshaping the existing signatures.
 */

interface TrackVoice {
  readonly trackId: string;
  channel: Tone.Channel;
  meter: Tone.Meter;
  delay: Tone.FeedbackDelay;
  filter: Tone.Filter;
  /** v2 sound-shaping nodes inserted in the per-track chain after the
   *  filter so per-voice sound params (drive, chorus, width) are
   *  audible without rebuilding the voice. Created lazily when enabled. */
  drive?: Tone.Distortion;
  chorus?: Tone.Chorus;
  widener?: Tone.StereoWidener;
  /** v2 mixer nodes: high-pass + 3-band EQ inserted between filter and
   *  drive; compressor + bitcrusher inserted later in the chain. Created lazily. */
  hpf?: Tone.Filter;
  eq3?: Tone.EQ3;
  comp?: Tone.Compressor;
  bitcrusher?: Tone.BitCrusher;
  /** Per-track sends to the 4 named global buses (post-fader). */
  sends?: Map<SendBusId, Tone.Gain>;
  poly?: MelodicVoice;
  drums?: DrumKit;
  /** v2 sound-model kit (when track.kitId is set). Coexists with `drums`. */
  kit?: KitVoice;
  /** Active kit id so we know when to rebuild on kit change. */
  kitId?: DrumKitId;
  /** Active melodic preset id (when track.presetId is set). */
  presetId?: string;
  /** Invalidates async sampler loads when an instrument is replaced/disposed. */
  instrumentGeneration: number;
  mic?: Tone.UserMedia;
  micOn?: boolean;
  dispose: () => void;
}

interface InstrumentState {
  poly?: MelodicVoice;
  drums?: DrumKit;
  kit?: KitVoice;
  kitId?: DrumKitId;
  presetId?: string;
}

type VoiceMode = "shell" | "lean" | "tone" | "disposed";

interface EnsureTrackOptions {
  mode?: Exclude<VoiceMode, "disposed">;
  reason?: string;
  allowHeavy?: boolean;
  deadlineMs?: number;
}

type PlaybackState =
  | "stopped"
  | "starting"
  | "playing"
  | "paused"
  | "stopping"
  | "error";

interface ScheduledTransportResource {
  label: string;
  trackId?: string;
}

interface AudioClipResource {
  url: string;
  trackId: string;
  eventId: number;
}

interface SamplerPromotionRequest {
  id: number;
  voice: TrackVoice;
  def: NonNullable<ReturnType<typeof findPreset>>;
  presetId: string;
  instrumentGeneration: number;
}

declare global {
  interface Window {
    __SN_AUDIO_ENGINE_STATUS__?: {
      voiceModes: () => ReturnType<AudioEngine["getVoiceModeSnapshot"]>;
      soundSelectors: () => ReturnType<AudioEngine["getVoiceSoundSelectorSnapshot"]>;
      padSamples: () => ReturnType<AudioEngine["getDrumPadSampleSnapshot"]>;
      playback: () => ReturnType<AudioEngine["getPlaybackDiagnosticSnapshot"]>;
    };
  }
}

class AudioEngine {
  /**
   * When `?disableAudio=1` is present in the URL the engine silently skips
   * all Tone.js node creation and teardown.  This lets E2E tests exercise
   * loadDemo / remixDemo flows without hitting the multi-second AudioContext
   * initialisation that headless Chromium incurs per track.
   */
  private readonly noAudio =
    typeof location !== "undefined" &&
    new URLSearchParams(location.search).has("disableAudio");

  private masterChain = new MasterChain();
  private metronomeSynth: Tone.MembraneSynth;
  private metronomeAccent: Tone.MembraneSynth;
  /** Phase 6: shared gain for all metronome sources so setMetronomeVolume()
   *  controls both the Tone.js fallback synths and the AudioWorklet click. */
  private metronomeGain: Tone.Gain;
  /** Phase 6: AudioWorkletNode running MetronomeProcessor on the audio thread. */
  private metronomeWorkletNode: AudioWorkletNode | null = null;
  /** Native bridge keeps a native AudioWorkletNode on the same context all
   * the way to the master input; Tone's wrapper Gain remains fallback-only. */
  private metronomeWorkletGain: GainNode | null = null;
  private metronomeVolume = 1;

  private voices = new Map<string, TrackVoice>();
  private leanDrumVoices = new Map<string, LeanDrumVoice>();
  private leanTrackSnapshots = new Map<string, Track>();
  private leanTrackSettings = new LeanDrumTrackSettingsCache();
  private projectTrackSnapshots = new Map<string, Track>();
  private drumPadSampleManager = new DrumPadSampleManager(
    this.masterChain.input,
    (trackId, piece) => {
      const voice = this.voices.get(trackId);
      if (voice) {
        return { destination: voice.filter, routing: "track" };
      }
      const lean = this.leanDrumVoices.get(trackId);
      if (lean) {
        return {
          destination: lean.getPadInput(piece) as Tone.InputNode,
          routing: "piece",
        };
      }
      return null;
    },
  );
  private voiceModes = new Map<string, VoiceMode>();
  private voicePromotions: Array<{
    trackId: string;
    from: VoiceMode;
    to: VoiceMode;
    reason: string;
    durationMs: number;
  }> = [];
  private samplerPromotionRequestId = 0;
  private backgroundAudioWorkEpoch = 0;
  private pendingSamplerPromotions = new Map<string, SamplerPromotionRequest>();
  private activeSamplerPromotion: SamplerPromotionRequest | null = null;
  private samplerPromotionDrainTimer: number | null = null;
  private pendingHeldNotes = new Map<string, number>();
  /** Invalidates user actions that were waiting on context/mic startup when
   * Panic or project replacement established a newer silence boundary. */
  private silenceGeneration = 0;
  private vocalMonitorGeneration = new Map<string, number>();

  // ---- Phase 11: Automation & Modulation ----
  private automationSchedulerId: number | null = null;
  private trackAutomationData = new Map<string, AutomationLane[]>();
  private modulationSources: ModulationSource[] = [];
  private modulationRoutings: ModulationRouting[] = [];
  private modOutputs = new Map<string, number>(); // sourceId -> 0..1
  private lfoPhases = new Map<string, number>(); // sourceId -> radians
  private driftState = new Map<string, { value: number; target: number }>();
  // sourceId -> current step index (for step mod)
  private stepModState = new Map<string, number>();
  /** Whether any automation/modulation is active (used to avoid scheduling when nothing is registered). */
  private get automationActive(): boolean {
    return this.trackAutomationData.size > 0 || this.modulationSources.length > 0;
  }
  /** Project-wide default groove merged under per-track overrides at
   *  schedule time. `undefined` means "no global humanization". */
  private globalGroove?: Partial<GrooveSettings>;
  /**
   * All Tone.Player instances scheduled for transport-aligned audio
   * clips. Kept here so `panicStopAll()` can hard-stop in-flight audio
   * playback regardless of which UI module scheduled it.
   */
  private activeAudioPlayers = new Set<Tone.Player>();
  private audioClipResources = new Map<Tone.Player, AudioClipResource>();
  private scheduledTransportIds = new Map<number, ScheduledTransportResource>();
  private metronomeId: number | null = null;
  private metronomeEnabled = false;
  private playbackState: PlaybackState = "stopped";
  private soloSet = new Set<string>();
  unlocked = false;
  private disposed = false;
  private audioStartPromise: Promise<void> | null = null;
  private workletInitAttempted = false;
  private workletUnavailable = false;
  private noteEverPlayed = false;
  private firstPlayAttempted = false;
  private playBlockedByWatchdog = false;

  private firstQwertyShown = false;
  private firstMidiShown = false;
  private presetPreviewGeneration = 0;
  private activePresetPreview: MelodicVoice | null = null;
  private presetPreviewTimeout: number | null = null;
  /** Track id that currently has the Chop Lab kit active as its drum voice. */
  private chopKitTrackId: string | null = null;

  constructor() {
    const globalKey = "__SN_STUDIO_AUDIO_ENGINE_ACTIVE__";
    const scope = globalThis as typeof globalThis & Record<string, boolean | undefined>;
    if (scope[globalKey] && (import.meta.env?.DEV ?? false)) {
      console.warn("[AudioEngine] Duplicate AudioEngine construction detected; retaining singleton export.");
    }
    scope[globalKey] = true;
    if (typeof window !== "undefined") {
      window.__SN_AUDIO_ENGINE_STATUS__ = {
        voiceModes: () => this.getVoiceModeSnapshot(),
        soundSelectors: () => this.getVoiceSoundSelectorSnapshot(),
        padSamples: () => this.getDrumPadSampleSnapshot(),
        playback: () => this.getPlaybackDiagnosticSnapshot(),
      };
    }

    Tone.getTransport().bpm.value = 100;
    Tone.getTransport().timeSignature = [4, 4];

    // Phase 6: shared gain node for all metronome signal sources (worklet + fallback synths).
    // Volume is controlled via metronomeGain.gain so a single ramp covers both paths.
    this.metronomeGain = new Tone.Gain(1).connect(this.masterChain.input);

    this.metronomeSynth = new Tone.MembraneSynth({
      pitchDecay: 0.008,
      octaves: 2,
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
    }).connect(this.metronomeGain);
    this.metronomeAccent = new Tone.MembraneSynth({
      pitchDecay: 0.008,
      octaves: 4,
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
    }).connect(this.metronomeGain);
  }

  // ---- lifecycle ----

  /**
   * Resume the underlying AudioContext. Browsers block audio until the
   * user has interacted with the page; the UI's "Tap to Enable Audio"
   * button is what calls this. Safe to call repeatedly.
   */
  async unlock() {
    if (this.disposed) throw new Error("AudioEngine has been disposed");
    if (this.unlocked && this.isAudioContextRunning()) {
      this.masterChain.releasePanicHold();
      return;
    }
    const silenceGeneration = this.silenceGeneration;
    const endInit = startPerfTimer("audio-engine-init");
    try {
      await this.ensureAudioContextStarted();
      // A Panic that occurred while context startup was pending remains
      // authoritative. A later, fresh user action will capture the new value
      // and may intentionally release the hold.
      if (silenceGeneration === this.silenceGeneration) {
        this.masterChain.releasePanicHold();
      }
    } finally {
      endInit();
    }
  }

  /** Alias for `unlock()` — part of the documented v2 facade surface. */
  async initAudio() {
    return this.unlock();
  }

  getSilenceGeneration(): number {
    return this.silenceGeneration;
  }

  private async startToneWithTimeout(): Promise<void> {
    let timeoutId: number | null = null;
    try {
      firstPlayMark("tone-start:before", {
        contextState: this.getAudioContextState(),
      });
      const started = performance.now();
      await Promise.race([
        Tone.start(),
        new Promise<void>((_, reject) => {
          timeoutId = window.setTimeout(
            () => reject(new Error(`Tone.start() timed out after ${AUDIO_START_TIMEOUT_MS} ms`)),
            AUDIO_START_TIMEOUT_MS,
          );
        }),
      ]);
      firstPlayMeasure("tone-start", started, performance.now(), {
        contextState: this.getAudioContextState(),
      });
    } catch (err) {
      const details = describeError(err);
      firstPlayMark("tone-start:error", details);
      console.warn("[AudioEngine] AudioContext start did not complete promptly.", details, err);
      throw err;
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    }
  }

  private async ensureAudioContextStarted(): Promise<void> {
    if (this.isAudioContextRunning()) {
      this.unlocked = true;
      configureChopEngineOutput(this.masterChain.input);
      await this.tryInitWorkletsOnce();
      return;
    }
    if (this.audioStartPromise) return this.audioStartPromise;
    firstPlayMark("audio-context-start:scheduled", {
      contextState: this.getAudioContextState(),
    });
    const startPromise = (async () => {
      await this.startToneWithTimeout();
      if (!this.isAudioContextRunning()) {
        throw new Error(`AudioContext is ${this.getAudioContextState()} after Tone.start().`);
      }
      this.unlocked = true;
      configureChopEngineOutput(this.masterChain.input);
      await this.tryInitWorkletsOnce();
    })();
    this.audioStartPromise = startPromise;
    try {
      await startPromise;
    } catch (error) {
      this.unlocked = false;
      throw error;
    } finally {
      if (this.audioStartPromise === startPromise) this.audioStartPromise = null;
    }
  }

  private scheduleAudioContextStart(): void {
    void this.ensureAudioContextStarted().catch((error) => {
      const details = describeError(error);
      firstPlayMark("audio-context-start:retryable-error", details);
    });
  }

  private async tryInitWorkletsOnce(): Promise<void> {
    if (this.workletInitAttempted || this.workletUnavailable || workletManager.fallback) return;
    this.workletInitAttempted = true;
    if (!AUDIO_WORKLETS_ENABLED) {
      this.workletUnavailable = true;
      workletManager.markUnavailable(
        "AudioWorklet path disabled by default; set VITE_STUDIO_ENABLE_AUDIO_WORKLETS=1 for profiling.",
      );
      setWorkletPlayerEnabled(false);
      return;
    }
    try {
      const toneCtx = Tone.getContext();
      const registered = await workletManager.register(toneCtx as unknown as AudioContext);
      if (!registered || workletManager.fallback) {
        this.workletUnavailable = true;
        return;
      }

      // Keep the safety-critical master graph on Tone/native Web Audio nodes.
      // Those nodes already execute on the audio rendering thread, while a
      // custom master rewire can strand the entire studio if a browser's
      // wrapper/native-node bridge is incompatible. Worklets are reserved for
      // the scheduler and sampled voices, where failure is locally recoverable.

      const node = workletManager.createNode("metronome", toneCtx as unknown as AudioContext);
      if (!node) return;
      let nativeGain: GainNode | null = null;
      try {
        // Keep the native worklet and its fader on the node's own context.
        // Routing a native AudioWorkletNode through Tone's wrapper Gain can
        // connect without throwing yet remain outside the wrapper's rendered
        // graph in Chromium. One native bridge into the master is reliable.
        nativeGain = node.context.createGain();
        nativeGain.gain.value = this.metronomeVolume;
        node.connect(nativeGain);
        connectToneCompatible(nativeGain, this.masterChain.input);
        this.metronomeWorkletNode = node;
        this.metronomeWorkletGain = nativeGain;
      } catch (err) {
        try { nativeGain?.disconnect(); } catch { /* best effort */ }
        workletManager.disposeNode(node);
        throw err;
      }
    } catch (err) {
      const details = describeError(err);
      console.warn("[AudioEngine] Worklet init failed — Tone.js fallback active.", details, err);
      this.workletUnavailable = true;
      workletManager.markUnavailable(
        `AudioEngine worklet init failed: ${details.name}: ${details.message}`,
      );
      workletManager.disposeNode(this.metronomeWorkletNode);
      this.metronomeWorkletNode = null;
      try { this.metronomeWorkletGain?.disconnect(); } catch { /* best effort */ }
      this.metronomeWorkletGain = null;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingSamplerPromotions.clear();
    if (this.samplerPromotionDrainTimer !== null) {
      globalThis.clearTimeout(this.samplerPromotionDrainTimer);
      this.samplerPromotionDrainTimer = null;
    }
    try {
      this.panicStopAll();
    } catch {
      // ignore
    }
    try {
      this.disposeAllTracks();
    } catch {
      // ignore
    }
    this.drumPadSampleManager.dispose();
    this.cancelPresetPreview();
    try {
      if (this.masterAnalyser) {
        this.masterChain.disconnectPostMaster(this.masterAnalyser);
        this.masterAnalyser.dispose();
      }
    } catch {
      // ignore
    }
    this.masterAnalyser = null;
    this.masterAnalyserSize = 0;
    try {
      workletManager.disposeNode(this.metronomeWorkletNode);
    } catch {
      // ignore
    }
    this.metronomeWorkletNode = null;
    try { this.metronomeWorkletGain?.disconnect(); } catch { /* ignore */ }
    this.metronomeWorkletGain = null;
    lookaheadScheduler.cancelAll();
    lookaheadScheduler.stop();
    try {
      this.metronomeSynth.dispose();
      this.metronomeAccent.dispose();
      this.metronomeGain.dispose();
      stopChopEngine();
      disposeChopEngine();
      disconnectChopEngineOutput();
      this.masterChain.dispose();
      workletManager.dispose();
    } catch {
      // ignore
    }
    this.unlocked = false;
    this.playbackState = "stopped";
    (globalThis as typeof globalThis & Record<string, boolean | undefined>).__SN_STUDIO_AUDIO_ENGINE_ACTIVE__ = false;
  }

  /** Resolves once Tone-managed buffers finish loading. Factory preset sample
   * work uses the app-owned queue below and can be awaited independently. */
  whenSamplesReady(): Promise<void> {
    return Tone.loaded();
  }

  async whenSampleWorkSettled(timeoutMs = 30_000): Promise<void> {
    const deadline = performance.now() + Math.max(1, timeoutMs);
    while (!this.disposed) {
      const cache = getSampleCacheStats();
      if (
        !this.activeSamplerPromotion &&
        this.pendingSamplerPromotions.size === 0 &&
        cache.activeDecodes === 0 &&
        cache.inFlight === 0
      ) return;
      if (performance.now() >= deadline) {
        throw new Error("Factory sample work did not settle before the timeout.");
      }
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 25));
    }
  }

  // ---- master ----

  /** Connect a trusted Tone node to the studio master chain. */
  connectToMaster(node: Tone.ToneAudioNode): void {
    node.connect(this.masterChain.input);
  }

  /**
   * Context-level input for the studio master chain. World ambience and other
   * sources created from Tone's raw context use this so Panic, master volume,
   * limiting, metering, and export monitoring remain authoritative.
   *
   * This may be a standardized-audio-context wrapper rather than a browser
   * native node, but it is owned by the same raw context as those sources.
   */
  getMasterContextInput(): AudioNode {
    return resolveToneContextInput(this.masterChain.input);
  }

  /** Tone.Meter for the post-master bus (used by StereoMeter). */
  getMasterMeter(): Tone.Meter {
    return this.masterChain.getMeter();
  }

  /**
   * Lazily-created Tone.Analyser hanging off the master input. Used by
   * the MasterScope component for an oscilloscope view. Created on first
   * call so we don't pay the cost when no scope is mounted.
   */
  private masterAnalyser: Tone.Analyser | null = null;
  private masterAnalyserSize = 0;
  getMasterAnalyser(size = 256): Tone.Analyser {
    if (getFirstPlayFlags().disableAnalyzers) {
      firstPlayMark("master-analyser:disabled", { size });
      throw new Error("Master analyser disabled by snDisableAnalyzers profiling flag");
    }
    firstPlayMark("master-analyser:ensure", { size });
    const boundedSize = Math.max(32, Math.min(2048, size));
    if (!this.masterAnalyser || this.masterAnalyserSize !== boundedSize) {
      if (this.masterAnalyser) {
        try {
          this.masterChain.disconnectPostMaster(this.masterAnalyser);
          this.masterAnalyser.dispose();
          trackToneDispose("analyser", `master:${this.masterAnalyserSize}`);
        } catch {
          // ignore analyser disposal races
        }
      }
      const a = new Tone.Analyser("waveform", boundedSize);
      trackToneCreate("analyser", `master:${boundedSize}`);
      // tap the post-master signal so the scope reflects what the user
      // actually hears (post FX, post limiter)
      this.masterChain.connectPostMaster(a);
      this.masterAnalyser = a;
      this.masterAnalyserSize = boundedSize;
    }
    return this.masterAnalyser;
  }

  /**
   * Cheap-to-poll peak/RMS levels for the master bus. Reuses an
   * internal object so it's safe to call every animation frame.
   */
  getMasterLevels() {
    return this.masterChain.getLevels();
  }

  setMaster(volume0to1: number) {
    this.masterChain.setVolume(volume0to1);
  }

  // ---- v2 master bus ----

  /** Apply a partial master-bus settings patch (limiter / glue / soft-clip
   *  / width). UI sends diffs; engine owns the underlying Tone nodes. */
  setMasterBus(patch: Partial<MasterBusSettings>) {
    this.masterChain.applySettings(patch);
  }

  getMasterBus(): MasterBusSettings {
    return this.masterChain.getSettings();
  }

  /** Latched "the master clipped" indicator. Cleared by `resetMasterClip`. */
  getMasterClipped(): boolean {
    return this.masterChain.getClipped();
  }

  resetMasterClip() {
    this.masterChain.resetClip();
  }

  /** Stable list of send-bus ids (for UI iteration). */
  getSendBusIds(): readonly SendBusId[] {
    return SEND_BUS_IDS;
  }

  // ---- v2 per-track mixer ----

  /** Apply EQ (low/mid/high gain dB + HPF on/off + HPF cutoff Hz). */
  setTrackEq(trackId: string, eq: Partial<TrackEq>) {
    this.leanDrumVoices.get(trackId)?.setTrackEq(eq);
    const v = this.voices.get(trackId);
    if (!v) return;
    const wantsEq =
      eq.hpfOn === true ||
      Math.abs(eq.low ?? 0) > 0.001 ||
      Math.abs(eq.mid ?? 0) > 0.001 ||
      Math.abs(eq.high ?? 0) > 0.001;
    if (wantsEq) this.ensureEqNodes(v);
    if (v.eq3) {
      if (typeof eq.low === "number") v.eq3.low.value = clampDb(eq.low);
      if (typeof eq.mid === "number") v.eq3.mid.value = clampDb(eq.mid);
      if (typeof eq.high === "number") v.eq3.high.value = clampDb(eq.high);
    }
    if (v.hpf) {
      const on = eq.hpfOn;
      const hz = eq.hpfHz;
      if (typeof on === "boolean" || typeof hz === "number") {
        // When off, park the cutoff at 20 Hz so it's effectively bypassed.
        const curHz = (typeof v.hpf.frequency.value === "number" ? v.hpf.frequency.value : 80) as number;
        const targetHz = on === false ? 20 : Math.max(20, Math.min(2000, hz ?? curHz));
        v.hpf.frequency.rampTo(targetHz, 0.03);
      }
    }
  }

  /** Set a single send (0..1) from this track to one of the global buses. */
  setTrackSend(trackId: string, busId: SendBusId, amount: number) {
    this.leanDrumVoices.get(trackId)?.setSend(busId, amount);
    const v = this.voices.get(trackId);
    if (!v?.sends) return;
    const g = v.sends.get(busId);
    if (!g) return;
    g.gain.rampTo(Math.max(0, Math.min(1, amount)), 0.03);
  }

  /** Enable/disable + tweak a per-track effect module. Modules use
   *  bypass-friendly defaults so disabling is audibly transparent. */
  setEffectModule(
    trackId: string,
    moduleId: FxModuleId,
    settings: Partial<FxModuleSettings>,
  ) {
    const enabled = settings.enabled !== false;
    this.leanDrumVoices.get(trackId)?.setEffectModule(moduleId, settings);
    const v = this.voices.get(trackId);
    if (!v) return;
    const amount = Math.max(0, Math.min(1, settings.amount ?? 0.5));
    const params = settings.params ?? {};
    switch (moduleId) {
      case "eq":
        if (enabled) this.ensureEqNodes(v);
        // EQ module is just an enable flag on top of the 3-band — disable
        // flattens it. Discrete band values go through setTrackEq.
        if (v.eq3 && !enabled) {
          v.eq3.low.value = 0;
          v.eq3.mid.value = 0;
          v.eq3.high.value = 0;
        }
        if (v.hpf && !enabled) v.hpf.frequency.rampTo(20, 0.03);
        return;
      case "compressor":
        if (enabled) this.ensureCompressorNode(v);
        if (v.comp) {
          if (!enabled) {
            v.comp.threshold.value = 0;
            v.comp.ratio.value = 1;
          } else {
            const thrNorm = typeof params.threshold === "number" ? params.threshold : amount;
            const ratNorm = typeof params.ratio === "number" ? params.ratio : amount;
            v.comp.threshold.value = -6 - 24 * Math.max(0, Math.min(1, thrNorm));
            v.comp.ratio.value = 1.5 + 8.5 * Math.max(0, Math.min(1, ratNorm));
            v.comp.attack.value = 0.005 + 0.04 * (1 - amount);
            v.comp.release.value = 0.08 + 0.4 * amount;
          }
        }
        return;
      case "saturation":
        if (enabled) this.ensureDriveNode(v);
        if (v.drive) {
          v.drive.distortion = enabled ? 0.05 + 0.6 * amount : 0;
          v.drive.wet.rampTo(enabled ? Math.max(0.2, amount) : 0, 0.05);
        }
        return;
      case "delay":
        if (v.delay) v.delay.wet.rampTo(enabled ? amount : 0, 0.05);
        return;
      case "reverb":
        this.setTrackReverbWet(v, enabled ? amount : 0, 0.05);
        return;
      case "chorus":
        if (enabled) this.ensureChorusNode(v);
        if (v.chorus) {
          v.chorus.depth = enabled ? 0.2 + 0.6 * amount : 0;
          v.chorus.wet.rampTo(enabled ? amount : 0, 0.05);
        }
        return;
      case "bitcrusher":
        if (enabled) this.ensureBitcrusherNode(v);
        if (v.bitcrusher) {
          const bits = enabled
            ? Math.max(2, Math.round(16 - 14 * (typeof params.bits === "number" ? params.bits : amount)))
            : 16;
          v.bitcrusher.bits.value = bits;
        }
        return;
      case "stereoWidth":
        if (enabled) this.ensureWidenerNode(v);
        if (v.widener) {
          // 0=mono, 0.5=normal stereo, 1=wide. Disable -> 0.5.
          v.widener.width.rampTo(enabled ? Math.max(0, Math.min(1, amount)) : 0.5, 0.05);
        }
        return;
    }
  }

  // ---- transport ----

  setBpm(bpm: number) {
    Tone.getTransport().bpm.rampTo(bpm, 0.05);
  }

  getBpm() {
    return Tone.getTransport().bpm.value;
  }

  /**
   * Set Tone.Transport swing amount (0..1) and optionally the swing
   * subdivision (defaults to 8n). Used by later v2 tasks (sequencer
   * groove) — exposed here so the facade contract is complete.
   */
  setSwing(amount: number, subdivision: Tone.Unit.Subdivision = "8n") {
    const t = Tone.getTransport();
    t.swing = Math.max(0, Math.min(1, amount));
    t.swingSubdivision = subdivision;
  }

  getSwing() {
    return Tone.getTransport().swing;
  }

  getPlaybackState(): PlaybackState {
    return this.playbackState;
  }

  /** Read-only production diagnostics for sustained-playback acceptance. */
  getPlaybackDiagnosticSnapshot() {
    const rawContext = Tone.getContext().rawContext;
    return {
      playbackState: this.playbackState,
      transportState: Tone.getTransport().state,
      contextState: this.getAudioContextState(),
      audioContext: {
        browserNative: rawContext === studioAudioContext,
        constructorName: rawContext?.constructor?.name ?? "unknown",
        standardizedProxyOwnerPresent: Boolean(
          (rawContext as typeof rawContext & { _nativeAudioContext?: unknown })
            ?._nativeAudioContext,
        ),
      },
      positionBeats: this.positionBeats(),
      masterLevels: this.getMasterLevels(),
      // Named drums are data-swapped on the native voice. These legacy-shaped
      // arrays stay in diagnostics so older support tools can assert no work.
      activeKitBuilds: [] as Array<{ trackId: string; generation: number }>,
      requestedKits: [] as Array<{
        trackId: string;
        kitId: DrumKitId;
        generation: number;
      }>,
      samplerPromotions: {
        active: this.activeSamplerPromotion
          ? {
              trackId: this.activeSamplerPromotion.voice.trackId,
              presetId: this.activeSamplerPromotion.presetId,
              requestId: this.activeSamplerPromotion.id,
            }
          : null,
        pending: Array.from(this.pendingSamplerPromotions.values()).map((request) => ({
          trackId: request.voice.trackId,
          presetId: request.presetId,
          requestId: request.id,
        })),
        cache: getSampleCacheStats(),
      },
    };
  }

  play(): boolean {
    const flags = getFirstPlayFlags();
    const traceFirstPlay = isFirstPlayTraceEnabled() && !this.firstPlayAttempted;
    markStartupSound("transport:play-request", {
      contextState: this.getAudioContextState(),
      transportState: Tone.getTransport().state,
      metronomeEnabled: this.metronomeEnabled,
      playbackState: this.playbackState,
    });
    if (traceFirstPlay) {
      this.firstPlayAttempted = true;
      firstPlayMark("AudioEngine.play:first-attempt", {
        contextState: this.getAudioContextState(),
        transportState: Tone.getTransport().state,
        playbackState: this.playbackState,
        flags,
      });
    } else {
      firstPlayMark("AudioEngine.play:enter", {
        contextState: this.getAudioContextState(),
        transportState: Tone.getTransport().state,
        playbackState: this.playbackState,
      });
    }
    if (this.noAudio) return false;
    if (this.playBlockedByWatchdog) {
      firstPlayMark("AudioEngine.play:blocked-watchdog");
      return false;
    }
    if (this.playbackState === "starting" || this.playbackState === "playing") return true;
    if (!this.isAudioContextRunning()) {
      firstPlayMark("AudioEngine.play:context-not-running", {
        contextState: this.getAudioContextState(),
      });
      this.scheduleAudioContextStart();
      return false;
    }
    // Releasing any held panic mute is a no-op when no panic is active,
    // so this is safe to call on every play.
    this.backgroundAudioWorkEpoch += 1;
    if (this.samplerPromotionDrainTimer !== null) {
      globalThis.clearTimeout(this.samplerPromotionDrainTimer);
      this.samplerPromotionDrainTimer = null;
    }
    this.playbackState = "starting";
    let watchdogId: number | null = null;
    if (traceFirstPlay) {
      watchdogId = window.setTimeout(() => {
        if (this.playbackState !== "starting") return;
        this.playbackState = "error";
        this.playBlockedByWatchdog = true;
        firstPlayMark("AudioEngine.play:watchdog-timeout", {
          timeoutMs: FIRST_PLAY_WATCHDOG_MS,
          contextState: this.getAudioContextState(),
          transportState: Tone.getTransport().state,
        });
      }, FIRST_PLAY_WATCHDOG_MS);
    }
    const started = performance.now();
    try {
      this.masterChain.releasePanicHold();
      if (this.metronomeEnabled && this.metronomeId === null) {
        firstPlayMark("AudioEngine.play:metronome-reschedule");
        this.setMetronome(true);
      }
      if (!flags.disableTransportCallbacks) {
        this.ensureAutomationScheduler();
      } else {
        firstPlayMark("AudioEngine.play:automation-skipped");
      }
      const transport = Tone.getTransport();
      firstPlayMark("Tone.Transport.start:before", {
        contextState: this.getAudioContextState(),
        transportState: transport.state,
      });
      markStartupSound("transport:start-before", {
        contextState: this.getAudioContextState(),
        transportState: transport.state,
      });
      const transportStart = performance.now();
      if (transport.state !== "started") {
        transport.start("+0.05");
      }
      markStartupSound("transport:start-after", {
        contextState: this.getAudioContextState(),
        transportState: transport.state,
      });
      firstPlayMeasure("Tone.Transport.start", transportStart, performance.now(), {
        contextState: this.getAudioContextState(),
        transportState: transport.state,
      });
      this.playbackState = "playing";
      firstPlayMeasure("AudioEngine.play", started, performance.now(), {
        contextState: this.getAudioContextState(),
        transportState: transport.state,
      });
      return true;
    } catch (err) {
      this.playbackState = "error";
      firstPlayMark("AudioEngine.play:error", describeError(err));
      throw err;
    } finally {
      if (watchdogId !== null) window.clearTimeout(watchdogId);
    }
  }

  private isAudioContextRunning(): boolean {
    try {
      return (Tone.getContext().rawContext as AudioContext | undefined)?.state === "running";
    } catch {
      return false;
    }
  }

  private getAudioContextState(): AudioContextState | "unknown" {
    try {
      return (Tone.getContext().rawContext as AudioContext | undefined)?.state ?? "unknown";
    } catch {
      return "unknown";
    }
  }
  pause() {
    if (this.noAudio) return;
    if (this.playbackState === "stopped" || this.playbackState === "stopping") return;
    try {
      Tone.getTransport().pause();
      this.playbackState = "paused";
    } catch (err) {
      this.playbackState = "error";
      throw err;
    }
  }
  /**
   * Stop transport and reliably release any sustained notes (keyboard,
   * sequenced, drums). Reverb/delay tails decay naturally on their own
   * — for a hard cut (e.g. user-initiated panic) use `panicStopAll()`.
   */
  stop() {
    if (this.noAudio) return;
    if (this.playbackState === "stopping") return;
    this.playbackState = "stopping";
    this.playBlockedByWatchdog = false;
    firstPlayMark("AudioEngine.stop:enter", {
      transportState: Tone.getTransport().state,
      contextState: this.getAudioContextState(),
    });
    try {
      Tone.getTransport().stop();
      Tone.getTransport().position = 0;
      this.stopScheduledAudioPlayers(false);
      for (const v of this.voices.values()) {
        releaseAllNotes(v.poly);
      }
      this.playbackState = "stopped";
      firstPlayMark("AudioEngine.stop:complete", {
        transportState: Tone.getTransport().state,
      });
      this.scheduleSamplerPromotionDrain();
    } catch (err) {
      this.playbackState = "error";
      throw err;
    }
  }
  seekToBeat(beat: number) {
    Tone.getTransport().position = `0:${beat}:0`;
  }
  get state(): "started" | "stopped" | "paused" {
    return Tone.getTransport().state;
  }
  positionBeats(): number {
    const pos = Tone.getTransport().position.toString();
    const [bars, beats, sixteenths] = pos.split(":").map(parseFloat);
    return bars * 4 + beats + sixteenths / 4;
  }

  setLoop(enabled: boolean, startBeat: number, endBeat: number) {
    const t = Tone.getTransport();
    t.loop = enabled;
    t.loopStart = `0:${startBeat}:0`;
    t.loopEnd = `0:${endBeat}:0`;
  }

  /**
   * Hard kill: stop the transport, clear all engine-owned schedules,
   * release every sustained note, dip the master to silence reverb/delay
   * tails, and stop any live mic monitoring. Bound to the red Panic button.
   */
  panicStopAll() {
    this.silenceGeneration += 1;
    this.backgroundAudioWorkEpoch += 1;
    const transport = Tone.getTransport();
    this.playbackState = "stopping";
    this.playBlockedByWatchdog = false;
    firstPlayMark("AudioEngine.panic:enter", {
      transportState: transport.state,
      contextState: this.getAudioContextState(),
    });
    try {
      transport.stop();
      transport.position = 0;
      this.clearAllScheduledTransportEvents();
      this.clearMetronomeSchedule();
      this.stopAutomationScheduler();
      this.stopScheduledAudioPlayers(true);
      this.cancelPresetPreview();
      this.drumPadSampleManager.stopAll();
      this.pendingHeldNotes.clear();
      for (const v of this.voices.values()) {
        this.vocalMonitorGeneration.set(
          v.trackId,
          (this.vocalMonitorGeneration.get(v.trackId) ?? 0) + 1,
        );
        releaseAllNotes(v.poly);
        if (v.mic) {
          try {
            v.mic.close();
          } catch {
            // ignore
          }
          v.micOn = false;
          try { v.mic.dispose(); } catch { /* ignore */ }
          v.mic = undefined;
        }
      }
      for (const lean of this.leanDrumVoices.values()) {
        lean.stopAll();
      }
      stopChopEngine();

      // Phase 6: clear any queued worklet metronome clicks and lookahead events.
      if (this.metronomeWorkletNode) {
        workletManager.postMessage(this.metronomeWorkletNode, { type: "clear" });
      }
      lookaheadScheduler.cancelAll();

      this.masterChain.duckForPanic();
      this.playbackState = "stopped";
      firstPlayMark("AudioEngine.panic:complete", {
        transportState: transport.state,
      });
      this.scheduleSamplerPromotionDrain();
    } catch {
      this.playbackState = "error";
    }
  }

  // ---- metronome ----
  /** Set the metronome ticks loudness (0..1). 0 mutes them. */
  setMetronomeVolume(v: number) {
    const clamped = Math.max(0, Math.min(1, v));
    // Phase 6: volume controlled via the shared metronomeGain so both the
    // Tone.js fallback synths AND the AudioWorklet click node are affected.
    // A 3 ms ramp prevents audible clicks when the slider moves quickly.
    const lin = clamped <= 0.001 ? 0 : Math.pow(10, ((clamped - 1) * 60) / 20);
    this.metronomeVolume = lin;
    this.metronomeGain.gain.rampTo(lin, 0.003);
    const nativeGain = this.metronomeWorkletGain;
    if (nativeGain) {
      const now = nativeGain.context.currentTime;
      nativeGain.gain.cancelScheduledValues(now);
      nativeGain.gain.setValueAtTime(nativeGain.gain.value, now);
      nativeGain.gain.linearRampToValueAtTime(lin, now + 0.003);
    }
  }

  setMetronome(on: boolean) {
    markStartupSound("metronome:set", {
      enabled: on,
      transportState: Tone.getTransport().state,
      playbackState: this.playbackState,
    });
    this.metronomeEnabled = on;
    if (!on) {
      // Explicitly remove the repeating Transport event so it stops consuming
      // scheduling CPU instead of just being silenced by the boolean guard.
      this.clearMetronomeSchedule();
      if (this.metronomeWorkletNode) {
        workletManager.postMessage(this.metronomeWorkletNode, { type: "clear" });
      }
      lookaheadScheduler.cancelAll();
      return;
    }
    if (this.metronomeId !== null) return; // already scheduled — don't stack
    {
      let beat = 0;
      const id = Tone.getTransport().scheduleRepeat((time) => {
        if (!this.metronomeEnabled) return;
        const accent = beat % 4 === 0;

        if (this.metronomeWorkletNode) {
          // Phase 6: schedule click on the audio thread for jitter-free timing.
          workletManager.postMessage(this.metronomeWorkletNode, {
            type: "schedule",
            audioTime: time,
            accent,
          });
          // Register with lookahead scheduler so diagnostics panel can count it.
          lookaheadScheduler.schedule(time, () => { /* click fired */ });
        } else {
          // Tone.js fallback path (MembraneSynth).
          // Phase 6: apply short linear ramps on triggers to eliminate click transients.
          if (accent) {
            this.metronomeAccent.triggerAttackRelease("C5", "32n", time);
          } else {
            this.metronomeSynth.triggerAttackRelease("C4", "32n", time);
          }
        }
        beat++;
      }, "4n");
      this.metronomeId = trackTransportEvent(id, "metronome");
    }
  }

  isMetronomeOn() {
    return this.metronomeEnabled;
  }

  // ---- Phase 6 diagnostics helpers ----

  /**
   * Count of active track voices (voices that have an instrument attached).
   * Used by the Diagnostics panel for CPU load estimation.
   */
  getActiveVoiceCount(): number {
    const active = new Set(this.leanDrumVoices.keys());
    for (const [trackId, voice] of this.voices) {
      if (voice.poly || voice.drums || voice.kit) active.add(trackId);
    }
    return active.size;
  }

  /**
   * Expose whether AudioWorklets are active (for the diagnostics panel).
   * Mirrors workletManager.ready.
   */
  getWorkletStatus(): { ready: boolean; fallback: boolean; reason: string | null } {
    return {
      ready: workletManager.ready,
      fallback: workletManager.fallback,
      reason: workletManager.unavailableReason,
    };
  }

  /**
   * A/B toggle: enable or disable the SamplePlayerProcessor path for drum
   * voices that support it (kick and snare in the acoustic kit).
   *
   * When disabled, those voices fall back to Tone.Player (main-thread
   * scheduling). Toggle this at runtime to compare timing accuracy by ear.
   * The setting takes effect on the next drum hit — no rebuild needed.
   */
  setWorkletDrumsEnabled(enabled: boolean): void {
    setWorkletPlayerEnabled(enabled);
  }

  /** Returns whether the AudioWorklet sample player path is currently on. */
  getWorkletDrumsEnabled(): boolean {
    return getWorkletPlayerEnabled();
  }

  // ---- tracks ----
  /** Keep lightweight project snapshots so live pads/keys can realize only the
   * requested voice before transport preparation has run. */
  setProjectTrackSnapshots(tracks: readonly Track[]) {
    const previousSnapshots = this.projectTrackSnapshots;
    this.projectTrackSnapshots = new Map(tracks.map((track) => [track.id, track]));
    this.soloSet = new Set(
      tracks.filter((track) => track.solo).map((track) => track.id),
    );
    if (!this.noAudio) this.drumPadSampleManager.syncTracks(tracks);
    // A same-id project/sketch replacement can alter the entire channel strip
    // without invoking the individual engine setters. Reapply a changed drum
    // snapshot here, outside the note scheduler, so EQ, sends, piece settings,
    // FX and sound parameters cannot remain stale behind a correct selector.
    for (const track of tracks) {
      const lean = this.leanDrumVoices.get(track.id);
      if (!lean) continue;
      this.leanTrackSnapshots.set(track.id, track);
      if (previousSnapshots.get(track.id) !== track) {
        lean.applyTrack(track);
        lean.setAudible(
          !track.muted && (this.soloSet.size === 0 || track.solo),
        );
        this.leanTrackSettings.markApplied(track);
      }
    }
  }

  /** Keep project-library blobs available to persisted drum-pad overrides. */
  setProjectSampleLibrary(samples: readonly SampleLibraryItem[] = []): void {
    if (this.noAudio) return;
    this.drumPadSampleManager.syncSamples(samples);
  }

  /** Read-only assignment/decode status for diagnostics and regression tests. */
  getDrumPadSampleSnapshot() {
    return this.drumPadSampleManager.snapshot();
  }

  private applyLeanTrackSettingsIfChanged(
    track: Track,
    lean: LeanDrumVoice,
  ): boolean {
    if (!this.leanTrackSettings.needsApply(track)) return false;
    lean.applyTrack(track);
    lean.setAudible(!track.muted && (this.soloSet.size === 0 || track.solo));
    this.leanTrackSettings.markApplied(track);
    return true;
  }

  /** Reconcile only an already-realized Tone voice. This never creates an
   * audio graph while the browser is locked, but guarantees that a project
   * selector change cannot leave the previous kit or preset sounding. */
  private reconcileExistingSoundSelector(track: Track): void {
    const lean = this.leanDrumVoices.get(track.id);
    if (track.kind === "drums" && lean) {
      const selectedKit = track.kitId ?? (
        track.preset === "acoustic"
          ? "garageband"
          : track.preset === "electronic"
            ? "cyberpunk"
            : "trap"
      );
      if (lean.kitId !== selectedKit) lean.setKit(selectedKit);
      const shell = this.voices.get(track.id);
      if (shell) shell.kitId = selectedKit;
      return;
    }
    const voice = this.voices.get(track.id);
    if (!voice) return;

    if (track.kind === "drums") {
      if (track.kitId) {
        if (voice.kitId !== track.kitId || !voice.kit) {
          this.setKit(track.id, track.kitId);
        }
      } else if (voice.kit) {
        this.changePreset(track);
      }
      return;
    }

    if (track.kind === "vocals") return;
    if (track.presetId) {
      if (voice.presetId !== track.presetId || !voice.poly) {
        this.setMelodicPreset(track.id, track.presetId);
      }
    } else if (voice.presetId) {
      this.changePreset(track);
    }
  }

  private ensurePlayableTrack(trackId: string, reason: string): void {
    const track = this.projectTrackSnapshots.get(trackId);
    if (!track) return;
    const lean = this.leanDrumVoices.get(trackId);
    if (lean) {
      if (this.applyLeanTrackSettingsIfChanged(track, lean)) {
        const anySolo = this.soloSet.size > 0;
        lean.setAudible(!track.muted && (!anySolo || track.solo));
      }
      this.reconcileExistingSoundSelector(track);
      this.drumPadSampleManager.refreshRouting(trackId);
      return;
    }
    if (this.voices.has(trackId) && track.kind !== "drums") {
      this.reconcileExistingSoundSelector(track);
      this.drumPadSampleManager.refreshRouting(trackId);
      return;
    }
    this.ensureTrack(track, {
      mode: track.kind === "drums" ? "lean" : "tone",
      reason,
      allowHeavy: track.kind !== "drums",
      deadlineMs: track.kind === "drums" ? 50 : undefined,
    });
    this.refreshAllMutes(Array.from(this.projectTrackSnapshots.values()));
  }

  ensureTrack(track: Track, options: EnsureTrackOptions = {}) {
    if (this.noAudio) return;
    const requestedMode = options.mode ?? "tone";
    const reason = options.reason ?? "unspecified";
    const allowHeavy = options.allowHeavy ?? requestedMode === "tone";
    const flags = getFirstPlayFlags();
    this.projectTrackSnapshots.set(track.id, track);
    const duringPlay = this.playbackState === "starting" || this.playbackState === "playing";
    const hadVoice = this.voices.has(track.id);
    const currentMode = this.getVoiceMode(track.id);
    this.leanTrackSnapshots.set(track.id, track);
    firstPlayMark("ensureTrack:enter", {
      trackId: track.id,
      kind: track.kind,
      duringPlay,
      hadVoice,
      mode: requestedMode,
      currentMode,
      reason,
      allowHeavy,
    });
    if (duringPlay && flags.disableGraphBuildOnPlay) {
      firstPlayMark("ensureTrack:blocked-during-play", { trackId: track.id });
      throw new Error(`ensureTrack(${track.id}) called during Play`);
    }
    if (flags.useMinimalAudioGraph) {
      firstPlayMark("ensureTrack:skipped-minimal-graph", { trackId: track.id });
      return;
    }
    if (requestedMode === "shell") {
      if (!this.voiceModes.has(track.id)) this.voiceModes.set(track.id, "shell");
      firstPlayMark("ensureTrack:shell", { trackId: track.id, reason });
      return;
    }
    const started = performance.now();
    // All real-time drum modes use the bounded native instrument. Treating a
    // caller's generic `mode: "tone"` as permission to rebuild a named Tone
    // kit was the path that exhausted the AudioContext after sound-set swaps.
    if (track.kind === "drums") {
      this.ensureLeanDrumTrack(track, reason, started);
      return;
    }
    if (!allowHeavy) {
      firstPlayMark("ensureTrack:heavy-blocked", {
        trackId: track.id,
        requestedMode,
        reason,
      });
      if (!this.voiceModes.has(track.id)) this.voiceModes.set(track.id, "shell");
      return;
    }
    if (options.deadlineMs && performance.now() - started > options.deadlineMs) {
      firstPlayMark("ensureTrack:deadline-exceeded-before-tone", {
        trackId: track.id,
        deadlineMs: options.deadlineMs,
        reason,
      });
      if (!this.voiceModes.has(track.id)) this.voiceModes.set(track.id, "shell");
      return;
    }
    this.disposeLeanDrumTrack(track.id);
    let v = this.voices.get(track.id);
    if (!v) {
      v = this.buildVoice(track);
      this.voices.set(track.id, v);
      this.recordVoicePromotion(track.id, currentMode, "tone", reason, started);
    } else {
      this.reconcileExistingSoundSelector(track);
    }
    this.rehydrateTrackVoice(track);
    this.drumPadSampleManager.refreshRouting(track.id);
    firstPlayMeasure("ensureTrack", started, performance.now(), {
      trackId: track.id,
      kind: track.kind,
      created: !hadVoice,
      mode: "tone",
      reason,
    });
  }

  private ensureLeanDrumTrack(track: Track, reason: string, started: number): void {
    this.leanTrackSnapshots.set(track.id, track);
    let lean = this.leanDrumVoices.get(track.id);
    const from = this.getVoiceMode(track.id);
    const shell = this.voices.get(track.id);
    // A previous build can still have a shell-backed native voice. Replace it
    // while the old route is alive, then dispose the shell only after the
    // direct native route is ready.
    if (!lean || shell) {
      let replacement: LeanDrumVoice;
      try {
        replacement = createLeanDrumVoice(track, this.masterChain.input, {
          roomReverb: this.masterChain.getBus("roomReverb")?.input,
          neonHall: this.masterChain.getBus("neonHall")?.input,
          tapeDelay: this.masterChain.getBus("tapeDelay")?.input,
          darkSlapback: this.masterChain.getBus("darkSlapback")?.input,
        });
      } catch (error) {
        firstPlayMark("ensureTrack:lean-construction-failed", {
          trackId: track.id,
          reason,
          message: error instanceof Error ? error.message : String(error),
          preservedPreviousVoice: Boolean(lean || shell),
        });
        return;
      }
      if (!replacement.isReady()) {
        replacement.dispose();
        firstPlayMark("ensureTrack:lean-routing-fallback", {
          trackId: track.id,
          reason,
        });
        return;
      }
      lean?.dispose();
      lean = replacement;
      this.leanDrumVoices.set(track.id, replacement);
      replacement.setAudible(
        !track.muted && (this.soloSet.size === 0 || track.solo),
      );
      this.leanTrackSettings.markApplied(track);
      this.recordVoicePromotion(track.id, from, "lean", reason, started);
    } else {
      this.applyLeanTrackSettingsIfChanged(track, lean);
    }

    if (shell) {
      shell.dispose();
      this.voices.delete(track.id);
    }
    this.drumPadSampleManager.refreshRouting(track.id);
    firstPlayMeasure("ensureTrack", started, performance.now(), {
      trackId: track.id,
      kind: track.kind,
      created: from !== "lean",
      mode: "lean",
      reason,
      mixerShell: false,
    });
  }

  private disposeLeanDrumTrack(trackId: string): void {
    const lean = this.leanDrumVoices.get(trackId);
    if (!lean) {
      this.leanTrackSettings.delete(trackId);
      return;
    }
    try {
      lean.dispose();
    } catch {
      // ignore
    }
    this.leanDrumVoices.delete(trackId);
    this.leanTrackSnapshots.delete(trackId);
    this.leanTrackSettings.delete(trackId);
    if (!this.voices.has(trackId)) this.voiceModes.set(trackId, "disposed");
  }

  private getVoiceMode(trackId: string): VoiceMode {
    if (this.leanDrumVoices.has(trackId)) return "lean";
    if (this.voices.has(trackId)) return "tone";
    return this.voiceModes.get(trackId) ?? "shell";
  }

  private recordVoicePromotion(
    trackId: string,
    from: VoiceMode,
    to: VoiceMode,
    reason: string,
    started: number,
  ): void {
    const durationMs = Number((performance.now() - started).toFixed(1));
    this.voiceModes.set(trackId, to);
    this.voicePromotions.push({ trackId, from, to, reason, durationMs });
    if (this.voicePromotions.length > 100) this.voicePromotions.shift();
    firstPlayMark("voice-promotion", { trackId, from, to, reason, durationMs });
  }

  getVoiceModeSnapshot() {
    const counts: Record<VoiceMode, number> = { shell: 0, lean: 0, tone: 0, disposed: 0 };
    for (const mode of this.voiceModes.values()) counts[mode] += 1;
    for (const id of this.voices.keys()) {
      if (!this.voiceModes.has(id)) counts.tone += 1;
    }
    for (const id of this.leanDrumVoices.keys()) {
      if (!this.voiceModes.has(id)) counts.lean += 1;
    }
    return {
      counts,
      promotions: this.voicePromotions.slice(-50),
      activeToneTrackIds: Array.from(this.voices.keys()).filter(
        (trackId) => !this.leanDrumVoices.has(trackId),
      ),
      activeLeanTrackIds: Array.from(this.leanDrumVoices.keys()),
      activeMixerShellTrackIds: Array.from(this.voices.keys()).filter((trackId) =>
        this.leanDrumVoices.has(trackId),
      ),
    };
  }

  /** Read-only selector diagnostics used by runtime and browser regression
   * tests. Project selectors and realized voices must agree after a pack or
   * preset switch; exposing IDs avoids relying on private Tone node shapes. */
  getVoiceSoundSelectorSnapshot() {
    const trackIds = new Set([
      ...this.voices.keys(),
      ...this.leanDrumVoices.keys(),
    ]);
    return Array.from(trackIds).map((trackId) => {
      const voice = this.voices.get(trackId);
      const lean = this.leanDrumVoices.get(trackId);
      return {
        trackId,
        kitId: lean?.kitId ?? voice?.kitId,
        presetId: voice?.presetId,
        hasKit: Boolean(lean || voice?.kit),
        hasNativeKit: Boolean(lean),
        hasToneKit: Boolean(voice?.kit),
        runtime: lean ? "native" as const : "tone" as const,
        hasMelodicVoice: Boolean(voice?.poly),
        isSampled: voice?.poly instanceof Tone.Sampler,
        samplePromotionState:
          this.activeSamplerPromotion?.voice.trackId === trackId
            ? "loading" as const
            : this.pendingSamplerPromotions.has(trackId)
              ? "pending" as const
              : "settled" as const,
      };
    });
  }

  /** Read-only live mixer diagnostics for regression tests and support. */
  getVoiceMixSnapshot() {
    const toneEntries = Array.from(this.voices.entries()).map(([trackId, voice]) => ({
      trackId,
      volumeDb: voice.channel.volume.value,
      pan: voice.channel.pan.value,
      hasEq: Boolean(voice.eq3 || voice.hpf),
      hasCompressor: Boolean(voice.comp),
      sends: Object.fromEntries(
        Array.from(voice.sends?.entries() ?? []).map(([id, gain]) => [id, gain.gain.value]),
      ) as Partial<Record<SendBusId, number>>,
    }));
    const toneTrackIds = new Set(toneEntries.map((entry) => entry.trackId));
    const nativeEntries = Array.from(this.leanDrumVoices.entries())
      .filter(([trackId]) => !toneTrackIds.has(trackId))
      .map(([trackId, voice]) => ({ trackId, ...voice.getMixSnapshot() }));
    return [...toneEntries, ...nativeEntries];
  }

  removeTrack(trackId: string) {
    this.pendingSamplerPromotions.delete(trackId);
    this.projectTrackSnapshots.delete(trackId);
    this.drumPadSampleManager.removeTrack(trackId);
    this.vocalMonitorGeneration.set(
      trackId,
      (this.vocalMonitorGeneration.get(trackId) ?? 0) + 1,
    );
    for (const key of Array.from(this.pendingHeldNotes.keys())) {
      if (key.startsWith(`${trackId}:`)) this.pendingHeldNotes.delete(key);
    }
    this.cancelScheduledForTrack(trackId);
    this.removeTrackAutomation(trackId);
    this.leanTrackSnapshots.delete(trackId);
    this.leanTrackSettings.delete(trackId);
    for (const key of Array.from(this.paramOverrides)) {
      if (key.startsWith(`${trackId}:`)) this.paramOverrides.delete(key);
    }
    this.disposeLeanDrumTrack(trackId);
    const v = this.voices.get(trackId);
    if (v) {
      v.dispose();
      this.voices.delete(trackId);
    }
    this.voiceModes.set(trackId, "disposed");
    this.soloSet.delete(trackId);
  }

  getActiveTrackIds(): string[] {
    return Array.from(new Set([...this.voices.keys(), ...this.leanDrumVoices.keys()]));
  }

  /** Tear down every voice — used when swapping in a fresh project
   * (e.g. loading a demo) so we don't leak instruments or accumulate
   * stale voice ids in the engine. */
  disposeAllTracks() {
    if (this.noAudio) return;
    this.cancelAllProjectSchedules();
    for (const id of this.getActiveTrackIds()) {
      this.removeTrack(id);
    }
    this.leanTrackSettings.clear();
    this.soloSet.clear();
  }

  /** Atomically clear all project-owned audio state before a project/demo is
   * replaced. This prevents reused track ids from inheriting voices,
   * automation, modulation, Chop slices, or scheduled callbacks. */
  replaceProject(project: Project) {
    this.silenceGeneration += 1;
    this.pendingHeldNotes.clear();
    try {
      this.stop();
    } catch {
      // continue with hard teardown
    }
    this.cancelAllProjectSchedules();
    this.stopAutomationScheduler();
    this.disposeAllTracks();
    this.drumPadSampleManager.dispose();
    stopChopEngine();
    disposeChopEngine();
    this.chopKitTrackId = null;
    this.trackAutomationData.clear();
    this.modulationSources = [];
    this.modulationRoutings = [];
    this.modOutputs.clear();
    this.lfoPhases.clear();
    this.driftState.clear();
    this.stepModState.clear();
    this.paramOverrides.clear();
    this.soloSet.clear();
    this.setProjectSampleLibrary(project.samples ?? []);
    this.setProjectTrackSnapshots(project.tracks);
    this.setGlobalGroove(project.globalGroove);
    this.masterChain.releasePanicHold();
  }

  removeAllTracksExcept(trackIds: readonly string[]) {
    if (this.noAudio) return;
    const keep = new Set(trackIds);
    for (const id of this.getActiveTrackIds()) {
      if (!keep.has(id)) this.removeTrack(id);
    }
  }

  applyTrackSettings(track: Track) {
    if (track.solo) this.soloSet.add(track.id);
    else this.soloSet.delete(track.id);
    const anySolo = this.soloSet.size > 0;
    const audible = !track.muted && (!anySolo || track.solo);
    const lean = this.leanDrumVoices.get(track.id);
    if (lean) {
      this.applyLeanTrackSettingsIfChanged(track, lean);
      lean.setAudible(audible);
    }
    const v = this.voices.get(track.id);
    if (!v) return;
    const db = audible
      ? track.volume <= 0.005
        ? -60
        : 20 * Math.log10(track.volume)
      : -Infinity;
    v.channel.volume.rampTo(db, 0.05);
    v.channel.pan.rampTo(track.pan, 0.05);

    this.setTrackReverbWet(v, track.fx.reverb, 0.05);
    v.delay.wet.rampTo(track.fx.delay, 0.05);
    const cutoff = 200 + track.fx.filter ** 2 * 17800;
    v.filter.frequency.rampTo(cutoff, 0.05);
  }

  /** Write a persisted channel fader change straight through to a live voice. */
  setTrackVolume(trackId: string, volume: number) {
    const track = this.projectTrackSnapshots.get(trackId);
    const bounded = Math.max(0, Math.min(1, volume));
    const lean = this.leanDrumVoices.get(trackId);
    if (lean && track) {
      lean.setVolume(bounded);
      lean.setAudible(!track.muted && (this.soloSet.size === 0 || track.solo));
      this.leanTrackSettings.markApplied(track);
    }
    const v = this.voices.get(trackId);
    if (!v) return;
    const audible = !track?.muted && (this.soloSet.size === 0 || Boolean(track?.solo));
    const db = audible ? (bounded <= 0.005 ? -60 : 20 * Math.log10(bounded)) : -Infinity;
    v.channel.volume.rampTo(db, 0.02);
  }

  /** Write a persisted pan change straight through to a live voice. */
  setTrackPan(trackId: string, pan: number) {
    const track = this.projectTrackSnapshots.get(trackId);
    const bounded = Math.max(-1, Math.min(1, pan));
    const lean = this.leanDrumVoices.get(trackId);
    if (lean && track) {
      lean.setPan(bounded);
      lean.setAudible(!track.muted && (this.soloSet.size === 0 || track.solo));
      this.leanTrackSettings.markApplied(track);
    }
    this.voices.get(trackId)?.channel.pan.rampTo(bounded, 0.02);
  }

  refreshAllMutes(tracks: Track[]) {
    this.soloSet = new Set(tracks.filter((track) => track.solo).map((track) => track.id));
    for (const t of tracks) this.applyTrackSettings(t);
  }

  private setTrackReverbWet(v: TrackVoice, amount: number, rampSec: number): void {
    const bounded = Math.max(0, Math.min(1, amount));
    v.sends?.get("roomReverb")?.gain.rampTo(bounded, rampSec);
  }

  private setTrackReverbWetImmediate(v: TrackVoice, amount: number): void {
    const bounded = Math.max(0, Math.min(1, amount));
    const send = v.sends?.get("roomReverb");
    if (send) send.gain.value = bounded;
  }

  private applyVocalPresetSettings(v: TrackVoice, preset: VocalsPreset): void {
    switch (preset) {
      case "clean":
        this.setTrackReverbWetImmediate(v, 0.05);
        v.delay.wet.value = 0;
        v.filter.frequency.value = 18000;
        break;
      case "warm":
        this.setTrackReverbWetImmediate(v, 0.45);
        v.delay.wet.value = 0.15;
        v.filter.frequency.value = 12000;
        break;
      case "lofi":
        this.setTrackReverbWetImmediate(v, 0.2);
        v.delay.wet.value = 0.1;
        v.filter.frequency.value = 3500;
        break;
    }
  }

  private snapshotInstrument(v: TrackVoice): InstrumentState {
    return {
      poly: v.poly,
      drums: v.drums,
      kit: v.kit,
      kitId: v.kitId,
      presetId: v.presetId,
    };
  }

  private disposeInstrumentState(state: InstrumentState): void {
    if (state.poly) {
      try {
        releaseAllNotes(state.poly);
        (state.poly as unknown as { disconnect?: () => void }).disconnect?.();
      } catch {
        // Best-effort release; disposal below remains authoritative.
      }
      try { state.poly.dispose(); } catch { /* ignore */ }
    }
    if (state.drums) {
      for (const piece of Object.keys(state.drums) as DrumPiece[]) {
        try { state.drums[piece].dispose(); } catch { /* ignore */ }
      }
    }
    if (state.kit) {
      try { state.kit.dispose(); } catch { /* ignore */ }
    }
  }

  /** Publish a fully-built instrument before releasing its predecessor. */
  private commitInstrument(v: TrackVoice, next: InstrumentState): void {
    const previous = this.snapshotInstrument(v);
    v.instrumentGeneration += 1;
    v.poly = next.poly;
    v.drums = next.drums;
    v.kit = next.kit;
    v.kitId = next.kitId;
    v.presetId = next.presetId;
    this.disposeInstrumentState(previous);
  }

  private rehydrateTrackVoice(track: Track): void {
    this.applyTrackSettings(track);
    if (track.sound) this.setSoundParams(track.id, track.sound);
    if (track.eq) this.setTrackEq(track.id, track.eq);
    if (track.sends) {
      for (const [busId, amount] of Object.entries(track.sends) as [SendBusId, number][]) {
        this.setTrackSend(track.id, busId, amount);
      }
    }
    if (track.fxRack) {
      for (const [moduleId, settings] of Object.entries(track.fxRack) as [
        FxModuleId,
        FxModuleSettings,
      ][]) {
        this.setEffectModule(track.id, moduleId, settings);
      }
    }
    if (track.kitId && track.pieceSettings) {
      for (const [piece, partial] of Object.entries(track.pieceSettings)) {
        if (!partial) continue;
        this.setPieceSetting(
          track.id,
          piece as DrumPiece,
          partial,
          track.pieceSettings,
        );
      }
    }
  }

  changePreset(track: Track) {
    if (track.kind === "drums") {
      const kitId = track.kitId ?? (
        track.preset === "acoustic"
          ? "garageband"
          : track.preset === "electronic"
            ? "cyberpunk"
            : "trap"
      );
      this.ensureLeanDrumTrack(track, "drum-preset-switch", performance.now());
      this.setKit(track.id, kitId);
      this.rehydrateTrackVoice(track);
      return;
    }
    const v = this.voices.get(track.id);
    if (!v) {
      if (this.isAudioContextRunning()) {
        this.ensureTrack(track, {
          mode: "tone",
          reason: "legacy-preset-switch",
          allowHeavy: true,
        });
      }
      return;
    }
    const endTiming = startPerfTimer("instrument-replacement", {
      trackId: track.id,
      kind: track.kind,
    });
    try {
      if (track.kind === "vocals") {
        this.applyVocalPresetSettings(v, track.preset as VocalsPreset);
        return;
      }
      if (track.presetId) {
        this.setMelodicPreset(track.id, track.presetId);
        return;
      }
      const poly = buildMelodicVoice(track.kind, track.preset);
      if (!poly) return;
      try {
        poly.connect(v.filter);
      } catch (error) {
        try { poly.dispose(); } catch { /* ignore */ }
        throw error;
      }
      this.commitInstrument(v, { poly });
      if (track.kind === "piano") announceSamplerLoadIfNeeded(poly);
      this.rehydrateTrackVoice(track);
    } catch (error) {
      firstPlayMark("instrument-replacement:failed", {
        trackId: track.id,
        kind: track.kind,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      endTiming();
    }
  }

  // ---- v2 sound-model methods ----

  /** Select a named kit without rebuilding the real-time audio graph. */
  setKit(trackId: string, kitId: DrumKitId) {
    let lean = this.leanDrumVoices.get(trackId);
    const track = this.projectTrackSnapshots.get(trackId);
    if (!lean && track?.kind === "drums") {
      this.ensureLeanDrumTrack(track, "named-kit-selection", performance.now());
      lean = this.leanDrumVoices.get(trackId);
    }
    if (!lean) return;

    lean.setKit(kitId);
    const shell = this.voices.get(trackId);
    if (shell && (shell.kit || shell.drums)) {
      this.commitInstrument(shell, { kitId });
    } else if (shell) {
      shell.kitId = kitId;
    }
    if (track?.pieceSettings) {
      for (const [piece, settings] of Object.entries(track.pieceSettings)) {
        if (settings) {
          lean.setPieceSetting(
            piece as DrumPiece,
            settings,
            track.pieceSettings,
          );
        }
      }
    }
    this.drumPadSampleManager.refreshRouting(trackId);
    firstPlayMark("kit-switch:native", { trackId, kitId });
  }

  /** Switch this track to a named v2 melodic preset, rebuilding the voice. */
  setMelodicPreset(trackId: string, presetId: string) {
    const v = this.voices.get(trackId);
    if (!v) return;
    if (v.presetId === presetId && v.poly) return;
    const def = findPreset(presetId);
    if (!def) return;
    const endTiming = startPerfTimer("instrument-replacement", { trackId, presetId });
    let poly: MelodicVoice | null = null;
    try {
      poly = buildPresetVoice(def);
      poly.connect(v.filter);
      this.commitInstrument(v, { poly, presetId });
      announceSamplerLoadIfNeeded(poly);
      const track = this.projectTrackSnapshots.get(trackId);
      if (track) this.rehydrateTrackVoice(track);
      else {
        this.setTrackReverbWet(v, def.synth.reverbSend, 0.05);
        v.delay.wet.rampTo(def.synth.delaySend, 0.05);
      }
      this.maybeAttachMelodicSampler(v, def, presetId);
    } catch (error) {
      if (poly && v.poly !== poly) {
        try { poly.dispose(); } catch { /* ignore */ }
      }
      firstPlayMark("instrument-replacement:failed", {
        trackId,
        presetId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      endTiming();
    }
  }

  /**
   * Queue a sample-backed upgrade for a melodic preset. The modeled synth is
   * authoritative immediately; fetch/decode and voice replacement happen one
   * track at a time only while Transport is fully stopped. This keeps a live
   * set change from spending the playback frame budget on PCM decoding or
   * disposing a voice that is still sustaining notes.
   */
  private maybeAttachMelodicSampler(
    v: TrackVoice,
    def: ReturnType<typeof findPreset>,
    presetId: string,
  ) {
    if (!def || !def.layers?.length) {
      this.pendingSamplerPromotions.delete(v.trackId);
      return;
    }
    if (getFirstPlayFlags().disableSamplePromotion) {
      this.pendingSamplerPromotions.delete(v.trackId);
      firstPlayMark("sampler-promotion:disabled", { trackId: v.trackId, presetId });
      return;
    }
    const request: SamplerPromotionRequest = {
      id: ++this.samplerPromotionRequestId,
      voice: v,
      def,
      presetId,
      instrumentGeneration: v.instrumentGeneration,
    };
    this.pendingSamplerPromotions.set(v.trackId, request);
    firstPlayMark("sampler-promotion:queued", {
      trackId: v.trackId,
      presetId,
      requestId: request.id,
      playbackState: this.playbackState,
    });
    this.scheduleSamplerPromotionDrain();
  }

  private isSamplerPromotionIdle(): boolean {
    return (
      !this.disposed &&
      this.playbackState === "stopped" &&
      Tone.getTransport().state === "stopped"
    );
  }

  private isSamplerPromotionCurrent(request: SamplerPromotionRequest): boolean {
    const { voice, presetId, instrumentGeneration } = request;
    return (
      !this.disposed &&
      this.pendingSamplerPromotions.get(voice.trackId) === request &&
      this.voices.get(voice.trackId) === voice &&
      voice.presetId === presetId &&
      voice.instrumentGeneration === instrumentGeneration
    );
  }

  private scheduleSamplerPromotionDrain(): void {
    if (!this.isSamplerPromotionIdle() || this.activeSamplerPromotion) return;
    if (this.samplerPromotionDrainTimer !== null) return;
    this.samplerPromotionDrainTimer = globalThis.setTimeout(() => {
      this.samplerPromotionDrainTimer = null;
      this.drainSamplerPromotions();
    }, 0) as unknown as number;
  }

  private drainSamplerPromotions(): void {
    if (!this.isSamplerPromotionIdle() || this.activeSamplerPromotion) return;
    let request: SamplerPromotionRequest | undefined;
    for (const candidate of this.pendingSamplerPromotions.values()) {
      if (this.isSamplerPromotionCurrent(candidate)) {
        request = candidate;
        break;
      }
      if (this.pendingSamplerPromotions.get(candidate.voice.trackId) === candidate) {
        this.pendingSamplerPromotions.delete(candidate.voice.trackId);
      }
    }
    if (!request) return;

    this.activeSamplerPromotion = request;
    const { voice, def, presetId } = request;
    const recipe = def.synth;
    const playbackEpoch = this.backgroundAudioWorkEpoch;
    firstPlayMark("sampler-promotion:start", {
      trackId: voice.trackId,
      presetId,
      requestId: request.id,
    });

    void tryLoadMelodicSampler(def.layers, {
      release: Math.max(0.1, recipe.release * 2),
      attack: Math.max(0, recipe.attack * 0.4),
      volume: -8,
      shouldContinue: () => (
        this.isSamplerPromotionCurrent(request!) &&
        this.isSamplerPromotionIdle() &&
        this.backgroundAudioWorkEpoch === playbackEpoch
      ),
    }).then((sampler) => {
      const canCommit = (
        this.isSamplerPromotionCurrent(request!) &&
        this.isSamplerPromotionIdle() &&
        this.backgroundAudioWorkEpoch === playbackEpoch
      );
      if (!sampler) {
        // If Play interrupted a decode, retain the request so Stop can retry.
        // A null result while idle means the asset was unavailable; the synth
        // fallback remains the final, working voice for this preset.
        if (canCommit) this.pendingSamplerPromotions.delete(voice.trackId);
        return;
      }
      if (!canCommit || voice.poly instanceof Tone.Sampler) {
        try { sampler.dispose(); } catch { /* ignore */ }
        if (canCommit) this.pendingSamplerPromotions.delete(voice.trackId);
        return;
      }
      try {
        sampler.connect(voice.filter);
      } catch {
        try { sampler.dispose(); } catch { /* ignore */ }
        this.pendingSamplerPromotions.delete(voice.trackId);
        return;
      }
      const old = voice.poly;
      voice.poly = sampler;
      this.pendingSamplerPromotions.delete(voice.trackId);
      if (old) {
        try {
          (old as unknown as { releaseAll?: () => void }).releaseAll?.();
        } catch { /* ignore */ }
        try { old.dispose(); } catch { /* ignore */ }
      }
      const track = this.projectTrackSnapshots.get(voice.trackId);
      if (track?.sound) this.setSoundParams(voice.trackId, track.sound);
      firstPlayMark("sampler-promotion:complete", {
        trackId: voice.trackId,
        presetId,
        requestId: request!.id,
      });
    }).catch(() => {
      if (this.isSamplerPromotionCurrent(request!) && this.isSamplerPromotionIdle()) {
        this.pendingSamplerPromotions.delete(voice.trackId);
      }
      // The already-connected synth fallback remains authoritative.
    }).finally(() => {
      if (this.activeSamplerPromotion === request) this.activeSamplerPromotion = null;
      this.scheduleSamplerPromotionDrain();
    });
  }

  /** Update one drum-piece's mixer fields. Pitch/decay are stored on the
   *  PieceVoice and read on the next hit. Solo is reconciled across the
   *  whole kit so any active solo silences un-soloed pieces. */
  setPieceSetting(
    trackId: string,
    piece: DrumPiece,
    partial: Partial<DrumPieceSettings>,
    allSettings?: Partial<Record<string, Partial<DrumPieceSettings>>>,
  ) {
    const lean = this.leanDrumVoices.get(trackId);
    if (lean) {
      lean.setPieceSetting(piece, partial, allSettings);
      return;
    }
    const v = this.voices.get(trackId);
    if (!v?.kit) return;
    const pv = v.kit.pieces.get(piece);
    if (!pv) return;
    if (partial.volume !== undefined) {
      const v01 = Math.max(0, Math.min(1, partial.volume));
      const db = v01 <= 0.005 ? -60 : 20 * Math.log10(v01);
      pv.channel.volume.rampTo(db, 0.04);
    }
    if (partial.pan !== undefined) {
      pv.channel.pan.rampTo(Math.max(-1, Math.min(1, partial.pan)), 0.04);
    }
    if (partial.cutoff !== undefined) {
      pv.filter.frequency.rampTo(cutoffNormToHz(partial.cutoff), 0.04);
    }
    if (partial.reverbSend !== undefined) {
      pv.reverbSend.gain.rampTo(Math.max(0, Math.min(1, partial.reverbSend)), 0.04);
    }
    if (partial.delaySend !== undefined) {
      pv.delaySend.gain.rampTo(Math.max(0, Math.min(1, partial.delaySend)), 0.04);
    }
    if (partial.pitch !== undefined) {
      pv.pitchSemis = Math.max(-12, Math.min(12, partial.pitch));
    }
    if (partial.decay !== undefined) {
      pv.decayMul = Math.max(0, Math.min(1, partial.decay));
    }
    if (partial.solo !== undefined) {
      pv.solo = !!partial.solo;
    }
    if (partial.muted !== undefined || partial.solo !== undefined || allSettings) {
      // Reconcile kit-wide solo/mute state. When any piece is soloed, all
      // others go silent; otherwise each piece honors its own `muted`.
      this.reconcileKitSolo(v, allSettings);
    }
  }

  /** Walk the kit and compute effective mute = userMute || (anySolo && !solo). */
  private reconcileKitSolo(
    v: TrackVoice,
    allSettings?: Partial<Record<string, Partial<DrumPieceSettings>>>,
  ) {
    if (!v.kit) return;
    let anySolo = false;
    v.kit.pieces.forEach((pv) => {
      if (pv.solo) anySolo = true;
    });
    v.kit.pieces.forEach((pv, piece) => {
      const userMute =
        (allSettings?.[piece]?.muted as boolean | undefined) ?? false;
      pv.channel.mute = userMute || (anySolo && !pv.solo);
    });
  }

  /** Apply per-track sound parameters (ADSR + cutoff + sends + glide). */
  setSoundParams(trackId: string, partial: Partial<SoundParams>) {
    const lean = this.leanDrumVoices.get(trackId);
    lean?.applySoundParams(partial);
    const leanTrack = this.projectTrackSnapshots.get(trackId);
    if (lean && leanTrack) this.leanTrackSettings.markApplied(leanTrack);
    const v = this.voices.get(trackId);
    if (!v) return;
    if (partial.cutoff !== undefined) {
      v.filter.frequency.rampTo(cutoffNormToHz(partial.cutoff), 0.05);
    }
    if (partial.reverbSend !== undefined) {
      this.setTrackReverbWet(v, partial.reverbSend, 0.05);
    }
    if (partial.delaySend !== undefined) {
      v.delay.wet.rampTo(Math.max(0, Math.min(1, partial.delaySend)), 0.05);
    }
    if (partial.resonance !== undefined) {
      v.filter.Q.rampTo(Math.max(0.1, partial.resonance * 16), 0.05);
    }
    if (partial.drive !== undefined && partial.drive > 0) this.ensureDriveNode(v);
    if (partial.drive !== undefined && v.drive) {
      const d = Math.max(0, Math.min(1, partial.drive));
      v.drive.distortion = d * 0.9;
      v.drive.wet.rampTo(d > 0 ? Math.min(1, d * 2) : 0, 0.05);
    }
    if (partial.chorusSend !== undefined && partial.chorusSend > 0) this.ensureChorusNode(v);
    if (partial.chorusSend !== undefined && v.chorus) {
      v.chorus.wet.rampTo(Math.max(0, Math.min(1, partial.chorusSend)), 0.05);
    }
    if (partial.width !== undefined && Math.abs(partial.width - 0.5) > 0.001) {
      this.ensureWidenerNode(v);
    }
    if (partial.width !== undefined && v.widener) {
      v.widener.width.rampTo(Math.max(0, Math.min(1, partial.width)), 0.05);
    }
    if (!v.poly) return;
    // Tone.PolySynth supports `.set()` to live-update voice options.
    const poly = v.poly as unknown as { set?: (opts: object) => void };
    if (typeof poly.set !== "function") return;
    const env: Record<string, number> = {};
    if (partial.attack !== undefined) env.attack = Math.max(0.001, partial.attack * 2);
    if (partial.decay !== undefined) env.decay = Math.max(0.001, partial.decay * 1.5);
    if (partial.sustain !== undefined) env.sustain = Math.max(0, Math.min(1, partial.sustain));
    if (partial.release !== undefined) env.release = Math.max(0.01, partial.release * 3);
    if (Object.keys(env).length > 0) {
      try {
        poly.set({ envelope: env });
      } catch {
        // some voices (Sampler, Pluck) don't expose envelope.set
      }
    }
    if (partial.glide !== undefined) {
      try {
        poly.set({ portamento: Math.max(0, partial.glide) });
      } catch {
        // ignore
      }
    }
  }

  /** Per-track groove settings live on the Track object itself; this
   *  method exists as the documented facade entry-point so the UI can
   *  signal a change. The next `scheduleClip` will pick up the new
   *  values from the patched Track and merge with `globalGroove`. */
  setTrackGroove(_trackId: string, _settings: Partial<GrooveSettings>) {
    // no-op on the engine cache; see scheduleClip for read site.
  }

  // ---- Phase 11: Automation & Modulation ----

  /** Update the automation lanes for a single track. Pass an empty array to clear. */
  setTrackAutomation(trackId: string, lanes: AutomationLane[]) {
    const previousParams = new Set(
      (this.trackAutomationData.get(trackId) ?? []).map((lane) => lane.param),
    );
    const nextParams = new Set(lanes.map((lane) => lane.param));
    if (lanes.length === 0) {
      this.trackAutomationData.delete(trackId);
    } else {
      this.trackAutomationData.set(trackId, lanes);
    }
    const removedParams = Array.from(previousParams).filter(
      (param) => !nextParams.has(param),
    );
    if (removedParams.length > 0) {
      const track = this.projectTrackSnapshots.get(trackId);
      if (track) {
        // Automation writes directly to long-lived AudioParams. Restore the
        // persisted channel snapshot when a lane disappears so its last value
        // (especially volume=0) cannot remain latched indefinitely.
        const lean = this.leanDrumVoices.get(trackId);
        if (lean) {
          lean.applyTrack(track);
          lean.setAudible(
            !track.muted && (this.soloSet.size === 0 || track.solo),
          );
          this.leanTrackSettings.markApplied(track);
        }
        if (this.voices.has(trackId)) this.rehydrateTrackVoice(track);
      }
    }
    if (this.automationActive) this.ensureAutomationScheduler();
    else this.stopAutomationScheduler();
  }

  /** Remove all automation data for a track (called on track deletion). */
  removeTrackAutomation(trackId: string) {
    this.trackAutomationData.delete(trackId);
    if (!this.automationActive) this.stopAutomationScheduler();
  }

  /** Replace the project-level modulation sources and routings. */
  setProjectModulation(sources: ModulationSource[], routings: ModulationRouting[]) {
    this.modulationSources = sources;
    this.modulationRoutings = routings;
    // Clean up internal state for removed sources
    const live = new Set(sources.map((s) => s.id));
    for (const id of this.modOutputs.keys()) {
      if (!live.has(id)) {
        this.modOutputs.delete(id);
        this.lfoPhases.delete(id);
        this.driftState.delete(id);
        this.stepModState.delete(id);
      }
    }
    if (this.automationActive) this.ensureAutomationScheduler();
    else this.stopAutomationScheduler();
  }

  /** Get the live output value (0..1) for a modulation source. Used by the MOD panel UI. */
  getModSourceOutput(sourceId: string): number {
    return this.modOutputs.get(sourceId) ?? 0.5;
  }

  private ensureAutomationScheduler() {
    if (this.automationSchedulerId !== null) return;
    if (!this.automationActive) return;
    const id = Tone.getTransport().scheduleRepeat(
      (time) => this.automationTick(time),
      0.02, // 20 ms resolution
    );
    this.automationSchedulerId = trackTransportEvent(id, "automation");
  }

  private stopAutomationScheduler() {
    if (this.automationSchedulerId !== null) {
      try {
        Tone.getTransport().clear(this.automationSchedulerId);
      } catch {
        // ignore
      }
      untrackTransportEvent(this.automationSchedulerId, "automation");
      this.automationSchedulerId = null;
    }
  }

  private automationTick(_time: number) {
    if (!this.automationActive) return;
    const beat = this.positionBeats();
    const DT = 0.02; // seconds per tick

    // Advance all modulation sources
    for (const src of this.modulationSources) {
      switch (src.type) {
        case "lfo": {
          const s = src.lfo ?? { shape: "sine", rate: 1, depth: 1, phase: 0 };
          let phase = this.lfoPhases.get(src.id) ?? (s.phase * Math.PI / 180);
          phase = (phase + 2 * Math.PI * s.rate * DT) % (2 * Math.PI);
          this.lfoPhases.set(src.id, phase);
          let raw = 0;
          switch (s.shape) {
            case "sine": raw = Math.sin(phase); break;
            case "triangle": {
              const p = (phase % (2 * Math.PI)) / (2 * Math.PI);
              raw = 1 - 4 * Math.abs(p - 0.5);
              break;
            }
            case "square": raw = Math.sin(phase) >= 0 ? 1 : -1; break;
            case "sawtooth": raw = ((phase % (2 * Math.PI)) / Math.PI) - 1; break;
          }
          this.modOutputs.set(src.id, Math.max(0, Math.min(1, (raw * s.depth + 1) / 2)));
          break;
        }
        case "randomDrift": {
          const s = src.randomDrift ?? { rate: 0.5, smoothing: 0.9 };
          let state = this.driftState.get(src.id);
          if (!state) {
            state = { value: 0.5, target: Math.random() };
            this.driftState.set(src.id, state);
          }
          const speed = DT * s.rate * 5 * Math.max(0.05, 1 - s.smoothing);
          state.value += (state.target - state.value) * speed;
          if (Math.abs(state.value - state.target) < 0.02) {
            state.target = Math.random();
          }
          this.modOutputs.set(src.id, Math.max(0, Math.min(1, state.value)));
          break;
        }
        case "stepMod": {
          const s = src.stepMod ?? { steps: [1, 0, 0.5, 0], rate: 1, glide: 0 };
          const steps = s.steps.length > 0 ? s.steps : [0.5];
          const beatsPerStep = Math.max(0.0625, s.rate);
          const idx = Math.floor(beat / beatsPerStep) % steps.length;
          const target = Math.max(0, Math.min(1, steps[idx] ?? 0));
          if (s.glide > 0) {
            const cur = this.modOutputs.get(src.id) ?? target;
            const glideSpeed = DT * Math.max(0.1, 1 - s.glide) * 8;
            this.modOutputs.set(src.id, Math.max(0, Math.min(1, cur + (target - cur) * glideSpeed)));
          } else {
            this.modOutputs.set(src.id, target);
          }
          break;
        }
        case "envelopeFollower":
        case "sidechainEnv":
          if (!this.modOutputs.has(src.id)) this.modOutputs.set(src.id, 0);
          break;
      }
    }

    // Apply automation + modulation to each track
    for (const [trackId, lanes] of this.trackAutomationData) {
      const voice = this.voices.get(trackId);
      const lean = this.leanDrumVoices.get(trackId);
      if (!voice && !lean) continue;
      for (const lane of lanes) {
        if (lane.breakpoints.length === 0) continue;
        // Skip if the user has a manual override active for this param
        if (this.paramOverrides.has(`${trackId}:${lane.param}`)) continue;
        let value = evalBreakpoints(lane.breakpoints, beat, lane.interpolation);
        // Add modulation offsets
        for (const r of this.modulationRoutings) {
          if (r.trackId !== trackId || r.param !== lane.param) continue;
          const modOut = this.modOutputs.get(r.sourceId) ?? 0.5;
          value = Math.max(0, Math.min(1, value + r.depth * (modOut - 0.5)));
        }
        if (voice) this.applyAutomationParam(voice, lane.param, value);
        else lean?.applyAutomation(lane.param, value, Tone.immediate() + 0.02);
      }
    }
  }

  private applyAutomationParam(v: TrackVoice, param: AutomationParamId, value: number) {
    try {
      const now = Tone.now();
      const rampEnd = now + 0.02; // ramp over the full tick interval to eliminate stepping
      switch (param) {
        case "volume": {
          const db = value <= 0.005 ? -60 : 20 * Math.log10(value);
          v.channel.volume.linearRampToValueAtTime(db, rampEnd);
          break;
        }
        case "pan":
          v.channel.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, value * 2 - 1)), rampEnd);
          break;
        case "filterCutoff":
          v.filter.frequency.linearRampToValueAtTime(200 + Math.pow(value, 2) * 17800, rampEnd);
          break;
        case "reverbSend":
          v.sends?.get("roomReverb")?.gain.linearRampToValueAtTime(value, rampEnd);
          break;
        case "delaySend":
          v.delay.wet.linearRampToValueAtTime(value, rampEnd);
          break;
        case "distortionAmount":
          if (value > 0) this.ensureDriveNode(v);
          if (v.drive) v.drive.wet.linearRampToValueAtTime(value, rampEnd);
          break;
        case "effectWetDry":
          if (value > 0) this.ensureChorusNode(v);
          if (v.chorus) v.chorus.wet.linearRampToValueAtTime(value, rampEnd);
          break;
        case "pitch":
        case "sampleStart":
          // Not directly applicable at audio-rate; gracefully skip
          break;
      }
    } catch {
      // best effort — ignore audio graph errors
    }
  }

  /** Project-wide groove default. Merged under per-track overrides at
   *  schedule time so tracks without their own groove still humanize. */
  setGlobalGroove(settings: Partial<GrooveSettings> | undefined) {
    this.globalGroove = settings;
  }

  /** Snapshot the resolved groove for a track (template + global + track),
   *  used by the UI to render the per-16th probability/flam grid against
   *  the effective values. */
  resolveGroove(track: Track) {
    return getGroove(track.groove, this.globalGroove);
  }

  /**
   * Trigger one note from a melodic preset preview. Sampled instruments wait
   * for their local zones and report which path sounded; missing/corrupt files
   * fall back to the preset model. A generation guard prevents a slow decode
   * from sounding after the user has already auditioned something else.
   */
  async previewPresetNote(
    presetId: string,
    note = "C4",
    durationSec = 0.6,
  ): Promise<"sampled" | "modeled" | null> {
    const def = findPreset(presetId);
    if (!def || this.noAudio || this.disposed) return null;
    const silenceGeneration = this.silenceGeneration;
    // A preview is an explicit user audio action. It must both recover a
    // suspended context and release the master attenuation left by Panic.
    await this.unlock();
    if (silenceGeneration !== this.silenceGeneration || this.disposed) return null;
    this.cancelPresetPreview();
    const generation = this.presetPreviewGeneration;

    let voice: MelodicVoice | null = null;
    let source: "sampled" | "modeled" = "modeled";
    if (def.layers?.length) {
      try {
        voice = await tryLoadMelodicSampler(def.layers, {
          release: Math.max(0.1, def.synth.release * 2),
          attack: Math.max(0, def.synth.attack * 0.4),
          volume: -8,
          shouldContinue: () => (
            generation === this.presetPreviewGeneration &&
            silenceGeneration === this.silenceGeneration &&
            !this.disposed
          ),
        });
        if (voice) source = "sampled";
      } catch {
        // The modeled voice below remains a deterministic fallback.
      }
    }
    voice ??= buildPresetVoice(def);

    if (generation !== this.presetPreviewGeneration || this.disposed) {
      try { voice.dispose(); } catch { /* ignore */ }
      return null;
    }

    // Build a one-shot preview voice on the master bus so it doesn't disturb
    // any track settings. The next preview, Panic, or lifecycle disposal can
    // cancel this tail immediately.
    this.activePresetPreview = voice;
    voice.connect(this.masterChain.input);
    try {
      voice.triggerAttackRelease(note, durationSec, undefined, 0.85);
    } catch {
      // ignore — preset preview is best-effort
    }
    const tailSec = Math.max(2, def.synth.release * 3);
    this.presetPreviewTimeout = window.setTimeout(() => {
      if (this.activePresetPreview === voice) this.cancelPresetPreview();
    }, Math.ceil((durationSec + tailSec) * 1000));
    return source;
  }

  private cancelPresetPreview() {
    this.presetPreviewGeneration += 1;
    if (this.presetPreviewTimeout !== null) {
      window.clearTimeout(this.presetPreviewTimeout);
      this.presetPreviewTimeout = null;
    }
    const voice = this.activePresetPreview;
    this.activePresetPreview = null;
    if (!voice) return;
    try { releaseAllNotes(voice); } catch { /* ignore */ }
    try {
      (voice as unknown as { disconnect?: () => void }).disconnect?.();
    } catch { /* ignore */ }
    try { voice.dispose(); } catch { /* ignore */ }
  }

  /** Internal: dispose whichever instrument(s) are attached. */
  private disposeInstrument(v: TrackVoice) {
    const current = this.snapshotInstrument(v);
    v.instrumentGeneration += 1;
    v.poly = undefined;
    v.drums = undefined;
    v.kit = undefined;
    v.presetId = undefined;
    v.kitId = undefined;
    this.disposeInstrumentState(current);
  }

  // ---- live triggering ----

  /**
   * Fires a window event the first time the user produces audio from a
   * given source — "qwerty" (computer keyboard) or "midi" (external MIDI
   * controller). Each source latches independently so the UI can confirm
   * both input paths are working.
   */
  private notifyFirstNote(source: "qwerty" | "midi") {
    if (!this.unlocked) return;
    if (source === "qwerty") {
      if (this.firstQwertyShown) return;
      this.firstQwertyShown = true;
    } else {
      if (this.firstMidiShown) return;
      this.firstMidiShown = true;
    }
    this.noteEverPlayed = true;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(`studio:first-${source}-note`));
    }
  }

  triggerNote(
    trackId: string,
    note: string,
    durationSec = 0.4,
    velocity = 0.9,
    source?: "qwerty" | "midi",
  ) {
    this.masterChain.releasePanicHold();
    if (!this.isAudioContextRunning()) {
      const silenceGeneration = this.silenceGeneration;
      void this.unlock()
        .then(() => {
          if (
            silenceGeneration === this.silenceGeneration &&
            this.projectTrackSnapshots.has(trackId)
          ) {
            this.triggerNote(trackId, note, durationSec, velocity, source);
          }
        })
        .catch(() => { /* the next user gesture can retry */ });
      return;
    }
    this.ensurePlayableTrack(trackId, "live-note");
    const v = this.voices.get(trackId);
    if (!v?.poly) return;
    try {
      v.poly.triggerAttackRelease(note, durationSec, undefined, velocity);
      jamCapture.captureOneShot(trackId, note, durationSec, velocity);
      if (source) this.notifyFirstNote(source);
      else this.noteEverPlayed = true;
    } catch {
      // ignore invalid notes
    }
  }

  /** Documented v2 alias for `triggerNote`. */
  triggerInstrumentNote(
    trackId: string,
    note: string,
    durationSec = 0.4,
    velocity = 0.9,
    source?: "qwerty" | "midi",
  ) {
    this.triggerNote(trackId, note, durationSec, velocity, source);
  }

  startNote(
    trackId: string,
    note: string,
    velocity = 0.9,
    source?: "qwerty" | "midi",
  ) {
    const pendingKey = `${trackId}:${note}`;
    this.masterChain.releasePanicHold();
    if (!this.isAudioContextRunning()) {
      const silenceGeneration = this.silenceGeneration;
      this.pendingHeldNotes.set(pendingKey, silenceGeneration);
      void this.unlock()
        .then(() => {
          if (
            this.pendingHeldNotes.get(pendingKey) === silenceGeneration &&
            silenceGeneration === this.silenceGeneration &&
            this.projectTrackSnapshots.has(trackId)
          ) {
            this.pendingHeldNotes.delete(pendingKey);
            this.startNote(trackId, note, velocity, source);
          }
        })
        .catch(() => this.pendingHeldNotes.delete(pendingKey));
      return;
    }
    this.pendingHeldNotes.delete(pendingKey);
    this.ensurePlayableTrack(trackId, "live-note-hold");
    const v = this.voices.get(trackId);
    if (!v?.poly) return;
    try {
      (v.poly as Tone.PolySynth).triggerAttack(note, undefined, velocity);
      jamCapture.noteOn(trackId, note, velocity);
      if (source) this.notifyFirstNote(source);
      else this.noteEverPlayed = true;
    } catch {
      // ignore
    }
  }

  endNote(trackId: string, note: string) {
    this.pendingHeldNotes.delete(`${trackId}:${note}`);
    const v = this.voices.get(trackId);
    if (!v?.poly) {
      jamCapture.noteOff(trackId, note);
      return;
    }
    try {
      (v.poly as Tone.PolySynth).triggerRelease(note);
    } catch {
      // ignore
    }
    jamCapture.noteOff(trackId, note);
  }

  /** Map drum piece names to Chop Lab slice indices (for "Use as Kit"). */
  private static readonly PIECE_TO_SLICE_INDEX: Partial<Record<DrumPiece, number>> = {
    kick: 0, snare: 1, hat: 2, ohat: 3, clap: 4,
    tomLow: 5, tomHigh: 6, crash: 7, fx: 8,
  };

  /** Activate/deactivate the Chop Lab kit for a track. When active, drum
   *  triggers are routed to the ChopEngine instead of the synthesized voices. */
  setChopKitForTrack(trackId: string | null) {
    if (this.chopKitTrackId !== trackId) stopChopEngine();
    this.chopKitTrackId = trackId;
  }

  /** Release Chop Lab ownership only when an authoritative user selector
   * chooses another sound for the track that currently owns Chop routing. */
  releaseChopKitForTrack(trackId: string) {
    if (this.chopKitTrackId === trackId) this.setChopKitForTrack(null);
  }

  triggerDrum(trackId: string, piece: DrumPiece, velocity = 0.9) {
    this.triggerDrumAt(trackId, piece, velocity);
  }

  /** Documented v2 alias for `triggerDrum` — fires a one-shot drum sample. */
  triggerSample(trackId: string, piece: DrumPiece, velocity = 0.9) {
    this.triggerDrumAt(trackId, piece, velocity);
  }

  triggerDrumAt(
    trackId: string,
    piece: DrumPiece,
    velocity = 0.9,
    time?: number,
  ) {
    // Only a fresh direct gesture may release the master Panic hold. Transport
    // callbacks carry an explicit audio time and can arrive from scheduler
    // lookahead after Panic; letting one reopen the master would resurrect
    // audio the user explicitly stopped.
    if (time === undefined) this.masterChain.releasePanicHold();
    if (!this.isAudioContextRunning()) {
      // Only replay direct pad/MIDI hits. Transport callbacks carry an
      // explicit audio time and must not be shifted to an unrelated moment.
      if (time === undefined) {
        const silenceGeneration = this.silenceGeneration;
        void this.unlock()
          .then(() => {
            if (
              silenceGeneration === this.silenceGeneration &&
              this.projectTrackSnapshots.has(trackId)
            ) {
              this.triggerDrumAt(trackId, piece, velocity);
            }
          })
          .catch(() => { /* the next user gesture can retry */ });
      }
      return;
    }
    // Chop Lab "Use as Kit" routing: redirect to ChopEngine slices.
    if (this.chopKitTrackId === trackId) {
      const sliceIndex = AudioEngine.PIECE_TO_SLICE_INDEX[piece] ?? 0;
      getChopEngine().triggerSlice(sliceIndex, time);
      if (time === undefined) jamCapture.captureDrum(trackId, piece, velocity);
      this.noteEverPlayed = true;
      return;
    }

    this.ensurePlayableTrack(trackId, "live-drum");
    this.drumPadSampleManager.refreshRouting(trackId);
    const lean = this.leanDrumVoices.get(trackId);
    const padResult = this.drumPadSampleManager.trigger(
      trackId,
      piece as DrumPadSamplePiece,
      time,
      velocity,
    );
    // Direct pad gestures should sound at the native context's current time.
    // Tone.now() adds scheduler look-ahead, which is correct for Transport but
    // makes a live hit feel late and can miss a short first-output probe.
    const t = time ?? Tone.immediate();
    if (padResult !== "fallback") {
      if (padResult === "played") {
        lean?.chokeExternal(piece, t);
        if (time === undefined) jamCapture.captureDrum(trackId, piece, velocity);
        this.noteEverPlayed = true;
      }
      return;
    }
    const v = this.voices.get(trackId);
    if (lean && (!v || (!v.kit && !v.drums))) {
      recordLeanDrumTrace("hit-scheduled", { trackId, piece });
      lean.trigger(piece, t, velocity);
      if (time === undefined) jamCapture.captureDrum(trackId, piece, velocity);
      this.noteEverPlayed = true;
      return;
    }
    if (!v) return;
    try {
      // v2 kit wins when present (the new sound model).
      if (v.kit) {
        const pv = v.kit.pieces.get(piece);
        if (pv) {
          pv.trigger(t, velocity);
          if (time === undefined) jamCapture.captureDrum(trackId, piece, velocity);
          this.noteEverPlayed = true;
        }
        return;
      }
      if (v.drums) {
        const inst = v.drums[piece];
        if (inst) {
          inst.trigger(t, velocity);
          if (time === undefined) jamCapture.captureDrum(trackId, piece, velocity);
          this.noteEverPlayed = true;
        }
      }
    } catch {
      // ignore
    }
  }

  // ---- vocals ----
  async startVocalMonitor(trackId: string, deviceId?: string) {
    const generation = (this.vocalMonitorGeneration.get(trackId) ?? 0) + 1;
    const silenceGeneration = this.silenceGeneration;
    this.vocalMonitorGeneration.set(trackId, generation);
    await this.unlock();
    if (
      this.vocalMonitorGeneration.get(trackId) !== generation ||
      this.silenceGeneration !== silenceGeneration
    ) {
      throw new DOMException("Microphone start was cancelled.", "AbortError");
    }
    let v = this.voices.get(trackId);
    if (!v) {
      const track = this.projectTrackSnapshots.get(trackId);
      if (!track || track.kind !== "vocals") {
        throw new Error("The vocal track is no longer available.");
      }
      this.ensureTrack(track, {
        mode: "tone",
        reason: "vocal-monitor",
        allowHeavy: true,
      });
      v = this.voices.get(trackId);
    }
    if (!v) {
      throw new Error("The microphone monitor could not create an audio voice.");
    }
    const candidate = new Tone.UserMedia();
    try {
      candidate.connect(v.filter);
      if (deviceId) await candidate.open(deviceId);
      else await candidate.open();
      if (
        this.vocalMonitorGeneration.get(trackId) !== generation ||
        this.silenceGeneration !== silenceGeneration ||
        this.voices.get(trackId) !== v
      ) {
        try { candidate.close(); } catch { /* ignore stale permission completion */ }
        try { candidate.dispose(); } catch { /* ignore stale permission completion */ }
        throw new DOMException("Microphone start was cancelled.", "AbortError");
      }
      const previous = v.mic;
      v.mic = candidate;
      v.micOn = true;
      if (previous && previous !== candidate) {
        try { previous.close(); } catch { /* ignore previous device teardown */ }
        try { previous.dispose(); } catch { /* ignore previous device teardown */ }
      }
    } catch (err) {
      if (v.mic !== candidate) {
        try { candidate.close(); } catch { /* ignore failed permission cleanup */ }
        try { candidate.dispose(); } catch { /* ignore failed permission cleanup */ }
      }
      throw err;
    }
  }
  stopVocalMonitor(trackId: string) {
    this.vocalMonitorGeneration.set(
      trackId,
      (this.vocalMonitorGeneration.get(trackId) ?? 0) + 1,
    );
    const v = this.voices.get(trackId);
    if (!v?.mic) return;
    try { v.mic.close(); } catch { /* ignore */ }
    try { v.mic.dispose(); } catch { /* ignore */ }
    v.mic = undefined;
    v.micOn = false;
  }
  getMic(trackId: string) {
    return this.voices.get(trackId)?.mic;
  }

  /** Returns the post-fader meter for either a Tone or native drum voice. */
  getTrackMeter(trackId: string): LevelMeter | undefined {
    return this.voices.get(trackId)?.meter ?? this.leanDrumVoices.get(trackId)?.meter;
  }

  // ---- clip scheduling ----

  /** Schedule notes from a clip on Tone.Transport. Returns event ids for cleanup.
   *
   * When the track defines a groove, microtiming/velocity humanization
   * is consulted per note at schedule time. The groove engine returns
   * a small time offset (sec) and a possibly-modified velocity; notes
   * may also be skipped (probability gate) or flammed (small lead-in
   * grace note) depending on the template.
   */
  scheduleClip(track: Track, clip: NoteClip): number[] {
    const ids: number[] = [];
    const flags = getFirstPlayFlags();
    if (flags.disableProjectSchedules || flags.disableTransportCallbacks) {
      firstPlayMark("scheduleClip:skipped", {
        trackId: track.id,
        clipId: clip.id,
        disableProjectSchedules: flags.disableProjectSchedules,
        disableTransportCallbacks: flags.disableTransportCallbacks,
      });
      return ids;
    }
    firstPlayMark("scheduleClip:enter", {
      trackId: track.id,
      clipId: clip.id,
      noteCount: clip.notes.length,
    });
    const hasToneVoice = this.voices.has(track.id);
    const hasLeanDrumVoice = track.kind === "drums" && this.leanDrumVoices.has(track.id);
    if (!hasToneVoice && !hasLeanDrumVoice) return ids;
    const startBeats = clip.start;
    // Merge project-wide groove (global defaults) under track overrides.
    const groove = getGroove(track.groove, this.globalGroove);
    for (const ev of clip.notes) {
      // Defensive: drop events outside the clip window so a shrunk
      // pattern can't keep firing notes from its old tail. In dev we
      // warn — production users get the silent skip.
      if (ev.time < 0 || ev.time >= clip.length) {
        if (import.meta.env?.DEV && ev.time >= clip.length) {
          // eslint-disable-next-line no-console
          console.warn(
            `[engine] dropping note at beat ${ev.time} past clip.length ${clip.length} on track ${track.id}`,
          );
        }
        continue;
      }
      const t = startBeats + ev.time;
      let id = -1;
      id = Tone.getTransport().schedule((time) => {
        firstPlayMark("transport-callback:note-clip", {
          trackId: track.id,
          clipId: clip.id,
          beat: t,
          audioTime: time,
        });
        const bpm = Tone.getTransport().bpm.value;
        // Per-step probability gate (independent of groove template prob).
        if (ev.probability !== undefined && ev.probability < 1) {
          if (Math.random() > ev.probability) return;
        }
        const g = applyGroove(ev.time, ev.velocity, groove, bpm);
        if (g.skip) return;
        // Per-step microTiming nudge (beats -> sec) added on top of groove.
        const microSec = ev.microTiming
          ? (ev.microTiming * 60) / bpm
          : 0;
        // Accent boosts velocity ~25% and is capped at 1.
        const accentMul = ev.accent ? 1.25 : 1;
        const baseVel = Math.max(0.05, Math.min(1, g.velocity * accentMul));
        const fireAt = Math.max(time + g.timeOffsetSec + microSec, time - 0.05);
        const retrigger = Math.max(1, Math.min(8, ev.retrigger ?? 1));
        const stepSec = (ev.duration * 60) / bpm;
        if (track.kind === "drums") {
          const piece = ev.note as DrumPiece;
          // Per-step flam (explicit) OR groove-template flam.
          const flam =
            ev.flam ||
            (shouldFlam(groove, ev.time) && piece !== "hat" && piece !== "ohat");
          if (flam) {
            this.triggerDrumAt(
              track.id,
              piece,
              baseVel * 0.45,
              fireAt - 0.025,
            );
          }
          // Ghost note from groove template (snare/clap only).
          if (shouldGhost(groove) && (piece === "snare" || piece === "clap")) {
            this.triggerDrumAt(
              track.id,
              piece,
              Math.max(0.05, baseVel * 0.22),
              fireAt + 0.06,
            );
          }
          if (retrigger > 1) {
            const spacing = stepSec / retrigger;
            for (let i = 0; i < retrigger; i++) {
              // Decay velocity slightly across the retrigger tail so it
              // sounds like a roll rather than N equal hits.
              const v = baseVel * (1 - i * 0.15);
              this.triggerDrumAt(
                track.id,
                piece,
                Math.max(0.1, v),
                fireAt + spacing * i,
              );
            }
          } else {
            this.triggerDrumAt(track.id, piece, baseVel, fireAt);
          }
        } else {
          // Resolve the current voice at callback time. Sound-set replacement
          // is transactional and may publish a new instrument after this
          // event was scheduled; capturing the old object would keep firing a
          // disposed voice for the remainder of the arrangement.
          const activeVoice = this.voices.get(track.id);
          if (!activeVoice?.poly) return;
          const dur = Math.max(0.05, (ev.duration * 60) / bpm);
          if (retrigger > 1) {
            const spacing = stepSec / retrigger;
            const subDur = Math.max(0.04, spacing * 0.9);
            for (let i = 0; i < retrigger; i++) {
              const vel = baseVel * (1 - i * 0.1);
              try {
                activeVoice.poly.triggerAttackRelease(
                  ev.note,
                  subDur,
                  fireAt + spacing * i,
                  Math.max(0.1, vel),
                );
              } catch {
                // skip
              }
            }
          } else {
            try {
              activeVoice.poly.triggerAttackRelease(ev.note, dur, fireAt, baseVel);
            } catch {
              // skip
            }
          }
        }
      }, `0:${t}:0`);
      this.registerScheduledTransportEvent(id, "note-clip", track.id);
      ids.push(id);
    }
    return ids;
  }

  /** Documented v2 alias for `scheduleClip`. */
  schedulePattern(track: Track, clip: NoteClip): number[] {
    return this.scheduleClip(track, clip);
  }

  cancelScheduled(ids: number[]) {
    for (const id of ids) {
      this.clearScheduledTransportEvent(id);
    }
  }

  cancelAllProjectSchedules() {
    const ids = Array.from(this.scheduledTransportIds.entries())
      .filter(([, resource]) => resource.label === "note-clip" || resource.label === "audio-clip")
      .map(([id]) => id);
    this.cancelScheduled(ids);
    this.stopScheduledAudioPlayers(true);
  }

  cancelScheduledForTrack(trackId: string) {
    const ids = Array.from(this.scheduledTransportIds.entries())
      .filter(([, resource]) => resource.trackId === trackId)
      .map(([id]) => id);
    this.cancelScheduled(ids);
    const players = Array.from(this.audioClipResources.entries())
      .filter(([, resource]) => resource.trackId === trackId)
      .map(([player]) => player);
    this.disposeScheduledAudioPlayers(players);
  }

  disposeScheduledAudioPlayers(players: Tone.Player[]) {
    for (const player of players) {
      this.disposeScheduledAudioPlayer(player);
    }
  }

  /** Schedule a vocal audio clip via Tone.Player aligned to its start beat. */
  // ---- Phase 11: parameter override (shift-click on channel strip) ----
  private paramOverrides = new Set<string>(); // `${trackId}:${param}`

  /** Temporarily suppress automation/modulation writes for a given param so the user can manually scrub it. */
  setParamOverride(trackId: string, param: AutomationParamId, active: boolean) {
    const key = `${trackId}:${param}`;
    if (active) this.paramOverrides.add(key);
    else this.paramOverrides.delete(key);
  }

  scheduleAudioClip(
    track: Track,
    clip: {
      id: string;
      start: number;
      durationSec: number;
      offsetSec?: number;
      blob?: Blob;
      reversed?: boolean;
    },
  ): { id: number; player: Tone.Player; ready: Promise<void> } | null {
    const flags = getFirstPlayFlags();
    if (flags.disableProjectSchedules || flags.disableTransportCallbacks) {
      firstPlayMark("scheduleAudioClip:skipped", {
        trackId: track.id,
        clipId: clip.id,
        disableProjectSchedules: flags.disableProjectSchedules,
        disableTransportCallbacks: flags.disableTransportCallbacks,
      });
      return null;
    }
    const v = this.voices.get(track.id);
    if (!v || !clip.blob) return null;
    firstPlayMark("scheduleAudioClip:player-create", {
      trackId: track.id,
      clipId: clip.id,
      durationSec: clip.durationSec,
    });
    const url = URL.createObjectURL(clip.blob);
    let settleReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      settleReady = resolve;
      rejectReady = reject;
    });
    const player = new Tone.Player({
      url,
      autostart: false,
      onload: () => settleReady(),
      onerror: (error) => rejectReady(error),
    }).connect(v.channel);
    if (player.loaded) settleReady();
    trackToneCreate("scheduledPlayer", track.id);
    // Phase 11: honour the reversed flag
    if (clip.reversed) player.reverse = true;
    this.activeAudioPlayers.add(player);
    const origDispose = player.dispose.bind(player);
    let playerTraceActive = true;
    player.dispose = () => {
      this.activeAudioPlayers.delete(player);
      const resource = this.audioClipResources.get(player);
      if (resource) {
        this.audioClipResources.delete(player);
        try {
          URL.revokeObjectURL(resource.url);
        } catch {
          // ignore
        }
      }
      if (playerTraceActive) {
        playerTraceActive = false;
        trackToneDispose("scheduledPlayer", track.id);
      }
      return origDispose();
    };
    const offset = Math.max(0, clip.offsetSec ?? 0);
    const duration = Math.max(0, clip.durationSec);
    let evId = -1;
    evId = Tone.getTransport().schedule((time) => {
      firstPlayMark("transport-callback:audio-clip", {
        trackId: track.id,
        clipId: clip.id,
        audioTime: time,
      });
      try {
        player.start(time, offset, duration);
      } catch {
        // ignore
      }
    }, `0:${clip.start}:0`);
    this.registerScheduledTransportEvent(evId, "audio-clip", track.id);
    this.audioClipResources.set(player, { url, trackId: track.id, eventId: evId });
    return { id: evId, player, ready };
  }

  private registerScheduledTransportEvent(id: number, label: string, trackId?: string) {
    this.scheduledTransportIds.set(id, { label, trackId });
    trackTransportEvent(id, label);
  }

  private unregisterScheduledTransportEvent(id: number) {
    const resource = this.scheduledTransportIds.get(id);
    if (!resource) return;
    this.scheduledTransportIds.delete(id);
    untrackTransportEvent(id, resource.label);
  }

  private clearScheduledTransportEvent(id: number) {
    try {
      Tone.getTransport().clear(id);
    } catch {
      // ignore
    }
    this.unregisterScheduledTransportEvent(id);
  }

  private clearAllScheduledTransportEvents() {
    for (const id of Array.from(this.scheduledTransportIds.keys())) {
      this.clearScheduledTransportEvent(id);
    }
  }

  private clearMetronomeSchedule() {
    if (this.metronomeId === null) return;
    try {
      Tone.getTransport().clear(this.metronomeId);
    } catch {
      // ignore
    }
    untrackTransportEvent(this.metronomeId, "metronome");
    this.metronomeId = null;
  }

  private stopScheduledAudioPlayers(dispose: boolean) {
    for (const player of Array.from(this.activeAudioPlayers)) {
      try {
        player.stop();
      } catch {
        // ignore
      }
      if (dispose) this.disposeScheduledAudioPlayer(player);
    }
  }

  private disposeScheduledAudioPlayer(player: Tone.Player) {
    try {
      player.stop();
    } catch {
      // ignore
    }
    const resource = this.audioClipResources.get(player);
    if (resource) {
      this.clearScheduledTransportEvent(resource.eventId);
    }
    try {
      player.dispose();
    } catch {
      this.activeAudioPlayers.delete(player);
      if (resource) {
        this.audioClipResources.delete(player);
        try {
          URL.revokeObjectURL(resource.url);
        } catch {
          // ignore
        }
      }
    }
  }

  // ---- voice construction ----
  private rewireTrackFxChain(v: TrackVoice) {
    const maybeChain: Array<Tone.ToneAudioNode | undefined> = [
      v.filter,
      v.hpf,
      v.eq3,
      v.drive,
      v.chorus,
      v.comp,
      v.delay,
      v.bitcrusher,
      v.widener,
    ];
    const chain = maybeChain.filter((node): node is Tone.ToneAudioNode => Boolean(node));

    for (const node of chain) {
      try {
        node.disconnect();
      } catch {
        // ignore
      }
    }

    for (let i = 0; i < chain.length - 1; i++) {
      chain[i].connect(chain[i + 1]);
    }
    chain[chain.length - 1]?.connect(v.channel);
  }

  private ensureEqNodes(v: TrackVoice) {
    let changed = false;
    if (!v.hpf) {
      firstPlayMark("effect-node:create", { kind: "hpf" });
      v.hpf = new Tone.Filter({ frequency: 20, type: "highpass", rolloff: -24 });
      trackToneCreate("effectModule", "hpf");
      changed = true;
    }
    if (!v.eq3) {
      firstPlayMark("effect-node:create", { kind: "eq3" });
      v.eq3 = new Tone.EQ3({ low: 0, mid: 0, high: 0, lowFrequency: 200, highFrequency: 3200 });
      trackToneCreate("effectModule", "eq3");
      changed = true;
    }
    if (changed) this.rewireTrackFxChain(v);
  }

  private ensureDriveNode(v: TrackVoice) {
    if (v.drive) return;
    firstPlayMark("effect-node:create", { kind: "drive" });
    v.drive = new Tone.Distortion({ distortion: 0, wet: 0 });
    trackToneCreate("effectModule", "drive");
    this.rewireTrackFxChain(v);
  }

  private ensureChorusNode(v: TrackVoice) {
    if (v.chorus) return;
    firstPlayMark("effect-node:create", { kind: "chorus" });
    v.chorus = new Tone.Chorus({ frequency: 1.2, depth: 0.4, wet: 0 }).start();
    trackToneCreate("effectModule", "chorus");
    this.rewireTrackFxChain(v);
  }

  private ensureCompressorNode(v: TrackVoice) {
    if (v.comp) return;
    firstPlayMark("effect-node:create", { kind: "compressor" });
    v.comp = new Tone.Compressor({ threshold: 0, ratio: 1, attack: 0.01, release: 0.18, knee: 8 });
    trackToneCreate("effectModule", "compressor");
    this.rewireTrackFxChain(v);
  }

  private ensureBitcrusherNode(v: TrackVoice) {
    if (v.bitcrusher) return;
    firstPlayMark("effect-node:create", { kind: "bitcrusher" });
    v.bitcrusher = new Tone.BitCrusher(16);
    trackToneCreate("effectModule", "bitcrusher");
    this.rewireTrackFxChain(v);
  }

  private ensureWidenerNode(v: TrackVoice) {
    if (v.widener) return;
    firstPlayMark("effect-node:create", { kind: "widener" });
    v.widener = new Tone.StereoWidener({ width: 0.5 });
    trackToneCreate("effectModule", "widener");
    this.rewireTrackFxChain(v);
  }

  private buildVoice(
    track: Track,
    options: { attachInstrument?: boolean } = {},
  ): TrackVoice {
    const started = performance.now();
    firstPlayMark("buildVoice:enter", {
      trackId: track.id,
      kind: track.kind,
      preset: track.preset,
      kitId: track.kitId,
      presetId: track.presetId,
    });
    const untrackVoice = trackAudioResource("track-voice");
    trackToneCreate("trackVoice", `${track.kind}:${track.id}`);
    firstPlayMark("audio-node:create", { kind: "channel", trackId: track.id });
    const channel = new Tone.Channel({ volume: 0 });
    // Freeverb is an algorithmic reverb (Schroeder/Moorer) — instantaneous
    // to create unlike Tone.Reverb which generates a convolution IR buffer
    // via OfflineAudioContext and blocks the main thread for ~6-8 s per
    // instance. With 5+ tracks this was causing a 45-50 s freeze on load.
    firstPlayMark("effect-node:create", { kind: "delay", trackId: track.id });
    const delay = new Tone.FeedbackDelay({
      delayTime: "8n",
      feedback: 0.35,
      wet: 0,
    });
    firstPlayMark("effect-node:create", { kind: "filter", trackId: track.id });
    const filter = new Tone.Filter({
      frequency: 18000,
      type: "lowpass",
      rolloff: -12,
    });
    firstPlayMark("analyser-node:create", { kind: "meter", trackId: track.id });
    const meter = new Tone.Meter({ smoothing: 0.7 });
    // Default chain is intentionally lean. Optional mixer/effect nodes are
    // inserted lazily by the setters above when a real non-default setting
    // needs them; eager creation was the largest runtime click/load stall.
    filter.connect(delay);
    delay.connect(channel);
    channel.connect(this.masterChain.input);
    // post-fader meter tap
    channel.connect(meter);
    // v2 sends — one gain per named bus, tapped post-fader off the channel.
    const sends = new Map<SendBusId, Tone.Gain>();
    for (const busId of SEND_BUS_IDS) {
      firstPlayMark("audio-node:create", { kind: "send-gain", trackId: track.id, busId });
      const g = new Tone.Gain(0);
      channel.connect(g);
      const bus = this.masterChain.getBus(busId);
      if (bus) g.connect(bus.input);
      sends.set(busId, g);
    }
    const voice: TrackVoice = {
      trackId: track.id,
      channel,
      meter,
      delay,
      filter,
      sends,
      instrumentGeneration: 0,
      dispose: () => {
        voice.instrumentGeneration += 1;
        voice.presetId = undefined;
        voice.kitId = undefined;
        if (voice.poly) voice.poly.dispose();
        if (voice.drums) {
          const drums = voice.drums;
          (Object.keys(drums) as DrumPiece[]).forEach((k) =>
            drums[k].dispose(),
          );
        }
        // v2 kits hold their own piece voices, channels, sends, and FX
        // nodes — they're owned by the track and must be torn down here
        // or the audio graph leaks them when the track is removed.
        if (voice.kit) {
          try {
            voice.kit.dispose();
          } catch {
            // ignore
          }
        }
        if (voice.mic) {
          if (voice.micOn) voice.mic.close();
          voice.mic.dispose();
        }
        filter.dispose();
        if (voice.drive) {
          voice.drive.dispose();
          trackToneDispose("effectModule", "drive");
        }
        if (voice.chorus) {
          voice.chorus.dispose();
          trackToneDispose("effectModule", "chorus");
        }
        if (voice.widener) {
          voice.widener.dispose();
          trackToneDispose("effectModule", "widener");
        }
        delay.dispose();
        if (voice.hpf) {
          voice.hpf.dispose();
          trackToneDispose("effectModule", "hpf");
        }
        if (voice.eq3) {
          voice.eq3.dispose();
          trackToneDispose("effectModule", "eq3");
        }
        if (voice.comp) {
          voice.comp.dispose();
          trackToneDispose("effectModule", "compressor");
        }
        if (voice.bitcrusher) {
          voice.bitcrusher.dispose();
          trackToneDispose("effectModule", "bitcrusher");
        }
        for (const g of sends.values()) {
          try { g.dispose(); } catch { /* ignore */ }
        }
        meter.dispose();
        channel.dispose();
        trackToneDispose("trackVoice", `${track.kind}:${track.id}`);
        untrackVoice();
      },
    };
    try {
      if (options.attachInstrument !== false) this.attachInstrument(voice, track);
    } catch (error) {
      // Constructors and cross-context connections can fail independently.
      // A failed candidate must release its already-created channel, sends,
      // meters, FX, and partial instrument before the caller keeps the old
      // working voice or retries on the next user action.
      try { voice.dispose(); } catch { /* best-effort candidate cleanup */ }
      throw error;
    }
    firstPlayMeasure("buildVoice", started, performance.now(), {
      trackId: track.id,
      kind: track.kind,
    });
    return voice;
  }

  /**
   * Attach an instrument to the voice. Honors the v2 sound model first:
   *   - `track.kitId`  → build a `KitVoice` from `sounds/kits.ts`
   *   - `track.presetId` → build a melodic voice from `sounds/presets.ts`
   * Falls back to the legacy preset factories when those are unset, so
   * old projects keep working unchanged.
   */
  private attachInstrument(v: TrackVoice, track: Track) {
    const started = performance.now();
    firstPlayMark("attachInstrument:enter", {
      trackId: track.id,
      kind: track.kind,
      kitId: track.kitId,
      presetId: track.presetId,
    });
    const { kind, preset } = track;
    const target = v.filter;
    if (kind === "drums") {
      // A TrackVoice is the bounded mixer shell only. The native drum voice
      // is created by ensureLeanDrumTrack and feeds this filter; attaching a
      // full Tone kit here can create thousands of permanent AudioParams.
      v.kitId = track.kitId ?? (
        preset === "acoustic"
          ? "garageband"
          : preset === "electronic"
            ? "cyberpunk"
            : "trap"
      );
      firstPlayMark("instrument-factory:native-drum-shell", {
        trackId: track.id,
        kitId: v.kitId,
      });
      firstPlayMeasure("attachInstrument", started, performance.now(), {
        trackId: track.id,
        kind,
      });
      return;
    }
    if (kind === "vocals") {
      this.applyVocalPresetSettings(v, preset as VocalsPreset);
      firstPlayMeasure("attachInstrument", started, performance.now(), {
        trackId: track.id,
        kind,
      });
      return;
    }
    // melodic — v2 preset id wins.
    if (track.presetId) {
      const def = findPreset(track.presetId);
      if (def) {
        firstPlayMark("instrument-factory:buildPresetVoice", {
          trackId: track.id,
          presetId: track.presetId,
        });
        v.presetId = track.presetId;
        const poly = buildPresetVoice(def);
        v.poly = poly;
        poly.connect(target);
        announceSamplerLoadIfNeeded(poly);
        this.maybeAttachMelodicSampler(v, def, track.presetId);
        firstPlayMeasure("attachInstrument", started, performance.now(), {
          trackId: track.id,
          kind,
        });
        return;
      }
    }
    firstPlayMark("instrument-factory:buildMelodicVoice", {
      trackId: track.id,
      kind,
      preset,
    });
    const poly = buildMelodicVoice(kind, preset);
    if (poly) {
      v.poly = poly;
      poly.connect(target);
      if (kind === "piano") announceSamplerLoadIfNeeded(poly);
    }
    firstPlayMeasure("attachInstrument", started, performance.now(), {
      trackId: track.id,
      kind,
    });
  }
}

export const audio = new AudioEngine();

function clampDb(x: number): number {
  return Math.max(-18, Math.min(18, x));
}

/** Evaluate a sorted array of breakpoints at `beat` using the given interpolation mode. */
export function evalBreakpoints(
  breakpoints: { beat: number; value: number }[],
  beat: number,
  interpolation: AutomationInterpolation,
): number {
  if (breakpoints.length === 0) return 0.5;
  const sorted = [...breakpoints].sort((a, b) => a.beat - b.beat);
  if (beat <= sorted[0].beat) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (beat >= last.beat) return last.value;

  let lo = sorted[0];
  let hi = last;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].beat <= beat && sorted[i + 1].beat >= beat) {
      lo = sorted[i];
      hi = sorted[i + 1];
      break;
    }
  }

  const span = hi.beat - lo.beat;
  if (span <= 0) return lo.value;
  const t = (beat - lo.beat) / span;

  if (interpolation === "smooth") {
    // Cubic smoothstep
    const s = t * t * (3 - 2 * t);
    return lo.value + (hi.value - lo.value) * s;
  }
  return lo.value + (hi.value - lo.value) * t;
}
