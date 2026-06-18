class StudioExitReporter {
  onBegin(_config, suite) {
    this.total = suite.allTests().length;
    this.completed = 0;
    this.failed = false;
    console.log(`Running ${this.total} tests using 1 worker`);
  }

  onTestEnd(test, result) {
    this.completed += 1;
    const title = test.titlePath().slice(1).join(" > ");
    const status = result.status === "passed" ? "ok" : result.status;
    console.log(`${status} ${title} (${result.duration}ms)`);
    if (result.error) {
      this.failed = true;
      console.error(result.error.stack || result.error.message || String(result.error));
    }
    if (this.completed >= this.total) {
      const exitCode = this.failed || result.status !== "passed" ? 1 : 0;
      setTimeout(() => {
        console.log(`Playwright completed ${this.completed}/${this.total} tests; forcing clean Windows exit.`);
        process.exit(exitCode);
      }, 100);
    }
  }

  async onEnd(result) {
    const status = result.status;
    console.log(`Playwright finished with status: ${status}`);
    setTimeout(() => {
      process.exit(status === "passed" ? 0 : 1);
    }, 25);
  }
}

module.exports = StudioExitReporter;
