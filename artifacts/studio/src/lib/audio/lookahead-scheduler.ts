/**
 * LookaheadScheduler — Phase 6 Pro Audio Engine
 *
 * Runs a 25 ms setInterval loop on the UI thread and queues Web Audio API
 * events (worklet messages, AudioBufferSourceNode starts) into the
 * AudioContext timeline up to 150 ms ahead. This decouples timing-critical
 * audio scheduling from React render cycles and requestAnimationFrame jitter.
 *
 * Usage
 * -----
 *   lookaheadScheduler.start();
 *   const id = lookaheadScheduler.schedule(audioCtxTime, callback);
 *   lookaheadScheduler.cancel(id);  // optional
 *   lookaheadScheduler.stop();
 *
 * The latency offset (measured by the calibration tool in Settings) is
 * subtracted from every AudioContext.currentTime comparison so the scheduler
 * compensates for measured output-round-trip delay.
 */

import * as Tone from 'tone';
import { trackInterval } from "../../utils/performanceDiagnostics";

export interface ScheduledEvent {
  id: number;
  audioTime: number;
  callback: (exactAudioTime: number) => void;
  fired: boolean;
}

class LookaheadScheduler {
  private _tickMs      = 25;
  private _lookaheadMs = 150;
  private _latencyOffsetMs = 0;

  private _timerId: ReturnType<typeof setInterval> | null = null;
  private _untrackInterval: (() => void) | null = null;
  private _events: ScheduledEvent[] = [];
  private _idCounter = 0;
  private _scheduledEventCount = 0;

  // ── public ──────────────────────────────────────────────────────────────

  /** Number of pending (not yet fired) scheduled events. Exposed for diagnostics. */
  get scheduledEventCount(): number {
    return this._scheduledEventCount;
  }

  /**
   * Set the output latency offset in milliseconds (from the calibration tool).
   * The scheduler subtracts this from AudioContext.currentTime when deciding
   * whether a future event is within the lookahead window.
   */
  setLatencyOffset(ms: number): void {
    this._latencyOffsetMs = Math.max(0, ms);
  }

  /** Begin the scheduling loop. Idempotent. */
  start(): void {
    if (this._timerId !== null) return;
    this._untrackInterval = trackInterval("lookahead-scheduler");
    this._timerId = setInterval(() => this._tick(), this._tickMs);
  }

  /** Stop the scheduling loop. Pending events are preserved but will not fire. */
  stop(): void {
    if (this._timerId !== null) {
      clearInterval(this._timerId);
      this._timerId = null;
      this._untrackInterval?.();
      this._untrackInterval = null;
    }
  }

  /**
   * Schedule a callback to be invoked when the audio-context clock reaches
   * `audioTime`. The callback receives the exact scheduled `audioTime` so it
   * can pass it to `AudioBufferSourceNode.start()` or worklet port messages.
   *
   * Returns a numeric id that can be passed to `cancel()`.
   */
  schedule(audioTime: number, callback: (exactAudioTime: number) => void): number {
    const id = ++this._idCounter;
    this._events.push({ id, audioTime, callback, fired: false });
    this._updateCount();
    return id;
  }

  /** Cancel a pending event. No-op if already fired or unknown. */
  cancel(id: number): void {
    const idx = this._events.findIndex((e) => e.id === id);
    if (idx !== -1) this._events.splice(idx, 1);
    this._updateCount();
  }

  /** Cancel all pending events. */
  cancelAll(): void {
    this._events = [];
    this._updateCount();
  }

  // ── private ─────────────────────────────────────────────────────────────

  private _tick(): void {
    try {
      const rawCtx = Tone.getContext().rawContext as AudioContext;
      if (!rawCtx) return;

      const now       = rawCtx.currentTime - this._latencyOffsetMs / 1000;
      const lookahead = now + this._lookaheadMs / 1000;

      const toFire: ScheduledEvent[] = [];
      const keep: ScheduledEvent[] = [];

      for (const ev of this._events) {
        if (ev.audioTime <= lookahead && !ev.fired) {
          ev.fired = true;
          toFire.push(ev);
        } else if (!ev.fired) {
          keep.push(ev);
        }
        // Fired events are discarded (not kept).
      }

      // Remove fired events; keep pending.
      this._events = keep;
      this._updateCount();

      // Fire callbacks outside the iteration loop (safe disposal).
      for (const ev of toFire) {
        try {
          ev.callback(ev.audioTime);
        } catch {
          // Individual callback errors must not crash the scheduler.
        }
      }

      // Prune stale events (past by > 500 ms — should never happen in normal use).
      const staleThreshold = now - 0.5;
      this._events = this._events.filter((e) => e.audioTime >= staleThreshold);
      this._updateCount();
    } catch {
      // Scheduler must never crash even if AudioContext is unavailable.
    }
  }

  private _updateCount(): void {
    this._scheduledEventCount = this._events.filter((e) => !e.fired).length;
  }
}

export const lookaheadScheduler = new LookaheadScheduler();
