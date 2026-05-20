import * as Tone from "tone";
import type {
  AnyPreset,
  DrumKitId,
  DrumPieceSettings,
  FxModuleId,
  FxModuleSettings,
  GrooveSettings,
  InstrumentKind,
  MasterBusSettings,
  NoteClip,
  SendBusId,
  SoundParams,
  Track,
  TrackEq,
  VocalsPreset,
} from "../../types";
import { SEND_BUS_IDS } from "../../types";
import { MasterChain } from "./master";
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
  reverb: Tone.Reverb;
  delay: Tone.FeedbackDelay;
  filter: Tone.Filter;
  /** v2 sound-shaping nodes inserted in the per-track chain after the
   *  filter so per-voice sound params (drive, chorus, width) are
   *  audible without rebuilding the voice. Wet defaults to 0 (bypass). */
  drive?: Tone.Distortion;
  chorus?: Tone.Chorus;
  widener?: Tone.StereoWidener;
  /** v2 mixer nodes: high-pass + 3-band EQ inserted between filter and
   *  drive; compressor + bitcrusher inserted later in the chain. */
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

class AudioEngine {
  private masterChain = new MasterChain();
  private metronomeSynth: Tone.MembraneSynth;
  private metronomeAccent: Tone.MembraneSynth;

  private voices = new Map<string, TrackVoice>();
  /** Project-wide default groove merged under per-track overrides at
   *  schedule time. `undefined` means "no global humanization". */
  private globalGroove?: Partial<GrooveSettings>;
  /**
   * All Tone.Player instances scheduled for transport-aligned audio
   * clips. Kept here so `panicStopAll()` can hard-stop in-flight audio
   * playback regardless of which UI module scheduled it.
   */
  private activeAudioPlayers = new Set<Tone.Player>();
  private metronomeId: number | null = null;
  private metronomeEnabled = false;
  private soloSet = new Set<string>();
  unlocked = false;
  private noteEverPlayed = false;

  private firstQwertyShown = false;
  private firstMidiShown = false;

  constructor() {
    Tone.getTransport().bpm.value = 100;
    Tone.getTransport().timeSignature = [4, 4];

    this.metronomeSynth = new Tone.MembraneSynth({
      pitchDecay: 0.008,
      octaves: 2,
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
    }).connect(this.masterChain.input);
    this.metronomeAccent = new Tone.MembraneSynth({
      pitchDecay: 0.008,
      octaves: 4,
      envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
    }).connect(this.masterChain.input);
  }

  // ---- lifecycle ----

  /**
   * Resume the underlying AudioContext. Browsers block audio until the
   * user has interacted with the page; the UI's "Tap to Enable Audio"
   * button is what calls this. Safe to call repeatedly.
   */
  async unlock() {
    if (this.unlocked) return;
    await Tone.start();
    this.unlocked = true;
  }

  /** Alias for `unlock()` — part of the documented v2 facade surface. */
  async initAudio() {
    return this.unlock();
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
  getMasterAnalyser(): Tone.Analyser {
    if (!this.masterAnalyser) {
      const a = new Tone.Analyser("waveform", 256);
      // tap the post-master signal so the scope reflects what the user
      // actually hears (post FX, post limiter)
      this.masterChain.input.connect(a);
      this.masterAnalyser = a;
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
        if (v.chorus) {
          v.chorus.depth = enabled ? 0.2 + 0.6 * amount : 0;
          v.chorus.wet.rampTo(enabled ? amount : 0, 0.05);
        }
        return;
      case "bitcrusher":
        if (v.bitcrusher) {
          const bits = enabled
            ? Math.max(2, Math.round(16 - 14 * (typeof params.bits === "number" ? params.bits : amount)))
            : 16;
          v.bitcrusher.bits.value = bits;
        }
        return;
      case "stereoWidth":
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

  play() {
    // Releasing any held panic mute is a no-op when no panic is active,
    // so this is safe to call on every play.
    this.masterChain.releasePanicHold();
    Tone.getTransport().start();
  }
  pause() {
    Tone.getTransport().pause();
  }
  /**
   * Stop transport and reliably release any sustained notes (keyboard,
   * sequenced, drums). Reverb/delay tails decay naturally on their own
   * — for a hard cut (e.g. user-initiated panic) use `panicStopAll()`.
   */
  stop() {
    Tone.getTransport().stop();
    Tone.getTransport().position = 0;
    for (const v of this.voices.values()) {
      releaseAllNotes(v.poly);
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
   * Hard kill: stop the transport, release every sustained note, dip
   * the master to silence reverb/delay tails, and stop any live mic
   * monitoring. Bound to the red Panic button.
   *
   * Intentionally does NOT call Transport.cancel() — clip and metronome
   * schedules registered by useTransport / setMetronome must survive
   * panic so the next Play resumes correctly without forcing a
   * reschedule.
   */
  panicStopAll() {
    // Intentionally does NOT call Transport.cancel() — clip and
    // metronome schedules were registered by useTransport / setMetronome
    // and must survive a panic so the next Play resumes correctly
    // without forcing a reschedule.
    const transport = Tone.getTransport();
    transport.stop();
    transport.position = 0;
    // Hard-stop every in-flight scheduled audio clip player so a panic
    // is a true kill for vocal/audio clips, not just for synth tails.
    for (const p of this.activeAudioPlayers) {
      try {
        p.stop();
      } catch {
        // ignore
      }
    }
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
    this.masterChain.duckForPanic();
  }

  // ---- metronome ----
  setMetronome(on: boolean) {
    this.metronomeEnabled = on;
    if (on && this.metronomeId === null) {
      let beat = 0;
      this.metronomeId = Tone.getTransport().scheduleRepeat((time) => {
        if (!this.metronomeEnabled) return;
        if (beat % 4 === 0) {
          this.metronomeAccent.triggerAttackRelease("C5", "32n", time);
        } else {
          this.metronomeSynth.triggerAttackRelease("C4", "32n", time);
        }
        beat++;
      }, "4n");
    }
  }
  isMetronomeOn() {
    return this.metronomeEnabled;
  }

  // ---- tracks ----
  ensureTrack(track: Track) {
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
    const v = this.voices.get(trackId);
    if (!v) return;
    v.dispose();
    this.voices.delete(trackId);
    this.soloSet.delete(trackId);
  }

  /** Tear down every voice — used when swapping in a fresh project
   * (e.g. loading a demo) so we don't leak instruments or accumulate
   * stale voice ids in the engine. */
  disposeAllTracks() {
    for (const id of Array.from(this.voices.keys())) {
      this.removeTrack(id);
    }
    this.soloSet.clear();
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
    this.disposeInstrument(v);
    this.attachInstrument(v, track);
  }

  // ---- v2 sound-model methods ----

  /** Switch this track to a named v2 drum kit, rebuilding pieces. */
  setKit(trackId: string, kitId: DrumKitId) {
    const v = this.voices.get(trackId);
    if (!v) return;
    if (v.kitId === kitId && v.kit) return;
    this.disposeInstrument(v);
    v.kitId = kitId;
    const def = findKit(kitId);
    v.kit = buildKit(def, v.filter, v.reverb, v.delay);
  }

  /** Switch this track to a named v2 melodic preset, rebuilding the voice. */
  setMelodicPreset(trackId: string, presetId: string) {
    const v = this.voices.get(trackId);
    if (!v) return;
    if (v.presetId === presetId && v.poly) return;
    const def = findPreset(presetId);
    if (!def) return;
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
    if (partial.drive !== undefined && v.drive) {
      const d = Math.max(0, Math.min(1, partial.drive));
      v.drive.distortion = d * 0.9;
      v.drive.wet.rampTo(d > 0 ? Math.min(1, d * 2) : 0, 0.05);
    }
    if (partial.chorusSend !== undefined && v.chorus) {
      v.chorus.wet.rampTo(Math.max(0, Math.min(1, partial.chorusSend)), 0.05);
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
      v.kit.dispose();
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
      if (ev.time < 0 || ev.time >= clip.length) continue;
      const t = startBeats + ev.time;
      const id = Tone.getTransport().schedule((time) => {
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
      ids.push(id);
    }
    return ids;
  }

  /** Documented v2 alias for `scheduleClip`. */
  schedulePattern(track: Track, clip: NoteClip): number[] {
    return this.scheduleClip(track, clip);
  }

  cancelScheduled(ids: number[]) {
    const t = Tone.getTransport();
    for (const id of ids) t.clear(id);
  }

  /** Schedule a vocal audio clip via Tone.Player aligned to its start beat. */
  scheduleAudioClip(
    track: Track,
    clip: {
      id: string;
      start: number;
      durationSec: number;
      offsetSec?: number;
      blob?: Blob;
    },
  ): { id: number; player: Tone.Player } | null {
    const v = this.voices.get(track.id);
    if (!v || !clip.blob) return null;
    const url = URL.createObjectURL(clip.blob);
    const player = new Tone.Player(url).connect(v.channel);
    player.autostart = false;
    this.activeAudioPlayers.add(player);
    const origDispose = player.dispose.bind(player);
    player.dispose = () => {
      this.activeAudioPlayers.delete(player);
      return origDispose();
    };
    const offset = Math.max(0, clip.offsetSec ?? 0);
    const duration = Math.max(0, clip.durationSec);
    const evId = Tone.getTransport().schedule((time) => {
      try {
        player.start(time, offset, duration);
      } catch {
        // ignore
      }
    }, `0:${clip.start}:0`);
    return { id: evId, player };
  }

  // ---- voice construction ----
  private buildVoice(track: Track): TrackVoice {
    const channel = new Tone.Channel({ volume: 0 });
    const reverb = new Tone.Reverb({ decay: 2.5, wet: 0 });
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
    // v2 sound-shaping nodes — wet defaults to 0 so they are inaudible
    // until the user opens MelodicParams and turns them up.
    const drive = new Tone.Distortion({ distortion: 0, wet: 0 });
    const chorus = new Tone.Chorus({ frequency: 1.2, depth: 0.4, wet: 0 }).start();
    const widener = new Tone.StereoWidener({ width: 0.5 });
    // v2 mixer nodes — bypass-friendly defaults so existing projects sound
    // identical. HPF at 20 Hz is effectively transparent; EQ all 0 dB;
    // compressor threshold 0 dB never engages; bitcrusher at 16 bits.
    const hpf = new Tone.Filter({ frequency: 20, type: "highpass", rolloff: -24 });
    const eq3 = new Tone.EQ3({ low: 0, mid: 0, high: 0, lowFrequency: 200, highFrequency: 3200 });
    const comp = new Tone.Compressor({ threshold: 0, ratio: 1, attack: 0.01, release: 0.18, knee: 8 });
    const bitcrusher = new Tone.BitCrusher(16);
    const meter = new Tone.Meter({ smoothing: 0.7 });
    // chain: instrument -> filter -> hpf -> eq3 -> drive -> chorus -> comp -> delay -> reverb -> bitcrusher -> widener -> channel -> master
    filter.connect(hpf);
    hpf.connect(eq3);
    eq3.connect(drive);
    drive.connect(chorus);
    chorus.connect(comp);
    comp.connect(delay);
    delay.connect(reverb);
    reverb.connect(bitcrusher);
    bitcrusher.connect(widener);
    widener.connect(channel);
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
      drive,
      chorus,
      widener,
      hpf,
      eq3,
      comp,
      bitcrusher,
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
        drive.dispose();
        chorus.dispose();
        widener.dispose();
        delay.dispose();
        reverb.dispose();
        hpf.dispose();
        eq3.dispose();
        comp.dispose();
        bitcrusher.dispose();
        for (const g of sends.values()) {
          try { g.dispose(); } catch { /* ignore */ }
        }
        meter.dispose();
        channel.dispose();
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
