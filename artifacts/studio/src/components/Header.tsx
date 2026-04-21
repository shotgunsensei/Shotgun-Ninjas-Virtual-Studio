import { useState } from "react";
import { Save, FolderOpen, FilePlus2, HelpCircle } from "lucide-react";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStore, getStore, resetStore, defaultProject } from "../store";
import { audio } from "../lib/audio/engine";
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
          onClick={() => getStore().set({ showHelp: true })}
          className="font-mono text-xs"
        >
          <HelpCircle className="w-3.5 h-3.5 mr-1" /> Help
        </Button>
      </div>

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
