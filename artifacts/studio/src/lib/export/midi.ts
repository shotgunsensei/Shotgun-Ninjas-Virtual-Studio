import type { Project, Track } from "../../types";

const PPQ = 480;

const GM_DRUM_MAP: Record<string, number> = {
  kick: 36,
  snare: 38,
  hat: 42,
  ohat: 46,
  clap: 39,
  tomLow: 41,
  tomHigh: 48,
  crash: 49,
  fx: 54,
};

const NOTE_SEMITONES: Record<string, number> = {
  C: 0, "C#": 1, Db: 1,
  D: 2, "D#": 3, Eb: 3,
  E: 4,
  F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8,
  A: 9, "A#": 10, Bb: 10,
  B: 11,
};

export function noteNameToMidi(note: string): number {
  const m = note.match(/^([A-Ga-g][#b]?)(-?\d+)$/);
  if (!m) return 60;
  const semi = NOTE_SEMITONES[m[1]] ?? 0;
  const octave = parseInt(m[2], 10);
  return (octave + 1) * 12 + semi;
}

function writeVlq(value: number): number[] {
  if (value < 0) value = 0;
  const bytes: number[] = [value & 0x7f];
  value >>>= 7;
  while (value > 0) {
    bytes.unshift((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  return bytes;
}

function writeUint32(v: number): number[] {
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

function writeUint16(v: number): number[] {
  return [(v >>> 8) & 0xff, v & 0xff];
}

function writeString(s: string): number[] {
  return Array.from(s).map((c) => c.charCodeAt(0));
}

function buildTempoTrack(bpm: number): number[] {
  const uspqn = Math.round(60_000_000 / bpm);
  const events: number[] = [
    ...writeVlq(0),
    0xff, 0x51, 0x03,
    (uspqn >>> 16) & 0xff,
    (uspqn >>> 8) & 0xff,
    uspqn & 0xff,
    ...writeVlq(0),
    0xff, 0x2f, 0x00,
  ];
  return [
    ...writeString("MTrk"),
    ...writeUint32(events.length),
    ...events,
  ];
}

interface MidiNote {
  onTick: number;
  offTick: number;
  midiNote: number;
  velocity: number;
  channel: number;
}

function collectNotes(track: Track, startBeat: number, endBeat: number): MidiNote[] {
  const notes: MidiNote[] = [];
  const isDrum = track.kind === "drums";
  const channel = isDrum ? 9 : 0;

  for (const clip of track.noteClips) {
    for (const ev of clip.notes) {
      const absT = clip.start + ev.time;
      if (absT < startBeat || absT >= endBeat) continue;
      const relT = absT - startBeat;

      let midiNote: number;
      if (isDrum) {
        midiNote = GM_DRUM_MAP[ev.note] ?? 36;
      } else {
        midiNote = noteNameToMidi(ev.note);
      }

      const velocity = Math.max(1, Math.min(127, Math.round(ev.velocity * 127)));
      const onTick = Math.round(relT * PPQ);
      const offTick = Math.round((relT + Math.max(0.05, ev.duration)) * PPQ);

      notes.push({ onTick, offTick, midiNote, velocity, channel });
    }
  }

  notes.sort((a, b) => a.onTick - b.onTick);
  return notes;
}

function buildTrackChunk(notes: MidiNote[], trackName: string): number[] {
  type Ev = { tick: number; bytes: number[] };
  const events: Ev[] = [];

  events.push({
    tick: 0,
    bytes: [0xff, 0x03, trackName.length, ...writeString(trackName)],
  });

  for (const n of notes) {
    events.push({ tick: n.onTick, bytes: [0x90 | n.channel, n.midiNote, n.velocity] });
    events.push({ tick: n.offTick, bytes: [0x80 | n.channel, n.midiNote, 0] });
  }

  events.sort((a, b) => a.tick - b.tick);
  events.push({ tick: (events[events.length - 1]?.tick ?? 0) + 1, bytes: [0xff, 0x2f, 0x00] });

  let curTick = 0;
  const trackData: number[] = [];
  for (const ev of events) {
    const delta = Math.max(0, ev.tick - curTick);
    trackData.push(...writeVlq(delta), ...ev.bytes);
    curTick = ev.tick;
  }

  return [
    ...writeString("MTrk"),
    ...writeUint32(trackData.length),
    ...trackData,
  ];
}

export interface MidiExportOptions {
  startBeat?: number;
  endBeat?: number;
}

export function encodeMidiFile(
  project: Project,
  tracks: Track[],
  options: MidiExportOptions = {},
): Uint8Array {
  const startBeat = options.startBeat ?? 0;
  const endBeat = options.endBeat ?? project.bars * 4;

  const melodicTracks = tracks.filter((t) => t.kind !== "vocals");

  const header: number[] = [
    ...writeString("MThd"),
    ...writeUint32(6),
    ...writeUint16(1),
    ...writeUint16(1 + melodicTracks.length),
    ...writeUint16(PPQ),
  ];

  const tempoChunk = buildTempoTrack(project.bpm);

  const trackChunks: number[] = [];
  for (const track of melodicTracks) {
    const notes = collectNotes(track, startBeat, endBeat);
    const chunk = buildTrackChunk(notes, track.name);
    trackChunks.push(...chunk);
  }

  const all = [...header, ...tempoChunk, ...trackChunks];
  return new Uint8Array(all);
}

export function encodeSingleTrackMidi(
  project: Project,
  track: Track,
  options: MidiExportOptions = {},
): Uint8Array {
  const startBeat = options.startBeat ?? 0;
  const endBeat = options.endBeat ?? project.bars * 4;

  const header: number[] = [
    ...writeString("MThd"),
    ...writeUint32(6),
    ...writeUint16(1),
    ...writeUint16(2),
    ...writeUint16(PPQ),
  ];

  const tempoChunk = buildTempoTrack(project.bpm);
  const notes = collectNotes(track, startBeat, endBeat);
  const trackChunk = buildTrackChunk(notes, track.name);

  const all = [...header, ...tempoChunk, ...trackChunk];
  return new Uint8Array(all);
}
