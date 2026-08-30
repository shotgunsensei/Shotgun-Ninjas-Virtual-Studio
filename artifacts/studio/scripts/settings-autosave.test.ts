import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_AUTOSAVE_INTERVAL_SEC,
  getSettings,
  isAutosaveActive,
  normalizeStoredSettings,
  resetSettings,
  setAutosaveEnabled,
  setAutosaveInterval,
} from "../src/lib/settings";

test("migrates the retired millisecond autosave setting to a safe cadence", () => {
  const source = {
    autosaveEnabled: true,
    autosaveIntervalMs: 1_500,
    themeId: "high-contrast",
  };

  const migrated = normalizeStoredSettings(source);

  assert.equal(migrated.autosaveEnabled, true);
  assert.equal(migrated.autosaveIntervalSec, 15);
  assert.equal(migrated.themeId, "high-contrast");
  assert.equal("autosaveIntervalMs" in migrated, false);
  assert.deepEqual(source, {
    autosaveEnabled: true,
    autosaveIntervalMs: 1_500,
    themeId: "high-contrast",
  });
});

test("preserves disabled settings from either legacy autosave control", () => {
  const legacyDisabled = normalizeStoredSettings({
    autosaveEnabled: false,
    autosaveIntervalMs: 5_000,
  });
  const headerDisabled = normalizeStoredSettings({
    autosaveEnabled: true,
    autosaveIntervalSec: 0,
    autosaveIntervalMs: 1_500,
  });

  assert.deepEqual(
    [legacyDisabled.autosaveEnabled, legacyDisabled.autosaveIntervalSec],
    [false, 0],
  );
  assert.deepEqual(
    [headerDisabled.autosaveEnabled, headerDisabled.autosaveIntervalSec],
    [false, 0],
  );
  assert.equal(isAutosaveActive(legacyDisabled), false);
  assert.equal(isAutosaveActive(headerDisabled), false);
});

test("keeps valid current cadences and repairs invalid stored values", () => {
  const current = normalizeStoredSettings({
    autosaveEnabled: true,
    autosaveIntervalSec: 60,
  });
  const repaired = normalizeStoredSettings({
    autosaveEnabled: true,
    autosaveIntervalSec: 7,
    autosaveIntervalMs: "not-a-number",
  });

  assert.equal(current.autosaveIntervalSec, 60);
  assert.equal(isAutosaveActive(current), true);
  assert.equal(repaired.autosaveIntervalSec, DEFAULT_AUTOSAVE_INTERVAL_SEC);
  assert.equal(isAutosaveActive(repaired), true);
});

test("autosave setters keep the enabled flag and cadence coherent", () => {
  resetSettings();
  setAutosaveInterval(0);
  assert.equal(getSettings().autosaveEnabled, false);
  assert.equal(getSettings().autosaveIntervalSec, 0);
  assert.equal(isAutosaveActive(getSettings()), false);

  setAutosaveEnabled(true);
  assert.equal(getSettings().autosaveEnabled, true);
  assert.equal(getSettings().autosaveIntervalSec, DEFAULT_AUTOSAVE_INTERVAL_SEC);

  setAutosaveInterval(60);
  assert.equal(getSettings().autosaveEnabled, true);
  assert.equal(getSettings().autosaveIntervalSec, 60);
  assert.equal(isAutosaveActive(getSettings()), true);

  setAutosaveEnabled(false);
  assert.equal(getSettings().autosaveEnabled, false);
  assert.equal(getSettings().autosaveIntervalSec, 0);
  resetSettings();
});

test("the runtime gates queued, periodic, and lifecycle saves through the shared policy", async () => {
  const appSource = await readFile(
    new URL("../src/App.tsx", import.meta.url),
    "utf8",
  );
  const policyChecks = appSource.match(
    /if \(!isAutosaveActive\(getSettings\(\)\)\)/g,
  );

  // queueDraftSave, the queued callback, the periodic callback, and the
  // pagehide/visibility lifecycle flush must each re-check the live setting.
  assert.equal(policyChecks?.length, 4);
  assert.match(
    appSource,
    /if \(!autosaveEnabled \|\| autosaveSec === 0\) return;/,
  );
});
