import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FolderOpen,
  VolumeX,
  Music,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { relocateSampleBlob } from "../lib/storage/db";
import { decodeBlob } from "../lib/audio/sampleEdits";
import {
  buildMissingSampleRecoveryPatch,
  buildMissingSampleSkipPatch,
  isMissingSampleRecovered,
  missingSampleEntryKey,
  type MissingSampleEntry,
} from "../lib/audio/missingSampleRecovery";
import { getStore } from "../store";
import { useToast } from "@/hooks/use-toast";

export type { MissingSampleEntry } from "../lib/audio/missingSampleRecovery";

type ItemAction =
  | "pending"
  | "reimported"
  | "muted"
  | "skipped"
  | "placeholder";

// ---------------------------------------------------------------------------
// Sine-wave placeholder generator
// ---------------------------------------------------------------------------

function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = 1;
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  str(36, "data");
  view.setUint32(40, dataSize, true);

  const channel = buffer.getChannelData(0);
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, channel[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

async function generateSineWaveBlob(
  durationSec = 2,
  frequency = 440,
  sampleRate = 44100,
): Promise<Blob> {
  const numSamples = Math.floor(sampleRate * durationSec);
  const offlineCtx = new OfflineAudioContext(1, numSamples, sampleRate);
  const oscillator = offlineCtx.createOscillator();
  const gain = offlineCtx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  oscillator.connect(gain);
  gain.connect(offlineCtx.destination);
  gain.gain.setValueAtTime(0.4, 0);
  gain.gain.linearRampToValueAtTime(0, durationSec);
  oscillator.start(0);
  oscillator.stop(durationSec);
  const buffer = await offlineCtx.startRendering();
  return audioBufferToWavBlob(buffer);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The sample could not be recovered. Check browser storage and try again.";
}

async function recoverMissingSampleBlob(
  entry: MissingSampleEntry,
  blob: Blob,
): Promise<void> {
  const store = getStore();
  const projectId = store.state.project.id;
  const projectLoadRevision = store.state.projectLoadRevision;
  const decoded = await decodeBlob(blob);

  if (
    store.state.project.id !== projectId ||
    store.state.projectLoadRevision !== projectLoadRevision
  ) {
    throw new Error("The project changed while the audio file was being checked. Try again.");
  }

  const projectRevision = store.state.projectRevision;
  const patch = buildMissingSampleRecoveryPatch(
    store.state.project,
    entry,
    blob,
    decoded.duration,
  );

  // Write first so the wizard can never report success for an in-memory Blob
  // that will disappear on the next reload.
  await relocateSampleBlob(entry.blobKey, blob);

  if (
    store.state.project.id !== projectId ||
    store.state.projectLoadRevision !== projectLoadRevision ||
    store.state.projectRevision !== projectRevision
  ) {
    throw new Error("The project changed while the sample was being saved. Try again.");
  }

  // These authoritative store paths also resync the drum-pad sample manager
  // and arrangement scheduler through Store.patchProject.
  if (patch.kind === "library") {
    store.patchProject({ samples: patch.samples });
  } else {
    store.patchProject({ tracks: patch.tracks });
  }

  if (!isMissingSampleRecovered(store.state.project, entry, blob)) {
    throw new Error("The sample was saved, but the audio engine did not accept it. Try again.");
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Wizard that surfaces after a project loads and references samples that
 * are no longer in IndexedDB (e.g. after clearing site data). The user
 * can handle each missing item individually before the studio opens.
 *
 * When all items are resolved the dialog auto-dismisses after ~1 s so
 * the user gets back to making music without an extra click.
 */
export function MissingSamplesDialog({
  open,
  entries,
  onClose,
}: {
  open: boolean;
  entries: MissingSampleEntry[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [actions, setActions] = useState<Record<string, ItemAction>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [busyKeys, setBusyKeys] = useState<Record<string, boolean>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const inFlightKeysRef = useRef(new Set<string>());
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setAction = (id: string, action: ItemAction) => {
    setActions((prev) => ({ ...prev, [id]: action }));
  };

  const handleReimport = (entry: MissingSampleEntry) => {
    const input = inputRefs.current[missingSampleEntryKey(entry)];
    if (!input) return;
    input.click();
  };

  const handleFileChosen = async (entry: MissingSampleEntry, file: File) => {
    const key = missingSampleEntryKey(entry);
    if (inFlightKeysRef.current.has(key)) return;
    inFlightKeysRef.current.add(key);
    setErrors((previous) => ({ ...previous, [key]: undefined }));
    setBusyKeys((previous) => ({ ...previous, [key]: true }));
    try {
      await recoverMissingSampleBlob(entry, file);
      setAction(key, "reimported");
    } catch (error) {
      const message = errorMessage(error);
      setErrors((previous) => ({ ...previous, [key]: message }));
      toast({ title: "Sample recovery failed", description: message });
    } finally {
      inFlightKeysRef.current.delete(key);
      setBusyKeys((previous) => ({ ...previous, [key]: false }));
    }
  };

  const handleMute = (entry: MissingSampleEntry) => {
    const key = missingSampleEntryKey(entry);
    setErrors((previous) => ({ ...previous, [key]: undefined }));
    try {
      const store = getStore();
      const patch = buildMissingSampleSkipPatch(store.state.project, entry);
      if (patch.tracks) store.patchProject({ tracks: patch.tracks });
      setAction(key, patch.action);
    } catch (error) {
      const message = errorMessage(error);
      setErrors((previous) => ({ ...previous, [key]: message }));
      toast({ title: "Sample could not be skipped", description: message });
    }
  };

  const handlePlaceholder = async (entry: MissingSampleEntry) => {
    const key = missingSampleEntryKey(entry);
    if (inFlightKeysRef.current.has(key)) return;
    inFlightKeysRef.current.add(key);
    setErrors((previous) => ({ ...previous, [key]: undefined }));
    setBusyKeys((previous) => ({ ...previous, [key]: true }));
    try {
      const blob = await generateSineWaveBlob();
      await recoverMissingSampleBlob(entry, blob);
      setAction(key, "placeholder");
    } catch (error) {
      const message = errorMessage(error);
      setErrors((previous) => ({ ...previous, [key]: message }));
      toast({ title: "Placeholder creation failed", description: message });
    } finally {
      inFlightKeysRef.current.delete(key);
      setBusyKeys((previous) => ({ ...previous, [key]: false }));
    }
  };

  const allResolved =
    entries.length > 0 &&
    entries.every(
      (entry) => {
        const action = actions[missingSampleEntryKey(entry)];
        return action && action !== "pending";
      },
    );

  // Auto-close ~1 s after all items are resolved.
  useEffect(() => {
    if (!open) return;

    if (allResolved) {
      autoCloseTimerRef.current = setTimeout(() => {
        toast({
          title: "All samples resolved",
          description: "Your session is ready.",
        });
        onClose();
      }, 1000);
    }

    return () => {
      if (autoCloseTimerRef.current !== null) {
        clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = null;
      }
    };
  }, [allResolved, open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Missing samples</DialogTitle>
          <DialogDescription>
            {entries.length} sample{entries.length === 1 ? "" : "s"} referenced
            by this project could not be found in your browser. Resolve each one
            before continuing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {entries.map((entry) => {
            const entryKey = missingSampleEntryKey(entry);
            const action = actions[entryKey] ?? "pending";
            const resolved = action !== "pending";
            const busy = busyKeys[entryKey] === true;
            const error = errors[entryKey];
            return (
              <div
                key={entryKey}
                aria-busy={busy}
                className={`border rounded-md p-3 transition-colors ${
                  resolved
                    ? "border-emerald-600/40 bg-emerald-600/5"
                    : "border-border bg-background/40"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {resolved ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-none" />
                  ) : (
                    <span className="w-3.5 h-3.5 rounded-full border border-yellow-400/60 flex-none" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs truncate">{entry.name}</div>
                    {entry.kind === "clip" && (
                      <div className="text-[10px] text-muted-foreground">
                        Track: {entry.trackName}
                      </div>
                    )}
                  </div>
                  {resolved && (
                    <span className="font-mono text-[9px] uppercase tracking-widest text-emerald-500">
                      {action === "reimported" && "Re-imported"}
                      {action === "muted" && "Muted"}
                      {action === "skipped" && "Skipped"}
                      {action === "placeholder" && "Placeholder"}
                    </span>
                  )}
                </div>

                {!resolved && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      type="button"
                      onClick={() => handleReimport(entry)}
                      disabled={busy}
                      className="flex items-center gap-1 h-6 px-2 rounded border border-primary/50 font-mono text-[9px] uppercase tracking-widest hover:bg-primary/10 text-primary"
                    >
                      {busy ? (
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      ) : (
                        <FolderOpen className="w-2.5 h-2.5" />
                      )}
                      {busy ? "Working…" : "Re-import"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMute(entry)}
                      disabled={busy}
                      className="flex items-center gap-1 h-6 px-2 rounded border border-border font-mono text-[9px] uppercase tracking-widest hover:bg-accent/40 text-muted-foreground"
                    >
                      <VolumeX className="w-2.5 h-2.5" />
                      Skip (mute)
                    </button>
                    <button
                      type="button"
                      onClick={() => void handlePlaceholder(entry)}
                      disabled={busy}
                      className="flex items-center gap-1 h-6 px-2 rounded border border-border font-mono text-[9px] uppercase tracking-widest hover:bg-accent/40 text-muted-foreground"
                    >
                      <Music className="w-2.5 h-2.5" />
                      Placeholder
                    </button>
                  </div>
                )}

                {error && (
                  <p
                    role="alert"
                    className="mt-2 text-[10px] leading-snug text-destructive"
                  >
                    {error}
                  </p>
                )}

                <input
                  ref={(el) => {
                    inputRefs.current[entryKey] = el;
                  }}
                  type="file"
                  accept="audio/*"
                  aria-label={`Choose replacement audio for ${entry.name}`}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.currentTarget.value = "";
                    if (file) void handleFileChosen(entry, file);
                  }}
                />
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between pt-1 gap-2">
          <p className="text-[10px] text-muted-foreground leading-snug flex-1">
            {allResolved
              ? "All resolved — closing automatically…"
              : "Skipped tracks will be muted. Placeholder tracks play a sine-wave tone so the arrangement stays audible."}
          </p>
          <button
            type="button"
            onClick={onClose}
            disabled={!allResolved && entries.length > 0}
            className="h-8 px-4 rounded-md bg-primary text-primary-foreground font-mono text-xs uppercase tracking-widest glow-red disabled:opacity-40"
          >
            {allResolved || entries.length === 0 ? "Continue" : "Resolve all"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
