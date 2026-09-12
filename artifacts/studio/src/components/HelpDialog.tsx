import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useStore, getStore } from "../store";
import { Logo } from "./Logo";
import { STARTING_MODES, loadDemo, type StartingModeId } from "../lib/demos";
import { setSettings, useSettings } from "../lib/settings";
import { preserveProjectForReplacement } from "../lib/storage/db";

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
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const templateBusyRef = useRef(false);
  useEffect(() => {
    if (open) {
      setStep(showOnboarding ? "mode" : "coach");
      setTemplateError(null);
    }
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

  const pickMode = async (id: StartingModeId) => {
    const mode = STARTING_MODES.find((m) => m.id === id);
    if (!mode || templateBusyRef.current) return;
    templateBusyRef.current = true;
    setLoadingTemplate(true);
    setTemplateError(null);
    let currentWorkSaved = false;
    try {
      const { project, isTransientProject } = getStore().state;
      await preserveProjectForReplacement(project, isTransientProject);
      currentWorkSaved = true;
      const state = getStore().state;
      if (!state.showOnboarding && !state.showHelp) return;
      if (!loadDemo(mode.demoId)) throw new Error("This starter could not be found.");
      // Template loading resets the project store. Keep onboarding open
      // until the player has read the quick start and chosen to continue.
      getStore().set({ showOnboarding: true });
      setStep("coach");
    } catch (error) {
      const message = currentWorkSaved
        ? `We couldn't open this starter. Your previous work was saved before loading. ${(error as Error).message}`
        : `We couldn't save your current work, so the template wasn't loaded. ${(error as Error).message}`;
      setTemplateError(message);
      getStore().setStatus(message, "error");
    } finally {
      templateBusyRef.current = false;
      setLoadingTemplate(false);
    }
  };

  const finish = () => {
    markSeen();
    getStore().set({ showHelp: false, showOnboarding: false });
  };

  return (
    <Dialog open={open} onOpenChange={dismiss}>
      <DialogContent className="max-w-xl max-h-[90dvh] overflow-y-auto" data-testid="help-dialog">
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
                Your music starts here.
              </div>
            </div>
          </DialogTitle>
          <DialogDescription>
            A DAW is a digital audio workstation: a place to make, record, and save music. Both versions are free.
          </DialogDescription>
        </DialogHeader>

        {step === "mode" ? (
          <ModeStep
            onPick={pickMode}
            onSkip={() => setStep("coach")}
            loading={loadingTemplate}
            error={templateError}
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
  loading,
  error,
}: {
  onPick: (id: StartingModeId) => void;
  onSkip: () => void;
  loading: boolean;
  error: string | null;
}) {
  const uiMode = useSettings((s) => s.uiMode);
  const tutorEnabled = useSettings((s) => s.tutorEnabled);
  return (
    <div className="space-y-3" data-testid="onboarding-mode-step">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">1. Choose your studio</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["beginner", "expert"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSettings({ uiMode: mode })}
              aria-pressed={uiMode === mode}
              data-testid={`onboarding-version-${mode}`}
              className={`rounded-md border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${uiMode === mode ? "border-primary bg-primary/10" : "border-border hover:bg-accent/40"}`}
            >
              <span className="block text-sm font-semibold">{mode === "beginner" ? "Basic · recommended" : "Advanced"}</span>
              <span className="mt-1 block text-xs text-muted-foreground leading-snug">
                {mode === "beginner"
                  ? "New to making music? Start with simple steps and fewer buttons. A welcoming place for kids, teens, and first-time musicians."
                  : "The full studio, with every instrument, effect, mixer control, and editing tool ready to explore."}
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <label className="flex items-start gap-3 rounded-md border border-border p-3 cursor-pointer">
        <input
          type="checkbox"
          checked={tutorEnabled}
          onChange={(event) => setSettings({ tutorEnabled: event.target.checked })}
          className="mt-0.5 h-5 w-5 accent-primary"
          data-testid="onboarding-tutor-toggle"
        />
        <span>
          <span className="block text-sm font-semibold">Learning tutor {tutorEnabled ? "on" : "off"}</span>
          <span className="mt-1 block text-xs text-muted-foreground">Get one small lesson at a time as you make music. Optional in both versions. Change Tutor on/off or switch versions any time at the top of the studio.</span>
        </span>
      </label>
      <p className="text-sm font-semibold">2. Pick something to play with</p>
      <p className="text-xs text-muted-foreground">These starter songs give you sounds and notes to change. Your current work is saved before a template opens.</p>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {loading && <p className="text-sm" role="status">Saving your current work and opening your starter…</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {STARTING_MODES.map((m, index) => (
          <button
            key={m.id}
            type="button"
            data-testid={`starting-mode-${m.id}`}
            onClick={() => onPick(m.id)}
            disabled={loading}
            className="text-left border border-border rounded-md p-3 bg-background hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50 disabled:cursor-wait"
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
          disabled={loading}
          className="px-3 h-9 rounded-md border border-border text-muted-foreground font-mono text-[11px] uppercase tracking-widest hover:text-foreground"
        >
          Keep my project · show me the tour
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
  const basicMode = useSettings((s) => s.uiMode === "beginner");
  const tutorEnabled = useSettings((s) => s.tutorEnabled);
  return (
    <div className="space-y-3 text-sm" data-testid="onboarding-coach-step">
      <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
        <p className="font-semibold">{basicMode ? "Basic studio" : "Advanced studio"} · Learning tutor {tutorEnabled ? "on" : "off"}</p>
        <p className="mt-1 text-xs text-muted-foreground">The tutor gives you a small task and explains what you are learning. Use Tutor on/off at the top any time. Your song stays the same when you switch versions.</p>
      </div>
      <Section title="1 · Turn on sound">
        Start with your speakers or headphones at a comfortable volume. Tap{" "}
        <span className="font-mono text-primary">Tap to Enable Audio</span>{" "}
        near Play. Browsers need your tap before they can make sound.
      </Section>
      <Section title="2 · Make one small change">
        {basicMode
          ? "Start with a beat. Tap squares in the drum grid to add or remove hits. Each row is a drum sound; each square is a moment in time. Then try adding a tune."
          : "Pick a track, then use the drum grid or piano roll to edit its notes. Arrange clips on the timeline, and open the mixer to shape each sound."}
      </Section>
      <Section title="3 · Listen, then try again">
        <Kbd>Space</Kbd> plays/pauses. <Kbd>Enter</Kbd> stops.{" "}
        <Kbd>Esc</Kbd> is Panic: it stops every sound. Try a change and listen
        again. There is no wrong first beat.
      </Section>
      <Section title="4 · Learn at your own pace">
        Follow the tutor for guided practice. For more ideas, open Lessons or
        The Dojo from Learn. Advanced opens the full studio whenever you are
        ready for more controls. <Kbd>?</Kbd> shows keyboard shortcuts.
      </Section>
      <Section title="5 · Keep your music">
        Give your song a name. Save keeps it in this browser; Load opens it
        again. Export downloads a WAV to listen to, or a project JSON backup
        to keep editing. <Kbd>S</Kbd> saves and <Kbd>B</Kbd> opens Export when
        you are not typing in a box.
      </Section>
      <div className="flex items-center justify-between pt-2 gap-2">
        <div className="flex items-center gap-2">
          {showBack && (
            <button
              type="button"
              onClick={onBack}
              className="px-3 h-9 rounded-md border border-border text-muted-foreground font-mono text-[11px] uppercase tracking-widest hover:text-foreground"
            >
              ← Studio &amp; starter
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
