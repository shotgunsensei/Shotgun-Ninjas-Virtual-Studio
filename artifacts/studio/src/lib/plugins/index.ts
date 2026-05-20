/**
 * Plugin system public API.
 * Import from here rather than from individual sub-modules.
 */

export { pluginRegistry } from "./registry";
export type { PluginKind, PluginStatus, PluginManifest, PluginParameterDescriptor, TrackPluginState, AutomationAddress } from "./types";
export { buildAutoAddress, parseAutoAddress } from "./types";
export { registerBuiltins, FX_MODULE_TO_PLUGIN_ID, PLUGIN_ID_TO_FX_MODULE } from "./builtins";
export { hostCreate, hostDispose, shouldBypassPlugin } from "./host";
export {
  registerAutomationTarget,
  unregisterTrackAutomationTargets,
  applyAutomationValue,
  getAllAutomationAddresses,
  getPluginAutomationAddresses,
  wireTrackAutomationTargets,
  getAutomationLabel,
} from "./automation";

/**
 * One-shot bootstrap — call once at app startup (before the engine starts).
 * Registers all built-in instrument and effect plugins.
 */
export { registerBuiltins as initPluginSystem } from "./builtins";
