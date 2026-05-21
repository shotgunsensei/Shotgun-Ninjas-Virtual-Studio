import { useEffect, useRef, useState } from "react";
import { getSettings, setSettings } from "../settings";

export type MidiStatus =
  | "unsupported"
  | "denied"
  | "no-access-yet"
  | "ready"
  | "error";

export interface MidiEvent {
  type: "noteon" | "noteoff" | "cc";
  channel: number;
  data1: number; // note or controller number
  data2: number; // velocity or value
  // raw signature used for mapping
  signature: string;
  device: string;
  ts: number;
}

type Listener = (e: MidiEvent) => void;

function detectInitialStatus(): MidiStatus {
  // Pure feature detection — does NOT request permission and does NOT
  // touch the Web MIDI API beyond a property check. This lets the
  // Settings UI render the "not supported" fallback proactively, before
  // the user clicks Enable MIDI.
  if (typeof navigator === "undefined") return "unsupported";
  if (!("requestMIDIAccess" in navigator)) return "unsupported";
  return "no-access-yet";
}

class MidiBus {
  status: MidiStatus = detectInitialStatus();
  error?: string;
  inputs: { id: string; name: string }[] = [];
  selectedId: string | null = null;
  private access: MIDIAccess | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<() => void>();

  onStatus(fn: () => void) {
    this.statusListeners.add(fn);
    return () => {
      this.statusListeners.delete(fn);
    };
  }
  onEvent(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify() {
    this.statusListeners.forEach((f) => f());
  }

  async requestAccess() {
    if (typeof navigator === "undefined" || !("requestMIDIAccess" in navigator)) {
      this.status = "unsupported";
      this.notify();
      return;
    }
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      this.access = access;
      this.status = "ready";
      this.refreshInputs();
      access.onstatechange = () => this.refreshInputs();
      // Restore previously selected input from settings so users don't
      // have to re-pick their controller every session.
      const savedId = getSettings().midiInputId;
      if (savedId && this.inputs.find((i) => i.id === savedId)) {
        this.selectedId = savedId;
        this.bind(savedId);
      }
      this.notify();
    } catch (err) {
      this.status = "denied";
      this.error = (err as Error).message;
      this.notify();
    }
  }

  private refreshInputs() {
    if (!this.access) return;
    const list: { id: string; name: string }[] = [];
    this.access.inputs.forEach((inp) => {
      list.push({ id: inp.id, name: inp.name ?? "Unknown MIDI Input" });
    });
    this.inputs = list;
    // re-bind selected
    if (this.selectedId && !list.find((i) => i.id === this.selectedId)) {
      this.selectedId = null;
    }
    this.bind(this.selectedId);
    this.notify();
  }

  selectInput(id: string | null) {
    this.selectedId = id;
    this.bind(id);
    // Persist so the same controller comes back next time the user
    // clicks Enable MIDI.
    try {
      setSettings({ midiInputId: id });
    } catch {
      /* settings unavailable */
    }
    this.notify();
  }

  /** Returns the stored default channel (1-16) for the given device ID, or 0 if unset. */
  getDeviceChannel(deviceId: string): number {
    return getSettings().midiDeviceChannels?.[deviceId] ?? 0;
  }

  /** Persist a default channel (1-16) for a device. Pass 0 to clear (any channel). */
  setDeviceChannel(deviceId: string, channel: number) {
    const prev = getSettings().midiDeviceChannels ?? {};
    const next = { ...prev };
    if (channel === 0) {
      delete next[deviceId];
    } else {
      next[deviceId] = channel;
    }
    try {
      setSettings({ midiDeviceChannels: next });
    } catch {
      /* settings unavailable */
    }
    this.notify();
  }

  /** Default channel for the currently selected device, or 0 if none/unset. */
  get selectedDeviceChannel(): number {
    if (!this.selectedId) return 0;
    return this.getDeviceChannel(this.selectedId);
  }

  private bind(id: string | null) {
    if (!this.access) return;
    this.access.inputs.forEach((inp) => {
      inp.onmidimessage = null;
    });
    if (!id) return;
    const inp = this.access.inputs.get(id);
    if (!inp) return;
    inp.onmidimessage = (msg) => this.handleMessage(inp.name ?? "midi", msg);
  }

  private handleMessage(deviceName: string, msg: MIDIMessageEvent) {
    if (!msg.data || msg.data.length < 2) return;
    const status = msg.data[0];
    const data1 = msg.data[1];
    const data2 = msg.data[2] ?? 0;
    const messageType = status & 0xf0;
    const channel = status & 0x0f;
    let type: MidiEvent["type"] | null = null;
    let signature = "";
    const ch = channel + 1; // convert 0-based to 1-based (1-16)
    if (messageType === 0x90 && data2 > 0) {
      type = "noteon";
      signature = `note:${ch}:${data1}`;
    } else if (messageType === 0x80 || (messageType === 0x90 && data2 === 0)) {
      type = "noteoff";
      signature = `note:${ch}:${data1}`;
    } else if (messageType === 0xb0) {
      type = "cc";
      signature = `cc:${ch}:${data1}`;
    }
    if (!type) return;
    const ev: MidiEvent = {
      type,
      channel,
      data1,
      data2,
      signature,
      device: deviceName,
      ts: performance.now(),
    };
    this.listeners.forEach((l) => l(ev));
  }
}

export const midiBus = new MidiBus();

/**
 * Hook returning a snapshot of midi state and a way to subscribe to events.
 */
export function useMidi() {
  const [, force] = useState(0);
  useEffect(() => {
    return midiBus.onStatus(() => force((n) => n + 1));
  }, []);
  return {
    status: midiBus.status,
    inputs: midiBus.inputs,
    selectedId: midiBus.selectedId,
    selectedDeviceChannel: midiBus.selectedDeviceChannel,
    error: midiBus.error,
    requestAccess: () => midiBus.requestAccess(),
    selectInput: (id: string | null) => midiBus.selectInput(id),
    getDeviceChannel: (id: string) => midiBus.getDeviceChannel(id),
    setDeviceChannel: (id: string, ch: number) => midiBus.setDeviceChannel(id, ch),
  };
}

/** Subscribe to midi events for a component's lifetime. */
export function useMidiEvents(handler: (e: MidiEvent) => void, deps: unknown[] = []) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const unsub = midiBus.onEvent((e) => ref.current(e));
    return () => {
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Convert a MIDI note number (0-127) to a Tone.js note string. */
export function midiNoteToName(num: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(num / 12) - 1;
  const name = names[num % 12];
  return `${name}${octave}`;
}
