import type { MasterBusSettings } from "../../types";

/** Pure persisted defaults. Kept separate from the Tone.js graph so storage,
 * tests, and non-audio UI do not initialize the audio engine just to migrate
 * project data. */
export const DEFAULT_MASTER_BUS: MasterBusSettings = {
  limiterThresholdDb: -0.6,
  limiterGainDb: 0,
  glueEnabled: true,
  glueThresholdDb: -14,
  glueRatio: 2,
  glueAttack: 0.025,
  glueRelease: 0.18,
  softClip: false,
  width: 1,
  oversample: false,
};
