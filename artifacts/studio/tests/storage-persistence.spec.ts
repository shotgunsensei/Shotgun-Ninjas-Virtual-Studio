import { expect, test, type Page } from "@playwright/test";

async function openStorageTestPage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("studio.onboardingShown", "1");
  });
  await page.goto("/studio?disableAudio=1", { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor({ state: "visible", timeout: 20_000 });
}

test("persistence calls stay FIFO even when the first blob hash resolves last", async ({
  page,
}) => {
  await openStorageTestPage(page);

  const result = await page.evaluate(async () => {
    const [{ defaultProject }, storage] = await Promise.all([
      import("/src/store.ts"),
      import("/src/lib/storage/db.ts"),
    ]);
    const id = `fifo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const key = `${id}:sample:ordered`;
    const originalArrayBuffer = Blob.prototype.arrayBuffer;
    const workerDescriptor = Object.getOwnPropertyDescriptor(window, "Worker");
    const hashEvents: string[] = [];
    let releaseSlowHash: (() => void) | undefined;
    let markSlowHashStarted: (() => void) | undefined;
    const slowHashStarted = new Promise<void>((resolve) => {
      markSlowHashStarted = resolve;
    });
    const slowHashGate = new Promise<void>((resolve) => {
      releaseSlowHash = resolve;
    });

    Object.defineProperty(window, "Worker", {
      configurable: true,
      value: undefined,
    });
    Blob.prototype.arrayBuffer = function patchedArrayBuffer() {
      const bytes = originalArrayBuffer.call(this);
      if (this.type === "application/x-fifo-old") {
        hashEvents.push("old");
        markSlowHashStarted?.();
        return slowHashGate.then(() => bytes);
      }
      if (this.type === "application/x-fifo-middle") hashEvents.push("middle");
      if (this.type === "application/x-fifo-newer") hashEvents.push("newer");
      return bytes;
    };

    const projectWithSample = (name: string, body: string, type: string) => {
      const project = defaultProject();
      project.id = id;
      project.name = name;
      project.updatedAt = Date.now();
      project.samples = [
        {
          id: "ordered",
          name: "Ordered sample",
          blobKey: key,
          durationSec: 0.1,
          createdAt: Date.now(),
          blob: new Blob([body], { type }),
        },
      ];
      return project;
    };

    try {
      const olderSave = storage.saveProject(
        projectWithSample("older", "older", "application/x-fifo-old"),
      );
      await slowHashStarted;

      let draftSettled = false;
      let relocationSettled = false;
      const middleDraft = storage
        .saveDraft(
          projectWithSample("middle", "middle", "application/x-fifo-middle"),
        )
        .then(() => {
          draftSettled = true;
        });
      const relocation = storage
        .relocateSampleBlob(
          key,
          new Blob(["relocated"], { type: "application/x-fifo-relocated" }),
        )
        .then(() => {
          relocationSettled = true;
        });
      const newerSave = storage.saveProject(
        projectWithSample("newer", "newer", "application/x-fifo-newer"),
      );

      await new Promise((resolve) => window.setTimeout(resolve, 75));
      const beforeRelease = {
        hashEvents: [...hashEvents],
        draftSettled,
        relocationSettled,
      };

      releaseSlowHash?.();
      await Promise.all([olderSave, middleDraft, relocation, newerSave]);
      const loaded = await storage.loadProject(id);
      const loadedSample = loaded?.samples?.[0];
      await storage.deleteProject(id);

      return {
        beforeRelease,
        hashEvents,
        loadedName: loaded?.name ?? null,
        loadedSampleText: (await loadedSample?.blob?.text()) ?? null,
      };
    } finally {
      Blob.prototype.arrayBuffer = originalArrayBuffer;
      if (workerDescriptor) {
        Object.defineProperty(window, "Worker", workerDescriptor);
      } else {
        delete (window as Window & { Worker?: typeof Worker }).Worker;
      }
      releaseSlowHash?.();
    }
  });

  expect(result.beforeRelease).toEqual({
    hashEvents: ["old"],
    draftSettled: false,
    relocationSettled: false,
  });
  expect(result.hashEvents).toEqual(["old", "middle", "newer"]);
  expect(result.loadedName).toBe("newer");
  expect(result.loadedSampleText).toBe("newer");
});

test("duplicate reowns assigned and missing sample keys across a storage roundtrip", async ({
  page,
}) => {
  await openStorageTestPage(page);

  const result = await page.evaluate(async () => {
    const [{ defaultProject }, storage] = await Promise.all([
      import("/src/store.ts"),
      import("/src/lib/storage/db.ts"),
    ]);
    const source = defaultProject();
    source.id = `duplicate-source-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    source.name = "Duplicate source";
    const assignedKey = `${source.id}:sample:assigned`;
    const missingKey = `${source.id}:sample:missing`;
    source.samples = [
      {
        id: "assigned",
        name: "Assigned hit",
        blobKey: assignedKey,
        durationSec: 0.1,
        createdAt: Date.now(),
        blob: new Blob(["assigned-audio"], { type: "audio/wav" }),
      },
      {
        id: "missing",
        name: "Missing hit",
        blobKey: missingKey,
        durationSec: 0.1,
        createdAt: Date.now(),
      },
    ];
    const drums = source.tracks.find((track) => track.kind === "drums");
    const vocals = source.tracks.find((track) => track.kind === "vocals");
    if (!drums || !vocals) throw new Error("Default project tracks are incomplete.");
    drums.padSamples = { kick: assignedKey, snare: missingKey };
    vocals.audioClips = [
      {
        id: "missing-clip",
        start: 0,
        durationSec: 1,
        blobKey: `${source.id}:${vocals.id}:missing-clip`,
      },
    ];
    source.chopLab = {
      markers: [],
      sliceSettings: [],
      sensitivity: 0.5,
      sampleName: "missing-break.wav",
      sampleBlobKey: `${source.id}:choplab:missing`,
    };

    await storage.saveProject(source);
    const duplicate = await storage.duplicateProject(source, "Reowned duplicate");
    await storage.deleteProject(source.id);
    const restored = await storage.loadProject(duplicate.id);
    const restoredDrums = restored?.tracks.find((track) => track.kind === "drums");
    const restoredVocals = restored?.tracks.find((track) => track.kind === "vocals");
    const assigned = restored?.samples?.find((sample) => sample.id === "assigned");
    const missing = restored?.samples?.find((sample) => sample.id === "missing");
    const output = {
      duplicateId: duplicate.id,
      assignedKey: assigned?.blobKey ?? null,
      assignedText: (await assigned?.blob?.text()) ?? null,
      missingKey: missing?.blobKey ?? null,
      kickKey: restoredDrums?.padSamples?.kick ?? null,
      snareKey: restoredDrums?.padSamples?.snare ?? null,
      missingClipKey: restoredVocals?.audioClips[0]?.blobKey ?? null,
      missingClipHasBlob: !!restoredVocals?.audioClips[0]?.blob,
      chopKey: restored?.chopLab?.sampleBlobKey ?? null,
      chopHasBlob: !!restored?.chopLab?.sampleBlob,
    };
    await storage.deleteProject(duplicate.id);
    return output;
  });

  expect(result.assignedKey).toBe(`${result.duplicateId}:sample:assigned`);
  expect(result.assignedText).toBe("assigned-audio");
  expect(result.missingKey).toBe(`${result.duplicateId}:sample:missing`);
  expect(result.kickKey).toBe(result.assignedKey);
  expect(result.snareKey).toBe(result.missingKey);
  expect(result.missingClipKey).toMatch(
    new RegExp(`^${result.duplicateId}:.+:missing-clip$`),
  );
  expect(result.missingClipHasBlob).toBe(false);
  expect(result.chopKey).toBe(`${result.duplicateId}:choplab:sample`);
  expect(result.chopHasBlob).toBe(false);
});

test("portable import reowns pad references and persists both present and missing blobs", async ({
  page,
}) => {
  await openStorageTestPage(page);

  const result = await page.evaluate(async () => {
    const [{ defaultProject }, storage] = await Promise.all([
      import("/src/store.ts"),
      import("/src/lib/storage/db.ts"),
    ]);
    const source = defaultProject();
    source.id = `import-source-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const assignedKey = `${source.id}:sample:assigned`;
    const missingKey = `${source.id}:sample:missing`;
    source.samples = [
      {
        id: "assigned",
        name: "Assigned import",
        blobKey: assignedKey,
        durationSec: 0.1,
        createdAt: Date.now(),
        blob: new Blob(["portable-audio"], { type: "audio/wav" }),
      },
      {
        id: "missing",
        name: "Missing import",
        blobKey: missingKey,
        durationSec: 0.1,
        createdAt: Date.now(),
      },
    ];
    const drums = source.tracks.find((track) => track.kind === "drums");
    if (!drums) throw new Error("Default project has no drum track.");
    drums.padSamples = { kick: assignedKey, snare: missingKey };

    const json = await storage.projectToJson(source, "project-with-samples");
    const imported = storage.parseProjectJson(json);
    await storage.saveProject(imported);
    const restored = await storage.loadProject(imported.id);
    const restoredDrums = restored?.tracks.find((track) => track.kind === "drums");
    const assigned = restored?.samples?.find((sample) => sample.id === "assigned");
    const missing = restored?.samples?.find((sample) => sample.id === "missing");
    const output = {
      sourceId: source.id,
      importedId: imported.id,
      assignedKey: assigned?.blobKey ?? null,
      assignedText: (await assigned?.blob?.text()) ?? null,
      missingKey: missing?.blobKey ?? null,
      missingHasBlob: !!missing?.blob,
      kickKey: restoredDrums?.padSamples?.kick ?? null,
      snareKey: restoredDrums?.padSamples?.snare ?? null,
    };
    await storage.deleteProject(imported.id);
    return output;
  });

  expect(result.importedId).not.toBe(result.sourceId);
  expect(result.assignedKey).toBe(`${result.importedId}:sample:assigned`);
  expect(result.assignedText).toBe("portable-audio");
  expect(result.missingKey).toBe(`${result.importedId}:sample:missing`);
  expect(result.missingHasBlob).toBe(false);
  expect(result.kickKey).toBe(result.assignedKey);
  expect(result.snareKey).toBe(result.missingKey);
});
