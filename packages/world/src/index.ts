// @keel-engine/world: the world runtime -- systems on a fixed step, settings
// layers and locks, generation through settings, target rules, a headless
// frame() for the renderer, snapshots, record and replay. Names as in the
// proof of concept's src/world.

export { RENDER_BUDGET, RENDER_FX_NAMES, SYSTEM_ORDER, createWorld, tuningFor } from "./world.ts";
export type {
  Brain, ChoiceOptions, DriveFn, EntityIntent, EntityMake, EntitySnapshot, FitsOptions, Frame, FrameBox, FrameCapsule, FrameMaterial, FramePalette, FrameView,
  FreeBody, FxPass, FxPassEntry, Gen, GenPlaceOptions, Generator, GeneratorFn, Hold, PaletteFn, PlaceOptions, RenderBudget, RendererLike, Rest, SpawnOptions,
  SystemDef, SystemInfo, World, WorldBody, WorldConfig, WorldEntity, WorldEvent, WorldExplanation, WorldIntent, WorldListener, WorldMaterial, WorldObject,
  WorldOptions, WorldSnapshot,
} from "./world.ts";

export { GLOBAL_SCOPES, createSettings, formatLocks, isScope, parseLocks } from "./settings.ts";
export type { GlobalScope, LockText, Scope, Settings, SettingsJSON, SettingsOptions, Thing } from "./settings.ts";

export { isEntry, layers } from "./config.ts";
export type { Accepted, ChainLink, Config, Entry, Explanation, Layer, LayerValues, Raw, Refusal, SetOptions, SettingValue, WriteResult } from "./config.ts";

export { ENGINE_DEFAULTS } from "./defaults.ts";
export { RULE_KEYS, resolveRules, targetRules } from "./rules.ts";
export type { ResolvedRules, RuleName, TargetRules } from "./rules.ts";
export { namedStream, worldSeed } from "./streams.ts";
export type { NamedStream } from "./streams.ts";
