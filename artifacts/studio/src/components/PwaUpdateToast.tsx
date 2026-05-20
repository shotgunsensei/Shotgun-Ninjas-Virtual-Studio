import { RefreshCw } from "lucide-react";
import { applyUpdate, usePwa } from "../lib/pwa";

/** Persistent toast surfaced when a freshly-built worker is waiting to
 * take over. Sits above the StatusToast so a transient status message
 * never hides the update prompt. */
export function PwaUpdateToast() {
  const { updateAvailable } = usePwa();
  if (!updateAvailable) return null;
  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[60] pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-md border border-primary/60 bg-graphite/95 shadow-lg shadow-black/40">
        <RefreshCw className="w-4 h-4 text-primary" aria-hidden />
        <span className="font-mono text-[11px] uppercase tracking-wider text-foreground">
          App update available
        </span>
        <button
          type="button"
          onClick={applyUpdate}
          className="font-mono text-[11px] uppercase tracking-wider px-2.5 py-1 rounded border border-primary/70 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
        >
          Reload to Update
        </button>
      </div>
    </div>
  );
}
