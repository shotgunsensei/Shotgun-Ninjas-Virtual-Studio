import { useCallback, useEffect, useRef, useState } from "react";
import * as Tone from "tone";
import {
  SOUND_PACKS,
  SOUND_PACK_CATEGORIES,
  type PackCategory,
  type SoundPack,
} from "../lib/audio/sounds/soundLibrary";
import { DRUM_KITS } from "../lib/audio/sounds/kits";
import { buildKit } from "../lib/audio/sounds/kits";
import { buildPresetVoice, findPreset } from "../lib/audio/sounds/presets";
import { tryLoadMelodicSampler } from "../lib/audio/sounds/samples";
import { PackCoverArt } from "./PackCoverArt";
import { getStore, useStore } from "../store";
import type { DrumPiece } from "../lib/audio/voices";
import { audio } from "../lib/audio/engine";

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
}

function PackCard({ pack, isActive, isPreviewing, onPreview, onLoad }: PackCardProps) {
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
    </div>
  );
}
