import assert from "node:assert/strict";
import test from "node:test";
import { DRUM_KITS } from "../src/lib/audio/sounds/kits";
import {
  MELODIC_PRESETS,
  findPreset,
  presetSoundParams,
} from "../src/lib/audio/sounds/presets";
import { SOUND_PACKS } from "../src/lib/audio/sounds/soundLibrary";

function assertUnique(values: string[], label: string) {
  assert.equal(new Set(values).size, values.length, `${label} IDs must be unique`);
}

test("expanded offline sound catalog is unique and range-safe", () => {
  assert.ok(MELODIC_PRESETS.length >= 28);
  assertUnique(MELODIC_PRESETS.map((preset) => preset.id), "Preset");

  for (const preset of MELODIC_PRESETS) {
    assert.ok(preset.compatibleWith.length > 0, `${preset.id} needs a compatible track`);
    for (const [name, value] of Object.entries(presetSoundParams(preset))) {
      const max = name === "glide" ? 0.4 : name === "decay" || name === "release" ? 2 : 1;
      assert.ok(value >= 0 && value <= max, `${preset.id}.${name} is out of range`);
    }
    for (const layer of preset.layers ?? []) {
      assert.match(layer.url, /^\/samples\//, `${preset.id} must not fetch a third-party sample`);
    }
  }
});

test("sound packs reference working kits, presets, and 16-step patterns", () => {
  assert.ok(SOUND_PACKS.length >= 13);
  assertUnique(SOUND_PACKS.map((pack) => pack.id), "Sound pack");

  for (const pack of SOUND_PACKS) {
    assert.ok(DRUM_KITS[pack.kitId], `${pack.id} references a missing kit`);
    if (pack.presetId) {
      assert.ok(findPreset(pack.presetId), `${pack.id} references a missing preset`);
    }
    for (const grid of Object.values(pack.demoPattern)) {
      assert.equal(grid?.length, 16, `${pack.id} contains a non-16-step demo grid`);
    }
  }
});
