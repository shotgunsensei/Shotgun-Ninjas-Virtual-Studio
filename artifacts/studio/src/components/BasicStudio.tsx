import { memo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Drum,
  Music2,
  Plus,
  Save,
  Undo2,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  flushAutomationToEngine,
  getStore,
  makeId,
  makeTrack,
  useStore,
} from "../store";
import type { AnyPreset, NoteClip, Project, Track } from "../types";
import { audio } from "../lib/audio/engine";
import {
  CREATIVE_ROOTS,
  createCreativeSeed,
  creativeScaleFromScaleId,
  nextCreativeClipStart,
} from "../lib/creative/creativeCompass";
import {
  appendBasicClip,
  basicSongEnd,
  repeatBasicSong,
  toggleBasicNote,
} from "../lib/learning/basicWorkflow";

const fieldClass =
  "min-h-11 min-w-0 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const DRUM_ROWS = [
  { note: "kick", label: "Kick", description: "Low thump" },
  { note: "snare", label: "Snare", description: "Sharp clap" },
  { note: "hat", label: "Hi-hat", description: "Ticking sound" },
];
const SOUNDS: Record<
  Track["kind"],
  Array<{ value: AnyPreset; label: string }>
> = {
  drums: [
    { value: "acoustic", label: "Acoustic drums" },
    { value: "electronic", label: "Electronic drums" },
    { value: "trap", label: "Trap drums" },
  ],
  piano: [
    { value: "grand", label: "Grand piano" },
    { value: "electric", label: "Electric keys" },
    { value: "synth", label: "Synth keys" },
  ],
  guitar: [
    { value: "clean", label: "Clean guitar" },
    { value: "acoustic", label: "Acoustic guitar" },
    { value: "crunch", label: "Crunch guitar" },
  ],
  bass: [
    { value: "finger", label: "Finger bass" },
    { value: "synth", label: "Synth bass" },
    { value: "sub", label: "Sub bass" },
  ],
  vocals: [
    { value: "clean", label: "Clean voice" },
    { value: "warm", label: "Warm voice" },
    { value: "lofi", label: "Lo-fi voice" },
  ],
};

function learningAction(action: "beat" | "melody" | "arrange" | "mix") {
  window.dispatchEvent(
    new CustomEvent("studio:learning-action", { detail: { action } }),
  );
}

function clipLabel(clip: NoteClip, index: number) {
  return `${clip.name ?? `Clip ${index + 1}`} · song bar ${Math.floor(clip.start / 4) + 1}`;
}

/** Fixed note buttons are separate from transport state and never animate. */
const SimpleClipEditor = memo(function SimpleClipEditor({
  track,
  clip,
}: {
  track: Track;
  clip: NoteClip;
}) {
  const [requestedBar, setBar] = useState(0);
  const bars = Math.max(1, Math.ceil(clip.length / 4));
  const bar = Math.min(requestedBar, bars - 1);
  const drums = track.kind === "drums";
  const steps = drums ? 16 : 8;
  // Existing melodic pitches remain available, including notes outside a scale.
  // Page the pitch list so imported chords do not create an enormous piano roll.
  const [pitchPage, setPitchPage] = useState(0);
  const [initialPitches] = useState(() => {
    const root = Math.max(
      0,
      CREATIVE_ROOTS.findIndex((name) => name === (clip.scaleRoot ?? "A")),
    );
    const octave = track.kind === "bass" ? 2 : track.kind === "guitar" ? 3 : 4;
    const intervals =
      clip.scaleMode === "major" || clip.scaleMode === "pentMajor"
        ? [0, 2, 4, 7, 9]
        : [0, 3, 5, 7, 10];
    const suggested = intervals.map((interval) => {
      const midi = 12 * (octave + 1) + root + interval;
      return `${CREATIVE_ROOTS[midi % 12]}${Math.floor(midi / 12) - 1}`;
    });
    return [...new Set([...clip.notes.map((note) => note.note), ...suggested])];
  });
  const existingPitches = [...new Set(clip.notes.map((note) => note.note))];
  const pitches = [...new Set([...initialPitches, ...existingPitches])];
  const pages = Math.max(1, Math.ceil(pitches.length / 5));
  const page = Math.min(pitchPage, pages - 1);
  const rows = drums
    ? DRUM_ROWS
    : pitches
        .slice(page * 5, page * 5 + 5)
        .map((note) => ({ note, label: note, description: "Musical note" }));
  const hiddenNotes = clip.notes.filter(
    (note) =>
      note.time >= bar * 4 &&
      note.time < (bar + 1) * 4 &&
      (!rows.some((row) => row.note === note.note) ||
        Math.abs(
          note.time * (drums ? 4 : 2) - Math.round(note.time * (drums ? 4 : 2)),
        ) > 0.0001),
  ).length;

  const toggle = (note: string, time: number) => {
    const store = getStore();
    const current = store.state.project.tracks
      .find((item) => item.id === track.id)
      ?.noteClips.find((item) => item.id === clip.id);
    if (!current) return;
    const changed = toggleBasicNote(
      current,
      note,
      time,
      drums ? 0.2 : 0.45,
      note === "hat" ? 0.5 : 0.8,
    );
    if (changed === current) return;
    store.updateNoteClip(track.id, changed);
    store.set({ selectedTrackId: track.id, selectedClipId: clip.id });
    learningAction(drums ? "beat" : "melody");
  };

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="min-h-11 min-w-11 px-2"
            aria-label="Previous clip bar"
            disabled={bar === 0}
            onClick={() => setBar(bar - 1)}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <span className="text-sm tabular-nums">
            Clip bar {bar + 1} of {bars}
          </span>
          <Button
            variant="outline"
            className="min-h-11 min-w-11 px-2"
            aria-label="Next clip bar"
            disabled={bar + 1 >= bars}
            onClick={() => setBar(bar + 1)}
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => {
            const store = getStore();
            store.patchProject({
              bars: Math.max(
                store.state.project.bars,
                Math.ceil((clip.start + clip.length) / 4),
              ),
              loopEnabled: true,
              loopStartBeat: clip.start,
              loopEndBeat: clip.start + clip.length,
            });
            store.setStatus(
              "Loop set to this clip. Press Play to hear it with the other parts at these bars.",
            );
          }}
        >
          Loop this clip
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {drums
          ? "Tap a square to add a hit. Tap it again to remove it. Each group of four squares is one beat."
          : "Tap a square to add a note. Tap it again to remove it. Try a few notes with spaces between them."}
      </p>
      <div
        className="overflow-x-auto pb-2"
        tabIndex={0}
        role="region"
        aria-label={
          drums
            ? "Drum steps, scroll sideways on a small screen"
            : "Musical note steps"
        }
      >
        <div
          className={cn(
            "grid gap-1.5",
            drums ? "min-w-[730px]" : "min-w-[400px]",
          )}
          style={{
            gridTemplateColumns: `64px repeat(${steps}, minmax(32px, 1fr))`,
          }}
        >
          <span className="sr-only">Sound</span>
          <span aria-hidden />
          {Array.from({ length: steps }, (_, step) => (
            <span
              key={step}
              aria-hidden
              className="text-center text-[10px] text-muted-foreground tabular-nums"
            >
              {step % (steps / 4) === 0
                ? `Beat ${step / (steps / 4) + 1}`
                : "·"}
            </span>
          ))}
          {rows.map((row) => (
            <div key={row.note} className="contents">
              <span
                className="self-center text-xs font-medium"
                title={row.description}
              >
                {row.label}
              </span>
              {Array.from({ length: steps }, (_, step) => {
                const time = bar * 4 + (step * 4) / steps;
                const on = clip.notes.some(
                  (note) =>
                    note.note === row.note &&
                    Math.abs(note.time - time) < 0.0001,
                );
                return (
                  <button
                    key={step}
                    type="button"
                    data-testid={`basic-step-${row.note}-${step}`}
                    aria-label={`${row.label}, clip bar ${bar + 1}, step ${step + 1}`}
                    aria-pressed={on}
                    disabled={time >= clip.length}
                    onClick={() => toggle(row.note, time)}
                    className={cn(
                      "flex min-h-11 items-center justify-center rounded-md border text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : step % (steps / 4) === 0
                          ? "border-foreground/35 bg-muted"
                          : "border-border bg-background hover:bg-muted",
                    )}
                  >
                    {on ? (
                      <Check className="size-4" aria-hidden />
                    ) : (
                      <span aria-hidden>·</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {!drums && pages > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={page === 0}
            onClick={() => setPitchPage(page - 1)}
          >
            Previous notes
          </Button>
          <span className="text-xs text-muted-foreground">
            Note group {page + 1} of {pages}
          </span>
          <Button
            variant="outline"
            disabled={page + 1 >= pages}
            onClick={() => setPitchPage(page + 1)}
          >
            More notes
          </Button>
        </div>
      )}
      {hiddenNotes > 0 && (
        <p className="text-xs text-muted-foreground">
          This bar also has {hiddenNotes} {hiddenNotes === 1 ? "note" : "notes"}{" "}
          outside this simple grid.{" "}
          {drums
            ? "Advanced shows every drum and timing detail."
            : "Use the note groups or Advanced to see more detail."}{" "}
          Your other notes stay in the song.
        </p>
      )}
    </div>
  );
});

function ClipPicker({
  track,
  clip,
  onChange,
}: {
  track: Track;
  clip?: NoteClip;
  onChange: (id: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
      Clip to edit
      <select
        className={fieldClass}
        value={clip?.id ?? ""}
        onChange={(event) => onChange(event.target.value)}
        disabled={!track.noteClips.length}
      >
        {!track.noteClips.length && (
          <option value="">No notes yet — add an idea below</option>
        )}
        {track.noteClips.map((item, index) => (
          <option value={item.id} key={item.id}>
            {clipLabel(item, index)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function BasicStudio() {
  const project = useStore((state) => state.project);
  const selectedTrackId = useStore((state) => state.selectedTrackId);
  const selectedClipId = useStore((state) => state.selectedClipId);
  const loadRevision = useStore((state) => state.projectLoadRevision);
  const [drumTrackId, setDrumTrackId] = useState("");
  const [melodicTrackId, setMelodicTrackId] = useState("");
  const [drumClipId, setDrumClipId] = useState("");
  const [melodicClipId, setMelodicClipId] = useState("");
  const [ideaSection, setIdeaSection] = useState<{
    projectId: string;
    loadRevision: number;
    start: number;
  } | null>(null);
  const [repeatSource, setRepeatSource] = useState<{
    project: Project;
    loadRevision: number;
  } | null>(null);
  const [undo, setUndo] = useState<{
    previous: Project;
    applied: Project;
    loadRevision: number;
    trackId: string;
    clipId: string | null;
  } | null>(null);
  const drums = project.tracks.filter((track) => track.kind === "drums");
  const melodic = project.tracks.filter(
    (track) => track.kind !== "drums" && track.kind !== "vocals",
  );
  const drum =
    drums.find((track) => track.id === selectedTrackId) ??
    drums.find((track) => track.id === drumTrackId) ??
    drums[0];
  const melody =
    melodic.find((track) => track.id === selectedTrackId) ??
    melodic.find((track) => track.id === melodicTrackId) ??
    melodic[0];
  const drumClip =
    drum?.noteClips.find((clip) => clip.id === selectedClipId) ??
    drum?.noteClips.find((clip) => clip.id === drumClipId) ??
    drum?.noteClips[0];
  const melodyClip =
    melody?.noteClips.find((clip) => clip.id === selectedClipId) ??
    melody?.noteClips.find((clip) => clip.id === melodicClipId) ??
    melody?.noteClips[0];
  const songEnd = basicSongEnd(project);
  const sourceSong =
    repeatSource?.project.id === project.id &&
    repeatSource.loadRevision === loadRevision
      ? repeatSource.project
      : project;
  const canUndo = Boolean(
    undo && undo.applied === project && undo.loadRevision === loadRevision,
  );

  const applyAddition = (patch: Partial<Project>) => {
    const store = getStore();
    const previous = store.state.project;
    const trackId = store.state.selectedTrackId;
    const clipId = store.state.selectedClipId;
    store.patchProject(patch);
    setUndo({
      previous,
      applied: store.state.project,
      loadRevision: store.state.projectLoadRevision,
      trackId,
      clipId,
    });
  };

  const select = (track: Track, clipId?: string) => {
    if (track.kind === "drums") {
      setDrumTrackId(track.id);
      if (clipId) setDrumClipId(clipId);
    } else {
      setMelodicTrackId(track.id);
      if (clipId) setMelodicClipId(clipId);
    }
    getStore().set({
      selectedTrackId: track.id,
      selectedClipId: clipId ?? null,
    });
  };

  const addIdea = (kind: "drums" | "bass" | "piano", empty = false) => {
    const store = getStore();
    const current = store.state.project;
    const preferred =
      kind === "drums"
        ? drum
        : kind === "bass"
          ? current.tracks.find((track) => track.kind === "bass")
          : melody?.kind !== "bass"
            ? melody
            : undefined;
    const track =
      current.tracks.find((item) => item.id === preferred?.id) ??
      current.tracks.find((item) => item.kind === kind) ??
      makeTrack(
        kind,
        kind === "drums" ? "Drums" : kind === "bass" ? "Bass" : "Melody",
        kind === "drums"
          ? "electronic"
          : kind === "bass"
            ? "finger"
            : "electric",
      );
    const anchor =
      kind !== "drums" &&
      ideaSection?.projectId === current.id &&
      ideaSection.loadRevision === store.state.projectLoadRevision
        ? ideaSection.start
        : basicSongEnd(current);
    const start = Math.max(
      anchor,
      nextCreativeClipStart(track, current.bpm),
      current.loopEnabled ? current.loopStartBeat : 0,
    );
    const clip = createCreativeSeed({
      id: makeId(),
      track,
      start,
      rootSemitone: current.performance?.scaleRoot ?? 9,
      scale: creativeScaleFromScaleId(current.performance?.scaleId),
      recipe: kind === "drums" ? "groove" : kind === "bass" ? "pulse" : "motif",
      seed: `${current.id}:${track.id}:${track.noteClips.length}`,
    });
    clip.name = empty
      ? "My beat"
      : kind === "drums"
        ? "Starter beat"
        : kind === "bass"
          ? "Bass idea"
          : "Melody idea";
    if (empty) clip.notes = [];
    else if (kind === "drums")
      clip.notes = clip.notes.filter((note) =>
        DRUM_ROWS.some((row) => row.note === note.note),
      );
    else
      clip.notes = clip.notes.map((note) => ({
        ...note,
        time: Math.round(note.time * 2) / 2,
      }));
    applyAddition(appendBasicClip(current, track, clip));
    setIdeaSection({
      projectId: current.id,
      loadRevision: store.state.projectLoadRevision,
      start: anchor,
    });
    select(track, clip.id);
    store.setStatus(
      `${clip.name} added at song bar ${Math.floor(start / 4) + 1}. Choose Loop this clip, then Play to hear it.`,
    );
    if (!empty) learningAction(kind === "drums" ? "beat" : "melody");
  };

  return (
    <div
      data-testid="basic-studio"
      className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-background p-3 pb-12 sm:p-5"
    >
      <div className="mx-auto max-w-6xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Make a beat. Build a song.</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Start with a rhythm, add notes, then balance the sounds. A track is
            one instrument. A clip is a block of music on that track. Use Play
            above to listen as you make changes.
          </p>
          {undo?.previous.id === project.id &&
            undo.loadRevision === loadRevision && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  className="min-h-11"
                  data-testid="basic-undo"
                  disabled={!canUndo}
                  onClick={() => {
                    const store = getStore();
                    if (
                      !undo ||
                      store.state.project !== undo.applied ||
                      store.state.projectLoadRevision !== undo.loadRevision
                    )
                      return;
                    for (const track of store.state.project.tracks) {
                      if (
                        !undo.previous.tracks.some(
                          (item) => item.id === track.id,
                        )
                      )
                        audio.removeTrack(track.id);
                    }
                    store.patchProject(undo.previous);
                    flushAutomationToEngine(store.state.project);
                    store.set({
                      selectedTrackId: undo.trackId,
                      selectedClipId: undo.clipId,
                    });
                    setUndo(null);
                    store.setStatus(
                      "Your latest addition was undone. Your earlier music is still here.",
                    );
                  }}
                >
                  <Undo2 aria-hidden />
                  Undo latest addition
                </Button>
                <span className="text-xs text-muted-foreground">
                  Available until you make another project change.
                </span>
              </div>
            )}
        </div>
        <section
          data-learning-target="beat"
          aria-labelledby="basic-beat-heading"
          className="min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4"
        >
          <h2
            id="basic-beat-heading"
            className="flex items-center gap-2 font-semibold"
          >
            <Drum className="size-5 text-primary-readable" aria-hidden />
            1. Make your beat
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Kick, snare, and hi-hat make the rhythm. Start with the music
            already here, or add a new beat.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            {drum && (
              <>
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
                  Drum track
                  <select
                    aria-label="Drum track"
                    className={fieldClass}
                    value={drum.id}
                    onChange={(event) => {
                      const track = drums.find(
                        (item) => item.id === event.target.value,
                      );
                      if (track) select(track);
                    }}
                  >
                    {drums.map((track) => (
                      <option value={track.id} key={track.id}>
                        {track.name}
                      </option>
                    ))}
                  </select>
                </label>
                <ClipPicker
                  track={drum}
                  clip={drumClip}
                  onChange={(id) => select(drum, id)}
                />
              </>
            )}
            <Button
              className="min-h-11"
              data-testid="basic-starter-beat"
              onClick={() => addIdea("drums")}
            >
              <Plus aria-hidden />
              Add starter beat
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => addIdea("drums", true)}
            >
              Draw a new beat
            </Button>
          </div>
          {drum && drumClip && (
            <SimpleClipEditor
              key={`${project.id}:${drum.id}:${drumClip.id}`}
              track={drum}
              clip={drumClip}
            />
          )}
        </section>
        <section
          data-learning-target="melody"
          aria-labelledby="basic-melody-heading"
          className="min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4"
        >
          <h2
            id="basic-melody-heading"
            className="flex items-center gap-2 font-semibold"
          >
            <Music2 className="size-5 text-primary-readable" aria-hidden />
            2. Add bass and a melody
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Bass adds low notes. A melody is a tune you can hum. These ideas use{" "}
            {CREATIVE_ROOTS[project.performance?.scaleRoot ?? 9] ?? "A"}{" "}
            {creativeScaleFromScaleId(project.performance?.scaleId).replaceAll(
              "_",
              " ",
            )}
            . Add a beat, then bass and melody to build a new section together.
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            {melody && (
              <>
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
                  Instrument track
                  <select
                    aria-label="Instrument track"
                    className={fieldClass}
                    value={melody.id}
                    onChange={(event) => {
                      const track = melodic.find(
                        (item) => item.id === event.target.value,
                      );
                      if (track) select(track);
                    }}
                  >
                    {melodic.map((track) => (
                      <option value={track.id} key={track.id}>
                        {track.name}
                      </option>
                    ))}
                  </select>
                </label>
                <ClipPicker
                  track={melody}
                  clip={melodyClip}
                  onChange={(id) => select(melody, id)}
                />
              </>
            )}
            <Button
              variant="outline"
              className="min-h-11"
              data-testid="basic-add-bass"
              onClick={() => addIdea("bass")}
            >
              <Plus aria-hidden />
              Add bass idea
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              data-testid="basic-add-melody"
              onClick={() => addIdea("piano")}
            >
              <Plus aria-hidden />
              Add melody idea
            </Button>
          </div>
          {melody && melodyClip && (
            <SimpleClipEditor
              key={`${project.id}:${melody.id}:${melodyClip.id}`}
              track={melody}
              clip={melodyClip}
            />
          )}
        </section>
        <section
          data-learning-target="arrange"
          aria-labelledby="basic-arrange-heading"
          className="min-w-0 rounded-lg border border-border bg-card p-4"
        >
          <h2
            id="basic-arrange-heading"
            className="flex items-center gap-2 font-semibold"
          >
            <Copy className="size-5 text-primary-readable" aria-hidden />
            3. Make it a song
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Your music fills {songEnd / 4} bars. A bar is a group of four beats.
            Each repeat adds a copy of the same {basicSongEnd(sourceSong) / 4}
            -bar song. Edit the new clips to make a different ending.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              data-testid="basic-repeat-song"
              disabled={songEnd === 0}
              onClick={() => {
                const store = getStore();
                const source =
                  repeatSource?.project.id === store.state.project.id &&
                  repeatSource.loadRevision === store.state.projectLoadRevision
                    ? repeatSource.project
                    : store.state.project;
                const patch = repeatBasicSong(
                  store.state.project,
                  makeId,
                  source,
                );
                if (!patch) return;
                if (source !== repeatSource?.project)
                  setRepeatSource({
                    project: source,
                    loadRevision: store.state.projectLoadRevision,
                  });
                applyAddition(patch);
                flushAutomationToEngine(store.state.project);
                store.setStatus(
                  "A copy of every part was added after your song. Choose a new clip above to change its ending.",
                );
                learningAction("arrange");
              }}
            >
              <Copy aria-hidden />
              Repeat song
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              disabled={songEnd === 0}
              onClick={() => {
                const store = getStore();
                const end = basicSongEnd(store.state.project);
                store.patchProject({
                  loopEnabled: true,
                  loopStartBeat: 0,
                  loopEndBeat: end,
                  bars: Math.max(store.state.project.bars, end / 4),
                });
                store.setStatus(
                  "The loop now covers your whole song. Press Play to listen.",
                );
              }}
            >
              Loop whole song
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Repeat adds a copy of all clips, including recordings. You can move
            clips, record, and explore detailed song sections in Advanced.
          </p>
        </section>
        <section
          data-learning-target="mix"
          aria-labelledby="basic-mix-heading"
          className="min-w-0 rounded-lg border border-border bg-card p-4"
        >
          <h2
            id="basic-mix-heading"
            className="flex items-center gap-2 font-semibold"
          >
            <Volume2 className="size-5 text-primary-readable" aria-hidden />
            4. Balance your sounds
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Listen while you move the volume sliders. Mute gives a part a rest.
            Turn it back on to hear the difference.
          </p>
          {project.tracks.some((track) => track.solo) && (
            <p className="mt-2 text-sm text-primary-readable">
              Some tracks are set to play alone. Use “Hear all” on those tracks
              to bring the others back.
            </p>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {project.tracks.map((track) => (
              <div
                key={track.id}
                className="min-w-0 rounded-md border border-border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    className={cn(
                      "min-h-11 min-w-0 truncate text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selectedTrackId === track.id && "text-primary-readable",
                    )}
                    aria-pressed={selectedTrackId === track.id}
                    onClick={() => select(track)}
                  >
                    {track.name}
                  </button>
                  <Button
                    variant={track.muted ? "secondary" : "outline"}
                    className="min-h-11"
                    aria-label={`Mute ${track.name}`}
                    aria-pressed={track.muted}
                    onClick={() => {
                      getStore().patchTrack(track.id, {
                        muted: !track.muted,
                        solo: track.muted ? track.solo : false,
                      });
                      learningAction("mix");
                    }}
                  >
                    {track.muted ? "Muted" : "Mute"}
                  </Button>
                </div>
                <label className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>Volume</span>
                  <input
                    aria-label={`${track.name} volume`}
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={Math.round(track.volume * 100)}
                    className="min-h-11 min-w-0 flex-1 accent-primary"
                    onChange={(event) => {
                      getStore().setTrackVolume(
                        track.id,
                        Number(event.target.value) / 100,
                      );
                      learningAction("mix");
                    }}
                  />
                  <span className="w-8 tabular-nums">
                    {Math.round(track.volume * 100)}%
                  </span>
                </label>
                <label className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
                  Sound
                  <select
                    aria-label={`${track.name} sound`}
                    className={fieldClass}
                    value={
                      track.kitId || track.presetId || track.sampleInstrument
                        ? "current"
                        : track.preset
                    }
                    onChange={(event) => {
                      const choice = SOUNDS[track.kind].find(
                        (item) => item.value === event.target.value,
                      );
                      if (choice)
                        getStore().applyLegacyPreset(track.id, choice.value);
                    }}
                  >
                    {(track.kitId ||
                      track.presetId ||
                      track.sampleInstrument) && (
                      <option value="current">
                        Current sound
                        {track.sampleInstrument ? " — your sample" : ""}
                      </option>
                    )}
                    {SOUNDS[track.kind].map((sound) => (
                      <option value={sound.value} key={sound.value}>
                        {sound.label}
                      </option>
                    ))}
                  </select>
                </label>
                {track.solo && (
                  <Button
                    variant="outline"
                    className="mt-1 min-h-11"
                    onClick={() => {
                      getStore().patchTrack(track.id, { solo: false });
                      learningAction("mix");
                    }}
                  >
                    Hear all — turn off solo
                  </Button>
                )}
                {track.automationLanes?.some(
                  (lane) => lane.param === "volume",
                ) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    This track has automatic volume changes. Edit those in
                    Advanced.
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
        <section
          data-learning-target="save"
          aria-labelledby="basic-save-heading"
          className="min-w-0 rounded-lg border border-border bg-card p-4"
        >
          <h2
            id="basic-save-heading"
            className="flex items-center gap-2 font-semibold"
          >
            <Save className="size-5 text-primary-readable" aria-hidden />
            5. Keep your music
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Save keeps an editable project in this browser. Download a project
            backup from Export to keep it safe or move to another device. Choose
            WAV there for an audio file you can listen to.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              className="min-h-11"
              data-testid="basic-save"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("studio:save"))
              }
            >
              <Save aria-hidden />
              Save project
            </Button>
            <Button
              variant="outline"
              className="min-h-11"
              data-testid="basic-export"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("studio:open-export"))
              }
            >
              <Download aria-hidden />
              Export / download
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
