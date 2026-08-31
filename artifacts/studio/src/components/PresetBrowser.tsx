import { useMemo, useState, useEffect, useRef } from "react";
import { audio } from "../lib/audio/engine";
import { getStore } from "../store";
import {
  MELODIC_CATEGORIES,
  MELODIC_PRESETS,
} from "../lib/audio/sounds/presets";
import type { Track } from "../types";
import type {
  MelodicPresetCategory,
  MelodicPresetDef,
} from "../lib/audio/sounds/types";
import { FACTORY_SAMPLE_SOURCE } from "../lib/audio/sounds/factorySamples";

/**
 * Preset Browser — filter / search / favorite / preview / load.
 *
 * Favorites live in localStorage. Selecting "Load" applies the preset
 * id to the currently-selected track via `audio.setMelodicPreset` and
 * persists the choice on the track so it survives reloads.
 */

const FAV_KEY = "studio.favPresets";

function useFavorites(): [string[], (id: string) => void] {
  const [favs, setFavs] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(favs));
    } catch {
      // ignore quota errors
    }
  }, [favs]);
  const toggle = (id: string) =>
    setFavs((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  return [favs, toggle];
}

export function PresetBrowser({ track }: { track: Track }) {
  const [category, setCategory] = useState<MelodicPresetCategory | "All" | "Favs">(
    "All",
  );
  const [query, setQuery] = useState("");
  const [guidePresetId, setGuidePresetId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const previewGenerationRef = useRef(0);
  const [favs, toggleFav] = useFavorites();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MELODIC_PRESETS.filter((p) => {
      if (!p.compatibleWith.includes(track.kind)) return false;
      if (category === "Favs" && !favs.includes(p.id)) return false;
      if (
        category !== "All" &&
        category !== "Favs" &&
        p.category !== category
      ) {
        return false;
      }
      if (q && !`${p.name} ${p.description}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [track.kind, category, query, favs]);

  const load = (p: MelodicPresetDef) => {
    getStore().applyMelodicPreset(track.id, p.id);
    getStore().setStatus(
      p.layers?.length
        ? `Loaded ${p.name}; HQ zones are decoding in the background.`
        : `Loaded preset: ${p.name}`,
      "info",
    );
  };

  const preview = async (p: MelodicPresetDef) => {
    const generation = ++previewGenerationRef.current;
    setPreviewingId(p.id);
    if (p.layers?.length) {
      getStore().setStatus(`Loading HQ preview: ${p.name}…`, "info");
    }
    try {
      const source = await audio.previewPresetNote(
        p.id,
        p.category === "Bass" ? "A2" : "C4",
        0.7,
      );
      if (generation !== previewGenerationRef.current || !source) return;
      getStore().setStatus(
        source === "sampled"
          ? `Previewing ${p.name} · local CC0 samples`
          : `Previewing ${p.name} · modeled fallback`,
        "info",
      );
    } catch {
      if (generation === previewGenerationRef.current) {
        getStore().setStatus(`Could not preview ${p.name}.`, "error");
      }
    } finally {
      if (generation === previewGenerationRef.current) setPreviewingId(null);
    }
  };

  return (
    <div className="panel-inset rounded-md p-2 space-y-2" data-testid="preset-browser">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Preset Browser
        </span>
        <span className="font-mono text-[9px] text-muted-foreground">
          {filtered.length} / {MELODIC_PRESETS.length}
        </span>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search presets…"
        className="w-full text-[11px] font-mono px-2 py-1 bg-graphite/60 border border-border rounded focus:outline-none focus:border-primary/60"
      />
      <div className="flex flex-wrap gap-1">
        {(["All", "Favs", ...MELODIC_CATEGORIES] as const).map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`text-[9px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
              category === c
                ? "border-primary text-primary"
                : "border-border hover:border-primary/60"
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="max-h-44 overflow-y-auto space-y-0.5">
        {filtered.map((p) => {
          const active = track.presetId === p.id;
          const fav = favs.includes(p.id);
          const showGuide = guidePresetId === p.id && p.guide;
          return (
            <div
              key={p.id}
              data-testid={`preset-row-${p.id}`}
              className={`px-1.5 py-1 rounded border ${
                active ? "border-primary/60" : "border-border/60"
              } hover:border-primary/60`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="font-mono text-[11px] truncate">{p.name}</span>
                    {p.layers?.length ? (
                      <span className="shrink-0 rounded border border-primary/35 px-1 py-0.5 font-mono text-[7px] uppercase tracking-wider text-primary">
                        HQ · {p.layers.length} zones
                      </span>
                    ) : null}
                  </div>
                  <div className="font-mono text-[9px] text-muted-foreground truncate">
                    {p.category} · {p.description}
                  </div>
                </div>
                {p.guide ? (
                  <button
                    type="button"
                    onClick={() => setGuidePresetId(showGuide ? null : p.id)}
                    aria-expanded={Boolean(showGuide)}
                    aria-label={`${showGuide ? "Hide" : "Show"} creative guide for ${p.name}`}
                    className={`text-[8px] font-mono px-1 py-0.5 border rounded ${
                      showGuide
                        ? "border-primary text-primary"
                        : "border-border text-muted-foreground hover:border-primary/60"
                    }`}
                  >
                    Learn
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => toggleFav(p.id)}
                  title={fav ? "Unfavorite" : "Favorite"}
                  aria-label={`${fav ? "Unfavorite" : "Favorite"} ${p.name}`}
                  className={`text-[10px] px-1 ${
                    fav ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {fav ? "★" : "☆"}
                </button>
                <button
                  type="button"
                  onClick={() => void preview(p)}
                  aria-label={`Preview ${p.name}`}
                  className="text-[9px] font-mono px-1 py-0.5 border border-border rounded hover:border-primary/60"
                >
                  {previewingId === p.id ? "…" : "▶"}
                </button>
                <button
                  type="button"
                  onClick={() => load(p)}
                  className={`text-[9px] font-mono px-1.5 py-0.5 border rounded ${
                    active
                      ? "border-primary text-primary"
                      : "border-border hover:border-primary/60"
                  }`}
                >
                  {active ? "Loaded" : "Load"}
                </button>
              </div>
              {showGuide ? (
                <div className="mt-1.5 rounded border border-primary/20 bg-primary/5 p-2 text-[9px] leading-relaxed">
                  <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
                    <span className="font-mono uppercase tracking-wider text-primary">Family</span>
                    <span className="text-muted-foreground">{p.guide!.family}</span>
                    <span className="font-mono uppercase tracking-wider text-primary">Range</span>
                    <span className="text-muted-foreground">{p.guide!.register}</span>
                    <span className="font-mono uppercase tracking-wider text-primary">Hear</span>
                    <span className="text-muted-foreground">{p.guide!.listeningCue}</span>
                    <span className="font-mono uppercase tracking-wider text-primary">Try</span>
                    <span className="text-foreground">{p.guide!.creativeMove}</span>
                  </div>
                  <div className="mt-1.5 border-t border-border/60 pt-1 text-[8px] text-muted-foreground">
                    {p.guide!.character} · {FACTORY_SAMPLE_SOURCE.license}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="font-mono text-[10px] text-muted-foreground p-2 text-center">
            No presets match.
          </div>
        )}
      </div>
    </div>
  );
}
