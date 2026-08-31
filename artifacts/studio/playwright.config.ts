import { defineConfig, devices } from "@playwright/test";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { platform } from "os";

const chromiumExecutablePath = (() => {
  const envPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (envPath) return envPath;
  try {
    const command = platform() === "win32" ? "where chromium" : "which chromium";
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/)[0]
      ?.trim() ?? "";
  } catch {
    return "";
  }
})();

const requestedPort = Number.parseInt(process.env.STUDIO_TEST_PORT ?? "5174", 10);
const TEST_PORT = Number.isFinite(requestedPort) ? requestedPort : 5174;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const REUSE_EXISTING_SERVER = process.env.STUDIO_TEST_REUSE_SERVER === "1";
const viteCli = fileURLToPath(new URL("./node_modules/vite/bin/vite.js", import.meta.url));

function quoteArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

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
          ...(chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {}),
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
    command: [
      quoteArg(process.execPath),
      quoteArg(viteCli),
      "--config",
      "vite.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(TEST_PORT),
      "--strictPort",
    ].join(" "),
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: REUSE_EXISTING_SERVER,
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
