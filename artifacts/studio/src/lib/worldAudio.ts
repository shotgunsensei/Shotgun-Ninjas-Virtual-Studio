import type { StudioWorld } from "./worlds";
import type { WorldId } from "./worlds";

/**
 * Synthesize a short welcome cue for the given world using the Web Audio API
 * directly. No Tone.js dependency — just raw AudioContext so it works even
 * before the Tone engine is fully started.
 */
export function playWorldWelcome(
  world: StudioWorld,
  ctx: AudioContext,
  output: AudioNode = ctx.destination,
): void {
  try {
    const { type, freq, duration } = world.welcomeSynth;
    switch (type) {
      case "percussive-strike":
        _percussiveStrike(ctx, freq, duration, output);
        break;
      case "low-rumble":
        _lowRumble(ctx, freq, duration, output);
        break;
      case "arpeggio":
        _arpeggio(ctx, freq, duration, output);
        break;
      case "chord-stab":
        _chordStab(ctx, freq, duration, output);
        break;
      case "deep-gong":
        _deepGong(ctx, freq, duration, output);
        break;
      case "8bit-jingle":
        _eightBitJingle(ctx, freq, duration, output);
        break;
    }
  } catch {
    // Non-critical — welcome cue failure never breaks anything
  }
}

// ---------------------------------------------------------------------------
// Ambient loops
// ---------------------------------------------------------------------------

/**
 * Handle for a running ambient loop. Allows volume adjustment and clean
 * shutdown. All audio is synthesized — no file fetching required.
 */
export interface AmbientLoop {
  setVolume(vol: number): void;
  stop(): void;
}

/**
 * Start the ambient loop for the given world. Returns an AmbientLoop handle
 * so the caller can adjust volume or stop it later.
 *
 * @param worldId  Which world's ambient soundscape to start
 * @param ctx      Shared AudioContext (must be running)
 * @param volume   Initial gain (0..1). Recommended default: 0.10
 */
export function startAmbientLoop(
  worldId: WorldId,
  ctx: AudioContext,
  volume: number,
  output: AudioNode = ctx.destination,
): AmbientLoop {
  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0, ctx.currentTime);
  masterGain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 2.0);
  masterGain.connect(output);

  let stopped = false;
  const stoppers: Array<() => void> = [];

  try {
    switch (worldId) {
      case "dojo-dark":
        stoppers.push(_ambientDojoDark(ctx, masterGain, () => stopped));
        break;
      case "demon-truck-garage":
        stoppers.push(_ambientDemonTruck(ctx, masterGain, () => stopped));
        break;
      case "neon-rooftop":
        stoppers.push(_ambientNeonRooftop(ctx, masterGain, () => stopped));
        break;
      case "lofi-smoke-room":
        stoppers.push(_ambientLofiSmoke(ctx, masterGain, () => stopped));
        break;
      case "cyber-temple":
        stoppers.push(_ambientCyberTemple(ctx, masterGain, () => stopped));
        break;
      case "arcade-alley":
        stoppers.push(_ambientArcadeAlley(ctx, masterGain, () => stopped));
        break;
    }
  } catch {
    // Non-critical
  }

  return {
    setVolume(vol: number) {
      try {
        masterGain.gain.linearRampToValueAtTime(
          Math.max(0, Math.min(1, vol)),
          ctx.currentTime + 0.5,
        );
      } catch {
        // Ignore
      }
    },
    stop() {
      stopped = true;
      try {
        masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
        setTimeout(() => {
          stoppers.forEach((fn) => {
            try {
              fn();
            } catch {
              // Ignore
            }
          });
          try {
            masterGain.disconnect();
          } catch {
            // Ignore
          }
        }, 1800);
      } catch {
        // Ignore
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Per-world ambient implementations
// ---------------------------------------------------------------------------

/**
 * Dojo Dark — distant synthesized drum loop.
 * Periodic low kick pulses with soft hi-hat shimmer.
 */
function _ambientDojoDark(
  ctx: AudioContext,
  out: GainNode,
  isStopped: () => boolean,
): () => void {
  // Continuous hiss layer (very low)
  const hissBuf = _noiseBuffer(ctx, 4);
  const hissSrc = ctx.createBufferSource();
  hissSrc.buffer = hissBuf;
  hissSrc.loop = true;
  const hissLpf = ctx.createBiquadFilter();
  hissLpf.type = "bandpass";
  hissLpf.frequency.value = 6000;
  hissLpf.Q.value = 0.5;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0.04;
  hissSrc.connect(hissLpf);
  hissLpf.connect(hissGain);
  hissGain.connect(out);
  hissSrc.start();

  // Kick scheduler — one kick every ~1.5s
  const KICK_INTERVAL = 1500;
  let kicked = false;
  const scheduleKick = () => {
    if (isStopped()) return;
    _synthKick(ctx, out, 0.35);
    kicked = true;
    setTimeout(scheduleKick, KICK_INTERVAL + (Math.random() - 0.5) * 300);
  };
  const kickTimer = setTimeout(scheduleKick, 600);

  // Hi-hat shimmer every ~0.75s, offset from kick
  const scheduleHat = () => {
    if (isStopped()) return;
    _synthHat(ctx, out, 0.06);
    setTimeout(scheduleHat, 750 + (Math.random() - 0.5) * 200);
  };
  const hatTimer = setTimeout(scheduleHat, 1200);

  return () => {
    clearTimeout(kickTimer);
    clearTimeout(hatTimer);
    try {
      hissSrc.stop();
    } catch {
      // Ignore
    }
  };
}

/**
 * Demon Truck Garage — industrial drone with sporadic metallic hits.
 */
function _ambientDemonTruck(
  ctx: AudioContext,
  out: GainNode,
  isStopped: () => boolean,
): () => void {
  // Low sub-bass oscillator with slow LFO
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 42;
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 4;
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);
  const oscLpf = ctx.createBiquadFilter();
  oscLpf.type = "lowpass";
  oscLpf.frequency.value = 180;
  const oscGain = ctx.createGain();
  oscGain.gain.value = 0.3;
  osc.connect(oscLpf);
  oscLpf.connect(oscGain);
  oscGain.connect(out);
  osc.start();
  lfo.start();

  // Industrial rumble noise
  const noiseBuf = _noiseBuffer(ctx, 4);
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  noiseSrc.loop = true;
  const noiseLpf = ctx.createBiquadFilter();
  noiseLpf.type = "lowpass";
  noiseLpf.frequency.value = 220;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.15;
  noiseSrc.connect(noiseLpf);
  noiseLpf.connect(noiseGain);
  noiseGain.connect(out);
  noiseSrc.start();

  // Sporadic metallic clang
  const scheduleMetal = () => {
    if (isStopped()) return;
    _synthMetalClang(ctx, out, 0.12);
    setTimeout(scheduleMetal, 3500 + Math.random() * 4000);
  };
  const metalTimer = setTimeout(scheduleMetal, 2000);

  return () => {
    clearTimeout(metalTimer);
    try {
      osc.stop();
      lfo.stop();
      noiseSrc.stop();
    } catch {
      // Ignore
    }
  };
}

/**
 * Neon Rooftop — rain texture + occasional synth droplet ping.
 */
function _ambientNeonRooftop(
  ctx: AudioContext,
  out: GainNode,
  isStopped: () => boolean,
): () => void {
  // Rain — highpass-filtered noise
  const rainBuf = _noiseBuffer(ctx, 4);
  const rainSrc = ctx.createBufferSource();
  rainSrc.buffer = rainBuf;
  rainSrc.loop = true;
  const rainHpf = ctx.createBiquadFilter();
  rainHpf.type = "highpass";
  rainHpf.frequency.value = 4000;
  const rainGain = ctx.createGain();
  rainGain.gain.value = 0.25;
  rainSrc.connect(rainHpf);
  rainHpf.connect(rainGain);
  rainGain.connect(out);
  rainSrc.start();

  // Subtle low-end hum (city ambience)
  const humOsc = ctx.createOscillator();
  humOsc.type = "sine";
  humOsc.frequency.value = 55;
  const humGain = ctx.createGain();
  humGain.gain.value = 0.08;
  humOsc.connect(humGain);
  humGain.connect(out);
  humOsc.start();

  // Synth droplet pings
  const scheduleDrop = () => {
    if (isStopped()) return;
    _synthPing(ctx, out, 660 + Math.random() * 880, 0.05);
    setTimeout(scheduleDrop, 1800 + Math.random() * 3000);
  };
  const dropTimer = setTimeout(scheduleDrop, 800);

  return () => {
    clearTimeout(dropTimer);
    try {
      rainSrc.stop();
      humOsc.stop();
    } catch {
      // Ignore
    }
  };
}

/**
 * Lo-Fi Smoke Room — vinyl crackle + tape hiss.
 */
function _ambientLofiSmoke(
  ctx: AudioContext,
  out: GainNode,
  isStopped: () => boolean,
): () => void {
  // Tape hiss — bandpass-filtered noise
  const hissBuf = _noiseBuffer(ctx, 4);
  const hissSrc = ctx.createBufferSource();
  hissSrc.buffer = hissBuf;
  hissSrc.loop = true;
  const hissBpf = ctx.createBiquadFilter();
  hissBpf.type = "bandpass";
  hissBpf.frequency.value = 3500;
  hissBpf.Q.value = 0.8;
  const hissGain = ctx.createGain();
  hissGain.gain.value = 0.12;
  hissSrc.connect(hissBpf);
  hissBpf.connect(hissGain);
  hissGain.connect(out);
  hissSrc.start();

  // Warm sub hum (turntable motor)
  const motorOsc = ctx.createOscillator();
  motorOsc.type = "sine";
  motorOsc.frequency.value = 33.3; // 33 RPM
  const motorGain = ctx.createGain();
  motorGain.gain.value = 0.04;
  motorOsc.connect(motorGain);
  motorGain.connect(out);
  motorOsc.start();

  // Vinyl crackle — random short noise bursts
  const scheduleCrackle = () => {
    if (isStopped()) return;
    _synthCrackle(ctx, out);
    setTimeout(scheduleCrackle, 80 + Math.random() * 600);
  };
  const crackleTimer = setTimeout(scheduleCrackle, 200);

  return () => {
    clearTimeout(crackleTimer);
    try {
      hissSrc.stop();
      motorOsc.stop();
    } catch {
      // Ignore
    }
  };
}

/**
 * Cyber Temple — deep resonant drone with harmonic shimmer.
 */
function _ambientCyberTemple(
  ctx: AudioContext,
  out: GainNode,
  isStopped: () => boolean,
): () => void {
  // Drone — layered sine oscillators
  const partials = [55, 110, 165.8, 220, 330];
  const oscNodes: OscillatorNode[] = [];
  const lfoNodes: OscillatorNode[] = [];

  partials.forEach((freq, i) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = freq;
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.05 + i * 0.03;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.8;
    lfo.connect(lfoG);
    lfoG.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.18 / (i + 1);
    o.connect(g);
    g.connect(out);
    o.start();
    lfo.start();
    oscNodes.push(o);
    lfoNodes.push(lfo);
  });

  // Shimmer — slow filtered noise
  const shimBuf = _noiseBuffer(ctx, 4);
  const shimSrc = ctx.createBufferSource();
  shimSrc.buffer = shimBuf;
  shimSrc.loop = true;
  const shimHpf = ctx.createBiquadFilter();
  shimHpf.type = "highpass";
  shimHpf.frequency.value = 8000;
  const shimGain = ctx.createGain();
  shimGain.gain.value = 0.03;
  shimSrc.connect(shimHpf);
  shimHpf.connect(shimGain);
  shimGain.connect(out);
  shimSrc.start();

  // Occasional resonant bell
  const scheduleBell = () => {
    if (isStopped()) return;
    _synthBell(ctx, out, 220 + Math.random() * 110, 0.07);
    setTimeout(scheduleBell, 5000 + Math.random() * 7000);
  };
  const bellTimer = setTimeout(scheduleBell, 4000);

  return () => {
    clearTimeout(bellTimer);
    try {
      oscNodes.forEach((o) => o.stop());
      lfoNodes.forEach((l) => l.stop());
      shimSrc.stop();
    } catch {
      // Ignore
    }
  };
}

/**
 * Arcade Alley — looping 8-bit arpeggiated melody.
 */
function _ambientArcadeAlley(
  ctx: AudioContext,
  out: GainNode,
  isStopped: () => boolean,
): () => void {
  // Simple 8-bit background hum (PWM)
  const bgOsc = ctx.createOscillator();
  bgOsc.type = "square";
  bgOsc.frequency.value = 110;
  const bgGain = ctx.createGain();
  bgGain.gain.value = 0.04;
  bgOsc.connect(bgGain);
  bgGain.connect(out);
  bgOsc.start();

  // Looping arpeggio melody
  const NOTES = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25, 523.25, 392];
  let noteIndex = 0;
  const NOTE_INTERVAL = 280;

  const scheduleNote = () => {
    if (isStopped()) return;
    const freq = NOTES[noteIndex % NOTES.length];
    noteIndex++;
    _synthPixelNote(ctx, out, freq, 0.05, NOTE_INTERVAL * 0.0009);
    setTimeout(scheduleNote, NOTE_INTERVAL + (Math.random() < 0.1 ? NOTE_INTERVAL : 0));
  };
  const noteTimer = setTimeout(scheduleNote, 300);

  // Occasional blip
  const scheduleBlip = () => {
    if (isStopped()) return;
    _synthPing(ctx, out, 1760 + Math.random() * 880, 0.02);
    setTimeout(scheduleBlip, 2000 + Math.random() * 3000);
  };
  const blipTimer = setTimeout(scheduleBlip, 1500);

  return () => {
    clearTimeout(noteTimer);
    clearTimeout(blipTimer);
    try {
      bgOsc.stop();
    } catch {
      // Ignore
    }
  };
}

// ---------------------------------------------------------------------------
// Shared primitive sound generators
// ---------------------------------------------------------------------------

function _synthKick(ctx: AudioContext, out: GainNode, gain: number) {
  const t = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  g.connect(out);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(28, t + 0.35);
  osc.connect(g);
  osc.start(t);
  osc.stop(t + 0.5);

  // Click transient
  const clickBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.008), ctx.sampleRate);
  const d = clickBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const clickSrc = ctx.createBufferSource();
  clickSrc.buffer = clickBuf;
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(gain * 0.5, t);
  cg.gain.exponentialRampToValueAtTime(0.001, t + 0.01);
  clickSrc.connect(cg);
  cg.connect(out);
  clickSrc.start(t);
}

function _synthHat(ctx: AudioContext, out: GainNode, gain: number) {
  const t = ctx.currentTime;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.12), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hpf = ctx.createBiquadFilter();
  hpf.type = "highpass";
  hpf.frequency.value = 8000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  src.connect(hpf);
  hpf.connect(g);
  g.connect(out);
  src.start(t);
}

function _synthMetalClang(ctx: AudioContext, out: GainNode, gain: number) {
  const t = ctx.currentTime;
  [220, 440, 880, 1760].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq * (1 + Math.random() * 0.03);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain / (i + 1), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2 / (i + 1));
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + 1.3);
  });
}

function _synthPing(ctx: AudioContext, out: GainNode, freq: number, gain: number) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
  osc.connect(g);
  g.connect(out);
  osc.start(t);
  osc.stop(t + 0.55);
}

function _synthCrackle(ctx: AudioContext, out: GainNode) {
  const t = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * (0.002 + Math.random() * 0.005));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = 0.08 + Math.random() * 0.08;
  src.connect(g);
  g.connect(out);
  src.start(t);
}

function _synthBell(ctx: AudioContext, out: GainNode, freq: number, gain: number) {
  const t = ctx.currentTime;
  [1, 2.76, 5.4].forEach((p, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq * p;
    const g = ctx.createGain();
    const decay = 3.0 / (i + 1);
    g.gain.setValueAtTime(gain / (i + 1), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  });
}

function _synthPixelNote(
  ctx: AudioContext,
  out: GainNode,
  freq: number,
  gain: number,
  durSec: number,
) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.setValueAtTime(gain, t + durSec * 0.7);
  g.gain.linearRampToValueAtTime(0, t + durSec);
  osc.connect(g);
  g.connect(out);
  osc.start(t);
  osc.stop(t + durSec + 0.01);
}

function _noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// ---------------------------------------------------------------------------
// Welcome cue internals (unchanged)
// ---------------------------------------------------------------------------

function _master(ctx: AudioContext, gain: number, output: AudioNode): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.connect(output);
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
function _percussiveStrike(
  ctx: AudioContext,
  freq: number,
  dur: number,
  output: AudioNode,
) {
  const master = _master(ctx, 0.6, output);
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
function _lowRumble(ctx: AudioContext, freq: number, dur: number, output: AudioNode) {
  const master = _master(ctx, 0.5, output);
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
function _arpeggio(ctx: AudioContext, freq: number, dur: number, output: AudioNode) {
  const master = _master(ctx, 0.45, output);
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
function _chordStab(ctx: AudioContext, freq: number, dur: number, output: AudioNode) {
  const master = _master(ctx, 0.4, output);
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
function _deepGong(ctx: AudioContext, freq: number, dur: number, output: AudioNode) {
  const master = _master(ctx, 0.5, output);
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
function _eightBitJingle(
  ctx: AudioContext,
  freq: number,
  dur: number,
  output: AudioNode,
) {
  const master = _master(ctx, 0.5, output);
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

function _distCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 256;
  const curve: Float32Array<ArrayBuffer> = new Float32Array(
    new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT),
  );
  const k = amount;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

// Suppress unused warning — _env is available for future use
void (_env as unknown);
