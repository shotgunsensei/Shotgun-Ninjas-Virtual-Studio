import { audio } from "./audio/engine";
import { applyMixPreset } from "./audio/mixPresets";
import {
  defaultProject,
  getStore,
  makeId,
  makeTrack,
  resetStore,
} from "../store";
import type {
  MixPresetId,
  NoteClip,
  NoteEvent,
  Project,
} from "../types";
import { startPerfTimer } from "../utils/performanceDiagnostics";

/**
 * Built-in demo project library. Each demo is built on the fly from
 * pure data (no IndexedDB) so loading one never overwrites a user's
 * saved sessions. Demos use the same project schema as user projects
 * and rely on the fallback synth voices, so they sound good even when
 * no sample packs are present.
 */

export interface DemoDefinition {
  id: string;
  name: string;
  description: string;
  bpm: number;
  /** Short kit / style tag for the demo card. */
  styleTag: string;
  mixPreset: MixPresetId;
  build: () => Project;
}

// ---- pattern helpers ----

type DrumStep = {
  beat: number;
  piece: string;
  vel?: number;
  dur?: number;
  accent?: boolean;
};

/** Compile a list of drum hits into NoteEvent[]. */
function drum(steps: DrumStep[]): NoteEvent[] {
  return steps.map((s) => ({
    time: s.beat,
    note: s.piece,
    duration: s.dur ?? 0.25,
    velocity: s.vel ?? 0.85,
    accent: s.accent,
  }));
}

/** Repeat a 1-bar drum pattern across `bars` bars. */
function repeatBar(barNotes: DrumStep[], bars: number): DrumStep[] {
  const out: DrumStep[] = [];
  for (let b = 0; b < bars; b++) {
    for (const n of barNotes) {
      out.push({ ...n, beat: n.beat + b * 4 });
    }
  }
  return out;
}

/** Build a NoteClip from a pattern. */
function clip(
  start: number,
  lengthBeats: number,
  notes: NoteEvent[],
  name?: string,
  color?: string,
): NoteClip {
  return {
    id: makeId(),
    start,
    length: lengthBeats,
    notes,
    name,
    color,
    bars: Math.max(1, Math.round(lengthBeats / 4)),
    division: "1/16",
  };
}

// Build melodic NoteEvent[] from compact tuples [beat, note, dur, vel?].
function mel(
  events: Array<[number, string, number, number?]>,
): NoteEvent[] {
  return events.map(([time, note, duration, velocity]) => ({
    time,
    note,
    duration,
    velocity: velocity ?? 0.78,
  }));
}

/** Tile chord stabs across bars. Each chord is [startBeat, notes[], dur, vel?]. */
function chordStabs(
  stabs: Array<[number, string[], number, number?]>,
): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const [t, notes, dur, vel] of stabs) {
    for (const n of notes) {
      out.push({ time: t, note: n, duration: dur, velocity: vel ?? 0.7 });
    }
  }
  return out;
}

// ---- demo #1: Trap Starter (140 BPM) ----

function buildTrapStarter(): Project {
  const drums = makeTrack("drums", "Drums", "trap");
  drums.kitId = "trap";
  const bass = makeTrack("bass", "808 Bass", "sub");
  bass.presetId = "bass.808";
  const keys = makeTrack("piano", "Synth Keys", "synth");
  keys.presetId = "keys.synth";
  const lead = makeTrack("guitar", "Pluck Lead", "clean");
  lead.presetId = "pluck.synth";
  const vocals = makeTrack("vocals", "Vocals", "warm");

  // Drum pattern (1 bar): trap kicks, snare on 2 & 4, fast hats
  const barTrap: DrumStep[] = [
    { beat: 0, piece: "kick", vel: 0.95, accent: true },
    { beat: 0.75, piece: "kick", vel: 0.7 },
    { beat: 1, piece: "snare", vel: 0.9, accent: true },
    { beat: 1, piece: "clap", vel: 0.65 },
    { beat: 2.5, piece: "kick", vel: 0.85 },
    { beat: 3, piece: "snare", vel: 0.9, accent: true },
    { beat: 3, piece: "clap", vel: 0.6 },
    { beat: 3.75, piece: "kick", vel: 0.7 },
  ];
  // 16th hats with one roll
  for (let i = 0; i < 16; i++) {
    const v = i % 4 === 0 ? 0.75 : i % 2 === 0 ? 0.55 : 0.4;
    barTrap.push({ beat: i * 0.25, piece: "hat", vel: v, dur: 0.125 });
  }
  // 1/32 roll on last beat for forward motion
  barTrap.push({ beat: 3.5, piece: "hat", vel: 0.5, dur: 0.0625 });
  barTrap.push({ beat: 3.625, piece: "hat", vel: 0.55, dur: 0.0625 });
  barTrap.push({ beat: 3.875, piece: "hat", vel: 0.7, dur: 0.0625 });

  const drumMain = repeatBar(barTrap, 4);
  const drumIntro: DrumStep[] = repeatBar(
    barTrap.filter((s) => s.piece === "hat" || s.piece === "kick"),
    2,
  );
  const drumOutro: DrumStep[] = [
    ...repeatBar(barTrap, 1),
    { beat: 4, piece: "crash", vel: 0.9 },
    { beat: 4, piece: "kick", vel: 0.9 },
    { beat: 5, piece: "snare", vel: 0.85 },
    { beat: 7, piece: "snare", vel: 0.85 },
  ];

  drums.noteClips = [
    clip(0, 8, drum(drumIntro), "Intro", "#f97316"),
    clip(8, 16, drum(drumMain), "Main", "#ef4444"),
    clip(24, 8, drum(drumOutro), "Outro", "#a78bfa"),
  ];

  // Bass: 808 line in F minor — F, F, Eb, Db
  const bassRoots = ["F1", "F1", "Eb1", "Db1"];
  const bassMain: NoteEvent[] = [];
  bassRoots.forEach((n, i) => {
    bassMain.push({ time: i * 4, note: n, duration: 3.5, velocity: 0.9 });
    bassMain.push({ time: i * 4 + 3.5, note: n, duration: 0.4, velocity: 0.7 });
  });
  bass.noteClips = [
    clip(8, 16, bassMain, "Main"),
    clip(24, 8, mel([[0, "F1", 6, 0.85], [6, "F1", 1.5, 0.75]]), "Outro"),
  ];

  // Keys: chord stabs in F minor (Fm, Fm, EbMaj, DbMaj)
  const chords = chordStabs([
    [0, ["F3", "Ab3", "C4"], 1.5, 0.7],
    [2, ["F3", "Ab3", "C4"], 0.5, 0.5],
    [4, ["F3", "Ab3", "C4"], 1.5, 0.7],
    [6, ["F3", "Ab3", "C4"], 0.5, 0.55],
    [8, ["Eb3", "G3", "Bb3"], 1.5, 0.7],
    [10, ["Eb3", "G3", "Bb3"], 0.5, 0.55],
    [12, ["Db3", "F3", "Ab3"], 3.5, 0.7],
  ]);
  keys.noteClips = [clip(8, 16, chords, "Main")];

  // Pluck lead: top-line melody, sparse
  const leadNotes = mel([
    [0, "C5", 0.5],
    [1, "Ab4", 0.5],
    [1.5, "C5", 0.5],
    [3, "F5", 0.5],
    [4, "C5", 0.5],
    [5, "Eb5", 0.5],
    [7, "F5", 0.75],
    [8, "Bb4", 0.5],
    [9.5, "G4", 0.5],
    [11, "Eb5", 0.75],
    [12, "Db5", 0.5],
    [13, "F5", 0.5],
    [14, "Ab5", 1.5],
  ]);
  lead.noteClips = [clip(8, 16, leadNotes, "Hook")];

  vocals.armed = true;

  const proj: Project = {
    id: `demo-trap-${makeId()}`,
    name: "Trap Starter",
    bpm: 140,
    bars: 32,
    loopEnabled: false,
    loopStartBeat: 32,
    loopEndBeat: 96,
    metronome: false,
    countIn: true,
    masterVolume: 0.82,
    tracks: [drums, bass, keys, lead, vocals],
    midiMappings: [],
    updatedAt: Date.now(),
  };
  return applyMixPreset(proj, "loudDemo");
}

// ---- demo #2: Boom Bap Sketch (86 BPM) ----

function buildBoomBap(): Project {
  const drums = makeTrack("drums", "Drums", "acoustic");
  drums.kitId = "boombap";
  const bass = makeTrack("bass", "Finger Bass", "finger");
  bass.presetId = "bass.finger";
  const keys = makeTrack("piano", "Rhodes", "electric");
  keys.presetId = "keys.electric";
  const guitar = makeTrack("guitar", "Pluck", "clean");
  guitar.presetId = "pluck.synth";
  const vocals = makeTrack("vocals", "Vocals", "warm");

  // 2-bar swung boom bap pattern
  const barA: DrumStep[] = [
    { beat: 0, piece: "kick", vel: 0.95, accent: true },
    { beat: 0.75, piece: "kick", vel: 0.7 },
    { beat: 1, piece: "snare", vel: 0.95, accent: true },
    { beat: 2.5, piece: "kick", vel: 0.85 },
    { beat: 3, piece: "snare", vel: 0.95, accent: true },
    // ghost
    { beat: 1.75, piece: "snare", vel: 0.3 },
    { beat: 3.75, piece: "snare", vel: 0.3 },
  ];
  const barB: DrumStep[] = [
    { beat: 0, piece: "kick", vel: 0.95, accent: true },
    { beat: 1, piece: "snare", vel: 0.95, accent: true },
    { beat: 1.5, piece: "kick", vel: 0.8 },
    { beat: 2, piece: "kick", vel: 0.7 },
    { beat: 3, piece: "snare", vel: 0.95, accent: true },
    { beat: 3.5, piece: "ohat", vel: 0.55 },
  ];
  // Swung 8th hats on every bar
  function hats(barOffset: number): DrumStep[] {
    const out: DrumStep[] = [];
    for (let i = 0; i < 8; i++) {
      const beat = i * 0.5 + barOffset;
      out.push({ beat, piece: "hat", vel: i % 2 === 0 ? 0.7 : 0.45 });
    }
    return out;
  }
  const drumMain: DrumStep[] = [
    ...barA,
    ...hats(0),
    ...barB.map((s) => ({ ...s, beat: s.beat + 4 })),
    ...hats(4),
    ...barA.map((s) => ({ ...s, beat: s.beat + 8 })),
    ...hats(8),
    ...barB.map((s) => ({ ...s, beat: s.beat + 12 })),
    ...hats(12),
  ];
  const drumIntro: DrumStep[] = [...hats(0), ...hats(4)];
  const drumOutro: DrumStep[] = [
    ...barA,
    ...hats(0),
    { beat: 4, piece: "crash", vel: 0.8 },
    { beat: 4, piece: "kick", vel: 0.9 },
    { beat: 6, piece: "snare", vel: 0.7 },
    { beat: 7, piece: "snare", vel: 0.85 },
    { beat: 7.5, piece: "snare", vel: 0.9 },
  ];

  drums.noteClips = [
    clip(0, 8, drum(drumIntro), "Intro", "#fbbf24"),
    clip(8, 16, drum(drumMain), "Main", "#f97316"),
    clip(24, 8, drum(drumOutro), "Outro", "#a78bfa"),
  ];

  // Bass: Am - F - C - G walking line (8 beats per chord)
  const bassMain = mel([
    [0, "A1", 1.5], [1.5, "A2", 0.5], [2, "A1", 1.5], [3.5, "E2", 0.5],
    [4, "F1", 1.5], [5.5, "F2", 0.5], [6, "F1", 1.5], [7.5, "C2", 0.5],
    [8, "C2", 1.5], [9.5, "C3", 0.5], [10, "C2", 1.5], [11.5, "G2", 0.5],
    [12, "G1", 1.5], [13.5, "G2", 0.5], [14, "G1", 1.5], [15.5, "A1", 0.5],
  ]);
  bass.noteClips = [clip(8, 16, bassMain, "Main")];

  // Rhodes: Am9 / FMaj7 / CMaj7 / G chords
  const keysMain = chordStabs([
    [0, ["A3", "C4", "E4", "G4", "B4"], 3.5, 0.65],
    [4, ["F3", "A3", "C4", "E4"], 3.5, 0.65],
    [8, ["C4", "E4", "G4", "B4"], 3.5, 0.65],
    [12, ["G3", "B3", "D4", "F#4"], 3.5, 0.6],
  ]);
  keys.noteClips = [clip(8, 16, keysMain, "Chords")];

  // Guitar pluck arpeggios on the main
  const arp = mel([
    [0.5, "E5", 0.3], [1.5, "C5", 0.3], [2.5, "G4", 0.3], [3.5, "A4", 0.3],
    [4.5, "C5", 0.3], [5.5, "A4", 0.3], [6.5, "F4", 0.3], [7.5, "E4", 0.3],
    [8.5, "G4", 0.3], [9.5, "E4", 0.3], [10.5, "B4", 0.3], [11.5, "C5", 0.3],
    [12.5, "D5", 0.3], [13.5, "B4", 0.3], [14.5, "G4", 0.3], [15.5, "A4", 0.3],
  ]);
  guitar.noteClips = [clip(8, 16, arp, "Arp")];

  vocals.armed = true;

  const proj: Project = {
    id: `demo-boombap-${makeId()}`,
    name: "Boom Bap Dojo",
    bpm: 86,
    bars: 32,
    loopEnabled: false,
    loopStartBeat: 32,
    loopEndBeat: 96,
    metronome: false,
    countIn: true,
    masterVolume: 0.8,
    tracks: [drums, bass, keys, guitar, vocals],
    midiMappings: [],
    sections: [
      { id: makeId(), bar: 0, label: "Intro" },
      { id: makeId(), bar: 2, label: "Verse" },
      { id: makeId(), bar: 6, label: "Outro" },
    ],
    globalGroove: { template: "boom-bap-drag", swing: 0.55, humanizeTiming: 0.4, humanizeVelocity: 0.3 },
    updatedAt: Date.now(),
  };
  return applyMixPreset(proj, "lofiDust");
}

// ---- demo #3: Cyber Ninja Theme (110 BPM) ----

function buildCyberNinja(): Project {
  const drums = makeTrack("drums", "Cyber Drums", "electronic");
  drums.kitId = "cyberpunk";
  const bass = makeTrack("bass", "Sub Bass", "sub");
  bass.presetId = "bass.sub";
  const lead = makeTrack("guitar", "Crunch Lead", "crunch");
  lead.presetId = "guitar.crunch";
  const pad = makeTrack("piano", "Dark Pad", "synth");
  pad.presetId = "pad.dark";
  const vocals = makeTrack("vocals", "Vocoder", "lofi");

  // 4-on-floor with snare on 2/4, claps, open hat off-beat
  const bar: DrumStep[] = [
    { beat: 0, piece: "kick", vel: 0.95, accent: true },
    { beat: 1, piece: "kick", vel: 0.7 },
    { beat: 1, piece: "snare", vel: 0.85 },
    { beat: 1, piece: "clap", vel: 0.7 },
    { beat: 2, piece: "kick", vel: 0.95, accent: true },
    { beat: 3, piece: "kick", vel: 0.7 },
    { beat: 3, piece: "snare", vel: 0.85 },
    { beat: 3, piece: "clap", vel: 0.7 },
  ];
  for (let i = 0; i < 8; i++) {
    bar.push({
      beat: i * 0.5,
      piece: i % 2 === 0 ? "hat" : "ohat",
      vel: i % 2 === 0 ? 0.55 : 0.4,
      dur: 0.125,
    });
  }
  const drumMain = repeatBar(bar, 4);
  // intro: sparse — just kicks and FX
  const drumIntro: DrumStep[] = [
    { beat: 0, piece: "fx", vel: 0.7 },
    { beat: 4, piece: "kick", vel: 0.9 },
    { beat: 6, piece: "kick", vel: 0.7 },
    { beat: 7.5, piece: "snare", vel: 0.7 },
  ];
  const drumOutro: DrumStep[] = [
    ...drumMain.slice(0, drumMain.length / 2).map((s) => ({ ...s })),
    { beat: 0, piece: "crash", vel: 0.9 },
    { beat: 6, piece: "fx", vel: 0.85 },
  ];
  drums.noteClips = [
    clip(0, 8, drum(drumIntro), "Intro", "#7dd3fc"),
    clip(8, 16, drum(drumMain), "Main", "#ef4444"),
    clip(24, 8, drum(drumOutro), "Outro", "#a78bfa"),
  ];

  // Sub bass: minor riff in D minor — D, D, Bb, A
  const subRoots = ["D1", "D1", "Bb1", "A1"];
  const bassMain: NoteEvent[] = [];
  subRoots.forEach((n, i) => {
    bassMain.push({ time: i * 4, note: n, duration: 1.5, velocity: 0.9 });
    bassMain.push({ time: i * 4 + 2, note: n, duration: 1.5, velocity: 0.8 });
  });
  bass.noteClips = [clip(8, 16, bassMain, "Sub")];
  bass.noteClips.push(clip(0, 8, mel([[4, "D1", 4, 0.7]]), "Intro"));

  // Dark pad: long chord swells — Dm, Dm, BbMaj, Am
  const padNotes = chordStabs([
    [0, ["D3", "F3", "A3"], 3.8, 0.55],
    [4, ["D3", "F3", "A3"], 3.8, 0.55],
    [8, ["Bb2", "D3", "F3"], 3.8, 0.55],
    [12, ["A2", "C3", "E3"], 3.8, 0.55],
  ]);
  pad.noteClips = [
    clip(0, 8, chordStabs([[0, ["D3", "F3", "A3"], 7.5, 0.5]]), "Intro"),
    clip(8, 16, padNotes, "Main"),
    clip(24, 8, chordStabs([[0, ["A2", "C3", "E3", "A3"], 7.5, 0.5]]), "Outro"),
  ];

  // Crunch lead motif
  const leadNotes = mel([
    [0, "D4", 0.5], [0.5, "F4", 0.5], [1, "A4", 1], [2.5, "C5", 0.75],
    [4, "D4", 0.5], [4.5, "F4", 0.5], [5, "A4", 1.5],
    [8, "Bb3", 0.5], [8.5, "D4", 0.5], [9, "F4", 1.5],
    [12, "A3", 0.5], [12.5, "C4", 0.5], [13, "E4", 1], [14, "A4", 1.5],
  ]);
  lead.noteClips = [clip(8, 16, leadNotes, "Theme")];

  vocals.armed = true;

  const proj: Project = {
    id: `demo-cyber-${makeId()}`,
    name: "Cyber Ninja Theme",
    bpm: 110,
    bars: 32,
    loopEnabled: false,
    loopStartBeat: 32,
    loopEndBeat: 96,
    metronome: false,
    countIn: true,
    masterVolume: 0.78,
    tracks: [drums, bass, pad, lead, vocals],
    midiMappings: [],
    updatedAt: Date.now(),
  };
  return applyMixPreset(proj, "wideNeon");
}

// ---- demo #4: Lo-Fi Loop (78 BPM) ----

function buildLoFi(): Project {
  const drums = makeTrack("drums", "Lo-Fi Drums", "acoustic");
  drums.kitId = "lofi";
  const bass = makeTrack("bass", "Warm Bass", "finger");
  bass.presetId = "bass.finger";
  const keys = makeTrack("piano", "Felt Piano", "grand");
  keys.presetId = "keys.soft";
  const bell = makeTrack("guitar", "Bell Mallet", "clean");
  bell.presetId = "bell.mallet";
  const vocals = makeTrack("vocals", "Vocals", "lofi");

  // Laid-back lo-fi: kick on 1 & "3-and", snare on 3, brushed hats
  const bar: DrumStep[] = [
    { beat: 0, piece: "kick", vel: 0.85, accent: true },
    { beat: 1.75, piece: "kick", vel: 0.65 },
    { beat: 2, piece: "snare", vel: 0.8, accent: true },
    { beat: 2, piece: "clap", vel: 0.4 },
    { beat: 3.5, piece: "kick", vel: 0.6 },
    // dusty FX
    { beat: 0, piece: "fx", vel: 0.35 },
  ];
  for (let i = 0; i < 8; i++) {
    bar.push({ beat: i * 0.5, piece: "hat", vel: i % 2 === 0 ? 0.55 : 0.35 });
  }
  const drumMain = repeatBar(bar, 4);
  const drumIntro = repeatBar(bar.filter((s) => s.piece === "hat" || s.piece === "fx"), 2);
  const drumOutro = repeatBar(bar.filter((s) => s.piece !== "snare"), 2);
  drums.noteClips = [
    clip(0, 8, drum(drumIntro), "Intro", "#fbbf24"),
    clip(8, 16, drum(drumMain), "Main", "#f97316"),
    clip(24, 8, drum(drumOutro), "Outro", "#a78bfa"),
  ];

  // Bass: Cmaj7 — Am7 — Dm7 — G7 (jazzy lo-fi turnaround)
  const bassMain = mel([
    [0, "C2", 2], [2, "G2", 2],
    [4, "A1", 2], [6, "E2", 2],
    [8, "D2", 2], [10, "A2", 2],
    [12, "G1", 2], [14, "D2", 2],
  ]);
  bass.noteClips = [clip(8, 16, bassMain, "Walk")];

  // Soft keys: jazzy 7th chords with rolled tops
  const keysMain = chordStabs([
    [0, ["C4", "E4", "G4", "B4"], 3.8, 0.6],
    [4, ["A3", "C4", "E4", "G4"], 3.8, 0.6],
    [8, ["D4", "F4", "A4", "C5"], 3.8, 0.6],
    [12, ["G3", "B3", "D4", "F4"], 3.8, 0.6],
  ]);
  // Add some top-melody embellishment
  keysMain.push(
    ...mel([
      [3, "B4", 0.5, 0.5],
      [7, "G4", 0.5, 0.5],
      [11, "C5", 0.5, 0.5],
      [15, "F4", 0.5, 0.5],
    ]),
  );
  keys.noteClips = [clip(8, 16, keysMain, "Keys")];

  // Bell mallet plays a sparse top-line
  const bellNotes = mel([
    [0, "E5", 1, 0.55], [2, "G5", 0.5, 0.5],
    [4, "C5", 1, 0.55], [6, "E5", 0.5, 0.5],
    [8, "A5", 1, 0.55], [10, "F5", 0.5, 0.5],
    [12, "D5", 1, 0.55], [14, "B4", 1, 0.5],
  ]);
  bell.noteClips = [clip(8, 16, bellNotes, "Bell")];

  vocals.armed = true;

  const proj: Project = {
    id: `demo-lofi-${makeId()}`,
    name: "Lo-Fi Smoke Loop",
    bpm: 78,
    bars: 32,
    loopEnabled: true,
    loopStartBeat: 32,
    loopEndBeat: 96,
    metronome: false,
    countIn: true,
    masterVolume: 0.78,
    tracks: [drums, bass, keys, bell, vocals],
    midiMappings: [],
    globalGroove: { template: "lazy-pocket", swing: 0.3, humanizeTiming: 0.5, humanizeVelocity: 0.4 },
    updatedAt: Date.now(),
  };
  return applyMixPreset(proj, "lofiDust");
}

// ---- demo #5: Cinematic Intro (90 BPM) ----

function buildCinematic(): Project {
  const drums = makeTrack("drums", "Cinematic Drums", "acoustic");
  drums.kitId = "cinematic";
  const bass = makeTrack("bass", "Sub", "sub");
  bass.presetId = "bass.sub";
  const piano = makeTrack("piano", "Grand Piano", "grand");
  piano.presetId = "keys.grand-piano";
  const brass = makeTrack("guitar", "Cinematic Brass", "clean");
  brass.presetId = "brass.cinematic";
  const vocals = makeTrack("vocals", "Vox FX", "warm");

  // Sparse cinematic hits — taiko low/high, big snare on 3
  const barA: DrumStep[] = [
    { beat: 0, piece: "kick", vel: 0.95, accent: true },
    { beat: 1, piece: "tomLow", vel: 0.7 },
    { beat: 2, piece: "snare", vel: 0.85, accent: true },
    { beat: 3, piece: "tomHigh", vel: 0.7 },
    { beat: 3.5, piece: "tomLow", vel: 0.6 },
  ];
  const barB: DrumStep[] = [
    { beat: 0, piece: "kick", vel: 0.95, accent: true },
    { beat: 0.5, piece: "kick", vel: 0.7 },
    { beat: 1, piece: "tomHigh", vel: 0.7 },
    { beat: 1.5, piece: "tomLow", vel: 0.7 },
    { beat: 2, piece: "snare", vel: 0.85, accent: true },
    { beat: 2.5, piece: "snare", vel: 0.55 },
    { beat: 3, piece: "tomHigh", vel: 0.75 },
    { beat: 3.5, piece: "tomLow", vel: 0.8 },
  ];
  const drumMain: DrumStep[] = [
    ...barA,
    ...barA.map((s) => ({ ...s, beat: s.beat + 4 })),
    ...barB.map((s) => ({ ...s, beat: s.beat + 8 })),
    ...barB.map((s) => ({ ...s, beat: s.beat + 12 })),
  ];
  const drumIntro: DrumStep[] = [
    { beat: 0, piece: "fx", vel: 0.85 },
    { beat: 4, piece: "tomLow", vel: 0.6 },
    { beat: 6, piece: "tomLow", vel: 0.7 },
    { beat: 7, piece: "tomHigh", vel: 0.8 },
    { beat: 7.5, piece: "snare", vel: 0.7 },
  ];
  const drumOutro: DrumStep[] = [
    { beat: 0, piece: "crash", vel: 0.95, accent: true },
    { beat: 0, piece: "kick", vel: 0.95 },
    { beat: 4, piece: "tomLow", vel: 0.85 },
    { beat: 5, piece: "tomHigh", vel: 0.85 },
    { beat: 6, piece: "snare", vel: 0.9 },
    { beat: 7, piece: "fx", vel: 0.8 },
  ];

  drums.noteClips = [
    clip(0, 8, drum(drumIntro), "Intro", "#7dd3fc"),
    clip(8, 16, drum(drumMain), "Main", "#ef4444"),
    clip(24, 8, drum(drumOutro), "Hit", "#a78bfa"),
  ];

  // Sub bass: long pedal Em -> C -> G -> D
  const subBass = mel([
    [0, "E1", 3.8, 0.85],
    [4, "C1", 3.8, 0.85],
    [8, "G1", 3.8, 0.85],
    [12, "D1", 3.8, 0.85],
  ]);
  bass.noteClips = [
    clip(0, 8, mel([[0, "E1", 7.5, 0.7]]), "Pedal"),
    clip(8, 16, subBass, "Main"),
    clip(24, 8, mel([[0, "E1", 7.5, 0.85]]), "Hit"),
  ];

  // Grand piano: minor triads with broken arpeggios
  const pianoMain: NoteEvent[] = [
    // Em (E G B)
    ...chordStabs([[0, ["E3", "G3", "B3"], 1.8, 0.55]]),
    ...mel([
      [2, "B3", 0.5, 0.6], [2.5, "E4", 0.5, 0.6], [3, "G4", 0.5, 0.55], [3.5, "B4", 0.5, 0.5],
    ]),
    // C (C E G)
    ...chordStabs([[4, ["C3", "E3", "G3"], 1.8, 0.55]]),
    ...mel([
      [6, "G3", 0.5, 0.6], [6.5, "C4", 0.5, 0.6], [7, "E4", 0.5, 0.55], [7.5, "G4", 0.5, 0.5],
    ]),
    // G (G B D)
    ...chordStabs([[8, ["G3", "B3", "D4"], 1.8, 0.55]]),
    ...mel([
      [10, "D4", 0.5, 0.6], [10.5, "G4", 0.5, 0.6], [11, "B4", 0.5, 0.55], [11.5, "D5", 0.5, 0.5],
    ]),
    // D (D F# A)
    ...chordStabs([[12, ["D3", "F#3", "A3"], 1.8, 0.55]]),
    ...mel([
      [14, "A3", 0.5, 0.6], [14.5, "D4", 0.5, 0.6], [15, "F#4", 0.5, 0.55], [15.5, "A4", 0.5, 0.5],
    ]),
  ];
  piano.noteClips = [
    clip(0, 8, mel([[0, "E3", 7, 0.45], [0, "G3", 7, 0.4], [0, "B3", 7, 0.4]]), "Intro"),
    clip(8, 16, pianoMain, "Main"),
  ];

  // Brass: heroic long notes
  const brassNotes = mel([
    [0, "E4", 3.5, 0.75],
    [4, "G4", 3.5, 0.75],
    [8, "D5", 3.5, 0.8],
    [12, "F#5", 3.5, 0.8],
  ]);
  brass.noteClips = [
    clip(8, 16, brassNotes, "Theme"),
    clip(24, 8, mel([[0, "E5", 6, 0.85]]), "Final"),
  ];

  vocals.armed = true;

  const proj: Project = {
    id: `demo-cinematic-${makeId()}`,
    name: "Cinematic Trailer Hit",
    bpm: 90,
    bars: 32,
    loopEnabled: false,
    loopStartBeat: 32,
    loopEndBeat: 96,
    metronome: false,
    countIn: true,
    masterVolume: 0.8,
    tracks: [drums, bass, piano, brass, vocals],
    midiMappings: [],
    sections: [
      { id: makeId(), bar: 0, label: "Intro" },
      { id: makeId(), bar: 2, label: "Theme" },
      { id: makeId(), bar: 6, label: "Hit" },
    ],
    updatedAt: Date.now(),
  };
  return applyMixPreset(proj, "darkCinematic");
}

// ---- demo #6: 808 Bass Test (90 BPM) ----

function build808BassTest(): Project {
  const drums = makeTrack("drums", "808 Drums", "trap");
  drums.kitId = "trap";
  const bass = makeTrack("bass", "808 Sub", "sub");
  bass.presetId = "bass.808";
  const vocals = makeTrack("vocals", "Vox", "warm");

  // Simple kick/snare/hat reference pattern so the 808 has context
  const bar: DrumStep[] = [
    { beat: 0, piece: "kick", vel: 0.95, accent: true },
    { beat: 1, piece: "snare", vel: 0.9, accent: true },
    { beat: 1, piece: "clap", vel: 0.55 },
    { beat: 2, piece: "kick", vel: 0.85 },
    { beat: 3, piece: "snare", vel: 0.9, accent: true },
    { beat: 3, piece: "clap", vel: 0.55 },
  ];
  for (let i = 0; i < 8; i++) {
    bar.push({ beat: i * 0.5, piece: "hat", vel: i % 2 === 0 ? 0.55 : 0.35 });
  }
  drums.noteClips = [clip(0, 16, drum(repeatBar(bar, 4)), "Drums", "#f97316")];

  // 808 bass cycles through the lowest notes of each octave so you can hear
  // how the sub responds across the range. Two bars per note.
  const notes = ["A1", "F1", "D1", "C1", "G1", "E1", "Bb1", "A2"];
  const bassNotes: NoteEvent[] = notes.map((n, i) => ({
    time: i * 2,
    note: n,
    duration: 1.8,
    velocity: 0.9,
  }));
  bass.noteClips = [clip(0, 16, bassNotes, "808 Test", "#a78bfa")];

  vocals.armed = false;

  const proj: Project = {
    id: `demo-808-${makeId()}`,
    name: "808 Bass Test",
    bpm: 90,
    bars: 24,
    loopEnabled: true,
    loopStartBeat: 0,
    loopEndBeat: 64,
    metronome: false,
    countIn: true,
    masterVolume: 0.8,
    tracks: [drums, bass, vocals],
    midiMappings: [],
    updatedAt: Date.now(),
  };
  return applyMixPreset(proj, "punchy");
}

// ---- demo #7: Sample Chop Template (94 BPM) ----

function buildSampleChop(): Project {
  const drums = makeTrack("drums", "Chop Drums", "acoustic");
  drums.kitId = "boombap";
  const bass = makeTrack("bass", "Sub", "sub");
  bass.presetId = "bass.sub";
  const keys = makeTrack("piano", "Felt Keys", "grand");
  keys.presetId = "keys.soft";
  const vocals = makeTrack("vocals", "Sample / Vox", "warm");
  vocals.armed = true;

  // 4-bar dusty break to chop over
  const barChop: DrumStep[] = [
    { beat: 0, piece: "kick", vel: 0.95, accent: true },
    { beat: 0.5, piece: "hat", vel: 0.5 },
    { beat: 1, piece: "snare", vel: 0.9, accent: true },
    { beat: 1.5, piece: "hat", vel: 0.45 },
    { beat: 2, piece: "kick", vel: 0.8 },
    { beat: 2.5, piece: "hat", vel: 0.5 },
    { beat: 2.75, piece: "kick", vel: 0.6 },
    { beat: 3, piece: "snare", vel: 0.9 },
    { beat: 3.5, piece: "ohat", vel: 0.5 },
  ];
  drums.noteClips = [
    clip(0, 16, drum(repeatBar(barChop, 4)), "Break", "#f97316"),
  ];

  // Sub bass holds the root for each 4-beat slice — Dm pedal
  bass.noteClips = [
    clip(
      0,
      16,
      mel([
        [0, "D1", 3.5, 0.85],
        [4, "D1", 3.5, 0.85],
        [8, "Bb1", 3.5, 0.85],
        [12, "A1", 3.5, 0.85],
      ]),
      "Sub",
      "#a78bfa",
    ),
  ];

  // Keys vamp — quiet so a chopped sample sits on top
  keys.noteClips = [
    clip(
      0,
      16,
      chordStabs([
        [0, ["D3", "F3", "A3"], 3.5, 0.5],
        [4, ["D3", "F3", "A3"], 3.5, 0.5],
        [8, ["Bb2", "D3", "F3"], 3.5, 0.5],
        [12, ["A2", "C3", "E3"], 3.5, 0.5],
      ]),
      "Pad",
      "#7dd3fc",
    ),
  ];

  const proj: Project = {
    id: `demo-chop-${makeId()}`,
    name: "Sample Chop Template",
    bpm: 94,
    bars: 32,
    loopEnabled: true,
    loopStartBeat: 0,
    loopEndBeat: 64,
    metronome: false,
    countIn: true,
    masterVolume: 0.78,
    tracks: [drums, bass, keys, vocals],
    midiMappings: [],
    sections: [
      { id: makeId(), bar: 0, label: "Chop here →" },
      { id: makeId(), bar: 4, label: "Drop a sample on the Sample / Vox track" },
    ],
    updatedAt: Date.now(),
  };
  return applyMixPreset(proj, "lofiDust");
}

// ---- demo #8: Empty Studio (120 BPM) ----

function buildEmptyStudio(): Project {
  const drums = makeTrack("drums", "Drums", "acoustic");
  drums.kitId = "boombap";
  const bass = makeTrack("bass", "Bass", "finger");
  bass.presetId = "bass.finger";
  const keys = makeTrack("piano", "Keys", "electric");
  keys.presetId = "keys.electric";
  const guitar = makeTrack("guitar", "Guitar", "clean");
  guitar.presetId = "guitar.clean";
  const vocals = makeTrack("vocals", "Vocals", "warm");

  const proj: Project = {
    id: `demo-empty-${makeId()}`,
    name: "Empty Studio",
    bpm: 120,
    bars: 16,
    loopEnabled: false,
    loopStartBeat: 0,
    loopEndBeat: 16,
    metronome: false,
    countIn: true,
    masterVolume: 0.78,
    tracks: [drums, bass, keys, guitar, vocals],
    midiMappings: [],
    updatedAt: Date.now(),
  };
  return applyMixPreset(proj, "clean");
}

// ---- registry ----

export const DEMOS: DemoDefinition[] = [
  {
    id: "trap-starter",
    name: "Trap Starter",
    description: "Sub 808s, snappy snares and rolling hats. F minor.",
    bpm: 140,
    styleTag: "Trap · 808",
    mixPreset: "loudDemo",
    build: buildTrapStarter,
  },
  {
    id: "boom-bap-dojo",
    name: "Boom Bap Dojo",
    description: "Dusty kick, swung hats and rhodes chords. Am — F — C — G.",
    bpm: 86,
    styleTag: "Boom Bap · Swing",
    mixPreset: "lofiDust",
    build: buildBoomBap,
  },
  {
    id: "cyber-ninja",
    name: "Cyber Ninja Theme",
    description: "Neon kit, sub bass and a crunch lead motif. D minor.",
    bpm: 110,
    styleTag: "Synthwave · Wide",
    mixPreset: "wideNeon",
    build: buildCyberNinja,
  },
  {
    id: "lofi-smoke-loop",
    name: "Lo-Fi Smoke Loop",
    description: "Laid-back beats, felt piano and bell top-line. Cmaj7 vamp.",
    bpm: 78,
    styleTag: "Lo-Fi · Chill",
    mixPreset: "lofiDust",
    build: buildLoFi,
  },
  {
    id: "cinematic-trailer-hit",
    name: "Cinematic Trailer Hit",
    description: "Taiko hits, sub pedal, grand piano and heroic brass. E minor.",
    bpm: 90,
    styleTag: "Cinematic · Score",
    mixPreset: "darkCinematic",
    build: buildCinematic,
  },
  {
    id: "808-bass-test",
    name: "808 Bass Test",
    description: "Reference 808 sweep with a punchy trap pattern to A/B subs.",
    bpm: 90,
    styleTag: "Reference · 808",
    mixPreset: "punchy",
    build: build808BassTest,
  },
  {
    id: "sample-chop-template",
    name: "Sample Chop Template",
    description: "Dusty break + Dm pedal — drop a sample on Sample / Vox and chop.",
    bpm: 94,
    styleTag: "Template · Chop",
    mixPreset: "lofiDust",
    build: buildSampleChop,
  },
  {
    id: "empty-studio",
    name: "Empty Studio",
    description: "Five empty tracks at 120 BPM. Start from a blank slate.",
    bpm: 120,
    styleTag: "Blank · Sketch",
    mixPreset: "clean",
    build: buildEmptyStudio,
  },
];

/** First-run "starting mode" tiles. Each maps to a demo id that
 *  `loadDemo` will hand to the user. Keep this list small so the
 *  welcome flow stays a single, fast decision. */
export type StartingModeId =
  | "beat-sketch"
  | "drum-machine"
  | "sample-chop"
  | "cinematic-intro"
  | "blank-project";

export interface StartingMode {
  id: StartingModeId;
  label: string;
  description: string;
  demoId: string;
}

export const STARTING_MODES: StartingMode[] = [
  {
    id: "beat-sketch",
    label: "Beat Sketch",
    description: "Boom-bap drums, walking bass and rhodes to jam over.",
    demoId: "boom-bap-dojo",
  },
  {
    id: "drum-machine",
    label: "Drum Machine",
    description: "Trap kit + 808 sub — perfect for punchy beats.",
    demoId: "808-bass-test",
  },
  {
    id: "sample-chop",
    label: "Sample Chop",
    description: "Dusty break + a Sample / Vox track ready for your sample.",
    demoId: "sample-chop-template",
  },
  {
    id: "cinematic-intro",
    label: "Cinematic Intro",
    description: "Taiko hits, grand piano and heroic brass for trailers.",
    demoId: "cinematic-trailer-hit",
  },
  {
    id: "blank-project",
    label: "Blank Project",
    description: "Five empty tracks at 120 BPM. Build from scratch.",
    demoId: "empty-studio",
  },
];

export function findDemo(id: string): DemoDefinition | undefined {
  return DEMOS.find((d) => d.id === id);
}

/**
 * Load a demo into the store. The demo lives entirely in memory — it
 * does NOT touch IndexedDB, so the user's saved projects are never
 * overwritten. The transient flag set on the store tells the autosave
 * loop in `App` to skip persisting until the user explicitly Save-As's
 * their copy.
 */
export function loadDemo(id: string): boolean {
  const endLoadDemo = startPerfTimer("demo.load", { id });
  const def = findDemo(id);
  if (!def) {
    endLoadDemo();
    return false;
  }
  try {
    const endBuild = startPerfTimer("demo.build", { id });
    const project = def.build();
    endBuild();

    const endStop = startPerfTimer("demo.audio-stop", { id });
    audio.stop();
    endStop();

    const endReset = startPerfTimer("demo.reset-store", {
      id,
      tracks: project.tracks.length,
    });
    resetStore(project);
    endReset();

    const endStorePatch = startPerfTimer("demo.post-reset-store", { id });
    const store = getStore();
    store.set({
      isTransientProject: true,
      selectedTrackId: project.tracks[0]?.id ?? "",
      selectedClipId: null,
      showHelp: false,
      showOnboarding: false,
    });
    store.setStatus(`Loaded demo: ${def.name}`, "info");
    endStorePatch();
    return true;
  } finally {
    endLoadDemo();
  }
}

/**
 * "Remix This Demo" — build a fresh copy of the demo as an editable
 * project (new id + " (remix)" suffix). The source demo definition is
 * untouched. The remix is loaded as a non-transient project so autosave
 * persists it to IndexedDB on the first change.
 */
export function remixDemo(id: string): boolean {
  const endRemixDemo = startPerfTimer("demo.remix", { id });
  const def = findDemo(id);
  if (!def) {
    endRemixDemo();
    return false;
  }
  try {
    const endBuild = startPerfTimer("demo.remix-build", { id });
    const base = def.build();
    const project: Project = {
      ...base,
      id: `remix-${def.id}-${makeId()}`,
      name: `${def.name} (remix)`,
      updatedAt: Date.now(),
    };
    endBuild();

    const endStop = startPerfTimer("demo.remix-audio-stop", { id });
    audio.stop();
    endStop();

    const endReset = startPerfTimer("demo.remix-reset-store", {
      id,
      tracks: project.tracks.length,
    });
    resetStore(project);
    endReset();

    const endStorePatch = startPerfTimer("demo.remix-post-reset-store", { id });
    const store = getStore();
    store.set({
      isTransientProject: false,
      selectedTrackId: project.tracks[0]?.id ?? "",
      selectedClipId: null,
      showHelp: false,
      showOnboarding: false,
    });
    store.setStatus(`Remixed "${def.name}" - autosave is on`, "info");
    endStorePatch();
    return true;
  } finally {
    endRemixDemo();
  }
}

// Re-export defaultProject so callers that already import demos don't
// need to also pull from the store module.
export { defaultProject };

// Helper for tests: list demos by name + bpm without building them.
export function demoSummaries(): Array<{
  id: string;
  name: string;
  bpm: number;
  styleTag: string;
}> {
  return DEMOS.map(({ id, name, bpm, styleTag }) => ({ id, name, bpm, styleTag }));
}

