import type { NoteClip, NoteEvent, Project, Track } from "../../types";

export type CreativeScale =
  | "major"
  | "minor"
  | "pentatonic_major"
  | "pentatonic_minor"
  | "dorian";
export type CreativeRecipe = "motif" | "chords" | "pulse" | "groove";
export type CreativeVariation = "answer" | "lift" | "pocket";

export const CREATIVE_ROOTS = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export const CREATIVE_SCALE_LABELS: Record<CreativeScale, string> = {
  major: "Major · open",
  minor: "Minor · focused",
  pentatonic_major: "Pentatonic major · bright",
  pentatonic_minor: "Pentatonic minor · spacious",
  dorian: "Dorian · soulful",
};

export const CREATIVE_RECIPE_COPY: Record<
  CreativeRecipe,
  { label: string; description: string; lesson: string }
> = {
  motif: {
    label: "Motif seed",
    description: "A short, repeatable melodic identity with a changed ending.",
    lesson: "A listener remembers contour and rhythm before individual notes.",
  },
  chords: {
    label: "Chord lanterns",
    description: "Four scale-built chords that establish a clear harmonic home.",
    lesson: "Common tones connect chords while the bass movement creates direction.",
  },
  pulse: {
    label: "Pulse line",
    description: "A grounded root-and-fifth pattern with deliberate breathing room.",
    lesson: "Space between low notes makes the groove feel larger and clearer.",
  },
  groove: {
    label: "Pocket groove",
    description: "A two-bar kick, snare, and hat conversation with a small turnaround.",
    lesson: "Repetition establishes the pocket; one late change signals the loop point.",
  },
};

export interface CreativeStage {
  id: "rhythm" | "harmony" | "low-end" | "shape";
  label: string;
  complete: boolean;
  detail: string;
}

export interface CreativeAnalysis {
  stages: CreativeStage[];
  completedStages: number;
  targetTrackId: string | null;
  recommendedRecipe: CreativeRecipe;
  nextMove: {
    title: string;
    why: string;
    practice: string;
  };
}

const SCALE_INTERVALS: Record<CreativeScale, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic_major: [0, 2, 4, 7, 9],
  pentatonic_minor: [0, 3, 5, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

export function creativeScaleFromScaleId(scaleId: string | undefined): CreativeScale {
  if (scaleId === "major") return "major";
  if (scaleId === "dorian") return "dorian";
  if (scaleId === "pentatonic_major") return "pentatonic_major";
  if (scaleId === "pentatonic_minor") return "pentatonic_minor";
  return "minor";
}

function noteCount(track: Track | undefined): number {
  return track?.noteClips.reduce((sum, clip) => sum + clip.notes.length, 0) ?? 0;
}

function firstTrack(
  project: Project,
  predicate: (track: Track) => boolean,
): Track | undefined {
  return project.tracks.find(predicate);
}

export function isCreativeTrack(track: Track): boolean {
  return track.kind !== "vocals";
}

export function analyzeCreativeProject(
  project: Project,
  selectedTrackId: string | null,
): CreativeAnalysis {
  const drums = firstTrack(project, (track) => track.kind === "drums");
  const harmony = firstTrack(
    project,
    (track) => track.kind === "piano" || track.kind === "guitar",
  );
  const bass = firstTrack(project, (track) => track.kind === "bass");
  const selected = project.tracks.find((track) => track.id === selectedTrackId);
  const fallbackMelodic = firstTrack(
    project,
    (track) =>
      track.kind === "piano" || track.kind === "guitar" || track.kind === "bass",
  );

  const hasRhythm = noteCount(drums) >= 4;
  const hasHarmony = noteCount(harmony) >= 3;
  const hasLowEnd = noteCount(bass) > 0;
  const latestNoteEnd = project.tracks.reduce(
    (latest, track) =>
      Math.max(
        latest,
        ...track.noteClips.map((clip) => clip.start + clip.length),
      ),
    0,
  );
  const hasShape = (project.sections?.length ?? 0) >= 2 || latestNoteEnd > 16;

  const stages: CreativeStage[] = [
    {
      id: "rhythm",
      label: "Pulse",
      complete: hasRhythm,
      detail: hasRhythm ? "A rhythmic foundation is present." : "Give the idea a repeatable pulse.",
    },
    {
      id: "harmony",
      label: "Home",
      complete: hasHarmony,
      detail: hasHarmony ? "The harmony establishes a tonal home." : "Establish where the music feels at rest.",
    },
    {
      id: "low-end",
      label: "Weight",
      complete: hasLowEnd,
      detail: hasLowEnd ? "The low end anchors the sketch." : "Add a simple low-frequency anchor.",
    },
    {
      id: "shape",
      label: "Contrast",
      complete: hasShape,
      detail: hasShape ? "The arrangement moves beyond one loop." : "Create a second scene or response.",
    },
  ];

  if (!hasRhythm) {
    return {
      stages,
      completedStages: stages.filter((stage) => stage.complete).length,
      targetTrackId: drums?.id ?? fallbackMelodic?.id ?? null,
      recommendedRecipe: drums ? "groove" : "pulse",
      nextMove: {
        title: "Give the sketch a pulse",
        why: "A steady rhythmic reference makes every later musical choice easier to hear.",
        practice: "Keep the first loop simple enough that you can hum it after one listen.",
      },
    };
  }

  if (!hasHarmony) {
    return {
      stages,
      completedStages: stages.filter((stage) => stage.complete).length,
      targetTrackId: harmony?.id ?? fallbackMelodic?.id ?? null,
      recommendedRecipe: "chords",
      nextMove: {
        title: "Choose a harmonic home",
        why: "A compact chord cycle gives melodies tension, release, and a place to land.",
        practice: "Notice which notes stay common while the chord underneath changes.",
      },
    };
  }

  if (!hasLowEnd) {
    return {
      stages,
      completedStages: stages.filter((stage) => stage.complete).length,
      targetTrackId: bass?.id ?? fallbackMelodic?.id ?? null,
      recommendedRecipe: "pulse",
      nextMove: {
        title: "Anchor the low end",
        why: "A restrained bass pattern clarifies both the harmony and the groove.",
        practice: "Leave gaps around the kick instead of filling every beat.",
      },
    };
  }

  return {
    stages,
    completedStages: stages.filter((stage) => stage.complete).length,
    targetTrackId:
      (selected && isCreativeTrack(selected) ? selected.id : fallbackMelodic?.id) ??
      drums?.id ??
      null,
    recommendedRecipe: "motif",
    nextMove: hasShape
      ? {
          title: "Refine one memorable identity",
          why: "Once the sketch has shape, fewer stronger ideas usually communicate more.",
          practice: "Mute one layer, then ask whether the song became clearer or merely smaller.",
        }
      : {
          title: "Write an answer, not another loop",
          why: "A related second phrase creates forward motion without abandoning the hook.",
          practice: "Keep the rhythm recognizable and change the contour or final note.",
        },
  };
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function scaleMidi(
  rootSemitone: number,
  baseOctave: number,
  scale: CreativeScale,
  degree: number,
): number {
  const intervals = SCALE_INTERVALS[scale];
  const length = intervals.length;
  const octaveOffset = Math.floor(degree / length);
  const normalized = ((degree % length) + length) % length;
  return 12 * (baseOctave + 1) + rootSemitone + intervals[normalized] + octaveOffset * 12;
}

function midiToName(midi: number): string {
  const safe = Math.max(0, Math.min(127, Math.round(midi)));
  return `${CREATIVE_ROOTS[safe % 12]}${Math.floor(safe / 12) - 1}`;
}

function noteNameToMidi(note: string): number | null {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(note.trim());
  if (!match) return null;
  const pitchClass: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };
  let semitone = pitchClass[match[1].toUpperCase()];
  if (match[2] === "#") semitone += 1;
  if (match[2] === "b") semitone -= 1;
  const octave = Number(match[3]);
  return Math.max(0, Math.min(127, (octave + 1) * 12 + semitone));
}

function quantizeToCreativeScale(
  midi: number,
  rootSemitone: number,
  scale: CreativeScale,
): number {
  let best = midi;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let candidate = Math.max(0, midi - 12); candidate <= Math.min(127, midi + 12); candidate += 1) {
    if (!isMidiInCreativeScale(candidate, rootSemitone, scale)) continue;
    const distance = Math.abs(candidate - midi);
    if (distance < bestDistance || (distance === bestDistance && candidate < best)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function isMidiInCreativeScale(
  midi: number,
  rootSemitone: number,
  scale: CreativeScale,
): boolean {
  const relative = ((midi - rootSemitone) % 12 + 12) % 12;
  return SCALE_INTERVALS[scale].includes(relative);
}

function melodicBaseOctave(trackKind: Track["kind"]): number {
  if (trackKind === "bass") return 2;
  if (trackKind === "guitar") return 3;
  return 4;
}

function motifNotes(
  trackKind: Track["kind"],
  rootSemitone: number,
  scale: CreativeScale,
  seed: string,
): NoteEvent[] {
  const patterns = [
    [0, 2, 1, 4, 0, 2, 3, 0],
    [0, 1, 3, 2, 0, 4, 2, 1],
    [0, 4, 3, 1, 2, 3, 1, 0],
  ];
  const pattern = patterns[hashSeed(seed) % patterns.length];
  const times = [0, 0.75, 1.5, 2.5, 4, 4.75, 5.5, 6.5];
  const octave = melodicBaseOctave(trackKind);
  return pattern.map((degree, index) => ({
    time: times[index],
    note: midiToName(scaleMidi(rootSemitone, octave, scale, degree)),
    duration: index === pattern.length - 1 ? 1.25 : index % 4 === 2 ? 0.75 : 0.5,
    velocity: index % 4 === 0 ? 0.84 : 0.68 + (index % 2) * 0.06,
  }));
}

function chordNotes(
  trackKind: Track["kind"],
  rootSemitone: number,
  scale: CreativeScale,
): NoteEvent[] {
  // Seven-note modes use familiar diatonic cycles. Pentatonic modes need
  // their own five-degree cycles; reusing degree 5/6 would wrap into the next
  // octave and repeat the tonic instead of creating four distinct roots.
  const progression: Record<CreativeScale, number[]> = {
    major: [0, 4, 5, 3],
    minor: [0, 5, 2, 6],
    dorian: [0, 5, 2, 6],
    pentatonic_major: [0, 3, 4, 1],
    pentatonic_minor: [0, 3, 2, 4],
  };
  const octave = 3;
  const notes: NoteEvent[] = [];
  progression[scale].forEach((degree, chordIndex) => {
    [degree, degree + 2, degree + 4].forEach((chordDegree, voiceIndex) => {
      notes.push({
        time: chordIndex * 2,
        note: midiToName(scaleMidi(rootSemitone, octave, scale, chordDegree)),
        duration: 1.75,
        velocity: 0.66 - voiceIndex * 0.04,
      });
    });
  });
  return notes;
}

function pulseNotes(
  trackKind: Track["kind"],
  rootSemitone: number,
  scale: CreativeScale,
): NoteEvent[] {
  const intervals = SCALE_INTERVALS[scale];
  const fifthDegree = intervals.indexOf(7);
  // Every supported Compass scale contains a perfect fifth. Resolve by its
  // interval rather than assuming degree 4, which is a minor seventh in a
  // five-note minor-pentatonic scale.
  const degrees = [0, 0, fifthDegree, fifthDegree, 0, 0, fifthDegree, 0];
  const octave = trackKind === "bass" ? 2 : melodicBaseOctave(trackKind);
  return degrees.map((degree, index) => ({
    time: index,
    note: midiToName(scaleMidi(rootSemitone, octave, scale, degree)),
    duration: index % 2 === 0 ? 0.72 : 0.45,
    velocity: index % 4 === 0 ? 0.86 : 0.7,
  }));
}

function grooveNotes(seed: string): NoteEvent[] {
  const variant = hashSeed(seed) % 3;
  const notes: NoteEvent[] = [];
  for (let beat = 0; beat < 8; beat += 0.5) {
    notes.push({
      time: beat,
      note: beat === 7.5 && variant === 2 ? "ohat" : "hat",
      duration: 0.125,
      velocity: Number.isInteger(beat) ? 0.56 : 0.4,
    });
  }
  [0, 2.5, 4, variant === 0 ? 6 : 6.5].forEach((time, index) => {
    notes.push({ time, note: "kick", duration: 0.2, velocity: index === 0 ? 0.94 : 0.82 });
  });
  [1, 3, 5, 7].forEach((time) => {
    notes.push({ time, note: "snare", duration: 0.2, velocity: 0.88 });
  });
  if (variant === 1) {
    notes.push({ time: 6.75, note: "clap", duration: 0.15, velocity: 0.48 });
  }
  return notes.sort((a, b) => a.time - b.time);
}

export function createCreativeSeed({
  id,
  track,
  start,
  rootSemitone,
  scale,
  recipe,
  seed,
}: {
  id: string;
  track: Track;
  start: number;
  rootSemitone: number;
  scale: CreativeScale;
  recipe: CreativeRecipe;
  seed: string;
}): NoteClip {
  const safeRecipe = track.kind === "drums" ? "groove" : recipe === "groove" ? "motif" : recipe;
  const notes =
    safeRecipe === "groove"
      ? grooveNotes(seed)
      : safeRecipe === "chords"
        ? chordNotes(track.kind, rootSemitone, scale)
        : safeRecipe === "pulse"
          ? pulseNotes(track.kind, rootSemitone, scale)
          : motifNotes(track.kind, rootSemitone, scale, seed);
  return {
    id,
    start,
    length: 8,
    notes,
    name: `Compass · ${CREATIVE_RECIPE_COPY[safeRecipe].label}`,
    color: track.meta?.color,
    bars: 2,
    division: "1/16",
    scaleRoot: CREATIVE_ROOTS[rootSemitone] ?? "C",
    scaleMode:
      scale === "pentatonic_major"
        ? "pentMajor"
        : scale === "pentatonic_minor"
          ? "pentMinor"
          : scale,
  };
}

function boundedSourceNotes(source: NoteClip): NoteEvent[] {
  const firstWindow = source.notes.filter((note) => note.time >= 0 && note.time < 8);
  if (firstWindow.length > 0) return firstWindow.slice(0, 96).map((note) => ({ ...note }));
  const earliest = [...source.notes].sort((a, b) => a.time - b.time).slice(0, 96);
  const offset = earliest[0]?.time ?? 0;
  return earliest.map((note) => ({ ...note, time: Math.max(0, note.time - offset) % 8 }));
}

function drumVariation(notes: NoteEvent[], variation: CreativeVariation): NoteEvent[] {
  if (variation === "answer") {
    const base = notes.filter((note) => note.time < 7);
    return [
      ...base,
      { time: 7, note: "tomLow", duration: 0.16, velocity: 0.7 },
      { time: 7.25, note: "tomHigh", duration: 0.16, velocity: 0.75 },
      { time: 7.5, note: "snare", duration: 0.18, velocity: 0.86 },
      { time: 7.75, note: "crash", duration: 0.2, velocity: 0.68 },
    ].sort((a, b) => a.time - b.time);
  }
  if (variation === "lift") {
    const withoutBackbeats = notes.filter((note) => note.note !== "snare" && note.note !== "clap");
    return [
      ...withoutBackbeats,
      { time: 3, note: "snare", duration: 0.2, velocity: 0.9 },
      { time: 7, note: "snare", duration: 0.2, velocity: 0.92 },
    ].sort((a, b) => a.time - b.time);
  }
  return [
    ...notes.map((note, index) => ({
      ...note,
      velocity: Math.max(0.25, Math.min(1, note.velocity * (index % 2 === 0 ? 1 : 0.9))),
    })),
    { time: 0.75, note: "snare", duration: 0.12, velocity: 0.34 },
    { time: 4.75, note: "snare", duration: 0.12, velocity: 0.32 },
  ].sort((a, b) => a.time - b.time);
}

function melodicVariation(
  notes: NoteEvent[],
  variation: CreativeVariation,
  rootSemitone: number,
  scale: CreativeScale,
): NoteEvent[] {
  if (variation === "lift") {
    return notes.map((note) => {
      const midi = noteNameToMidi(note.note);
      return {
        ...note,
        note: midi !== null && note.time >= 4 ? midiToName(midi + 12) : note.note,
      };
    });
  }
  if (variation === "pocket") {
    return notes.map((note, index) => ({
      ...note,
      time: Math.min(7.875, note.time + (index % 2 === 1 ? 0.25 : 0)),
      duration: Math.max(0.125, note.duration * 0.72),
      velocity: Math.max(0.3, Math.min(1, note.velocity * (index % 4 === 0 ? 1.08 : 0.9))),
    }));
  }
  return notes.map((note, index) => {
    const midi = noteNameToMidi(note.note);
    if (midi === null) return { ...note };
    const answered = quantizeToCreativeScale(midi + (index % 3 === 0 ? 5 : 2), rootSemitone, scale);
    const isLast = index === notes.length - 1;
    const resolved = isLast
      ? quantizeToCreativeScale(
          Math.round((answered - rootSemitone) / 12) * 12 + rootSemitone,
          rootSemitone,
          scale,
        )
      : answered;
    return {
      ...note,
      note: midiToName(resolved),
      velocity: Math.max(0.3, Math.min(1, note.velocity * 0.92)),
    };
  });
}

export function createCreativeVariation({
  id,
  track,
  source,
  start,
  variation,
  rootSemitone,
  scale,
}: {
  id: string;
  track: Track;
  source: NoteClip;
  start: number;
  variation: CreativeVariation;
  rootSemitone: number;
  scale: CreativeScale;
}): NoteClip {
  const sourceNotes = boundedSourceNotes(source);
  if (sourceNotes.length === 0) {
    throw new Error("source clip must contain at least one note");
  }
  const notes =
    track.kind === "drums"
      ? drumVariation(sourceNotes, variation)
      : melodicVariation(sourceNotes, variation, rootSemitone, scale);
  const name =
    track.kind === "drums"
      ? variation === "answer"
        ? "Compass · Turnaround fill"
        : variation === "lift"
          ? "Compass · Half-time space"
          : "Compass · Ghost pocket"
      : variation === "answer"
        ? "Compass · Answer phrase"
        : variation === "lift"
          ? "Compass · Octave lift"
          : "Compass · Pocket edit";
  return {
    id,
    start,
    length: 8,
    notes,
    name,
    color: track.meta?.color,
    bars: 2,
    division: source.division ?? "1/16",
    scaleRoot: CREATIVE_ROOTS[rootSemitone] ?? source.scaleRoot ?? "C",
    scaleMode:
      scale === "pentatonic_major"
        ? "pentMajor"
        : scale === "pentatonic_minor"
          ? "pentMinor"
          : scale,
  };
}

export function nextCreativeClipStart(track: Track, bpm: number): number {
  const beatsPerSecond = bpm / 60;
  const noteEnd = track.noteClips.reduce(
    (latest, clip) => Math.max(latest, clip.start + clip.length),
    0,
  );
  const audioEnd = track.audioClips.reduce(
    (latest, clip) => Math.max(latest, clip.start + clip.durationSec * beatsPerSecond),
    0,
  );
  return Math.ceil(Math.max(noteEnd, audioEnd) / 4) * 4;
}

export function barsRequiredForClip(clip: NoteClip): number {
  return Math.max(1, Math.ceil((clip.start + clip.length) / 4));
}
