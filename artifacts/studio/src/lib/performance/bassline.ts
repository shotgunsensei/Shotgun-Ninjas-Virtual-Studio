import * as Tone from "tone";
import { midiNoteToName } from "../midi/midi";
import type { BasslinePatternId } from "../../types";
import { trackTransportEvent, untrackTransportEvent } from "../../utils/performanceDiagnostics";
export type { BasslinePatternId };

export const BASSLINE_PATTERN_LABELS: Record<BasslinePatternId, string> = {
  quarters: "Quarter Notes",
  offbeat: "Offbeat",
  walking: "Walking",
};

interface PatternStep {
  /** Offset in seconds from bar start (computed at trigger time using current BPM). */
  beatOffset: number;
  /** Semitone offset from root. */
  semitone: number;
  /** Velocity 0..1. */
  velocity: number;
  /** Duration as Tone.js time string. */
  duration: string;
}

/** 4-beat (1 bar) pattern definitions — beatOffset is in beats (quarter notes). */
const PATTERNS: Record<BasslinePatternId, PatternStep[]> = {
  quarters: [
    { beatOffset: 0,   semitone: 0, velocity: 0.9,  duration: "8n" },
    { beatOffset: 1,   semitone: 0, velocity: 0.75, duration: "8n" },
    { beatOffset: 2,   semitone: 0, velocity: 0.85, duration: "8n" },
    { beatOffset: 3,   semitone: 0, velocity: 0.7,  duration: "8n" },
  ],
  offbeat: [
    { beatOffset: 0.5, semitone: 0,  velocity: 0.85, duration: "8n" },
    { beatOffset: 1.5, semitone: 7,  velocity: 0.7,  duration: "8n" },
    { beatOffset: 2.5, semitone: 0,  velocity: 0.8,  duration: "8n" },
    { beatOffset: 3.5, semitone: 5,  velocity: 0.65, duration: "8n" },
  ],
  walking: [
    { beatOffset: 0,   semitone: 0,  velocity: 0.9,  duration: "8n" },
    { beatOffset: 1,   semitone: 4,  velocity: 0.75, duration: "8n" },
    { beatOffset: 2,   semitone: 7,  velocity: 0.8,  duration: "8n" },
    { beatOffset: 3,   semitone: 10, velocity: 0.7,  duration: "8n" },
  ],
};

/**
 * BasselinePattern — schedules a repeating rhythmic bass pattern against
 * Tone.Transport using a given root MIDI note.
 */
export class BasselinePattern {
  private eventIds: number[] = [];
  private currentTrackId: string | null = null;
  private playNote: ((trackId: string, note: string, velocity: number, duration: string) => void) | null = null;

  setPlayNote(fn: (trackId: string, note: string, velocity: number, duration: string) => void) {
    this.playNote = fn;
  }

  trigger(trackId: string, rootNote: number, patternId: BasslinePatternId) {
    this.stop();
    this.currentTrackId = trackId;
    const steps = PATTERNS[patternId];
    const transport = Tone.getTransport();
    const beatDurSec = () => 60 / transport.bpm.value;

    for (const step of steps) {
      const noteNum = Math.max(0, Math.min(127, rootNote + step.semitone));
      const noteName = midiNoteToName(noteNum);
      const velocity = step.velocity;
      const duration = step.duration;
      const beatOff = step.beatOffset;

      const id = trackTransportEvent(transport.scheduleRepeat(
        (time) => {
          if (!this.playNote || !this.currentTrackId) return;
          this.playNote(this.currentTrackId, noteName, velocity, duration);
          void time;
        },
        "1m",
        `+${beatOff * beatDurSec()}`,
      ), "bassline-pattern");
      this.eventIds.push(id);
    }
  }

  stop() {
    const transport = Tone.getTransport();
    for (const id of this.eventIds) {
      try { transport.clear(id); } catch { /* ignore */ }
      untrackTransportEvent(id, "bassline-pattern");
    }
    this.eventIds = [];
    this.currentTrackId = null;
  }

  isActive(): boolean {
    return this.eventIds.length > 0;
  }
}

export const basslinePattern = new BasselinePattern();
