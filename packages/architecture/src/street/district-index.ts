/** Nearest eligible block centre, with the planner's original first-index tie rule. */
interface Point { readonly x: number; readonly z: number; readonly index: number }
interface Node extends Point { readonly axis: 0 | 1; readonly left: Node | null; readonly right: Node | null }

export function districtBlockIndex(centres: readonly (readonly [number, number])[], blockDistrict: ReadonlyMap<number, number>): (x: number, z: number) => number {
  // A small city's scan is already cheap; keep its original path and avoid
  // building a tree or allocating a recursive search closure for each query.
  if (centres.length <= 32) return (x, z) => {
    let best = 0, d2 = Infinity;
    centres.forEach(([cx, cz], i) => { const d = (cx - x) * (cx - x) + (cz - z) * (cz - z); if (d < d2 && blockDistrict.has(i)) { d2 = d; best = i; } });
    return best;
  };
  const points: Point[] = [];
  centres.forEach(([x, z], index) => {
    // A non-finite centre cannot win the original strict distance comparison.
    if (blockDistrict.has(index) && Number.isFinite(x) && Number.isFinite(z)) points.push({ x, z, index });
  });
  const build = (entries: Point[], axis: 0 | 1): Node | null => {
    if (!entries.length) return null;
    entries.sort((a, b) => (axis === 0 ? a.x - b.x : a.z - b.z) || a.index - b.index);
    const middle = Math.floor(entries.length / 2), point = entries[middle]!;
    return { ...point, axis, left: build(entries.slice(0, middle), axis === 0 ? 1 : 0), right: build(entries.slice(middle + 1), axis === 0 ? 1 : 0) };
  };
  const root = build(points, 0);

  return (x, z) => {
    // This also preserves the original fallback when all distances are NaN or Infinity.
    if (!root || !Number.isFinite(x) || !Number.isFinite(z)) return 0;
    let best = 0, bestD2 = Infinity;
    const visit = (node: Node | null): void => {
      if (!node) return;
      const dx = node.x - x, dz = node.z - z, d = dx * dx + dz * dz;
      if (d < bestD2 || (d === bestD2 && node.index < best)) { bestD2 = d; best = node.index; }
      const delta = node.axis === 0 ? x - node.x : z - node.z;
      const near = delta < 0 ? node.left : node.right, far = delta < 0 ? node.right : node.left;
      visit(near);
      // A far subtree can contain an equal-distance earlier block. Allow a
      // small rounding margin around the splitting plane before pruning it.
      if (delta * delta <= bestD2 + Math.max(1, bestD2) * 1e-12) visit(far);
    };
    visit(root);
    return best;
  };
}
