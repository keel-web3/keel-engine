// A spatial hash grid on the ground plane (x, z): what's near a point, what's
// inside a rectangle, what the camera can see. Cells are fixed-size buckets
// of ids, kept in typed arrays and rebuilt or moved without allocating --
// the structure an RTS with thousands of units asks every frame for culling,
// picking, separation and target search.
//
//   const grid = createGrid({ cell: 4, capacity: 4096 });
//   grid.set(id, x, z, r);         // insert or move (r: its radius, for queries)
//   grid.near(x, z, radius, out)   // ids within radius (by their centres + radii)
//   grid.rect(x0, z0, x1, z1, out) // ids whose circles touch the rectangle
//
// Ids are small integers (0..capacity-1), as an entity pool hands out.

import { dhypot } from "@keel-engine/core";

export interface Grid {
  /** Put an id at (x, z) with radius r (inserting, or moving it if it's there). */
  set(id: number, x: number, z: number, r?: number): void;
  remove(id: number): void;
  has(id: number): boolean;
  /** Ids within `radius` of (x, z) -- circles touching the query circle. Appends to `out`, returns it. */
  near(x: number, z: number, radius: number, out?: number[]): number[];
  /** Ids whose circles touch the rectangle. */
  rect(x0: number, z0: number, x1: number, z1: number, out?: number[]): number[];
  /** The nearest id to (x, z) within maxRadius passing `accept`, or -1. */
  nearest(x: number, z: number, maxRadius: number, accept?: (id: number) => boolean): number;
  readonly size: number;
  clear(): void;
}

export interface GridOptions {
  /** Cell size in world units: about the size of the commonest query radius. */
  readonly cell: number;
  /** How many ids it can hold (ids are 0..capacity-1). */
  readonly capacity: number;
}

// Cells live in a hash table of 2^k buckets keyed by (cx, cz); each id sits in
// exactly one cell (the one its centre is in), so a query widens by the
// largest radius present to catch circles poking in from neighbours.
export function createGrid({ cell, capacity }: GridOptions): Grid {
  if (!(cell > 0)) throw new RangeError("A grid's cell size must be positive.");
  const inv = 1 / cell;
  const buckets = 1 << Math.max(8, 32 - Math.clz32(Math.ceil(capacity * 2) - 1)); // (ceil(log2(capacity x 2)), in integers)
  const mask = buckets - 1;
  const head = new Int32Array(buckets).fill(-1); // first id in each bucket
  const next = new Int32Array(capacity).fill(-1); // the chain through a bucket
  const prev = new Int32Array(capacity).fill(-1);
  const bucketOf = new Int32Array(capacity).fill(-1);
  const cx = new Int32Array(capacity);
  const cz = new Int32Array(capacity);
  const px = new Float64Array(capacity);
  const pz = new Float64Array(capacity);
  const pr = new Float64Array(capacity);
  let count = 0;
  let maxR = 0;
  // (An integer hash of the cell: two big odd multipliers, xor-folded.)
  const hash = (x: number, z: number) => (Math.imul(x, 0x9e3779b1) ^ Math.imul(z, 0x85ebca77)) & mask;

  function unlink(id: number) {
    const b = bucketOf[id]!;
    if (b < 0) return;
    const p = prev[id]!;
    const n = next[id]!;
    if (p >= 0) next[p] = n; else head[b] = n;
    if (n >= 0) prev[n] = p;
    bucketOf[id] = -1;
    count -= 1;
  }
  function link(id: number, b: number) {
    const h = head[b]!;
    next[id] = h;
    prev[id] = -1;
    if (h >= 0) prev[h] = id;
    head[b] = id;
    bucketOf[id] = b;
    count += 1;
  }
  // Visit every id in cells overlapping [x0,x1]x[z0,z1] (widened by the largest radius).
  function scan(x0: number, z0: number, x1: number, z1: number, visit: (id: number) => void) {
    const a0 = Math.floor((x0 - maxR) * inv);
    const a1 = Math.floor((x1 + maxR) * inv);
    const b0 = Math.floor((z0 - maxR) * inv);
    const b1 = Math.floor((z1 + maxR) * inv);
    // (A huge query would walk more cells than there are ids: walk the ids instead.)
    if ((a1 - a0 + 1) * (b1 - b0 + 1) > count * 2 + 64) {
      for (let id = 0; id < capacity; id += 1) if (bucketOf[id]! >= 0 && cx[id]! >= a0 && cx[id]! <= a1 && cz[id]! >= b0 && cz[id]! <= b1) visit(id);
      return;
    }
    for (let a = a0; a <= a1; a += 1) {
      for (let b = b0; b <= b1; b += 1) {
        for (let id = head[hash(a, b)]!; id >= 0; id = next[id]!) if (cx[id] === a && cz[id] === b) visit(id);
      }
    }
  }

  return {
    set(id, x, z, r = 0) {
      if (id < 0 || id >= capacity || !Number.isInteger(id)) throw new RangeError(`Grid id ${id} is outside 0..${capacity - 1}.`);
      const a = Math.floor(x * inv);
      const b = Math.floor(z * inv);
      px[id] = x; pz[id] = z; pr[id] = r;
      if (r > maxR) maxR = r;
      if (bucketOf[id]! >= 0 && cx[id] === a && cz[id] === b) return; // (same cell: nothing to move)
      unlink(id);
      cx[id] = a; cz[id] = b;
      link(id, hash(a, b));
    },
    remove: unlink,
    has: (id) => id >= 0 && id < capacity && bucketOf[id]! >= 0,
    near(x, z, radius, out = []) {
      scan(x - radius, z - radius, x + radius, z + radius, (id) => {
        const dx = px[id]! - x;
        const dz = pz[id]! - z;
        const reach = radius + pr[id]!;
        if (dx * dx + dz * dz <= reach * reach) out.push(id);
      });
      return out;
    },
    rect(x0, z0, x1, z1, out = []) {
      scan(x0, z0, x1, z1, (id) => {
        const r = pr[id]!;
        const qx = Math.max(x0, Math.min(px[id]!, x1));
        const qz = Math.max(z0, Math.min(pz[id]!, z1));
        const dx = px[id]! - qx;
        const dz = pz[id]! - qz;
        if (dx * dx + dz * dz <= r * r) out.push(id);
      });
      return out;
    },
    nearest(x, z, maxRadius, accept) {
      let best = -1;
      let bd = Infinity;
      // (Grow the search ring by ring: most nearest-queries end in the first cell or two.)
      for (let reach = cell; ; reach = Math.min(maxRadius, reach * 2)) {
        scan(x - reach, z - reach, x + reach, z + reach, (id) => {
          if (accept && !accept(id)) return;
          const d = dhypot(px[id]! - x, pz[id]! - z) - pr[id]!;
          if (d < bd || (d === bd && id < best)) { bd = d; best = id; }
        });
        if ((best >= 0 && bd <= reach) || reach >= maxRadius) break;
      }
      return bd <= maxRadius ? best : -1;
    },
    get size() { return count; },
    clear() { head.fill(-1); bucketOf.fill(-1); count = 0; maxR = 0; },
  };
}
