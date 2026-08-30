/**
 * Plugin Browser panel.
 *
 * Lists all registered plugins grouped by category.  Shows per-track
 * status badges (Active / Disabled / Error) and provides toggle controls.
 * A search input filters the list when it grows large.
 *
 * Effect plugins route through the existing fxRack enable/disable system
 * so toggling them here is identical to toggling them in the EffectsRack.
 *
 * WAM plugins loaded at runtime appear in their own "WAM" section with
 * per-parameter sliders that reflect the manifest's PluginParameterDescriptor
 * list. They are visually distinct from built-ins.
 */

import { useMemo, useState, useCallback, useRef } from "react";
import { Power, AlertTriangle, Search, PackagePlus, X, Loader2, ExternalLink } from "lucide-react";
import { useStore, getStore } from "../store";
import { pluginRegistry } from "../lib/plugins/registry";
import { PLUGIN_ID_TO_FX_MODULE } from "../lib/plugins/builtins";
import {
  loadWamPlugin,
  REMOTE_WAM_LOADING_SUPPORTED,
} from "../lib/plugins/wam-loader";
import type { PluginManifest } from "../lib/plugins/types";
import type { DrumKitId, FxModuleId } from "../types";

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
      if (store.applyMelodicPreset(selectedTrackId, presetId)) {
        store.setStatus(`Preset: ${manifest.name}`, "info");
      }
    } else if (manifest.id.startsWith("instrument.drumkit.")) {
      const kitId = manifest.id.replace("instrument.drumkit.", "") as DrumKitId;
      if (track.kind !== "drums") {
        store.setStatus("Select a drum track to change kits.", "warn");
        return;
      }
      if (store.applyDrumKit(selectedTrackId, kitId)) {
        store.setStatus(`Kit: ${manifest.name}`, "info");
      }
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

// ─── WAM plugin row ───────────────────────────────────────────────────────────

/**
 * A WAM plugin row shows the plugin name, its source URL as a link, and
 * a slider for every parameter listed in the manifest.  Parameter values
 * are local state — they serve as a UI representation; the engine would
 * read them via the factory instance when the plugin is wired up.
 */
function WamPluginRow({
  manifest,
  onUnload,
}: {
  manifest: PluginManifest;
  onUnload: (id: string) => void;
}) {
  const [params, setParams] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const p of manifest.parameters) {
      init[p.id] = p.defaultValue;
    }
    return init;
  });
  const [expanded, setExpanded] = useState(false);

  const setParam = (id: string, value: number) => {
    setParams((prev) => ({ ...prev, [id]: value }));
  };

  return (
    <div className="rounded border border-primary/20 bg-primary/5 mb-1 overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[11px] truncate text-foreground/90 flex items-center gap-1">
            {manifest.name}
            <span className="text-[8px] font-mono px-1 py-0.5 bg-primary/20 text-primary rounded border border-primary/30 uppercase tracking-wider">
              WAM
            </span>
          </div>
          {manifest.wamUrl && (
            <a
              href={manifest.wamUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[9px] text-muted-foreground/60 hover:text-primary truncate mt-0.5 flex items-center gap-0.5 max-w-full"
              title={manifest.wamUrl}
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-2 h-2 flex-shrink-0" />
              <span className="truncate">{manifest.wamUrl}</span>
            </a>
          )}
        </div>
        <div className="flex items-center gap-1">
          {manifest.parameters.length > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[9px] font-mono text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-border/40 hover:border-border transition-colors"
              title={expanded ? "Hide parameters" : "Show parameters"}
            >
              {manifest.parameters.length}p
            </button>
          )}
          <button
            onClick={() => onUnload(manifest.id)}
            className="text-muted-foreground/50 hover:text-red-400 transition-colors"
            title="Remove WAM plugin"
            aria-label="Remove WAM plugin"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {expanded && manifest.parameters.length > 0 && (
        <div className="px-2 pb-2 space-y-1.5 border-t border-primary/10 pt-1.5">
          {manifest.parameters.map((p) => (
            <div key={p.id} className="flex items-center gap-2">
              <div className="w-16 font-mono text-[9px] text-muted-foreground truncate flex-shrink-0">
                {p.label}
              </div>
              <input
                type="range"
                min={p.min}
                max={p.max}
                step={p.step ?? (p.max - p.min) / 1000}
                value={params[p.id] ?? p.defaultValue}
                onChange={(e) => setParam(p.id, Number(e.target.value))}
                className="flex-1 h-1 accent-primary cursor-pointer"
                aria-label={p.label}
              />
              <div className="w-10 font-mono text-[9px] text-right text-muted-foreground/70 flex-shrink-0">
                {(params[p.id] ?? p.defaultValue).toFixed(2)}
                {p.unit ? ` ${p.unit}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── WAM load dialog ──────────────────────────────────────────────────────────

type DialogState = "idle" | "loading" | "error";

function WamLoadDialog({
  onClose,
  onLoaded,
}: {
  onClose: () => void;
  onLoaded: () => void;
}) {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<DialogState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleLoad = async () => {
    if (!url.trim()) return;
    setState("loading");
    setErrorMsg("");
    const result = await loadWamPlugin(url);
    if (result.ok) {
      setState("idle");
      onLoaded();
      onClose();
    } else {
      setState("error");
      setErrorMsg(result.error);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleLoad();
    if (e.key === "Escape") onClose();
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <PackagePlus className="w-3.5 h-3.5 text-primary" />
          <span className="font-mono text-[11px] text-foreground font-medium">
            External WAM Status
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 flex flex-col gap-3 p-3">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Remote WAM loading is paused until the Studio has a genuinely
          isolated audio-plugin host. Built-in instruments and effects remain
          fully available.
        </p>

        <div className="space-y-1">
          <label className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
            Plugin URL
          </label>
          <input
            ref={inputRef}
            autoFocus
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (state === "error") {
                setState("idle");
                setErrorMsg("");
              }
            }}
            onKeyDown={handleKey}
            placeholder="Remote plugin URLs are disabled during stabilization"
            className={`w-full bg-background/60 border rounded px-2 py-1.5 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none transition-colors ${
              state === "error"
                ? "border-red-500/60 focus:border-red-500"
                : "border-border focus:border-primary/50"
            }`}
            disabled={!REMOTE_WAM_LOADING_SUPPORTED || state === "loading"}
          />
          {state === "error" && (
            <div className="flex items-start gap-1.5 text-[9px] text-red-400 font-mono leading-snug">
              <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        <div className="bg-muted/20 border border-border/40 rounded p-2 space-y-0.5">
          <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-1">
            Why it is paused
          </div>
          <div className="text-[9px] text-muted-foreground/70 space-y-0.5">
            <p>• A URL-based module otherwise runs with this page's permissions.</p>
            <p>• The previous metadata loader did not route or process audio.</p>
            <p>• A try/catch is an error boundary, not a security sandbox.</p>
            <p>• Re-enabling requires isolation, integrity, routing, bypass, and cleanup.</p>
          </div>
        </div>

        <div className="flex gap-2 mt-auto">
          <button
            onClick={onClose}
            disabled={state === "loading"}
            className="flex-1 px-3 py-1.5 border border-border rounded font-mono text-[11px] text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleLoad}
            disabled={!REMOTE_WAM_LOADING_SUPPORTED || !url.trim() || state === "loading"}
            className="flex-1 px-3 py-1.5 bg-primary/20 border border-primary/40 hover:bg-primary/30 rounded font-mono text-[11px] text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            {state === "loading" ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading…
              </>
            ) : (
              <>
                <PackagePlus className="w-3 h-3" />
                Unavailable
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Group component ──────────────────────────────────────────────────────────

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

// ─── Main export ──────────────────────────────────────────────────────────────

export function PluginBrowser() {
  const [query, setQuery] = useState("");
  const [showWamDialog, setShowWamDialog] = useState(false);
  const [pluginVersion, setPluginVersion] = useState(0);

  const refresh = useCallback(() => {
    setPluginVersion((v) => v + 1);
  }, []);

  const allPlugins = useMemo(
    () => pluginRegistry.getAll(),
    [pluginVersion],
  );

  const wamPlugins = useMemo(
    () => allPlugins.filter((m) => !!m.wamUrl),
    [allPlugins],
  );

  const builtinPlugins = useMemo(
    () => allPlugins.filter((m) => !m.wamUrl),
    [allPlugins],
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return builtinPlugins;
    return builtinPlugins.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q),
    );
  }, [builtinPlugins, query]);

  const filteredWam = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return wamPlugins;
    return wamPlugins.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q) ||
        m.wamUrl?.toLowerCase().includes(q),
    );
  }, [wamPlugins, query]);

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

  const handleUnloadWam = useCallback((id: string) => {
    pluginRegistry.unregister(id);
    refresh();
  }, [refresh]);

  const totalCount = allPlugins.length;
  const builtinCount = builtinPlugins.length;

  return (
    <div className="flex flex-col h-full relative">
      {showWamDialog && (
        <WamLoadDialog
          onClose={() => setShowWamDialog(false)}
          onLoaded={refresh}
        />
      )}

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

      <div className="flex-1 overflow-y-auto px-1 pb-2">
        {effects.length > 0 && (
          <PluginGroup label="Effects" manifests={effects} kind="effect" />
        )}

        {Array.from(instrumentsByCategory.entries()).map(([cat, manifests]) => (
          <PluginGroup key={cat} label={cat} manifests={manifests} kind="instrument" />
        ))}

        {filteredWam.length > 0 && (
          <div className="mb-3">
            <div className="px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground border-b border-primary/20 mb-1 flex items-center gap-1.5">
              <span>WAM Plugins</span>
              <span className="text-[8px] px-1 bg-primary/10 text-primary/70 rounded">
                {filteredWam.length}
              </span>
            </div>
            <div>
              {filteredWam.map((m) => (
                <WamPluginRow key={m.id} manifest={m} onUnload={handleUnloadWam} />
              ))}
            </div>
          </div>
        )}

        {filtered.length === 0 && filteredWam.length === 0 && query && (
          <div className="px-2 py-4 text-[10px] font-mono text-muted-foreground text-center">
            No plugins match "{query}"
          </div>
        )}
      </div>

      <div className="px-2 py-1.5 border-t border-border/40 flex items-center justify-between gap-2">
        <div className="text-[9px] font-mono text-muted-foreground/50">
          {builtinCount} built-in
          {wamPlugins.length > 0 && ` · ${wamPlugins.length} WAM`}
          {" "}/ {totalCount} total
        </div>
        <button
          onClick={() => setShowWamDialog(true)}
          className="flex items-center gap-1 px-2 py-0.5 rounded border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary font-mono text-[9px] uppercase tracking-wider transition-colors"
          title="View external WAM security status"
        >
          <PackagePlus className="w-2.5 h-2.5" />
          WAM Status
        </button>
      </div>
    </div>
  );
}
