import { expect, test } from "@playwright/test";

test.skip(process.env.STUDIO_PRODUCTION_TEST !== "1", "Built static release verification");

for (const route of ["/", "/studio"]) {
  test(`built static ${route} loads directly and after reload without runtime or asset errors`, async ({ page }) => {
    const errors: string[] = [];
    const scripts: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("requestfailed", (request) => errors.push(`Request failed: ${request.url()}`));
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
    });
    page.on("request", (request) => {
      const url = new URL(request.url());
      // Tone creates AudioWorklets from in-memory blob URLs. Assert that
      // network-loaded scripts come from built assets, while retaining audio.
      if (request.resourceType() === "script" && ["http:", "https:"].includes(url.protocol)) {
        scripts.push(url.pathname);
      }
    });
    const response = await page.goto(route, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    if (route === "/studio") {
      await expect(page.getByTestId("onboarding-version-beginner")).toBeVisible();
      await page.getByTestId("starting-mode-blank-project").click();
      await page.getByRole("button", { name: /let.?s go/i }).click();
      await expect(page.getByTestId("basic-studio")).toBeVisible();
      await expect(page.getByTestId("project-name-input")).toBeEditable();
    } else {
      await expect(page.getByRole("button", { name: /launch studio/i }).first()).toBeVisible();
    }
    const reloaded = await page.reload({ waitUntil: "networkidle" });
    expect(reloaded?.status()).toBe(200);
    if (route === "/studio") await expect(page.getByTestId("basic-studio")).toBeVisible();
    else await expect(page.getByRole("button", { name: /launch studio/i }).first()).toBeVisible();
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.every((url) => url.startsWith("/assets/")), scripts.join("\n")).toBe(true);
    expect(errors).toEqual([]);
  });
}
