/**
 * End-to-end walkthrough: welcome / onboarding modal and Remix button.
 *
 * Covers the acceptance criteria from Task #52:
 *  1. Fresh load shows the welcome modal with exactly five starting-mode tiles.
 *  2. Picking a tile loads the matching demo and advances to the coach card.
 *  3. The Load dialog's Remix button forks a demo; name ends with " (remix)".
 *  4. On reload after onboarding, the welcome modal does NOT re-appear.
 *
 * All tests navigate to `/studio?disableAudio=1` so the AudioEngine skips Tone.js
 * node construction (which blocks the headless Chromium main thread for tens
 * of seconds per track).  The UI flow — modal, store updates, coach card,
 * project-name field — is fully exercised; only the audio graph is skipped.
 */

import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** URL used by every test — audio disabled so loadDemo / remixDemo are fast. */
const STUDIO_URL = "/studio?disableAudio=1";

/** Clear all browser storage so each test starts from a truly blank slate. */
async function clearStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    try {
      localStorage.clear();
    } catch {
      /* quota / security */
    }
    const DB_NAME = "shotgun-ninjas-studio";
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });
}

/** Navigate to the studio (with audio disabled) and wait for the app to mount. */
async function openStudio(page: Page): Promise<void> {
  await page.goto(STUDIO_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("header", { timeout: 15_000 });
}

/** Read the project name from the header title input. */
async function getProjectName(page: Page): Promise<string> {
  const input = page.getByTestId("project-name-input");
  await input.waitFor({ timeout: 5_000 });
  return input.inputValue();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe("Welcome flow & Remix button", () => {
  // -------------------------------------------------------------------------
  // 1. Welcome modal appears with five starting-mode tiles
  // -------------------------------------------------------------------------
  test("shows the welcome modal with five starting-mode tiles on first load", async ({
    page,
  }) => {
    await openStudio(page);
    await clearStorage(page);
    await openStudio(page); // reload with clean storage so onboarding triggers

    const dialog = page.getByTestId("help-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    const modeStep = page.getByTestId("onboarding-mode-step");
    await expect(modeStep).toBeVisible();

    // Should render exactly 5 starting-mode tiles (one per STARTING_MODES entry).
    const tiles = page.locator('[data-testid^="starting-mode-"]');
    await expect(tiles).toHaveCount(5);
  });

  // -------------------------------------------------------------------------
  // 2. Picking a tile loads the matching demo and shows the coach card
  // -------------------------------------------------------------------------
  test("picking a starting-mode tile loads the demo and shows the coach card", async ({
    page,
  }) => {
    await openStudio(page);
    await clearStorage(page);
    await openStudio(page);

    const dialog = page.getByTestId("help-dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("onboarding-mode-step")).toBeVisible();

    // Pick the "Cinematic Intro" tile — its demoId is "cinematic-trailer-hit"
    // which produces a project named "Cinematic Trailer Hit".
    await page.getByTestId("starting-mode-cinematic-intro").click();

    // After picking a tile the dialog should advance to the coach card.
    const coachStep = page.getByTestId("onboarding-coach-step");
    await expect(coachStep).toBeVisible({ timeout: 8_000 });

    // The mode-selection step should be gone.
    await expect(page.getByTestId("onboarding-mode-step")).not.toBeVisible();

    // The selected demo should now be live in the project name field.
    const projectName = await getProjectName(page);
    expect(projectName).toContain("Cinematic");

    // Dismiss the coach card via the primary "Let's go" button.
    const letsGoBtn = coachStep.locator("button").filter({ hasText: /let.?s go/i });
    await letsGoBtn.click();
    await expect(dialog).not.toBeVisible({ timeout: 8_000 });
  });

  // -------------------------------------------------------------------------
  // 3. Remix creates a fork named "<demo> (remix)" and leaves the source intact
  // -------------------------------------------------------------------------
  test("Remix button forks the demo with a '(remix)' suffix and leaves source untouched", async ({
    page,
  }) => {
    await openStudio(page);
    await clearStorage(page);
    // Set the onboarding flag so the welcome modal is skipped.
    await page.evaluate(() =>
      localStorage.setItem("studio.onboardingShown", "1"),
    );
    await openStudio(page);

    // Make sure the welcome dialog is NOT showing.
    await expect(page.getByTestId("help-dialog")).not.toBeVisible({
      timeout: 5_000,
    });

    // Open the Load dialog via the header button.
    await page.getByTestId("open-load-dialog").click();
    const demoList = page.getByTestId("demo-list");
    await expect(demoList).toBeVisible({ timeout: 5_000 });

    // Remix the first demo (Trap Starter — id: "trap-starter").
    await page.getByTestId("demo-remix-trap-starter").click();

    // Dialog should close after remix.
    await expect(page.getByTestId("demo-list")).not.toBeVisible({
      timeout: 8_000,
    });

    // Project name should end with " (remix)".
    const remixedName = await getProjectName(page);
    expect(remixedName.trim()).toMatch(/\(remix\)$/i);
    expect(remixedName).toContain("Trap Starter");

    // Re-open the Load dialog and verify the source demo card is still present
    // with its original name (the source definition is unchanged).
    await page.getByTestId("open-load-dialog").click();
    await expect(demoList).toBeVisible({ timeout: 5_000 });

    const trapDemoCard = page.getByTestId("demo-card-trap-starter");
    await expect(trapDemoCard).toBeVisible();

    // The demo card should display the original name, not a "(remix)" suffix.
    const cardText = await trapDemoCard.textContent();
    expect(cardText).toContain("Trap Starter");
    expect(cardText).not.toMatch(/\(remix\)/i);
  });

  // -------------------------------------------------------------------------
  // 4. "studio.onboardingShown" flag prevents the modal from re-appearing
  // -------------------------------------------------------------------------
  test("welcome modal does not re-appear once onboardingShown flag is set", async ({
    page,
  }) => {
    // Simulate the flag being present from a prior session.
    await openStudio(page);
    await page.evaluate(() =>
      localStorage.setItem("studio.onboardingShown", "1"),
    );

    // Reload the app — the bootstrap check should honour the flag.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("header", { timeout: 15_000 });

    // The help dialog must not be shown automatically.
    await page.waitForTimeout(1_500);
    await expect(page.getByTestId("help-dialog")).not.toBeVisible();
  });
});
