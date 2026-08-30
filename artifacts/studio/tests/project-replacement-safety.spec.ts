import { expect, test } from "@playwright/test";

test("New durably preserves the latest project before replacement", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("studio.onboardingShown", "1");
  });
  await page.goto("/studio?disableAudio=1", { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor({ state: "visible", timeout: 15_000 });

  const savedName = `Replacement safety ${Date.now()}`;
  await page.getByTestId("project-name-input").fill(savedName);
  await page.getByTestId("project-menu").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("menuitem", { name: "New project" }).click();
  await expect(page.getByTestId("project-name-input")).not.toHaveValue(savedName, {
    timeout: 15_000,
  });

  await page.getByTestId("open-load-dialog").click();
  await expect(page.getByText(savedName, { exact: true })).toBeVisible();
});

test("opening the current project reloads its newest in-memory edits", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("studio.onboardingShown", "1");
  });
  await page.goto("/studio?disableAudio=1", { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor({ state: "visible", timeout: 15_000 });

  const savedName = `Same project baseline ${Date.now()}`;
  const latestName = `Same project latest ${Date.now()}`;
  await page.getByTestId("project-name-input").fill(savedName);
  await page.getByRole("button", { name: "Save project" }).click();
  await page.getByTestId("project-name-input").fill(latestName);

  await page.getByTestId("open-load-dialog").click();
  const savedProjectRow = page.getByText(savedName, { exact: true }).locator("../..");
  await savedProjectRow.getByRole("button", { name: "Open" }).click();

  await expect(page.getByTestId("project-name-input")).toHaveValue(latestName, {
    timeout: 15_000,
  });
});

test("New keeps an edited transient demo available for recovery", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("studio.onboardingShown", "1");
  });
  await page.goto("/studio?disableAudio=1", { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor({ state: "visible", timeout: 15_000 });

  await page.getByTestId("open-load-dialog").click();
  await page.getByTestId("demo-load-trap-starter").click();
  await expect(page.getByTestId("project-name-input")).toHaveValue("Trap Starter");
  const transientName = `Transient recovery ${Date.now()}`;
  await page.getByTestId("project-name-input").fill(transientName);

  await page.getByTestId("project-menu").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("menuitem", { name: "New project" }).click();
  await expect(page.getByTestId("project-name-input")).not.toHaveValue(transientName, {
    timeout: 15_000,
  });

  await page.getByTestId("open-load-dialog").click();
  await expect(page.getByTestId("recover-unsaved")).toBeEnabled();
  await page.getByTestId("recover-unsaved").click();
  await expect(page.getByTestId("project-name-input")).toHaveValue(transientName);
});

test("World Picker preserves an edited demo before loading another demo", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("studio.onboardingShown", "1");
  });
  await page.goto("/studio?disableAudio=1", { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor({ state: "visible", timeout: 15_000 });

  await page.getByTestId("open-load-dialog").click();
  await page.getByTestId("demo-load-trap-starter").click();
  await expect(page.getByTestId("project-name-input")).toHaveValue("Trap Starter");
  const transientName = `World recovery ${Date.now()}`;
  await page.getByTestId("project-name-input").fill(transientName);

  await page.getByRole("button", { name: "Open Studio World picker" }).click();
  await page.getByRole("button", { name: "Load demo" }).first().click();
  await expect(page.getByTestId("project-name-input")).toHaveValue("Cyber Ninja Theme");

  await page.getByTestId("open-load-dialog").click();
  await expect(page.getByTestId("recover-unsaved")).toBeEnabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("recover-unsaved").click();
  await expect(page.getByTestId("project-name-input")).toHaveValue(transientName);
});

test("Restore Last Session reloads the just-preserved current revision", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("studio.onboardingShown", "1");
  });
  await page.goto("/studio?disableAudio=1", { waitUntil: "domcontentloaded" });
  await page.locator("header").waitFor({ state: "visible", timeout: 15_000 });

  const savedName = `Restore baseline ${Date.now()}`;
  const latestName = `Restore latest ${Date.now()}`;
  await page.getByTestId("project-name-input").fill(savedName);
  await page.getByRole("button", { name: "Save project" }).click();
  await expect(page.getByText("Project saved", { exact: true })).toBeVisible();
  await page.getByTestId("project-name-input").fill(latestName);

  await page.getByTestId("open-load-dialog").click();
  await page.getByTestId("restore-last-session").click();
  await expect(page.getByTestId("project-name-input")).toHaveValue(latestName);

  const durableName = await page.evaluate(async () => {
    const { getLastProjectId, loadProject } = await import("/src/lib/storage/db.ts");
    const id = await getLastProjectId();
    return id ? (await loadProject(id))?.name ?? null : null;
  });
  expect(durableName).toBe(latestName);
});
