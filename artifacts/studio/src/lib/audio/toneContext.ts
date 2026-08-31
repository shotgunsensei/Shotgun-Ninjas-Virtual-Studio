// Import the context setter directly. Importing Tone's package root first
// eagerly reads getContext() for legacy singleton exports, which would create
// the standardized context before this bootstrap can replace it.
import { setContext } from "tone/build/esm/core/Global.js";

type StudioAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
  __SN_NATIVE_TONE_CONTEXT__?: AudioContext;
};

/**
 * Install Tone on one browser-owned AudioContext before any studio graph is
 * constructed.
 *
 * Tone's default context factory uses standardized-audio-context. That proxy
 * performs a recursive downstream cycle scan for every connection, which can
 * monopolize the main thread when dense transient and polyphonic voices are
 * created during playback. Supplying the native context keeps Tone's timing
 * and node abstractions while making its underlying graph browser-native.
 *
 * The context is intentionally created suspended; `audio.unlock()` resumes it
 * from the user's Enable Audio gesture. The window marker makes Vite HMR reuse
 * the same context instead of leaking another hardware audio destination.
 */
export function installNativeToneContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  const studioWindow = window as StudioAudioWindow;
  const existing = studioWindow.__SN_NATIVE_TONE_CONTEXT__;
  if (existing && existing.state !== "closed") return existing;

  const AudioContextConstructor =
    window.AudioContext ?? studioWindow.webkitAudioContext;
  if (!AudioContextConstructor) return null;

  let context: AudioContext;
  try {
    context = new AudioContextConstructor({ latencyHint: "interactive" });
  } catch {
    // Older WebKit implementations expose AudioContext but reject options.
    context = new AudioContextConstructor();
  }

  setContext(context);
  studioWindow.__SN_NATIVE_TONE_CONTEXT__ = context;
  return context;
}

export const studioAudioContext = installNativeToneContext();
