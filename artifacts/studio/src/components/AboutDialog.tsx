import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ExternalLink,
  Bug,
  Lightbulb,
  Share2,
  Sparkles,
  ScrollText,
  Wrench,
} from "lucide-react";
import { Logo } from "./Logo";
import { APP_NAME, APP_VERSION } from "../lib/version";
import { ChangelogDialog } from "./ChangelogDialog";
import { DiagnosticsDialog } from "./DiagnosticsDialog";
import { getStore } from "../store";

/**
 * About + brand-hooks dialog. Hosts links to the Shotgun Ninjas
 * website, bug / feature feedback channels, a "Share Studio" action,
 * and the changelog. Pricing copy is intentionally absent — this is a
 * free product.
 */
export function AboutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);

  const shareStudio = async () => {
    const url = window.location.origin + window.location.pathname;
    const data = {
      title: APP_NAME,
      text: "Make music in your browser — free.",
      url,
    };
    const nav = navigator as Navigator & {
      share?: (d: typeof data) => Promise<void>;
    };
    try {
      if (nav.share) {
        await nav.share(data);
        getStore().setStatus("Thanks for sharing the studio.", "info");
      } else {
        await navigator.clipboard.writeText(url);
        getStore().setStatus("Studio link copied to clipboard.", "info");
      }
    } catch {
      // user cancelled or clipboard denied — quietly ignore
    }
  };

  const showWelcomeAgain = () => {
    try {
      localStorage.removeItem("studio.onboardingShown");
    } catch {
      /* quota */
    }
    getStore().set({ showOnboarding: true, showHelp: false });
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <Logo className="w-9 h-9" />
              <div className="leading-tight">
                <div>About {APP_NAME}</div>
                <div className="font-mono text-[10px] tracking-widest text-primary uppercase mt-0.5">
                  v{APP_VERSION} · built by Shotgun Ninjas Productions
                </div>
              </div>
            </DialogTitle>
            <DialogDescription>
              A free, browser-based studio for fast sketches and full tracks.
              No accounts, no uploads, no fine print.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-2">
            <LinkButton
              icon={<ExternalLink className="w-3.5 h-3.5" />}
              label="Visit Shotgun Ninjas"
              href="https://shotgunninjas.com"
            />
            <LinkButton
              icon={<Bug className="w-3.5 h-3.5" />}
              label="Report a bug"
              href="https://shotgunninjas.com/studio/bug"
            />
            <LinkButton
              icon={<Lightbulb className="w-3.5 h-3.5" />}
              label="Request a feature"
              href="https://shotgunninjas.com/studio/idea"
            />
            <button
              type="button"
              onClick={shareStudio}
              className="flex items-center gap-2 border border-border rounded-md p-2 bg-background hover:border-primary hover:bg-primary/5 transition-colors text-left"
            >
              <Share2 className="w-3.5 h-3.5 text-primary" />
              <span className="font-mono text-[11px] uppercase tracking-wider">
                Share studio
              </span>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={showWelcomeAgain}
              className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
            >
              <Sparkles className="w-3 h-3" />
              Show welcome again
            </button>
            <button
              type="button"
              onClick={() => setChangelogOpen(true)}
              className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
            >
              <ScrollText className="w-3 h-3" />
              Changelog
            </button>
            <button
              type="button"
              onClick={() => setDiagOpen(true)}
              className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
            >
              <Wrench className="w-3 h-3" />
              Diagnostics
            </button>
          </div>

          <p className="text-[10px] text-muted-foreground text-center pt-1">
            Free forever · no accounts · no paywalls
          </p>
        </DialogContent>
      </Dialog>

      <ChangelogDialog open={changelogOpen} onOpenChange={setChangelogOpen} />
      <DiagnosticsDialog open={diagOpen} onOpenChange={setDiagOpen} />
    </>
  );
}

function LinkButton({
  icon,
  label,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 border border-border rounded-md p-2 bg-background hover:border-primary hover:bg-primary/5 transition-colors"
    >
      <span className="text-primary">{icon}</span>
      <span className="font-mono text-[11px] uppercase tracking-wider">
        {label}
      </span>
    </a>
  );
}
