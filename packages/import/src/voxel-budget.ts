/** Working-set estimates count dense typed arrays, padded flood-fill queues,
 * JS geometry arrays (including growth), typed accessors and GLB copies. The
 * shared reader enforces the same generated-geometry memory contract. */
export const VOXEL_REPLAY_MEMORY_BYTES = 256 * 1024 * 1024;
export function voxelMemoryBudget(value = VOXEL_REPLAY_MEMORY_BYTES): number {
  if (!Number.isSafeInteger(value) || value < 1) throw Error('Voxel maxWorkingBytes must be a positive safe integer');
  return value;
}
export function voxelCubeWorkingBytes(skinned: boolean, morphTargets: number) {
  const javascript = (24 * (3 + 2 + 4 + 4 + 4) + 36) * 8 * 2;
  const encoded = (24 * (3 + 4) * 4 + 36 * 4 + (skinned ? 24 * 4 * (2 + 4) : 0)) * 3;
  return javascript + encoded + morphTargets * 24 * 3 * (8 * 2 + 4 * 3);
}
export function voxelGridWorkingBytes(size: readonly number[], skinning = true, morphs = true, fill: string = 'none') {
  const cells = size.reduce((n, v) => n * v, 1), padded = size.reduce((n, v) => n * (v + 2), 1);
  // Surface/best-triangle/interior/depth/source arrays and both BFS frontiers;
  // flood mode additionally keeps an outside bitmap and growing JS stack.
  return cells * (47 + (skinning ? 36 : 0) + (morphs ? 12 : 0)) + padded * (48 + (fill === 'flood' ? 17 : fill === 'parity' ? 1 : 0));
}
export class VoxelResourceLimitError extends Error {
  readonly code = 'VOXEL_RESOURCE_LIMIT';
  readonly requirements: Record<string, unknown>;
  constructor(message: string, requirements: Record<string, unknown>) { super(message); this.name = 'VoxelResourceLimitError'; this.requirements = requirements; }
}
export function allocateVoxelBudget(counts: number[], budget: number): number[] {
  const total = counts.reduce((n, v) => n + v, 0);
  if (!total) return counts.map(() => 0);
  // Give each nonempty part one cell when possible, then use source coverage.
  const present = counts.filter(Boolean).length, base = budget >= present ? counts.map(v => Number(v > 0)) : counts.map(() => 0), remainder = budget - base.reduce((n, v) => n + v, 0);
  const result = counts.map((v, i) => base[i]! + Math.floor(v / total * remainder));
  let left = budget - result.reduce((n, v) => n + v, 0);
  for (const { i } of counts.map((v, i) => ({ i, fraction: v / total * remainder % 1, count: v })).sort((a, b) => b.fraction - a.fraction || b.count - a.count || a.i - b.i)) if (left && counts[i]) { result[i]!++; left--; }
  return result;
}
