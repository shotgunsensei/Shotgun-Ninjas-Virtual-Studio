import type { Project, Track } from "../../types";

const DIVISIONS = 480;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const STEP_ALTER: Record<string, { step: string; alter?: number }> = {
  C: { step: "C" }, "C#": { step: "C", alter: 1 },
  D: { step: "D" }, "D#": { step: "D", alter: 1 },
  E: { step: "E" },
  F: { step: "F" }, "F#": { step: "F", alter: 1 },
  G: { step: "G" }, "G#": { step: "G", alter: 1 },
  A: { step: "A" }, "A#": { step: "A", alter: 1 },
  B: { step: "B" },
  Db: { step: "D", alter: -1 }, Eb: { step: "E", alter: -1 },
  Gb: { step: "G", alter: -1 }, Ab: { step: "A", alter: -1 },
  Bb: { step: "B", alter: -1 },
};

function parseNoteName(note: string): { step: string; alter?: number; octave: number } | null {
  const m = note.match(/^([A-Ga-g][#b]?)(-?\d+)$/);
  if (!m) return null;
  const sa = STEP_ALTER[m[1]] ?? { step: m[1].toUpperCase() };
  return { ...sa, octave: parseInt(m[2], 10) };
}

function beatsToType(beats: number): { type: string; dots: number } {
  const types: Array<[number, string]> = [
    [4, "whole"], [3, "half"], [2, "half"], [1.5, "quarter"],
    [1, "quarter"], [0.75, "eighth"], [0.5, "eighth"],
    [0.375, "16th"], [0.25, "16th"], [0.125, "32nd"],
  ];
  let bestType = "quarter";
  let bestDots = 0;
  for (const [b, t] of types) {
    if (Math.abs(beats - b) < 0.05) { bestType = t; bestDots = 0; break; }
    if (Math.abs(beats - b * 1.5) < 0.05) { bestType = t; bestDots = 1; break; }
  }
  return { type: bestType, dots: bestDots };
}

function el(tag: string, attrs: Record<string, string | number>, ...children: string[]): string {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join("");
  if (children.length === 0) return `<${tag}${attrStr}/>`;
  return `<${tag}${attrStr}>${children.join("")}</${tag}>`;
}

function elText(tag: string, text: string | number): string {
  return `<${tag}>${text}</${tag}>`;
}

function buildNoteXml(
  note: string,
  durationBeats: number,
  isRest = false,
): string {
  const divs = Math.max(1, Math.round(durationBeats * DIVISIONS));
  const { type, dots } = beatsToType(durationBeats);

  const dotStr = Array(dots).fill("<dot/>").join("");

  if (isRest) {
    return `<note><rest/>${elText("duration", divs)}<type>${type}</type>${dotStr}</note>`;
  }

  const parsed = parseNoteName(note);
  if (!parsed) return "";

  const alterStr = parsed.alter !== undefined ? elText("alter", parsed.alter) : "";
  const pitchXml = `<pitch>${elText("step", parsed.step)}${alterStr}${elText("octave", parsed.octave)}</pitch>`;

  return `<note>${pitchXml}${elText("duration", divs)}<type>${type}</type>${dotStr}</note>`;
}

function buildMeasures(
  track: Track,
  totalBeats: number,
  bpm: number,
): string {
  const beatsPerMeasure = 4;
  const numMeasures = Math.max(1, Math.ceil(totalBeats / beatsPerMeasure));

  const allNotes: Array<{ beat: number; duration: number; note: string }> = [];
  for (const clip of track.noteClips) {
    for (const ev of clip.notes) {
      allNotes.push({
        beat: clip.start + ev.time,
        duration: Math.max(0.0625, ev.duration),
        note: ev.note,
      });
    }
  }
  allNotes.sort((a, b) => a.beat - b.beat);

  const measures: string[] = [];

  for (let m = 0; m < numMeasures; m++) {
    const mStart = m * beatsPerMeasure;
    const mEnd = mStart + beatsPerMeasure;

    const attrs =
      m === 0
        ? `<attributes>${elText("divisions", DIVISIONS)}<key>${elText("fifths", 0)}</key><time>${elText("beats", 4)}${elText("beat-type", 4)}</time><clef>${elText("sign", "G")}${elText("line", 2)}</clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>${elText("per-minute", Math.round(bpm))}</metronome></direction-type></direction>`
        : "";

    const mNotes = allNotes.filter((n) => n.beat >= mStart && n.beat < mEnd);

    let content = attrs;
    let cursor = mStart;

    for (const n of mNotes) {
      if (n.beat > cursor + 0.01) {
        const restDur = n.beat - cursor;
        content += buildNoteXml("", restDur, true);
      }
      const clampedDur = Math.min(n.duration, mEnd - n.beat);
      content += buildNoteXml(n.note, clampedDur);
      cursor = n.beat + clampedDur;
    }

    if (cursor < mEnd - 0.01) {
      content += buildNoteXml("", mEnd - cursor, true);
    }

    measures.push(`<measure number="${m + 1}">${content}</measure>`);
  }

  return measures.join("");
}

export function encodeMusicXml(
  project: Project,
  options: { startBeat?: number; endBeat?: number } = {},
): string {
  const startBeat = options.startBeat ?? 0;
  const endBeat = options.endBeat ?? project.bars * 4;
  const totalBeats = endBeat - startBeat;

  const melodicTracks = project.tracks.filter(
    (t) =>
      t.kind !== "drums" &&
      t.kind !== "vocals" &&
      t.noteClips.some((c) => c.notes.length > 0),
  );

  if (melodicTracks.length === 0) {
    throw new Error("No melodic tracks with notes to export.");
  }

  const partList = melodicTracks
    .map(
      (t, i) =>
        `<score-part id="P${i + 1}"><part-name>${escXml(t.name)}</part-name></score-part>`,
    )
    .join("");

  const parts = melodicTracks
    .map((t, i) => {
      const shiftedTrack: Track = {
        ...t,
        noteClips: t.noteClips.map((c) => ({
          ...c,
          start: c.start - startBeat,
        })),
      };
      return `<part id="P${i + 1}">${buildMeasures(shiftedTrack, totalBeats, project.bpm)}</part>`;
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n` +
    `<score-partwise version="4.0">` +
    `<work><work-title>${escXml(project.name)}</work-title></work>` +
    `<part-list>${partList}</part-list>` +
    parts +
    `</score-partwise>`
  );
}

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function hasMelodicTracks(project: Project): boolean {
  return project.tracks.some(
    (t) =>
      t.kind !== "drums" &&
      t.kind !== "vocals" &&
      t.noteClips.some((c) => c.notes.length > 0),
  );
}
