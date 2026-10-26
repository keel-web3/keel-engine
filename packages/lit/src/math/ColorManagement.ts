// Ported from Three.js r180's math/ColorManagement.js (MIT, see packages/lit/NOTICE).

import { Matrix3 } from "./Matrix3.ts";
import type { ColorSpace } from "./types.ts";

// (KEEL's colour spaces are r180's: "srgb" is SRGBColorSpace, "linear" is
// LinearSRGBColorSpace ("srgb-linear"), "" is NoColorSpace. The transfers
// keep r180's names, "srgb" and "linear".)
export type ColorTransfer = "srgb" | "linear";

/** What convert works on (a Color fits). */
export interface ConvertibleColor {
  r: number;
  g: number;
  b: number;
  applyMatrix3(m: Matrix3): unknown;
}

export interface ColorSpaceDefinition {
  primaries: readonly number[];
  whitePoint: readonly number[];
  transfer: ColorTransfer;
  toXYZ: Matrix3;
  fromXYZ: Matrix3;
  luminanceCoefficients: readonly number[];
  workingColorSpaceConfig?: { unpackColorSpace: ColorSpace };
  outputColorSpaceConfig?: { drawingBufferColorSpace: ColorSpace; toneMappingMode?: string };
}

const LINEAR_REC709_TO_XYZ = /*@__PURE__*/ new Matrix3().set(
  0.4123908, 0.3575843, 0.1804808,
  0.2126390, 0.7151687, 0.0721923,
  0.0193308, 0.1191948, 0.9505322,
);

const XYZ_TO_LINEAR_REC709 = /*@__PURE__*/ new Matrix3().set(
  3.2409699, - 1.5373832, - 0.4986108,
  - 0.9692436, 1.8759675, 0.0415551,
  0.0556301, - 0.2039770, 1.0569715,
);

function createColorManagement() {
  const colorManagement = {
    enabled: true,

    workingColorSpace: "linear" as ColorSpace,

    // (keyed by colour space; "" has no entry, as in r180)
    spaces: {} as Record<string, ColorSpaceDefinition>,

    convert<T extends ConvertibleColor>(color: T, sourceColorSpace: ColorSpace, targetColorSpace: ColorSpace): T {
      if (this.enabled === false || sourceColorSpace === targetColorSpace || !sourceColorSpace || !targetColorSpace) {
        return color;
      }

      const source = this.spaces[sourceColorSpace]!;
      const target = this.spaces[targetColorSpace]!;

      if (source.transfer === "srgb") {
        color.r = srgbToLinear(color.r);
        color.g = srgbToLinear(color.g);
        color.b = srgbToLinear(color.b);
      }

      if (source.primaries !== target.primaries) {
        color.applyMatrix3(source.toXYZ);
        color.applyMatrix3(target.fromXYZ);
      }

      if (target.transfer === "srgb") {
        color.r = linearToSrgb(color.r);
        color.g = linearToSrgb(color.g);
        color.b = linearToSrgb(color.b);
      }

      return color;
    },

    workingToColorSpace<T extends ConvertibleColor>(color: T, targetColorSpace: ColorSpace): T {
      return this.convert(color, this.workingColorSpace, targetColorSpace);
    },

    colorSpaceToWorking<T extends ConvertibleColor>(color: T, sourceColorSpace: ColorSpace): T {
      return this.convert(color, sourceColorSpace, this.workingColorSpace);
    },

    getPrimaries(colorSpace: ColorSpace): readonly number[] {
      return this.spaces[colorSpace]!.primaries;
    },

    getTransfer(colorSpace: ColorSpace): ColorTransfer {
      if (colorSpace === "") return "linear";

      return this.spaces[colorSpace]!.transfer;
    },

    getToneMappingMode(colorSpace: ColorSpace): string {
      return this.spaces[colorSpace]!.outputColorSpaceConfig!.toneMappingMode || "standard";
    },

    getLuminanceCoefficients<T extends { fromArray(array: ArrayLike<number>): T }>(target: T, colorSpace?: ColorSpace): T {
      if (colorSpace === undefined) colorSpace = this.workingColorSpace; // (r180's default)

      return target.fromArray(this.spaces[colorSpace]!.luminanceCoefficients);
    },

    define(colorSpaces: Record<string, ColorSpaceDefinition>): void {
      Object.assign(this.spaces, colorSpaces);
    },

    // (internal, as in r180)
    _getMatrix(targetMatrix: Matrix3, sourceColorSpace: ColorSpace, targetColorSpace: ColorSpace): Matrix3 {
      return targetMatrix
        .copy(this.spaces[sourceColorSpace]!.toXYZ)
        .multiply(this.spaces[targetColorSpace]!.fromXYZ);
    },

    _getDrawingBufferColorSpace(colorSpace: ColorSpace): ColorSpace {
      return this.spaces[colorSpace]!.outputColorSpaceConfig!.drawingBufferColorSpace;
    },

    _getUnpackColorSpace(colorSpace?: ColorSpace): ColorSpace {
      if (colorSpace === undefined) colorSpace = this.workingColorSpace; // (r180's default)

      return this.spaces[colorSpace]!.workingColorSpaceConfig!.unpackColorSpace;
    },
  };

  // (http://www.russellcottrell.com/photo/matrixCalculator.htm)
  const REC709_PRIMARIES = [0.640, 0.330, 0.300, 0.600, 0.150, 0.060];
  const REC709_LUMINANCE_COEFFICIENTS = [0.2126, 0.7152, 0.0722];
  const D65 = [0.3127, 0.3290];

  colorManagement.define({
    linear: {
      primaries: REC709_PRIMARIES,
      whitePoint: D65,
      transfer: "linear",
      toXYZ: LINEAR_REC709_TO_XYZ,
      fromXYZ: XYZ_TO_LINEAR_REC709,
      luminanceCoefficients: REC709_LUMINANCE_COEFFICIENTS,
      workingColorSpaceConfig: { unpackColorSpace: "srgb" },
      outputColorSpaceConfig: { drawingBufferColorSpace: "srgb" },
    },

    srgb: {
      primaries: REC709_PRIMARIES,
      whitePoint: D65,
      transfer: "srgb",
      toXYZ: LINEAR_REC709_TO_XYZ,
      fromXYZ: XYZ_TO_LINEAR_REC709,
      luminanceCoefficients: REC709_LUMINANCE_COEFFICIENTS,
      outputColorSpaceConfig: { drawingBufferColorSpace: "srgb" },
    },
  });

  return colorManagement;
}

/** r180's ColorManagement: the working space is linear sRGB. */
export const colorManagement = /*@__PURE__*/ createColorManagement();

/** r180's SRGBToLinear (its constants, not the exact sRGB curve's). */
export function srgbToLinear(c: number): number {
  return (c < 0.04045) ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

/** r180's LinearToSRGB (its 0.41666 exponent, not 1/2.4). */
export function linearToSrgb(c: number): number {
  return (c < 0.0031308) ? c * 12.92 : 1.055 * (Math.pow(c, 0.41666)) - 0.055;
}
