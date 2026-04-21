import * as Tone from "tone";
import { audio } from "./engine";
import type { NoteEvent } from "../../types";

/**
 * Note recorder. Captures attack/release events while transport is rolling
 * and converts them into a NoteClip starting at a given beat position.
 */

interface PendingNote {
  startBeat: number;
  velocity: number;
}

class NoteRecorder {
  private active = false;
  private trackId: string | null = null;
  private clipStartBeat = 0;
  private events: NoteEvent[] = [];
  private pending = new Map<string, PendingNote>();

  start(trackId: string, atBeat: number) {
    this.active = true;
    this.trackId = trackId;
    this.clipStartBeat = atBeat;
    this.events = [];
    this.pending.clear();
  }

  isActiveFor(trackId: string): boolean {
    return this.active && this.trackId === trackId;
  }

  noteOn(trackId: string, note: string, velocity = 0.9) {
    if (!this.active || this.trackId !== trackId) return;
    const beat = audio.positionBeats() - this.clipStartBeat;
    if (beat < 0) return;
    this.pending.set(note, { startBeat: beat, velocity });
  }

  noteOff(trackId: string, note: string) {
    if (!this.active || this.trackId !== trackId) return;
    const p = this.pending.get(note);
    if (!p) return;
    const endBeat = audio.positionBeats() - this.clipStartBeat;
    const duration = Math.max(0.1, endBeat - p.startBeat);
    this.events.push({
      time: p.startBeat,
      note,
      duration,
      velocity: p.velocity,
    });
    this.pending.delete(note);
  }

  /** One-shot drum hit: beat + zero duration. */
  hit(trackId: string, note: string, velocity = 0.9) {
    if (!this.active || this.trackId !== trackId) return;
    const beat = audio.positionBeats() - this.clipStartBeat;
    if (beat < 0) return;
    this.events.push({ time: beat, note, duration: 0.25, velocity });
  }

  stop(): { events: NoteEvent[]; startBeat: number; lengthBeats: number } | null {
    if (!this.active) return null;
    // close any dangling notes
    const endBeat = audio.positionBeats() - this.clipStartBeat;
    for (const [note, p] of this.pending.entries()) {
      this.events.push({
        time: p.startBeat,
        note,
        duration: Math.max(0.1, endBeat - p.startBeat),
        velocity: p.velocity,
      });
    }
    this.pending.clear();
    this.active = false;
    this.trackId = null;
    const events = this.events;
    this.events = [];
    return {
      events,
      startBeat: this.clipStartBeat,
      lengthBeats: Math.max(1, endBeat),
    };
  }
}

export const noteRecorder = new NoteRecorder();

/**
 * Vocal recorder. Wraps Tone.UserMedia output through MediaRecorder so we get
 * a Blob the user can play back from the timeline.
 */
class VocalRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startBeat = 0;
  private startTime = 0;
  private stream: MediaStream | null = null;

  async start(deviceId: string | undefined, atBeat: number): Promise<void> {
    this.startBeat = atBeat;
    this.chunks = [];
    const constraints: MediaStreamConstraints = {
      audio: deviceId
        ? { deviceId: { exact: deviceId } }
        : true,
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    const mime =
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
    this.rec = mime
      ? new MediaRecorder(this.stream, { mimeType: mime })
      : new MediaRecorder(this.stream);
    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.startTime = Tone.now();
    this.rec.start();
  }

  isActive() {
    return this.rec?.state === "recording";
  }

  async stop(): Promise<{ blob: Blob; durationSec: number; startBeat: number } | null> {
    if (!this.rec) return null;
    const rec = this.rec;
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType || "audio/webm" });
        const dur = Tone.now() - this.startTime;
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = null;
        this.rec = null;
        this.chunks = [];
        resolve({ blob, durationSec: Math.max(0.1, dur), startBeat: this.startBeat });
      };
      try {
        rec.stop();
      } catch {
        resolve(null);
      }
    });
  }
}

export const vocalRecorder = new VocalRecorder();
