import { useEffect, useState } from "react";
import * as Tone from "tone";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy } from "lucide-react";
import { APP_VERSION, APP_NAME } from "../lib/version";
import { listProjects } from "../lib/storage/db";

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
}

function detectBrowser(ua: string): string {
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Unknown";
}

async function gather(): Promise<DiagnosticsSnapshot> {
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
      // iOS Safari uses a non-standard property.
      const navAny = navigator as unknown as { standalone?: boolean };
      if (navAny.standalone) return true;
      return false;
    } catch {
      return "unknown";
    }
  })();

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
  };
}

export function DiagnosticsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [snap, setSnap] = useState<DiagnosticsSnapshot | null>(null);

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
              <div className="pt-2 text-[10px] text-muted-foreground break-words">
                {snap.userAgent}
              </div>
            </>
          ) : (
            <div className="text-muted-foreground">Gathering…</div>
          )}
        </div>
        <div className="flex items-center justify-between pt-2">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Free forever · no accounts · no paywalls
          </span>
          <button
            onClick={copy}
            disabled={!snap}
            className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border font-mono text-[10px] uppercase tracking-widest hover:bg-accent/40 disabled:opacity-50"
          >
            <Copy className="w-3 h-3" />
            Copy
          </button>
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
