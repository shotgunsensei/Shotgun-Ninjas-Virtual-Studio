/**
 * Built-in plugin registration.
 *
 * Wraps every existing melodic preset and drum kit in a PluginManifest
 * and registers them as "instrument" plugins.  Wraps every FxModuleId
 * as an "effect" plugin.
 *
 * This module must be imported (and `registerBuiltins()` called) once
 * during app bootstrap, before the audio engine starts processing tracks.
 * The existing engine code is NOT changed — the registry is purely a
 * metadata/capability layer on top.
 */

import { pluginRegistry } from "./registry";
import type { PluginManifest, PluginParameterDescriptor } from "./types";
import { MELODIC_PRESETS } from "../audio/sounds/presets";
import { DRUM_KIT_LIST } from "../audio/sounds/kits";

// ─── Instrument plugins ───────────────────────────────────────────────────────

/**
 * Map each melodic preset def to an instrument plugin manifest.
 * The factory is a lightweight shim — actual voice creation happens
 * inside the engine (buildPresetVoice / ensureTrack).  The manifest
 * lets the plugin browser discover and describe the preset.
 */
function makeMelodicInstrumentManifest(presetId: string): PluginManifest {
  const def = MELODIC_PRESETS.find((p) => p.id === presetId)!;
  const parameters: PluginParameterDescriptor[] = [
    {
      id: "attack",
      label: "Attack",
      min: 0,
      max: 1,
      defaultValue: def.synth.attack,
      automatable: true,
      unit: "s",
    },
    {
      id: "decay",
      label: "Decay",
      min: 0,
      max: 1,
      defaultValue: def.synth.decay,
      automatable: true,
      unit: "s",
    },
    {
      id: "sustain",
      label: "Sustain",
      min: 0,
      max: 1,
      defaultValue: def.synth.sustain,
      automatable: true,
    },
    {
      id: "release",
      label: "Release",
      min: 0,
      max: 1,
      defaultValue: def.synth.release,
      automatable: true,
      unit: "s",
    },
    {
      id: "cutoff",
      label: "Cutoff",
      min: 0,
      max: 1,
      defaultValue: def.synth.cutoff,
      automatable: true,
    },
    {
      id: "reverbSend",
      label: "Reverb Send",
      min: 0,
      max: 1,
      defaultValue: def.synth.reverbSend,
      automatable: true,
    },
    {
      id: "delaySend",
      label: "Delay Send",
      min: 0,
      max: 1,
      defaultValue: def.synth.delaySend,
      automatable: true,
    },
  ];

  return {
    id: `instrument.melodic.${presetId}`,
    kind: "instrument",
    name: def.name,
    version: "1.0.0",
    category: def.category,
    description: def.description,
    parameters,
    factory: () => ({ presetId }),
  };
}

/**
 * Map each drum kit to an instrument plugin manifest.
 */
function makeDrumKitInstrumentManifest(kitId: string): PluginManifest {
  const def = DRUM_KIT_LIST.find((k) => k.id === kitId)!;
  return {
    id: `instrument.drumkit.${kitId}`,
    kind: "instrument",
    name: def.name,
    version: "1.0.0",
    category: "Drum Kits",
    description: def.description,
    parameters: [],
    factory: () => ({ kitId }),
  };
}

// ─── Effect plugins ───────────────────────────────────────────────────────────

interface EffectPluginDef {
  id: string;
  name: string;
  description: string;
  parameters: PluginParameterDescriptor[];
}

const EFFECT_DEFS: EffectPluginDef[] = [
  {
    id: "effect.eq",
    name: "EQ / Filter",
    description: "3-band EQ with high-pass filter and tilt control.",
    parameters: [
      { id: "low", label: "Low Gain", min: 0, max: 1, defaultValue: 0.5, automatable: true, unit: "dB" },
      { id: "mid", label: "Mid Gain", min: 0, max: 1, defaultValue: 0.5, automatable: true, unit: "dB" },
      { id: "high", label: "High Gain", min: 0, max: 1, defaultValue: 0.5, automatable: true, unit: "dB" },
    ],
  },
  {
    id: "effect.compressor",
    name: "Compressor",
    description: "Dynamic range compressor with threshold, ratio, attack and release.",
    parameters: [
      { id: "amount", label: "Amount", min: 0, max: 1, defaultValue: 0.5, automatable: true },
      { id: "threshold", label: "Threshold", min: 0, max: 1, defaultValue: 0.5, automatable: true, unit: "dB" },
      { id: "ratio", label: "Ratio", min: 0, max: 1, defaultValue: 0.5, automatable: true },
    ],
  },
  {
    id: "effect.saturation",
    name: "Saturation",
    description: "Tape/tube/fuzz saturation — adds harmonic warmth and grit.",
    parameters: [
      { id: "amount", label: "Drive", min: 0, max: 1, defaultValue: 0.5, automatable: true },
    ],
  },
  {
    id: "effect.delay",
    name: "Delay",
    description: "Feedback delay line with tempo-synced time options.",
    parameters: [
      { id: "amount", label: "Wet", min: 0, max: 1, defaultValue: 0.35, automatable: true },
    ],
  },
  {
    id: "effect.reverb",
    name: "Reverb",
    description: "Algorithmic reverb from tight room to cathedral.",
    parameters: [
      { id: "amount", label: "Wet", min: 0, max: 1, defaultValue: 0.3, automatable: true },
    ],
  },
  {
    id: "effect.chorus",
    name: "Chorus",
    description: "Modulation chorus — subtle widening to swirling depth.",
    parameters: [
      { id: "amount", label: "Depth", min: 0, max: 1, defaultValue: 0.4, automatable: true },
    ],
  },
  {
    id: "effect.bitcrusher",
    name: "Bitcrusher",
    description: "Lo-fi bit depth reduction from 12-bit vinyl to 4-bit crunch.",
    parameters: [
      { id: "amount", label: "Crush", min: 0, max: 1, defaultValue: 0.5, automatable: true },
      { id: "bits", label: "Bit Depth", min: 0, max: 1, defaultValue: 0.35, automatable: true },
    ],
  },
  {
    id: "effect.stereoWidth",
    name: "Stereo Width",
    description: "Stereo image control from mono to hyper-wide.",
    parameters: [
      { id: "amount", label: "Width", min: 0, max: 1, defaultValue: 0.5, automatable: true },
    ],
  },
];

function makeEffectManifest(def: EffectPluginDef): PluginManifest {
  return {
    id: def.id,
    kind: "effect",
    name: def.name,
    version: "1.0.0",
    category: "Effects",
    description: def.description,
    parameters: def.parameters,
    factory: () => ({ effectId: def.id }),
  };
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

let registered = false;

/**
 * Register all built-in instrument and effect plugins.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function registerBuiltins(): void {
  if (registered) return;
  registered = true;

  // Melodic instrument presets
  for (const preset of MELODIC_PRESETS) {
    pluginRegistry.register(makeMelodicInstrumentManifest(preset.id));
  }

  // Drum kits
  for (const kit of DRUM_KIT_LIST) {
    pluginRegistry.register(makeDrumKitInstrumentManifest(kit.id));
  }

  // Built-in effects
  for (const def of EFFECT_DEFS) {
    pluginRegistry.register(makeEffectManifest(def));
  }

  if (import.meta.env?.DEV ?? false) {
    console.log(
      `[PluginRegistry] Registered ${pluginRegistry.size} built-in plugins.`,
    );
  }
}

/**
 * Map from the internal FxModuleId to our plugin id.
 * Convenience for components that already work with FxModuleId.
 */
export const FX_MODULE_TO_PLUGIN_ID: Record<string, string> = {
  eq: "effect.eq",
  compressor: "effect.compressor",
  saturation: "effect.saturation",
  delay: "effect.delay",
  reverb: "effect.reverb",
  chorus: "effect.chorus",
  bitcrusher: "effect.bitcrusher",
  stereoWidth: "effect.stereoWidth",
};

/** Reverse map: plugin id → FxModuleId */
export const PLUGIN_ID_TO_FX_MODULE: Record<string, string> = Object.fromEntries(
  Object.entries(FX_MODULE_TO_PLUGIN_ID).map(([k, v]) => [v, k]),
);
