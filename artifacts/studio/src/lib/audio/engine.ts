import * as Tone from "tone";
import type {
  AnyPreset,
  AutomationInterpolation,
  AutomationLane,
  AutomationParamId,
  DrumKitId,
  DrumPieceSettings,
  FxModuleId,
  FxModuleSettings,
  GrooveSettings,
  InstrumentKind,
  MasterBusSettings,
  ModulationRouting,
  ModulationSource,
  NoteClip,
  SendBusId,
  SoundParams,
  Track,
  TrackEq,
  VocalsPreset,
} from "../../types";
import { SEND_BUS_IDS } from "../../types";
import { MasterChain } from "./master";
import { workletManager } from "./worklet-manager";
import {
  getWorkletPlayerEnabled,
  setWorkletPlayerEnabled,
} from "./worklet-sample-player";
import { lookaheadScheduler } from "./lookahead-scheduler";
import {
  announceSamplerLoadIfNeeded,
  applyVocalPresetTo,
  buildDrumKit,
  buildMelodicVoice,
  releaseAllNotes,
  type DrumKit,
  type DrumPiece,
  type MelodicVoice,
} from "./voices";
import { buildKit, cutoffNormToHz, findKit, type KitVoice } from "./sounds/kits";
import { buildPresetVoice, findPreset } from "./sounds/presets";
import { tryLoadMelodicSampler } from "./sounds/samples";
import { applyGroove, getGroove, shouldFlam, shouldGhost } from "./sounds/groove";
import { getChopEngine } from "./chopEngine";
import {
  startPerfTimer,
  trackAudioResource,
  trackTransportEvent,
  untrackTransportEvent,
} from "../../utils/performanceDiagnostics";

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
  channel: Tone.Channel;
  meter: Tone.Meter;
  reverb: Tone.Freeverb;
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
  mic?: Tone.UserMedia;
  micOn?: boolean;
  dispose: () => void;
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

  private voices = new Map<string, TrackVoice>();

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
  private noteEverPlayed = false;

  private firstQwertyShown = false;
  private firstMidiShown = false;
  /** Track id that currently has the Chop Lab kit active as its drum voice. */
  private chopKitTrackId: string | null = null;

  constructor() {
    const globalKey = "__SN_STUDIO_AUDIO_ENGINE_ACTIVE__";
    const scope = globalThis as typeof globalThis & Record<string, boolean | undefined>;
    if (scope[globalKey] && import.meta.env.DEV) {
      console.warn("[AudioEngine] Duplicate AudioEngine construction detected; retaining singleton export.");
    }
    scope[globalKey] = true;

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
    if (this.unlocked) return;
    const endInit = startPerfTimer("audio-engine-init");
    try {
      await Tone.start();

      // Phase 6: register AudioWorklet processors then wire them into the master chain.
      try {
        const toneCtx = Tone.getContext();
        const rawCtx = toneCtx.rawContext as AudioContext;
        await workletManager.register(toneCtx as unknown as AudioContext);
        this.masterChain.initWorklets();

        // Create the MetronomeProcessor node on the audio thread.
        if (workletManager.ready) {
          const node = workletManager.createNode("metronome", toneCtx as unknown as AudioContext);
          if (node) {
            // Bridge the AudioWorkletNode (native) to the Tone.js metronomeGain node.
            const gainAny = this.metronomeGain as unknown as { input?: AudioNode };
            if (gainAny.input instanceof AudioNode) {
              node.connect(gainAny.input);
            } else {
              // Fallback: connect to Tone destination directly (lower precedence than master chain).
              node.connect(rawCtx.destination);
            }
            this.metronomeWorkletNode = node;
          }
        }
      } catch (err) {
        console.warn("[AudioEngine] Worklet init failed — Tone.js fallback active.", err);
      }

      // Phase 6: start the lookahead scheduler.
      lookaheadScheduler.start();

      this.unlocked = true;
    } finally {
      endInit();
    }
  }

  /** Alias for `unlock()` — part of the documented v2 facade surface. */
  async initAudio() {
    return this.unlock();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
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
    try {
      this.masterAnalyser?.dispose();
    } catch {
      // ignore
    }
    this.masterAnalyser = null;
    this.masterAnalyserSize = 0;
    try {
      this.metronomeWorkletNode?.disconnect();
    } catch {
      // ignore
    }
    this.metronomeWorkletNode = null;
    lookaheadScheduler.cancelAll();
    lookaheadScheduler.stop();
    try {
      this.metronomeSynth.dispose();
      this.metronomeAccent.dispose();
      this.metronomeGain.dispose();
      this.masterChain.dispose();
      workletManager.dispose();
    } catch {
      // ignore
    }
    this.unlocked = false;
    this.playbackState = "stopped";
    (globalThis as typeof globalThis & Record<string, boolean | undefined>).__SN_STUDIO_AUDIO_ENGINE_ACTIVE__ = false;
  }

  /** Resolves once all Tone-managed buffers (samplers etc.) finish loading. */
  whenSamplesReady(): Promise<void> {
    return Tone.loaded();
  }

  // ---- master ----

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
    const boundedSize = Math.max(32, Math.min(2048, size));
    if (!this.masterAnalyser || this.masterAnalyserSize !== boundedSize) {
      if (this.masterAnalyser) {
        try {
          this.masterAnalyser.dispose();
        } catch {
          // ignore analyser disposal races
        }
      }
      const a = new Tone.Analyser("waveform", boundedSize);
      // tap the post-master signal so the scope reflects what the user
      // actually hears (post FX, post limiter)
      this.masterChain.input.connect(a);
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
    const v = this.voices.get(trackId);
    if (!v) return;
    const wantsEq =
      eq.hpfOn === true ||
      typeof eq.hpfHz === "number" ||
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
    const v = this.voices.get(trackId);
    if (!v) return;
    const enabled = settings.enabled !== false;
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
        if (v.reverb) v.reverb.wet.rampTo(enabled ? amount : 0, 0.05);
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

  play() {
    if (this.noAudio) return;
    if (this.playbackState === "starting" || this.playbackState === "playing") return;
    // Releasing any held panic mute is a no-op when no panic is active,
    // so this is safe to call on every play.
    this.playbackState = "starting";
    try {
      this.masterChain.releasePanicHold();
      if (this.metronomeEnabled && this.metronomeId === null) {
        this.setMetronome(true);
      }
      this.ensureAutomationScheduler();
      const transport = Tone.getTransport();
      if (transport.state !== "started") {
        transport.start();
      }
      this.playbackState = "playing";
    } catch (err) {
      this.playbackState = "error";
      throw err;
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
    try {
      Tone.getTransport().stop();
      Tone.getTransport().position = 0;
      this.stopScheduledAudioPlayers(false);
      for (const v of this.voices.values()) {
        releaseAllNotes(v.poly);
      }
      this.playbackState = "stopped";
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
    const transport = Tone.getTransport();
    this.playbackState = "stopping";
    try {
      transport.stop();
      transport.position = 0;
      this.clearAllScheduledTransportEvents();
      this.clearMetronomeSchedule();
      this.stopAutomationScheduler();
      this.stopScheduledAudioPlayers(true);
      for (const v of this.voices.values()) {
        releaseAllNotes(v.poly);
        if (v.mic && v.micOn) {
          try {
            v.mic.close();
          } catch {
            // ignore
          }
          v.micOn = false;
        }
      }

      // Phase 6: clear any queued worklet metronome clicks and lookahead events.
      if (this.metronomeWorkletNode) {
        workletManager.postMessage(this.metronomeWorkletNode, { type: "clear" });
      }
      lookaheadScheduler.cancelAll();

      this.masterChain.duckForPanic();
      this.playbackState = "stopped";
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
    this.metronomeGain.gain.rampTo(lin, 0.003);
  }

  setMetronome(on: boolean) {
    this.metronomeEnabled = on;
    if (!on) {
      // Explicitly remove the repeating Transport event so it stops consuming
      // scheduling CPU instead of just being silenced by the boolean guard.
      this.clearMetronomeSchedule();
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
    let count = 0;
    for (const v of this.voices.values()) {
      if (v.poly || v.drums || v.kit) count++;
    }
    return count;
  }

  /**
   * Expose whether AudioWorklets are active (for the diagnostics panel).
   * Mirrors workletManager.ready.
   */
  getWorkletStatus(): { ready: boolean; fallback: boolean } {
    return { ready: workletManager.ready, fallback: workletManager.fallback };
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
  ensureTrack(track: Track) {
    if (this.noAudio) return;
    let v = this.voices.get(track.id);
    if (!v) {
      v = this.buildVoice(track);
      this.voices.set(track.id, v);
    } else {
      // Rebuild instrument when v2 sound-model selectors change.
      const wantKit = track.kitId;
      const wantPreset = track.presetId;
      if (track.kind === "drums" && wantKit && v.kitId !== wantKit) {
        this.setKit(track.id, wantKit);
      } else if (
        track.kind !== "drums" &&
        track.kind !== "vocals" &&
        wantPreset &&
        v.presetId !== wantPreset
      ) {
        this.setMelodicPreset(track.id, wantPreset);
      }
    }
    this.applyTrackSettings(track);
    // v2: re-apply per-track sound params and per-piece mixer overrides
    // so the engine state matches the latest track snapshot.
    if (track.sound) this.setSoundParams(track.id, track.sound);
    if (track.kitId && track.pieceSettings) {
      // Pass the full settings map on every call so kit-wide solo
      // arbitration sees the complete picture during rehydration —
      // otherwise the last piece written wins and stored mute/solo
      // state can be lost.
      for (const [piece, partial] of Object.entries(track.pieceSettings)) {
        if (partial) {
          this.setPieceSetting(
            track.id,
            piece as DrumPiece,
            partial,
            track.pieceSettings,
          );
        }
      }
    }
  }

  removeTrack(trackId: string) {
    this.cancelScheduledForTrack(trackId);
    this.removeTrackAutomation(trackId);
    for (const key of Array.from(this.paramOverrides)) {
      if (key.startsWith(`${trackId}:`)) this.paramOverrides.delete(key);
    }
    const v = this.voices.get(trackId);
    if (!v) return;
    v.dispose();
    this.voices.delete(trackId);
    this.soloSet.delete(trackId);
  }

  getActiveTrackIds(): string[] {
    return Array.from(this.voices.keys());
  }

  /** Tear down every voice — used when swapping in a fresh project
   * (e.g. loading a demo) so we don't leak instruments or accumulate
   * stale voice ids in the engine. */
  disposeAllTracks() {
    if (this.noAudio) return;
    this.cancelAllProjectSchedules();
    for (const id of Array.from(this.voices.keys())) {
      this.removeTrack(id);
    }
    this.soloSet.clear();
  }

  removeAllTracksExcept(trackIds: readonly string[]) {
    if (this.noAudio) return;
    const keep = new Set(trackIds);
    for (const id of Array.from(this.voices.keys())) {
      if (!keep.has(id)) this.removeTrack(id);
    }
  }

  applyTrackSettings(track: Track) {
    const v = this.voices.get(track.id);
    if (!v) return;
    if (track.solo) this.soloSet.add(track.id);
    else this.soloSet.delete(track.id);

    const anySolo = this.soloSet.size > 0;
    const audible = !track.muted && (!anySolo || track.solo);
    const db = audible
      ? track.volume <= 0.005
        ? -60
        : 20 * Math.log10(track.volume)
      : -Infinity;
    v.channel.volume.rampTo(db, 0.05);
    v.channel.pan.rampTo(track.pan, 0.05);

    v.reverb.wet.rampTo(track.fx.reverb, 0.05);
    v.delay.wet.rampTo(track.fx.delay, 0.05);
    const cutoff = 200 + track.fx.filter ** 2 * 17800;
    v.filter.frequency.rampTo(cutoff, 0.05);
  }

  refreshAllMutes(tracks: Track[]) {
    for (const t of tracks) this.applyTrackSettings(t);
  }

  changePreset(track: Track) {
    const v = this.voices.get(track.id);
    if (!v) return;
    const endTiming = startPerfTimer("instrument-replacement", {
      trackId: track.id,
      kind: track.kind,
    });
    this.disposeInstrument(v);
    this.attachInstrument(v, track);
    endTiming();
  }

  // ---- v2 sound-model methods ----

  /** Switch this track to a named v2 drum kit, rebuilding pieces. */
  setKit(trackId: string, kitId: DrumKitId) {
    const v = this.voices.get(trackId);
    if (!v) return;
    if (v.kitId === kitId && v.kit) return;
    const endTiming = startPerfTimer("kit-switch", { trackId, kitId });
    this.disposeInstrument(v);
    v.kitId = kitId;
    const def = findKit(kitId);
    v.kit = buildKit(def, v.filter, v.reverb, v.delay);
    endTiming();
  }

  /** Switch this track to a named v2 melodic preset, rebuilding the voice. */
  setMelodicPreset(trackId: string, presetId: string) {
    const v = this.voices.get(trackId);
    if (!v) return;
    if (v.presetId === presetId && v.poly) return;
    const def = findPreset(presetId);
    if (!def) return;
    const endTiming = startPerfTimer("instrument-replacement", { trackId, presetId });
    this.disposeInstrument(v);
    v.presetId = presetId;
    const poly = buildPresetVoice(def);
    v.poly = poly;
    poly.connect(v.filter);
    announceSamplerLoadIfNeeded(poly);
    // Apply preset's send defaults as a starting point so the user hears
    // the intended character without further tweaking.
    v.reverb.wet.rampTo(def.synth.reverbSend, 0.05);
    v.delay.wet.rampTo(def.synth.delaySend, 0.05);
    this.maybeAttachMelodicSampler(v, def, presetId);
    endTiming();
  }

  /**
   * Probe the preset's sample layers in the background. If at least one
   * layer is reachable, hot-swap the active voice from the synth fallback
   * to the loaded Tone.Sampler — disposing the old voice and connecting
   * the sampler into the existing track chain. Guarded by `presetId` so
   * a preset change mid-load doesn't cross-wire voices.
   */
  private maybeAttachMelodicSampler(
    v: TrackVoice,
    def: ReturnType<typeof findPreset>,
    presetId: string,
  ) {
    if (!def) return;
    const r = def.synth;
    void tryLoadMelodicSampler(def.layers, {
      release: Math.max(0.1, r.release * 2),
      attack: Math.max(0, r.attack * 0.4),
      volume: -8,
    }).then((sampler) => {
      if (!sampler) return;
      // User may have swapped presets, removed the track, or the engine
      // may already have a sampler attached (e.g. duplicate probe).
      if (v.presetId !== presetId) {
        try { sampler.dispose(); } catch { /* ignore */ }
        return;
      }
      if (v.poly instanceof Tone.Sampler) {
        try { sampler.dispose(); } catch { /* ignore */ }
        return;
      }
      try {
        const old = v.poly;
        v.poly = sampler;
        sampler.connect(v.filter);
        if (old) {
          try {
            (old as unknown as { releaseAll?: () => void }).releaseAll?.();
          } catch { /* ignore */ }
          try { old.dispose(); } catch { /* ignore */ }
        }
      } catch {
        // ignore — best effort swap
      }
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
    const v = this.voices.get(trackId);
    if (!v) return;
    if (partial.cutoff !== undefined) {
      v.filter.frequency.rampTo(cutoffNormToHz(partial.cutoff), 0.05);
    }
    if (partial.reverbSend !== undefined) {
      v.reverb.wet.rampTo(Math.max(0, Math.min(1, partial.reverbSend)), 0.05);
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
    if (lanes.length === 0) {
      this.trackAutomationData.delete(trackId);
    } else {
      this.trackAutomationData.set(trackId, lanes);
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
      if (!voice) continue;
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
        this.applyAutomationParam(voice, lane.param, value);
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
          v.reverb.wet.linearRampToValueAtTime(value, rampEnd);
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

  /** Trigger one note from a melodic preset preview (used by the browser UI). */
  previewPresetNote(presetId: string, note = "C4", durationSec = 0.6) {
    const def = findPreset(presetId);
    if (!def) return;
    // Build a one-shot preview voice on the master bus so it doesn't
    // disturb any track's settings. Disposed shortly after the note.
    const voice = buildPresetVoice(def);
    voice.connect(this.masterChain.input);
    try {
      voice.triggerAttackRelease(note, durationSec, undefined, 0.85);
    } catch {
      // ignore — preset preview is best-effort
    }
    // Dispose after note + tail.
    window.setTimeout(() => {
      try {
        voice.dispose();
      } catch {
        // ignore
      }
    }, Math.ceil((durationSec + 2.0) * 1000));
  }

  /** Internal: dispose whichever instrument(s) are attached. */
  private disposeInstrument(v: TrackVoice) {
    if (v.poly) {
      try {
        releaseAllNotes(v.poly);
        (v.poly as unknown as { disconnect?: () => void }).disconnect?.();
      } catch {
        // ignore
      }
      try {
        v.poly.dispose();
      } catch {
        // ignore
      }
      v.poly = undefined;
    }
    if (v.drums) {
      const drums = v.drums;
      (Object.keys(drums) as DrumPiece[]).forEach((k) => drums[k].dispose());
      v.drums = undefined;
    }
    if (v.kit) {
      try {
        v.kit.dispose();
      } catch {
        // ignore
      }
      v.kit = undefined;
    }
    v.presetId = undefined;
    v.kitId = undefined;
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
    const v = this.voices.get(trackId);
    if (!v?.poly) return;
    try {
      v.poly.triggerAttackRelease(note, durationSec, undefined, velocity);
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
    const v = this.voices.get(trackId);
    if (!v?.poly) return;
    try {
      (v.poly as Tone.PolySynth).triggerAttack(note, undefined, velocity);
      if (source) this.notifyFirstNote(source);
      else this.noteEverPlayed = true;
    } catch {
      // ignore
    }
  }

  endNote(trackId: string, note: string) {
    const v = this.voices.get(trackId);
    if (!v?.poly) return;
    try {
      (v.poly as Tone.PolySynth).triggerRelease(note);
    } catch {
      // ignore
    }
  }

  /** Map drum piece names to Chop Lab slice indices (for "Use as Kit"). */
  private static readonly PIECE_TO_SLICE_INDEX: Partial<Record<DrumPiece, number>> = {
    kick: 0, snare: 1, hat: 2, ohat: 3, clap: 4,
    tomLow: 5, tomHigh: 6, crash: 7, fx: 8,
  };

  /** Activate/deactivate the Chop Lab kit for a track. When active, drum
   *  triggers are routed to the ChopEngine instead of the synthesized voices. */
  setChopKitForTrack(trackId: string | null) {
    this.chopKitTrackId = trackId;
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
    // Chop Lab "Use as Kit" routing: redirect to ChopEngine slices.
    if (this.chopKitTrackId === trackId) {
      const sliceIndex = AudioEngine.PIECE_TO_SLICE_INDEX[piece] ?? 0;
      getChopEngine().triggerSlice(sliceIndex, time);
      this.noteEverPlayed = true;
      return;
    }

    const v = this.voices.get(trackId);
    if (!v) return;
    const t = time ?? Tone.now();
    try {
      // v2 kit wins when present (the new sound model).
      if (v.kit) {
        const pv = v.kit.pieces.get(piece);
        if (pv) {
          pv.trigger(t, velocity);
          this.noteEverPlayed = true;
        }
        return;
      }
      if (v.drums) {
        const inst = v.drums[piece];
        if (inst) {
          inst.trigger(t, velocity);
          this.noteEverPlayed = true;
        }
      }
    } catch {
      // ignore
    }
  }

  // ---- vocals ----
  async startVocalMonitor(trackId: string, deviceId?: string) {
    const v = this.voices.get(trackId);
    if (!v?.mic) return;
    try {
      if (deviceId) await v.mic.open(deviceId);
      else await v.mic.open();
      v.micOn = true;
    } catch (err) {
      v.micOn = false;
      throw err;
    }
  }
  stopVocalMonitor(trackId: string) {
    const v = this.voices.get(trackId);
    if (!v?.mic) return;
    if (v.micOn) {
      v.mic.close();
      v.micOn = false;
    }
  }
  getMic(trackId: string) {
    return this.voices.get(trackId)?.mic;
  }

  /** Returns the post-fader Tone.Meter for a track, if it exists. */
  getTrackMeter(trackId: string): Tone.Meter | undefined {
    return this.voices.get(trackId)?.meter;
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
    const v = this.voices.get(track.id);
    if (!v) return ids;
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
        } else if (v.poly) {
          const dur = Math.max(0.05, (ev.duration * 60) / bpm);
          if (retrigger > 1) {
            const spacing = stepSec / retrigger;
            const subDur = Math.max(0.04, spacing * 0.9);
            for (let i = 0; i < retrigger; i++) {
              const vel = baseVel * (1 - i * 0.1);
              try {
                v.poly.triggerAttackRelease(
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
              v.poly.triggerAttackRelease(ev.note, dur, fireAt, baseVel);
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
  ): { id: number; player: Tone.Player } | null {
    const v = this.voices.get(track.id);
    if (!v || !clip.blob) return null;
    const url = URL.createObjectURL(clip.blob);
    const player = new Tone.Player(url).connect(v.channel);
    player.autostart = false;
    // Phase 11: honour the reversed flag
    if (clip.reversed) player.reverse = true;
    this.activeAudioPlayers.add(player);
    const origDispose = player.dispose.bind(player);
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
      return origDispose();
    };
    const offset = Math.max(0, clip.offsetSec ?? 0);
    const duration = Math.max(0, clip.durationSec);
    let evId = -1;
    evId = Tone.getTransport().schedule((time) => {
      try {
        player.start(time, offset, duration);
      } catch {
        // ignore
      }
    }, `0:${clip.start}:0`);
    this.registerScheduledTransportEvent(evId, "audio-clip", track.id);
    this.audioClipResources.set(player, { url, trackId: track.id, eventId: evId });
    return { id: evId, player };
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
      v.reverb,
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
      v.hpf = new Tone.Filter({ frequency: 20, type: "highpass", rolloff: -24 });
      changed = true;
    }
    if (!v.eq3) {
      v.eq3 = new Tone.EQ3({ low: 0, mid: 0, high: 0, lowFrequency: 200, highFrequency: 3200 });
      changed = true;
    }
    if (changed) this.rewireTrackFxChain(v);
  }

  private ensureDriveNode(v: TrackVoice) {
    if (v.drive) return;
    v.drive = new Tone.Distortion({ distortion: 0, wet: 0 });
    this.rewireTrackFxChain(v);
  }

  private ensureChorusNode(v: TrackVoice) {
    if (v.chorus) return;
    v.chorus = new Tone.Chorus({ frequency: 1.2, depth: 0.4, wet: 0 }).start();
    this.rewireTrackFxChain(v);
  }

  private ensureCompressorNode(v: TrackVoice) {
    if (v.comp) return;
    v.comp = new Tone.Compressor({ threshold: 0, ratio: 1, attack: 0.01, release: 0.18, knee: 8 });
    this.rewireTrackFxChain(v);
  }

  private ensureBitcrusherNode(v: TrackVoice) {
    if (v.bitcrusher) return;
    v.bitcrusher = new Tone.BitCrusher(16);
    this.rewireTrackFxChain(v);
  }

  private ensureWidenerNode(v: TrackVoice) {
    if (v.widener) return;
    v.widener = new Tone.StereoWidener({ width: 0.5 });
    this.rewireTrackFxChain(v);
  }

  private buildVoice(track: Track): TrackVoice {
    const untrackVoice = trackAudioResource("track-voice");
    const channel = new Tone.Channel({ volume: 0 });
    // Freeverb is an algorithmic reverb (Schroeder/Moorer) — instantaneous
    // to create unlike Tone.Reverb which generates a convolution IR buffer
    // via OfflineAudioContext and blocks the main thread for ~6-8 s per
    // instance. With 5+ tracks this was causing a 45-50 s freeze on load.
    const reverb = new Tone.Freeverb({ roomSize: 0.65, dampening: 3000, wet: 0 });
    const delay = new Tone.FeedbackDelay({
      delayTime: "8n",
      feedback: 0.35,
      wet: 0,
    });
    const filter = new Tone.Filter({
      frequency: 18000,
      type: "lowpass",
      rolloff: -12,
    });
    const meter = new Tone.Meter({ smoothing: 0.7 });
    // Default chain is intentionally lean. Optional mixer/effect nodes are
    // inserted lazily by the setters above when a real non-default setting
    // needs them; eager creation was the largest runtime click/load stall.
    delay.connect(reverb);
    filter.connect(delay);
    reverb.connect(channel);
    channel.connect(this.masterChain.input);
    // post-fader meter tap
    channel.connect(meter);
    // v2 sends — one gain per named bus, tapped post-fader off the channel.
    const sends = new Map<SendBusId, Tone.Gain>();
    for (const busId of SEND_BUS_IDS) {
      const g = new Tone.Gain(0);
      channel.connect(g);
      const bus = this.masterChain.getBus(busId);
      if (bus) g.connect(bus.input);
      sends.set(busId, g);
    }
    const voice: TrackVoice = {
      channel,
      meter,
      reverb,
      delay,
      filter,
      sends,
      dispose: () => {
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
        voice.drive?.dispose();
        voice.chorus?.dispose();
        voice.widener?.dispose();
        delay.dispose();
        reverb.dispose();
        voice.hpf?.dispose();
        voice.eq3?.dispose();
        voice.comp?.dispose();
        voice.bitcrusher?.dispose();
        for (const g of sends.values()) {
          try { g.dispose(); } catch { /* ignore */ }
        }
        meter.dispose();
        channel.dispose();
        untrackVoice();
      },
    };
    this.attachInstrument(voice, track);
    if (track.kind === "vocals") {
      voice.mic = new Tone.UserMedia();
      voice.mic.connect(filter);
    }
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
    const { kind, preset } = track;
    const target = v.filter;
    if (kind === "drums") {
      if (track.kitId) {
        v.kitId = track.kitId;
        v.kit = buildKit(findKit(track.kitId), target, v.reverb, v.delay);
      } else {
        const drums = buildDrumKit(preset as import("../../types").DrumsPreset);
        v.drums = drums;
        (Object.keys(drums) as DrumPiece[]).forEach((k) =>
          drums[k].connect(target),
        );
      }
      return;
    }
    if (kind === "vocals") {
      applyVocalPresetTo(
        { reverb: v.reverb, delay: v.delay, filter: v.filter },
        preset as VocalsPreset,
      );
      return;
    }
    // melodic — v2 preset id wins.
    if (track.presetId) {
      const def = findPreset(track.presetId);
      if (def) {
        v.presetId = track.presetId;
        const poly = buildPresetVoice(def);
        v.poly = poly;
        poly.connect(target);
        announceSamplerLoadIfNeeded(poly);
        this.maybeAttachMelodicSampler(v, def, track.presetId);
        return;
      }
    }
    const poly = buildMelodicVoice(kind, preset);
    if (poly) {
      v.poly = poly;
      poly.connect(target);
      if (kind === "piano") announceSamplerLoadIfNeeded(poly);
    }
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
