import { useCallback, useEffect, useRef } from "react";
import * as Tone from "tone";
import { audio } from "../lib/audio/engine";
import { getStore, useStore, makeId } from "../store";
import { noteRecorder, vocalRecorder } from "../lib/audio/recorder";

/**
 * Hook providing the play/pause/stop/record actions for the transport bar.
 * Centralizing them keeps the keyboard shortcuts and transport buttons
 * behaviorally identical, and lets MIDI Learn invoke the same code paths.
 */

export function useTransport() {
  const project = useStore((s) => s.project);
  const audioUnlocked = useStore((s) => s.audioUnlocked);

  const ensureUnlocked = useCallback(async () => {
    if (!audioUnlocked) {
      await audio.unlock();
      getStore().set({ audioUnlocked: true });
    }
  }, [audioUnlocked]);

  const play = useCallback(async () => {
    await ensureUnlocked();
    audio.play();
    getStore().set({ isPlaying: true });
  }, [ensureUnlocked]);

  const pause = useCallback(() => {
    audio.pause();
    getStore().set({ isPlaying: false });
  }, []);

  const stop = useCallback(async () => {
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

    // commit any in-progress recording first
    const armed = getStore().state.project.tracks.find((t) => t.armed);
    if (armed) {
      if (armed.kind === "vocals") {
        if (vocalRecorder.isActive()) {
          const result = await vocalRecorder.stop();
          if (result) {
            getStore().addAudioClip(armed.id, {
              id: makeId(),
              start: result.startBeat,
              durationSec: result.durationSec,
              blob: result.blob,
            });
          }
        }
      } else if (noteRecorder.isActiveFor(armed.id)) {
        const result = noteRecorder.stop();
        if (result && result.events.length > 0) {
          getStore().addNoteClip(armed.id, {
            id: makeId(),
            start: result.startBeat,
            length: Math.max(result.lengthBeats, 1),
            notes: result.events,
          });
        }
      }
    }
    audio.stop();
    getStore().set({ isPlaying: false, isRecording: false, countingIn: false, countInBeat: 0 });
  }, []);

  const record = useCallback(async () => {
    await ensureUnlocked();
    const proj = getStore().state.project;
    const armed = proj.tracks.find((t) => t.armed);
    if (!armed) {
      getStore().setStatus("Arm a track (record dot on the channel) to record.", "warn");
      return;
    }

    const startRecording = async () => {
      const beat = audio.positionBeats();
      if (armed.kind === "vocals") {
        try {
          const dev = getStore().state.vocalDeviceId ?? undefined;
          await vocalRecorder.start(dev, beat);
        } catch (err) {
          getStore().setStatus(
            `Mic permission required: ${(err as Error).message}`,
            "error",
          );
          return;
        }
      } else {
        noteRecorder.start(armed.id, beat);
      }
      getStore().set({ isRecording: true });
    };

    if (proj.countIn) {
      // 4 beats of metronome accent at current bpm, then start
      audio.setMetronome(true);
      const wasMet = proj.metronome;
      const bpm = proj.bpm;
      const beatMs = (60 / bpm) * 1000;
      audio.play();
      let n = 0;
      const intervalId = window.setInterval(() => {
        n++;
        getStore().set({ countInBeat: n % 4 });
      }, beatMs);
      const timeoutId = window.setTimeout(async () => {
        const cur = getStore().state.countInTimers;
        // if stop() already cleared us, abort
        if (cur.timeout !== timeoutId) return;
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
      }, beatMs * 4);
      getStore().set({
        isPlaying: true,
        countingIn: true,
        countInBeat: 0,
        countInTimers: { interval: intervalId, timeout: timeoutId },
      });
    } else {
      audio.play();
      getStore().set({ isPlaying: true });
      await startRecording();
    }
  }, [ensureUnlocked]);

  // Schedule existing clips on play. Re-schedule whenever the project clip set changes.
  const scheduledRef = useRef<{ noteIds: number[]; audioPlayers: Array<Tone.Player>; audioIds: number[] }>({
    noteIds: [],
    audioPlayers: [],
    audioIds: [],
  });
  useEffect(() => {
    // ensure all tracks have an engine voice
    for (const t of project.tracks) audio.ensureTrack(t);
    // reschedule
    audio.cancelScheduled([...scheduledRef.current.noteIds, ...scheduledRef.current.audioIds]);
    scheduledRef.current.audioPlayers.forEach((p) => p.dispose());

    const noteIds: number[] = [];
    const audioPlayers: Tone.Player[] = [];
    const audioIds: number[] = [];
    for (const t of project.tracks) {
      for (const c of t.noteClips) {
        noteIds.push(...audio.scheduleClip(t, c));
      }
      for (const c of t.audioClips) {
        if (c.blob) {
          const r = audio.scheduleAudioClip(t, c);
          if (r) {
            audioIds.push(r.id);
            audioPlayers.push(r.player);
          }
        }
      }
    }
    scheduledRef.current = { noteIds, audioPlayers, audioIds };
    return () => {
      audio.cancelScheduled([...noteIds, ...audioIds]);
      audioPlayers.forEach((p) => p.dispose());
    };
  }, [project.tracks, project.bpm]);

  // Apply track settings to engine
  useEffect(() => {
    audio.refreshAllMutes(project.tracks);
  }, [project.tracks]);

  return { play, pause, stop, record };
}
