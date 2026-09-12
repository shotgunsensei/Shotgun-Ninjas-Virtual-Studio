import type { SendBusId } from "../../types";

/** Shared live/offline space recipes. All feedback loops are damped and bounded. */
export const SPACE_RECIPES = {
  roomReverb: { seconds: 0.9, preDelay: 0.012, decay: 3.2, gain: 0.65, seed: 0x51a7 },
  neonHall: { seconds: 2.6, preDelay: 0.028, decay: 2.4, gain: 0.5, seed: 0x9e37 },
} as const;

export function delayRecipe(id: "tapeDelay" | "darkSlapback", bpm: number) {
  return id === "tapeDelay"
    ? { seconds: 45 / Math.max(40, Math.min(240, bpm)), feedback: 0.36, low: 180, high: 4_500, gain: 0.65 }
    : { seconds: 0.11, feedback: 0.18, low: 240, high: 2_800, gain: 0.6 };
}

// Two small impulse buffers per context, reused for the lifetime of that context.
// Generate PCM directly; never launch an offline rendering context to make reverb.
const impulses = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();
export function spaceImpulse(ctx: BaseAudioContext, id: keyof typeof SPACE_RECIPES): AudioBuffer {
  let cache = impulses.get(ctx);
  if (!cache) { cache = new Map(); impulses.set(ctx, cache); }
  const existing = cache.get(id);
  if (existing) return existing;
  const recipe = SPACE_RECIPES[id];
  const buffer = ctx.createBuffer(2, Math.ceil(recipe.seconds * ctx.sampleRate), ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let seed = recipe.seed + channel * 10_007;
    let low = 0;
    let dc = 0;
    const start = Math.floor(recipe.preDelay * ctx.sampleRate);
    for (let i = start; i < data.length; i++) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      const age = (i - start) / (data.length - start);
      const noise = (seed / 0xffffffff) * 2 - 1;
      // High frequencies decay first. Remove low rumble before it fills the room.
      const cutoff = 6_500 * (1 - age) + 1_100 * age;
      low += (1 - Math.exp(-2 * Math.PI * cutoff / ctx.sampleRate)) * (noise - low);
      dc += (1 - Math.exp(-2 * Math.PI * 170 / ctx.sampleRate)) * (low - dc);
      const rise = Math.min(1, (i - start) / (ctx.sampleRate * 0.025));
      data[i] = (low - dc) * rise * (1 - age) ** recipe.decay;
    }
    for (const [seconds, gain] of [[0.009, 0.55], [0.021, 0.35], [0.038, 0.22]]) {
      const index = start + Math.floor((seconds + channel * 0.0017) * ctx.sampleRate);
      if (index < data.length) data[index] += gain;
    }
  }
  cache.set(id, buffer);
  return buffer;
}

export interface NativeSendEffect {
  input: GainNode;
  output: GainNode;
  nodes: AudioNode[];
  setBpm(bpm: number): void;
  dispose(): void;
}

export function createSendEffect(ctx: BaseAudioContext, id: SendBusId, bpm: number): NativeSendEffect {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const nodes: AudioNode[] = [input, output];
  let delay: DelayNode | undefined;
  if (id === "roomReverb" || id === "neonHall") {
    const convolver = ctx.createConvolver();
    convolver.normalize = true;
    convolver.buffer = spaceImpulse(ctx, id);
    output.gain.value = SPACE_RECIPES[id].gain;
    input.connect(convolver);
    convolver.connect(output);
    nodes.push(convolver);
  } else {
    const recipe = delayRecipe(id, bpm);
    delay = ctx.createDelay(2);
    delay.delayTime.value = recipe.seconds;
    const highpass = ctx.createBiquadFilter();
    const lowpass = ctx.createBiquadFilter();
    const feedback = ctx.createGain();
    highpass.type = "highpass";
    highpass.frequency.value = recipe.low;
    highpass.Q.value = 0.5;
    lowpass.type = "lowpass";
    lowpass.frequency.value = recipe.high;
    lowpass.Q.value = 0.5;
    feedback.gain.value = recipe.feedback;
    output.gain.value = recipe.gain;
    input.connect(delay);
    delay.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(output);
    lowpass.connect(feedback);
    feedback.connect(delay);
    nodes.push(delay, highpass, lowpass, feedback);
  }
  let disposed = false;
  return {
    input, output, nodes,
    setBpm(next) {
      if (disposed || !delay || id !== "tapeDelay") return;
      const param = delay.delayTime;
      param.cancelScheduledValues(ctx.currentTime);
      param.setValueAtTime(param.value, ctx.currentTime);
      param.linearRampToValueAtTime(delayRecipe(id, next).seconds, ctx.currentTime + 0.05);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      nodes.forEach((node) => node.disconnect());
    },
  };
}
