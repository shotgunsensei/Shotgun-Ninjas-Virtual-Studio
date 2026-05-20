/**
 * Plugin Browser panel.
 *
 * Lists all registered plugins grouped by category.  Shows per-track
 * status badges (Active / Disabled / Error) and provides toggle controls.
 * A search input filters the list when it grows large.
 *
 * Effect plugins route through the existing fxRack enable/disable system
 * so toggling them here is identical to toggling them in the EffectsRack.
 */

import { useMemo, useState } from "react";
import { Power, AlertTriangle, Search } from "lucide-react";
import { useStore, getStore } from "../store";
import { pluginRegistry } from "../lib/plugins/registry";
import { PLUGIN_ID_TO_FX_MODULE } from "../lib/plugins/builtins";
import type { PluginManifest } from "../lib/plugins/types";
import type { FxModuleId } from "../types";

type StatusBadge = "active" | "disabled" | "errored" | "inactive";

function getEffectStatus(
  pluginId: string,
  fxRack: Record<string, { enabled: boolean }> | undefined,
): StatusBadge {
  const fxModuleId = PLUGIN_ID_TO_FX_MODULE[pluginId];
  if (!fxModuleId) return "inactive";
  const settings = fxRack?.[fxModuleId];
  if (!settings) return "inactive";
  return settings.enabled ? "active" : "disabled";
}

function getInstrumentStatus(
  pluginId: string,
  trackPresetId: string | undefined,
  trackKitId: string | undefined,
): StatusBadge {
  if (pluginId.startsWith("instrument.melodic.")) {
    const presetId = pluginId.replace("instrument.melodic.", "");
    return trackPresetId === presetId ? "active" : "inactive";
  }
  if (pluginId.startsWith("instrument.drumkit.")) {
    const kitId = pluginId.replace("instrument.drumkit.", "");
    return trackKitId === kitId ? "active" : "inactive";
  }
  return "inactive";
}

const STATUS_STYLES: Record<StatusBadge, string> = {
  active: "bg-primary/20 text-primary border-primary/40",
  disabled: "bg-muted/40 text-muted-foreground border-border",
  errored: "bg-red-500/20 text-red-400 border-red-500/40",
  inactive: "bg-muted/20 text-muted-foreground/50 border-transparent",
};

const STATUS_LABELS: Record<StatusBadge, string> = {
  active: "Active",
  disabled: "Off",
  errored: "Error",
  inactive: "—",
};

function StatusBadge({ status }: { status: StatusBadge }) {
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider border ${STATUS_STYLES[status]}`}
    >
      {status === "errored" && <AlertTriangle className="w-2.5 h-2.5" />}
      {STATUS_LABELS[status]}
    </span>
  );
}

function EffectPluginRow({ manifest }: { manifest: PluginManifest }) {
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const fxRack = useStore((s) => {
    const track = s.project.tracks.find((t) => t.id === selectedTrackId);
    return track?.fxRack as Record<string, { enabled: boolean }> | undefined;
  });

  const status = getEffectStatus(manifest.id, fxRack);
  const fxModuleId = PLUGIN_ID_TO_FX_MODULE[manifest.id] as FxModuleId;

  const toggle = () => {
    if (!selectedTrackId || !fxModuleId) return;
    const store = getStore();
    const cur = fxRack?.[fxModuleId];
    if (!cur || !cur.enabled) {
      store.setFxModule(selectedTrackId, fxModuleId, { enabled: true, amount: 0.5 });
    } else {
      store.setFxModule(selectedTrackId, fxModuleId, { enabled: false });
    }
  };

  const isActive = status === "active";

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded border transition-colors ${
        isActive
          ? "border-primary/30 bg-primary/5"
          : "border-transparent bg-transparent hover:bg-accent/20"
      }`}
    >
      <button
        onClick={toggle}
        disabled={!selectedTrackId}
        className={`flex-shrink-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
        }`}
        aria-label={isActive ? "Disable" : "Enable"}
        title={isActive ? "Disable" : "Enable"}
      >
        <Power className="w-3 h-3" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[11px] truncate text-foreground/90">
          {manifest.name}
        </div>
        {manifest.description && (
          <div className="text-[9px] text-muted-foreground/70 truncate mt-0.5">
            {manifest.description}
          </div>
        )}
      </div>
      <StatusBadge status={status} />
    </div>
  );
}

function InstrumentPluginRow({ manifest }: { manifest: PluginManifest }) {
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const track = useStore((s) =>
    s.project.tracks.find((t) => t.id === selectedTrackId),
  );

  const status = getInstrumentStatus(
    manifest.id,
    track?.presetId,
    track?.kitId,
  );

  const isActive = status === "active";

  const activate = () => {
    if (!selectedTrackId || !track) return;
    const store = getStore();
    if (manifest.id.startsWith("instrument.melodic.")) {
      const presetId = manifest.id.replace("instrument.melodic.", "");
      const compatible =
        track.kind === "piano" || track.kind === "bass" || track.kind === "guitar";
      if (!compatible) {
        store.setStatus("Select a melodic track to apply this preset.", "warn");
        return;
      }
      store.patchTrack(selectedTrackId, { presetId });
      store.setStatus(`Preset: ${manifest.name}`, "info");
    } else if (manifest.id.startsWith("instrument.drumkit.")) {
      const kitId = manifest.id.replace("instrument.drumkit.", "");
      if (track.kind !== "drums") {
        store.setStatus("Select a drum track to change kits.", "warn");
        return;
      }
      store.patchTrack(selectedTrackId, { kitId });
      store.setStatus(`Kit: ${manifest.name}`, "info");
    }
  };

  return (
    <button
      onClick={activate}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded border text-left transition-colors ${
        isActive
          ? "border-primary/30 bg-primary/5"
          : "border-transparent bg-transparent hover:bg-accent/20"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[11px] truncate text-foreground/90">
          {manifest.name}
        </div>
        {manifest.description && (
          <div className="text-[9px] text-muted-foreground/70 truncate mt-0.5">
            {manifest.description}
          </div>
        )}
      </div>
      {isActive && <StatusBadge status="active" />}
    </button>
  );
}

function PluginGroup({
  label,
  manifests,
  kind,
}: {
  label: string;
  manifests: PluginManifest[];
  kind: "instrument" | "effect";
}) {
  if (manifests.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground border-b border-border/40 mb-1">
        {label}
      </div>
      <div className="space-y-0.5">
        {manifests.map((m) =>
          kind === "effect" ? (
            <EffectPluginRow key={m.id} manifest={m} />
          ) : (
            <InstrumentPluginRow key={m.id} manifest={m} />
          ),
        )}
      </div>
    </div>
  );
}

export function PluginBrowser() {
  const [query, setQuery] = useState("");

  const allPlugins = useMemo(() => pluginRegistry.getAll(), []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return allPlugins;
    return allPlugins.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q),
    );
  }, [allPlugins, query]);

  const effects = useMemo(
    () => filtered.filter((m) => m.kind === "effect"),
    [filtered],
  );

  const instrumentsByCategory = useMemo(() => {
    const map = new Map<string, PluginManifest[]>();
    for (const m of filtered) {
      if (m.kind !== "instrument") continue;
      const cat = m.category;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(m);
    }
    return map;
  }, [filtered]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 pt-2 pb-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search plugins…"
            className="w-full bg-background/60 border border-border rounded px-2 pl-6 py-1 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1 pb-4">
        {effects.length > 0 && (
          <PluginGroup label="Effects" manifests={effects} kind="effect" />
        )}

        {Array.from(instrumentsByCategory.entries()).map(([cat, manifests]) => (
          <PluginGroup key={cat} label={cat} manifests={manifests} kind="instrument" />
        ))}

        {filtered.length === 0 && (
          <div className="px-2 py-4 text-[10px] font-mono text-muted-foreground text-center">
            No plugins match "{query}"
          </div>
        )}
      </div>

      <div className="px-2 py-1 border-t border-border/40">
        <div className="text-[9px] font-mono text-muted-foreground/50">
          {allPlugins.length} built-in plugins registered
        </div>
      </div>
    </div>
  );
}
