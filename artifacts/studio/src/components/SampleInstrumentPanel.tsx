import { useEffect, useRef, useState } from "react";
import { getStore, useStore } from "../store";
import { audio } from "../lib/audio/engine";
import { assertSampleImportAllowed } from "../lib/storage/performanceGuards";
import type { SampleLibraryItem, Track } from "../types";

const EMPTY_SAMPLES: SampleLibraryItem[] = [];
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function SourceNoteSelect({ value, onChange, disabled = false }: {
  value: number; onChange: (value: number) => void; disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-mono">
      Source note
      <select aria-label="Source note" value={value} disabled={disabled}
        onKeyDown={(event) => event.stopPropagation()}
        onChange={(event) => onChange(Number(event.target.value))}
        className="rounded border border-border bg-background px-2 py-1 text-foreground">
        {Array.from({ length: 128 }, (_, midi) => (
          <option key={midi} value={midi}>{NOTE_NAMES[midi % 12]}{Math.floor(midi / 12) - 1}</option>
        ))}
      </select>
    </label>
  );
}

/** File validation/editing remains in the existing lazy sample import dialog. */
export function InstrumentUploadButton() {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a"
        className="hidden" aria-label="Upload instrument sample" onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            assertSampleImportAllowed(file);
            getStore().set({ pendingSample: {
              blob: file, defaultName: file.name.replace(/\.[^.]+$/, ""), createInstrument: true,
            } });
          } catch (error) {
            getStore().setStatus((error as Error).message, "error");
          }
        }} />
      <button type="button" onClick={() => input.current?.click()}
        className="rounded border border-primary/50 px-2 py-1 text-xs font-mono text-primary hover:bg-primary/10">
        Create instrument from sample
      </button>
    </>
  );
}

export function SampleInstrumentPanel({ track }: { track: Track }) {
  const samples = useStore((state) => state.project.samples ?? EMPTY_SAMPLES);
  const audioUnlocked = useStore((state) => state.audioUnlocked);
  const [, refresh] = useState(0);
  useEffect(() => {
    const onChange = () => refresh((revision) => revision + 1);
    window.addEventListener("studio:sample-instruments-changed", onChange);
    return () => window.removeEventListener("studio:sample-instruments-changed", onChange);
  }, []);
  const config = track.sampleInstrument;
  const source = config ? samples.find((sample) => sample.blobKey === config.blobKey) : undefined;
  const state = config ? audio.getSampleInstrumentSnapshot().find((item) => item.trackId === track.id) : undefined;
  useEffect(() => {
    if (!audioUnlocked || !config || !source?.blob) return;
    const current = getStore().state.project.tracks.find((item) => item.id === track.id);
    if (!current?.sampleInstrument) return;
    try {
      // Prepare the selected source as soon as audio is enabled, so the first
      // key after Ready is audible. Root changes reuse the existing buffer.
      audio.ensureTrack(current, { reason: "custom-instrument-selected" });
      audio.refreshAllMutes(getStore().state.project.tracks);
      refresh((revision) => revision + 1);
    } catch (error) {
      getStore().setStatus(`Instrument saved; audio preparation failed: ${(error as Error).message}`, "error");
    }
  }, [audioUnlocked, track.id, config?.blobKey, source?.blob]);
  return (
    <div className="panel-inset rounded-md p-2 space-y-2" data-testid="sample-instrument-panel">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Custom instrument</div>
      <InstrumentUploadButton />
      {samples.length > 0 && (
        <label className="block text-xs font-mono space-y-1">
          <span>Use a project sample on this track</span>
          <select aria-label="Instrument sample" value={config?.blobKey ?? ""}
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              if (event.target.value) getStore().applySampleInstrument(track.id, event.target.value, config?.rootNote ?? 60);
            }} className="block w-full rounded border border-border bg-background px-2 py-1 text-foreground">
            <option value="" disabled>Choose a sample…</option>
            {config && !source && <option value={config.blobKey} disabled>Missing source sample</option>}
            {samples.map((sample) => (
              <option key={sample.id} value={sample.blobKey} disabled={!sample.blob}>
                {sample.name}{sample.blob ? "" : " (missing)"}
              </option>
            ))}
          </select>
        </label>
      )}
      {config ? (
        <>
          <SourceNoteSelect value={config.rootNote} onChange={(rootNote) =>
            getStore().patchTrack(track.id, { sampleInstrument: { ...config, rootNote } })} />
          <p className="text-[11px] text-muted-foreground">
            Set the original pitch of your recording. Every key plays this sound at the matching pitch;
            use Octave − / + for other octaves. Higher notes are shorter, lower notes longer.
            The sound ends naturally when the sample runs out.
          </p>
          <p className="text-xs font-mono" role="status" data-testid="sample-instrument-status">
            {!source?.blob ? "Source missing — use Samples → Locate sample to restore it."
              : state?.status === "error" ? `Sample could not load: ${state.error ?? "decode failed"}. Choose another sample or locate a replacement in Samples.`
              : state?.status === "loading" ? "Preparing your instrument…"
              : state?.status === "ready" ? `${source.name} · Ready across the keyboard`
              : `${source.name} · Enable audio to prepare the instrument`}
          </p>
        </>
      ) : <p className="text-[11px] text-muted-foreground">Upload a single clear note or any sound, name it, and play it across the keyboard. Saved with your project.</p>}
    </div>
  );
}
