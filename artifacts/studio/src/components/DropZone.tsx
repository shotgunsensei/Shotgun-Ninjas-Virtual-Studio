import { useEffect, useState } from "react";
import { Upload } from "lucide-react";

/**
 * Full-window drop overlay for audio file imports. Only activates when
 * the drag's dataTransfer carries actual files (filters out the in-app
 * slider/clip drags so they don't get intercepted).
 */
export function DropZone({
  onFiles,
}: {
  onFiles: (files: File[]) => void;
}) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => {
      const types = e.dataTransfer?.types;
      if (!types) return false;
      // 'Files' is the only signal the spec guarantees for OS file drags.
      for (let i = 0; i < types.length; i++) {
        if (types[i] === "Files") return true;
      }
      return false;
    };
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setActive(true);
      e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth--;
      if (depth <= 0) {
        depth = 0;
        setActive(false);
      }
      e.preventDefault();
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setActive(false);
      const list = e.dataTransfer?.files;
      if (!list) return;
      const files: File[] = [];
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        if (
          f.type.startsWith("audio/") ||
          /\.(wav|mp3|ogg|m4a|aac|flac|webm)$/i.test(f.name)
        ) {
          files.push(f);
        }
      }
      if (files.length) onFiles(files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [onFiles]);

  if (!active) return null;
  return (
    <div className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div className="border-2 border-dashed border-neon rounded-xl px-8 py-6 bg-graphite/80 text-center">
        <Upload className="w-8 h-8 mx-auto text-neon mb-2" />
        <div className="font-display tracking-widest text-neon">DROP AUDIO TO IMPORT</div>
        <div className="text-xs text-muted-foreground font-mono mt-1">
          WAV · MP3 · OGG
        </div>
      </div>
    </div>
  );
}
