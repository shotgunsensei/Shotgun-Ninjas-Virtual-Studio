/** One bounded native envelope, shared by custom instruments and their WAVs.
 * All times follow the audio clock; no polling, timers or extra nodes. */
export interface SampleEnvelope {
  started: number;
  attackEnd: number;
  fadeAt: number;
  naturalEnd: number;
  level: number;
  releaseAt: number;
  end: number;
}

const finite = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback;

export function scheduleSampleEnvelope(
  param: AudioParam,
  started: number,
  naturalDuration: number,
  attack: number,
  level: number,
): SampleEnvelope {
  const tail = Math.min(0.005, naturalDuration / 2);
  const naturalEnd = started + naturalDuration;
  const attackDuration = Math.max(0.002, finite(attack, 0.002));
  const attackEnd = started + Math.min(attackDuration, naturalDuration - tail);
  // A short recording must retain the requested attack slope and level.
  // Reaching full velocity early would boost samples with long attacks.
  const peak = level * Math.min(1, (naturalDuration - tail) / attackDuration);
  const fadeAt = naturalEnd - tail;
  const envelope: SampleEnvelope = {
    started,
    attackEnd,
    fadeAt,
    naturalEnd,
    level: peak,
    releaseAt: naturalEnd,
    end: naturalEnd,
  };
  param.setValueAtTime(0, started);
  param.linearRampToValueAtTime(peak, attackEnd);
  if (fadeAt > attackEnd) param.setValueAtTime(peak, fadeAt);
  // Account for transposition: the recording may end before the note gate.
  param.linearRampToValueAtTime(0, naturalEnd);
  return envelope;
}

/** An earlier key-up may shorten a scheduled gate. Later/duplicate key-ups
 * must never raise a tail or extend its source lifetime. */
export function releaseSampleEnvelope(
  param: AudioParam,
  envelope: SampleEnvelope,
  requestedTime: number,
  release: number,
): number {
  const at = Math.max(
    envelope.started,
    finite(requestedTime, envelope.started),
  );
  if (at >= envelope.releaseAt) return envelope.end;
  const { started, attackEnd, fadeAt, naturalEnd, level } = envelope;
  const held =
    level *
    (at < attackEnd
      ? (at - started) / (attackEnd - started)
      : at > fadeAt
        ? (naturalEnd - at) / (naturalEnd - fadeAt)
        : 1);
  param.cancelScheduledValues(at);
  // Canceling the next ramp endpoint also cancels its preceding slope.
  // Restore the partial attack/fade before starting the release ramp.
  if (at > started && (at <= attackEnd || at > fadeAt)) {
    param.linearRampToValueAtTime(held, at);
  } else {
    param.setValueAtTime(held, at);
  }
  envelope.releaseAt = at;
  envelope.end = Math.min(
    envelope.end,
    naturalEnd,
    at + Math.max(0.005, finite(release, 0.6)),
  );
  param.linearRampToValueAtTime(0, envelope.end);
  return envelope.end;
}
