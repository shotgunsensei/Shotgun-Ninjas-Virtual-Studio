import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { ReactNode } from "react";
import * as Tone from "tone";
import { audio } from "../lib/audio/engine";
import { getStore, useStore, makeId } from "../store";
import { noteRecorder, vocalRecorder } from "../lib/audio/recorder";
import { startPerfTimer } from "../utils/performanceDiagnostics";
import {
  firstPlayMark,
  firstPlayMeasure,
  getFirstPlayFlags,
} from "../lib/performance/firstPlayTrace";
import { useSettings } from "../lib/settings";

/**
 * Hook providing the play/pause/stop/record actions for the transport bar.
 * Centralizing them keeps the keyboard shortcuts and transport buttons
 * behaviorally identical, and lets MIDI Learn invoke the same code paths.
 */

export interface TransportActions {
  play: () => Promise<void>;
  pause: () => void;
  stop: () => Promise<void>;
  record: () => Promise<void>;
}

const TransportContext = createContext<TransportActions | null>(null);

function useTransportController(): TransportActions {
  const audioUnlocked = useStore((s) => s.audioUnlocked);
  const panicRevision = useStore((s) => s.panicRevision);
  const scheduleRevision = useStore((s) => s.transportScheduleRevision);
  const bpm = useStore((s) => s.project.bpm);
  const masterVolume = useStore((s) => s.project.masterVolume);
  const loopEnabled = useStore((s) => s.project.loopEnabled);
  const loopStartBeat = useStore((s) => s.project.loopStartBeat);
  const loopEndBeat = useStore((s) => s.project.loopEndBeat);
  const metronome = useStore((s) => s.project.metronome);
  const globalSwing = useStore((s) => s.project.globalGroove?.swing ?? 0);
  const metronomeVolume = useSettings((s) => s.metronomeVolume);

  // Separate mute/solo signal — cheap string comparison, no reschedule.
  const muteKey = useStore((s) =>
    s.project.tracks
      .map((t) => `${t.id}:${t.muted ? 1 : 0}:${t.solo ? 1 : 0}`)
      .join("|"),
  );

  // Schedule existing clips on play. Re-schedule only when clip structure
  // or BPM actually changes (scheduleKey), not on every fader/mute move.
  const scheduledRef = useRef<{
    noteIds: number[];
    audioPlayers: Array<Tone.Player>;
    audioIds: number[];
  }>({
    noteIds: [],
    audioPlayers: [],
    audioIds: [],
  });
  const preparedRevisionRef = useRef<number | null>(null);
  const preparationGenerationRef = useRef(0);
  const preparationRef = useRef<{
    revision: number;
    generation: number;
    promise: Promise<boolean>;
  } | null>(null);
  // User transport intents are separate from engine-level Panic generations.
  // Stop must be able to revoke a Play/Record action while it is awaiting
  // AudioContext resume, project preparation, or microphone permission.
  const transportIntentGenerationRef = useRef(0);
  const handledPanicRevisionRef = useRef(panicRevision);

  // View-independent project → engine synchronization. Keeping this beside
  // the sole transport owner makes desktop and mobile playback identical.
  useEffect(() => {
    audio.setBpm(bpm);
  }, [bpm]);
  useEffect(() => {
    audio.setMaster(masterVolume);
  }, [masterVolume]);
  useEffect(() => {
    audio.setLoop(loopEnabled, loopStartBeat, loopEndBeat);
  }, [loopEnabled, loopStartBeat, loopEndBeat]);
  useEffect(() => {
    audio.setMetronome(metronome);
  }, [metronome]);
  useEffect(() => {
    audio.setMetronomeVolume(metronomeVolume);
  }, [metronomeVolume]);
  useEffect(() => {
    audio.setSwing(globalSwing);
  }, [globalSwing]);

  const ensureUnlocked = useCallback(async () => {
    // The store flag records that audio worked once; it cannot represent an
    // OS sleep, Bluetooth/output switch, or background-tab suspension. Verify
    // the actual context on every user Play/Record action. `unlock()` is a
    // cheap no-op while already running.
    firstPlayMark("useTransport.ensureUnlocked:before", { audioUnlocked });
    await audio.unlock();
    if (!audioUnlocked) {
      window.requestAnimationFrame(() => {
        firstPlayMark("useTransport.ensureUnlocked:set-audioUnlocked");
        getStore().set({ audioUnlocked: true });
      });
    }
  }, [audioUnlocked]);

  const clearProjectSchedules = useCallback(() => {
    preparationGenerationRef.current += 1;
    preparedRevisionRef.current = null;
    audio.cancelScheduled([
      ...scheduledRef.current.noteIds,
      ...scheduledRef.current.audioIds,
    ]);
    audio.disposeScheduledAudioPlayers(scheduledRef.current.audioPlayers);
    scheduledRef.current = { noteIds: [], audioPlayers: [], audioIds: [] };
  }, []);

  /** Build every audible voice and transport callback before playback starts.
   * The old first-play path armed drums only, which made melodic and recorded
   * audio clips silent on the first Play click. */
  const prepareProjectSchedules = useCallback(async (): Promise<boolean> => {
    const revision = getStore().state.transportScheduleRevision;
    if (preparedRevisionRef.current === revision) return true;
    if (
      audio.getPlaybackState() === "playing" ||
      audio.getPlaybackState() === "starting"
    ) {
      return false;
    }
    if (
      preparationRef.current?.revision === revision &&
      preparationRef.current.generation === preparationGenerationRef.current
    ) {
      return preparationRef.current.promise;
    }

    const generation = ++preparationGenerationRef.current;
    const run = async () => {
      const flags = getFirstPlayFlags();
      firstPlayMark("project-schedule:run:start", {
        revision,
        disableProjectSchedules: flags.disableProjectSchedules,
        disableTransportCallbacks: flags.disableTransportCallbacks,
        disableGraphBuildOnPlay: flags.disableGraphBuildOnPlay,
        useMinimalAudioGraph: flags.useMinimalAudioGraph,
      });
      if (flags.disableProjectSchedules || flags.disableTransportCallbacks) {
        preparedRevisionRef.current = revision;
        firstPlayMark("project-schedule:skipped");
        return true;
      }

      const allTracks = getStore().state.project.tracks;
      const tracks = flags.leanDrumValidation
        ? allTracks.filter((track) => track.kind === "drums")
        : allTracks;
      const keepTrackIds = new Set(allTracks.map((track) => track.id));
      const noteIds: number[] = [];
      const audioPlayers: Tone.Player[] = [];
      const audioIds: number[] = [];
      const audioReady: Promise<void>[] = [];
      const yieldToBrowser = () =>
        new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      const cleanupPending = () => {
        audio.cancelScheduled([...noteIds, ...audioIds]);
        audio.disposeScheduledAudioPlayers(audioPlayers);
      };

      audio.cancelScheduled([
        ...scheduledRef.current.noteIds,
        ...scheduledRef.current.audioIds,
      ]);
      audio.disposeScheduledAudioPlayers(scheduledRef.current.audioPlayers);
      scheduledRef.current = { noteIds: [], audioPlayers: [], audioIds: [] };

      try {
        for (const id of audio.getActiveTrackIds()) {
          if (!keepTrackIds.has(id)) {
            audio.removeTrack(id);
            await yieldToBrowser();
          }
        }

        for (const capturedTrack of tracks) {
          if (
            generation !== preparationGenerationRef.current ||
            getStore().state.transportScheduleRevision !== revision
          ) {
            cleanupPending();
            return false;
          }
          // Selector-only edits intentionally do not invalidate transport
          // callbacks. Resolve the authoritative track immediately before
          // realizing it so a sound-pack change during yielded preparation
          // cannot be overwritten by this run's older project snapshot.
          const track = getStore().state.project.tracks.find(
            (candidate) => candidate.id === capturedTrack.id,
          );
          if (!track) {
            cleanupPending();
            return false;
          }
          firstPlayMark("project-schedule:track", {
            trackId: track.id,
            kind: track.kind,
            noteClips: track.noteClips.length,
            audioClips: track.audioClips.length,
          });
          audio.ensureTrack(track, {
            mode: track.kind === "drums" ? "lean" : "tone",
            reason: "project-schedule",
            allowHeavy: track.kind !== "drums",
            deadlineMs: track.kind === "drums" ? 50 : undefined,
          });
          for (const clip of track.noteClips) {
            noteIds.push(...audio.scheduleClip(track, clip));
          }
          for (const clip of track.audioClips) {
            if (!clip.blob) continue;
            const scheduled = audio.scheduleAudioClip(track, clip);
            if (scheduled) {
              audioIds.push(scheduled.id);
              audioPlayers.push(scheduled.player);
              audioReady.push(scheduled.ready);
            }
          }
          await yieldToBrowser();
        }

        // Solo is a project-wide decision; apply it once with the complete set
        // after every track voice exists so ordering cannot affect audibility.
        audio.refreshAllMutes(getStore().state.project.tracks);

        if (audioReady.length > 0) {
          let timeoutId: number | null = null;
          try {
            await Promise.race([
              Promise.all(audioReady).then(() => undefined),
              new Promise<never>((_, reject) => {
                timeoutId = window.setTimeout(
                  () => reject(new Error("Audio clip preparation timed out.")),
                  15_000,
                );
              }),
            ]);
          } finally {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
          }
        }

        if (
          generation !== preparationGenerationRef.current ||
          getStore().state.transportScheduleRevision !== revision
        ) {
          cleanupPending();
          return false;
        }

        scheduledRef.current = { noteIds, audioPlayers, audioIds };
        preparedRevisionRef.current = revision;
        firstPlayMark("project-schedule:run:complete", {
          revision,
          noteIds: noteIds.length,
          audioIds: audioIds.length,
          audioPlayers: audioPlayers.length,
        });
        return true;
      } catch (error) {
        cleanupPending();
        throw error;
      }
    };

    const promise = run();
    preparationRef.current = { revision, generation, promise };
    try {
      return await promise;
    } finally {
      if (preparationRef.current?.promise === promise) {
        preparationRef.current = null;
      }
    }
  }, []);

  const play = useCallback(async () => {
    const endTiming = startPerfTimer("transport-play");
    const startedAt = performance.now();
    const intentGeneration = ++transportIntentGenerationRef.current;
    const intentIsCurrent = () =>
      transportIntentGenerationRef.current === intentGeneration;
    const silenceGeneration = audio.getSilenceGeneration();
    firstPlayMark("useTransport.play:start", {
      audioUnlocked,
      transportState: audio.state,
      playbackState: audio.getPlaybackState(),
    });
    try {
      await ensureUnlocked();
      if (
        !intentIsCurrent() ||
        audio.getSilenceGeneration() !== silenceGeneration
      )
        return;
      firstPlayMark("useTransport.play:before-engine-play", {
        transportState: audio.state,
        playbackState: audio.getPlaybackState(),
      });
      const prepared = await prepareProjectSchedules();
      if (!intentIsCurrent()) return;
      if (!prepared) {
        getStore().setStatus(
          "Playback changed while preparing. Press Play again.",
          "warn",
        );
        return;
      }
      if (audio.getSilenceGeneration() !== silenceGeneration) {
        clearProjectSchedules();
        return;
      }
      if (!intentIsCurrent()) return;
      const started = audio.play();
      firstPlayMark("useTransport.play:after-engine-play", {
        started,
        transportState: audio.state,
        playbackState: audio.getPlaybackState(),
      });
      if (started) {
        getStore().set({ isPlaying: true });
      } else {
        getStore().setStatus(
          "Audio is still starting. Try Play again in a moment.",
          "warn",
        );
      }
    } catch (error) {
      if (!intentIsCurrent()) return;
      const message = error instanceof Error ? error.message : String(error);
      firstPlayMark("useTransport.play:error", { message });
      getStore().setStatus(`Playback preparation failed: ${message}`, "error");
    } finally {
      firstPlayMeasure("useTransport.play", startedAt, performance.now(), {
        transportState: audio.state,
        playbackState: audio.getPlaybackState(),
      });
      endTiming();
    }
  }, [
    audioUnlocked,
    clearProjectSchedules,
    ensureUnlocked,
    prepareProjectSchedules,
  ]);

  const pause = useCallback(() => {
    audio.pause();
    getStore().set({ isPlaying: false });
  }, []);

  const stop = useCallback(async () => {
    // Revoke pending async Play/Record work before Stop itself awaits recorder
    // finalization. Also detach any in-flight preparation generation so a new
    // user action can start a fresh run without inheriting the cancelled one.
    transportIntentGenerationRef.current += 1;
    if (preparationRef.current) {
      preparationGenerationRef.current += 1;
      preparedRevisionRef.current = null;
    }
    const endTiming = startPerfTimer("transport-stop");
    try {
      // cancel any pending count-in BEFORE doing anything else so deferred
      // timers cannot start a new recording after stop.
      const timers = getStore().state.countInTimers;
      if (timers.interval !== null) window.clearInterval(timers.interval);
      if (timers.timeout !== null) window.clearTimeout(timers.timeout);
      getStore().set({
        countInTimers: { interval: null, timeout: null },
        countingIn: false,
        countInBeat: 0,
      });

      // Commit recordings to the track that actually owns the recorder. The
      // currently armed track is UI state and can change during a take.
      const vocalOwner = vocalRecorder.getTrackId();
      if (vocalRecorder.isBusy()) {
        const result = await vocalRecorder.stop();
        const ownerTrack = vocalOwner
          ? getStore().state.project.tracks.find(
              (track) => track.id === vocalOwner,
            )
          : undefined;
        if (result && ownerTrack) {
          const recordedClipId = makeId();
          getStore().addAudioClip(ownerTrack.id, {
            id: recordedClipId,
            start: result.startBeat,
            durationSec: result.durationSec,
            blob: result.blob,
          });
          // Surface the take in the sample preview dialog so the user can
          // trim silence / normalize / fade and save it to the library.
          getStore().set({
            pendingSample: {
              blob: result.blob,
              defaultName: `${ownerTrack.name} take ${new Date().toLocaleTimeString()}`,
              recordedTrackId: ownerTrack.id,
              recordedClipId,
            },
          });
        }
      }

      const noteOwner = noteRecorder.getTrackId();
      if (noteRecorder.isActive()) {
        const result = noteRecorder.stop();
        const ownerTrack = noteOwner
          ? getStore().state.project.tracks.find(
              (track) => track.id === noteOwner,
            )
          : undefined;
        if (result && result.events.length > 0 && ownerTrack) {
          getStore().addNoteClip(ownerTrack.id, {
            id: makeId(),
            start: result.startBeat,
            length: Math.max(result.lengthBeats, 1),
            notes: result.events,
          });
        }
      }
      audio.stop();
      getStore().set({
        isPlaying: false,
        isRecording: false,
        countingIn: false,
        countInBeat: 0,
      });
    } finally {
      endTiming();
    }
  }, []);

  const record = useCallback(async () => {
    const state = getStore().state;
    if (
      state.isRecording ||
      state.countingIn ||
      noteRecorder.isActive() ||
      vocalRecorder.isBusy()
    ) {
      getStore().setStatus(
        "Recording is already active. Press Stop or Panic first.",
        "warn",
      );
      return;
    }
    const intentGeneration = ++transportIntentGenerationRef.current;
    const intentIsCurrent = () =>
      transportIntentGenerationRef.current === intentGeneration;
    const silenceGeneration = audio.getSilenceGeneration();
    await ensureUnlocked();
    if (
      !intentIsCurrent() ||
      audio.getSilenceGeneration() !== silenceGeneration
    )
      return;
    const proj = getStore().state.project;
    const armed = proj.tracks.find((t) => t.armed);
    if (!armed) {
      getStore().setStatus(
        "Arm a track (record dot on the channel) to record.",
        "warn",
      );
      return;
    }
    try {
      const prepared = await prepareProjectSchedules();
      if (!intentIsCurrent()) return;
      if (!prepared) {
        getStore().setStatus(
          "Project changed while preparing to record. Try again.",
          "warn",
        );
        return;
      }
      if (audio.getSilenceGeneration() !== silenceGeneration) {
        clearProjectSchedules();
        return;
      }
    } catch (error) {
      if (!intentIsCurrent()) return;
      const message = error instanceof Error ? error.message : String(error);
      getStore().setStatus(`Recording preparation failed: ${message}`, "error");
      return;
    }

    const startRecording = async () => {
      if (
        !intentIsCurrent() ||
        audio.getSilenceGeneration() !== silenceGeneration
      )
        return;
      const beat = audio.positionBeats();
      if (armed.kind === "vocals") {
        try {
          const dev = getStore().state.vocalDeviceId ?? undefined;
          await vocalRecorder.start(armed.id, dev, beat);
          if (
            !intentIsCurrent() ||
            audio.getSilenceGeneration() !== silenceGeneration
          ) {
            vocalRecorder.cancel();
            return;
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          getStore().setStatus(
            `Mic permission required: ${(err as Error).message}`,
            "error",
          );
          return;
        }
      } else {
        if (
          !intentIsCurrent() ||
          audio.getSilenceGeneration() !== silenceGeneration
        )
          return;
        if (!noteRecorder.start(armed.id, beat)) {
          getStore().setStatus("A note recording is already active.", "warn");
          return;
        }
      }
      if (!intentIsCurrent()) return;
      getStore().set({ isRecording: true });
    };

    if (proj.countIn) {
      // 1 or 2 bars of metronome accent at current bpm, then start
      audio.setMetronome(true);
      const wasMet = proj.metronome;
      const bpm = proj.bpm;
      const beatMs = (60 / bpm) * 1000;
      const countInBeats = (proj.countInBars ?? 1) * 4;
      const started = audio.play();
      if (!started) {
        getStore().setStatus(
          "Audio is still starting. Try Record again in a moment.",
          "warn",
        );
        return;
      }
      let n = 0;
      const intervalId = window.setInterval(() => {
        n++;
        getStore().set({ countInBeat: n % 4 });
      }, beatMs);
      const timeoutId = window.setTimeout(async () => {
        const cur = getStore().state.countInTimers;
        // if stop() already cleared us, abort
        if (cur.timeout !== timeoutId) {
          window.clearInterval(intervalId);
          audio.setMetronome(getStore().state.project.metronome);
          return;
        }
        if (
          !intentIsCurrent() ||
          audio.getSilenceGeneration() !== silenceGeneration
        ) {
          window.clearInterval(intervalId);
          getStore().set({
            countingIn: false,
            countInBeat: 0,
            countInTimers: { interval: null, timeout: null },
          });
          audio.setMetronome(getStore().state.project.metronome);
          return;
        }
        window.clearInterval(intervalId);
        getStore().set({
          countingIn: false,
          countInBeat: 0,
          countInTimers: { interval: null, timeout: null },
        });
        if (!wasMet) audio.setMetronome(false);
        // re-zero transport position before recording
        audio.stop();
        audio.play();
        await startRecording();
      }, beatMs * countInBeats);
      getStore().set({
        isPlaying: true,
        countingIn: true,
        countInBeat: 0,
        countInTimers: { interval: intervalId, timeout: timeoutId },
      });
    } else {
      const started = audio.play();
      if (started) {
        getStore().set({ isPlaying: true });
        await startRecording();
      } else {
        getStore().setStatus(
          "Audio is still starting. Try Record again in a moment.",
          "warn",
        );
      }
    }
  }, [clearProjectSchedules, ensureUnlocked, prepareProjectSchedules]);

  useEffect(() => {
    if (panicRevision !== handledPanicRevisionRef.current) {
      handledPanicRevisionRef.current = panicRevision;
      clearProjectSchedules();
      firstPlayMark("project-schedule:panic-reset");
    }
  }, [clearProjectSchedules, panicRevision]);

  // A scheduling-relevant edit invalidates captured callbacks. Preparation is
  // intentionally deferred until the next Play so fader/UI activity stays
  // light and playback never rebuilds graphs in the middle of a callback.
  useEffect(() => {
    if (preparedRevisionRef.current !== scheduleRevision) {
      preparationGenerationRef.current += 1;
      preparedRevisionRef.current = null;
    }
  }, [scheduleRevision]);

  useEffect(() => clearProjectSchedules, [clearProjectSchedules]);

  // Apply mute/solo to engine only when those flags actually change.
  useEffect(() => {
    audio.refreshAllMutes(getStore().state.project.tracks);
  }, [muteKey]);

  return useMemo(
    () => ({ play, pause, stop, record }),
    [pause, play, record, stop],
  );
}

/** Owns the sole project scheduler for the mounted Studio. All desktop,
 * mobile, keyboard, and MIDI controls consume the same action instance. */
export function TransportProvider({ children }: { children: ReactNode }) {
  const actions = useTransportController();
  return createElement(TransportContext.Provider, { value: actions }, children);
}

export function useTransport(): TransportActions {
  const actions = useContext(TransportContext);
  if (!actions) {
    throw new Error("useTransport must be used within TransportProvider");
  }
  return actions;
}
