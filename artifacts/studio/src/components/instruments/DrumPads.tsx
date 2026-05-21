import { useEffect, useMemo, useRef, useState } from "react";
import { audio, type DrumPiece, DRUM_PIECES } from "../../lib/audio/engine";
import { noteRecorder } from "../../lib/audio/recorder";
import { useMidiEvents } from "../../lib/midi/midi";
import { useStore, getStore, makeId } from "../../store";
import { getSettings } from "../../lib/settings";
import { MidiLearnButton } from "../MidiLearnButton";
import type {
  Track,
  NoteEvent,
  NoteClip,
  DrumKitId,
  DrumPieceSettings,
  StepDivision,
} from "../../types";
import { DRUM_KIT_LIST, findKit } from "../../lib/audio/sounds/kits";
import {
  addGhostNotes,
  generateBoomBap,
  generateCinematic,
  generateTrapHats,
  randomizeKit,
  randomizeLane,
  simplifyPattern,
} from "../../lib/audio/patterns";

const PAD_KEYS: Record<string, DrumPiece> = {
  q: "kick",
  w: "snare",
  e: "clap",
  r: "hat",
  a: "ohat",
  s: "tomLow",
  d: "tomHigh",
  f: "crash",
  g: "fx",
};

const LABELS: Record<DrumPiece, string> = {
  kick: "Kick",
  snare: "Snare",
  clap: "Clap",
  hat: "Hat",
  ohat: "O-Hat",
  tomLow: "Tom L",
  tomHigh: "Tom H",
  crash: "Crash",
  fx: "FX",
};

const VELOCITY_CYCLE = [0.55, 0.85, 1.0] as const;
type VelTier = "soft" | "normal" | "hard";
function velocityTier(v: number): VelTier {
  if (v <= 0.65) return "soft";
  if (v >= 0.95) return "hard";
  return "normal";
}

const DIVISIONS: { id: StepDivision; label: string; stepBeats: number }[] = [
  { id: "1/4", label: "1/4", stepBeats: 1 },
  { id: "1/8", label: "1/8", stepBeats: 0.5 },
  { id: "1/16", label: "1/16", stepBeats: 0.25 },
  { id: "1/16T", label: "1/16T", stepBeats: 1 / 6 },
  { id: "1/32", label: "1/32", stepBeats: 0.125 },
];

const BAR_OPTIONS = [1, 2, 4, 8] as const;

function divInfo(id: StepDivision | undefined) {
  return DIVISIONS.find((d) => d.id === (id ?? "1/16")) ?? DIVISIONS[2];
}

function clipBars(clip: NoteClip | undefined): number {
  if (clip?.bars) return clip.bars;
  if (!clip) return 1;
  return Math.max(1, Math.round(clip.length / 4));
}

function findStepNote(
  notes: NoteEvent[],
  piece: DrumPiece,
  beat: number,
): NoteEvent | undefined {
  const tol = 0.01;
  return notes.find(
    (n) => n.note === piece && Math.abs(n.time - beat) < tol,
  );
}

function replaceStepNote(
  clip: NoteClip,
  piece: DrumPiece,
  beat: number,
  patch: Partial<NoteEvent> | null,
  stepBeats: number,
): NoteClip {
  const existing = findStepNote(clip.notes, piece, beat);
  if (!patch) {
    return {
      ...clip,
      notes: clip.notes.filter((n) => n !== existing),
    };
  }
  if (existing) {
    return {
      ...clip,
      notes: clip.notes.map((n) =>
        n === existing ? { ...existing, ...patch } : n,
      ),
    };
  }
  const base: NoteEvent = {
    time: beat,
    note: piece,
    duration: stepBeats,
    velocity: 0.85,
    ...patch,
  };
  return { ...clip, notes: [...clip.notes, base] };
}

export function DrumPads({ track }: { track: Track }) {
  const isRecording = useStore((s) => s.isRecording);
  const midiMappings = useStore((s) => s.project.midiMappings);
  const isPlaying = useStore((s) => s.isPlaying);

  const clip = track.noteClips[0];
  const bars = clipBars(clip);
  const div = divInfo(clip?.division);
  const totalBeats = bars * 4;
  const totalSteps = Math.max(1, Math.round(totalBeats / div.stepBeats));
  const stepsPerBeat = 1 / div.stepBeats;

  const stepBeats = useMemo(
    () => Array.from({ length: totalSteps }, (_, i) => i * div.stepBeats),
    [totalSteps, div.stepBeats],
  );

  const playheadStep = usePlayheadStep(isPlaying, totalBeats, div.stepBeats);

  const PAD_LABEL_GUTTER = "3rem";
  const padRowTemplate = `var(--pad-label-gutter) repeat(${totalSteps}, minmax(0, 1fr))`;

  const ensureClip = (): NoteClip => {
    if (clip) return clip;
    const fresh: NoteClip = {
      id: makeId(),
      start: 0,
      length: totalBeats,
      notes: [],
      bars,
      division: div.id,
    };
    getStore().addNoteClip(track.id, fresh);
    return fresh;
  };

  const writeClip = (next: NoteClip) => {
    getStore().updateNoteClip(track.id, next);
  };

  const hit = (piece: DrumPiece, velocity = 0.95) => {
    audio.triggerDrum(track.id, piece, velocity);
    if (isRecording) noteRecorder.hit(track.id, piece, velocity);
  };

  const onCellClick = (
    e: React.MouseEvent,
    piece: DrumPiece,
    beat: number,
  ) => {
    const c = ensureClip();
    const existing = findStepNote(c.notes, piece, beat);
    if (e.shiftKey) {
      // shift-click cycles velocity through soft -> normal -> hard
      const cur = existing?.velocity ?? VELOCITY_CYCLE[1];
      const tier = velocityTier(cur);
      const nextTier: VelTier =
        tier === "soft" ? "normal" : tier === "normal" ? "hard" : "soft";
      const nextVel =
        VELOCITY_CYCLE[
          nextTier === "soft" ? 0 : nextTier === "normal" ? 1 : 2
        ];
      const accent = nextTier === "hard";
      writeClip(
        replaceStepNote(
          c,
          piece,
          beat,
          { velocity: nextVel, accent },
          div.stepBeats,
        ),
      );
      hit(piece, nextVel);
      return;
    }
    // normal click toggles
    writeClip(
      replaceStepNote(
        c,
        piece,
        beat,
        existing ? null : { velocity: 0.85 },
        div.stepBeats,
      ),
    );
    if (!existing) hit(piece, 0.85);
  };

  const [editor, setEditor] = useState<{
    piece: DrumPiece;
    beat: number;
  } | null>(null);

  const onCellContext = (
    e: React.MouseEvent,
    piece: DrumPiece,
    beat: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const c = ensureClip();
    if (!findStepNote(c.notes, piece, beat)) {
      writeClip(
        replaceStepNote(c, piece, beat, { velocity: 0.85 }, div.stepBeats),
      );
    }
    setEditor({ piece, beat });
  };

  // qwerty pads
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      const p = PAD_KEYS[e.key.toLowerCase()];
      if (!p) return;
      hit(p);
    };
    window.addEventListener("keydown", onDown);
    return () => window.removeEventListener("keydown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, isRecording]);

  // Flash state: track which drum pieces are highlighted by incoming MIDI
  const [midiFlash, setMidiFlash] = useState<Set<DrumPiece>>(new Set());

  const flashPiece = (piece: DrumPiece) => {
    setMidiFlash((prev) => new Set(prev).add(piece));
    window.setTimeout(() => {
      setMidiFlash((prev) => {
        const next = new Set(prev);
        next.delete(piece);
        return next;
      });
    }, 120);
  };

  useMidiEvents(
    (e) => {
      if (e.type !== "noteon") return;
      if (!getSettings().midiPassthrough) return;
      const idx = e.data1 - 36;
      if (idx >= 0 && idx < DRUM_PIECES.length) {
        const customMapped = midiMappings.find(
          (m) => m.signature === e.signature && m.target.kind === "drum-pad",
        );
        if (!customMapped) {
          hit(DRUM_PIECES[idx]);
          flashPiece(DRUM_PIECES[idx]);
        }
      }
    },
    [track.id, isRecording, midiMappings],
  );

  const [showMixer, setShowMixer] = useState(false);

  // ---- pattern actions ----
  const seedRef = useRef(1);
  const nextSeed = () => {
    seedRef.current = (seedRef.current * 1103515245 + 12345) & 0x7fffffff;
    return seedRef.current ^ Date.now();
  };

  const action = (label: string, build: (c: NoteClip) => NoteClip) => () => {
    const c = ensureClip();
    const next = build(c);
    writeClip(next);
    getStore().setStatus(label, "info");
  };

  const duplicateAction = action("Pattern duplicated", (c) => {
    // duplicate by appending a copy of all notes shifted by totalBeats
    // and growing the clip's bars/length to fit.
    const shifted = c.notes.map((n) => ({ ...n, time: n.time + totalBeats }));
    const newBars = bars * 2;
    return {
      ...c,
      bars: newBars,
      length: newBars * 4,
      notes: [...c.notes, ...shifted],
    };
  });
  const clearAction = action("Pattern cleared", (c) => ({ ...c, notes: [] }));
  const randomLaneAction = (piece: DrumPiece) =>
    action(`Randomized ${LABELS[piece]}`, (c) => ({
      ...c,
      notes: randomizeLane(c.notes, piece, totalBeats, nextSeed()),
    }));
  const randomKitAction = action("Kit randomized", (c) => ({
    ...c,
    notes: randomizeKit(c.notes, totalBeats, nextSeed()),
  }));
  const trapAction = action("Trap hats generated", (c) => ({
    ...c,
    notes: generateTrapHats(c.notes, totalBeats, nextSeed()),
  }));
  const boomBapAction = action("Boom-bap groove", (c) => ({
    ...c,
    notes: generateBoomBap(c.notes, totalBeats, nextSeed()),
  }));
  const cinematicAction = action("Cinematic hits", (c) => ({
    ...c,
    notes: generateCinematic(c.notes, totalBeats, nextSeed()),
  }));
  const simplifyAction = action("Pattern simplified", (c) => ({
    ...c,
    notes: simplifyPattern(c.notes),
  }));
  const ghostAction = action("Ghost notes added", (c) => ({
    ...c,
    notes: addGhostNotes(c.notes, totalBeats, nextSeed()),
  }));

  const setBars = (b: number) => {
    const c = ensureClip();
    writeClip({ ...c, bars: b, length: b * 4 });
  };
  const setDivision = (id: StepDivision) => {
    const c = ensureClip();
    // Re-snap existing notes' duration to the new step length so previously
    // toggled cells continue to read as "on" in the new grid.
    const newStep = divInfo(id).stepBeats;
    const notes = c.notes.map((n) => ({ ...n, duration: newStep }));
    writeClip({ ...c, division: id, notes });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {track.name} · Pads
        </span>
        <span className="font-mono text-[10px] text-muted-foreground hidden sm:inline">
          Q W E R / A S D F G
        </span>
      </div>

      <KitPicker track={track} />

      <div className="flex items-center justify-between">
        <button
          onClick={() => setShowMixer((s) => !s)}
          className={`text-[10px] font-mono px-2 py-0.5 border rounded transition-colors ${
            showMixer
              ? "border-primary/60 text-primary"
              : "border-border hover:border-primary/60"
          }`}
        >
          {showMixer ? "Hide" : "Show"} Piece Mixer
        </button>
      </div>

      {showMixer && <PieceMixer track={track} />}

      <div className="grid grid-cols-3 gap-2">
        {DRUM_PIECES.map((p) => (
          <div key={p} className="relative">
            <button
              onPointerDown={(e) => {
                // Use pointer events so a single handler covers mouse +
                // touch + stylus without firing twice on touch devices.
                e.preventDefault();
                hit(p);
              }}
              data-pad-trigger={p}
              className={`touch-pad w-full aspect-square panel-inset rounded-md border-2 transition-colors flex flex-col items-center justify-center ${
                midiFlash.has(p)
                  ? "border-primary bg-primary/30 glow-red"
                  : "border-border hover:border-primary/60 active:bg-primary/30 active:glow-red"
              }`}
            >
              <span className="font-mono text-xs font-semibold">{LABELS[p]}</span>
              <span className="font-mono text-[9px] text-muted-foreground mt-1">
                {Object.entries(PAD_KEYS).find(([, v]) => v === p)?.[0]?.toUpperCase() ?? ""}
              </span>
            </button>
            <div className="absolute top-1 right-1">
              <MidiLearnButton target={{ kind: "drum-pad", pad: p }} small />
            </div>
          </div>
        ))}
      </div>

      {/* Step sequencer */}
      <div
        className="panel-inset panel-glow rounded-md p-2 space-y-2"
        style={{ ["--pad-label-gutter" as string]: PAD_LABEL_GUTTER }}
        data-step-sequencer
        data-total-steps={totalSteps}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Sequencer · {totalSteps} steps
          </span>
          <div className="flex items-center gap-1 text-[9px] font-mono">
            <span className="text-muted-foreground">Bars</span>
            {BAR_OPTIONS.map((b) => (
              <button
                key={b}
                onClick={() => setBars(b)}
                className={`px-1.5 py-0.5 border rounded ${
                  bars === b
                    ? "border-primary text-primary"
                    : "border-border hover:border-primary/60"
                }`}
                data-bar-option={b}
              >
                {b}
              </button>
            ))}
            <span className="text-muted-foreground ml-2">Div</span>
            {DIVISIONS.map((d) => (
              <button
                key={d.id}
                onClick={() => setDivision(d.id)}
                className={`px-1.5 py-0.5 border rounded ${
                  div.id === d.id
                    ? "border-primary text-primary"
                    : "border-border hover:border-primary/60"
                }`}
                data-division={d.id}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <ActionBtn onClick={duplicateAction}>Duplicate</ActionBtn>
          <ActionBtn onClick={clearAction}>Clear</ActionBtn>
          <ActionBtn onClick={randomKitAction} data-action="randomize-kit">
            Random Kit
          </ActionBtn>
          <ActionBtn onClick={trapAction} data-action="trap">
            Trap Hats
          </ActionBtn>
          <ActionBtn onClick={boomBapAction} data-action="boombap">
            Boom Bap
          </ActionBtn>
          <ActionBtn onClick={cinematicAction} data-action="cinematic">
            Cinematic
          </ActionBtn>
          <ActionBtn onClick={simplifyAction} data-action="simplify">
            Simplify
          </ActionBtn>
          <ActionBtn onClick={ghostAction} data-action="ghosts">
            + Ghosts
          </ActionBtn>
        </div>

        {/* Beat-number header row — one label per beat, spanning the
            correct number of step columns so it aligns with the grid below.
            For multi-bar patterns we show a global beat index (1…N). */}
        <div
          className="grid items-end gap-x-0.5 pb-0.5 mb-0.5 border-b border-border/25"
          style={{ gridTemplateColumns: padRowTemplate }}
        >
          <div /> {/* gutter spacer */}
          {Array.from({ length: totalBeats }, (_, i) => (
            <div
              key={i}
              className="text-center font-mono text-[8px] text-muted-foreground/50 leading-none select-none"
              style={{ gridColumn: `span ${Math.round(stepsPerBeat)}` }}
            >
              {i + 1}
            </div>
          ))}
        </div>

        <div className="space-y-1">
          {DRUM_PIECES.map((piece) => (
            <div
              key={piece}
              className="grid items-center gap-x-0.5"
              style={{ gridTemplateColumns: padRowTemplate }}
            >
              <div className="flex items-center gap-0.5 pr-1">
                <button
                  onClick={randomLaneAction(piece)}
                  title={`Randomize ${LABELS[piece]}`}
                  className="font-mono text-[9px] text-muted-foreground hover:text-primary truncate text-left flex-1"
                  data-randomize-lane={piece}
                >
                  {LABELS[piece]}
                </button>
              </div>
              {stepBeats.map((beat, i) => (
                <StepCell
                  key={i}
                  index={i}
                  piece={piece}
                  beat={beat}
                  clip={clip}
                  stepsPerBeat={stepsPerBeat}
                  isPlaying={isPlaying}
                  playheadStep={playheadStep}
                  onClick={onCellClick}
                  onContext={onCellContext}
                />
              ))}
            </div>
          ))}
        </div>

        <p className="text-[9px] text-muted-foreground font-mono">
          Click toggles · Shift-click cycles velocity · Right-click / long-press
          opens step editor.
        </p>
      </div>

      {editor && clip && (
        <StepEditor
          clip={clip}
          piece={editor.piece}
          beat={editor.beat}
          stepBeats={div.stepBeats}
          onChange={(patch) =>
            writeClip(
              replaceStepNote(clip, editor.piece, editor.beat, patch, div.stepBeats),
            )
          }
          onClose={() => setEditor(null)}
          onClear={() => {
            writeClip(
              replaceStepNote(clip, editor.piece, editor.beat, null, div.stepBeats),
            );
            setEditor(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Single step cell. Extracted so we can attach a touch long-press handler
 * (which opens the step editor) without sprinkling timer refs through the
 * parent component for every cell in the grid.
 */
function StepCell({
  index: i,
  piece,
  beat,
  clip,
  stepsPerBeat,
  isPlaying,
  playheadStep,
  onClick,
  onContext,
}: {
  index: number;
  piece: DrumPiece;
  beat: number;
  clip: NoteClip | undefined;
  stepsPerBeat: number;
  isPlaying: boolean;
  playheadStep: number;
  onClick: (e: React.MouseEvent, piece: DrumPiece, beat: number) => void;
  onContext: (e: React.MouseEvent, piece: DrumPiece, beat: number) => void;
}) {
  const longPressRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);

  const ev = clip ? findStepNote(clip.notes, piece, beat) : undefined;
  const on = !!ev;
  const isBeat = Math.abs(i % stepsPerBeat) < 0.001;
  const isAtPlayhead = isPlaying && i === playheadStep;
  const startsBeat = i > 0 && Math.abs(i % stepsPerBeat) < 0.001;
  const accent = !!ev?.accent;
  const prob = ev?.probability ?? 1;
  const ret = ev?.retrigger ?? 1;
  const flam = !!ev?.flam;
  const tier = ev ? velocityTier(ev.velocity) : "normal";
  const fillCls = !on
    ? isBeat
      ? "bg-graphite/80 border-border"
      : "bg-graphite/40 border-border/60 hover:bg-graphite/60"
    : accent
      ? "bg-primary border-primary glow-red ring-1 ring-primary/80"
      : tier === "hard"
        ? "bg-primary border-primary glow-red"
        : tier === "soft"
          ? "bg-primary/40 border-primary/60"
          : "bg-primary/70 border-primary";

  const startLongPress = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch") return;
    longPressedRef.current = false;
    if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
    longPressRef.current = window.setTimeout(() => {
      longPressedRef.current = true;
      onContext(
        { preventDefault: () => undefined, stopPropagation: () => undefined } as unknown as React.MouseEvent,
        piece,
        beat,
      );
    }, 450);
  };
  const cancelLongPress = () => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  return (
    <div className="relative">
      {startsBeat && (
        <span
          aria-hidden
          className="pointer-events-none absolute -left-[2px] top-0 bottom-0 w-px bg-border/60"
        />
      )}
      <button
        onClick={(e) => {
          if (longPressedRef.current) {
            // Long-press already opened the step editor; suppress the
            // synthesized click so we don't also toggle the step off.
            longPressedRef.current = false;
            return;
          }
          onClick(e, piece, beat);
        }}
        onContextMenu={(e) => onContext(e, piece, beat)}
        onPointerDown={startLongPress}
        onPointerUp={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onPointerCancel={cancelLongPress}
        className={`block w-full h-4 rounded-[2px] border transition-colors relative ${fillCls} ${
          isAtPlayhead ? "ring-1 ring-neon" : ""
        }`}
        aria-label={`${LABELS[piece]} step ${i + 1}`}
        data-step
        data-piece={piece}
        data-step-index={i}
        data-on={on ? "1" : "0"}
        data-accent={accent ? "1" : "0"}
      >
        {on && prob < 1 && (
          <span
            aria-hidden
            data-marker="prob"
            className="absolute left-0 top-0 text-[7px] leading-none text-foreground/90 px-[1px]"
          >
            ?
          </span>
        )}
        {on && ret > 1 && (
          <span
            aria-hidden
            data-marker="retrigger"
            className="absolute right-0 top-0 text-[7px] leading-none text-foreground px-[1px] font-bold"
          >
            {ret > 4 ? "≣" : ret > 2 ? "≡" : "∥"}
          </span>
        )}
        {on && flam && (
          <span
            aria-hidden
            data-marker="flam"
            className="absolute left-0 bottom-0 w-1 h-1 rounded-full bg-foreground/80"
          />
        )}
      </button>
    </div>
  );
}

function ActionBtn({
  onClick,
  children,
  ...rest
}: {
  onClick: () => void;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      onClick={onClick}
      className="text-[10px] font-mono px-2 py-0.5 border border-border rounded hover:border-primary/60"
      {...rest}
    >
      {children}
    </button>
  );
}

function StepEditor({
  clip,
  piece,
  beat,
  stepBeats,
  onChange,
  onClose,
  onClear,
}: {
  clip: NoteClip;
  piece: DrumPiece;
  beat: number;
  stepBeats: number;
  onChange: (patch: Partial<NoteEvent>) => void;
  onClose: () => void;
  onClear: () => void;
}) {
  const ev = findStepNote(clip.notes, piece, beat);
  const velocity = ev?.velocity ?? 0.85;
  const probability = ev?.probability ?? 1;
  const microTiming = ev?.microTiming ?? 0;
  const retrigger = ev?.retrigger ?? 1;
  const flam = !!ev?.flam;
  const accent = !!ev?.accent;

  // close on Escape and on outside click
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      data-step-editor
      data-piece={piece}
      className="panel-inset rounded-md p-2 space-y-1.5 border border-primary/40 glow-red"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-primary">
          Step Editor · {LABELS[piece]} · {(beat + 1).toFixed(2)}
        </span>
        <button
          onClick={onClose}
          className="text-[9px] font-mono px-1.5 py-0.5 border border-border rounded hover:border-primary/60"
        >
          Close
        </button>
      </div>
      <Slider
        label="Velocity"
        value={velocity}
        onChange={(v) => onChange({ velocity: v })}
      />
      <Slider
        label="Probability"
        value={probability}
        onChange={(v) => onChange({ probability: v })}
      />
      <Slider
        label="Nudge"
        value={microTiming}
        min={-stepBeats}
        max={stepBeats}
        onChange={(v) => onChange({ microTiming: v })}
      />
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] text-muted-foreground w-16">
          Retrigger
        </span>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 6].map((n) => (
            <button
              key={n}
              onClick={() => onChange({ retrigger: n })}
              data-retrigger={n}
              className={`text-[9px] font-mono px-1.5 py-0.5 border rounded ${
                retrigger === n
                  ? "border-primary text-primary"
                  : "border-border"
              }`}
            >
              ×{n}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onChange({ flam: !flam })}
          data-flam-toggle
          className={`text-[9px] font-mono px-2 py-0.5 border rounded ${
            flam ? "border-primary text-primary" : "border-border"
          }`}
        >
          Flam
        </button>
        <button
          onClick={() => onChange({ accent: !accent })}
          data-accent-toggle
          className={`text-[9px] font-mono px-2 py-0.5 border rounded ${
            accent ? "border-primary text-primary" : "border-border"
          }`}
        >
          Accent
        </button>
        <div className="flex-1" />
        <button
          onClick={onClear}
          className="text-[9px] font-mono px-2 py-0.5 border border-border rounded hover:border-primary/60 text-muted-foreground"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[9px] text-muted-foreground w-16">
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={(max - min) / 100}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-3 accent-primary"
      />
      <span className="font-mono text-[9px] text-foreground/80 w-10 text-right">
        {Math.abs(max - min) <= 1
          ? Math.round(value * 100) + "%"
          : value.toFixed(2)}
      </span>
    </div>
  );
}

function KitPicker({ track }: { track: Track }) {
  const current = track.kitId;
  const set = (id: DrumKitId) => {
    audio.setKit(track.id, id);
    getStore().patchTrack(track.id, { kitId: id });
  };
  return (
    <div className="panel-inset rounded-md p-2 space-y-1">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Drum Kit
      </div>
      <div className="grid grid-cols-5 gap-1">
        {DRUM_KIT_LIST.map((k) => (
          <button
            key={k.id}
            onClick={() => set(k.id)}
            title={k.description}
            className={`text-[10px] font-mono px-1 py-1 rounded border transition-colors truncate ${
              current === k.id
                ? "border-primary text-primary glow-red"
                : "border-border hover:border-primary/60"
            }`}
          >
            {k.name.replace(/\s+Kit$/, "")}
          </button>
        ))}
      </div>
      {current && (
        <div className="text-[9px] text-muted-foreground font-mono pt-1">
          {findKit(current).description}
        </div>
      )}
    </div>
  );
}

function PieceMixer({ track }: { track: Track }) {
  const settings = (track.pieceSettings ?? {}) as Record<
    string,
    Partial<DrumPieceSettings> | undefined
  >;
  const update = (piece: DrumPiece, patch: Partial<DrumPieceSettings>) => {
    const next = {
      ...settings,
      [piece]: { ...(settings[piece] ?? {}), ...patch },
    };
    audio.setPieceSetting(track.id, piece, patch, next);
    getStore().patchTrack(track.id, { pieceSettings: next });
  };
  return (
    <div className="panel-inset rounded-md p-2 space-y-1">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
        Piece Mixer
      </div>
      <div className="grid grid-cols-[2.5rem_repeat(7,1fr)_auto_auto_auto_auto_auto] gap-x-1 gap-y-0.5 items-center text-[9px] font-mono text-muted-foreground">
        <div />
        <div className="text-center">Vol</div>
        <div className="text-center">Pan</div>
        <div className="text-center">Pit</div>
        <div className="text-center">Dec</div>
        <div className="text-center">Cut</div>
        <div className="text-center">Rev</div>
        <div className="text-center">Dly</div>
        <div className="text-center px-1">M</div>
        <div className="text-center px-1">S</div>
        <div className="text-center" title="MIDI: Volume">Mv</div>
        <div className="text-center" title="MIDI: Pan">Mp</div>
        <div className="text-center" title="MIDI: Pitch">Mt</div>
        {DRUM_PIECES.map((p) => {
          const s = settings[p] ?? {};
          const v = (k: keyof DrumPieceSettings, dflt: number) =>
            (s[k] as number | undefined) ?? dflt;
          return (
            <Row
              key={p}
              trackId={track.id}
              pieceId={p}
              label={LABELS[p]}
              vol={v("volume", 1)}
              pan={v("pan", 0)}
              pitch={v("pitch", 0)}
              decay={v("decay", 1)}
              cutoff={v("cutoff", 1)}
              reverb={v("reverbSend", 0)}
              delay={v("delaySend", 0)}
              muted={(s.muted as boolean | undefined) ?? false}
              solo={(s.solo as boolean | undefined) ?? false}
              onChange={(patch) => update(p, patch)}
            />
          );
        })}
      </div>
    </div>
  );
}

function Row({
  trackId,
  pieceId,
  label,
  vol,
  pan,
  pitch,
  decay,
  cutoff,
  reverb,
  delay,
  muted,
  solo,
  onChange,
}: {
  trackId: string;
  pieceId: string;
  label: string;
  vol: number;
  pan: number;
  pitch: number;
  decay: number;
  cutoff: number;
  reverb: number;
  delay: number;
  muted: boolean;
  solo: boolean;
  onChange: (patch: Partial<DrumPieceSettings>) => void;
}) {
  const slider = (val: number, on: (v: number) => void, min = 0, max = 1) => (
    <input
      type="range"
      min={min}
      max={max}
      step={(max - min) / 100}
      value={val}
      onChange={(e) => on(parseFloat(e.target.value))}
      className="w-full h-3 accent-primary"
    />
  );
  return (
    <>
      <div className="text-foreground/80 truncate text-[9px]">{label}</div>
      {slider(vol, (v) => onChange({ volume: v }))}
      {slider(pan, (v) => onChange({ pan: v }), -1, 1)}
      {slider(pitch, (v) => onChange({ pitch: v }), -12, 12)}
      {slider(decay, (v) => onChange({ decay: v }))}
      {slider(cutoff, (v) => onChange({ cutoff: v }))}
      {slider(reverb, (v) => onChange({ reverbSend: v }))}
      {slider(delay, (v) => onChange({ delaySend: v }))}
      <button
        onClick={() => onChange({ muted: !muted })}
        className={`px-1 rounded text-[9px] border ${
          muted ? "bg-primary/30 border-primary text-primary" : "border-border"
        }`}
        title="Mute"
      >
        M
      </button>
      <button
        onClick={() => onChange({ solo: !solo })}
        className={`px-1 rounded text-[9px] border ${
          solo ? "bg-accent/40 border-accent text-accent-foreground" : "border-border"
        }`}
        title="Solo"
      >
        S
      </button>
      <MidiLearnButton small target={{ kind: "drum-piece-volume", trackId, pieceId }} />
      <MidiLearnButton small target={{ kind: "drum-piece-pan", trackId, pieceId }} />
      <MidiLearnButton small target={{ kind: "drum-piece-pitch", trackId, pieceId }} />
      <MidiLearnButton small target={{ kind: "drum-piece-decay", trackId, pieceId }} />
      <MidiLearnButton small target={{ kind: "drum-piece-cutoff", trackId, pieceId }} />
      <MidiLearnButton small target={{ kind: "drum-piece-reverb", trackId, pieceId }} />
      <MidiLearnButton small target={{ kind: "drum-piece-delay", trackId, pieceId }} />
    </>
  );
}

function usePlayheadStep(
  isPlaying: boolean,
  totalBeats: number,
  stepBeats: number,
) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!isPlaying || totalBeats <= 0 || stepBeats <= 0) return;
    let raf = 0;
    let lastStep = -1;
    const tick = () => {
      // Skip rendering work when the tab is hidden — transport keeps
      // running, but we don't want to schedule unnecessary React work.
      if (!document.hidden) {
        const pos = audio.positionBeats() % totalBeats;
        const next = Math.floor(pos / stepBeats);
        // Only push a re-render when the lit cell actually changes,
        // not every animation frame.
        if (next !== lastStep) {
          lastStep = next;
          setStep(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, totalBeats, stepBeats]);
  return step;
}
