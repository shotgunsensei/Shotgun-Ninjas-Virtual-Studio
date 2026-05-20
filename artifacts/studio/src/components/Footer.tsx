import { useState } from "react";
import { Info } from "lucide-react";
import { APP_VERSION } from "../lib/version";
import { AboutDialog } from "./AboutDialog";

/**
 * Tiny footer strip pinned at the bottom of the studio shell. Surfaces
 * the app version (so users can quote it in bug reports) and a discreet
 * About link that opens the brand / changelog / diagnostics surface.
 */
export function StudioFooter() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="h-5 px-3 flex items-center justify-between border-t border-border bg-graphite/60 text-[9px] font-mono uppercase tracking-widest text-muted-foreground select-none">
        <span>Shotgun Ninjas · free forever</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 hover:text-foreground"
          aria-label="About Shotgun Ninjas Virtual Studio"
          title="About"
        >
          <Info className="w-2.5 h-2.5" />
          About · v{APP_VERSION}
        </button>
      </div>
      <AboutDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
