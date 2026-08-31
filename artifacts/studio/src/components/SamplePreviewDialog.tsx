import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, {
  type Region,
} from "wavesurfer.js/dist/plugins/regions.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  applyEditsToBlob,
  decodeBlob,
  trimSilence as trimSilenceBuffer,
  audioBufferToWavBlob,
} from "../lib/audio/sampleEdits";
import { useStore, getStore, makeId, makeTrack } from "../store";
import { saveProject } from "../lib/storage/db";
import { startPerfTimer } from "../utils/performanceDiagnostics";
import {
  markSampleImport,
  measureSampleImport,
  timeSampleImport,
} from "../lib/performance/sampleImportTrace";
import {
  assertSampleImportAllowed,
  formatBytes,
  isLargeSample,
} from "../lib/storage/performanceGuards";
import { audio } from "../lib/audio/engine";
import {
  assignDrumPadSampleKey,
  isDrumPadSamplePiece,
} from "../lib/audio/drumPadSamples";
import type { AudioClip, DrumPadSamplePiece, Track } from "../types";

type Assign =
  | { kind: "none" }
  | { kind: "track"; trackId: string }
  | { kind: "new-track" }
  | { kind: "pad"; trackId: string; pad: DrumPadSamplePiece };

const LIGHTWEIGHT_WAVEFORM_BYTES = 2 * 1024 * 1024;
const QUICK_ASSIGN_PAD_PIECES = ["kick", "snare", "clap", "hat"] as const satisfies readonly DrumPadSamplePiece[];

interface SampleCommitReceipt {
  projectId: string;
  projectLoadRevision: number;
  sampleId: string;
  createdTrackId?: string;
  createdClip?: { trackId: string; clipId: string };
  padAssignment?: {
    trackId: string;
    piece: DrumPadSamplePiece;
    appliedBlobKey: string;
    previousBlobKey?: string;
  };
  recordedClip?: {
    trackId: string;
    clipId: string;
    previous: AudioClip;
    appliedBlob: Blob;
  };
}

function rollbackSampleCommit(receipt: SampleCommitReceipt): void {
  const store = getStore();
  if (
    store.state.project.id !== receipt.projectId ||
    store.state.projectLoadRevision !== receipt.projectLoadRevision
  ) return;

  const current = store.state.project;
  let tracks = current.tracks;
  if (receipt.createdTrackId) {
    tracks = tracks.filter((track) => track.id !== receipt.createdTrackId);
  }
  if (receipt.createdClip) {
    tracks = tracks.map((track) =>
      track.id === receipt.createdClip!.trackId
        ? {
            ...track,
            audioClips: track.audioClips.filter(
              (clip) => clip.id !== receipt.createdClip!.clipId,
            ),
          }
        : track,
    );
  }
  if (receipt.padAssignment) {
    const assignment = receipt.padAssignment;
    tracks = tracks.map((track) => {
      if (
        track.id !== assignment.trackId ||
        track.padSamples?.[assignment.piece] !== assignment.appliedBlobKey
      ) return track;
      const padSamples: NonNullable<Track["padSamples"]> = { ...(track.padSamples ?? {}) };
      if (assignment.previousBlobKey) {
        padSamples[assignment.piece] = assignment.previousBlobKey;
      } else {
        delete padSamples[assignment.piece];
      }
      return { ...track, padSamples };
    });
  }
  if (receipt.recordedClip) {
    const recorded = receipt.recordedClip;
    tracks = tracks.map((track) => {
      if (track.id !== recorded.trackId) return track;
      return {
        ...track,
        audioClips: track.audioClips.map((clip) =>
          clip.id === recorded.clipId && clip.blob === recorded.appliedBlob
            ? {
                ...clip,
                blob: recorded.previous.blob,
                blobKey: recorded.previous.blobKey,
                durationSec: recorded.previous.durationSec,
                sourceDurationSec: recorded.previous.sourceDurationSec,
                offsetSec: recorded.previous.offsetSec,
                reversed: recorded.previous.reversed,
              }
            : clip,
        ),
      };
    });
  }

  store.patchProject({
    samples: (current.samples ?? []).filter((sample) => sample.id !== receipt.sampleId),
    tracks,
  });
}

export interface SamplePreviewProps {
  open: boolean;
  blob: Blob | null;
  defaultName: string;
  /** If set, the dialog will not show edit controls (used for post-record quick-review). */
  recordedTrackId?: string;
  /** Exact timeline clip created for a just-recorded take. Saved edits replace
   * this clip's media instead of silently creating an unrelated library copy. */
  recordedClipId?: string;
  onClose: () => void;
}

export function SamplePreviewDialog({
  open,
  blob,
  defaultName,
  recordedTrackId,
  recordedClipId,
  onClose,
}: SamplePreviewProps) {
  const project = useStore((s) => s.project);
  const panicRevision = useStore((s) => s.panicRevision);
  const [waveformHost, setWaveformHost] = useState<HTMLDivElement | null>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionRef = useRef<Region | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [wsFailed, setWsFailed] = useState(false);
  const [duration, setDuration] = useState(0);
  const [region, setRegion] = useState<{ start: number; end: number }>({
    start: 0,
    end: 0,
  });
  const [name, setName] = useState(defaultName);
  const [normalize, setNormalize] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  // For just-recorded takes the clip is already placed on the timeline,
  // so default to "library only" to avoid creating a duplicate clip at
  // beat 0. For imports, also default to library so nothing surprising
  // happens until the user opts in.
  const [assign, setAssign] = useState<Assign>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [decodeState, setDecodeState] = useState<"decoding" | "ready" | "error">("decoding");
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [fallbackCanvas, setFallbackCanvas] = useState<HTMLCanvasElement | null>(null);
  const importTokenRef = useRef(0);

  // The waveform renderer is visual; this dedicated media element is the
  // authoritative audible preview and works for both small and large files.
  const audiblePreviewBlob = previewBlob ?? blob;
  useEffect(() => {
    const player = previewAudioRef.current;
    if (!open || !audiblePreviewBlob) {
      player?.pause();
      setPreviewUrl(null);
      setIsPreviewPlaying(false);
      return;
    }
    const url = URL.createObjectURL(audiblePreviewBlob);
    setPreviewUrl(url);
    setIsPreviewPlaying(false);
    return () => {
      player?.pause();
      URL.revokeObjectURL(url);
    };
  }, [audiblePreviewBlob, open]);

  useEffect(() => {
    previewAudioRef.current?.pause();
    setIsPreviewPlaying(false);
  }, [panicRevision]);

  const stopPreview = () => {
    const player = previewAudioRef.current;
    if (!player) return;
    player.pause();
    setIsPreviewPlaying(false);
  };

  const togglePreview = async () => {
    const player = previewAudioRef.current;
    if (!player || !previewUrl) return;
    if (!player.paused) {
      stopPreview();
      return;
    }
    if (
      region.end > region.start &&
      (player.currentTime < region.start || player.currentTime >= region.end)
    ) {
      player.currentTime = region.start;
    }
    try {
      await player.play();
    } catch (err) {
      setError(`Sample preview unavailable: ${(err as Error).message}`);
      setIsPreviewPlaying(false);
    }
  };

  const closeDialog = () => {
    stopPreview();
    onClose();
  };

  // (Re)mount wavesurfer when the dialog opens with a new blob.
  useEffect(() => {
    if (!open || !blob) return;
    markSampleImport("preview-open", { bytes: blob.size, type: blob.type });
    setName(defaultName);
    setNormalize(false);
    setReverse(false);
    setFadeIn(0);
    setFadeOut(0);
    setDuration(0);
    setRegion({ start: 0, end: 0 });
    setDecodeState("decoding");
    setError(null);
    setWarning(null);
    try {
      assertSampleImportAllowed(blob);
      if (isLargeSample(blob)) {
        setWarning(
          `Large sample (${formatBytes(blob.size)}). Waveform and edits may take longer; autosave waits for the import to finish.`,
        );
      }
    } catch (err) {
      setDecodeState("error");
      setError((err as Error).message);
      return;
    }
    setWsFailed(false);
    setPreviewBlob(null);
    setAssign({ kind: "none" });
    if (blob.size >= LIGHTWEIGHT_WAVEFORM_BYTES) {
      markSampleImport("wavesurfer-skip-large", { bytes: blob.size, type: blob.type });
      setWsFailed(true);
      return;
    }
    if (!waveformHost) return;
    let ws: WaveSurfer | null = null;
    let regionsPlugin: ReturnType<typeof RegionsPlugin.create> | null = null;
    const token = ++importTokenRef.current;
    try {
      regionsPlugin = RegionsPlugin.create();
      ws = WaveSurfer.create({
        container: waveformHost,
        height: 96,
        waveColor: "rgba(0, 200, 255, 0.6)",
        progressColor: "rgba(0, 200, 255, 0.9)",
        cursorColor: "rgba(255, 60, 90, 0.9)",
        normalize: false,
        plugins: [regionsPlugin],
      });
      wsRef.current = ws;
      markSampleImport("object-url:create", { bytes: blob.size, type: blob.type });
      const url = URL.createObjectURL(blob);
      const endWaveformTiming = startPerfTimer("waveform-generation", {
        source: "WaveSurfer",
        bytes: blob.size,
        type: blob.type,
      });
      let waveformTimingEnded = false;
      const endWaveformOnce = () => {
        if (waveformTimingEnded) return;
        waveformTimingEnded = true;
        endWaveformTiming();
      };
      ws.on("ready", () => {
        if (token !== importTokenRef.current) return;
        endWaveformOnce();
        markSampleImport("wavesurfer-ready", { bytes: blob.size, type: blob.type });
        const d = ws!.getDuration();
        setDuration(d);
        setRegion({ start: 0, end: d });
        setDecodeState("ready");
        const r = regionsPlugin!.addRegion({
          start: 0,
          end: d,
          color: "rgba(255, 60, 90, 0.15)",
          drag: true,
          resize: true,
        });
        regionRef.current = r;
        r.on("update-end", () => {
          setRegion({ start: r.start, end: r.end });
        });
      });
      ws.on("error", () => {
        if (token !== importTokenRef.current) return;
        endWaveformOnce();
        markSampleImport("wavesurfer-error", { bytes: blob.size, type: blob.type });
        setWsFailed(true);
      });
      ws.load(url).catch(() => {
        if (token !== importTokenRef.current) return;
        endWaveformOnce();
        markSampleImport("wavesurfer-load-error", { bytes: blob.size, type: blob.type });
        setWsFailed(true);
      });
      return () => {
        importTokenRef.current++;
        endWaveformOnce();
        markSampleImport("object-url:revoke", { bytes: blob.size, type: blob.type });
        URL.revokeObjectURL(url);
        try {
          ws?.destroy();
        } catch {
          // ignore
        }
        wsRef.current = null;
        regionRef.current = null;
      };
    } catch {
      setWsFailed(true);
    }
    return () => {
      try {
        ws?.destroy();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, blob, waveformHost]);

  // Canvas fallback when wavesurfer fails: render a basic waveform from the
  // decoded AudioBuffer so the user can still see + assign the import.
  useEffect(() => {
    if (!wsFailed || !blob || !fallbackCanvas) return;
    setDecodeState("decoding");
    markSampleImport("fallback-waveform:start", { bytes: blob.size, type: blob.type });
    let cancelled = false;
    const token = ++importTokenRef.current;
    (async () => {
      const endTiming = startPerfTimer("waveform-generation", {
        source: "SamplePreviewDialog fallback",
        bytes: blob.size,
        type: blob.type,
      });
      try {
        const buf = await timeSampleImport(
          "audio-decode",
          () => decodeBlob(blob),
          { bytes: blob.size, type: blob.type },
        );
        if (cancelled || token !== importTokenRef.current) return;
        markSampleImport("audio-decode:accepted", {
          bytes: blob.size,
          durationSec: Math.round(buf.duration * 100) / 100,
        });
        setDuration(buf.duration);
        setRegion({ start: 0, end: buf.duration });
        setDecodeState("ready");
        const cv = fallbackCanvas;
        const ctx = cv.getContext("2d");
        if (!ctx) return;
        const data = buf.getChannelData(0);
        const w = cv.width;
        const h = cv.height;
        await yieldToBrowser();
        const peaksStart = performance.now();
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "rgba(0, 200, 255, 0.6)";
        const step = Math.max(1, Math.floor(data.length / w));
        for (let x = 0; x < w; x++) {
          let min = 1;
          let max = -1;
          for (let j = 0; j < step; j++) {
            const v = data[x * step + j] ?? 0;
            if (v < min) min = v;
            if (v > max) max = v;
          }
          const y1 = ((1 - max) / 2) * h;
          const y2 = ((1 - min) / 2) * h;
          ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
          if (x > 0 && x % 64 === 0) await yieldToBrowser();
        }
        measureSampleImport("waveform-peak-generation", peaksStart, {
          bytes: blob.size,
          columns: w,
          step,
        });
      } catch (err) {
        markSampleImport("fallback-waveform:error", {
          bytes: blob.size,
          error: (err as Error).message,
        });
        setDecodeState("error");
        setError((err as Error).message);
      } finally {
        endTiming();
        markSampleImport("fallback-waveform:end", { bytes: blob.size, type: blob.type });
      }
    })();
    return () => {
      cancelled = true;
      importTokenRef.current++;
    };
  }, [wsFailed, blob, fallbackCanvas]);

  const onTrimSilence = async () => {
    if (!blob) return;
    const token = importTokenRef.current;
    const store = getStore();
    const projectId = store.state.project.id;
    const projectLoadRevision = store.state.projectLoadRevision;
    stopPreview();
    setBusy(true);
    setError(null);
    try {
      const buf = await decodeBlob(blob);
      if (
        token !== importTokenRef.current ||
        store.state.project.id !== projectId ||
        store.state.projectLoadRevision !== projectLoadRevision
      ) return;
      const trimmed = trimSilenceBuffer(buf);
      const newBlob = audioBufferToWavBlob(trimmed);
      setPreviewBlob(newBlob);
      setDecodeState("ready");
      // Re-render wavesurfer with the trimmed blob
      if (wsRef.current) {
        const url = URL.createObjectURL(newBlob);
        await wsRef.current.load(url).catch(() => setWsFailed(true));
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setRegion({ start: 0, end: trimmed.duration });
      setDuration(trimmed.duration);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    const source = previewBlob ?? blob;
    if (!source) return;
    if (decodeState !== "ready") {
      setError("Wait for audio validation to finish before saving or assigning this sample.");
      return;
    }
    const store = getStore();
    const projectId = store.state.project.id;
    const projectLoadRevision = store.state.projectLoadRevision;
    const isCurrentProject = () =>
      store.state.project.id === projectId &&
      store.state.projectLoadRevision === projectLoadRevision;
    let receipt: SampleCommitReceipt | null = null;
    let stateMutated = false;
    markSampleImport("commit:start", {
      bytes: source.size,
      edited: source !== blob,
      assign: assign.kind,
    });
    setBusy(true);
    setError(null);
    try {
      const hasEdits =
        normalize ||
        reverse ||
        fadeIn > 0 ||
        fadeOut > 0 ||
        region.start > 0.001 ||
        (duration > 0 && Math.abs(region.end - duration) > 0.001);
      const editedResult = hasEdits
        ? await timeSampleImport(
            "apply-edits",
            () =>
              applyEditsToBlob(source, {
                trimStartSec: region.start,
                trimEndSec: region.end,
                normalize,
                reverse,
                fadeInSec: fadeIn,
                fadeOutSec: fadeOut,
              }),
            { bytes: source.size },
          )
        : null;
      const edited = editedResult?.blob ?? source;
      const sampleDuration = editedResult?.buffer.duration ?? duration;
      if (!isCurrentProject()) return;
      if (!Number.isFinite(sampleDuration) || sampleDuration <= 0) {
        throw new Error("The selected file did not decode into playable audio.");
      }

      const baseProject = store.state.project;
      const previousSamples = baseProject.samples ?? [];
      const previousTracks = baseProject.tracks;
      const assignedTrack =
        assign.kind === "track" || assign.kind === "pad"
          ? previousTracks.find((track) => track.id === assign.trackId)
          : undefined;
      if (assign.kind === "track" && assignedTrack?.kind !== "vocals") {
        throw new Error("The selected audio track is no longer available.");
      }
      if (assign.kind === "pad" && assignedTrack?.kind !== "drums") {
        throw new Error("The selected drum pad is no longer available.");
      }
      const recordedTrack =
        recordedTrackId && recordedClipId
          ? previousTracks.find((track) => track.id === recordedTrackId)
          : undefined;
      const previousRecordedClip = recordedTrack?.audioClips.find(
        (clip) => clip.id === recordedClipId,
      );
      if (recordedClipId && (!recordedTrack || !previousRecordedClip)) {
        throw new Error("The recorded take is no longer available on this project.");
      }

      const sampleId = makeId();
      const blobKey = `${baseProject.id}:sample:${sampleId}`;
      const sample = {
        id: sampleId,
        name: name.trim() || defaultName,
        blobKey,
        durationSec: sampleDuration,
        createdAt: Date.now(),
        blob: edited,
      };
      const samples = [...previousSamples, sample];
      let tracks: Track[] = previousTracks;
      receipt = { projectId, projectLoadRevision, sampleId };

      // A recorded review owns the exact timeline clip created by Stop. Edits
      // replace that clip's media; the new sample entry is the reusable copy.
      if (recordedTrack && previousRecordedClip && recordedClipId) {
        tracks = tracks.map((track) =>
          track.id === recordedTrack.id
            ? {
                ...track,
                audioClips: track.audioClips.map((clip) =>
                  clip.id === recordedClipId
                    ? {
                        ...clip,
                        blob: edited,
                        durationSec: sampleDuration,
                        sourceDurationSec: sampleDuration,
                        offsetSec: 0,
                        reversed: reverse ? false : clip.reversed,
                      }
                    : clip,
                ),
              }
            : track,
        );
        receipt.recordedClip = {
          trackId: recordedTrack.id,
          clipId: recordedClipId,
          previous: previousRecordedClip,
          appliedBlob: edited,
        };
      }

      // Apply any explicit secondary assignment in the same project mutation.
      if (assign.kind === "track") {
        const clipId = makeId();
        const assignedClip: AudioClip = {
          id: clipId,
          start: 0,
          durationSec: sampleDuration,
          sourceDurationSec: sampleDuration,
          blob: edited,
          blobKey: `${baseProject.id}:${assign.trackId}:${clipId}`,
        };
        tracks = tracks.map((track) =>
          track.id === assign.trackId
            ? { ...track, audioClips: [...track.audioClips, assignedClip] }
            : track,
        );
        receipt.createdClip = { trackId: assign.trackId, clipId };
      } else if (assign.kind === "new-track") {
        const t = makeTrack("vocals", sample.name.slice(0, 16) || "Audio", "clean");
        t.armed = false;
        const clipId = makeId();
        t.audioClips = [{
          id: clipId,
          start: 0,
          durationSec: sampleDuration,
          sourceDurationSec: sampleDuration,
          blob: edited,
          blobKey: `${baseProject.id}:${t.id}:${clipId}`,
        }];
        tracks = [...tracks, t];
        receipt.createdTrackId = t.id;
      } else if (assign.kind === "pad") {
        if (!assignedTrack) {
          throw new Error("The selected drum pad is no longer available.");
        }
        tracks = tracks.map((track) =>
          track.id === assign.trackId
            ? {
                ...track,
                padSamples: assignDrumPadSampleKey(track, assign.pad, blobKey),
              }
            : track,
        );
        receipt.padAssignment = {
          trackId: assign.trackId,
          piece: assign.pad,
          appliedBlobKey: blobKey,
          previousBlobKey: assignedTrack.padSamples?.[assign.pad],
        };
      }

      if (!isCurrentProject()) return;
      const stateStart = performance.now();
      store.patchProject({ samples, tracks });
      stateMutated = true;
      measureSampleImport("ui-state:update-project", stateStart, {
        samples: samples.length,
        bytes: edited.size,
      });

      // Persist immediately so a reload picks up the new sample/blob.
      try {
        const projectToSave = store.state.project;
        await timeSampleImport(
          "project-save",
          () => saveProject(projectToSave),
          { samples: samples.length, bytes: edited.size },
        );
      } catch (saveError) {
        if (stateMutated && receipt && isCurrentProject()) {
          rollbackSampleCommit(receipt);
        }
        throw new Error(
          `Sample could not be saved: ${(saveError as Error).message}`,
        );
      }
      if (!isCurrentProject()) return;

      const currentProject = store.state.project;
      const padStillAssigned = receipt.padAssignment
        ? currentProject.tracks.find((track) => track.id === receipt!.padAssignment!.trackId)
            ?.padSamples?.[receipt.padAssignment.piece] === receipt.padAssignment.appliedBlobKey
        : false;
      if (receipt.padAssignment && padStillAssigned) {
        // Chop and per-pad assignment share a trigger path. The durable pad
        // save is now authoritative, so only now relinquish Chop ownership.
        audio.releaseChopKitForTrack(receipt.padAssignment.trackId);
      }
      const recordedTakeUpdated = receipt.recordedClip
        ? currentProject.tracks
            .find((track) => track.id === receipt!.recordedClip!.trackId)
            ?.audioClips.some(
              (clip) =>
                clip.id === receipt!.recordedClip!.clipId &&
                clip.blob === receipt!.recordedClip!.appliedBlob,
            ) ?? false
        : false;
      const assignmentStatus =
        assign.kind === "pad" && padStillAssigned
          ? ` and assigned it to ${assignedTrack!.name} ${assign.pad}`
          : assign.kind === "track"
            ? ` and placed it on ${assignedTrack!.name}`
            : assign.kind === "new-track"
              ? " on a new audio track"
              : " to the sample library";
      const recordedStatus = recordedTakeUpdated
        ? ` and updated the recorded take on ${recordedTrack!.name}`
        : "";
      store.setStatus(`Saved sample “${sample.name}”${assignmentStatus}${recordedStatus}`, "info");
      markSampleImport("commit:end", { bytes: edited.size, assign: assign.kind });
      closeDialog();
    } catch (err) {
      if (!isCurrentProject()) return;
      markSampleImport("commit:error", {
        bytes: source.size,
        error: (err as Error).message,
      });
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const drumTracks = project.tracks.filter((t) => t.kind === "drums");
  const audioTracks = project.tracks.filter((t) => t.kind === "vocals");

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) closeDialog();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{recordedClipId ? "Review recorded take" : "Import sample"}</DialogTitle>
          <DialogDescription>
            {recordedClipId
              ? "Preview and edit this take. Saving updates its timeline clip and also keeps a reusable library copy."
              : "Preview, edit and assign the sample to a track or pad."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground w-16">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>

          {wsFailed ? (
            <div className="panel-inset rounded p-2">
              <canvas
                ref={setFallbackCanvas}
                width={640}
                height={96}
                className="w-full h-24 block"
              />
              <p className="text-[10px] text-muted-foreground font-mono mt-1">
                Waveform engine unavailable — using fallback preview. Region
                edits work via the sliders below.
              </p>
            </div>
          ) : (
            <div
              ref={setWaveformHost}
              className="panel-inset rounded p-2 min-h-[112px]"
            />
          )}

          <div className="flex items-center gap-3">
            <audio
              ref={previewAudioRef}
              src={previewUrl ?? undefined}
              preload="metadata"
              className="hidden"
              data-testid="sample-preview-audio"
              onPlay={() => setIsPreviewPlaying(true)}
              onPause={() => setIsPreviewPlaying(false)}
              onEnded={() => setIsPreviewPlaying(false)}
              onLoadedMetadata={(event) => {
                const mediaDuration = event.currentTarget.duration;
                if (!Number.isFinite(mediaDuration) || mediaDuration <= 0) return;
                setDuration((current) => current || mediaDuration);
                setRegion((current) =>
                  current.end > current.start
                    ? current
                    : { start: 0, end: mediaDuration },
                );
              }}
              onTimeUpdate={(event) => {
                const player = event.currentTarget;
                if (region.end <= region.start || player.currentTime < region.end) return;
                player.pause();
                player.currentTime = region.start;
              }}
              onError={() => {
                setIsPreviewPlaying(false);
                setError("This browser could not play the selected sample format.");
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void togglePreview()}
              disabled={busy || !previewUrl}
              data-testid="sample-preview-toggle"
            >
              {isPreviewPlaying ? "Stop preview" : "Play preview"}
            </Button>
            <span className="font-mono text-[10px] text-muted-foreground">
              Plays the selected trim region
            </span>
          </div>

          {duration > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Trim start ({region.start.toFixed(2)}s)
                </label>
                <Slider
                  value={[region.start]}
                  min={0}
                  max={Math.max(0.01, region.end - 0.05)}
                  step={0.01}
                  onValueChange={([v]) => {
                    const start = v ?? 0;
                    setRegion((r) => ({ ...r, start }));
                    regionRef.current?.setOptions({ start });
                  }}
                />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Trim end ({region.end.toFixed(2)}s)
                </label>
                <Slider
                  value={[region.end]}
                  min={Math.min(duration, region.start + 0.05)}
                  max={duration}
                  step={0.01}
                  onValueChange={([v]) => {
                    const end = v ?? duration;
                    setRegion((r) => ({ ...r, end }));
                    regionRef.current?.setOptions({ end });
                  }}
                />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Fade in ({fadeIn.toFixed(2)}s)
                </label>
                <Slider
                  value={[fadeIn]}
                  min={0}
                  max={Math.min(2, (region.end - region.start) / 2)}
                  step={0.01}
                  onValueChange={([v]) => setFadeIn(v ?? 0)}
                />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  Fade out ({fadeOut.toFixed(2)}s)
                </label>
                <Slider
                  value={[fadeOut]}
                  min={0}
                  max={Math.min(2, (region.end - region.start) / 2)}
                  step={0.01}
                  onValueChange={([v]) => setFadeOut(v ?? 0)}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
            <label className="flex items-center gap-2">
              <Switch checked={normalize} onCheckedChange={setNormalize} />
              Normalize
            </label>
            <label className="flex items-center gap-2">
              <Switch checked={reverse} onCheckedChange={setReverse} />
              Reverse
            </label>
            <Button
              size="sm"
              variant="outline"
              onClick={onTrimSilence}
              disabled={busy}
            >
              Trim silence
            </Button>
          </div>

          <div className="border-t border-border pt-3 space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Assign to
            </div>
            <Select
              disabled={busy || decodeState !== "ready"}
              value={
                assign.kind === "none"
                  ? "library"
                  : assign.kind === "new-track"
                    ? "new-track"
                    : assign.kind === "track"
                      ? `track:${assign.trackId}`
                      : `pad:${assign.trackId}:${assign.pad}`
              }
              onValueChange={(v) => {
                if (v === "library") setAssign({ kind: "none" });
                else if (v === "new-track") setAssign({ kind: "new-track" });
                else if (v.startsWith("track:"))
                  setAssign({ kind: "track", trackId: v.slice(6) });
                else if (v.startsWith("pad:")) {
                  const [, tid, pad] = v.split(":");
                  if (tid && pad && isDrumPadSamplePiece(pad)) {
                    setAssign({ kind: "pad", trackId: tid, pad });
                  } else {
                    setError("That drum-pad assignment is not available.");
                  }
                }
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="library">Sample library only</SelectItem>
                <SelectItem value="new-track">New audio track</SelectItem>
                {audioTracks.map((t) => (
                  <SelectItem key={t.id} value={`track:${t.id}`}>
                    Place on track: {t.name}
                  </SelectItem>
                ))}
                {drumTracks.flatMap((t) =>
                  QUICK_ASSIGN_PAD_PIECES.map((p) => (
                    <SelectItem
                      key={`${t.id}:${p}`}
                      value={`pad:${t.id}:${p}`}
                    >
                      Assign to {t.name} pad: {p}
                    </SelectItem>
                  )),
                )}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p className="text-xs text-destructive font-mono">{error}</p>
          )}
          {warning && !error && (
            <p className="text-xs text-amber-300 font-mono">{warning}</p>
          )}
          {decodeState === "decoding" && !error && (
            <p className="text-xs text-muted-foreground font-mono" data-testid="sample-decode-status">
              Validating audio… Save and assignment unlock after decoding succeeds.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={closeDialog} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={commit}
              disabled={busy || !blob || decodeState !== "ready"}
            >
              {busy ? "Saving…" : recordedClipId ? "Save take & sample" : "Save sample"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
