/** Remove only collapsed edges, keeping every vertex and the order of all visible triangles.
 * Use after positions become Float32 and before computing LOD or part draw ranges.
 * `parts` is [slot,u,v,part] per vertex; coincident vertices on different animated parts are not collapsed.
 */
export function cleanTriangles(
  positions: Float32Array,
  indices: Uint32Array,
  parts: Float32Array,
): Uint32Array {
  const equal = (a: number, b: number): boolean =>
    parts[a * 4 + 3] === parts[b * 4 + 3] &&
    positions[a * 3] === positions[b * 3] &&
    positions[a * 3 + 1] === positions[b * 3 + 1] &&
    positions[a * 3 + 2] === positions[b * 3 + 2];
  let output: Uint32Array | undefined,
    count = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]!,
      b = indices[i + 1]!,
      c = indices[i + 2]!;
    if (equal(a, b) || equal(b, c) || equal(c, a)) {
      if (!output) {
        output = new Uint32Array(indices.length);
        output.set(indices.subarray(0, i));
      }
    } else {
      if (output) {
        output[count] = a;
        output[count + 1] = b;
        output[count + 2] = c;
      }
      count += 3;
    }
  }
  return output ? output.slice(0, count) : indices;
}
