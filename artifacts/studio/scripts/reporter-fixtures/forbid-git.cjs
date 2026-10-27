// Test-only port: metadata capture must never spawn Git in synthetic fixtures.
const childProcess = require("node:child_process");
const { appendFileSync } = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const path = require("node:path");

for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync"]) {
  const original = childProcess[name];
  childProcess[name] = function (command, ...args) {
    const executable = path.basename(String(command)).toLowerCase();
    if (["git", "git.exe"].includes(executable) || /^git\s/.test(String(command))) {
      appendFileSync(path.join(process.env.REPORTER_FIXTURE_DIR, "git-calls"), `${name}\n`);
      throw new Error("Synthetic reporter fixture must not invoke Git");
    }
    return original.call(this, command, ...args);
  };
}
syncBuiltinESMExports();
