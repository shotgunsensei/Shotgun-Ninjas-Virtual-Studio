import type { Project, Track } from "../../types";
import {
  analyzeCreativeProject,
  isCreativeTrack,
  type CreativeAnalysis,
  type CreativeRecipe,
} from "./creativeCompass";

export type DojoGuidanceLevel = "teach" | "surprise" | "quiet";

export const DOJO_GUIDANCE_COPY: Record<
  DojoGuidanceLevel,
  { label: string; shortLabel: string; description: string }
> = {
  teach: {
    label: "Teach me",
    shortLabel: "Teach",
    description: "Explain one useful musical move and what to listen for.",
  },
  surprise: {
    label: "Surprise me",
    shortLabel: "Surprise",
    description: "Offer a playful constraint that reacts to this project.",
  },
  quiet: {
    label: "Stay out of my way",
    shortLabel: "Quiet",
    description: "Keep the help compact and wait until you ask.",
  },
};

export interface DojoSession {
  analysis: CreativeAnalysis;
  guidance: DojoGuidanceLevel;
  targetTrackId: string | null;
  recommendedRecipe: CreativeRecipe;
  title: string;
  why: string;
  listenFor: string;
  constraint: string | null;
}

const SURPRISE_RECIPES: CreativeRecipe[] = ["motif", "pulse", "chords"];
const SURPRISE_CONSTRAINTS = [
  "Use only three different pitches. Let rhythm and silence create the identity.",
  "Leave beat four mostly empty in the first bar, then answer it in the second.",
  "Repeat the first idea exactly once, then change only its final note.",
  "Make the quietest note the one that pulls the listener into the next bar.",
  "Build tension by removing one expected hit instead of adding another layer.",
] as const;

function projectFingerprint(project: Project): number {
  let hash = 2166136261;
  const signature = [
    project.id,
    project.bpm,
    project.tracks.length,
    ...project.tracks.flatMap((track) => [
      track.id,
      track.kind,
      track.noteClips.length,
      track.noteClips.reduce((sum, clip) => sum + clip.notes.length, 0),
    ]),
  ].join(":");
  for (let index = 0; index < signature.length; index += 1) {
    hash ^= signature.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function preferredTrack(project: Project, selectedTrackId: string | null): Track | undefined {
  const selected = project.tracks.find(
    (track) => track.id === selectedTrackId && isCreativeTrack(track),
  );
  return selected ?? project.tracks.find(isCreativeTrack);
}

/**
 * Produce one local, deterministic teaching session from the current project.
 * No project data leaves the browser and no audio nodes are created here.
 */
export function buildDojoSession(
  project: Project,
  selectedTrackId: string | null,
  guidance: DojoGuidanceLevel,
): DojoSession {
  const analysis = analyzeCreativeProject(project, selectedTrackId);

  if (guidance === "teach") {
    return {
      analysis,
      guidance,
      targetTrackId: analysis.targetTrackId,
      recommendedRecipe: analysis.recommendedRecipe,
      title: analysis.nextMove.title,
      why: analysis.nextMove.why,
      listenFor: analysis.nextMove.practice,
      constraint: null,
    };
  }

  if (guidance === "quiet") {
    return {
      analysis,
      guidance,
      targetTrackId: analysis.targetTrackId,
      recommendedRecipe: analysis.recommendedRecipe,
      title: analysis.nextMove.title,
      why: "One optional move, ready when you are. Your project stays in control.",
      listenFor: analysis.nextMove.practice,
      constraint: null,
    };
  }

  const fingerprint = projectFingerprint(project);
  const target = preferredTrack(project, selectedTrackId);
  const recommendedRecipe =
    target?.kind === "drums"
      ? "groove"
      : SURPRISE_RECIPES[fingerprint % SURPRISE_RECIPES.length];
  const constraint = SURPRISE_CONSTRAINTS[fingerprint % SURPRISE_CONSTRAINTS.length];

  return {
    analysis,
    guidance,
    targetTrackId: target?.id ?? analysis.targetTrackId,
    recommendedRecipe,
    title: "Try a two-bar creative dare",
    why: "A small boundary can interrupt habit without taking authorship away from you.",
    listenFor: "Whether the limitation makes the phrase clearer, stranger, or more memorable.",
    constraint,
  };
}

const GUIDANCE_STORAGE_KEY = "studio.dojo.guidance";

export function loadDojoGuidance(): DojoGuidanceLevel {
  try {
    const value = window.localStorage.getItem(GUIDANCE_STORAGE_KEY);
    if (value === "teach" || value === "surprise" || value === "quiet") return value;
  } catch {
    // Storage is optional; the Dojo works in private/restricted contexts.
  }
  return "teach";
}

export function saveDojoGuidance(value: DojoGuidanceLevel): void {
  try {
    window.localStorage.setItem(GUIDANCE_STORAGE_KEY, value);
  } catch {
    // Preference persistence is best-effort and never blocks music making.
  }
}
