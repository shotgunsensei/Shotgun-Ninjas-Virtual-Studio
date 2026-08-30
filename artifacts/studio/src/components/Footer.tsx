import { lazy, Suspense, useState } from "react";
import { Info } from "lucide-react";
import { APP_VERSION } from "../lib/version";
import { TrustBadgeStrip, TrustStatementModal } from "./TrustStatementModal";
import { useSettings } from "../lib/settings";

const AboutDialog = lazy(() =>
  import("./AboutDialog").then((module) => ({ default: module.AboutDialog })),
);

/**
 * Tiny footer strip pinned at the bottom of the studio shell. Surfaces
 * the app version, trust badges (clicking opens TrustStatementModal),
 * and links to Changelog, Credits, Press, and About.
 *
 * In Beginner mode a subtle badge is shown so users can easily find the
 * toggle to switch back to Expert mode.
 */
export function StudioFooter() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [trustOpen, setTrustOpen] = useState(false);
  const [trustTab, setTrustTab] = useState<"privacy" | "offline">("privacy");
  const uiMode = useSettings((s) => s.uiMode);

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
          {uiMode === "beginner" && (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("studio:open-settings", { detail: { tab: "ui" } }))}
              className="beginner-badge hover:text-foreground transition-colors"
              aria-label="Beginner mode active — tap to open settings and switch to Expert mode"
              title="Beginner mode — tap ⚙ to switch"
            >
              Beginner mode · tap ⚙ to switch
            </button>
          )}
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
      {aboutOpen && (
        <Suspense fallback={null}>
          <AboutDialog open onOpenChange={setAboutOpen} />
        </Suspense>
      )}
      {trustOpen && (
        <TrustStatementModal
          open
          onOpenChange={setTrustOpen}
          defaultTab={trustTab}
        />
      )}
    </>
  );
}
