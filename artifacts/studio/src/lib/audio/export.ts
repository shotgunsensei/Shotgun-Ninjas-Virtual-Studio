import type {
  FxModuleSettings,
  DrumPieceSettings,
  MasterBusSettings,
  NoteEvent,
  Project,
  SendBusId,
  Track,
  TrackEq,
} from "../../types";
import { SEND_BUS_IDS } from "../../types";
import { type DrumPiece } from "./engine";
import { DEFAULT_MASTER_BUS } from "./master-defaults";
import { findKit } from "./sounds/kits";
import { getGroove, GROOVE_TEMPLATES } from "./sounds/groove";
import { findPreset } from "./sounds/presets";
import {
  loadSampleLayers,
  type DecodedSampleLayer,
} from "./sounds/samples";
import {
  startPerfTimer,
  trackAudioResource,
} from "../../utils/performanceDiagnostics";
import { recordExportTrace } from "../performance/exportTrace";
import { safeFilename } from "../export/download";

export {
  downloadBlob,
  safeFilename,
  studioExportFilename,
  studioProjectFilename,
} from "../export/download";

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const TAIL_SEC = 2;

function padSampleBufferKey(blobKey: string): string {
  return `pad:${blobKey}`;
}

// ── export concurrency guard ─────────────────────────────────────────────
// Prevents a second export from launching while one is already rendering.
// The OfflineAudioContext render is CPU-intensive; stacking two would cause
// severe main-thread jank and likely page-unresponsive errors.
let _exportInProgress = false;

/** True while a renderProject call is still pending. */
export function isExportInProgress(): boolean {
  return _exportInProgress;
}

export type RenderPhase = "decoding" | "rendering" | "encoding";
export interface RenderProgress {
  phase: RenderPhase;
  progress: number;
}

export type ExportFormat = "wav" | "mp3";

export interface ExportResult {
  blob: Blob;
  extension: string;
  mimeType: string;
  clipping?: { clipped: boolean; peakDb: number };
  route?: "native-wav" | "native-offline";
  warnings?: string[];
}

export async function renderProjectToWav(
  project: Project,
  onProgress?: (p: RenderProgress) => void,
): Promise<Blob> {
  const result = await renderProject(project, "wav", onProgress);
  return result.blob;
}

export interface RenderOptions {
  /** When true, only the loop region [loopStartBeat..loopEndBeat) is rendered. */
  loopOnly?: boolean;
  /**
   * Custom render range in beats. When both are provided and customEndBeat >
   * customStartBeat, this takes precedence over loopOnly.
   */
  customStartBeat?: number;
  customEndBeat?: number;
}

export async function renderProject(
  project: Project,
  format: ExportFormat,
  onProgress?: (p: RenderProgress) => void,
  options: RenderOptions = {},
): Promise<ExportResult> {
  if (_exportInProgress) {
    throw new Error(
      "An export is already in progress. Please wait for it to complete before starting another.",
    );
  }
  const endTiming = startPerfTimer(format === "wav" ? "wav-export" : "mp3-export", {
    tracks: project.tracks.length,
    bars: project.bars,
    format,
  });
  _exportInProgress = true;
  try {
    return await _renderProjectInner(project, format, onProgress, options);
  } finally {
    _exportInProgress = false;
    endTiming();
  }
}

interface ExportRange {
  startBeat: number;
  endBeat: number;
  projectSec: number;
  renderSec: number;
}

interface ExportPlan extends ExportRange {
  audibleTracks: Track[];
  noteEvents: number;
  drumEvents: number;
  melodicEvents: number;
  audioClips: number;
  approximatedTracks: number;
  estimatedPcmBytes: number;
  estimatedWavBytes: number;
  route: "native-wav" | "native-offline";
  warnings: string[];
}

async function _renderProjectInner(
  project: Project,
  format: ExportFormat,
  onProgress?: (p: RenderProgress) => void,
  options: RenderOptions = {},
): Promise<ExportResult> {
  const plan = createExportPlan(project, format, options);
  recordExportTrace("preflight", {
    format,
    route: plan.route,
    audibleTracks: plan.audibleTracks.length,
    noteEvents: plan.noteEvents,
    drumEvents: plan.drumEvents,
    melodicEvents: plan.melodicEvents,
    audioClips: plan.audioClips,
    approximatedTracks: plan.approximatedTracks,
    durationSec: Math.round(plan.renderSec * 100) / 100,
    estimatedPcmMB: Math.round((plan.estimatedPcmBytes / (1024 * 1024)) * 10) / 10,
    estimatedWavMB: Math.round((plan.estimatedWavBytes / (1024 * 1024)) * 10) / 10,
    warnings: plan.warnings,
  });

  if (plan.renderSec > 20 * 60 || plan.estimatedPcmBytes > 512 * 1024 * 1024) {
    const message =
      `${format.toUpperCase()} export range is too large for the in-browser renderer. Export a shorter range or split the project first.`;
    recordExportTrace("error", { format, route: plan.route, message });
    throw new Error(message);
  }

  onProgress?.({ phase: "decoding", progress: 0 });
  const decoded = await decodeAudioClips(project, plan, (p) =>
    onProgress?.({ phase: "decoding", progress: p * 0.5 }),
  );
  const nativeSampleBanks = await decodeNativeSampleBanks(plan.audibleTracks);
  onProgress?.({ phase: "decoding", progress: 1 });

  recordExportTrace("route", { format, route: plan.route });
  // Both formats share the bounded native renderer. MP3 is an encoding choice,
  // not permission to reconstruct the retired thousands-of-node Tone drum
  // graph inside an OfflineContext.
  const buffer = await renderNativeWav(
    project,
    decoded,
    nativeSampleBanks,
    plan,
    (p) => onProgress?.({ phase: "rendering", progress: p }),
  );
  const clipping = detectClipping(buffer);

  onProgress?.({ phase: "encoding", progress: 0 });
  if (format === "mp3") {
    const mp3 = await encodeMp3(buffer, (p) =>
      onProgress?.({ phase: "encoding", progress: p }),
    );
    onProgress?.({ phase: "encoding", progress: 1 });
    return {
      blob: new Blob([mp3.buffer as ArrayBuffer], { type: "audio/mpeg" }),
      extension: "mp3",
      mimeType: "audio/mpeg",
      clipping,
      route: "native-offline",
      warnings: plan.warnings,
    };
  }
  const wav = await encodeWav(buffer, (p) =>
    onProgress?.({ phase: "encoding", progress: p }),
  );
  onProgress?.({ phase: "encoding", progress: 1 });
  recordExportTrace("result", {
    format,
    route: plan.route,
    wavBytes: wav.byteLength,
    warnings: plan.warnings,
  });
  return {
    blob: new Blob([wav], { type: "audio/wav" }),
    extension: "wav",
    mimeType: "audio/wav",
    clipping,
    route: plan.route,
    warnings: plan.warnings,
  };
}

function createExportPlan(
  project: Project,
  format: ExportFormat,
  options: RenderOptions,
): ExportPlan {
  const range = resolveExportRange(project, options);
  const anySolo = project.tracks.some((t) => t.solo);
  const audibleTracks = project.tracks.filter((t) => !t.muted && (!anySolo || t.solo));
  let noteEvents = 0;
  let drumEvents = 0;
  let melodicEvents = 0;
  let audioClips = 0;
  let approximatedTracks = 0;
  let hasAutomationApproximation = false;
  let hasDeterministicPerformance = false;
  const missingTimelineAudio = new Set<string>();
  const warnings: string[] = [];

  for (const track of audibleTracks) {
    let trackNeedsApproximation = false;
    const preset = findPreset(track.presetId);
    const hasDecodedPresetPath = Boolean(preset?.layers?.length);
    if (
      track.kind !== "drums" &&
      !hasDecodedPresetPath &&
      track.noteClips.some((clip) => clip.notes.length > 0)
    ) {
      trackNeedsApproximation = true;
    }
    if (track.fxRack && Object.values(track.fxRack).some((fx) => fx?.enabled)) {
      // Native export preserves the enabled rack topology and amount, but its
      // bounded Web Audio algorithms are not sample-identical to Tone effects.
      trackNeedsApproximation = true;
    }
    if (
      track.sound &&
      ["attack", "decay", "sustain", "release", "glide"].some(
        (param) => track.sound?.[param as keyof typeof track.sound] !== undefined,
      )
    ) {
      trackNeedsApproximation = true;
    }
    if (track.automationLanes?.some((lane) => lane.breakpoints.length > 0)) {
      trackNeedsApproximation = true;
      hasAutomationApproximation = true;
    }
    if (trackNeedsApproximation) approximatedTracks += 1;
    for (const clip of track.noteClips) {
      for (const ev of clip.notes) {
        if (ev.time < 0 || ev.time >= clip.length) continue;
        const absT = clip.start + ev.time + (ev.microTiming ?? 0);
        if (absT < range.startBeat || absT >= range.endBeat) continue;
        if (
          (ev.probability !== undefined && ev.probability < 1) ||
          (ev.retrigger ?? 1) > 1 ||
          ev.flam ||
          (track.groove?.humanizeTiming ?? project.globalGroove?.humanizeTiming ?? 0) > 0 ||
          (track.groove?.humanizeVelocity ?? project.globalGroove?.humanizeVelocity ?? 0) > 0
        ) {
          hasDeterministicPerformance = true;
        }
        noteEvents += 1;
        if (track.kind === "drums") drumEvents += 1;
        else melodicEvents += 1;
      }
    }
    for (const clip of track.audioClips) {
      if (clip.start >= range.endBeat) continue;
      const clipEndBeat = clip.start + clip.durationSec * (project.bpm / 60);
      if (clipEndBeat <= range.startBeat) continue;
      audioClips += 1;
      if (!clip.blob) missingTimelineAudio.add(clip.name ?? clip.id);
      if (clip.reversed) warnings.push(`Reversed audio clip "${clip.name ?? clip.id}" renders forward in the stabilized ${format.toUpperCase()} path.`);
    }
  }

  if (approximatedTracks > 0) {
    warnings.push(
      `${format.toUpperCase()} export used the stabilized native renderer. Unsampled melodic voices, ADSR/glide, and enabled effect racks retain their controls but use bounded native approximations.`,
    );
  }
  if (hasAutomationApproximation || (project.modulationRoutings?.length ?? 0) > 0) {
    warnings.push(
      "Live automation and modulation are not replayed by the offline renderer; persisted static channel settings were rendered.",
    );
  }
  if (hasDeterministicPerformance) {
    warnings.push(
      "Probability and humanized groove choices were rendered deterministically so repeated exports remain identical.",
    );
  }
  if (missingTimelineAudio.size > 0) {
    warnings.push(
      `Timeline audio unavailable during export: ${Array.from(missingTimelineAudio).join(", ")}. Relink those clips for a complete mix.`,
    );
  }

  const missingAssignedSamples = new Set<string>();
  const sampleByBlobKey = new Map(
    (project.samples ?? []).map((sample) => [sample.blobKey, sample]),
  );
  for (const track of audibleTracks) {
    for (const blobKey of assignedPadBlobKeysForRange(track, range)) {
      const sample = sampleByBlobKey.get(blobKey);
      if (!sample?.blob) missingAssignedSamples.add(sample?.name ?? blobKey);
    }
  }
  if (missingAssignedSamples.size > 0) {
    warnings.push(
      `Assigned drum samples unavailable during export: ${Array.from(missingAssignedSamples).join(", ")}. Their modeled kit fallbacks were rendered.`,
    );
  }

  const frames = Math.ceil(range.renderSec * SAMPLE_RATE);
  return {
    ...range,
    audibleTracks,
    noteEvents,
    drumEvents,
    melodicEvents,
    audioClips,
    approximatedTracks,
    estimatedPcmBytes: frames * CHANNELS * 4,
    estimatedWavBytes: 44 + frames * CHANNELS * 2,
    route: format === "wav" ? "native-wav" : "native-offline",
    warnings,
  };
}

function resolveExportRange(project: Project, options: RenderOptions): ExportRange {
  const beatsPerSec = project.bpm / 60;
  let startBeat: number;
  let endBeat: number;
  if (
    options.customStartBeat !== undefined &&
    options.customEndBeat !== undefined &&
    options.customEndBeat > options.customStartBeat
  ) {
    startBeat = Math.max(0, options.customStartBeat);
    endBeat = Math.min(project.bars * 4, options.customEndBeat);
  } else if (
    options.loopOnly &&
    project.loopEnabled &&
    project.loopEndBeat > project.loopStartBeat
  ) {
    startBeat = project.loopStartBeat;
    endBeat = project.loopEndBeat;
  } else {
    startBeat = 0;
    endBeat = project.bars * 4;
  }
  const projectSec = Math.max(0, (endBeat - startBeat) / beatsPerSec);
  return {
    startBeat,
    endBeat,
    projectSec,
    renderSec: Math.max(0.5, projectSec + TAIL_SEC),
  };
}

async function decodeAudioClips(
  project: Project,
  plan: ExportPlan,
  onProgress?: (p: number) => void,
): Promise<Map<string, AudioBuffer>> {
  const out = new Map<string, AudioBuffer>();
  const failedAssignedSamples = new Set<string>();
  const failedTimelineClips = new Set<string>();
  const sampleByBlobKey = new Map(
    (project.samples ?? []).map((sample) => [sample.blobKey, sample]),
  );

  // Decode only material that can contribute to this export range. Large
  // project libraries otherwise make a one-bar bounce decode unrelated PCM.
  const pending = new Map<
    string,
    { blob: Blob; assignedSampleName?: string; timelineClipName?: string }
  >();
  for (const t of plan.audibleTracks) {
    for (const c of t.audioClips) {
      if (!c.blob || c.start >= plan.endBeat) continue;
      const clipEndBeat = c.start + c.durationSec * (project.bpm / 60);
      if (clipEndBeat <= plan.startBeat) continue;
      pending.set(c.id, { blob: c.blob, timelineClipName: c.name ?? c.id });
    }
  }
  const assignedBlobKeys = new Set(
    plan.audibleTracks.flatMap((track) =>
      Array.from(assignedPadBlobKeysForRange(track, plan)),
    ),
  );
  for (const blobKey of assignedBlobKeys) {
    const sample = sampleByBlobKey.get(blobKey);
    if (!sample?.blob) continue;
    pending.set(padSampleBufferKey(blobKey), {
      blob: sample.blob,
      assignedSampleName: sample.name || blobKey,
    });
  }
  if (pending.size === 0) return out;

  const entries = Array.from(
    pending,
    ([bufferKey, { blob, assignedSampleName, timelineClipName }]) => ({
      bufferKey,
      blob,
      assignedSampleName,
      timelineClipName,
    }),
  );

  const ac = new AudioContext();
  try {
    // Decode in batches of 4 to prevent simultaneous decodeAudioData calls
    // from spiking memory/CPU and triggering page-unresponsive warnings on
    // projects with many large audio clips.
    const BATCH = 2;
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async ({ bufferKey, blob, assignedSampleName, timelineClipName }) => {
          try {
            const ab = await blob.arrayBuffer();
            const decoded = await ac.decodeAudioData(ab.slice(0));
            out.set(bufferKey, decoded);
          } catch {
            // Assigned pads deterministically fall back to their modeled kit
            // recipe. Timeline omissions are reported explicitly below.
            if (assignedSampleName) failedAssignedSamples.add(assignedSampleName);
            if (timelineClipName) failedTimelineClips.add(timelineClipName);
          }
        }),
      );
      // Yield to the UI thread between batches so progress indicators
      // can update and the page remains interactive during long exports.
      if (i + BATCH < entries.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      onProgress?.(Math.min(1, (i + batch.length) / entries.length));
    }
  } finally {
    await ac.close();
  }
  if (failedAssignedSamples.size > 0) {
    plan.warnings.push(
      `Assigned drum samples could not be decoded during export: ${Array.from(failedAssignedSamples).join(", ")}. Their modeled kit fallbacks were rendered.`,
    );
  }
  if (failedTimelineClips.size > 0) {
    plan.warnings.push(
      `Timeline audio could not be decoded during export: ${Array.from(failedTimelineClips).join(", ")}. Those clips were omitted; relink or replace them for a complete mix.`,
    );
  }
  return out;
}

interface NativeSampleZone {
  buffer: AudioBuffer;
  rootNote: string;
  minVelocity: number;
  maxVelocity: number;
}

interface NativeSampleBank {
  presetId: string;
  attackSec: number;
  releaseSec: number;
  zones: NativeSampleZone[];
}

type NativeSampleBanks = Map<string, NativeSampleBank>;

/**
 * Decode each audible sampled preset once before the OfflineAudioContext is
 * created. The shared resolver de-duplicates live-preview/export work and
 * limits decode concurrency; AudioBuffers can then be attached directly to
 * native offline buffer sources without routing WAV export through Tone.
 */
async function decodeNativeSampleBanks(tracks: Track[]): Promise<NativeSampleBanks> {
  const banks: NativeSampleBanks = new Map();
  const presets = new Map(
    tracks
      .map((track) => findPreset(track.presetId))
      .filter((preset): preset is NonNullable<ReturnType<typeof findPreset>> =>
        Boolean(preset?.layers?.length),
      )
      .map((preset) => [preset.id, preset]),
  );

  await Promise.all(
    Array.from(presets.values()).map(async (preset) => {
      const decoded: DecodedSampleLayer[] = await loadSampleLayers(preset.layers);
      const zones = decoded.flatMap(({ layer, buffer }) =>
        layer.rootNote
          ? [{
              buffer,
              rootNote: layer.rootNote,
              minVelocity: layer.minVelocity,
              maxVelocity: layer.maxVelocity,
            }]
          : [],
      );
      if (!zones.length) return;
      banks.set(preset.id, {
        presetId: preset.id,
        attackSec: Math.max(0.002, preset.synth.attack * 0.4),
        releaseSec: Math.max(0.08, preset.synth.release * 2),
        zones,
      });
      recordExportTrace("native-sample-bank", {
        presetId: preset.id,
        zones: zones.length,
      });
    }),
  );
  return banks;
}

interface NativeTrackGraph {
  input: GainNode;
  nodes: AudioNode[];
}

interface NativeMasterGraph {
  input: GainNode;
  nodes: AudioNode[];
}

interface NativeSendBusGraph {
  inputs: Record<SendBusId, GainNode>;
  nodes: AudioNode[];
}

type NativeDrumChokeState = Map<string, AudioScheduledSourceNode[]>;

export interface NativeTrackRenderControls {
  eq: TrackEq;
  width: number;
  driveAmount: number;
  bits: number;
}

/** Resolve the final persisted static controls in the same order as live
 * voice rehydration: sound/EQ first, then explicit FX-rack bypasses. */
export function resolveNativeTrackRenderControls(
  track: Pick<Track, "eq" | "sound" | "fxRack">,
): NativeTrackRenderControls {
  const eq: TrackEq = track.fxRack?.eq?.enabled === false
    ? { low: 0, mid: 0, high: 0, hpfOn: false, hpfHz: 20 }
    : (track.eq ?? { low: 0, mid: 0, high: 0, hpfOn: false, hpfHz: 20 });

  const saturation = track.fxRack?.saturation;
  const baseDrive = clamp01(track.sound?.drive ?? 0) * 0.9;
  const driveAmount = saturation?.enabled === false
    ? 0
    : Math.max(
        baseDrive,
        saturation
          ? 0.05 + clamp01(saturation.amount ?? 0.5) * 0.75
          : 0,
      );

  const bitcrusher = track.fxRack?.bitcrusher;
  const bits = bitcrusher && bitcrusher.enabled !== false
    ? Math.round(
        16 - 14 * clamp01(bitcrusher.params?.bits ?? bitcrusher.amount ?? 0.5),
      )
    : 16;

  const widthModule = track.fxRack?.stereoWidth;
  const width = clamp(
    widthModule?.enabled === false
      ? 0.5
      : widthModule
        ? widthModule.amount ?? 0.5
        : track.sound?.width ?? 0.5,
    0,
    1,
  );
  return { eq, width, driveAmount, bits };
}

export function resolveNativeAssignedPadVolume(
  settings: Partial<DrumPieceSettings> | undefined,
  kitDefaultVolume: number | undefined,
): number {
  return clamp01(settings?.volume ?? kitDefaultVolume ?? 1);
}

const DRUM_DECAY: Record<string, number> = {
  kick: 0.36,
  snare: 0.16,
  hat: 0.045,
  ohat: 0.32,
  clap: 0.11,
  tomLow: 0.24,
  tomHigh: 0.18,
  crash: 0.8,
  fx: 0.48,
};

async function renderNativeWav(
  project: Project,
  audioBuffers: Map<string, AudioBuffer>,
  nativeSampleBanks: NativeSampleBanks,
  plan: ExportPlan,
  onProgress: (p: number) => void,
): Promise<AudioBuffer> {
  const untrackOfflineRender = trackAudioResource("native-offline-render");
  const frames = Math.max(1, Math.ceil(plan.renderSec * SAMPLE_RATE));
  const ctx = new OfflineAudioContext(CHANNELS, frames, SAMPLE_RATE);
  const master = createNativeMasterGraph(
    ctx,
    project.masterVolume,
    project.masterBus,
  );
  const sendBuses = createNativeSendBuses(ctx, master.input, project.bpm);
  const noiseBuffer = makeNativeNoiseBuffer(ctx);
  const cleanupNodes: AudioNode[] = [...master.nodes, ...sendBuses.nodes];
  let scheduled = 0;

  onProgress(0);

  try {
    for (const track of plan.audibleTracks) {
      const graph = createNativeTrackGraph(
        ctx,
        track,
        master.input,
        sendBuses.inputs,
      );
      cleanupNodes.push(...graph.nodes);
      recordExportTrace("native-track", { trackId: track.id, kind: track.kind });
      const anyDrumPieceSolo =
        track.kind === "drums" &&
        Object.values(track.pieceSettings ?? {}).some((settings) => settings?.solo);
      const groove = getGroove(track.groove, project.globalGroove);
      const chokeState: NativeDrumChokeState = new Map();

      // Chokes and retriggers are time-order dependent. Projects imported from
      // older versions do not guarantee clip/note array ordering, so normalize
      // it here before scheduling the offline graph.
      const noteEntries = track.noteClips
        .flatMap((clip) => clip.notes.map((ev) => ({ clip, ev })))
        .filter(({ clip, ev }) => shouldRenderNote(clip.start, clip.length, ev, plan))
        .sort((a, b) =>
          (a.clip.start + a.ev.time + (a.ev.microTiming ?? 0)) -
          (b.clip.start + b.ev.time + (b.ev.microTiming ?? 0)),
        );
      for (const { clip, ev } of noteEntries) {
          const eventKey = `${project.id}:${track.id}:${clip.id}:${ev.time}:${ev.note}`;
          const performance = applyNativeGroove(
            ev.time,
            ev.velocity,
            ev.probability,
            groove,
            project.bpm,
            eventKey,
          );
          if (performance.skip) continue;
          const time = Math.max(
            0,
            beatToSeconds(
              clip.start + ev.time + (ev.microTiming ?? 0),
              project.bpm,
              plan.startBeat,
            ) + performance.timeOffsetSec,
          );
          const velocity = clamp01(
            performance.velocity * (ev.accent ? 1.25 : 1),
          );
          const retrigger = Math.max(1, Math.min(8, ev.retrigger ?? 1));
          const stepSec = Math.max(0.025, (ev.duration * 60) / project.bpm);
          const scheduleAt = (
            eventTime: number,
            eventVelocity: number,
            eventDurationSec = stepSec,
          ) => {
            if (track.kind === "drums") {
              const piece = ev.note as DrumPiece;
              const assignedBlobKey = track.padSamples?.[piece];
              scheduleNativeDrumHit(
                ctx,
                graph.input,
                sendBuses.inputs,
                noiseBuffer,
                track,
                ev.note,
                eventTime,
                eventVelocity,
                anyDrumPieceSolo,
                chokeState,
                assignedBlobKey
                  ? audioBuffers.get(padSampleBufferKey(assignedBlobKey))
                  : undefined,
                assignedBlobKey,
              );
            } else {
              scheduleNativeMelodicNote(
                ctx,
                graph.input,
                track,
                ev,
                eventTime,
                eventDurationSec,
                eventVelocity,
                track.presetId ? nativeSampleBanks.get(track.presetId) : undefined,
              );
            }
            scheduled += 1;
          };

          if (
            track.kind === "drums" &&
            (ev.flam || performance.flam) &&
            ev.note !== "hat" &&
            ev.note !== "ohat"
          ) {
            scheduleAt(Math.max(0, time - 0.025), velocity * 0.45);
          }
          if (
            track.kind === "drums" &&
            performance.ghost &&
            (ev.note === "snare" || ev.note === "clap")
          ) {
            scheduleAt(time + 0.06, Math.max(0.05, velocity * 0.22));
          }
          for (let index = 0; index < retrigger; index += 1) {
            const retriggerVelocity = track.kind === "drums"
              ? velocity * (1 - index * 0.15)
              : velocity * (1 - index * 0.1);
            scheduleAt(
              time + (stepSec / retrigger) * index,
              Math.max(0.05, retriggerVelocity),
              retrigger > 1
                ? Math.max(0.025, (stepSec / retrigger) * 0.9)
                : stepSec,
            );
          }
          recordExportTrace("native-note", { trackId: track.id, kind: track.kind });
          if (scheduled % 256 === 0) {
            recordExportTrace("native-yield", { scheduled });
            onProgress(Math.min(0.15, scheduled / Math.max(1, plan.noteEvents) * 0.15));
            await yieldToMain();
          }
      }

      for (const clip of track.audioClips) {
        scheduleNativeAudioClip(ctx, graph.input, audioBuffers.get(clip.id), clip, project.bpm, plan);
      }
    }

    const estimatedMs = Math.max(500, plan.renderSec * 120);
    const startedAt = performance.now();
    let progressError: unknown = null;
    const tick = window.setInterval(() => {
      if (progressError) return;
      try {
        const elapsed = performance.now() - startedAt;
        onProgress(Math.min(0.95, 0.15 + (elapsed / estimatedMs) * 0.8));
      } catch (err) {
        progressError = err;
      }
    }, 100);
    try {
      const buffer = await ctx.startRendering();
      if (progressError) throw progressError;
      onProgress(1);
      return buffer;
    } finally {
      window.clearInterval(tick);
    }
  } finally {
    for (const node of cleanupNodes) {
      try {
        node.disconnect();
      } catch {
        // ignore offline cleanup races
      }
    }
    untrackOfflineRender();
  }
}

function createNativeMasterGraph(
  ctx: OfflineAudioContext,
  projectVolume: number,
  partialSettings: Partial<MasterBusSettings> | undefined,
): NativeMasterGraph {
  const settings: MasterBusSettings = {
    ...DEFAULT_MASTER_BUS,
    ...(partialSettings ?? {}),
  };
  const input = ctx.createGain();
  const glue = ctx.createDynamicsCompressor();
  const softClip = ctx.createWaveShaper();
  const splitter = ctx.createChannelSplitter(2);
  const leftToLeft = ctx.createGain();
  const leftToRight = ctx.createGain();
  const rightToRight = ctx.createGain();
  const rightToLeft = ctx.createGain();
  const merger = ctx.createChannelMerger(2);
  const limiter = ctx.createDynamicsCompressor();
  const output = ctx.createGain();

  glue.threshold.value = settings.glueEnabled
    ? clamp(settings.glueThresholdDb, -36, 0)
    : 0;
  glue.ratio.value = settings.glueEnabled ? clamp(settings.glueRatio, 1, 10) : 1;
  glue.knee.value = settings.glueEnabled ? 6 : 0;
  glue.attack.value = clamp(settings.glueAttack, 0, 0.1);
  glue.release.value = clamp(settings.glueRelease, 0.05, 1);
  softClip.curve = settings.softClip ? makeNativeSaturationCurve(0.72, 16) : null;
  softClip.oversample = settings.oversample ? "2x" : "none";

  const width = clamp(settings.width, 0, 2);
  const main = (1 + width) / 2;
  const cross = (1 - width) / 2;
  leftToLeft.gain.value = main;
  rightToRight.gain.value = main;
  leftToRight.gain.value = cross;
  rightToLeft.gain.value = cross;

  limiter.threshold.value = clamp(settings.limiterThresholdDb, -24, 0);
  limiter.ratio.value = 20;
  limiter.knee.value = 0;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  output.gain.value = clamp01(projectVolume) * dbToGain(settings.limiterGainDb);

  input.connect(glue);
  glue.connect(softClip);
  softClip.connect(splitter);
  splitter.connect(leftToLeft, 0);
  splitter.connect(leftToRight, 0);
  splitter.connect(rightToRight, 1);
  splitter.connect(rightToLeft, 1);
  leftToLeft.connect(merger, 0, 0);
  rightToLeft.connect(merger, 0, 0);
  rightToRight.connect(merger, 0, 1);
  leftToRight.connect(merger, 0, 1);
  merger.connect(limiter);
  limiter.connect(output);
  output.connect(ctx.destination);

  return {
    input,
    nodes: [
      input,
      glue,
      softClip,
      splitter,
      leftToLeft,
      leftToRight,
      rightToRight,
      rightToLeft,
      merger,
      limiter,
      output,
    ],
  };
}

function createNativeSendBuses(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  bpm: number,
): NativeSendBusGraph {
  const inputs = Object.fromEntries(
    SEND_BUS_IDS.map((busId) => [busId, ctx.createGain()]),
  ) as Record<SendBusId, GainNode>;
  const nodes: AudioNode[] = [...Object.values(inputs)];

  const connectReverb = (
    input: GainNode,
    durationSec: number,
    decayPower: number,
    wetGain: number,
    seed: number,
  ) => {
    const convolver = ctx.createConvolver();
    const output = ctx.createGain();
    convolver.buffer = makeNativeImpulse(ctx, durationSec, decayPower, seed);
    convolver.normalize = true;
    output.gain.value = wetGain;
    input.connect(convolver);
    convolver.connect(output);
    output.connect(destination);
    nodes.push(convolver, output);
  };

  const connectDelay = (
    input: GainNode,
    seconds: number,
    feedbackAmount: number,
    cutoffHz: number,
    wetGain: number,
  ) => {
    const delay = ctx.createDelay(2);
    const filter = ctx.createBiquadFilter();
    const feedback = ctx.createGain();
    const output = ctx.createGain();
    delay.delayTime.value = seconds;
    filter.type = "lowpass";
    filter.frequency.value = cutoffHz;
    feedback.gain.value = feedbackAmount;
    output.gain.value = wetGain;
    input.connect(delay);
    delay.connect(filter);
    filter.connect(output);
    output.connect(destination);
    filter.connect(feedback);
    feedback.connect(delay);
    nodes.push(delay, filter, feedback, output);
  };

  connectReverb(inputs.roomReverb, 0.9, 2.8, 0.34, 0x51a7);
  connectReverb(inputs.neonHall, 2.6, 1.65, 0.24, 0x9e37);
  connectDelay(
    inputs.tapeDelay,
    clamp((60 / Math.max(40, bpm)) * 0.5, 0.08, 1.2),
    0.32,
    4_500,
    0.5,
  );
  connectDelay(inputs.darkSlapback, 0.085, 0.16, 2_800, 0.42);
  return { inputs, nodes };
}

function createNativeTrackGraph(
  ctx: OfflineAudioContext,
  track: Track,
  destination: AudioNode,
  sendDestinations: Record<SendBusId, GainNode>,
): NativeTrackGraph {
  const input = ctx.createGain();
  const hpf = ctx.createBiquadFilter();
  const lowShelf = ctx.createBiquadFilter();
  const midPeak = ctx.createBiquadFilter();
  const highShelf = ctx.createBiquadFilter();
  const filter = ctx.createBiquadFilter();
  const compressor = ctx.createDynamicsCompressor();
  const drive = ctx.createWaveShaper();
  const splitter = ctx.createChannelSplitter(2);
  const leftToLeft = ctx.createGain();
  const leftToRight = ctx.createGain();
  const rightToRight = ctx.createGain();
  const rightToLeft = ctx.createGain();
  const merger = ctx.createChannelMerger(2);
  const pan = ctx.createStereoPanner();
  const fader = ctx.createGain();
  const nodes: AudioNode[] = [
    input,
    hpf,
    lowShelf,
    midPeak,
    highShelf,
    filter,
    compressor,
    drive,
    splitter,
    leftToLeft,
    leftToRight,
    rightToRight,
    rightToLeft,
    merger,
    pan,
    fader,
  ];

  const renderControls = resolveNativeTrackRenderControls(track);
  const { eq } = renderControls;
  hpf.type = "highpass";
  hpf.frequency.value = eq.hpfOn ? clamp(eq.hpfHz, 20, 2_000) : 20;
  lowShelf.type = "lowshelf";
  lowShelf.frequency.value = 160;
  lowShelf.gain.value = clamp(eq.low, -12, 12);
  midPeak.type = "peaking";
  midPeak.frequency.value = 1_200;
  midPeak.Q.value = 0.8;
  midPeak.gain.value = clamp(eq.mid, -12, 12);
  highShelf.type = "highshelf";
  highShelf.frequency.value = 6_500;
  highShelf.gain.value = clamp(eq.high, -12, 12);
  filter.type = "lowpass";
  const cutoff = track.sound?.cutoff ?? track.fx.filter;
  filter.frequency.value = 200 + clamp01(cutoff) ** 2 * 17_800;
  filter.Q.value = 0.1 + clamp01(track.sound?.resonance ?? 0.04) * 16;

  const compressorSettings = track.fxRack?.compressor;
  const compressorEnabled = Boolean(
    compressorSettings && compressorSettings.enabled !== false,
  );
  const compressorAmount = clamp01(compressorSettings?.amount ?? 0.5);
  const compressorParams = compressorSettings?.params ?? {};
  compressor.threshold.value = compressorEnabled
    ? -6 - 24 * clamp01(compressorParams.threshold ?? compressorAmount)
    : 0;
  compressor.ratio.value = compressorEnabled
    ? 1.5 + 8.5 * clamp01(compressorParams.ratio ?? compressorAmount)
    : 1;
  compressor.knee.value = compressorEnabled ? 6 : 0;
  compressor.attack.value = 0.005 + 0.04 * (1 - compressorAmount);
  compressor.release.value = 0.08 + 0.4 * compressorAmount;

  const { driveAmount, bits } = renderControls;
  drive.curve = driveAmount > 0 || bits < 16
    ? makeNativeSaturationCurve(driveAmount, bits)
    : null;
  drive.oversample = "none";

  const { width } = renderControls;
  const main = 0.5 + width;
  const cross = 0.5 - width;
  leftToLeft.gain.value = main;
  rightToRight.gain.value = main;
  leftToRight.gain.value = cross;
  rightToLeft.gain.value = cross;
  pan.pan.value = clampPan(track.pan);
  fader.gain.value = clamp01(track.volume);

  input.connect(hpf);
  hpf.connect(lowShelf);
  lowShelf.connect(midPeak);
  midPeak.connect(highShelf);
  highShelf.connect(filter);
  filter.connect(compressor);
  compressor.connect(drive);
  drive.connect(splitter);
  splitter.connect(leftToLeft, 0);
  splitter.connect(leftToRight, 0);
  splitter.connect(rightToRight, 1);
  splitter.connect(rightToLeft, 1);
  leftToLeft.connect(merger, 0, 0);
  rightToLeft.connect(merger, 0, 0);
  rightToRight.connect(merger, 0, 1);
  leftToRight.connect(merger, 0, 1);
  merger.connect(pan);
  pan.connect(fader);
  fader.connect(destination);

  const sendLevels = nativeTrackSendLevels(track);
  for (const busId of SEND_BUS_IDS) {
    const send = ctx.createGain();
    send.gain.value = sendLevels[busId];
    fader.connect(send);
    send.connect(sendDestinations[busId]);
    nodes.push(send);
  }
  return { input, nodes };
}

function nativeTrackSendLevels(track: Track): Record<SendBusId, number> {
  const levels: Record<SendBusId, number> = {
    roomReverb: clamp01(track.fx.reverb),
    neonHall: 0,
    tapeDelay: clamp01(track.fx.delay),
    darkSlapback: 0,
  };
  if (track.sound?.reverbSend !== undefined) {
    levels.roomReverb = clamp01(track.sound.reverbSend);
  }
  if (track.sound?.delaySend !== undefined) {
    levels.tapeDelay = clamp01(track.sound.delaySend);
  }
  if (track.sound?.chorusSend !== undefined) {
    levels.neonHall = clamp01(track.sound.chorusSend) * 0.45;
  }
  for (const busId of SEND_BUS_IDS) {
    const explicit = track.sends?.[busId];
    if (explicit !== undefined) levels[busId] = clamp01(explicit);
  }
  const effectSends: Array<[SendBusId, FxModuleSettings | undefined]> = [
    ["roomReverb", track.fxRack?.reverb],
    ["tapeDelay", track.fxRack?.delay],
    ["neonHall", track.fxRack?.chorus],
  ];
  for (const [busId, settings] of effectSends) {
    if (!settings || settings.enabled === false) continue;
    const multiplier = busId === "neonHall" ? 0.45 : 1;
    levels[busId] = Math.max(
      levels[busId],
      clamp01(settings.amount ?? 0.5) * multiplier,
    );
  }
  return levels;
}

function makeNativeImpulse(
  ctx: OfflineAudioContext,
  durationSec: number,
  decayPower: number,
  initialSeed: number,
): AudioBuffer {
  const length = Math.max(1, Math.ceil(ctx.sampleRate * durationSec));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  let seed = initialSeed >>> 0;
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      const noise = (seed / 0xffffffff) * 2 - 1;
      const envelope = Math.pow(1 - index / length, decayPower);
      data[index] = noise * envelope;
    }
  }
  return buffer;
}

function makeNativeSaturationCurve(amount: number, bits: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(2_048);
  const drive = 1 + clamp01(amount) * 28;
  const boundedBits = Math.max(2, Math.min(16, Math.round(bits)));
  const levels = 2 ** (boundedBits - 1) - 1;
  for (let index = 0; index < curve.length; index += 1) {
    const input = (index / (curve.length - 1)) * 2 - 1;
    const saturated = Math.tanh(input * drive) / Math.tanh(drive);
    curve[index] = boundedBits < 16
      ? Math.round(saturated * levels) / levels
      : saturated;
  }
  return curve;
}

function dbToGain(db: number): number {
  return Math.pow(10, clamp(db, -60, 24) / 20);
}

/** Return only assigned pads that can contribute a note inside this render.
 * Large project libraries often contain old pad assignments; decoding those
 * unrelated blobs made short bounces slower and more memory intensive. */
function assignedPadBlobKeysForRange(
  track: Track,
  range: ExportRange,
): Set<string> {
  const blobKeys = new Set<string>();
  if (track.kind !== "drums") return blobKeys;
  const anyPieceSolo = Object.values(track.pieceSettings ?? {}).some(
    (settings) => settings?.solo,
  );
  for (const clip of track.noteClips) {
    for (const event of clip.notes) {
      if (!shouldRenderNote(clip.start, clip.length, event, range)) continue;
      if ((event.probability ?? 1) <= 0.001) continue;
      const piece = event.note as DrumPiece;
      const settings = track.pieceSettings?.[piece];
      if (settings?.muted || (anyPieceSolo && !settings?.solo)) continue;
      const blobKey = track.padSamples?.[piece];
      if (blobKey) blobKeys.add(blobKey);
    }
  }
  return blobKeys;
}

function shouldRenderNote(
  clipStart: number,
  clipLength: number,
  ev: NoteEvent,
  plan: ExportRange,
): boolean {
  const absT = clipStart + ev.time + (ev.microTiming ?? 0);
  return (
    ev.time >= 0 &&
    ev.time < clipLength &&
    absT >= plan.startBeat &&
    absT < plan.endBeat &&
    ev.velocity > 0.001
  );
}

function applyNativeGroove(
  beatInClip: number,
  baseVelocity: number,
  noteProbability: number | undefined,
  settings: ReturnType<typeof getGroove>,
  bpm: number,
  eventKey: string,
): {
  timeOffsetSec: number;
  velocity: number;
  skip: boolean;
  flam: boolean;
  ghost: boolean;
} {
  const template = GROOVE_TEMPLATES[settings.template] ?? GROOVE_TEMPLATES.straight;
  const stepIndex = ((Math.round(beatInClip * 4) % 16) + 16) % 16;
  const grooveProbability = settings.stepProbability?.[stepIndex]
    ?? template.probability[stepIndex]
    ?? 1;
  if (
    deterministicUnit(`${eventKey}:note-probability`) > clamp01(noteProbability ?? 1) ||
    deterministicUnit(`${eventKey}:groove-probability`) > clamp01(grooveProbability)
  ) {
    return { timeOffsetSec: 0, velocity: baseVelocity, skip: true, flam: false, ghost: false };
  }

  const timingNoise =
    (deterministicUnit(`${eventKey}:timing`) * 2 - 1) *
    template.humanTimingScaleMs *
    clamp01(settings.humanizeTiming);
  let totalMs = (template.microMs[stepIndex] ?? 0) + timingNoise;
  const swing = clamp(template.swing + settings.swing, 0, 1);
  if (stepIndex % 2 === 1 && swing > 0) {
    totalMs += ((60_000 / Math.max(40, bpm)) / 4) * swing * 0.5;
  }
  const velocityNoise =
    (deterministicUnit(`${eventKey}:velocity`) * 2 - 1) *
    0.25 *
    clamp01(settings.humanizeVelocity);
  const velocity = clamp(
    baseVelocity * (template.velocityCurve[stepIndex] ?? 1) + velocityNoise,
    0.05,
    1,
  );
  const templateFlamProbability =
    template.flamProbability * (0.4 + clamp01(settings.humanizeTiming) * 0.6);
  const flam = Boolean(settings.stepFlam?.[stepIndex]) ||
    deterministicUnit(`${eventKey}:flam`) < templateFlamProbability;
  const ghostProbability =
    template.ghostProbability * (0.6 + clamp01(settings.humanizeVelocity) * 0.4);
  const ghost = deterministicUnit(`${eventKey}:ghost`) < ghostProbability;
  return { timeOffsetSec: totalMs / 1_000, velocity, skip: false, flam, ghost };
}

function deterministicUnit(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function beatToSeconds(beat: number, bpm: number, startBeat: number): number {
  return Math.max(0, ((beat - startBeat) * 60) / bpm);
}

function makeNativeNoiseBuffer(ctx: OfflineAudioContext): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * 2));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function scheduleNativeDrumHit(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  sendDestinations: Record<SendBusId, GainNode>,
  noiseBuffer: AudioBuffer,
  track: Track,
  pieceValue: string,
  time: number,
  velocity: number,
  anyPieceSolo: boolean,
  chokeState: NativeDrumChokeState,
  assignedBuffer?: AudioBuffer,
  assignedBlobKey?: string,
): void {
  const piece = pieceValue as DrumPiece;
  const settings = track.pieceSettings?.[piece];
  if (settings?.muted || (anyPieceSolo && !settings?.solo)) return;
  const kitId = track.kitId ?? (
    track.preset === "acoustic"
      ? "garageband"
      : track.preset === "electronic"
        ? "cyberpunk"
        : "trap"
  );
  const def = findKit(kitId).pieces[piece];
  chokeNativeDrumGroup(chokeState, def?.chokeGroup, time);

  // Assigned user samples replace the modeled pad during live playback, so
  // export must make the same substitution. The sample enters the track graph
  // and therefore still inherits track gain, pan and filtering.
  if (assignedBuffer) {
    const source = ctx.createBufferSource();
    const userFilter = ctx.createBiquadFilter();
    const sourceGain = ctx.createGain();
    const piecePan = ctx.createStereoPanner();
    const pitchSemis = Math.max(-24, Math.min(24, settings?.pitch ?? 0));
    const pieceVolume = resolveNativeAssignedPadVolume(
      settings,
      def?.defaultVolume,
    );
    const playbackRate = Math.pow(2, pitchSemis / 12);
    const sourceDuration = Math.max(
      0.02,
      assignedBuffer.duration * clamp(settings?.decay ?? 1, 0.05, 1),
    );
    source.buffer = assignedBuffer;
    source.playbackRate.setValueAtTime(playbackRate, time);
    userFilter.type = "lowpass";
    userFilter.frequency.setValueAtTime(
      20 * Math.pow(1000, clamp01(settings?.cutoff ?? def?.defaultCutoff ?? 1)),
      time,
    );
    userFilter.Q.setValueAtTime(0.5, time);
    sourceGain.gain.setValueAtTime(
      Math.max(0.0001, clamp01(velocity) * pieceVolume),
      time,
    );
    piecePan.pan.setValueAtTime(
      clampPan(settings?.pan ?? def?.defaultPan ?? 0),
      time,
    );
    source.connect(userFilter);
    userFilter.connect(sourceGain);
    sourceGain.connect(piecePan);
    piecePan.connect(destination);
    connectNativePieceSends(
      ctx,
      piecePan,
      sendDestinations,
      settings?.reverbSend ?? def?.defaultReverbSend ?? 0,
      settings?.delaySend ?? def?.defaultDelaySend ?? 0,
      track.volume,
    );
    source.start(time, 0, sourceDuration);
    registerNativeDrumSource(chokeState, def?.chokeGroup, source);
    recordExportTrace("native-assigned-pad", {
      piece,
      blobKey: assignedBlobKey,
      durationSec: sourceDuration / playbackRate,
    });
    recordExportTrace("native-source", {
      kind: "AssignedPadAudioBufferSourceNode",
      piece,
    });
    return;
  }

  if (!def) return;

  const recipe = def.synth;
  const pitchSemis = Math.max(-24, Math.min(24, settings?.pitch ?? def.defaultPitch ?? 0));
  const spread = recipe.pitchSpread ?? 0;
  const deterministicJitter = spread * Math.sin(time * 104729 + piece.length * 17);
  const midiPitch =
    (recipe.pitch ?? (recipe.engine === "kick" ? 40 : 56)) +
    pitchSemis +
    deterministicJitter;
  const decayMul = Math.max(0.05, Math.min(1, settings?.decay ?? 1));
  const decay = Math.max(
    0.025,
    Math.min(2.5, (recipe.decay ?? def.defaultDecay ?? DRUM_DECAY[piece] ?? 0.12) * decayMul),
  );
  const pieceVolume = clamp01(settings?.volume ?? def.defaultVolume ?? 0.85);
  const bodyGain =
    typeof recipe.bodyLevelDb === "number"
      ? Math.pow(10, recipe.bodyLevelDb / 20)
      : 1;
  const amp = clamp01(velocity) * pieceVolume * bodyGain;
  const sourceGain = ctx.createGain();
  const recipeFilter = ctx.createBiquadFilter();
  const userFilter = ctx.createBiquadFilter();
  const piecePan = ctx.createStereoPanner();
  sourceGain.gain.setValueAtTime(Math.max(0.0001, amp), time);
  sourceGain.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  const usesNoise =
    recipe.engine === "snare" ||
    recipe.engine === "clap" ||
    recipe.engine === "hat" ||
    recipe.engine === "crash" ||
    (recipe.engine === "fx" && Boolean(recipe.noise));
  recipeFilter.type = usesNoise && recipe.highpass ? "highpass" : "lowpass";
  recipeFilter.frequency.setValueAtTime(
    Math.max(
      20,
      Math.min(20_000, usesNoise && recipe.highpass ? recipe.highpass : recipe.lowpass ?? 18_000),
    ),
    time,
  );
  recipeFilter.Q.setValueAtTime(
    Math.max(0.1, Math.min(18, recipe.Q ?? (recipe.engine === "snare" ? 1.1 : 0.7))),
    time,
  );
  userFilter.type = "lowpass";
  userFilter.frequency.setValueAtTime(
    20 * Math.pow(1000, clamp01(settings?.cutoff ?? def.defaultCutoff ?? 1)),
    time,
  );
  userFilter.Q.setValueAtTime(0.5, time);
  piecePan.pan.setValueAtTime(
    clampPan(settings?.pan ?? def.defaultPan ?? 0),
    time,
  );
  recipeFilter.connect(userFilter);
  userFilter.connect(sourceGain);
  sourceGain.connect(piecePan);
  piecePan.connect(destination);
  connectNativePieceSends(
    ctx,
    piecePan,
    sendDestinations,
    settings?.reverbSend ?? def.defaultReverbSend ?? 0,
    settings?.delaySend ?? def.defaultDelaySend ?? 0,
    track.volume,
  );
  recordExportTrace("native-drum-hit", { piece, kitId });

  const addNoise = (duration = decay) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    src.playbackRate.setValueAtTime(Math.pow(2, pitchSemis / 12), time);
    src.connect(recipeFilter);
    src.start(time);
    src.stop(time + duration);
    registerNativeDrumSource(chokeState, def.chokeGroup, src);
    recordExportTrace("native-source", { kind: "AudioBufferSourceNode", piece });
  };
  const addOscillator = (duration = decay) => {
    const osc = ctx.createOscillator();
    osc.type = recipe.engine === "kick" ? "sine" : recipe.engine === "fx" ? "sawtooth" : "triangle";
    const frequency = Math.max(24, Math.min(12_000, 440 * Math.pow(2, (midiPitch - 69) / 12)));
    osc.frequency.setValueAtTime(frequency, time);
    if (recipe.engine === "kick") {
      const octaves = Math.max(0, Math.min(10, recipe.octaves ?? 4));
      osc.frequency.setValueAtTime(
        Math.max(30, Math.min(16_000, frequency * Math.pow(2, octaves / 2))),
        time,
      );
      osc.frequency.exponentialRampToValueAtTime(
        frequency,
        time + Math.max(0.015, Math.min(Math.min(0.3, decay), recipe.pitchDecay ?? 0.06)),
      );
    }
    osc.connect(recipeFilter);
    osc.start(time);
    osc.stop(time + duration);
    registerNativeDrumSource(chokeState, def.chokeGroup, osc);
    recordExportTrace("native-source", { kind: "OscillatorNode", piece });
  };

  if (usesNoise) addNoise();
  else addOscillator();
  if (recipe.engine === "snare") addOscillator(Math.min(decay, 0.16));
}

function chokeNativeDrumGroup(
  state: NativeDrumChokeState,
  chokeGroup: string | undefined,
  time: number,
): void {
  if (!chokeGroup) return;
  const active = state.get(chokeGroup);
  if (!active) return;
  for (const source of active) {
    try {
      source.stop(time);
    } catch {
      // A naturally completed source is already silent.
    }
  }
  state.delete(chokeGroup);
}

function registerNativeDrumSource(
  state: NativeDrumChokeState,
  chokeGroup: string | undefined,
  source: AudioScheduledSourceNode,
): void {
  if (!chokeGroup) return;
  const active = state.get(chokeGroup) ?? [];
  active.push(source);
  state.set(chokeGroup, active);
}

function connectNativePieceSends(
  ctx: OfflineAudioContext,
  source: AudioNode,
  destinations: Record<SendBusId, GainNode>,
  reverbAmount: number,
  delayAmount: number,
  trackVolume: number,
): void {
  const sendLevels: Array<[SendBusId, number]> = [
    ["roomReverb", reverbAmount],
    ["tapeDelay", delayAmount],
  ];
  for (const [busId, amount] of sendLevels) {
    const level = clamp01(amount) * clamp01(trackVolume);
    if (level <= 0.0001) continue;
    const send = ctx.createGain();
    send.gain.value = level;
    source.connect(send);
    send.connect(destinations[busId]);
  }
}

function scheduleNativeMelodicNote(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  track: Track,
  ev: NoteEvent,
  time: number,
  durationSec: number,
  velocity: number,
  sampleBank?: NativeSampleBank,
): void {
  const dur = Math.max(0.05, durationSec);
  if (sampleBank?.zones.length) {
    scheduleNativeSampledNote(ctx, destination, sampleBank, ev.note, time, dur, velocity);
    return;
  }
  const freq = noteToFrequency(ev.note);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = nativeOscillatorType(track);
  osc.frequency.setValueAtTime(freq, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, velocity * nativeTrackGainScale(track)), time + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + dur + nativeReleaseSeconds(track));
  osc.connect(gain);
  gain.connect(destination);
  osc.start(time);
  osc.stop(time + dur + nativeReleaseSeconds(track));
  recordExportTrace("native-source", { kind: "OscillatorNode", trackKind: track.kind });
}

function scheduleNativeSampledNote(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  bank: NativeSampleBank,
  note: string,
  time: number,
  durationSec: number,
  velocity: number,
): void {
  const targetFrequency = noteToFrequency(note);
  const eligible = bank.zones.filter(
    (zone) => velocity >= zone.minVelocity && velocity <= zone.maxVelocity,
  );
  const candidates = eligible.length ? eligible : bank.zones;
  const zone = candidates.reduce((nearest, candidate) => {
    const nearestDistance = Math.abs(
      Math.log2(targetFrequency / noteToFrequency(nearest.rootNote)),
    );
    const candidateDistance = Math.abs(
      Math.log2(targetFrequency / noteToFrequency(candidate.rootNote)),
    );
    return candidateDistance < nearestDistance ? candidate : nearest;
  });
  const rootFrequency = noteToFrequency(zone.rootNote);
  const playbackRate = Math.max(0.125, Math.min(8, targetFrequency / rootFrequency));
  const naturalDuration = zone.buffer.duration / playbackRate;
  const audibleDuration = Math.max(
    0.03,
    Math.min(naturalDuration, durationSec + bank.releaseSec),
  );
  const attack = Math.min(bank.attackSec, audibleDuration * 0.2);
  const release = Math.min(bank.releaseSec, Math.max(0.01, audibleDuration * 0.4));
  const fadeAt = Math.max(time + attack, time + audibleDuration - release);

  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = zone.buffer;
  source.playbackRate.setValueAtTime(playbackRate, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, velocity * 0.8), time + attack);
  gain.gain.setValueAtTime(Math.max(0.0001, velocity * 0.8), fadeAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + audibleDuration);
  source.connect(gain);
  gain.connect(destination);
  source.start(time);
  source.stop(time + audibleDuration);
  recordExportTrace("native-source", {
    kind: "SampledAudioBufferSourceNode",
    presetId: bank.presetId,
    rootNote: zone.rootNote,
    note,
  });
}

function scheduleNativeAudioClip(
  ctx: OfflineAudioContext,
  destination: AudioNode,
  buffer: AudioBuffer | undefined,
  clip: { id: string; start: number; durationSec: number; offsetSec?: number; reversed?: boolean },
  bpm: number,
  plan: ExportPlan,
): void {
  if (!buffer) return;
  const beatStart = clip.start - plan.startBeat;
  const offset = Math.max(0, clip.offsetSec ?? 0);
  const duration = Math.max(0, clip.durationSec);
  let when = Math.max(0, (beatStart * 60) / bpm);
  let sourceOffset = offset;
  let sourceDuration = duration;
  if (beatStart < 0) {
    const skipSec = (-beatStart * 60) / bpm;
    if (skipSec >= duration) return;
    sourceOffset += skipSec;
    sourceDuration -= skipSec;
    when = 0;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(destination);
  src.start(when, sourceOffset, sourceDuration);
  recordExportTrace("native-audio-clip", { clipId: clip.id, reversed: !!clip.reversed });
  recordExportTrace("native-source", { kind: "AudioBufferSourceNode", clipId: clip.id });
}

function nativeOscillatorType(track: Track): OscillatorType {
  if (track.kind === "bass") return track.preset === "sub" ? "sine" : "sawtooth";
  if (track.kind === "guitar") return "triangle";
  return "sine";
}

function nativeTrackGainScale(track: Track): number {
  if (track.kind === "bass") return 0.8;
  if (track.kind === "guitar") return 0.45;
  return 0.55;
}

function nativeReleaseSeconds(track: Track): number {
  if (track.kind === "bass") return 0.04;
  if (track.kind === "guitar") return 0.08;
  return 0.12;
}

function noteToFrequency(note: string): number {
  const match = note.match(/^([A-Ga-g][#b]?)(-?\d+)$/);
  if (!match) return 440;
  const semitones: Record<string, number> = {
    C: 0,
    "C#": 1,
    Db: 1,
    D: 2,
    "D#": 3,
    Eb: 3,
    E: 4,
    F: 5,
    "F#": 6,
    Gb: 6,
    G: 7,
    "G#": 8,
    Ab: 8,
    A: 9,
    "A#": 10,
    Bb: 10,
    B: 11,
  };
  const pitch = match[1][0].toUpperCase() + match[1].slice(1);
  const octave = Number.parseInt(match[2], 10);
  const midi = (octave + 1) * 12 + (semitones[pitch] ?? 0);
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}
function clamp(x: number, min: number, max: number) {
  return Math.max(min, Math.min(max, x));
}
function clampPan(x: number) {
  return Math.max(-1, Math.min(1, x));
}

// ---------- WAV encoding ----------

async function encodeWav(
  buffer: AudioBuffer,
  onProgress?: (p: number) => void,
): Promise<ArrayBuffer> {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const ab = new ArrayBuffer(totalSize);
  const view = new DataView(ab);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, "WAVE");
  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channels.push(buffer.getChannelData(c));

  let offset = headerSize;
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channels[c][i];
      if (sample > 1) sample = 1;
      else if (sample < -1) sample = -1;
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
    if (i > 0 && i % 16384 === 0) {
      onProgress?.(Math.min(0.99, i / numFrames));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  onProgress?.(1);
  return ab;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

// ---------- MP3 encoding ----------

async function encodeMp3(
  buffer: AudioBuffer,
  onProgress?: (p: number) => void,
): Promise<Uint8Array> {
  const { default: lamejs } = await import("@breezystack/lamejs");
  const numChannels = Math.min(2, buffer.numberOfChannels);
  const sampleRate = buffer.sampleRate;
  const kbps = 192;
  const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, kbps);

  const blockSize = 1152;
  const leftInput = buffer.getChannelData(0);
  const rightInput = numChannels > 1 ? buffer.getChannelData(1) : leftInput;
  const left = new Int16Array(blockSize);
  const right = numChannels > 1 ? new Int16Array(blockSize) : left;
  const numFrames = leftInput.length;
  const chunks: Uint8Array[] = [];

  for (let i = 0; i < numFrames; i += blockSize) {
    const end = Math.min(i + blockSize, numFrames);
    const frameCount = end - i;
    for (let frame = 0; frame < frameCount; frame++) {
      left[frame] = floatSampleTo16(leftInput[i + frame]);
      if (numChannels > 1) right[frame] = floatSampleTo16(rightInput[i + frame]);
    }
    const lChunk = left.subarray(0, frameCount);
    const rChunk = right.subarray(0, frameCount);
    const mp3buf =
      numChannels > 1
        ? encoder.encodeBuffer(lChunk, rChunk)
        : encoder.encodeBuffer(lChunk);
    if (mp3buf.length > 0) chunks.push(mp3buf);
    if (onProgress && i % (blockSize * 64) === 0) {
      onProgress(Math.min(0.99, i / numFrames));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }
  const flush = encoder.flush();
  if (flush.length > 0) chunks.push(flush);
  onProgress?.(1);

  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function floatSampleTo16(sample: number): number {
  const bounded = Math.max(-1, Math.min(1, sample));
  return bounded < 0 ? bounded * 0x8000 : bounded * 0x7fff;
}

// ---------- Stems & DAW Pack export ----------

export interface StemProgress {
  trackIndex: number;
  trackCount: number;
  trackName: string;
  phase: RenderPhase | "packaging";
}

export type StemsProgressCallback = (p: StemProgress) => void;

/**
 * Render a single track in isolation and return a WAV Blob.
 * All other tracks are muted for this render pass.
 */
export async function renderStemForTrack(
  project: Project,
  trackId: string,
  options: RenderOptions = {},
): Promise<Blob> {
  const soloProject: Project = {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      muted: t.id !== trackId,
      solo: false,
    })),
  };
  const result = await renderProject(soloProject, "wav", undefined, options);
  return result.blob;
}

/**
 * Render each un-muted, non-vocals track as its own WAV file.
 * Returns an array of { name, wav } ready to zip.
 */
export async function renderStems(
  project: Project,
  options: RenderOptions = {},
  onProgress?: StemsProgressCallback,
): Promise<Array<{ name: string; wav: Blob }>> {
  const anySolo = project.tracks.some((t) => t.solo);
  const eligible = project.tracks.filter(
    (t) => !t.muted && (!anySolo || t.solo) && t.kind !== "vocals",
  );
  const out: Array<{ name: string; wav: Blob }> = [];
  for (let i = 0; i < eligible.length; i++) {
    const t = eligible[i];
    onProgress?.({
      trackIndex: i,
      trackCount: eligible.length,
      trackName: t.name,
      phase: "rendering",
    });
    const wav = await renderStemForTrack(project, t.id, options);
    out.push({ name: t.name, wav });
  }
  return out;
}

/**
 * Assemble a Stems ZIP: stems/<trackname>.wav for each eligible track.
 */
export async function exportStemsZip(
  project: Project,
  options: RenderOptions = {},
  onProgress?: StemsProgressCallback,
): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const stems = await renderStems(project, options, onProgress);
  for (const s of stems) {
    onProgress?.({
      trackIndex: stems.indexOf(s),
      trackCount: stems.length,
      trackName: s.name,
      phase: "packaging",
    });
    const safe = safeFilename(s.name);
    zip.file(`${safe}.wav`, s.wav);
  }
  return zip.generateAsync({ type: "blob" });
}

/**
 * Build the full DAW Pack ZIP containing:
 *   mix.wav, stems/<track>.wav, midi/<track>.mid,
 *   project.snproj.json, README.txt
 */
export async function exportDawPack(
  project: Project,
  projectJson: string,
  midiFiles: Array<{ name: string; bytes: Uint8Array }>,
  options: RenderOptions = {},
  onProgress?: StemsProgressCallback,
): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  // Full mix
  onProgress?.({ trackIndex: 0, trackCount: 1, trackName: "Full mix", phase: "rendering" });
  const mixResult = await renderProject(project, "wav", undefined, options);
  zip.file("mix.wav", mixResult.blob);

  // Stems
  const stems = await renderStems(project, options, (p) => {
    onProgress?.(p);
  });
  const stemsFolder = zip.folder("stems")!;
  for (const s of stems) {
    stemsFolder.file(`${safeFilename(s.name)}.wav`, s.wav);
  }

  // MIDI files
  const midiFolder = zip.folder("midi")!;
  for (const m of midiFiles) {
    midiFolder.file(`${safeFilename(m.name)}.mid`, m.bytes);
  }

  // Project file
  zip.file("project.snproj.json", projectJson);

  // README
  const anySolo = project.tracks.some((t) => t.solo);
  const trackLines = project.tracks
    .filter((t) => !t.muted && (!anySolo || t.solo))
    .map((t) => `  - ${t.name} (${t.kind})`)
    .join("\n");
  const now = new Date();
  const readme =
    `Shotgun Ninjas Virtual Studio — DAW Pack\n` +
    `=========================================\n\n` +
    `Project : ${project.name}\n` +
    `BPM     : ${project.bpm}\n` +
    `Bars    : ${project.bars}\n` +
    `Exported: ${now.toISOString()}\n\n` +
    `Tracks\n------\n${trackLines}\n\n` +
    `Contents\n--------\n` +
    `  mix.wav            — Full stereo mixdown\n` +
    `  stems/<name>.wav   — Individual track renders\n` +
    `  midi/<name>.mid    — MIDI data for melodic tracks\n` +
    `  project.snproj.json — Re-importable project file\n\n` +
    `Open mix.wav or any stems/*.wav in Ableton, Logic, FL Studio, Reaper, etc.\n` +
    `Import midi/*.mid into any DAW or notation app (MuseScore, Sibelius, Finale).\n` +
    `Import project.snproj.json back into Shotgun Ninjas Virtual Studio.\n\n` +
    `Made with Shotgun Ninjas Virtual Studio — https://shotgunninjas.com/studio\n`;
  zip.file("README.txt", readme);

  onProgress?.({ trackIndex: 0, trackCount: 1, trackName: "Packaging…", phase: "packaging" });
  return zip.generateAsync({ type: "blob" });
}

/**
 * Scan an AudioBuffer for samples above 0 dBFS. Returns the peak in dBFS
 * and a clipping flag, used to surface the master clipping warning in the
 * Export modal.
 */
export function detectClipping(buffer: AudioBuffer): { clipped: boolean; peakDb: number } {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
  }
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  return { clipped: peak >= 0.999, peakDb };
}
