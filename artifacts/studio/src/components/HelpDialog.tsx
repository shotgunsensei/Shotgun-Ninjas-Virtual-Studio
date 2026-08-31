import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStore, getStore } from "../store";
import { Logo } from "./Logo";
import { STARTING_MODES, loadDemo, type StartingModeId } from "../lib/demos";

type Step = "mode" | "coach";

export function HelpDialog() {
  const showHelp = useStore((s) => s.showHelp);
  const showOnboarding = useStore((s) => s.showOnboarding);
  const open = showHelp || showOnboarding;

  // The onboarding has two pages: mode selection then coach card. The
  // Help-from-menu entrypoint skips straight to the coach card so it
  // works as a refresher reference. Local state resets each time the
  // dialog opens so re-opening always lands on the right step.
  const [step, setStep] = useState<Step>(showOnboarding ? "mode" : "coach");
  useEffect(() => {
    if (open) setStep(showOnboarding ? "mode" : "coach");
  }, [open, showOnboarding]);

  const markSeen = () => {
    try {
      localStorage.setItem("studio.onboardingShown", "1");
    } catch {
      /* quota */
    }
  };

  const dismiss = (o: boolean) => {
    if (!o && showOnboarding) markSeen();
    getStore().set(
      showOnboarding ? { showOnboarding: o } : { showHelp: o },
    );
  };

  const pickMode = (id: StartingModeId) => {
    const mode = STARTING_MODES.find((m) => m.id === id);
    if (!mode) return;
    loadDemo(mode.demoId);
    // loadDemo → resetStore clears showOnboarding; restore it so the dialog
    // stays open for the coach-card step that follows.
    getStore().set({ showOnboarding: true });
    // Move to the coach card so the user gets the four-step tour after
    // their starting template is on screen. The studio is now ready to
    // play behind the dimmed dialog.
    setStep("coach");
  };

  const finish = () => {
    markSeen();
    getStore().set({ showHelp: false, showOnboarding: false });
  };

  return (
    <Dialog open={open} onOpenChange={dismiss}>
      <DialogContent className="max-w-xl" data-testid="help-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <Logo className="w-7 h-7" />
            <div>
              <div className="text-base">
                {step === "mode"
                  ? "Welcome to Shotgun Ninjas Virtual Studio"
                  : "Studio quick-start"}
              </div>
              <div className="font-mono text-[10px] tracking-widest text-primary uppercase mt-0.5">
                Strike fast. Track loud.
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        {step === "mode" ? (
          <ModeStep
            onPick={pickMode}
            onSkip={() => setStep("coach")}
          />
        ) : (
          <CoachStep
            showBack={showOnboarding}
            onBack={() => setStep("mode")}
            onLoadDemo={() => {
              getStore().set({
                showHelp: false,
                showOnboarding: false,
                requestOpenLoadDialog: true,
              });
              markSeen();
            }}
            onFinish={finish}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ModeStep({
  onPick,
  onSkip,
}: {
  onPick: (id: StartingModeId) => void;
  onSkip: () => void;
}) {
  return (
    <div className="space-y-3" data-testid="onboarding-mode-step">
      <p className="text-sm text-foreground/85">
        Pick a starting mode and we'll load a matching template you can play
        with right away. New studios start in a calmer Beginner view; every
        advanced control remains available when you want it.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {STARTING_MODES.map((m, index) => (
          <button
            key={m.id}
            type="button"
            data-testid={`starting-mode-${m.id}`}
            onClick={() => onPick(m.id)}
            className="text-left border border-border rounded-md p-3 bg-background hover:border-primary hover:bg-primary/5 transition-colors"
          >
            <div className="flex items-center justify-between gap-2 font-mono text-sm">
              <span>{m.label}</span>
              {index === 0 && (
                <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[8px] uppercase tracking-widest text-primary-readable">
                  Recommended
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1 leading-snug">
              {m.description}
            </div>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-end pt-1">
        <button
          type="button"
          onClick={onSkip}
          className="px-3 h-9 rounded-md border border-border text-muted-foreground font-mono text-[11px] uppercase tracking-widest hover:text-foreground"
        >
          Skip — show me the tour
        </button>
      </div>
    </div>
  );
}

function CoachStep({
  showBack,
  onBack,
  onLoadDemo,
  onFinish,
}: {
  showBack: boolean;
  onBack: () => void;
  onLoadDemo: () => void;
  onFinish: () => void;
}) {
  return (
    <div className="space-y-3 text-sm" data-testid="onboarding-coach-step">
      <Section title="1 · Enable audio">
        Browsers require a tap before sound. Hit{" "}
        <span className="font-mono text-primary">Tap to Enable Audio</span>{" "}
        in the transport bar — or just press <Kbd>Space</Kbd> to play.
      </Section>
      <Section title="2 · Add steps">
        Pick a track on the left, then click the drum pads or piano roll
        on the right to add notes. Clips on the timeline are draggable
        and resizable.
      </Section>
      <Section title="3 · Press Space">
        <Kbd>Space</Kbd> plays/pauses. <Kbd>Enter</Kbd> stops.{" "}
        <Kbd>R</Kbd> arms recording. <Kbd>?</Kbd> shows every shortcut.
      </Section>
      <Section title="4 · Step into The Dojo">
        Open <span className="font-mono text-primary-readable">The Dojo</span>{" "}
        from <span className="font-mono">Learn</span> on larger screens or{" "}
        <span className="font-mono">Create</span> on phones for one clear next
        move, editable musical seeds, and short explanations of why each choice
        works. If inspiration arrives before Record, use Never Lose the Jam to
        recover your latest played notes as a clip.
      </Section>
      <Section title="5 · Save &amp; export">
        Press <Kbd>S</Kbd> to save. Hit <Kbd>B</Kbd> (or the{" "}
        <span className="font-mono">Export</span> button) to bounce to
        WAV / MP3 / project JSON.
      </Section>
      <div className="flex items-center justify-between pt-2 gap-2">
        <div className="flex items-center gap-2">
          {showBack && (
            <button
              type="button"
              onClick={onBack}
              className="px-3 h-9 rounded-md border border-border text-muted-foreground font-mono text-[11px] uppercase tracking-widest hover:text-foreground"
            >
              ← Pick mode
            </button>
          )}
          <button
            type="button"
            data-testid="help-load-demo"
            onClick={onLoadDemo}
            className="px-3 h-9 rounded-md border border-primary/60 text-primary font-mono text-[11px] uppercase tracking-widest hover:bg-primary/10"
            title="Open the demo library"
          >
            Demo library
          </button>
        </div>
        <button
          type="button"
          onClick={onFinish}
          className="px-4 h-9 rounded-md bg-primary text-primary-foreground font-mono text-xs uppercase tracking-widest glow-red"
        >
          Let's go
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-primary">
        {title}
      </div>
      <div className="text-foreground/85">{children}</div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 rounded border border-border bg-background font-mono text-[10px]">
      {children}
    </kbd>
  );
}
