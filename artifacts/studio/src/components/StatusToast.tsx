import { useStore } from "../store";

export function StatusToast() {
  const message = useStore((s) => s.statusMessage);
  const variant = useStore((s) => s.statusVariant);
  if (!message) return null;
  const color =
    variant === "error"
      ? "bg-destructive/90 text-destructive-foreground border-destructive"
      : variant === "warn"
        ? "bg-yellow-600/90 text-black border-yellow-700"
        : "bg-graphite/95 text-foreground border-border";
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
      <div
        className={`pointer-events-auto px-4 py-2 rounded-md border font-mono text-xs uppercase tracking-wider ${color}`}
      >
        {message}
      </div>
    </div>
  );
}
