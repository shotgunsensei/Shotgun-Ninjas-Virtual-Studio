/**
 * WorkletSampledDrum — audio-thread drum voice backed by SamplePlayerProcessor.
 *
 * Why this matters:
 *   Tone.Player.start(time) schedules an AudioBufferSourceNode from the main
 *   thread. Even though the Web Audio API honours the scheduled time on the
 *   audio thread, creating the node and calling start() must happen before
 *   that time, introducing a dependency on the main-thread event loop. Under
 *   GC pressure or CPU spikes this can cause late or dropped hits.
 *
 *   SamplePlayerProcessor already holds the PCM data on the audio thread.
 *   A `play` message simply enqueues a pending event that is processed at
 *   exactly the right sample-frame — no main-thread round-trip at trigger
 *   time, yielding hardware-accurate timing.
 *
 * Fallback hierarchy (per trigger):
 *   1. Worklet player   — preferred when ready + A/B flag is on
 *   2. Tone.Player      — used while worklet buffer is still decoding
 *   3. Synth fallback   — used while the CDN audio is loading
 */

import * as Tone from "tone";
import { workletManager } from "./worklet-manager";
import type { DrumVoice } from "./voices";

// ── A/B module-level toggle ────────────────────────────────────────────────

let _workletPlayerEnabled = true;
const MAX_WORKLET_SAMPLE_SECONDS = 5;
const MAX_WORKLET_SAMPLE_BYTES = 8 * 1024 * 1024;

/** Enable or disable the AudioWorklet sample player path globally.
 *  When disabled every voice falls back to Tone.Player (main-thread scheduling). */
export function setWorkletPlayerEnabled(on: boolean): void {
  _workletPlayerEnabled = on;
}

export function getWorkletPlayerEnabled(): boolean {
  return _workletPlayerEnabled;
}

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Bridge a native AudioWorkletNode output to a Tone.InputNode.
 * Tone nodes expose their underlying AudioNode as `.input`.
 */
function connectNativeToDest(
  native: AudioWorkletNode,
  dest: Tone.InputNode,
): boolean {
  const destAny = dest as unknown as { input?: AudioNode };
  if (destAny.input instanceof AudioNode) {
    native.connect(destAny.input);
    return true;
  }
  return false;
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Build a DrumVoice that routes playback through SamplePlayerProcessor when
 * the AudioWorklet subsystem is ready, falling back to Tone.Player and then
 * to `fallbackVoice` (a synth) while the worklet or CDN asset is loading.
 *
 * @param url          CDN URL of the drum sample (mp3 / ogg / wav).
 * @param fallbackVoice Synth DrumVoice to use before any audio loads.
 * @param volumeDb     Nominal output level in dB (applied to both paths).
 */
export function makeWorkletSampledDrum(
  url: string,
  fallbackVoice: DrumVoice,
  volumeDb = 0,
): DrumVoice {
  const player = new Tone.Player({ url, loop: false, volume: volumeDb });
  const volumeLin = Math.pow(10, volumeDb / 20);

  let workletNode: AudioWorkletNode | null = null;
  let decodedBuffer: AudioBuffer | null = null;
  let workletNodeConnected = false;
  let pendingDest: Tone.InputNode | null = null;

  // ── Wire worklet node to the Tone destination once both exist ──
  function maybeConnectWorklet(): void {
    if (!workletNode || workletNodeConnected || !pendingDest) return;
    if (connectNativeToDest(workletNode, pendingDest)) {
      workletNodeConnected = true;
    }
  }

  // ── Create AudioWorkletNode and upload PCM data to audio thread ──
  function initWorkletNode(): void {
    if (workletNode) return;
    if (!workletManager.ready || workletManager.fallback || !decodedBuffer) return;
    if (
      decodedBuffer.duration > MAX_WORKLET_SAMPLE_SECONDS ||
      decodedBuffer.length * decodedBuffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT >
        MAX_WORKLET_SAMPLE_BYTES
    ) {
      return;
    }
    try {
      const rawCtx = Tone.getContext().rawContext as AudioContext;
      const node = workletManager.createNode("sample-player", rawCtx);
      if (!node) return;

      // Transfer channel arrays to the audio thread.
      // We use transferable ArrayBuffers so the copy is zero-cost on the
      // receiver side (ownership moves to the worklet's Realm).
      const channels: Float32Array[] = [];
      const transfers: ArrayBuffer[] = [];
      for (let c = 0; c < decodedBuffer.numberOfChannels; c++) {
        const src = decodedBuffer.getChannelData(c);
        const copy = new Float32Array(src.length);
        copy.set(src);
        channels.push(copy);
        transfers.push(copy.buffer);
      }
      try {
        node.port.postMessage({ type: "load", channels }, transfers);
        workletNode = node;
        maybeConnectWorklet();
      } catch (err) {
        workletManager.disposeNode(node);
        throw err;
      }
    } catch (err) {
      console.warn("[WorkletSampledDrum] Failed to create worklet node:", err);
    }
  }

  // ── Async: fetch → decode → attempt worklet init ──
  void (async () => {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return;
      const arrayBuf = await resp.arrayBuffer();
      // decodeAudioData works on a suspended AudioContext; Tone always
      // creates one eagerly on import so this is safe.
      const rawCtx = Tone.getContext().rawContext as AudioContext;
      decodedBuffer = await rawCtx.decodeAudioData(arrayBuf);
      initWorkletNode();
    } catch {
      // Decode failed — Tone.Player still handles the URL via its own path.
    }
  })();

  return {
    trigger: (time: number, velocity: number) => {
      // Lazy worklet init: worklets may have become ready after buffer decoded.
      if (!workletNode && workletManager.ready && !workletManager.fallback && decodedBuffer) {
        initWorkletNode();
      }

      if (_workletPlayerEnabled && workletNode && !workletManager.fallback) {
        // ── Worklet path: audio-thread-accurate trigger ──
        workletNode.port.postMessage({
          type: "play",
          audioTime: time,
          amplitude: velocity * volumeLin,
        });
      } else if (player.loaded) {
        // ── Tone.Player path: main-thread schedule ──
        player.volume.setValueAtTime(
          volumeDb + 20 * Math.log10(Math.max(velocity, 0.01)),
          time,
        );
        player.start(time);
      } else {
        // ── Synth fallback: used while CDN sample loads ──
        fallbackVoice.trigger(time, velocity);
      }
    },

    connect: (dest: Tone.InputNode) => {
      pendingDest = dest;
      // Tone.Player and synth fallback connect the Tone way.
      player.connect(dest);
      fallbackVoice.connect(dest);
      // Worklet node bridges native → Tone.
      maybeConnectWorklet();
    },

    dispose: () => {
      player.dispose();
      fallbackVoice.dispose();
      if (workletNode) {
        try {
          workletNode.port.postMessage({ type: "stop" });
        } catch {
          // ignore
        }
        workletManager.disposeNode(workletNode);
        workletNode = null;
      }
    },
  };
}
