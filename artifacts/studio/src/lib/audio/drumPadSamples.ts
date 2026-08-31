import * as Tone from "tone";
import type {
  DrumPadSamplePiece,
  DrumPieceSettings,
  SampleLibraryItem,
  Track,
} from "../../types";
import {
  connectToneCompatible,
  disconnectToneCompatible,
} from "./toneConnection";

export const ASSIGNABLE_DRUM_PAD_PIECES = [
  "kick",
  "snare",
  "hat",
  "ohat",
  "clap",
  "tomLow",
  "tomHigh",
  "crash",
  "fx",
] as const satisfies readonly DrumPadSamplePiece[];

const ASSIGNABLE_PIECES = new Set<string>(ASSIGNABLE_DRUM_PAD_PIECES);

export function isDrumPadSamplePiece(value: string): value is DrumPadSamplePiece {
  return ASSIGNABLE_PIECES.has(value);
}

export function assignDrumPadSampleKey(
  track: Track,
  piece: DrumPadSamplePiece,
  blobKey: string,
): Track["padSamples"] {
  return { ...(track.padSamples ?? {}), [piece]: blobKey };
}

export function resolveDrumPadSample(
  track: Track,
  piece: DrumPadSamplePiece,
  samples: readonly SampleLibraryItem[],
): SampleLibraryItem | null {
  const blobKey = track.padSamples?.[piece];
  if (!blobKey) return null;
  return samples.find((sample) => sample.blobKey === blobKey) ?? null;
}

interface PadSampleResource {
  trackId: string;
  piece: DrumPadSamplePiece;
  blobKey: string;
  blob: Blob;
  url: string;
  buffer: Tone.ToneAudioBuffer;
  channel: Tone.Channel;
  activeSources: Set<Tone.ToneBufferSource>;
  destination: Tone.InputNode;
  routing: "piece" | "track" | "fallback";
  durationSec: number;
  ready: boolean;
  failed: boolean;
  effectiveAudible: boolean;
}

interface ResolvedTrackDestination {
  destination: Tone.InputNode;
  routing: "piece" | "track";
}

type TrackDestinationResolver = (
  trackId: string,
  piece: DrumPadSamplePiece,
) => ResolvedTrackDestination | null;

export type PadSampleTriggerResult = "fallback" | "suppressed" | "played";

const MAX_ACTIVE_SOURCES_PER_PAD = 8;

function volumeToDb(volume: number): number {
  const bounded = Math.max(0, Math.min(1, volume));
  return bounded <= 0.005 ? -60 : 20 * Math.log10(bounded);
}

/**
 * Owns the small set of user-assigned drum-pad players. Sources prefer the
 * owning track input (EQ/FX/sends/meter), with a bounded master route while a
 * track graph is unavailable. The regular kit remains the decode fallback.
 */
export class DrumPadSampleManager {
  private readonly resources = new Map<string, PadSampleResource>();
  private tracks = new Map<string, Track>();
  private samples: readonly SampleLibraryItem[] = [];

  constructor(
    private readonly fallbackDestination: Tone.InputNode,
    private readonly resolveTrackDestination: TrackDestinationResolver = () => null,
  ) {}

  syncSamples(samples: readonly SampleLibraryItem[]): void {
    this.samples = samples;
    this.reconcile();
  }

  syncTracks(tracks: readonly Track[]): void {
    this.tracks = new Map(tracks.map((track) => [track.id, track]));
    this.reconcile();
  }

  removeTrack(trackId: string): void {
    this.tracks.delete(trackId);
    for (const [key, resource] of this.resources) {
      if (resource.trackId !== trackId) continue;
      this.disposeResource(resource);
      this.resources.delete(key);
    }
  }

  trigger(
    trackId: string,
    piece: DrumPadSamplePiece,
    time: number | undefined,
    velocity: number,
  ): PadSampleTriggerResult {
    if (velocity <= 0.001) return "suppressed";
    const track = this.tracks.get(trackId);
    if (!track) return "fallback";
    const resource = this.resources.get(this.key(trackId, piece));
    const settings = track.pieceSettings?.[piece];
    const anyTrackSolo = Array.from(this.tracks.values()).some(
      (candidate) => candidate.solo,
    );
    const anyPieceSolo = Object.values(track.pieceSettings ?? {}).some(
      (candidate) => candidate?.solo,
    );
    const incomingAudible =
      !track.muted &&
      (!anyTrackSolo || track.solo) &&
      !settings?.muted &&
      (!anyPieceSolo || Boolean(settings?.solo)) &&
      velocity > 0.001;
    if (!incomingAudible) {
      return resource?.ready && !resource.failed ? "suppressed" : "fallback";
    }

    // Choke ownership spans both engines. A modeled closed-hat fallback must
    // stop an assigned open-hat just as an assigned hit stops the modeled
    // sibling, even when the incoming piece has no ready custom resource.
    if (piece === "hat" || piece === "ohat") {
      const chokeTime = time ?? Tone.immediate();
      for (const sibling of ["hat", "ohat"] as const) {
        const siblingResource = this.resources.get(this.key(trackId, sibling));
        if (siblingResource) this.stopResourceSources(siblingResource, chokeTime);
      }
    }

    if (!resource?.ready || resource.failed) return "fallback";
    // The assignment still owns this pad while muted/unsoloed, but it must not
    // allocate a hidden Player source for every sequencer hit. The suppressed
    // result prevents a modeled fallback from bypassing that assignment.
    if (!resource.effectiveAudible) return "suppressed";
    let source: Tone.ToneBufferSource | null = null;
    try {
      // Independent one-shots preserve natural kick/snare/crash tails while a
      // small per-pad cap prevents pathological retrigger storms from growing
      // the graph without bound. Hat choke groups are stopped above.
      while (resource.activeSources.size >= MAX_ACTIVE_SOURCES_PER_PAD) {
        const oldest = resource.activeSources.values().next().value as
          | Tone.ToneBufferSource
          | undefined;
        if (!oldest) break;
        resource.activeSources.delete(oldest);
        try { oldest.stop(time); } catch { /* already ended */ }
      }
      source = new Tone.ToneBufferSource({
        url: resource.buffer,
        playbackRate: Math.pow(2, (settings?.pitch ?? 0) / 12),
        onended: () => {
          if (source) resource.activeSources.delete(source);
        },
      }).connect(resource.channel);
      const duration = Math.max(
        0.02,
        resource.durationSec * Math.max(0.05, Math.min(1, settings?.decay ?? 1)),
      );
      resource.activeSources.add(source);
      // Direct gestures resolve `now` after source construction. Reusing a
      // timestamp captured by the engine before this work can put the first
      // hit in the past under load, even though the decoded resource is ready.
      // Transport callers still pass an explicit audio time and remain exact.
      const startTime = time ?? Tone.immediate();
      source.start(startTime, 0, duration, Math.max(0.001, Math.min(1, velocity)));
      return "played";
    } catch {
      if (source) {
        resource.activeSources.delete(source);
        try { source.dispose(); } catch { /* best effort */ }
      }
      // The regular kit remains the deterministic fallback for this hit.
      return "fallback";
    }
  }

  stopAll(): void {
    for (const resource of this.resources.values()) {
      this.stopResourceSources(resource);
    }
  }

  dispose(): void {
    for (const resource of this.resources.values()) this.disposeResource(resource);
    this.resources.clear();
    this.tracks.clear();
    this.samples = [];
  }

  snapshot() {
    return Array.from(this.resources.values()).map((resource) => ({
      trackId: resource.trackId,
      piece: resource.piece,
      blobKey: resource.blobKey,
      routing: resource.routing,
      ready: resource.ready,
      failed: resource.failed,
      effectiveAudible: resource.effectiveAudible,
      activeSources: resource.activeSources.size,
    }));
  }

  /** Re-evaluate graph ownership after a lightweight drum voice is promoted
   * to a full track voice. Until that graph exists, the bounded master route
   * keeps the assigned pad playable instead of making the first hit silent. */
  refreshRouting(trackId?: string): void {
    const anyTrackSolo = Array.from(this.tracks.values()).some((track) => track.solo);
    for (const resource of this.resources.values()) {
      if (trackId && resource.trackId !== trackId) continue;
      const track = this.tracks.get(resource.trackId);
      if (!track) continue;
      const anyPieceSolo = Object.values(track.pieceSettings ?? {}).some(
        (settings) => settings?.solo,
      );
      this.ensureRouting(resource);
      this.applyMix(
        resource,
        track,
        track.pieceSettings?.[resource.piece],
        anyTrackSolo,
        anyPieceSolo,
      );
    }
  }

  private reconcile(): void {
    const expected = new Set<string>();
    try {
      const anyTrackSolo = Array.from(this.tracks.values()).some((track) => track.solo);

      for (const track of this.tracks.values()) {
        if (track.kind !== "drums" || !track.padSamples) continue;
        const anyPieceSolo = Object.values(track.pieceSettings ?? {}).some(
          (settings) => settings?.solo,
        );
        for (const [pieceValue, blobKey] of Object.entries(track.padSamples)) {
          if (!blobKey || !isDrumPadSamplePiece(pieceValue)) continue;
          const piece = pieceValue;
          const sample = resolveDrumPadSample(track, piece, this.samples);
          if (!sample?.blob) continue;
          const key = this.key(track.id, piece);
          expected.add(key);
          let resource = this.resources.get(key);
          if (
            !resource ||
            resource.blobKey !== blobKey ||
            resource.blob !== sample.blob
          ) {
            // Build the candidate completely before disturbing the working
            // resource. A constructor/connect failure then degrades to the
            // regular kit without leaking a URL or half-connected Tone node.
            const replacement = this.createResource(
              track.id,
              piece,
              blobKey,
              sample.blob,
              sample.durationSec,
            );
            if (!replacement) {
              if (resource) this.disposeResource(resource);
              this.resources.delete(key);
              continue;
            }
            this.resources.set(key, replacement);
            if (resource) this.disposeResource(resource);
            resource = replacement;
          }
          this.ensureRouting(resource);
          this.applyMix(
            resource,
            track,
            track.pieceSettings?.[piece],
            anyTrackSolo,
            anyPieceSolo,
          );
        }
      }
    } catch {
      // Reconciliation is called from store mutation paths. An unavailable
      // browser audio primitive must never make a project edit or save fail.
    } finally {
      for (const [key, resource] of this.resources) {
        if (expected.has(key)) continue;
        this.disposeResource(resource);
        this.resources.delete(key);
      }
    }
  }

  private createResource(
    trackId: string,
    piece: DrumPadSamplePiece,
    blobKey: string,
    blob: Blob,
    durationSec: number,
  ): PadSampleResource | null {
    let url: string | null = null;
    let channel: Tone.Channel | null = null;
    let buffer: Tone.ToneAudioBuffer | null = null;
    let resource: PadSampleResource | null = null;
    let loadedBeforePublish = false;
    let failedBeforePublish = false;
    try {
      url = URL.createObjectURL(blob);
      channel = new Tone.Channel({ volume: 0, pan: 0 });
      const route = this.resolveRouting(trackId, piece);
      let publishedRoute = route;
      try {
        connectToneCompatible(channel, route.destination);
      } catch {
        if (route.routing === "fallback") throw new Error("Pad sample output is unavailable.");
        connectToneCompatible(channel, this.fallbackDestination);
        publishedRoute = {
          destination: this.fallbackDestination,
          routing: "fallback",
        };
      }
      buffer = new Tone.ToneAudioBuffer(
        url,
        () => {
          loadedBeforePublish = true;
          if (resource) resource.ready = true;
        },
        () => {
          failedBeforePublish = true;
          if (resource) resource.failed = true;
        },
      );
      resource = {
        trackId,
        piece,
        blobKey,
        blob,
        url,
        buffer,
        channel,
        activeSources: new Set(),
        destination: publishedRoute.destination,
        routing: publishedRoute.routing,
        durationSec: Math.max(0.02, durationSec),
        ready: buffer.loaded || loadedBeforePublish,
        failed: failedBeforePublish,
        effectiveAudible: false,
      };
      return resource;
    } catch {
      try { buffer?.dispose(); } catch { /* best effort */ }
      try { channel?.dispose(); } catch { /* best effort */ }
      if (url) {
        try { URL.revokeObjectURL(url); } catch { /* best effort */ }
      }
      return null;
    }
  }

  private resolveRouting(
    trackId: string,
    piece: DrumPadSamplePiece,
  ): {
    destination: Tone.InputNode;
    routing: "piece" | "track" | "fallback";
  } {
    try {
      const resolved = this.resolveTrackDestination(trackId, piece);
      if (resolved) return resolved;
    } catch {
      // A disposed/rebuilding track graph falls through to the bounded route.
    }
    return { destination: this.fallbackDestination, routing: "fallback" };
  }

  private ensureRouting(resource: PadSampleResource): void {
    const desired = this.resolveRouting(resource.trackId, resource.piece);
    if (
      desired.destination === resource.destination &&
      desired.routing === resource.routing
    ) return;
    try {
      disconnectToneCompatible(resource.channel);
      connectToneCompatible(resource.channel, desired.destination);
      resource.destination = desired.destination;
      resource.routing = desired.routing;
    } catch {
      // Never leave a previously usable player disconnected. A full track
      // graph can disappear during project replacement, so reconnect to the
      // master only until the engine publishes its successor.
      try {
        disconnectToneCompatible(resource.channel);
        connectToneCompatible(resource.channel, this.fallbackDestination);
        resource.destination = this.fallbackDestination;
        resource.routing = "fallback";
      } catch {
        resource.failed = true;
      }
    }
  }

  private applyMix(
    resource: PadSampleResource,
    track: Track,
    settings: Partial<DrumPieceSettings> | undefined,
    anyTrackSolo: boolean,
    anyPieceSolo: boolean,
  ): void {
    resource.effectiveAudible = false;
    try {
      const audibleTrack = !track.muted && (!anyTrackSolo || track.solo);
      const audiblePiece =
        !settings?.muted && (!anyPieceSolo || Boolean(settings?.solo));
      resource.effectiveAudible = audibleTrack && audiblePiece;
      const pieceVolume = settings?.volume ?? 1;
      // A track route receives track volume/pan once from the owning channel;
      // the bounded master fallback must provide those controls itself.
      const routedVolume = resource.routing === "piece"
        ? 1
        : resource.routing === "track"
          ? pieceVolume
          : track.volume * pieceVolume;
      resource.channel.volume.value =
        audibleTrack && audiblePiece ? volumeToDb(routedVolume) : -Infinity;
      resource.channel.pan.value = Math.max(
        -1,
        Math.min(
          1,
          resource.routing === "piece"
            ? 0
            : (resource.routing === "track" ? 0 : track.pan) + (settings?.pan ?? 0),
        ),
      );
    } catch {
      // The regular kit remains available if a node is being torn down.
    }
  }

  private disposeResource(resource: PadSampleResource): void {
    this.stopResourceSources(resource);
    try { resource.buffer.dispose(); } catch { /* best effort */ }
    try { resource.channel.dispose(); } catch { /* best effort */ }
    try { URL.revokeObjectURL(resource.url); } catch { /* best effort */ }
  }

  private stopResourceSources(resource: PadSampleResource, time?: number): void {
    for (const source of resource.activeSources) {
      try { source.stop(time); } catch { /* already stopped */ }
    }
    resource.activeSources.clear();
  }

  private key(trackId: string, piece: DrumPadSamplePiece): string {
    return `${trackId}:${piece}`;
  }
}
