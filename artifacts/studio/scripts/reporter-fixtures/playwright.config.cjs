const path = require("node:path");

module.exports = {
  testDir: __dirname,
  testMatch: "retry.spec.cjs",
  workers: 1,
  retries: 2,
  timeout: 10_000,
  globalTimeout: 15_000,
  outputDir: path.join(process.env.REPORTER_FIXTURE_DIR, "results"),
  globalSetup: process.env.REPORTER_FIXTURE_SCENARIO === "global-error"
    ? require.resolve("./global-setup.cjs") : undefined,
  globalTeardown: require.resolve("./global-teardown.cjs"),
  reporter: [
    [process.env.REPORTER_UNDER_TEST || require.resolve("../playwright-exit-reporter.cjs")],
    ["json", { outputFile: path.join(process.env.REPORTER_FIXTURE_DIR, "report.json") }],
  ],
};
