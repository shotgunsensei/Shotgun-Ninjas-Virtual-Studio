import { useState } from "react";
import { Info } from "lucide-react";
import { APP_VERSION } from "../lib/version";
import { AboutDialog } from "./AboutDialog";
import { TrustBadgeStrip, TrustStatementModal } from "./TrustStatementModal";

/**
 * Tiny footer strip pinned at the bottom of the studio shell. Surfaces
 * the app version, trust badges (clicking opens TrustStatementModal),
 * and links to Changelog, Credits, Press, and About.
 */
export function StudioFooter() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [trustOpen, setTrustOpen] = useState(false);
  const [trustTab, setTrustTab] = useState<"privacy" | "offline">("privacy");

  const openTrust = (tab: "privacy" | "offline") => {
    setTrustTab(tab);
    setTrustOpen(true);
  };

  return (
    <>
      <div className="h-5 px-3 flex items-center justify-between border-t border-border bg-graphite/60 text-[9px] font-mono uppercase tracking-widest text-muted-foreground select-none">
        <div className="flex items-center gap-4">
          <TrustBadgeStrip onOpen={openTrust} />
          <a href="/changelog" className="hover:text-foreground transition-colors">Changelog</a>
          <a href="/press" className="hover:text-foreground transition-colors">Press</a>
        </div>
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          className="flex items-center gap-1 hover:text-foreground"
          aria-label="About Shotgun Ninjas Virtual Studio"
          title="About"
        >
          <Info className="w-2.5 h-2.5" />
          About · v{APP_VERSION}
        </button>
      </div>
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      <TrustStatementModal
        open={trustOpen}
        onOpenChange={setTrustOpen}
        defaultTab={trustTab}
      />
    </>
  );
}
