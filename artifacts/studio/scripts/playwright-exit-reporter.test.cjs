const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, existsSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const vm = require("node:vm");
const test = require("node:test");

const cli = require.resolve("@playwright/test/cli");
const config = path.join(__dirname, "reporter-fixtures/playwright.config.cjs");
const source = readFileSync(path.join(__dirname, "playwright-exit-reporter.cjs"), "utf8");

function fixture(scenario, extraArgs = []) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "studio-reporter-"));
  try {
    const result = spawnSync(process.execPath, [cli, "test", "-c", config, ...extraArgs], {
      env: { ...process.env, REPORTER_FIXTURE_DIR: directory, REPORTER_FIXTURE_SCENARIO: scenario },
      encoding: "utf8", timeout: 25_000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    const events = existsSync(path.join(directory, "events"))
      ? readFileSync(path.join(directory, "events"), "utf8").trim().split("\n") : [];
    const report = JSON.parse(readFileSync(path.join(directory, "report.json"), "utf8"));
    return { ...result, events, report };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("fail once, pass on retry: later tests, teardown, and reports finish", () => {
  const result = fixture("retry");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(result.events, ["attempt:0", "attempt:1", "later-finished", "teardown-finished"]);
  assert.equal(result.report.stats.flaky, 1);
  assert.equal(result.report.stats.expected, 1);
  assert.equal(result.report.stats.unexpected, 0);
});

test("exhausted retries stay nonzero and still finish later tests and teardown", () => {
  const result = fixture("exhausted");
  assert.equal(result.status, 1);
  assert.deepEqual(result.events, ["attempt:0", "attempt:1", "attempt:2", "later-finished", "teardown-finished"]);
  assert.equal(result.report.stats.unexpected, 1);
});

test("global setup failure stays nonzero and produces its report", () => {
  const result = fixture("global-error");
  assert.equal(result.status, 1);
  assert.match(JSON.stringify(result.report.errors), /deterministic global setup failure/);
});

test("expected failures follow Playwright's result policy", () => {
  const result = fixture("expected");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.report.stats.expected, 2);
});

test("fail-on-flaky policy stays nonzero after a recovered retry", () => {
  assert.equal(fixture("retry", ["--fail-on-flaky-tests"]).status, 1);
});

test("SIGINT interruption stays nonzero and completes teardown", { skip: process.platform === "win32" }, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "studio-reporter-interrupt-"));
  const child = spawn(process.execPath, [cli, "test", "-c", config], {
    env: { ...process.env, REPORTER_FIXTURE_DIR: directory, REPORTER_FIXTURE_SCENARIO: "interrupted" },
    stdio: "ignore",
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  try {
    const eventsPath = path.join(directory, "events");
    const deadline = Date.now() + 10_000;
    while (!existsSync(eventsPath) || !readFileSync(eventsPath, "utf8").includes("interrupt-ready")) {
      assert.ok(Date.now() < deadline, "fixture must begin before SIGINT");
      await delay(25);
    }
    child.kill("SIGINT");
    const result = await exited;
    assert.equal(result.code, 130);
    assert.equal(result.signal, null);
    assert.match(readFileSync(eventsPath, "utf8"), /teardown-finished/);
    assert.ok(existsSync(path.join(directory, "report.json")));
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    rmSync(directory, { recursive: true, force: true });
  }
});

function windowsReporter() {
  const timers = [];
  const exits = [];
  const runtime = { platform: "win32", exit: (code) => exits.push(code) };
  const context = {
    module: { exports: {} }, process: runtime,
    console: { log() {}, error() {} },
    setTimeout(callback, milliseconds) {
      const timer = { callback, milliseconds, unrefed: false, unref() { this.unrefed = true; } };
      timers.push(timer);
      return timer;
    },
  };
  vm.runInNewContext(source, context);
  return { reporter: new context.module.exports(), timers, exits, runtime };
}

test("Windows fallback waits for onExit, is unrefed, and preserves final failure statuses", () => {
  for (const status of ["passed", "failed", "timedout", "interrupted"]) {
    const { reporter, timers, exits } = windowsReporter();
    const fakeTest = { titlePath: () => ["root", "fixture"], outcome: () => "flaky" };
    reporter.onBegin({ workers: 1 }, { allTests: () => [fakeTest] });
    reporter.onTestEnd(fakeTest, { status: "failed", retry: 0, duration: 1, error: { message: "first attempt" } });
    reporter.onTestEnd(fakeTest, { status: "passed", retry: 1, duration: 1 });
    reporter.onEnd({ status });
    assert.equal(timers.length, 0, "no termination before teardown/reporting");
    reporter.onExit();
    assert.equal(timers.length, 1);
    assert.equal(timers[0].milliseconds, 5_000);
    assert.equal(timers[0].unrefed, true);
    timers[0].callback();
    assert.deepEqual(exits, [status === "passed" ? 0 : 1]);
  }
});

test("Windows fallback preserves global errors and a stricter runner exit code", () => {
  for (const useGlobalError of [false, true]) {
    const { reporter, timers, exits, runtime } = windowsReporter();
    if (useGlobalError) reporter.onError({ message: "global failure" });
    else runtime.exitCode = 130;
    reporter.onEnd({ status: "passed" });
    reporter.onExit();
    timers[0].callback();
    assert.deepEqual(exits, [useGlobalError ? 1 : 130]);
  }
});
