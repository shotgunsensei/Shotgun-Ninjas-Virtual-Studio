const path = require("node:path");

module.exports = {
  // Synthetic outcome tests need no commit/diff metadata or implicit git fetch.
  captureGitInfo: { commit: false, diff: false },
  testDir: __dirname,
  testMatch: "retry.spec.cjs",
  workers: 1,
  retries: 2,
  timeout: 10_000,
  globalTimeout: process.env.REPORTER_FIXTURE_SCENARIO === "global-timeout" ? 500 : 30_000,
  outputDir: path.join(process.env.REPORTER_FIXTURE_DIR, "results"),
  globalSetup: ["global-error", "delayed-setup", "global-timeout"].includes(process.env.REPORTER_FIXTURE_SCENARIO)
    ? require.resolve("./global-setup.cjs") : undefined,
  globalTeardown: require.resolve("./global-teardown.cjs"),
  reporter: [
    [process.env.REPORTER_UNDER_TEST || require.resolve("../playwright-exit-reporter.cjs")],
    ["json", { outputFile: path.join(process.env.REPORTER_FIXTURE_DIR, "report.json") }],
  ],
};
