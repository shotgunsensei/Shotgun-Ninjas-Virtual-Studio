import { expect, test } from "@playwright/test";

test.describe("offline export audio ownership", () => {
  test("renders sampled MP3 natively without disturbing the live Tone context", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      localStorage.setItem("studio.onboardingShown", "1");
    });
    await page.goto("/studio?offlineContextTest=1", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("header", { timeout: 20_000 });

    const result = await page.evaluate(async () => {
      const [{ getStore }, { renderProject }, Tone] = await Promise.all([
        import("/src/store.ts"),
        import("/src/lib/audio/export.ts"),
        import("/node_modules/.vite/deps/tone.js"),
      ]);
      const project = structuredClone(getStore().state.project);
      const piano = project.tracks.find((track) => track.kind === "piano");
      if (!piano) throw new Error("Default project has no piano track");
      piano.presetId = "brass.vcsl-tenor-sax-stabs";
      piano.muted = false;
      piano.solo = false;
      piano.audioClips = [];
      project.tracks = [piano];

      const liveContext = Tone.getContext();
      let phase = "decoding";
      let renderObservations = 0;
      let wrongContextObservations = 0;
      let probeContextWasLive = true;
      let probeCreated = false;
      const timer = window.setInterval(() => {
        if (phase !== "rendering") return;
        renderObservations += 1;
        if (Tone.getContext() !== liveContext) wrongContextObservations += 1;
        if (!probeCreated) {
          probeCreated = true;
          const probe = new Tone.Gain(0);
          probeContextWasLive = probe.context === liveContext;
          probe.dispose();
        }
      }, 0);

      try {
        const exported = await renderProject(
          project,
          "mp3",
          (progress) => {
            phase = progress.phase;
          },
          { customStartBeat: 0, customEndBeat: 2 },
        );
        return {
          size: exported.blob.size,
          type: exported.blob.type,
          route: exported.route,
          renderObservations,
          wrongContextObservations,
          probeContextWasLive,
          contextRestored: Tone.getContext() === liveContext,
        };
      } finally {
        window.clearInterval(timer);
      }
    });

    expect(result.route).toBe("native-offline");
    expect(result.type).toContain("audio/mpeg");
    expect(result.size).toBeGreaterThan(1_000);
    expect(result.renderObservations).toBeGreaterThan(0);
    expect(result.wrongContextObservations).toBe(0);
    expect(result.probeContextWasLive).toBe(true);
    expect(result.contextRestored).toBe(true);
  });

  test("uses assigned drum-pad audio in both WAV and MP3 exports", async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      localStorage.setItem("studio.onboardingShown", "1");
    });
    await page.goto("/studio?assignedPadExportTest=1", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector("header", { timeout: 20_000 });

    const result = await page.evaluate(async () => {
      const [{ getStore }, { renderProject }] = await Promise.all([
        import("/src/store.ts"),
        import("/src/lib/audio/export.ts"),
      ]);

      const makeToneBlob = (): Blob => {
        const sampleRate = 44_100;
        const frames = sampleRate;
        const dataBytes = frames * 2;
        const bytes = new ArrayBuffer(44 + dataBytes);
        const view = new DataView(bytes);
        const write = (offset: number, value: string) => {
          for (let i = 0; i < value.length; i += 1) {
            view.setUint8(offset + i, value.charCodeAt(i));
          }
        };
        write(0, "RIFF");
        view.setUint32(4, 36 + dataBytes, true);
        write(8, "WAVE");
        write(12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        write(36, "data");
        view.setUint32(40, dataBytes, true);
        for (let frame = 0; frame < frames; frame += 1) {
          const envelope = Math.min(1, frame / 220) * Math.min(1, (frames - frame) / 220);
          const sample = Math.sin((frame / sampleRate) * Math.PI * 2 * 880) * 0.55 * envelope;
          view.setInt16(44 + frame * 2, Math.round(sample * 0x7fff), true);
        }
        return new Blob([bytes], { type: "audio/wav" });
      };

      const project = structuredClone(getStore().state.project);
      const drums = project.tracks.find((track) => track.kind === "drums");
      if (!drums) throw new Error("Default project has no drum track");
      const blobKey = "assigned-pad-export-test";
      drums.muted = false;
      drums.solo = false;
      drums.volume = 1;
      drums.pan = 0;
      drums.fx = { reverb: 0, delay: 0, filter: 1 };
      drums.noteClips = [{
        id: "assigned-pad-clip",
        start: 0,
        length: 2,
        notes: [{ time: 0, note: "kick", duration: 0.25, velocity: 1 }],
      }];
      drums.audioClips = [];
      drums.padSamples = { kick: blobKey };
      drums.pieceSettings = {
        ...(drums.pieceSettings ?? {}),
        kick: { volume: 1, pan: 0, pitch: 0, muted: false, solo: false },
      };
      project.masterVolume = 0.8;
      project.bpm = 120;
      project.bars = 1;
      project.tracks = [drums];
      project.samples = [{
        id: "assigned-pad-export-sample",
        name: "Assigned pad export probe",
        blobKey,
        durationSec: 1,
        createdAt: Date.now(),
        blob: makeToneBlob(),
      }];

      const [wav, mp3] = await Promise.all([
        renderProject(project, "wav", undefined, {
          customStartBeat: 0,
          customEndBeat: 2,
        }),
        // The concurrency guard intentionally serializes exports. Start MP3
        // only after WAV completes so this regression exercises both routes.
        Promise.resolve(null),
      ]);
      const mp3Result = await renderProject(project, "mp3", undefined, {
        customStartBeat: 0,
        customEndBeat: 2,
      });

      const audioContext = new AudioContext();
      const tailRms = async (blob: Blob): Promise<number> => {
        const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
        const channel = decoded.getChannelData(0);
        const start = Math.floor(decoded.sampleRate * 0.55);
        const end = Math.min(channel.length, Math.floor(decoded.sampleRate * 0.85));
        let sumSquares = 0;
        for (let i = start; i < end; i += 1) sumSquares += channel[i] * channel[i];
        return Math.sqrt(sumSquares / Math.max(1, end - start));
      };
      try {
        return {
          wavRoute: wav.route,
          mp3Route: mp3Result.route,
          wavType: wav.blob.type,
          mp3Type: mp3Result.blob.type,
          wavRms: await tailRms(wav.blob),
          mp3Rms: await tailRms(mp3Result.blob),
          wavWarnings: wav.warnings ?? [],
          mp3Warnings: mp3Result.warnings ?? [],
        };
      } finally {
        await audioContext.close();
      }
    });

    expect(result.wavRoute).toBe("native-wav");
    expect(result.mp3Route).toBe("native-offline");
    expect(result.wavType).toContain("audio/wav");
    expect(result.mp3Type).toContain("audio/mpeg");
    expect(result.wavRms).toBeGreaterThan(0.1);
    expect(result.mp3Rms).toBeGreaterThan(0.08);
    expect(result.wavWarnings.join(" ")).not.toContain("Assigned drum samples unavailable");
    expect(result.mp3Warnings.join(" ")).not.toContain("Assigned drum samples unavailable");
  });

  test("keeps repeated long assigned-pad one-shots overlapping live and in native exports", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      localStorage.setItem("studio.onboardingShown", "1");
    });
    await page.goto("/studio?snExportTrace=1&repeatedAssignedPadTest=1", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector("header", { timeout: 20_000 });
    const enableAudio = page
      .getByRole("button", { name: /Tap to Enable Audio/i })
      .first();
    if (await enableAudio.isVisible().catch(() => false)) await enableAudio.click();

    const result = await page.evaluate(async () => {
      const [{ audio }, { getStore }, { renderProject }] = await Promise.all([
        import("/src/lib/audio/engine.ts"),
        import("/src/store.ts"),
        import("/src/lib/audio/export.ts"),
      ]);

      const makeLongToneBlob = (): Blob => {
        const sampleRate = 44_100;
        const frames = sampleRate * 2;
        const dataBytes = frames * 2;
        const bytes = new ArrayBuffer(44 + dataBytes);
        const view = new DataView(bytes);
        const write = (offset: number, value: string) => {
          for (let index = 0; index < value.length; index += 1) {
            view.setUint8(offset + index, value.charCodeAt(index));
          }
        };
        write(0, "RIFF");
        view.setUint32(4, 36 + dataBytes, true);
        write(8, "WAVE");
        write(12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        write(36, "data");
        view.setUint32(40, dataBytes, true);
        for (let frame = 0; frame < frames; frame += 1) {
          const fadeIn = Math.min(1, frame / 220);
          const fadeOut = Math.min(1, (frames - frame) / 220);
          const sample =
            Math.sin((frame / sampleRate) * Math.PI * 2 * 333) *
            0.3 *
            fadeIn *
            fadeOut;
          view.setInt16(44 + frame * 2, Math.round(sample * 0x7fff), true);
        }
        return new Blob([bytes], { type: "audio/wav" });
      };

      const project = structuredClone(getStore().state.project);
      const drums = project.tracks.find((track) => track.kind === "drums");
      if (!drums) throw new Error("Default project has no drum track");
      const blobKey = "repeated-long-assigned-pad";
      drums.muted = false;
      drums.solo = false;
      drums.volume = 1;
      drums.pan = 0;
      drums.fx = { reverb: 0, delay: 0, filter: 1 };
      drums.noteClips = [{
        id: "repeated-assigned-pad-clip",
        start: 0,
        length: 2,
        notes: [
          { time: 0, note: "kick", duration: 0.25, velocity: 0.8 },
          { time: 0.5, note: "kick", duration: 0.25, velocity: 0.8 },
        ],
      }];
      drums.audioClips = [];
      drums.padSamples = { kick: blobKey };
      drums.pieceSettings = {
        ...(drums.pieceSettings ?? {}),
        kick: {
          volume: 1,
          pan: 0,
          pitch: 0,
          decay: 1,
          cutoff: 1,
          reverbSend: 0,
          delaySend: 0,
          muted: false,
          solo: false,
        },
      };
      project.masterVolume = 0.8;
      project.bpm = 120;
      project.bars = 1;
      project.tracks = [drums];
      project.samples = [{
        id: "repeated-long-assigned-pad-sample",
        name: "Repeated long assigned pad",
        blobKey,
        durationSec: 2,
        createdAt: Date.now(),
        blob: makeLongToneBlob(),
      }];

      audio.replaceProject(project);
      let pad = audio
        .getDrumPadSampleSnapshot()
        .find((entry) => entry.trackId === drums.id && entry.piece === "kick");
      for (let attempt = 0; attempt < 160 && !pad?.ready; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 25));
        pad = audio
          .getDrumPadSampleSnapshot()
          .find((entry) => entry.trackId === drums.id && entry.piece === "kick");
      }
      if (!pad?.ready || pad.failed) throw new Error("Assigned kick did not decode");

      audio.triggerDrum(drums.id, "kick", 0.8);
      await new Promise((resolve) => window.setTimeout(resolve, 40));
      const afterFirst = audio
        .getDrumPadSampleSnapshot()
        .find((entry) => entry.trackId === drums.id && entry.piece === "kick");
      audio.triggerDrum(drums.id, "kick", 0.8);
      await new Promise((resolve) => window.setTimeout(resolve, 40));
      const afterSecond = audio
        .getDrumPadSampleSnapshot()
        .find((entry) => entry.trackId === drums.id && entry.piece === "kick");
      audio.panicStopAll();

      const trace = window.__SN_EXPORT_TRACE__;
      if (!trace?.enabled) throw new Error("Export trace is unavailable");
      trace.clear();
      const wav = await renderProject(project, "wav", undefined, {
        customStartBeat: 0,
        customEndBeat: 2,
      });
      const wavAssignedEvents = trace
        .snapshot()
        .events.filter((event) => event.type === "native-assigned-pad");
      const wavAssignedSources = wavAssignedEvents.length;
      trace.clear();
      const mp3 = await renderProject(project, "mp3", undefined, {
        customStartBeat: 0,
        customEndBeat: 2,
      });
      const mp3AssignedEvents = trace
        .snapshot()
        .events.filter((event) => event.type === "native-assigned-pad");
      const mp3AssignedSources = mp3AssignedEvents.length;

      const context = new AudioContext();
      const rangeRms = async (
        blob: Blob,
        startSec: number,
        endSec: number,
      ): Promise<number> => {
        const decoded = await context.decodeAudioData(await blob.arrayBuffer());
        const channel = decoded.getChannelData(0);
        const start = Math.floor(decoded.sampleRate * startSec);
        const end = Math.min(channel.length, Math.floor(decoded.sampleRate * endSec));
        let sumSquares = 0;
        for (let index = start; index < end; index += 1) {
          sumSquares += channel[index] * channel[index];
        }
        return Math.sqrt(sumSquares / Math.max(1, end - start));
      };
      try {
        return {
          routing: afterSecond?.routing ?? null,
          activeAfterFirst: afterFirst?.activeSources ?? -1,
          activeAfterSecond: afterSecond?.activeSources ?? -1,
          wavAssignedSources,
          mp3AssignedSources,
          wavAssignedDurations: wavAssignedEvents.map((event) => event.detail?.durationSec),
          mp3AssignedDurations: mp3AssignedEvents.map((event) => event.detail?.durationSec),
          wavRms: await rangeRms(wav.blob, 0.05, 0.2),
          mp3Rms: await rangeRms(mp3.blob, 0.05, 0.2),
          wavTailRms: await rangeRms(wav.blob, 0.75, 1.25),
          mp3TailRms: await rangeRms(mp3.blob, 0.75, 1.25),
          wavWarnings: wav.warnings ?? [],
          mp3Warnings: mp3.warnings ?? [],
        };
      } finally {
        await context.close();
      }
    });

    expect(result.routing).toBe("piece");
    expect(result.activeAfterFirst).toBe(1);
    expect(result.activeAfterSecond).toBe(2);
    expect(result.wavAssignedSources).toBe(2);
    expect(result.mp3AssignedSources).toBe(2);
    expect(result.wavAssignedDurations).toEqual([2, 2]);
    expect(result.mp3AssignedDurations).toEqual([2, 2]);
    expect(result.wavRms).toBeGreaterThan(0.01);
    expect(result.mp3Rms).toBeGreaterThan(0.008);
    expect(result.wavTailRms).toBeGreaterThan(0.01);
    expect(result.mp3TailRms).toBeGreaterThan(0.008);
    expect(result.wavWarnings.join(" ")).not.toContain("Assigned drum samples");
    expect(result.mp3Warnings.join(" ")).not.toContain("Assigned drum samples");
  });
});
