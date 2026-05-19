/**
 * GrooveEngine — humanization & swing for sequenced notes.
 *
 * Templates encode microtiming offsets (ms), velocity curves, and
 * per-position probability/flam behavior. Defaults are tight: the
 * "straight" template is a no-op. Humanization is opt-in via the
 * `humanizeTiming` / `humanizeVelocity` knobs.
 */

import type { GrooveSettings, GrooveTemplateId } from "../../../types";

export interface GrooveTemplate {
  id: GrooveTemplateId;
  name: string;
  description: string;
  /** Base swing 0..1 applied on 8ths (added to per-track swing). */
  swing: number;
  /** Per-16th step microtiming offsets, in milliseconds. Repeats every 16. */
  microMs: number[];
  /** Per-16th step velocity multipliers (1.0 == unchanged). */
  velocityCurve: number[];
  /** Probability per 16th step (1.0 == always plays). Useful for hat thins. */
  probability: number[];
  /** Probability of ghost (low-vel) extra hit on snare-like hits. */
  ghostProbability: number;
  /** Probability of flam (small +12ms early double-hit). */
  flamProbability: number;
  /** Maximum additional human timing noise (ms) at humanize=1. */
  humanTimingScaleMs: number;
}

const flatVel = Array(16).fill(1);
const flatProb = Array(16).fill(1);

export const GROOVE_TEMPLATES: Record<GrooveTemplateId, GrooveTemplate> = {
  straight: {
    id: "straight",
    name: "Straight",
    description: "Tight quantized grid, no swing or humanization.",
    swing: 0,
    microMs: Array(16).fill(0),
    velocityCurve: flatVel,
    probability: flatProb,
    ghostProbability: 0,
    flamProbability: 0,
    humanTimingScaleMs: 6,
  },
  "slight-push": {
    id: "slight-push",
    name: "Slight Push",
    description: "A touch ahead of the grid — energetic, forward.",
    swing: 0.05,
    microMs: [-2, -1, 0, -1, -2, -1, 0, -1, -2, -1, 0, -1, -2, -1, 0, -1],
    velocityCurve: [1.05, 0.95, 1, 0.95, 1.05, 0.95, 1, 0.95, 1.05, 0.95, 1, 0.95, 1.05, 0.95, 1, 0.95],
    probability: flatProb,
    ghostProbability: 0.0,
    flamProbability: 0.0,
    humanTimingScaleMs: 6,
  },
  "lazy-pocket": {
    id: "lazy-pocket",
    name: "Lazy Pocket",
    description: "Slightly behind the beat — laid back groove.",
    swing: 0.12,
    microMs: [3, 8, 4, 9, 3, 8, 4, 9, 3, 8, 4, 9, 3, 8, 4, 9],
    velocityCurve: [1, 0.85, 0.95, 0.8, 1, 0.85, 0.95, 0.8, 1, 0.85, 0.95, 0.8, 1, 0.85, 0.95, 0.8],
    probability: flatProb,
    ghostProbability: 0.15,
    flamProbability: 0.02,
    humanTimingScaleMs: 12,
  },
  "trap-bounce": {
    id: "trap-bounce",
    name: "Trap Bounce",
    description: "Triplet hat feel with bouncing 16ths.",
    swing: 0.22,
    microMs: [0, 6, -2, 4, 0, 6, -2, 4, 0, 6, -2, 4, 0, 6, -2, 4],
    velocityCurve: [1, 0.7, 0.9, 0.6, 1, 0.7, 0.9, 0.6, 1, 0.7, 0.9, 0.6, 1, 0.7, 0.9, 0.6],
    probability: flatProb,
    ghostProbability: 0.1,
    flamProbability: 0.03,
    humanTimingScaleMs: 8,
  },
  "boom-bap-drag": {
    id: "boom-bap-drag",
    name: "Boom Bap Drag",
    description: "Dilla-style late snare, dragged hats, ghost notes.",
    swing: 0.18,
    microMs: [0, 10, 2, 12, 4, 10, 2, 12, 0, 10, 2, 12, 4, 10, 2, 12],
    velocityCurve: [1, 0.75, 0.9, 0.65, 1, 0.75, 0.9, 0.65, 1, 0.75, 0.9, 0.65, 1, 0.75, 0.9, 0.65],
    probability: flatProb,
    ghostProbability: 0.25,
    flamProbability: 0.05,
    humanTimingScaleMs: 14,
  },
  "mechanical-tight": {
    id: "mechanical-tight",
    name: "Mechanical Tight",
    description: "Rigid robotic feel, near-zero variance.",
    swing: 0,
    microMs: Array(16).fill(0),
    velocityCurve: flatVel,
    probability: flatProb,
    ghostProbability: 0,
    flamProbability: 0,
    humanTimingScaleMs: 1,
  },
  "drunken-ninja": {
    id: "drunken-ninja",
    name: "Drunken Ninja",
    description: "Wobbly, unpredictable. Use sparingly.",
    swing: 0.1,
    microMs: [0, 9, -3, 11, 4, 8, -2, 13, 1, 10, -4, 12, 5, 9, -1, 14],
    velocityCurve: [1, 0.7, 0.95, 0.6, 1.05, 0.8, 0.9, 0.5, 1, 0.7, 0.95, 0.6, 1.05, 0.8, 0.9, 0.5],
    probability: [1, 0.9, 1, 0.85, 1, 0.95, 1, 0.8, 1, 0.9, 1, 0.85, 1, 0.95, 1, 0.8],
    ghostProbability: 0.2,
    flamProbability: 0.08,
    humanTimingScaleMs: 22,
  },
};

export const GROOVE_TEMPLATE_LIST: GrooveTemplate[] = [
  GROOVE_TEMPLATES.straight,
  GROOVE_TEMPLATES["slight-push"],
  GROOVE_TEMPLATES["lazy-pocket"],
  GROOVE_TEMPLATES["trap-bounce"],
  GROOVE_TEMPLATES["boom-bap-drag"],
  GROOVE_TEMPLATES["mechanical-tight"],
  GROOVE_TEMPLATES["drunken-ninja"],
];

export const DEFAULT_GROOVE: GrooveSettings = {
  template: "straight",
  swing: 0,
  humanizeTiming: 0,
  humanizeVelocity: 0,
};

/**
 * Merge a project-level groove with a per-track groove. Per-track fields
 * win when present so a user can tweak one track without losing global
 * defaults. Defaults to DEFAULT_GROOVE if both are empty.
 */
export function getGroove(
  trackSettings: Partial<GrooveSettings> | undefined,
  globalSettings?: Partial<GrooveSettings> | undefined,
): GrooveSettings {
  return {
    ...DEFAULT_GROOVE,
    ...(globalSettings ?? {}),
    ...(trackSettings ?? {}),
  };
}

/**
 * Compute the groove-adjusted time offset and velocity for a note that
 * lands at `beatInClip` beats from the clip start.
 *
 * Returns `null` if the note should be skipped (probability gate).
 * `timeOffsetSec` is the offset to add to the note's already-scheduled
 * transport time. `velocity` is the post-groove velocity.
 */
export function applyGroove(
  beatInClip: number,
  baseVelocity: number,
  settings: GrooveSettings,
  bpm: number,
): { timeOffsetSec: number; velocity: number; skip: boolean } {
  const tpl = GROOVE_TEMPLATES[settings.template] ?? GROOVE_TEMPLATES.straight;
  // Locate which 16th-step this note sits on (snap to nearest).
  const stepIdx = Math.round(beatInClip * 4) % 16;
  const positiveStep = ((stepIdx % 16) + 16) % 16;

  // Probability gate. Per-track step overrides win over the template.
  const tplProb = tpl.probability[positiveStep] ?? 1;
  const userProb = settings.stepProbability?.[positiveStep];
  const prob = userProb !== undefined ? userProb : tplProb;
  if (prob < 1 && Math.random() > prob) {
    return { timeOffsetSec: 0, velocity: baseVelocity, skip: true };
  }

  // Template microtiming + human noise (scaled by humanizeTiming).
  const microMs = tpl.microMs[positiveStep] ?? 0;
  const noiseMs =
    (Math.random() * 2 - 1) * tpl.humanTimingScaleMs * settings.humanizeTiming;
  let totalMs = microMs + noiseMs;

  // Swing pushes off-beat 16ths late.
  const swing = Math.max(0, Math.min(1, tpl.swing + settings.swing));
  const isOff8th = positiveStep % 2 === 1; // 16th between beats
  if (isOff8th && swing > 0) {
    // 16th note duration in ms:
    const sixteenthMs = (60_000 / bpm) / 4;
    totalMs += sixteenthMs * swing * 0.5;
  }

  // Velocity curve + humanization noise.
  const curve = tpl.velocityCurve[positiveStep] ?? 1;
  const velNoise = (Math.random() * 2 - 1) * 0.25 * settings.humanizeVelocity;
  const velocity = Math.max(
    0.05,
    Math.min(1, baseVelocity * curve + velNoise),
  );

  return { timeOffsetSec: totalMs / 1000, velocity, skip: false };
}

/** Whether the note should additionally trigger a flam (small lead-in hit).
 *  Per-track step toggles always win when set — a user-armed flam fires
 *  even if the template is straight. */
export function shouldFlam(
  settings: GrooveSettings,
  beatInClip?: number,
): boolean {
  if (settings.stepFlam && beatInClip !== undefined) {
    const stepIdx = Math.round(beatInClip * 4) % 16;
    const positiveStep = ((stepIdx % 16) + 16) % 16;
    if (settings.stepFlam[positiveStep]) return true;
  }
  const tpl = GROOVE_TEMPLATES[settings.template] ?? GROOVE_TEMPLATES.straight;
  if (tpl.flamProbability <= 0) return false;
  // Humanization scales the flam probability so a tight default really
  // is tight; cranking humanize lets the template breathe.
  const p = tpl.flamProbability * (0.4 + settings.humanizeTiming * 0.6);
  return Math.random() < p;
}

/** Whether the note should additionally trigger a ghost hit (subtle, low
 *  velocity, slightly after the main hit). Snare/clap-style accents. */
export function shouldGhost(settings: GrooveSettings): boolean {
  const tpl = GROOVE_TEMPLATES[settings.template] ?? GROOVE_TEMPLATES.straight;
  if (tpl.ghostProbability <= 0) return false;
  // Ghost notes are part of the template's character but humanization
  // can crank them up a little for a busier feel.
  const p = tpl.ghostProbability * (0.6 + settings.humanizeVelocity * 0.4);
  return Math.random() < p;
}
