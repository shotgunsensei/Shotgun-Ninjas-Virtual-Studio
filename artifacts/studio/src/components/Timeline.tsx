import { memo, useEffect, useRef, useState } from "react";
import { Download, Flag, MoreVertical, Plus, X } from "lucide-react";
import { useStore, getStore, canDropClipOnTrack } from "../store";
import { audio } from "../lib/audio/engine";
import { visualTicker } from "../lib/visualTicker";
import { drawWaveformPeaks, getWaveformPeaks } from "../lib/audio/waveformPeaks";
import type { Section, Track } from "../types";
import { AutomationLaneStrip, AddAutomationLaneRow } from "./AutomationLane";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const PX_PER_BEAT = 32;
// Snap clip drags to 1/4 of a beat so users can place takes precisely while
// still landing on a sensible musical grid.
const DRAG_SNAP_BEATS = 0.25;

/** Clip color swatches surfaced in the clip context/dropdown menu. */
const CLIP_COLORS: Array<{ name: string; value: string }> = [
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f59e0b" },
  { name: "Yellow", value: "#eab308" },
  { name: "Green", value: "#22c55e" },
  { name: "Cyan", value: "#06b6d4" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Purple", value: "#a855f7" },
  { name: "Pink", value: "#ec4899" },
];

/** Default section labels for one-click drop. */
const SECTION_LABELS = ["Intro", "Verse", "Hook", "Bridge", "Outro"] as const;

const SECTION_PALETTE: Record<string, string> = {
  Intro: "#22c55e",
  Verse: "#3b82f6",
  Hook: "#ec4899",
  Bridge: "#a855f7",
  Outro: "#f59e0b",
};

function sectionColor(s: Section): string {
  return s.color ?? SECTION_PALETTE[s.label] ?? "#06b6d4";
}

function promptRename(current: string | undefined, kind: string): string | null {
  const next = window.prompt(`Rename ${kind}`, current ?? "");
  if (next === null) return null;
  return next;
}

export function Timeline() {
  const bars = useStore((s) => s.project.bars);
  const sections = useStore((s) => s.project.sections);
  const tracks = useStore((s) => s.project.tracks);
  const loopEnabled = useStore((s) => s.project.loopEnabled);
  const loopStartBeat = useStore((s) => s.project.loopStartBeat);
  const loopEndBeat = useStore((s) => s.project.loopEndBeat);
  const selectedTrackId = useStore((s) => s.selectedTrackId);
  const selectedClipId = useStore((s) => s.selectedClipId);
  const exportRangeMode = useStore((s) => s.exportRangeMode);
  const exportStartBar = useStore((s) => s.exportStartBar);
  const exportEndBar = useStore((s) => s.exportEndBar);

  const totalBeats = bars * 4;
  const width = totalBeats * PX_PER_BEAT;

  // Live playhead via ref + style transform — avoids re-rendering the
  // whole Timeline tree every animation frame. The DOM mutation is cheap
  // and visually identical to the previous setState approach.
  const playheadRef = useRef<HTMLDivElement>(null);
  const isPlaying = useStore((s) => s.isPlaying);

  useEffect(() => {
    if (!isPlaying || !playheadRef.current) return;
    return visualTicker.subscribe(() => {
      if (!playheadRef.current) return;
      const pos = audio.positionBeats() % (totalBeats || 1);
      playheadRef.current.style.transform = `translateX(${pos * PX_PER_BEAT}px)`;
    });
  }, [isPlaying, totalBeats]);

  // Delete the selected clip with the keyboard, ignoring text inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      const id = getStore().state.selectedClipId;
      if (!id) return;
      const track = getStore().state.project.tracks.find(
        (t) =>
          t.noteClips.some((c) => c.id === id) ||
          t.audioClips.some((c) => c.id === id),
      );
      if (!track) return;
      e.preventDefault();
      getStore().removeClip(track.id, id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="flex-1 overflow-auto panel-inset relative"
      onMouseDown={(e) => {
        // Clicking empty timeline background clears clip selection.
        if (e.target === e.currentTarget) getStore().selectClip(null);
      }}
    >
      <div className="relative" style={{ width, minWidth: "100%" }}>
        {/* sections strip */}
        <SectionsStrip
          sections={sections ?? []}
          bars={bars}
        />

        {/* ruler — also hosts loop region handles */}
        <div className="h-7 sticky top-7 z-10 bg-graphite/95 border-b border-border relative">
          <RulerLoopOverlay
            loopEnabled={loopEnabled}
            loopStartBeat={loopStartBeat}
            loopEndBeat={loopEndBeat}
            totalBeats={totalBeats}
          />
          <div className="flex h-full">
            {Array.from({ length: bars }).map((_, bar) => (
              <div
                key={bar}
                className="flex-none border-r border-border/60 flex items-center pl-2 font-mono text-[10px] text-muted-foreground"
                style={{ width: 4 * PX_PER_BEAT }}
              >
                {bar + 1}
              </div>
            ))}
          </div>
        </div>

        {/* export region strip (h-5 = 20px) — dedicated drag zone below the ruler */}
        <ExportRegionStrip
          bars={bars}
          totalBeats={totalBeats}
          exportRangeMode={exportRangeMode}
          exportStartBar={exportStartBar}
          exportEndBar={exportEndBar}
        />

        {/* tracks */}
        <div>
          {tracks.map((t) => (
            <TimelineRow
              key={t.id}
              track={t}
              selected={selectedTrackId === t.id}
              selectedClipId={selectedClipId}
              totalBeats={totalBeats}
            />
          ))}
        </div>

        {/* loop region overlay across track lanes */}
        {loopEnabled && (
          <div
            className="absolute left-0 right-0 bg-neon/10 border-l border-r border-neon/40 pointer-events-none"
            data-testid="loop-region-overlay"
            style={{
              top: 76,
              bottom: 0,
              left: loopStartBeat * PX_PER_BEAT,
              width: (loopEndBeat - loopStartBeat) * PX_PER_BEAT,
            }}
          />
        )}

        {/* export region overlay across track lanes — visible only in custom mode */}
        {exportRangeMode === "custom" && (
          <div
            className="absolute left-0 right-0 bg-amber-500/10 border-l border-r border-amber-500/40 pointer-events-none"
            data-testid="export-region-overlay"
            style={{
              top: 76,
              bottom: 0,
              left: (exportStartBar - 1) * 4 * PX_PER_BEAT,
              width: (exportEndBar - exportStartBar + 1) * 4 * PX_PER_BEAT,
            }}
          />
        )}

        {/* playhead */}
        <div
          ref={playheadRef}
          className="absolute top-0 bottom-0 left-0 w-px bg-primary glow-red pointer-events-none"
          style={{ transform: "translateX(0)" }}
        />
      </div>
    </div>
  );
}

/** Translucent loop region rendered on the ruler with draggable grip
 *  handles on each edge plus a body grip for moving the whole region. */
function RulerLoopOverlay({
  loopEnabled,
  loopStartBeat,
  loopEndBeat,
  totalBeats,
}: {
  loopEnabled: boolean;
  loopStartBeat: number;
  loopEndBeat: number;
  totalBeats: number;
}) {
  const beginDrag = (mode: "start" | "end" | "move") => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startA = loopStartBeat;
    const startB = loopEndBeat;
    const onMove = (ev: MouseEvent) => {
      const dxBeats = (ev.clientX - startX) / PX_PER_BEAT;
      const snap = (b: number) =>
        Math.max(0, Math.min(totalBeats, Math.round(b / DRAG_SNAP_BEATS) * DRAG_SNAP_BEATS));
      if (mode === "start") {
        const a = snap(startA + dxBeats);
        getStore().setLoopRegion(Math.min(a, startB - DRAG_SNAP_BEATS), startB);
      } else if (mode === "end") {
        const b = snap(startB + dxBeats);
        getStore().setLoopRegion(startA, Math.max(b, startA + DRAG_SNAP_BEATS));
      } else {
        const width = startB - startA;
        let a = snap(startA + dxBeats);
        a = Math.max(0, Math.min(totalBeats - width, a));
        getStore().setLoopRegion(a, a + width);
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Allow user to click an empty area on the ruler to set the loop end
  // (Shift-click sets the loop start). When loop is disabled, click also
  // enables it.
  const onRulerMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-loop-handle]")) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const beat = Math.max(
      0,
      Math.min(
        totalBeats,
        Math.round(px / PX_PER_BEAT / DRAG_SNAP_BEATS) * DRAG_SNAP_BEATS,
      ),
    );
    if (!loopEnabled) {
      getStore().patchProject({ loopEnabled: true });
    }
    if (e.shiftKey) {
      getStore().setLoopRegion(beat, Math.max(beat + DRAG_SNAP_BEATS, loopEndBeat));
    } else {
      getStore().setLoopRegion(Math.min(loopStartBeat, beat - DRAG_SNAP_BEATS), beat);
    }
  };

  return (
    <div
      className="absolute inset-0 z-0"
      onMouseDown={onRulerMouseDown}
      data-testid="ruler-click-area"
      title="Click to set loop end, Shift-click to set loop start"
    >
      {loopEnabled && (
        <>
          <div
            className="absolute top-0 bottom-0 bg-neon/15 border-l border-r border-neon/60"
            style={{
              left: loopStartBeat * PX_PER_BEAT,
              width: (loopEndBeat - loopStartBeat) * PX_PER_BEAT,
            }}
          />
          <div
            data-loop-handle="start"
            data-testid="loop-handle-start"
            onMouseDown={beginDrag("start")}
            role="separator"
            aria-label="Loop start handle"
            className="absolute top-0 bottom-0 w-2 -ml-1 cursor-ew-resize bg-neon/80 hover:bg-neon"
            style={{ left: loopStartBeat * PX_PER_BEAT }}
          />
          <div
            data-loop-handle="end"
            data-testid="loop-handle-end"
            onMouseDown={beginDrag("end")}
            role="separator"
            aria-label="Loop end handle"
            className="absolute top-0 bottom-0 w-2 -ml-1 cursor-ew-resize bg-neon/80 hover:bg-neon"
            style={{ left: loopEndBeat * PX_PER_BEAT }}
          />
          <div
            data-loop-handle="move"
            onMouseDown={beginDrag("move")}
            aria-label="Move loop region"
            className="absolute top-0 bottom-0 cursor-grab active:cursor-grabbing"
            style={{
              left: loopStartBeat * PX_PER_BEAT + 4,
              width: Math.max(
                0,
                (loopEndBeat - loopStartBeat) * PX_PER_BEAT - 8,
              ),
            }}
          />
        </>
      )}
    </div>
  );
}

/**
 * Thin strip rendered below the ruler. It shows the current export range
 * as an amber region and lets the user drag to set a custom export range.
 * Dragging anywhere on the strip switches the export dialog to "custom" mode.
 */
function ExportRegionStrip({
  bars,
  totalBeats,
  exportRangeMode,
  exportStartBar,
  exportEndBar,
}: {
  bars: number;
  totalBeats: number;
  exportRangeMode: "whole" | "loop" | "custom";
  exportStartBar: number;
  exportEndBar: number;
}) {
  const width = totalBeats * PX_PER_BEAT;
  const isCustom = exportRangeMode === "custom";

  const startBeat = (exportStartBar - 1) * 4;
  const endBeat = exportEndBar * 4;

  const beginHandleDrag = (mode: "start" | "end" | "move") => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const origStartBeat = startBeat;
    const origEndBeat = endBeat;
    const snapToBar = (b: number) =>
      Math.max(0, Math.min(totalBeats, Math.round(b / 4) * 4));
    const onMove = (ev: MouseEvent) => {
      const dxBeats = (ev.clientX - startX) / PX_PER_BEAT;
      if (mode === "start") {
        const newS = snapToBar(origStartBeat + dxBeats);
        const newStartBar = Math.floor(newS / 4) + 1;
        const newEndBar = Math.ceil(origEndBeat / 4);
        if (newStartBar < newEndBar) getStore().setExportRange(newStartBar, newEndBar);
      } else if (mode === "end") {
        const newE = snapToBar(origEndBeat + dxBeats);
        const newStartBar = Math.floor(origStartBeat / 4) + 1;
        const newEndBar = Math.ceil(newE / 4);
        if (newEndBar > newStartBar) getStore().setExportRange(newStartBar, newEndBar);
      } else {
        const rangeBeats = origEndBeat - origStartBeat;
        let newS = snapToBar(origStartBeat + dxBeats);
        newS = Math.max(0, Math.min(totalBeats - rangeBeats, newS));
        const newStartBar = Math.floor(newS / 4) + 1;
        const newEndBar = Math.ceil((newS + rangeBeats) / 4);
        getStore().setExportRange(newStartBar, newEndBar);
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Drag on empty strip area to draw a new export region
  const onStripMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-export-handle]")) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const startPx = e.clientX - rect.left;
    const startBeatRaw = Math.max(0, Math.min(totalBeats, Math.round(startPx / PX_PER_BEAT / 4) * 4));
    const anchorBar = Math.floor(startBeatRaw / 4) + 1;
    getStore().setExportRange(anchorBar, Math.min(bars, anchorBar + 1));

    const onMove = (ev: MouseEvent) => {
      const px = ev.clientX - rect.left;
      const beat = Math.max(0, Math.min(totalBeats, Math.round(px / PX_PER_BEAT / 4) * 4));
      const barAt = Math.ceil(beat / 4);
      if (barAt > anchorBar) {
        getStore().setExportRange(anchorBar, barAt);
      } else if (barAt < anchorBar) {
        getStore().setExportRange(Math.max(1, barAt), anchorBar);
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className="h-5 sticky top-14 z-[9] bg-graphite/90 border-b border-border/50 relative cursor-crosshair select-none"
      style={{ width }}
      onMouseDown={onStripMouseDown}
      data-testid="export-region-strip"
      title="Drag to set export range · handles to adjust · opens Export dialog on click"
    >
      {/* label */}
      <div className="absolute left-1 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
        <Download className="w-2.5 h-2.5 text-muted-foreground/60" />
        <span className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground/60">
          Export
        </span>
      </div>

      {/* export region fill + handles */}
      {isCustom && (
        <>
          {/* filled region */}
          <div
            className="absolute top-0 bottom-0 bg-amber-500/25 border-l-2 border-r-2 border-amber-500/70"
            style={{
              left: startBeat * PX_PER_BEAT,
              width: Math.max(0, (endBeat - startBeat) * PX_PER_BEAT),
            }}
          >
            {/* centre label */}
            <span className="absolute inset-0 flex items-center justify-center font-mono text-[8px] uppercase tracking-widest text-amber-400/80 pointer-events-none select-none overflow-hidden whitespace-nowrap">
              {exportEndBar - exportStartBar + 1 > 0
                ? `${exportStartBar}–${exportEndBar}`
                : ""}
            </span>
          </div>

          {/* start handle */}
          <div
            data-export-handle="start"
            onMouseDown={beginHandleDrag("start")}
            aria-label="Export region start handle"
            className="absolute top-0 bottom-0 w-2.5 -ml-1 cursor-ew-resize bg-amber-500/70 hover:bg-amber-400 z-10"
            style={{ left: startBeat * PX_PER_BEAT }}
          />

          {/* end handle */}
          <div
            data-export-handle="end"
            onMouseDown={beginHandleDrag("end")}
            aria-label="Export region end handle"
            className="absolute top-0 bottom-0 w-2.5 -ml-1 cursor-ew-resize bg-amber-500/70 hover:bg-amber-400 z-10"
            style={{ left: endBeat * PX_PER_BEAT }}
          />

          {/* body move handle */}
          <div
            data-export-handle="move"
            onMouseDown={beginHandleDrag("move")}
            aria-label="Move export region"
            className="absolute top-0 bottom-0 cursor-grab active:cursor-grabbing z-[9]"
            style={{
              left: startBeat * PX_PER_BEAT + 6,
              width: Math.max(0, (endBeat - startBeat) * PX_PER_BEAT - 12),
            }}
          />
        </>
      )}
    </div>
  );
}

/** Strip rendered above the timeline ruler. Click empty space to drop a
 *  section flag (Verse by default); existing flags are draggable and have
 *  a context menu for rename / change label / color / delete. */
function SectionsStrip({
  sections,
  bars,
}: {
  sections: Section[];
  bars: number;
}) {
  const width = bars * 4 * PX_PER_BEAT;
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-section-flag]")) return;
    if ((e.target as HTMLElement).closest("[data-section-add]")) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const bar = Math.max(0, Math.min(bars, Math.round(px / (4 * PX_PER_BEAT))));
    getStore().addSection(bar, "Verse");
  };
  return (
    <div
      className="h-7 sticky top-0 z-20 bg-graphite/95 border-b border-border/70 relative cursor-copy"
      style={{ width }}
      onMouseDown={onMouseDown}
      data-testid="sections-strip"
      title="Click to drop a Verse marker. Right-click a flag to rename/color/delete."
    >
      <div className="absolute left-1 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
        <Flag className="w-3 h-3 text-muted-foreground" />
        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
          Sections
        </span>
      </div>
      <SectionAddMenu bars={bars} />
      {sections.map((s) => (
        <SectionFlag key={s.id} section={s} bars={bars} />
      ))}
    </div>
  );
}

function SectionAddMenu({ bars }: { bars: number }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          data-section-add
          data-testid="add-section-button"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-5 px-1.5 rounded-sm border border-border/70 bg-background/60 hover:bg-background text-foreground/80 hover:text-foreground flex items-center gap-1"
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Add section marker"
          title="Add section marker"
        >
          <Plus className="w-3 h-3" />
          <span className="font-mono text-[9px] uppercase tracking-wide">add</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SECTION_LABELS.map((label) => (
          <DropdownMenuItem
            key={label}
            onSelect={() => getStore().addSection(bars, label)}
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm mr-2"
              style={{ background: SECTION_PALETTE[label] }}
            />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SectionFlag({ section, bars }: { section: Section; bars: number }) {
  const left = section.bar * 4 * PX_PER_BEAT;
  const color = sectionColor(section);
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-section-action]")) return;
    e.stopPropagation();
    const startX = e.clientX;
    const startBar = section.bar;
    const onMove = (ev: MouseEvent) => {
      const dxBars = (ev.clientX - startX) / (4 * PX_PER_BEAT);
      const next = Math.max(0, Math.min(bars, Math.round(startBar + dxBars)));
      if (next !== section.bar) getStore().moveSection(section.id, next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-section-flag
          data-testid={`section-flag-${section.label}`}
          onMouseDown={onMouseDown}
          className="absolute top-0.5 bottom-0.5 px-1.5 rounded-sm flex items-center gap-1 cursor-grab active:cursor-grabbing"
          style={{
            left,
            background: `${color}33`,
            border: `1px solid ${color}`,
            color,
          }}
          title={`${section.label} @ bar ${section.bar + 1}`}
        >
          <Flag className="w-2.5 h-2.5" />
          <span className="font-mono text-[10px] uppercase tracking-wide">
            {section.label}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onSelect={() => {
            const next = promptRename(section.label, "section");
            if (next !== null && next.trim())
              getStore().renameSection(section.id, next.trim());
          }}
        >
          Rename…
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Change label</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {SECTION_LABELS.map((label) => (
              <ContextMenuItem
                key={label}
                onSelect={() => getStore().renameSection(section.id, label)}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm mr-2"
                  style={{ background: SECTION_PALETTE[label] }}
                />
                {label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => getStore().removeSection(section.id)}
        >
          Delete section
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// Memoized so unrelated store changes (transport flags, selection on
// other rows, etc.) don't re-render every track row in the timeline.
// Track reference identity is preserved by patchTrack — rows that
// didn't change skip re-render entirely.
const TimelineRow = memo(function TimelineRow({
  track,
  selected,
  selectedClipId,
  totalBeats,
}: {
  track: Track;
  selected: boolean;
  selectedClipId: string | null;
  totalBeats: number;
}) {
  const dropTargetTrackId = useStore((s) => s.dropTargetTrackId);
  const isDropTarget = dropTargetTrackId === track.id;
  const lanes = track.automationLanes ?? [];
  const hasLanes = lanes.length > 0;

  return (
    <div
      className="border-b border-border/60"
      style={{ width: totalBeats * PX_PER_BEAT }}
    >
      {/* Main clip row */}
      <div
        data-track-row="true"
        data-track-id={track.id}
        data-track-kind={track.kind}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            getStore().set({ selectedTrackId: track.id });
            getStore().selectClip(null);
          }
        }}
        className={`relative h-16 cursor-pointer ${
          selected ? "bg-primary/5" : ""
        } ${
          isDropTarget ? "bg-neon/15 ring-1 ring-inset ring-neon/70" : ""
        } grid-bg`}
      >
        {track.noteClips.map((c) => (
          <NoteClipView
            key={c.id}
            track={track}
            clip={c}
            isSelected={selectedClipId === c.id}
          />
        ))}
        {track.audioClips.map((c) => (
          <AudioClipView
            key={c.id}
            track={track}
            clip={c}
            isSelected={selectedClipId === c.id}
          />
        ))}
        {track.kind === "vocals" &&
          track.audioClips.length === 0 &&
          track.noteClips.length === 0 && (
            <VocalPlaceholder armed={track.armed} totalBeats={totalBeats} />
          )}
        {/* Automation badge */}
        {hasLanes && (
          <div className="absolute bottom-1 left-1 px-1 rounded-sm bg-neon/20 border border-neon/40 font-mono text-[8px] text-neon pointer-events-none">
            A
          </div>
        )}
      </div>
      {/* Automation lanes */}
      {lanes.map((lane) => (
        <AutomationLaneStrip
          key={lane.id}
          track={track}
          lane={lane}
          totalBeats={totalBeats}
        />
      ))}
      <AddAutomationLaneRow track={track} />
    </div>
  );
});

function VocalPlaceholder({
  armed,
  totalBeats,
}: {
  armed: boolean;
  totalBeats: number;
}) {
  return (
    <div
      className="absolute top-1.5 bottom-1.5 left-1 rounded-sm border border-dashed border-neon/50 bg-neon/5 flex items-center justify-center pointer-events-none"
      style={{ width: Math.max(120, totalBeats * PX_PER_BEAT - 8) }}
    >
      <span className="font-mono text-[10px] text-neon/80 tracking-wide px-2">
        {armed
          ? "Press ● record to capture vocals here"
          : "Arm this track (R on the channel) and record your vocals here"}
      </span>
    </div>
  );
}

/**
 * Shared drag-to-move behavior for clips on the timeline. Returns the
 * mouseDown handler and the live drag offset (in beats) used to shift the
 * visual position while the user is dragging.
 */
function useClipDrag({
  trackId,
  clipId,
  startBeat,
  clipKind,
}: {
  trackId: string;
  clipId: string;
  startBeat: number;
  clipKind: "note" | "audio";
}) {
  const [dragDelta, setDragDelta] = useState(0);
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // ignore drags that originate on the close button etc.
    if ((e.target as HTMLElement).closest("[data-clip-action]")) return;
    e.stopPropagation();
    e.preventDefault();
    getStore().set({ selectedTrackId: trackId });
    getStore().selectClip(clipId);
    const startX = e.clientX;
    let lastDelta = 0;
    let lastDestTrackId: string | null = null;
    const onMove = (ev: MouseEvent) => {
      const dxPx = ev.clientX - startX;
      const dxBeats = dxPx / PX_PER_BEAT;
      const snapped =
        Math.round(dxBeats / DRAG_SNAP_BEATS) * DRAG_SNAP_BEATS;
      // prevent dragging before beat 0
      const clamped = Math.max(-startBeat, snapped);
      lastDelta = clamped;
      setDragDelta(clamped);

      // figure out which track row the cursor is over for vertical drops
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const row = el?.closest("[data-track-row]") as HTMLElement | null;
      const destId = row?.getAttribute("data-track-id") ?? null;
      const destKind = row?.getAttribute("data-track-kind") as
        | Track["kind"]
        | null;
      let nextDest: string | null = null;
      if (destId && destId !== trackId && destKind) {
        if (canDropClipOnTrack(clipKind, destKind)) {
          nextDest = destId;
        }
      }
      if (nextDest !== lastDestTrackId) {
        lastDestTrackId = nextDest;
        getStore().set({ dropTargetTrackId: nextDest });
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const dest = lastDestTrackId;
      if (dest) {
        getStore().moveClip(trackId, clipId, startBeat + lastDelta, dest);
      } else if (lastDelta !== 0) {
        getStore().moveClip(trackId, clipId, startBeat + lastDelta);
      }
      if (getStore().state.dropTargetTrackId !== null) {
        getStore().set({ dropTargetTrackId: null });
      }
      setDragDelta(0);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  return { onMouseDown, dragDelta };
}

/**
 * Drag-to-resize behavior for a clip's left or right edge. The component
 * applies the live `delta` (in beats) to its rendered width/left so the
 * preview snaps with the mouse, and commits to the store on mouseup.
 */
function useClipResize({
  trackId,
  clipId,
  edge,
  startBeat,
  lengthBeats,
}: {
  trackId: string;
  clipId: string;
  edge: "left" | "right";
  startBeat: number;
  lengthBeats: number;
}) {
  const [delta, setDelta] = useState(0);
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    getStore().set({ selectedTrackId: trackId });
    getStore().selectClip(clipId);
    const startX = e.clientX;
    let lastDelta = 0;
    const onMove = (ev: MouseEvent) => {
      const dxPx = ev.clientX - startX;
      const dxBeats = dxPx / PX_PER_BEAT;
      let snapped =
        Math.round(dxBeats / DRAG_SNAP_BEATS) * DRAG_SNAP_BEATS;
      if (edge === "left") {
        // shift can't push start below 0 and can't shrink length to <= 0
        snapped = Math.max(
          -startBeat,
          Math.min(lengthBeats - DRAG_SNAP_BEATS, snapped),
        );
      } else {
        // right edge: length stays >= one snap unit
        snapped = Math.max(DRAG_SNAP_BEATS - lengthBeats, snapped);
      }
      lastDelta = snapped;
      setDelta(snapped);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (lastDelta !== 0) {
        getStore().resizeClip(trackId, clipId, edge, lastDelta);
      }
      setDelta(0);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
  return { onMouseDown, delta };
}

function ClipResizeHandle({
  edge,
  onMouseDown,
}: {
  edge: "left" | "right";
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      data-clip-action
      data-resize-edge={edge}
      onMouseDown={onMouseDown}
      role="separator"
      aria-label={edge === "left" ? "Resize clip start" : "Resize clip end"}
      title={edge === "left" ? "Drag to trim start" : "Drag to trim end"}
      className={`absolute top-0 bottom-0 w-1.5 z-20 cursor-ew-resize bg-foreground/0 hover:bg-foreground/30 ${
        edge === "left" ? "left-0" : "right-0"
      }`}
    />
  );
}

function ClipDeleteButton({
  trackId,
  clipId,
}: {
  trackId: string;
  clipId: string;
}) {
  return (
    <button
      data-clip-action
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        getStore().removeClip(trackId, clipId);
      }}
      className="absolute top-0.5 right-0.5 z-10 w-4 h-4 rounded-sm bg-background/70 hover:bg-primary/70 text-foreground/80 hover:text-foreground flex items-center justify-center"
      aria-label="Delete clip"
      title="Delete clip"
    >
      <X className="w-2.5 h-2.5" />
    </button>
  );
}

/** Reusable list of actions for a clip — duplicate / rename / color / delete.
 *  Rendered inside both the right-click ContextMenu and the ⋯ DropdownMenu so
 *  pointer and keyboard users have the same affordances. */
function ClipActionItems({
  trackId,
  clipId,
  clipName,
  Item,
  Sub,
  SubTrigger,
  SubContent,
  Separator,
}: {
  trackId: string;
  clipId: string;
  clipName: string | undefined;
  Item: typeof ContextMenuItem | typeof DropdownMenuItem;
  Sub: typeof ContextMenuSub | typeof DropdownMenuSub;
  SubTrigger: typeof ContextMenuSubTrigger | typeof DropdownMenuSubTrigger;
  SubContent: typeof ContextMenuSubContent | typeof DropdownMenuSubContent;
  Separator: typeof ContextMenuSeparator | typeof DropdownMenuSeparator;
}) {
  return (
    <>
      <Item onSelect={() => getStore().duplicateClipById(trackId, clipId)}>
        Duplicate
      </Item>
      <Item
        onSelect={() => {
          const next = promptRename(clipName, "clip");
          if (next !== null) getStore().renameClip(trackId, clipId, next);
        }}
      >
        Rename…
      </Item>
      <Sub>
        <SubTrigger>Color</SubTrigger>
        <SubContent>
          {CLIP_COLORS.map((c) => (
            <Item
              key={c.value}
              onSelect={() =>
                getStore().setClipColor(trackId, clipId, c.value)
              }
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm mr-2"
                style={{ background: c.value }}
              />
              {c.name}
            </Item>
          ))}
          <Separator />
          <Item
            onSelect={() => getStore().setClipColor(trackId, clipId, null)}
          >
            Default
          </Item>
        </SubContent>
      </Sub>
      <Separator />
      <Item onSelect={() => getStore().removeClip(trackId, clipId)}>
        Delete
      </Item>
    </>
  );
}

function ClipMenuButton({
  trackId,
  clipId,
  clipName,
}: {
  trackId: string;
  clipId: string;
  clipName: string | undefined;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          data-clip-action
          data-testid="clip-menu-button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-0.5 right-5 z-10 w-4 h-4 rounded-sm bg-background/70 hover:bg-foreground/30 text-foreground/80 hover:text-foreground flex items-center justify-center"
          aria-label="Clip actions"
          title="Clip actions"
        >
          <MoreVertical className="w-2.5 h-2.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ClipActionItems
          trackId={trackId}
          clipId={clipId}
          clipName={clipName}
          Item={DropdownMenuItem}
          Sub={DropdownMenuSub}
          SubTrigger={DropdownMenuSubTrigger}
          SubContent={DropdownMenuSubContent}
          Separator={DropdownMenuSeparator}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NoteClipView({
  track,
  clip,
  isSelected,
}: {
  track: Track;
  clip: {
    id: string;
    start: number;
    length: number;
    notes: Array<{ time: number; note: string; duration: number; velocity: number }>;
    name?: string;
    color?: string;
  };
  isSelected: boolean;
}) {
  const { onMouseDown, dragDelta } = useClipDrag({
    trackId: track.id,
    clipId: clip.id,
    startBeat: clip.start,
    clipKind: "note",
  });
  const leftResize = useClipResize({
    trackId: track.id,
    clipId: clip.id,
    edge: "left",
    startBeat: clip.start,
    lengthBeats: clip.length,
  });
  const rightResize = useClipResize({
    trackId: track.id,
    clipId: clip.id,
    edge: "right",
    startBeat: clip.start,
    lengthBeats: clip.length,
  });
  const previewStart = clip.start + dragDelta + leftResize.delta;
  const previewLength = clip.length - leftResize.delta + rightResize.delta;
  const left = previewStart * PX_PER_BEAT;
  const width = Math.max(20, previewLength * PX_PER_BEAT);
  const isDrums = track.kind === "drums";
  const tint = clip.color;
  const containerStyle: React.CSSProperties = tint
    ? {
        left,
        width,
        background: `${tint}26`,
        borderColor: isSelected ? tint : `${tint}99`,
        boxShadow: isSelected ? `0 0 0 1px ${tint}` : undefined,
      }
    : { left, width };
  const headerStyle: React.CSSProperties = tint
    ? { background: `${tint}33`, color: tint }
    : {};
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onMouseDown={onMouseDown}
          data-testid="note-clip"
          className={`absolute top-1.5 bottom-1.5 rounded-sm border overflow-hidden cursor-grab active:cursor-grabbing ${
            tint
              ? ""
              : `bg-primary/15 ${
                  isSelected
                    ? "border-primary ring-1 ring-primary/70 glow-red"
                    : "border-primary/60 hover:border-primary"
                }`
          }`}
          style={containerStyle}
        >
          <div
            className={`px-1.5 py-0.5 text-[10px] font-mono pr-10 truncate ${
              tint ? "" : "text-primary/90 bg-primary/20"
            }`}
            style={headerStyle}
          >
            {clip.name ?? `${track.name} clip`}
          </div>
          <ClipMenuButton
            trackId={track.id}
            clipId={clip.id}
            clipName={clip.name}
          />
          <ClipDeleteButton trackId={track.id} clipId={clip.id} />
          <ClipResizeHandle edge="left" onMouseDown={leftResize.onMouseDown} />
          <ClipResizeHandle edge="right" onMouseDown={rightResize.onMouseDown} />
          <div className="absolute inset-x-0 top-4 bottom-0 pointer-events-none">
            {clip.notes.map((n, i) => {
          const x = (n.time / clip.length) * 100;
          const w = Math.max(1, (n.duration / clip.length) * 100);
          let y = 50;
          if (isDrums) {
            const order = ["kick", "tomLow", "snare", "clap", "tomHigh", "hat", "ohat", "crash"];
            const idx = order.indexOf(n.note);
            y = idx >= 0 ? 10 + idx * 10 : 50;
          } else {
            const m = /([A-G]#?)(\d)/.exec(n.note);
            if (m) {
              const semis = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"].indexOf(m[1]);
              const oct = parseInt(m[2], 10);
              const total = oct * 12 + semis;
              y = 90 - ((total - 24) * 1.5);
              y = Math.max(5, Math.min(90, y));
            }
          }
          return (
            <div
              key={i}
              className="absolute h-1 bg-primary rounded-sm"
              style={{ left: `${x}%`, width: `${w}%`, top: `${y}%`, opacity: 0.4 + n.velocity * 0.6 }}
            />
          );
        })}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ClipActionItems
          trackId={track.id}
          clipId={clip.id}
          clipName={clip.name}
          Item={ContextMenuItem}
          Sub={ContextMenuSub}
          SubTrigger={ContextMenuSubTrigger}
          SubContent={ContextMenuSubContent}
          Separator={ContextMenuSeparator}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function AudioClipView({
  track,
  clip,
  isSelected,
}: {
  track: Track;
  clip: {
    id: string;
    start: number;
    durationSec: number;
    offsetSec?: number;
    blob?: Blob;
    blobKey?: string;
    name?: string;
    color?: string;
  };
  isSelected: boolean;
}) {
  // A clip that references a blob by key but didn't hydrate one is a
  // "missing sample" — surface visually so the user knows the audio is
  // gone (and offer a re-import in the sample browser).
  const isMissing = !!clip.blobKey && !clip.blob;
  const bpm = useStore((s) => s.project.bpm);
  const beatsPerSecond = bpm / 60;
  const lengthBeats = clip.durationSec * beatsPerSecond;
  const { onMouseDown, dragDelta } = useClipDrag({
    trackId: track.id,
    clipId: clip.id,
    startBeat: clip.start,
    clipKind: "audio",
  });
  const leftResize = useClipResize({
    trackId: track.id,
    clipId: clip.id,
    edge: "left",
    startBeat: clip.start,
    lengthBeats,
  });
  const rightResize = useClipResize({
    trackId: track.id,
    clipId: clip.id,
    edge: "right",
    startBeat: clip.start,
    lengthBeats,
  });
  const previewStart = clip.start + dragDelta + leftResize.delta;
  const previewLengthBeats =
    lengthBeats - leftResize.delta + rightResize.delta;
  const left = previewStart * PX_PER_BEAT;
  const width = Math.max(20, previewLengthBeats * PX_PER_BEAT);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const offsetSec = clip.offsetSec ?? 0;
  const durationSec = clip.durationSec;
  const canvasWidth = Math.max(50, Math.floor(width));

  useEffect(() => {
    if (!clip.blob || !canvasRef.current) return;
    const cv = canvasRef.current;
    let cancelled = false;
    (async () => {
      try {
        const peaks = await getWaveformPeaks(clip.blob!);
        if (cancelled) return;
        drawWaveformPeaks(cv, peaks, { offsetSec, durationSec });
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clip.blob, offsetSec, durationSec, canvasWidth]);

  const tint = isMissing ? "#f59e0b" : clip.color;
  const containerStyle: React.CSSProperties = tint
    ? {
        left,
        width,
        background: `${tint}26`,
        borderColor: isSelected ? tint : `${tint}99`,
        boxShadow: isSelected ? `0 0 0 1px ${tint}` : undefined,
      }
    : { left, width };
  const headerStyle: React.CSSProperties = tint
    ? { background: `${tint}33`, color: tint }
    : {};
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onMouseDown={onMouseDown}
          data-testid="audio-clip"
          data-missing={isMissing ? "true" : undefined}
          title={
            isMissing
              ? "Audio data missing — re-import this clip from the Samples browser."
              : undefined
          }
          className={`absolute top-1.5 bottom-1.5 rounded-sm border overflow-hidden cursor-grab active:cursor-grabbing ${
            tint
              ? ""
              : `bg-neon/10 ${
                  isSelected
                    ? "border-neon ring-1 ring-neon/70"
                    : "border-neon/60 hover:border-neon"
                }`
          }`}
          style={containerStyle}
        >
          <div
            className={`px-1.5 py-0.5 text-[10px] font-mono pr-10 truncate ${
              tint ? "" : "text-neon bg-neon/15"
            }`}
            style={headerStyle}
          >
            {clip.name ?? `${track.name} take · ${clip.durationSec.toFixed(1)}s`}
          </div>
          <ClipMenuButton
            trackId={track.id}
            clipId={clip.id}
            clipName={clip.name}
          />
          <ClipDeleteButton trackId={track.id} clipId={clip.id} />
          {/* Reverse toggle */}
          <button
            type="button"
            className={`absolute top-0.5 right-12 w-5 h-4 text-[8px] font-mono rounded flex items-center justify-center border ${
              (clip as import("../types").AudioClip).reversed
                ? "bg-neon/30 border-neon/60 text-neon"
                : "bg-background/40 border-border/40 text-muted-foreground hover:text-foreground"
            }`}
            title="Reverse clip playback"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              getStore().toggleAudioClipReverse(track.id, clip.id);
            }}
          >
            ⇄
          </button>
          <ClipResizeHandle edge="left" onMouseDown={leftResize.onMouseDown} />
          <ClipResizeHandle edge="right" onMouseDown={rightResize.onMouseDown} />
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={42}
            className="block w-full h-[42px] pointer-events-none"
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ClipActionItems
          trackId={track.id}
          clipId={clip.id}
          clipName={clip.name}
          Item={ContextMenuItem}
          Sub={ContextMenuSub}
          SubTrigger={ContextMenuSubTrigger}
          SubContent={ContextMenuSubContent}
          Separator={ContextMenuSeparator}
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
