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

type Assign =
  | { kind: "none" }
  | { kind: "track"; trackId: string }
  | { kind: "new-track" }
  | { kind: "pad"; trackId: string; pad: string };

export interface SamplePreviewProps {
  open: boolean;
  blob: Blob | null;
  defaultName: string;
  /** If set, the dialog will not show edit controls (used for post-record quick-review). */
  recordedTrackId?: string;
  onClose: () => void;
}

export function SamplePreviewDialog({
  open,
  blob,
  defaultName,
  recordedTrackId: _recordedTrackId,
  onClose,
}: SamplePreviewProps) {
  void _recordedTrackId;
  const project = useStore((s) => s.project);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionRef = useRef<Region | null>(null);
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
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);

  // (Re)mount wavesurfer when the dialog opens with a new blob.
  useEffect(() => {
    if (!open || !blob || !containerRef.current) return;
    setName(defaultName);
    setNormalize(false);
    setReverse(false);
    setFadeIn(0);
    setFadeOut(0);
    setError(null);
    setWsFailed(false);
    setPreviewBlob(null);
    setAssign({ kind: "none" });
    let ws: WaveSurfer | null = null;
    let regionsPlugin: ReturnType<typeof RegionsPlugin.create> | null = null;
    try {
      regionsPlugin = RegionsPlugin.create();
      ws = WaveSurfer.create({
        container: containerRef.current,
        height: 96,
        waveColor: "rgba(0, 200, 255, 0.6)",
        progressColor: "rgba(0, 200, 255, 0.9)",
        cursorColor: "rgba(255, 60, 90, 0.9)",
        normalize: false,
        plugins: [regionsPlugin],
      });
      wsRef.current = ws;
      const url = URL.createObjectURL(blob);
      ws.on("ready", () => {
        const d = ws!.getDuration();
        setDuration(d);
        setRegion({ start: 0, end: d });
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
      ws.on("error", () => setWsFailed(true));
      ws.load(url).catch(() => setWsFailed(true));
      return () => {
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
  }, [open, blob]);

  // Canvas fallback when wavesurfer fails: render a basic waveform from the
  // decoded AudioBuffer so the user can still see + assign the import.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!wsFailed || !blob || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const buf = await decodeBlob(blob);
        if (cancelled || !canvasRef.current) return;
        setDuration(buf.duration);
        setRegion({ start: 0, end: buf.duration });
        const cv = canvasRef.current;
        const ctx = cv.getContext("2d");
        if (!ctx) return;
        const data = buf.getChannelData(0);
        const w = cv.width;
        const h = cv.height;
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
        }
      } catch (err) {
        setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wsFailed, blob]);

  const onTrimSilence = async () => {
    if (!blob) return;
    setBusy(true);
    setError(null);
    try {
      const buf = await decodeBlob(blob);
      const trimmed = trimSilenceBuffer(buf);
      const newBlob = audioBufferToWavBlob(trimmed);
      setPreviewBlob(newBlob);
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
    setBusy(true);
    setError(null);
    try {
      const { blob: edited, buffer } = await applyEditsToBlob(source, {
        trimStartSec: region.start,
        trimEndSec: region.end,
        normalize,
        reverse,
        fadeInSec: fadeIn,
        fadeOutSec: fadeOut,
      });

      const store = getStore();
      const sampleId = makeId();
      const blobKey = `${store.state.project.id}:sample:${sampleId}`;
      const sample = {
        id: sampleId,
        name: name.trim() || defaultName,
        blobKey,
        durationSec: buffer.duration,
        createdAt: Date.now(),
        blob: edited,
      };
      const samples = [...(store.state.project.samples ?? []), sample];
      store.patchProject({ samples });

      // Apply assignment
      if (assign.kind === "track") {
        store.addAudioClip(assign.trackId, {
          id: makeId(),
          start: 0,
          durationSec: buffer.duration,
          blob: edited,
        });
      } else if (assign.kind === "new-track") {
        const t = makeTrack("vocals", sample.name.slice(0, 16) || "Audio", "clean");
        t.armed = false;
        const next = [...store.state.project.tracks, t];
        store.patchProject({ tracks: next });
        store.addAudioClip(t.id, {
          id: makeId(),
          start: 0,
          durationSec: buffer.duration,
          blob: edited,
        });
      } else if (assign.kind === "pad") {
        // Lightweight pad sample override stored on the track for later
        // engine wiring; for now still saves into the sample library so
        // the user can drag it onto a track manually.
        const padOverrides =
          (
            store.state.project.tracks.find((t) => t.id === assign.trackId) as
              | (typeof store.state.project.tracks[number] & {
                  padSamples?: Record<string, string>;
                })
              | undefined
          )?.padSamples ?? {};
        store.patchTrack(assign.trackId, {
          ...(store.state.project.tracks.find((t) => t.id === assign.trackId) ?? {}),
          padSamples: { ...padOverrides, [assign.pad]: blobKey },
        } as Partial<(typeof store.state.project.tracks)[number]>);
      }

      // Persist immediately so a reload picks up the new sample/blob.
      try {
        await saveProject(getStore().state.project);
      } catch {
        // best-effort
      }
      store.setStatus(`Saved sample “${sample.name}”`, "info");
      onClose();
    } catch (err) {
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
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import sample</DialogTitle>
          <DialogDescription>
            Preview, edit and assign the sample to a track or pad.
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
                ref={canvasRef}
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
              ref={containerRef}
              className="panel-inset rounded p-2 min-h-[112px]"
            />
          )}

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
                  setAssign({ kind: "pad", trackId: tid, pad });
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
                  ["kick", "snare", "clap", "hat"].map((p) => (
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

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={commit} disabled={busy || !blob}>
              {busy ? "Saving…" : "Save sample"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
