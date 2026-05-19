import { audio } from "../lib/audio/engine";
import { getStore } from "../store";
import type { SoundParams, Track } from "../types";

/**
 * MelodicParams — exposes the per-voice sound-shaping knobs for melodic
 * tracks (piano / guitar / bass). The sliders write through
 * `audio.setSoundParams` for immediate audibility AND persist on the
 * Track via `patchTrack({ sound })` so the values survive reloads and
 * apply when the voice is rebuilt (kit/preset swap).
 *
 * Defaults come from `track.sound`, falling back to neutral starting
 * values that match the engine's bypass state for the relevant nodes.
 */
const DEFAULTS: SoundParams = {
  attack: 0.05,
  decay: 0.25,
  sustain: 0.7,
  release: 0.3,
  cutoff: 1,
  resonance: 0.1,
  reverbSend: 0,
  delaySend: 0,
  chorusSend: 0,
  width: 0.5,
  drive: 0,
  glide: 0,
};

export function MelodicParams({ track }: { track: Track }) {
  const cur: SoundParams = { ...DEFAULTS, ...(track.sound ?? {}) };

  const set = (patch: Partial<SoundParams>) => {
    audio.setSoundParams(track.id, patch);
    getStore().patchTrack(track.id, { sound: { ...cur, ...patch } });
  };

  return (
    <div className="panel-inset rounded-md p-2 space-y-1">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
        Sound
      </div>
      <Group label="Envelope">
        <Row label="Attack" value={cur.attack} onChange={(v) => set({ attack: v })} />
        <Row label="Decay" value={cur.decay} onChange={(v) => set({ decay: v })} />
        <Row label="Sustain" value={cur.sustain} onChange={(v) => set({ sustain: v })} />
        <Row label="Release" value={cur.release} onChange={(v) => set({ release: v })} />
      </Group>
      <Group label="Filter">
        <Row label="Cutoff" value={cur.cutoff} onChange={(v) => set({ cutoff: v })} />
        <Row label="Resonance" value={cur.resonance} onChange={(v) => set({ resonance: v })} />
      </Group>
      <Group label="FX">
        <Row label="Reverb" value={cur.reverbSend} onChange={(v) => set({ reverbSend: v })} />
        <Row label="Delay" value={cur.delaySend} onChange={(v) => set({ delaySend: v })} />
        <Row label="Chorus" value={cur.chorusSend} onChange={(v) => set({ chorusSend: v })} />
        <Row label="Drive" value={cur.drive} onChange={(v) => set({ drive: v })} />
        <Row label="Width" value={cur.width} onChange={(v) => set({ width: v })} />
        <Row
          label="Glide"
          value={cur.glide / 0.4}
          onChange={(v) => set({ glide: v * 0.4 })}
        />
      </Group>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/80">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[9px] text-muted-foreground w-16 truncate">
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-3 accent-primary"
      />
      <span className="font-mono text-[9px] text-foreground/80 w-8 text-right">
        {Math.round(value * 100)}
      </span>
    </div>
  );
}
