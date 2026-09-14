// Mesh -> voxels. Every node's triangles are voxelised on their own (so a
// helmet stays a helmet where it overlaps the head, and a grip inside a hand
// stays the sword's):
//
//   surface  every cell a triangle touches (the exact triangle-box overlap
//            test: a closed surface is 6-separating, so filling can't leak)
//   solid    "flood" (default): whatever the outside can't reach, flooding
//            from the node's padded bounds; "parity": a cell centre is inside
//            when rays along x, y and z (two of three) cross the surface an
//            odd number of times (for shells with small gaps); "none"
//   merge    where nodes overlap, a surface beats an interior, then the
//            nearer triangle wins
//
// Each cell keeps where it came from -- node, mesh, material, the colour at
// the nearest point of the nearest triangle (base colour x texture at its uv x
// vertex colour), the dominant skin joint and its weight -- interior cells
// from the surface cell they were reached from. That is what segmentation and
// role clustering read. A .vox needs none of this: its cells are the grid.
//
//   const grid = voxelize(scene, { voxels: 48 });       // 48 along the longest side
//   voxelize(scene, { unit: 0.05 });                     // 5 cm cells
//   voxelize(scene, { height: 1.8, voxels: 64 });        // sized to 1.8 m tall first

import type { V3 } from "./math.ts";
import { ImportError, sampleTexture, soupOf } from "./scene.ts";
import type { ImportScene, Soup, SoupOptions } from "./scene.ts";

export interface VoxelizeOptions extends SoupOptions {
  /** Cells along the longest side (default 48). */
  readonly voxels?: number;
  /** Cells up the height (instead of `voxels`). */
  readonly tall?: number;
  /** Metres per cell (instead of either). */
  readonly unit?: number;
  /** Size the model to this many metres tall first (OBJ/STL units are anyone's guess). */
  readonly height?: number;
  readonly fill?: "flood" | "parity" | "none";
  /** "thin" (default): surface cells the surface only grazes are dropped where they look outside; "conservative": every touched cell. */
  readonly surface?: "thin" | "conservative";
  /** Most cells allowed (default 4 million) -- a guard against a unit far too small. */
  readonly maxCells?: number;
}

/** The voxels, dense over their box, and where each came from. Index x + sx * (y + sy * z). */
export interface VoxelGrid {
  readonly size: V3;
  /** Metres per cell. */
  readonly unit: number;
  /** Where cell (0, 0, 0)'s low corner is (engine frame, metres). */
  readonly origin: V3;
  /** 0 empty, 1 surface, 2 interior. */
  readonly occ: Uint8Array;
  readonly node: Int32Array;
  readonly mesh: Int32Array;
  /** Material index (a .vox: the palette index), -1 none. */
  readonly material: Int32Array;
  /** Linear RGB per cell. */
  readonly colour: Float32Array;
  /** Dominant skin joint (a node index), -1 none; and its weight. */
  readonly joint: Int32Array;
  readonly weight: Float32Array;
  /** Cells to the surface (0 on it). */
  readonly depth: Uint16Array;
  readonly nodeNames: readonly string[];
  readonly materialNames: readonly string[];
  /** Materials that glow (emissive). */
  readonly emissive: ReadonlySet<number>;
  readonly skinned: boolean;
  /** Metres per source unit as voxelised (the scene's own, times `scale`, times the `height` sizing): joints map with it. */
  readonly scale: number;
  readonly stats: { readonly triangles: number; readonly surface: number; readonly interior: number; readonly ms?: number };
}

// ---------------------------------------------------------------- geometry

// Triangle-box overlap (Akenine-Moller): the box's three normals, the triangle's normal, and the nine edge cross products.
function triBox(c: V3, h: number, t: Float32Array, o: number): boolean {
  const v0x = t[o]! - c[0], v0y = t[o + 1]! - c[1], v0z = t[o + 2]! - c[2];
  const v1x = t[o + 3]! - c[0], v1y = t[o + 4]! - c[1], v1z = t[o + 5]! - c[2];
  const v2x = t[o + 6]! - c[0], v2y = t[o + 7]! - c[1], v2z = t[o + 8]! - c[2];
  if (Math.min(v0x, v1x, v2x) > h || Math.max(v0x, v1x, v2x) < -h) return false;
  if (Math.min(v0y, v1y, v2y) > h || Math.max(v0y, v1y, v2y) < -h) return false;
  if (Math.min(v0z, v1z, v2z) > h || Math.max(v0z, v1z, v2z) < -h) return false;
  const e0x = v1x - v0x, e0y = v1y - v0y, e0z = v1z - v0z;
  const e1x = v2x - v1x, e1y = v2y - v1y, e1z = v2z - v1z;
  const e2x = v0x - v2x, e2y = v0y - v2y, e2z = v0z - v2z;
  const nx = e0y * e1z - e0z * e1y, ny = e0z * e1x - e0x * e1z, nz = e0x * e1y - e0y * e1x;
  const d = nx * v0x + ny * v0y + nz * v0z;
  const r = h * (Math.abs(nx) + Math.abs(ny) + Math.abs(nz));
  if (d > r || d < -r) return false;
  const axis = (ax: number, ay: number, az: number): boolean => {
    const p0 = ax * v0x + ay * v0y + az * v0z, p1 = ax * v1x + ay * v1y + az * v1z, p2 = ax * v2x + ay * v2y + az * v2z;
    const rad = h * (Math.abs(ax) + Math.abs(ay) + Math.abs(az));
    return !(Math.min(p0, p1, p2) > rad || Math.max(p0, p1, p2) < -rad);
  };
  for (const [ex, ey, ez] of [[e0x, e0y, e0z], [e1x, e1y, e1z], [e2x, e2y, e2z]] as const) {
    if (!axis(0, -ez, ey) || !axis(ez, 0, -ex) || !axis(-ey, ex, 0)) return false;
  }
  return true;
}

/** The closest point on triangle o of `t` to p, as barycentric weights (Ericson), and the squared distance. */
function closest(p: V3, t: Float32Array, o: number): { u: number; v: number; w: number; d2: number } {
  const ax = t[o]!, ay = t[o + 1]!, az = t[o + 2]!;
  const abx = t[o + 3]! - ax, aby = t[o + 4]! - ay, abz = t[o + 5]! - az;
  const acx = t[o + 6]! - ax, acy = t[o + 7]! - ay, acz = t[o + 8]! - az;
  const apx = p[0] - ax, apy = p[1] - ay, apz = p[2] - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const at = (u: number, v: number, w: number) => {
    const qx = ax * u + (ax + abx) * v + (ax + acx) * w, qy = ay * u + (ay + aby) * v + (ay + acy) * w, qz = az * u + (az + abz) * v + (az + acz) * w;
    return { u, v, w, d2: (p[0] - qx) ** 2 + (p[1] - qy) ** 2 + (p[2] - qz) ** 2 };
  };
  if (d1 <= 0 && d2 <= 0) return at(1, 0, 0);
  const bpx = p[0] - (ax + abx), bpy = p[1] - (ay + aby), bpz = p[2] - (az + abz);
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return at(0, 1, 0);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return at(1 - v, v, 0); }
  const cpx = p[0] - (ax + acx), cpy = p[1] - (ay + acy), cpz = p[2] - (az + acz);
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return at(0, 0, 1);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return at(1 - w, 0, w); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return at(0, 1 - w, w); }
  const den = 1 / (va + vb + vc);
  const v = vb * den, w = vc * den;
  return at(1 - v - w, v, w);
}

// ---------------------------------------------------------------- the grid

function blank(size: V3, unit: number, origin: V3, extra: Pick<VoxelGrid, "nodeNames" | "materialNames" | "emissive" | "skinned">): Omit<VoxelGrid, "stats" | "scale"> {
  const n = size[0] * size[1] * size[2];
  return {
    size, unit, origin, occ: new Uint8Array(n), node: new Int32Array(n).fill(-1), mesh: new Int32Array(n).fill(-1), material: new Int32Array(n).fill(-1),
    colour: new Float32Array(n * 3), joint: new Int32Array(n).fill(-1), weight: new Float32Array(n), depth: new Uint16Array(n), ...extra,
  };
}

/** A scene as voxels (see the top). */
export function voxelize(scene: ImportScene, opts: VoxelizeOptions = {}): VoxelGrid {
  if (scene.voxels) return gridFromVox(scene);
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const soup0 = soupOf(scene, opts);
  if (!soup0.count) throw new ImportError(scene.format, "no triangles to voxelise");
  // Bounds, and the unit.
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < soup0.count * 3; i += 1) for (let k = 0; k < 3; k += 1) { const v = soup0.positions[i * 3 + k]!; if (v < lo[k]!) lo[k] = v; if (v > hi[k]!) hi[k] = v; }
  let soup: Soup = soup0;
  let sizing = 1;
  if (opts.height) {
    const k = opts.height / Math.max(1e-9, hi[1] - lo[1]);
    sizing = k;
    const positions = Float32Array.from(soup0.positions, (v) => v * k);
    soup = { ...soup0, positions };
    for (let a = 0; a < 3; a += 1) { lo[a]! *= k; hi[a]! *= k; }
  }
  const ext: V3 = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const longest = Math.max(...ext, 1e-9);
  const unit = opts.unit ?? (opts.tall ? Math.max(ext[1], 1e-9) / opts.tall : longest / (opts.voxels ?? 48));
  if (!(unit > 0)) throw new RangeError("voxelize: the unit must be positive");
  const size: V3 = [Math.max(1, Math.ceil(ext[0] / unit - 1e-6)), Math.max(1, Math.ceil(ext[1] / unit - 1e-6)), Math.max(1, Math.ceil(ext[2] / unit - 1e-6))];
  const cells = size[0] * size[1] * size[2];
  if (cells > (opts.maxCells ?? 4_000_000)) throw new RangeError(`voxelize: ${size.join(" x ")} = ${cells} cells is too many -- a bigger unit, or fewer voxels`);
  // (The model is centred on x and z by the builder later; the grid starts at the bounds' low corner.)
  const origin: V3 = [lo[0] - (size[0] * unit - ext[0]) / 2, lo[1], lo[2] - (size[2] * unit - ext[2]) / 2];
  const emissive = new Set<number>();
  scene.materials.forEach((m, i) => { if (m.emissive && m.emissive[0] + m.emissive[1] + m.emissive[2] > 0.3) emissive.add(i); });
  const g = blank(size, unit, origin, { nodeNames: scene.nodes.map((n) => n.name), materialNames: scene.materials.map((m) => m.name), emissive, skinned: soup.skinned });
  const [sx, sy, sz] = size;
  const rank = new Float32Array(cells).fill(Infinity);
  const srcTri = new Int32Array(cells).fill(-1);
  const srcCell = new Int32Array(cells).fill(-1);
  const P = soup.positions;
  // Triangles by node.
  const byNode = new Map<number, number[]>();
  for (let t = 0; t < soup.count; t += 1) { const n = soup.node[t]!; const l = byNode.get(n) ?? []; l.push(t); byNode.set(n, l); }
  const half = unit / 2;
  for (const [node, tris] of [...byNode].sort((a, b) => a[0] - b[0])) {
    // The node's own box of cells, padded by one.
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const t of tris) for (let c = 0; c < 3; c += 1) {
      const o = (t * 3 + c) * 3;
      x0 = Math.min(x0, P[o]!); x1 = Math.max(x1, P[o]!); y0 = Math.min(y0, P[o + 1]!); y1 = Math.max(y1, P[o + 1]!); z0 = Math.min(z0, P[o + 2]!); z1 = Math.max(z1, P[o + 2]!);
    }
    const cell = (v: number, a: number): number => Math.max(0, Math.min(size[a]! - 1, Math.floor((v - origin[a]!) / unit)));
    const bx0 = cell(x0, 0) - 1, by0 = cell(y0, 1) - 1, bz0 = cell(z0, 2) - 1;
    const lx = cell(x1, 0) + 1 - bx0 + 1, ly = cell(y1, 1) + 1 - by0 + 1, lz = cell(z1, 2) + 1 - bz0 + 1;
    const L = lx * ly * lz;
    const li = (x: number, y: number, z: number): number => x + lx * (y + ly * z);
    const surf = new Uint8Array(L);
    const best = new Float32Array(L).fill(Infinity);
    const bestTri = new Int32Array(L).fill(-1);
    const tv = new Float32Array(9);
    for (const t of tris) {
      for (let k = 0; k < 9; k += 1) tv[k] = P[t * 9 + k]!;
      const mnx = cell(Math.min(tv[0]!, tv[3]!, tv[6]!), 0), mxx = cell(Math.max(tv[0]!, tv[3]!, tv[6]!), 0);
      const mny = cell(Math.min(tv[1]!, tv[4]!, tv[7]!), 1), mxy = cell(Math.max(tv[1]!, tv[4]!, tv[7]!), 1);
      const mnz = cell(Math.min(tv[2]!, tv[5]!, tv[8]!), 2), mxz = cell(Math.max(tv[2]!, tv[5]!, tv[8]!), 2);
      // (A degenerate triangle -- zero area -- still marks the cells it passes through, by its points.)
      for (let z = mnz; z <= mxz; z += 1) for (let y = mny; y <= mxy; y += 1) for (let x = mnx; x <= mxx; x += 1) {
        const c: V3 = [origin[0] + (x + 0.5) * unit, origin[1] + (y + 0.5) * unit, origin[2] + (z + 0.5) * unit];
        if (!triBox(c, half * 1.0001, tv, 0)) continue;
        const k = li(x - bx0, y - by0, z - bz0);
        surf[k] = 1;
        const d2 = closest(c, tv, 0).d2;
        if (d2 < best[k]!) { best[k] = d2; bestTri[k] = t; }
      }
    }
    // Solid: flood the outside from the padded box's faces (6-connected); or parity rays.
    const inside = new Uint8Array(L);
    const fill = opts.fill ?? "flood";
    if (fill === "flood") {
      const out = new Uint8Array(L);
      const stack: number[] = [];
      for (let z = 0; z < lz; z += 1) for (let y = 0; y < ly; y += 1) for (let x = 0; x < lx; x += 1) {
        if (x && y && z && x < lx - 1 && y < ly - 1 && z < lz - 1) continue;
        const k = li(x, y, z);
        if (!surf[k] && !out[k]) { out[k] = 1; stack.push(k); }
      }
      while (stack.length) {
        const k = stack.pop()!;
        const x = k % lx, y = Math.floor(k / lx) % ly, z = Math.floor(k / (lx * ly));
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (nx < 0 || ny < 0 || nz < 0 || nx >= lx || ny >= ly || nz >= lz) continue;
          const q = li(nx, ny, nz);
          if (surf[q] || out[q]) continue;
          out[q] = 1;
          stack.push(q);
        }
      }
      for (let k = 0; k < L; k += 1) if (!surf[k] && !out[k]) inside[k] = 1;
    } else if (fill === "parity") parityFill(tris, P, origin, unit, [bx0, by0, bz0], [lx, ly, lz], surf, inside);
    // Thin: a surface cell the surface only grazes (its centre more than half a cell from it) and that looks onto the
    // outside is dropped -- the conservative test fattens everything by up to a cell, and a band half a cell either
    // side of the surface is still a closed skin.
    if ((opts.surface ?? "thin") === "thin" && fill !== "none") {
      const lim = (unit * 0.5) ** 2 * 1.0001;
      const drop: number[] = [];
      for (let z = 1; z < lz - 1; z += 1) for (let y = 1; y < ly - 1; y += 1) for (let x = 1; x < lx - 1; x += 1) {
        const k = li(x, y, z);
        if (!surf[k] || best[k]! <= lim) continue;
        const outside = (q: number): boolean => !surf[q] && !inside[q];
        if (outside(k + 1) || outside(k - 1) || outside(k + lx) || outside(k - lx) || outside(k + lx * ly) || outside(k - lx * ly)) drop.push(k);
      }
      for (const k of drop) surf[k] = 0;
    }
    // Depth (cells to this node's surface) and each interior cell's surface source, by BFS from the surface.
    const depth = new Uint16Array(L);
    const from = new Int32Array(L).fill(-1);
    let frontier: number[] = [];
    for (let k = 0; k < L; k += 1) if (surf[k]) { frontier.push(k); from[k] = k; }
    for (let dd = 1; frontier.length; dd += 1) {
      const next: number[] = [];
      for (const k of frontier) {
        const x = k % lx, y = Math.floor(k / lx) % ly, z = Math.floor(k / (lx * ly));
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (nx < 0 || ny < 0 || nz < 0 || nx >= lx || ny >= ly || nz >= lz) continue;
          const q = li(nx, ny, nz);
          if (!inside[q] || from[q]! >= 0) continue;
          from[q] = from[k]!; depth[q] = Math.min(65535, dd);
          next.push(q);
        }
      }
      frontier = next;
    }
    // Merge into the grid: a surface beats an interior, then the nearer triangle.
    for (let z = 0; z < lz; z += 1) for (let y = 0; y < ly; y += 1) for (let x = 0; x < lx; x += 1) {
      const k = li(x, y, z);
      if (!surf[k] && !inside[k]) continue;
      const gx = x + bx0, gy = y + by0, gz = z + bz0;
      if (gx < 0 || gy < 0 || gz < 0 || gx >= sx || gy >= sy || gz >= sz) continue;
      const gi = gx + sx * (gy + sy * gz);
      const r = surf[k] ? Math.sqrt(best[k]!) / unit : 1 + depth[k]!;
      if (r >= rank[gi]!) continue;
      rank[gi] = r;
      const src = from[k]!;
      g.occ[gi] = surf[k] ? 1 : 2;
      g.depth[gi] = surf[k] ? 0 : depth[k]!;
      g.node[gi] = node;
      srcTri[gi] = bestTri[src >= 0 ? src : k]!;
      // (Where to sample: this cell's centre on the surface, the source surface cell's centre inside.)
      srcCell[gi] = -1;
      if (!surf[k] && src >= 0) {
        const sx2 = src % lx + bx0, sy2 = Math.floor(src / lx) % ly + by0, sz2 = Math.floor(src / (lx * ly)) + bz0;
        if (sx2 >= 0 && sy2 >= 0 && sz2 >= 0 && sx2 < sx && sy2 < sy && sz2 < sz) srcCell[gi] = sx2 + sx * (sy2 + sy * sz2);
      }
    }
  }
  // Sample every cell's source: material, colour, skin.
  for (let gi = 0; gi < cells; gi += 1) {
    const t = srcTri[gi]!;
    if (!g.occ[gi] || t < 0) continue;
    const si = srcCell[gi]! >= 0 ? srcCell[gi]! : gi;
    const at = [si % sx, Math.floor(si / sx) % sy, Math.floor(si / (sx * sy))] as const;
    const c: V3 = [origin[0] + (at[0] + 0.5) * unit, origin[1] + (at[1] + 0.5) * unit, origin[2] + (at[2] + 0.5) * unit];
    const b = closest(c, P, t * 9);
    const mat = soup.material[t]!;
    g.mesh[gi] = soup.mesh[t]!;
    g.material[gi] = mat;
    const m = mat >= 0 ? scene.materials[mat] : undefined;
    let r = m ? m.colour[0] : 0.8, gg = m ? m.colour[1] : 0.8, bb = m ? m.colour[2] : 0.8;
    const w = [b.u, b.v, b.w];
    let vr = 0, vg = 0, vb = 0;
    for (let k = 0; k < 3; k += 1) { const o = (t * 3 + k) * 4; vr += soup.colours[o]! * w[k]!; vg += soup.colours[o + 1]! * w[k]!; vb += soup.colours[o + 2]! * w[k]!; }
    r *= vr; gg *= vg; bb *= vb;
    if (m?.texture) {
      let u = 0, v = 0;
      for (let k = 0; k < 3; k += 1) { u += soup.uvs[(t * 3 + k) * 2]! * w[k]!; v += soup.uvs[(t * 3 + k) * 2 + 1]! * w[k]!; }
      const s = sampleTexture(scene, m.texture.texture, u, v);
      r *= s[0]; gg *= s[1]; bb *= s[2];
    }
    g.colour[gi * 3] = r; g.colour[gi * 3 + 1] = gg; g.colour[gi * 3 + 2] = bb;
    if (soup.skinned) {
      const acc = new Map<number, number>();
      for (let k = 0; k < 3; k += 1) for (let j = 0; j < 4; j += 1) {
        const o = (t * 3 + k) * 4 + j;
        const jn = soup.joints[o]!;
        if (jn >= 0) acc.set(jn, (acc.get(jn) ?? 0) + soup.weights[o]! * w[k]!);
      }
      let bj = -1, bw = 0;
      for (const [jn, ww] of acc) if (ww > bw || (ww === bw && jn < bj)) { bj = jn; bw = ww; }
      g.joint[gi] = bj; g.weight[gi] = bw;
    }
  }
  let surface = 0, interior = 0;
  for (let i = 0; i < cells; i += 1) { if (g.occ[i] === 1) surface += 1; else if (g.occ[i] === 2) interior += 1; }
  const ms = typeof performance !== "undefined" ? performance.now() - t0 : 0;
  return { ...g, scale: scene.metres * (opts.scale ?? 1) * sizing, stats: { triangles: soup.count, surface, interior, ms: Math.round(ms) } };
}

// Parity: along each axis, a cell centre's ray crosses the node's triangles; odd crossings from one side is inside. Two of three axes decide.
function parityFill(tris: readonly number[], P: Float32Array, origin: V3, unit: number, b0: V3, ls: V3, surf: Uint8Array, inside: Uint8Array): void {
  const [lx, ly, lz] = ls;
  const votes = new Uint8Array(lx * ly * lz);
  for (const ax of [0, 1, 2] as const) {
    const u = (ax + 1) % 3, v = (ax + 2) % 3;
    const nu = ls[u]!, nv = ls[v]!;
    const hits = new Map<number, number[]>();
    for (const t of tris) {
      const o = t * 9;
      const pu = [P[o + u]!, P[o + 3 + u]!, P[o + 6 + u]!], pv = [P[o + v]!, P[o + 3 + v]!, P[o + 6 + v]!], pa = [P[o + ax]!, P[o + 3 + ax]!, P[o + 6 + ax]!];
      const area = (pu[1]! - pu[0]!) * (pv[2]! - pv[0]!) - (pu[2]! - pu[0]!) * (pv[1]! - pv[0]!);
      if (Math.abs(area) < 1e-18) continue;
      const cu0 = Math.max(0, Math.floor((Math.min(...pu) - origin[u]!) / unit - 0.5) - b0[u]!), cu1 = Math.min(nu - 1, Math.ceil((Math.max(...pu) - origin[u]!) / unit - 0.5) - b0[u]!);
      const cv0 = Math.max(0, Math.floor((Math.min(...pv) - origin[v]!) / unit - 0.5) - b0[v]!), cv1 = Math.min(nv - 1, Math.ceil((Math.max(...pv) - origin[v]!) / unit - 0.5) - b0[v]!);
      for (let cv = cv0; cv <= cv1; cv += 1) for (let cu = cu0; cu <= cu1; cu += 1) {
        // (A tiny offset keeps a ray off shared edges, so a crossing counts once.)
        const qu = origin[u]! + (cu + b0[u]! + 0.5) * unit + unit * 1.3e-4, qv = origin[v]! + (cv + b0[v]! + 0.5) * unit + unit * 2.7e-4;
        const w0 = ((pu[1]! - qu) * (pv[2]! - qv) - (pu[2]! - qu) * (pv[1]! - qv)) / area;
        const w1 = ((pu[2]! - qu) * (pv[0]! - qv) - (pu[0]! - qu) * (pv[2]! - qv)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const key = cu + nu * cv;
        const list = hits.get(key) ?? [];
        list.push(w0 * pa[0]! + w1 * pa[1]! + w2 * pa[2]!);
        hits.set(key, list);
      }
    }
    for (const [key, list] of hits) {
      list.sort((a, b) => a - b);
      const cu = key % nu, cv = Math.floor(key / nu);
      for (let i = 0; i + 1 < list.length; i += 2) {
        const a0 = Math.ceil((list[i]! - origin[ax]!) / unit - 0.5) - b0[ax]!, a1 = Math.floor((list[i + 1]! - origin[ax]!) / unit - 0.5) - b0[ax]!;
        for (let a = Math.max(0, a0); a <= Math.min(ls[ax]! - 1, a1); a += 1) {
          const p: V3 = [0, 0, 0];
          p[ax] = a; p[u] = cu; p[v] = cv;
          votes[p[0] + lx * (p[1] + ly * p[2])]! += 1;
        }
      }
    }
  }
  for (let k = 0; k < votes.length; k += 1) if (votes[k]! >= 2 && !surf[k]) inside[k] = 1;
}

/** A .vox's cells as a grid: surface where a face is open, each model a node, each palette index a material. */
function gridFromVox(scene: ImportScene): VoxelGrid {
  const vs = scene.voxels!;
  const [sx, sy, sz] = vs.size;
  const g = blank([sx, sy, sz], scene.metres, [-(sx * scene.metres) / 2, 0, -(sz * scene.metres) / 2], {
    nodeNames: vs.modelNames, materialNames: Array.from({ length: 256 }, (_, i) => `colour ${i}`), emissive: new Set(), skinned: false,
  });
  const at = (x: number, y: number, z: number): number => (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : vs.cells[x + sx * (y + sy * z)]!);
  let surface = 0, interior = 0;
  for (let z = 0; z < sz; z += 1) for (let y = 0; y < sy; y += 1) for (let x = 0; x < sx; x += 1) {
    const i = x + sx * (y + sy * z);
    const ci = vs.cells[i]!;
    if (!ci) continue;
    const open = !at(x + 1, y, z) || !at(x - 1, y, z) || !at(x, y + 1, z) || !at(x, y - 1, z) || !at(x, y, z + 1) || !at(x, y, z - 1);
    g.occ[i] = open ? 1 : 2;
    if (open) surface += 1; else interior += 1;
    g.node[i] = vs.model[i]!; g.mesh[i] = vs.model[i]!; g.material[i] = ci;
    g.colour.set([vs.palette[ci * 4]!, vs.palette[ci * 4 + 1]!, vs.palette[ci * 4 + 2]!], i * 3);
  }
  return { ...g, scale: scene.metres, stats: { triangles: 0, surface, interior } };
}

/** Cell index helpers. */
export const cellIndex = (g: Pick<VoxelGrid, "size">, x: number, y: number, z: number): number => x + g.size[0] * (y + g.size[1] * z);
export const cellOf = (g: Pick<VoxelGrid, "size">, i: number): V3 => [i % g.size[0], Math.floor(i / g.size[0]) % g.size[1], Math.floor(i / (g.size[0] * g.size[1]))];
