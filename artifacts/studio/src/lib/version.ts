/**
 * Single source of truth for the user-visible studio version.
 *
 * Bumped manually as each Phase 3 task lands. Surfaced in the footer,
 * the About dialog, and any future PWA update toast.
 */
export const APP_VERSION = "3.1.0-polish";
export const APP_NAME = "Shotgun Ninjas Virtual Studio";

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
