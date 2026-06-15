import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as Tone from "tone";
import {
  WORLDS,
  type StudioWorld,
  type CustomWorldDef,
  applyWorldTheme,
  findWorld,
  getStoredWorldId,
  getWorldPrefs,
  saveWorldPrefs,
  loadCustomWorldDefs,
  saveCustomWorldDefs,
  buildCustomWorld,
} from "../lib/worlds";
import { playWorldWelcome, startAmbientLoop, type AmbientLoop } from "../lib/worldAudio";
import { getStore } from "../store";
import { audio } from "../lib/audio/engine";
import type { DrumKitId } from "../types";
import { firstPlayMark, getFirstPlayFlags } from "../lib/performance/firstPlayTrace";

const AMBIENT_VOLUME = 0.10;

interface WorldContextValue {
  activeWorld: StudioWorld;
  setWorld: (id: string) => void;
  ambientEnabled: boolean;
  setAmbientEnabled: (enabled: boolean) => void;
  customWorldDefs: CustomWorldDef[];
  customWorlds: StudioWorld[];
  allWorlds: StudioWorld[];
  saveCustomWorld: (def: CustomWorldDef) => void;
  deleteCustomWorld: (id: string) => void;
}

const WorldContext = createContext<WorldContextValue | null>(null);

/** Returns true when the user or system prefers reduced motion/audio. */
function _prefersReducedAudio(): boolean {
  try {
    if (getFirstPlayFlags().disableWorldAudio) return true;
    if (document.documentElement.classList.contains("studio-reduce-motion")) return true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
  } catch {
    // SSR guard
  }
  return false;
}

export function WorldProvider({ children }: { children: React.ReactNode }) {
  const [activeWorldId, setActiveWorldId] = useState<string>(getStoredWorldId);
  const [customWorldDefs, setCustomWorldDefs] = useState<CustomWorldDef[]>(
    loadCustomWorldDefs,
  );

  const audioCtxRef = useRef<AudioContext | null>(null);
  const ambientLoopRef = useRef<AmbientLoop | null>(null);
  // Tracks any pending delayed ambient-start so we can cancel it
  const ambientStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-session ambient toggle — defaults to enabled unless reduced-audio preference
  const [ambientEnabled, setAmbientEnabledState] = useState<boolean>(
    () => !_prefersReducedAudio(),
  );

  // Keep a ref in sync so callbacks closed over stale state can read the latest value
  const ambientEnabledRef = useRef(ambientEnabled);
  useEffect(() => {
    ambientEnabledRef.current = ambientEnabled;
  }, [ambientEnabled]);

  const getAudioCtx = useCallback(() => {
    const toneCtx = Tone.getContext().rawContext as AudioContext;
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = toneCtx;
    }
    return audioCtxRef.current;
  }, []);

  const customWorlds = useMemo(
    () => customWorldDefs.map(buildCustomWorld),
    [customWorldDefs],
  );

  const allWorlds = useMemo(
    () => [...WORLDS, ...customWorlds],
    [customWorlds],
  );

  /** Cancel any pending delayed ambient-start. */
  const _cancelPendingAmbientStart = useCallback(() => {
    if (ambientStartTimerRef.current !== null) {
      clearTimeout(ambientStartTimerRef.current);
      ambientStartTimerRef.current = null;
    }
  }, []);

  /** Stop and clear the current ambient loop. */
  const _stopAmbient = useCallback(() => {
    _cancelPendingAmbientStart();
    if (ambientLoopRef.current) {
      ambientLoopRef.current.stop();
      ambientLoopRef.current = null;
    }
  }, [_cancelPendingAmbientStart]);

  /** Start the ambient loop for a given world (stops any current one first). */
  const _startAmbient = useCallback(
    (worldId: string) => {
      _stopAmbient();
      if (_prefersReducedAudio()) return;
      try {
        const ctx = getAudioCtx();
        const doStart = () => {
          // Re-check the latest enabled state — may have changed during the async resume
          if (!ambientEnabledRef.current || _prefersReducedAudio()) return;
          try {
            // Stop anything that may have started in the gap
            if (ambientLoopRef.current) {
              ambientLoopRef.current.stop();
              ambientLoopRef.current = null;
            }
            ambientLoopRef.current = startAmbientLoop(worldId, ctx, AMBIENT_VOLUME);
          } catch {
            // Non-critical
          }
        };
        if (ctx.state === "suspended") {
          ctx.resume().then(doStart).catch(() => {
            // Audio not unlocked yet — will start on next interaction
          });
        } else {
          doStart();
        }
      } catch {
        // Non-critical
      }
    },
    [getAudioCtx, _stopAmbient],
  );

  // Apply the world theme on mount and whenever it changes
  useEffect(() => {
    const world = findWorld(activeWorldId, customWorlds) ?? WORLDS[0];
    applyWorldTheme(world);
  }, [activeWorldId, customWorlds]);

  // React to ambientEnabled toggle
  useEffect(() => {
    if (ambientEnabled) {
      _startAmbient(activeWorldId);
    } else {
      _stopAmbient();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambientEnabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      _stopAmbient();
    };
  }, [_stopAmbient]);

  const setWorld = useCallback(
    (id: string) => {
      const world = findWorld(id, customWorlds);
      if (!world) return;

      // Save current world's kit + BPM before switching
      const store = getStore();
      const { project } = store.state;
      const drumTrack = project.tracks.find((t) => t.kind === "drums");
      saveWorldPrefs(activeWorldId, {
        kitId: drumTrack?.kitId,
        bpm: project.bpm,
      });

      setActiveWorldId(id);
      applyWorldTheme(world);

      // Cancel any in-flight delayed ambient start from a previous world change
      _cancelPendingAmbientStart();
      // Stop current loop immediately
      if (ambientLoopRef.current) {
        ambientLoopRef.current.stop();
        ambientLoopRef.current = null;
      }

      // Restore saved kit + BPM for the new world (if any)
      const savedPrefs = getWorldPrefs(id);
      if (savedPrefs) {
        if (savedPrefs.bpm !== undefined) {
          const clampedBpm = Math.max(40, Math.min(240, savedPrefs.bpm));
          store.patchProject({ bpm: clampedBpm });
          audio.setBpm(clampedBpm);
        }
        if (savedPrefs.kitId !== undefined && drumTrack) {
          store.patchTrack(drumTrack.id, { kitId: savedPrefs.kitId as DrumKitId });
          audio.setKit(drumTrack.id, savedPrefs.kitId as DrumKitId);
        }
      }

      // Play welcome cue — resume AudioContext if needed (browsers suspend by default)
      if (getFirstPlayFlags().disableWorldAudio) {
        firstPlayMark("world-audio:welcome-skipped");
        return;
      }
      try {
        const ctx = getAudioCtx();
        const resume = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
        resume
          .then(() => {
            playWorldWelcome(world, ctx);
            // Start ambient after a short delay (let welcome cue breathe)
            ambientStartTimerRef.current = setTimeout(() => {
              ambientStartTimerRef.current = null;
              // Check latest state — user may have toggled off during the delay
              if (!ambientEnabledRef.current || _prefersReducedAudio()) return;
              try {
                if (ambientLoopRef.current) {
                  ambientLoopRef.current.stop();
                  ambientLoopRef.current = null;
                }
                const audioCtx = audioCtxRef.current;
                if (!audioCtx || audioCtx.state === "closed") return;
                ambientLoopRef.current = startAmbientLoop(id, audioCtx, AMBIENT_VOLUME);
              } catch {
                // Non-critical
              }
            }, 1200);
          })
          .catch(() => {
            // Ignore — audio may not be unlocked yet
          });
      } catch {
        // Ignore
      }
    },
    [activeWorldId, getAudioCtx, _cancelPendingAmbientStart, customWorlds],
  );

  const setAmbientEnabled = useCallback((enabled: boolean) => {
    setAmbientEnabledState(enabled);
  }, []);

  const saveCustomWorld = useCallback((def: CustomWorldDef) => {
    setCustomWorldDefs((prev) => {
      const existing = prev.findIndex((d) => d.id === def.id);
      const next =
        existing >= 0
          ? prev.map((d, i) => (i === existing ? def : d))
          : [...prev, def];
      saveCustomWorldDefs(next);
      return next;
    });
  }, []);

  const deleteCustomWorld = useCallback(
    (id: string) => {
      setCustomWorldDefs((prev) => {
        const next = prev.filter((d) => d.id !== id);
        saveCustomWorldDefs(next);
        return next;
      });
      // If the deleted world is active, switch to the default
      if (activeWorldId === id) {
        setActiveWorldId("dojo-dark");
        applyWorldTheme(WORLDS[0]);
      }
    },
    [activeWorldId],
  );

  const activeWorld = useMemo(
    () => findWorld(activeWorldId, customWorlds) ?? WORLDS[0],
    [activeWorldId, customWorlds],
  );

  const value = useMemo(
    () => ({
      activeWorld,
      setWorld,
      ambientEnabled,
      setAmbientEnabled,
      customWorldDefs,
      customWorlds,
      allWorlds,
      saveCustomWorld,
      deleteCustomWorld,
    }),
    [
      activeWorld,
      setWorld,
      ambientEnabled,
      setAmbientEnabled,
      customWorldDefs,
      customWorlds,
      allWorlds,
      saveCustomWorld,
      deleteCustomWorld,
    ],
  );

  return (
    <WorldContext.Provider value={value}>{children}</WorldContext.Provider>
  );
}

export function useWorld(): WorldContextValue {
  const ctx = useContext(WorldContext);
  if (!ctx) throw new Error("useWorld must be used inside WorldProvider");
  return ctx;
}
