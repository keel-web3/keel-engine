// Foliage scatter: a region's rules expanded into placements, the same every
// time. Candidate points are a Poisson-disk sample (Bridson's, at the smallest
// spacing any rule allows); at each, the rules that can grow on the tile's
// type (and near or away from water) are weighed, a clump field thins them
// into forests and clearings, and a rule's own spacing is kept from every
// thing already grown. Roads, bridges, ramps, water, things' footprints and
// spawns are kept clear.
//
// The region (a few rules and a seed) is what a level stores; the thousands
// of placements are made at load.

import { dcos, dsin, fbm2 } from "@keel-engine/core";
import { namedStream } from "@keel-engine/world";
import type { NamedStream } from "@keel-engine/world";
import { FLAG } from "@keel-engine/terrain";
import type { Level, ScatterRegion, ScatterRule, V3 } from "./document.ts";

/** A grown thing. */
export interface ScatterInstance {
  readonly id: string;
  readonly region: string;
  readonly rule: number;
  readonly pack: string;
  readonly object: string;
  readonly pos: V3;
  readonly yaw: number;
  readonly scale: number;
}

/**
 * A fast float source seeded from a named stream (two of its draws): layout
 * draws by the hundred thousand (a named stream hashes every draw; this is a
 * mulberry32 over its seed -- the same numbers every time, on every machine).
 */
export function bulkStream(S: NamedStream): () => number {
  let a = ((S.int(0, 0xffff) << 16) | S.int(0, 0xffff)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A Poisson-disk sample of a rectangle [x0, z0, x1, z1] (metres): points at
 * least `radius` apart, `k` tries round each (Bridson), drawn from a bulk
 * stream off `S`.
 */
export function poissonDisk(rect: readonly [number, number, number, number], radius: number, S: NamedStream, { k = 10, max = 400000 }: { readonly k?: number; readonly max?: number } = {}): Array<[number, number]> {
  const f = bulkStream(S);
  const [x0, z0, x1, z1] = rect;
  const cell = radius / Math.SQRT2;
  const gw = Math.max(1, Math.ceil((x1 - x0) / cell)), gh = Math.max(1, Math.ceil((z1 - z0) / cell));
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts: Array<[number, number]> = [];
  const active: number[] = [];
  const put = (x: number, z: number): void => {
    const id = pts.length;
    pts.push([x, z]);
    active.push(id);
    grid[Math.min(gh - 1, Math.floor((z - z0) / cell)) * gw + Math.min(gw - 1, Math.floor((x - x0) / cell))] = id;
  };
  put(x0 + f() * (x1 - x0), z0 + f() * (z1 - z0));
  const r2 = radius * radius;
  while (active.length && pts.length < max) {
    const a = Math.floor(f() * active.length);
    const [px, pz] = pts[active[a]!]!;
    let found = false;
    for (let n = 0; n < k; n += 1) {
      const ang = f() * Math.PI * 2, rr = radius * (1 + f());
      const x = px + dcos(ang) * rr, z = pz + dsin(ang) * rr;
      if (x < x0 || z < z0 || x >= x1 || z >= z1) continue;
      const gx = Math.floor((x - x0) / cell), gz = Math.floor((z - z0) / cell);
      let ok = true;
      for (let dz = -2; dz <= 2 && ok; dz += 1) for (let dx = -2; dx <= 2; dx += 1) {
        const cx = gx + dx, cz = gz + dz;
        if (cx < 0 || cz < 0 || cx >= gw || cz >= gh) continue;
        const q = grid[cz * gw + cx]!;
        if (q >= 0) { const [qx, qz] = pts[q]!; if ((qx - x) ** 2 + (qz - z) ** 2 < r2) { ok = false; break; } }
      }
      if (ok) { put(x, z); found = true; break; }
    }
    if (!found) { active[a] = active[active.length - 1]!; active.pop(); }
  }
  return pts;
}

/** Tiles to keep clear of foliage: roads, bridges, ramps, blocked footprints (and `clear` tiles round them), spawns. */
export function clearMask(level: Level, clear: number): Uint8Array {
  const t = level.terrain;
  const W = t.width, D = t.depth;
  const hard = new Uint8Array(W * D);
  const road = t.types.has("road") ? t.types.id("road") : -1, path = t.types.has("path") ? t.types.id("path") : -1;
  for (let k = 0; k < hard.length; k += 1) if (t.type[k] === road || t.type[k] === path || t.flags[k]! & (FLAG.BRIDGE | FLAG.RAMP | FLAG.BLOCKED)) hard[k] = 1;
  const blocked = level.blocked();
  for (let k = 0; k < hard.length; k += 1) if (blocked[k]) hard[k] = 1;
  for (const s of level.spawns) for (let dj = -4; dj <= 4; dj += 1) for (let di = -4; di <= 4; di += 1) { const i = s.at[0] + di, j = s.at[1] + dj; if (t.inside(i, j)) hard[j * W + i] = 1; }
  if (clear <= 0) return hard;
  const out = hard.slice();
  for (let j = 0; j < D; j += 1) for (let i = 0; i < W; i += 1) {
    if (!hard[j * W + i]) continue;
    for (let dj = -clear; dj <= clear; dj += 1) for (let di = -clear; di <= clear; di += 1) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < W && b < D) out[b * W + a] = 1; }
  }
  return out;
}

// Chebyshev distance to the nearest wet tile, capped (for reeds and the like).
function waterDistance(level: Level, cap: number): Uint8Array {
  const t = level.terrain;
  const d = new Uint8Array(t.width * t.depth).fill(cap);
  for (let k = 0; k < d.length; k += 1) if (t.waterDepth(k % t.width, Math.floor(k / t.width)) > 0) d[k] = 0;
  for (let pass = 0; pass < cap; pass += 1) {
    for (let j = 0; j < t.depth; j += 1) for (let i = 0; i < t.width; i += 1) {
      const k = j * t.width + i;
      let v = d[k]!;
      for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < t.width && b < t.depth) v = Math.min(v, d[b * t.width + a]! + 1); }
      d[k] = v;
    }
  }
  return d;
}

/** A region's placements (deterministic: the level's seed and the region's id). */
export function expandScatter(level: Level, region: ScatterRegion, { mask, water }: { readonly mask?: Uint8Array; readonly water?: Uint8Array } = {}): ScatterInstance[] {
  const t = level.terrain;
  const ts = t.tileSize;
  const rules = region.rules;
  if (!rules.length || region.density <= 0) return [];
  const clear = mask ?? clearMask(level, region.clear);
  const wet = water ?? waterDistance(level, 8);
  const S = namedStream(level.seed, `scatter:${region.id}`);
  const minSpacing = Math.min(...rules.map((r) => r.spacing));
  const rect: [number, number, number, number] = [region.rect[0] * ts, region.rect[1] * ts, region.rect[2] * ts, region.rect[3] * ts];
  const pts = poissonDisk(rect, minSpacing, S);
  const typeIds = rules.map((r) => new Set(r.on.filter((n) => t.types.has(n)).map((n) => t.types.id(n))));
  const clumpSeed = (S.int(0, 1 << 20)) | 0;
  const F = bulkStream(S);
  // Everything grown so far, in a hash on the ground: a rule's spacing from all of it.
  const cell = Math.max(...rules.map((r) => r.spacing));
  const hash = new Map<number, number[]>();
  const out: ScatterInstance[] = [];
  const near = (x: number, z: number, r: number): boolean => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const list = hash.get((cz + dz) * 65536 + cx + dx);
      if (list) for (const n of list) { const p = out[n]!.pos; if ((p[0] - x) ** 2 + (p[2] - z) ** 2 < r * r) return true; }
    }
    return false;
  };
  for (const [x, z] of pts) {
    const i = Math.floor(x / ts), j = Math.floor(z / ts);
    if (!t.inside(i, j)) continue;
    const k = j * t.width + i;
    // (Draws happen for every point, whatever is decided: a rule changed never moves another point's draws.)
    const roll = F(), pick = F(), yawR = F(), scaleR = F();
    if (clear[k] || t.waterDepth(i, j) > 0) continue;
    const ty = t.type[k]!;
    const can: Array<[ScatterRule, number]> = [];
    let total = 0;
    rules.forEach((r, n) => {
      if (!typeIds[n]!.has(ty)) return;
      if (r.water !== undefined && (r.water >= 0 ? wet[k]! > r.water : wet[k]! < -r.water)) return;
      const clump = r.clump ?? 0;
      const field = clump ? Math.max(0, Math.min(1, (fbm2(x * 0.035, z * 0.035, clumpSeed + n * 17, 2) - 0.38) * 4)) : 1;
      const w = r.weight * (1 - clump + clump * field);
      if (w > 0) { can.push([r, w]); total += w; }
    });
    if (!total || roll > Math.min(1, total * region.density)) continue;
    let ticket = pick * total, chosen = can[can.length - 1]!;
    for (const c of can) { if (ticket < c[1]) { chosen = c; break; } ticket -= c[1]; }
    const [rule] = chosen;
    if (near(x, z, rule.spacing)) continue;
    const n = out.length;
    out.push({ id: `${region.id}#${n}`, region: region.id, rule: rules.indexOf(rule), pack: rule.pack, object: rule.object, pos: [x, t.heightAt(x, z), z], yaw: yawR * Math.PI * 2, scale: rule.scale[0] + (rule.scale[1] - rule.scale[0]) * scaleR });
    const key = Math.floor(z / cell) * 65536 + Math.floor(x / cell);
    (hash.get(key) ?? hash.set(key, []).get(key)!).push(n);
  }
  return out;
}

/** Every region's placements. */
export function expandAll(level: Level): ScatterInstance[] {
  const water = waterDistance(level, 8);
  const masks = new Map<number, Uint8Array>();
  return level.scatter.flatMap((r) => {
    let mask = masks.get(r.clear);
    if (!mask) { mask = clearMask(level, r.clear); masks.set(r.clear, mask); }
    return expandScatter(level, r, { mask, water });
  });
}
