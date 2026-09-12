import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("studio.onboardingShown", "1"));
  await page.goto("/studio", { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor();
});

test("every modeled preset renders finite audio, its release, and distinct timbres", async ({ page }) => {
  test.setTimeout(90_000);
  const result = await page.evaluate(async () => {
    const [{ MELODIC_PRESETS }, { scheduleModeledNote }] = await Promise.all([
      import("/src/lib/audio/sounds/presets.ts"), import("/src/lib/audio/soundQuality.ts"),
    ]);
    const rendered = [];
    for (const preset of MELODIC_PRESETS) {
      const ctx = new OfflineAudioContext(1, 44_100 * 4, 44_100);
      scheduleModeledNote(ctx, ctx.destination, preset.synth, 220, 0.02, 0.4, 0.85, preset.id);
      const buffer = await ctx.startRendering();
      const data = buffer.getChannelData(0);
      let peak = 0, power = 0, crossings = 0, tail = 0;
      for (let i = 0; i < data.length; i++) {
        if (!Number.isFinite(data[i])) throw new Error(`${preset.id}: non-finite audio`);
        peak = Math.max(peak, Math.abs(data[i]));
        if (i < 17_640) {
          power += data[i] ** 2;
          if (i > 0 && data[i] * data[i - 1] < 0) crossings++;
        }
        if (i > data.length - 441) tail = Math.max(tail, Math.abs(data[i]));
      }
      rendered.push({ id: preset.id, peak, rms: Math.sqrt(power / 17_640), crossings, tail });
    }
    return rendered;
  });
  for (const voice of result) {
    expect(voice.peak, voice.id).toBeGreaterThan(0.003);
    expect(voice.peak, voice.id).toBeLessThan(1);
    expect(voice.tail, voice.id).toBeLessThan(0.00001);
  }
  const sub = result.find((voice) => voice.id === "bass.sub")!;
  const bell = result.find((voice) => voice.id === "bell.fm") ?? result.find((voice) => voice.id.includes("bell."))!;
  expect(bell.crossings).toBeGreaterThan(sub.crossings * 1.3);
});

test("live plucks respond to velocity, dampening and release without a worklet", async ({ page }) => {
  const results = await page.evaluate(async () => {
    const { renderPluck } = await import("/tests/helpers/render-pluck.ts");
    const output = [];
    for (const [velocity, dampening] of [[0.3, 1800], [0.95, 1800], [0.95, 7000]]) {
      output.push(await renderPluck(velocity, dampening));
    }
    return output;
  });
  expect(results[0].energy).toBeGreaterThan(0);
  expect(results[1].energy).toBeGreaterThan(results[0].energy * 3);
  expect(results[1].brightness).toBeGreaterThan(results[0].brightness * 1.15);
  expect(results[2].brightness).toBeGreaterThan(results[1].brightness * 1.15);
  expect(results.every((item) => item.tail < 0.0001)).toBe(true);
});

test("WAV export keeps preset timbre and the grand piano's actual concert pitch", async ({ page }) => {
  test.setTimeout(60_000);
  const results = await page.evaluate(async () => {
    const [{ getStore }, { renderProject }, { findPreset, presetSoundParams }] = await Promise.all([
      import("/src/store.ts"), import("/src/lib/audio/export.ts"), import("/src/lib/audio/sounds/presets.ts"),
    ]);
    const output = [];
    for (const id of ["bass.sub", "bell.crystal", "keys.grand-piano"]) {
      const project = structuredClone(getStore().state.project);
      const piano = project.tracks.find((track) => track.kind === "piano")!;
      piano.presetId = id; piano.muted = false; piano.solo = false; piano.audioClips = [];
      piano.fxRack = {};
      piano.sends = { roomReverb: 0, neonHall: 0, tapeDelay: 0, darkSlapback: 0 };
      piano.sound = { ...presetSoundParams(findPreset(id)!), attack: 0, cutoff: 1, drive: 0,
        reverbSend: 0, delaySend: 0, chorusSend: 0, width: 0.5 };
      piano.noteClips = [{ id: "quality-note", start: 0, length: 4,
        notes: [{ time: 0, note: "C4", duration: 2, velocity: 0.8 }] }];
      project.tracks = [piano]; project.bpm = 120;
      const exported = await renderProject(project, "wav", undefined, { customStartBeat: 0, customEndBeat: 4 });
      const context = new OfflineAudioContext(1, 1, 44_100);
      const buffer = await context.decodeAudioData(await exported.blob.arrayBuffer());
      const data = buffer.getChannelData(0);
      const segment = data.slice(Math.floor(buffer.sampleRate * 0.15), Math.floor(buffer.sampleRate * 0.35));
      let energy = 0, crossings = 0;
      for (let i = 1; i < segment.length; i++) {
        energy += segment[i] ** 2;
        if (segment[i] * segment[i - 1] < 0) crossings++;
      }
      const pitchPower = (hz: number) => {
        let peak = 0;
        for (let cents = -35; cents <= 35; cents += 2) {
          let re = 0, im = 0;
          const omega = 2 * Math.PI * hz * 2 ** (cents / 1200) / buffer.sampleRate;
          for (let i = 0; i < segment.length; i++) {
            const sample = segment[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (segment.length - 1)));
            re += sample * Math.cos(omega * i); im += sample * Math.sin(omega * i);
          }
          peak = Math.max(peak, re * re + im * im);
        }
        return peak;
      };
      output.push({ id, energy, crossings, route: exported.route,
        correctPitch: pitchPower(261.626), octaveLow: pitchPower(130.813) });
    }
    return output;
  });
  for (const result of results) {
    expect(result.route).toBe("native-wav");
    expect(result.energy, result.id).toBeGreaterThan(0.01);
  }
  expect(results[1].crossings).toBeGreaterThan(results[0].crossings * 1.2);
  expect(results[2].correctPitch).toBeGreaterThan(results[2].octaveLow * 100);
});

test("shared spaces are stereo, causal and decaying; delays preserve authored timing", async ({ page }) => {
  const results = await page.evaluate(async () => {
    const { createSendEffect, spaceImpulse, SPACE_RECIPES } = await import("/src/lib/audio/spatialEffects.ts");
    const output = [];
    for (const id of ["roomReverb", "neonHall", "tapeDelay", "darkSlapback"] as const) {
      const ctx = new OfflineAudioContext(2, 44_100 * 4, 44_100);
      const effect = createSendEffect(ctx, id, 120);
      const impulse = ctx.createBuffer(1, 1, 44_100);
      impulse.getChannelData(0)[0] = 1;
      const source = ctx.createBufferSource(); source.buffer = impulse;
      source.connect(effect.input); effect.output.connect(ctx.destination); source.start(0);
      const cacheReused = id === "roomReverb" || id === "neonHall"
        ? spaceImpulse(ctx, id) === spaceImpulse(ctx, id) : true;
      const buffer = await ctx.startRendering();
      const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
      let first = -1, energy = 0, stereoDifference = 0, tail = 0;
      for (let i = 0; i < left.length; i++) {
        if (!Number.isFinite(left[i])) throw new Error(`${id}: non-finite tail`);
        if (first < 0 && Math.abs(left[i]) > 1e-6) first = i / 44_100;
        energy += left[i] ** 2;
        stereoDifference += (left[i] - right[i]) ** 2;
        if (i > left.length - 441) tail = Math.max(tail, Math.abs(left[i]));
      }
      effect.dispose(); effect.dispose();
      output.push({ id, first, energy, stereoDifference, tail, cacheReused,
        preDelay: id === "roomReverb" || id === "neonHall" ? SPACE_RECIPES[id].preDelay : 0 });
    }
    return output;
  });
  for (const result of results) {
    expect(result.energy, result.id).toBeGreaterThan(0.0001);
    expect(result.cacheReused).toBe(true);
    expect(result.tail, result.id).toBeLessThan(0.0001);
    if (result.preDelay) {
      expect(result.first).toBeGreaterThanOrEqual(result.preDelay - 0.001);
      expect(result.stereoDifference).toBeGreaterThan(0.001);
    } else expect(result.first).toBeCloseTo(result.id === "tapeDelay" ? 0.375 : 0.11, 2);
  }
});
