/** Small structural contract shared by Tone meters and native Web Audio meters. */
export interface LevelMeter {
  getValue(): number | number[] | Float32Array;
}
