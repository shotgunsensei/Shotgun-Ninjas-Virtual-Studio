import { test, expect, type Page } from "@playwright/test";

const STUDIO_URL = "/studio?disableAudio=1&snStartupSoundTrace=1";

async function openStudio(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("header", { timeout: 15_000 });
  return errors;
}

test.describe("4.0.0-launch release guards", () => {
  test("loads a built-in demo and changes a track preset without empty Select value crashes", async ({
    page,
  }) => {
    // Playwright supplies a fresh browser context for this test. Seed its
    // preferences before startup instead of deleting an open IndexedDB database.
    await page.addInitScript(() => {
      localStorage.setItem("studio.onboardingShown", "1");
      localStorage.setItem("studio.settings.v1", JSON.stringify({ uiMode: "expert", tutorEnabled: false }));
    });
    const errors = await openStudio(page);

    await page.getByTestId("open-load-dialog").click();
    await expect(page.getByTestId("demo-list")).toBeVisible();
    await page.getByTestId("demo-load-trap-starter").click();
    await expect(page.getByTestId("demo-list")).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("project-name-input")).toHaveValue(/Trap Starter/i);

    const firstStrip = page.locator('[data-testid^="channel-strip-"]').first();
    await expect(firstStrip).toBeVisible();
    const presetSelect = firstStrip.getByRole("combobox").first();
    await presetSelect.click();
    const secondOption = page.getByRole("option").nth(1);
    await expect(secondOption).toBeVisible();
    await secondOption.click();

    await expect(firstStrip).toBeVisible();
    expect(errors.join("\n")).not.toContain("A <Select.Item /> must have a value prop");

    const startupTrace = await page.evaluate(() =>
      window.__SN_STARTUP_SOUND_TRACE__?.snapshot().map((event) => event.name) ?? [],
    );
    expect(startupTrace).not.toContain("world-welcome:play");
    expect(startupTrace).not.toContain("world-ambient:start");
  });
});
