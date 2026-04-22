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

export type DrumKit = Record<
  "kick" | "snare" | "hat" | "ohat" | "clap" | "tomLow" | "tomHigh" | "crash",
  Tone.Synth | Tone.NoiseSynth | Tone.MembraneSynth | Tone.MetalSynth
>;

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

interface TrackVoice {
  channel: Tone.Channel;
  meter: Tone.Meter;
  reverb: Tone.Reverb;
  delay: Tone.FeedbackDelay;
  filter: Tone.Filter;
  // melodic instruments
  poly?: Tone.PolySynth | Tone.Sampler;
  // drums
  drums?: Record<DrumPiece, Tone.Synth | Tone.NoiseSynth | Tone.MembraneSynth | Tone.MetalSynth>;
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
    } catch {
      // ignore invalid notes
    }
  }

  startNote(trackId: string, note: string, velocity = 0.9) {
    const v = this.voices.get(trackId);
    if (!v?.poly) return;
    try {
      // PolySynth supports triggerAttack
      (v.poly as Tone.PolySynth).triggerAttack(note, undefined, velocity);
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
      switch (piece) {
        case "kick":
          (inst as Tone.MembraneSynth).triggerAttackRelease("C2", "8n", t, velocity);
          break;
        case "snare":
        case "clap":
          (inst as Tone.NoiseSynth).triggerAttackRelease("16n", t, velocity);
          break;
        case "hat":
          (inst as Tone.MetalSynth).triggerAttackRelease("32n", t, velocity);
          break;
        case "ohat":
          (inst as Tone.MetalSynth).triggerAttackRelease("8n", t, velocity);
          break;
        case "tomLow":
          (inst as Tone.MembraneSynth).triggerAttackRelease("A2", "8n", t, velocity);
          break;
        case "tomHigh":
          (inst as Tone.MembraneSynth).triggerAttackRelease("D3", "8n", t, velocity);
          break;
        case "crash":
          (inst as Tone.MetalSynth).triggerAttackRelease("4n", t, velocity);
          break;
      }
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

export function triggerDrumPiece(
  drums: DrumKit,
  piece: DrumPiece,
  velocity: number,
  time: number,
) {
  const inst = drums[piece];
  if (!inst) return;
  try {
    switch (piece) {
      case "kick":
        (inst as Tone.MembraneSynth).triggerAttackRelease("C2", "8n", time, velocity);
        break;
      case "snare":
      case "clap":
        (inst as Tone.NoiseSynth).triggerAttackRelease("16n", time, velocity);
        break;
      case "hat":
        (inst as Tone.MetalSynth).triggerAttackRelease("32n", time, velocity);
        break;
      case "ohat":
        (inst as Tone.MetalSynth).triggerAttackRelease("8n", time, velocity);
        break;
      case "tomLow":
        (inst as Tone.MembraneSynth).triggerAttackRelease("A2", "8n", time, velocity);
        break;
      case "tomHigh":
        (inst as Tone.MembraneSynth).triggerAttackRelease("D3", "8n", time, velocity);
        break;
      case "crash":
        (inst as Tone.MetalSynth).triggerAttackRelease("4n", time, velocity);
        break;
    }
  } catch {
    // ignore
  }
}

export function buildPiano(preset: PianoPreset): Tone.PolySynth {
  switch (preset) {
    case "grand":
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.005, decay: 0.6, sustain: 0.25, release: 1.4 },
        volume: -10,
      });
    case "electric":
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3,
        modulationIndex: 6,
        oscillator: { type: "sine" },
        envelope: { attack: 0.005, decay: 0.4, sustain: 0.4, release: 1.2 },
        modulation: { type: "square" },
        modulationEnvelope: { attack: 0.01, decay: 0.5, sustain: 0.2, release: 0.5 },
        volume: -12,
      });
    case "synth":
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.02, decay: 0.3, sustain: 0.7, release: 0.8 },
        volume: -14,
      });
  }
}

export function buildGuitar(preset: GuitarPreset): Tone.PolySynth {
  switch (preset) {
    case "clean":
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.005, decay: 0.4, sustain: 0.2, release: 0.8 },
        volume: -12,
      });
    case "crunch":
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.005, decay: 0.5, sustain: 0.5, release: 0.6 },
        volume: -14,
      });
    case "acoustic":
      // Plucky nylon-ish: short attack, long release, slight detune via FM
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 1.005,
        modulationIndex: 2,
        oscillator: { type: "triangle" },
        envelope: { attack: 0.002, decay: 1.4, sustain: 0, release: 1.2 },
        modulation: { type: "triangle" },
        modulationEnvelope: { attack: 0.002, decay: 0.8, sustain: 0, release: 0.5 },
        volume: -10,
      });
  }
}

export function buildBass(preset: BassPreset): Tone.PolySynth {
  switch (preset) {
    case "finger":
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.005, decay: 0.5, sustain: 0.3, release: 0.6 },
        volume: -8,
      });
    case "synth":
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: "sawtooth" },
        filter: { Q: 4, frequency: 600, type: "lowpass" },
        envelope: { attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.5 },
        filterEnvelope: { attack: 0.005, decay: 0.4, sustain: 0.2, release: 0.4, baseFrequency: 200, octaves: 3 },
        volume: -10,
      });
    case "sub":
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.01, decay: 0.5, sustain: 0.6, release: 1.2 },
        volume: -6,
      });
  }
}

export function buildDrumKit(preset: DrumsPreset): DrumKit {
  // Acoustic-ish, electronic, trap -- different envelope/noise/pitch
  const isAcoustic = preset === "acoustic";
  const isElectronic = preset === "electronic";
  const isTrap = preset === "trap";

  const kick = new Tone.MembraneSynth({
    pitchDecay: isTrap ? 0.06 : isElectronic ? 0.04 : 0.05,
    octaves: isTrap ? 6 : isElectronic ? 5 : 4,
    envelope: { attack: 0.001, decay: isTrap ? 0.6 : 0.4, sustain: 0, release: 0.4 },
    volume: isTrap ? -2 : -4,
  });
  const snare = new Tone.NoiseSynth({
    noise: { type: isAcoustic ? "white" : "pink" },
    envelope: { attack: 0.001, decay: isAcoustic ? 0.18 : 0.13, sustain: 0, release: 0.1 },
    volume: -10,
  });
  const clap = new Tone.NoiseSynth({
    noise: { type: "white" },
    envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.05 },
    volume: -12,
  });
  const hat = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.06, release: 0.02 },
    harmonicity: isAcoustic ? 5.1 : 8.5,
    modulationIndex: 32,
    resonance: 4000,
    octaves: 1.5,
    volume: -22,
  });
  const ohat = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 0.3, release: 0.2 },
    harmonicity: isAcoustic ? 5.1 : 8.5,
    modulationIndex: 32,
    resonance: 4000,
    octaves: 1.5,
    volume: -24,
  });
  const tomLow = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 3,
    envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.3 },
    volume: -8,
  });
  const tomHigh = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 3,
    envelope: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.25 },
    volume: -8,
  });
  const crash = new Tone.MetalSynth({
    envelope: { attack: 0.001, decay: 1.2, release: 1.2 },
    harmonicity: 3.1,
    modulationIndex: 16,
    resonance: 6000,
    octaves: 1.5,
    volume: -28,
  });

  return { kick, snare, clap, hat, ohat, tomLow, tomHigh, crash } as DrumKit;
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
