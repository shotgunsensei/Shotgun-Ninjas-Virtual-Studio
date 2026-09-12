import { expect, test } from "@playwright/test";

test.describe("CC0 factory instruments", () => {
  for (const instrument of [
    { id: "bell.vcsl-tanzanian-kalimba", folder: "tanzanian-kalimba", name: "VCSL Tanzanian Kalimba", zones: 4, cue: "Build a three-note ostinato", family: "Plucked idiophone" },
    { id: "keys.grand-piano", folder: "kawai-grand", name: "Grand Piano", zones: 6, cue: "Play a quiet broken chord", family: "Acoustic grand piano" },
  ]) {
  test(`loads ${instrument.name} from same-origin assets with bounded fetch concurrency`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      localStorage.setItem("studio.onboardingShown", "1");
    });

    const errors: string[] = [];
    const responses: Array<{ url: string; status: number }> = [];
    let activeFactoryRequests = 0;
    let maxFactoryRequests = 0;
    const isFactory = (url: string) =>
      new URL(url).pathname.includes(`/samples/factory/vcsl/${instrument.folder}/`);

    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("request", (request) => {
      if (!isFactory(request.url())) return;
      activeFactoryRequests += 1;
      maxFactoryRequests = Math.max(maxFactoryRequests, activeFactoryRequests);
    });
    const finish = (url: string) => {
      if (isFactory(url)) activeFactoryRequests = Math.max(0, activeFactoryRequests - 1);
    };
    page.on("requestfinished", (request) => finish(request.url()));
    page.on("requestfailed", (request) => finish(request.url()));
    page.on("response", (response) => {
      if (isFactory(response.url())) {
        responses.push({ url: response.url(), status: response.status() });
      }
    });

    await page.goto("/studio?factoryInstrumentTest=1", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector("header", { timeout: 20_000 });

    const row = page.getByTestId(`preset-row-${instrument.id}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText(`HQ · ${instrument.zones} zones`);

    await row.getByRole("button", { name: /creative guide/i }).click();
    await expect(row).toContainText(instrument.cue);
    await expect(row).toContainText(instrument.family);

    await row.getByRole("button", { name: `Preview ${instrument.name}` }).click();
    await expect.poll(() => responses.length, { timeout: 20_000 }).toBe(instrument.zones);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(new Set(responses.map((response) => response.url)).size).toBe(instrument.zones);
    expect(maxFactoryRequests).toBeLessThanOrEqual(3);

    await expect(page.getByText(`Previewing ${instrument.name} · local CC0 samples`, { exact: false })).toBeVisible({
      timeout: 10_000,
    });
    await row.getByRole("button", { name: "Load" }).click();
    await expect(row.getByRole("button", { name: "Loaded" })).toBeVisible();
    expect(errors).toEqual([]);
  });
  }

  test("renders sampled preset zones into an offline WAV export", async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      localStorage.setItem("studio.onboardingShown", "1");
    });

    const sampleResponses: number[] = [];
    page.on("response", (response) => {
      if (new URL(response.url()).pathname.includes("/samples/factory/vcsl/tenor-sax-staccato/")) {
        sampleResponses.push(response.status());
      }
    });

    await page.goto("/studio?factoryExportTest=1", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("header", { timeout: 20_000 });

    const result = await page.evaluate(async () => {
      const [{ getStore }, { renderProject }] = await Promise.all([
        import("/src/store.ts"),
        import("/src/lib/audio/export.ts"),
      ]);
      const project = structuredClone(getStore().state.project);
      const piano = project.tracks.find((track) => track.kind === "piano");
      if (!piano) throw new Error("Default project has no piano track");
      piano.presetId = "brass.vcsl-tenor-sax-stabs";
      piano.muted = false;
      piano.solo = false;
      piano.audioClips = [];
      project.tracks = [piano];

      const exported = await renderProject(project, "wav", undefined, {
        customStartBeat: 0,
        customEndBeat: 2,
      });
      const bytes = new Uint8Array(await exported.blob.arrayBuffer());
      return {
        size: exported.blob.size,
        type: exported.blob.type,
        route: exported.route,
        magic: String.fromCharCode(...bytes.slice(0, 4)),
      };
    });

    expect(result.route).toBe("native-wav");
    expect(result.type).toContain("audio/wav");
    expect(result.magic).toBe("RIFF");
    expect(result.size).toBeGreaterThan(44_100);
    expect(sampleResponses).toHaveLength(4);
    expect(sampleResponses.every((status) => status === 200)).toBe(true);
  });
});
