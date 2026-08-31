import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ArrowRight,
  Check,
  Circle,
  Compass,
  GraduationCap,
  History,
  Lightbulb,
  Music2,
  Radio,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Trash2,
  Undo2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getStore, makeId, useStore } from "../store";
import type { NoteClip, Track } from "../types";
import {
  CREATIVE_RECIPE_COPY,
  CREATIVE_ROOTS,
  CREATIVE_SCALE_LABELS,
  barsRequiredForClip,
  creativeScaleFromScaleId,
  createCreativeSeed,
  createCreativeVariation,
  isCreativeTrack,
  nextCreativeClipStart,
  type CreativeRecipe,
  type CreativeScale,
  type CreativeVariation,
} from "../lib/creative/creativeCompass";
import {
  buildDojoSession,
  DOJO_GUIDANCE_COPY,
  loadDojoGuidance,
  saveDojoGuidance,
  type DojoGuidanceLevel,
} from "../lib/creative/dojo";
import {
  buildJamRecoveryClip,
  jamCapture,
  type JamCaptureEvent,
  type JamRecoveryFeel,
} from "../lib/performance/jamCapture";

interface CreativeCompassPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CreatedClipRef {
  trackId: string;
  clipId: string;
  label: string;
  previousLoopEndBeat: number;
  appliedLoopEndBeat: number;
  recoveryEvents?: JamCaptureEvent[];
}

const GUIDANCE_ICONS = {
  teach: GraduationCap,
  surprise: Shuffle,
  quiet: VolumeX,
} satisfies Record<DojoGuidanceLevel, typeof GraduationCap>;

const RECIPE_ORDER: CreativeRecipe[] = ["motif", "chords", "pulse", "groove"];

const VARIATION_COPY: Record<
  CreativeVariation,
  { label: string; description: string }
> = {
  answer: {
    label: "Write an answer",
    description: "Keep the identity, then change the ending.",
  },
  lift: {
    label: "Create a lift",
    description: "Raise the register or open the backbeat.",
  },
  pocket: {
    label: "Find more pocket",
    description: "Shorten, offset, and soften selected notes.",
  },
};

function clipSource(track: Track | undefined, selectedClipId: string | null): NoteClip | null {
  if (!track) return null;
  const selected = selectedClipId
    ? track.noteClips.find((clip) => clip.id === selectedClipId)
    : undefined;
  return selected ?? track.noteClips.at(-1) ?? null;
}

export function CreativeCompassPanel({
  open,
  onOpenChange,
}: CreativeCompassPanelProps) {
  const project = useStore((state) => state.project);
  const selectedTrackId = useStore((state) => state.selectedTrackId);
  const selectedClipId = useStore((state) => state.selectedClipId);
  const [guidance, setGuidance] = useState<DojoGuidanceLevel>(loadDojoGuidance);
  const session = useMemo(
    () => buildDojoSession(project, selectedTrackId, guidance),
    [guidance, project, selectedTrackId],
  );
  const analysis = session.analysis;
  const creativeTracks = useMemo(
    () => project.tracks.filter(isCreativeTrack),
    [project.tracks],
  );
  const jamRevision = useSyncExternalStore(
    jamCapture.subscribe,
    jamCapture.getRevision,
    jamCapture.getRevision,
  );
  const jamSources = useMemo(
    () => jamCapture.summarize(project.id),
    [jamRevision, project.id],
  );

  const selectedIsCreative = creativeTracks.some((track) => track.id === selectedTrackId);
  const [targetTrackId, setTargetTrackId] = useState(
    selectedIsCreative ? selectedTrackId : analysis.targetTrackId ?? "",
  );
  const [rootSemitone, setRootSemitone] = useState(
    project.performance?.scaleRoot ?? 9,
  );
  const [scale, setScale] = useState<CreativeScale>(
    creativeScaleFromScaleId(project.performance?.scaleId),
  );
  const [recipe, setRecipe] = useState<CreativeRecipe>(session.recommendedRecipe);
  const [jamSourceTrackId, setJamSourceTrackId] = useState("");
  const [jamTargetTrackId, setJamTargetTrackId] = useState("");
  const [jamWindowSeconds, setJamWindowSeconds] = useState("30");
  const [jamFeel, setJamFeel] = useState<JamRecoveryFeel>("natural");
  const [lastCreated, setLastCreated] = useState<CreatedClipRef | null>(null);

  const changeGuidance = (value: DojoGuidanceLevel) => {
    setGuidance(value);
    saveDojoGuidance(value);
  };

  useEffect(() => {
    if (!open) return;
    const currentTargetExists = creativeTracks.some((track) => track.id === targetTrackId);
    if (!currentTargetExists) {
      setTargetTrackId(
        (selectedIsCreative ? selectedTrackId : analysis.targetTrackId) ??
          creativeTracks[0]?.id ??
          "",
      );
    }
  }, [
    analysis.targetTrackId,
    creativeTracks,
    open,
    selectedIsCreative,
    selectedTrackId,
    targetTrackId,
  ]);

  useEffect(() => {
    setLastCreated(null);
  }, [project.id]);

  useEffect(() => {
    if (!open || jamSources.length === 0) return;
    if (!jamSources.some((source) => source.trackId === jamSourceTrackId)) {
      setJamSourceTrackId(jamSources[0].trackId);
    }
  }, [jamSourceTrackId, jamSources, open]);

  const jamSource = jamSources.find((source) => source.trackId === jamSourceTrackId);
  const compatibleJamTargets = useMemo(
    () =>
      project.tracks.filter((track) =>
        jamSource?.kind === "drum"
          ? track.kind === "drums"
          : track.kind !== "drums" && track.kind !== "vocals",
      ),
    [jamSource?.kind, project.tracks],
  );

  useEffect(() => {
    if (!open || !jamSource) return;
    if (!compatibleJamTargets.some((track) => track.id === jamTargetTrackId)) {
      setJamTargetTrackId(
        compatibleJamTargets.find((track) => track.id === jamSource.trackId)?.id ??
          compatibleJamTargets[0]?.id ??
          "",
      );
    }
  }, [compatibleJamTargets, jamSource, jamTargetTrackId, open]);

  const targetTrack = creativeTracks.find((track) => track.id === targetTrackId);
  const sourceClip = clipSource(targetTrack, selectedClipId);
  const canVarySource = Boolean(sourceClip?.notes.length);
  const recipeForTrack =
    targetTrack?.kind === "drums"
      ? "groove"
      : recipe === "groove"
        ? "motif"
        : recipe;

  const nextReachableClipStart = (track: Track): number => {
    const current = getStore().state.project;
    const currentTrack = current.tracks.find((item) => item.id === track.id) ?? track;
    return Math.max(
      nextCreativeClipStart(currentTrack, current.bpm),
      current.loopEnabled ? current.loopStartBeat : 0,
    );
  };

  const appendClip = (
    track: Track,
    clip: NoteClip,
    label: string,
    recoveryEvents?: JamCaptureEvent[],
  ): boolean => {
    const current = getStore().state.project;
    const currentTrack = current.tracks.find((item) => item.id === track.id);
    if (!currentTrack) {
      getStore().setStatus("That track is no longer available.", "warn");
      return false;
    }
    const tracks = current.tracks.map((item) =>
      item.id === track.id
        ? { ...item, noteClips: [...item.noteClips, clip] }
        : item,
    );
    const clipEndBeat = clip.start + clip.length;
    const appliedLoopEndBeat = current.loopEnabled
      ? Math.max(current.loopEndBeat, clipEndBeat)
      : current.loopEndBeat;
    getStore().patchProject({
      tracks,
      bars: Math.max(current.bars, barsRequiredForClip(clip)),
      loopEndBeat: appliedLoopEndBeat,
    });
    getStore().set({ selectedTrackId: track.id, selectedClipId: clip.id });
    setLastCreated({
      trackId: track.id,
      clipId: clip.id,
      label,
      previousLoopEndBeat: current.loopEndBeat,
      appliedLoopEndBeat,
      recoveryEvents,
    });
    getStore().setStatus(`${label} added — press Space when you are ready to hear it.`, "info");
    return true;
  };

  const addSeed = () => {
    if (!targetTrack) {
      getStore().setStatus("Add or choose an instrument track first.", "warn");
      return;
    }
    const safeRecipe = targetTrack.kind === "drums" ? "groove" : recipeForTrack;
    const clip = createCreativeSeed({
      id: makeId(),
      track: targetTrack,
      start: nextReachableClipStart(targetTrack),
      rootSemitone,
      scale,
      recipe: safeRecipe,
      seed: `${project.id}:${targetTrack.id}:${targetTrack.noteClips.length}:${safeRecipe}`,
    });
    appendClip(targetTrack, clip, CREATIVE_RECIPE_COPY[safeRecipe].label);
  };

  const addVariation = (variation: CreativeVariation) => {
    if (!targetTrack || !sourceClip?.notes.length) {
      getStore().setStatus("Choose a note clip that contains notes before making a variation.", "warn");
      return;
    }
    const clip = createCreativeVariation({
      id: makeId(),
      track: targetTrack,
      source: sourceClip,
      start: nextReachableClipStart(targetTrack),
      variation,
      rootSemitone,
      scale,
    });
    appendClip(targetTrack, clip, VARIATION_COPY[variation].label);
  };

  const recoverJam = () => {
    const target = project.tracks.find((track) => track.id === jamTargetTrackId);
    if (!jamSource || !target) {
      getStore().setStatus("Choose a captured take and a destination track first.", "warn");
      return;
    }
    const events = jamCapture
      .getProjectEvents(project.id)
      .filter((event) => event.trackId === jamSource.trackId);
    const recovery = buildJamRecoveryClip({
      id: makeId(),
      events,
      targetTrack: target,
      bpm: project.bpm,
      start: nextReachableClipStart(target),
      windowSeconds: Number(jamWindowSeconds),
      feel: jamFeel,
    });
    if (!recovery) {
      getStore().setStatus("Play a few notes, chords, or drum hits before recovering a jam.", "warn");
      return;
    }
    const claimed = jamCapture.claim(recovery.eventIds);
    if (!appendClip(target, recovery.clip, "Recovered jam", claimed)) {
      jamCapture.restore(claimed);
      return;
    }
    getStore().setStatus(
      `Recovered ${recovery.clip.notes.length} notes from ${recovery.spanSeconds.toFixed(1)} seconds of playing.`,
      "info",
    );
  };

  const discardJam = () => {
    if (!jamSource) return;
    const removed = jamCapture.discardTrack(project.id, jamSource.trackId);
    getStore().setStatus(
      removed > 0 ? `Cleared ${removed} captured jam events.` : "There was no captured jam to clear.",
      "info",
    );
  };

  const undoLast = () => {
    if (!lastCreated) return;
    getStore().removeClip(lastCreated.trackId, lastCreated.clipId);
    const current = getStore().state.project;
    if (current.loopEndBeat === lastCreated.appliedLoopEndBeat) {
      getStore().patchProject({ loopEndBeat: lastCreated.previousLoopEndBeat });
    }
    if (lastCreated.recoveryEvents?.length) {
      jamCapture.restore(lastCreated.recoveryEvents);
    }
    getStore().setStatus(`${lastCreated.label} removed.`, "info");
    setLastCreated(null);
  };

  const useRecommendation = () => {
    setRecipe(session.recommendedRecipe);
    if (session.targetTrackId) setTargetTrackId(session.targetTrackId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] min-w-0 max-w-5xl overflow-x-hidden overflow-y-auto p-0 sm:max-h-[88vh] sm:w-[calc(100vw-2rem)]"
        data-testid="creative-compass"
      >
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <div className="flex items-start gap-3 pr-8">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/40 bg-primary/10 text-primary-readable">
              <Compass className="size-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="text-balance text-lg">The Dojo</DialogTitle>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-300">
                  <ShieldCheck className="size-3" aria-hidden /> Local mentor
                </span>
              </div>
              <DialogDescription className="text-pretty">
                Learn from the music already in front of you, rescue ideas you played before
                Record, and keep every decision yours. Nothing plays or replaces your work automatically.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
          <div className="space-y-5">
            <section aria-labelledby="dojo-guidance-heading">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3
                    id="dojo-guidance-heading"
                    className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
                  >
                    How should the Dojo help?
                  </h3>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Change this at any time. It never changes your music by itself.
                  </p>
                </div>
                <span className="font-mono text-[9px] uppercase tracking-wider text-emerald-300">
                  On-device · no account
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Dojo guidance level">
                {(Object.keys(DOJO_GUIDANCE_COPY) as DojoGuidanceLevel[]).map((level) => {
                  const copy = DOJO_GUIDANCE_COPY[level];
                  const Icon = GUIDANCE_ICONS[level];
                  return (
                    <button
                      key={level}
                      type="button"
                      role="radio"
                      aria-checked={guidance === level}
                      onClick={() => changeGuidance(level)}
                      className={cn(
                        "min-h-20 rounded-md border p-3 text-left transition-colors duration-150",
                        guidance === level
                          ? "border-primary bg-primary/10"
                          : "border-border bg-background/50 hover:border-foreground/30",
                      )}
                      data-testid={`dojo-guidance-${level}`}
                    >
                      <span className="flex items-center gap-2 text-xs font-medium">
                        <Icon className="size-3.5" aria-hidden />
                        {copy.label}
                      </span>
                      <span className="mt-1 block text-pretty text-[10px] leading-snug text-muted-foreground">
                        {copy.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section aria-labelledby="compass-map-heading">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3
                  id="compass-map-heading"
                  className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
                >
                  Your musical map
                </h3>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  {analysis.completedStages} of {analysis.stages.length} foundations present
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {analysis.stages.map((stage) => (
                  <div
                    key={stage.id}
                    className={cn(
                      "rounded-md border p-2.5",
                      stage.complete
                        ? "border-emerald-500/35 bg-emerald-500/5"
                        : "border-border bg-background/60",
                    )}
                  >
                    <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider">
                      {stage.complete ? (
                        <Check className="size-3.5 text-emerald-400" aria-hidden />
                      ) : (
                        <Circle className="size-3.5 text-muted-foreground" aria-hidden />
                      )}
                      {stage.label}
                    </div>
                    <p className="mt-1 text-pretty text-[11px] leading-snug text-muted-foreground">
                      {stage.detail}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section
              className="rounded-md border border-primary/35 bg-primary/5 p-4"
              aria-labelledby="compass-next-heading"
            >
              <div className="flex items-start gap-3">
                <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary-readable" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-primary-readable">
                    Suggested next move
                  </div>
                  <h3 id="compass-next-heading" className="mt-1 text-balance font-medium">
                    {session.title}
                  </h3>
                  <p className="mt-1 text-pretty text-xs leading-relaxed text-muted-foreground">
                    {session.why}
                  </p>
                  {session.constraint && (
                    <p className="mt-2 rounded border border-primary/25 bg-background/55 px-2.5 py-2 text-pretty text-[11px] leading-relaxed text-foreground">
                      <span className="font-medium">Creative dare:</span> {session.constraint}
                    </p>
                  )}
                  <p className="mt-2 text-pretty text-[11px] leading-relaxed text-foreground/80">
                    <span className="font-medium">Listen for:</span> {session.listenFor}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={useRecommendation}
                  className="shrink-0 font-mono text-[10px] uppercase tracking-wider"
                >
                  Use move
                </Button>
              </div>
            </section>

            <section aria-labelledby="compass-recipe-heading">
              <h3
                id="compass-recipe-heading"
                className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
              >
                Choose a musical seed
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {RECIPE_ORDER.map((recipeId) => {
                  const copy = CREATIVE_RECIPE_COPY[recipeId];
                  const disabled = targetTrack?.kind === "drums" && recipeId !== "groove";
                  return (
                    <button
                      key={recipeId}
                      type="button"
                      disabled={disabled}
                      aria-pressed={recipeForTrack === recipeId}
                      onClick={() => setRecipe(recipeId)}
                      className={cn(
                        "min-h-20 rounded-md border p-3 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-35",
                        recipeForTrack === recipeId
                          ? "border-primary bg-primary/10"
                          : "border-border bg-background/50 hover:border-foreground/30",
                      )}
                    >
                      <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider">
                        <Music2 className="size-3.5" aria-hidden />
                        {copy.label}
                      </span>
                      <span className="mt-1 block text-pretty text-[11px] leading-snug text-muted-foreground">
                        {copy.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          <aside className="space-y-4 lg:border-l lg:border-border lg:pl-5">
            <section aria-labelledby="compass-controls-heading">
              <h3
                id="compass-controls-heading"
                className="mb-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
              >
                Place the idea
              </h3>
              <div className="space-y-3 rounded-md border border-border bg-background/60 p-3">
                <label className="block space-y-1">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Target track
                  </span>
                  <Select value={targetTrackId} onValueChange={setTargetTrackId}>
                    <SelectTrigger aria-label="Dojo target track" data-testid="compass-track-select">
                      <SelectValue placeholder="Choose a track" />
                    </SelectTrigger>
                    <SelectContent>
                      {creativeTracks.map((track) => (
                        <SelectItem key={track.id} value={track.id}>
                          {track.name} · {track.kind}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block space-y-1">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Root
                    </span>
                    <Select
                      value={String(rootSemitone)}
                      onValueChange={(value) => setRootSemitone(Number(value))}
                    >
                      <SelectTrigger aria-label="Dojo root note">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CREATIVE_ROOTS.map((root, index) => (
                          <SelectItem key={root} value={String(index)}>
                            {root}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="block space-y-1">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Character
                    </span>
                    <Select
                      value={scale}
                      onValueChange={(value) => setScale(value as CreativeScale)}
                    >
                      <SelectTrigger aria-label="Dojo scale">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(CREATIVE_SCALE_LABELS) as CreativeScale[]).map(
                          (scaleId) => (
                            <SelectItem key={scaleId} value={scaleId}>
                              {CREATIVE_SCALE_LABELS[scaleId]}
                            </SelectItem>
                          ),
                        )}
                      </SelectContent>
                    </Select>
                  </label>
                </div>

                <Button
                  type="button"
                  onClick={addSeed}
                  disabled={!targetTrack}
                  className="w-full justify-between font-mono text-xs uppercase tracking-wider"
                  data-testid="compass-add-seed"
                >
                  <span className="flex items-center gap-2">
                    <Sparkles className="size-3.5" aria-hidden />
                    Add {CREATIVE_RECIPE_COPY[recipeForTrack].label}
                  </span>
                  <ArrowRight className="size-3.5" aria-hidden />
                </Button>
                <p className="text-pretty text-[10px] leading-relaxed text-muted-foreground">
                  Adds an editable two-bar clip after this track's existing material.
                  Your clips, tempo, sounds, and playback state stay untouched.
                </p>
              </div>
            </section>

            <section aria-labelledby="compass-variation-heading">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3
                  id="compass-variation-heading"
                  className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
                >
                  Develop an existing clip
                </h3>
                <span className="max-w-32 truncate text-[10px] text-muted-foreground">
                  {sourceClip?.name ?? "No source clip"}
                </span>
              </div>
              <div className="space-y-1.5">
                {(Object.keys(VARIATION_COPY) as CreativeVariation[]).map((variation) => (
                  <button
                    key={variation}
                    type="button"
                    disabled={!canVarySource}
                    onClick={() => addVariation(variation)}
                    className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-background/50 px-3 py-2 text-left transition-colors duration-150 hover:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span>
                      <span className="block text-xs font-medium">
                        {VARIATION_COPY[variation].label}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {VARIATION_COPY[variation].description}
                      </span>
                    </span>
                    <ArrowRight className="size-3.5 shrink-0" aria-hidden />
                  </button>
                ))}
              </div>
            </section>

            <section
              className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-3"
              aria-labelledby="jam-recovery-heading"
              data-testid="jam-recovery"
            >
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                  <History className="size-3.5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 id="jam-recovery-heading" className="text-xs font-medium">
                      Never Lose the Jam
                    </h3>
                    <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-cyan-300">
                      <Radio className="size-3" aria-hidden /> Always ready
                    </span>
                  </div>
                  <p className="mt-1 text-pretty text-[10px] leading-relaxed text-muted-foreground">
                    The Studio keeps a small local history of notes you actually play while
                    Record is off. Scheduled playback is never captured.
                  </p>
                </div>
              </div>

              {jamSources.length === 0 ? (
                <div
                  className="mt-3 rounded border border-dashed border-border px-3 py-3 text-center text-[10px] text-muted-foreground"
                  data-testid="jam-recovery-empty"
                >
                  Play the keyboard, guitar, performance pads, or drums. Your latest idea will appear here.
                </div>
              ) : (
                <div className="mt-3 space-y-3" data-testid="jam-recovery-ready">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <label className="block space-y-1">
                      <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                        Captured take
                      </span>
                      <Select value={jamSourceTrackId} onValueChange={setJamSourceTrackId}>
                        <SelectTrigger aria-label="Captured jam source" data-testid="jam-source-select">
                          <SelectValue placeholder="Choose a take" />
                        </SelectTrigger>
                        <SelectContent>
                          {jamSources.map((source) => {
                            const track = project.tracks.find((item) => item.id === source.trackId);
                            return (
                              <SelectItem key={source.trackId} value={source.trackId}>
                                {track?.name ?? "Removed track"} · {source.eventCount} notes
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="block space-y-1">
                      <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                        Put it on
                      </span>
                      <Select value={jamTargetTrackId} onValueChange={setJamTargetTrackId}>
                        <SelectTrigger aria-label="Jam recovery destination" data-testid="jam-target-select">
                          <SelectValue placeholder="Choose a track" />
                        </SelectTrigger>
                        <SelectContent>
                          {compatibleJamTargets.map((track) => (
                            <SelectItem key={track.id} value={track.id}>
                              {track.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block space-y-1">
                      <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                        Recover latest
                      </span>
                      <Select value={jamWindowSeconds} onValueChange={setJamWindowSeconds}>
                        <SelectTrigger aria-label="Jam recovery window">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="15">15 seconds</SelectItem>
                          <SelectItem value="30">30 seconds</SelectItem>
                          <SelectItem value="60">1 minute</SelectItem>
                          <SelectItem value="120">2 minutes</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="block space-y-1">
                      <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                        Timing
                      </span>
                      <Select
                        value={jamFeel}
                        onValueChange={(value) => setJamFeel(value as JamRecoveryFeel)}
                      >
                        <SelectTrigger aria-label="Jam recovery timing">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="natural">Keep natural feel</SelectItem>
                          <SelectItem value="sixteenth">Tighten to 1/16</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      onClick={recoverJam}
                      disabled={!jamSource || !jamTargetTrackId}
                      className="min-w-0 flex-1 justify-between font-mono text-[10px] uppercase tracking-wider"
                      data-testid="jam-recover"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Sparkles className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">Recover as clip</span>
                      </span>
                      <ArrowRight className="size-3.5 shrink-0" aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={discardJam}
                      aria-label="Discard captured jam"
                      title="Discard captured jam"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                </div>
              )}

              <p className="mt-2 text-pretty text-[9px] leading-relaxed text-muted-foreground">
                Bounded to 2,048 events across four recent projects. Stored only in this browser,
                skipped during formal recording, and removable at any time.
              </p>
            </section>

            <section className="rounded-md border border-border bg-muted/20 p-3">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Why this works
              </div>
              <p className="mt-1 text-pretty text-[11px] leading-relaxed text-foreground/80">
                {CREATIVE_RECIPE_COPY[recipeForTrack].lesson}
              </p>
            </section>

            {lastCreated && (
              <div
                className="flex items-center justify-between gap-3 rounded-md border border-emerald-500/35 bg-emerald-500/5 p-3"
                role="status"
                data-testid="compass-created-status"
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium">{lastCreated.label} added</div>
                  <div className="text-[10px] text-muted-foreground">
                    Selected on the timeline and ready to edit.
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={undoLast}
                  className="shrink-0 gap-1.5 font-mono text-[10px] uppercase tracking-wider"
                  data-testid="compass-undo"
                >
                  <Undo2 className="size-3.5" aria-hidden />
                  Undo
                </Button>
              </div>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
