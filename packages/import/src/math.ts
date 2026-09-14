// Small 4x4 matrix helpers (column-major, as glTF stores them) and the axis
// conversions from each format's frame into the engine's (+y up, +z front,
// +x the thing's right hand -- a left-handed frame, as core's frame says).

export type V3 = [number, number, number];
/** Column-major 4x4: m[col * 4 + row]. */
export type Mat4 = Float64Array;

export const identity = (): Mat4 => { const m = new Float64Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };

export function mul4(a: Mat4, b: Mat4): Mat4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) {
    let s = 0;
    for (let k = 0; k < 4; k += 1) s += a[k * 4 + r]! * b[c * 4 + k]!;
    o[c * 4 + r] = s;
  }
  return o;
}

/** Translation, rotation (a unit quaternion x y z w) and scale, as glTF composes them: T * R * S. */
export function fromTRS(t: readonly number[] = [0, 0, 0], q: readonly number[] = [0, 0, 0, 1], s: readonly number[] = [1, 1, 1]): Mat4 {
  const [x, y, z, w] = [q[0]!, q[1]!, q[2]!, q[3]!];
  const m = new Float64Array(16);
  m[0] = (1 - 2 * (y * y + z * z)) * s[0]!; m[1] = 2 * (x * y + z * w) * s[0]!; m[2] = 2 * (x * z - y * w) * s[0]!;
  m[4] = 2 * (x * y - z * w) * s[1]!; m[5] = (1 - 2 * (x * x + z * z)) * s[1]!; m[6] = 2 * (y * z + x * w) * s[1]!;
  m[8] = 2 * (x * z + y * w) * s[2]!; m[9] = 2 * (y * z - x * w) * s[2]!; m[10] = (1 - 2 * (x * x + y * y)) * s[2]!;
  m[12] = t[0]!; m[13] = t[1]!; m[14] = t[2]!; m[15] = 1;
  return m;
}

export const applyPoint = (m: Mat4, p: readonly number[]): V3 => [
  m[0]! * p[0]! + m[4]! * p[1]! + m[8]! * p[2]! + m[12]!,
  m[1]! * p[0]! + m[5]! * p[1]! + m[9]! * p[2]! + m[13]!,
  m[2]! * p[0]! + m[6]! * p[1]! + m[10]! * p[2]! + m[14]!,
];

export const translationOf = (m: Mat4): V3 => [m[12]!, m[13]!, m[14]!];

export function invert4(m: Mat4): Mat4 {
  const a = m, o = new Float64Array(16);
  const b00 = a[0]! * a[5]! - a[1]! * a[4]!, b01 = a[0]! * a[6]! - a[2]! * a[4]!, b02 = a[0]! * a[7]! - a[3]! * a[4]!;
  const b03 = a[1]! * a[6]! - a[2]! * a[5]!, b04 = a[1]! * a[7]! - a[3]! * a[5]!, b05 = a[2]! * a[7]! - a[3]! * a[6]!;
  const b06 = a[8]! * a[13]! - a[9]! * a[12]!, b07 = a[8]! * a[14]! - a[10]! * a[12]!, b08 = a[8]! * a[15]! - a[11]! * a[12]!;
  const b09 = a[9]! * a[14]! - a[10]! * a[13]!, b10 = a[9]! * a[15]! - a[11]! * a[13]!, b11 = a[10]! * a[15]! - a[11]! * a[14]!;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-300) return identity();
  const d = 1 / det;
  o[0] = (a[5]! * b11 - a[6]! * b10 + a[7]! * b09) * d; o[1] = (a[2]! * b10 - a[1]! * b11 - a[3]! * b09) * d;
  o[2] = (a[13]! * b05 - a[14]! * b04 + a[15]! * b03) * d; o[3] = (a[10]! * b04 - a[9]! * b05 - a[11]! * b03) * d;
  o[4] = (a[6]! * b08 - a[4]! * b11 - a[7]! * b07) * d; o[5] = (a[0]! * b11 - a[2]! * b08 + a[3]! * b07) * d;
  o[6] = (a[14]! * b02 - a[12]! * b05 - a[15]! * b01) * d; o[7] = (a[8]! * b05 - a[10]! * b02 + a[11]! * b01) * d;
  o[8] = (a[4]! * b10 - a[5]! * b08 + a[7]! * b06) * d; o[9] = (a[1]! * b08 - a[0]! * b10 - a[3]! * b06) * d;
  o[10] = (a[12]! * b04 - a[13]! * b02 + a[15]! * b00) * d; o[11] = (a[9]! * b02 - a[8]! * b04 - a[11]! * b00) * d;
  o[12] = (a[5]! * b07 - a[4]! * b09 - a[6]! * b06) * d; o[13] = (a[0]! * b09 - a[1]! * b07 + a[2]! * b06) * d;
  o[14] = (a[13]! * b01 - a[12]! * b03 - a[14]! * b00) * d; o[15] = (a[8]! * b03 - a[9]! * b01 + a[10]! * b00) * d;
  return o;
}

// ---------------------------------------------------------------- axes

/** Which way is up and which way the thing faces in a source file, and its handedness. */
export interface Axes {
  readonly up: "+y" | "+z";
  /** The thing's front in the source frame. */
  readonly front: "+z" | "-z" | "+x" | "-x" | "+y" | "-y";
  readonly handed: "right" | "left";
}

/** glTF and (usually) OBJ: right-handed, +y up, the front +z. */
export const GLTF_AXES: Axes = { up: "+y", front: "+z", handed: "right" };
/** STL (CAD) and MagicaVoxel: right-handed, +z up, the front -y. */
export const Z_UP_AXES: Axes = { up: "+z", front: "-y", handed: "right" };

const unitOf = (a: string): V3 => {
  const s = a[0] === "-" ? -1 : 1;
  return a[1] === "x" ? [s, 0, 0] : a[1] === "y" ? [0, s, 0] : [0, 0, s];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The matrix taking source coordinates to the engine's frame: source up -> +y,
 * source front -> +z, and the source's right hand -> +x (right-handed sources
 * are mirrored, which is what keeps a model's left hand its left).
 */
export function axesToEngine(ax: Axes): Mat4 {
  const up = unitOf(ax.up), front = unitOf(ax.front);
  if (Math.abs(up[0] * front[0] + up[1] * front[1] + up[2] * front[2]) > 0.5) throw new RangeError(`Axes: up ${ax.up} and front ${ax.front} must differ.`);
  // (Facing `front` with `up` overhead, the right hand is front x up in a right-handed frame, up x front in a left-handed one.)
  const right = ax.handed === "right" ? cross(front, up) : cross(up, front);
  // (Rows: engine x = right . p, y = up . p, z = front . p.)
  const m = identity();
  for (let c = 0; c < 3; c += 1) { m[c * 4] = right[c]!; m[c * 4 + 1] = up[c]!; m[c * 4 + 2] = front[c]!; }
  return m;
}
