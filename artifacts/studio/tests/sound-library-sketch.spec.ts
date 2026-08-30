import { expect, test, type Page } from "@playwright/test";

async function openStudio(page: Page, disableAudio = true): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("studio.onboardingShown", "1");
    localStorage.setItem("studio.browser.tab", "tracks");
  });
  await page.goto(`/studio${disableAudio ? "?disableAudio=1" : ""}`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("header").waitFor({ state: "visible", timeout: 15_000 });
}

async function editableProjectSnapshot(page: Page) {
  return page.evaluate(async () => {
    const { getStore } = await import("/src/store.ts");
    const { project, lastPackSketch } = getStore().state;
    return {
      id: project.id,
      bars: project.bars,
      loopEnabled: project.loopEnabled,
      loopEndBeat: project.loopEndBeat,
      soundPackId: project.soundPackId ?? null,
      tracks: project.tracks.map((track) => ({
        id: track.id,
        kitId: track.kitId ?? null,
        presetId: track.presetId ?? null,
        sound: track.sound ?? null,
        noteClips: track.noteClips.map((clip) => ({
          id: clip.id,
          start: clip.start,
          length: clip.length,
          noteCount: clip.notes.length,
        })),
      })),
      undoPackName: lastPackSketch?.packName ?? null,
    };
  });
}

test("pack sketch undo survives tab changes and restores the prior project sound", async ({
  page,
}) => {
  await openStudio(page);
  const before = await editableProjectSnapshot(page);

  await page.getByRole("tab", { name: "Library" }).click();
  await page.getByTestId("start-pack-sketch-vcsl-neon-keys").click();
  const generated = await editableProjectSnapshot(page);
  expect(generated.undoPackName).toBe("VCSL Neon Keys");
  expect(generated.soundPackId).toBe("vcsl-neon-keys");
  expect(generated.loopEndBeat).toBeGreaterThan(before.loopEndBeat);
  expect(generated.tracks.flatMap((track) => track.noteClips).length).toBeGreaterThan(
    before.tracks.flatMap((track) => track.noteClips).length,
  );

  await page.getByRole("tab", { name: "Tracks" }).click();
  await page.getByRole("tab", { name: "Library" }).click();
  await expect(page.getByRole("button", { name: /Undo sketch/i })).toBeVisible();
  await page.getByRole("button", { name: /Undo sketch/i }).click();

  const restored = await editableProjectSnapshot(page);
  expect(restored).toEqual(before);
});

test("an editable sketch reconciles an existing audio voice before Play and Panic", async ({
  page,
}) => {
  test.slow();
  await openStudio(page, false);
  await page.getByRole("button", { name: /Tap to Enable Audio/i }).click();

  const drumTrackId = await page.evaluate(async () => {
    const { audio } = await import("/src/lib/audio/engine.ts");
    const { getStore } = await import("/src/store.ts");
    const drum = getStore().state.project.tracks.find((track) => track.kind === "drums");
    if (!drum) throw new Error("Default project has no drum track");
    audio.ensureTrack(drum, {
      mode: "tone",
      reason: "pack-sketch-regression",
      allowHeavy: true,
    });
    return drum.id;
  });

  await page.getByRole("tab", { name: "Library" }).click();
  await page.getByTestId("start-pack-sketch-demon-truck").click();
  await page.getByTestId("start-pack-sketch-lofi-smoke-room").click();

  await expect.poll(async () =>
    page.evaluate((trackId) => {
      const voice = window.__SN_AUDIO_ENGINE_STATUS__
        ?.soundSelectors()
        .find((entry) => entry.trackId === trackId);
      return voice?.kitId ?? null;
    }, drumTrackId),
  ).toBe("lofi");

  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.waitForTimeout(350);
  await page.getByRole("button", { name: /Panic/i }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();

  const finalState = await page.evaluate(async (trackId) => {
    const { getStore } = await import("/src/store.ts");
    const voice = window.__SN_AUDIO_ENGINE_STATUS__
      ?.soundSelectors()
      .find((entry) => entry.trackId === trackId);
    return {
      isPlaying: getStore().state.isPlaying,
      kitId: voice?.kitId ?? null,
      hasKit: voice?.hasKit ?? false,
    };
  }, drumTrackId);
  expect(finalState).toEqual({ isPlaying: false, kitId: "lofi", hasKit: true });
});
