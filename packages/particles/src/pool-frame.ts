export function frameFromYaw(x: number, y: number, z: number, yaw: number, out: Float64Array, o = 0): Float64Array {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  out[o] = x; out[o + 1] = y; out[o + 2] = z;
  out[o + 3] = c; out[o + 4] = 0; out[o + 5] = s;
  out[o + 6] = 0; out[o + 7] = 1; out[o + 8] = 0;
  out[o + 9] = -s; out[o + 10] = 0; out[o + 11] = c;
  return out;
}

/** A point in a located frame (position + 3×3 as the host fills it) -> world, into `out`. */
export function frameToWorld(f: ArrayLike<number>, lx: number, ly: number, lz: number, out: Float64Array | number[], o = 0): void {
  out[o] = f[0]! + f[3]! * lx + f[4]! * ly + f[5]! * lz;
  out[o + 1] = f[1]! + f[6]! * lx + f[7]! * ly + f[8]! * lz;
  out[o + 2] = f[2]! + f[9]! * lx + f[10]! * ly + f[11]! * lz;
}
