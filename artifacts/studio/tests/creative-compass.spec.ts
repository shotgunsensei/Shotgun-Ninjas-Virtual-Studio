import { expect, test, type Page } from "@playwright/test";

const STUDIO_URL = "/studio?disableAudio=1";

async function openStudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("studio.onboardingShown", "1");
  });
  await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor({ state: "visible", timeout: 15_000 });
}

async function exposeInstallPrompt(page: Page): Promise<void> {
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.defineProperties(event, {
      prompt: {
        value: async () => undefined,
      },
      userChoice: {
        value: Promise.resolve({ outcome: "dismissed" as const }),
      },
    });
    window.dispatchEvent(event);
  });
}

async function projectSnapshot(page: Page) {
  return page.evaluate(async () => {
    const { getStore } = await import("/src/store.ts");
    const state = getStore().state;
    return {
      revision: state.projectRevision,
      isPlaying: state.isPlaying,
      selectedTrackId: state.selectedTrackId,
      selectedClipId: state.selectedClipId,
      soundPackId: state.project.soundPackId,
      loopEndBeat: state.project.loopEndBeat,
      clips: state.project.tracks.flatMap((track) =>
        track.noteClips.map((clip) => ({
          trackId: track.id,
          id: clip.id,
          name: clip.name ?? "",
          length: clip.length,
          noteCount: clip.notes.length,
        })),
      ),
    };
  });
}

test.describe("Creative Compass", () => {
  test("adds and develops an editable idea without replacing work or starting audio", async ({
    page,
  }) => {
    await openStudio(page);
    const before = await projectSnapshot(page);

    await page.getByTestId("learn-menu").click();
    await page.getByTestId("open-creative-compass").click();
    const compass = page.getByTestId("creative-compass");
    await expect(compass).toBeVisible();
    await expect(compass).toContainText("Nothing plays or replaces your work automatically");

    await page.getByTestId("compass-add-seed").click();
    await expect(page.getByTestId("compass-created-status")).toContainText(/added/i);

    const afterSeed = await projectSnapshot(page);
    expect(afterSeed.clips).toHaveLength(before.clips.length + 1);
    expect(afterSeed.revision).toBe(before.revision + 1);
    expect(afterSeed.isPlaying).toBe(false);
    const seed = afterSeed.clips.find((clip) => clip.id === afterSeed.selectedClipId);
    expect(seed?.name).toMatch(/^Compass ·/);
    expect(seed?.length).toBe(8);
    expect(seed?.noteCount).toBeGreaterThan(0);
    expect(afterSeed.loopEndBeat).toBeGreaterThan(before.loopEndBeat);

    await compass.getByRole("button", { name: /Write an answer/i }).click();
    const afterVariation = await projectSnapshot(page);
    expect(afterVariation.clips).toHaveLength(before.clips.length + 2);
    expect(afterVariation.isPlaying).toBe(false);
    expect(
      afterVariation.clips.find((clip) => clip.id === afterVariation.selectedClipId)?.name,
    ).toMatch(/Answer phrase/);
    expect(afterVariation.loopEndBeat).toBeGreaterThan(afterSeed.loopEndBeat);

    await page.getByTestId("compass-undo").click();
    const afterUndo = await projectSnapshot(page);
    expect(afterUndo.clips).toHaveLength(before.clips.length + 1);
    expect(afterUndo.clips.some((clip) => clip.id === seed?.id)).toBe(true);
    expect(afterUndo.loopEndBeat).toBe(afterSeed.loopEndBeat);
    expect(afterUndo.isPlaying).toBe(false);
  });

  test("stays within tablet and mobile viewports and exposes the same Create entry point", async ({
    page,
  }) => {
    test.slow();
    await page.addInitScript(() => {
      localStorage.setItem("studio.onboardingShown", "1");
    });

    for (const width of [600, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 820 });
      await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded" });
      const header = page.locator("header");
      await header.waitFor({ state: "visible" });
      const metrics = await header.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
      await expect(page.getByTestId("open-load-dialog")).toBeVisible();
      await expect(page.getByTestId("open-export")).toBeVisible();
      await expect(page.getByTestId("learn-menu")).toBeVisible();
    }

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded" });
      const createButton = page.getByTestId("mobile-open-creative");
      await expect(createButton).toBeVisible();
      await createButton.click();
      const compass = page.getByTestId("creative-compass");
      await expect(compass).toBeVisible();
      await page.waitForTimeout(250);
      const bounds = await compass.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
      const overflow = await compass.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
    }
  });

  test("keeps the conditional install action reachable without header overflow", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem("studio.onboardingShown", "1");
    });

    for (const width of [1024, 1440]) {
      await page.setViewportSize({ width, height: 820 });
      await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded" });
      const header = page.locator("header");
      await header.waitFor({ state: "visible" });
      await exposeInstallPrompt(page);
      await page.getByTestId("more-menu").click();
      await expect(page.getByTestId("desktop-pwa-install-action")).toBeVisible();
      await expect(page.getByTestId("desktop-pwa-install-action")).toContainText(
        "Install app",
      );
      await page.keyboard.press("Escape");
      const metrics = await header.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
    }

    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, "userAgent", {
        configurable: true,
        value:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await expect(page.getByTestId("mobile-pwa-install-action")).toBeVisible();
    await expect(page.getByTestId("mobile-pwa-install-action")).toContainText(
      "Add to Home Screen",
    );
    await page.getByTestId("mobile-pwa-install-action").click();
    await expect(
      page.getByRole("dialog", { name: "Install on iPhone or iPad" }),
    ).toBeVisible();
  });

  test("browser tabs use roving focus and activate with arrow, Home, and End keys", async ({
    page,
  }) => {
    await openStudio(page);
    const tracks = page.getByRole("tab", { name: "Tracks" });
    const kits = page.getByRole("tab", { name: "Kits" });
    const library = page.getByRole("tab", { name: "Library" });
    const plugins = page.getByRole("tab", { name: "Plugins" });

    await expect(tracks).toHaveAttribute("aria-selected", "true");
    await expect(tracks).toHaveAttribute("tabindex", "0");
    await tracks.focus();
    await page.keyboard.press("ArrowRight");
    await expect(kits).toBeFocused();
    await expect(kits).toHaveAttribute("aria-selected", "true");
    await expect(tracks).toHaveAttribute("tabindex", "-1");
    await expect(page.getByRole("tabpanel", { name: "Kits" })).toBeVisible();

    await page.keyboard.press("End");
    await expect(plugins).toBeFocused();
    await expect(plugins).toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Home");
    await expect(library).toBeFocused();
    await expect(library).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(plugins).toBeFocused();
    await expect(plugins).toHaveAttribute("aria-selected", "true");
  });
});

test("Sound Library turns a preview pack into scoped, undoable editable clips", async ({
  page,
}) => {
  await openStudio(page);
  const before = await projectSnapshot(page);

  await page.getByRole("tab", { name: "Library" }).click();
  const sketchButton = page.locator('[data-testid^="start-pack-sketch-"]').first();
  await expect(sketchButton).toBeVisible();
  const packId = (await sketchButton.getAttribute("data-testid"))!.replace(
    "start-pack-sketch-",
    "",
  );
  await sketchButton.click();

  const after = await projectSnapshot(page);
  expect(after.clips.length).toBeGreaterThan(before.clips.length);
  expect(after.revision).toBe(before.revision + 1);
  expect(after.soundPackId).toBe(packId);
  expect(after.isPlaying).toBe(false);
  const addedIds = after.clips
    .filter((clip) => !before.clips.some((existing) => existing.id === clip.id))
    .map((clip) => clip.id);
  expect(addedIds.length).toBeGreaterThanOrEqual(1);

  await page.getByRole("button", { name: /Undo sketch/i }).click();
  const undone = await projectSnapshot(page);
  expect(undone.clips.some((clip) => addedIds.includes(clip.id))).toBe(false);
  expect(undone.clips).toHaveLength(before.clips.length);
  expect(undone.isPlaying).toBe(false);
});
