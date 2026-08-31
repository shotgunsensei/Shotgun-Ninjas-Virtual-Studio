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
    if (this.active) return false;
    this.active = true;
    this.trackId = trackId;
    this.clipStartBeat = atBeat;
    this.events = [];
    this.pending.clear();
    return true;
  }

  isActive(): boolean {
    return this.active;
  }

  getTrackId(): string | null {
    return this.trackId;
  }

  cancel(): void {
    this.active = false;
    this.trackId = null;
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
type VocalRecordingResult = {
  blob: Blob;
  durationSec: number;
  startBeat: number;
};

class VocalRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startBeat = 0;
  private startTime = 0;
  private stream: MediaStream | null = null;
  private trackId: string | null = null;
  private starting = false;
  private generation = 0;
  private stopPromise: Promise<VocalRecordingResult | null> | null = null;
  private stopResolver: ((result: VocalRecordingResult | null) => void) | null = null;

  async start(trackId: string, deviceId: string | undefined, atBeat: number): Promise<void> {
    if (this.starting || this.rec || this.stopPromise) {
      throw new Error("A vocal recording is already active.");
    }
    const generation = ++this.generation;
    this.starting = true;
    this.trackId = trackId;
    this.startBeat = atBeat;
    const chunks: Blob[] = [];
    const constraints: MediaStreamConstraints = {
      audio: deviceId
        ? { deviceId: { exact: deviceId } }
        : true,
    };
    let stream: MediaStream | null = null;
    let recorder: MediaRecorder | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (generation !== this.generation) {
        throw new DOMException("Vocal recording start was cancelled.", "AbortError");
      }
      const mime =
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "";
      recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.start();
      if (generation !== this.generation) {
        throw new DOMException("Vocal recording start was cancelled.", "AbortError");
      }
      this.stream = stream;
      this.rec = recorder;
      this.chunks = chunks;
      this.startTime = Tone.now();
    } catch (error) {
      if (recorder?.state === "recording") {
        try { recorder.stop(); } catch { /* ignore */ }
      }
      stream?.getTracks().forEach((track) => track.stop());
      if (generation === this.generation) {
        this.trackId = null;
        this.chunks = [];
      }
      throw error;
    } finally {
      if (generation === this.generation) this.starting = false;
    }
  }

  isActive() {
    return this.rec?.state === "recording";
  }

  isBusy() {
    return this.starting || this.rec !== null;
  }

  getTrackId(): string | null {
    return this.trackId;
  }

  async stop(): Promise<VocalRecordingResult | null> {
    // Stop is an idempotent ownership boundary. Desktop/mobile controls,
    // project replacement, and keyboard shortcuts can converge here within
    // the same event turn; every caller must await the same finalization.
    if (this.stopPromise) return this.stopPromise;
    this.generation += 1;
    this.starting = false;
    if (!this.rec) {
      this.stream?.getTracks().forEach((track) => track.stop());
      this.stream = null;
      this.trackId = null;
      return null;
    }
    const rec = this.rec;
    const stream = this.stream;
    const chunks = this.chunks;
    const startBeat = this.startBeat;
    const startTime = this.startTime;
    let resolveStop!: (result: VocalRecordingResult | null) => void;
    const stopPromise = new Promise<VocalRecordingResult | null>((resolve) => {
      resolveStop = resolve;
    });
    this.stopPromise = stopPromise;
    this.stopResolver = resolveStop;
    let finished = false;
    const finish = (result: VocalRecordingResult | null) => {
        if (finished) return;
        finished = true;
        stream?.getTracks().forEach((track) => track.stop());
        if (this.rec === rec) this.rec = null;
        if (this.stream === stream) this.stream = null;
        this.trackId = null;
        this.chunks = [];
        const resolver = this.stopResolver;
        this.stopResolver = null;
        if (this.stopPromise === stopPromise) this.stopPromise = null;
        resolver?.(result);
    };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      const dur = Tone.now() - startTime;
      finish({ blob, durationSec: Math.max(0.1, dur), startBeat });
    };
    try {
      rec.stop();
    } catch {
      finish(null);
    }
    return stopPromise;
  }

  cancel(): void {
    this.generation += 1;
    this.starting = false;
    const rec = this.rec;
    if (rec) {
      rec.ondataavailable = null;
      rec.onstop = null;
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch {
        // best-effort recorder cancellation
      }
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.rec = null;
    this.stream = null;
    this.trackId = null;
    this.chunks = [];
    const resolver = this.stopResolver;
    this.stopResolver = null;
    this.stopPromise = null;
    resolver?.(null);
  }
}

export const vocalRecorder = new VocalRecorder();

/** Synchronous replacement/Panic barrier for every recorder-owned resource. */
export function cancelAllRecorders(): void {
  noteRecorder.cancel();
  vocalRecorder.cancel();
}
