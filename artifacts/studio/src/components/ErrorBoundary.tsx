import { Component, type ReactNode } from "react";
import { AlertOctagon, RefreshCw, Copy, LifeBuoy } from "lucide-react";
import { APP_VERSION } from "../lib/version";
import { getStore } from "../store";
import { projectToJson, getLastProjectId, loadProject } from "../lib/storage/db";

interface State {
  hasError: boolean;
  error: Error | null;
  info: string;
}

/**
 * Top-level studio error boundary. If a child component throws during
 * render, we show a recovery panel instead of a blank screen so the user
 * can reload, copy the trace, panic-stop audio, or download a JSON
 * snapshot of the in-memory project as a recovery file.
 */
export class StudioErrorBoundary extends Component<
  { children: ReactNode; onPanic?: () => void },
  State
> {
  state: State = { hasError: false, error: null, info: "" };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, info: "" };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Surface in console for devtools while showing a friendly panel.
    console.error("[studio] caught render error", error, info);
    this.setState({ info: info.componentStack ?? "" });
  }

  private copy = () => {
    const text = `${this.state.error?.name}: ${this.state.error?.message}\n${this.state.error?.stack ?? ""}\n--- component stack ---${this.state.info}\n--- version ---\n${APP_VERSION}`;
    navigator.clipboard?.writeText(text).catch(() => {
      /* clipboard denied */
    });
  };

  private reload = () => {
    window.location.reload();
  };

  private panic = () => {
    try {
      this.props.onPanic?.();
    } catch {
      /* ignore */
    }
    this.setState({ hasError: false, error: null, info: "" });
  };

  /**
   * Best-effort recovery export. Tries the in-memory store first because
   * that's the freshest state the user saw; falls back to the most
   * recent IndexedDB autosave if the store isn't usable (rare — happens
   * if the crash was during bootstrap). Wraps the result so even on
   * total failure the user gets the raw error trace to file a report.
   */
  private exportRecovery = async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `shotgun-ninjas-recovery-${stamp}.json`;
    const errorPayload = {
      app: "shotgun-ninjas-studio",
      version: APP_VERSION,
      capturedAt: new Date().toISOString(),
      error: this.state.error
        ? {
            name: this.state.error.name,
            message: this.state.error.message,
            stack: this.state.error.stack,
          }
        : null,
      componentStack: this.state.info,
    };

    let projectJson: string | null = null;
    let source: "memory" | "indexeddb" | "none" = "none";
    try {
      const project = getStore().state.project;
      if (project) {
        projectJson = await projectToJson(project);
        source = "memory";
      }
    } catch (err) {
      console.warn("[studio] in-memory recovery serialize failed", err);
    }
    if (!projectJson) {
      try {
        const id = await getLastProjectId();
        if (id) {
          const saved = await loadProject(id);
          if (saved) {
            projectJson = await projectToJson(saved);
            source = "indexeddb";
          }
        }
      } catch (err) {
        console.warn("[studio] IndexedDB recovery load failed", err);
      }
    }

    // Always download the canonical project JSON first so the user can
    // reload it through File · Import without any manual editing — that
    // is the primary recovery affordance. Wrapping it in a custom
    // envelope would break parseProjectJson(), so the crash metadata is
    // shipped as a separate sidecar file when available.
    const triggerDownload = (data: Blob, name: string) => {
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    if (projectJson) {
      triggerDownload(
        new Blob([projectJson], { type: "application/json" }),
        filename,
      );
    }
    const metaName = projectJson
      ? `shotgun-ninjas-recovery-${stamp}.meta.json`
      : filename;
    triggerDownload(
      new Blob(
        [
          JSON.stringify({ ...errorPayload, recoverySource: source }, null, 2),
        ],
        { type: "application/json" },
      ),
      metaName,
    );
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="h-full flex items-center justify-center bg-background text-foreground p-6">
        <div className="max-w-lg w-full border border-destructive/50 bg-destructive/5 rounded-md p-5 space-y-4">
          <div className="flex items-center gap-2 text-destructive">
            <AlertOctagon className="w-5 h-5" />
            <h2 className="font-mono text-sm uppercase tracking-widest">
              Studio crashed
            </h2>
          </div>
          <p className="text-sm text-foreground/85">
            Something inside the studio threw an error. Your project is still
            saved. Reload to try again, copy the trace to report it, export a
            recovery file to keep a copy of the project, or hit Panic to
            silence any audio that's still playing.
          </p>
          <pre className="text-xs font-mono bg-background/60 border border-border rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap break-words">
            {this.state.error?.name}: {this.state.error?.message}
          </pre>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={this.reload}
              className="flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground font-mono text-xs uppercase tracking-widest"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reload
            </button>
            <button
              onClick={this.panic}
              className="flex items-center gap-1.5 h-9 px-3 rounded-md border border-red-500/50 text-red-400 font-mono text-xs uppercase tracking-widest hover:bg-red-500/15"
            >
              <AlertOctagon className="w-3.5 h-3.5" />
              Panic
            </button>
            <button
              onClick={() => {
                void this.exportRecovery();
              }}
              className="flex items-center gap-1.5 h-9 px-3 rounded-md border border-border font-mono text-xs uppercase tracking-widest hover:bg-accent/40"
            >
              <LifeBuoy className="w-3.5 h-3.5" />
              Export recovery data
            </button>
            <button
              onClick={this.copy}
              className="flex items-center gap-1.5 h-9 px-3 rounded-md border border-border font-mono text-xs uppercase tracking-widest hover:bg-accent/40"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy error
            </button>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {APP_VERSION}
          </p>
        </div>
      </div>
    );
  }
}
