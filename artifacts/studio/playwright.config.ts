import { defineConfig, devices } from "@playwright/test";
import { execSync } from "child_process";

const chromiumExecutablePath = (() => {
  const envPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (envPath) return envPath;
  try {
    return execSync("which chromium", { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
})();

const TEST_PORT = 5174;
const BASE_URL = `http://localhost:${TEST_PORT}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath: chromiumExecutablePath,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-web-security",
            "--enable-unsafe-swiftshader",
          ],
        },
      },
    },
  ],

  webServer: {
    command: `PORT=${TEST_PORT} BASE_PATH=/ pnpm --filter @workspace/studio dev`,
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: String(TEST_PORT),
      BASE_PATH: "/",
      // Suppress Replit-specific dev-banner and cartographer overlays so
      // they don't intercept pointer events during headless test runs.
      REPL_ID: "",
      NODE_ENV: "test",
    },
  },
});
