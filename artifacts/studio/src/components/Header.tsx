import { useState } from "react";
import { Save, FolderOpen, FilePlus2, HelpCircle, Download } from "lucide-react";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useStore, getStore, resetStore, defaultProject } from "../store";
import { audio } from "../lib/audio/engine";
import {
  renderProject,
  downloadBlob,
  safeFilename,
  type ExportFormat,
  type RenderProgress,
} from "../lib/audio/export";
import {
  saveProject,
  listProjects,
  loadProject,
  deleteProject,
  setLastProjectId,
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
  const [projects, setProjects] = useState<
    Array<{ id: string; name: string; updatedAt: number }>
  >([]);
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("wav");
  const [exportProgress, setExportProgress] = useState<RenderProgress>({
    phase: "rendering",
    progress: 0,
  });
  const [exportError, setExportError] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);

  const startExport = async (format: ExportFormat) => {
    if (exporting) return;
    setChooserOpen(false);
    audio.stop();
    setExportFormat(format);
    setExportError(null);
    setExportProgress({ phase: "decoding", progress: 0 });
    setExporting(true);
    try {
      const proj = getStore().state.project;
      const result = await renderProject(proj, format, (p) =>
        setExportProgress(p),
      );
      downloadBlob(result.blob, `${safeFilename(proj.name)}.${result.extension}`);
      getStore().setStatus(
        `Exported ${format.toUpperCase()}`,
        "info",
      );
    } catch (err) {
      const msg = (err as Error).message || "Export failed";
      setExportError(msg);
      getStore().setStatus(`Export failed: ${msg}`, "error");
    } finally {
      setExporting(false);
    }
  };

  const onNew = async () => {
    audio.stop();
    const proj = defaultProject();
    // persist as a new project + mark as last so reload is consistent
    await saveProject(proj);
    await setLastProjectId(proj.id);
    resetStore(proj);
    window.location.reload();
  };

  const onSave = async () => {
    try {
      await saveProject(getStore().state.project);
      getStore().setStatus("Project saved", "info");
    } catch (err) {
      getStore().setStatus(`Save failed: ${(err as Error).message}`, "error");
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
        <Button variant="outline" size="sm" onClick={openLoadDialog} className="font-mono text-xs">
          <FolderOpen className="w-3.5 h-3.5 mr-1" /> Load
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setChooserOpen(true)}
          disabled={exporting}
          className="font-mono text-xs"
        >
          <Download className="w-3.5 h-3.5 mr-1" /> Export
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => getStore().set({ showHelp: true })}
          className="font-mono text-xs"
        >
          <HelpCircle className="w-3.5 h-3.5 mr-1" /> Help
        </Button>
      </div>

      <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Export song</DialogTitle>
            <DialogDescription>
              Pick a format for your downloaded file.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => startExport("wav")}
              className="w-full text-left border border-border rounded-md p-3 bg-background hover:bg-accent/40 transition-colors"
            >
              <div className="font-mono text-sm">WAV</div>
              <div className="text-xs text-muted-foreground">
                Uncompressed, highest quality. Larger file.
              </div>
            </button>
            <button
              type="button"
              onClick={() => startExport("mp3")}
              className="w-full text-left border border-border rounded-md p-3 bg-background hover:bg-accent/40 transition-colors"
            >
              <div className="font-mono text-sm">MP3</div>
              <div className="text-xs text-muted-foreground">
                Compressed at 192 kbps. Smaller, easy to share.
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={exporting || exportError !== null}
        onOpenChange={(open) => {
          if (!open && !exporting) {
            setExportError(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Export song</DialogTitle>
            <DialogDescription>
              {exportError
                ? "Something went wrong while rendering."
                : `Rendering your arrangement to a ${exportFormat.toUpperCase()} file.`}
            </DialogDescription>
          </DialogHeader>
          {exportError ? (
            <div className="space-y-3">
              <p className="text-sm text-destructive font-mono break-words">
                {exportError}
              </p>
              <div className="flex justify-end">
                <Button size="sm" onClick={() => setExportError(null)}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                {exportProgress.phase === "decoding" && "Loading audio clips…"}
                {exportProgress.phase === "rendering" && "Mixing down…"}
                {exportProgress.phase === "encoding" &&
                  `Encoding ${exportFormat.toUpperCase()}…`}
              </div>
              <Progress value={Math.round(exportProgress.progress * 100)} />
              <div className="text-right text-xs font-mono text-muted-foreground">
                {Math.round(exportProgress.progress * 100)}%
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={openLoad} onOpenChange={setOpenLoad}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Load project</DialogTitle>
            <DialogDescription>
              Saved locally in your browser.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
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
                    variant="destructive"
                    onClick={() => onDelete(p.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
