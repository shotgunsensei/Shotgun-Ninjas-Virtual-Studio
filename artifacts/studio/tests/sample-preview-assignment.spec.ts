import { expect, test, type Page } from "@playwright/test";

async function openRealAudioStudio(page: Page, query = ""): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("studio.onboardingShown", "1");
  });
  await page.goto(`/studio${query}`, { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor({ state: "visible", timeout: 20_000 });
  const enableAudio = page.getByRole("button", { name: /Tap to Enable Audio/i }).first();
  if (await enableAudio.isVisible().catch(() => false)) await enableAudio.click();
}

type HatPiece = "hat" | "ohat";

async function installLongHatSample(
  page: Page,
  assignedPiece: HatPiece,
): Promise<string> {
  return page.evaluate(async (piece) => {
    const [{ audio }, { getStore, makeId }] = await Promise.all([
      import("/src/lib/audio/engine.ts"),
      import("/src/store.ts"),
    ]);
    const sampleRate = 44_100;
    const seconds = 2;
    const frames = sampleRate * seconds;
    const bytes = new ArrayBuffer(44 + frames * 2);
    const view = new DataView(bytes);
    const ascii = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };
    ascii(0, "RIFF");
    view.setUint32(4, 36 + frames * 2, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, frames * 2, true);
    for (let frame = 0; frame < frames; frame += 1) {
      const envelope = Math.min(1, frame / 200) * Math.max(0, 1 - frame / frames);
      const sample = Math.sin((2 * Math.PI * 220 * frame) / sampleRate) * envelope;
      view.setInt16(44 + frame * 2, Math.round(sample * 24_000), true);
    }

    const store = getStore();
    const drums = store.state.project.tracks.find((track) => track.kind === "drums");
    if (!drums) throw new Error("Default project has no drum track.");
    const sampleId = makeId();
    const blobKey = `${store.state.project.id}:sample:${sampleId}`;
    const neutralHat = {
      volume: 1,
      pan: 0,
      pitch: 0,
      decay: 1,
      cutoff: 1,
      reverbSend: 0,
      delaySend: 0,
      muted: false,
      solo: false,
    };
    const isolatedDrums = {
      ...drums,
      kitId: "trap" as const,
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
      fx: { ...drums.fx, reverb: 0, delay: 0, filter: 1 },
      sends: {
        roomReverb: 0,
        neonHall: 0,
        tapeDelay: 0,
        darkSlapback: 0,
      },
      pieceSettings: {
        ...(drums.pieceSettings ?? {}),
        hat: neutralHat,
        ohat: neutralHat,
      },
      padSamples: { [piece]: blobKey },
    };
    store.patchProject({
      samples: [
        ...(store.state.project.samples ?? []),
        {
          id: sampleId,
          name: `Mixed choke ${piece}`,
          blobKey,
          durationSec: seconds,
          createdAt: Date.now(),
          blob: new Blob([bytes], { type: "audio/wav" }),
        },
      ],
      tracks: [isolatedDrums],
    });
    audio.removeAllTracksExcept([drums.id]);
    audio.ensureTrack(isolatedDrums, {
      mode: "lean",
      reason: `mixed-choke-${piece}`,
      allowHeavy: false,
    });
    audio.refreshAllMutes([isolatedDrums]);

    const deadline = performance.now() + 10_000;
    while (performance.now() < deadline) {
      const resource = window.__SN_AUDIO_ENGINE_STATUS__
        ?.padSamples()
        .find((entry) => entry.trackId === drums.id && entry.piece === piece);
      if (resource?.ready && resource.routing === "piece") return drums.id;
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    }
    throw new Error(`Assigned ${piece} sample did not become piece-routed and ready.`);
  }, assignedPiece);
}

async function queueTestSample(page: Page): Promise<{ drumId: string; drumName: string }> {
  return page.evaluate(async () => {
    const { getStore } = await import("/src/store.ts");
    const sampleRate = 44_100;
    const seconds = 2;
    const frames = sampleRate * seconds;
    const bytes = new ArrayBuffer(44 + frames * 2);
    const view = new DataView(bytes);
    const ascii = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };
    ascii(0, "RIFF");
    view.setUint32(4, 36 + frames * 2, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, frames * 2, true);
    for (let frame = 0; frame < frames; frame += 1) {
      const envelope = Math.min(1, frame / 200) * Math.max(0, 1 - frame / frames);
      const sample = Math.sin((2 * Math.PI * 110 * frame) / sampleRate) * envelope;
      view.setInt16(44 + frame * 2, Math.round(sample * 24_000), true);
    }
    const store = getStore();
    const drums = store.state.project.tracks.find((track) => track.kind === "drums");
    if (!drums) throw new Error("Default project has no drum track.");
    store.set({
      pendingSample: {
        blob: new Blob([bytes], { type: "audio/wav" }),
        defaultName: "Pad Preview Regression",
      },
    });
    return { drumId: drums.id, drumName: drums.name };
  });
}

async function triggerPadAndCaptureOutput(
  page: Page,
  drumId: string,
): Promise<{ peakDb: number; analyserPeak: number }> {
  return page.evaluate(async (trackId) => {
    const { audio } = await import("/src/lib/audio/engine.ts");
    const analyser = audio.getMasterAnalyser(256);
    let peakDb = -Infinity;
    let analyserPeak = 0;

    audio.triggerDrum(trackId, "kick", 0.9);
    const deadline = performance.now() + 650;
    while (performance.now() < deadline) {
      peakDb = Math.max(peakDb, ...audio.getMasterLevels().peakDb);
      const value = analyser.getValue();
      const channels = Array.isArray(value) ? value : [value];
      for (const channel of channels) {
        for (let index = 0; index < channel.length; index += 1) {
          analyserPeak = Math.max(analyserPeak, Math.abs(channel[index] ?? 0));
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 5));
    }
    return { peakDb, analyserPeak };
  }, drumId);
}

async function waitForMasterSilence(
  page: Page,
): Promise<{ peakDb: number; analyserPeak: number }> {
  return page.evaluate(async () => {
    const { audio } = await import("/src/lib/audio/engine.ts");
    const analyser = audio.getMasterAnalyser(256);
    const deadline = performance.now() + 2_500;
    let peakDb = Infinity;
    let analyserPeak = Infinity;
    let quietReads = 0;
    while (performance.now() < deadline) {
      peakDb = Math.max(...audio.getMasterLevels().peakDb);
      analyserPeak = 0;
      const value = analyser.getValue();
      const channels = Array.isArray(value) ? value : [value];
      for (const channel of channels) {
        for (let index = 0; index < channel.length; index += 1) {
          analyserPeak = Math.max(analyserPeak, Math.abs(channel[index] ?? 0));
        }
      }
      quietReads = peakDb < -65 && analyserPeak < 0.001 ? quietReads + 1 : 0;
      if (quietReads >= 3) break;
      await new Promise((resolve) => window.setTimeout(resolve, 25));
    }
    return { peakDb, analyserPeak };
  });
}

test("assigned drum-pad audio reaches the master and safely falls back to the kit", async ({
  page,
}) => {
  test.slow();
  await openRealAudioStudio(page);
  const drums = await queueTestSample(page);
  const dialog = page.getByRole("dialog", { name: "Import sample" });
  await expect(dialog).toBeVisible();

  const preview = dialog.getByTestId("sample-preview-toggle");
  await expect(preview).toBeEnabled();
  await preview.click();
  await expect(preview).toHaveText("Stop preview");
  await expect
    .poll(() =>
      dialog
        .getByTestId("sample-preview-audio")
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0);
  await preview.click();
  await expect(preview).toHaveText("Play preview");

  await dialog.getByRole("combobox").click();
  await page
    .getByRole("option", { name: `Assign to ${drums.drumName} pad: kick` })
    .click();
  await dialog.getByRole("button", { name: "Save sample" }).click();
  await expect(dialog).toBeHidden();

  const assignment = await page.evaluate(async (drumId) => {
    const { getStore } = await import("/src/store.ts");
    const track = getStore().state.project.tracks.find((item) => item.id === drumId);
    const blobKey = track?.padSamples?.kick ?? null;
    return {
      blobKey,
      sampleBlobKey:
        getStore().state.project.samples?.find((sample) => sample.blobKey === blobKey)
          ?.blobKey ?? null,
      status: getStore().state.statusMessage,
    };
  }, drums.drumId);
  expect(assignment).toMatchObject({
    sampleBlobKey: assignment.blobKey,
    status: `Saved sample “Pad Preview Regression” and assigned it to ${drums.drumName} kick`,
  });
  expect(assignment.blobKey).toBeTruthy();

  await expect
    .poll(() =>
      page.evaluate((drumId) => {
        return (
          window.__SN_AUDIO_ENGINE_STATUS__
            ?.padSamples()
            .find((entry) => entry.trackId === drumId && entry.piece === "kick") ?? null
        );
      }, drums.drumId),
    )
    .toMatchObject({
      trackId: drums.drumId,
      piece: "kick",
      blobKey: assignment.blobKey,
      ready: true,
      failed: false,
    });

  // The first playable hit realizes the owning track graph and moves the
  // assigned sample ahead of its EQ/FX/channel/meter. Prove that this is not
  // merely a ready-state flag: both the post-master meter and waveform tap
  // must observe real signal from the production trigger path.
  const customOutput = await triggerPadAndCaptureOutput(page, drums.drumId);
  expect(customOutput.peakDb).toBeGreaterThan(-55);
  expect(customOutput.analyserPeak).toBeGreaterThan(0.001);
  await expect
    .poll(() =>
      page.evaluate((drumId) => {
        return (
          window.__SN_AUDIO_ENGINE_STATUS__
            ?.padSamples()
            .find((entry) => entry.trackId === drumId && entry.piece === "kick")
            ?.routing ?? null
        );
      }, drums.drumId),
    )
    .toBe("piece");

  // Keep the persisted assignment but temporarily make its blob unavailable.
  // The custom resource must be removed without throwing, and the exact same
  // engine trigger must remain audible through the regular drum-kit fallback.
  const fallbackState = await page.evaluate(
    async ({ drumId, blobKey }) => {
      const [{ audio }, { getStore }] = await Promise.all([
        import("/src/lib/audio/engine.ts"),
        import("/src/store.ts"),
      ]);
      audio.panicStopAll();
      const store = getStore();
      store.patchProject({
        samples: (store.state.project.samples ?? []).map((sample) =>
          sample.blobKey === blobKey ? { ...sample, blob: undefined } : sample,
        ),
      });
      return {
        assignment:
          store.state.project.tracks.find((track) => track.id === drumId)
            ?.padSamples?.kick ?? null,
        resourcePresent:
          window.__SN_AUDIO_ENGINE_STATUS__
            ?.padSamples()
            .some(
              (entry) => entry.trackId === drumId && entry.piece === "kick",
            ) ?? false,
      };
    },
    { drumId: drums.drumId, blobKey: assignment.blobKey! },
  );
  expect(fallbackState).toEqual({
    assignment: assignment.blobKey,
    resourcePresent: false,
  });

  // Establish a silent baseline so residual custom-sample or FX tail cannot
  // satisfy the fallback assertions below.
  const silence = await waitForMasterSilence(page);
  expect(silence.peakDb).toBeLessThan(-65);
  expect(silence.analyserPeak).toBeLessThan(0.001);

  const fallbackOutput = await triggerPadAndCaptureOutput(page, drums.drumId);
  expect(fallbackOutput.peakDb).toBeGreaterThan(-55);
  expect(fallbackOutput.analyserPeak).toBeGreaterThan(0.001);

  await page.evaluate(async () => {
    const [{ audio }, { loadProject }, { getStore }] = await Promise.all([
      import("/src/lib/audio/engine.ts"),
      import("/src/lib/storage/db.ts"),
      import("/src/store.ts"),
    ]);
    const restored = await loadProject(getStore().state.project.id);
    if (!restored) throw new Error("Saved project did not reload.");
    audio.replaceProject(restored);
  });

  await expect
    .poll(() =>
      page.evaluate((drumId) => {
        return (
          window.__SN_AUDIO_ENGINE_STATUS__
            ?.padSamples()
            .find((entry) => entry.trackId === drumId && entry.piece === "kick") ?? null
        );
      }, drums.drumId),
    )
    .toMatchObject({
      trackId: drums.drumId,
      piece: "kick",
      blobKey: assignment.blobKey,
      ready: true,
      failed: false,
  });
});

test("modeled closed hat chokes a playing assigned open hat", async ({ page }) => {
  await openRealAudioStudio(page, "?snAudioNodeTrace=1");
  const drumId = await installLongHatSample(page, "ohat");
  const result = await page.evaluate(async (trackId) => {
    const { audio } = await import("/src/lib/audio/engine.ts");
    const analyser = audio.getMasterAnalyser(256);
    const capturePeak = async (durationMs: number) => {
      const deadline = performance.now() + durationMs;
      let peak = 0;
      while (performance.now() < deadline) {
        const value = analyser.getValue();
        const channels = Array.isArray(value) ? value : [value];
        for (const channel of channels) {
          for (let index = 0; index < channel.length; index += 1) {
            peak = Math.max(peak, Math.abs(channel[index] ?? 0));
          }
        }
        await new Promise((resolve) => window.setTimeout(resolve, 5));
      }
      return peak;
    };
    audio.triggerDrum(trackId, "ohat", 0.9);
    await new Promise((resolve) => window.setTimeout(resolve, 40));
    const assignedOpenPeak = await capturePeak(80);

    audio.triggerDrum(trackId, "hat", 0.9);
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    const afterModeledClosedPeak = await capturePeak(80);
    audio.panicStopAll();
    return { assignedOpenPeak, afterModeledClosedPeak };
  }, drumId);

  expect(result.assignedOpenPeak).toBeGreaterThan(0.01);
  expect(result.afterModeledClosedPeak).toBeLessThan(0.001);
});

test("assigned closed hat chokes a playing modeled open hat", async ({ page }) => {
  await openRealAudioStudio(page, "?snAudioNodeTrace=1");
  const drumId = await installLongHatSample(page, "hat");
  const result = await page.evaluate(async (trackId) => {
    const { audio } = await import("/src/lib/audio/engine.ts");
    const trace = window.__SN_AUDIO_NODE_TRACE__;
    if (!trace) throw new Error("Audio-node trace is unavailable.");
    trace.clear();

    audio.triggerDrum(trackId, "ohat", 0.9);
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    const beforeAssignedClosed = trace.snapshot();

    audio.triggerDrum(trackId, "hat", 0.9);
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    const afterAssignedClosed = trace.snapshot();
    audio.panicStopAll();
    return {
      activeModeledBeforeChoke: beforeAssignedClosed.leanOneShotSourcesActive,
      activeModeledAfterChoke: afterAssignedClosed.leanOneShotSourcesActive,
      modeledSourcesDisconnected: afterAssignedClosed.leanOneShotSourcesDisconnected,
    };
  }, drumId);

  expect(result.activeModeledBeforeChoke).toBeGreaterThan(0);
  expect(result.activeModeledAfterChoke).toBe(0);
  expect(result.modeledSourcesDisconnected).toBeGreaterThan(0);
});

test("recorded-take review updates the exact timeline clip and keeps a library copy", async ({
  page,
}) => {
  test.slow();
  await openRealAudioStudio(page);
  await queueTestSample(page);
  const recorded = await page.evaluate(async () => {
    const { getStore, makeId } = await import("/src/store.ts");
    const store = getStore();
    const pending = store.state.pendingSample;
    const vocals = store.state.project.tracks.find((track) => track.kind === "vocals");
    if (!pending || !vocals) throw new Error("Recorded-take fixture could not be created.");
    const clipId = makeId();
    store.addAudioClip(vocals.id, {
      id: clipId,
      start: 4,
      durationSec: 2,
      blob: pending.blob,
    });
    store.set({
      pendingSample: {
        ...pending,
        defaultName: "Recorded Take Review",
        recordedTrackId: vocals.id,
        recordedClipId: clipId,
      },
    });
    return { trackId: vocals.id, clipId };
  });

  const dialog = page.getByRole("dialog", { name: "Review recorded take" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save take & sample" })).toBeEnabled();
  await dialog.getByRole("switch", { name: "Reverse" }).click();
  await dialog.getByRole("button", { name: "Save take & sample" }).click();
  await expect(dialog).toBeHidden();

  const result = await page.evaluate(async ({ trackId, clipId }) => {
    const { getStore } = await import("/src/store.ts");
    const store = getStore();
    const track = store.state.project.tracks.find((item) => item.id === trackId);
    const clip = track?.audioClips.find((item) => item.id === clipId);
    const sample = store.state.project.samples?.find(
      (item) => item.name === "Recorded Take Review",
    );
    return {
      clipStillPresent: Boolean(clip),
      clipAndLibraryShareEditedBlob: Boolean(clip?.blob && clip.blob === sample?.blob),
      clipStart: clip?.start,
      samplePresent: Boolean(sample),
      status: store.state.statusMessage,
    };
  }, recorded);
  expect(result).toMatchObject({
    clipStillPresent: true,
    clipAndLibraryShareEditedBlob: true,
    clipStart: 4,
    samplePresent: true,
  });
  expect(result.status).toContain("updated the recorded take");
});

test("invalid audio cannot be saved or assigned", async ({ page }) => {
  await openRealAudioStudio(page);
  await page.evaluate(async () => {
    const { getStore } = await import("/src/store.ts");
    getStore().set({
      pendingSample: {
        blob: new Blob(["not an audio stream"], { type: "audio/wav" }),
        defaultName: "Invalid Audio",
      },
    });
  });

  const dialog = page.getByRole("dialog", { name: "Import sample" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save sample" })).toBeDisabled();
  await expect(dialog.getByRole("combobox")).toBeDisabled();
  await expect(dialog.locator(".text-destructive")).toBeVisible({ timeout: 15_000 });
  const projectState = await page.evaluate(async () => {
    const { getStore } = await import("/src/store.ts");
    return {
      saved: getStore().state.project.samples?.some((sample) => sample.name === "Invalid Audio"),
      status: getStore().state.statusMessage,
    };
  });
  expect(projectState.saved).toBeFalsy();
  expect(projectState.status ?? "").not.toContain("Saved sample");
});

test("pad resource construction failure stays non-throwing and falls back to the kit", async ({
  page,
}) => {
  await openRealAudioStudio(page);
  await queueTestSample(page);
  const result = await page.evaluate(async () => {
    const { getStore, makeId } = await import("/src/store.ts");
    const store = getStore();
    const pending = store.state.pendingSample;
    const drums = store.state.project.tracks.find((track) => track.kind === "drums");
    if (!pending || !drums) throw new Error("Pad fallback fixture could not be created.");
    store.set({ pendingSample: null });
    const sampleId = makeId();
    const blobKey = `${store.state.project.id}:sample:${sampleId}`;
    const originalCreateObjectURL = URL.createObjectURL;
    let threw = false;
    try {
      URL.createObjectURL = () => {
        throw new DOMException("object URLs unavailable", "NotSupportedError");
      };
      store.patchProject({
        samples: [
          ...(store.state.project.samples ?? []),
          {
            id: sampleId,
            name: "Fallback Pad",
            blobKey,
            durationSec: 2,
            createdAt: Date.now(),
            blob: pending.blob,
          },
        ],
        tracks: store.state.project.tracks.map((track) =>
          track.id === drums.id
            ? { ...track, padSamples: { ...(track.padSamples ?? {}), kick: blobKey } }
            : track,
        ),
      });
    } catch {
      threw = true;
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
    }
    return {
      threw,
      assignmentPersisted:
        store.state.project.tracks.find((track) => track.id === drums.id)?.padSamples?.kick ===
        blobKey,
      realizedResource: window.__SN_AUDIO_ENGINE_STATUS__
        ?.padSamples()
        .some((entry) => entry.trackId === drums.id && entry.piece === "kick"),
    };
  });
  expect(result).toEqual({
    threw: false,
    assignmentPersisted: true,
    realizedResource: false,
  });
});

test("an in-flight sample save cannot mutate a replacement project", async ({ page }) => {
  test.slow();
  await openRealAudioStudio(page);
  await queueTestSample(page);
  const dialog = page.getByRole("dialog", { name: "Import sample" });
  const save = dialog.getByRole("button", { name: "Save sample" });
  await expect(save).toBeEnabled();

  await page.evaluate(() => {
    let releaseSave: (() => void) | null = null;
    let markHit: (() => void) | null = null;
    let claimed = false;
    const hit = new Promise<void>((resolve) => { markHit = resolve; });
    const blocked = new Promise<void>((resolve) => { releaseSave = resolve; });
    const globals = window as unknown as Record<string, any>;
    globals.__SN_TEST_PERSISTENCE_GATE__ = async (
      operation: string,
      project: { samples?: Array<{ name: string }> },
    ) => {
      if (
        operation !== "save-project" ||
        claimed ||
        !project.samples?.some((sample) => sample.name === "Pad Preview Regression")
      ) return;
      claimed = true;
      markHit?.();
      await blocked;
    };
    (window as unknown as Record<string, unknown>).__SN_TEST_SAMPLE_SAVE_GATE__ = {
      waitForHit: () => hit,
      release: () => {
        delete globals.__SN_TEST_PERSISTENCE_GATE__;
        releaseSave?.();
      },
    };
  });

  await save.click();
  await page.evaluate(async () => {
    const gate = (window as unknown as Record<string, any>).__SN_TEST_SAMPLE_SAVE_GATE__;
    await gate.waitForHit();
  });
  const replacementId = await page.evaluate(async () => {
    const { defaultProject, getStore, resetStore } = await import("/src/store.ts");
    const replacement = defaultProject();
    resetStore(replacement);
    const gate = (window as unknown as Record<string, any>).__SN_TEST_SAMPLE_SAVE_GATE__;
    gate.release();
    return getStore().state.project.id;
  });

  await expect(dialog).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(async (projectId) => {
        const { getStore } = await import("/src/store.ts");
        const store = getStore();
        return {
          projectId: store.state.project.id,
          leakedSample: store.state.project.samples?.some(
            (sample) => sample.name === "Pad Preview Regression",
          ) ?? false,
          status: store.state.statusMessage,
        };
      }, replacementId),
    )
    .toMatchObject({ projectId: replacementId, leakedSample: false });
});
