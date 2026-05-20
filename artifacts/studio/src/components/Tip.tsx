import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSettings } from "../lib/settings";

/**
 * Project-wide tooltip wrapper used to annotate advanced controls.
 * Honors the user's "Show tooltips" preference — when off, the trigger
 * is rendered without any tooltip overlay so power users aren't slowed
 * down. Keep tooltip strings short and action-oriented.
 */
export function Tip({
  label,
  side = "top",
  children,
  asChild = true,
}: {
  label: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  children: React.ReactElement;
  asChild?: boolean;
}) {
  const enabled = useSettings((s) => s.showTooltips);
  if (!enabled) return children;
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild={asChild}>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        className="bg-graphite text-foreground border border-border font-mono text-[10px] uppercase tracking-widest"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
