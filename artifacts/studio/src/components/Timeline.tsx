import { useEffect, useRef, useState } from "react";
import { useStore, getStore } from "../store";
import { audio } from "../lib/audio/engine";
import type { Track } from "../types";

const PX_PER_BEAT = 32;

export function Timeline() {
  const project = useStore((s) => s.project);
  const selectedTrackId = useStore((s) => s.selectedTrackId);

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

  return (
    <div className="flex-1 overflow-auto panel-inset relative">
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
  totalBeats,
}: {
  track: Track;
  selected: boolean;
  totalBeats: number;
}) {
  return (
    <div
      onClick={() => getStore().set({ selectedTrackId: track.id })}
      className={`relative h-16 border-b border-border/60 cursor-pointer ${
        selected ? "bg-primary/5" : ""
      } grid-bg`}
      style={{ width: totalBeats * PX_PER_BEAT }}
    >
      {track.noteClips.map((c) => (
        <NoteClipView key={c.id} track={track} clip={c} />
      ))}
      {track.audioClips.map((c) => (
        <AudioClipView
          key={c.id}
          track={track}
          clip={c}
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

function NoteClipView({ track, clip }: { track: Track; clip: { id: string; start: number; length: number; notes: Array<{ time: number; note: string; duration: number; velocity: number }> } }) {
  const left = clip.start * PX_PER_BEAT;
  const width = Math.max(20, clip.length * PX_PER_BEAT);
  // map melodic notes to vertical positions
  const isDrums = track.kind === "drums";
  return (
    <div
      className="absolute top-1.5 bottom-1.5 rounded-sm border border-primary/60 bg-primary/15 overflow-hidden"
      style={{ left, width }}
    >
      <div className="px-1.5 py-0.5 text-[10px] font-mono text-primary/90 bg-primary/20">
        {track.name} clip
      </div>
      <div className="absolute inset-x-0 top-4 bottom-0">
        {clip.notes.map((n, i) => {
          const x = (n.time / clip.length) * 100;
          const w = Math.max(1, (n.duration / clip.length) * 100);
          let y = 50;
          if (isDrums) {
            const order = ["kick", "tomLow", "snare", "clap", "tomHigh", "hat", "ohat", "crash"];
            const idx = order.indexOf(n.note);
            y = idx >= 0 ? 10 + idx * 10 : 50;
          } else {
            // note name to y: parse octave
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

function AudioClipView({ track, clip }: { track: Track; clip: { id: string; start: number; durationSec: number; blob?: Blob } }) {
  const project = useStore((s) => s.project);
  const beatsPerSecond = project.bpm / 60;
  const left = clip.start * PX_PER_BEAT;
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
      className="absolute top-1.5 bottom-1.5 rounded-sm border border-neon/60 bg-neon/10 overflow-hidden"
      style={{ left, width }}
    >
      <div className="px-1.5 py-0.5 text-[10px] font-mono text-neon bg-neon/15">
        {track.name} take · {clip.durationSec.toFixed(1)}s
      </div>
      <canvas
        ref={canvasRef}
        width={Math.max(50, Math.floor(width))}
        height={42}
        className="block w-full h-[42px]"
      />
    </div>
  );
}
