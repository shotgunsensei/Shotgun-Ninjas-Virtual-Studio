/**
 * Unified Performance Input Router.
 *
 * Single choke point for all performance input:
 *   - Hardware MIDI bus events
 *   - QWERTY keyboard (KeyboardPerformanceService)
 *   - Gamepad button events (GamepadService)
 *
 * Before dispatching to consumers, passes notes through:
 *   1. Scale-lock quantizer (if active)
 *   2. Chord expander (if active)
 *
 * Output events are re-dispatched to all registered listeners so the
 * DrumPads, Keyboard, and PerformancePadScreen all share one event stream.
 */

import { midiBus } from "../midi/midi";
import { gamepadService } from "./gamepad";
import { keyboardPerfService } from "./keyboard";
import { quantizeToScale, expandToChord } from "./scaleUtils";
import type { ScaleId, ChordType, InputSource, GamepadMapping } from "../../types";

export type { InputSource, GamepadMapping };

export interface PerformanceNoteEvent {
  type: "noteon" | "noteoff";
  note: number;
  velocity: number;
  source: InputSource;
  /** Original note before scale lock (for display). */
  rawNote: number;
}

type PerformanceListener = (e: PerformanceNoteEvent) => void;

/** Per-button gamepad → drum pad MIDI note mapping. Default = GM drum map. */
export const DEFAULT_GAMEPAD_MAPPINGS: GamepadMapping[] = [
  { buttonIndex: 0,  note: 36, label: "A / Cross → Kick" },
  { buttonIndex: 1,  note: 38, label: "B / Circle → Snare" },
  { buttonIndex: 2,  note: 42, label: "X / Square → Hi-Hat" },
  { buttonIndex: 3,  note: 46, label: "Y / Triangle → Open Hat" },
  { buttonIndex: 4,  note: 39, label: "LB / L1 → Clap" },
  { buttonIndex: 5,  note: 49, label: "RB / R1 → Crash" },
  { buttonIndex: 6,  note: 41, label: "LT / L2 → Tom Lo" },
  { buttonIndex: 7,  note: 43, label: "RT / R2 → Tom Hi" },
  { buttonIndex: 12, note: 48, label: "D-Pad Up → FX" },
  { buttonIndex: 13, note: 45, label: "D-Pad Down → Tom Mid" },
];

interface RouterConfig {
  active: boolean;
  inputSource: InputSource;
  scaleLock: boolean;
  scaleRoot: number;
  scaleId: ScaleId;
  chordMode: boolean;
  chordType: ChordType;
  gamepadMappings: GamepadMapping[];
}

class PerformanceRouter {
  private listeners = new Set<PerformanceListener>();
  private unsubs: Array<() => void> = [];
  private initialized = false;
  private config: RouterConfig = {
    active: false,
    inputSource: "midi",
    scaleLock: false,
    scaleRoot: 0,
    scaleId: "major",
    chordMode: false,
    chordType: "major_triad",
    gamepadMappings: [...DEFAULT_GAMEPAD_MAPPINGS],
  };

  /** Call once to wire up all input sources. */
  initialize() {
    if (this.initialized) return;
    this.initialized = true;

    const midiUnsub = midiBus.onEvent((e) => {
      if (e.type !== "noteon" && e.type !== "noteoff") return;
      if (this.config.active && this.config.inputSource !== "midi") return;
      this.dispatch({
        type: e.type,
        note: e.data1,
        velocity: e.data2 / 127,
        source: "midi",
        rawNote: e.data1,
      });
    });

    const kbUnsub = keyboardPerfService.onNote((e) => {
      if (!this.config.active || this.config.inputSource !== "keyboard") return;
      this.dispatch({
        type: e.type,
        note: e.note,
        velocity: e.velocity,
        source: "keyboard",
        rawNote: e.note,
      });
    });

    const gpUnsub = gamepadService.onButton((buttonIndex, pressed, value) => {
      if (!this.config.active || this.config.inputSource !== "gamepad") return;
      const mapping = this.config.gamepadMappings.find(
        (m) => m.buttonIndex === buttonIndex,
      );
      if (!mapping) return;
      this.dispatch({
        type: pressed ? "noteon" : "noteoff",
        note: mapping.note,
        velocity: value > 0 ? value : (pressed ? 0.85 : 0),
        source: "gamepad",
        rawNote: mapping.note,
      });
    });

    this.unsubs = [midiUnsub, kbUnsub, gpUnsub];
  }

  teardown() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.initialized = false;
  }

  configure(patch: Partial<RouterConfig>) {
    const prev = this.config;
    this.config = { ...this.config, ...patch };

    if (this.config.active && this.config.inputSource === "keyboard") {
      if (!keyboardPerfService.isActive()) keyboardPerfService.activate();
    } else if (prev.active && !this.config.active) {
      if (keyboardPerfService.isActive()) keyboardPerfService.deactivate();
    } else if (this.config.active && this.config.inputSource !== "keyboard") {
      if (keyboardPerfService.isActive()) keyboardPerfService.deactivate();
    }
  }

  getConfig(): Readonly<RouterConfig> {
    return this.config;
  }

  onNote(fn: PerformanceListener) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private dispatch(raw: PerformanceNoteEvent) {
    let note = raw.note;

    if (this.config.scaleLock && raw.type === "noteon") {
      note = quantizeToScale(note, this.config.scaleRoot, this.config.scaleId);
    }

    if (this.config.chordMode && raw.type === "noteon") {
      const chordNotes = expandToChord(note, this.config.chordType);
      for (const cn of chordNotes) {
        this.listeners.forEach((l) =>
          l({ ...raw, note: cn, rawNote: raw.note }),
        );
      }
      return;
    }

    this.listeners.forEach((l) => l({ ...raw, note, rawNote: raw.note }));
  }
}

export const performanceRouter = new PerformanceRouter();
