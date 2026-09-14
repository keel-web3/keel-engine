// @keel-engine/core: seeded streams, the frame convention, math (and the
// deterministic dmath), SDF primitives, OKLCH palettes, looks (per-role ramps, patterns, finishes),
// dither screens, the quantizer, and (optional) the GIF encoder. Names as in the proof of concept's src/core.

export { createRoll, deriveSeed, normalizeSeed, seedFromToken, stream } from "./rng.ts";
export type { Roll, Seed, Stream, SubStream, Weighted } from "./rng.ts";

export {
  FRONT, RIGHT, UP, cameraBasis, fromNocturnesYaw, frontOf, localToWorld, moveFromView, rightOf, toNocturnesYaw, worldToLocal, wrapAngle, yawOf, yawTo,
} from "./frame.ts";
export type { CameraBasis } from "./frame.ts";

// Deterministic math: simulation and generation call these, never Math's transcendentals (docs/CONVENTIONS.md).
export { DMATH, dacos, dasin, datan, datan2, dcbrt, dcos, dexp, dhypot, dlen, dlog, dlog10, dlog2, dpow, dscalbn, dsin, dtan } from "./dmath.ts";

export {
  TAU, add, clamp, cross, dot, fbm2, fract, hash2, hash3, len, loopFbm2, mix, norm, sat, scale, smooth, sub, tri, v3, vnoise2, wrapNoise2,
} from "./math.ts";
export type { Vec3, Vec3Like } from "./math.ts";

export { profile, sdBox, sdCapsule, sdCylinder, sdEllipsoid, sdHexPrism, sdLathe, sdPlanes, sdPolygon, sdSphere, sdTorus, smin } from "./sdf.ts";
export type { Profile } from "./sdf.ts";

export {
  RAMP_BUDGET, SCHEMES, SCHEME_NAMES, TABLE, TRANSPARENT, accentRamp, baseHue, buildPalette, cmax, hueCount, hueName, makePalette, oklch, ramp,
  rampBudget, rampForTarget, rampIndicesForTarget, wrap,
} from "./palette.ts";
export type { Harmony, Palette, PaletteForce, PaletteRamps, PaletteSlots, PaletteSpec, RGB, RampSlot, RampSpec, Scheme, SchemeName } from "./palette.ts";

export {
  FINISHES, LOOK_ROLES, PATTERNS, PATTERN_STEP, PROFILES, PROFILE_WEIGHTS, candidateLook, createLookPool, finishIndex, lookDistance, lookOf, lookSignature, patternIndex, rampColours,
  rampKey, roleIndex, roleLab,
} from "./look.ts";
export type { Finish, Look, LookOptions, LookPool, LookProfile, LookRole, LookRoles, Pattern, PatternLook, RoleLook, RoleSpecLike } from "./look.ts";

export {
  KIND_PAIRS, SCREENS, SCREEN_GEOM, SCREEN_IDS, SCREEN_KIND, SCREEN_MIN_BAND, SCREEN_PAIRS, TARGET_BANDS, TARGET_SCREENS, TARGET_STEPS,
  bandOf, measureScreen, screenForTarget, screenIndex, screenPair,
} from "./dither.ts";
export type {
  Band, LayerScreen, ScreenDef, ScreenDirection, ScreenFamily, ScreenGeometry, ScreenId, ScreenMeasure, ScreenPreference, TargetScreen, ThresholdMap,
} from "./dither.ts";

export { BAYER4Q, HALO_SCREEN, LAYER_KEYS, accentCode, createQuantizer, lumsOf, makeBuf, quantizerFor, rampsOf } from "./quantize.ts";
export type { AccentSample, LayerKey, Quantize, QuantizeInput, QuantizeRamps, QuantizerSpec, Region, ShadeBuf } from "./quantize.ts";

// (Optional: a GIF export. Its TRANSPARENT is the same 31 as the palette's, so it isn't re-exported under that name.)
export { PALETTE_SIZE, encodeGif, encodeGifSteps } from "./gif.ts";
export type { GifFrame, GifSpec } from "./gif.ts";
