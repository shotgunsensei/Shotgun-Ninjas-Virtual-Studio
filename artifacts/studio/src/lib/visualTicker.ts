/**
 * VisualTicker — centralized requestAnimationFrame loop for all UI visuals.
 *
 * Instead of each meter, visualizer, or particle layer running its own rAF
 * loop, they subscribe here. One shared loop drives all of them, which:
 *   - Reduces the number of concurrent rAF callbacks (browser overhead)
 *   - Allows a single document.hidden guard to pause ALL visual work
 *   - Allows a single global FPS cap (default 25, reduced to 15 in Performance Mode)
 *   - Lets the loop lapse naturally when zero subscribers remain
 *
 * Audio playback (Tone.Transport) is NEVER stopped by this class.
 *
 * Usage:
 *   const unsub = visualTicker.subscribe((ts) => { drawMyCanvas(ts); });
 *   // on unmount:
 *   unsub();
 */

type TickCallback = (timestamp: number) => void;

class VisualTicker {
  private subs = new Set<TickCallback>();
  private rafId = 0;
  private fpsCap = 25;
  private minIntervalMs = 1000 / 25;
  private lastTick = 0;
  private paused = false;

  constructor() {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
          this.paused = true;
        } else {
          this.paused = false;
          if (this.subs.size > 0 && this.rafId === 0) {
            this._start();
          }
        }
      });
    }
  }

  /** Set the global FPS cap. Affects all subscribers. */
  setFpsCap(fps: number): void {
    this.fpsCap = Math.max(1, Math.min(120, fps));
    this.minIntervalMs = 1000 / this.fpsCap;
  }

  getFpsCap(): number {
    return this.fpsCap;
  }

  /**
   * Subscribe a callback. Returns an unsubscribe function.
   * The callback receives the rAF timestamp (ms since page load).
   */
  subscribe(cb: TickCallback): () => void {
    this.subs.add(cb);
    if (this.subs.size === 1 && !this.paused) {
      this._start();
    }
    return () => this.unsubscribe(cb);
  }

  unsubscribe(cb: TickCallback): void {
    this.subs.delete(cb);
    // Loop lets itself lapse on the next tick when subs is empty.
  }

  get subscriberCount(): number {
    return this.subs.size;
  }

  private _start(): void {
    if (this.rafId !== 0) return;
    this.rafId = requestAnimationFrame((ts) => this._loop(ts));
  }

  private _loop(ts: number): void {
    this.rafId = 0;

    if (this.paused || this.subs.size === 0) {
      return;
    }

    if (ts - this.lastTick >= this.minIntervalMs) {
      this.lastTick = ts;
      for (const cb of this.subs) {
        try {
          cb(ts);
        } catch {
          // Individual subscriber errors must not crash the loop.
        }
      }
    }

    this.rafId = requestAnimationFrame((ts2) => this._loop(ts2));
  }
}

export const visualTicker = new VisualTicker();
