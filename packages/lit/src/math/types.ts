// The small structural types the maths classes share (no r180 counterpart:
// r180 is untyped, so these say what each method reads, and nothing more).

/** Anything indexable to write numbers into: an array or a typed array. */
export interface NumberArray {
  [index: number]: number;
}

/** What `fromBufferAttribute` reads (core's `Attribute` fits it). */
export interface AttributeLike {
  readonly count: number;
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
  getW(index: number): number;
}

/** r180's coordinate systems, as KEEL's typed strings (r180's 2000 and 2001). */
export type CoordinateSystem = "webgl" | "webgpu";

/** r180's colour spaces: "srgb", "linear" (r180's "srgb-linear") and "" (none). */
export type ColorSpace = "srgb" | "linear" | "";

export type EulerOrder = "XYZ" | "YXZ" | "ZXY" | "ZYX" | "YZX" | "XZY";
