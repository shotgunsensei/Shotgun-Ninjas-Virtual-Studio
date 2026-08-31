import { expect, test, type Page } from "@playwright/test";

async function openStudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("studio.onboardingShown", "1");
    localStorage.setItem("studio.browser.tab", "library");
  });
  await page.goto("/studio?disableAudio=1", { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor({ state: "visible", timeout: 15_000 });
}

test("authoritative drum selectors release Chop Lab ownership for that track only", async ({
  page,
}) => {
  await openStudio(page);

  const result = await page.evaluate(async () => {
    const [{ audio }, { getStore }] = await Promise.all([
      import("/src/lib/audio/engine.ts"),
      import("/src/store.ts"),
    ]);
    const store = getStore();
    const drums = store.state.project.tracks.find((track) => track.kind === "drums");
    const melodic = store.state.project.tracks.find((track) => track.kind === "piano");
    if (!drums || !melodic) throw new Error("Default instrument tracks are missing.");

    const ownershipCalls: Array<string | null> = [];
    (window as typeof window & { __chopOwnershipCalls?: Array<string | null> })
      .__chopOwnershipCalls = ownershipCalls;
    const setChopKitForTrack = audio.setChopKitForTrack.bind(audio);
    audio.setChopKitForTrack = ((trackId) => {
      ownershipCalls.push(trackId);
      return setChopKitForTrack(trackId);
    }) as typeof audio.setChopKitForTrack;

    audio.setChopKitForTrack(drums.id);
    store.applyMelodicPreset(melodic.id, "keys.soft");
    const afterMelodic = ownershipCalls.slice();

    // A selector aimed at some other drum track must not steal this track's
    // intentional Chop routing.
    audio.setKit("unrelated-drum-track", "lofi");
    const afterUnrelatedDrum = ownershipCalls.slice();

    store.applyDrumKit(drums.id, "lofi");
    audio.setChopKitForTrack(drums.id);
    store.applyLegacyPreset(drums.id, "trap");

    return {
      drumId: drums.id,
      afterMelodic,
      afterUnrelatedDrum,
      ownershipCalls,
    };
  });

  expect(result.afterMelodic).toEqual([result.drumId]);
  expect(result.afterUnrelatedDrum).toEqual([result.drumId]);
  expect(result.ownershipCalls).toEqual([
    result.drumId,
    null,
    result.drumId,
    null,
  ]);

  // Sound-pack loading uses the same authoritative kit path. Exercise the UI
  // callsite so a future bypass cannot silently reintroduce split ownership.
  await page.evaluate(async (drumId) => {
    const { audio } = await import("/src/lib/audio/engine.ts");
    audio.setChopKitForTrack(drumId);
  }, result.drumId);
  await page.getByTestId("load-sound-pack-vcsl-neon-keys").click();

  const finalCalls = await page.evaluate(
    () =>
      (window as typeof window & { __chopOwnershipCalls?: Array<string | null> })
        .__chopOwnershipCalls,
  );
  expect(finalCalls).toEqual([
    result.drumId,
    null,
    result.drumId,
    null,
    result.drumId,
    null,
  ]);
});

test("Performance Mode follows in-place persisted project replacement", async ({ page }) => {
  await openStudio(page);

  await page.evaluate(async () => {
    const { getStore } = await import("/src/store.ts");
    const project = getStore().state.project;
    getStore().patchProject({
      performance: {
        open: true,
        inputSource: "keyboard",
        scaleLock: true,
        scaleRoot: 2,
        scaleId: "minor",
        chordMode: true,
        chordType: "minor_triad",
        basslineMode: false,
        basslinePatternId: "quarters",
        gamepadMappings: [],
      },
    });
    void project;
  });
  await expect(page.getByText("Performance Mode", { exact: true })).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { performanceRouter } = await import("/src/lib/performance/router.ts");
        const config = performanceRouter.getConfig();
        return {
          active: config.active,
          inputSource: config.inputSource,
          scaleRoot: config.scaleRoot,
          scaleId: config.scaleId,
          chordType: config.chordType,
        };
      }),
    )
    .toEqual({
      active: true,
      inputSource: "keyboard",
      scaleRoot: 2,
      scaleId: "minor",
      chordType: "minor_triad",
    });

  await page.evaluate(async () => {
    const { getStore, resetStore } = await import("/src/store.ts");
    const current = getStore().state.project;
    resetStore({
      ...current,
      tracks: current.tracks.map((track) => ({ ...track })),
      performance: {
        open: true,
        inputSource: "gamepad",
        scaleLock: true,
        scaleRoot: 9,
        scaleId: "dorian",
        chordMode: true,
        chordType: "dominant_seventh",
        basslineMode: true,
        basslinePatternId: "eighths",
        gamepadMappings: [{ buttonIndex: 0, note: 42, label: "Test Hat" }],
      },
    });
  });

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { performanceRouter } = await import("/src/lib/performance/router.ts");
        const config = performanceRouter.getConfig();
        return {
          active: config.active,
          inputSource: config.inputSource,
          scaleRoot: config.scaleRoot,
          scaleId: config.scaleId,
          chordType: config.chordType,
          gamepadNote: config.gamepadMappings[0]?.note,
        };
      }),
    )
    .toEqual({
      active: true,
      inputSource: "gamepad",
      scaleRoot: 9,
      scaleId: "dorian",
      chordType: "dominant_seventh",
      gamepadNote: 42,
    });

  await page.evaluate(async () => {
    const { getStore, resetStore } = await import("/src/store.ts");
    const current = getStore().state.project;
    resetStore({
      ...current,
      tracks: current.tracks.map((track) => ({ ...track })),
      performance: { ...current.performance!, open: false },
    });
  });

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { performanceRouter } = await import("/src/lib/performance/router.ts");
        return performanceRouter.getConfig().active;
      }),
    )
    .toBe(false);
});

test("same-id replacement clears Chop state while ordinary panel remount preserves it", async ({
  page,
}) => {
  await openStudio(page);
  const projectId = await page.evaluate(async () => {
    const { getStore, resetStore } = await import("/src/store.ts");
    const store = getStore();
    const current = store.state.project;

    const sampleRate = 44_100;
    const frames = 4_410;
    const bytes = new ArrayBuffer(44 + frames * 2);
    const view = new DataView(bytes);
    const write = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };
    write(0, "RIFF");
    view.setUint32(4, 36 + frames * 2, true);
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
    view.setUint32(40, frames * 2, true);
    for (let frame = 0; frame < frames; frame += 1) {
      const sample = Math.sin((frame / sampleRate) * Math.PI * 2 * 220) * 0.2;
      view.setInt16(44 + frame * 2, sample * 0x7fff, true);
    }
    const sampleBlob = new Blob([bytes], { type: "audio/wav" });

    resetStore({
      ...current,
      tracks: current.tracks.map((track) => ({ ...track })),
      chopLab: {
        markers: [],
        sliceSettings: [{
          reverse: false,
          pitch: 0,
          normalize: false,
          fadeIn: 0,
          fadeOut: 0,
          chokeGroup: "none",
        }],
        sensitivity: 0.5,
        sampleName: "owned-chop.wav",
        sampleBlobKey: `${current.id}:choplab:sample`,
        sampleBlob,
      },
    });
    const drums = getStore().state.project.tracks.find((track) => track.kind === "drums");
    if (!drums) throw new Error("Default drum track is missing.");
    getStore().set({ selectedTrackId: drums.id });
    getStore().patchChopLab({ showChopLab: true });
    return current.id;
  });

  await expect(page.getByText("owned-chop.wav", { exact: true }).first()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { getChopEngine } = await import("/src/lib/audio/chopEngine.ts");
        return getChopEngine().sliceCount;
      }),
    )
    .toBe(1);

  await page.evaluate(async () => {
    const [{ getChopEngine }, { getStore }] = await Promise.all([
      import("/src/lib/audio/chopEngine.ts"),
      import("/src/store.ts"),
    ]);
    const engine = getChopEngine();
    const scope = window as typeof window & { __chopDisposeCalls?: number };
    scope.__chopDisposeCalls = 0;
    const dispose = engine.dispose.bind(engine);
    engine.dispose = (() => {
      scope.__chopDisposeCalls = (scope.__chopDisposeCalls ?? 0) + 1;
      return dispose();
    }) as typeof engine.dispose;
    getStore().patchChopLab({ showChopLab: false });
  });
  await page.waitForTimeout(50);
  await page.evaluate(async () => {
    const { getStore } = await import("/src/store.ts");
    getStore().patchChopLab({ showChopLab: true });
  });
  await expect(page.getByText("owned-chop.wav", { exact: true }).first()).toBeVisible();

  const remount = await page.evaluate(async () => {
    const { getChopEngine } = await import("/src/lib/audio/chopEngine.ts");
    return {
      disposeCalls: (window as typeof window & { __chopDisposeCalls?: number })
        .__chopDisposeCalls ?? 0,
      slices: getChopEngine().sliceCount,
    };
  });
  expect(remount).toEqual({ disposeCalls: 0, slices: 1 });

  const after = await page.evaluate(async () => {
    const { getStore, resetStore } = await import("/src/store.ts");
    const current = getStore().state.project;
    resetStore({
      ...current,
      id: current.id,
      tracks: current.tracks.map((track) => ({ ...track })),
      chopLab: undefined,
    });
    const drums = getStore().state.project.tracks.find((track) => track.kind === "drums");
    if (!drums) throw new Error("Default drum track is missing.");
    getStore().set({ selectedTrackId: drums.id });
    getStore().patchChopLab({ showChopLab: true });
    return {
      sameId: getStore().state.project.id === current.id,
      revision: getStore().state.projectLoadRevision,
    };
  });
  expect(after).toEqual({ sameId: true, revision: 2 });
  expect(projectId).toBeTruthy();
  await expect(page.getByText("No sample loaded", { exact: true }).first()).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { getChopEngine } = await import("/src/lib/audio/chopEngine.ts");
        return getChopEngine().sliceCount;
      }),
    )
    .toBe(0);
});
