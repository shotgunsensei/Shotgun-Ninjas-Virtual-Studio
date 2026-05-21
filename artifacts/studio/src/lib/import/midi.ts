import type { NoteClip, NoteEvent, Track } from "../../types";
import { midiNoteToName } from "../midi/midi";

const GM_DRUM_REVERSE: Record<number, string> = {
  35: "kick", 36: "kick",
  38: "snare", 40: "snare",
  42: "hat", 44: "hat",
  46: "ohat",
  39: "clap",
  41: "tomLow", 43: "tomLow",
  45: "tomHigh", 47: "tomHigh", 48: "tomHigh",
  49: "crash", 51: "crash", 57: "crash",
  54: "fx", 56: "fx", 60: "fx",
};

function readVlq(data: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let bytesRead = 0;
  let byte: number;
  do {
    if (offset + bytesRead >= data.length) break;
    byte = data[offset + bytesRead];
    value = (value << 7) | (byte & 0x7f);
    bytesRead++;
  } while (byte & 0x80);
  return { value, bytesRead };
}

function readUint32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] ?? 0) << 24) |
    ((data[offset + 1] ?? 0) << 16) |
    ((data[offset + 2] ?? 0) << 8) |
    (data[offset + 3] ?? 0)
  ) >>> 0;
}

function readUint16(data: Uint8Array, offset: number): number {
  return (((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0)) >>> 0;
}

interface MidiTrackEvent {
  tick: number;
  type: "noteon" | "noteoff" | "tempo" | "trackname" | "other";
  channel?: number;
  note?: number;
  velocity?: number;
  tempoBpm?: number;
  name?: string;
}

function parseTrack(data: Uint8Array, offset: number, length: number): MidiTrackEvent[] {
  const events: MidiTrackEvent[] = [];
  const end = offset + length;
  let pos = offset;
  let curTick = 0;
  let runningStatus = 0;

  while (pos < end) {
    const { value: delta, bytesRead } = readVlq(data, pos);
    pos += bytesRead;
    curTick += delta;

    if (pos >= end) break;

    let statusByte = data[pos];

    if (statusByte === 0xff) {
      pos++;
      const metaType = data[pos++];
      const { value: metaLen, bytesRead: mlb } = readVlq(data, pos);
      pos += mlb;

      if (metaType === 0x51 && metaLen === 3) {
        const uspqn =
          ((data[pos] ?? 0) << 16) |
          ((data[pos + 1] ?? 0) << 8) |
          (data[pos + 2] ?? 0);
        const bpm = uspqn > 0 ? 60_000_000 / uspqn : 120;
        events.push({ tick: curTick, type: "tempo", tempoBpm: bpm });
      } else if (metaType === 0x03) {
        const nameBytes = data.subarray(pos, pos + metaLen);
        const name = new TextDecoder().decode(nameBytes);
        events.push({ tick: curTick, type: "trackname", name });
      }
      pos += metaLen;
      continue;
    }

    if (statusByte === 0xf0 || statusByte === 0xf7) {
      pos++;
      const { value: sysexLen, bytesRead: slb } = readVlq(data, pos);
      pos += slb + sysexLen;
      continue;
    }

    if (statusByte & 0x80) {
      runningStatus = statusByte;
      pos++;
    } else {
      statusByte = runningStatus;
    }

    const messageType = statusByte & 0xf0;
    const channel = statusByte & 0x0f;

    if (messageType === 0x90 || messageType === 0x80) {
      const note = data[pos++] ?? 0;
      const velocity = data[pos++] ?? 0;
      const isOn = messageType === 0x90 && velocity > 0;
      events.push({
        tick: curTick,
        type: isOn ? "noteon" : "noteoff",
        channel,
        note,
        velocity,
      });
    } else if (messageType === 0xa0) {
      pos += 2;
    } else if (messageType === 0xb0) {
      pos += 2;
    } else if (messageType === 0xc0) {
      pos += 1;
    } else if (messageType === 0xd0) {
      pos += 1;
    } else if (messageType === 0xe0) {
      pos += 2;
    } else {
      pos++;
    }
  }

  return events;
}

export interface ParsedMidiTrack {
  name: string;
  isDrum: boolean;
  notes: Array<{ startBeat: number; durationBeats: number; note: string; velocity: number }>;
}

export interface ParsedMidi {
  bpm: number;
  ppq: number;
  tracks: ParsedMidiTrack[];
}

export function parseMidiFile(buffer: ArrayBuffer): ParsedMidi {
  const data = new Uint8Array(buffer);

  if (
    data[0] !== 0x4d ||
    data[1] !== 0x54 ||
    data[2] !== 0x68 ||
    data[3] !== 0x64
  ) {
    throw new Error("Not a valid MIDI file (missing MThd header)");
  }

  const formatType = readUint16(data, 8);
  const numTracks = readUint16(data, 10);
  const ppq = readUint16(data, 12);

  if (formatType > 1) {
    throw new Error(`MIDI format type ${formatType} is not supported (only Type 0 and 1).`);
  }

  let bpm = 120;
  const allTrackEvents: MidiTrackEvent[][] = [];

  let pos = 14;
  for (let t = 0; t < numTracks; t++) {
    if (pos + 8 > data.length) break;

    const chunkId = String.fromCharCode(
      data[pos], data[pos + 1], data[pos + 2], data[pos + 3],
    );
    const chunkLength = readUint32(data, pos + 4);
    pos += 8;

    if (chunkId === "MTrk") {
      const events = parseTrack(data, pos, chunkLength);
      allTrackEvents.push(events);

      const tempoEv = events.find((e) => e.type === "tempo");
      if (tempoEv?.tempoBpm) bpm = tempoEv.tempoBpm;
    }

    pos += chunkLength;
  }

  const parsedTracks: ParsedMidiTrack[] = [];

  for (const events of allTrackEvents) {
    const nameEv = events.find((e) => e.type === "trackname");
    const trackName = nameEv?.name ?? "Track";

    const noteOns = events.filter((e) => e.type === "noteon");
    if (noteOns.length === 0) continue;

    const isDrum = noteOns.some((e) => e.channel === 9);

    const openNotes = new Map<number, { startTick: number; velocity: number }>();
    const notes: ParsedMidiTrack["notes"] = [];

    for (const ev of events) {
      if (ev.type === "noteon" && ev.note !== undefined && ev.velocity !== undefined) {
        openNotes.set(ev.note, { startTick: ev.tick, velocity: ev.velocity });
      } else if (ev.type === "noteoff" && ev.note !== undefined) {
        const open = openNotes.get(ev.note);
        if (open) {
          openNotes.delete(ev.note);
          const startBeat = open.startTick / ppq;
          const durationBeats = Math.max(0.0625, (ev.tick - open.startTick) / ppq);
          const noteName = isDrum
            ? (GM_DRUM_REVERSE[ev.note] ?? "kick")
            : midiNoteToName(ev.note);
          notes.push({
            startBeat,
            durationBeats,
            note: noteName,
            velocity: open.velocity / 127,
          });
        }
      }
    }

    for (const [midiNote, open] of openNotes.entries()) {
      const lastTick =
        events.reduce((max, e) => Math.max(max, e.tick), 0);
      const startBeat = open.startTick / ppq;
      const durationBeats = Math.max(0.0625, (lastTick - open.startTick) / ppq);
      const noteName = isDrum
        ? (GM_DRUM_REVERSE[midiNote] ?? "kick")
        : midiNoteToName(midiNote);
      notes.push({ startBeat, durationBeats, note: noteName, velocity: open.velocity / 127 });
    }

    if (notes.length > 0) {
      parsedTracks.push({ name: trackName, isDrum, notes });
    }
  }

  return { bpm, ppq, tracks: parsedTracks };
}

const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function midiTracksToNoteClips(parsed: ParsedMidiTrack): NoteClip {
  const notes: NoteEvent[] = parsed.notes.map((n) => ({
    time: n.startBeat,
    note: n.note,
    duration: n.durationBeats,
    velocity: n.velocity,
  }));

  const maxBeat =
    notes.reduce((m, n) => Math.max(m, n.time + n.duration), 0);
  const bars = Math.max(1, Math.ceil(maxBeat / 4));
  const length = bars * 4;

  return {
    id: newId(),
    start: 0,
    length,
    notes,
  };
}

export function midiToTrackPartials(
  parsed: ParsedMidi,
): Array<{ name: string; kind: Track["kind"]; clip: NoteClip }> {
  return parsed.tracks.map((t) => ({
    name: t.name,
    kind: t.isDrum ? "drums" : ("piano" as Track["kind"]),
    clip: midiTracksToNoteClips(t),
  }));
}
