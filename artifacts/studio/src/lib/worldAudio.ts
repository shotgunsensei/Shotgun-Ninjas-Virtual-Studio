import type { StudioWorld } from "./worlds";

/**
 * Synthesize a short welcome cue for the given world using the Web Audio API
 * directly. No Tone.js dependency — just raw AudioContext so it works even
 * before the Tone engine is fully started.
 */
export function playWorldWelcome(world: StudioWorld, ctx: AudioContext): void {
  try {
    const { type, freq, duration } = world.welcomeSynth;
    switch (type) {
      case "percussive-strike":
        _percussiveStrike(ctx, freq, duration);
        break;
      case "low-rumble":
        _lowRumble(ctx, freq, duration);
        break;
      case "arpeggio":
        _arpeggio(ctx, freq, duration);
        break;
      case "chord-stab":
        _chordStab(ctx, freq, duration);
        break;
      case "deep-gong":
        _deepGong(ctx, freq, duration);
        break;
      case "8bit-jingle":
        _eightBitJingle(ctx, freq, duration);
        break;
    }
  } catch {
    // Non-critical — welcome cue failure never breaks anything
  }
}

function _master(ctx: AudioContext, gain: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.connect(ctx.destination);
  return g;
}

function _env(
  gain: GainNode,
  ctx: AudioContext,
  attack: number,
  decay: number,
  peak: number,
  end: number,
) {
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(Math.max(end, 0.0001), t + attack + decay);
}

/** Dojo Dark: sharp transient strike + reverb shimmer */
function _percussiveStrike(ctx: AudioContext, freq: number, dur: number) {
  const master = _master(ctx, 0.6);
  const t = ctx.currentTime;

  // Click body
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(freq * 2, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.3, t + 0.08);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.9, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.7);

  // Distortion
  const dist = ctx.createWaveShaper();
  dist.curve = _distCurve(200);

  osc.connect(dist);
  dist.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + dur);

  // Reverb shimmer — delayed noise burst
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.8, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hpf = ctx.createBiquadFilter();
  hpf.type = "highpass";
  hpf.frequency.value = 3000;
  const rg = ctx.createGain();
  rg.gain.setValueAtTime(0, t + 0.05);
  rg.gain.linearRampToValueAtTime(0.18, t + 0.1);
  rg.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(hpf);
  hpf.connect(rg);
  rg.connect(master);
  src.start(t + 0.05);
}

/** Demon Truck Garage: low distorted rumble */
function _lowRumble(ctx: AudioContext, freq: number, dur: number) {
  const master = _master(ctx, 0.5);
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.5, t + dur * 0.6);

  const dist = ctx.createWaveShaper();
  dist.curve = _distCurve(400);

  const lpf = ctx.createBiquadFilter();
  lpf.type = "lowpass";
  lpf.frequency.value = 300;
  lpf.Q.value = 2;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.9, t + 0.04);
  g.gain.setValueAtTime(0.9, t + dur * 0.4);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);

  osc.connect(dist);
  dist.connect(lpf);
  lpf.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + dur);

  // Rumble sub noise
  const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const nlpf = ctx.createBiquadFilter();
  nlpf.type = "lowpass";
  nlpf.frequency.value = 150;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0, t);
  ng.gain.linearRampToValueAtTime(0.3, t + 0.1);
  ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
  noise.connect(nlpf);
  nlpf.connect(ng);
  ng.connect(master);
  noise.start(t);
}

/** Neon Rooftop: bright arpeggiated synth blip */
function _arpeggio(ctx: AudioContext, freq: number, dur: number) {
  const master = _master(ctx, 0.45);
  const t = ctx.currentTime;
  const notes = [freq, freq * 1.25, freq * 1.5, freq * 2, freq * 2.5];
  const stepDur = dur / notes.length;

  notes.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = f;

    const g = ctx.createGain();
    const start = t + i * stepDur;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(0.7, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, start + stepDur * 0.9);

    const hpf = ctx.createBiquadFilter();
    hpf.type = "highpass";
    hpf.frequency.value = 800;

    osc.connect(hpf);
    hpf.connect(g);
    g.connect(master);
    osc.start(start);
    osc.stop(start + stepDur);
  });
}

/** Lo-Fi Smoke Room: warm filtered chord stab */
function _chordStab(ctx: AudioContext, freq: number, dur: number) {
  const master = _master(ctx, 0.4);
  const t = ctx.currentTime;
  const ratios = [1, 1.25, 1.5, 2]; // Major chord approx

  ratios.forEach((r) => {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq * r;

    // Detune slightly for warmth
    osc.detune.value = (Math.random() - 0.5) * 12;

    const lpf = ctx.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.setValueAtTime(2200, t);
    lpf.frequency.exponentialRampToValueAtTime(600, t + dur * 0.5);
    lpf.Q.value = 1.5;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.02);
    g.gain.setValueAtTime(0.35, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(lpf);
    lpf.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur);
  });
}

/** Cyber Temple: deep gong with shimmer */
function _deepGong(ctx: AudioContext, freq: number, dur: number) {
  const master = _master(ctx, 0.5);
  const t = ctx.currentTime;

  // Fundamental
  const partials = [1, 2.76, 5.4, 8.93];
  partials.forEach((p, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq * p;

    const g = ctx.createGain();
    const decay = dur / (1 + i * 0.8);
    g.gain.setValueAtTime(0.5 / (i + 1), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);

    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + decay + 0.1);
  });

  // Shimmer — high-frequency amplitude-modulated noise
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hpf = ctx.createBiquadFilter();
  hpf.type = "highpass";
  hpf.frequency.value = 5000;
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.08, t + 0.02);
  sg.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(hpf);
  hpf.connect(sg);
  sg.connect(master);
  src.start(t + 0.02);
}

/** Arcade Alley: 8-bit coin/jingle */
function _eightBitJingle(ctx: AudioContext, freq: number, dur: number) {
  const master = _master(ctx, 0.5);
  const t = ctx.currentTime;

  // Classic coin sound: two notes up
  const notes = [freq, freq * 1.5];
  const noteDur = dur / 2;

  notes.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = f;

    const g = ctx.createGain();
    const start = t + i * noteDur;
    g.gain.setValueAtTime(0.6, start);
    g.gain.setValueAtTime(0.6, start + noteDur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.001, start + noteDur);

    osc.connect(g);
    g.connect(master);
    osc.start(start);
    osc.stop(start + noteDur);
  });

  // Extra pixel shimmer
  const osc2 = ctx.createOscillator();
  osc2.type = "square";
  osc2.frequency.setValueAtTime(freq * 3, t);
  osc2.frequency.exponentialRampToValueAtTime(freq * 0.5, t + dur);
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.15, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc2.connect(g2);
  g2.connect(master);
  osc2.start(t);
  osc2.stop(t + dur);
}

function _distCurve(amount: number): Float32Array {
  const n = 256;
  const curve = new Float32Array(n);
  const k = amount;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}
