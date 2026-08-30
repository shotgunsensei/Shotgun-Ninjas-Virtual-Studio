/**
 * Chop Lab — Sample Chopper panel for the Shotgun Ninjas Virtual Studio.
 *
 * Zones:
 *   Top   — waveform canvas + transient detection controls + sample loader
 *   Middle — 16-pad grid
 *   Bottom — per-slice controls + actions (Slice Pattern, Export Kit, Use as Kit)
 */
import * as Tone from "tone";
import { useCallback, useEffect, useRef, useState } from "react";
import { getStore, useStore } from "../../store";
import { DEFAULT_SLICE_SETTING, detectTransients, estimateBpm, getChopEngine, renderSliceToWav } from "../../lib/audio/chopEngine";
import type { ChopSliceSetting } from "../../lib/audio/chopEngine";
import { makeId } from "../../store";
import { audio } from "../../lib/audio/engine";
import type { Track, NoteEvent, NoteClip } from "../../types";
import { MidiLearnButton } from "../MidiLearnButton";
import { startPerfTimer } from "../../utils/performanceDiagnostics";
import {
  assertSampleImportAllowed,
  formatBytes,
  isLargeSample,
} from "../../lib/storage/performanceGuards";

// ---- keyboard map: 1-8 = pads 0-7, q-i = pads 8-15 ----
const PAD_KEYS: Record<string, number> = {
  "1": 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6, "8": 7,
  "q": 8, "w": 9, "e": 10, "r": 11, "t": 12, "y": 13, "u": 14, "i": 15,
};

const PAD_KEY_LABELS: Record<number, string> = {
  0: "1", 1: "2", 2: "3", 3: "4", 4: "5", 5: "6", 6: "7", 7: "8",
  8: "Q", 9: "W", 10: "E", 11: "R", 12: "T", 13: "Y", 14: "U", 15: "I",
};

const CHOKE_COLORS: Record<string, string> = {
  A: "#ef4444",
  B: "#f97316",
  C: "#22c55e",
  D: "#3b82f6",
};

export function ChopLab({ track }: { track: Track }) {
  const chopLab = useStore((s) => s.chopLab);
  const projectBpm = useStore((s) => s.project.bpm);
  const project = useStore((s) => s.project);
  const { markers, sliceSettings, activeSliceIndex, sensitivity, sampleBpm, syncToBpm } = chopLab;

  // Non-serializable AudioBuffer lives here, not in the store.
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const [sampleName, setSampleName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [playingPads, setPlayingPads] = useState<Set<number>>(new Set());
  const [patternAlgo, setPatternAlgo] = useState<"linear" | "euclidean" | "random">("linear");
  // "needs-relink" is shown when the project has chopLab state but the
  // blob couldn't be found in IDB (e.g. the project was imported without
  // the blob embedded, or IDB was cleared).
  const [relinkNeeded, setRelinkNeeded] = useState(false);

  const engine = getChopEngine();
  const loadTokenRef = useRef(0);

  // Keep engine tempo-sync state in sync with store.
  useEffect(() => {
    engine.setTempoSync(syncToBpm, sampleBpm, projectBpm);
  }, [syncToBpm, sampleBpm, projectBpm]);

  // Restore persisted ChopLab state when the project loads.  We decode
  // the sample blob from IDB back into an AudioBuffer so the waveform
  // and engine come back to life without the user doing anything.
  const restoredForProjectRef = useRef<string | null>(null);
  useEffect(() => {
    const cl = project.chopLab;
    if (!cl || restoredForProjectRef.current === project.id) return;
    restoredForProjectRef.current = project.id;

    if (!cl.sampleBlob) {
      // Markers/settings exist but blob is gone — prompt the user to relink.
      if (cl.sampleBlobKey) {
        setRelinkNeeded(true);
        setSampleName(cl.sampleName ?? null);
      }
      return;
    }

    // Decode the stored blob back to an AudioBuffer.
    const token = ++loadTokenRef.current;
    (async () => {
      try {
        assertSampleImportAllowed(cl.sampleBlob!);
        const arrayBuffer = await cl.sampleBlob!.arrayBuffer();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawCtx: AudioContext = (Tone.getContext().rawContext as any);
        const decoded = await rawCtx.decodeAudioData(arrayBuffer);
        if (token !== loadTokenRef.current) return;
        audioBufferRef.current = decoded;
        setSampleName(cl.sampleName ?? null);
        setRelinkNeeded(false);
        getStore().setStatus(`Chop Lab restored: ${cl.sampleName ?? "sample"}`, "info");
      } catch {
        setRelinkNeeded(true);
        setSampleName(cl.sampleName ?? null);
      }
    })();
  // Only run when the project id changes (i.e. a new project was loaded).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // Derive slices boundaries from markers + buffer duration.
  const sliceBoundaries = (() => {
    const buf = audioBufferRef.current;
    if (!buf) return [];
    const dur = buf.duration;
    const sorted = [0, ...markers.filter((m) => m > 0 && m < dur)].sort((a, b) => a - b);
    const boundaries: { start: number; end: number; index: number }[] = [];
    for (let i = 0; i < sorted.length && i < 16; i++) {
      boundaries.push({ start: sorted[i], end: sorted[i + 1] ?? dur, index: i });
    }
    return boundaries;
  })();
  const sliceCount = sliceBoundaries.length;

  // Reload engine when buffer, markers, or settings change.
  const reloadEngine = useCallback(() => {
    const buf = audioBufferRef.current;
    if (!buf) return;
    const settings = sliceSettings.length >= sliceCount
      ? sliceSettings.slice(0, sliceCount)
      : Array.from({ length: sliceCount }, (_, i) => sliceSettings[i] ?? { ...DEFAULT_SLICE_SETTING });
    engine.loadBuffer(buf, markers, settings);
  }, [markers, sliceSettings, sliceCount]);

  useEffect(() => {
    if (audioBufferRef.current) reloadEngine();
  }, [reloadEngine]);

  // Keyboard shortcuts for pads.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const idx = PAD_KEYS[e.key.toLowerCase()];
      if (idx === undefined || idx >= sliceCount) return;
      triggerPad(idx);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sliceCount]);

  function triggerPad(index: number) {
    engine.triggerSlice(index);
    setPlayingPads((p) => new Set([...p, index]));
    // Flash for 200ms.
    setTimeout(() => {
      setPlayingPads((p) => {
        const next = new Set(p);
        next.delete(index);
        return next;
      });
    }, 200);
    getStore().patchChopLab({ activeSliceIndex: index });
  }

  // ---- Sample loading ----
  async function loadFile(file: File) {
    const token = ++loadTokenRef.current;
    const endTiming = startPerfTimer("sample-import", {
      source: "ChopLab",
      bytes: file.size,
      type: file.type,
    });
    setLoadError(null);
    setSampleName(null);
    setRelinkNeeded(false);
    try {
      assertSampleImportAllowed(file);
      if (isLargeSample(file)) {
        getStore().setStatus(
          `Large Chop Lab sample (${formatBytes(file.size)}). Loading may take a moment.`,
          "warn",
        );
      }
      const arrayBuffer = await file.arrayBuffer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawCtx: AudioContext = (Tone.getContext().rawContext as any);
      const decoded = await rawCtx.decodeAudioData(arrayBuffer.slice(0));
      if (token !== loadTokenRef.current) return;
      audioBufferRef.current = decoded;
      setSampleName(file.name);
      // Auto-estimate BPM from the loaded sample.
      const detectedBpm = estimateBpm(decoded);
      // Persist the raw Blob + name on the project so the next save stores it.
      // Also resets markers and records the detected BPM.
      getStore().setChopLabSample(file, file.name, detectedBpm);
      engine.loadBuffer(decoded, [], []);
      getStore().setStatus(`Sample loaded: ${file.name} · detected ~${detectedBpm} BPM`, "info");
    } catch (err) {
      setLoadError((err as Error).message || "Failed to decode audio. Try a WAV or MP3 file.");
    } finally {
      endTiming();
    }
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) await loadFile(file);
  };

  const onFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await loadFile(file);
    e.target.value = "";
  };

  // ---- Transient detection ----
  function runTransientDetection() {
    const buf = audioBufferRef.current;
    if (!buf) return;
    const found = detectTransients(buf, sensitivity);
    getStore().setChopLabMarkers(found);
    engine.loadBuffer(buf, found, getStore().state.chopLab.sliceSettings);
    getStore().setStatus(`Detected ${found.length} transients → ${found.length + 1} slices`, "info");
  }

  // ---- Slice pattern generator ----
  function generateSlicePattern() {
    if (sliceCount === 0) return;
    const drumTrack = track;
    const totalSteps = 16;
    const stepBeats = 0.25;
    const notes: NoteEvent[] = [];

    // Map slice indices to drum-piece strings (for the 9 standard pieces).
    const PIECES = ["kick", "snare", "hat", "ohat", "clap", "tomLow", "tomHigh", "crash", "fx"];

    if (patternAlgo === "linear") {
      // Distribute slices linearly across 16 steps.
      for (let step = 0; step < totalSteps; step++) {
        const sliceIdx = step % sliceCount;
        const piece = PIECES[sliceIdx] ?? "kick";
        notes.push({ time: step * stepBeats, note: piece, duration: stepBeats, velocity: 0.85 });
      }
    } else if (patternAlgo === "euclidean") {
      // Euclidean distribution of slices across 16 steps.
      const hits = Math.min(sliceCount, 8);
      for (let step = 0; step < totalSteps; step++) {
        if ((step * hits) % totalSteps < hits) {
          const sliceIdx = Math.floor((step * sliceCount) / totalSteps) % sliceCount;
          const piece = PIECES[sliceIdx] ?? "kick";
          notes.push({ time: step * stepBeats, note: piece, duration: stepBeats, velocity: 0.85 });
        }
      }
    } else {
      // Random distribution.
      const seed = Date.now();
      let rng = seed;
      const lcg = () => {
        rng = (rng * 1664525 + 1013904223) & 0xffffffff;
        return (rng >>> 0) / 0x100000000;
      };
      for (let step = 0; step < totalSteps; step++) {
        if (lcg() > 0.4) {
          const sliceIdx = Math.floor(lcg() * sliceCount);
          const piece = PIECES[sliceIdx] ?? "kick";
          notes.push({ time: step * stepBeats, note: piece, duration: stepBeats, velocity: 0.85 });
        }
      }
    }

    const existingClipId = drumTrack.noteClips[0]?.id ?? makeId();
    const clip: NoteClip = { id: existingClipId, start: 0, length: totalSteps * stepBeats, notes };
    getStore().updateNoteClip(drumTrack.id, clip);
    getStore().setStatus(`Slice pattern (${patternAlgo}) loaded into sequencer`, "info");
  }

  // ---- Export Kit ----
  async function exportKit() {
    const buf = audioBufferRef.current;
    if (!buf || sliceCount === 0) return;
    setIsExporting(true);
    getStore().setStatus("Rendering slices…", "info");
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (let i = 0; i < sliceCount; i++) {
        const boundary = sliceBoundaries[i];
        if (!boundary) continue;
        const s = sliceSettings[i] ?? DEFAULT_SLICE_SETTING;
        const wav = await renderSliceToWav(buf, boundary.start, boundary.end, s);
        const num = String(i + 1).padStart(2, "0");
        zip.file(`slice_${num}.wav`, wav);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `chop_kit_${sampleName?.replace(/\.[^.]+$/, "") ?? "export"}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      getStore().setStatus(`Kit exported — ${sliceCount} slices`, "info");
    } catch (err) {
      getStore().setStatus("Export failed", "error");
    } finally {
      setIsExporting(false);
    }
  }

  // ---- Use as Kit ----
  function useAsKit() {
    if (sliceCount === 0) return;
    // Generate a linear pattern and activate ChopEngine routing.
    setPatternAlgo("linear");
    generateSlicePattern();
    audio.setChopKitForTrack(track.id);
    getStore().setStatus("Chop Lab kit is now the active drum voice — play or use sequencer", "info");
  }

  const hasBuffer = !!audioBufferRef.current;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-widest text-primary">
          Chop Lab
        </span>
        <span className="font-mono text-[9px] text-muted-foreground">
          {sampleName ? sampleName : "No sample loaded"}
        </span>
      </div>

      {/* Re-link prompt — shown when markers exist but the sample blob is missing */}
      {relinkNeeded && !hasBuffer && (
        <RelinkPrompt
          sampleName={sampleName}
          onFileInput={onFileInput}
          onDrop={onDrop}
        />
      )}

      {/* Sample Loader — hidden while relink prompt is active */}
      {!relinkNeeded && (
        <SampleLoader
          onDrop={onDrop}
          onFileInput={onFileInput}
          hasBuffer={hasBuffer}
          error={loadError}
          sampleName={sampleName}
        />
      )}

      {/* Waveform + Transient Controls */}
      {hasBuffer && (
        <>
          <WaveformCanvas
            audioBuffer={audioBufferRef.current!}
            markers={markers}
            sliceCount={sliceCount}
          />
          <TransientControls
            sensitivity={sensitivity}
            onSensitivityChange={(v) => getStore().patchChopLab({ sensitivity: v })}
            onDetect={runTransientDetection}
          />
          <TempoSyncControls
            syncToBpm={syncToBpm}
            sampleBpm={sampleBpm}
            projectBpm={projectBpm}
            onToggleSync={() => getStore().patchChopLab({ syncToBpm: !syncToBpm })}
            onSampleBpmChange={(v) => getStore().patchChopLab({ sampleBpm: v })}
            onDetectBpm={() => {
              const buf = audioBufferRef.current;
              if (!buf) return;
              const detected = estimateBpm(buf);
              getStore().patchChopLab({ sampleBpm: detected });
              getStore().setStatus(`BPM re-detected: ~${detected}`, "info");
            }}
          />
        </>
      )}

      {/* 16-Pad Grid */}
      <div className="grid grid-cols-4 gap-1.5">
        {Array.from({ length: 16 }, (_, i) => {
          const hasSlice = i < sliceCount;
          const isActive = activeSliceIndex === i;
          const isPlaying = playingPads.has(i);
          const choke = sliceSettings[i]?.chokeGroup ?? "none";
          return (
            <div key={i} className="relative">
              <button
                onPointerDown={(e) => {
                  e.preventDefault();
                  if (!hasSlice) return;
                  triggerPad(i);
                }}
                className={[
                  "w-full aspect-square rounded-md border-2 flex flex-col items-center justify-center transition-all",
                  hasSlice
                    ? isPlaying
                      ? "border-primary bg-primary/40 glow-red scale-95"
                      : isActive
                      ? "border-primary/70 bg-primary/10"
                      : "border-border hover:border-primary/50 bg-background/30 hover:bg-accent/20"
                    : "border-border/30 bg-background/10 opacity-30 cursor-not-allowed",
                ].join(" ")}
              >
                <span className="font-mono text-[10px] font-bold leading-none">
                  {i + 1}
                </span>
                <span className="font-mono text-[8px] text-muted-foreground mt-0.5">
                  {PAD_KEY_LABELS[i]}
                </span>
                {hasSlice && choke !== "none" && (
                  <div
                    className="w-1.5 h-1.5 rounded-full mt-0.5"
                    style={{ background: CHOKE_COLORS[choke] ?? "#888" }}
                  />
                )}
              </button>
              {hasSlice && (
                <div
                  className="absolute top-0.5 right-0.5 z-10"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <MidiLearnButton
                    target={{ kind: "chop-pad", padIndex: i }}
                    small
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Slice info */}
      {sliceCount > 0 && (
        <div className="font-mono text-[9px] text-muted-foreground text-center">
          {sliceCount} slice{sliceCount !== 1 ? "s" : ""} · click pad to select
        </div>
      )}

      {/* Per-Slice Controls */}
      {activeSliceIndex !== null && activeSliceIndex < sliceCount && (
        <SliceControls
          index={activeSliceIndex}
          settings={sliceSettings[activeSliceIndex] ?? DEFAULT_SLICE_SETTING}
          onUpdate={(patch) => {
            getStore().updateChopSliceSetting(activeSliceIndex, patch);
            engine.updateSliceSetting(activeSliceIndex, {
              ...(sliceSettings[activeSliceIndex] ?? DEFAULT_SLICE_SETTING),
              ...patch,
            });
          }}
        />
      )}

      {/* Action Buttons */}
      {hasBuffer && sliceCount > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1">
            <span className="font-mono text-[9px] text-muted-foreground">Pattern</span>
            {(["linear", "euclidean", "random"] as const).map((algo) => (
              <button
                key={algo}
                onClick={() => setPatternAlgo(algo)}
                className={`text-[9px] font-mono px-1.5 py-0.5 border rounded capitalize transition-colors ${
                  patternAlgo === algo
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground hover:border-primary/60"
                }`}
              >
                {algo}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <ActionButton onClick={generateSlicePattern} className="flex-1">
              Slice Pattern
            </ActionButton>
            <ActionButton
              onClick={exportKit}
              disabled={isExporting}
              className="flex-1"
            >
              {isExporting ? "Exporting…" : "Export Kit"}
            </ActionButton>
          </div>
          <ActionButton onClick={useAsKit} className="w-full" variant="primary">
            Use as Kit
          </ActionButton>
        </div>
      )}
    </div>
  );
}

// ---- Sub-components ----

function SampleLoader({
  onDrop,
  onFileInput,
  hasBuffer,
  error,
  sampleName,
}: {
  onDrop: (e: React.DragEvent) => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  hasBuffer: boolean;
  error: string | null;
  sampleName: string | null;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onDrop={onDrop}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onClick={() => inputRef.current?.click()}
      className={[
        "border-2 border-dashed rounded-md p-3 text-center cursor-pointer transition-colors",
        dragOver
          ? "border-primary bg-primary/10"
          : hasBuffer
          ? "border-primary/40 bg-primary/5 hover:border-primary/60"
          : "border-border hover:border-primary/40 bg-background/20",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".wav,.mp3,audio/wav,audio/mpeg"
        className="hidden"
        onChange={onFileInput}
      />
      {error ? (
        <p className="font-mono text-[10px] text-red-400">{error}</p>
      ) : sampleName ? (
        <p className="font-mono text-[10px] text-primary truncate">{sampleName}</p>
      ) : (
        <p className="font-mono text-[10px] text-muted-foreground">
          Drop WAV / MP3 or click to browse
        </p>
      )}
    </div>
  );
}

/**
 * Shown when the project remembers a chopped kit but the sample audio
 * blob couldn't be found in IndexedDB (e.g. the browser storage was
 * cleared, or the project was exported without embedding samples).
 * The user can drop / pick the original file to relink it.
 */
function RelinkPrompt({
  sampleName,
  onDrop,
  onFileInput,
}: {
  sampleName: string | null;
  onDrop: (e: React.DragEvent) => void;
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 p-3 space-y-1.5">
      <p className="font-mono text-[10px] text-yellow-400 font-semibold">
        Sample unavailable
      </p>
      <p className="font-mono text-[9px] text-muted-foreground leading-relaxed">
        This project has a saved Chop Lab kit
        {sampleName ? ` (${sampleName})` : ""} but the audio file could not be
        found. Re-link the original sample to restore the waveform and pads.
      </p>
      <div
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => inputRef.current?.click()}
        className={[
          "border-2 border-dashed rounded p-2 text-center cursor-pointer transition-colors mt-1",
          dragOver
            ? "border-yellow-400 bg-yellow-400/10"
            : "border-yellow-500/40 hover:border-yellow-400/70 bg-background/20",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".wav,.mp3,audio/wav,audio/mpeg"
          className="hidden"
          onChange={onFileInput}
        />
        <p className="font-mono text-[10px] text-yellow-400/80">
          Drop file or click to re-link sample
        </p>
      </div>
    </div>
  );
}

function WaveformCanvas({
  audioBuffer,
  markers,
}: {
  audioBuffer: AudioBuffer;
  markers: number[];
  sliceCount: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragIndexRef = useRef<number | null>(null);
  const dragTimeRef = useRef<number | null>(null);
  const pendingMarkersRef = useRef<number[] | null>(null);
  const ignorePointerUpRef = useRef(false);
  const isDragging = useRef(false);

  const duration = audioBuffer.duration;

  const draw = useCallback(() => {
    const endTiming = startPerfTimer("waveform-generation", {
      source: "ChopLab",
      samples: audioBuffer.length,
      markers: markers.length,
    });
    try {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Background.
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, W, H);

    // Waveform.
    const data = audioBuffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / W));
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < W; x++) {
      const start = x * step;
      let min = 0, max = 0;
      for (let s = start; s < start + step && s < data.length; s++) {
        if (data[s] > max) max = data[s];
        if (data[s] < min) min = data[s];
      }
      const yMin = H / 2 + (min * H) / 2;
      const yMax = H / 2 - (max * H) / 2;
      ctx.moveTo(x, H / 2);
      ctx.lineTo(x, yMax);
      ctx.moveTo(x, H / 2);
      ctx.lineTo(x, yMin);
    }
    ctx.stroke();

    // Center line.
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();

    // Slice markers. During a drag this uses a local preview array so moving a
    // marker does not rebuild the audio engine or write project state on every
    // pointer event. The store receives one update when the drag commits.
    const displayMarkers = pendingMarkersRef.current ?? markers;
    displayMarkers.forEach((t, i) => {
      const x = Math.round((t / duration) * W);
      ctx.strokeStyle = "#facc15";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();

      // Label.
      ctx.fillStyle = "#facc15";
      ctx.font = "bold 9px monospace";
      ctx.fillText(String(i + 1), x + 2, 11);
    });
    } finally {
      endTiming();
    }
  }, [audioBuffer, markers, duration]);

  // Resize + redraw.
  useEffect(() => {
    pendingMarkersRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = canvas.clientWidth * window.devicePixelRatio;
      canvas.height = canvas.clientHeight * window.devicePixelRatio;
      draw();
    });
    ro.observe(canvas);
    draw();
    return () => ro.disconnect();
  }, [draw]);

  function timeFromX(canvas: HTMLCanvasElement, clientX: number): number {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    return Math.max(0, Math.min(duration, (x / rect.width) * duration));
  }

  function markerIndexNear(canvas: HTMLCanvasElement, clientX: number): number {
    const rect = canvas.getBoundingClientRect();
    const pxPerSec = rect.width / duration;
    for (let i = 0; i < markers.length; i++) {
      const markerX = markers[i] * pxPerSec;
      if (Math.abs((clientX - rect.left) - markerX) < 8) return i;
    }
    return -1;
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    if (e.button === 2) {
      // Right-click: delete marker.
      ignorePointerUpRef.current = true;
      const idx = markerIndexNear(canvas, e.clientX);
      if (idx !== -1) getStore().deleteChopLabMarker(idx);
      return;
    }
    const idx = markerIndexNear(canvas, e.clientX);
    if (idx !== -1) {
      dragIndexRef.current = idx;
      dragTimeRef.current = markers[idx];
      pendingMarkersRef.current = markers.slice();
      isDragging.current = false;
      canvas.setPointerCapture(e.pointerId);
    } else {
      dragIndexRef.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragIndexRef.current === null) return;
    isDragging.current = true;
    const t = timeFromX(canvasRef.current!, e.clientX);
    dragTimeRef.current = t;
    const preview = pendingMarkersRef.current ?? markers.slice();
    preview[dragIndexRef.current] = t;
    pendingMarkersRef.current = preview;
    draw();
  };

  const clearDrag = () => {
    dragIndexRef.current = null;
    dragTimeRef.current = null;
    pendingMarkersRef.current = null;
    isDragging.current = false;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (ignorePointerUpRef.current) {
      ignorePointerUpRef.current = false;
      clearDrag();
      return;
    }
    try {
      if (canvasRef.current?.hasPointerCapture(e.pointerId)) {
        canvasRef.current.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Pointer capture may already have been released by the browser.
    }
    if (dragIndexRef.current !== null) {
      if (isDragging.current && dragTimeRef.current !== null) {
        getStore().moveChopLabMarker(dragIndexRef.current, dragTimeRef.current);
      } else {
        // Was a click on existing marker — select slice.
        getStore().patchChopLab({ activeSliceIndex: dragIndexRef.current });
      }
      clearDrag();
    } else {
      // Click on empty space: add marker.
      const t = timeFromX(canvasRef.current!, e.clientX);
      if (t > 0.01 && t < duration - 0.01) {
        getStore().addChopLabMarker(t);
      }
    }
  };

  const onPointerCancel = () => {
    clearDrag();
    draw();
  };

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-20 rounded-md cursor-crosshair"
      style={{ imageRendering: "pixelated" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      title="Click to add marker · Drag to move · Right-click to delete"
    />
  );
}

function TransientControls({
  sensitivity,
  onSensitivityChange,
  onDetect,
}: {
  sensitivity: number;
  onSensitivityChange: (v: number) => void;
  onDetect: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onDetect}
        className="text-[10px] font-mono px-2 py-1 bg-primary text-primary-foreground rounded hover:bg-primary/80 transition-colors whitespace-nowrap"
      >
        Detect Transients
      </button>
      <span className="font-mono text-[9px] text-muted-foreground whitespace-nowrap">
        Sensitivity
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={sensitivity}
        onChange={(e) => onSensitivityChange(Number(e.target.value))}
        className="flex-1 accent-primary h-1"
      />
      <span className="font-mono text-[9px] text-muted-foreground w-6 text-right">
        {Math.round(sensitivity * 100)}
      </span>
    </div>
  );
}

function TempoSyncControls({
  syncToBpm,
  sampleBpm,
  projectBpm,
  onToggleSync,
  onSampleBpmChange,
  onDetectBpm,
}: {
  syncToBpm: boolean;
  sampleBpm: number;
  projectBpm: number;
  onToggleSync: () => void;
  onSampleBpmChange: (v: number) => void;
  onDetectBpm: () => void;
}) {
  const ratio = sampleBpm > 0 ? projectBpm / sampleBpm : 1;
  const semitoneShiftNum = -(Math.log2(ratio) * 12);
  const semitoneShiftStr = semitoneShiftNum.toFixed(1);

  return (
    <div className="panel-inset rounded-md p-2 space-y-1.5 border border-primary/20">
      {/* Toggle row */}
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleSync}
          className={[
            "text-[10px] font-mono px-2 py-1 rounded border transition-colors whitespace-nowrap",
            syncToBpm
              ? "border-primary bg-primary/20 text-primary"
              : "border-border text-muted-foreground hover:border-primary/50",
          ].join(" ")}
        >
          Sync to BPM
        </button>
        {syncToBpm && (
          <span className="font-mono text-[9px] text-primary ml-auto">
            ×{ratio.toFixed(3)} rate
            {Math.abs(semitoneShiftNum) > 0.1 && (
              <span className="text-muted-foreground ml-1">({semitoneShiftStr}st pitch)</span>
            )}
          </span>
        )}
      </div>

      {/* BPM inputs row */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] text-muted-foreground whitespace-nowrap">
          Sample BPM
        </span>
        <input
          type="number"
          min={40}
          max={300}
          step={1}
          value={sampleBpm}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (v >= 40 && v <= 300) onSampleBpmChange(v);
          }}
          className="w-14 text-center font-mono text-[10px] bg-background border border-border rounded px-1 py-0.5 focus:border-primary outline-none"
        />
        <button
          onClick={onDetectBpm}
          className="text-[9px] font-mono px-1.5 py-0.5 border border-border rounded text-muted-foreground hover:border-primary/60 hover:text-primary transition-colors whitespace-nowrap"
          title="Re-detect BPM from loaded sample"
        >
          Detect
        </button>
        <span className="font-mono text-[9px] text-muted-foreground ml-auto whitespace-nowrap">
          Project: <span className="text-foreground">{projectBpm}</span>
        </span>
      </div>
    </div>
  );
}

function SliceControls({
  index,
  settings,
  onUpdate,
}: {
  index: number;
  settings: ChopSliceSetting;
  onUpdate: (patch: Partial<ChopSliceSetting>) => void;
}) {
  return (
    <div className="panel-inset rounded-md p-2 space-y-2 border border-primary/20">
      <div className="font-mono text-[9px] text-primary uppercase tracking-widest">
        Slice {index + 1} Controls
      </div>

      {/* Row 1: toggles */}
      <div className="flex items-center gap-3">
        <ToggleChip
          label="Reverse"
          active={settings.reverse}
          onClick={() => onUpdate({ reverse: !settings.reverse })}
        />
        <ToggleChip
          label="Normalize"
          active={settings.normalize}
          onClick={() => onUpdate({ normalize: !settings.normalize })}
        />
        {/* Choke group */}
        <div className="flex items-center gap-1 ml-auto">
          <span className="font-mono text-[9px] text-muted-foreground">Choke</span>
          {(["none", "A", "B", "C", "D"] as const).map((g) => (
            <button
              key={g}
              onClick={() => onUpdate({ chokeGroup: g })}
              className={[
                "text-[9px] font-mono w-5 h-5 rounded border transition-colors",
                settings.chokeGroup === g
                  ? g === "none"
                    ? "border-primary text-primary bg-primary/10"
                    : "border-transparent text-white"
                  : "border-border text-muted-foreground hover:border-primary/50",
              ].join(" ")}
              style={
                settings.chokeGroup === g && g !== "none"
                  ? { background: CHOKE_COLORS[g] }
                  : {}
              }
            >
              {g === "none" ? "—" : g}
            </button>
          ))}
        </div>
      </div>

      {/* Pitch */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] text-muted-foreground w-8">Pitch</span>
        <input
          type="range"
          min={-24}
          max={24}
          step={1}
          value={settings.pitch}
          onChange={(e) => onUpdate({ pitch: Number(e.target.value) })}
          className="flex-1 accent-primary h-1"
        />
        <span className="font-mono text-[9px] text-muted-foreground w-8 text-right">
          {settings.pitch > 0 ? "+" : ""}{settings.pitch}st
        </span>
      </div>

      {/* Fade In */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] text-muted-foreground w-8">F.In</span>
        <input
          type="range"
          min={0}
          max={500}
          step={5}
          value={settings.fadeIn}
          onChange={(e) => onUpdate({ fadeIn: Number(e.target.value) })}
          className="flex-1 accent-primary h-1"
        />
        <span className="font-mono text-[9px] text-muted-foreground w-10 text-right">
          {settings.fadeIn}ms
        </span>
      </div>

      {/* Fade Out */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] text-muted-foreground w-8">F.Out</span>
        <input
          type="range"
          min={0}
          max={500}
          step={5}
          value={settings.fadeOut}
          onChange={(e) => onUpdate({ fadeOut: Number(e.target.value) })}
          className="flex-1 accent-primary h-1"
        />
        <span className="font-mono text-[9px] text-muted-foreground w-10 text-right">
          {settings.fadeOut}ms
        </span>
      </div>
    </div>
  );
}

function ToggleChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "text-[9px] font-mono px-2 py-0.5 rounded border transition-colors",
        active
          ? "border-primary bg-primary/20 text-primary"
          : "border-border text-muted-foreground hover:border-primary/40",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  className,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  variant?: "default" | "primary";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        "text-[10px] font-mono py-1 rounded border transition-colors",
        variant === "primary"
          ? "bg-primary text-primary-foreground border-primary hover:bg-primary/80"
          : "border-border text-foreground hover:border-primary/60 hover:bg-accent/20",
        disabled ? "opacity-50 cursor-not-allowed" : "",
        className ?? "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

