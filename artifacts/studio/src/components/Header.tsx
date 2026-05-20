import { useEffect, useRef, useState } from "react";
import {
  Save,
  FolderOpen,
  FilePlus2,
  HelpCircle,
  Download,
  Copy,
  FileText,
  Upload,
  AlertTriangle,
  Maximize2,
  Minimize2,
  Keyboard as KeyboardIcon,
  Settings as SettingsIcon,
  Info,
} from "lucide-react";
import { Logo } from "./Logo";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { ShortcutOverlay } from "./ShortcutOverlay";
import { SettingsModal } from "./SettingsModal";
import { AboutDialog } from "./AboutDialog";
import { Tip } from "./Tip";
import { useSettings, getSettings } from "../lib/settings";
import { PwaInstallControls } from "./PwaInstallControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useStore, getStore, resetStore, defaultProject } from "../store";
import { audio } from "../lib/audio/engine";
import { DEMOS, loadDemo, remixDemo } from "../lib/demos";
import {
  renderProject,
  downloadBlob,
  studioExportFilename,
  detectClipping,
  type ExportFormat,
  type RenderProgress,
} from "../lib/audio/export";
import {
  saveProject,
  listProjects,
  loadProject,
  deleteProject,
  setLastProjectId,
  duplicateProject,
  projectToJson,
  parseProjectJson,
} from "../lib/storage/db";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function Header() {
  const project = useStore((s) => s.project);
  const [openLoad, setOpenLoad] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const showShortcutsButton = useSettings((s) => s.showShortcutsButton);
  const [isFullscreen, setIsFullscreen] = useState(
    typeof document !== "undefined" && !!document.fullscreenElement,
  );

  // mirror the browser's fullscreen state so the icon flips correctly
  // whether the user toggled via the button, the F shortcut, or Esc.
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // open the shortcut overlay when the user fires the global event from
  // App.tsx's keyboard handler (so the listener can live next to the
  // other shortcut wiring without prop-drilling state)
  useEffect(() => {
    const onOpen = () => setShortcutsOpen(true);
    const onExport = () => setExportModalOpen(true);
    window.addEventListener("studio:open-shortcuts", onOpen);
    window.addEventListener("studio:open-export", onExport);
    return () => {
      window.removeEventListener("studio:open-shortcuts", onOpen);
      window.removeEventListener("studio:open-export", onExport);
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else {
        getStore().setStatus(
          "Fullscreen isn't supported in this browser.",
          "warn",
        );
      }
    } catch (err) {
      getStore().setStatus(
        `Fullscreen failed: ${(err as Error).message}`,
        "warn",
      );
    }
  };

  const [projects, setProjects] = useState<
    Array<{ id: string; name: string; updatedAt: number }>
  >([]);
  // External components (HelpDialog) request the demo picker via a
  // store flag rather than duplicating the dialog markup.
  const requestOpenLoadDialog = useStore((s) => s.requestOpenLoadDialog);
  useEffect(() => {
    if (!requestOpenLoadDialog) return;
    (async () => {
      setProjects(await listProjects());
      setOpenLoad(true);
      getStore().set({ requestOpenLoadDialog: false });
    })();
  }, [requestOpenLoadDialog]);
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("wav");
  const [exportProgress, setExportProgress] = useState<RenderProgress>({
    phase: "rendering",
    progress: 0,
  });
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [loopOnly, setLoopOnly] = useState(false);
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const jsonImportRef = useRef<HTMLInputElement>(null);

  const startExport = async (format: ExportFormat) => {
    if (exporting) return;
    audio.stop();
    setExportFormat(format);
    setExportError(null);
    setExportProgress({ phase: "decoding", progress: 0 });
    setExporting(true);
    cancelRef.current = { cancelled: false };
    try {
      const proj = getStore().state.project;
      const result = await renderProject(
        proj,
        format,
        (p) => {
          if (cancelRef.current.cancelled) {
            throw new Error("Export cancelled");
          }
          setExportProgress(p);
        },
        { loopOnly },
      );
      if (cancelRef.current.cancelled) throw new Error("Export cancelled");
      // Detect clipping for status surface
      try {
        const ac = new AudioContext();
        const buf = await ac.decodeAudioData(
          (await result.blob.arrayBuffer()).slice(0),
        );
        const { clipped, peakDb } = detectClipping(buf);
        if (clipped) {
          getStore().setStatus(
            `Master clipped (${peakDb.toFixed(1)} dBFS) — consider lowering master.`,
            "warn",
          );
        }
        await ac.close();
      } catch {
        // ignore peak detection failures
      }
      downloadBlob(
        result.blob,
        studioExportFilename(proj.name, proj.bpm, result.extension),
      );
      getStore().setStatus(`Exported ${format.toUpperCase()}`, "info");
    } catch (err) {
      const msg = (err as Error).message || "Export failed";
      if (msg === "Export cancelled") {
        getStore().setStatus("Export cancelled", "warn");
      } else {
        setExportError(msg);
        getStore().setStatus(`Export failed: ${msg}`, "error");
      }
    } finally {
      setExporting(false);
    }
  };

  const onJsonExport = async () => {
    try {
      const proj = getStore().state.project;
      const text = await projectToJson(proj);
      const blob = new Blob([text], { type: "application/json" });
      downloadBlob(blob, studioExportFilename(proj.name, proj.bpm, "json"));
      getStore().setStatus("Project JSON exported", "info");
    } catch (err) {
      getStore().setStatus(
        `JSON export failed: ${(err as Error).message}`,
        "error",
      );
    }
  };

  const onJsonImport = async (file: File) => {
    try {
      const text = await file.text();
      const proj = parseProjectJson(text);
      await saveProject(proj);
      await setLastProjectId(proj.id);
      resetStore(proj);
      window.location.reload();
    } catch (err) {
      getStore().setStatus(
        `JSON import failed: ${(err as Error).message}`,
        "error",
      );
    }
  };

  const onNew = async () => {
    const settings = getSettings();
    if (
      settings.confirmBeforeOverwrite &&
      !window.confirm(
        "Start a fresh project? Your current project will stay saved in the Load dialog.",
      )
    ) {
      return;
    }
    audio.stop();
    const proj = defaultProject();
    // Honor user defaults for new projects.
    proj.bpm = settings.defaultBpm;
    proj.masterVolume = settings.defaultMasterVolume;
    const drumTrack = proj.tracks.find((t) => t.kind === "drums");
    if (drumTrack) drumTrack.kitId = settings.defaultKit;
    await saveProject(proj);
    await setLastProjectId(proj.id);
    resetStore(proj);
    window.location.reload();
  };

  const onSave = async () => {
    try {
      await saveProject(getStore().state.project);
      // Promote a transient demo into a real saved project so future
      // edits autosave normally.
      if (getStore().state.isTransientProject) {
        getStore().set({ isTransientProject: false });
      }
      getStore().setStatus("Project saved", "info");
    } catch (err) {
      getStore().setStatus(`Save failed: ${(err as Error).message}`, "error");
    }
  };

  const onSaveAs = async () => {
    const cur = getStore().state.project;
    const name = window.prompt("Save project as", `${cur.name} copy`);
    if (!name) return;
    try {
      const dup = await duplicateProject(cur, name);
      await setLastProjectId(dup.id);
      resetStore(dup);
      window.location.reload();
    } catch (err) {
      getStore().setStatus(
        `Save As failed: ${(err as Error).message}`,
        "error",
      );
    }
  };

  const onDuplicate = async (id: string) => {
    const proj = await loadProject(id);
    if (!proj) return;
    const dup = await duplicateProject(proj, `${proj.name} copy`);
    setProjects(await listProjects());
    getStore().setStatus(`Duplicated to “${dup.name}”`, "info");
  };

  const openLoadDialog = async () => {
    setProjects(await listProjects());
    setOpenLoad(true);
  };

  const onLoad = async (id: string) => {
    const proj = await loadProject(id);
    if (!proj) return;
    audio.stop();
    await setLastProjectId(id);
    resetStore(proj);
    setOpenLoad(false);
    window.location.reload();
  };

  const onDelete = async (id: string) => {
    await deleteProject(id);
    setProjects(await listProjects());
  };

  return (
    <header className="h-14 border-b border-border flex items-center px-4 gap-4 bg-graphite">
      <div className="flex items-center gap-3">
        <Logo className="w-9 h-9" />
        <div className="leading-tight">
          <div className="font-display text-sm tracking-[0.2em] text-foreground/90">
            SHOTGUN NINJAS
          </div>
          <div className="font-mono text-[10px] tracking-[0.3em] text-primary uppercase">
            Virtual Studio
          </div>
        </div>
      </div>

      <div className="h-8 w-px bg-border mx-2" />

      <div className="flex items-center gap-2 flex-1 max-w-md">
        <span className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
          Project
        </span>
        <Input
          value={project.name}
          onChange={(e) => getStore().patchProject({ name: e.target.value })}
          className="h-8 bg-background border-border font-mono text-sm"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onNew} className="font-mono text-xs">
          <FilePlus2 className="w-3.5 h-3.5 mr-1" /> New
        </Button>
        <Button variant="outline" size="sm" onClick={onSave} className="font-mono text-xs">
          <Save className="w-3.5 h-3.5 mr-1" /> Save
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onSaveAs}
          className="font-mono text-xs"
        >
          <Copy className="w-3.5 h-3.5 mr-1" /> Save As
        </Button>
        <Button variant="outline" size="sm" onClick={openLoadDialog} className="font-mono text-xs">
          <FolderOpen className="w-3.5 h-3.5 mr-1" /> Load
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setExportModalOpen(true)}
          disabled={exporting}
          className="font-mono text-xs"
        >
          <Download className="w-3.5 h-3.5 mr-1" /> Export
        </Button>
        <PwaInstallControls />
        <Tip label="Help & onboarding">
          <Button
            variant="outline"
            size="sm"
            onClick={() => getStore().set({ showHelp: true })}
            className="font-mono text-xs"
          >
            <HelpCircle className="w-3.5 h-3.5 mr-1" /> Help
          </Button>
        </Tip>
        {showShortcutsButton && (
          <Tip label="Keyboard shortcuts (?)">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShortcutsOpen(true)}
              className="font-mono text-xs"
              aria-label="Keyboard shortcuts"
            >
              <KeyboardIcon className="w-3.5 h-3.5" />
            </Button>
          </Tip>
        )}
        <Tip label="Studio settings">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            className="font-mono text-xs"
            aria-label="Settings"
          >
            <SettingsIcon className="w-3.5 h-3.5" />
          </Button>
        </Tip>
        <Tip label="About, changelog & feedback">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAboutOpen(true)}
            className="font-mono text-xs"
            aria-label="About"
          >
            <Info className="w-3.5 h-3.5" />
          </Button>
        </Tip>
        <Tip label={isFullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleFullscreen}
            className="font-mono text-xs"
            aria-label="Toggle fullscreen"
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </Button>
        </Tip>
        <ThemeSwitcher />
        <input
          ref={jsonImportRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onJsonImport(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* Export modal — opens chooser, kicks off render, shows progress, cancel, errors */}
      <Dialog
        open={exportModalOpen || exporting || exportError !== null}
        onOpenChange={(open) => {
          if (!open) {
            if (exporting) return; // can't dismiss mid-render
            setExportModalOpen(false);
            setExportError(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Export song</DialogTitle>
            <DialogDescription>
              <span className="font-mono text-xs">
                {project.name} · {project.bpm} BPM ·{" "}
                {project.loopEnabled
                  ? `loop ${project.loopStartBeat}–${project.loopEndBeat} beats`
                  : `${project.bars} bars`}
              </span>
            </DialogDescription>
          </DialogHeader>

          {!exporting && !exportError && (
            <div className="space-y-3">
              <ClippingWarning />

              {project.loopEnabled && (
                <label className="flex items-center gap-2 text-xs font-mono">
                  <input
                    type="checkbox"
                    checked={loopOnly}
                    onChange={(e) => setLoopOnly(e.target.checked)}
                  />
                  Export loop region only
                </label>
              )}

              <button
                type="button"
                onClick={() => startExport("wav")}
                className="w-full text-left border border-border rounded-md p-3 bg-background hover:bg-accent/40 transition-colors"
              >
                <div className="font-mono text-sm">Export WAV</div>
                <div className="text-xs text-muted-foreground">
                  Uncompressed PCM, 44.1 kHz, 16-bit stereo.
                </div>
              </button>
              <button
                type="button"
                onClick={() => startExport("mp3")}
                className="w-full text-left border border-border rounded-md p-3 bg-background hover:bg-accent/40 transition-colors"
              >
                <div className="font-mono text-sm">Export MP3</div>
                <div className="text-xs text-muted-foreground">
                  192 kbps stereo. Smaller, easy to share.
                </div>
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onJsonExport();
                    setExportModalOpen(false);
                  }}
                  className="text-left border border-border rounded-md p-3 bg-background hover:bg-accent/40 transition-colors"
                >
                  <div className="font-mono text-sm flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5" /> Project JSON
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Re-importable project file.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExportModalOpen(false);
                    jsonImportRef.current?.click();
                  }}
                  className="text-left border border-border rounded-md p-3 bg-background hover:bg-accent/40 transition-colors"
                >
                  <div className="font-mono text-sm flex items-center gap-1">
                    <Upload className="w-3.5 h-3.5" /> Import JSON
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Restore a project from JSON.
                  </div>
                </button>
              </div>
              <button
                type="button"
                disabled
                className="w-full text-left border border-border rounded-md p-3 bg-background/40 opacity-60 cursor-not-allowed"
              >
                <div className="font-mono text-sm">Export Stems</div>
                <div className="text-xs text-muted-foreground">
                  Coming soon — per-track WAV exports.
                </div>
              </button>
            </div>
          )}

          {exporting && !exportError && (
            <div className="space-y-3">
              <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                {exportProgress.phase === "decoding" && "Loading audio clips…"}
                {exportProgress.phase === "rendering" && "Mixing down…"}
                {exportProgress.phase === "encoding" &&
                  `Encoding ${exportFormat.toUpperCase()}…`}
              </div>
              <Progress value={Math.round(exportProgress.progress * 100)} />
              <div className="flex justify-between items-center text-xs font-mono">
                <span className="text-muted-foreground">
                  {Math.round(exportProgress.progress * 100)}%
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    cancelRef.current.cancelled = true;
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {exportError && (
            <div className="space-y-3">
              <p className="text-sm text-destructive font-mono break-words">
                {exportError}
              </p>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => {
                    setExportError(null);
                    setExportModalOpen(false);
                  }}
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={openLoad} onOpenChange={setOpenLoad}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Load project</DialogTitle>
            <DialogDescription>
              Pick a built-in demo to play with, or open one of your saved
              sessions.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[28rem] overflow-y-auto pr-1">
            <section data-testid="demo-list">
              <div className="font-mono text-[10px] uppercase tracking-widest text-primary mb-2">
                Demos
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {DEMOS.map((d) => (
                  <div
                    key={d.id}
                    data-testid={`demo-card-${d.id}`}
                    className="border border-border rounded-md p-2 bg-background hover:border-primary/60 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-mono text-sm">{d.name}</div>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-primary border border-primary/40 rounded px-1.5 py-0.5">
                        {d.bpm} BPM
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 leading-snug">
                      {d.description}
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-widest text-foreground/60 mt-1">
                      {d.styleTag}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid={`demo-load-${d.id}`}
                        onClick={() => {
                          loadDemo(d.id);
                          setOpenLoad(false);
                        }}
                        className="flex-1 font-mono text-[11px]"
                      >
                        Load
                      </Button>
                      <Button
                        size="sm"
                        data-testid={`demo-remix-${d.id}`}
                        onClick={async () => {
                          remixDemo(d.id);
                          try {
                            const proj = getStore().state.project;
                            await saveProject(proj);
                            await setLastProjectId(proj.id);
                          } catch {
                            /* autosave will retry */
                          }
                          setOpenLoad(false);
                        }}
                        className="flex-1 font-mono text-[11px]"
                        title="Fork this demo into a new editable project"
                      >
                        Remix
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                <span className="font-mono">Load</span> plays the demo without
                saving — hit <span className="font-mono">Save As</span> to keep
                your edits. <span className="font-mono">Remix</span> forks it
                into a fresh editable project.
              </p>
            </section>
            <section>
              <div className="font-mono text-[10px] uppercase tracking-widest text-primary mb-2">
                Your projects
              </div>
            {projects.length === 0 && (
              <p className="text-sm text-muted-foreground">No saved projects.</p>
            )}
            {projects.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between border border-border rounded-md p-2 bg-background"
              >
                <div>
                  <div className="font-mono text-sm">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(p.updatedAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => onLoad(p.id)}>
                    Open
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onDuplicate(p.id)}
                  >
                    Duplicate
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => onDelete(p.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <ShortcutOverlay open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </header>
  );
}

/**
 * Project-wide clipping warning shown in the export modal. Reads the
 * post-master peak meter and lights up if any sample has clipped recently.
 */
function ClippingWarning() {
  const peak = audio.getMasterLevels().peakDb;
  const maxPeak = Math.max(peak[0], peak[1]);
  if (!Number.isFinite(maxPeak) || maxPeak < -1) return null;
  return (
    <div className="flex items-start gap-2 border border-yellow-600/50 bg-yellow-600/10 rounded-md p-2 text-xs font-mono">
      <AlertTriangle className="w-4 h-4 text-yellow-500 flex-none mt-0.5" />
      <span>
        Master is near or above 0 dBFS ({maxPeak.toFixed(1)} dBFS). Consider
        lowering the master volume before bouncing to avoid audible clipping.
      </span>
    </div>
  );
}
