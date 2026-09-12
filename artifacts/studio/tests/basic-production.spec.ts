import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

// Run against `pnpm serve`, never Vite's source-module endpoints:
// STUDIO_PRODUCTION_TEST=1 STUDIO_TEST_PORT=5175 STUDIO_TEST_REUSE_SERVER=1
// STUDIO_LEARNING_SOAK=1 additionally enables the ten-minute playback check.
test.skip(process.env.STUDIO_PRODUCTION_TEST !== "1", "Opt-in production preview verification");

async function openBlankStudio(page: Page) {
  await page.addInitScript(() => {
    // Exercise the ordinary download fallback without native OS save dialogs.
    Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined });
    if (!localStorage.getItem("studio.settings.v1")) {
      localStorage.setItem("studio.settings.v1", JSON.stringify({
        uiMode: "beginner", tutorEnabled: true, autosaveEnabled: false,
      }));
    }
  });
  const sourceRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/src/")) sourceRequests.push(request.url());
  });
  await page.goto("/studio", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("onboarding-version-beginner")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("starting-mode-blank-project").click();
  await page.getByRole("button", { name: /let.?s go/i }).click();
  await expect(page.getByTestId("basic-studio")).toBeVisible();
  expect(sourceRequests, "Production must load built assets, not source modules").toEqual([]);
}

async function makeSong(page: Page) {
  await page.getByTestId("basic-starter-beat").click();
  await page.getByTestId("basic-add-bass").click();
  await page.getByTestId("basic-add-melody").click();
  await page.getByTestId("basic-repeat-song").click();
}

test("production Basic makes, saves, downloads, and reloads a song", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await openBlankStudio(page);
  await makeSong(page);
  await page.getByTestId("project-name-input").fill("My first production song");
  await page.getByRole("button", { name: "Next lesson", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("basic-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Turn tutor off", exact: true }).click();
  await page.getByTestId("basic-save").click();
  await expect(page.getByRole("status").filter({ hasText: "Project saved" }).first()).toBeVisible();

  await page.getByTestId("basic-export").click();
  const exportDialog = page.getByRole("dialog", { name: "Export song", exact: true });
  await expect(exportDialog).toBeVisible();
  await expect(exportDialog.getByRole("radio", { name: /Whole song/ })).toBeChecked();
  await expect(exportDialog.locator("details")).not.toHaveAttribute("open", "");
  const jsonDownloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-project-with-samples").click();
  const jsonDownload = await jsonDownloadPromise;
  const jsonPath = testInfo.outputPath(jsonDownload.suggestedFilename());
  await jsonDownload.saveAs(jsonPath);
  const backup = JSON.parse(await readFile(jsonPath, "utf8"));
  expect(backup.format).toBe("shotgun-ninjas-studio-project");
  expect(backup.project.name).toBe("My first production song");
  for (const kind of ["drums", "bass", "piano"]) {
    expect(backup.project.tracks.some((track: { kind: string; noteClips: Array<{ notes: unknown[] }> }) =>
      track.kind === kind && track.noteClips.some((clip) => clip.notes.length > 0)), `${kind} notes exported`).toBe(true);
  }

  await page.getByRole("button", { name: "Tap to Enable Audio", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByTestId("basic-export").click();
  const wavDownloadPromise = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByTestId("export-wav").click();
  const wavDownload = await wavDownloadPromise;
  const wavPath = testInfo.outputPath(wavDownload.suggestedFilename());
  await wavDownload.saveAs(wavPath);
  const wav = await readFile(wavPath);
  expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
  let dataStart = 0;
  let dataLength = 0;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const length = wav.readUInt32LE(offset + 4);
    if (wav.toString("ascii", offset, offset + 4) === "data") {
      dataStart = offset + 8;
      dataLength = length;
      break;
    }
    offset += 8 + length + (length % 2);
  }
  expect(dataLength).toBeGreaterThan(44_100);
  let peak = 0;
  for (let offset = dataStart; offset + 2 <= dataStart + dataLength; offset += 2) {
    peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
  }
  expect(peak, "Rendered WAV contains audible PCM samples").toBeGreaterThan(100);
  await page.getByRole("dialog", { name: /Your beat is ready/ }).getByRole("button", { name: "Skip", exact: true }).click();
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(page.getByTestId("basic-studio")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("advanced-desktop.png"), fullPage: true });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Advanced", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Learning tutor", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("project-name-input")).toHaveValue("My first production song");
  await page.getByRole("button", { name: "Basic", exact: true }).click();
  await page.getByRole("button", { name: "Learning tutor", exact: true }).click();
  await expect(page.getByTestId("guided-tutor")).toContainText("2 of 7");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("basic-studio")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("basic-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Turn tutor off", exact: true }).click();
  await page.getByTestId("open-load-dialog").click();
  const savedProject = page.getByRole("dialog", { name: "Load project", exact: true }).getByText("My first production song", { exact: true }).locator("../..");
  await savedProject.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Load project", exact: true })).not.toBeVisible();
  await expect(page.getByTestId("project-name-input")).toHaveValue("My first production song");

  // The Basic backup explanation promises that the downloaded file opens
  // through Load. Exercise that complete route, including review and reload.
  await page.getByTestId("open-load-dialog").click();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByTestId("load-project-backup").click();
  await (await fileChooserPromise).setFiles(jsonPath);
  await expect(page.getByTestId("import-summary")).toContainText("My first production song");
  await expect(page.getByTestId("import-summary")).toContainText("5 tracks");
  const importReloadPromise = page.waitForEvent("load");
  await page.getByTestId("import-summary-confirm").click();
  await importReloadPromise;
  await expect(page.getByTestId("basic-studio")).toBeVisible();
  await expect(page.getByTestId("project-name-input")).toHaveValue("My first production song");
  await page.getByTestId("basic-export").click();
  const restoredDownloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-project-with-samples").click();
  const restoredDownload = await restoredDownloadPromise;
  const restoredPath = testInfo.outputPath("restored-project.snproj.json");
  await restoredDownload.saveAs(restoredPath);
  const restoredBackup = JSON.parse(await readFile(restoredPath, "utf8"));
  const musicalContent = (project: { tracks: Array<{ id: string; kind: string; noteClips: unknown[]; audioClips: unknown[] }> }) =>
    project.tracks.map(({ id, kind, noteClips, audioClips }) => ({ id, kind, noteClips, audioClips }));
  expect(musicalContent(restoredBackup.project)).toEqual(musicalContent(backup.project));
  expect(restoredBackup.project.bpm).toBe(backup.project.bpm);
  expect(restoredBackup.project.bars).toBe(backup.project.bars);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
  await testInfo.attach("production-exports", { body: JSON.stringify({ wavBytes: wav.length, peakPcm16: peak, projectTracks: backup.project.tracks.length }), contentType: "application/json" });
});

test("production playback stays responsive for ten minutes across studio versions", async ({ page }, testInfo) => {
  test.skip(process.env.STUDIO_LEARNING_SOAK !== "1", "Set STUDIO_LEARNING_SOAK=1 for the ten-minute real-audio check");
  test.setTimeout(720_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openBlankStudio(page);
  await makeSong(page);
  await page.getByRole("button", { name: "Turn tutor off", exact: true }).click();
  await page.getByRole("button", { name: "Tap to Enable Audio", exact: true }).click();
  await page.getByRole("checkbox", { name: "Repeat", exact: true }).check();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const startedAt = Date.now();
  let pulses = 0;
  while (Date.now() - startedAt < 600_000) {
    await page.waitForTimeout(Math.min(30_000, 600_000 - (Date.now() - startedAt)));
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await expect(page.getByTestId("project-name-input")).toBeEditable();
    await page.getByRole("button", { name: "Advanced", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    const position = page.getByText("Position", { exact: true }).locator("..").locator("span").last();
    const before = await position.textContent();
    await expect.poll(() => position.textContent()).not.toBe(before);
    if (await page.getByRole("button", { name: "Show mixer", exact: true }).isVisible()) {
      await page.getByRole("button", { name: "Show mixer", exact: true }).click();
    }
    await expect(page.getByRole("button", { name: "Hide mixer", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Hide mixer", exact: true }).click();
    await page.getByRole("button", { name: "Basic", exact: true }).click();
    expect(pageErrors).toEqual([]);
    pulses++;
    console.log(`Production playback check ${pulses}: ${Math.round((Date.now() - startedAt) / 1000)} seconds, transport advancing and mixer responsive.`);
  }
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Panic — stop all sound", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await testInfo.attach("ten-minute-playback", { body: JSON.stringify({ durationMs: Date.now() - startedAt, responsivenessChecks: pulses, pageErrors }), contentType: "application/json" });
});
