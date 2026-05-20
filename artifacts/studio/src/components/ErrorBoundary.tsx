import { Component, type ReactNode } from "react";
import { AlertOctagon, RefreshCw, Copy } from "lucide-react";

interface State {
  hasError: boolean;
  error: Error | null;
  info: string;
}

/**
 * Top-level studio error boundary. If a child component throws during
 * render, we show a recovery panel instead of a blank screen so the user
 * can reload, copy the trace, or hit a panic button to silence audio.
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
    const text = `${this.state.error?.name}: ${this.state.error?.message}\n${this.state.error?.stack ?? ""}\n--- component stack ---${this.state.info}`;
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
            saved. Reload to try again, copy the trace to report it, or hit
            panic to silence any audio that's still playing.
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
              onClick={this.copy}
              className="flex items-center gap-1.5 h-9 px-3 rounded-md border border-border font-mono text-xs uppercase tracking-widest hover:bg-accent/40"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy error
            </button>
          </div>
        </div>
      </div>
    );
  }
}
