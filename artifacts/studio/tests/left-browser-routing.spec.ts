import { expect, test, type Page } from "@playwright/test";

async function openStudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("studio.onboardingShown", "1");
    localStorage.setItem("studio.browser.tab", "tracks");
  });
  await page.goto("/studio?disableAudio=1", { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor({ state: "visible", timeout: 15_000 });
}

test("sidebar kits and presets use the authoritative engine selector paths", async ({
  page,
}) => {
  await openStudio(page);
  await page.evaluate(async () => {
    const { audio } = await import("/src/lib/audio/engine.ts");
    const calls: Array<{ kind: "kit" | "preset"; trackId: string; id: string }> = [];
    const scope = window as typeof window & { __selectorCalls?: typeof calls };
    scope.__selectorCalls = calls;

    const setKit = audio.setKit.bind(audio);
    audio.setKit = ((trackId, kitId) => {
      calls.push({ kind: "kit", trackId, id: kitId });
      return setKit(trackId, kitId);
    }) as typeof audio.setKit;

    const setMelodicPreset = audio.setMelodicPreset.bind(audio);
    audio.setMelodicPreset = ((trackId, presetId) => {
      calls.push({ kind: "preset", trackId, id: presetId });
      return setMelodicPreset(trackId, presetId);
    }) as typeof audio.setMelodicPreset;
  });

  await page.getByRole("tab", { name: "Kits" }).click();
  await page.getByRole("button", { name: "Lo-Fi Smoke Kit" }).click();
  await page.getByRole("tab", { name: "Presets" }).click();
  await page.getByRole("button", { name: "Soft Keys" }).click();

  const state = await page.evaluate(async () => {
    const { getStore } = await import("/src/store.ts");
    const store = getStore().state;
    const drum = store.project.tracks.find((track) => track.kind === "drums");
    const piano = store.project.tracks.find((track) => track.kind === "piano");
    return {
      drumId: drum?.id,
      pianoId: piano?.id,
      kitId: drum?.kitId,
      presetId: piano?.presetId,
      selectedTrackId: store.selectedTrackId,
      status: store.statusMessage,
      calls: (
        window as typeof window & {
          __selectorCalls?: Array<{
            kind: "kit" | "preset";
            trackId: string;
            id: string;
          }>;
        }
      ).__selectorCalls,
    };
  });

  expect(state).toMatchObject({
    kitId: "lofi",
    presetId: "keys.soft",
    selectedTrackId: state.pianoId,
    status: "Preset: Soft Keys",
    calls: [
      { kind: "kit", trackId: state.drumId, id: "lofi" },
      { kind: "preset", trackId: state.pianoId, id: "keys.soft" },
    ],
  });
});

test("sidebar project load preserves current work and performs a full project reset", async ({
  page,
}) => {
  await openStudio(page);
  const marker = `Sidebar unsaved ${Date.now()}`;
  const targetName = `Sidebar target ${Date.now()}`;
  const ids = await page.evaluate(
    async ({ markerName, replacementName }) => {
      const { defaultProject, getStore } = await import("/src/store.ts");
      const { saveProject } = await import("/src/lib/storage/db.ts");
      const currentId = getStore().state.project.id;
      getStore().patchProject({ name: markerName });

      const target = defaultProject();
      target.name = replacementName;
      await saveProject(target);
      return { currentId, targetId: target.id };
    },
    { markerName: marker, replacementName: targetName },
  );

  await page.getByRole("tab", { name: "Projects" }).click();
  const target = page.getByRole("button", { name: targetName });
  await expect(target).toBeVisible();
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    target.click(),
  ]);
  await page.locator("header").waitFor({ state: "visible", timeout: 15_000 });

  const result = await page.evaluate(async (currentId) => {
    const { getStore } = await import("/src/store.ts");
    const { loadProject } = await import("/src/lib/storage/db.ts");
    const preserved = await loadProject(currentId);
    return {
      loadedId: getStore().state.project.id,
      loadedName: getStore().state.project.name,
      preservedName: preserved?.name ?? null,
    };
  }, ids.currentId);

  expect(result).toEqual({
    loadedId: ids.targetId,
    loadedName: targetName,
    preservedName: marker,
  });
});

test("channel-strip presets replace modern selectors instead of leaving the old sound active", async ({
  page,
}) => {
  await openStudio(page);
  const ids = await page.evaluate(async () => {
    const [{ audio }, { getStore }] = await Promise.all([
      import("/src/lib/audio/engine.ts"),
      import("/src/store.ts"),
    ]);
    const calls: Array<{
      trackId: string;
      preset: string;
      kitId: string | null;
      presetId: string | null;
    }> = [];
    const changePreset = audio.changePreset.bind(audio);
    audio.changePreset = ((track) => {
      calls.push({
        trackId: track.id,
        preset: track.preset,
        kitId: track.kitId ?? null,
        presetId: track.presetId ?? null,
      });
      return changePreset(track);
    }) as typeof audio.changePreset;
    (window as typeof window & { __legacyPresetCalls?: typeof calls }).__legacyPresetCalls = calls;
    const tracks = getStore().state.project.tracks;
    return {
      pianoId: tracks.find((track) => track.kind === "piano")?.id,
      drumId: tracks.find((track) => track.kind === "drums")?.id,
    };
  });
  if (!ids.pianoId || !ids.drumId) throw new Error("Default instrument tracks are missing.");

  await page.getByTestId(`legacy-preset-${ids.pianoId}`).click();
  await page.getByRole("option", { name: "Synth", exact: true }).click();
  await page.getByTestId(`legacy-preset-${ids.drumId}`).click();
  await page.getByRole("option", { name: "Trap", exact: true }).click();

  const result = await page.evaluate(async () => {
    const { getStore } = await import("/src/store.ts");
    const tracks = getStore().state.project.tracks;
    const piano = tracks.find((track) => track.kind === "piano");
    const drums = tracks.find((track) => track.kind === "drums");
    return {
      piano: { preset: piano?.preset, presetId: piano?.presetId ?? null },
      drums: { preset: drums?.preset, kitId: drums?.kitId ?? null },
      calls: (
        window as typeof window & {
          __legacyPresetCalls?: Array<{
            trackId: string;
            preset: string;
            kitId: string | null;
            presetId: string | null;
          }>;
        }
      ).__legacyPresetCalls,
    };
  });

  expect(result).toEqual({
    piano: { preset: "synth", presetId: null },
    drums: { preset: "trap", kitId: null },
    calls: [
      { trackId: ids.pianoId, preset: "synth", kitId: null, presetId: null },
      { trackId: ids.drumId, preset: "trap", kitId: null, presetId: null },
    ],
  });
});
