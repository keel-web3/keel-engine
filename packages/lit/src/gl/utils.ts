// Ported from Three.js r180's renderers/webgl/WebGLUtils.js (MIT, see
// packages/lit/NOTICE): a texture type or pixel format to its GL enum.
//
// keel/lit's constants are strings; convert() maps each through src/constants.ts
// to r180's number and then branches exactly as r180 does on that number, so
// every value lands on the GL enum r180 picks (and a value r180 leaves to its
// fallback, e.g. RGBIntegerFormat, falls back here too).
//
// Dropped: the compressed formats (S3TC, PVRTC, ETC, ASTC, BPTC, RGTC: keel/lit
// has no CompressedTexture), and with them the colour space's transfer, which
// only they read.

import { PIXEL_FORMAT, TEXTURE_TYPE } from "../constants.ts";
import type { PixelFormat, TextureType } from "../constants.ts";
import type { ColorSpace } from "../math/types.ts";
import type { Extensions } from "./extensions.ts";

// (r180's numbers, by r180's names)
const UnsignedByteType = TEXTURE_TYPE.u8, ByteType = TEXTURE_TYPE.i8, ShortType = TEXTURE_TYPE.i16, UnsignedShortType = TEXTURE_TYPE.u16;
const IntType = TEXTURE_TYPE.int, UnsignedIntType = TEXTURE_TYPE.uint, FloatType = TEXTURE_TYPE.float, HalfFloatType = TEXTURE_TYPE.half;
const UnsignedShort4444Type = TEXTURE_TYPE.u4444, UnsignedShort5551Type = TEXTURE_TYPE.u5551, UnsignedInt248Type = TEXTURE_TYPE["depth24-stencil8"];
const UnsignedInt5999Type = TEXTURE_TYPE.u5999, UnsignedInt101111Type = TEXTURE_TYPE.u101111;
const AlphaFormat = PIXEL_FORMAT.alpha, RGBFormat = PIXEL_FORMAT.rgb, RGBAFormat = PIXEL_FORMAT.rgba, DepthFormat = PIXEL_FORMAT.depth;
const DepthStencilFormat = PIXEL_FORMAT["depth-stencil"], RedFormat = PIXEL_FORMAT.red, RedIntegerFormat = PIXEL_FORMAT["red-integer"];
const RGFormat = PIXEL_FORMAT.rg, RGIntegerFormat = PIXEL_FORMAT["rg-integer"], RGBAIntegerFormat = PIXEL_FORMAT["rgba-integer"];

/** r180's WebGLUtils. */
export interface Utils {
  /** A KEEL texture type or pixel format (or a GL constant's name) to its GL enum; null if there is none. */
  convert(p: TextureType | PixelFormat | (string & {}), colorSpace?: ColorSpace): number | null;
}

export function createUtils(gl: WebGL2RenderingContext, extensions: Extensions): Utils {
  // (r180 reads extensions only for the compressed formats, which keel/lit lacks)
  void extensions;

  function convert(value: TextureType | PixelFormat | (string & {}), colorSpace: ColorSpace = ""): number | null {
    void colorSpace;

    const p = (TEXTURE_TYPE as Record<string, number>)[value] ?? (PIXEL_FORMAT as Record<string, number>)[value];

    if (p === UnsignedByteType) return gl.UNSIGNED_BYTE;
    if (p === UnsignedShort4444Type) return gl.UNSIGNED_SHORT_4_4_4_4;
    if (p === UnsignedShort5551Type) return gl.UNSIGNED_SHORT_5_5_5_1;
    if (p === UnsignedInt5999Type) return gl.UNSIGNED_INT_5_9_9_9_REV;
    if (p === UnsignedInt101111Type) return gl.UNSIGNED_INT_10F_11F_11F_REV;

    if (p === ByteType) return gl.BYTE;
    if (p === ShortType) return gl.SHORT;
    if (p === UnsignedShortType) return gl.UNSIGNED_SHORT;
    if (p === IntType) return gl.INT;
    if (p === UnsignedIntType) return gl.UNSIGNED_INT;
    if (p === FloatType) return gl.FLOAT;
    if (p === HalfFloatType) return gl.HALF_FLOAT;

    if (p === AlphaFormat) return gl.ALPHA;
    if (p === RGBFormat) return gl.RGB;
    if (p === RGBAFormat) return gl.RGBA;
    if (p === DepthFormat) return gl.DEPTH_COMPONENT;
    if (p === DepthStencilFormat) return gl.DEPTH_STENCIL;

    // WebGL2 formats.

    if (p === RedFormat) return gl.RED;
    if (p === RedIntegerFormat) return gl.RED_INTEGER;
    if (p === RGFormat) return gl.RG;
    if (p === RGIntegerFormat) return gl.RG_INTEGER;
    if (p === RGBAIntegerFormat) return gl.RGBA_INTEGER;

    // (r180: S3TC, PVRTC, ETC, ASTC, BPTC and RGTC compressed formats, through their extensions)

    if (p === UnsignedInt248Type) return gl.UNSIGNED_INT_24_8;

    // if "p" can't be resolved, assume the user defines a WebGL constant as a string (fallback/workaround for packed RGB formats)
    // (r180 looks its number up on the context, which has no numeric keys; keel/lit looks up the string)

    if (p !== undefined) return null;

    const named = (gl as unknown as Record<string, unknown>)[value];
    return named !== undefined ? (named as number) : null;
  }

  return { convert: convert };
}
