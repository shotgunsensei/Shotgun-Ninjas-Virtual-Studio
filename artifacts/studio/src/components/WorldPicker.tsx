import { useState, useCallback } from "react";
import { Globe, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { WORLDS, type WorldId, getWorldPrefs, resetWorldPrefs } from "../lib/worlds";
import { useWorld } from "../contexts/WorldContext";
import { Tip } from "./Tip";
import { useStore } from "../store";
import { loadDemo } from "../lib/demos";

/**
 * Globe button that opens the World Picker modal from the transport bar.
 */
export function WorldPickerButton() {
  const [open, setOpen] = useState(false);
  const { activeWorld } = useWorld();

  return (
    <>
      <Tip label={`Studio World: ${activeWorld.name} — click to change`}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 h-8 px-2 rounded-md border border-border text-muted-foreground hover:border-primary/40 hover:text-foreground font-mono text-[10px] transition-colors"
          aria-label="Open Studio World picker"
        >
          <Globe className="w-3.5 h-3.5" />
          <span className="hidden sm:inline truncate max-w-[80px]">
            {activeWorld.name}
          </span>
        </button>
      </Tip>
      <WorldPickerModal open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * Full-screen modal showing a 2×3 grid of world cards.
 */
export function WorldPickerModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { activeWorld, setWorld, ambientEnabled, setAmbientEnabled } = useWorld();
  const [hovered, setHovered] = useState<WorldId | null>(null);
  const [resetTick, setResetTick] = useState(0);
  const isTransient = useStore((s) => s.isTransientProject);

  const handleSelect = (id: WorldId) => {
    setWorld(id);
    onOpenChange(false);
  };

  const handleLoadDemo = (e: React.MouseEvent, demoId: string) => {
    e.stopPropagation();
    loadDemo(demoId);
    onOpenChange(false);
  };

  const handleResetPrefs = useCallback((e: React.MouseEvent, worldId: WorldId) => {
    e.stopPropagation();
    resetWorldPrefs(worldId);
    setResetTick((t) => t + 1);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            Studio Worlds
            {/* Ambient audio toggle */}
            <Tip
              label={
                ambientEnabled
                  ? "Ambient audio on — click to mute"
                  : "Ambient audio off — click to enable"
              }
            >
              <button
                type="button"
                onClick={() => setAmbientEnabled(!ambientEnabled)}
                className={`ml-auto flex items-center gap-1 h-6 px-2 rounded border font-mono text-[9px] uppercase tracking-widest transition-colors ${
                  ambientEnabled
                    ? "border-primary/50 text-primary bg-primary/10 hover:bg-primary/20"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
                aria-label={ambientEnabled ? "Mute ambient audio" : "Enable ambient audio"}
                aria-pressed={ambientEnabled}
              >
                {ambientEnabled ? (
                  <Volume2 className="w-3 h-3" />
                ) : (
                  <VolumeX className="w-3 h-3" />
                )}
                <span>Ambient</span>
              </button>
            </Tip>
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Each world transforms the atmosphere — visuals, accent colors, and
            a welcome sound. Your project is never affected.
          </p>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
          {WORLDS.map((world) => {
            const isActive = world.id === activeWorld.id;
            const isHovered = world.id === hovered;
            // resetTick dependency forces re-read when prefs are cleared
            const hasSavedPrefs = resetTick >= 0 && !!getWorldPrefs(world.id as WorldId);
            return (
              <button
                key={world.id}
                type="button"
                onClick={() => handleSelect(world.id as WorldId)}
                onMouseEnter={() => setHovered(world.id as WorldId)}
                onMouseLeave={() => setHovered(null)}
                className={`relative text-left rounded-lg border p-3 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? "border-primary bg-primary/10 shadow-[0_0_12px_hsl(var(--primary)/0.3)]"
                    : "border-border hover:border-primary/40 hover:bg-accent/30"
                }`}
                aria-pressed={isActive}
                aria-label={`Select ${world.name} world`}
              >
                {/* Active badge */}
                {isActive && (
                  <span className="absolute top-2 right-2 font-mono text-[9px] uppercase tracking-widest text-primary bg-primary/15 border border-primary/40 rounded px-1.5 py-0.5">
                    Active
                  </span>
                )}

                {/* Ambient speaker icon — top-left, always visible */}
                <span
                  className={`absolute top-2 left-2 transition-opacity ${
                    isActive && ambientEnabled
                      ? "opacity-100 text-primary"
                      : "opacity-20 text-muted-foreground"
                  }`}
                  aria-label={
                    isActive && ambientEnabled
                      ? "Ambient audio playing"
                      : ambientEnabled
                        ? "Ambient audio available"
                        : "Ambient audio muted"
                  }
                  title={
                    isActive && ambientEnabled
                      ? "Ambient audio playing"
                      : ambientEnabled
                        ? "Ambient audio available"
                        : "Ambient audio muted"
                  }
                >
                  {ambientEnabled ? (
                    <Volume2 className="w-2.5 h-2.5" />
                  ) : (
                    <VolumeX className="w-2.5 h-2.5" />
                  )}
                </span>

                {/* Color swatch strip */}
                <div className="flex gap-1 mb-2.5 mt-3">
                  {world.swatchColors.map((color, i) => (
                    <div
                      key={i}
                      className="h-2 rounded-sm flex-1"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>

                {/* Mini background preview */}
                <div
                  className={`w-full h-14 rounded-md mb-2.5 overflow-hidden relative transition-opacity duration-200 ${
                    isHovered || isActive ? "opacity-100" : "opacity-60"
                  }`}
                  style={{ background: `hsl(${world.vars["--background"]})` }}
                >
                  <WorldMiniPreview
                    variant={world.visualizerVariant}
                    colors={world.swatchColors}
                  />
                </div>

                {/* Info */}
                <div className="font-mono text-xs font-semibold uppercase tracking-wider mb-0.5">
                  {world.name}
                </div>
                <div className="font-mono text-[10px] text-primary mb-1.5">
                  {world.tagline}
                </div>
                <div className="text-[10px] text-muted-foreground leading-snug line-clamp-2">
                  {world.lore}
                </div>

                {/* Bottom actions row */}
                {(isTransient || hasSavedPrefs) && (
                  <div
                    className="mt-2 pt-2 border-t border-border/50 flex gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isTransient && (
                      <button
                        type="button"
                        onClick={(e) => handleLoadDemo(e, world.demoId)}
                        className="flex items-center gap-1 flex-1 justify-center h-6 rounded border border-border/70 text-muted-foreground hover:border-primary/50 hover:text-primary font-mono text-[9px] uppercase tracking-widest transition-colors"
                      >
                        <Play className="w-2.5 h-2.5" />
                        Load demo
                      </button>
                    )}
                    {hasSavedPrefs && (
                      <Tip label="Clear saved kit & BPM for this world">
                        <button
                          type="button"
                          onClick={(e) => handleResetPrefs(e, world.id as WorldId)}
                          className="flex items-center gap-1 flex-1 justify-center h-6 rounded border border-border/70 text-muted-foreground hover:border-destructive/50 hover:text-destructive font-mono text-[9px] uppercase tracking-widest transition-colors"
                          aria-label={`Reset saved kit and BPM for ${world.name}`}
                        >
                          <RotateCcw className="w-2.5 h-2.5" />
                          Reset defaults
                        </button>
                      </Tip>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer note about ambient volume */}
        <p className="text-[10px] text-muted-foreground text-center mt-3 font-mono opacity-60">
          Ambient loops play at 10% volume and never interfere with your session audio.
        </p>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Tiny inline preview of each world's visualizer variant.
 * Pure CSS/SVG — no canvas, no heavy computation.
 */
function WorldMiniPreview({
  variant,
  colors,
}: {
  variant: string;
  colors: string[];
}) {
  const accent = colors[1] ?? "#fff";
  const secondary = colors[2] ?? accent;

  if (variant === "shuriken") {
    return (
      <div className="absolute inset-0 flex items-center justify-center opacity-30">
        <svg viewBox="0 0 100 100" className="w-10 h-10" fill={accent}>
          <path d="M50 5 L58 42 L95 50 L58 58 L50 95 L42 58 L5 50 L42 42 Z" />
          <circle cx="50" cy="50" r="4" fill="rgba(0,0,0,0.5)" />
        </svg>
      </div>
    );
  }

  if (variant === "sparks") {
    return (
      <div className="absolute inset-0 overflow-hidden">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="absolute w-0.5 rounded-full world-spark-preview"
            style={{
              left: `${15 + i * 14}%`,
              bottom: "10%",
              height: `${8 + (i % 3) * 6}px`,
              backgroundColor: i % 2 === 0 ? accent : secondary,
              opacity: 0.7,
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </div>
    );
  }

  if (variant === "rain") {
    return (
      <div className="absolute inset-0 overflow-hidden">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${8 + i * 13}%`,
              top: `${(i * 17) % 70}%`,
              width: "1px",
              height: `${10 + (i % 3) * 4}px`,
              backgroundColor: i % 2 === 0 ? accent : secondary,
              opacity: 0.5,
              transform: "rotate(-10deg)",
            }}
          />
        ))}
      </div>
    );
  }

  if (variant === "smoke") {
    return (
      <div className="absolute inset-0 flex items-center justify-around overflow-hidden">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-full blur-sm"
            style={{
              width: `${30 + i * 12}px`,
              height: `${30 + i * 12}px`,
              backgroundColor: accent,
              opacity: 0.1 + i * 0.04,
            }}
          />
        ))}
      </div>
    );
  }

  if (variant === "circuit") {
    return (
      <svg
        viewBox="0 0 100 56"
        className="absolute inset-0 w-full h-full opacity-30"
        fill="none"
        stroke={accent}
        strokeWidth="1"
      >
        <line x1="0" y1="28" x2="100" y2="28" />
        <line x1="20" y1="0" x2="20" y2="56" />
        <line x1="60" y1="0" x2="60" y2="56" />
        <circle cx="20" cy="28" r="3" fill={accent} />
        <circle cx="60" cy="28" r="3" fill={secondary} />
        <circle cx="40" cy="14" r="2" fill={secondary} />
        <line x1="40" y1="14" x2="40" y2="28" />
        <line x1="40" y1="28" x2="60" y2="28" />
      </svg>
    );
  }

  if (variant === "scanline") {
    return (
      <div className="absolute inset-0 overflow-hidden">
        {Array.from({ length: 7 }, (_, i) => (
          <div
            key={i}
            className="absolute w-full"
            style={{
              top: `${i * 14 + 4}%`,
              height: "2px",
              backgroundColor: accent,
              opacity: i % 2 === 0 ? 0.15 : 0.07,
            }}
          />
        ))}
        <div
          className="absolute inset-0"
          style={{
            background: `repeating-linear-gradient(0deg, transparent, transparent 3px, ${accent}08 4px)`,
          }}
        />
      </div>
    );
  }

  return null;
}
