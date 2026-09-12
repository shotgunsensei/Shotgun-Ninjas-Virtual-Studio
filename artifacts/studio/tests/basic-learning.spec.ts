import { expect, test, type Page } from "@playwright/test";

async function openBasic(page: Page, realAudio = false) {
  await page.addInitScript(() => {
    localStorage.setItem("studio.onboardingShown", "1");
    if (!localStorage.getItem("studio.settings.v1")) {
      localStorage.setItem("studio.settings.v1", JSON.stringify({ uiMode: "beginner", tutorEnabled: true, autosaveEnabled: false }));
    }
  });
  await page.goto(realAudio ? "/studio" : "/studio?disableAudio=1");
  await expect(page.getByTestId("basic-studio")).toBeVisible();
}

async function projectSnapshot(page: Page) {
  return page.evaluate(async () => {
    const { getStore } = await import("/src/store.ts");
    return JSON.stringify(getStore().state.project);
  });
}

test("first visit offers two versions and the independent optional tutor up front", async ({ page }) => {
  await page.goto("/studio?disableAudio=1");
  await expect(page.getByTestId("onboarding-version-beginner")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("onboarding-version-expert")).toBeVisible();
  await expect(page.getByTestId("onboarding-tutor-toggle")).toBeVisible();
  await page.getByTestId("onboarding-tutor-toggle").click();
  await page.getByTestId("starting-mode-cinematic-intro").click();
  await page.getByRole("button", { name: /let.?s go/i }).click();
  await expect(page.getByTestId("basic-studio")).toBeVisible();
  await expect(page.getByTestId("guided-tutor")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("guided-tutor")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Learning tutor" })).toHaveAttribute("aria-pressed", "false");
});

test("editing a beat and changing versions preserves the complete project", async ({ page }) => {
  await openBasic(page);
  const before = await projectSnapshot(page);
  const step = page.getByTestId("basic-step-kick-0");
  const pressed = await step.getAttribute("aria-pressed");
  await step.click();
  await expect(step).toHaveAttribute("aria-pressed", pressed === "true" ? "false" : "true");
  const edited = await projectSnapshot(page);
  expect(edited).not.toBe(before);
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(page.getByTestId("basic-studio")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Toggle audio diagnostics panel" })).toBeVisible();
  expect(await projectSnapshot(page)).toBe(edited);
  await page.getByRole("button", { name: "Basic", exact: true }).click();
  await expect(step).toHaveAttribute("aria-pressed", pressed === "true" ? "false" : "true");
  expect(await projectSnapshot(page)).toBe(edited);
});

test("tutor remembers progress and off state; restart never changes the song", async ({ page }) => {
  await openBasic(page);
  const before = await projectSnapshot(page);
  await page.getByRole("button", { name: "Next lesson" }).click();
  await expect(page.getByTestId("guided-tutor")).toContainText("2 of 7");
  await page.getByRole("button", { name: "Turn tutor off" }).click();
  await page.reload();
  await expect(page.getByTestId("guided-tutor")).toHaveCount(0);
  await page.getByRole("button", { name: "Learning tutor" }).click();
  await expect(page.getByTestId("guided-tutor")).toContainText("2 of 7");
  for (let step = 1; step < 6; step++) await page.getByRole("button", { name: "Next lesson" }).click();
  await page.getByRole("button", { name: "Finish tutor" }).click();
  await expect(page.getByTestId("guided-tutor")).toContainText("tour is complete");
  const afterReload = await projectSnapshot(page);
  await page.getByRole("button", { name: "Restart tutor" }).click();
  await expect(page.getByTestId("guided-tutor")).toContainText("1 of 7");
  expect(await projectSnapshot(page)).toBe(afterReload);
  expect(JSON.parse(before).tracks.length).toBe(JSON.parse(afterReload).tracks.length);
});

test("focused beat buttons work with Space without starting transport", async ({ page }) => {
  await openBasic(page);
  const step = page.getByTestId("basic-step-kick-0");
  const pressed = await step.getAttribute("aria-pressed");
  await step.focus();
  await page.keyboard.press("Space");
  await expect(step).toHaveAttribute("aria-pressed", pressed === "true" ? "false" : "true");
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
});

test("Delete and Backspace keep Basic clips safe while Advanced timeline deletion works", async ({ page }) => {
  await openBasic(page);
  const step = page.getByTestId("basic-step-kick-0");
  await step.click();
  const edited = await projectSnapshot(page);
  for (const target of [step, page.getByRole("button", { name: "Learning tutor" })]) {
    await target.focus();
    for (const key of ["Delete", "Backspace"]) {
      await page.keyboard.press(key);
      expect(await projectSnapshot(page)).toBe(edited);
    }
  }
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await page.getByRole("button", { name: "Hide mixer", exact: true }).click();
  const clips = page.getByTestId("note-clip");
  await expect(clips.first()).toBeVisible();
  for (const key of ["Delete", "Backspace"]) {
    const count = await clips.count();
    await clips.first().click({ position: { x: 40, y: 28 } });
    await page.keyboard.press(key);
    await expect(clips).toHaveCount(count - 1);
  }
});

test("phone Advanced tutor offers reachable Basic practice without changing the song", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBasic(page);
  await page.getByRole("button", { name: "Next lesson" }).click();
  const before = await projectSnapshot(page);
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(page.getByTestId("guided-tutor")).toContainText("The full Inspector is available on a larger screen");
  await page.getByRole("button", { name: "Practice in Basic", exact: true }).click();
  await expect(page.getByTestId("basic-step-kick-0")).toBeVisible();
  await expect(page.getByTestId("guided-tutor")).toContainText("2 of 7");
  expect(await projectSnapshot(page)).toBe(before);
});

test("new beat, bass, and melody align after existing music and undo preserves earlier work", async ({ page }) => {
  await openBasic(page);
  const original = JSON.parse(await projectSnapshot(page));
  const initialEnd = Math.max(...original.tracks.flatMap((track: { noteClips: Array<{ start: number; length: number }> }) => track.noteClips.map((clip) => clip.start + clip.length)));
  await page.getByTestId("basic-starter-beat").click();
  await page.getByTestId("basic-add-bass").click();
  const beforeMelody = JSON.parse(await projectSnapshot(page));
  await page.getByTestId("basic-add-melody").click();
  const created = JSON.parse(await projectSnapshot(page));
  const originals = new Set(original.tracks.flatMap((track: { noteClips: Array<{ id: string }> }) => track.noteClips.map((clip) => clip.id)));
  const additions = created.tracks.flatMap((track: { noteClips: Array<{ id: string; start: number }> }) => track.noteClips.filter((clip) => !originals.has(clip.id)));
  expect(additions).toHaveLength(3);
  expect(additions.every((clip: { start: number }) => clip.start === initialEnd)).toBe(true);
  await page.getByTestId("basic-undo").click();
  const restored = JSON.parse(await projectSnapshot(page));
  expect(restored.tracks).toEqual(beforeMelody.tracks);
  expect(restored.bars).toBe(beforeMelody.bars);
  await page.getByTestId("basic-starter-beat").click();
  await page.getByTestId("basic-step-kick-0").click();
  await expect(page.getByTestId("basic-undo")).toBeDisabled();
});

test("repeated song sections grow linearly and switching tutor never mutates the project", async ({ page }) => {
  await openBasic(page);
  const count = (value: string) => JSON.parse(value).tracks.reduce((sum: number, track: { noteClips: unknown[]; audioClips: unknown[] }) => sum + track.noteClips.length + track.audioClips.length, 0);
  const originalCount = count(await projectSnapshot(page));
  await page.getByTestId("basic-repeat-song").click();
  expect(count(await projectSnapshot(page))).toBe(originalCount * 2);
  await page.getByTestId("basic-repeat-song").click();
  expect(count(await projectSnapshot(page))).toBe(originalCount * 3);
  const snapshot = await projectSnapshot(page);
  await page.getByRole("button", { name: "Learning tutor" }).click();
  await page.getByRole("button", { name: "Learning tutor" }).click();
  expect(await projectSnapshot(page)).toBe(snapshot);
});

test("Basic creation works on a phone without overflowing the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBasic(page);
  await page.getByRole("button", { name: "Turn tutor off" }).click();
  await page.getByTestId("basic-starter-beat").click();
  await page.getByTestId("basic-add-bass").click();
  await page.getByTestId("basic-add-melody").click();
  await page.getByTestId("basic-repeat-song").click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.getByTestId("basic-save").click();
  await expect(page.getByRole("status").filter({ hasText: "Project saved" }).first()).toBeVisible();
  await page.getByTestId("basic-export").click();
  await expect(page.getByRole("dialog", { name: "Export song" })).toBeVisible();
});

test("Basic real audio plays across mode changes and Stop/Panic release playback", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openBasic(page, true);
  await page.getByRole("button", { name: "Tap to Enable Audio", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => page.evaluate(async () => {
    const { audio } = await import("/src/lib/audio/engine.ts");
    return Math.max(...audio.getMasterLevels().peakDb);
  })).toBeGreaterThan(-80);
  await page.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Basic", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Panic — stop all sound" }).click();
  await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const { audio } = await import("/src/lib/audio/engine.ts");
    return Math.max(...audio.getMasterLevels().peakDb);
  })).toBeLessThan(-80);
  expect(errors).toEqual([]);
});
