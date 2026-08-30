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
  const normalizedPitch = `${m[1][0].toUpperCase()}${m[1].slice(1)}`;
  const semi = NOTE_SEMITONES[normalizedPitch] ?? 0;
  const octave = parseInt(m[2], 10);
  return Math.max(0, Math.min(127, (octave + 1) * 12 + semi));
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

function writeAscii(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0) & 0x7f);
}

function writeUtf8(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

function buildTempoTrack(bpm: number): number[] {
  const safeBpm = Number.isFinite(bpm) ? Math.max(4, Math.min(960, bpm)) : 120;
  const uspqn = Math.max(1, Math.min(0xffffff, Math.round(60_000_000 / safeBpm)));
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
    ...writeAscii("MTrk"),
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
      const absT = Number(clip.start) + Number(ev.time);
      if (!Number.isFinite(absT)) continue;
      if (absT < startBeat || absT >= endBeat) continue;
      const relT = absT - startBeat;

      let midiNote: number;
      if (isDrum) {
        midiNote = GM_DRUM_MAP[ev.note] ?? 36;
      } else {
        midiNote = noteNameToMidi(ev.note);
      }

      const rawVelocity = Number.isFinite(ev.velocity) ? ev.velocity : 0.8;
      const velocity = Math.max(1, Math.min(127, Math.round(rawVelocity * 127)));
      const onTick = Math.round(relT * PPQ);
      const rawDuration = Number.isFinite(ev.duration) ? ev.duration : 0.25;
      const offTick = Math.max(
        onTick + 1,
        Math.round((relT + Math.max(1 / PPQ, rawDuration)) * PPQ),
      );

      notes.push({ onTick, offTick, midiNote, velocity, channel });
    }
  }

  notes.sort((a, b) =>
    a.channel - b.channel || a.midiNote - b.midiNote || a.onTick - b.onTick,
  );

  // Collapse exact duplicate attacks and shorten a prior same-pitch note to
  // the next attack. Without this, an earlier note-off can silence a newer
  // overlapping note in many DAWs and hardware synths.
  const normalized: MidiNote[] = [];
  for (const note of notes) {
    const previous = normalized[normalized.length - 1];
    if (
      previous &&
      previous.channel === note.channel &&
      previous.midiNote === note.midiNote
    ) {
      if (previous.onTick === note.onTick) {
        previous.velocity = Math.max(previous.velocity, note.velocity);
        previous.offTick = Math.max(previous.offTick, note.offTick);
        continue;
      }
      if (previous.offTick > note.onTick) {
        previous.offTick = Math.max(previous.onTick + 1, note.onTick);
      }
    }
    normalized.push({ ...note });
  }

  return normalized.sort((a, b) => a.onTick - b.onTick);
}

function buildTrackChunk(notes: MidiNote[], trackName: string): number[] {
  type Ev = { tick: number; order: number; bytes: number[] };
  const events: Ev[] = [];

  const nameBytes = writeUtf8(trackName);

  events.push({
    tick: 0,
    order: 0,
    bytes: [0xff, 0x03, ...writeVlq(nameBytes.length), ...nameBytes],
  });

  for (const n of notes) {
    events.push({
      tick: n.onTick,
      order: 2,
      bytes: [0x90 | n.channel, n.midiNote, n.velocity],
    });
    events.push({
      tick: n.offTick,
      order: 1,
      bytes: [0x80 | n.channel, n.midiNote, 0],
    });
  }

  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  events.push({
    tick: (events[events.length - 1]?.tick ?? 0) + 1,
    order: 3,
    bytes: [0xff, 0x2f, 0x00],
  });

  let curTick = 0;
  const trackData: number[] = [];
  for (const ev of events) {
    const delta = Math.max(0, ev.tick - curTick);
    trackData.push(...writeVlq(delta), ...ev.bytes);
    curTick = ev.tick;
  }

  return [
    ...writeAscii("MTrk"),
    ...writeUint32(trackData.length),
    ...trackData,
  ];
}

export interface MidiExportOptions {
  startBeat?: number;
  endBeat?: number;
}

function exportRange(project: Project, options: MidiExportOptions): [number, number] {
  const projectEnd = Math.max(1, Number(project.bars) * 4 || 4);
  const requestedStart = Number(options.startBeat ?? 0);
  const startBeat = Number.isFinite(requestedStart)
    ? Math.max(0, Math.min(projectEnd, requestedStart))
    : 0;
  const requestedEnd = Number(options.endBeat ?? projectEnd);
  const endBeat = Number.isFinite(requestedEnd) && requestedEnd > startBeat
    ? Math.min(projectEnd, requestedEnd)
    : projectEnd;
  return [startBeat, Math.max(startBeat + 1 / PPQ, endBeat)];
}

export function encodeMidiFile(
  project: Project,
  tracks: Track[],
  options: MidiExportOptions = {},
): Uint8Array {
  const [startBeat, endBeat] = exportRange(project, options);

  const melodicTracks = tracks.filter((t) => t.kind !== "vocals");

  const header: number[] = [
    ...writeAscii("MThd"),
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
  const [startBeat, endBeat] = exportRange(project, options);

  const header: number[] = [
    ...writeAscii("MThd"),
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
