import { useMemo, useState, useEffect } from "react";
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
    getStore().setStatus(`Loaded preset: ${p.name}`, "info");
  };

  const preview = (p: MelodicPresetDef) => {
    audio.unlock().catch(() => {});
    audio.previewPresetNote(p.id, p.category === "Bass" ? "A2" : "C4", 0.7);
  };

  return (
    <div className="panel-inset rounded-md p-2 space-y-2">
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
          return (
            <div
              key={p.id}
              className={`flex items-center justify-between gap-1 px-1.5 py-1 rounded border ${
                active ? "border-primary/60" : "border-border/60"
              } hover:border-primary/60`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[11px] truncate">{p.name}</div>
                <div className="font-mono text-[9px] text-muted-foreground truncate">
                  {p.category} · {p.description}
                </div>
              </div>
              <button
                onClick={() => toggleFav(p.id)}
                title={fav ? "Unfavorite" : "Favorite"}
                className={`text-[10px] px-1 ${
                  fav ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {fav ? "★" : "☆"}
              </button>
              <button
                onClick={() => preview(p)}
                className="text-[9px] font-mono px-1 py-0.5 border border-border rounded hover:border-primary/60"
              >
                ▶
              </button>
              <button
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
