import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowRight,
  ChevronDown,
  GraduationCap,
  Keyboard,
  Library,
  Music,
  SlidersHorizontal,
  Unlock,
} from "lucide-react";
import { Logo } from "../components/Logo";
import { APP_VERSION } from "../lib/version";

const FEATURES = [
  {
    icon: Music,
    title: "Beat-making in the browser",
    desc: "Start in Basic with an editable beat, add bass and a tune, then save your song. Switch to Advanced for the full studio.",
  },
  {
    icon: SlidersHorizontal,
    title: "A complete mixing workspace",
    desc: "Per-track EQ, an FX rack, global send buses, mix presets, and a master limiter, running in Web Audio.",
  },
  {
    icon: Keyboard,
    title: "Piano roll + sequencer",
    desc: "Draw notes or record from a MIDI controller. Shape velocity, groove swing, and a clip-based arrangement.",
  },
  {
    icon: Library,
    title: "Instruments and sound packs",
    desc: "Explore the included instruments and samples, or upload your own sound to make a keyboard instrument.",
  },
  {
    icon: GraduationCap,
    title: "Learn by creating",
    desc: "An optional tutor explains one small task at a time. Keep learning in Basic, Advanced, Lessons, and The Dojo.",
  },
  {
    icon: Unlock,
    title: "Free to make it yours",
    desc: "No accounts, paywalls, or ads. Your projects stay in this browser. Export your music and keep a project backup.",
  },
];

const TUTORIALS = [
  {
    step: "01",
    title: "Choose Basic and your tutor",
    desc: "New to music software? Choose Basic at welcome. Keep the learning tutor on for step-by-step help, or turn it off any time.",
    param: "?focus=bpm",
  },
  {
    step: "02",
    title: "Add a drum pattern",
    desc: "Use Add starter beat, then tap squares to change the rhythm. Press Play to hear your changes.",
    param: "?focus=drums",
  },
  {
    step: "03",
    title: "Add bass and a melody",
    desc: "Add a bass or melody idea in Basic, then change notes in its grid. Advanced also lets you record a keyboard or MIDI controller.",
    param: "?focus=piano",
  },
  {
    step: "04",
    title: "Mix and polish",
    desc: "Balance track volumes in Basic. In Advanced, explore the mixer, effects, and detailed sound controls.",
    param: "?focus=mixer",
  },
  {
    step: "05",
    title: "Export your beat",
    desc: "Press B or click Export in the header to bounce a WAV or MP3 — your file, client-side only.",
    param: "?focus=export",
  },
  {
    step: "06",
    title: "Save and share",
    desc: "Save keeps your editable music in this browser. Export a project JSON backup to keep it safe or open it on another device.",
    param: "",
  },
];

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [pwaPrompt, setPwaPrompt] = useState<{ prompt: () => void } | null>(
    null,
  );
  const [tutorialOpen, setTutorialOpen] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      const evt = e as CustomEvent<{ prompt: () => void }>;
      if (typeof evt.detail?.prompt === "function") setPwaPrompt(evt.detail);
    };
    window.addEventListener("studio:pwa-prompt", onPrompt);
    return () => window.removeEventListener("studio:pwa-prompt", onPrompt);
  }, []);

  const goToStudio = (param = "") => {
    setLocation(`/studio${param}`);
  };

  return (
    <div className="studio-landing min-h-screen bg-background text-foreground flex flex-col font-sans">
      {/* Nav */}
      <nav
        aria-label="Studio navigation"
        className="min-h-20 border-b border-border bg-graphite/90 backdrop-blur sticky top-0 z-50 flex items-center px-5 sm:px-8 gap-4"
      >
        <div className="flex items-center gap-3 flex-1">
          <Logo className="w-8 h-8" />
          <div className="leading-tight hidden sm:block">
            <div className="font-display text-sm tracking-[0.2em] text-foreground/90">
              SHOTGUN NINJAS
            </div>
            <div className="font-mono text-[9px] tracking-[0.3em] text-primary uppercase">
              Virtual Studio
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/changelog"
            className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors hidden sm:block"
          >
            Changelog
          </a>
          <button
            onClick={() => goToStudio()}
            className="bg-primary text-primary-foreground font-mono text-xs uppercase tracking-widest px-4 py-2 rounded-md hover:bg-primary/90 transition-colors"
          >
            Launch Studio
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden flex flex-col items-center justify-center px-6 py-16 sm:py-20 text-center">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_hsl(var(--primary)/0.12)_0%,_transparent_70%)] pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_hsl(var(--neon)/0.06)_0%,_transparent_60%)] pointer-events-none" />
        <div className="relative max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 border border-primary/30 bg-primary/10 rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-widest text-primary mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Free music studio · No account required
          </div>
          <h1 className="font-display text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight leading-[1.06]">
            Make Beats <span className="text-primary">in Your Browser</span>
          </h1>
          <p className="text-lg sm:text-xl text-foreground/70 max-w-xl mx-auto leading-relaxed">
            Make your first song in Basic, or explore every control in Advanced.
            An optional learning tutor guides you as you create. Both versions
            are free, with no sign-up. Your music stays in your browser.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              onClick={() => goToStudio()}
              className="bg-primary text-primary-foreground font-mono text-sm uppercase tracking-widest px-8 py-3 rounded-md hover:bg-primary/90 transition-all hover:scale-105 shadow-lg shadow-primary/20"
            >
              Launch Studio →
            </button>
            <button
              onClick={() => goToStudio("?demo=lofi")}
              className="border border-border bg-graphite/60 font-mono text-sm uppercase tracking-widest px-8 py-3 rounded-md hover:border-primary/50 hover:bg-graphite transition-colors"
            >
              Load Demo
            </button>
          </div>
          {pwaPrompt?.prompt && (
            <button
              onClick={() => pwaPrompt.prompt()}
              className="text-xs font-mono text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors"
            >
              ↓ Install App
            </button>
          )}
        </div>
      </section>

      {/* Actual local application interface, not a simulated workstation. */}
      <section
        className="px-6 py-8 max-w-5xl mx-auto w-full"
        aria-label="Studio workspace preview"
      >
        <button
          type="button"
          onClick={() => goToStudio()}
          aria-label="Open the studio from the workspace preview"
          className="group w-full overflow-hidden rounded-2xl border border-border bg-graphite text-left shadow-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
        >
          <img
            src={`${import.meta.env.BASE_URL}images/studio-workspace.png`}
            width="1440"
            height="1000"
            loading="lazy"
            decoding="async"
            alt="The Basic studio workspace, with the drum sequencer and music tracks"
            className="h-auto w-full"
          />
          <span className="flex min-h-14 items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-foreground/80">
            <span>Explore the Basic workspace</span>
            <ArrowRight
              className="h-4 w-4 shrink-0 text-primary"
              aria-hidden="true"
            />
          </span>
        </button>
      </section>

      {/* What is this? */}
      <section className="px-6 py-16 max-w-3xl mx-auto w-full">
        <div className="border border-border rounded-xl bg-graphite/40 p-8">
          <h2 className="font-display text-2xl tracking-wide mb-4">
            What is this?
          </h2>
          <p className="text-foreground/75 leading-relaxed mb-4">
            Shotgun Ninjas Virtual Studio is a browser-native digital audio
            workstation built by Shotgun Ninjas Productions. It runs entirely in
            your browser using the Web Audio API — no plugins, no Flash, no
            cloud processing required.
          </p>
          <p className="text-foreground/75 leading-relaxed">
            Layer drums, melodies, bass, guitar, and vocals. Mix with a full FX
            rack and EQ. Record from a MIDI controller. Export your finished
            track as a WAV or MP3 — all without ever leaving the tab.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-16 max-w-5xl mx-auto w-full">
        <h2 className="font-display text-3xl tracking-wide text-center mb-10">
          Everything you need to make music
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="border border-border rounded-xl bg-graphite/40 p-6 hover:border-primary/40 transition-colors"
            >
              <f.icon
                className="mb-5 h-7 w-7 text-primary"
                aria-hidden="true"
              />
              <h3 className="font-display text-base tracking-wide mb-2">
                {f.title}
              </h3>
              <p className="text-sm text-foreground/65 leading-relaxed">
                {f.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Export CTA */}
      <section className="px-6 py-10 max-w-3xl mx-auto w-full">
        <div className="border border-primary/30 rounded-xl bg-primary/5 p-8 text-center">
          <div className="font-mono text-[11px] uppercase tracking-[0.4em] text-primary mb-3">
            Quick start
          </div>
          <h2 className="font-display text-2xl tracking-wide mb-4">
            Export Your First Beat
          </h2>
          <p className="text-foreground/65 mb-6 leading-relaxed">
            Open the studio, load the Lo-Fi Smoke demo, then hit{" "}
            <kbd className="font-mono text-xs border border-border rounded px-1.5 py-0.5 bg-graphite">
              B
            </kbd>{" "}
            to bounce. Save an editable project backup before you export your
            finished audio.
          </p>
          <button
            onClick={() => goToStudio("?demo=lofi")}
            className="bg-primary text-primary-foreground font-mono text-sm uppercase tracking-widest px-8 py-3 rounded-md hover:bg-primary/90 transition-all hover:scale-105"
          >
            Try It Now →
          </button>
        </div>
      </section>

      {/* Tutorial cards */}
      <section className="px-6 py-16 max-w-5xl mx-auto w-full">
        <button
          onClick={() => setTutorialOpen((v) => !v)}
          aria-expanded={tutorialOpen}
          aria-controls="studio-tutorials"
          className="w-full flex items-center justify-between border border-border rounded-xl bg-graphite/40 px-6 py-4 hover:border-primary/40 transition-colors mb-1"
        >
          <div className="flex items-center gap-3">
            <span className="font-display text-xl tracking-wide">
              Get Started
            </span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground border border-border rounded px-2 py-0.5">
              6 steps
            </span>
          </div>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${tutorialOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </button>
        {tutorialOpen && (
          <div
            id="studio-tutorials"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4"
          >
            {TUTORIALS.map((t) => (
              <button
                key={t.step}
                onClick={() => goToStudio(t.param)}
                className="text-left border border-border rounded-xl bg-graphite/40 p-5 hover:border-primary/40 transition-colors group"
              >
                <div className="font-mono text-[10px] uppercase tracking-widest text-primary mb-2">
                  {t.step}
                </div>
                <div className="font-display text-base tracking-wide mb-2 group-hover:text-primary transition-colors">
                  {t.title}
                </div>
                <p className="text-xs text-foreground/60 leading-relaxed">
                  {t.desc}
                </p>
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-3 group-hover:text-primary transition-colors">
                  Open studio →
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-graphite/60 mt-auto">
        <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <Logo className="w-7 h-7" />
            <div>
              <div className="font-display text-sm tracking-[0.2em]">
                SHOTGUN NINJAS
              </div>
              <div className="font-mono text-[9px] tracking-[0.3em] text-muted-foreground uppercase">
                Free forever · No accounts
              </div>
            </div>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            <a
              href="/changelog"
              className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              Changelog
            </a>
            <a
              href="/credits"
              className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              Credits
            </a>
            <a
              href="/press"
              className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              Press
            </a>
            <a
              href="https://shotgunninjas.com/contact"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
            >
              Feedback
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
