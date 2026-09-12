import type { NoteClip, NoteEvent, Project, Track } from "../../types";

/** Only the addressed note onset changes; off-grid notes and other bars survive. */
export function toggleBasicNote(
  clip: NoteClip,
  note: string,
  time: number,
  duration = 0.2,
  velocity = 0.75,
): NoteClip {
  if (!Number.isFinite(time) || time < 0 || time >= clip.length) return clip;
  const matches = (event: NoteEvent) =>
    event.note === note && Math.abs(event.time - time) < 0.0001;
  const notes = clip.notes.some(matches)
    ? clip.notes.filter((event) => !matches(event))
    : [
        ...clip.notes,
        {
          note,
          time,
          duration: Math.min(duration, clip.length - time),
          velocity,
        },
      ].sort((a, b) => a.time - b.time);
  return { ...clip, notes };
}

/** Musical content, including recorded audio, determines where a repeat starts. */
export function basicSongEnd(project: Project): number {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.noteClips)
      end = Math.max(end, clip.start + clip.length);
    for (const clip of track.audioClips) {
      end = Math.max(end, clip.start + (clip.durationSec * project.bpm) / 60);
    }
  }
  return Math.ceil(end / 4) * 4;
}

/** A single project patch keeps clips and their playable range in sync. */
export function appendBasicClip(
  project: Project,
  track: Track,
  clip: NoteClip,
): Partial<Project> {
  const exists = project.tracks.some((item) => item.id === track.id);
  const tracks = exists
    ? project.tracks.map((item) =>
        item.id === track.id
          ? { ...item, noteClips: [...item.noteClips, clip] }
          : item,
      )
    : [...project.tracks, { ...track, noteClips: [...track.noteClips, clip] }];
  return {
    tracks,
    bars: Math.max(project.bars, Math.ceil((clip.start + clip.length) / 4)),
    loopEndBeat: project.loopEnabled
      ? Math.max(project.loopEndBeat, clip.start + clip.length)
      : project.loopEndBeat,
  };
}

/** Repeat a complete song without sharing editable note/automation objects.
 * Audio blobs are intentionally reused, matching the existing duplicate action.
 */
export function repeatBasicSong(
  project: Project,
  id: () => string,
  source = project,
): Partial<Project> | null {
  const end = basicSongEnd(project);
  const sourceEnd = basicSongEnd(source);
  if (end <= 0 || sourceEnd <= 0) return null;
  const tracks = project.tracks.map((track) => {
    const original = source.tracks.find((item) => item.id === track.id);
    if (!original) return track;
    return {
      ...track,
      noteClips: [
        ...track.noteClips,
        ...original.noteClips.map((clip) => ({
          ...clip,
          id: id(),
          start: clip.start + end,
          notes: clip.notes.map((note) => ({ ...note })),
        })),
      ],
      audioClips: [
        ...track.audioClips,
        ...original.audioClips.map((clip) => ({
          ...clip,
          id: id(),
          start: clip.start + end,
        })),
      ],
      automationLanes: track.automationLanes?.map((lane) => {
        const sourceLane = original.automationLanes?.find(
          (item) => item.id === lane.id,
        );
        // At the repeat boundary the copied beginning wins. Duplicate timestamps
        // otherwise make interpolation depend on an accidental array order.
        const points = new Map(
          lane.breakpoints.map((point) => [point.beat, point]),
        );
        for (const point of sourceLane?.breakpoints ?? []) {
          if (point.beat >= 0 && point.beat <= sourceEnd) {
            points.set(point.beat + end, { ...point, beat: point.beat + end });
          }
        }
        return {
          ...lane,
          breakpoints: [...points.values()].sort((a, b) => a.beat - b.beat),
        };
      }),
    };
  });
  const sections = [...(project.sections ?? [])];
  if (!sections.some((section) => section.bar === 0)) {
    sections.push({ id: id(), bar: 0, label: "Part 1" });
  }
  sections.push({ id: id(), bar: end / 4, label: "Repeat" });
  return {
    tracks,
    sections: sections.sort((a, b) => a.bar - b.bar),
    bars: Math.max(project.bars, Math.ceil((end + sourceEnd) / 4)),
    loopStartBeat: 0,
    loopEndBeat: end + sourceEnd,
  };
}
