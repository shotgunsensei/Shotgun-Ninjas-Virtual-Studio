import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { studioBrowserOptions } from "./playwright-browser-options";

test("GitHub CI selects preinstalled Chrome and keeps the sandbox enabled", () => {
  const options = studioBrowserOptions(
    { CI: "true", GITHUB_ACTIONS: "true" },
    "/usr/bin/chromium",
  );
  assert.equal(options.channel, "chrome");
  assert.equal(options.launchOptions.chromiumSandbox, true);
  assert.equal("executablePath" in options.launchOptions, false);
  assert.deepEqual(options.launchOptions.args, ["--disable-dev-shm-usage"]);
});

test("local explicit or detected executables retain their original behavior", () => {
  for (const executablePath of ["C:/qa/chrome.exe", "/usr/bin/chromium"]) {
    const options = studioBrowserOptions({}, executablePath);
    assert.equal("channel" in options, false);
    assert.equal(options.launchOptions.executablePath, executablePath);
    assert.equal(options.launchOptions.chromiumSandbox, true);
  }
});

test("other CI providers do not assume the GitHub runner browser is installed", () => {
  const options = studioBrowserOptions({ CI: "true" }, "");
  assert.equal("channel" in options, false);
  assert.equal("executablePath" in options.launchOptions, false);
  assert.equal(options.launchOptions.chromiumSandbox, true);
});

test("both GitHub and CI markers are required", () => {
  for (const environment of [
    { GITHUB_ACTIONS: "true" },
    { CI: "false", GITHUB_ACTIONS: "true" },
    { CI: "true", GITHUB_ACTIONS: "false" },
  ]) {
    const options = studioBrowserOptions(environment, "/local/chromium");
    assert.equal("channel" in options, false);
    assert.equal(options.launchOptions.executablePath, "/local/chromium");
    assert.equal(options.launchOptions.chromiumSandbox, true);
  }
});

test("development and built-release configs share the guarded browser selection", () => {
  const config = readFileSync(
    new URL("../playwright.config.ts", import.meta.url),
    "utf8",
  );
  const release = readFileSync(
    new URL("../playwright.release.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    config,
    /\.\.\.studioBrowserOptions\(process\.env, chromiumExecutablePath\)/,
  );
  assert.match(release, /import config from "\.\/playwright\.config"/);
  assert.match(release, /\.\.\.config,/);
});

test("hosted browser preflight reads the installed package without acquiring one", () => {
  const workflow = readFileSync(
    new URL(
      "../../../.github/workflows/release-verification.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(workflow, /test -x \/opt\/google\/chrome\/chrome/);
  assert.match(workflow, /google-chrome --version/);
  assert.doesNotMatch(
    workflow,
    /playwright install|apt-get|--no-sandbox|sysctl|apparmor/,
  );
});
