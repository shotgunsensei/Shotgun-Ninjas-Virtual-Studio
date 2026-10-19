import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const hook = path.resolve(process.env.POST_MERGE_TEST_HOOK || path.join(root, "scripts/post-merge.sh"));

function existingShell() {
  if (process.platform !== "win32") return "/bin/sh";
  const candidates = [
    process.env.POST_MERGE_TEST_SH,
    path.join(process.env.ProgramFiles || "C:/Program Files", "Git/bin/sh.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)", "Git/bin/sh.exe"),
  ];
  const found = candidates.find((candidate) => candidate && existsSync(candidate));
  assert.ok(found, "An existing Git for Windows sh is required; this test installs nothing.");
  return found;
}

function runHook(installExit) {
  const tempRoot = path.resolve(os.tmpdir());
  const scratch = mkdtempSync(path.join(tempRoot, "post-merge-test-"));
  const log = path.join(scratch, "pnpm-args.log");
  try {
    const fakePnpm = [
      "#!/bin/sh",
      "separator=''",
      'for argument do',
      '  printf \'%s%s\' "$separator" "$argument" >> "$POST_MERGE_TEST_LOG"',
      "  separator='	'",
      "done",
      'printf \'\\n\' >> "$POST_MERGE_TEST_LOG"',
      'if [ "$#" -eq 2 ] && [ "$1" = install ] && [ "$2" = --frozen-lockfile ]; then',
      '  exit "$POST_MERGE_TEST_INSTALL_EXIT"',
      "fi",
      "exit 97",
      "",
    ].join("\n");
    writeFileSync(path.join(scratch, "pnpm"), fakePnpm, { mode: 0o755 });
    // Do not forward database/provider configuration. Only the fake binary is
    // discoverable on PATH; shell and printf are existing shell/builtin tools.
    const env = {};
    for (const key of ["SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    env.PATH = scratch;
    env.POST_MERGE_TEST_LOG = log.replaceAll("\\", "/");
    env.POST_MERGE_TEST_INSTALL_EXIT = String(installExit);
    const result = spawnSync(existingShell(), [hook.replaceAll("\\", "/")], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });
    if (result.error) throw result.error;
    const calls = existsSync(log)
      ? readFileSync(log, "utf8").trimEnd().split("\n").filter(Boolean).map((line) => line.split("\t"))
      : [];
    return { status: result.status, signal: result.signal, calls, stderr: result.stderr };
  } finally {
    // Delete only this test's resolved direct child of the system temp root.
    assert.equal(path.dirname(path.resolve(scratch)), tempRoot);
    assert.ok(path.basename(scratch).startsWith("post-merge-test-"));
    rmSync(scratch, { recursive: true, force: true });
  }
}

test("post-merge runs exactly one frozen install and no database command", () => {
  const result = runHook(0);
  assert.equal(result.status, 0, JSON.stringify(result));
  assert.deepEqual(result.calls, [["install", "--frozen-lockfile"]]);
});

test("post-merge propagates installation failure without further commands", () => {
  const result = runHook(23);
  assert.equal(result.status, 23, JSON.stringify(result));
  assert.deepEqual(result.calls, [["install", "--frozen-lockfile"]]);
});
