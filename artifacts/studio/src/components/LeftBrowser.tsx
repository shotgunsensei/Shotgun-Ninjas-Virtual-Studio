import { useEffect, useMemo, useRef, useState } from "react";
import { getStore, useStore } from "../store";
import { DRUM_KIT_LIST } from "../lib/audio/sounds/kits";
import { MELODIC_PRESETS } from "../lib/audio/sounds/presets";
import { listProjects, loadProject, relocateSampleBlob } from "../lib/storage/db";
import { flushMixToEngine } from "../store";
import { PluginBrowser } from "./PluginBrowser";
import { SoundLibraryPanel } from "./SoundLibraryPanel";

type TabId = "library" | "tracks" | "kits" | "presets" | "samples" | "projects" | "plugins";

const TABS: { id: TabId; label: string }[] = [
  { id: "library", label: "Library" },
  { id: "tracks", label: "Tracks" },
  { id: "kits", label: "Kits" },
  { id: "presets", label: "Presets" },
  { id: "samples", label: "Samples" },
  { id: "projects", label: "Projects" },
  { id: "plugins", label: "Plugins" },
];

const STORAGE_KEY = "studio.browser.tab";

export function LeftBrowser() {
  const [tab, setTab] = useState<TabId>(() => {
    if (typeof localStorage === "undefined") return "tracks";
    const v = localStorage.getItem(STORAGE_KEY);
    return (TABS.find((t) => t.id === v)?.id ?? "tracks") as TabId;
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, tab);
    } catch {
      /* quota */
    }
  }, [tab]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex border-b border-border bg-graphite/60 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-2 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
              tab === t.id
                ? "text-foreground border-b border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title={t.label}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === "library" && <SoundLibraryPanel />}
        {tab === "tracks" && <TracksTab />}
        {tab === "kits" && <KitsTab />}
        {tab === "presets" && <PresetsTab />}
        {tab === "samples" && <SamplesTab />}
        {tab === "projects" && <ProjectsTab />}
        {tab === "plugins" && <PluginBrowser />}
      </div>
    </div>
  );
}

function TracksTab() {
  const tracks = useStore((s) => s.project.tracks);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  return (
    <div className="p-2 space-y-1">
      {tracks.map((t, i) => {
        const active = t.id === selectedTrackId;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => getStore().set({ selectedTrackId: t.id })}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded font-mono text-[11px] text-left transition-colors ${
              active
                ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
            }`}
            title={`${t.name} — press ${i + 1} to focus`}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: t.meta?.color || "var(--primary)" }}
            />
            <span className="truncate flex-1">{t.name}</span>
            <span className="text-[9px] uppercase tracking-widest opacity-60">
              {i < 8 ? i + 1 : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function KitsTab() {
  const drumTrack = useStore((s) =>
    s.project.tracks.find((t) => t.kind === "drums"),
  );
  return (
    <div className="p-2 space-y-1">
      <div className="px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        {drumTrack ? `Drum track · ${drumTrack.name}` : "No drum track"}
      </div>
      {DRUM_KIT_LIST.map((k) => {
        const active = drumTrack?.kitId === k.id;
        return (
          <button
            key={k.id}
            type="button"
            disabled={!drumTrack}
            onClick={() => {
              if (!drumTrack) return;
              getStore().patchTrack(drumTrack.id, { kitId: k.id });
              getStore().set({ selectedTrackId: drumTrack.id });
              flushMixToEngine(getStore().state.project);
              getStore().setStatus(`Kit: ${k.name}`, "info");
            }}
            className={`w-full px-2 py-1.5 rounded font-mono text-[11px] text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              active
                ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
            }`}
            title={k.name}
          >
            {k.name}
          </button>
        );
      })}
    </div>
  );
}

function PresetsTab() {
  const tracks = useStore((s) => s.project.tracks);
  const selectedId = useStore((s) => s.selectedTrackId);
  const target = useMemo(
    () =>
      tracks.find(
        (t) =>
          t.id === selectedId &&
          (t.kind === "piano" || t.kind === "bass" || t.kind === "guitar"),
      ) ??
      tracks.find(
        (t) => t.kind === "piano" || t.kind === "bass" || t.kind === "guitar",
      ),
    [tracks, selectedId],
  );
  return (
    <div className="p-2 space-y-1">
      <div className="px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
        {target ? `Melodic track · ${target.name}` : "No melodic track"}
      </div>
      {MELODIC_PRESETS.map((p) => {
        const active = target?.presetId === p.id;
        return (
          <button
            key={p.id}
            type="button"
            disabled={!target}
            onClick={() => {
              if (!target) return;
              getStore().patchTrack(target.id, { presetId: p.id });
              getStore().set({ selectedTrackId: target.id });
              flushMixToEngine(getStore().state.project);
              getStore().setStatus(`Preset: ${p.name}`, "info");
            }}
            className={`w-full px-2 py-1.5 rounded font-mono text-[11px] text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              active
                ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
            }`}
            title={`${p.name} · ${p.category}`}
          >
            <div className="truncate">{p.name}</div>
            <div className="text-[9px] uppercase tracking-widest opacity-60">
              {p.category}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SamplesTab() {
  const samples = useStore((s) => s.project.samples ?? []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingSampleIdRef = useRef<string | null>(null);

  const startLocate = (sampleId: string) => {
    pendingSampleIdRef.current = sampleId;
    fileInputRef.current?.click();
  };

  const onLocateFile = async (file: File) => {
    const sampleId = pendingSampleIdRef.current;
    pendingSampleIdRef.current = null;
    if (!sampleId) return;
    const proj = getStore().state.project;
    const target = (proj.samples ?? []).find((s) => s.id === sampleId);
    if (!target) return;
    try {
      // Rewrite the blob behind the sample's existing blobKey so any
      // clip that references the sample picks up the new audio on next
      // load without a full project reload.
      await relocateSampleBlob(target.blobKey, file);
      const ac = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const buf = await ac.decodeAudioData(await file.arrayBuffer());
      const durationSec = buf.duration;
      ac.close();
      const nextSamples = (proj.samples ?? []).map((s) =>
        s.id === sampleId ? { ...s, blob: file, durationSec } : s,
      );
      getStore().patchProject({ samples: nextSamples });
      getStore().setStatus(`Sample "${target.name}" located`, "info");
    } catch (err) {
      getStore().setStatus(
        `Locate failed: ${(err as Error).message}`,
        "error",
      );
    }
  };

  return (
    <div className="p-2 space-y-1">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onLocateFile(f);
          e.target.value = "";
        }}
      />
      {samples.length === 0 && (
        <div className="px-2 py-3 font-mono text-[10px] text-muted-foreground">
          No samples yet. Drop an audio file onto the timeline to import one.
        </div>
      )}
      {samples.map((s) => {
        const missing = !!s.blobKey && !s.blob;
        return (
          <div
            key={s.id}
            className={`px-2 py-1.5 rounded font-mono text-[11px] border ${
              missing
                ? "bg-yellow-600/10 border-yellow-600/40 text-yellow-200"
                : "bg-background/40 border-border text-muted-foreground"
            }`}
            title={s.name}
          >
            <div className="flex items-center gap-1">
              <div className="truncate text-foreground/90 flex-1">{s.name}</div>
              {missing && (
                <span className="text-[8px] uppercase tracking-widest text-yellow-400 border border-yellow-600/50 rounded px-1">
                  Missing
                </span>
              )}
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <div className="text-[9px] uppercase tracking-widest opacity-60">
                {s.durationSec.toFixed(2)}s
              </div>
              {missing && (
                <button
                  type="button"
                  onClick={() => startLocate(s.id)}
                  className="text-[9px] uppercase tracking-widest text-yellow-300 hover:text-yellow-100 underline underline-offset-2"
                  data-testid={`locate-sample-${s.id}`}
                >
                  Locate sample
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProjectsTab() {
  const [items, setItems] = useState<
    Array<{ id: string; name: string; updatedAt: number }>
  >([]);
  const currentId = useStore((s) => s.project.id);
  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [currentId]);
  return (
    <div className="p-2 space-y-1">
      {items.length === 0 && (
        <div className="px-2 py-3 font-mono text-[10px] text-muted-foreground">
          No saved projects yet.
        </div>
      )}
      {items.map((p) => {
        const active = p.id === currentId;
        return (
          <button
            key={p.id}
            type="button"
            onClick={async () => {
              try {
                const proj = await loadProject(p.id);
                if (!proj) return;
                getStore().set({ project: proj });
                flushMixToEngine(proj);
                getStore().setStatus(`Loaded "${proj.name}"`, "info");
              } catch (err) {
                getStore().setStatus(
                  `Load failed: ${(err as Error).message}`,
                  "error",
                );
              }
            }}
            className={`w-full px-2 py-1.5 rounded font-mono text-[11px] text-left transition-colors ${
              active
                ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                : "text-muted-foreground hover:bg-accent/30 hover:text-foreground"
            }`}
            title={p.name}
          >
            <div className="truncate">{p.name}</div>
            <div className="text-[9px] uppercase tracking-widest opacity-60">
              {new Date(p.updatedAt).toLocaleString()}
            </div>
          </button>
        );
      })}
    </div>
  );
}
