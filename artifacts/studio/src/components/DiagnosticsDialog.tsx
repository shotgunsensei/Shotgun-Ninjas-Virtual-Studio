import { useEffect, useState } from "react";
import * as Tone from "tone";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Download, CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import { APP_VERSION, APP_NAME } from "../lib/version";
import { listProjects } from "../lib/storage/db";
import { getSampleCacheStats } from "../lib/audio/sounds/samples";

interface DiagnosticsSnapshot {
  appVersion: string;
  appName: string;
  capturedAt: string;
  browser: string;
  userAgent: string;
  language: string;
  audioContextState: string;
  sampleRate: number | null;
  baseLatencySec: number | null;
  outputLatencySec: number | null;
  webMidiSupported: boolean;
  pwaInstalled: boolean | "unknown";
  savedProjects: number | "unavailable";
  storageUsageMb: number | "unavailable";
  storageQuotaMb: number | "unavailable";
  decodedSampleBuffers: number;
  decodedSampleCacheMb: number;
  sampleDecodesActive: number;
  sampleDecodesInFlight: number;
}

interface CompatResult {
  label: string;
  status: "ok" | "warn" | "error";
  note: string;
}

function detectBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Unknown";
}

export async function gather(): Promise<DiagnosticsSnapshot> {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const ctx = (() => {
    try {
      return Tone.getContext().rawContext as unknown as AudioContext | undefined;
    } catch {
      return undefined;
    }
  })();
  let savedProjects: number | "unavailable" = "unavailable";
  try {
    const projects = await listProjects();
    savedProjects = projects.length;
  } catch {
    savedProjects = "unavailable";
  }
  let storageUsageMb: number | "unavailable" = "unavailable";
  let storageQuotaMb: number | "unavailable" = "unavailable";
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      if (typeof est.usage === "number") {
        storageUsageMb = Math.round((est.usage / (1024 * 1024)) * 10) / 10;
      }
      if (typeof est.quota === "number") {
        storageQuotaMb = Math.round((est.quota / (1024 * 1024)) * 10) / 10;
      }
    }
  } catch {
    /* ignore */
  }
  const pwaInstalled: boolean | "unknown" = (() => {
    try {
      if (typeof window === "undefined") return "unknown";
      if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
      const navAny = navigator as unknown as { standalone?: boolean };
      if (navAny.standalone) return true;
      return false;
    } catch {
      return "unknown";
    }
  })();
  const sampleCache = getSampleCacheStats();

  return {
    appVersion: APP_VERSION,
    appName: APP_NAME,
    capturedAt: new Date().toISOString(),
    browser: detectBrowser(ua),
    userAgent: ua,
    language: typeof navigator !== "undefined" ? navigator.language : "?",
    audioContextState: ctx?.state ?? "uninitialized",
    sampleRate: ctx?.sampleRate ?? null,
    baseLatencySec:
      typeof (ctx as { baseLatency?: number } | undefined)?.baseLatency === "number"
        ? (ctx as { baseLatency: number }).baseLatency
        : null,
    outputLatencySec:
      typeof (ctx as { outputLatency?: number } | undefined)?.outputLatency ===
      "number"
        ? (ctx as { outputLatency: number }).outputLatency
        : null,
    webMidiSupported:
      typeof navigator !== "undefined" && "requestMIDIAccess" in navigator,
    pwaInstalled,
    savedProjects,
    storageUsageMb,
    storageQuotaMb,
    decodedSampleBuffers: sampleCache.decodedBuffers,
    decodedSampleCacheMb:
      Math.round((sampleCache.decodedBytes / (1024 * 1024)) * 10) / 10,
    sampleDecodesActive: sampleCache.activeDecodes,
    sampleDecodesInFlight: sampleCache.inFlight,
  };
}

export function checkBrowserCompat(): CompatResult[] {
  const results: CompatResult[] = [];

  const hasAudioCtx =
    typeof window !== "undefined" &&
    (typeof AudioContext !== "undefined" || typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== "undefined");
  results.push({
    label: "AudioContext",
    status: hasAudioCtx ? "ok" : "error",
    note: hasAudioCtx ? "Audio engine available" : "Audio engine unavailable — studio cannot play sound",
  });

  const hasIDB = typeof indexedDB !== "undefined";
  results.push({
    label: "IndexedDB",
    status: hasIDB ? "ok" : "error",
    note: hasIDB ? "Project storage available" : "Project storage unavailable — save/load disabled",
  });

  const hasWebMidi =
    typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
  results.push({
    label: "Web MIDI",
    status: hasWebMidi ? "ok" : "warn",
    note: hasWebMidi ? "MIDI controller input available" : "MIDI controller input disabled in this browser",
  });

  const hasSAB = typeof SharedArrayBuffer !== "undefined";
  results.push({
    label: "SharedArrayBuffer",
    status: hasSAB ? "ok" : "warn",
    note: hasSAB ? "High-performance audio worklets enabled" : "Some audio worklets may be limited — use Chrome or Edge with HTTPS",
  });

  const hasOPFS = (() => {
    try {
      return typeof navigator !== "undefined" && "storage" in navigator && typeof (navigator.storage as unknown as { getDirectory?: unknown }).getDirectory === "function";
    } catch {
      return false;
    }
  })();
  results.push({
    label: "OPFS",
    status: hasOPFS ? "ok" : "warn",
    note: hasOPFS ? "Origin Private File System available for large file caching" : "Large sample caching limited — IndexedDB used as fallback",
  });

  const hasMediaRecorder = typeof MediaRecorder !== "undefined";
  results.push({
    label: "MediaRecorder",
    status: hasMediaRecorder ? "ok" : "error",
    note: hasMediaRecorder ? "Vocal recording available" : "Vocal/microphone recording unavailable",
  });

  return results;
}

export function DiagnosticsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [snap, setSnap] = useState<DiagnosticsSnapshot | null>(null);
  const [compat] = useState<CompatResult[]>(() => checkBrowserCompat());
  const [showCompat, setShowCompat] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void gather().then((s) => {
      if (!cancelled) setSnap(s);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const copy = () => {
    if (!snap) return;
    navigator.clipboard?.writeText(JSON.stringify(snap, null, 2)).catch(() => {
      /* clipboard denied */
    });
  };

  const exportReport = () => {
    if (!snap) return;
    const report = {
      ...snap,
      browserCompatibility: compat,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `sn-studio-diagnostics-${ts}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-describedby="diag-desc">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3">
            <span>About &amp; Diagnostics</span>
            <span className="font-mono text-[10px] tracking-widest text-primary uppercase">
              {APP_VERSION}
            </span>
          </DialogTitle>
          <DialogDescription id="diag-desc">
            Read-only runtime info. Helpful when reporting a bug.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1 font-mono text-xs">
          {snap ? (
            <>
              <Row label="App" value={`${snap.appName}`} />
              <Row label="Version" value={snap.appVersion} />
              <Row label="Browser" value={snap.browser} />
              <Row label="Language" value={snap.language} />
              <Row label="Audio state" value={snap.audioContextState} />
              <Row
                label="Sample rate"
                value={snap.sampleRate ? `${snap.sampleRate} Hz` : "—"}
              />
              <Row
                label="Base latency"
                value={
                  snap.baseLatencySec != null
                    ? `${Math.round(snap.baseLatencySec * 1000)} ms`
                    : "—"
                }
              />
              <Row
                label="Output latency"
                value={
                  snap.outputLatencySec != null
                    ? `${Math.round(snap.outputLatencySec * 1000)} ms`
                    : "—"
                }
              />
              <Row
                label="Web MIDI"
                value={snap.webMidiSupported ? "supported" : "unsupported"}
              />
              <Row
                label="Installed PWA"
                value={
                  snap.pwaInstalled === true
                    ? "yes"
                    : snap.pwaInstalled === false
                      ? "no"
                      : "unknown"
                }
              />
              <Row
                label="Saved projects"
                value={String(snap.savedProjects)}
              />
              <Row
                label="Storage used"
                value={
                  snap.storageUsageMb === "unavailable"
                    ? "—"
                    : `${snap.storageUsageMb} MB`
                }
              />
              <Row
                label="Storage quota"
                value={
                  snap.storageQuotaMb === "unavailable"
                    ? "—"
                    : `${snap.storageQuotaMb} MB`
                }
              />
              <Row
                label="Sample cache"
                value={`${snap.decodedSampleBuffers} buffers · ${snap.decodedSampleCacheMb} MB`}
              />
              <Row
                label="Sample decode"
                value={`${snap.sampleDecodesActive} active · ${snap.sampleDecodesInFlight} in flight`}
              />
              <div className="pt-2 text-[10px] text-muted-foreground break-words">
                {snap.userAgent}
              </div>
            </>
          ) : (
            <div className="text-muted-foreground">Gathering…</div>
          )}
        </div>

        {/* Browser compatibility matrix */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowCompat((v) => !v)}
            className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground w-full text-left"
          >
            <span className="flex-1">Browser compatibility</span>
            <span>{showCompat ? "▲" : "▼"}</span>
          </button>
          {showCompat && (
            <div className="mt-2 space-y-1 border border-border rounded-md p-2">
              {compat.map((c) => (
                <CompatRow key={c.label} result={c} />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 gap-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Free forever · no accounts · no paywalls
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={copy}
              disabled={!snap}
              className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border font-mono text-[10px] uppercase tracking-widest hover:bg-accent/40 disabled:opacity-50"
            >
              <Copy className="w-3 h-3" />
              Copy
            </button>
            <button
              onClick={exportReport}
              disabled={!snap}
              className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border font-mono text-[10px] uppercase tracking-widest hover:bg-accent/40 disabled:opacity-50"
            >
              <Download className="w-3 h-3" />
              Export
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/40 py-1">
      <span className="text-muted-foreground uppercase tracking-widest text-[10px]">
        {label}
      </span>
      <span className="text-foreground truncate text-right">{value}</span>
    </div>
  );
}

function CompatRow({ result }: { result: CompatResult }) {
  const Icon =
    result.status === "ok"
      ? CheckCircle2
      : result.status === "warn"
        ? AlertCircle
        : XCircle;
  const color =
    result.status === "ok"
      ? "text-emerald-500"
      : result.status === "warn"
        ? "text-yellow-400"
        : "text-destructive";
  return (
    <div className="flex items-start gap-2 py-0.5">
      <Icon className={`w-3 h-3 mt-0.5 flex-none ${color}`} />
      <div className="flex-1 min-w-0">
        <span className="font-mono text-[10px] uppercase tracking-widest text-foreground">
          {result.label}
        </span>
        <span className="text-muted-foreground text-[10px] ml-2 leading-snug">
          {result.note}
        </span>
      </div>
    </div>
  );
}
