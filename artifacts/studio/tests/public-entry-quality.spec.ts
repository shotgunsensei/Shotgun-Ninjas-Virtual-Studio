import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname) ||
      ["data:", "blob:", "about:"].includes(url.protocol)
      ? route.continue()
      : route.abort();
  });
});

test("the actual workspace preview is available to keyboard users", async ({
  page,
}) => {
  await page.goto("/");
  const preview = page.getByRole("button", {
    name: "Open the studio from the workspace preview",
  });
  await preview.focus();
  await expect(preview).toBeFocused();
  await expect
    .poll(() =>
      preview
        .locator("img")
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBe(1440);
  await preview.press("Enter");
  await expect(page).toHaveURL(/\/studio$/);
});

test("quick-start disclosure reports its state and controls all six steps", async ({
  page,
}) => {
  await page.goto("/");
  const button = page.getByRole("button", { name: /Get Started/ });
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.press("Enter");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#studio-tutorials button")).toHaveCount(6);
  await button.press("Enter");
  await expect(page.locator("#studio-tutorials")).toHaveCount(0);
});

test("public entry fits desktop and mobile while the font remains local", async ({
  page,
}) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Make Beats in Your Browser",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Array.from(document.fonts).some(
            (font) => font.family === "Inter" && font.status === "loaded",
          ),
        ),
      )
      .toBe(true);
    expect(
      await page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .some((resource) => resource.name.includes("fonts.googleapis.com")),
      ),
    ).toBe(false);
    const launch = page
      .getByRole("button", { name: "Launch Studio", exact: true })
      .first();
    expect((await launch.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test("feedback points to the existing contact page with isolated external navigation", async ({
  page,
}) => {
  await page.goto("/");
  const feedback = page.getByRole("link", { name: "Feedback", exact: true });
  await expect(feedback).toHaveAttribute(
    "href",
    "https://shotgunninjas.com/contact",
  );
  await expect(feedback).toHaveAttribute("rel", "noopener noreferrer");
});
