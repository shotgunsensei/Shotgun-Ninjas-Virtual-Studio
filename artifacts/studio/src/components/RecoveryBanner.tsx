import { RotateCcw, X } from "lucide-react";

/**
 * Banner shown on load when a draft snapshot exists that's newer than
 * the last saved project (e.g. the tab crashed before autosave ran).
 * Letting the user explicitly recover (rather than auto-restoring)
 * prevents surprising state replacements on every refresh.
 */
export function RecoveryBanner({
  draftTs,
  onRecover,
  onDiscard,
}: {
  draftTs: number;
  onRecover: () => void;
  onDiscard: () => void;
}) {
  const ago = formatAgo(Date.now() - draftTs);
  return (
    <div
      data-testid="recovery-banner"
      className="border-b border-primary/40 bg-primary/10 px-4 py-2"
    >
      <div className="flex items-center gap-3 text-xs font-mono">
        <RotateCcw className="w-3.5 h-3.5 text-primary flex-none" />
        <span className="flex-1">
          Unsaved work from {ago} ago is available. Recover it?
        </span>
        <button
          type="button"
          onClick={onRecover}
          data-testid="recover-now"
          className="px-2 py-1 rounded bg-primary/30 hover:bg-primary/50 text-foreground uppercase tracking-widest text-[10px]"
        >
          Recover
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Discard draft"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function formatAgo(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}
