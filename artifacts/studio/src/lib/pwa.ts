/* PWA runtime helpers — service worker registration, install prompt
 * capture, update detection, and a tiny store so React components can
 * subscribe without pulling in a full state library. */
import { useSyncExternalStore } from "react";

type Listener = () => void;

export type PwaState = {
  /** SW is registered and the app shell is cached for offline use. */
  offlineReady: boolean;
  /** A new SW is waiting in the wings — show the update toast. */
  updateAvailable: boolean;
  /** True when beforeinstallprompt has fired and we can prompt. */
  installAvailable: boolean;
  /** True when the page is running standalone (installed). */
  installed: boolean;
  /** iOS Safari — beforeinstallprompt doesn't fire so we show the hint. */
  iosInstallHint: boolean;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let state: PwaState = {
  offlineReady: false,
  updateAvailable: false,
  installAvailable: false,
  installed: false,
  iosInstallHint: false,
};

const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());

function patch(next: Partial<PwaState>) {
  state = { ...state, ...next };
  emit();
}

let waitingWorker: ServiceWorker | null = null;
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let registration: ServiceWorkerRegistration | null = null;
let updateReloadPending = false;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari quirk: navigator.standalone is non-standard but reliable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window.navigator as any).standalone === true;
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS 13+ reports as Mac; detect by touch points too.
  const iPadDesktop =
    /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
  return /iPhone|iPad|iPod/i.test(ua) || iPadDesktop;
}

function trackWaiting(reg: ServiceWorkerRegistration) {
  const candidate = reg.waiting;
  if (candidate && navigator.serviceWorker.controller) {
    waitingWorker = candidate;
    patch({ updateAvailable: true });
  }
  reg.addEventListener("updatefound", () => {
    const sw = reg.installing;
    if (!sw) return;
    sw.addEventListener("statechange", () => {
      if (sw.state === "installed" && navigator.serviceWorker.controller) {
        waitingWorker = sw;
        patch({ updateAvailable: true });
      }
    });
  });
}

/** Tell the waiting worker to take over and reload the page once it does. */
export function applyUpdate() {
  if (updateReloadPending) return;
  updateReloadPending = true;
  if (!waitingWorker) {
    // Fallback: just reload — the SW lifecycle will sort itself out.
    window.location.reload();
    return;
  }
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  patch({ updateAvailable: false });
  waitingWorker.postMessage({ type: "SKIP_WAITING" });
}

/** Trigger the install prompt captured from beforeinstallprompt. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredInstallPrompt) return "unavailable";
  const evt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  patch({ installAvailable: false });
  try {
    await evt.prompt();
    const choice = await evt.userChoice;
    return choice.outcome;
  } catch {
    return "dismissed";
  }
}

export function getPwaState(): PwaState {
  return state;
}

export function subscribePwa(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function usePwa(): PwaState {
  return useSyncExternalStore(subscribePwa, getPwaState, getPwaState);
}

let initialized = false;
/** Call once at startup. Safe to call repeatedly. */
export function initPwa() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  patch({ installed: isStandalone() });
  if (isIos() && !isStandalone()) patch({ iosInstallHint: true });

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e as BeforeInstallPromptEvent;
    patch({ installAvailable: true, iosInstallHint: false });
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    patch({ installAvailable: false, installed: true, iosInstallHint: false });
  });

  if (!("serviceWorker" in navigator)) return;

  // Only register the SW in production builds. Registering in `vite dev`
  // would fight HMR and is unnecessary for offline verification, which is
  // done against the built/preview output per the task spec.
  if (!import.meta.env.PROD) return;

  // The SW lives at the artifact base path so its scope matches the app.
  const swUrl = `${import.meta.env.BASE_URL}sw.js`;
  const swScope = import.meta.env.BASE_URL || "/";

  navigator.serviceWorker
    .register(swUrl, { scope: swScope })
    .then((reg) => {
      registration = reg;
      trackWaiting(reg);
      if (navigator.serviceWorker.controller) {
        patch({ offlineReady: true });
      }
    })
    .catch((err) => {
      console.warn("[pwa] service worker registration failed", err);
    });

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "SW_ACTIVATED") {
      patch({ offlineReady: true });
    }
  });

  navigator.serviceWorker.ready
    .then(() => patch({ offlineReady: true }))
    .catch(() => undefined);

  // Periodically poll for an updated SW so long-lived sessions discover
  // new builds without requiring a manual reload.
  const POLL_MS = 60 * 60 * 1000; // 1 hour
  window.setInterval(() => {
    registration?.update().catch(() => undefined);
  }, POLL_MS);
}
