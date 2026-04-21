import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useStore, getStore } from "../store";
import { audio } from "../lib/audio/engine";
import type { Track } from "../types";

const PX_PER_BEAT = 32;
// Snap clip drags to 1/4 of a beat so users can place takes precisely while
// still landing on a sensible musical grid.
const DRAG_SNAP_BEATS = 0.25;

export function Timeline() {
  const project = useStore((s) => s.project);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const selectedClipId = useStore((s) => s.selectedClipId);

  const totalBeats = project.bars * 4;
  const width = totalBeats * PX_PER_BEAT;

  const [playheadBeat, setPlayheadBeat] = useState(0);
  const isPlaying = useStore((s) => s.isPlaying);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setPlayheadBeat(audio.positionBeats() % (totalBeats || 1));
      raf = requestAnimationFrame(tick);
    };
    if (isPlaying) raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, totalBeats]);

  // Delete the selected clip with the keyboard, ignoring text inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      const id = getStore().state.selectedClipId;
      if (!id) return;
      const track = getStore().state.project.tracks.find(
        (t) =>
          t.noteClips.some((c) => c.id === id) ||
          t.audioClips.some((c) => c.id === id),
      );
      if (!track) return;
      e.preventDefault();
      getStore().removeClip(track.id, id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="flex-1 overflow-auto panel-inset relative"
      onMouseDown={(e) => {
        // Clicking empty timeline background clears clip selection.
        if (e.target === e.currentTarget) getStore().selectClip(null);
      }}
    >
      <div className="relative" style={{ width, minWidth: "100%" }}>
        {/* ruler */}
        <div className="h-7 sticky top-0 z-10 bg-graphite/95 border-b border-border flex">
          {Array.from({ length: project.bars }).map((_, bar) => (
            <div
              key={bar}
              className="flex-none border-r border-border/60 flex items-center pl-2 font-mono text-[10px] text-muted-foreground"
              style={{ width: 4 * PX_PER_BEAT }}
            >
              {bar + 1}
            </div>
          ))}
        </div>

        {/* tracks */}
        <div>
          {project.tracks.map((t) => (
            <TimelineRow
              key={t.id}
              track={t}
              selected={selectedTrackId === t.id}
              selectedClipId={selectedClipId}
              totalBeats={totalBeats}
            />
          ))}
        </div>

        {/* loop region */}
        {project.loopEnabled && (
          <div
            className="absolute top-0 bottom-0 bg-neon/10 border-l border-r border-neon/40 pointer-events-none"
            style={{
              left: project.loopStartBeat * PX_PER_BEAT,
              width: (project.loopEndBeat - project.loopStartBeat) * PX_PER_BEAT,
            }}
          />
        )}

        {/* playhead */}
        <div
          className="absolute top-0 bottom-0 w-px bg-primary glow-red pointer-events-none"
          style={{ left: playheadBeat * PX_PER_BEAT }}
        />
      </div>
    </div>
  );
}

function TimelineRow({
  track,
  selected,
  selectedClipId,
  totalBeats,
}: {
  track: Track;
  selected: boolean;
  selectedClipId: string | null;
  totalBeats: number;
}) {
  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          getStore().set({ selectedTrackId: track.id });
          getStore().selectClip(null);
        }
      }}
      className={`relative h-16 border-b border-border/60 cursor-pointer ${
        selected ? "bg-primary/5" : ""
      } grid-bg`}
      style={{ width: totalBeats * PX_PER_BEAT }}
    >
      {track.noteClips.map((c) => (
        <NoteClipView
          key={c.id}
          track={track}
          clip={c}
          isSelected={selectedClipId === c.id}
        />
      ))}
      {track.audioClips.map((c) => (
        <AudioClipView
          key={c.id}
          track={track}
          clip={c}
          isSelected={selectedClipId === c.id}
        />
      ))}
      {track.kind === "vocals" &&
        track.audioClips.length === 0 &&
        track.noteClips.length === 0 && (
          <VocalPlaceholder armed={track.armed} totalBeats={totalBeats} />
        )}
    </div>
  );
}

function VocalPlaceholder({
  armed,
  totalBeats,
}: {
  armed: boolean;
  totalBeats: number;
}) {
  return (
    <div
      className="absolute top-1.5 bottom-1.5 left-1 rounded-sm border border-dashed border-neon/50 bg-neon/5 flex items-center justify-center pointer-events-none"
      style={{ width: Math.max(120, totalBeats * PX_PER_BEAT - 8) }}
    >
      <span className="font-mono text-[10px] text-neon/80 tracking-wide px-2">
        {armed
          ? "Press ● record to capture vocals here"
          : "Arm this track (R on the channel) and record your vocals here"}
      </span>
    </div>
  );
}

/**
 * Shared drag-to-move behavior for clips on the timeline. Returns the
 * mouseDown handler and the live drag offset (in beats) used to shift the
 * visual position while the user is dragging.
 */
function useClipDrag({
  trackId,
  clipId,
  startBeat,
}: {
  trackId: string;
  clipId: string;
  startBeat: number;
}) {
  const [dragDelta, setDragDelta] = useState(0);
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // ignore drags that originate on the close button etc.
    if ((e.target as HTMLElement).closest("[data-clip-action]")) return;
    e.stopPropagation();
    e.preventDefault();
    getStore().set({ selectedTrackId: trackId });
    getStore().selectClip(clipId);
    const startX = e.clientX;
    let lastDelta = 0;
    const onMove = (ev: MouseEvent) => {
      const dxPx = ev.clientX - startX;
      const dxBeats = dxPx / PX_PER_BEAT;
      const snapped =
        Math.round(dxBeats / DRAG_SNAP_BEATS) * DRAG_SNAP_BEATS;
      // prevent dragging before beat 0
      const clamped = Math.max(-startBeat, snapped);
      lastDelta = clamped;
      setDragDelta(clamped);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (lastDelta !== 0) {
        getStore().moveClip(trackId, clipId, startBeat + lastDelta);
      }
      setDragDelta(0);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  return { onMouseDown, dragDelta };
}

function ClipDeleteButton({
  trackId,
  clipId,
}: {
  trackId: string;
  clipId: string;
}) {
  return (
    <button
      data-clip-action
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        getStore().removeClip(trackId, clipId);
      }}
      className="absolute top-0.5 right-0.5 z-10 w-4 h-4 rounded-sm bg-background/70 hover:bg-primary/70 text-foreground/80 hover:text-foreground flex items-center justify-center"
      aria-label="Delete clip"
      title="Delete clip"
    >
      <X className="w-2.5 h-2.5" />
    </button>
  );
}

function NoteClipView({
  track,
  clip,
  isSelected,
}: {
  track: Track;
  clip: { id: string; start: number; length: number; notes: Array<{ time: number; note: string; duration: number; velocity: number }> };
  isSelected: boolean;
}) {
  const { onMouseDown, dragDelta } = useClipDrag({
    trackId: track.id,
    clipId: clip.id,
    startBeat: clip.start,
  });
  const left = (clip.start + dragDelta) * PX_PER_BEAT;
  const width = Math.max(20, clip.length * PX_PER_BEAT);
  const isDrums = track.kind === "drums";
  return (
    <div
      onMouseDown={onMouseDown}
      className={`absolute top-1.5 bottom-1.5 rounded-sm border bg-primary/15 overflow-hidden cursor-grab active:cursor-grabbing ${
        isSelected
          ? "border-primary ring-1 ring-primary/70 glow-red"
          : "border-primary/60 hover:border-primary"
      }`}
      style={{ left, width }}
    >
      <div className="px-1.5 py-0.5 text-[10px] font-mono text-primary/90 bg-primary/20 pr-5">
        {track.name} clip
      </div>
      <ClipDeleteButton trackId={track.id} clipId={clip.id} />
      <div className="absolute inset-x-0 top-4 bottom-0 pointer-events-none">
        {clip.notes.map((n, i) => {
          const x = (n.time / clip.length) * 100;
          const w = Math.max(1, (n.duration / clip.length) * 100);
          let y = 50;
          if (isDrums) {
            const order = ["kick", "tomLow", "snare", "clap", "tomHigh", "hat", "ohat", "crash"];
            const idx = order.indexOf(n.note);
            y = idx >= 0 ? 10 + idx * 10 : 50;
          } else {
            const m = /([A-G]#?)(\d)/.exec(n.note);
            if (m) {
              const semis = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"].indexOf(m[1]);
              const oct = parseInt(m[2], 10);
              const total = oct * 12 + semis;
              y = 90 - ((total - 24) * 1.5);
              y = Math.max(5, Math.min(90, y));
            }
          }
          return (
            <div
              key={i}
              className="absolute h-1 bg-primary rounded-sm"
              style={{ left: `${x}%`, width: `${w}%`, top: `${y}%`, opacity: 0.4 + n.velocity * 0.6 }}
            />
          );
        })}
      </div>
    </div>
  );
}

function AudioClipView({
  track,
  clip,
  isSelected,
}: {
  track: Track;
  clip: { id: string; start: number; durationSec: number; blob?: Blob };
  isSelected: boolean;
}) {
  const project = useStore((s) => s.project);
  const beatsPerSecond = project.bpm / 60;
  const { onMouseDown, dragDelta } = useClipDrag({
    trackId: track.id,
    clipId: clip.id,
    startBeat: clip.start,
  });
  const left = (clip.start + dragDelta) * PX_PER_BEAT;
  const width = Math.max(20, clip.durationSec * beatsPerSecond * PX_PER_BEAT);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!clip.blob || !canvasRef.current) return;
    const cv = canvasRef.current;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let cancelled = false;
    (async () => {
      try {
        const arr = await clip.blob!.arrayBuffer();
        const ac = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const buf = await ac.decodeAudioData(arr);
        if (cancelled) return;
        const data = buf.getChannelData(0);
        const w = cv.width;
        const h = cv.height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "rgba(0, 200, 255, 0.6)";
        const step = Math.max(1, Math.floor(data.length / w));
        for (let x = 0; x < w; x++) {
          let min = 1.0;
          let max = -1.0;
          for (let j = 0; j < step; j++) {
            const v = data[x * step + j] ?? 0;
            if (v < min) min = v;
            if (v > max) max = v;
          }
          const y1 = ((1 - max) / 2) * h;
          const y2 = ((1 - min) / 2) * h;
          ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
        }
        ac.close();
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clip.blob]);

  return (
    <div
      onMouseDown={onMouseDown}
      className={`absolute top-1.5 bottom-1.5 rounded-sm border bg-neon/10 overflow-hidden cursor-grab active:cursor-grabbing ${
        isSelected
          ? "border-neon ring-1 ring-neon/70"
          : "border-neon/60 hover:border-neon"
      }`}
      style={{ left, width }}
    >
      <div className="px-1.5 py-0.5 text-[10px] font-mono text-neon bg-neon/15 pr-5">
        {track.name} take · {clip.durationSec.toFixed(1)}s
      </div>
      <ClipDeleteButton trackId={track.id} clipId={clip.id} />
      <canvas
        ref={canvasRef}
        width={Math.max(50, Math.floor(width))}
        height={42}
        className="block w-full h-[42px] pointer-events-none"
      />
    </div>
  );
}
