import { expect, test } from "@playwright/test";

test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("studio.onboardingShown", "1"),
  );
  await page.goto("/studio?disableAudio=1");
  await page.locator("header").waitFor({ state: "visible" });
});

// Every render uses an OfflineAudioContext. Nothing connects to a device.
test("custom sample endings and short gates stay continuous at multiple pitches", async ({
  page,
}, testInfo) => {
  const results = await page.evaluate(async () => {
    const { SampleInstrumentVoice } =
      await import("/src/lib/audio/sampleInstrumentVoice.ts");
    const { sampleRecording } =
      await import("/tests/helpers/sample-recording.ts");
    const results = [];
    for (const rate of [44100, 48000]) {
      for (const note of ["A2", "A3", "A4"]) {
        for (const attack of [0.04, 0.4]) {
          const context = new OfflineAudioContext(1, rate, rate);
          const voice = new SampleInstrumentVoice(
            57,
            sampleRecording(rate, 0.2),
            context,
          );
          await voice.ready;
          voice.connect(context.destination);
          voice.attack = attack;
          voice.release = 0.08;
          voice.triggerAttackRelease(note, 0.8, 0, 0.8);
          const before = performance.now();
          const buffer = await context.startRendering();
          const renderMs = performance.now() - before;
          const data = buffer.getChannelData(0);
          let maxStep = 0,
            nonfinite = 0,
            energy = 0;
          for (let i = 1; i < data.length; i++) {
            maxStep = Math.max(maxStep, Math.abs(data[i] - data[i - 1]));
            nonfinite += Number(!Number.isFinite(data[i]));
            energy += data[i] ** 2;
          }
          const active = voice.snapshot().activeSources;
          voice.dispose();
          results.push({
            rate,
            note,
            attack,
            attackLevel: data[Math.round(rate * 0.02)],
            expectedAttackLevel:
              ((12000 / 32768) * 0.8 * Math.pow(10, -8 / 20) * 0.02) / attack,
            maxStep,
            nonfinite,
            energy,
            active,
            renderMs,
          });
        }
      }
    }
    return results;
  });
  await testInfo.attach("sample-end-metrics", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });
  for (const result of results) {
    expect(result.nonfinite).toBe(0);
    expect(result.energy).toBeGreaterThan(0.1);
    expect(result.maxStep, `${result.rate}/${result.note}`).toBeLessThan(0.002);
    expect(result.active).toBe(0);
    expect(
      result.attackLevel,
      `${result.rate}/${result.note}/attack=${result.attack}`,
    ).toBeCloseTo(result.expectedAttackLevel, 5);
  }
});

test("early note-off releases a scheduled gate without canceling a later same-pitch note", async ({
  page,
}, testInfo) => {
  const result = await page.evaluate(async () => {
    const { SampleInstrumentVoice } =
      await import("/src/lib/audio/sampleInstrumentVoice.ts");
    const context = new OfflineAudioContext(1, 44100, 44100);
    const { sampleRecording } =
      await import("/tests/helpers/sample-recording.ts");
    const voice = new SampleInstrumentVoice(
      57,
      sampleRecording(44100, 1),
      context,
    );
    await voice.ready;
    voice.connect(context.destination);
    voice.attack = 0.1;
    voice.release = 0.02;
    voice.triggerAttackRelease("A3", 0.7, 0, 0.8);
    voice.triggerAttackRelease("A3", 0.2, 0.4, 0.8);
    voice.triggerRelease("A3", 0.025);
    // A later duplicate release must not raise or lengthen an existing tail.
    voice.triggerRelease("A3", 0.03);
    const data = (await context.startRendering()).getChannelData(0);
    const peak = (start: number, end: number) =>
      Math.max(
        ...data
          .slice(Math.floor(start * 44100), Math.floor(end * 44100))
          .map(Math.abs),
      );
    const result = {
      earlyTail: peak(0.06, 0.3),
      futureNote: peak(0.5, 0.58),
      active: voice.snapshot().activeSources,
    };
    voice.dispose();
    return result;
  });
  await testInfo.attach("early-release-metrics", {
    body: JSON.stringify(result),
    contentType: "application/json",
  });
  expect(result.earlyTail).toBeLessThan(0.000001);
  expect(result.futureNote).toBeGreaterThan(0.01);
  expect(result.active).toBe(0);
});

test("zero gates, exact attack endpoints and releases inside the natural fade remain continuous", async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const [{ SampleInstrumentVoice }, { sampleRecording }] = await Promise.all([
      import("/src/lib/audio/sampleInstrumentVoice.ts"),
      import("/tests/helpers/sample-recording.ts"),
    ]);
    const results = [];
    for (const gate of [0, 0.001, 0.04, 0.197]) {
      const context = new OfflineAudioContext(1, 44100, 44100);
      const voice = new SampleInstrumentVoice(
        57,
        sampleRecording(44100, 0.2),
        context,
      );
      await voice.ready;
      voice.connect(context.destination);
      voice.attack = 0.04;
      voice.release = 0.08;
      voice.triggerAttackRelease("A3", gate, 0, 0.8);
      const data = (await context.startRendering()).getChannelData(0);
      let maxStep = 0,
        peak = 0;
      for (let i = 1; i < data.length; i++) {
        maxStep = Math.max(maxStep, Math.abs(data[i] - data[i - 1]));
        peak = Math.max(peak, Math.abs(data[i]));
      }
      voice.dispose();
      results.push({ gate, maxStep, peak });
    }
    return results;
  });
  for (const result of results)
    expect(result.maxStep, `gate=${result.gate}`).toBeLessThan(0.002);
  expect(results[0].peak).toBe(0);
  expect(results[1].peak).toBeGreaterThan(0);
});

test("dense retriggering keeps the native voice budget and releases every source", async ({
  page,
}, testInfo) => {
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(async () => {
    await Promise.all([
      import("/src/lib/audio/sampleInstrumentVoice.ts"),
      import("/tests/helpers/sample-recording.ts"),
    ]);
  });
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  const before = await cdp.send("Performance.getMetrics");
  const result = await page.evaluate(async () => {
    const [{ SampleInstrumentVoice }, { sampleRecording }] = await Promise.all([
      import("/src/lib/audio/sampleInstrumentVoice.ts"),
      import("/tests/helpers/sample-recording.ts"),
    ]);
    const context = new OfflineAudioContext(1, 44100, 44100);
    const voice = new SampleInstrumentVoice(
      57,
      sampleRecording(44100, 0.2),
      context,
    );
    await voice.ready;
    voice.connect(context.destination);
    const before = performance.now();
    for (let i = 0; i < 4096; i++)
      voice.triggerAttackRelease("A3", 0.1, 0, 0.2);
    const scheduleMs = performance.now() - before;
    const bounded = voice.snapshot().activeSources;
    await context.startRendering();
    const afterRender = voice.snapshot().activeSources;
    voice.releaseAll();
    voice.releaseAll();
    voice.dispose();
    voice.dispose();
    const { studioAudioContext } =
      await import("/src/lib/audio/toneContext.ts");
    return {
      notes: 4096,
      scheduleMs,
      bounded,
      afterRender,
      afterDispose: voice.snapshot().activeSources,
      headlessContext: studioAudioContext
        ? {
            state: studioAudioContext.state,
            sampleRate: studioAudioContext.sampleRate,
            reportedBaseLatency: studioAudioContext.baseLatency,
            reportedOutputLatency: studioAudioContext.outputLatency,
          }
        : null,
    };
  });
  await cdp.send("HeapProfiler.collectGarbage");
  const after = await cdp.send("Performance.getMetrics");
  const metric = (metrics: typeof before.metrics, name: string) =>
    metrics.find((item) => item.name === name)?.value ?? 0;
  const measurement = {
    ...result,
    rendererTaskSeconds:
      metric(after.metrics, "TaskDuration") -
      metric(before.metrics, "TaskDuration"),
    retainedJsHeapBytes:
      metric(after.metrics, "JSHeapUsedSize") -
      metric(before.metrics, "JSHeapUsedSize"),
  };
  await testInfo.attach("dense-voice-metrics", {
    body: JSON.stringify(measurement, null, 2),
    contentType: "application/json",
  });
  expect(result.bounded).toBe(32);
  expect(result.afterRender).toBe(0);
  expect(result.afterDispose).toBe(0);
});

test("custom WAV export smooths the recording's natural endpoint", async ({
  page,
}, testInfo) => {
  const result = await page.evaluate(async () => {
    const [{ renderProject }, { getStore }, { sampleRecording }] =
      await Promise.all([
        import("/src/lib/audio/export.ts"),
        import("/src/store.ts"),
        import("/tests/helpers/sample-recording.ts"),
      ]);
    const project = structuredClone(getStore().state.project);
    const track = project.tracks.find((track) => track.kind === "piano")!;
    track.sampleInstrument = { rootNote: 57, blobKey: "envelope-fixture" };
    track.sound = {
      ...track.sound,
      attack: 0.1,
      release: 0.04,
      cutoff: 1,
      reverbSend: 0,
      delaySend: 0,
      chorusSend: 0,
      drive: 0,
    };
    track.fx = { reverb: 0, delay: 0, filter: 1 };
    track.fxRack = {};
    track.sends = { roomReverb: 0, neonHall: 0, tapeDelay: 0, darkSlapback: 0 };
    track.eq = { low: 0, mid: 0, high: 0, hpfOn: false, hpfHz: 20 };
    track.muted = false;
    track.solo = false;
    track.volume = 0.5;
    track.pan = 0;
    track.audioClips = [];
    track.noteClips = [
      {
        id: "sample-edge",
        start: 0,
        length: 2,
        notes: [{ note: "A3", time: 0, duration: 1, velocity: 0.8 }],
      },
    ];
    project.tracks = [track];
    project.bpm = 120;
    project.masterBus = {
      ...project.masterBus!,
      glueEnabled: false,
      softClip: false,
    };
    const blob = sampleRecording(44100, 0.2, 233);
    project.samples = [
      {
        id: "envelope",
        blobKey: "envelope-fixture",
        name: "Envelope fixture",
        durationSec: 0.2,
        createdAt: 0,
        blob,
      },
    ];
    const exported = await renderProject(project, "wav", undefined, {
      customStartBeat: 0,
      customEndBeat: 2,
    });
    const context = new OfflineAudioContext(1, 44100, 44100);
    const bounced = await context.decodeAudioData(
      await exported.blob.arrayBuffer(),
    );
    const wav = bounced.getChannelData(0);
    // Inspect the whole bounce so existing compressor delay cannot move a
    // hard sample ending outside the assertion. The carrier survives the HPF.
    let peak = 0,
      maxStep = 0,
      tail = 0;
    for (let i = 1; i < wav.length; i++) {
      peak = Math.max(peak, Math.abs(wav[i]));
      maxStep = Math.max(maxStep, Math.abs(wav[i] - wav[i - 1]));
      if (i > 44100) tail = Math.max(tail, Math.abs(wav[i]));
    }
    return { route: exported.route, peak, maxStep, tail };
  });
  await testInfo.attach("wav-envelope-metrics", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  expect(result.route).toBe("native-wav");
  expect(result.peak).toBeGreaterThan(0.005);
  expect(result.maxStep).toBeLessThan(0.003);
  expect(result.tail).toBeLessThan(0.0001);
});
