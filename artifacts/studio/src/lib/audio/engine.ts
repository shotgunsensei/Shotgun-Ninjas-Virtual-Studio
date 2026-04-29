import * as Tone from "tone";
import type {
  AnyPreset,
  BassPreset,
  DrumsPreset,
  GuitarPreset,
  InstrumentKind,
  NoteClip,
  PianoPreset,
  Track,
  VocalsPreset,
} from "../../types";

/**
 * Audio engine: a singleton that owns Tone.Transport, the master bus, and a
 * voice per track. Every UI-visible knob in the app maps to a real method here.
 */

/**
 * A drum-kit piece exposes a uniform contract so the engine and offline
 * renderer can trigger pieces without knowing whether they're a single
 * synth or a layered composite.
 */
export interface DrumVoice {
  trigger: (time: number, velocity: number) => void;
  connect: (dest: Tone.InputNode) => unknown;
  dispose: () => void;
}

export type DrumKit = Record<DrumPiece, DrumVoice>;

export const DRUM_PIECES = [
  "kick",
  "snare",
  "hat",
  "ohat",
  "clap",
  "tomLow",
  "tomHigh",
  "crash",
] as const;
export type DrumPiece = (typeof DRUM_PIECES)[number];

/**
 * Polyphonic wrapper around `Tone.PluckSynth` (Karplus–Strong).
 * `PluckSynth` is monophonic and not compatible with `Tone.PolySynth`'s
 * `Monophonic` constraint, so we maintain a small voice pool ourselves
 * and round-robin notes across it.
 */
export class PolyPluck {
  private voices: Tone.PluckSynth[];
  private next = 0;

  constructor(
    opts: Partial<Tone.PluckSynthOptions> = {},
    voiceCount = 8,
  ) {
    this.voices = Array.from(
      { length: voiceCount },
      () => new Tone.PluckSynth(opts),
    );
  }

  triggerAttack(
    note: Tone.Unit.Frequency,
    time?: Tone.Unit.Time,
    _velocity = 0.9,
  ) {
    const v = this.voices[this.next];
    this.next = (this.next + 1) % this.voices.length;
    // Tone.PluckSynth.triggerAttack ignores a velocity argument; the
    // pluck excitation is governed by `attackNoise` / `resonance`.
    v.triggerAttack(note, time);
    return this;
  }

  triggerRelease(_note?: Tone.Unit.Frequency, _time?: Tone.Unit.Time) {
    // Karplus–Strong decays naturally — no explicit release stage.
    return this;
  }

  triggerAttackRelease(
    note: Tone.Unit.Frequency,
    duration: Tone.Unit.Time,
    time?: Tone.Unit.Time,
    velocity = 0.9,
  ) {
    const v = this.voices[this.next];
    this.next = (this.next + 1) % this.voices.length;
    v.triggerAttackRelease(note, duration, time, velocity);
    return this;
  }

  connect(dest: Tone.InputNode) {
    for (const v of this.voices) v.connect(dest);
    return this;
  }

  dispose() {
    for (const v of this.voices) v.dispose();
    return this;
  }
}

export type MelodicVoice = Tone.PolySynth | Tone.Sampler | PolyPluck;

interface TrackVoice {
  channel: Tone.Channel;
  meter: Tone.Meter;
  reverb: Tone.Reverb;
  delay: Tone.FeedbackDelay;
  filter: Tone.Filter;
  // melodic instruments — Sampler for sample-based presets, PolySynth or
  // PolyPluck for synthesized presets.
  poly?: MelodicVoice;
  // drums
  drums?: DrumKit;
  // vocals
  mic?: Tone.UserMedia;
  micOn?: boolean;
  // for cleanup
  dispose: () => void;
}

class AudioEngine {
  private master = new Tone.Channel({ volume: 0 }).toDestination();
  private masterMeter = new Tone.Meter({ smoothing: 0.7 });
  private metronomeSynth = new Tone.MembraneSynth({
    pitchDecay: 0.008,
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
  }).connect(this.master);
  private metronomeAccent = new Tone.MembraneSynth({
    pitchDecay: 0.008,
    octaves: 4,
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
  }).connect(this.master);

  private voices = new Map<string, TrackVoice>();
  private metronomeId: number | null = null;
  private metronomeEnabled = false;
  private soloSet = new Set<string>();
  unlocked = false;
  private noteEverPlayed = false;

  constructor() {
    Tone.getTransport().bpm.value = 100;
    Tone.getTransport().timeSignature = [4, 4];
    // post-master meter tap
    this.master.connect(this.masterMeter);
  }

  /** Returns the post-master Tone.Meter for the main output bus. */
  getMasterMeter(): Tone.Meter {
    return this.masterMeter;
  }

  async unlock() {
    if (this.unlocked) return;
    await Tone.start();
    this.unlocked = true;
  }

  /** Resolves once all Tone-managed buffers (samplers etc.) finish loading. */
  whenSamplesReady(): Promise<void> {
    return Tone.loaded();
  }

  /** Fires a window event the first time any audible note is triggered. */
  private notifyFirstNote() {
    if (this.noteEverPlayed) return;
    if (!this.unlocked) return;
    this.noteEverPlayed = true;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("studio:first-note"));
    }
  }

  setMaster(volume0to1: number) {
    // map 0..1 to -60..0 db (mute below 0.005)
    const db = volume0to1 <= 0.005 ? -Infinity : 20 * Math.log10(volume0to1);
    this.master.volume.rampTo(db, 0.05);
  }

  setBpm(bpm: number) {
    Tone.getTransport().bpm.rampTo(bpm, 0.05);
  }

  getBpm() {
    return Tone.getTransport().bpm.value;
  }

  // ---- transport ----
  play() {
    Tone.getTransport().start();
  }
  pause() {
    Tone.getTransport().pause();
  }
  stop() {
    Tone.getTransport().stop();
    Tone.getTransport().position = 0;
  }
  seekToBeat(beat: number) {
    Tone.getTransport().position = `0:${beat}:0`;
  }
  get state(): "started" | "stopped" | "paused" {
    return Tone.getTransport().state;
  }
  positionBeats(): number {
    // Tone returns position string like "1:2:0.5" (bars:beats:sixteenths)
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
    // map filter 0..1 -> 200..18000Hz (0 = strong filter, 1 = open)
    const cutoff = 200 + (track.fx.filter ** 2) * 17800;
    v.filter.frequency.rampTo(cutoff, 0.05);
  }

  // Re-apply all soloing decisions across the bank
  refreshAllMutes(tracks: Track[]) {
    for (const t of tracks) this.applyTrackSettings(t);
  }

  changePreset(track: Track) {
    const v = this.voices.get(track.id);
    if (!v) return;
    // dispose voice instruments only, keep the channel/fx chain
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
  triggerNote(trackId: string, note: string, durationSec = 0.4, velocity = 0.9) {
    const v = this.voices.get(trackId);
    if (!v?.poly) return;
    try {
      v.poly.triggerAttackRelease(note, durationSec, undefined, velocity);
      this.notifyFirstNote();
    } catch {
      // ignore invalid notes
    }
  }

  startNote(trackId: string, note: string, velocity = 0.9) {
    const v = this.voices.get(trackId);
    if (!v?.poly) return;
    try {
      // PolySynth and Sampler both expose triggerAttack(note, time, velocity)
      (v.poly as Tone.PolySynth).triggerAttack(note, undefined, velocity);
      this.notifyFirstNote();
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

  // ---- vocals ----
  async startVocalMonitor(trackId: string, deviceId?: string) {
    const v = this.voices.get(trackId);
    if (!v?.mic) return;
    try {
      if (deviceId) {
        await v.mic.open(deviceId);
      } else {
        await v.mic.open();
      }
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
      // Skip notes that fall outside the trimmed clip window. Resizing keeps
      // the underlying note data intact (so growing the clip back restores
      // them) — the play pass is what enforces the trim.
      if (ev.time < 0 || ev.time >= clip.length) continue;
      const t = startBeats + ev.time;
      const id = Tone.getTransport().schedule((time) => {
        if (track.kind === "drums") {
          this.triggerDrumAt(track.id, ev.note as DrumPiece, ev.velocity, time);
        } else {
          if (v.poly) {
            const dur = Math.max(0.05, (ev.duration * 60) / Tone.getTransport().bpm.value);
            try {
              v.poly.triggerAttackRelease(ev.note, dur, time, ev.velocity);
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

  triggerDrumAt(trackId: string, piece: DrumPiece, velocity = 0.9, time?: number) {
    const v = this.voices.get(trackId);
    if (!v?.drums) return;
    const inst = v.drums[piece];
    if (!inst) return;
    const t = time ?? Tone.now();
    try {
      inst.trigger(t, velocity);
      this.notifyFirstNote();
    } catch {
      // ignore
    }
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
    const offset = Math.max(0, clip.offsetSec ?? 0);
    const duration = Math.max(0, clip.durationSec);
    const evId = Tone.getTransport().schedule((time) => {
      try {
        // Honor the trimmed window: skip `offset` seconds into the buffer
        // and only play `duration` seconds so the audible region matches
        // what the user sees on the timeline.
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
    const delay = new Tone.FeedbackDelay({ delayTime: "8n", feedback: 0.35, wet: 0 });
    const filter = new Tone.Filter({ frequency: 18000, type: "lowpass", rolloff: -12 });
    const meter = new Tone.Meter({ smoothing: 0.7 });
    // chain: instrument -> filter -> delay -> reverb -> channel -> master
    filter.connect(delay);
    delay.connect(reverb);
    reverb.connect(channel);
    channel.connect(this.master);
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
          (Object.keys(drums) as DrumPiece[]).forEach((k) => drums[k].dispose());
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

  private attachInstrument(v: TrackVoice, kind: InstrumentKind, preset: AnyPreset) {
    const target = v.filter;
    switch (kind) {
      case "piano": {
        v.poly = buildPiano(preset as PianoPreset);
        v.poly.connect(target);
        announceSamplerLoadIfNeeded(v.poly);
        break;
      }
      case "guitar": {
        v.poly = buildGuitar(preset as GuitarPreset);
        v.poly.connect(target);
        break;
      }
      case "bass": {
        v.poly = buildBass(preset as BassPreset);
        v.poly.connect(target);
        break;
      }
      case "drums": {
        const drums = buildDrumKit(preset as DrumsPreset);
        v.drums = drums;
        (Object.keys(drums) as DrumPiece[]).forEach((k) => drums[k].connect(target));
        break;
      }
      case "vocals": {
        // vocal preset adjusts the FX chain defaults
        applyVocalPreset(v, preset as VocalsPreset);
        break;
      }
    }
  }
}

// ---------- preset factories ----------

/**
 * Tone.Sampler loads buffers asynchronously. When a freshly-built sampler is
 * still loading, fire window events so the UI can flash a "loading samples"
 * status without coupling the engine to the store.
 */
function announceSamplerLoadIfNeeded(node: MelodicVoice) {
  if (!(node instanceof Tone.Sampler)) return;
  if (node.loaded) return;
  if (typeof window === "undefined") return;

  const sampler = node;
  window.dispatchEvent(new CustomEvent("studio:samples-loading"));

  // Keep the loading toast visible for at least this many ms so users
  // (and e2e screenshots) can see it even when buffers come from cache.
  const start = performance.now();
  const MIN_VISIBLE_MS = 900;

  const finish = () => {
    const elapsed = performance.now() - start;
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("studio:samples-loaded"));
    }, wait);
  };

  // Poll the sampler's own loaded flag. Tone.loaded() may resolve before
  // the freshly-constructed sampler has registered its buffers, so we
  // prefer the per-instance flag and use Tone.loaded() as a backup.
  let done = false;
  const tick = () => {
    if (done) return;
    if (sampler.loaded || sampler.disposed) {
      done = true;
      finish();
      return;
    }
    window.setTimeout(tick, 100);
  };
  // Give Tone a microtask to wire up the buffers before the first poll.
  window.setTimeout(tick, 50);

  Tone.loaded()
    .then(() => {
      if (done) return;
      done = true;
      finish();
    })
    .catch(() => {
      if (done) return;
      done = true;
      finish();
    });

  // Hard safety net so the "loading" toast cannot get stuck forever.
  window.setTimeout(() => {
    if (done) return;
    done = true;
    finish();
  }, 30_000);
}

export function triggerDrumPiece(
  drums: DrumKit,
  piece: DrumPiece,
  velocity: number,
  time: number,
) {
  const inst = drums[piece];
  if (!inst) return;
  try {
    inst.trigger(time, velocity);
  } catch {
    // ignore
  }
}

/**
 * Salamander grand piano samples hosted by the Tone.js project (MIT).
 * A sparse map (every minor third) is sufficient for natural pitch
 * interpolation while keeping initial download under ~2 MB.
 */
const SALAMANDER_BASE = "https://tonejs.github.io/audio/salamander/";
const SALAMANDER_URLS: Record<string, string> = {
  A1: "A1.mp3",
  C2: "C2.mp3",
  "D#2": "Ds2.mp3",
  "F#2": "Fs2.mp3",
  A2: "A2.mp3",
  C3: "C3.mp3",
  "D#3": "Ds3.mp3",
  "F#3": "Fs3.mp3",
  A3: "A3.mp3",
  C4: "C4.mp3",
  "D#4": "Ds4.mp3",
  "F#4": "Fs4.mp3",
  A4: "A4.mp3",
  C5: "C5.mp3",
  "D#5": "Ds5.mp3",
  "F#5": "Fs5.mp3",
  A5: "A5.mp3",
  C6: "C6.mp3",
};

export function buildPiano(preset: PianoPreset): MelodicVoice {
  switch (preset) {
    case "grand":
      // Velocity-sensitive sampled grand piano — much more realistic
      // than the previous triangle-wave PolySynth.
      return new Tone.Sampler({
        urls: SALAMANDER_URLS,
        baseUrl: SALAMANDER_BASE,
        release: 1.4,
        attack: 0,
        volume: -8,
      });
    case "electric": {
      // DX7-style Rhodes voice: a sine carrier modulated by a sine to
      // produce the characteristic tine bell, with a soft attack and a
      // long, evolving release. Sounds appreciably more like a Rhodes
      // than the previous square-modulator FM patch.
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 8,
        modulationIndex: 5.2,
        oscillator: { type: "sine" },
        envelope: { attack: 0.002, decay: 1.2, sustain: 0.0, release: 1.4 },
        modulation: { type: "sine" },
        modulationEnvelope: {
          attack: 0.002,
          decay: 0.35,
          sustain: 0.05,
          release: 0.4,
        },
        volume: -12,
      });
    }
    case "synth":
      // Detuned, slightly filtered analog-poly pad
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "sawtooth" },
        filter: { Q: 1.2, frequency: 1800, type: "lowpass", rolloff: -24 },
        envelope: { attack: 0.015, decay: 0.4, sustain: 0.65, release: 1.1 },
        filterEnvelope: {
          attack: 0.02,
          decay: 0.6,
          sustain: 0.4,
          release: 1.2,
          baseFrequency: 250,
          octaves: 3.5,
        },
        volume: -16,
      });
  }
}

export function buildGuitar(preset: GuitarPreset): MelodicVoice {
  switch (preset) {
    case "clean":
      // Bright triangle blended with a subtle saw harmonic via FM for body
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 1.0,
        modulationIndex: 1.4,
        oscillator: { type: "triangle" },
        envelope: { attack: 0.004, decay: 0.7, sustain: 0.18, release: 0.9 },
        modulation: { type: "triangle" },
        modulationEnvelope: {
          attack: 0.004,
          decay: 0.6,
          sustain: 0.0,
          release: 0.5,
        },
        volume: -14,
      });
    case "crunch":
      // Distorted single-coil — saw with snappy filter envelope
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "sawtooth" },
        filter: { Q: 2.5, frequency: 1600, type: "lowpass", rolloff: -24 },
        envelope: { attack: 0.003, decay: 0.45, sustain: 0.55, release: 0.5 },
        filterEnvelope: {
          attack: 0.003,
          decay: 0.25,
          sustain: 0.35,
          release: 0.4,
          baseFrequency: 350,
          octaves: 3,
        },
        volume: -16,
      });
    case "acoustic":
      // Karplus–Strong physical model — the most realistic algorithm for
      // plucked steel/nylon strings. PluckSynth itself is monophonic, so
      // PolyPluck round-robins notes across an 8-voice pool for chords.
      return new PolyPluck(
        {
          attackNoise: 0.6,
          dampening: 4500,
          resonance: 0.94,
          release: 0.7,
          volume: -8,
        },
        8,
      );
  }
}

export function buildBass(preset: BassPreset): MelodicVoice {
  switch (preset) {
    case "finger":
      // Round triangle body + low-pass for thump, soft attack for finger
      // articulation, snappy decay then sustained body.
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "triangle" },
        filter: { Q: 1.8, frequency: 1400, type: "lowpass", rolloff: -24 },
        envelope: { attack: 0.008, decay: 0.45, sustain: 0.55, release: 0.5 },
        filterEnvelope: {
          attack: 0.005,
          decay: 0.3,
          sustain: 0.5,
          release: 0.4,
          baseFrequency: 180,
          octaves: 2.5,
        },
        volume: -8,
      });
    case "synth":
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "sawtooth" },
        filter: { Q: 4, frequency: 600, type: "lowpass" },
        envelope: { attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.5 },
        filterEnvelope: {
          attack: 0.005,
          decay: 0.4,
          sustain: 0.2,
          release: 0.4,
          baseFrequency: 200,
          octaves: 3,
        },
        volume: -10,
      });
    case "sub":
      // Pure sine fundamental + tiny triangle harmonic for definition on
      // small speakers (otherwise pure sine is inaudible on phones).
      return new Tone.PolySynth(Tone.AMSynth, {
        harmonicity: 2.0,
        oscillator: { type: "sine" },
        modulation: { type: "sine" },
        envelope: { attack: 0.01, decay: 0.5, sustain: 0.7, release: 1.2 },
        modulationEnvelope: {
          attack: 0.01,
          decay: 0.3,
          sustain: 0.2,
          release: 0.4,
        },
        volume: -6,
      });
  }
}

// ---------- drum kit ----------

/**
 * Build a layered drum voice for `kick` — a punchy MembraneSynth body
 * plus a short metal-click transient gives much more attack than the
 * previous single-MembraneSynth approach.
 */
function makeKick(preset: DrumsPreset): DrumVoice {
  const isAcoustic = preset === "acoustic";
  const isElectronic = preset === "electronic";
  const isTrap = preset === "trap";

  const body = new Tone.MembraneSynth({
    pitchDecay: isTrap ? 0.07 : isElectronic ? 0.04 : 0.045,
    octaves: isTrap ? 8 : isElectronic ? 6 : 5.5,
    envelope: {
      attack: 0.001,
      decay: isTrap ? 0.7 : isElectronic ? 0.4 : 0.5,
      sustain: 0,
      release: isTrap ? 0.6 : 0.4,
    },
    volume: isTrap ? -2 : -3,
  });

  const click = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.018, release: 0.01 },
    harmonicity: 5.1,
    modulationIndex: 14,
    resonance: isAcoustic ? 4500 : 5500,
    octaves: 0.5,
    volume: isAcoustic ? -22 : -28,
  });

  return {
    trigger: (time, velocity) => {
      body.triggerAttackRelease("C2", "8n", time, velocity);
      click.triggerAttackRelease("32n", time, velocity * 0.7);
    },
    connect: (dest) => {
      body.connect(dest);
      click.connect(dest);
    },
    dispose: () => {
      body.dispose();
      click.dispose();
    },
  };
}

/**
 * Snare layered from a tonal body (membrane) + filtered noise burst,
 * so it has a pitch + crisp top end like a real snare.
 */
function makeSnare(preset: DrumsPreset): DrumVoice {
  const isAcoustic = preset === "acoustic";
  const isTrap = preset === "trap";

  const body = new Tone.MembraneSynth({
    pitchDecay: 0.02,
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.13, sustain: 0, release: 0.1 },
    volume: -14,
  });
  const noise = new Tone.NoiseSynth({
    noise: { type: isAcoustic ? "white" : "pink" },
    envelope: {
      attack: 0.001,
      decay: isAcoustic ? 0.18 : isTrap ? 0.1 : 0.13,
      sustain: 0,
      release: 0.1,
    },
    volume: -12,
  });
  const filter = new Tone.Filter({
    type: "highpass",
    frequency: isAcoustic ? 1200 : 1600,
    Q: 0.7,
  });
  noise.connect(filter);

  return {
    trigger: (time, velocity) => {
      body.triggerAttackRelease("D3", "32n", time, velocity * 0.7);
      noise.triggerAttackRelease("16n", time, velocity);
    },
    connect: (dest) => {
      body.connect(dest);
      filter.connect(dest);
    },
    dispose: () => {
      body.dispose();
      noise.dispose();
      filter.dispose();
    },
  };
}

function makeClap(): DrumVoice {
  // Three quick noise hits to fake the multi-handhit signature
  const noise = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
    volume: -12,
  });
  const filter = new Tone.Filter({
    type: "bandpass",
    frequency: 1500,
    Q: 1.5,
  });
  noise.connect(filter);
  return {
    trigger: (time, velocity) => {
      noise.triggerAttackRelease("32n", time, velocity);
      noise.triggerAttackRelease("32n", time + 0.012, velocity * 0.85);
      noise.triggerAttackRelease("16n", time + 0.024, velocity * 0.95);
    },
    connect: (dest) => {
      filter.connect(dest);
    },
    dispose: () => {
      noise.dispose();
      filter.dispose();
    },
  };
}

function makeHat(preset: DrumsPreset, open: boolean): DrumVoice {
  const isAcoustic = preset === "acoustic";
  const synth = new Tone.MetalSynth({
    envelope: {
      attack: 0.001,
      decay: open ? 0.35 : 0.06,
      release: open ? 0.25 : 0.02,
    },
    harmonicity: isAcoustic ? 5.1 : 8.5,
    modulationIndex: 32,
    resonance: 4000,
    octaves: 1.5,
    volume: open ? -24 : -22,
  });
  const filter = new Tone.Filter({
    type: "highpass",
    frequency: isAcoustic ? 6000 : 7000,
    Q: 0.6,
  });
  synth.connect(filter);
  return {
    trigger: (time, velocity) => {
      synth.triggerAttackRelease(open ? "8n" : "32n", time, velocity);
    },
    connect: (dest) => {
      filter.connect(dest);
    },
    dispose: () => {
      synth.dispose();
      filter.dispose();
    },
  };
}

function makeTom(pitch: string): DrumVoice {
  const synth = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 3,
    envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.3 },
    volume: -8,
  });
  return {
    trigger: (time, velocity) => {
      synth.triggerAttackRelease(pitch, "8n", time, velocity);
    },
    connect: (dest) => {
      synth.connect(dest);
    },
    dispose: () => {
      synth.dispose();
    },
  };
}

function makeCrash(): DrumVoice {
  const synth = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 1.4, release: 1.2 },
    harmonicity: 3.1,
    modulationIndex: 16,
    resonance: 6000,
    octaves: 1.5,
    volume: -28,
  });
  return {
    trigger: (time, velocity) => {
      synth.triggerAttackRelease("4n", time, velocity);
    },
    connect: (dest) => {
      synth.connect(dest);
    },
    dispose: () => {
      synth.dispose();
    },
  };
}

export function buildDrumKit(preset: DrumsPreset): DrumKit {
  return {
    kick: makeKick(preset),
    snare: makeSnare(preset),
    clap: makeClap(),
    hat: makeHat(preset, false),
    ohat: makeHat(preset, true),
    tomLow: makeTom("A2"),
    tomHigh: makeTom("D3"),
    crash: makeCrash(),
  };
}

function applyVocalPreset(v: TrackVoice, preset: VocalsPreset) {
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

export const audio = new AudioEngine();
