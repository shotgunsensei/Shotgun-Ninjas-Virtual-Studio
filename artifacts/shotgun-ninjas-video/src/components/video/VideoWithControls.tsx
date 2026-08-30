import {
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  Repeat,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import VideoTemplate, {
  SCENE_DURATIONS,
} from '@/components/video/VideoTemplate';

import { useSceneControls } from './useSceneControls';

const SCENE_DETAILS: Record<string, { title: string; filePath: string }> = {
  intro: {
    title: 'Make noise',
    filePath: 'src/components/video/video_scenes/Scene1.tsx',
  },
  timeline: {
    title: 'Build the loop',
    filePath: 'src/components/video/video_scenes/Scene2.tsx',
  },
  sound: {
    title: 'Shape the sound',
    filePath: 'src/components/video/video_scenes/Scene3.tsx',
  },
  vocals: {
    title: 'Record the room',
    filePath: 'src/components/video/video_scenes/Scene4.tsx',
  },
  export: {
    title: 'Export your track',
    filePath: 'src/components/video/video_scenes/Scene5.tsx',
  },
};

const PROGRESS_TICK_MS = 60;

function formatPlaybackTime(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function announceSceneSelection(index: number, sceneKeys: string[]) {
  const key = sceneKeys[index];
  const details = SCENE_DETAILS[key];
  if (!details?.filePath) return;

  window.parent.postMessage(
    {
      type: 'REPLIT_VIDEO_SCENE_SELECTED',
      payload: {
        sceneIndex: index,
        sceneCount: sceneKeys.length,
        sceneTitle: details.title || key,
        filePath: details.filePath,
        lineNumber: 1,
      },
    },
    '*',
  );
}

function PlaybackStatus({
  sceneKeys,
  activeIndex,
  activeDuration,
  activeStartTime,
  totalDuration,
  tick,
  paused,
  onJumpTo,
}: {
  sceneKeys: string[];
  activeIndex: number;
  activeDuration: number;
  activeStartTime: number;
  totalDuration: number;
  tick: number;
  paused: boolean;
  onJumpTo: (index: number) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const elapsedBaseRef = useRef(0);

  useEffect(() => {
    setElapsed(0);
    elapsedBaseRef.current = 0;
  }, [tick]);

  useEffect(() => {
    if (paused) return undefined;

    const startedAt = performance.now();
    const interval = window.setInterval(() => {
      setElapsed(
        elapsedBaseRef.current + (performance.now() - startedAt),
      );
    }, PROGRESS_TICK_MS);

    return () => {
      window.clearInterval(interval);
      elapsedBaseRef.current += performance.now() - startedAt;
    };
  }, [paused, tick]);

  const progress =
    activeDuration > 0 ? Math.min(1, elapsed / activeDuration) : 0;
  const totalElapsed = Math.min(
    totalDuration,
    activeStartTime + Math.min(elapsed, activeDuration),
  );

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {sceneKeys.map((key, index) => {
          const fill = index === activeIndex ? progress * 100 : 0;
          return (
            <button
              aria-current={index === activeIndex ? 'true' : undefined}
              aria-label={`Jump to scene ${index + 1}`}
              className="relative h-3 min-h-3 flex-1 cursor-pointer overflow-hidden rounded-full bg-white/20 transition-all hover:h-4 hover:bg-white/25"
              key={key}
              onClick={() => onJumpTo(index)}
              type="button"
            >
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-white/90 transition-[width] duration-100"
                style={{ width: `${fill}%` }}
              />
            </button>
          );
        })}
      </div>
      <div className="shrink-0 font-mono text-xl tabular-nums text-white/60">
        {activeIndex + 1}/{sceneKeys.length}
      </div>
      <div
        aria-label={`Playback time ${formatPlaybackTime(totalElapsed)} of ${formatPlaybackTime(totalDuration)}`}
        className="min-w-[11ch] shrink-0 text-right font-mono text-xl tabular-nums text-white/80"
        role="timer"
      >
        {formatPlaybackTime(totalElapsed)} / {formatPlaybackTime(totalDuration)}
      </div>
    </>
  );
}

export default function VideoWithControls() {
  const isIframed =
    typeof window !== 'undefined' && window.self !== window.top;

  const {
    sceneKeys,
    activeIndex,
    locked,
    paused,
    mountKey,
    tick,
    durations,
    activeDuration,
    activeStartTime,
    totalDuration,
    onSceneChange,
    jumpTo,
    toggleLock,
    togglePause,
  } = useSceneControls(SCENE_DURATIONS);

  const [muted, setMuted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [tapPinned, setTapPinned] = useState(false);
  const sensorRef = useRef<HTMLDivElement | null>(null);

  const handleJumpTo = useCallback(
    (index: number) => {
      jumpTo(index);
      announceSceneSelection(index, sceneKeys);
    },
    [jumpTo, sceneKeys],
  );

  const handlePointerEnter = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse') setHovering(true);
    },
    [],
  );

  const handlePointerLeave = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse') setHovering(false);
    },
    [],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== 'mouse' && collapsed) setTapPinned(true);
    },
    [collapsed],
  );

  const handleToggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      if (!value) {
        setHovering(false);
        setTapPinned(false);
      }
      return !value;
    });
  }, []);

  useEffect(() => {
    if (!(collapsed && tapPinned)) return undefined;

    const handleDocumentPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return;
      if (!sensorRef.current?.contains(event.target as Node)) {
        setTapPinned(false);
      }
    };

    document.addEventListener('pointerdown', handleDocumentPointerDown);
    return () =>
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
  }, [collapsed, tapPinned]);

  useEffect(() => {
    if (!paused) return undefined;

    const runningAnimations = document
      .getAnimations()
      .filter((animation) => animation.playState === 'running');
    runningAnimations.forEach((animation) => animation.pause());
    return () => runningAnimations.forEach((animation) => animation.play());
  }, [paused]);

  if (!isIframed) return <VideoTemplate />;

  const controlsVisible = !collapsed || hovering || tapPinned;

  return (
    <div className="relative h-screen w-full">
      <VideoTemplate
        key={mountKey}
        durations={durations}
        loop
        muted={muted}
        onSceneChange={onSceneChange}
        paused={paused}
      />
      <div
        className="absolute bottom-0 left-0 right-0 z-50 flex h-1/4 flex-col justify-end"
        onPointerDown={handlePointerDown}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        ref={sensorRef}
      >
        <div aria-hidden="true" className="w-full flex-1" />
        <div
          aria-hidden={!controlsVisible}
          className={`flex items-center gap-3 bg-black/60 px-5 py-4 backdrop-blur-sm transition-all duration-200 ease-out ${
            controlsVisible
              ? 'pointer-events-auto translate-y-0 opacity-100'
              : 'pointer-events-none translate-y-full opacity-0'
          }`}
        >
          <button
            aria-label={paused ? 'Play' : 'Pause'}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            onClick={togglePause}
            title={paused ? 'Play' : 'Pause'}
            type="button"
          >
            {paused ? <Play className="h-8 w-8" /> : <Pause className="h-8 w-8" />}
          </button>
          <button
            aria-label={locked ? 'Loop current scene: on' : 'Loop current scene: off'}
            aria-pressed={locked}
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-lg transition-colors ${
              locked
                ? 'bg-white/15 text-white hover:bg-white/25'
                : 'text-white/60 hover:bg-white/10 hover:text-white'
            }`}
            onClick={toggleLock}
            title={locked ? 'Loop current scene: on' : 'Loop current scene: off'}
            type="button"
          >
            <Repeat className="h-8 w-8" />
          </button>
          <button
            aria-label={muted ? 'Unmute preview audio' : 'Mute preview audio'}
            aria-pressed={muted}
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-lg transition-colors ${
              muted
                ? 'bg-white/15 text-white hover:bg-white/25'
                : 'text-white/60 hover:bg-white/10 hover:text-white'
            }`}
            onClick={() => setMuted((value) => !value)}
            title={muted ? 'Unmute preview audio' : 'Mute preview audio'}
            type="button"
          >
            {muted ? <VolumeX className="h-8 w-8" /> : <Volume2 className="h-8 w-8" />}
          </button>
          <div aria-hidden="true" className="w-px self-stretch bg-white/15" />
          <PlaybackStatus
            activeDuration={activeDuration}
            activeIndex={activeIndex}
            activeStartTime={activeStartTime}
            onJumpTo={handleJumpTo}
            paused={paused}
            sceneKeys={sceneKeys}
            tick={tick}
            totalDuration={totalDuration}
          />
          <button
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Show controls' : 'Hide controls'}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            onClick={handleToggleCollapsed}
            title={collapsed ? 'Show controls' : 'Hide controls'}
            type="button"
          >
            {collapsed ? (
              <ChevronUp className="h-10 w-10" />
            ) : (
              <ChevronDown className="h-10 w-10" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}