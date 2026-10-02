class StudioExitReporter {
  constructor() {
    this.exitCode = 1;
    this.globalError = false;
  }

  onBegin(config, suite) {
    this.suite = suite;
    console.log(`Running ${suite.allTests().length} tests using ${config.workers} worker(s)`);
  }

  onTestEnd(test, result) {
    const title = test.titlePath().slice(1).join(" > ");
    const status = result.status === "passed" ? "ok" : result.status;
    console.log(`${status} ${title} (attempt ${result.retry + 1}, ${result.duration}ms)`);
    if (result.error) {
      console.error(result.error.stack || result.error.message || String(result.error));
    }
  }

  onError(error) {
    this.globalError = true;
    console.error(error.stack || error.message || String(error));
  }

  onEnd(result) {
    // FullResult accounts for retries, expected failures, skips, interruption,
    // and global failures. A failed attempt alone is not a failed test run.
    this.exitCode = result.status === "passed" && !this.globalError ? 0 : 1;
    const outcomes = {};
    for (const test of this.suite?.allTests() ?? []) {
      const outcome = test.outcome();
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }
    console.log(`Playwright finished with status: ${result.status}; outcomes: ${JSON.stringify(outcomes)}`);
  }

  onExit() {
    if (process.platform !== "win32") return;
    // Arm only after runner teardown and report generation. Do not keep a
    // healthy process alive; give lingering Windows handles five seconds to
    // close, and preserve stricter runner policies (e.g. fail-on-flaky).
    setTimeout(() => {
      const exitCode = process.exitCode || this.exitCode;
      console.error(`Playwright Windows exit fallback after 5000ms (code ${exitCode}).`);
      process.exit(exitCode);
    }, 5_000).unref();
  }
}

module.exports = StudioExitReporter;
