import { expect, test, type Page } from "@playwright/test";

async function openStudio(page: Page, disableAudio = true): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("studio.onboardingShown", "1");
    localStorage.setItem("studio.settings.v1", JSON.stringify({ uiMode: "expert", tutorEnabled: false }));
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
        sampleInstrument: track.sampleInstrument ?? null,
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

test("pack sketch undo restores custom audio and respects a later custom instrument selection", async ({ page }) => {
  await openStudio(page);
  const trackId = await page.evaluate(async () => {
    const { getStore } = await import("/src/store.ts");
    const store = getStore();
    const track = store.state.project.tracks.find((candidate) => candidate.kind === "piano")!;
    const blobKey = `${store.state.project.id}:sample:custom-sketch`;
    store.patchProject({
      tracks: store.state.project.tracks.filter((candidate) => candidate.kind === "drums" || candidate.id === track.id),
      samples: [{ id: "custom-sketch", name: "Custom sketch source", blobKey, durationSec: 1, createdAt: 0, blob: new Blob(["source"], { type: "audio/wav" }) }],
    });
    store.applySampleInstrument(track.id, blobKey, 57);
    return track.id;
  });
  const before = await editableProjectSnapshot(page);
  await page.getByRole("tab", { name: "Library" }).click();
  await page.getByTestId("start-pack-sketch-vcsl-neon-keys").click();
  const generated = await editableProjectSnapshot(page);
  const generatedTrack = generated.tracks.find((track) => track.id === trackId)!;
  expect(generatedTrack.sampleInstrument).toBeNull();
  expect(generatedTrack.presetId).toBe("keys.vcsl-tx81z-piano");
  await page.getByRole("button", { name: /Undo sketch/i }).click();
  expect(await editableProjectSnapshot(page)).toEqual(before);

  await page.getByTestId("start-pack-sketch-vcsl-neon-keys").click();
  const newSelection = await page.evaluate(async (id) => {
    const { getStore } = await import("/src/store.ts");
    const store = getStore();
    store.applySampleInstrument(id, store.state.project.samples![0].blobKey, 72);
    const track = store.state.project.tracks.find((candidate) => candidate.id === id)!;
    return { sampleInstrument: track.sampleInstrument, sound: track.sound, presetId: track.presetId ?? null };
  }, trackId);
  await page.getByRole("button", { name: /Undo sketch/i }).click();
  const after = (await editableProjectSnapshot(page)).tracks.find((track) => track.id === trackId)!;
  expect({ sampleInstrument: after.sampleInstrument, sound: after.sound, presetId: after.presetId }).toEqual(newSelection);
  expect(after.noteClips).toEqual(before.tracks.find((track) => track.id === trackId)!.noteClips);
});
