const { appendFileSync } = require("node:fs");
const path = require("node:path");
module.exports = async () => {
  await new Promise((resolve) => setTimeout(resolve, 150));
  appendFileSync(path.join(process.env.REPORTER_FIXTURE_DIR, "events"), "teardown-finished\n");
};
