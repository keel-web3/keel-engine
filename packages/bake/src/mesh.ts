// Look meshes: a design's solids (the same boxes, wedges and capsules the baker
// draws sprites from) as ONE triangle mesh, made once and cached on the GPU --
// a real 3D object the sprite renderer draws live at any position, heading
// and spin (SpriteRenderer.setMesh / drawMeshes), and paints through the same
// looks as its indexed sprites. Every vertex carries its part's SLOT and its
// SURFACE COORDINATE, laid out as the indexed bake lays them (keel/render
// indexed.ts surfaceUv: round a capsule and along it, across a box's face), so
// a livery's stripes, a decal and a sheen land where they do on a sprite.
//
//   const mesh = lookMesh(design.pose("still", 0));
//   sprites.setMesh(design.key, mesh);
//   sprites.drawMeshes(view, [{ mesh: design.key, x, y: 0, z, yaw, look }], style);

import { cleanTriangles } from "./clean-triangles.ts";
import { dacos, dcos, dhypot, dsin } from "@keel-engine/core";
import type { BakeBox, BakeCapsule, BakeWorld } from "./bake.ts";

/**
 * A mesh: positions and normals (3 floats a vertex), [slot, u, v, part] a vertex (part: which solid, for the outline),
 * `bodies` the point's place in the WHOLE thing (x, y, z each 0..1 over its bounds -- what a paint painted in "body"
 * space reads, so a stripe runs down the whole car centred instead of restarting on every panel), and the triangles.
 */
export interface LookMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly attrs: Float32Array;
  readonly bodies: Float32Array;
  readonly indices: Uint32Array;
  /**
   * Per vertex, metres above the foot of its facade-grid face (-1 off a grid): what a wall's material detail
   * (looks.ts WallDetail) darkens its contact band and grime by. Only a mesh with a grid face carries it.
   */
  readonly facade?: Float32Array | undefined;
}

export interface LookMeshOptions {
  /** Segments round a capsule (default 12) and rings per hemisphere (default 3). */
  readonly around?: number;
  readonly rings?: number;
  /** Coarsen small capsules to this world-space chord error; never exceed the requested around/rings resolution. */
  readonly chordError?: number;
  /**
   * The bounds body space is measured over: [minX, minY, minZ, maxX, maxY, maxZ]. Every mesh of one thing (a car's
   * body, its glass, a stage of its build) must be given the SAME bounds, or their paint won't line up. Default: this
   * mesh's own bounds.
   */
  readonly bounds?: readonly [number, number, number, number, number, number];
}

class Builder {
  p: number[] = []; n: number[] = []; a: number[] = []; i: number[] = []; f: number[] = [];
  part = 0; grid = false;
  readonly boundsOnly: boolean;
  readonly bounds: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  constructor(boundsOnly = false) { this.boundsOnly = boundsOnly; }
  vert(p: readonly number[], n: readonly number[], slot: number, u: number, v: number, foot = -1): number {
    if (this.boundsOnly) {
      // Match the uploaded Float32 positions exactly, including tessellated capsules.
      for (let a = 0; a < 3; a++) { const v = Math.fround(p[a]!); this.bounds[a] = Math.min(this.bounds[a]!, v); this.bounds[a + 3] = Math.max(this.bounds[a + 3]!, v); }
      return 0;
    }
    this.p.push(p[0]!, p[1]!, p[2]!); this.n.push(n[0]!, n[1]!, n[2]!); this.a.push(slot, u, v, this.part); this.f.push(foot);
    if (foot >= 0) this.grid = true;
    return this.p.length / 3 - 1;
  }
  quad(a: number, b: number, c: number, d: number): void { if (!this.boundsOnly) this.i.push(a, b, c, a, c, d); }
}

// (A box's frame -> the world: x = c lx + s lz, z = -s lx + c lz -- the inverse of the renderer's world -> box turn.)
const turn = ([c, s]: readonly [number, number], x: number, y: number, z: number): [number, number, number] => {
  return [c * x + s * z, y, -s * x + c * z];
};

/** A face's surface coordinate, the bake's rule: by the axis it faces, the other two local coordinates over the half extents. */
const faceUv = (axis: 0 | 1 | 2, l: readonly number[], h: readonly number[]): [number, number] => {
  const r = [l[0]! / Math.max(1e-4, h[0]!), l[1]! / Math.max(1e-4, h[1]!), l[2]! / Math.max(1e-4, h[2]!)];
  const f = axis === 0 ? [r[2]!, r[1]!] : axis === 1 ? [r[0]!, r[2]!] : [r[0]!, r[1]!];
  return [Math.max(0, Math.min(1, f[0]! * 0.5 + 0.5)), Math.max(0, Math.min(1, f[1]! * 0.5 + 0.5))];
};

/**
 * A side face's METRIC coordinate (BakeBox.grid): cells along the face and up it from its bottom edge, offset. It goes
 * out as u = -(1 + cells across) -- the sign is the G-buffer pass's cue that this is a facade grid (MESH_GFS), since
 * a plain face's u is never below 0.
 */
const gridUv = (axis: 0 | 1 | 2, l: readonly number[], h: readonly number[], g: NonNullable<BakeBox["grid"]>): [number, number] => {
  const along = axis === 0 ? l[2]! + h[2]! : l[0]! + h[0]!;
  const u = along / Math.max(0.1, g[0]) + (g[2] ?? 0), v = (l[1]! + h[1]!) / Math.max(0.1, g[1]) + (g[3] ?? 0);
  return [-1 - Math.max(0, u), v];
};

/** A convex polygon face (local corners, counter-clockwise from outside) with a flat normal. */
function face(B: Builder, box: BakeBox, corners: readonly (readonly number[])[], localNormal: readonly number[], axis: 0 | 1 | 2, rotation: readonly [number, number]): void {
  const slot = box.mat ?? 0, c = box.c, h = [box.h[0] ?? 0, box.h[1] ?? 0, box.h[2] ?? 0];
  const n = B.boundsOnly ? [] : turn(rotation, localNormal[0]!, localNormal[1]!, localNormal[2]!);
  const grid = box.grid && axis !== 1 && box.kind !== "wedge" ? box.grid : null;
  const ids = corners.map((l) => {
    const w = turn(rotation, l[0]!, l[1]!, l[2]!);
    const p = [w[0] + (c[0] ?? 0), w[1] + (c[1] ?? 0), w[2] + (c[2] ?? 0)];
    // Bounds consume only the exact Float32 positions; UVs and normals do not affect them.
    if (B.boundsOnly) return B.vert(p, n, slot, 0, 0);
    const [u, v] = grid ? gridUv(axis, l, h, grid) : faceUv(axis, l, h);
    return B.vert(p, n, slot, u, v, grid ? Math.max(0, l[1]! + h[1]!) : -1);
  });
  if (!B.boundsOnly) for (let k = 1; k + 1 < ids.length; k += 1) B.i.push(ids[0]!, ids[k]!, ids[k + 1]!);
}

function boxMesh(B: Builder, b: BakeBox): void {
  const rotation: [number, number] = [dcos(b.yaw ?? 0), dsin(b.yaw ?? 0)];
  const emit = (corners: readonly (readonly number[])[], normal: readonly number[], axis: 0 | 1 | 2): void => face(B, b, corners, normal, axis, rotation);
  const [x, y, z] = [b.h[0] ?? 0, b.h[1] ?? 0, b.h[2] ?? 0];
  emit([[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]], [1, 0, 0], 0);
  emit([[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]], [-1, 0, 0], 0);
  emit([[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]], [0, 1, 0], 1);
  emit([[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]], [0, -1, 0], 1);
  emit([[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]], [0, 0, 1], 2);
  emit([[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]], [0, 0, -1], 2);
}

/** A wedge: its section in (z, y) the foot at +z (lo x its height), rising to full height at -z (keel/render's). */
function wedgeMesh(B: Builder, b: BakeBox): void {
  const rotation: [number, number] = [dcos(b.yaw ?? 0), dsin(b.yaw ?? 0)];
  const emit = (corners: readonly (readonly number[])[], normal: readonly number[], axis: 0 | 1 | 2): void => face(B, b, corners, normal, axis, rotation);
  const [x, y, z] = [b.h[0] ?? 0, b.h[1] ?? 0, b.h[2] ?? 0];
  const lo = Math.max(0, Math.min(0.98, b.lo ?? 0));
  const yf = -y + 2 * y * lo; // (the foot's top)
  const backBottom = b.skin ? Math.max(-y, y - b.skin) : -y;
  const frontBottom = b.skin ? Math.max(-y, yf - b.skin) : -y;
  const sec = [[-z, backBottom], [z, frontBottom], [z, yf], [-z, y]] as const;
  // Sides: the section at +x and -x.
  emit([[x, sec[0][1], sec[0][0]], [x, sec[3][1], sec[3][0]], [x, sec[2][1], sec[2][0]], [x, sec[1][1], sec[1][0]]].map(([px, py, pz]) => [px!, py!, pz!]), [1, 0, 0], 0);
  emit([[-x, sec[0][1], sec[0][0]], [-x, sec[1][1], sec[1][0]], [-x, sec[2][1], sec[2][0]], [-x, sec[3][1], sec[3][0]]].map(([px, py, pz]) => [px!, py!, pz!]), [-1, 0, 0], 0);
  const slope = (frontBottom - backBottom) / (2 * z || 1), nl = Math.sqrt(1 + slope * slope);
  emit([[-x, backBottom, -z], [x, backBottom, -z], [x, frontBottom, z], [-x, frontBottom, z]], [0, -1 / nl, slope / nl], 1);
  emit([[x, backBottom, -z], [-x, backBottom, -z], [-x, y, -z], [x, y, -z]], [0, 0, -1], 2);
  if (yf > -y + 1e-4) emit([[-x, frontBottom, z], [x, frontBottom, z], [x, yf, z], [-x, yf, z]], [0, 0, 1], 2);
  // The slope, from the full height at -z down to the foot at +z.
  const dy = yf - y, dz = 2 * z, len = dhypot(dy, dz) || 1;
  emit([[-x, y, -z], [-x, yf, z], [x, yf, z], [x, y, -z]], [0, dz / len, -dy / len], 1);
}

// Tessellation depends only on resolution, never the seed, pose or material. Keep a small bounded set of
// double-precision templates: converting these to Float32 would move the existing geometry and UVs.
interface CapsuleTemplate { readonly circle: readonly (readonly [number, number])[]; readonly profile: readonly (readonly [number, number, number])[] }
const capsuleTemplates = new Map<string, CapsuleTemplate>();
function capsuleTemplate(around: number, rings: number): CapsuleTemplate {
  const key = `${around}:${rings}`, cached = capsuleTemplates.get(key);
  if (cached) return cached;
  const circle: [number, number][] = [], profile: [number, number, number][] = [];
  for (let i = 0; i <= around; i++) { const th = (i / around) * Math.PI * 2 - Math.PI; circle.push([dcos(th), dsin(th)]); }
  for (const end of [0, 1]) for (let k = 0; k <= rings; k++) {
    const phi = (end ? 0 : -Math.PI / 2) + (k / rings) * (Math.PI / 2), sin = dsin(phi);
    profile.push([sin, dcos(phi), Math.sqrt(Math.max(0, 1 - sin * sin))]);
  }
  const template = { circle, profile };
  if (capsuleTemplates.size >= 32) capsuleTemplates.delete(capsuleTemplates.keys().next().value!);
  capsuleTemplates.set(key, template);
  return template;
}

function capsuleMesh(B: Builder, cap: BakeCapsule, around: number, rings: number): void {
  const A = [cap.a[0] ?? 0, cap.a[1] ?? 0, cap.a[2] ?? 0], Bp = [cap.b[0] ?? 0, cap.b[1] ?? 0, cap.b[2] ?? 0];
  const r = cap.r, slot = cap.mat ?? 0;
  let ax = [Bp[0]! - A[0]!, Bp[1]! - A[1]!, Bp[2]! - A[2]!];
  const len = dhypot(ax[0]!, ax[1]!, ax[2]!);
  ax = len > 1e-6 ? ax.map((v) => v / len) : [0, 1, 0];
  // (The surface coordinate's frame, as the bake's: e1 across the axis, e2 = axis x e1.)
  const cross = (p: number[], q: number[]) => [p[1]! * q[2]! - p[2]! * q[1]!, p[2]! * q[0]! - p[0]! * q[2]!, p[0]! * q[1]! - p[1]! * q[0]!];
  let e1 = Math.abs(ax[1]!) < 0.9 ? cross(ax, [0, 1, 0]) : cross(ax, [1, 0, 0]);
  const el = dhypot(e1[0]!, e1[1]!, e1[2]!) || 1;
  e1 = e1.map((v) => v / el);
  const e2 = cross(ax, e1);
  const template = capsuleTemplate(around, rings);
  const directions = template.circle.map(([c, s]) => [e1[0]! * c + e2[0]! * s, e1[1]! * c + e2[1]! * s, e1[2]! * c + e2[2]! * s]);
  const start = B.p.length / 3;
  for (let k = 0; k < template.profile.length; k++) {
    const [na, rad, nr] = template.profile[k]!, h = (k > rings ? len : 0) + r * na;
    for (let i = 0; i <= around; i++) {
      const dir = directions[i]!;
      const p = [A[0]! + ax[0]! * h + dir[0]! * r * rad, A[1]! + ax[1]! * h + dir[1]! * r * rad, A[2]! + ax[2]! * h + dir[2]! * r * rad];
      if (B.boundsOnly) { B.vert(p, [], slot, 0, 0); continue; }
      const n = [dir[0]! * nr + ax[0]! * na, dir[1]! * nr + ax[1]! * na, dir[2]! * nr + ax[2]! * na];
      B.vert(p, n, slot, i / around, Math.max(0, Math.min(1, (h + r) / (len + 2 * r))));
    }
  }
  if (B.boundsOnly) return;
  const row = around + 1;
  for (let k = 0; k + 1 < template.profile.length; k += 1) for (let i = 0; i < around; i += 1) {
    const a = start + k * row + i, b = a + 1, c = a + row + 1, d = a + row;
    B.quad(a, d, c, b);
  }
}

/** Several meshes as one (a design's parts that always move together). Parts stay apart for the outline. */
export function mergeMeshes(meshes: readonly LookMesh[]): LookMesh {
  let nv = 0, ni = 0;
  for (const m of meshes) { nv += m.positions.length / 3; ni += m.indices.length; }
  const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), attrs = new Float32Array(nv * 4), bodies = new Float32Array(nv * 3), indices = new Uint32Array(ni);
  // (Facade feet only when some mesh has them: the rest read -1, no grid.)
  const facade = meshes.some((m) => m.facade) ? new Float32Array(nv).fill(-1) : null;
  let v = 0, i = 0, part = 0;
  for (const m of meshes) {
    const n = m.positions.length / 3;
    positions.set(m.positions, v * 3); normals.set(m.normals, v * 3); bodies.set(m.bodies, v * 3);
    if (facade && m.facade) facade.set(m.facade, v);
    let top = 0;
    attrs.set(m.attrs, v * 4);
    for (let k = 0; k < n; k += 1) { attrs[(v + k) * 4 + 3] = m.attrs[k * 4 + 3]! + part; top = Math.max(top, m.attrs[k * 4 + 3]! + 1); }
    for (let k = 0; k < m.indices.length; k += 1) indices[i + k] = m.indices[k]! + v;
    v += n; i += m.indices.length; part += top;
  }
  return facade ? { positions, normals, attrs, bodies, indices, facade } : { positions, normals, attrs, bodies, indices };
}

/** A 4x4 transform (column-major, WebGL's): translate, then yaw about y, pitch about x, roll about z, then scale. */
export function meshMatrix({ x = 0, y = 0, z = 0, yaw = 0, pitch = 0, roll = 0, scale = 1 }: { x?: number; y?: number; z?: number; yaw?: number; pitch?: number; roll?: number; scale?: number } = {}): Float32Array {
  // (An angle of exactly +0 -- most draws turn about one axis, if any -- needs no trig: dcos(+0) is 1, dsin(+0) is +0.)
  const cy = Object.is(yaw, 0) ? 1 : dcos(yaw), sy = Object.is(yaw, 0) ? 0 : dsin(yaw);
  const cp = Object.is(pitch, 0) ? 1 : dcos(pitch), sp = Object.is(pitch, 0) ? 0 : dsin(pitch);
  const cr = Object.is(roll, 0) ? 1 : dcos(roll), sr = Object.is(roll, 0) ? 0 : dsin(roll);
  // R = Ry(yaw) * Rx(pitch) * Rz(roll), with Ry mapping local +z to (sin yaw, 0, cos yaw) -- the frame convention.
  // (Into scratch, not new arrays: every draw of every frame makes these. The same sums in the same order: the same bits.)
  const ry = M3_RY, rx = M3_RX, rz = M3_RZ, R = M3_R;
  ry[0] = cy; ry[1] = 0; ry[2] = -sy; ry[3] = 0; ry[4] = 1; ry[5] = 0; ry[6] = sy; ry[7] = 0; ry[8] = cy; // columns
  rx[0] = 1; rx[1] = 0; rx[2] = 0; rx[3] = 0; rx[4] = cp; rx[5] = sp; rx[6] = 0; rx[7] = -sp; rx[8] = cp;
  rz[0] = cr; rz[1] = sr; rz[2] = 0; rz[3] = -sr; rz[4] = cr; rz[5] = 0; rz[6] = 0; rz[7] = 0; rz[8] = 1;
  mul3Into(M3_T, ry, rx);
  mul3Into(R, M3_T, rz);
  const o = new Float32Array(16);
  o[0] = R[0]! * scale; o[1] = R[1]! * scale; o[2] = R[2]! * scale;
  o[4] = R[3]! * scale; o[5] = R[4]! * scale; o[6] = R[5]! * scale;
  o[8] = R[6]! * scale; o[9] = R[7]! * scale; o[10] = R[8]! * scale;
  o[12] = x; o[13] = y; o[14] = z; o[15] = 1;
  return o;
}
const M3_RY = new Float64Array(9), M3_RX = new Float64Array(9), M3_RZ = new Float64Array(9), M3_T = new Float64Array(9), M3_R = new Float64Array(9);
/** o = a x b, 3x3 column-major: each entry summed up from zero over k, in order. */
function mul3Into(o: Float64Array, a: Float64Array, b: Float64Array): void {
  for (let c = 0; c < 3; c += 1) for (let r = 0; r < 3; r += 1) { let s = 0; for (let k = 0; k < 3; k += 1) s += a[k * 3 + r]! * b[c * 3 + k]!; o[c * 3 + r] = s; }
}

/** a x b (column-major 4x4): b's transform first, then a's -- a wheel's spin (b) on its hub (a). */
export function mulMatrix(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) { let s = 0; for (let k = 0; k < 4; k += 1) s += a[k * 4 + r]! * b[c * 4 + k]!; o[c * 4 + r] = s; }
  return o;
}

/** Feed the same vertex path to either mesh buffers or the bounds-only sink. */
function appendWorld(B: Builder, world: BakeWorld, around: number, rings: number, chordError = 0): void {
  for (const b of world.boxes ?? []) { (b.kind === "wedge" ? wedgeMesh : boxMesh)(B, b); B.part += 1; }
  for (const w of world.wedges ?? []) { wedgeMesh(B, w); B.part += 1; }
  for (const c of world.capsules ?? []) {
    let sides = around, arcs = rings;
    if (chordError > 0 && c.r > 0) {
      // Circle sagitta: error = r * (1 - cos(angle / 2)). Share the error between the two surface axes.
      const angle = dacos(Math.max(-1, Math.min(1, 1 - chordError / (2 * c.r))));
      sides = Math.min(around, Math.max(4, Math.ceil(Math.PI / angle)));
      arcs = Math.min(rings, Math.max(1, Math.ceil(Math.PI / (4 * angle))));
    }
    capsuleMesh(B, c, sides, arcs); B.part += 1;
  }
}

/** A design's posed solids as one look mesh (made once; drawn at any position, heading and spin). */
export function lookMesh(world: BakeWorld, { around = 12, rings = 3, bounds, chordError }: LookMeshOptions = {}): LookMesh {
  const B = new Builder();
  appendWorld(B, world, around, rings, chordError);
  const positions = Float32Array.from(B.p), attrs = Float32Array.from(B.a);
  const mesh = { positions, normals: Float32Array.from(B.n), attrs, bodies: bodySpace(positions, bounds ?? meshBounds(positions)), indices: cleanTriangles(positions, Uint32Array.from(B.i), attrs) };
  return B.grid ? { ...mesh, facade: Float32Array.from(B.f) } : mesh;
}

/** A mesh's own bounds: [minX, minY, minZ, maxX, maxY, maxZ] (what to pass every mesh of one thing). */
export function meshBounds(positions: Float32Array): [number, number, number, number, number, number] {
  const b: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let v = 0; v < positions.length; v += 3) for (let a = 0; a < 3; a += 1) {
    const q = positions[v + a]!;
    if (q < b[a]!) b[a] = q;
    if (q > b[a + 3]!) b[a + 3] = q;
  }
  return b;
}

/** The bounds of a whole design's worlds together (a car's body and its glass: one body space for both). */
export function worldsBounds(worlds: readonly BakeWorld[], options: LookMeshOptions = {}): [number, number, number, number, number, number] {
  const B = new Builder(true);
  for (const w of worlds) appendWorld(B, w, options.around ?? 12, options.rings ?? 3, options.chordError);
  return B.bounds;
}

export const bodySpace = (positions: Float32Array, b: readonly number[]): Float32Array => {
  const out = new Float32Array(positions.length);
  const span = [Math.max(1e-4, b[3]! - b[0]!), Math.max(1e-4, b[4]! - b[1]!), Math.max(1e-4, b[5]! - b[2]!)];
  for (let v = 0; v < positions.length; v += 3) for (let a = 0; a < 3; a += 1) out[v + a] = Math.max(0, Math.min(1, (positions[v + a]! - b[a]!) / span[a]!));
  return out;
};

// ---------------------------------------------------------------- posing a mesh (bending limbs)

const cross3 = (p: readonly number[], q: readonly number[]): number[] => [p[1]! * q[2]! - p[2]! * q[1]!, p[2]! * q[0]! - p[0]! * q[2]!, p[0]! * q[1]! - p[1]! * q[0]!];
const norm3 = (v: readonly number[]): number[] => { const l = dhypot(v[0]!, v[1]!, v[2]!) || 1; return [v[0]! / l, v[1]! / l, v[2]! / l]; };
/** A frame about an axis, as a column-major 3x3 [axis, e1, e2] (the surface coordinate's frame: mesh and bake agree). */
const frameOf = (ax: readonly number[]): number[] => {
  const e1 = norm3(Math.abs(ax[1]!) < 0.9 ? cross3(ax, [0, 1, 0]) : cross3(ax, [1, 0, 0]));
  const e2 = cross3(ax, e1);
  return [ax[0]!, ax[1]!, ax[2]!, e1[0]!, e1[1]!, e1[2]!, e2[0]!, e2[1]!, e2[2]!];
};
const mat4Of = (r: readonly number[], t: readonly number[]): number[] => [r[0]!, r[1]!, r[2]!, 0, r[3]!, r[4]!, r[5]!, 0, r[6]!, r[7]!, r[8]!, 0, t[0]!, t[1]!, t[2]!, 1];
const apply3 = (m: readonly number[], v: readonly number[]): number[] => [m[0]! * v[0]! + m[3]! * v[1]! + m[6]! * v[2]!, m[1]! * v[0]! + m[4]! * v[1]! + m[7]! * v[2]!, m[2]! * v[0]! + m[5]! * v[1]! + m[8]! * v[2]!];
const mul33 = (a: readonly number[], b: readonly number[]): number[] => {
  const o = new Array<number>(9).fill(0);
  for (let c = 0; c < 3; c += 1) for (let r = 0; r < 3; r += 1) for (let k = 0; k < 3; k += 1) o[c * 3 + r]! += a[k * 3 + r]! * b[c * 3 + k]!;
  return o;
};
const scale33 = (sx: number, sy: number, sz: number): number[] => [sx, 0, 0, 0, sy, 0, 0, 0, sz];
const yaw33 = (yaw: number): number[] => [dcos(yaw), 0, -dsin(yaw), 0, 1, 0, dsin(yaw), 0, dcos(yaw)];

/**
 * A pose for a mesh: per part (its solid, in lookMesh's order) the transform that takes it from the mesh's REST pose to
 * where the clip's frame puts it -- a limb turned and stretched, a door swung, a wing tilted. Sixteen floats a part
 * (column-major 4x4), for MeshDraw.parts: the mesh is made once and bends live.
 *
 *   sr.setMesh(key, lookMesh(design.pose("idle", 0)));                     // once
 *   const parts = poseMatrices(design.pose("idle", 0), design.pose("run", f));  // a frame
 *   sr.drawMeshes(view, [{ mesh: key, matrix, look, parts }], style);
 */
export function poseMatrices(rest: BakeWorld, posed: BakeWorld): Float32Array {
  const list = (w: BakeWorld) => [...(w.boxes ?? []), ...(w.wedges ?? [])];
  const A = list(rest), B = list(posed);
  const ca = rest.capsules ?? [], cb = posed.capsules ?? [];
  const n = A.length + ca.length;
  const out = new Float32Array(n * 16);
  const put = (i: number, m: readonly number[]) => out.set(m, i * 16);
  for (let i = 0; i < A.length; i += 1) {
    const a = A[i]!, b = B[i] ?? a;
    // A box: turned from its rest yaw to its posed one, stretched by its half extents, about its centre.
    const s = scale33(...([0, 1, 2].map((k) => (b.h[k] ?? 0) / Math.max(1e-4, a.h[k] ?? 0)) as [number, number, number]));
    const R = mul33(mul33(yaw33(b.yaw ?? 0), s), yaw33(-(a.yaw ?? 0)));
    const c0 = [a.c[0] ?? 0, a.c[1] ?? 0, a.c[2] ?? 0], c1 = [b.c[0] ?? 0, b.c[1] ?? 0, b.c[2] ?? 0];
    const t = apply3(R, c0);
    put(i, mat4Of(R, [c1[0]! - t[0]!, c1[1]! - t[1]!, c1[2]! - t[2]!]));
  }
  for (let i = 0; i < ca.length; i += 1) {
    const a = ca[i]!, b = cb[i] ?? a;
    const av = [a.b[0]! - a.a[0]!, a.b[1]! - a.a[1]!, a.b[2]! - a.a[2]!], bv = [b.b[0]! - b.a[0]!, b.b[1]! - b.a[1]!, b.b[2]! - b.a[2]!];
    const la = dhypot(av[0]!, av[1]!, av[2]!), lb = dhypot(bv[0]!, bv[1]!, bv[2]!);
    const F0 = frameOf(la > 1e-6 ? norm3(av) : [0, 1, 0]), F1 = frameOf(lb > 1e-6 ? norm3(bv) : [0, 1, 0]);
    // (Along the axis: how much longer it is; across it: how much fatter. F0 transposed takes the rest frame back to the axes.)
    const S = scale33(la > 1e-6 ? lb / la : 1, b.r / Math.max(1e-4, a.r), b.r / Math.max(1e-4, a.r));
    const F0t = [F0[0]!, F0[3]!, F0[6]!, F0[1]!, F0[4]!, F0[7]!, F0[2]!, F0[5]!, F0[8]!];
    const R = mul33(mul33(F1, S), F0t);
    const m0 = [a.a[0]!, a.a[1]!, a.a[2]!], m1 = [b.a[0]!, b.a[1]!, b.a[2]!];
    const t = apply3(R, m0);
    put(A.length + i, mat4Of(R, [m1[0]! - t[0]!, m1[1]! - t[1]!, m1[2]! - t[2]!]));
  }
  return out;
}

// ---------------------------------------------------------------- the live draw's first pass

/**
 * Pass 1 of SpriteRenderer.drawMeshes: each mesh through the pixel view (orthographic, the layers' projection) into a
 * small G-buffer -- (slot + 1, shade, u, v) as an indexed texel is, (look + 1, draw << 16 | part, the scene's depth,
 * the view depth) and the dither anchor -- lit live: the sun and up to MESH_LIGHTS point / spot lights.
 */
export const MESH_LIGHTS = 16;
export const MESH_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNorm;
layout(location=2) in vec4 aAttr;
layout(location=3) in vec3 aBody;    // where the vertex is in the WHOLE thing (0..1 each way)
layout(location=4) in float aFacade; // metres above its facade face's foot (LookMesh.facade; -1: none -- the unbound default)
uniform mat4 uModel;
uniform sampler2D uParts;     // a pose: a 4x4 per part (four texels a row), read by the vertex's part
uniform int uPosed;
uniform vec3 uCenter, uRight, uUp, uForward;
uniform float uK, uDepthRange, uTie;
uniform float uClipRange;     // an orthographic view's hardware depth span (project.ts clipFar; the contract's range by default)
uniform vec2 uSize, uSnap;
uniform int uGround;
uniform mat4 uShadowMat;      // the world, as the sun sees it (the shadow pass draws through this)
uniform int uShadowPass;
uniform mat4 uProj;           // project.ts's clip matrix: under perspective the picture goes through it
uniform int uPersp;
out vec3 vW;
out vec3 vN;
out vec3 vAttr;
out vec3 vBody;
flat out float vPart;
out float vScene;
out float vView;
out float vFacade;
void main() {
  vec3 lp = aPos, ln = aNorm;
  vFacade = aFacade;
  if (uPosed == 1) {
    int pi = int(aAttr.w + 0.5);
    mat4 B = mat4(texelFetch(uParts, ivec2(0, pi), 0), texelFetch(uParts, ivec2(1, pi), 0), texelFetch(uParts, ivec2(2, pi), 0), texelFetch(uParts, ivec2(3, pi), 0));
    lp = (B * vec4(lp, 1.0)).xyz;
    ln = mat3(B) * ln;
  }
  vec3 w = (uModel * vec4(lp, 1.0)).xyz;
  vW = w;
  vN = mat3(uModel) * ln;
  vAttr = aAttr.xyz;
  vBody = aBody;
  vPart = aAttr.w;
  vec3 d = w - uCenter;
  vec2 px = vec2(dot(d, uRight), dot(d, uUp)) * uK + uSnap;
  float fd = dot(d, uForward);
  vView = fd;
  float cp = max(uUp.y, 1e-4);
  float gd = uGround == 1 ? cp * (w.x * uForward.x / cp + w.z * uForward.z / cp) - dot(uCenter, uForward) : fd;
  vScene = clamp(0.5 + (gd - uTie) / uDepthRange, 0.0, 1.0);
  // (Perspective moves the CLIP position only: vScene and vView above are the same linear forward distance either
  // way, so the G-buffer, the paint pass and everything that composites against it read depth one way -- project.ts.)
  gl_Position = uShadowPass == 1 ? uShadowMat * vec4(w, 1.0)
    : uPersp == 1 ? uProj * vec4(w, 1.0)
    : vec4(px * 2.0 / uSize, clamp(0.5 + fd / uClipRange, 0.0, 1.0) * 2.0 - 1.0, 1.0);
}`;

/**
 * Crossed cards (cards.ts cardsMesh): a card's surface coordinate is u = across (0..1) + 2 x (seed x 4 + kind) and
 * v = -(1 + up) -- v below 0 is the cue, as a facade grid's u is. cardKeep() is its cutout: grass blades, a bush's
 * lumpy blob, a leafy canopy, reeds -- each measured on the card itself (it never swims) and roughened on a lattice of
 * the card's own "leaf texels", so the silhouette reads as pixel-art foliage. Both the G-buffer and the sun's pass cut it.
 */
export const CARD_GLSL = `
float cardHash(vec3 p) { uvec3 v = uvec3(ivec3(floor(p)) + ivec3(8192)); v = v * 1664525u + 1013904223u; v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y; v ^= v >> 16u; v.x += v.y * v.z; return float(v.x & 65535u) / 65536.0; }
// (Positive inside, negative out; the lattice roughens it at the edge.)
float cardShape(int kind, float seed, float a, float t) {
  if (kind == 0 || kind == 3) {
    // Grass (seven blades) or reeds (four, taller and thinner): tapering spikes, each its own height and lean.
    int n = kind == 0 ? 7 : 4;
    float w0 = kind == 0 ? 0.075 : 0.045, best = -1.0;
    for (int i = 0; i < 7; i++) {
      if (i >= n) break;
      float fi = float(i);
      float h = (kind == 0 ? 0.5 : 0.7) + (kind == 0 ? 0.5 : 0.3) * cardHash(vec3(fi, seed, 1.0));
      float lean = (cardHash(vec3(fi, seed, 2.0)) - 0.5) * 0.5;
      float c = (fi + 0.5) / float(n) + (cardHash(vec3(fi, seed, 3.0)) - 0.5) * 0.6 / float(n);
      float w = w0 * (1.0 - t / h);
      if (kind == 3 && t > h - 0.18 && t < h - 0.02) w = w0 * 1.6;   // (a reed's seed head)
      if (t < h) best = max(best, (w - abs(a - c - lean * t * t)) / w0);
    }
    return best;
  }
  vec2 q = vec2(a - 0.5, t - 0.45);
  if (kind == 1) {
    // A bush: a lumpy dome, flat where it sits.
    float ang = atan(q.y, q.x);
    float r = 0.44 + 0.05 * sin(ang * 5.0 + seed) + 0.04 * sin(ang * 9.0 - seed * 1.7);
    return (r - length(q * vec2(1.0, 1.1))) / 0.12 - (t < 0.04 ? 1.0 : 0.0);
  }
  // Leafy: a canopy of five overlapping clumps.
  float best = -1.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 c = vec2(0.22 + 0.56 * cardHash(vec3(fi, seed, 4.0)), 0.3 + 0.5 * cardHash(vec3(fi, seed, 5.0)));
    float r = 0.16 + 0.12 * cardHash(vec3(fi, seed, 6.0));
    best = max(best, (r - length(vec2(a, t) - c)) / 0.1);
  }
  return best;
}
bool cardKeep(int kind, float seed, float a, float t) {
  float d = cardShape(kind, seed, a, t);
  if (kind == 1 || kind == 2) {
    // (Leaf texels: holes near the edge, a ragged rim.)
    vec3 cell = vec3(floor(a * 12.0), floor(t * 12.0), seed);
    d += (cardHash(cell) - 0.5) * (kind == 2 ? 1.3 : 0.9);
  }
  return d > 0.0;
}
bool cardCut(vec3 attr) {
  if (attr.z >= -0.5) return false;
  float id = floor((attr.y + 0.5) * 0.5);
  float a = attr.y - 2.0 * id, t = -attr.z - 1.0;
  return !cardKeep(int(mod(id, 4.0)), floor(id / 4.0), clamp(a, 0.0, 1.0), clamp(t, 0.0, 1.0));
}`;

/** The shadow pass: depth only, from the sun (MESH_VS with uShadowPass = 1) -- a crossed card casts its cutout. */
export const MESH_SHADOW_FS = `#version 300 es
precision highp float;
precision highp int;
in vec3 vAttr;
${CARD_GLSL}
void main() { if (cardCut(vAttr)) discard; }`;
export const MESH_GFS = `#version 300 es
precision highp float;
precision highp int;
uniform vec3 uForward, uSun;
uniform int uLook, uDraw, uLightCount;
uniform int uChunk;                   // how many picture pixels wide this thing's own pixels are (1: the picture's)
uniform int uMarked;                  // 1: this draw wears the style's markFilter, not the picture's (filters.ts)
uniform float uSnowK;                 // how much of the weather's snow this draw takes (0 without weather: MeshDraw.snow)
uniform float uSlotGlow[32];          // per slot, live emission (a headlight on, a taillight under braking, a hot exhaust)

uniform ivec2 uAnchor;
uniform vec4 uFx;                     // light scale, added shade (a flash), fade (1 whole; negative: the complementary screen), ambient
uniform vec2 uWipe;                   // body-space digitization wipe: threshold, side (0 old / 1 new)
uniform sampler2D uShadow;            // the sun's depth of the nearest surface, for what it can't see
uniform mat4 uShadowMat;
uniform float uShadowK;               // how dark its shadow is (0: none)
uniform vec4 uLightPos[${MESH_LIGHTS}];     // xyz, radius (m)
uniform vec4 uLightDir[${MESH_LIGHTS}];     // xyz spot direction (0: a point light), cos of the cone's half angle
uniform float uLightI[${MESH_LIGHTS}];
uniform float uLightTint[${MESH_LIGHTS}];   // which tint ramp a light wears (0: none), as a float
uniform float uLightOwner[${MESH_LIGHTS}];  // whose lamp it is (0: nobody's): it never lights its own thing
uniform float uOwner;
in vec3 vW;
in vec3 vN;
in vec3 vAttr;
in vec3 vBody;
flat in float vPart;
in float vScene;
in float vView;
in float vFacade;
layout(location=0) out vec4 gA;
layout(location=1) out uvec4 gB;
layout(location=2) out ivec4 gC;
layout(location=3) out vec4 gD;       // the surface's normal (octahedral), and its place in the whole thing
float bayer4(ivec2 p) { int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5); return (float(m[(p.y & 3) * 4 + (p.x & 3)]) + 0.5) / 16.0; }
// (An integer hash, 0..1: the same on every GPU, where sin() of a big number isn't.)
float cellHash(uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  return float(v.x & 65535u) / 65536.0;
}
${CARD_GLSL}
void main() {
  // A crossed card's cutout (cards.ts): what isn't blade or leaf is never drawn, so what's behind shows through.
  if (cardCut(vAttr)) discard;
  // The two car versions share the same body coordinates. A soft dithered edge makes the old car
  // dissolve behind the new one instead of popping or cross-fading the whole silhouette at once.
  if (uWipe.x >= 0.0) {
    float edge = smoothstep(uWipe.x - 0.08, uWipe.x + 0.08, clamp(vBody.z, 0.0, 1.0));
    float keep = uWipe.y > 0.5 ? edge : 1.0 - edge;
    if (bayer4(ivec2(gl_FragCoord.xy)) >= keep) discard;
  }
  // (A dithered fade keeps the pixels whose screen is under it; a negative fade keeps exactly the others -- two draws
  // cross-fading with t and -(1 - t) partition the pixels between them, no gap and no pixel drawn twice.)
  if (uFx.z < 0.0) { if (bayer4(ivec2(gl_FragCoord.xy)) < 1.0 + uFx.z) discard; }
  else if (uFx.z < 0.999 && bayer4(ivec2(gl_FragCoord.xy)) >= uFx.z) discard;
  vec3 n = normalize(vN);
  if (dot(n, uForward) > 0.0) n = -n;
  float diff = max(dot(n, uSun), 0.0);
  // The sun's own shadow: what it cannot see from where it stands -- a car's roof over its cabin, a car over the one beside it.
  if (uShadowK > 0.0 && diff > 0.0) {
    vec4 sp = uShadowMat * vec4(vW, 1.0);
    vec3 q = sp.xyz / sp.w * 0.5 + 0.5;
    if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0 && q.z < 1.0) {
      float bias = 0.0012 + 0.006 * (1.0 - diff);
      vec2 tx = 1.0 / vec2(textureSize(uShadow, 0));
      float lit = 0.0;
      for (int i = 0; i < 4; i++) {
        vec2 o = (i == 0 ? vec2(-0.5, -0.5) : i == 1 ? vec2(0.5, -0.5) : i == 2 ? vec2(-0.5, 0.5) : vec2(0.5, 0.5)) * tx;
        lit += texture(uShadow, q.xy + o).r + bias >= q.z ? 0.25 : 0.0;
      }
      diff *= mix(1.0, lit, uShadowK);
    }
  }
  float L = (uFx.w + 0.1 * n.y + 0.5 * diff) * uFx.x;
  float tint = 0.0; int tintId = 0;
  for (int i = 0; i < uLightCount; i++) {
    if (uLightOwner[i] > 0.5 && abs(uLightOwner[i] - uOwner) < 0.5) continue;  // (a car's own headlights don't light it)
    vec3 to = uLightPos[i].xyz - vW;
    float dist = length(to);
    float r = uLightPos[i].w;
    if (dist >= r) continue;
    vec3 l = to / max(dist, 1e-4);
    float att = 1.0 - dist / r; att *= att;
    float cone = 1.0;
    if (dot(uLightDir[i].xyz, uLightDir[i].xyz) > 0.0) cone = smoothstep(uLightDir[i].w, mix(uLightDir[i].w, 1.0, 0.5), dot(-l, normalize(uLightDir[i].xyz)));
    float lit = uLightI[i] * att * cone * (0.35 + 0.65 * max(dot(n, l), 0.0));
    L += lit;
    // (A coloured light: the strongest one over this pixel wins its ramp -- the paint keeps its shade, not its colour.)
    if (uLightTint[i] > 0.5 && lit > tint) { tint = lit; tintId = int(uLightTint[i] + 0.5); }
  }
  int slot = int(vAttr.x + 0.5);
  L += uFx.y + uSlotGlow[slot];
  // A facade grid (mesh.ts gridUv: u below 0): its cell resolved HERE, at full precision, and packed into the two
  // surface bytes -- where in the cell (a 16th each way, the high nibbles) and one draw for the cell (the low nibbles)
  // that the "windows" pattern lights it by. Whole floors go lit or dark together now and then (an office at night).
  vec2 suv = clamp(vAttr.yz, 0.0, 1.0);
  int grid = 0;
  float fine = -1.0;
  if (vAttr.y < -0.5) {
    vec2 cells = vec2(-vAttr.y - 1.0, vAttr.z);
    vec2 cell = floor(cells), f = fract(cells);
    uvec2 ci = uvec2(ivec2(cell) + ivec2(4096));
    float r = cellHash(ci), fl = cellHash(uvec2(ci.y * 7u + 3u, ci.x / 24u + 911u));
    if (fl < 0.12) r *= 0.2; else if (fl > 0.84) r = 0.8 + 0.2 * r;
    int q = int(min(r * 256.0, 255.0));
    ivec2 fq = ivec2(min(f * 16.0, vec2(15.0)));
    suv = vec2(float(fq.x * 16 + (q >> 4)), float(fq.y * 16 + (q & 15))) / 255.0;
    grid = 256;
    // (For a wall's material detail -- looks.ts WallDetail: the cell's 256ths, whose high nibbles are the bytes above,
    // their low nibbles in the body channel; and how far above its foot, in quarter metres (31: far, or unknown).)
    ivec2 f256 = ivec2(min(f * 256.0, vec2(255.0)));
    fine = float((f256.x & 15) * 16 + (f256.y & 15)) / 255.0;
    grid |= (vFacade < 0.0 ? 31 : min(31, int(vFacade * 4.0))) << 10;
  }
  // A crossed card: its own surface coordinate (across, up), rooted -- dark at its foot, lit at its tips -- and each
  // tuft a touch lighter or darker than the next. (Bit 10 off a grid marks it: its ink is softer.)
  int card = 0;
  if (vAttr.z < -0.5) {
    float id = floor((vAttr.y + 0.5) * 0.5), up = clamp(-vAttr.z - 1.0, 0.0, 1.0);
    suv = vec2(clamp(vAttr.y - 2.0 * id, 0.0, 1.0), up);
    L = L * (0.55 + 0.55 * up) + (cellHash(uvec2(uint(id), 77u)) - 0.5) * 0.12;
    card = 1024;
  }
  gA = vec4(float(slot + 1) / 255.0, clamp(L, 0.0, 1.0), suv);
  gB = uvec4(uint(uLook + 1), (uint(uDraw) << 16u) | uint(int(vPart + 0.5) & 65535), floatBitsToUint(vScene), floatBitsToUint(vView));
  // (The tint's ramp and this thing's pixel size share a channel: the ramp in the low five bits, the size above them.)
  // (Bit 8 of the tint's strength marks a facade grid's packed surface bytes, and bit 9 that this draw wears the
  // style's markFilter -- both read by the paint pass, both clear of the strength's own eight bits.)
  // (And above them both, in bits 10-14, how much of the weather's snow it takes: none without weather.)
  gC = ivec4(uAnchor, tintId + max(1, uChunk) * 32 + (int(clamp(uSnowK, 0.0, 1.0) * 31.0 + 0.5) << 10), int(clamp(tint, 0.0, 1.0) * 255.0) | grid | card | (uMarked == 1 ? 512 : 0));
  // Body space, by the face it is on: a top or an end reads ACROSS the thing, mirrored about its middle (so a stripe
  // is centred and the same on both halves); a side reads along it. Panels meet, so a stripe runs from nose to tail.
  vec3 b = clamp(vBody, 0.0, 1.0);
  vec3 an = abs(n);
  vec2 buv = an.y >= an.x && an.y >= an.z ? vec2(abs(b.x - 0.5) * 2.0, b.z)
           : an.x >= an.z ? vec2(b.z, b.y)
           : vec2(abs(b.x - 0.5) * 2.0, b.y);
  // (The normal, octahedral: two channels do for the reflection, and the other two carry body space.)
  vec3 on = n / max(abs(n.x) + abs(n.y) + abs(n.z), 1e-5);
  vec2 oct = on.z >= 0.0 ? on.xy : (1.0 - abs(on.yx)) * vec2(on.x >= 0.0 ? 1.0 : -1.0, on.y >= 0.0 ? 1.0 : -1.0);
  // (A facade grid's body channel carries its height instead -- 0 at the street, 1 at 96 m -- for its wall's shading.)
  if (grid != 0) buv.y = clamp(vW.y / 96.0, 0.0, 1.0);
  if (fine >= 0.0) buv.x = fine;
  gD = vec4(oct * 0.5 + 0.5, buv);
}`;
