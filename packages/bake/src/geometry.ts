// Pure mesh coordinates. No renderer, generator catalogue, or GPU dependency.
export function meshBounds(positions: Float32Array): [number, number, number, number, number, number] {
  const b: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let v = 0; v < positions.length; v += 3) for (let a = 0; a < 3; a += 1) {
    const q = positions[v + a]!;
    if (q < b[a]!) b[a] = q;
    if (q > b[a + 3]!) b[a + 3] = q;
  }
  return b;
}
export const bodySpace = (positions: Float32Array, b: readonly number[]): Float32Array => {
  const out = new Float32Array(positions.length);
  const span = [Math.max(1e-4, b[3]! - b[0]!), Math.max(1e-4, b[4]! - b[1]!), Math.max(1e-4, b[5]! - b[2]!)];
  for (let v = 0; v < positions.length; v += 3) for (let a = 0; a < 3; a += 1) out[v + a] = Math.max(0, Math.min(1, (positions[v + a]! - b[a]!) / span[a]!));
  return out;
};
