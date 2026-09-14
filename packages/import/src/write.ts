// Writers for every format the importer reads -- glTF/GLB (meshes, nodes,
// materials, PNG textures, skins with inverse bind matrices), OBJ + MTL,
// STL (binary, with colours, or ASCII) and .vox -- and a small mesh builder
// (boxes, balls, capsules, cylinders, tori, sheets), so test models are
// written programmatically, round-trip through the parsers, and nothing is
// downloaded.

import { fromTRS, invert4 } from "./math.ts";
import type { Mat4, V3 } from "./math.ts";
import { encodePng } from "./png.ts";
import { linearToSrgb, worldTransforms } from "./scene.ts";

// ---------------------------------------------------------------- mesh builder

/** Triangles with per-vertex colour and up to four joints/weights each. */
export interface MeshData {
  positions: number[];
  indices: number[];
  uvs: number[];
  colours: number[];
  joints: number[];
  weights: number[];
}
export const meshData = (): MeshData => ({ positions: [], indices: [], uvs: [], colours: [], joints: [], weights: [] });

/** What each vertex added carries: joints (up to four) and weights, a colour (linear RGBA). */
export interface VertexExtras { readonly joints?: readonly number[]; readonly weights?: readonly number[]; readonly colour?: readonly number[]; readonly weightAt?: (p: V3) => { joints: number[]; weights: number[] } }

function push(m: MeshData, p: V3, uv: [number, number], x: VertexExtras): number {
  m.positions.push(p[0], p[1], p[2]);
  m.uvs.push(uv[0], uv[1]);
  const c = x.colour ?? [1, 1, 1, 1];
  m.colours.push(c[0]!, c[1]!, c[2]!, c[3] ?? 1);
  const jw = x.weightAt ? x.weightAt(p) : { joints: [...(x.joints ?? [0])], weights: [...(x.weights ?? [1])] };
  for (let i = 0; i < 4; i += 1) { m.joints.push(jw.joints[i] ?? 0); m.weights.push(jw.weights[i] ?? 0); }
  return m.positions.length / 3 - 1;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addv = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const crs = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** An axis-aligned box (centre, half-extents), turned by `yaw` about y. */
export function addBox(m: MeshData, c: V3, h: V3, x: VertexExtras = {}, yaw = 0): void {
  const co = Math.cos(yaw), si = Math.sin(yaw);
  const P = (sx: number, sy: number, sz: number): V3 => { const lx = sx * h[0], lz = sz * h[2]; return [c[0] + co * lx + si * lz, c[1] + sy * h[1], c[2] - si * lx + co * lz]; };
  const faces: Array<[V3, V3, V3, V3]> = [
    [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], [P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1)],
    [P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1)], [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)],
    [P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1)], [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)],
  ];
  for (const f of faces) {
    const i = [push(m, f[0], [0, 1], x), push(m, f[1], [1, 1], x), push(m, f[2], [1, 0], x), push(m, f[3], [0, 0], x)];
    m.indices.push(i[0]!, i[1]!, i[2]!, i[0]!, i[2]!, i[3]!);
  }
}

/** An ellipsoid (centre, radii) as a UV sphere. */
export function addBall(m: MeshData, c: V3, r: V3, x: VertexExtras = {}, seg = 12): void {
  const rings = Math.max(4, Math.round(seg / 2));
  const base = m.positions.length / 3;
  for (let i = 0; i <= rings; i += 1) {
    const th = (Math.PI * i) / rings;
    for (let j = 0; j <= seg; j += 1) {
      const ph = (2 * Math.PI * j) / seg;
      push(m, [c[0] + r[0] * Math.sin(th) * Math.cos(ph), c[1] + r[1] * Math.cos(th), c[2] + r[2] * Math.sin(th) * Math.sin(ph)], [j / seg, i / rings], x);
    }
  }
  for (let i = 0; i < rings; i += 1) for (let j = 0; j < seg; j += 1) {
    const a = base + i * (seg + 1) + j, b = a + seg + 1;
    m.indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
}

/** A closed cylinder from a to b (radius ra at a, rb at b: a cone when they differ). */
export function addCylinder(m: MeshData, a: V3, b: V3, ra: number, rb = ra, x: VertexExtras = {}, seg = 12): void {
  const axis = nrm(sub(b, a));
  const ref: V3 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = nrm(crs(axis, ref)), v = crs(axis, u);
  const ring = (c: V3, r: number, t: number): number[] => Array.from({ length: seg + 1 }, (_, j) => { const ph = (2 * Math.PI * j) / seg; return push(m, addv(c, addv(scl(u, r * Math.cos(ph)), scl(v, r * Math.sin(ph)))), [j / seg, t], x); });
  const A = ring(a, ra, 0), B = ring(b, rb, 1);
  for (let j = 0; j < seg; j += 1) m.indices.push(A[j]!, B[j]!, A[j + 1]!, A[j + 1]!, B[j]!, B[j + 1]!);
  const ca = push(m, a, [0.5, 0.5], x), cb = push(m, b, [0.5, 0.5], x);
  for (let j = 0; j < seg; j += 1) { m.indices.push(ca, A[j + 1]!, A[j]!); m.indices.push(cb, B[j]!, B[j + 1]!); }
}

/** A capsule: a cylinder with a ball at each end. */
export function addCapsule(m: MeshData, a: V3, b: V3, r: number, x: VertexExtras = {}, seg = 12): void {
  addCylinder(m, a, b, r, r, x, seg);
  addBall(m, a, [r, r, r], x, seg);
  addBall(m, b, [r, r, r], x, seg);
}

/** A torus round the y axis (a ring: collars, belts), centre, major radius R, tube r; `sy` squashes it (a band). */
export function addTorus(m: MeshData, c: V3, R: number, r: number, x: VertexExtras = {}, seg = 16, tube = 8, sy = 1, sz = 1): void {
  const base = m.positions.length / 3;
  for (let i = 0; i <= seg; i += 1) {
    const ph = (2 * Math.PI * i) / seg;
    for (let j = 0; j <= tube; j += 1) {
      const th = (2 * Math.PI * j) / tube;
      const rr = R + r * Math.cos(th);
      push(m, [c[0] + rr * Math.cos(ph), c[1] + r * Math.sin(th) * sy, c[2] + rr * Math.sin(ph) * sz], [i / seg, j / tube], x);
    }
  }
  for (let i = 0; i < seg; i += 1) for (let j = 0; j < tube; j += 1) {
    const a = base + i * (tube + 1) + j, b = a + tube + 1;
    m.indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
}

/** A thick sheet: corners p00, p10, p01 (+ p11 = p10 + p01 - p00), thickness along its normal. */
export function addSheet(m: MeshData, p00: V3, p10: V3, p01: V3, thick: number, x: VertexExtras = {}): void {
  const e1 = sub(p10, p00), e2 = sub(p01, p00);
  const n = scl(nrm(crs(e1, e2)), thick / 2);
  const c = addv(p00, scl(addv(e1, e2), 0.5));
  const L1 = Math.hypot(...e1) / 2, L2 = Math.hypot(...e2) / 2;
  const u = nrm(e1), v = nrm(e2), w = nrm(n);
  const P = (a: number, b: number, d: number): V3 => addv(c, addv(scl(u, a * L1), addv(scl(v, b * L2), scl(w, (d * thick) / 2))));
  const faces: Array<[V3, V3, V3, V3]> = [
    [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], [P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1)],
    [P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1)], [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)],
    [P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1)], [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)],
  ];
  for (const f of faces) {
    const i = [push(m, f[0], [0, 1], x), push(m, f[1], [1, 1], x), push(m, f[2], [1, 0], x), push(m, f[3], [0, 0], x)];
    m.indices.push(i[0]!, i[1]!, i[2]!, i[0]!, i[2]!, i[3]!);
  }
}

/** Append one mesh's triangles to another. */
export function mergeMesh(into: MeshData, m: MeshData): void {
  const base = into.positions.length / 3;
  into.positions.push(...m.positions); into.uvs.push(...m.uvs); into.colours.push(...m.colours); into.joints.push(...m.joints); into.weights.push(...m.weights);
  into.indices.push(...m.indices.map((i) => i + base));
}

// ---------------------------------------------------------------- glTF / GLB

export interface GltfBuildMaterial { readonly name: string; readonly colour: readonly [number, number, number, number]; readonly emissive?: V3; readonly texture?: number; readonly metallic?: number }
export interface GltfBuildPrimitive { readonly mesh: MeshData; readonly material?: number; readonly colours?: boolean; readonly skinned?: boolean }
export interface GltfBuildNode { readonly name: string; readonly parent?: number; readonly t?: V3; readonly r?: readonly number[]; readonly s?: V3; readonly mesh?: number; readonly skin?: number }
export interface GltfBuild {
  readonly nodes: readonly GltfBuildNode[];
  readonly meshes: ReadonlyArray<{ readonly name: string; readonly primitives: readonly GltfBuildPrimitive[] }>;
  readonly materials?: readonly GltfBuildMaterial[];
  /** Textures as RGBA images (encoded to PNG). */
  readonly images?: ReadonlyArray<{ width: number; height: number; data: Uint8Array }>;
  /** Skins: joints as node indices; inverse bind matrices from the nodes' world transforms unless given. */
  readonly skins?: ReadonlyArray<{ readonly name?: string; readonly joints: readonly number[]; readonly inverseBind?: readonly Mat4[] }>;
}

/** A glTF document (JSON) and its binary buffer. */
export function buildGltf(b: GltfBuild): { json: Record<string, unknown>; bin: Uint8Array } {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const views: Array<Record<string, unknown>> = [];
  const accessors: Array<Record<string, unknown>> = [];
  const addView = (bytes: Uint8Array, target?: number): number => {
    const pad = (4 - (length % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); length += pad; }
    views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes); length += bytes.length;
    return views.length - 1;
  };
  const accessor = (data: ArrayLike<number>, type: string, ct: number, count: number, extra: Record<string, unknown> = {}): number => {
    const arr = ct === 5126 ? Float32Array.from(data) : ct === 5125 ? Uint32Array.from(data) : ct === 5123 ? Uint16Array.from(data) : Uint8Array.from(data);
    const view = addView(new Uint8Array(arr.buffer), extra["target"] as number | undefined);
    const { target: _t, ...rest } = extra;
    void _t;
    accessors.push({ bufferView: view, componentType: ct, count, type, ...rest });
    return accessors.length - 1;
  };
  const worlds = worldTransforms(b.nodes.map((n) => ({ parent: n.parent ?? -1, local: fromTRS(n.t, n.r, n.s) })));
  const meshes = b.meshes.map((me) => ({
    name: me.name,
    primitives: me.primitives.map((p) => {
      const m = p.mesh;
      const n = m.positions.length / 3;
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i += 1) for (let k = 0; k < 3; k += 1) { min[k] = Math.min(min[k]!, m.positions[i * 3 + k]!); max[k] = Math.max(max[k]!, m.positions[i * 3 + k]!); }
      const attributes: Record<string, number> = {
        POSITION: accessor(m.positions, "VEC3", 5126, n, { min, max, target: 34962 }),
        TEXCOORD_0: accessor(m.uvs, "VEC2", 5126, n, { target: 34962 }),
      };
      if (p.colours) attributes["COLOR_0"] = accessor(m.colours, "VEC4", 5126, n, { target: 34962 });
      if (p.skinned) {
        attributes["JOINTS_0"] = accessor(m.joints, "VEC4", 5123, n, { target: 34962 });
        attributes["WEIGHTS_0"] = accessor(m.weights, "VEC4", 5126, n, { target: 34962 });
      }
      return { attributes, indices: accessor(m.indices, "SCALAR", n > 65535 ? 5125 : 5123, m.indices.length, { target: 34963 }), ...(p.material !== undefined ? { material: p.material } : {}), mode: 4 };
    }),
  }));
  const skins = (b.skins ?? []).map((s) => {
    const ibm = s.inverseBind ?? s.joints.map((j) => invert4(worlds[j]!));
    const flat: number[] = [];
    for (const m of ibm) flat.push(...m);
    return { ...(s.name ? { name: s.name } : {}), joints: [...s.joints], inverseBindMatrices: accessor(flat, "MAT4", 5126, ibm.length) };
  });
  const images = (b.images ?? []).map((img) => ({ bufferView: addView(encodePng(img)), mimeType: "image/png" }));
  const children = b.nodes.map((_n, i) => b.nodes.map((m, j) => (m.parent === i ? j : -1)).filter((j) => j >= 0));
  const json: Record<string, unknown> = {
    asset: { version: "2.0", generator: "keel-engine import writer" },
    scene: 0,
    scenes: [{ name: "scene", nodes: b.nodes.map((n, i) => (n.parent === undefined ? i : -1)).filter((i) => i >= 0) }],
    nodes: b.nodes.map((n, i) => ({
      name: n.name, ...(children[i]!.length ? { children: children[i] } : {}),
      ...(n.t ? { translation: [...n.t] } : {}), ...(n.r ? { rotation: [...n.r] } : {}), ...(n.s ? { scale: [...n.s] } : {}),
      ...(n.mesh !== undefined ? { mesh: n.mesh } : {}), ...(n.skin !== undefined ? { skin: n.skin } : {}),
    })),
    meshes,
    materials: (b.materials ?? []).map((m) => ({
      name: m.name,
      pbrMetallicRoughness: { baseColorFactor: [...m.colour], metallicFactor: m.metallic ?? 0, roughnessFactor: 0.8, ...(m.texture !== undefined ? { baseColorTexture: { index: m.texture } } : {}) },
      ...(m.emissive ? { emissiveFactor: [...m.emissive] } : {}),
    })),
    ...(images.length ? { images, textures: images.map((_im, i) => ({ source: i, sampler: 0 })), samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 10497, wrapT: 10497 }] } : {}),
    ...(skins.length ? { skins } : {}),
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: length }],
  };
  const bin = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) { bin.set(c, o); o += c.length; }
  return { json, bin };
}

/** A .glb file. */
export function writeGlb(b: GltfBuild): Uint8Array {
  const { json, bin } = buildGltf(b);
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (text.length % 4)) % 4, bpad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + text.length + jpad + 8 + bin.length + bpad;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, text.length + jpad, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20); out.fill(0x20, 20 + text.length, 20 + text.length + jpad);
  const b0 = 20 + text.length + jpad;
  dv.setUint32(b0, bin.length + bpad, true); dv.setUint32(b0 + 4, 0x004e4942, true);
  out.set(bin, b0 + 8);
  return out;
}

/** A .gltf JSON document with its buffer inline (a data: URI). */
export function writeGltfJson(b: GltfBuild): string {
  const { json, bin } = buildGltf(b);
  let s = "";
  for (let i = 0; i < bin.length; i += 1) s += String.fromCharCode(bin[i]!);
  const b64 = typeof btoa === "function" ? btoa(s) : "";
  (json["buffers"] as Array<Record<string, unknown>>)[0]!["uri"] = `data:application/octet-stream;base64,${b64}`;
  return JSON.stringify(json);
}

// ---------------------------------------------------------------- OBJ, STL, VOX

const fmt = (v: number): string => (Math.abs(v) < 1e-9 ? "0" : Number(v.toFixed(6)).toString());

/** OBJ text (one "o" per group, usemtl per group) and its MTL. Colours are written as sRGB. */
export function writeObj(groups: ReadonlyArray<{ readonly name: string; readonly mesh: MeshData; readonly material?: string }>, materials: ReadonlyArray<{ readonly name: string; readonly colour: readonly number[] }> = [], mtlName = "model.mtl"): { obj: string; mtl: string } {
  const lines = [`# keel-engine import writer`, `mtllib ${mtlName}`];
  let base = 1;
  for (const g of groups) {
    lines.push(`o ${g.name}`);
    const n = g.mesh.positions.length / 3;
    for (let i = 0; i < n; i += 1) lines.push(`v ${fmt(g.mesh.positions[i * 3]!)} ${fmt(g.mesh.positions[i * 3 + 1]!)} ${fmt(g.mesh.positions[i * 3 + 2]!)}`);
    for (let i = 0; i < n; i += 1) lines.push(`vt ${fmt(g.mesh.uvs[i * 2]!)} ${fmt(1 - g.mesh.uvs[i * 2 + 1]!)}`);
    if (g.material) lines.push(`usemtl ${g.material}`);
    for (let i = 0; i < g.mesh.indices.length; i += 3) {
      const [a, b, c] = [g.mesh.indices[i]! + base, g.mesh.indices[i + 1]! + base, g.mesh.indices[i + 2]! + base];
      lines.push(`f ${a}/${a} ${b}/${b} ${c}/${c}`);
    }
    base += n;
  }
  const mtl = materials.flatMap((m) => [`newmtl ${m.name}`, `Kd ${fmt(linearToSrgb(m.colour[0]!))} ${fmt(linearToSrgb(m.colour[1]!))} ${fmt(linearToSrgb(m.colour[2]!))}`, "d 1", ""]).join("\n");
  return { obj: lines.join("\n") + "\n", mtl };
}

/** Binary STL (with a VisCAM colour per facet when `colour` is given, linear RGB), or ASCII. */
export function writeStl(mesh: MeshData, { ascii = false, name = "keel", colour }: { ascii?: boolean; name?: string; colour?: V3 } = {}): Uint8Array | string {
  const n = mesh.indices.length / 3;
  const P = (i: number): V3 => [mesh.positions[i * 3]!, mesh.positions[i * 3 + 1]!, mesh.positions[i * 3 + 2]!];
  const normal = (t: number): V3 => nrm(crs(sub(P(mesh.indices[t * 3 + 1]!), P(mesh.indices[t * 3]!)), sub(P(mesh.indices[t * 3 + 2]!), P(mesh.indices[t * 3]!))));
  if (ascii) {
    const l = [`solid ${name}`];
    for (let t = 0; t < n; t += 1) {
      const nn = normal(t);
      l.push(`  facet normal ${fmt(nn[0])} ${fmt(nn[1])} ${fmt(nn[2])}`, "    outer loop");
      for (let c = 0; c < 3; c += 1) { const p = P(mesh.indices[t * 3 + c]!); l.push(`      vertex ${fmt(p[0])} ${fmt(p[1])} ${fmt(p[2])}`); }
      l.push("    endloop", "  endfacet");
    }
    l.push(`endsolid ${name}`);
    return l.join("\n") + "\n";
  }
  const out = new Uint8Array(84 + n * 50);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode(name.slice(0, 80)), 0);
  dv.setUint32(80, n, true);
  const attr = colour ? 0x8000 | (Math.round(linearToSrgb(colour[0]) * 31) << 10) | (Math.round(linearToSrgb(colour[1]) * 31) << 5) | Math.round(linearToSrgb(colour[2]) * 31) : 0;
  for (let t = 0; t < n; t += 1) {
    const o = 84 + t * 50;
    const nn = normal(t);
    for (let k = 0; k < 3; k += 1) dv.setFloat32(o + k * 4, nn[k]!, true);
    for (let c = 0; c < 3; c += 1) { const p = P(mesh.indices[t * 3 + c]!); for (let k = 0; k < 3; k += 1) dv.setFloat32(o + 12 + c * 12 + k * 4, p[k]!, true); }
    dv.setUint16(o + 48, attr, true);
  }
  return out;
}

/** A .vox file: models (size, voxels as [x, y, z, colour index] in MagicaVoxel's frame) placed by translation, a palette (sRGB bytes, index 1..255). */
export function writeVox(models: ReadonlyArray<{ readonly name?: string; readonly size: readonly [number, number, number]; readonly voxels: ReadonlyArray<readonly [number, number, number, number]>; readonly t?: readonly [number, number, number] }>, palette: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  const chunk = (id: string, content: Uint8Array, children: Uint8Array = new Uint8Array(0)): Uint8Array => {
    const c = new Uint8Array(12 + content.length + children.length);
    const dv = new DataView(c.buffer);
    for (let i = 0; i < 4; i += 1) c[i] = id.charCodeAt(i);
    dv.setInt32(4, content.length, true); dv.setInt32(8, children.length, true);
    c.set(content, 12); c.set(children, 12 + content.length);
    return c;
  };
  const ints = (...v: number[]): Uint8Array => { const b = new Uint8Array(v.length * 4); const dv = new DataView(b.buffer); v.forEach((x, i) => dv.setInt32(i * 4, x, true)); return b; };
  const cat = (...a: Uint8Array[]): Uint8Array => { const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
  const str = (s: string): Uint8Array => { const t = new TextEncoder().encode(s); return cat(ints(t.length), t); };
  const dict = (d: Record<string, string>): Uint8Array => cat(ints(Object.keys(d).length), ...Object.entries(d).flatMap(([k, v]) => [str(k), str(v)]));
  for (const m of models) {
    parts.push(chunk("SIZE", ints(m.size[0], m.size[1], m.size[2])));
    const xyzi = new Uint8Array(4 + m.voxels.length * 4);
    new DataView(xyzi.buffer).setInt32(0, m.voxels.length, true);
    m.voxels.forEach((v, i) => xyzi.set([v[0], v[1], v[2], v[3]], 4 + i * 4));
    parts.push(chunk("XYZI", xyzi));
  }
  // Scene graph: root transform -> group -> (transform -> shape) per model.
  const ids = models.map((_m, i) => [2 + i * 2, 3 + i * 2] as const);
  parts.push(chunk("nTRN", cat(ints(0), dict({}), ints(1, -1, -1, 1), dict({}))));
  parts.push(chunk("nGRP", cat(ints(1), dict({}), ints(models.length, ...ids.map((p) => p[0])))));
  models.forEach((m, i) => {
    const t = m.t ?? [0, 0, 0];
    parts.push(chunk("nTRN", cat(ints(ids[i]![0]), dict(m.name ? { _name: m.name } : {}), ints(ids[i]![1], -1, 0, 1), dict({ _t: `${t[0]} ${t[1]} ${t[2]}` }))));
    parts.push(chunk("nSHP", cat(ints(ids[i]![1]), dict({}), ints(1, i), dict({}))));
  });
  const rgba = new Uint8Array(256 * 4);
  for (let i = 1; i < 256; i += 1) rgba.set(palette.subarray(i * 4, i * 4 + 4), (i - 1) * 4);
  parts.push(chunk("RGBA", rgba));
  const main = chunk("MAIN", new Uint8Array(0), cat(...parts));
  return cat(new Uint8Array([0x56, 0x4f, 0x58, 0x20]), ints(150), main);
}

/** A node's world matrix from a GltfBuild (to place things relative to joints). */
export function buildWorlds(b: Pick<GltfBuild, "nodes">): Mat4[] {
  return worldTransforms(b.nodes.map((n) => ({ parent: n.parent ?? -1, local: fromTRS(n.t, n.r, n.s) })));
}
