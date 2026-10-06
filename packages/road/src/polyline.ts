/** Minimal sampled path contract; usable without generating roads or a world. */
export interface PolylinePath { readonly x: ArrayLike<number>; readonly z: ArrayLike<number>; readonly length: number; readonly closed?: boolean }
/** Map line with a fixed sample stride and an explicit endpoint. No intermediate number[] or conversion. */
export function pathPolyline(path: PolylinePath, step = 6, closed = path.closed ?? false): Float32Array {
  if (!Number.isInteger(step) || step < 1) throw RangeError("Polyline step must be a positive integer");
  const n = path.length;
  if (!Number.isInteger(n) || n < 0 || n > path.x.length || n > path.z.length) throw RangeError("Invalid polyline length");
  if (!n) return new Float32Array();
  const out = new Float32Array(2 * (Math.ceil(n / step) + 1));
  let at = 0;
  for (let i = 0; i < n; i += step) { out[at++] = path.x[i]!; out[at++] = path.z[i]!; }
  const end = closed ? 0 : n - 1;
  out[at++] = path.x[end]!; out[at] = path.z[end]!;
  return out;
}
