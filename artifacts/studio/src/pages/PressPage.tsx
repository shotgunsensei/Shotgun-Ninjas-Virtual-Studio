import { Logo } from "../components/Logo";
import { APP_VERSION } from "../lib/version";

const KEY_FEATURES = [
  "Full multi-track arrangement with note clips and audio clips",
  "Drum sequencer (step-grid), piano roll, and live MIDI recording",
  "Per-track 3-band EQ, FX rack (reverb, delay, distortion, chorus)",
  "Four global send buses with mix presets",
  "WAV and MP3 export, all client-side — no upload required",
  "IndexedDB project persistence, JSON import/export, draft recovery",
  "PWA-installable, works offline after first load",
  "MIDI controller support via Web MIDI API",
  "Mobile-responsive layout with drawer panels",
  "Free and open — no accounts, no paywalls, no ads",
];

export default function PressPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      {/* Nav */}
      <nav className="h-14 border-b border-border bg-graphite/80 backdrop-blur sticky top-0 z-50 flex items-center px-6 gap-4">
        <a href="/" className="flex items-center gap-3 flex-1 hover:opacity-80 transition-opacity">
          <Logo className="w-8 h-8" />
          <div className="leading-tight hidden sm:block">
            <div className="font-display text-sm tracking-[0.2em] text-foreground/90">SHOTGUN NINJAS</div>
            <div className="font-mono text-[9px] tracking-[0.3em] text-primary uppercase">Virtual Studio</div>
          </div>
        </a>
        <a
          href="/studio"
          className="bg-primary text-primary-foreground font-mono text-xs uppercase tracking-widest px-4 py-2 rounded-md hover:bg-primary/90 transition-colors"
        >
          Launch Studio
        </a>
      </nav>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-16 space-y-12">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.4em] text-primary mb-3">Media resources</div>
          <h1 className="font-display text-4xl tracking-wide mb-4">Press Kit</h1>
          <p className="text-foreground/65 leading-relaxed">
            Resources for journalists, bloggers, and content creators covering Shotgun Ninjas Virtual Studio.
          </p>
        </div>

        {/* Brand description */}
        <section>
          <SectionHeader>About the App</SectionHeader>
          <div className="border border-border rounded-xl bg-graphite/40 p-6 space-y-3">
            <div className="font-display text-lg tracking-wide">Shotgun Ninjas Virtual Studio</div>
            <div className="font-mono text-xs uppercase tracking-widest text-primary">
              "Make Beats in Your Browser"
            </div>
            <p className="text-sm text-foreground/75 leading-relaxed">
              Shotgun Ninjas Virtual Studio is a free, browser-native digital audio workstation by Shotgun Ninjas Productions. Built entirely on modern web standards — Web Audio API, Web MIDI, IndexedDB, and the File System Access API — it delivers a professional-grade music production environment without any downloads, plugins, or accounts required.
            </p>
            <p className="text-sm text-foreground/75 leading-relaxed">
              Users can compose beats, record melodies, mix multi-track projects, and export finished audio — all from a single browser tab. The app installs as a PWA and works offline, making it accessible to musicians anywhere.
            </p>
          </div>
        </section>

        {/* App facts */}
        <section>
          <SectionHeader>Quick Facts</SectionHeader>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: "Version", value: `v${APP_VERSION}` },
              { label: "Price", value: "Free" },
              { label: "Platform", value: "Browser (PWA)" },
              { label: "Accounts", value: "None required" },
              { label: "Export", value: "WAV & MP3" },
              { label: "MIDI", value: "Web MIDI supported" },
            ].map((f) => (
              <div key={f.label} className="border border-border rounded-xl bg-graphite/40 p-4">
                <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">{f.label}</div>
                <div className="font-mono text-sm text-foreground">{f.value}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Key features */}
        <section>
          <SectionHeader>Key Features</SectionHeader>
          <div className="border border-border rounded-xl bg-graphite/40 divide-y divide-border">
            {KEY_FEATURES.map((f) => (
              <div key={f} className="px-5 py-3 flex gap-3 items-start">
                <span className="w-1 h-1 rounded-full bg-primary flex-none mt-2" />
                <span className="text-sm text-foreground/80">{f}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Logo downloads */}
        <section>
          <SectionHeader>Logo & Brand Assets</SectionHeader>
          <div className="border border-border rounded-xl bg-graphite/40 p-6 space-y-5">
            <p className="text-sm text-foreground/65 leading-relaxed">
              Use the logo and wordmark in editorial and review contexts. Do not alter the colors or proportions. Do not use our marks in a way that implies endorsement.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <AssetCard
                label="App Icon (SVG)"
                description="Dark background, primary red accent"
                href="/pwa-icon.svg"
                filename="sn-studio-icon.svg"
              />
              <AssetCard
                label="OG Image (JPG, 1200×630)"
                description="Social share card banner"
                href="/opengraph.jpg"
                filename="sn-studio-og.jpg"
              />
            </div>
            <div className="bg-background/40 border border-border rounded-lg p-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-3">Brand colors</div>
              <div className="flex flex-wrap gap-4">
                {[
                  { name: "Background", hex: "#0d0d0d", swatch: "bg-[#0d0d0d] border" },
                  { name: "Primary Red", hex: "#7a0007", swatch: "bg-[#7a0007]" },
                  { name: "Neon Accent", hex: "#00ffe0", swatch: "bg-[#00ffe0]" },
                  { name: "Graphite", hex: "#1c1c1c", swatch: "bg-[#1c1c1c] border" },
                ].map((c) => (
                  <div key={c.name} className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded ${c.swatch} border-border`} />
                    <div>
                      <div className="font-mono text-[10px] text-foreground/80">{c.name}</div>
                      <div className="font-mono text-[9px] text-muted-foreground">{c.hex}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Contact */}
        <section>
          <SectionHeader>Contact & Feedback</SectionHeader>
          <div className="border border-border rounded-xl bg-graphite/40 p-6 space-y-4">
            <p className="text-sm text-foreground/65 leading-relaxed">
              For press inquiries, review access, or partnership discussions, use the feedback form below. We aim to respond within a few business days.
            </p>
            <a
              href="https://docs.google.com/forms/d/e/1FAIpQLSfeedback/viewform"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 border border-border rounded-md px-4 py-2 font-mono text-xs uppercase tracking-widest text-foreground/80 hover:border-primary/50 hover:text-foreground transition-colors"
            >
              Open Feedback Form →
            </a>
          </div>
        </section>
      </main>

      <PageFooter />
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-xl tracking-wide mb-4">{children}</h2>
  );
}

function AssetCard({
  label,
  description,
  href,
  filename,
}: {
  label: string;
  description: string;
  href: string;
  filename: string;
}) {
  return (
    <a
      href={href}
      download={filename}
      className="border border-border rounded-lg bg-background/40 p-4 flex flex-col gap-2 hover:border-primary/50 transition-colors group"
    >
      <div className="font-mono text-xs uppercase tracking-widest text-primary group-hover:text-primary">{label}</div>
      <div className="text-xs text-foreground/55">{description}</div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-auto group-hover:text-foreground transition-colors">
        ↓ Download
      </div>
    </a>
  );
}

function PageFooter() {
  return (
    <footer className="border-t border-border bg-graphite/60">
      <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <a href="/" className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
          ← Back to home
        </a>
        <nav className="flex gap-6">
          <a href="/changelog" className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">Changelog</a>
          <a href="/credits" className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">Credits</a>
          <a href="/studio" className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">Studio</a>
        </nav>
      </div>
    </footer>
  );
}
