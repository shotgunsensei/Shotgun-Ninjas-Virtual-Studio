const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, existsSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const vm = require("node:vm");
const test = require("node:test");
const { EventEmitter } = require("node:events");

const cli = require.resolve("@playwright/test/cli");
const config = path.join(__dirname, "reporter-fixtures/playwright.config.cjs");
const source = readFileSync(path.join(__dirname, "playwright-exit-reporter.cjs"), "utf8");

function observeFixture(child, directory) {
  let outcome;
  let childError;
  let stdout = "";
  let stderr = "";
  let complete;
  const exited = new Promise((resolve) => { complete = resolve; });
  const onStdout = (data) => { stdout = (stdout + String(data)).slice(-4_000); };
  const onStderr = (data) => { stderr = (stderr + String(data)).slice(-4_000); };
  const onExit = (code, signal) => { outcome = { code, signal }; complete(outcome); };
  const onClose = (code, signal) => { outcome = { code, signal }; complete(outcome); };
  const onError = (error) => { childError = error; complete({ error }); };
  child.stdout?.on("data", onStdout);
  child.stderr?.on("data", onStderr);
  child.once("exit", onExit);
  child.once("close", onClose);
  child.once("error", onError);

  const diagnostics = () => `stdout:\n${stdout}\nstderr:\n${stderr}`;
  return {
    exited,
    async ready(timeout = 35_000) {
      // The fixture has a 30s global runner budget. Allow its launch to finish,
      // but reject a dead/failed child immediately rather than waiting blindly.
      const deadline = Date.now() + timeout;
      const eventsPath = path.join(directory, "events");
      while (true) {
        if (childError) throw new Error(`Fixture failed to start: ${childError.message}\n${diagnostics()}`);
        if (outcome) {
          throw new Error(`Fixture exited before readiness (code ${outcome.code}, signal ${outcome.signal})\n${diagnostics()}`);
        }
        if (existsSync(eventsPath) && readFileSync(eventsPath, "utf8").split("\n").includes("interrupt-ready")) return;
        if (Date.now() >= deadline) throw new Error(`Fixture did not become ready within ${timeout}ms\n${diagnostics()}`);
        await Promise.race([delay(25), exited]);
      }
    },
    dispose() {
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("exit", onExit);
      child.off("close", onClose);
      child.off("error", onError);
      child.stdout?.destroy?.();
      child.stderr?.destroy?.();
    },
  };
}

function fixture(scenario, extraArgs = []) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "studio-reporter-"));
  try {
    const result = spawnSync(process.execPath, [cli, "test", "-c", config, ...extraArgs], {
      env: { ...process.env, REPORTER_FIXTURE_DIR: directory, REPORTER_FIXTURE_SCENARIO: scenario },
      encoding: "utf8", timeout: 45_000,
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

test("bounded startup tolerates a cold setup without truncating retries or teardown", () => {
  const result = fixture("delayed-setup");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(result.events, ["setup-finished", "attempt:0", "attempt:1", "later-finished", "teardown-finished"]);
  assert.equal(result.report.stats.flaky, 1);
  assert.equal(result.report.stats.expected, 1);
});

test("global timeouts remain nonzero and produce diagnostic reports", () => {
  const result = fixture("global-timeout");
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /status: timedout/);
  assert.match(JSON.stringify(result.report.errors), /Timed out/i);
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
    stdio: ["ignore", "pipe", "pipe"],
  });
  const observed = observeFixture(child, directory);
  try {
    const eventsPath = path.join(directory, "events");
    await observed.ready();
    assert.equal(child.kill("SIGINT"), true, "ready fixture must accept SIGINT");
    const result = await observed.exited;
    assert.ifError(result.error);
    assert.equal(result.code, 130);
    assert.equal(result.signal, null);
    assert.match(readFileSync(eventsPath, "utf8"), /teardown-finished/);
    assert.ok(existsSync(path.join(directory, "report.json")));
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await observed.exited;
    observed.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});

function syntheticFixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "studio-reporter-ready-"));
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const observed = observeFixture(child, directory);
  return {
    child, observed,
    markReady() { require("node:fs").writeFileSync(path.join(directory, "events"), "interrupt-ready\n"); },
    close(code = 0, signal = null) { child.emit("exit", code, signal); child.emit("close", code, signal); },
    dispose() { observed.dispose(); rmSync(directory, { recursive: true, force: true }); },
  };
}

test("readiness waits for the actual fixture marker", async () => {
  const fixture = syntheticFixture();
  try {
    let ready = false;
    const pending = fixture.observed.ready(500).then(() => { ready = true; });
    await Promise.resolve();
    assert.equal(ready, false);
    fixture.markReady();
    await pending;
    assert.equal(ready, true);
  } finally { fixture.close(); fixture.dispose(); }
});

test("readiness rejects early child exit with captured diagnostics", async () => {
  const fixture = syntheticFixture();
  try {
    const pending = fixture.observed.ready(500);
    fixture.child.stderr.emit("data", "synthetic fixture startup failure");
    fixture.close(1);
    await assert.rejects(pending, /exited before readiness.*code 1[\s\S]*synthetic fixture startup failure/);
    assert.deepEqual(await fixture.observed.exited, { code: 1, signal: null });
  } finally { fixture.dispose(); }
});

test("readiness settles child exit before inherited pipes close", async () => {
  const fixture = syntheticFixture();
  try {
    fixture.child.emit("exit", 1, null);
    const result = await Promise.race([
      fixture.observed.exited,
      delay(100).then(() => undefined),
    ]);
    assert.deepEqual(result, { code: 1, signal: null }, "child exit must not wait for pipe close");
    await assert.rejects(fixture.observed.ready(500), /exited before readiness/);
  } finally { fixture.close(1); fixture.dispose(); }
});

test("readiness rejects child spawn errors without an unhandled rejection", async () => {
  const fixture = syntheticFixture();
  try {
    const pending = fixture.observed.ready(500);
    const error = new Error("synthetic spawn error");
    fixture.child.emit("error", error);
    await assert.rejects(pending, /failed to start: synthetic spawn error/);
    assert.equal((await fixture.observed.exited).error, error);
  } finally { fixture.dispose(); }
});

test("readiness rejects a dead fixture even if its marker exists", async () => {
  const fixture = syntheticFixture();
  try {
    fixture.markReady();
    fixture.close(1);
    await assert.rejects(fixture.observed.ready(500), /exited before readiness/);
  } finally { fixture.dispose(); }
});

test("readiness times out a live child and retains bounded output", async () => {
  const fixture = syntheticFixture();
  try {
    fixture.child.stdout.emit("data", "discarded-prefix" + "x".repeat(4_001) + "retained-tail");
    await assert.rejects(fixture.observed.ready(25), (error) => {
      assert.match(error.message, /did not become ready/);
      assert.match(error.message, /retained-tail/);
      assert.doesNotMatch(error.message, /discarded-prefix/);
      return true;
    });
  } finally { fixture.close(); fixture.dispose(); }
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
