/**
 * KeyboardPerformanceService — translates QWERTY keypresses to MIDI note
 * events when Performance Mode is active.
 *
 * Uses the standard piano layout (Z row = lower octave, Q row = upper octave)
 * matching the Keyboard component's existing mapping style.
 * Guards against triggering when focus is in any text input.
 */

export interface KeyNoteEvent {
  type: "noteon" | "noteoff";
  note: number;
  velocity: number;
  source: "keyboard";
}

type KeyListener = (e: KeyNoteEvent) => void;

/**
 * Standard piano QWERTY map.
 * Z=C, X=D, C=E, V=F, B=G, N=A, M=B (lower octave whites)
 * S=C#, D=D#, G=F#, H=G#, J=A# (lower octave sharps)
 * Q=C, W=D, E=E, R=F, T=G, Y=A, U=B (upper octave whites)
 * 2=C#, 3=D#, 5=F#, 6=G#, 7=A# (upper octave sharps)
 *
 * These are relative offsets from the base MIDI note (octave * 12 + 12).
 * Default octave=4 → base=60=C4.
 */
export const PERF_KEYBOARD_MAP: Record<string, number> = {
  // Lower octave whites (Z row)
  z: 0,  // C
  x: 2,  // D
  c: 4,  // E
  v: 5,  // F
  b: 7,  // G
  n: 9,  // A
  m: 11, // B
  // Lower octave sharps
  s: 1,  // C#
  d: 3,  // D#
  g: 6,  // F#
  h: 8,  // G#
  j: 10, // A#
  // Upper octave whites (Q row)
  q: 12, // C
  w: 14, // D
  e: 16, // E
  r: 17, // F
  t: 19, // G
  y: 21, // A
  u: 23, // B
  // Upper octave sharps
  "2": 13, // C#
  "3": 15, // D#
  "5": 18, // F#
  "6": 20, // G#
  "7": 22, // A#
};

/** Keys that shift the octave (number keys not used above). */
export const OCTAVE_DOWN_KEY = "1";
export const OCTAVE_UP_KEY = "8";

class KeyboardPerformanceService {
  private listeners = new Set<KeyListener>();
  private octaveListeners = new Set<(o: number) => void>();
  private active = false;
  private held = new Set<number>();
  octave = 4;

  onNote(fn: KeyListener) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  onOctave(fn: (o: number) => void) {
    this.octaveListeners.add(fn);
    return () => { this.octaveListeners.delete(fn); };
  }

  private isEditTarget(el: EventTarget | null): boolean {
    return (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement ||
      ((el as HTMLElement)?.isContentEditable ?? false)
    );
  }

  private midiNote(offset: number): number {
    return Math.max(0, Math.min(127, (this.octave + 1) * 12 + offset));
  }

  activate() {
    if (this.active) return;
    this.active = true;

    const onDown = (e: KeyboardEvent) => {
      if (!this.active) return;
      if (this.isEditTarget(e.target)) return;
      if (e.repeat) return;

      const key = e.key.toLowerCase();

      if (key === OCTAVE_DOWN_KEY || e.key === OCTAVE_DOWN_KEY) {
        this.octave = Math.max(0, this.octave - 1);
        this.octaveListeners.forEach((l) => l(this.octave));
        return;
      }
      if (key === OCTAVE_UP_KEY || e.key === OCTAVE_UP_KEY) {
        this.octave = Math.min(7, this.octave + 1);
        this.octaveListeners.forEach((l) => l(this.octave));
        return;
      }

      const offset = PERF_KEYBOARD_MAP[key] ?? PERF_KEYBOARD_MAP[e.key];
      if (offset === undefined) return;
      const note = this.midiNote(offset);
      if (this.held.has(note)) return;
      this.held.add(note);
      const ev: KeyNoteEvent = { type: "noteon", note, velocity: 0.8, source: "keyboard" };
      this.listeners.forEach((l) => l(ev));
    };

    const onUp = (e: KeyboardEvent) => {
      if (!this.active) return;
      const key = e.key.toLowerCase();
      const offset = PERF_KEYBOARD_MAP[key] ?? PERF_KEYBOARD_MAP[e.key];
      if (offset === undefined) return;
      const note = this.midiNote(offset);
      this.held.delete(note);
      const ev: KeyNoteEvent = { type: "noteoff", note, velocity: 0, source: "keyboard" };
      this.listeners.forEach((l) => l(ev));
    };

    window.addEventListener("keydown", onDown, { capture: true });
    window.addEventListener("keyup", onUp, { capture: true });

    this._cleanup = () => {
      window.removeEventListener("keydown", onDown, { capture: true });
      window.removeEventListener("keyup", onUp, { capture: true });
    };
  }

  private _cleanup: (() => void) | null = null;

  deactivate() {
    this.active = false;
    this._cleanup?.();
    this._cleanup = null;
    // release any held notes
    for (const note of this.held) {
      const ev: KeyNoteEvent = { type: "noteoff", note, velocity: 0, source: "keyboard" };
      this.listeners.forEach((l) => l(ev));
    }
    this.held.clear();
  }

  isActive() {
    return this.active;
  }

  getHeld(): ReadonlySet<number> {
    return this.held;
  }
}

export const keyboardPerfService = new KeyboardPerformanceService();
