/**
 * Single source of truth for the user-visible studio version.
 *
 * Bumped manually as each Phase 3 task lands. Surfaced in the footer,
 * the About dialog, and any future PWA update toast.
 */
export const APP_VERSION = "4.3.0-dojo";
export const APP_NAME = "Shotgun Ninjas Virtual Studio";
/** Canonical landing URL stamped on exported projects so a JSON file
 *  always tells you where it came from. The browser preview rewrites
 *  the live origin into share copy at runtime. */
export const APP_URL = "https://shotgunninjas.com/studio";
/** Identifier baked into every exported `.snproj.json` file. */
export const CREATED_WITH = APP_NAME;
/** Short, copyable share blurb the About dialog and Share menu offer. */
export const SHARE_TEXT = `Made this in ${APP_NAME}, a free browser DAW.`;

export interface ChangelogEntry {
  version: string;
  date: string;
  highlights: string[];
}

/**
 * Hand-curated changelog surfaced in the About → Changelog modal.
 * Newest entry first.
 */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "4.3.0-dojo",
    date: "2026-08-30",
    highlights: [
      "The Dojo turns Creative Compass into a project-aware local mentor with Teach, Surprise, and Quiet guidance levels.",
      "Never Lose the Jam captures a bounded history of successful live notes while formal Record is off, without recording scheduled playback.",
      "Recover the latest 15 seconds to two minutes as an editable clip with natural timing or optional 1/16 tightening.",
      "Recovered ideas are consumed only after placement and return to the recovery buffer when the scoped clip Undo is used.",
      "Jam history stays in this browser, flushes on page hide, spans at most four recent projects and 2,048 events, and can be discarded at any time.",
    ],
  },
  {
    version: "4.2.0-compass",
    date: "2026-08-30",
    highlights: [
      "Creative Compass reads the current arrangement and suggests one understandable next musical move.",
      "Editable motif, chord, bass-pulse, and drum-groove seeds plus answer, lift, and pocket variations.",
      "Sound-pack previews can become reversible two-bar sketches; Undo Sketch restores the prior clips and sound when those generated values are still current.",
      "Adaptive Project, Export, Learn, and More commands remain reachable from tablet through widescreen layouts.",
      "Beginner view is the new-user default; existing preferences remain unchanged.",
      "Scale Lock now chooses the nearest note correctly across octave boundaries.",
    ],
  },
  {
    version: "4.1.0-factory",
    date: "2026-08-30",
    highlights: [
      "Six original-quality CC0 factory instruments with 26 local chromatic sample zones.",
      "Nineteen sound packs, including six drum-and-instrument VCSL previews with composition prompts.",
      "Learn cards explain instrument family, useful register, listening cues, and a practical creative move.",
      "Three new Creative Practice lessons cover motif development, arrangement by timbre, and guided harmony.",
      "Bounded sample decoding, same-origin lazy loading, modeled fallbacks, and sampled offline WAV rendering.",
    ],
  },
  {
    version: "4.0.0-launch",
    date: "2026-05-20",
    highlights: [
      "Public landing page with hero, feature cards, tutorial steps, and Install App prompt.",
      "URL-based routing — /studio, /changelog, /credits, /press.",
      "Open Graph and Twitter Card metadata with a 1200×630 share image.",
      "Made with SN Studio share card generated after exports.",
      "Changelog, Credits, and Press kit pages linked from the landing footer.",
      "PWA manifest start URL points directly to /studio.",
    ],
  },
  {
    version: "3.2.0-share",
    date: "2026-05-20",
    highlights: [
      "Project Info dialog — title, creator, description, tags, mood, genre.",
      "Three-mode Export dialog: project only, project + samples, audio WAV.",
      "Project files stamped with brand + version metadata, new .snproj.json naming.",
      "Import Summary modal reviews incoming files before replacing the current project.",
      "Web Share, Save As, Open and Export To… use native pickers where supported.",
    ],
  },
  {
    version: "3.1.0-polish",
    date: "2026-05-20",
    highlights: [
      "Settings modal with audio, UI, project, keyboard and MIDI preferences.",
      "Four themes — Dojo Dark, Neon Control Room, Lo-Fi Smoke, Classic Console.",
      "Transport now shows swing, bar/beat/step position, and a master clip warning.",
      "About / Changelog / Feedback dialogs with Shotgun Ninjas brand links.",
      "Tooltips on advanced controls; reduce-animations + compact mode honored.",
    ],
  },
  {
    version: "3.0.0-foundation",
    date: "2026-05-12",
    highlights: [
      "Multi-track timeline with note + audio clips, drag, resize, sections.",
      "Per-track FX rack, EQ and four global send buses with mix presets.",
      "MIDI-learn for transport, metronome, track volume and drum pads.",
      "Demo library, save / load to IndexedDB, JSON import / export.",
    ],
  },
];
