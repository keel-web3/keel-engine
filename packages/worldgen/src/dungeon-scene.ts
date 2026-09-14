// A dressed dungeon as geometry the dungeon renderer draws: walls with real
// height (2-3.6 m) built on a fine grid of half-metre columns hugging the
// rooms (a metre thick; caves' rock rough-edged, a ruin's tops broken), their
// faces and caps; pillars; arched lintels over the doorways and their frames;
// stairs up at the entry and down at the exit; bridges over chasms; the
// floor, its pits and pools; and the drop of every outer wall into the abyss.
//
// Every piece is a QUAD (16 floats, see QUAD_* below). A wall column's cap and
// face carry the column's middle, so the renderer's CUTAWAY can sink the
// columns between the camera and the hero to stubs in the vertex shader; the
// faces between two columns ("inner" faces) carry the neighbour's middle too
// and open up only when one sinks lower than the other -- the stub keeps a
// solid top, never a hole.
//
// The camera sees faces whose normals point -x or -z (it looks along +x +z,
// down): only those are built.

import { CELL } from "./dungeon.ts";
import { DECOR, DIR_X, DIR_Z, FLOOR } from "./dungeon-dress.ts";
import type { DungeonDressing } from "./dungeon-dress.ts";
import { hash01, value2 } from "./noise.ts";

/** Floats per quad: p (3), u (3), v (3), material, seed, bits + 256 kind, column x z, neighbour column x z. */
export const QUAD_FLOATS = 16;
/** Quad kinds: a flat (never cut), a column's cap (cut), a column's outer face (top cut), an inner face (top and bottom cut), a free quad. */
export const QUAD = Object.freeze({ FLAT: 0, CAP: 1, FACE: 2, INNER: 3, FREE: 4 });
/** Materials the renderer knows. */
export const MAT = Object.freeze({ FLOOR: 0, CORRIDOR: 1, CAVE: 2, BRIDGE: 3, WATER: 4, LAVA: 5, WALL: 6, CAP: 7, PILLAR: 8, DOOR: 9, LOCKED: 10, STAIR: 11, LINTEL: 12, DROP: 13, TRIM: 14, OPENING: 15, BEAM: 16, BEDROCK: 17 });
/** Fine subcells a cell has along each side (0.5 m each at the default 2 m tile). */
export const SUB = 4;
/** No column (a quad that isn't cut). */
export const NO_COLUMN = 1e9;
/** Fine grid kinds. */
export const FINE = Object.freeze({ VOID: 0, FLOOR: 1, WALL: 2, PIT: 3, LIQUID: 4, PILLAR: 5 });

export interface SceneFlame { readonly x: number; readonly y: number; readonly z: number; readonly kind: number; readonly size: number; readonly seed: number; readonly light: number }
export interface SceneDoor {
  readonly index: number;
  readonly x0: number; readonly z0: number;
  /** 0: the way runs along x (the leaves span z); 1: along z (they span x). */
  readonly axis: 0 | 1;
  readonly locked: boolean;
  /** Where the leaves stand (m along the way through, from the cell's low edge). */
  readonly at: number;
  /** In a front wall (the cutaway keeps it low with the wall). */
  readonly front: boolean;
}

export interface DungeonScene {
  readonly w: number;
  readonly d: number;
  readonly tile: number;
  /** The fine grid: SUB x SUB subcells a cell, FINE kinds, column heights (m), walkable subcells. */
  readonly fw: number;
  readonly fd: number;
  readonly fine: Uint8Array;
  readonly height: Float32Array;
  readonly walk: Uint8Array;
  readonly quads: Float32Array;
  readonly count: number;
  readonly flames: readonly SceneFlame[];
  readonly doors: readonly SceneDoor[];
  readonly abyss: number;
  readonly stats: Record<string, number>;
}

/** Flame kinds (the renderer's): 0 torch, 1 brazier, 2 candle, 3 sconce (magic). */
export const FLAME_KIND: Readonly<Record<string, number>> = { torch: 0, brazier: 1, candle: 2, sconce: 3 };

export function buildDungeonScene(S: DungeonDressing): DungeonScene {
  const { w, d, tile, theme } = S;
  const sub = SUB, fs = tile / sub;
  const fw = w * sub, fd = d * sub;
  const FN = fw * fd;
  const fine = new Uint8Array(FN), height = new Float32Array(FN);
  const cells = S.cells;
  const abyss = theme.abyss.depth;
  const pillarSet = new Set(S.pillars);
  const cellOf = (fx: number, fz: number): number => Math.floor(fz / sub) * w + Math.floor(fx / sub);
  const liquid = (f: number): boolean => f === FLOOR.WATER || f === FLOOR.LAVA;

  // ---------------------------------------------------------------- the fine grid
  for (let fz = 0; fz < fd; fz += 1) for (let fx = 0; fx < fw; fx += 1) {
    const k = cellOf(fx, fz), f = S.floor[k]!;
    const q = fz * fw + fx;
    if (cells[k] === CELL.WALL) fine[q] = pillarSet.has(k) ? FINE.FLOOR : FINE.VOID;
    else if (f === FLOOR.PIT) fine[q] = FINE.PIT;
    else if (liquid(f)) fine[q] = FINE.LIQUID;
    else fine[q] = FINE.FLOOR;
  }
  // Walls: the subcells of wall cells within `thickness` of open ground (Chebyshev), so a room's wall hugs it.
  const T = theme.wall.thickness, rough = theme.wall.rough;
  const dist = new Uint8Array(FN).fill(255);
  const q0: number[] = [];
  for (let q = 0; q < FN; q += 1) if (fine[q] !== FINE.VOID) { dist[q] = 0; q0.push(q); }
  for (let h = 0; h < q0.length; h += 1) {
    const q = q0[h]!, fx = q % fw, fz = (q - fx) / fw;
    if (dist[q]! >= T + 2) continue;
    for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const x = fx + dx, z = fz + dz;
      if ((dx || dz) && x >= 0 && z >= 0 && x < fw && z < fd && dist[z * fw + x]! > dist[q]! + 1) { dist[z * fw + x] = dist[q]! + 1; q0.push(z * fw + x); }
    }
  }
  const seedN = Math.floor(hash01(w, d, 77) * 1e6);
  for (let q = 0; q < FN; q += 1) {
    if (fine[q] !== FINE.VOID || cells[cellOf(q % fw, Math.floor(q / fw))] !== CELL.WALL) continue;
    const fx = q % fw, fz = (q - fx) / fw;
    // (Rough rock: the thickness wanders.)
    const t = rough > 0 ? T + Math.round((value2(fx * 0.35, fz * 0.35, seedN) - 0.5) * 2.6 * rough) : T;
    if (dist[q]! <= Math.max(1, t)) fine[q] = FINE.WALL;
  }
  // (Rough rock also bulges into the floor at the edges: never in a door, a corridor, a stair or a bridge.)
  if (rough > 0.5) {
    for (let q = 0; q < FN; q += 1) {
      if (fine[q] !== FINE.FLOOR) continue;
      const fx = q % fw, fz = (q - fx) / fw, k = cellOf(fx, fz), f = S.floor[k]!;
      if (f !== FLOOR.ROOM && f !== FLOOR.CAVE) continue;
      let touch = false;
      // (Only off a wall behind the floor, +x or +z of it -- a room's back walls: a bulge off a front wall would stand
      // before the cutaway's stubs as a lone black slab.)
      for (let dz = 0; dz <= 1 && !touch; dz += 1) for (let dx = 0; dx <= 1; dx += 1) { const x = fx + dx, z = fz + dz; if ((dx || dz) && x >= 0 && z >= 0 && x < fw && z < fd && fine[z * fw + x] === FINE.WALL && cells[cellOf(x, z)] === CELL.WALL) { touch = true; break; } }
      if (touch && value2(fx * 0.5 + 3, fz * 0.5, seedN + 1) > 0.56 && !S.blocked[k]) fine[q] = FINE.WALL;
    }
  }
  // Column heights: the theme's range; masonry level, rock and ruins wandering.
  const [h0, h1] = theme.wall.height;
  for (let q = 0; q < FN; q += 1) {
    if (fine[q] !== FINE.WALL) continue;
    const fx = q % fw, fz = (q - fx) / fw;
    let H = h1;
    if (h1 > h0) {
      const n = theme.wall.style === 3 ? value2(fx * 0.3, fz * 0.3, seedN + 2) * 0.7 + hash01(fx >> 1, fz >> 1, seedN + 3) * 0.3 : value2(fx * 0.09, fz * 0.09, seedN + 2);
      H = h0 + (h1 - h0) * n;
      H = Math.round(H / (theme.wall.style === 3 ? 0.25 : 0.125)) * (theme.wall.style === 3 ? 0.25 : 0.125);
    }
    height[q] = H;
  }
  // (Beside a door the wall stands full height: its lintel needs something to rest on.)
  for (const dr of S.doors) for (let fz = dr.j * sub - 2; fz < (dr.j + 1) * sub + 2; fz += 1) for (let fx = dr.i * sub - 2; fx < (dr.i + 1) * sub + 2; fx += 1) { const q = fz * fw + fx; if (fx >= 0 && fz >= 0 && fx < fw && fz < fd && fine[q] === FINE.WALL) height[q] = Math.max(height[q]!, h1); }

  // ---------------------------------------------------------------- quads
  let data = new Float32Array(QUAD_FLOATS * 4096);
  let n = 0;
  const push = (kind: number, mat: number, px: number, py: number, pz: number, ux: number, uy: number, uz: number, vx: number, vy: number, vz: number, seed: number, bits: number, cx = NO_COLUMN, cz = NO_COLUMN, nx = NO_COLUMN, nz = NO_COLUMN): void => {
    if ((n + 1) * QUAD_FLOATS > data.length) { const next = new Float32Array(data.length * 2); next.set(data); data = next; }
    const o = n * QUAD_FLOATS;
    data[o] = px; data[o + 1] = py; data[o + 2] = pz; data[o + 3] = ux; data[o + 4] = uy; data[o + 5] = uz; data[o + 6] = vx; data[o + 7] = vy; data[o + 8] = vz;
    data[o + 9] = mat; data[o + 10] = seed; data[o + 11] = bits + 256 * kind; data[o + 12] = cx; data[o + 13] = cz; data[o + 14] = nx; data[o + 15] = nz;
    n += 1;
  };
  const rugAt = new Int32Array(w * d).fill(-1);
  S.rugs.forEach((r, ri) => { for (let j = r.j0; j < r.j1; j += 1) for (let i = r.i0; i < r.i1; i += 1) if (i >= 0 && j >= 0 && i < w && j < d) rugAt[j * w + i] = ri; });
  const levelOf = (f: number): number => (f === FLOOR.WATER ? -0.28 : f === FLOOR.LAVA ? -0.22 : f === FLOOR.PIT ? -abyss : f === FLOOR.WALL ? 0 : f === FLOOR.BRIDGE ? -abyss : 0);

  // Floors (a quad a cell), pools and lava a step down, bridges' decks.
  let floors = 0;
  for (let j = 0; j < d; j += 1) for (let i = 0; i < w; i += 1) {
    const k = j * w + i, f = pillarSet.has(k) ? FLOOR.ROOM : S.floor[k]!;
    if (f === FLOOR.WALL) continue;
    if (f === FLOOR.PIT || f === FLOOR.STAIRS_DOWN) continue;
    const x = i * tile, z = j * tile;
    const v = S.variant[k]!;
    if (f === FLOOR.BRIDGE) {
      // (A deck along the way across: planks the other way.)
      const alongX = S.floor[k - 1] !== FLOOR.PIT && S.floor[k + 1] !== FLOOR.PIT ? 1 : S.floor[k - w] !== FLOOR.PIT && S.floor[k + w] !== FLOOR.PIT ? 0 : 1;
      push(QUAD.FLAT, MAT.BRIDGE, x, -0.08, z, tile, 0, 0, 0, 0, tile, v, alongX);
      // Its beams: a face on the camera's side of it, down from the deck.
      if (alongX) push(QUAD.FREE, MAT.BEAM, x, -0.45, z + 0.15, tile, 0, 0, 0, 0.37, 0, v, 0);
      else push(QUAD.FREE, MAT.BEAM, x + 0.15, -0.45, z + tile, 0, 0, -tile, 0, 0.37, 0, v, 0);
      floors += 1;
      continue;
    }
    const mat = liquid(f) ? (f === FLOOR.LAVA ? MAT.LAVA : MAT.WATER) : f === FLOOR.CORRIDOR ? MAT.CORRIDOR : f === FLOOR.CAVE ? MAT.CAVE : MAT.FLOOR;
    const ri = rugAt[k]!;
    let rx = NO_COLUMN, rz = NO_COLUMN, seed = v;
    if (ri >= 0 && !liquid(f)) { const r = S.rugs[ri]!; rx = (i - r.i0) + 64 * (r.i1 - r.i0); rz = (j - r.j0) + 64 * (r.j1 - r.j0); seed = v + 256 * (r.style + 1); }
    push(QUAD.FLAT, mat, x, levelOf(f), z, tile, 0, 0, 0, 0, tile, seed, S.decor[k]!, NO_COLUMN, NO_COLUMN, rx, rz);
    floors += 1;
  }
  // Bedrock: the rock the dungeon is cut from, under every wall cell (its walls stand on it; between rooms it's the
  // ground you never walk -- rubble, dark, textured -- not a void).
  for (let j = 0; j < d; j += 1) for (let i = 0; i < w; i += 1) {
    const k = j * w + i;
    if (S.floor[k] !== FLOOR.WALL || pillarSet.has(k)) continue;
    push(QUAD.FLAT, MAT.BEDROCK, i * tile, 0, j * tile, tile, 0, 0, 0, 0, tile, S.variant[k]!, 0);
  }
  // Drops: where the ground falls away on the camera's side of a cell (into a pit, a pool, the abyss), its edge face.
  for (let j = 0; j < d; j += 1) for (let i = 0; i < w; i += 1) {
    const k = j * w + i, f = S.floor[k]!;
    if (f === FLOOR.WALL || f === FLOOR.PIT || f === FLOOR.BRIDGE) continue;
    const top = levelOf(f === FLOOR.STAIRS_DOWN ? FLOOR.ROOM : f);
    for (const dir of [2, 3]) {
      const a = i + DIR_X[dir]!, b = j + DIR_Z[dir]!;
      const fn = a < 0 || b < 0 || a >= w || b >= d ? FLOOR.WALL : S.floor[b * w + a]!;
      if (fn === FLOOR.WALL) continue; // (a wall there has its own face)
      const low = levelOf(fn);
      if (low >= top - 1e-3) continue;
      if (dir === 3) push(QUAD.FREE, MAT.DROP, i * tile, low, j * tile, tile, 0, 0, 0, top - low, 0, S.variant[k]!, 0);
      else push(QUAD.FREE, MAT.DROP, i * tile, low, (j + 1) * tile, 0, 0, -tile, 0, top - low, 0, S.variant[k]!, 0);
    }
  }

  // Walls: each column's cap and its faces toward the camera.
  let columns = 0;
  const kindAt = (fx: number, fz: number): number => (fx < 0 || fz < 0 || fx >= fw || fz >= fd ? FINE.VOID : fine[fz * fw + fx]!);
  // FRONT walls: a room's walls the camera looks through -- floor behind them (+x, +z), none before them. The
  // cutaway keeps these low everywhere (a dollhouse's open front), not only near the hero.
  const floorish = (k: number): boolean => k === FINE.FLOOR || k === FINE.LIQUID || k === FINE.PIT || k === FINE.PILLAR;
  const front = new Uint8Array(FN);
  for (let fz = 0; fz < fd; fz += 1) for (let fx = 0; fx < fw; fx += 1) {
    const q = fz * fw + fx;
    if (fine[q] !== FINE.WALL) continue;
    let behind = false, before = false;
    for (let d2 = 1; d2 <= 4 && !behind; d2 += 1) behind = floorish(kindAt(fx + d2, fz)) || floorish(kindAt(fx, fz + d2)) || floorish(kindAt(fx + d2, fz + d2));
    // (Floor right before it -- a metre -- makes it some other room's back wall; a nook further off doesn't: a thick
    // wall's far side goes low with the rest of the front, never left standing as a black slab.)
    // (A chasm before it is no room: a wall on a pit's far rim, seen across the drop, goes low too.)
    const ground = (k: number): boolean => k === FINE.FLOOR || k === FINE.LIQUID || k === FINE.PILLAR;
    for (let d2 = 1; d2 <= 2 && !before; d2 += 1) before = ground(kindAt(fx - d2, fz)) || ground(kindAt(fx, fz - d2));
    if (behind && !before) front[q] = 1;
  }
  for (let fz = 0; fz < fd; fz += 1) for (let fx = 0; fx < fw; fx += 1) {
    const q = fz * fw + fx;
    if (fine[q] !== FINE.WALL) continue;
    columns += 1;
    const H = height[q]!, x = fx * fs, z = fz * fs, cx = x + fs / 2, cz = z + fs / 2;
    const seed = Math.floor(hash01(fx, fz, 5) * 256);
    // (Its top's open edges toward the camera: the rim the renderer lights.)
    const rim = (kindAt(fx - 1, fz) !== FINE.WALL ? 1 : 0) | (kindAt(fx, fz - 1) !== FINE.WALL ? 2 : 0);
    const fr = front[q] ? 32 : 0;
    push(QUAD.CAP, MAT.CAP, x, H, z, fs, 0, 0, 0, 0, fs, seed, rim | fr, cx, cz);
    for (const dir of [3, 2]) {
      const ax = fx + (dir === 2 ? -1 : 0), az = fz + (dir === 3 ? -1 : 0);
      const nk = kindAt(ax, az);
      // (Face along +x at the column's -z edge (normal -z), or along -z at its -x edge (normal -x).)
      const px = x, pz = dir === 3 ? z : z + fs, ux = dir === 3 ? fs : 0, uz = dir === 3 ? 0 : -fs;
      if (nk === FINE.WALL) {
        const Hn = height[az * fw + ax]!;
        push(QUAD.INNER, MAT.WALL, px, Hn, pz, ux, 0, uz, 0, H - Hn, 0, seed, dir | fr | (front[az * fw + ax] ? 64 : 0), cx, cz, ax * fs + fs / 2, az * fs + fs / 2);
      } else {
        // (A wall stands on the floor, in a pool, over a pit's drop, or on the bedrock the dungeon is cut from.)
        const yb = nk === FINE.FLOOR || nk === FINE.PILLAR || nk === FINE.VOID ? 0 : nk === FINE.LIQUID ? -0.28 : -abyss;
        // (bits: the direction it faces, +16 when it's a wall's back -- facing the bedrock, not a room.)
        push(QUAD.FACE, MAT.WALL, px, yb, pz, ux, 0, uz, 0, H - yb, 0, seed, dir | (nk === FINE.VOID ? 16 : 0) | fr, cx, cz);
      }
    }
  }

  // Pillars: a plinth, an eight-sided shaft, a capital -- cut as one column.
  const OCT = 8;
  for (const k of S.pillars) {
    const i = k % w, j = Math.floor(k / w);
    const cx = (i + 0.5) * tile, cz = (j + 0.5) * tile, H = h1;
    const seed = S.variant[k]!;
    for (let f = 0; f < 4; f += 1) { const q = (j * sub + 1 + (f >> 1)) * fw + i * sub + 1 + (f & 1); fine[q] = FINE.PILLAR; height[q] = H; }
    const box = (hx: number, y0: number, y1: number, mat: number): void => {
      push(QUAD.CAP, mat, cx - hx, y1, cz - hx, hx * 2, 0, 0, 0, 0, hx * 2, seed, 1, cx, cz);
      push(QUAD.FACE, mat, cx - hx, y0, cz - hx, hx * 2, 0, 0, 0, y1 - y0, 0, seed, 3, cx, cz);
      push(QUAD.FACE, mat, cx - hx, y0, cz + hx, 0, 0, -hx * 2, 0, y1 - y0, 0, seed, 2, cx, cz);
    };
    box(0.62, 0, 0.32, MAT.TRIM);
    const r = 0.42;
    for (let s = 0; s < OCT; s += 1) {
      const a0 = (s / OCT) * Math.PI * 2 + Math.PI / OCT, a1 = ((s + 1) / OCT) * Math.PI * 2 + Math.PI / OCT;
      const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      // (Faces whose outward normal leans toward the camera, -x -z.)
      const nx = Math.cos((a0 + a1) / 2), nz = Math.sin((a0 + a1) / 2);
      if (nx + nz > 0.05) continue;
      // (U so that up x U is the outward normal: from the first point to the second.)
      push(QUAD.FACE, MAT.PILLAR, x0, 0.32, z0, x1 - x0, 0, z1 - z0, 0, H - 0.62, 0, seed, 8 + s, cx, cz);
    }
    box(0.58, H - 0.3, H, MAT.TRIM);
  }

  // Doors: the arched lintel over the way through (cut like a column), its frame, and where the leaves stand.
  const doors: SceneDoor[] = [];
  S.doors.forEach((dr, index) => {
    const x0 = dr.i * tile, z0 = dr.j * tile, H = h1;
    const cx = x0 + tile / 2, cz = z0 + tile / 2;
    const seed = S.variant[dr.cell]!;
    // (In a front wall when the wall columns beside it are: its lintel, jambs and leaves go low with them.)
    // (Any of the wall's columns either side of it, a metre out and through its depth: the doorway's own floor makes the
    // nearest ones look like some room's back wall.)
    const fxs: number[][] = [];
    for (let t = 0; t < sub; t += 1) for (const o of [-1, -2, sub, sub + 1]) fxs.push(dr.axis === 1 ? [dr.i * sub + o, dr.j * sub + t] : [dr.i * sub + t, dr.j * sub + o]);
    const isFront = fxs.some(([a, b]) => a! >= 0 && b! >= 0 && a! < fw && b! < fd && front[b! * fw + a!] === 1);
    const F = isFront ? 32 : 0;
    doors.push({ index, x0, z0, axis: dr.axis, locked: dr.locked, at: tile / 2, front: isFront });
    if (!dr.jambs) return;
    if (dr.axis === 1) {
      // The way runs along z: the lintel spans x, its face toward the camera at the cell's -z edge.
      push(QUAD.FACE, MAT.LINTEL, x0, 1.45, z0, tile, 0, 0, 0, H - 1.45, 0, seed, 3 | F, cx, cz);
      push(QUAD.CAP, MAT.CAP, x0, H, z0, tile, 0, 0, 0, 0, tile, seed, F, cx, cz);
      // Jambs: dressed stone at both sides of the opening.
      push(QUAD.FACE, MAT.TRIM, x0, 0, z0, 0.22, 0, 0, 0, 1.5, 0, seed, 3 | F, cx, cz);
      push(QUAD.FACE, MAT.TRIM, x0 + tile - 0.22, 0, z0, 0.22, 0, 0, 0, 1.5, 0, seed, 3 | F, cx, cz);
      push(QUAD.FACE, MAT.TRIM, x0 + tile - 0.22, 0, z0 + tile, 0, 0, -tile, 0, 1.5, 0, seed, 2 | F, cx, cz);
    } else {
      push(QUAD.FACE, MAT.LINTEL, x0, 1.45, z0 + tile, 0, 0, -tile, 0, H - 1.45, 0, seed, 2 | F, cx, cz);
      push(QUAD.CAP, MAT.CAP, x0, H, z0, tile, 0, 0, 0, 0, tile, seed, F, cx, cz);
      push(QUAD.FACE, MAT.TRIM, x0, 0, z0 + tile, 0, 0, -0.22, 0, 1.5, 0, seed, 2 | F, cx, cz);
      push(QUAD.FACE, MAT.TRIM, x0, 0, z0 + 0.22, 0, 0, -0.22, 0, 1.5, 0, seed, 2 | F, cx, cz);
      push(QUAD.FACE, MAT.TRIM, x0, 0, z0 + tile - 0.22, tile, 0, 0, 0, 1.5, 0, seed, 3 | F, cx, cz);
    }
  });

  // Stairs up: steps rising to the wall, a dark way on up through it.
  if (S.stairsUp) {
    const { i, j, dir } = S.stairsUp;
    const x0 = i * tile, z0 = j * tile, steps = 6, rise = 0.24, run = tile / steps;
    for (let s = 0; s < steps; s += 1) {
      const y = (s + 1) * rise;
      if (dir === 1) {
        push(QUAD.FLAT, MAT.STAIR, x0, y, z0 + s * run, tile, 0, 0, 0, 0, run, s, 1);
        push(QUAD.FREE, MAT.STAIR, x0, y - rise, z0 + s * run, tile, 0, 0, 0, rise, 0, s, 2);
        push(QUAD.FREE, MAT.TRIM, x0, 0, z0 + (s + 1) * run, 0, 0, -run, 0, y, 0, s, 0);
      } else {
        push(QUAD.FLAT, MAT.STAIR, x0 + s * run, y, z0, run, 0, 0, 0, 0, tile, s, 1);
        push(QUAD.FREE, MAT.STAIR, x0 + s * run, y - rise, z0 + tile, 0, 0, -tile, 0, rise, 0, s, 2);
        push(QUAD.FREE, MAT.TRIM, x0 + s * run, 0, z0, run, 0, 0, 0, y, 0, s, 0);
      }
    }
    // (The way up: a dark arch on the wall's face, a hair in front of it.)
    if (dir === 1) push(QUAD.FREE, MAT.OPENING, x0 + 0.25, 1.2, z0 + tile - 0.03, tile - 0.5, 0, 0, 0, 1.5, 0, 0, 0);
    else push(QUAD.FREE, MAT.OPENING, x0 + tile - 0.03, 1.2, z0 + tile - 0.25, 0, 0, -(tile - 0.5), 0, 1.5, 0, 0, 0);
  }
  // Stairs down: steps going away from the camera into the dark, the well's walls round them.
  if (S.stairsDown) {
    const { i, j, dir } = S.stairsDown;
    // (Shallower than the camera looks down -- 30 degrees -- or the near rim hides every tread.)
    const x0 = i * tile, z0 = j * tile, steps = 7, drop = 0.13, run = tile / steps;
    for (let s = 0; s < steps; s += 1) {
      const y = -(s + 1) * drop;
      if (dir === 1) { push(QUAD.FLAT, MAT.STAIR, x0, y, z0 + s * run, tile, 0, 0, 0, 0, run, s, 3); push(QUAD.FREE, MAT.STAIR, x0, y, z0 + s * run, tile, 0, 0, 0, drop, 0, s, 2); }
      else { push(QUAD.FLAT, MAT.STAIR, x0 + s * run, y, z0, run, 0, 0, 0, 0, tile, s, 3); push(QUAD.FREE, MAT.STAIR, x0 + s * run, y, z0 + tile, 0, 0, -tile, 0, drop, 0, s, 2); }
    }
    const deep = -(steps + 1) * drop;
    // (The well's side walls, and at its far end the way on down: a dark arch.)
    if (dir === 1) { push(QUAD.FREE, MAT.DROP, x0 + tile, deep, z0 + tile, 0, 0, -tile, 0, -deep, 0, 1, 0); push(QUAD.FREE, MAT.DROP, x0, deep, z0 + tile, tile, 0, 0, 0, -deep, 0, 1, 0); push(QUAD.FREE, MAT.OPENING, x0 + 0.25, deep - 1.1, z0 + tile - 0.02, tile - 0.5, 0, 0, 0, 1.5, 0, 0, 0); }
    else { push(QUAD.FREE, MAT.DROP, x0, deep, z0 + tile, tile, 0, 0, 0, -deep, 0, 1, 0); push(QUAD.FREE, MAT.DROP, x0 + tile, deep, z0 + tile, 0, 0, -tile, 0, -deep, 0, 1, 0); push(QUAD.FREE, MAT.OPENING, x0 + tile - 0.02, deep - 1.1, z0 + tile - 0.25, 0, 0, -(tile - 0.5), 0, 1.5, 0, 0, 0); }
  }

  // ---------------------------------------------------------------- walking
  const walk = new Uint8Array(FN);
  for (let q = 0; q < FN; q += 1) {
    const k = cellOf(q % fw, Math.floor(q / fw)), f = S.floor[k]!;
    walk[q] = fine[q] === FINE.FLOOR && f !== FLOOR.STAIRS_UP ? 1 : f === FLOOR.BRIDGE ? 1 : 0;
  }
  for (const p of S.props) {
    if (!p.block) continue;
    const r = p.id === "sarcophagus" ? 0.7 : p.id === "table" ? 0.6 : p.id === "throne" ? 0.9 : p.id === "bookshelf" || p.id === "weapon-rack" ? 0.35 : 0.3;
    for (let fz = Math.floor((p.z - r) / fs); fz <= Math.floor((p.z + r) / fs); fz += 1) for (let fx = Math.floor((p.x - r) / fs); fx <= Math.floor((p.x + r) / fs); fx += 1) {
      if (fx < 0 || fz < 0 || fx >= fw || fz >= fd) continue;
      if (Math.hypot((fx + 0.5) * fs - p.x, (fz + 0.5) * fs - p.z) <= r + fs * 0.35) walk[fz * fw + fx] = 0;
    }
  }

  // ---------------------------------------------------------------- flames
  const flames: SceneFlame[] = [];
  S.lights.forEach((L, li) => { if (L.flame) flames.push({ x: L.x, y: L.y, z: L.z, kind: FLAME_KIND[L.kind] ?? 0, size: L.kind === "brazier" ? 1 : L.kind === "candle" ? 0.28 : L.kind === "sconce" ? 0.7 : 0.62, seed: L.seed, light: li }); });

  return { w, d, tile, fw, fd, fine, height, walk, quads: data.subarray(0, n * QUAD_FLOATS), count: n, flames, doors, abyss, stats: { quads: n, floors, columns, pillars: S.pillars.length, doors: doors.length, flames: flames.length } };
}

/** Is a world point walkable (the fine grid)? Doors are the game's business. */
export function walkableAt(s: DungeonScene, x: number, z: number): boolean {
  const fs = s.tile / SUB;
  const fx = Math.floor(x / fs), fz = Math.floor(z / fs);
  return fx >= 0 && fz >= 0 && fx < s.fw && fz < s.fd && s.walk[fz * s.fw + fx] === 1;
}

/** The decor bits' names (for tools). */
export const DECOR_NAMES: Readonly<Record<number, string>> = Object.fromEntries(Object.entries(DECOR).map(([k, v]) => [v, k.toLowerCase()]));
