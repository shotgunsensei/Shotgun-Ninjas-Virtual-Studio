import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';

import {
  useVideoPlayer,
  VideoPausedContext,
} from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

export const SCENE_DURATIONS = {
  intro: 3600,
  timeline: 4700,
  sound: 4300,
  vocals: 3900,
  export: 4700,
} as const;

const SCENE_COMPONENTS = {
  intro: Scene1,
  timeline: Scene2,
  sound: Scene3,
  vocals: Scene4,
  export: Scene5,
} as const;

const SCENE_START_SEC: Record<string, number> = (() => {
  const starts: Record<string, number> = {};
  let elapsedMs = 0;
  for (const [key, duration] of Object.entries(SCENE_DURATIONS)) {
    starts[key] = elapsedMs / 1000;
    elapsedMs += duration;
  }
  return starts;
})();

const AUDIO_SEEK_EPSILON_SEC = 0.18;

export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  paused = false,
  muted = false,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  paused?: boolean;
  muted?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentScene, currentSceneKey } = useVideoPlayer({
    durations,
    loop,
    paused,
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSceneKeyRef = useRef<string | null>(null);
  const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '');
  const sceneIndex = Object.keys(SCENE_DURATIONS).indexOf(baseSceneKey);
  const CurrentScene =
    SCENE_COMPONENTS[baseSceneKey as keyof typeof SCENE_COMPONENTS] ?? Scene1;

  useEffect(() => {
    onSceneChange?.(currentSceneKey);
  }, [currentSceneKey, onSceneChange]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = 0.45;
    if (paused) {
      audio.pause();
      return;
    }

    if (lastSceneKeyRef.current !== currentSceneKey) {
      lastSceneKeyRef.current = currentSceneKey;
      const targetTime = SCENE_START_SEC[baseSceneKey] ?? 0;
      if (Math.abs(audio.currentTime - targetTime) > AUDIO_SEEK_EPSILON_SEC) {
        audio.currentTime = targetTime;
      }
    }
    audio.play().catch(() => {});
  }, [baseSceneKey, currentSceneKey, muted, paused]);

  return (
    <VideoPausedContext.Provider value={paused}>
      <main className="film">
        <div className="grain" />
        <motion.div
          animate={{
            x: `${8 + Math.max(0, sceneIndex) * 17}vw`,
            y: `${20 + Math.max(0, sceneIndex) * 8}vh`,
            scale: [1, 1.12, 0.96, 1],
          }}
          className="orb"
          transition={{ duration: 4.5, ease: 'easeInOut' }}
        />
        <div className="mark">
          <b>SN</b>
          <small>04.2026</small>
        </div>
        <div className="count">
          0{Math.max(0, sceneIndex) + 1} / 05
        </div>
        <AnimatePresence mode="sync">
          <motion.div
            animate={{
              clipPath: 'polygon(0 0,100% 0,100% 100%,0 100%)',
            }}
            className="scene-frame"
            exit={{
              clipPath: 'polygon(0 0,0 0,0 100%,0 100%)',
            }}
            initial={{
              clipPath: 'polygon(100% 0,100% 0,100% 100%,100% 100%)',
            }}
            key={currentSceneKey}
            transition={{ duration: 0.72, ease: [0.76, 0, 0.24, 1] }}
          >
            <CurrentScene />
          </motion.div>
        </AnimatePresence>
        <div className="footer">
          <span>CREATIVE AUDIO TOOLS / IN THE BROWSER</span>
          <span>LOOP — ON</span>
        </div>
        <audio
          autoPlay
          muted={muted}
          preload="auto"
          ref={audioRef}
          src={`${import.meta.env.BASE_URL}audio/bg_music.mp3`}
        />
      </main>
    </VideoPausedContext.Provider>
  );
}