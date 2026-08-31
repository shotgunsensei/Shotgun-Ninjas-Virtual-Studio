import { expect, test } from "@playwright/test";

test("a pack loaded while stopped keeps lean drums audible on first Play", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    localStorage.setItem("studio.onboardingShown", "1");
    localStorage.setItem("studio.browser.tab", "tracks");
  });
  await page.goto("/studio?snAudioNodeTrace=1&snFirstPlayTrace=1", {
    waitUntil: "domcontentloaded",
  });
  await page.locator("header").waitFor({ state: "visible", timeout: 20_000 });
  await page.getByRole("button", { name: /Tap to Enable Audio/i }).click();

  // Isolate the first-play drum path so another instrument cannot hide a
  // broken master connection, and keep the pattern repeating while polling.
  const drumTrackId = await page.evaluate(async () => {
    const { getStore } = await import("/src/store.ts");
    const current = getStore().state.project;
    const tracks = current.tracks.map((track) => ({
      ...track,
      muted: track.kind !== "drums",
      solo: false,
      volume: 1,
    }));
    const drums = tracks.find((track) => track.kind === "drums");
    if (!drums) throw new Error("Default project has no drum track");
    getStore().patchProject({
      tracks,
      loopEnabled: true,
      loopStartBeat: 0,
      loopEndBeat: 16,
    });
    return drums.id;
  });

  await page.getByRole("tab", { name: "Library" }).click();
  await page.getByTestId("load-sound-pack-vcsl-neon-keys").click();
  await expect(page.getByTestId("load-sound-pack-vcsl-neon-keys")).toHaveText(
    "Loaded",
  );
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const trace = window.__SN_AUDIO_NODE_TRACE__?.snapshot();
        return (
          (trace?.leanDrumHitsTriggered ?? 0) > 0 &&
          (trace?.leanOneShotSourcesCreated ?? 0) > 0
        );
      }),
    )
    .toBe(true);

  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { audio } = await import("/src/lib/audio/engine.ts");
        const levels = audio.getMasterLevels();
        return [...levels.peakDb, ...levels.rmsDb].some(Number.isFinite);
      }),
    )
    .toBe(true);

  const result = await page.evaluate((trackId) => {
    const trace = window.__SN_AUDIO_NODE_TRACE__?.snapshot();
    return {
      hits: trace?.leanDrumHitsTriggered ?? 0,
      sources: trace?.leanOneShotSourcesCreated ?? 0,
      activeLeanTrackIds:
        window.__SN_AUDIO_ENGINE_STATUS__?.voiceModes().activeLeanTrackIds ?? [],
      connectFailures:
        window.__SN_FIRST_PLAY_TRACE__
          ?.dump()
          .filter((event) => event.phase === "lean-drum-voice:master-connect-failed") ?? [],
      expectedTrackId: trackId,
    };
  }, drumTrackId);
  expect(result.hits).toBeGreaterThan(0);
  expect(result.sources).toBeGreaterThan(0);
  expect(result.activeLeanTrackIds).toContain(result.expectedTrackId);
  expect(result.connectFailures).toEqual([]);

  await page.getByRole("button", { name: /Panic/i }).click();
});
