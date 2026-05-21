import { Logo } from "../components/Logo";
import { CHANGELOG } from "../lib/version";

const EXTRA_ENTRIES = [
  {
    version: "4.0.0-launch",
    date: "2026-05-20",
    highlights: [
      "Public landing page with hero, feature cards, tutorial steps, and Install App prompt.",
      "URL-based routing — /studio, /changelog, /credits, /press.",
      "Open Graph & Twitter Card meta tags with a 1200×630 OG image.",
      "Made with SN Studio share card — Canvas-generated image after every export.",
      "Changelog, Credits, and Press kit pages linked from landing footer.",
      "Studio header now links back to the landing page.",
      "PWA manifest updated with correct start_url pointing to /studio.",
    ],
  },
];

const ALL_ENTRIES = [...EXTRA_ENTRIES, ...CHANGELOG];

export default function ChangelogPage() {
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

      {/* Content */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-16">
        <div className="mb-10">
          <div className="font-mono text-[11px] uppercase tracking-[0.4em] text-primary mb-3">Release notes</div>
          <h1 className="font-display text-4xl tracking-wide mb-4">Changelog</h1>
          <p className="text-foreground/65 leading-relaxed">
            Notable updates to Shotgun Ninjas Virtual Studio, newest first.
          </p>
        </div>

        <div className="space-y-5">
          {ALL_ENTRIES.map((entry) => (
            <div
              key={entry.version}
              className="border border-border rounded-xl bg-graphite/40 p-6"
            >
              <div className="flex items-center justify-between gap-3 mb-4">
                <span className="font-mono text-xs uppercase tracking-widest text-primary border border-primary/40 rounded px-2 py-0.5">
                  v{entry.version}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {entry.date}
                </span>
              </div>
              <ul className="space-y-2">
                {entry.highlights.map((h, i) => (
                  <li key={i} className="flex gap-2 text-sm text-foreground/80 leading-relaxed">
                    <span className="w-1 h-1 rounded-full bg-primary flex-none mt-2" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </main>

      <PageFooter />
    </div>
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
          <a href="/credits" className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">Credits</a>
          <a href="/press" className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">Press</a>
          <a href="/studio" className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">Studio</a>
        </nav>
      </div>
    </footer>
  );
}
