import { expect, test, type Page } from "@playwright/test";

// A newly installed service worker intentionally reloads on controllerchange.
// This regression exercises IndexedDB and audio ownership, so keep that
// unrelated PWA lifecycle from replacing the document during fixture setup.
test.use({ serviceWorkers: "block" });

function wavBuffer({
  seconds = 0.25,
  frequency = 180,
  sampleRate = 44_100,
} = {}): Buffer {
  const frames = Math.floor(seconds * sampleRate);
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + frames * 2, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const envelope = Math.max(0, 1 - frame / frames);
    const sample =
      Math.sin((2 * Math.PI * frequency * frame) / sampleRate) * envelope * 0.5;
    buffer.writeInt16LE(Math.round(sample * 0x7fff), 44 + frame * 2);
  }
  return buffer;
}

async function seedMissingPadSample(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("studio.onboardingShown", "1");
  });
  await page.goto("/studio?disableAudio=1", { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor({ state: "visible", timeout: 20_000 });

  return page.evaluate(async () => {
    const [{ getStore }, { saveProject }] = await Promise.all([
      import("/src/store.ts"),
      import("/src/lib/storage/db.ts"),
    ]);
    const current = getStore().state.project;
    const drums = current.tracks.find((track) => track.kind === "drums");
    if (!drums) throw new Error("Default project has no drum track.");

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const projectId = `missing-relink-${suffix}`;
    const targetBlobKey = `${projectId}:sample:target`;
    const decoyBlobKey = `${projectId}:sample:decoy`;
    const duplicateSampleId = `duplicate-sample-${suffix}`;
    const decoyBytes = new TextEncoder().encode("hydrated decoy owner");
    const fixture = {
      ...current,
      id: projectId,
      name: "Missing sample relink regression",
      tracks: current.tracks.map((track) =>
        track.id === drums.id
          ? {
              ...track,
              padSamples: { ...(track.padSamples ?? {}), kick: targetBlobKey },
            }
          : { ...track },
      ),
      samples: [
        {
          id: duplicateSampleId,
          name: "Missing exact owner",
          blobKey: targetBlobKey,
          durationSec: 9,
          createdAt: 1,
        },
        {
          id: duplicateSampleId,
          name: "Hydrated duplicate-id decoy",
          blobKey: decoyBlobKey,
          durationSec: 7,
          createdAt: 2,
          blob: new Blob([decoyBytes], { type: "application/octet-stream" }),
        },
      ],
      updatedAt: Date.now(),
    };
    await saveProject(fixture);
    return {
      projectId,
      drumId: drums.id,
      duplicateSampleId,
      targetBlobKey,
      decoyBlobKey,
      decoySize: decoyBytes.byteLength,
    };
  });
}

test("Missing Samples relink validates, persists, hydrates the exact owner, and reconciles the pad engine", async ({
  page,
}) => {
  test.slow();
  const fixture = await seedMissingPadSample(page);
  const replacement = wavBuffer();

  // Navigate without disableAudio so Store.patchProject's sample path must
  // reconcile a real DrumPadSampleManager resource.
  await page.goto("/studio", { waitUntil: "domcontentloaded" });
  const dialog = page.getByRole("dialog", { name: "Missing samples" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Missing exact owner", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Hydrated duplicate-id decoy", { exact: true })).toHaveCount(0);
  const fileInput = dialog.locator('input[type="file"]');
  await expect(fileInput).toHaveCount(1);

  // A MIME label alone is not enough: invalid bytes must fail decode, remain
  // unresolved, and never be written to the target blob key.
  await fileInput.setInputFiles({
    name: "fake.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("not playable audio"),
  });
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByText("Re-imported", { exact: true })).toHaveCount(0);
  const afterInvalid = await page.evaluate(async (projectId) => {
    const { loadProject } = await import("/src/lib/storage/db.ts");
    const project = await loadProject(projectId);
    return project?.samples?.map((sample) => ({
      blobKey: sample.blobKey,
      hydrated: sample.blob instanceof Blob,
    }));
  }, fixture.projectId);
  expect(afterInvalid).toEqual([
    { blobKey: fixture.targetBlobKey, hydrated: false },
    { blobKey: fixture.decoyBlobKey, hydrated: true },
  ]);

  // The input is reset after an attempt, so the user can retry in place.
  await fileInput.setInputFiles({
    name: "replacement.wav",
    mimeType: "audio/wav",
    buffer: replacement,
  });
  await expect(dialog.getByText("Re-imported", { exact: true })).toBeVisible();

  const recovery = await page.evaluate(
    async ({ projectId, duplicateSampleId, targetBlobKey, decoyBlobKey, drumId }) => {
      const [{ getStore }, { loadProject }] = await Promise.all([
        import("/src/store.ts"),
        import("/src/lib/storage/db.ts"),
      ]);
      const current = getStore().state.project;
      const durable = await loadProject(projectId);
      const currentTarget = current.samples?.find(
        (sample) =>
          sample.id === duplicateSampleId && sample.blobKey === targetBlobKey,
      );
      const currentDecoy = current.samples?.find(
        (sample) =>
          sample.id === duplicateSampleId && sample.blobKey === decoyBlobKey,
      );
      const durableTarget = durable?.samples?.find(
        (sample) =>
          sample.id === duplicateSampleId && sample.blobKey === targetBlobKey,
      );
      const durableDecoy = durable?.samples?.find(
        (sample) =>
          sample.id === duplicateSampleId && sample.blobKey === decoyBlobKey,
      );
      return {
        currentTargetSize: currentTarget?.blob?.size ?? null,
        currentTargetDuration: currentTarget?.durationSec ?? null,
        currentDecoySize: currentDecoy?.blob?.size ?? null,
        currentDecoyDuration: currentDecoy?.durationSec ?? null,
        durableTargetSize: durableTarget?.blob?.size ?? null,
        durableDecoySize: durableDecoy?.blob?.size ?? null,
        padAssignment:
          current.tracks.find((track) => track.id === drumId)?.padSamples?.kick ?? null,
      };
    },
    fixture,
  );
  expect(recovery).toEqual({
    currentTargetSize: replacement.byteLength,
    currentTargetDuration: 0.25,
    currentDecoySize: fixture.decoySize,
    currentDecoyDuration: 7,
    durableTargetSize: replacement.byteLength,
    durableDecoySize: fixture.decoySize,
    padAssignment: fixture.targetBlobKey,
  });

  await expect
    .poll(() =>
      page.evaluate(
        ({ drumId, targetBlobKey }) =>
          window.__SN_AUDIO_ENGINE_STATUS__
            ?.padSamples()
            .find(
              (entry) =>
                entry.trackId === drumId &&
                entry.piece === "kick" &&
                entry.blobKey === targetBlobKey,
            ) ?? null,
        fixture,
      ),
    )
    .toMatchObject({
      trackId: fixture.drumId,
      piece: "kick",
      blobKey: fixture.targetBlobKey,
      ready: true,
      failed: false,
    });
});
