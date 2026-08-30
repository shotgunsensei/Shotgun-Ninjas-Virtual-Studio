import { Logo } from "../components/Logo";

const OSS_PACKAGES = [
  { name: "React", license: "MIT", url: "https://react.dev" },
  { name: "Tone.js", license: "MIT", url: "https://tonejs.github.io" },
  { name: "WaveSurfer.js", license: "BSD-3-Clause", url: "https://wavesurfer.xyz" },
  { name: "lamejs (@breezystack/lamejs)", license: "LGPL-3.0", url: "https://github.com/breezystack/lamejs" },
  { name: "idb", license: "ISC", url: "https://github.com/jakearchibald/idb" },
  { name: "Vite", license: "MIT", url: "https://vitejs.dev" },
  { name: "Tailwind CSS", license: "MIT", url: "https://tailwindcss.com" },
  { name: "Radix UI", license: "MIT", url: "https://www.radix-ui.com" },
  { name: "Lucide React", license: "ISC", url: "https://lucide.dev" },
  { name: "Framer Motion", license: "MIT", url: "https://www.framer.com/motion" },
  { name: "wouter", license: "ISC", url: "https://github.com/molefrog/wouter" },
  { name: "Recharts", license: "MIT", url: "https://recharts.org" },
  { name: "date-fns", license: "MIT", url: "https://date-fns.org" },
  { name: "react-resizable-panels", license: "MIT", url: "https://github.com/bvaughn/react-resizable-panels" },
  { name: "vaul", license: "MIT", url: "https://vaul.emilkowal.ski" },
  { name: "cmdk", license: "MIT", url: "https://cmdk.paco.me" },
  { name: "sonner", license: "MIT", url: "https://sonner.emilkowal.ski" },
  { name: "class-variance-authority", license: "Apache-2.0", url: "https://cva.style" },
  { name: "clsx", license: "MIT", url: "https://github.com/lukeed/clsx" },
  { name: "tailwind-merge", license: "MIT", url: "https://github.com/dcastil/tailwind-merge" },
  { name: "Inter (Google Fonts)", license: "OFL-1.1", url: "https://rsms.me/inter" },
];

const SOUND_CREDITS = [
  {
    category: "Drum Kits",
    items: [
      "Trap Kit — original samples, royalty-free",
      "Boom Bap Kit — original samples, royalty-free",
      "Cyberpunk Kit — synthesized, original work",
      "Lo-Fi Kit — original processed samples, royalty-free",
      "Cinematic Kit — original samples, royalty-free",
    ],
  },
  {
    category: "CC0 Factory Instruments",
    items: [
      "VCSL TX81Z Piano 1 — six sampled zones",
      "VCSL Folk Harp — four sampled zones",
      "VCSL Vibraphone (hard mallets) — four sampled zones",
      "VCSL Tanzanian Kalimba — four sampled zones",
      "VCSL Ocarina (sustain) — four sampled zones",
      "VCSL Tenor Saxophone (staccato) — four sampled zones",
      "Versilian Community Sample Library — CC0 1.0 public-domain dedication",
    ],
  },
  {
    category: "Synthesized Instruments",
    items: [
      "Grand Piano — Tone.js Sampler with internal synthesis fallback",
      "Electric Piano — Tone.js FM synthesis",
      "Synth Lead — Tone.js oscillator stack",
      "Bass (Finger, Synth, Sub) — Tone.js synthesis chain",
      "Guitar (Clean, Crunch, Acoustic) — Tone.js with convolution",
    ],
  },
  {
    category: "Effects & DSP",
    items: [
      "Reverb — Web Audio ConvolverNode with synthesized IRs",
      "Delay — Web Audio native DelayNode",
      "Distortion — WaveShaperNode with custom curves",
      "Chorus — LFO-driven pitch modulation via Tone.js",
    ],
  },
];

const CONTRIBUTORS = [
  { name: "Shotgun Ninjas Productions", role: "Design, Engineering, Sound Design" },
];

export default function CreditsPage() {
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

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-16 space-y-14">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.4em] text-primary mb-3">Acknowledgements</div>
          <h1 className="font-display text-4xl tracking-wide mb-4">Credits</h1>
          <p className="text-foreground/65 leading-relaxed">
            Shotgun Ninjas Virtual Studio is built on the shoulders of excellent open-source work. Thank you to everyone who made their code and samples freely available.
          </p>
        </div>

        {/* Contributors */}
        <section>
          <SectionHeader>Contributors</SectionHeader>
          <div className="space-y-3">
            {CONTRIBUTORS.map((c) => (
              <div key={c.name} className="border border-border rounded-xl bg-graphite/40 p-4 flex items-center justify-between gap-4">
                <span className="font-mono text-sm">{c.name}</span>
                <span className="text-xs text-muted-foreground">{c.role}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Sound credits */}
        {SOUND_CREDITS.map((cat) => (
          <section key={cat.category}>
            <SectionHeader>{cat.category}</SectionHeader>
            <div className="border border-border rounded-xl bg-graphite/40 divide-y divide-border">
              {cat.items.map((item) => (
                <div key={item} className="px-5 py-3 text-sm text-foreground/80">
                  {item}
                </div>
              ))}
            </div>
          </section>
        ))}

        <section className="rounded-xl border border-primary/25 bg-primary/5 p-5 text-sm leading-relaxed text-foreground/70">
          Factory audio is pinned to a specific upstream revision and kept in
          its original PCM WAV form. Review the{" "}
          <a
            href="https://github.com/sgossner/VCSL"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            official VCSL source
          </a>
          {" · "}
          <a
            href="/samples/factory/vcsl/SOURCES.json"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            exact local manifest and hashes
          </a>
        </section>

        {/* OSS */}
        <section>
          <SectionHeader>Open-Source Libraries</SectionHeader>
          <p className="text-sm text-foreground/55 mb-4 leading-relaxed">
            This project uses the following open-source packages. All licenses apply to their respective packages.
          </p>
          <div className="border border-border rounded-xl bg-graphite/40 divide-y divide-border">
            {OSS_PACKAGES.map((pkg) => (
              <div key={pkg.name} className="px-5 py-3 flex items-center justify-between gap-4">
                <a
                  href={pkg.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-sm hover:text-primary transition-colors"
                >
                  {pkg.name}
                </a>
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground border border-border rounded px-1.5 py-0.5">
                  {pkg.license}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="border border-border rounded-xl bg-graphite/40 p-6">
          <p className="text-sm text-foreground/60 leading-relaxed">
            If you believe any attribution is missing or incorrect, please reach out via the Feedback link below and we'll correct it promptly.
          </p>
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

function PageFooter() {
  return (
    <footer className="border-t border-border bg-graphite/60">
      <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <a href="/" className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">
          ← Back to home
        </a>
        <nav className="flex gap-6">
          <a href="/changelog" className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">Changelog</a>
          <a href="/press" className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">Press</a>
          <a href="/studio" className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors">Studio</a>
        </nav>
      </div>
    </footer>
  );
}
