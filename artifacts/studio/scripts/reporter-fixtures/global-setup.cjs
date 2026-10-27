const { appendFileSync } = require("node:fs");
const path = require("node:path");

module.exports = async () => {
  if (process.env.REPORTER_FIXTURE_SCENARIO === "delayed-setup") {
    await new Promise((resolve) => setTimeout(resolve, 16_000));
    appendFileSync(path.join(process.env.REPORTER_FIXTURE_DIR, "events"), "setup-finished\n");
    return;
  }
  if (process.env.REPORTER_FIXTURE_SCENARIO === "global-timeout") {
    await new Promise(() => {});
    return;
  }
  throw new Error("deterministic global setup failure");
};
