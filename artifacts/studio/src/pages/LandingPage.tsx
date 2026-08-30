import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Logo } from "../components/Logo";
import { APP_VERSION } from "../lib/version";

const FEATURES = [
  {
    icon: "🥁",
    title: "Beat-making in the browser",
    desc: "Drum sequencer, piano roll, and step patterns — no downloads, no installs. Open the tab and make noise.",
  },
  {
    icon: "🎛️",
    title: "Pro-grade mixer",
    desc: "Per-track EQ, FX rack, four global send buses, mix presets, and a master limiter — all running in Web Audio.",
  },
  {
    icon: "🎹",
    title: "Piano roll + sequencer",
    desc: "Draw notes or record live from a MIDI controller. Supports velocity, groove swing, and clip-based arrangement.",
  },
  {
    icon: "🎷",
    title: "34 instruments, 19 packs",
    desc: "Six HQ CC0 sampled instruments join the modeled synth catalog, with local lazy loading and export-ready sound.",
  },
  {
    icon: "🧠",
    title: "Learn by creating",
    desc: "Instrument listening guides, composition prompts, and creative-practice lessons teach ideas inside the workflow.",
  },
  {
    icon: "⚡",
    title: "Free forever",
    desc: "No accounts, no paywalls, no ads. Your projects live in your browser. Export WAV or MP3 anytime.",
  },
];

const TUTORIALS = [
  {
    step: "01",
    title: "Set your BPM",
    desc: "Click the tempo display in the transport bar and type a number, or tap the BPM button to set it live.",
    param: "?focus=bpm",
  },
  {
    step: "02",
    title: "Add a drum pattern",
    desc: "Select the Drums track, open the step sequencer, and click pads to build a beat.",
    param: "?focus=drums",
  },
  {
    step: "03",
    title: "Record a melody",
    desc: "Select any melodic track, press R to arm record, then play your keyboard or MIDI controller.",
    param: "?focus=piano",
  },
  {
    step: "04",
    title: "Mix and polish",
    desc: "Open the mixer, pull faders, add reverb from the FX rack, and apply a mix preset to glue it.",
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
    desc: "Press S to save your project to IndexedDB, then grab the share card after export.",
    param: "",
  },
];

export default function LandingPage() {
  const [, setLocation] = useLocation();
  const [pwaPrompt, setPwaPrompt] = useState<{ prompt: () => void } | null>(null);
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
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      {/* Nav */}
      <nav className="h-14 border-b border-border bg-graphite/80 backdrop-blur sticky top-0 z-50 flex items-center px-6 gap-4">
        <div className="flex items-center gap-3 flex-1">
          <Logo className="w-8 h-8" />
          <div className="leading-tight hidden sm:block">
            <div className="font-display text-sm tracking-[0.2em] text-foreground/90">SHOTGUN NINJAS</div>
            <div className="font-mono text-[9px] tracking-[0.3em] text-primary uppercase">Virtual Studio</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a href="/changelog" className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors hidden sm:block">
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
      <section className="relative overflow-hidden flex flex-col items-center justify-center px-6 py-24 text-center">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_hsl(var(--primary)/0.12)_0%,_transparent_70%)] pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,_hsl(var(--neon)/0.06)_0%,_transparent_60%)] pointer-events-none" />
        <div className="relative max-w-3xl space-y-6">
          <div className="inline-flex items-center gap-2 border border-primary/30 bg-primary/10 rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-widest text-primary mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            v{APP_VERSION} · Free & Open in Your Browser
          </div>
          <h1 className="font-display text-5xl sm:text-6xl md:text-7xl tracking-tight leading-none">
            Make Beats{" "}
            <span className="text-primary">in Your Browser</span>
          </h1>
          <p className="text-lg sm:text-xl text-foreground/70 max-w-xl mx-auto leading-relaxed">
            A full DAW experience — drums, piano, guitar, vocals, FX, mixer, MIDI — running entirely client-side. No sign-up. No cost. Your music, your browser.
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

      {/* What is this? */}
      <section className="px-6 py-16 max-w-3xl mx-auto w-full">
        <div className="border border-border rounded-xl bg-graphite/40 p-8">
          <h2 className="font-display text-2xl tracking-wide mb-4">What is this?</h2>
          <p className="text-foreground/75 leading-relaxed mb-4">
            Shotgun Ninjas Virtual Studio is a browser-native digital audio workstation built by Shotgun Ninjas Productions. It runs entirely in your browser using the Web Audio API — no plugins, no Flash, no cloud processing required.
          </p>
          <p className="text-foreground/75 leading-relaxed">
            Layer drums, melodies, bass, guitar, and vocals. Mix with a full FX rack and EQ. Record from a MIDI controller. Export your finished track as a WAV or MP3 — all without ever leaving the tab.
          </p>
        </div>
      </section>

      {/* Screenshot / mockup area */}
      <section className="px-6 py-8 max-w-5xl mx-auto w-full">
        <div
          className="rounded-xl border border-border overflow-hidden bg-graphite/60 aspect-video flex items-center justify-center relative cursor-pointer group"
          onClick={() => goToStudio()}
          title="Open the studio"
        >
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_hsl(var(--primary)/0.08)_0%,_transparent_70%)]" />
          <div className="text-center space-y-3 relative z-10">
            <Logo className="w-20 h-20 mx-auto opacity-60 group-hover:opacity-90 transition-opacity" />
            <div className="font-display text-2xl tracking-widest text-foreground/50 group-hover:text-foreground/80 transition-colors">
              Click to open the studio
            </div>
            <div className="font-mono text-[11px] uppercase tracking-[0.4em] text-primary/60 group-hover:text-primary transition-colors">
              Full DAW in your browser
            </div>
          </div>
          {/* Fake UI hints */}
          <div className="absolute top-3 left-3 right-3 h-8 rounded bg-graphite/80 border border-border/40 flex items-center gap-2 px-3 opacity-30">
            <div className="w-4 h-4 rounded bg-primary/60" />
            <div className="w-24 h-2 rounded bg-foreground/30" />
            <div className="flex-1" />
            <div className="w-12 h-2 rounded bg-foreground/20" />
            <div className="w-12 h-2 rounded bg-foreground/20" />
            <div className="w-12 h-2 rounded bg-primary/40" />
          </div>
          <div className="absolute bottom-3 left-3 right-3 h-6 rounded bg-graphite/70 border border-border/30 opacity-20" />
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-16 max-w-5xl mx-auto w-full">
        <h2 className="font-display text-3xl tracking-wide text-center mb-10">Everything you need to make music</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="border border-border rounded-xl bg-graphite/40 p-6 hover:border-primary/40 transition-colors"
            >
              <div className="text-3xl mb-4">{f.icon}</div>
              <h3 className="font-display text-base tracking-wide mb-2">{f.title}</h3>
              <p className="text-sm text-foreground/65 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Export CTA */}
      <section className="px-6 py-10 max-w-3xl mx-auto w-full">
        <div className="border border-primary/30 rounded-xl bg-primary/5 p-8 text-center">
          <div className="font-mono text-[11px] uppercase tracking-[0.4em] text-primary mb-3">Quick start</div>
          <h2 className="font-display text-2xl tracking-wide mb-4">Export Your First Beat</h2>
          <p className="text-foreground/65 mb-6 leading-relaxed">
            Open the studio, load the Lo-Fi Smoke demo, then hit <kbd className="font-mono text-xs border border-border rounded px-1.5 py-0.5 bg-graphite">B</kbd> to bounce. Your first track in under a minute.
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
          className="w-full flex items-center justify-between border border-border rounded-xl bg-graphite/40 px-6 py-4 hover:border-primary/40 transition-colors mb-1"
        >
          <div className="flex items-center gap-3">
            <span className="font-display text-xl tracking-wide">Get Started</span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground border border-border rounded px-2 py-0.5">
              6 steps
            </span>
          </div>
          <span className="font-mono text-muted-foreground text-sm">{tutorialOpen ? "▲" : "▼"}</span>
        </button>
        {tutorialOpen && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
            {TUTORIALS.map((t) => (
              <button
                key={t.step}
                onClick={() => goToStudio(t.param)}
                className="text-left border border-border rounded-xl bg-graphite/40 p-5 hover:border-primary/40 transition-colors group"
              >
                <div className="font-mono text-[10px] uppercase tracking-widest text-primary mb-2">{t.step}</div>
                <div className="font-display text-base tracking-wide mb-2 group-hover:text-primary transition-colors">{t.title}</div>
                <p className="text-xs text-foreground/60 leading-relaxed">{t.desc}</p>
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
              <div className="font-display text-sm tracking-[0.2em]">SHOTGUN NINJAS</div>
              <div className="font-mono text-[9px] tracking-[0.3em] text-muted-foreground uppercase">Free forever · No accounts</div>
            </div>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            <a href="/changelog" className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">Changelog</a>
            <a href="/credits" className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">Credits</a>
            <a href="/press" className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">Press</a>
            <a
              href="https://docs.google.com/forms/d/e/1FAIpQLSfeedback/viewform"
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
