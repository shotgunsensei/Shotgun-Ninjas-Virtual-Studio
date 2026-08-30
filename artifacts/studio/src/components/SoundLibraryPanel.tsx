import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import { Sparkles, Undo2 } from "lucide-react";
import {
  SOUND_PACKS,
  SOUND_PACK_CATEGORIES,
  type PackCategory,
  type SoundPack,
} from "../lib/audio/sounds/soundLibrary";
import { DRUM_KITS } from "../lib/audio/sounds/kits";
import { buildKit } from "../lib/audio/sounds/kits";
import {
  buildPresetVoice,
  findPreset,
  presetSoundParams,
} from "../lib/audio/sounds/presets";
import { tryLoadMelodicSampler } from "../lib/audio/sounds/samples";
import { PackCoverArt } from "./PackCoverArt";
import { getStore, makeId, useStore, type PackSketchUndoState } from "../store";
import type { DrumPiece } from "../lib/audio/voices";
import type { Track } from "../types";
import { audio } from "../lib/audio/engine";
import { createPackSketch } from "../lib/creative/packSketch";
import { nextCreativeClipStart } from "../lib/creative/creativeCompass";

const ALL_CATEGORY = "All" as const;
type FilterCategory = typeof ALL_CATEGORY | PackCategory;

/* ── Preview engine ──────────────────────────────────────────
   Builds a temporary kit and optional melodic voice routed through the
   studio master chain, fires all hits using absolute audio-clock scheduling,
   and disposes everything after the pattern completes.
   Never touches the project's track state.
──────────────────────────────────────────────────────────── */

interface PreviewHandle {
  stop: () => void;
}

async function startPreview(
  pack: SoundPack,
  bpm: number,
  onStop: () => void,
): Promise<PreviewHandle> {
  await audio.unlock();

  const kitDef = DRUM_KITS[pack.kitId];
  const channel = new Tone.Channel({ volume: -3 });
  audio.connectToMaster(channel);
  const reverb = new Tone.Freeverb({ roomSize: 0.4, dampening: 3000, wet: 0.15 });
  reverb.connect(channel);
  const kitVoice = buildKit(kitDef, channel, reverb, null);
  const preset = findPreset(pack.presetId);
  const melodicVoice = preset && pack.demoMelody?.length
    ? (await tryLoadMelodicSampler(preset.layers, {
        attack: Math.max(0, preset.synth.attack * 0.4),
        release: Math.max(0.15, preset.synth.release * 2),
        volume: -9,
      })) ?? buildPresetVoice(preset)
    : null;
  melodicVoice?.connect(channel);

  const stepSec = 60 / bpm / 4; // 1/16 note duration in seconds
  const bars = 2;
  const steps = 16 * bars;

  const startTime = Tone.now() + 0.05;
  let stopped = false;

  const pieces = Object.keys(pack.demoPattern) as DrumPiece[];
  for (let step = 0; step < steps; step++) {
    const patStep = step % 16;
    for (const piece of pieces) {
      const grid = pack.demoPattern[piece];
      if (!grid || !grid[patStep]) continue;
      const pv = kitVoice.pieces.get(piece);
      if (!pv) continue;
      const t = startTime + step * stepSec;
      try {
        // Tone/Web Audio schedules against its own clock; queuing the hit now
        // avoids one main-thread timeout per drum event and remains stable if
        // React is busy while the preview is playing.
        pv.trigger(t, 0.8);
      } catch {
        /* ignore a single preview hit */
      }
    }
  }

  if (melodicVoice && pack.demoMelody) {
    const offsets = pack.demoMelody.some((event) => event.step >= 16)
      ? [0]
      : [0, 16];
    for (const offset of offsets) {
      for (const event of pack.demoMelody) {
        if (event.step + offset >= steps) continue;
        try {
          melodicVoice.triggerAttackRelease(
            event.note,
            Math.max(stepSec, event.lengthSteps * stepSec * 0.94),
            startTime + (event.step + offset) * stepSec,
            event.velocity ?? 0.72,
          );
        } catch {
          /* ignore a single melodic preview event */
        }
      }
    }
  }

  const disposePreview = () => {
    try { melodicVoice?.dispose(); } catch { /* ignore */ }
    try { kitVoice.dispose(); } catch { /* ignore */ }
    try { channel.dispose(); } catch { /* ignore */ }
    try { reverb.dispose(); } catch { /* ignore */ }
  };

  const totalMs = steps * stepSec * 1000 + 2000;
  const finishHandle = setTimeout(() => {
    if (!stopped) {
      stopped = true;
      disposePreview();
      onStop();
    }
  }, totalMs);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(finishHandle);
      disposePreview();
      onStop();
    },
  };
}

/* ── Component ───────────────────────────────────────────── */

export function SoundLibraryPanel() {
  const project = useStore((s) => s.project);
  const panicRevision = useStore((s) => s.panicRevision);
  const lastSketch = useStore((s) => s.lastPackSketch);
  const [filter, setFilter] = useState<FilterCategory>(ALL_CATEGORY);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewRef = useRef<PreviewHandle | null>(null);
  const previewGenerationRef = useRef(0);

  const activePack = project.soundPackId ?? "core-kit";

  const visible =
    filter === ALL_CATEGORY
      ? SOUND_PACKS
      : SOUND_PACKS.filter((p) => p.category === filter);

  const stopPreview = useCallback(() => {
    previewGenerationRef.current += 1;
    if (previewRef.current) {
      previewRef.current.stop();
      previewRef.current = null;
    }
    setPreviewingId(null);
  }, []);

  useEffect(() => {
    return () => {
      previewGenerationRef.current += 1;
      previewRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (panicRevision > 0) stopPreview();
  }, [panicRevision, stopPreview]);

  const handlePreview = async (pack: SoundPack) => {
    if (previewingId === pack.id) {
      stopPreview();
      return;
    }
    stopPreview();
    const generation = previewGenerationRef.current;
    setPreviewingId(pack.id);
    const bpm = pack.demoBpm ?? project.bpm ?? 120;
    try {
      const handle = await startPreview(pack, bpm, () => {
        if (previewGenerationRef.current === generation) {
          setPreviewingId(null);
          previewRef.current = null;
        }
      });
      if (previewGenerationRef.current !== generation) {
        handle.stop();
        return;
      }
      previewRef.current = handle;
    } catch {
      if (previewGenerationRef.current === generation) setPreviewingId(null);
    }
  };

  const handleLoadPack = (pack: SoundPack) => {
    stopPreview();

    const tracks = project.tracks;
    const drumTrack = tracks.find((t) => t.kind === "drums");
    const preset = findPreset(pack.presetId);
    const melodicTrack = preset
      ? tracks.find((track) => preset.compatibleWith.includes(track.kind))
      : undefined;

    if (drumTrack) {
      getStore().applyDrumKit(drumTrack.id, pack.kitId);
    }
    if (melodicTrack && pack.presetId) {
      getStore().applyMelodicPreset(melodicTrack.id, pack.presetId);
    }
    getStore().patchProject({ soundPackId: pack.id });
    getStore().setStatus(`Pack loaded: ${pack.name}`, "info");
  };

  const handleStartSketch = (pack: SoundPack) => {
    stopPreview();
    const current = getStore().state.project;
    const drumTrack = current.tracks.find((track) => track.kind === "drums");
    if (!drumTrack) {
      getStore().setStatus("Add a drum track before starting a pack sketch.", "warn");
      return;
    }

    const preset = findPreset(pack.presetId);
    const melodicTrack = preset
      ? current.tracks.find((track) => preset.compatibleWith.includes(track.kind))
      : undefined;
    if (pack.demoMelody?.length && !melodicTrack) {
      getStore().setStatus(
        "This pack needs a compatible piano, guitar, or bass track for its melody.",
        "warn",
      );
      return;
    }

    const startBeat = Math.max(
      nextCreativeClipStart(drumTrack, current.bpm),
      melodicTrack ? nextCreativeClipStart(melodicTrack, current.bpm) : 0,
      current.loopEnabled ? current.loopStartBeat : 0,
    );
    const sketch = createPackSketch({
      pack,
      drumTrack,
      melodicTrack,
      startBeat,
      ids: {
        drumClipId: makeId(),
        melodicClipId: pack.demoMelody?.length ? makeId() : undefined,
      },
    });

    const replacements = new Map<string, (typeof current.tracks)[number]>();
    const appliedMelodicSound = sketch.melodic
      ? preset
        ? {
            ...(sketch.melodic.track.sound ?? {}),
            ...presetSoundParams(preset),
          }
        : sketch.melodic.track.sound
      : undefined;
    replacements.set(sketch.drum.track.id, sketch.drum.track);
    if (sketch.melodic) {
      replacements.set(sketch.melodic.track.id, {
        ...sketch.melodic.track,
        sound: appliedMelodicSound,
      });
    }

    const tracks = current.tracks.map((track) => replacements.get(track.id) ?? track);
    const appliedBars = Math.max(
      current.bars,
      Math.ceil((startBeat + sketch.lengthBeats) / 4),
    );
    const appliedLoopEndBeat = current.loopEnabled
      ? Math.max(current.loopEndBeat, startBeat + sketch.lengthBeats)
      : current.loopEndBeat;
    getStore().patchProject({
      tracks,
      soundPackId: pack.id,
      bars: appliedBars,
      loopEndBeat: appliedLoopEndBeat,
    });

    // A project patch updates engine snapshots but intentionally does not
    // create voices while audio is locked. Reconcile only voices that already
    // exist so a Pack A -> Pack B sketch switch cannot keep playing Pack A.
    try {
      audio.setKit(sketch.drum.track.id, pack.kitId);
      if (sketch.melodic && pack.presetId) {
        audio.setMelodicPreset(sketch.melodic.track.id, pack.presetId);
        if (appliedMelodicSound) {
          audio.setSoundParams(sketch.melodic.track.id, appliedMelodicSound);
        }
      }
    } catch {
      // The project snapshot remains authoritative. Playback preparation or a
      // later live trigger will retry selector reconciliation.
    }
    const selected = sketch.melodic ?? sketch.drum;
    getStore().set({
      selectedTrackId: selected.track.id,
      selectedClipId: selected.clip.id,
    });
    const undoState: PackSketchUndoState = {
      projectId: current.id,
      packId: pack.id,
      packName: pack.name,
      previousSoundPackId: current.soundPackId,
      previousBars: current.bars,
      appliedBars,
      previousLoopEndBeat: current.loopEndBeat,
      appliedLoopEndBeat,
      clips: [
        { trackId: sketch.drum.track.id, clipId: sketch.drum.clip.id },
        ...(sketch.melodic
          ? [{ trackId: sketch.melodic.track.id, clipId: sketch.melodic.clip.id }]
          : []),
      ],
      tracks: [
        {
          trackId: drumTrack.id,
          previous: {
            kitId: drumTrack.kitId,
            presetId: drumTrack.presetId,
            sound: drumTrack.sound ? { ...drumTrack.sound } : undefined,
          },
          applied: {
            kitId: sketch.drum.track.kitId,
            presetId: sketch.drum.track.presetId,
            sound: sketch.drum.track.sound ? { ...sketch.drum.track.sound } : undefined,
          },
        },
        ...(sketch.melodic && melodicTrack
          ? [{
              trackId: melodicTrack.id,
              previous: {
                kitId: melodicTrack.kitId,
                presetId: melodicTrack.presetId,
                sound: melodicTrack.sound ? { ...melodicTrack.sound } : undefined,
              },
              applied: {
                kitId: sketch.melodic.track.kitId,
                presetId: sketch.melodic.track.presetId,
                sound: appliedMelodicSound
                  ? { ...appliedMelodicSound }
                  : undefined,
              },
            }]
          : []),
      ],
    };
    getStore().set({ lastPackSketch: undoState });
    const tempoNote =
      pack.demoBpm && pack.demoBpm !== current.bpm
        ? ` Pack preview tempo is ${pack.demoBpm} BPM; your ${current.bpm} BPM tempo was preserved.`
        : "";
    getStore().setStatus(`${pack.name} editable sketch added.${tempoNote}`, "info");
  };

  const undoLastSketch = () => {
    if (!lastSketch || lastSketch.projectId !== getStore().state.project.id) return;
    const current = getStore().state.project;
    const clipIdsByTrack = new Map<string, Set<string>>();
    for (const clip of lastSketch.clips) {
      const ids = clipIdsByTrack.get(clip.trackId) ?? new Set<string>();
      ids.add(clip.clipId);
      clipIdsByTrack.set(clip.trackId, ids);
    }
    const receipts = new Map(lastSketch.tracks.map((entry) => [entry.trackId, entry]));
    const sameSound = (left: Track["sound"], right: Track["sound"]) =>
      JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
    const tracks = current.tracks.map((track) => {
      const receipt = receipts.get(track.id);
      const generatedIds = clipIdsByTrack.get(track.id);
      const next = {
        ...track,
        noteClips: generatedIds
          ? track.noteClips.filter((clip) => !generatedIds.has(clip.id))
          : track.noteClips,
      };
      if (!receipt) return next;

      // Restore a generated selector only while it still has the generated
      // value. Any sound edit made after sketch creation wins.
      if (next.kitId === receipt.applied.kitId) next.kitId = receipt.previous.kitId;
      if (next.presetId === receipt.applied.presetId) {
        next.presetId = receipt.previous.presetId;
      }
      if (sameSound(next.sound, receipt.applied.sound)) {
        next.sound = receipt.previous.sound ? { ...receipt.previous.sound } : undefined;
      }
      return next;
    });
    const furthestRemainingBeat = tracks.reduce((furthest, track) => {
      const noteEnd = track.noteClips.reduce(
        (end, clip) => Math.max(end, clip.start + clip.length),
        0,
      );
      const audioEnd = track.audioClips.reduce(
        (end, clip) =>
          Math.max(end, clip.start + clip.durationSec * (current.bpm / 60)),
        0,
      );
      return Math.max(furthest, noteEnd, audioEnd);
    }, 0);
    const furthestSectionBar = (current.sections ?? []).reduce(
      (furthest, section) => Math.max(furthest, section.bar + 1),
      0,
    );
    const loopEndBeat =
      current.loopEndBeat === lastSketch.appliedLoopEndBeat
        ? lastSketch.previousLoopEndBeat
        : current.loopEndBeat;
    const minimumBars = Math.max(
      1,
      Math.ceil(furthestRemainingBeat / 4),
      furthestSectionBar,
      Math.ceil(loopEndBeat / 4),
    );
    const bars =
      current.bars === lastSketch.appliedBars
        ? Math.max(lastSketch.previousBars, minimumBars)
        : current.bars;
    const soundPackId =
      current.soundPackId === lastSketch.packId
        ? lastSketch.previousSoundPackId
        : current.soundPackId;
    getStore().patchProject({ tracks, bars, soundPackId, loopEndBeat });

    // Keep already-realized audio voices aligned with the restored project.
    for (const receipt of lastSketch.tracks) {
      const restored = tracks.find((track) => track.id === receipt.trackId);
      if (restored) {
        try {
          audio.changePreset(restored);
        } catch {
          // The restored project snapshot is authoritative and will retry on
          // the next preparation/live trigger.
        }
      }
    }
    const { selectedClipId, selectedTrackId } = getStore().state;
    if (
      selectedClipId &&
      clipIdsByTrack.get(selectedTrackId)?.has(selectedClipId)
    ) {
      getStore().set({ selectedClipId: null });
    }
    getStore().setStatus(`${lastSketch.packName} sketch clips removed.`, "info");
    getStore().set({ lastPackSketch: null });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Category filter strip */}
      <div className="flex overflow-x-auto gap-1 px-2 py-1.5 border-b border-border shrink-0">
        {([ALL_CATEGORY, ...SOUND_PACK_CATEGORIES] as FilterCategory[]).map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setFilter(cat)}
            className={`shrink-0 px-2 py-0.5 rounded font-mono text-[9px] uppercase tracking-widest transition-colors ${
              filter === cat
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {lastSketch && (
        <div
          className="mx-2 mt-2 flex items-center justify-between gap-2 rounded border border-emerald-500/35 bg-emerald-500/5 px-2.5 py-2"
          role="status"
        >
          <div className="min-w-0">
            <div className="truncate font-mono text-[10px] text-foreground">
              {lastSketch.packName} sketch added
            </div>
            <div className="text-[9px] text-muted-foreground">
              Editable clips are selected on the timeline.
            </div>
          </div>
          <button
            type="button"
            onClick={undoLastSketch}
            className="flex h-7 shrink-0 items-center gap-1 rounded border border-border px-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            <Undo2 className="size-3" aria-hidden /> Undo sketch
          </button>
        </div>
      )}

      {/* Pack cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {visible.map((pack) => {
          const isActive = activePack === pack.id;
          const isPreviewing = previewingId === pack.id;
          return (
            <PackCard
              key={pack.id}
              pack={pack}
              isActive={isActive}
              isPreviewing={isPreviewing}
              onPreview={() => void handlePreview(pack)}
              onLoad={() => handleLoadPack(pack)}
              onSketch={() => handleStartSketch(pack)}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ── Pack Card ────────────────────────────────────────────── */

interface PackCardProps {
  pack: SoundPack;
  isActive: boolean;
  isPreviewing: boolean;
  onPreview: () => void;
  onLoad: () => void;
  onSketch: () => void;
}

function PackCard({
  pack,
  isActive,
  isPreviewing,
  onPreview,
  onLoad,
  onSketch,
}: PackCardProps) {
  return (
    <div
      className={`rounded border transition-colors ${
        isActive
          ? "border-primary/70 bg-primary/10"
          : "border-border/50 bg-background/40 hover:border-border"
      }`}
    >
      <div className="flex gap-2 p-2">
        {/* Cover art */}
        <div className="shrink-0 rounded overflow-hidden">
          <PackCoverArt art={pack.coverArt} size={72} />
        </div>

        {/* Text info */}
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-foreground font-medium truncate leading-tight">
                {pack.name}
              </span>
              {isActive && (
                <span className="shrink-0 font-mono text-[8px] uppercase tracking-wider text-primary border border-primary/50 rounded px-1 py-0.5 leading-none">
                  Active
                </span>
              )}
            </div>
            <div className="font-mono text-[9px] text-primary/80 italic mt-0.5 truncate">
              {pack.tagline}
            </div>
            <div className="font-mono text-[9px] text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
              {pack.description}
            </div>
          </div>

          {/* Category + BPM badges */}
          <div className="flex gap-1 mt-1.5 flex-wrap">
            <span className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground border border-border/40 rounded px-1 py-0.5 leading-none">
              {pack.category}
            </span>
            {pack.demoBpm && (
              <span className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground border border-border/40 rounded px-1 py-0.5 leading-none">
                {pack.demoBpm} BPM
              </span>
            )}
            {pack.demoMelody?.length ? (
              <span className="font-mono text-[8px] uppercase tracking-widest text-primary border border-primary/35 rounded px-1 py-0.5 leading-none">
                Drums + instrument
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {pack.creativePrompt ? (
        <div className="mx-2 mb-2 rounded border border-primary/20 bg-primary/5 px-2 py-1.5">
          <div className="font-mono text-[8px] uppercase tracking-widest text-primary/80 mb-0.5">
            Creative move
          </div>
          <p className="text-[9px] leading-relaxed text-muted-foreground">
            {pack.creativePrompt}
          </p>
        </div>
      ) : null}

      {/* Action row */}
      <div className="flex gap-1 px-2 pb-2">
        <button
          type="button"
          onClick={onPreview}
          className={`flex-1 py-1 rounded font-mono text-[9px] uppercase tracking-widest transition-colors ${
            isPreviewing
              ? "bg-primary/25 text-primary border border-primary/50"
              : "bg-background border border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
          }`}
        >
          {isPreviewing ? "◼ Stop" : "▶ Preview"}
        </button>
        <button
          type="button"
          onClick={onLoad}
          disabled={isActive}
          className={`flex-1 py-1 rounded font-mono text-[9px] uppercase tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            isActive
              ? "bg-primary/20 text-primary border border-primary/40"
              : "bg-primary text-primary-foreground hover:bg-primary/85"
          }`}
        >
          {isActive ? "Loaded" : "Load Pack"}
        </button>
      </div>
      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={onSketch}
          className="flex min-h-8 w-full items-center justify-center gap-1.5 rounded border border-primary/45 bg-primary/10 px-2 py-1.5 font-mono text-[9px] uppercase tracking-widest text-primary-readable transition-colors duration-150 hover:bg-primary/15"
          data-testid={`start-pack-sketch-${pack.id}`}
        >
          <Sparkles className="size-3" aria-hidden /> Start editable sketch
        </button>
      </div>
    </div>
  );
}
