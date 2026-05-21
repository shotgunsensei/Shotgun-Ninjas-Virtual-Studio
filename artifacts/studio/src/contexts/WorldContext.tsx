import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  WORLDS,
  type StudioWorld,
  type WorldId,
  applyWorldTheme,
  findWorld,
  getStoredWorldId,
} from "../lib/worlds";
import { playWorldWelcome } from "../lib/worldAudio";

interface WorldContextValue {
  activeWorld: StudioWorld;
  setWorld: (id: WorldId) => void;
}

const WorldContext = createContext<WorldContextValue | null>(null);

export function WorldProvider({ children }: { children: React.ReactNode }) {
  const [activeWorldId, setActiveWorldId] = useState<WorldId>(
    getStoredWorldId,
  );

  const audioCtxRef = useRef<AudioContext | null>(null);

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }, []);

  // Apply the world theme on mount and whenever it changes
  useEffect(() => {
    const world = findWorld(activeWorldId) ?? WORLDS[0];
    applyWorldTheme(world);
  }, [activeWorldId]);

  const setWorld = useCallback(
    (id: WorldId) => {
      const world = findWorld(id);
      if (!world) return;
      setActiveWorldId(id);
      applyWorldTheme(world);
      // Play welcome cue — resume AudioContext if needed (browsers suspend by default)
      try {
        const ctx = getAudioCtx();
        const resume = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
        resume.then(() => playWorldWelcome(world, ctx)).catch(() => {
          // Ignore — audio may not be unlocked yet
        });
      } catch {
        // Ignore
      }
    },
    [getAudioCtx],
  );

  const activeWorld = useMemo(
    () => findWorld(activeWorldId) ?? WORLDS[0],
    [activeWorldId],
  );

  const value = useMemo(
    () => ({ activeWorld, setWorld }),
    [activeWorld, setWorld],
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
