import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import config from "./playwright.config";

const port = Number(process.env.STUDIO_TEST_PORT ?? "5175");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("STUDIO_TEST_PORT must be an integer between 1 and 65535");
}
const viteCli = fileURLToPath(new URL("./node_modules/vite/bin/vite.js", import.meta.url));

export default defineConfig({
  ...config,
  testMatch: ["static-release.spec.ts", "release-select-startup.spec.ts", "basic-production.spec.ts"],
  outputDir: "test-results-production",
  reporter: [
    ["./scripts/playwright-exit-reporter.cjs"],
    ["html", { open: "never", outputFolder: "playwright-report/release" }],
  ],
  use: { ...config.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `"${process.execPath}" "${viteCli}" preview --config vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    timeout: 30_000,
    reuseExistingServer: false,
    env: { PORT: String(port), BASE_PATH: "/", REPL_ID: "", NODE_ENV: "production" },
  },
});
