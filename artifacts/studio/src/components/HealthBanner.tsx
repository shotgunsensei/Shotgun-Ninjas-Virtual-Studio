import { useState } from "react";
import { AlertTriangle, Info, ChevronDown, ChevronUp, X } from "lucide-react";
import type { HealthReport } from "../lib/storage/health";

/**
 * Non-blocking banner that surfaces a project's health report on
 * load: missing samples, orphaned mappings, schema upgrades, etc.
 * Collapses to a single-line summary by default and can be dismissed
 * for the rest of the session (the report is recomputed on next load).
 */
export function HealthBanner({
  report,
  onDismiss,
}: {
  report: HealthReport;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!report || report.ok) return null;

  const warnCount = report.issues.filter((i) => i.severity !== "info").length;
  const accent = warnCount > 0
    ? "border-yellow-600/50 bg-yellow-600/10"
    : "border-primary/40 bg-primary/5";
  const Icon = warnCount > 0 ? AlertTriangle : Info;
  const summary =
    warnCount > 0
      ? `${warnCount} project issue${warnCount === 1 ? "" : "s"} detected`
      : `${report.issues.length} project note${report.issues.length === 1 ? "" : "s"}`;

  return (
    <div
      data-testid="health-banner"
      className={`border-b px-4 py-2 ${accent}`}
    >
      <div className="flex items-center gap-2 text-xs font-mono">
        <Icon className="w-3.5 h-3.5 text-yellow-400 flex-none" />
        <span className="flex-1 truncate">{summary}</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
          aria-label={expanded ? "Hide details" : "Show details"}
        >
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
          <span>{expanded ? "Hide" : "Show"} details</span>
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Dismiss health banner"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {expanded && (
        <ul className="mt-2 space-y-1 text-[11px] font-mono">
          {report.issues.map((issue, i) => (
            <li
              key={i}
              className={`flex items-start gap-2 ${
                issue.severity === "info"
                  ? "text-muted-foreground"
                  : "text-yellow-200"
              }`}
            >
              <span className="text-[9px] uppercase tracking-widest opacity-70 mt-0.5 w-10 flex-none">
                {issue.severity}
              </span>
              <span className="flex-1">{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
