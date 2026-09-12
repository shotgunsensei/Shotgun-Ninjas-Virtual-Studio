import type { MelodicSynthRecipe } from "./sounds/types";

const bounded = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, Number.isFinite(value) ? value : low));

/** A short harmonic string excitation; Web Audio band-limits the waveform. */
export function pluckCharacter(dampening = 4_500, resonance = 0.94, pick = 0.6) {
  const brightness = bounded(dampening, 400, 12_000);
  const body = bounded(resonance, 0, 1);
  const edge = bounded(pick, 0, 1);
  return {
    partials: [1, 0.24 + edge * 0.22, 0.32, 0.1 + edge * 0.12, 0.14, 0.06, 0.06, 0.025],
    baseFrequency: brightness * 0.22,
    octaves: 1.6 + edge * 1.1,
    decay: 0.16 + body * 1.15,
    filterDecay: 0.06 + body * 0.3,
  };
}

/** Native WAV keeps the recipe's envelope and harmonic family, without Tone. */
export function scheduleModeledNote(
  ctx: BaseAudioContext,
  destination: AudioNode,
  recipe: MelodicSynthRecipe,
  frequency: number,
  time: number,
  duration: number,
  velocity: number,
  presetId = "",
): void {
  const v = bounded(velocity, 0, 1);
  if (v === 0) return;
  const r = recipe;
  const attack = Math.max(0.001, bounded(r.attack, 0, 1) * 2);
  const decay = Math.max(0.001, bounded(r.decay, 0, 1) * 1.5);
  const release = Math.max(0.01, bounded(r.release, 0, 1) * 3);
  const sustain = bounded(r.sustain, 0, 1);
  const gate = Math.max(0.005, duration);
  const end = time + gate + release;
  const amp = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  const osc = ctx.createOscillator();
  const nodes: AudioNode[] = [osc, filter, amp];
  const sources: OscillatorNode[] = [osc];
  osc.frequency.setValueAtTime(bounded(frequency, 8, ctx.sampleRate * 0.45), time);
  let level = 0.22;
  let cutoff = 700 + bounded(r.cutoff, 0, 1) ** 2 * 14_000;
  let filterDecay = decay;
  const fm = (ratio: number, index: number) => {
    const mod = ctx.createOscillator();
    const depth = ctx.createGain();
    mod.frequency.value = frequency * ratio;
    const amount = frequency * index * v;
    depth.gain.setValueAtTime(amount, time);
    depth.gain.exponentialRampToValueAtTime(Math.max(0.001, amount * 0.035), time + 0.4);
    mod.connect(depth);
    depth.connect(osc.frequency);
    sources.push(mod);
    nodes.push(mod, depth);
  };
  switch (r.engine) {
    case "sampler": osc.type = "triangle"; fm(2.01, 1.8); level = 0.2; break;
    case "fmkeys":
      fm(presetId === "keys.electric" ? 3.5 : 8, presetId === "keys.electric" ? 3.2 : 5.2);
      break;
    case "bell": fm(3.01, 14); level = 0.18; break;
    case "softkeys": osc.type = "triangle"; level = 0.18; break;
    case "sub": level = 0.4; cutoff = 500; break;
    case "808": {
      level = 0.4;
      const dive = bounded(r.pitchEnv ?? 0, 0, 24);
      osc.frequency.setValueAtTime(frequency * 2 ** (dive / 12), time);
      osc.frequency.exponentialRampToValueAtTime(frequency, time + 0.09);
      cutoff = 1_000;
      break;
    }
    case "pluck": {
      const shape = pluckCharacter(800 + r.cutoff * 6_500, 0.7 + Math.min(1, r.decay) * 0.28, 0.2 + r.resonance * 0.8);
      const real = new Float32Array(shape.partials.length + 1);
      const imag = new Float32Array([0, ...shape.partials]);
      osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
      cutoff = shape.baseFrequency * 2 ** (shape.octaves * (0.3 + 0.7 * v));
      filterDecay = shape.filterDecay;
      level = 0.3;
      break;
    }
    case "pad": {
      osc.type = "sawtooth";
      const second = ctx.createOscillator();
      second.type = "sawtooth";
      second.frequency.value = frequency;
      second.detune.value = 5;
      osc.detune.value = -5;
      second.connect(filter);
      sources.push(second);
      nodes.push(second);
      level = 0.07;
      break;
    }
    default: osc.type = "sawtooth"; level = r.engine === "monosaw" ? 0.2 : 0.13;
  }
  filter.type = "lowpass";
  filter.Q.value = 0.5 + bounded(r.resonance, 0, 1) * 2;
  const openHz = Math.min(ctx.sampleRate * 0.45, cutoff * (0.35 + v * 0.65));
  filter.frequency.setValueAtTime(Math.max(80, openHz), time);
  if (r.engine !== "pad" && r.engine !== "sub") {
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, openHz * 0.32), time + filterDecay);
  }
  const peak = level * v;
  const envelopeAt = (seconds: number) => seconds < attack
    ? seconds / attack
    : seconds < attack + decay
      ? 1 + (sustain - 1) * (seconds - attack) / decay
      : sustain;
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(peak * envelopeAt(Math.min(gate, attack)), time + Math.min(gate, attack));
  if (gate > attack) amp.gain.linearRampToValueAtTime(peak * envelopeAt(Math.min(gate, attack + decay)), time + Math.min(gate, attack + decay));
  if (gate > attack + decay) amp.gain.setValueAtTime(peak * sustain, time + gate);
  amp.gain.linearRampToValueAtTime(0, end);
  osc.connect(filter);
  filter.connect(amp);
  amp.connect(destination);
  osc.onended = () => nodes.forEach((node) => node.disconnect());
  for (const source of sources) { source.start(time); source.stop(end); }
}
