import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Circle,
  Compass,
  Lightbulb,
  Music2,
  Sparkles,
  Undo2,
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
  analyzeCreativeProject,
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
}

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
  const analysis = useMemo(
    () => analyzeCreativeProject(project, selectedTrackId),
    [project, selectedTrackId],
  );
  const creativeTracks = useMemo(
    () => project.tracks.filter(isCreativeTrack),
    [project.tracks],
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
  const [recipe, setRecipe] = useState<CreativeRecipe>(analysis.recommendedRecipe);
  const [lastCreated, setLastCreated] = useState<CreatedClipRef | null>(null);

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

  const appendClip = (track: Track, clip: NoteClip, label: string) => {
    const current = getStore().state.project;
    const currentTrack = current.tracks.find((item) => item.id === track.id);
    if (!currentTrack) {
      getStore().setStatus("That track is no longer available.", "warn");
      return;
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
    });
    getStore().setStatus(`${label} added — press Space when you are ready to hear it.`, "info");
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

  const undoLast = () => {
    if (!lastCreated) return;
    getStore().removeClip(lastCreated.trackId, lastCreated.clipId);
    const current = getStore().state.project;
    if (current.loopEndBeat === lastCreated.appliedLoopEndBeat) {
      getStore().patchProject({ loopEndBeat: lastCreated.previousLoopEndBeat });
    }
    getStore().setStatus(`${lastCreated.label} removed.`, "info");
    setLastCreated(null);
  };

  const useRecommendation = () => {
    setRecipe(analysis.recommendedRecipe);
    if (analysis.targetTrackId) setTargetTrackId(analysis.targetTrackId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] min-w-0 max-w-4xl overflow-x-hidden overflow-y-auto p-0 sm:max-h-[88vh] sm:w-[calc(100vw-2rem)]"
        data-testid="creative-compass"
      >
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <div className="flex items-start gap-3 pr-8">
            <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/40 bg-primary/10 text-primary-readable">
              <Compass className="size-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-balance text-lg">Creative Compass</DialogTitle>
              <DialogDescription className="text-pretty">
                Read the shape of your project, learn one musical idea, and add an
                editable starting point. Nothing plays or replaces your work automatically.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
          <div className="space-y-5">
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
                    {analysis.nextMove.title}
                  </h3>
                  <p className="mt-1 text-pretty text-xs leading-relaxed text-muted-foreground">
                    {analysis.nextMove.why}
                  </p>
                  <p className="mt-2 text-pretty text-[11px] leading-relaxed text-foreground/80">
                    <span className="font-medium">Listen for:</span> {analysis.nextMove.practice}
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
                    <SelectTrigger aria-label="Creative Compass target track" data-testid="compass-track-select">
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
                      <SelectTrigger aria-label="Creative Compass root note">
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
                      <SelectTrigger aria-label="Creative Compass scale">
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
