import { useEffect, useMemo, useRef, useState } from "react";
import { audio } from "../../lib/audio/engine";
import { getStore, makeId, useStore } from "../../store";
import type { NoteClip, NoteEvent, StepDivision, Track } from "../../types";

/**
 * Lightweight DOM piano roll for melodic tracks.
 *
 * Interactions:
 *   - Click/drag on the grid to draw a note one step long (drag right to
 *     extend before releasing).
 *   - Drag the body of a note to move it; drag the right edge to resize.
 *   - Click a note (without dragging) to select it; Delete key removes
 *     the selected note. Clicking the grid background clears selection.
 *   - When transport is stopped, drawing or clicking a note auditions it.
 *
 * Snap = current step division. A Key/Scale picker tints in-scale rows so
 * the player can stay in key by eye.
 */

const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
type KeyName = (typeof KEYS)[number];

type Mode = NonNullable<NoteClip["scaleMode"]>;
const MODES: { id: Mode; name: string; intervals: number[] }[] = [
  { id: "major", name: "Major", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "minor", name: "Minor", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "dorian", name: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "pentMajor", name: "Penta Maj", intervals: [0, 2, 4, 7, 9] },
  { id: "pentMinor", name: "Penta Min", intervals: [0, 3, 5, 7, 10] },
  { id: "chromatic", name: "Chromatic", intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];

const DIVISIONS: { id: StepDivision; label: string; stepBeats: number }[] = [
  { id: "1/4", label: "1/4", stepBeats: 1 },
  { id: "1/8", label: "1/8", stepBeats: 0.5 },
  { id: "1/16", label: "1/16", stepBeats: 0.25 },
  { id: "1/16T", label: "1/16T", stepBeats: 1 / 6 },
  { id: "1/32", label: "1/32", stepBeats: 0.125 },
];

const PX_PER_BEAT = 36;
const ROW_PX = 14;
const VEL_LANE_PX = 60;
const LOW_MIDI = 36; // C2
const HIGH_MIDI = 84; // C6
const ROW_COUNT = HIGH_MIDI - LOW_MIDI + 1;

function midiToName(midi: number): string {
  const oct = Math.floor(midi / 12) - 1;
  return `${KEYS[midi % 12]}${oct}`;
}
function nameToMidi(name: string): number | null {
  const m = /^([A-G]#?)(-?\d+)$/.exec(name);
  if (!m) return null;
  const idx = KEYS.indexOf(m[1] as KeyName);
  if (idx < 0) return null;
  return (parseInt(m[2], 10) + 1) * 12 + idx;
}
function inScale(midi: number, root: KeyName, mode: Mode): boolean {
  const intervals = MODES.find((m) => m.id === mode)?.intervals ?? [];
  const rootIdx = KEYS.indexOf(root);
  return intervals.includes(((midi - rootIdx) % 12 + 12) % 12);
}

function divInfo(id: StepDivision | undefined) {
  return DIVISIONS.find((d) => d.id === (id ?? "1/16")) ?? DIVISIONS[2];
}

export function PianoRoll({ track }: { track: Track }) {
  const isPlaying = useStore((s) => s.isPlaying);
  // Re-read the live clip on every render so edits push back into the panel.
  const clip = useStore((s) =>
    s.project.tracks.find((t) => t.id === track.id)?.noteClips[0],
  );

  const bars = clip?.bars ?? Math.max(1, Math.round((clip?.length ?? 4) / 4));
  const div = divInfo(clip?.division);
  const totalBeats = bars * 4;
  const widthPx = totalBeats * PX_PER_BEAT;
  const heightPx = ROW_COUNT * ROW_PX;
  const scaleRoot = (clip?.scaleRoot as KeyName | undefined) ?? "C";
  const scaleMode: Mode = (clip?.scaleMode as Mode | undefined) ?? "minor";

  const [selectedNoteIdx, setSelectedNoteIdx] = useState<number | null>(null);

  const ensureClip = (): NoteClip => {
    if (clip) return clip;
    const fresh: NoteClip = {
      id: makeId(),
      start: 0,
      length: totalBeats,
      notes: [],
      bars,
      division: div.id,
      scaleRoot,
      scaleMode,
    };
    getStore().addNoteClip(track.id, fresh);
    return fresh;
  };

  const writeClip = (next: NoteClip) => {
    getStore().updateNoteClip(track.id, next);
  };

  const snap = (beats: number) => Math.round(beats / div.stepBeats) * div.stepBeats;

  const gridRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);

  // Live playhead during playback (no React re-renders per frame).
  useEffect(() => {
    if (!isPlaying || !playheadRef.current) return;
    let raf = 0;
    const tick = () => {
      const pos = audio.positionBeats() % totalBeats;
      if (playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${pos * PX_PER_BEAT}px)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, totalBeats]);

  // Delete the selected note via keyboard (only when the roll has focus
  // semantics — selection lives in state, so listen always and clear when
  // text inputs are focused).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (selectedNoteIdx === null || !clip) return;
      e.preventDefault();
      const next = {
        ...clip,
        notes: clip.notes.filter((_, i) => i !== selectedNoteIdx),
      };
      writeClip(next);
      setSelectedNoteIdx(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNoteIdx, clip]);

  const auditionIfStopped = (midi: number, dur = 0.4, vel = 0.85) => {
    if (isPlaying) return;
    audio.triggerNote(track.id, midiToName(midi), dur, vel);
  };

  // Click/drag on the grid background draws a new note.
  const onGridMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const startBeats = snap(Math.max(0, (e.clientX - rect.left) / PX_PER_BEAT));
    const row = Math.floor((e.clientY - rect.top) / ROW_PX);
    const midi = HIGH_MIDI - row;
    if (midi < LOW_MIDI || midi > HIGH_MIDI) return;
    const startDur = div.stepBeats;
    const c = ensureClip();
    const note: NoteEvent = {
      time: Math.min(totalBeats - startDur, startBeats),
      note: midiToName(midi),
      duration: startDur,
      velocity: 0.85,
    };
    const nextNotes = [...c.notes, note];
    writeClip({ ...c, notes: nextNotes });
    setSelectedNoteIdx(nextNotes.length - 1);
    auditionIfStopped(midi);

    // Drag-extend while held.
    const onMove = (ev: MouseEvent) => {
      const liveBeats = Math.max(
        note.time + div.stepBeats,
        snap((ev.clientX - rect.left) / PX_PER_BEAT),
      );
      const dur = Math.max(div.stepBeats, liveBeats - note.time);
      const cur = getStore().state.project.tracks
        .find((t) => t.id === track.id)
        ?.noteClips[0];
      if (!cur) return;
      const idx = cur.notes.length - 1;
      const updated = cur.notes.slice();
      updated[idx] = { ...updated[idx], duration: dur };
      getStore().updateNoteClip(track.id, { ...cur, notes: updated });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Drag-to-move and drag-edge-to-resize for a single note.
  const startNoteDrag = (
    e: React.MouseEvent,
    idx: number,
    mode: "move" | "resize",
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!clip) return;
    const startEv = clip.notes[idx];
    if (!startEv) return;
    setSelectedNoteIdx(idx);
    if (mode === "move") {
      const midi = nameToMidi(startEv.note);
      if (midi !== null) auditionIfStopped(midi);
    }
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const onMove = (ev: MouseEvent) => {
      const dxPx = ev.clientX - startX;
      const dyPx = ev.clientY - startY;
      if (!moved && Math.abs(dxPx) < 2 && Math.abs(dyPx) < 2) return;
      moved = true;
      const dBeats = snap(dxPx / PX_PER_BEAT);
      const cur = getStore().state.project.tracks
        .find((t) => t.id === track.id)
        ?.noteClips[0];
      if (!cur) return;
      const arr = cur.notes.slice();
      const n = arr[idx];
      if (!n) return;
      if (mode === "move") {
        const dRow = Math.round(dyPx / ROW_PX);
        const origMidi = nameToMidi(startEv.note);
        const newMidi =
          origMidi !== null
            ? Math.max(
                LOW_MIDI,
                Math.min(HIGH_MIDI, origMidi - dRow),
              )
            : null;
        const newTime = Math.max(
          0,
          Math.min(totalBeats - n.duration, startEv.time + dBeats),
        );
        arr[idx] = {
          ...n,
          time: newTime,
          note: newMidi !== null ? midiToName(newMidi) : n.note,
        };
      } else {
        const newDur = Math.max(
          div.stepBeats,
          Math.min(totalBeats - n.time, startEv.duration + dBeats),
        );
        arr[idx] = { ...n, duration: newDur };
      }
      getStore().updateNoteClip(track.id, { ...cur, notes: arr });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const setScale = (root: KeyName, mode: Mode) => {
    const c = ensureClip();
    writeClip({ ...c, scaleRoot: root, scaleMode: mode });
  };
  const setDivision = (id: StepDivision) => {
    const c = ensureClip();
    writeClip({ ...c, division: id });
  };

  const beatLines = useMemo(
    () => Array.from({ length: Math.max(1, totalBeats) + 1 }, (_, i) => i),
    [totalBeats],
  );

  const notes = clip?.notes ?? [];

  return (
    <div
      className="panel-inset panel-glow rounded-md p-2 space-y-2"
      data-piano-roll
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Piano Roll · {bars} bar{bars > 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-1 text-[9px] font-mono">
          <span className="text-muted-foreground">Key</span>
          <select
            value={scaleRoot}
            onChange={(e) => setScale(e.target.value as KeyName, scaleMode)}
            className="bg-graphite border border-border rounded px-1 py-0.5 text-foreground"
            data-scale-root
          >
            {KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <select
            value={scaleMode}
            onChange={(e) => setScale(scaleRoot, e.target.value as Mode)}
            className="bg-graphite border border-border rounded px-1 py-0.5 text-foreground"
            data-scale-mode
          >
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground ml-2">Snap</span>
          {DIVISIONS.map((d) => (
            <button
              key={d.id}
              onClick={() => setDivision(d.id)}
              className={`px-1 py-0.5 border rounded ${
                div.id === d.id
                  ? "border-primary text-primary"
                  : "border-border hover:border-primary/60"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className="relative overflow-auto border border-border rounded-sm bg-graphite/40"
        style={{ maxHeight: 260 }}
      >
        <div
          ref={gridRef}
          onMouseDown={onGridMouseDown}
          onClick={(e) => {
            if (e.target === gridRef.current) setSelectedNoteIdx(null);
          }}
          style={{ width: widthPx, height: heightPx, position: "relative" }}
        >
          {/* row stripes (scale highlight) */}
          {Array.from({ length: ROW_COUNT }, (_, i) => {
            const midi = HIGH_MIDI - i;
            const isKey = midi % 12 === KEYS.indexOf(scaleRoot);
            const isIn = inScale(midi, scaleRoot, scaleMode);
            const isBlack = [1, 3, 6, 8, 10].includes(midi % 12);
            const cls = isKey
              ? "bg-primary/15"
              : isIn
                ? "bg-foreground/5"
                : isBlack
                  ? "bg-graphite/70"
                  : "bg-graphite/30";
            return (
              <div
                key={midi}
                className={`absolute left-0 right-0 ${cls}`}
                style={{ top: i * ROW_PX, height: ROW_PX }}
              />
            );
          })}
          {/* vertical beat lines */}
          {beatLines.map((b) => (
            <div
              key={b}
              className={`absolute top-0 bottom-0 ${
                b % 4 === 0 ? "bg-border" : "bg-border/40"
              }`}
              style={{ left: b * PX_PER_BEAT, width: 1 }}
            />
          ))}
          {/* notes */}
          {notes.map((n, idx) => {
            const midi = nameToMidi(n.note);
            if (midi === null) return null;
            const row = HIGH_MIDI - midi;
            if (row < 0 || row >= ROW_COUNT) return null;
            const left = n.time * PX_PER_BEAT;
            const width = Math.max(6, n.duration * PX_PER_BEAT);
            const top = row * ROW_PX;
            const sel = selectedNoteIdx === idx;
            return (
              <div
                key={idx}
                onMouseDown={(e) => startNoteDrag(e, idx, "move")}
                data-piano-note={idx}
                className={`absolute rounded-sm border ${
                  sel
                    ? "bg-primary border-primary ring-1 ring-primary/80 glow-red"
                    : "bg-primary/70 border-primary"
                }`}
                style={{
                  left,
                  width,
                  top: top + 1,
                  height: ROW_PX - 2,
                  opacity: 0.5 + n.velocity * 0.5,
                }}
              >
                <div
                  onMouseDown={(e) => startNoteDrag(e, idx, "resize")}
                  data-piano-note-resize={idx}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-foreground/40"
                />
              </div>
            );
          })}
          {/* playhead */}
          {isPlaying && (
            <div
              ref={playheadRef}
              aria-hidden
              className="absolute top-0 bottom-0 w-px bg-primary glow-red pointer-events-none"
              style={{ transform: "translateX(0)" }}
            />
          )}
        </div>
      </div>

      {/* Velocity lane */}
      <div
        className="relative border border-border rounded-sm bg-graphite/40 overflow-hidden"
        style={{ width: "100%", height: VEL_LANE_PX }}
        data-velocity-lane
      >
        <div
          className="relative"
          style={{ width: widthPx, height: VEL_LANE_PX }}
        >
          {notes.map((n, idx) => {
            const left = n.time * PX_PER_BEAT;
            const h = Math.max(2, n.velocity * VEL_LANE_PX);
            const sel = selectedNoteIdx === idx;
            return (
              <div
                key={idx}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelectedNoteIdx(idx);
                  const startY = e.clientY;
                  const startVel = n.velocity;
                  const onMove = (ev: MouseEvent) => {
                    const dy = startY - ev.clientY;
                    const newVel = Math.max(
                      0.05,
                      Math.min(1, startVel + dy / VEL_LANE_PX),
                    );
                    const cur = getStore().state.project.tracks
                      .find((t) => t.id === track.id)
                      ?.noteClips[0];
                    if (!cur) return;
                    const arr = cur.notes.slice();
                    arr[idx] = { ...arr[idx], velocity: newVel };
                    getStore().updateNoteClip(track.id, { ...cur, notes: arr });
                  };
                  const onUp = () => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
                data-piano-velocity={idx}
                className={`absolute bottom-0 cursor-ns-resize ${
                  sel
                    ? "bg-primary"
                    : "bg-primary/60 hover:bg-primary/80"
                }`}
                style={{ left, width: 4, height: h }}
              />
            );
          })}
        </div>
      </div>

      <p className="text-[9px] text-muted-foreground font-mono">
        Drag on grid to draw · Drag note body to move · Drag right edge to
        resize · Delete to remove · Velocity lane drags vertically.
      </p>
    </div>
  );
}
