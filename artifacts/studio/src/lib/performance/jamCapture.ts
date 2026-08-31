import type { NoteClip, Track } from "../../types";

const STORAGE_KEY = "studio.jamCapture.v1";
const MAX_CAPTURED_EVENTS = 2_048;
const MAX_PROJECTS = 4;
const DEFAULT_BPM = 120;

export type JamEventKind = "melodic" | "drum";
export type JamRecoveryFeel = "natural" | "sixteenth";

export interface JamCaptureEvent {
  id: string;
  projectId: string;
  trackId: string;
  kind: JamEventKind;
  note: string;
  velocity: number;
  startedAtMs: number;
  durationMs: number;
  bpm: number;
}

interface PendingJamNote {
  projectId: string;
  trackId: string;
  note: string;
  velocity: number;
  startedAtMs: number;
  bpm: number;
}

interface StoredJamCapture {
  version: 1;
  events: JamCaptureEvent[];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface JamTrackSummary {
  trackId: string;
  eventCount: number;
  firstAtMs: number;
  lastAtMs: number;
  spanSeconds: number;
  kind: JamEventKind;
}

export interface JamRecoveryResult {
  clip: NoteClip;
  eventIds: string[];
  spanSeconds: number;
}

function clampVelocity(value: number): number {
  return Math.max(0.01, Math.min(1, Number.isFinite(value) ? value : 0.85));
}

function createEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `jam-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function resolveStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function validEvent(value: unknown): value is JamCaptureEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<JamCaptureEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.projectId === "string" &&
    typeof event.trackId === "string" &&
    (event.kind === "melodic" || event.kind === "drum") &&
    typeof event.note === "string" &&
    typeof event.velocity === "number" &&
    typeof event.startedAtMs === "number" &&
    typeof event.durationMs === "number" &&
    typeof event.bpm === "number"
  );
}

export class JamCapture {
  private events: JamCaptureEvent[] = [];
  private pending = new Map<string, PendingJamNote>();
  private activeProjectId: string | null = null;
  private activeBpm = DEFAULT_BPM;
  private formalRecordingActive = false;
  private revision = 0;
  private loaded = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly storage: StorageLike | null | undefined = undefined,
    private readonly now: () => number = () => Date.now(),
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    const onChange = () => listener();
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  };

  getRevision = (): number => {
    this.ensureLoaded();
    return this.revision;
  };

  private listeners = new Set<() => void>();

  private changed(): void {
    this.revision += 1;
    this.listeners.forEach((listener) => listener());
    this.persistSoon();
  }

  private storageTarget(): StorageLike | null {
    return this.storage === undefined ? resolveStorage() : this.storage;
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const storage = this.storageTarget();
    if (!storage) return;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<StoredJamCapture>;
      if (parsed.version !== 1 || !Array.isArray(parsed.events)) return;
      this.events = parsed.events.filter(validEvent).slice(-MAX_CAPTURED_EVENTS);
      this.trimProjects();
    } catch {
      this.events = [];
    }
  }

  private persistSoon(): void {
    if (!this.storageTarget()) return;
    // This is a true trailing debounce. Rapid playing must not serialize the
    // bounded history to synchronous localStorage several times per second.
    // A short musical pause persists it; pagehide/visibility flush the tail.
    if (this.persistTimer !== null) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      const storage = this.storageTarget();
      if (!storage) return;
      try {
        const payload: StoredJamCapture = { version: 1, events: this.events };
        storage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // Recovery is an enhancement; storage restrictions must never stop audio.
      }
    }, 250);
  }

  flush(): void {
    this.ensureLoaded();
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const storage = this.storageTarget();
    if (!storage) return;
    try {
      const payload: StoredJamCapture = { version: 1, events: this.events };
      storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Best-effort lifecycle flush; project audio and navigation stay unblocked.
    }
  }

  private trimProjects(): void {
    const newestByProject = new Map<string, number>();
    for (const event of this.events) {
      newestByProject.set(
        event.projectId,
        Math.max(newestByProject.get(event.projectId) ?? 0, event.startedAtMs),
      );
    }
    const retained = new Set(
      [...newestByProject.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, MAX_PROJECTS)
        .map(([projectId]) => projectId),
    );
    this.events = this.events
      .filter((event) => retained.has(event.projectId))
      .slice(-MAX_CAPTURED_EVENTS);
  }

  private append(event: JamCaptureEvent): void {
    this.ensureLoaded();
    this.events.push(event);
    this.trimProjects();
    this.changed();
  }

  setActiveProject(projectId: string, bpm: number): void {
    this.ensureLoaded();
    this.activeProjectId = projectId;
    this.activeBpm = Number.isFinite(bpm) ? Math.max(20, Math.min(400, bpm)) : DEFAULT_BPM;
    for (const [key, note] of this.pending) {
      if (note.projectId !== projectId) this.pending.delete(key);
    }
  }

  setFormalRecordingActive(active: boolean): void {
    this.formalRecordingActive = active;
    if (active) this.pending.clear();
  }

  captureOneShot(trackId: string, note: string, durationSec: number, velocity: number): void {
    if (this.formalRecordingActive || !this.activeProjectId) return;
    this.append({
      id: createEventId(),
      projectId: this.activeProjectId,
      trackId,
      kind: "melodic",
      note,
      velocity: clampVelocity(velocity),
      startedAtMs: this.now(),
      durationMs: Math.max(40, durationSec * 1_000),
      bpm: this.activeBpm,
    });
  }

  noteOn(trackId: string, note: string, velocity: number): void {
    if (this.formalRecordingActive || !this.activeProjectId) return;
    const key = `${trackId}:${note}`;
    this.pending.set(key, {
      projectId: this.activeProjectId,
      trackId,
      note,
      velocity: clampVelocity(velocity),
      startedAtMs: this.now(),
      bpm: this.activeBpm,
    });
  }

  noteOff(trackId: string, note: string): void {
    const key = `${trackId}:${note}`;
    const pending = this.pending.get(key);
    if (!pending) return;
    this.pending.delete(key);
    if (this.formalRecordingActive) return;
    this.append({
      id: createEventId(),
      projectId: pending.projectId,
      trackId: pending.trackId,
      kind: "melodic",
      note: pending.note,
      velocity: pending.velocity,
      startedAtMs: pending.startedAtMs,
      durationMs: Math.max(40, this.now() - pending.startedAtMs),
      bpm: pending.bpm,
    });
  }

  captureDrum(trackId: string, note: string, velocity: number): void {
    if (this.formalRecordingActive || !this.activeProjectId) return;
    this.append({
      id: createEventId(),
      projectId: this.activeProjectId,
      trackId,
      kind: "drum",
      note,
      velocity: clampVelocity(velocity),
      startedAtMs: this.now(),
      durationMs: 125,
      bpm: this.activeBpm,
    });
  }

  getProjectEvents(projectId: string): JamCaptureEvent[] {
    this.ensureLoaded();
    return this.events
      .filter((event) => event.projectId === projectId)
      .map((event) => ({ ...event }));
  }

  summarize(projectId: string): JamTrackSummary[] {
    const groups = new Map<string, JamCaptureEvent[]>();
    for (const event of this.getProjectEvents(projectId)) {
      const group = groups.get(event.trackId) ?? [];
      group.push(event);
      groups.set(event.trackId, group);
    }
    return [...groups.entries()]
      .map(([trackId, events]) => {
        const firstAtMs = Math.min(...events.map((event) => event.startedAtMs));
        const lastAtMs = Math.max(
          ...events.map((event) => event.startedAtMs + event.durationMs),
        );
        return {
          trackId,
          eventCount: events.length,
          firstAtMs,
          lastAtMs,
          spanSeconds: Math.max(0, (lastAtMs - firstAtMs) / 1_000),
          kind: events[0]?.kind ?? "melodic",
        };
      })
      .sort((left, right) => right.lastAtMs - left.lastAtMs);
  }

  claim(eventIds: readonly string[]): JamCaptureEvent[] {
    this.ensureLoaded();
    const ids = new Set(eventIds);
    const claimed = this.events.filter((event) => ids.has(event.id));
    if (claimed.length === 0) return [];
    this.events = this.events.filter((event) => !ids.has(event.id));
    this.changed();
    return claimed.map((event) => ({ ...event }));
  }

  restore(events: readonly JamCaptureEvent[]): void {
    if (events.length === 0) return;
    this.ensureLoaded();
    const existing = new Set(this.events.map((event) => event.id));
    const restored = events.filter((event) => !existing.has(event.id));
    if (restored.length === 0) return;
    this.events = [...this.events, ...restored].sort(
      (left, right) => left.startedAtMs - right.startedAtMs,
    );
    this.trimProjects();
    this.changed();
  }

  discardTrack(projectId: string, trackId: string): number {
    this.ensureLoaded();
    const before = this.events.length;
    this.events = this.events.filter(
      (event) => event.projectId !== projectId || event.trackId !== trackId,
    );
    const removed = before - this.events.length;
    if (removed > 0) this.changed();
    return removed;
  }
}

function snapBeat(value: number, feel: JamRecoveryFeel): number {
  if (feel === "natural") return Math.max(0, value);
  return Math.max(0, Math.round(value / 0.25) * 0.25);
}

export function buildJamRecoveryClip({
  id,
  events,
  targetTrack,
  bpm,
  start,
  windowSeconds,
  feel,
}: {
  id: string;
  events: readonly JamCaptureEvent[];
  targetTrack: Track;
  bpm: number;
  start: number;
  windowSeconds: number;
  feel: JamRecoveryFeel;
}): JamRecoveryResult | null {
  if (events.length === 0) return null;
  const safeBpm = Math.max(20, Math.min(400, bpm));
  const sorted = [...events].sort((left, right) => left.startedAtMs - right.startedAtMs);
  const lastStart = sorted.at(-1)?.startedAtMs ?? 0;
  const threshold = lastStart - Math.max(1, windowSeconds) * 1_000;
  const selected = sorted.filter((event) => event.startedAtMs >= threshold);
  if (selected.length === 0) return null;
  const baseMs = selected[0].startedAtMs;
  const beatMs = 60_000 / safeBpm;
  const notes = selected.map((event) => {
    const time = snapBeat((event.startedAtMs - baseMs) / beatMs, feel);
    const naturalDuration = event.kind === "drum" ? 0.25 : event.durationMs / beatMs;
    const duration =
      feel === "sixteenth"
        ? Math.max(0.125, Math.round(naturalDuration / 0.25) * 0.25)
        : Math.max(0.125, naturalDuration);
    return {
      time,
      note: event.note,
      duration,
      velocity: clampVelocity(event.velocity),
    };
  });
  const latestEnd = Math.max(...notes.map((note) => note.time + note.duration));
  const length = Math.max(4, Math.ceil(latestEnd / 4) * 4);
  const spanSeconds = Math.max(
    0,
    (Math.max(...selected.map((event) => event.startedAtMs + event.durationMs)) - baseMs) /
      1_000,
  );
  return {
    clip: {
      id,
      start,
      length,
      notes,
      name: `Recovered Jam · ${feel === "natural" ? "Natural feel" : "Tight 1/16"}`,
      color: targetTrack.meta?.color,
      bars: Math.max(1, Math.ceil(length / 4)),
      division: "1/16",
    },
    eventIds: selected.map((event) => event.id),
    spanSeconds,
  };
}

export const jamCapture = new JamCapture();

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => jamCapture.flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") jamCapture.flush();
  });
}

export const JAM_CAPTURE_LIMIT = MAX_CAPTURED_EVENTS;
