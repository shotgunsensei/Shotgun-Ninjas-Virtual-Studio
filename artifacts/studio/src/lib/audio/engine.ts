import * as Tone from "tone";
import type {
  AnyPreset,
  InstrumentKind,
  NoteClip,
  Track,
  VocalsPreset,
} from "../../types";
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
  poly?: MelodicVoice;
  drums?: DrumKit;
  mic?: Tone.UserMedia;
  micOn?: boolean;
  dispose: () => void;
}

class AudioEngine {
  private masterChain = new MasterChain();
  private metronomeSynth: Tone.MembraneSynth;
  private metronomeAccent: Tone.MembraneSynth;

  private voices = new Map<string, TrackVoice>();
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
   * Cheap-to-poll peak/RMS levels for the master bus. Reuses an
   * internal object so it's safe to call every animation frame.
   */
  getMasterLevels() {
    return this.masterChain.getLevels();
  }

  setMaster(volume0to1: number) {
    this.masterChain.setVolume(volume0to1);
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
    }
    this.applyTrackSettings(track);
  }

  removeTrack(trackId: string) {
    const v = this.voices.get(trackId);
    if (!v) return;
    v.dispose();
    this.voices.delete(trackId);
    this.soloSet.delete(trackId);
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
    if (v.poly) {
      v.poly.dispose();
      v.poly = undefined;
    }
    if (v.drums) {
      const drums = v.drums;
      (Object.keys(drums) as DrumPiece[]).forEach((k) => drums[k].dispose());
      v.drums = undefined;
    }
    this.attachInstrument(v, track.kind, track.preset);
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
    if (!v?.drums) return;
    const inst = v.drums[piece];
    if (!inst) return;
    const t = time ?? Tone.now();
    try {
      inst.trigger(t, velocity);
      this.noteEverPlayed = true;
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

  /** Schedule notes from a clip on Tone.Transport. Returns event ids for cleanup. */
  scheduleClip(track: Track, clip: NoteClip): number[] {
    const ids: number[] = [];
    const v = this.voices.get(track.id);
    if (!v) return ids;
    const startBeats = clip.start;
    for (const ev of clip.notes) {
      // Skip notes that fall outside the trimmed clip window. Resizing
      // keeps the underlying note data intact (so growing the clip back
      // restores them) — the play pass is what enforces the trim.
      if (ev.time < 0 || ev.time >= clip.length) continue;
      const t = startBeats + ev.time;
      const id = Tone.getTransport().schedule((time) => {
        if (track.kind === "drums") {
          this.triggerDrumAt(track.id, ev.note as DrumPiece, ev.velocity, time);
        } else if (v.poly) {
          const dur = Math.max(
            0.05,
            (ev.duration * 60) / Tone.getTransport().bpm.value,
          );
          try {
            v.poly.triggerAttackRelease(ev.note, dur, time, ev.velocity);
          } catch {
            // skip
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
    const meter = new Tone.Meter({ smoothing: 0.7 });
    // chain: instrument -> filter -> delay -> reverb -> channel -> master
    filter.connect(delay);
    delay.connect(reverb);
    reverb.connect(channel);
    channel.connect(this.masterChain.input);
    // post-fader meter tap
    channel.connect(meter);
    const voice: TrackVoice = {
      channel,
      meter,
      reverb,
      delay,
      filter,
      dispose: () => {
        if (voice.poly) voice.poly.dispose();
        if (voice.drums) {
          const drums = voice.drums;
          (Object.keys(drums) as DrumPiece[]).forEach((k) =>
            drums[k].dispose(),
          );
        }
        if (voice.mic) {
          if (voice.micOn) voice.mic.close();
          voice.mic.dispose();
        }
        filter.dispose();
        delay.dispose();
        reverb.dispose();
        meter.dispose();
        channel.dispose();
      },
    };
    this.attachInstrument(voice, track.kind, track.preset);
    if (track.kind === "vocals") {
      voice.mic = new Tone.UserMedia();
      voice.mic.connect(filter);
    }
    return voice;
  }

  private attachInstrument(
    v: TrackVoice,
    kind: InstrumentKind,
    preset: AnyPreset,
  ) {
    const target = v.filter;
    if (kind === "drums") {
      const drums = buildDrumKit(preset as import("../../types").DrumsPreset);
      v.drums = drums;
      (Object.keys(drums) as DrumPiece[]).forEach((k) =>
        drums[k].connect(target),
      );
      return;
    }
    if (kind === "vocals") {
      applyVocalPresetTo(
        { reverb: v.reverb, delay: v.delay, filter: v.filter },
        preset as VocalsPreset,
      );
      return;
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
