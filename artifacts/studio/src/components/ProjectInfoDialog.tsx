import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getStore, useStore } from "../store";
import type { ProjectMetadata } from "../types";

/**
 * Lightweight editor for the human-readable Project metadata block.
 * Saved fields show up on `.snproj.json` exports and in the Import
 * Summary modal on the receiving side.
 */
export function ProjectInfoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const project = useStore((s) => s.project);
  const [name, setName] = useState(project.name);
  const [creator, setCreator] = useState(project.metadata?.creator ?? "");
  const [description, setDescription] = useState(
    project.metadata?.description ?? "",
  );
  const [tagsText, setTagsText] = useState(
    (project.metadata?.tags ?? []).join(", "),
  );
  const [mood, setMood] = useState(project.metadata?.mood ?? "");
  const [genre, setGenre] = useState(project.metadata?.genre ?? "");

  // Reseed local state every time the dialog opens so external edits
  // (rename in the header, demo load) don't get clobbered by stale form
  // state.
  useEffect(() => {
    if (!open) return;
    setName(project.name);
    setCreator(project.metadata?.creator ?? "");
    setDescription(project.metadata?.description ?? "");
    setTagsText((project.metadata?.tags ?? []).join(", "));
    setMood(project.metadata?.mood ?? "");
    setGenre(project.metadata?.genre ?? "");
  }, [open, project]);

  const onSave = () => {
    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const next: ProjectMetadata = {};
    if (creator.trim()) next.creator = creator.trim();
    if (description.trim()) next.description = description.trim();
    if (tags.length) next.tags = tags;
    if (mood.trim()) next.mood = mood.trim();
    if (genre.trim()) next.genre = genre.trim();
    getStore().patchProject({
      name: name.trim() || project.name,
      metadata: Object.keys(next).length ? next : undefined,
    });
    getStore().setStatus("Project info updated", "info");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Project info</DialogTitle>
          <DialogDescription>
            Tag your beat so collaborators and your future self know what
            they're looking at. Stamped onto every exported project file.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Title">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              data-testid="project-info-title"
            />
          </Field>
          <Field label="Creator (optional)">
            <Input
              value={creator}
              onChange={(e) => setCreator(e.target.value)}
              maxLength={80}
              placeholder="Your name or handle"
              data-testid="project-info-creator"
            />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Short note about the track"
              className="w-full bg-background border border-border rounded-md p-2 font-mono text-xs"
              data-testid="project-info-description"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Mood">
              <Input
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                maxLength={40}
                placeholder="e.g. dark, hype"
                data-testid="project-info-mood"
              />
            </Field>
            <Field label="Genre">
              <Input
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                maxLength={40}
                placeholder="e.g. trap, lofi"
                data-testid="project-info-genre"
              />
            </Field>
          </div>
          <Field label="Tags (comma separated)">
            <Input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="boombap, late-night, draft"
              data-testid="project-info-tags"
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={onSave} data-testid="project-info-save">
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
