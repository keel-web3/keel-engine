// Models built from parts: rounded polygons, lofts (an outline swept through depth, so bevels and chamfers are real
// geometry), lathes, ear-clipped caps, merge and transform. Every part is a MeshData: positions, normals, uvs, a baked
// ambient-occlusion channel (1 = open) and triangle indices. Nothing here touches GL.

import { type Mat4, type Vec2, normalMatrix, transformPoint } from "./math.ts";

export interface MeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  /** Per-vertex ambient occlusion, 1 = fully open (bakeAO fills it; builders start it at 1). */
  readonly ao: Float32Array;
  readonly indices: Uint32Array;
}

/** Accumulates vertices and triangles; `done()` freezes it into a MeshData. */
export class MeshBuilder {
  p: number[] = []; n: number[] = []; t: number[] = []; a: number[] = []; i: number[] = [];
  get count(): number { return this.p.length / 3; }
  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, v = 0, ao = 1): number {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.t.push(u, v); this.a.push(ao);
    return this.count - 1;
  }
  tri(a: number, b: number, c: number): void { this.i.push(a, b, c); }
  /** Append a whole mesh (its indices shifted). */
  append(m: MeshData): void {
    const base = this.count;
    for (const v of m.positions) this.p.push(v);
    for (const v of m.normals) this.n.push(v);
    for (const v of m.uvs) this.t.push(v);
    for (const v of m.ao) this.a.push(v);
    for (const v of m.indices) this.i.push(v + base);
  }
  done(): MeshData {
    return {
      positions: new Float32Array(this.p), normals: new Float32Array(this.n), uvs: new Float32Array(this.t),
      ao: new Float32Array(this.a), indices: new Uint32Array(this.i),
    };
  }
}

export const mergeMeshes = (...ms: MeshData[]): MeshData => { const b = new MeshBuilder(); for (const m of ms) b.append(m); return b.done(); };

/** The mesh moved by a matrix (normals by its normal matrix, renormalised). Triangles flip back if it mirrors. */
export function transformMesh(m: MeshData, mat: Mat4): MeshData {
  const n3 = normalMatrix(mat), pos = new Float32Array(m.positions.length), nor = new Float32Array(m.normals.length);
  for (let k = 0; k < m.positions.length; k += 3) {
    const q = transformPoint(mat, [m.positions[k]!, m.positions[k + 1]!, m.positions[k + 2]!]);
    pos[k] = q[0]; pos[k + 1] = q[1]; pos[k + 2] = q[2];
    const x = m.normals[k]!, y = m.normals[k + 1]!, z = m.normals[k + 2]!;
    const nx = n3[0]! * x + n3[3]! * y + n3[6]! * z, ny = n3[1]! * x + n3[4]! * y + n3[7]! * z, nz = n3[2]! * x + n3[5]! * y + n3[8]! * z;
    const l = Math.hypot(nx, ny, nz) || 1;
    nor[k] = nx / l; nor[k + 1] = ny / l; nor[k + 2] = nz / l;
  }
  const det = mat[0]! * (mat[5]! * mat[10]! - mat[9]! * mat[6]!) - mat[4]! * (mat[1]! * mat[10]! - mat[9]! * mat[2]!) + mat[8]! * (mat[1]! * mat[6]! - mat[5]! * mat[2]!);
  let indices = m.indices;
  if (det < 0) { indices = new Uint32Array(m.indices); for (let k = 0; k < indices.length; k += 3) { const s = indices[k + 1]!; indices[k + 1] = indices[k + 2]!; indices[k + 2] = s; } }
  return { positions: pos, normals: nor, uvs: m.uvs, ao: m.ao, indices };
}

export interface Bounds { readonly min: [number, number, number]; readonly max: [number, number, number] }
export function boundsOf(m: MeshData): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < m.positions.length; k += 3) for (let a = 0; a < 3; a += 1) {
    const v = m.positions[k + a]!; if (v < min[a]!) min[a] = v; if (v > max[a]!) max[a] = v;
  }
  return { min, max };
}

// ---------------------------------------------------------------------------------------------------------------
// Rounded polygons

/** A polygon (counter-clockwise, y up) whose every corner is an arc of its own radius. */
export interface RoundedPolygon {
  readonly points: readonly Vec2[];
  readonly radii: readonly number[];
}

/** Twice the signed area: positive when counter-clockwise. */
export function signedArea(pts: readonly Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i += 1) { const a = pts[i]!, b = pts[(i + 1) % pts.length]!; s += a[0] * b[1] - b[0] * a[1]; }
  return s;
}

/** The polygon moved inward by d (negative: outward). Convex corners' radii shrink by d, concave ones' grow, so an
 *  inset of a rounded polygon is the rounded polygon a bevel passes through. */
export function insetPolygon(poly: RoundedPolygon, d: number): RoundedPolygon {
  const P = poly.points, n = P.length, out: Vec2[] = [], radii: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = P[(i + n - 1) % n]!, b = P[i]!, c = P[(i + 1) % n]!;
    const d1 = dir(a, b), d2 = dir(b, c);
    // (Left normals point inward on a counter-clockwise outline.)
    const n1: Vec2 = [-d1[1], d1[0]], n2: Vec2 = [-d2[1], d2[0]];
    const p1: Vec2 = [a[0] + n1[0] * d, a[1] + n1[1] * d], p2: Vec2 = [b[0] + n2[0] * d, b[1] + n2[1] * d];
    out.push(intersect(p1, d1, p2, d2) ?? [b[0] + n1[0] * d, b[1] + n1[1] * d]);
    const convex = d1[0] * d2[1] - d1[1] * d2[0] > 0;
    radii.push(Math.max(0, (poly.radii[i] ?? 0) + (convex ? -d : d)));
  }
  return { points: out, radii };
}

function dir(a: Vec2, b: Vec2): Vec2 { const x = b[0] - a[0], y = b[1] - a[1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; }
function intersect(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

/** The outline as points: every corner `seg` arc steps (seg + 1 points), so outlines of one polygon at any inset or
 *  radius have the same count -- what a loft needs to join them. A corner whose radius is 0 repeats its point. */
export function outline(poly: RoundedPolygon, seg = 8): Vec2[] {
  const P = poly.points, n = P.length, out: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = P[(i + n - 1) % n]!, b = P[i]!, c = P[(i + 1) % n]!;
    const d1 = dir(a, b), d2 = dir(b, c);
    const turn = d1[0] * d2[1] - d1[1] * d2[0];            // >0 convex (CCW), <0 concave
    const cosT = Math.max(-1, Math.min(1, -(d1[0] * d2[0] + d1[1] * d2[1])));
    const theta = Math.acos(cosT);                          // the interior angle at b
    let r = poly.radii[i] ?? 0;
    const lim = Math.min(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1])) * 0.5;
    const tan = Math.tan(theta / 2);
    if (r > 0 && tan > 1e-6 && r / tan > lim) r = lim * tan;  // (a radius can't eat more than half an edge)
    if (r <= 1e-9 || Math.abs(turn) < 1e-9) { for (let s = 0; s <= seg; s += 1) out.push(b); continue; }
    const t = r / tan;
    const t1: Vec2 = [b[0] - d1[0] * t, b[1] - d1[1] * t], t2: Vec2 = [b[0] + d2[0] * t, b[1] + d2[1] * t];
    const side = turn > 0 ? 1 : -1;                          // centre on the inside (left) for convex, outside for concave
    const cx = t1[0] - d1[1] * r * side, cy = t1[1] + d1[0] * r * side;
    const a0 = Math.atan2(t1[1] - cy, t1[0] - cx), a1 = Math.atan2(t2[1] - cy, t2[0] - cx);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let s = 0; s <= seg; s += 1) { const ang = a0 + (da * s) / seg; out.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]); }
  }
  return out;
}

/** A rectangle centred at (cx, cy) with corner radii [bottom-left, bottom-right, top-right, top-left]. */
export function roundedRect(cx: number, cy: number, w: number, h: number, r: number | readonly [number, number, number, number]): RoundedPolygon {
  const rr = typeof r === "number" ? [r, r, r, r] : [...r];
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  return { points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], radii: rr };
}

/** A stadium (pill) of length `len` (end to end) and width `w`, along the x axis. */
export const stadium = (len: number, w: number): RoundedPolygon => roundedRect(0, 0, len, w, w / 2 - 1e-6);

/** A plus sign: arms `span` end to end, `arm` wide; outer corners `ro`, inner (concave) corners `ri`. */
export function cross(span: number, arm: number, ro: number, ri: number): RoundedPolygon {
  const s = span / 2, a = arm / 2;
  const pts: Vec2[] = [[-a, -s], [a, -s], [a, -a], [s, -a], [s, a], [a, a], [a, s], [-a, s], [-a, a], [-s, a], [-s, -a], [-a, -a]];
  const radii = [ro, ro, ri, ro, ro, ri, ro, ro, ri, ro, ro, ri];
  return { points: pts, radii };
}

// ---------------------------------------------------------------------------------------------------------------
// Ear clipping (for caps: outlines can be concave -- a cross, a notched shell)

export function triangulate(pts: readonly Vec2[]): number[] {
  // Drop exact repeats (zero-radius corners) but remember the original index.
  const idx: number[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]!, q = pts[idx[idx.length - 1] ?? -1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9) idx.push(i);
  }
  if (idx.length > 2) { const f = pts[idx[0]!]!, l = pts[idx[idx.length - 1]!]!; if (Math.hypot(f[0] - l[0], f[1] - l[1]) <= 1e-9) idx.pop(); }
  const ccw = signedArea(idx.map((i) => pts[i]!)) > 0;
  const V = ccw ? idx : idx.reverse();
  const out: number[] = [];
  let guard = V.length * V.length;
  while (V.length > 3 && guard-- > 0) {
    let cut = false;
    for (let k = 0; k < V.length; k += 1) {
      const i0 = V[(k + V.length - 1) % V.length]!, i1 = V[k]!, i2 = V[(k + 1) % V.length]!;
      const a = pts[i0]!, b = pts[i1]!, c = pts[i2]!;
      const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cr <= 1e-14) continue;
      let inside = false;
      for (const j of V) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inTri(pts[j]!, a, b, c)) { inside = true; break; }
      }
      if (inside) continue;
      out.push(ccw ? i0 : i0, i1, i2);
      V.splice(k, 1); cut = true; break;
    }
    if (!cut) break; // (degenerate: give up on what's left rather than loop)
  }
  if (V.length === 3) out.push(V[0]!, V[1]!, V[2]!);
  if (!ccw) for (let k = 0; k < out.length; k += 3) { const s = out[k + 1]!; out[k + 1] = out[k + 2]!; out[k + 2] = s; }
  return out;
}
function inTri(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]);
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]);
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

// ---------------------------------------------------------------------------------------------------------------
// Lofts

export interface Ring {
  readonly pts: readonly Vec2[];
  readonly z: number;
  /** A crease here: the band before and the band after don't share normals (a chamfer's crisp edge). */
  readonly hard?: boolean;
}

export interface LoftOptions {
  /** Close the first ring (facing -z) and/or the last ring (facing +z) with a flat cap. */
  readonly capStart?: boolean;
  readonly capEnd?: boolean;
  /** Cap uvs from the cap's (x, y); default (x, y) as they are. */
  readonly capUV?: (x: number, y: number) => Vec2;
}

/** Sweep rings of equal count through z (rings in increasing z). Side normals are smooth around each ring and along
 *  each band between creases; caps are flat. Side uv: u = the outline's length fraction, v = z. */
export function loft(rings: readonly Ring[], o: LoftOptions = {}): MeshData {
  const b = new MeshBuilder();
  const n = rings[0]?.pts.length ?? 0;
  if (rings.length < 2 || n < 3 || rings.some((r) => r.pts.length !== n)) throw new Error("loft: needs 2+ rings of one point count");
  const ccw = signedArea(rings[0]!.pts) > 0;
  // Bands: runs of rings between creases (a crease ring belongs to both bands, duplicated).
  const bands: number[][] = [[0]];
  for (let k = 1; k < rings.length; k += 1) {
    bands[bands.length - 1]!.push(k);
    if (rings[k]!.hard && k < rings.length - 1) bands.push([k]);
  }
  // Outline length fractions (from the first ring).
  const len: number[] = [0];
  for (let i = 1; i <= n; i += 1) { const p = rings[0]!.pts[i - 1]!, q = rings[0]!.pts[i % n]!; len.push(len[i - 1]! + Math.hypot(q[0] - p[0], q[1] - p[1])); }
  const total = len[n] || 1;
  for (const band of bands) {
    // Per-vertex normals: sum of adjacent quad normals within the band.
    const R = band.length, acc = new Float32Array(R * n * 3);
    const P = (r: number, i: number): [number, number, number] => { const ring = rings[band[r]!]!, p = ring.pts[((i % n) + n) % n]!; return [p[0], p[1], ring.z]; };
    for (let r = 0; r < R - 1; r += 1) for (let i = 0; i < n; i += 1) {
      const a = P(r, i), bb = P(r, i + 1), c = P(r + 1, i + 1), d = P(r + 1, i);
      // Quad normal from its diagonals (robust to a degenerate edge).
      const e1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], e2 = [d[0] - bb[0], d[1] - bb[1], d[2] - bb[2]];
      let nx = e1[1]! * e2[2]! - e1[2]! * e2[1]!, ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!, nz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
      if (!ccw) { nx = -nx; ny = -ny; nz = -nz; }
      const l = Math.hypot(nx, ny, nz); if (l < 1e-14) continue;
      nx /= l; ny /= l; nz /= l;
      for (const [rr, ii] of [[r, i], [r, i + 1], [r + 1, i + 1], [r + 1, i]] as const) {
        const k = (rr * n + (ii % n)) * 3; acc[k] = acc[k]! + nx; acc[k + 1] = acc[k + 1]! + ny; acc[k + 2] = acc[k + 2]! + nz;
      }
    }
    const base = b.count;
    for (let r = 0; r < R; r += 1) for (let i = 0; i <= n; i += 1) {
      const k = (r * n + (i % n)) * 3, p = P(r, i);
      let nx = acc[k]!, ny = acc[k + 1]!, nz = acc[k + 2]!; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      b.vertex(p[0], p[1], p[2], nx, ny, nz, len[i]! / total, p[2]);
    }
    const W = n + 1;
    for (let r = 0; r < R - 1; r += 1) for (let i = 0; i < n; i += 1) {
      const a = base + r * W + i, c = base + (r + 1) * W + i;
      if (ccw) { b.tri(a, a + 1, c + 1); b.tri(a, c + 1, c); } else { b.tri(a, c + 1, a + 1); b.tri(a, c, c + 1); }
    }
  }
  const cap = (ring: Ring, facing: 1 | -1): void => {
    const tris = triangulate(ring.pts), base = b.count;
    for (const p of ring.pts) { const uv = o.capUV ? o.capUV(p[0], p[1]) : p; b.vertex(p[0], p[1], ring.z, 0, 0, facing, uv[0], uv[1]); }
    for (let k = 0; k < tris.length; k += 3) {
      if (facing > 0) b.tri(base + tris[k]!, base + tris[k + 1]!, base + tris[k + 2]!);
      else b.tri(base + tris[k]!, base + tris[k + 2]!, base + tris[k + 1]!);
    }
  };
  if (o.capStart) cap(rings[0]!, -1);
  if (o.capEnd) cap(rings[rings.length - 1]!, 1);
  return b.done();
}

export type BevelKind = "round" | "chamfer";
export interface Bevel { readonly size: number; readonly kind?: BevelKind; readonly steps?: number; /** depth of the bevel (default = size) */ readonly depth?: number }

/** The rings of a slab: `poly` swept from z0 to z1, its back (z0) and front (z1) edges bevelled. A chamfer's edges are
 *  creases (its flat catches a light as one bright line); a round bevel is smooth into the wall and the cap. */
export function slabRings(poly: RoundedPolygon, z0: number, z1: number, back: Bevel | null, front: Bevel | null, seg = 8): Ring[] {
  const rings: Ring[] = [];
  const bevelRings = (bv: Bevel, atZ: number, sign: 1 | -1, fromCap: boolean): Ring[] => {
    const kind = bv.kind ?? "round", steps = kind === "chamfer" ? 1 : (bv.steps ?? 6), depth = bv.depth ?? bv.size, out: Ring[] = [];
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps; // 0 at the cap, 1 at the wall
      const ang = (t * Math.PI) / 2;
      const inset = kind === "chamfer" ? bv.size * (1 - t) : bv.size * (1 - Math.sin(ang));
      const dz = kind === "chamfer" ? depth * t : depth * (1 - Math.cos(ang));
      out.push({ pts: outline(insetPolygon(poly, inset), seg), z: atZ - sign * dz, hard: kind === "chamfer" });
    }
    return fromCap ? out : out.reverse();
  };
  if (back) rings.push(...bevelRings(back, z0, -1, true));
  else rings.push({ pts: outline(poly, seg), z: z0, hard: true });
  const frontRings = front ? bevelRings(front, z1, 1, false) : [{ pts: outline(poly, seg), z: z1, hard: true }];
  // (The wall: from the last back ring to the first front ring.)
  rings.push(...frontRings);
  return rings;
}

/** A slab with caps: the commonest part (a shell half, a key, a board). */
export function slab(poly: RoundedPolygon, z0: number, z1: number, back: Bevel | null, front: Bevel | null, o: LoftOptions & { seg?: number } = {}): MeshData {
  return loft(slabRings(poly, z0, z1, back, front, o.seg ?? 8), { capStart: o.capStart ?? true, capEnd: o.capEnd ?? true, ...(o.capUV ? { capUV: o.capUV } : {}) });
}

// ---------------------------------------------------------------------------------------------------------------
// Lathes

/** Revolve a profile of (radius, z) points about the z axis. `hard` marks creases (indices into the profile). The ends
 *  close themselves when their radius is 0. uv: u around, v along the profile. */
export function lathe(profile: readonly Vec2[], segments = 32, hard: readonly number[] = []): MeshData {
  const b = new MeshBuilder();
  const bands: number[][] = [[0]];
  for (let k = 1; k < profile.length; k += 1) { bands[bands.length - 1]!.push(k); if (hard.includes(k) && k < profile.length - 1) bands.push([k]); }
  for (const band of bands) {
    const base = b.count;
    for (let r = 0; r < band.length; r += 1) {
      const k = band[r]!, p = profile[k]!;
      // Profile tangent from neighbours inside the band -> the 2D normal (outward for a profile going +z with r > 0).
      const prev = profile[band[Math.max(0, r - 1)]!]!, next = profile[band[Math.min(band.length - 1, r + 1)]!]!;
      let tr = next[0] - prev[0], tz = next[1] - prev[1]; const l = Math.hypot(tr, tz) || 1; tr /= l; tz /= l;
      const nr = tz, nz = -tr;
      for (let s = 0; s <= segments; s += 1) {
        const a = (s / segments) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        b.vertex(p[0] * c, p[0] * sn, p[1], nr * c, nr * sn, nz, s / segments, k / (profile.length - 1));
      }
    }
    const W = segments + 1;
    for (let r = 0; r < band.length - 1; r += 1) for (let s = 0; s < segments; s += 1) {
      const a = base + r * W + s, c = base + (r + 1) * W + s;
      b.tri(a, a + 1, c + 1); b.tri(a, c + 1, c);
    }
  }
  return b.done();
}

/** A cylinder along z with flat caps (radius r, from z0 to z1). */
export function cylinder(r: number, z0: number, z1: number, segments = 32): MeshData {
  return lathe([[0, z0], [r, z0], [r, z1], [0, z1]], segments, [1, 2]);
}

/** An axis-aligned box centred at c with half sizes h, flat faces. */
export function box(c: readonly [number, number, number], h: readonly [number, number, number]): MeshData {
  const b = new MeshBuilder();
  const faces: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const n of faces) {
    const ax = n[0] ? 0 : n[1] ? 1 : 2, u = (ax + 1) % 3, v = (ax + 2) % 3, s = n[ax]!;
    const base = b.count;
    for (const [du, dv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const p = [0, 0, 0]; p[ax] = c[ax]! + s * h[ax]!; p[u] = c[u]! + du * h[u]!; p[v] = c[v]! + dv * h[v]!;
      b.vertex(p[0]!, p[1]!, p[2]!, n[0], n[1], n[2], (du + 1) / 2, (dv + 1) / 2);
    }
    if (s > 0) { b.tri(base, base + 1, base + 2); b.tri(base, base + 2, base + 3); } else { b.tri(base, base + 2, base + 1); b.tri(base, base + 3, base + 2); }
  }
  return b.done();
}

/** A flat rectangle in the xy plane facing +z (a print, a screen), uv 0..1 with v up. */
export function quad(cx: number, cy: number, w: number, h: number, z = 0): MeshData {
  const b = new MeshBuilder();
  b.vertex(cx - w / 2, cy - h / 2, z, 0, 0, 1, 0, 0); b.vertex(cx + w / 2, cy - h / 2, z, 0, 0, 1, 1, 0);
  b.vertex(cx + w / 2, cy + h / 2, z, 0, 0, 1, 1, 1); b.vertex(cx - w / 2, cy + h / 2, z, 0, 0, 1, 0, 1);
  b.tri(0, 1, 2); b.tri(0, 2, 3);
  return b.done();
}

/** Flat shading: every triangle its own three vertices (for parts that must look faceted, and for tests). */
export function flatten(m: MeshData): MeshData {
  const b = new MeshBuilder();
  for (let k = 0; k < m.indices.length; k += 3) {
    const v = [m.indices[k]!, m.indices[k + 1]!, m.indices[k + 2]!];
    const p = v.map((i) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!] as const);
    const e1 = [p[1]![0] - p[0]![0], p[1]![1] - p[0]![1], p[1]![2] - p[0]![2]], e2 = [p[2]![0] - p[0]![0], p[2]![1] - p[0]![1], p[2]![2] - p[0]![2]];
    let nx = e1[1]! * e2[2]! - e1[2]! * e2[1]!, ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!, nz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let j = 0; j < 3; j += 1) { const i = v[j]!; b.vertex(p[j]![0], p[j]![1], p[j]![2], nx, ny, nz, m.uvs[i * 2]!, m.uvs[i * 2 + 1]!, m.ao[i]!); }
    b.tri(b.count - 3, b.count - 2, b.count - 1);
  }
  return b.done();
}
