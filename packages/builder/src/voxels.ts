// The voxel model: a sparse grid of cells, each empty or holding a ROLE --
// "primary", "trim", "skin", "glow" -- never a colour. Looks (ramps and
// materials) are applied later, so one built model wears any palette, and a
// variant recolours without touching a voxel.
//
//   const m = createVoxels({ unit: 0.1 });       // 10 cm voxels
//   m.set(0, 0, 0, "primary");
//   m.roleAt(0, 0, 0);                            // "primary"
//
// Storage: 16^3 chunks of palette indices (Uint8Array, 0 = empty) in a map,
// so a model costs what it fills. Index i >= 1 is roles[i - 1]; at most 255
// roles. Coordinates are integers in -2048..2047 on every axis (+y up, +z the
// thing's front, +x its right: the core frame). A voxel (x, y, z) fills the
// unit cube [x, x+1] x [y, y+1] x [z, z+1].
//
// GROUPS name regions (boxes of voxels, inclusive): "door", "flag", "head".
// They name parts (front detection reads "door", "face"), carry animation,
// variation and rig overrides. A voxel belongs to the first group whose
// regions hold it.

export type Vec3i = readonly [number, number, number];
export type V3 = [number, number, number];

/** A box of voxels, both corners inclusive. */
export interface Region {
  readonly min: Vec3i;
  readonly max: Vec3i;
}

/** The standard roles: what a voxel plays, so looks can dress it later. */
export const ROLES = ["primary", "secondary", "trim", "accent", "skin", "dark", "glow"] as const;
export type StandardRole = (typeof ROLES)[number];
export const ROLE_NAME = /^[a-z][a-z0-9-]{0,23}$/;

const CHUNK = 16;
const CHUNK_BITS = 4;
const LIMIT = 2048;

/** The dense copy of a model's bounding box: index = (x - min.x) + sx * ((y - min.y) + sy * (z - min.z)). */
export interface Dense {
  readonly min: V3;
  readonly size: V3;
  readonly data: Uint8Array;
}

export interface VoxelModel {
  /** Palette: index i >= 1 plays roles[i - 1]. */
  readonly roles: readonly string[];
  /** Metres per voxel. */
  unit: number;
  /** The pivot in voxel coordinates (half-voxels allowed); null: the middle of the base, from the bounds. */
  origin: V3 | null;
  /** Named regions, in order (a voxel belongs to the first that holds it). */
  readonly groups: Map<string, Region[]>;
  name: string;
  readonly count: number;
  /** A role's palette index (added if new; throws past 255 or for a bad name). */
  roleIndex(role: string): number;
  get(x: number, y: number, z: number): number;
  roleAt(x: number, y: number, z: number): string | null;
  /** Set a cell's palette index (0 empties it); returns the index it had. */
  setIndex(x: number, y: number, z: number, index: number): number;
  /** Set a cell's role (null empties it); returns the index it had. */
  set(x: number, y: number, z: number, role: string | null): number;
  /** [min, max] inclusive, or null when empty. */
  bounds(): { min: V3; max: V3 } | null;
  /** The pivot: `origin`, or the middle of the base. */
  pivot(): V3;
  /** Every filled cell, in a fixed order (chunks by key, cells by index). */
  forEach(fn: (x: number, y: number, z: number, index: number) => void): void;
  dense(): Dense;
  clone(): VoxelModel;
  /** The group a cell belongs to (first match), or null. */
  groupAt(x: number, y: number, z: number): string | null;
  clear(): void;
}

const checkCoord = (v: number, axis: string): void => {
  if (!Number.isInteger(v) || v < -LIMIT || v >= LIMIT) throw new RangeError(`Voxel ${axis} = ${v}: whole numbers in ${-LIMIT}..${LIMIT - 1}.`);
};
const keyOf = (cx: number, cy: number, cz: number): number => ((cx + 128) << 16) | ((cy + 128) << 8) | (cz + 128);
const unkey = (k: number): V3 => [((k >> 16) & 255) - 128, ((k >> 8) & 255) - 128, (k & 255) - 128];

export const inRegion = (r: Region, x: number, y: number, z: number): boolean =>
  x >= r.min[0] && x <= r.max[0] && y >= r.min[1] && y <= r.max[1] && z >= r.min[2] && z <= r.max[2];

/** A region from two corners in any order. */
export const regionOf = (a: Vec3i, b: Vec3i): Region => ({
  min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
  max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
});

export interface VoxelOptions {
  readonly unit?: number;
  readonly roles?: readonly string[];
  readonly origin?: Vec3i | null;
  readonly name?: string;
}

export function createVoxels({ unit = 0.1, roles = [], origin = null, name = "model" }: VoxelOptions = {}): VoxelModel {
  if (!(unit > 0)) throw new RangeError("A voxel's unit (metres) must be positive.");
  const palette: string[] = [];
  const chunks = new Map<number, Uint8Array>();
  const filled = new Map<number, number>();
  let count = 0;
  let boundsCache: { min: V3; max: V3 } | null | undefined;
  const groups = new Map<string, Region[]>();

  const roleIndex = (role: string): number => {
    const at = palette.indexOf(role);
    if (at >= 0) return at + 1;
    if (!ROLE_NAME.test(role)) throw new TypeError(`Role "${role}": lower-case letters, digits and dashes, starting with a letter (the standard ones: ${ROLES.join(", ")}).`);
    if (palette.length >= 255) throw new RangeError("A model holds at most 255 roles.");
    palette.push(role);
    return palette.length;
  };
  for (const r of roles) roleIndex(r);

  const get = (x: number, y: number, z: number): number => {
    const c = chunks.get(keyOf(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS));
    if (!c) return 0;
    return c[(x & 15) | ((y & 15) << 4) | ((z & 15) << 8)]!;
  };

  const setIndex = (x: number, y: number, z: number, index: number): number => {
    checkCoord(x, "x"); checkCoord(y, "y"); checkCoord(z, "z");
    if (!Number.isInteger(index) || index < 0 || index > palette.length) throw new RangeError(`Palette index ${index}: 0 (empty) or 1..${palette.length}.`);
    const k = keyOf(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS);
    let c = chunks.get(k);
    const i = (x & 15) | ((y & 15) << 4) | ((z & 15) << 8);
    const was = c ? c[i]! : 0;
    if (was === index) return was;
    if (!c) { c = new Uint8Array(CHUNK * CHUNK * CHUNK); chunks.set(k, c); filled.set(k, 0); }
    c[i] = index;
    const d = (index ? 1 : 0) - (was ? 1 : 0);
    if (d) {
      count += d;
      const n = filled.get(k)! + d;
      if (n === 0) { chunks.delete(k); filled.delete(k); } else filled.set(k, n);
      boundsCache = undefined;
    }
    return was;
  };

  const sortedKeys = (): number[] => [...chunks.keys()].sort((a, b) => a - b);
  const forEach = (fn: (x: number, y: number, z: number, index: number) => void): void => {
    for (const k of sortedKeys()) {
      const c = chunks.get(k)!;
      const [cx, cy, cz] = unkey(k);
      for (let i = 0; i < c.length; i += 1) {
        const v = c[i]!;
        if (v) fn((cx << CHUNK_BITS) | (i & 15), (cy << CHUNK_BITS) | ((i >> 4) & 15), (cz << CHUNK_BITS) | (i >> 8), v);
      }
    }
  };

  const bounds = (): { min: V3; max: V3 } | null => {
    if (boundsCache !== undefined) return boundsCache && { min: [...boundsCache.min], max: [...boundsCache.max] };
    if (!count) { boundsCache = null; return null; }
    const min: V3 = [Infinity, Infinity, Infinity];
    const max: V3 = [-Infinity, -Infinity, -Infinity];
    forEach((x, y, z) => {
      if (x < min[0]) min[0] = x; if (y < min[1]) min[1] = y; if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x; if (y > max[1]) max[1] = y; if (z > max[2]) max[2] = z;
    });
    boundsCache = { min, max };
    return { min: [...min], max: [...max] };
  };

  const model: VoxelModel = {
    get roles() { return palette; },
    unit,
    origin: origin ? [origin[0], origin[1], origin[2]] : null,
    groups,
    name,
    get count() { return count; },
    roleIndex,
    get,
    roleAt: (x, y, z) => { const v = get(x, y, z); return v ? palette[v - 1]! : null; },
    setIndex,
    set: (x, y, z, role) => setIndex(x, y, z, role === null ? 0 : roleIndex(role)),
    bounds,
    pivot() {
      if (model.origin) return [...model.origin];
      const b = bounds();
      if (!b) return [0, 0, 0];
      return [(b.min[0] + b.max[0] + 1) / 2, b.min[1], (b.min[2] + b.max[2] + 1) / 2];
    },
    forEach,
    dense() {
      const b = bounds();
      if (!b) return { min: [0, 0, 0], size: [0, 0, 0], data: new Uint8Array(0) };
      const size: V3 = [b.max[0] - b.min[0] + 1, b.max[1] - b.min[1] + 1, b.max[2] - b.min[2] + 1];
      const data = new Uint8Array(size[0] * size[1] * size[2]);
      forEach((x, y, z, v) => { data[x - b.min[0] + size[0] * (y - b.min[1] + size[1] * (z - b.min[2]))] = v; });
      return { min: b.min, size, data };
    },
    clone() {
      const m = createVoxels({ unit: model.unit, roles: palette, origin: model.origin, name: model.name });
      forEach((x, y, z, v) => m.setIndex(x, y, z, v));
      for (const [g, rs] of groups) m.groups.set(g, rs.map((r) => ({ min: [...r.min] as V3, max: [...r.max] as V3 })));
      return m;
    },
    groupAt(x, y, z) {
      for (const [g, rs] of groups) for (const r of rs) if (inRegion(r, x, y, z)) return g;
      return null;
    },
    clear() { chunks.clear(); filled.clear(); count = 0; boundsCache = undefined; },
  };
  return model;
}

/** Same cells, same roles by name (palette order may differ), same groups, unit and origin. */
export function sameVoxels(a: VoxelModel, b: VoxelModel): boolean {
  if (a.count !== b.count || a.unit !== b.unit) return false;
  if (JSON.stringify(a.origin) !== JSON.stringify(b.origin)) return false;
  if (JSON.stringify([...a.groups]) !== JSON.stringify([...b.groups])) return false;
  let same = true;
  a.forEach((x, y, z) => { if (same && a.roleAt(x, y, z) !== b.roleAt(x, y, z)) same = false; });
  return same;
}

/** How many cells each role fills. */
export function roleCounts(m: VoxelModel): Record<string, number> {
  const out: Record<string, number> = {};
  m.forEach((_x, _y, _z, v) => { const r = m.roles[v - 1]!; out[r] = (out[r] ?? 0) + 1; });
  return out;
}
