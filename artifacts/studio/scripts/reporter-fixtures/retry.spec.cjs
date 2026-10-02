const { appendFileSync } = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const scenario = process.env.REPORTER_FIXTURE_SCENARIO;
const record = (event) => appendFileSync(path.join(process.env.REPORTER_FIXTURE_DIR, "events"), `${event}\n`);

test("retry outcome", async ({}, testInfo) => {
  record(`attempt:${testInfo.retry}`);
  if (scenario === "interrupted") {
    record("interrupt-ready");
    await new Promise(() => {});
  }
  if (scenario === "expected") test.fail();
  expect(scenario !== "exhausted" && scenario !== "expected" && testInfo.retry > 0).toBe(true);
});

test("later test must finish", async () => {
  // Exceeds the old reporter's 100ms attempt-count exit timer.
  await new Promise((resolve) => setTimeout(resolve, 300));
  record("later-finished");
});
