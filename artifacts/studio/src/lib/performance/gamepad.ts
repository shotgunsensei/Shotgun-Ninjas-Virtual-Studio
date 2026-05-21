import { useEffect, useState } from "react";
import type { GamepadMapping } from "../../types";
export type { GamepadMapping };

export interface GamepadButton {
  pressed: boolean;
  justPressed: boolean;
  justReleased: boolean;
  value: number;
}

export interface GamepadState {
  connected: boolean;
  id: string;
  buttons: GamepadButton[];
  axes: number[];
}

export type GamepadEventListener = (
  buttonIndex: number,
  pressed: boolean,
  value: number,
) => void;

const EMPTY_STATE: GamepadState = {
  connected: false,
  id: "",
  buttons: [],
  axes: [],
};

/**
 * Singleton GamepadService.
 *
 * Uses the Web Gamepad API with a requestAnimationFrame polling loop.
 * Suspends polling when the tab is hidden to save CPU.
 * Normalizes Xbox / PlayStation standard layout (both use the same
 * Web Gamepad standard layout index order).
 *
 * Button layout (standard gamepad):
 *   0=A/Cross  1=B/Circle  2=X/Square  3=Y/Triangle
 *   4=LB  5=RB  6=LT  7=RT
 *   8=Select  9=Start
 *   12=DPad-Up  13=DPad-Down  14=DPad-Left  15=DPad-Right
 */
class GamepadService {
  private rafId: number | null = null;
  private listeners = new Set<GamepadEventListener>();
  private statusListeners = new Set<() => void>();
  private prevButtons: boolean[] = [];
  private paused = false;

  state: GamepadState = { ...EMPTY_STATE };

  constructor() {
    if (typeof window === "undefined") return;

    window.addEventListener("gamepadconnected", (e) => {
      this.state = this.snapshot((e as GamepadEvent).gamepad);
      this.statusListeners.forEach((l) => l());
      this.startLoop();
    });
    window.addEventListener("gamepaddisconnected", () => {
      this.state = { ...EMPTY_STATE };
      this.statusListeners.forEach((l) => l());
      this.stopLoop();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.paused = true;
      } else {
        this.paused = false;
        if (this.state.connected) this.startLoop();
      }
    });
  }

  onStatus(fn: () => void) {
    this.statusListeners.add(fn);
    return () => { this.statusListeners.delete(fn); };
  }

  onButton(fn: GamepadEventListener) {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private snapshot(gp: Gamepad): GamepadState {
    return {
      connected: true,
      id: gp.id,
      buttons: Array.from(gp.buttons).map((b) => ({
        pressed: b.pressed,
        justPressed: false,
        justReleased: false,
        value: b.value,
      })),
      axes: Array.from(gp.axes),
    };
  }

  private startLoop() {
    if (this.rafId !== null) return;
    const tick = () => {
      if (!this.paused) this.poll();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private poll() {
    const gamepads = navigator.getGamepads();
    let gp: Gamepad | null = null;
    for (const g of gamepads) {
      if (g && g.connected) {
        gp = g;
        break;
      }
    }
    if (!gp) {
      if (this.state.connected) {
        this.state = { ...EMPTY_STATE };
        this.statusListeners.forEach((l) => l());
      }
      return;
    }

    const newButtons: GamepadButton[] = Array.from(gp.buttons).map((b, i) => {
      const wasPressed = this.prevButtons[i] ?? false;
      const isPressed = b.pressed || b.value > 0.5;
      const just = isPressed && !wasPressed;
      const released = !isPressed && wasPressed;
      if (just) this.listeners.forEach((l) => l(i, true, b.value));
      if (released) this.listeners.forEach((l) => l(i, false, 0));
      return {
        pressed: isPressed,
        justPressed: just,
        justReleased: released,
        value: b.value,
      };
    });

    this.prevButtons = newButtons.map((b) => b.pressed);
    this.state = {
      connected: true,
      id: gp.id,
      buttons: newButtons,
      axes: Array.from(gp.axes),
    };
  }
}

export const gamepadService = new GamepadService();

/** React hook for reactive gamepad state. */
export function useGamepad(): GamepadState {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const unsub = gamepadService.onStatus(() => {
      forceUpdate((n) => n + 1);
    });
    return () => { unsub(); };
  }, []);

  return gamepadService.state;
}

/** Button label map for standard gamepad layout. */
export const GAMEPAD_BUTTON_LABELS: Record<number, string> = {
  0: "A / Cross",
  1: "B / Circle",
  2: "X / Square",
  3: "Y / Triangle",
  4: "LB / L1",
  5: "RB / R1",
  6: "LT / L2",
  7: "RT / R2",
  8: "Select / Share",
  9: "Start / Options",
  10: "L3",
  11: "R3",
  12: "D-Pad Up",
  13: "D-Pad Down",
  14: "D-Pad Left",
  15: "D-Pad Right",
};
