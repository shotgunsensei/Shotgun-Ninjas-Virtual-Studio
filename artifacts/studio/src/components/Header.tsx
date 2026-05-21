import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
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
  Share2,
  Tag,
  Home,
} from "lucide-react";
import { ShareCardModal, type ShareCardData } from "./ShareCardModal";
import { ProjectInfoDialog } from "./ProjectInfoDialog";
import { ImportSummaryDialog } from "./ImportSummaryDialog";
import {
  canUseFileSystemAccess,
  canWebShare,
  canWebShareFiles,
  openProjectWithPicker,
  saveBlobWithPicker,
  shareAppLink,
  shareFile,
} from "../lib/share";
import type { ProjectImportSummary } from "../lib/storage/db";
import { Logo } from "./Logo";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { ShortcutOverlay } from "./ShortcutOverlay";
import { SettingsModal } from "./SettingsModal";
import { AboutDialog } from "./AboutDialog";
import { Tip } from "./Tip";
import {
  useSettings,
  getSettings,
  subscribeSettings,
  setAutosaveInterval,
  AUTOSAVE_OPTIONS,
  type AutosaveIntervalSec,
} from "../lib/settings";
import { PwaInstallControls } from "./PwaInstallControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useStore, getStore, resetStore, defaultProject, flushMixToEngine } from "../store";
import { audio } from "../lib/audio/engine";
import { DEMOS, loadDemo, remixDemo } from "../lib/demos";
import {
  renderProject,
  downloadBlob,
  studioExportFilename,
  studioProjectFilename,
  detectClipping,
  exportStemsZip,
  exportDawPack,
  type ExportFormat,
  type RenderProgress,
  type StemProgress,
} from "../lib/audio/export";
import { encodeMidiFile, encodeSingleTrackMidi } from "../lib/export/midi";
import { encodeMusicXml, hasMelodicTracks } from "../lib/export/musicxml";
import { parseMidiFile, midiToTrackPartials } from "../lib/import/midi";
import {
  saveProject,
  listProjects,
  loadProject,
  deleteProject,
  setLastProjectId,
  duplicateProject,
  projectToJson,
  parseProjectJson,
  projectHasUnembeddableSamples,
  summarizeProjectJson,
  getLastProjectId,
  loadDraft,
  hydrateDraft,
  clearDraft,
  type ProjectExportMode,
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
  const [, setLocation] = useLocation();
  const [openLoad, setOpenLoad] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [shareCardOpen, setShareCardOpen] = useState(false);
  const [shareCardData, setShareCardData] = useState<ShareCardData | null>(null);
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
    const onSettings = () => setSettingsOpen(true);
    const onAbout = () => setAboutOpen(true);
    const onNewProj = () => { void onNew(); };
    const onSaveProj = () => { void onSave(); };
    const onSaveAsProj = () => { void onSaveAs(); };
    const onOpenLoad = () => { void openLoadDialog(); };
    window.addEventListener("studio:open-shortcuts", onOpen);
    window.addEventListener("studio:open-export", onExport);
    window.addEventListener("studio:open-settings", onSettings);
    window.addEventListener("studio:open-about", onAbout);
    window.addEventListener("studio:new-project", onNewProj);
    window.addEventListener("studio:save", onSaveProj);
    window.addEventListener("studio:save-as", onSaveAsProj);
    window.addEventListener("studio:open-load", onOpenLoad);
    return () => {
      window.removeEventListener("studio:open-shortcuts", onOpen);
      window.removeEventListener("studio:open-export", onExport);
      window.removeEventListener("studio:open-settings", onSettings);
      window.removeEventListener("studio:open-about", onAbout);
      window.removeEventListener("studio:new-project", onNewProj);
      window.removeEventListener("studio:save", onSaveProj);
      window.removeEventListener("studio:save-as", onSaveAsProj);
      window.removeEventListener("studio:open-load", onOpenLoad);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  type ExportRangeMode = "whole" | "loop" | "custom";
  const [exportRangeMode, setExportRangeMode] = useState<ExportRangeMode>("whole");
  const [customStartBar, setCustomStartBar] = useState(1);
  const [customEndBar, setCustomEndBar] = useState(project.bars);
  const [projectInfoOpen, setProjectInfoOpen] = useState(false);
  const [importSummary, setImportSummary] =
    useState<ProjectImportSummary | null>(null);
  const [lastWav, setLastWav] = useState<{ blob: Blob; filename: string } | null>(
    null,
  );
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const jsonImportRef = useRef<HTMLInputElement>(null);
  const midiImportRef = useRef<HTMLInputElement>(null);
  const [stemsExporting, setStemsExporting] = useState(false);
  const [stemProgress, setStemProgress] = useState<StemProgress | null>(null);
  const [dawPackExporting, setDawPackExporting] = useState(false);
  const [dawPackProgress, setDawPackProgress] = useState<StemProgress | null>(null);

  const fsSaveSupported = canUseFileSystemAccess("save");
  const fsOpenSupported = canUseFileSystemAccess("open");
  const webShareSupported = canWebShare();
  const webShareFilesSupported = canWebShareFiles();

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
      const renderOptions =
        exportRangeMode === "loop"
          ? { loopOnly: true }
          : exportRangeMode === "custom"
          ? {
              customStartBeat: (customStartBar - 1) * 4,
              customEndBeat: customEndBar * 4,
            }
          : {};
      const result = await renderProject(
        proj,
        format,
        (p) => {
          if (cancelRef.current.cancelled) {
            throw new Error("Export cancelled");
          }
          setExportProgress(p);
        },
        renderOptions,
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
      const filename = studioExportFilename(proj.name, proj.bpm, result.extension);
      let saved = false;
      if (fsSaveSupported && format === "wav") {
        try {
          const chosen = await saveBlobWithPicker(result.blob, filename, "wav");
          if (chosen) {
            saved = true;
            getStore().setStatus(`Saved ${chosen}`, "info");
          } else {
            // user cancelled the picker — fall back to a normal download
            // so the export isn't lost.
          }
        } catch (err) {
          getStore().setStatus(
            `Save dialog failed, downloading instead: ${(err as Error).message}`,
            "warn",
          );
        }
      }
      if (!saved) {
        downloadBlob(result.blob, filename);
        getStore().setStatus(`Exported ${format.toUpperCase()}`, "info");
      }
      if (format === "wav") setLastWav({ blob: result.blob, filename });
      // Offer the share card after any successful export
      setShareCardData({
        projectName: proj.name,
        bpm: proj.bpm,
        genre: (proj as Record<string, unknown>).genre as string | undefined,
        exportDate: new Date(),
      });
      setShareCardOpen(true);
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

  const onJsonExport = async (mode: ProjectExportMode) => {
    try {
      const proj = getStore().state.project;
      const text = await projectToJson(proj, mode);
      const blob = new Blob([text], { type: "application/json" });
      const filename = studioProjectFilename(proj.name);
      let saved = false;
      if (fsSaveSupported) {
        try {
          const chosen = await saveBlobWithPicker(blob, filename, "project");
          if (chosen) {
            saved = true;
            getStore().setStatus(`Saved ${chosen}`, "info");
          }
        } catch (err) {
          getStore().setStatus(
            `Save dialog failed, downloading instead: ${(err as Error).message}`,
            "warn",
          );
        }
      }
      if (!saved) {
        downloadBlob(blob, filename);
        getStore().setStatus(
          mode === "project-with-samples"
            ? "Project + samples exported"
            : "Project exported",
          "info",
        );
      }
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
      const summary = summarizeProjectJson(text);
      setImportSummary(summary);
    } catch (err) {
      getStore().setStatus(
        `JSON import failed: ${(err as Error).message}`,
        "error",
      );
    }
  };

  const confirmImport = async () => {
    if (!importSummary) return;
    const proj = importSummary.project;
    try {
      audio.stop();
      await saveProject(proj);
      await setLastProjectId(proj.id);
      resetStore(proj);
      setImportSummary(null);
      window.location.reload();
    } catch (err) {
      getStore().setStatus(
        `Import failed: ${(err as Error).message}`,
        "error",
      );
    }
  };

  const onOpenFromDisk = async () => {
    try {
      const file = await openProjectWithPicker();
      if (!file) return;
      await onJsonImport(file);
    } catch (err) {
      getStore().setStatus(
        `Open failed: ${(err as Error).message}`,
        "error",
      );
    }
  };

  const onShareLink = async () => {
    const result = await shareAppLink();
    if (result === "shared") {
      getStore().setStatus("Thanks for sharing the studio.", "info");
    } else if (result === "copied") {
      getStore().setStatus("Studio link copied to clipboard.", "info");
    } else if (result === "unsupported") {
      getStore().setStatus("Sharing isn't available in this browser.", "warn");
    }
  };

  const onShareLastWav = async () => {
    if (!lastWav) return;
    const result = await shareFile(lastWav.blob, lastWav.filename, {
      text: "Made this in Shotgun Ninjas Virtual Studio, a free browser DAW.",
    });
    if (result === "shared") {
      getStore().setStatus("Shared WAV", "info");
    } else if (result === "unsupported") {
      downloadBlob(lastWav.blob, lastWav.filename);
      getStore().setStatus(
        "File sharing isn't available — downloaded instead.",
        "warn",
      );
    }
  };

  const onShareProjectJson = async (mode: ProjectExportMode) => {
    try {
      const proj = getStore().state.project;
      const text = await projectToJson(proj, mode);
      const blob = new Blob([text], { type: "application/json" });
      const filename = studioProjectFilename(proj.name);
      const result = await shareFile(blob, filename, {
        text: "Project file made in Shotgun Ninjas Virtual Studio.",
      });
      if (result === "shared") {
        getStore().setStatus("Shared project", "info");
      } else if (result === "unsupported") {
        downloadBlob(blob, filename);
        getStore().setStatus(
          "File sharing isn't available — downloaded instead.",
          "warn",
        );
      }
    } catch (err) {
      getStore().setStatus(
        `Share failed: ${(err as Error).message}`,
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

  const onMidiExport = () => {
    try {
      const proj = getStore().state.project;
      const exportTracks = proj.tracks.filter((t) => t.kind !== "vocals");
      if (exportTracks.length === 0) {
        getStore().setStatus("No exportable tracks for MIDI.", "warn");
        return;
      }
      const startBeat = loopOnly && proj.loopEnabled ? proj.loopStartBeat : 0;
      const endBeat = loopOnly && proj.loopEnabled ? proj.loopEndBeat : proj.bars * 4;
      const bytes = encodeMidiFile(proj, exportTracks, { startBeat, endBeat });
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "audio/midi" });
      const safe = proj.name.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "song";
      downloadBlob(blob, `${safe}.mid`);
      getStore().setStatus("MIDI exported", "info");
      setExportModalOpen(false);
    } catch (err) {
      getStore().setStatus(`MIDI export failed: ${(err as Error).message}`, "error");
    }
  };

  const onMusicXmlExport = () => {
    try {
      const proj = getStore().state.project;
      const startBeat = loopOnly && proj.loopEnabled ? proj.loopStartBeat : 0;
      const endBeat = loopOnly && proj.loopEnabled ? proj.loopEndBeat : proj.bars * 4;
      const xml = encodeMusicXml(proj, { startBeat, endBeat });
      const blob = new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" });
      const safe = proj.name.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "song";
      downloadBlob(blob, `${safe}.musicxml`);
      getStore().setStatus("MusicXML exported", "info");
      setExportModalOpen(false);
    } catch (err) {
      getStore().setStatus(`MusicXML export failed: ${(err as Error).message}`, "error");
    }
  };

  const onStemsExport = async () => {
    if (stemsExporting || dawPackExporting) return;
    audio.stop();
    setStemsExporting(true);
    setStemProgress(null);
    setExportModalOpen(false);
    try {
      const proj = getStore().state.project;
      const options = { loopOnly };
      const blob = await exportStemsZip(proj, options, (p) => setStemProgress(p));
      const safe = proj.name.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "song";
      downloadBlob(blob, `${safe}_stems.zip`);
      getStore().setStatus("Stems exported", "info");
    } catch (err) {
      getStore().setStatus(`Stems export failed: ${(err as Error).message}`, "error");
    } finally {
      setStemsExporting(false);
      setStemProgress(null);
    }
  };

  const onDawPackExport = async () => {
    if (stemsExporting || dawPackExporting) return;
    audio.stop();
    setDawPackExporting(true);
    setDawPackProgress(null);
    setExportModalOpen(false);
    try {
      const proj = getStore().state.project;
      const options = { loopOnly };
      const startBeat = loopOnly && proj.loopEnabled ? proj.loopStartBeat : 0;
      const endBeat = loopOnly && proj.loopEnabled ? proj.loopEndBeat : proj.bars * 4;
      const projectJson = await projectToJson(proj, "project-only");
      const melodicTracks = proj.tracks.filter(
        (t) => t.kind !== "vocals" && t.noteClips.some((c) => c.notes.length > 0),
      );
      const midiFiles = melodicTracks.map((t) => ({
        name: t.name,
        bytes: encodeSingleTrackMidi(proj, t, { startBeat, endBeat }),
      }));
      const blob = await exportDawPack(proj, projectJson, midiFiles, options, (p) =>
        setDawPackProgress(p),
      );
      const safe = proj.name.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "song";
      downloadBlob(blob, `${safe}_daw_pack.zip`);
      getStore().setStatus("DAW Pack exported", "info");
    } catch (err) {
      getStore().setStatus(`DAW Pack export failed: ${(err as Error).message}`, "error");
    } finally {
      setDawPackExporting(false);
      setDawPackProgress(null);
    }
  };

  const onMidiImport = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseMidiFile(buffer);
      const trackPartials = midiToTrackPartials(parsed);
      if (trackPartials.length === 0) {
        getStore().setStatus("No note tracks found in MIDI file.", "warn");
        return;
      }
      const newId = () =>
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      for (const tp of trackPartials) {
        const trackId = newId();
        const newTrack = {
          id: trackId,
          name: tp.name || "MIDI Import",
          kind: tp.kind,
          preset: tp.kind === "drums" ? "acoustic" : "electric",
          volume: 0.78,
          pan: 0,
          muted: false,
          solo: false,
          armed: false,
          noteClips: [tp.clip],
          audioClips: [],
          fx: { reverb: 0.1, delay: 0, filter: 1 },
          eq: { low: 0, mid: 0, high: 0, hpfOn: false, hpfHz: 80 },
          sends: { roomReverb: 0, neonHall: 0, tapeDelay: 0, darkSlapback: 0 },
          fxRack: {},
          meta: {},
        } as import("../types").Track;
        getStore().patchProject({
          tracks: [...getStore().state.project.tracks, newTrack],
        });
      }
      getStore().setStatus(
        `Imported ${trackPartials.length} track${trackPartials.length > 1 ? "s" : ""} from MIDI`,
        "info",
      );
    } catch (err) {
      getStore().setStatus(`MIDI import failed: ${(err as Error).message}`, "error");
    }
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

  /**
   * Re-open whatever project the user had loaded before the last reload —
   * useful after accidental refreshes or when bouncing back from a demo.
   * Falls back to a toast when no last-session pointer exists yet.
   */
  const onRestoreLastSession = async () => {
    try {
      const lastId = await getLastProjectId();
      if (!lastId) {
        getStore().setStatus("No previous session to restore", "warn");
        return;
      }
      const proj = await loadProject(lastId);
      if (!proj) {
        getStore().setStatus("Last session is no longer available", "warn");
        return;
      }
      audio.stop();
      resetStore(proj);
      flushMixToEngine(proj);
      setOpenLoad(false);
      getStore().setStatus(`Restored "${proj.name}"`, "info");
    } catch (err) {
      getStore().setStatus(
        `Restore failed: ${(err as Error).message}`,
        "error",
      );
    }
  };

  /**
   * Pull the draft snapshot (autosaved on every dirty edit) and load
   * it into the studio. The Recovery banner does the same thing on
   * boot; this menu entry lets the user pull it later if they
   * dismissed the banner.
   */
  const onRecoverUnsaved = async () => {
    try {
      const snap = await loadDraft();
      if (!snap) {
        getStore().setStatus("No unsaved draft to recover", "warn");
        return;
      }
      const proj = await hydrateDraft(snap);
      audio.stop();
      resetStore(proj);
      flushMixToEngine(proj);
      setOpenLoad(false);
      getStore().setStatus("Unsaved work restored", "info");
    } catch (err) {
      getStore().setStatus(
        `Recovery failed: ${(err as Error).message}`,
        "error",
      );
    }
  };

  const onDiscardDraft = async () => {
    try {
      await clearDraft();
      getStore().setStatus("Unsaved draft discarded", "info");
      setDraftPresent(false);
    } catch (err) {
      getStore().setStatus(
        `Discard failed: ${(err as Error).message}`,
        "error",
      );
    }
  };

  // Settings: autosave interval and live presence of a recoverable draft
  // (so the menu can disable the Recover action when there's nothing to
  // recover). Subscribed to settings so the Off/15/30/60 control stays
  // in sync across header instances.
  const [autosaveSec, setAutosaveSec] = useState<AutosaveIntervalSec>(
    () => getSettings().autosaveIntervalSec,
  );
  useEffect(
    () => subscribeSettings((s) => setAutosaveSec(s.autosaveIntervalSec)),
    [],
  );
  const [draftPresent, setDraftPresent] = useState(false);
  useEffect(() => {
    if (!openLoad) return;
    let cancelled = false;
    loadDraft()
      .then((d) => {
        if (!cancelled) setDraftPresent(!!d);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [openLoad]);

  const onDelete = async (id: string) => {
    await deleteProject(id);
    setProjects(await listProjects());
  };

  return (
    <header className="h-14 border-b border-border flex items-center px-4 gap-4 bg-graphite">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setLocation("/")}
          className="flex items-center gap-3 hover:opacity-75 transition-opacity"
          title="Back to home"
          aria-label="Back to home"
        >
          <Logo className="w-9 h-9" />
          <div className="leading-tight">
            <div className="font-display text-sm tracking-[0.2em] text-foreground/90">
              SHOTGUN NINJAS
            </div>
            <div className="font-mono text-[10px] tracking-[0.3em] text-primary uppercase">
              Virtual Studio
            </div>
          </div>
        </button>
        <Tip label="Back to home">
          <button
            type="button"
            onClick={() => setLocation("/")}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back to home"
          >
            <Home className="w-3.5 h-3.5" />
          </button>
        </Tip>
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
          data-testid="project-name-input"
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
        <Button variant="outline" size="sm" onClick={openLoadDialog} className="font-mono text-xs" data-testid="open-load-dialog">
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
        <Tip label="Project info — title, creator, tags">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setProjectInfoOpen(true)}
            className="font-mono text-xs"
            aria-label="Project info"
            data-testid="open-project-info"
          >
            <Tag className="w-3.5 h-3.5" />
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
        <input
          ref={midiImportRef}
          type="file"
          accept=".mid,.midi,audio/midi,audio/x-midi"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onMidiImport(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* Stems export progress banner */}
      {stemsExporting && (
        <div className="fixed bottom-4 right-4 z-50 bg-graphite border border-border rounded-lg p-3 shadow-xl min-w-56">
          <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Rendering stems…
          </div>
          {stemProgress && (
            <div className="text-xs font-mono truncate text-foreground/80">
              {stemProgress.trackName}
              {stemProgress.trackCount > 1 &&
                ` (${stemProgress.trackIndex + 1}/${stemProgress.trackCount})`}
            </div>
          )}
          <Progress value={
            stemProgress
              ? Math.round(((stemProgress.trackIndex) / stemProgress.trackCount) * 100)
              : 10
          } className="mt-2 h-1.5" />
        </div>
      )}

      {/* DAW Pack export progress banner */}
      {dawPackExporting && (
        <div className="fixed bottom-4 right-4 z-50 bg-graphite border border-border rounded-lg p-3 shadow-xl min-w-56">
          <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Building DAW Pack…
          </div>
          {dawPackProgress && (
            <div className="text-xs font-mono truncate text-foreground/80">
              {dawPackProgress.phase === "packaging" ? "Packaging…" : dawPackProgress.trackName}
            </div>
          )}
          <Progress value={
            dawPackProgress
              ? Math.round(((dawPackProgress.trackIndex) / Math.max(1, dawPackProgress.trackCount)) * 100)
              : 10
          } className="mt-2 h-1.5" />
        </div>
      )}

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

              <div className="space-y-1">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                  Export range
                </div>
                <label className="flex items-center gap-2 text-xs font-mono cursor-pointer">
                  <input
                    type="radio"
                    name="export-range"
                    value="whole"
                    checked={exportRangeMode === "whole"}
                    onChange={() => setExportRangeMode("whole")}
                  />
                  Whole song ({project.bars} bars)
                </label>
                {project.loopEnabled && (
                  <label className="flex items-center gap-2 text-xs font-mono cursor-pointer">
                    <input
                      type="radio"
                      name="export-range"
                      value="loop"
                      checked={exportRangeMode === "loop"}
                      onChange={() => setExportRangeMode("loop")}
                    />
                    Loop region (bars {Math.floor(project.loopStartBeat / 4) + 1}–{Math.ceil(project.loopEndBeat / 4)})
                  </label>
                )}
                <label className="flex items-center gap-2 text-xs font-mono cursor-pointer">
                  <input
                    type="radio"
                    name="export-range"
                    value="custom"
                    checked={exportRangeMode === "custom"}
                    onChange={() => setExportRangeMode("custom")}
                  />
                  Custom range
                </label>
                {exportRangeMode === "custom" && (
                  <div className="flex items-center gap-2 ml-5 mt-1">
                    <span className="text-xs font-mono text-muted-foreground">Bar</span>
                    <input
                      type="number"
                      min={1}
                      max={project.bars}
                      value={customStartBar}
                      onChange={(e) => {
                        const v = Math.max(1, Math.min(project.bars, Number(e.target.value)));
                        setCustomStartBar(v);
                        if (v >= customEndBar) setCustomEndBar(Math.min(project.bars, v + 1));
                      }}
                      className="w-16 h-7 rounded border border-border bg-background px-2 text-xs font-mono text-center"
                      data-testid="export-custom-start-bar"
                    />
                    <span className="text-xs font-mono text-muted-foreground">to</span>
                    <input
                      type="number"
                      min={1}
                      max={project.bars}
                      value={customEndBar}
                      onChange={(e) => {
                        const v = Math.max(1, Math.min(project.bars, Number(e.target.value)));
                        setCustomEndBar(v);
                        if (v <= customStartBar) setCustomStartBar(Math.max(1, v - 1));
                      }}
                      className="w-16 h-7 rounded border border-border bg-background px-2 text-xs font-mono text-center"
                      data-testid="export-custom-end-bar"
                    />
                    <span className="text-xs font-mono text-muted-foreground">
                      ({customEndBar - customStartBar + 1} bar{customEndBar - customStartBar + 1 !== 1 ? "s" : ""})
                    </span>
                  </div>
                )}
              </div>

              <ExportSamplesWarning />

              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  data-testid="export-project-only"
                  onClick={() => {
                    onJsonExport("project-only");
                    setExportModalOpen(false);
                  }}
                  className="text-left border border-border rounded-md p-3 bg-background hover:bg-accent/40 transition-colors"
                >
                  <div className="font-mono text-sm flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5" /> Export project only
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Lightweight .snproj.json — no embedded audio.
                  </div>
                </button>
                <button
                  type="button"
                  data-testid="export-project-with-samples"
                  onClick={() => {
                    onJsonExport("project-with-samples");
                    setExportModalOpen(false);
                  }}
                  className="text-left border border-border rounded-md p-3 bg-background hover:bg-accent/40 transition-colors"
                >
                  <div className="font-mono text-sm flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5" /> Export project + samples
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Self-contained .snproj.json with embedded sample audio.
                  </div>
                </button>
                <button
                  type="button"
                  data-testid="export-wav"
                  onClick={() => startExport("wav")}
                  className="w-full text-left border border-border rounded-md p-3 bg-background hover:bg-accent/40 transition-colors"
                >
                  <div className="font-mono text-sm">Export audio (WAV)</div>
                  <div className="text-xs text-muted-foreground">
                    Uncompressed PCM, 44.1 kHz, 16-bit stereo.
                    {fsSaveSupported && " Pick a save location."}
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
              </div>

              <div className="pt-1 border-t border-border space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground pt-1">
                  DAW &amp; Format Exports
                </div>
                <button
                  type="button"
                  onClick={onDawPackExport}
                  className="w-full text-left border border-primary/50 rounded-md p-3 bg-primary/5 hover:bg-primary/10 transition-colors"
                >
                  <div className="font-mono text-sm flex items-center gap-1 text-primary">
                    <Download className="w-3.5 h-3.5" /> Export to DAW Pack
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ZIP with mix, stems, MIDI and project file. Open in Ableton, Logic, FL Studio…
                  </div>
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={onMidiExport}
                    className="text-left border border-border rounded-md p-3 bg-background hover:bg-accent/40 transition-colors"
                  >
                    <div className="font-mono text-sm">Export MIDI</div>
                    <div className="text-xs text-muted-foreground">
                      Standard .mid — import into any DAW or notation app.
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={onStemsExport}
                    className="text-left border border-border rounded-md p-3 bg-background hover:bg-accent/40 transition-colors"
                  >
                    <div className="font-mono text-sm">Export Stems (ZIP)</div>
                    <div className="text-xs text-muted-foreground">
                      One WAV per track. Re-mix in any DAW.
                    </div>
                  </button>
                  {hasMelodicTracks(project) && (
                    <button
                      type="button"
                      onClick={onMusicXmlExport}
                      className="text-left border border-border rounded-md p-3 bg-background hover:bg-accent/40 transition-colors"
                    >
                      <div className="font-mono text-sm">Export MusicXML</div>
                      <div className="text-xs text-muted-foreground">
                        Open in MuseScore, Sibelius, Finale, Dorico…
                      </div>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setExportModalOpen(false);
                      midiImportRef.current?.click();
                    }}
                    className="text-left border border-border rounded-md p-3 bg-background hover:bg-accent/40 transition-colors"
                  >
                    <div className="font-mono text-sm flex items-center gap-1">
                      <Upload className="w-3.5 h-3.5" /> Import MIDI
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Add tracks from a .mid file.
                    </div>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
                <button
                  type="button"
                  data-testid="import-from-disk"
                  onClick={() => {
                    setExportModalOpen(false);
                    if (fsOpenSupported) {
                      onOpenFromDisk();
                    } else {
                      jsonImportRef.current?.click();
                    }
                  }}
                  className="text-left border border-border rounded-md p-3 bg-background hover:bg-accent/40 transition-colors"
                >
                  <div className="font-mono text-sm flex items-center gap-1">
                    <Upload className="w-3.5 h-3.5" /> Open project file
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Restore a .snproj.json from disk.
                  </div>
                </button>
                <button
                  type="button"
                  data-testid="share-project"
                  onClick={() => {
                    if (webShareFilesSupported) {
                      onShareProjectJson("project-with-samples");
                    } else {
                      onShareLink();
                    }
                    setExportModalOpen(false);
                  }}
                  className="text-left border border-border rounded-md p-3 bg-background hover:bg-accent/40 transition-colors"
                >
                  <div className="font-mono text-sm flex items-center gap-1">
                    <Share2 className="w-3.5 h-3.5" />
                    {webShareFilesSupported ? "Share project" : "Share studio link"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {webShareFilesSupported
                      ? "Send the .snproj.json via your system share sheet."
                      : "Send a link to the studio via your share sheet or clipboard."}
                  </div>
                </button>
              </div>

              {lastWav && webShareFilesSupported && (
                <button
                  type="button"
                  data-testid="share-last-wav"
                  onClick={() => {
                    onShareLastWav();
                    setExportModalOpen(false);
                  }}
                  className="w-full text-left border border-border rounded-md p-3 bg-background hover:bg-accent/40 transition-colors"
                >
                  <div className="font-mono text-sm flex items-center gap-1">
                    <Share2 className="w-3.5 h-3.5" /> Share last WAV
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {lastWav.filename}
                  </div>
                </button>
              )}

              <CopyableShareBlurb />
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
            <section
              data-testid="recovery-section"
              className="border border-border rounded-md p-2 bg-background"
            >
              <div className="font-mono text-[10px] uppercase tracking-widest text-primary mb-2">
                Recovery & autosave
              </div>
              <div className="flex flex-wrap gap-2 mb-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onRestoreLastSession}
                  data-testid="restore-last-session"
                >
                  Restore Last Session
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onRecoverUnsaved}
                  disabled={!draftPresent}
                  data-testid="recover-unsaved"
                >
                  Recover Unsaved Project
                </Button>
                {draftPresent && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onDiscardDraft}
                    className="text-muted-foreground"
                  >
                    Discard draft
                  </Button>
                )}
              </div>
              <label className="flex items-center gap-2 text-xs font-mono">
                <span className="text-muted-foreground">Autosave</span>
                <select
                  value={autosaveSec}
                  onChange={(e) =>
                    setAutosaveInterval(
                      Number(e.target.value) as AutosaveIntervalSec,
                    )
                  }
                  className="bg-background border border-border rounded px-1 py-0.5 font-mono text-xs"
                  data-testid="autosave-interval"
                >
                  {AUTOSAVE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground/70 text-[10px]">
                  Drafts are written ~1s after each change.
                </span>
              </label>
            </section>
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
      <ProjectInfoDialog
        open={projectInfoOpen}
        onOpenChange={setProjectInfoOpen}
      />
      <ImportSummaryDialog
        summary={importSummary}
        onCancel={() => setImportSummary(null)}
        onConfirm={confirmImport}
      />
      <ShareCardModal
        open={shareCardOpen}
        onOpenChange={setShareCardOpen}
        data={shareCardData}
      />
    </header>
  );
}

/**
 * Surfaces a warning in the Export dialog when the project references
 * samples that have lost their underlying blob — these won't make it
 * into the exported file and will need to be relinked on import.
 */
function ExportSamplesWarning() {
  const project = useStore((s) => s.project);
  const { hasMissing, missingNames } = projectHasUnembeddableSamples(project);
  if (!hasMissing) return null;
  return (
    <div className="flex items-start gap-2 border border-amber-500/40 bg-amber-500/10 rounded-md p-2 text-xs font-mono">
      <AlertTriangle className="w-4 h-4 text-amber-500 flex-none mt-0.5" />
      <div>
        <div className="uppercase tracking-wider text-amber-200">
          {missingNames.length} sample{missingNames.length === 1 ? "" : "s"} can't be embedded
        </div>
        <div className="text-muted-foreground mt-1 break-words">
          {missingNames.slice(0, 4).join(", ")}
          {missingNames.length > 4 && "…"}
        </div>
      </div>
    </div>
  );
}

/**
 * Small copy-to-clipboard share blurb shown at the bottom of the
 * Export dialog. Intentionally no login / paywall copy.
 */
function CopyableShareBlurb() {
  const text = "Made this in Shotgun Ninjas Virtual Studio, a free browser DAW.";
  const onCopy = async () => {
    try {
      const url =
        typeof window !== "undefined"
          ? window.location.origin + window.location.pathname
          : "";
      await navigator.clipboard.writeText(`${text} ${url}`.trim());
      getStore().setStatus("Share text copied to clipboard.", "info");
    } catch {
      getStore().setStatus("Clipboard unavailable.", "warn");
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      data-testid="copy-share-blurb"
      className="w-full text-left border border-dashed border-border rounded-md p-2 bg-background hover:border-primary/60 transition-colors"
    >
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1">
        <Copy className="w-3 h-3" /> Copy share text
      </div>
      <div className="text-xs text-foreground/80 mt-1 italic">"{text}"</div>
    </button>
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
