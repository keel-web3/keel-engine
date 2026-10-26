// KEEL's typed-string constants and the r180 numbers they stand for (MIT, see
// packages/lit/NOTICE). r180 writes these as numeric constants (FrontSide = 0,
// RGBAFormat = 1023...); keel/lit writes them as strings, and every union here
// has a table from string to r180's number, so the renderer can map a value
// back to the GL enum r180 would have used (and a test can compare with r180).

export type { ColorSpace, CoordinateSystem } from "./math/types.ts";
import type { ColorSpace, CoordinateSystem } from "./math/types.ts";

type Table<T extends string> = Readonly<Record<T, number>>;

/** Which faces draw. r180: FrontSide 0, BackSide 1, DoubleSide 2. */
export type Side = "front" | "back" | "both";
export const SIDE: Table<Side> = Object.freeze({ front: 0, back: 1, both: 2 });

/** r180: NoBlending 0, NormalBlending 1, AdditiveBlending 2, SubtractiveBlending 3, MultiplyBlending 4, CustomBlending 5. */
export type Blending = "none" | "normal" | "add" | "subtract" | "multiply" | "custom";
export const BLENDING: Table<Blending> = Object.freeze({ none: 0, normal: 1, add: 2, subtract: 3, multiply: 4, custom: 5 });

/** r180: AddEquation 100, SubtractEquation 101, ReverseSubtractEquation 102, MinEquation 103, MaxEquation 104. */
export type BlendEquation = "add" | "subtract" | "reverse-subtract" | "min" | "max";
export const BLEND_EQUATION: Table<BlendEquation> = Object.freeze({ add: 100, subtract: 101, "reverse-subtract": 102, min: 103, max: 104 });

/** r180: ZeroFactor 200 ... OneMinusConstantAlphaFactor 214, in this order. */
export type BlendFactor =
  | "zero" | "one" | "src-color" | "one-minus-src-color" | "src-alpha" | "one-minus-src-alpha"
  | "dst-alpha" | "one-minus-dst-alpha" | "dst-color" | "one-minus-dst-color" | "src-alpha-saturate"
  | "constant-color" | "one-minus-constant-color" | "constant-alpha" | "one-minus-constant-alpha";
export const BLEND_FACTOR: Table<BlendFactor> = Object.freeze({
  zero: 200, one: 201, "src-color": 202, "one-minus-src-color": 203, "src-alpha": 204, "one-minus-src-alpha": 205,
  "dst-alpha": 206, "one-minus-dst-alpha": 207, "dst-color": 208, "one-minus-dst-color": 209, "src-alpha-saturate": 210,
  "constant-color": 211, "one-minus-constant-color": 212, "constant-alpha": 213, "one-minus-constant-alpha": 214,
});

/** A comparison: a material's depthFunc, stencilFunc, a depth texture's compareFunction. */
export type CompareFunction = "never" | "always" | "less" | "less-equal" | "equal" | "greater-equal" | "greater" | "not-equal";
/** Material.depthFunc. r180: NeverDepth 0, AlwaysDepth 1, LessDepth 2, LessEqualDepth 3, EqualDepth 4, GreaterEqualDepth 5, GreaterDepth 6, NotEqualDepth 7. */
export const DEPTH_FUNC: Table<CompareFunction> = Object.freeze({ never: 0, always: 1, less: 2, "less-equal": 3, equal: 4, "greater-equal": 5, greater: 6, "not-equal": 7 });
/** Material.stencilFunc and DepthTexture.compareFunction (r180's *StencilFunc and *Compare: the GL enums). r180: Never 512, Less 513, Equal 514, LessEqual 515, Greater 516, NotEqual 517, GreaterEqual 518, Always 519. */
export const COMPARE_FUNC: Table<CompareFunction> = Object.freeze({ never: 512, less: 513, equal: 514, "less-equal": 515, greater: 516, "not-equal": 517, "greater-equal": 518, always: 519 });

/** r180: ZeroStencilOp 0, KeepStencilOp 7680, ReplaceStencilOp 7681, IncrementStencilOp 7682, DecrementStencilOp 7683, IncrementWrapStencilOp 34055, DecrementWrapStencilOp 34056, InvertStencilOp 5386. */
export type StencilOp = "zero" | "keep" | "replace" | "increment" | "decrement" | "increment-wrap" | "decrement-wrap" | "invert";
export const STENCIL_OP: Table<StencilOp> = Object.freeze({ zero: 0, keep: 7680, replace: 7681, increment: 7682, decrement: 7683, "increment-wrap": 34055, "decrement-wrap": 34056, invert: 5386 });

/** FlatMaterial.combine (the env map's). r180: MultiplyOperation 0, MixOperation 1, AddOperation 2. */
export type Combine = "multiply" | "mix" | "add";
export const COMBINE: Table<Combine> = Object.freeze({ multiply: 0, mix: 1, add: 2 });

/** r180: TangentSpaceNormalMap 0, ObjectSpaceNormalMap 1. */
export type NormalMapType = "tangent" | "object";
export const NORMAL_MAP_TYPE: Table<NormalMapType> = Object.freeze({ tangent: 0, object: 1 });

/** DepthMaterial.depthPacking. r180: BasicDepthPacking 3200, RGBADepthPacking 3201, RGBDepthPacking 3202, RGDepthPacking 3203. */
export type DepthPacking = "basic" | "rgba" | "rgb" | "rg";
export const DEPTH_PACKING: Table<DepthPacking> = Object.freeze({ basic: 3200, rgba: 3201, rgb: 3202, rg: 3203 });

/** Texture.mapping. r180: UVMapping 300, CubeReflectionMapping 301, CubeRefractionMapping 302, EquirectangularReflectionMapping 303, EquirectangularRefractionMapping 304, CubeUVReflectionMapping 306. */
export type Mapping = "uv" | "cube-reflection" | "cube-refraction" | "equirect-reflection" | "equirect-refraction" | "cube-uv-reflection";
export const MAPPING: Table<Mapping> = Object.freeze({ uv: 300, "cube-reflection": 301, "cube-refraction": 302, "equirect-reflection": 303, "equirect-refraction": 304, "cube-uv-reflection": 306 });

/** Texture.wrapS / wrapT. r180: RepeatWrapping 1000, ClampToEdgeWrapping 1001, MirroredRepeatWrapping 1002. */
export type Wrapping = "repeat" | "clamp" | "mirror";
export const WRAPPING: Table<Wrapping> = Object.freeze({ repeat: 1000, clamp: 1001, mirror: 1002 });

/** Texture.magFilter / minFilter. r180: NearestFilter 1003, NearestMipmapNearestFilter 1004, NearestMipmapLinearFilter 1005, LinearFilter 1006, LinearMipmapNearestFilter 1007, LinearMipmapLinearFilter 1008. */
export type TextureFilter = "nearest" | "nearest-mipmap-nearest" | "nearest-mipmap-linear" | "linear" | "linear-mipmap-nearest" | "linear-mipmap-linear";
/** The filters a magFilter takes. */
export type MagFilter = "nearest" | "linear";
export const FILTER: Table<TextureFilter> = Object.freeze({
  nearest: 1003, "nearest-mipmap-nearest": 1004, "nearest-mipmap-linear": 1005,
  linear: 1006, "linear-mipmap-nearest": 1007, "linear-mipmap-linear": 1008,
});

/**
 * A texel's (or an attribute's GPU) component type. r180: UnsignedByteType 1009 "u8", ByteType 1010 "i8",
 * ShortType 1011 "i16", UnsignedShortType 1012 "u16", IntType 1013 "int", UnsignedIntType 1014 "uint",
 * FloatType 1015 "float", HalfFloatType 1016 "half", UnsignedShort4444Type 1017 "u4444",
 * UnsignedShort5551Type 1018 "u5551", UnsignedInt248Type 1020 "depth24-stencil8" (packed depth 24 / stencil 8),
 * UnsignedInt5999Type 35902 "u5999", UnsignedInt101111Type 35899 "u101111".
 */
export type TextureType =
  | "u8" | "i8" | "i16" | "u16" | "int" | "uint" | "float" | "half"
  | "u4444" | "u5551" | "depth24-stencil8" | "u5999" | "u101111";
export const TEXTURE_TYPE: Table<TextureType> = Object.freeze({
  u8: 1009, i8: 1010, i16: 1011, u16: 1012, int: 1013, uint: 1014, float: 1015, half: 1016,
  u4444: 1017, u5551: 1018, "depth24-stencil8": 1020, u5999: 35902, u101111: 35899,
});

/** Texture.format. r180: AlphaFormat 1021, RGBFormat 1022, RGBAFormat 1023, DepthFormat 1026, DepthStencilFormat 1027, RedFormat 1028, RedIntegerFormat 1029, RGFormat 1030, RGIntegerFormat 1031, RGBIntegerFormat 1032, RGBAIntegerFormat 1033. */
export type PixelFormat =
  | "alpha" | "rgb" | "rgba" | "depth" | "depth-stencil" | "red" | "red-integer" | "rg" | "rg-integer" | "rgb-integer" | "rgba-integer";
export const PIXEL_FORMAT: Table<PixelFormat> = Object.freeze({
  alpha: 1021, rgb: 1022, rgba: 1023, depth: 1026, "depth-stencil": 1027, red: 1028, "red-integer": 1029,
  rg: 1030, "rg-integer": 1031, "rgb-integer": 1032, "rgba-integer": 1033,
});

/** Attribute.usage (the GL buffer usage). r180: StaticDrawUsage 35044, DynamicDrawUsage 35048, StreamDrawUsage 35040, StaticReadUsage 35045, DynamicReadUsage 35049, StreamReadUsage 35041, StaticCopyUsage 35046, DynamicCopyUsage 35050, StreamCopyUsage 35042. */
export type Usage = "static" | "dynamic" | "stream" | "static-read" | "dynamic-read" | "stream-read" | "static-copy" | "dynamic-copy" | "stream-copy";
export const USAGE: Table<Usage> = Object.freeze({
  static: 35044, dynamic: 35048, stream: 35040, "static-read": 35045, "dynamic-read": 35049, "stream-read": 35041,
  "static-copy": 35046, "dynamic-copy": 35050, "stream-copy": 35042,
});

/** The renderer's shadow filter. r180: BasicShadowMap 0, PCFShadowMap 1, PCFSoftShadowMap 2, VSMShadowMap 3. */
export type ShadowMapType = "basic" | "pcf" | "pcf-soft" | "vsm";
export const SHADOW_MAP_TYPE: Table<ShadowMapType> = Object.freeze({ basic: 0, pcf: 1, "pcf-soft": 2, vsm: 3 });

/** The renderer's tone mapping. r180: NoToneMapping 0, LinearToneMapping 1, ReinhardToneMapping 2, CineonToneMapping 3, ACESFilmicToneMapping 4, CustomToneMapping 5, AgXToneMapping 6, NeutralToneMapping 7. */
export type ToneMapping = "none" | "linear" | "reinhard" | "cineon" | "aces-filmic" | "custom" | "agx" | "neutral";
export const TONE_MAPPING: Table<ToneMapping> = Object.freeze({ none: 0, linear: 1, reinhard: 2, cineon: 3, "aces-filmic": 4, custom: 5, agx: 6, neutral: 7 });

/** Which faces GL culls (the renderer's state). r180: CullFaceNone 0, CullFaceBack 1, CullFaceFront 2, CullFaceFrontBack 3. */
export type CullFace = "none" | "back" | "front" | "front-back";
export const CULL_FACE: Table<CullFace> = Object.freeze({ none: 0, back: 1, front: 2, "front-back": 3 });

/** CustomMaterial.glslVersion: r180's GLSL1 and GLSL3 are already strings ("100", "300 es"). */
export type GlslVersion = "100" | "300 es";

/** Colour spaces are strings in r180 too; only the linear one's name differs. r180: NoColorSpace "", SRGBColorSpace "srgb", LinearSRGBColorSpace "srgb-linear". */
export const COLOR_SPACE: Readonly<Record<ColorSpace, string>> = Object.freeze({ "": "", srgb: "srgb", linear: "srgb-linear" });

/** r180: WebGLCoordinateSystem 2000, WebGPUCoordinateSystem 2001. */
export const COORDINATE_SYSTEM: Table<CoordinateSystem> = Object.freeze({ webgl: 2000, webgpu: 2001 });

/** Every table, by the union it maps: `R180.side[material.side]` is r180's number. */
export const R180 = Object.freeze({
  side: SIDE,
  blending: BLENDING,
  blendEquation: BLEND_EQUATION,
  blendFactor: BLEND_FACTOR,
  depthFunc: DEPTH_FUNC,
  compareFunc: COMPARE_FUNC,
  stencilOp: STENCIL_OP,
  combine: COMBINE,
  normalMapType: NORMAL_MAP_TYPE,
  depthPacking: DEPTH_PACKING,
  mapping: MAPPING,
  wrapping: WRAPPING,
  filter: FILTER,
  textureType: TEXTURE_TYPE,
  pixelFormat: PIXEL_FORMAT,
  usage: USAGE,
  shadowMapType: SHADOW_MAP_TYPE,
  toneMapping: TONE_MAPPING,
  cullFace: CULL_FACE,
  coordinateSystem: COORDINATE_SYSTEM,
});
export type R180Table = keyof typeof R180;
