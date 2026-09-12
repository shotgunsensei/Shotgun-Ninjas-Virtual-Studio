import { expect, test } from "@playwright/test";

function sineWav(): Buffer {
  const rate = 22050;
  const frames = rate * 2;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(36 + frames * 2, 4);
  bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) {
    bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * frame / rate) * 16000), 44 + frame * 2);
  }
  return bytes;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("studio.onboardingShown", "1"));
  await page.goto("/studio", { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor();
});

test("uploads a named instrument, maps octaves, persists its source and switches back to a preset", async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.getByRole("button", { name: /Tap to Enable Audio/i }).first().click();
  const panel = page.getByTestId("sample-instrument-panel");
  await panel.getByLabel("Upload instrument sample").setInputFiles({ name: "single-A4.wav", mimeType: "audio/wav", buffer: sineWav() });
  const dialog = page.getByRole("dialog", { name: "Import sample" });
  await expect(dialog.getByRole("button", { name: "Create instrument", exact: true })).toBeEnabled();
  await dialog.getByLabel("Sample name").fill("My glass keys");
  await dialog.getByLabel("Source note", { exact: true }).selectOption("69");
  await dialog.getByRole("button", { name: "Create instrument", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(panel.getByLabel("Source note", { exact: true })).toHaveValue("69");
  const saved = await page.evaluate(async () => {
    const { getStore } = await import("/src/store.ts");
    const { loadProject } = await import("/src/lib/storage/db.ts");
    const store = getStore();
    const track = store.state.project.tracks.find((item) => item.id === store.state.selectedTrackId)!;
    const loaded = await loadProject(store.state.project.id);
    return {
      id: track.id, name: track.name, config: track.sampleInstrument,
      saved: loaded?.tracks.find((item) => item.id === track.id)?.sampleInstrument,
      blobBytes: loaded?.samples?.find((item) => item.blobKey === track.sampleInstrument?.blobKey)?.blob?.size,
    };
  });
  expect(saved.name).toBe("My glass keys");
  expect(saved.saved).toEqual(saved.config);
  expect(saved.blobBytes).toBe(sineWav().length);
  await expect(panel.getByTestId("sample-instrument-status")).toContainText("Ready across the keyboard");
  await page.evaluate(async () => {
    const { audio } = await import("/src/lib/audio/engine.ts");
    const target = window as typeof window & { __sampleSelectorNotes: number };
    target.__sampleSelectorNotes = 0;
    const startNote = audio.startNote.bind(audio);
    audio.startNote = (...args: Parameters<typeof startNote>) => {
      target.__sampleSelectorNotes++;
      return startNote(...args);
    };
  });
  await panel.getByLabel("Source note", { exact: true }).press("a");
  await panel.getByLabel("Instrument sample", { exact: true }).press("a");
  expect(await page.evaluate(() => (window as typeof window & { __sampleSelectorNotes: number }).__sampleSelectorNotes)).toBe(0);
  await panel.getByLabel("Source note", { exact: true }).selectOption("69");
  await page.getByRole("button", { name: "C4", exact: true }).click();
  const rates = await page.evaluate(async (id) => {
    const { audio } = await import("/src/lib/audio/engine.ts");
    audio.startNote(id, "A3", 0.7); audio.startNote(id, "A4", 0.7); audio.startNote(id, "A5", 0.7);
    const snapshot = audio.getSampleInstrumentSnapshot().find((item) => item.trackId === id)!;
    const rates = snapshot.playbackRates;
    audio.endNote(id, "A3"); audio.endNote(id, "A4"); audio.endNote(id, "A5");
    return rates;
  }, saved.id);
  expect(rates).toEqual(expect.arrayContaining([0.5, 1, 2]));
  await page.screenshot({ path: testInfo.outputPath("custom-instrument.png") });
  await panel.getByLabel("Source note", { exact: true }).selectOption("60");
  await expect(panel.getByLabel("Source note", { exact: true })).toHaveValue("60");
  await page.getByTestId("preset-row-keys.electric").getByRole("button", { name: "Load", exact: true }).click();
  await expect(panel.getByLabel("Source note", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(async (id) => {
    const { getStore } = await import("/src/store.ts");
    return getStore().state.project.tracks.find((item) => item.id === id)?.sampleInstrument;
  }, saved.id)).toBeUndefined();
  expect(errors).toEqual([]);
});

test("rejects a corrupt upload and cancellation leaves the project intact", async ({ page }) => {
  const before = await page.evaluate(async () => {
    const { getStore } = await import("/src/store.ts");
    return JSON.stringify(getStore().state.project);
  });
  await page.getByLabel("Upload instrument sample").first().setInputFiles({ name: "broken.wav", mimeType: "audio/wav", buffer: Buffer.from("invalid audio") });
  const dialog = page.getByRole("dialog", { name: "Import sample" });
  await expect(dialog.getByRole("button", { name: "Create instrument", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(async () => {
    const { getStore } = await import("/src/store.ts");
    return JSON.stringify(getStore().state.project);
  })).toBe(before);
});

test("custom sample controls remain available on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Create instrument from sample", exact: true }).first()).toBeVisible();
});
