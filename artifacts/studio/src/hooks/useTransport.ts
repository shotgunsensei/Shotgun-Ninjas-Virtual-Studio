import { useCallback, useEffect, useRef } from "react";
import * as Tone from "tone";
import { audio } from "../lib/audio/engine";
import { getStore, useStore, makeId } from "../store";
import { noteRecorder, vocalRecorder } from "../lib/audio/recorder";
import { startPerfTimer } from "../utils/performanceDiagnostics";

/**
 * Hook providing the play/pause/stop/record actions for the transport bar.
 * Centralizing them keeps the keyboard shortcuts and transport buttons
 * behaviorally identical, and lets MIDI Learn invoke the same code paths.
 */

export function useTransport() {
  const audioUnlocked = useStore((s) => s.audioUnlocked);

  // Fingerprint that changes only when clip structure or BPM changes —
  // NOT on fader/mute/name edits. Prevents rescheduling audio on every
  // slider move, which previously caused needless audio glitches.
  const scheduleKey = useStore((s) => {
    const p = s.project;
    return (
      s.transportScheduleRevision +
      '|' +
      p.bpm +
      '|' +
      p.tracks
        .map(
          (t) =>
            t.id +
            ':' +
            t.noteClips
              .map((c) => `${c.id}@${c.start}:${c.length}:${c.notes.length}`)
              .join(',') +
            '/' +
            t.audioClips.map((c) => `${c.id}@${c.start}`).join(','),
        )
        .join(';')
    );
  });

  // Separate mute/solo signal — cheap string comparison, no reschedule.
  const muteKey = useStore((s) =>
    s.project.tracks.map((t) => `${t.id}:${t.muted ? 1 : 0}:${t.solo ? 1 : 0}`).join('|'),
  );

  const ensureUnlocked = useCallback(async () => {
    if (!audioUnlocked) {
      await audio.unlock();
      getStore().set({ audioUnlocked: true });
    }
  }, [audioUnlocked]);

  const play = useCallback(async () => {
    const endTiming = startPerfTimer("transport-play");
    try {
      await ensureUnlocked();
      audio.play();
      getStore().set({ isPlaying: true });
    } finally {
      endTiming();
    }
  }, [ensureUnlocked]);

  const pause = useCallback(() => {
    audio.pause();
    getStore().set({ isPlaying: false });
  }, []);

  const stop = useCallback(async () => {
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
              // Surface the take in the sample preview dialog so the user
              // can trim silence / normalize / fade and save it to the
              // sample library or re-assign it.
              getStore().set({
                pendingSample: {
                  blob: result.blob,
                  defaultName: `${armed.name} take ${new Date().toLocaleTimeString()}`,
                  recordedTrackId: armed.id,
                },
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
    } finally {
      endTiming();
    }
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
      // 1 or 2 bars of metronome accent at current bpm, then start
      audio.setMetronome(true);
      const wasMet = proj.metronome;
      const bpm = proj.bpm;
      const beatMs = (60 / bpm) * 1000;
      const countInBeats = (proj.countInBars ?? 1) * 4;
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
      }, beatMs * countInBeats);
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

  // Schedule existing clips on play. Re-schedule only when clip structure
  // or BPM actually changes (scheduleKey), not on every fader/mute move.
  const scheduledRef = useRef<{ noteIds: number[]; audioPlayers: Array<Tone.Player>; audioIds: number[] }>({
    noteIds: [],
    audioPlayers: [],
    audioIds: [],
  });
  useEffect(() => {
    let cancelled = false;
    const noteIds: number[] = [];
    const audioPlayers: Tone.Player[] = [];
    const audioIds: number[] = [];

    const yieldToBrowser = () =>
      new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    const run = async () => {
      const tracks = getStore().state.project.tracks;
      const keepTrackIds = new Set(tracks.map((t) => t.id));
      for (const id of audio.getActiveTrackIds()) {
        if (cancelled) break;
        if (!keepTrackIds.has(id)) {
          audio.removeTrack(id);
          await yieldToBrowser();
        }
      }
      audio.cancelScheduled([...scheduledRef.current.noteIds, ...scheduledRef.current.audioIds]);
      audio.disposeScheduledAudioPlayers(scheduledRef.current.audioPlayers);

      for (const t of tracks) {
        if (cancelled) break;
        audio.ensureTrack(t);
        for (const c of t.noteClips) {
          if (cancelled) break;
          noteIds.push(...audio.scheduleClip(t, c));
        }
        for (const c of t.audioClips) {
          if (cancelled) break;
          if (c.blob) {
            const r = audio.scheduleAudioClip(t, c);
            if (r) {
              audioIds.push(r.id);
              audioPlayers.push(r.player);
            }
          }
        }
        await yieldToBrowser();
      }

      if (cancelled) {
        audio.cancelScheduled([...noteIds, ...audioIds]);
        audio.disposeScheduledAudioPlayers(audioPlayers);
        return;
      }
      scheduledRef.current = { noteIds, audioPlayers, audioIds };
    };

    const timeoutId = window.setTimeout(() => {
      void run();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      audio.cancelScheduled([...noteIds, ...audioIds]);
      audio.disposeScheduledAudioPlayers(audioPlayers);
    };
  }, [scheduleKey]);

  // Apply mute/solo to engine only when those flags actually change.
  useEffect(() => {
    audio.refreshAllMutes(getStore().state.project.tracks);
  }, [muteKey]);

  return { play, pause, stop, record };
}
