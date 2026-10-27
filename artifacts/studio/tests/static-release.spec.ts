import { expect, test } from "@playwright/test";

test.skip(
  process.env.STUDIO_PRODUCTION_TEST !== "1",
  "Built static release verification",
);

for (const route of ["/", "/studio"]) {
  test(`built static ${route} loads directly and after reload without runtime or asset errors`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const scripts: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("requestfailed", (request) =>
      errors.push(`Request failed: ${request.url()}`),
    );
    page.on("response", (response) => {
      if (response.status() >= 400)
        errors.push(`HTTP ${response.status()}: ${response.url()}`);
    });
    page.on("request", (request) => {
      const url = new URL(request.url());
      // Tone creates AudioWorklets from in-memory blob URLs. Assert that
      // network-loaded scripts come from built assets, while retaining audio.
      if (
        request.resourceType() === "script" &&
        ["http:", "https:"].includes(url.protocol)
      ) {
        scripts.push(url.pathname);
      }
    });
    const response = await page.goto(route, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    const viewport = page.locator('head meta[name="viewport"]');
    await expect(viewport).toHaveCount(1);
    const viewportContent = (await viewport.getAttribute("content")) ?? "";
    expect(viewportContent).toContain("width=device-width");
    expect(viewportContent).toMatch(/initial-scale=1(?:\.0)?(?:,|$)/);
    expect(viewportContent).not.toMatch(
      /maximum-scale|user-scalable\s*=\s*(?:no|0)/i,
    );
    if (route === "/studio") {
      await expect(
        page.getByTestId("onboarding-version-beginner"),
      ).toBeVisible();
      await page.getByTestId("starting-mode-blank-project").click();
      await page.getByRole("button", { name: /let.?s go/i }).click();
      await expect(page.getByTestId("basic-studio")).toBeVisible();
      await expect(page.getByTestId("project-name-input")).toBeEditable();
    } else {
      await expect(
        page.getByRole("button", { name: /launch studio/i }).first(),
      ).toBeVisible();
    }
    const reloaded = await page.reload({ waitUntil: "networkidle" });
    expect(reloaded?.status()).toBe(200);
    await expect(viewport).toHaveAttribute("content", viewportContent);
    if (route === "/studio")
      await expect(page.getByTestId("basic-studio")).toBeVisible();
    else
      await expect(
        page.getByRole("button", { name: /launch studio/i }).first(),
      ).toBeVisible();
    expect(scripts.length).toBeGreaterThan(0);
    expect(
      scripts.every((url) => url.startsWith("/assets/")),
      scripts.join("\n"),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("built mobile routes retain browser zoom and a device-width layout", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/", "/studio"]) {
    const response = await page.goto(`${route}?disableAudio=1`, {
      waitUntil: "networkidle",
    });
    expect(response?.status()).toBe(200);
    const viewport = page.locator('head meta[name="viewport"]');
    await expect(viewport).toHaveCount(1);
    const content = (await viewport.getAttribute("content")) ?? "";
    expect(content).toContain("width=device-width");
    expect(content).not.toMatch(/maximum-scale|user-scalable\s*=\s*(?:no|0)/i);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(391);
    await page.screenshot({
      path: testInfo.outputPath(
        route === "/" ? "mobile-landing.png" : "mobile-studio.png",
      ),
    });
  }
});

test("configured information routes load directly and unknown resources keep their 404", async ({
  request,
}) => {
  for (const route of [
    "/studio/",
    "/changelog",
    "/changelog/",
    "/credits",
    "/credits/",
    "/press",
    "/press/",
  ]) {
    const response = await request.get(`${route}?disableAudio=1`);
    expect(response.status(), route).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");
  }
  for (const route of [
    "/missing-page",
    "/assets/missing.js",
    "/src/main.tsx",
    "/api/healthz",
  ]) {
    expect((await request.get(route)).status(), route).toBe(404);
  }
});
