// glTF 2.0, as JSON (.gltf, buffers inline as data: URIs or handed in by
// name) or binary (.glb). Meshes and their primitives (triangles, strips and
// fans), the node hierarchy with its transforms, materials (base colour
// factor, base colour texture and its uv set, emissive, metallic), images
// (PNG decoded here; JPEG and others through the host's `decodeImage`),
// samplers, vertex colours, skins (joints, inverse bind matrices, JOINTS_0 /
// WEIGHTS_0), sparse accessors and quantized attributes.
//
//   const scene = parseGltf(bytesOrJson, { resources: { "body.bin": bytes } });

import { fromTRS, identity, GLTF_AXES } from "./math.ts";
import type { Mat4 } from "./math.ts";
import { decodePng, isPng } from "./png.ts";
import { ImportError, emptyScene, worldTransforms } from "./scene.ts";
import type { ImportImage, ImportMaterial, ImportMesh, ImportNode, ImportPrimitive, ImportScene, ImportSkin, ImportTexture } from "./scene.ts";

export interface GltfOptions {
  /** External files a .gltf names (buffers, images), by URI. */
  readonly resources?: Readonly<Record<string, Uint8Array>>;
  /** Decode an image the importer can't (JPEG, WebP, interlaced PNG): RGBA, or null to skip its texture. */
  readonly decodeImage?: (bytes: Uint8Array, mimeType: string) => ImportImage | null;
  /** Which scene (default: the file's `scene`, else 0). */
  readonly scene?: number;
  readonly name?: string;
}

type Json = Record<string, unknown>;
const SUPPORTED_EXT = new Set(["KHR_materials_emissive_strength", "KHR_mesh_quantization", "KHR_texture_transform", "KHR_materials_unlit"]);
const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

const fail = (msg: string): never => { throw new ImportError("glTF", msg); };
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Is this a GLB (binary glTF)? */
export const isGlb = (b: Uint8Array): boolean => b.length >= 12 && b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46;

function decodeBase64(s: string): Uint8Array {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0, acc = 0, o = 0;
  for (const ch of clean) {
    acc = (acc << 6) | A.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; if (o < out.length) out[o++] = (acc >> bits) & 255; }
  }
  return out.subarray(0, o);
}

/** Read a GLB container: its JSON and its BIN chunk. */
export function readGlb(b: Uint8Array): { json: Json; bin: Uint8Array | null } {
  if (!isGlb(b)) fail("not a GLB (no 'glTF' magic)");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const version = dv.getUint32(4, true);
  if (version !== 2) fail(`GLB version ${version}: only 2 is supported`);
  const length = dv.getUint32(8, true);
  if (length > b.length) fail(`GLB says ${length} bytes, the file has ${b.length}`);
  let pos = 12, json: Json | null = null, bin: Uint8Array | null = null;
  while (pos + 8 <= length) {
    const len = dv.getUint32(pos, true), type = dv.getUint32(pos + 4, true);
    if (pos + 8 + len > length) fail(`GLB chunk at ${pos} runs past the end`);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (type === 0x4e4f534a) {
      try { json = JSON.parse(new TextDecoder().decode(data)) as Json; } catch (e) { fail(`GLB JSON chunk: ${(e as Error).message}`); }
    } else if (type === 0x004e4942 && !bin) bin = data;
    pos += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) fail("GLB has no JSON chunk");
  return { json: json!, bin };
}

/** glTF (JSON text, a parsed object, or GLB bytes) -> an ImportScene. */
export function parseGltf(input: Uint8Array | string | Json, opts: GltfOptions = {}): ImportScene {
  let json: Json, bin: Uint8Array | null = null;
  if (input instanceof Uint8Array) {
    if (isGlb(input)) ({ json, bin } = readGlb(input));
    else { try { json = JSON.parse(new TextDecoder().decode(input)) as Json; } catch (e) { return fail(`neither GLB nor JSON: ${(e as Error).message}`); } }
  } else if (typeof input === "string") { try { json = JSON.parse(input) as Json; } catch (e) { return fail(`bad JSON: ${(e as Error).message}`); } }
  else json = input;
  const asset = json["asset"] as Json | undefined;
  if (!asset || typeof asset["version"] !== "string") fail("no asset.version (is this glTF 2.0?)");
  if (!String(asset!["version"]).startsWith("2")) fail(`asset.version ${String(asset!["version"])}: only 2.x is supported`);
  const required = (json["extensionsRequired"] as string[] | undefined) ?? [];
  const missing = required.filter((e) => !SUPPORTED_EXT.has(e));
  if (missing.length) fail(`needs ${missing.join(", ")}${missing.includes("KHR_draco_mesh_compression") ? " (Draco-compressed meshes: decompress them first, e.g. gltf-transform)" : ""}`);
  const warnings: string[] = [];
  const res = opts.resources ?? {};

  // Buffers and views.
  const buffers = arr(json["buffers"]).map((b, i): Uint8Array => {
    const uri = b["uri"] as string | undefined;
    const len = num(b["byteLength"], 0);
    let data: Uint8Array | undefined;
    if (uri === undefined) { if (!bin) fail(`buffer ${i} has no uri and there is no GLB BIN chunk`); data = bin!; }
    else if (uri.startsWith("data:")) data = decodeBase64(uri.slice(uri.indexOf(",") + 1));
    else data = res[uri] ?? res[decodeURIComponent(uri)];
    if (!data) return fail(`buffer ${i} is "${uri}": pass its bytes in resources`);
    if (data.length < len) fail(`buffer ${i} has ${data.length} bytes, byteLength says ${len}`);
    return data;
  });
  const views = arr(json["bufferViews"]);
  const viewBytes = (vi: number): { bytes: Uint8Array; stride: number } => {
    const v = views[vi];
    if (!v) return fail(`bufferView ${vi} doesn't exist`);
    const buf = buffers[num(v["buffer"], -1)];
    if (!buf) return fail(`bufferView ${vi}: buffer ${String(v["buffer"])} doesn't exist`);
    const off = num(v["byteOffset"], 0), len = num(v["byteLength"], 0);
    if (off + len > buf.length) fail(`bufferView ${vi} runs past the end of buffer ${String(v["buffer"])}`);
    return { bytes: buf.subarray(off, off + len), stride: num(v["byteStride"], 0) };
  };

  // Accessors: every element as floats (normalized ints scaled to 0..1 / -1..1 when flagged).
  const accessors = arr(json["accessors"]);
  const cache = new Map<number, Float64Array>();
  const readAccessor = (ai: number, what: string): { data: Float64Array; count: number; comps: number } => {
    const a = accessors[ai];
    if (!a) return fail(`${what}: accessor ${ai} doesn't exist`);
    const comps = COMPONENTS[String(a["type"])];
    const ct = num(a["componentType"], 0);
    const size = BYTES[ct];
    if (!comps || !size) return fail(`${what}: accessor ${ai} has type ${String(a["type"])} / componentType ${ct}`);
    const count = num(a["count"], 0);
    const had = cache.get(ai);
    if (had) return { data: had, count, comps };
    const out = new Float64Array(count * comps);
    const norm = a["normalized"] === true;
    const readInto = (target: Float64Array, bytes: Uint8Array, stride: number, offset: number, n: number, compType: number, into?: Uint32Array): void => {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const sz = BYTES[compType]!;
      const step = stride || sz * comps;
      if (n && offset + step * (n - 1) + sz * comps > bytes.length) fail(`${what}: accessor ${ai} reads past the end of its bufferView`);
      for (let i = 0; i < n; i += 1) for (let c = 0; c < comps; c += 1) {
        const p = offset + i * step + c * sz;
        let v: number;
        switch (compType) {
          case 5120: v = dv.getInt8(p); if (norm) v = Math.max(v / 127, -1); break;
          case 5121: v = dv.getUint8(p); if (norm) v /= 255; break;
          case 5122: v = dv.getInt16(p, true); if (norm) v = Math.max(v / 32767, -1); break;
          case 5123: v = dv.getUint16(p, true); if (norm) v /= 65535; break;
          case 5125: v = dv.getUint32(p, true); break;
          default: v = dv.getFloat32(p, true);
        }
        target[(into ? into[i]! : i) * comps + c] = v;
      }
    };
    if (a["bufferView"] !== undefined) {
      const { bytes, stride } = viewBytes(num(a["bufferView"], -1));
      readInto(out, bytes, stride, num(a["byteOffset"], 0), count, ct);
    }
    const sparse = a["sparse"] as Json | undefined;
    if (sparse) {
      const n = num(sparse["count"], 0);
      const si = sparse["indices"] as Json, sv = sparse["values"] as Json;
      const iv = viewBytes(num(si["bufferView"], -1));
      const idx = new Uint32Array(n);
      const idt = num(si["componentType"], 5125);
      const dvi = new DataView(iv.bytes.buffer, iv.bytes.byteOffset, iv.bytes.byteLength);
      const io = num(si["byteOffset"], 0);
      for (let i = 0; i < n; i += 1) {
        const p = io + i * BYTES[idt]!;
        idx[i] = idt === 5121 ? dvi.getUint8(p) : idt === 5123 ? dvi.getUint16(p, true) : dvi.getUint32(p, true);
        if (idx[i]! >= count) fail(`${what}: accessor ${ai}'s sparse index ${idx[i]} is past its ${count} elements`);
      }
      const vv = viewBytes(num(sv["bufferView"], -1));
      readInto(out, vv.bytes, 0, num(sv["byteOffset"], 0), n, ct, idx);
    }
    cache.set(ai, out);
    return { data: out, count, comps };
  };

  // Images, textures, materials.
  const images = arr(json["images"]).map((im, i): ImportImage => {
    let bytes: Uint8Array | undefined;
    let mime = String(im["mimeType"] ?? "");
    const uri = im["uri"] as string | undefined;
    if (im["bufferView"] !== undefined) bytes = viewBytes(num(im["bufferView"], -1)).bytes;
    else if (uri?.startsWith("data:")) { mime ||= uri.slice(5, uri.indexOf(";")); bytes = decodeBase64(uri.slice(uri.indexOf(",") + 1)); }
    else if (uri) bytes = res[uri] ?? res[decodeURIComponent(uri)];
    const name = String(im["name"] ?? uri ?? `image${i}`);
    if (!bytes) { warnings.push(`image ${i} (${name}) wasn't given: its textures are left out`); return { width: 0, height: 0, data: new Uint8Array(0), name }; }
    try {
      if (isPng(bytes)) return { ...decodePng(bytes), name };
    } catch (e) {
      if (!opts.decodeImage) { warnings.push(`image ${i} (${name}): ${(e as Error).message}; its textures are left out`); return { width: 0, height: 0, data: new Uint8Array(0), name }; }
    }
    const d = opts.decodeImage?.(bytes, mime || "application/octet-stream") ?? null;
    if (!d) { warnings.push(`image ${i} (${name}, ${mime || "unknown type"}) can't be decoded here (PNG only; pass decodeImage): its textures are left out`); return { width: 0, height: 0, data: new Uint8Array(0), name }; }
    return { ...d, name };
  });
  const samplers = arr(json["samplers"]);
  const wrapOf = (v: unknown): ImportTexture["wrapS"] => (v === 33071 ? "clamp" : v === 33648 ? "mirror" : "repeat");
  const textures = arr(json["textures"]).map((t): ImportTexture => {
    const s = t["sampler"] !== undefined ? samplers[num(t["sampler"], -1)] ?? {} : {};
    return { image: num(t["source"], -1), wrapS: wrapOf(s["wrapS"]), wrapT: wrapOf(s["wrapT"]), nearest: s["magFilter"] === 9728 };
  });
  const materials = arr(json["materials"]).map((m, i): ImportMaterial => {
    const pbr = (m["pbrMetallicRoughness"] as Json | undefined) ?? {};
    const f = arr(pbr["baseColorFactor"]).length === 4 ? (pbr["baseColorFactor"] as number[]) : [1, 1, 1, 1];
    const tex = pbr["baseColorTexture"] as Json | undefined;
    const ext = (m["extensions"] as Json | undefined) ?? {};
    const strength = num((ext["KHR_materials_emissive_strength"] as Json | undefined)?.["emissiveStrength"], 1);
    const e = arr(m["emissiveFactor"]).length === 3 ? (m["emissiveFactor"] as number[]) : [0, 0, 0];
    return {
      name: String(m["name"] ?? `material${i}`),
      colour: [num(f[0], 1), num(f[1], 1), num(f[2], 1), num(f[3], 1)],
      ...(tex && textures[num(tex["index"], -1)] && images[textures[num(tex["index"], -1)]!.image]?.width ? { texture: { texture: num(tex["index"], -1), texCoord: num(tex["texCoord"], 0) } } : {}),
      ...(e.some((v) => v > 0) ? { emissive: [e[0]! * strength, e[1]! * strength, e[2]! * strength] as const } : {}),
      metallic: num(pbr["metallicFactor"], 1),
    };
  });

  // Meshes.
  const meshes = arr(json["meshes"]).map((m, mi): ImportMesh => {
    const prims: ImportPrimitive[] = [];
    arr(m["primitives"]).forEach((p, pi) => {
      const where = `mesh ${mi} (${String(m["name"] ?? "")}) primitive ${pi}`;
      const mode = num(p["mode"], 4);
      if (mode < 4) { warnings.push(`${where}: points/lines (mode ${mode}) have no surface: left out`); return; }
      const at = (p["attributes"] as Json | undefined) ?? {};
      if (at["POSITION"] === undefined) { warnings.push(`${where}: no POSITION: left out`); return; }
      const pos = readAccessor(num(at["POSITION"], -1), `${where} POSITION`);
      if (pos.comps !== 3) fail(`${where}: POSITION must be VEC3`);
      const n = pos.count;
      const f32 = (d: Float64Array): Float32Array => Float32Array.from(d);
      const uvs: Float32Array[] = [];
      for (const k of ["TEXCOORD_0", "TEXCOORD_1"]) if (at[k] !== undefined) uvs.push(f32(readAccessor(num(at[k], -1), `${where} ${k}`).data));
      let colours: Float32Array | undefined;
      if (at["COLOR_0"] !== undefined) {
        const c = readAccessor(num(at["COLOR_0"], -1), `${where} COLOR_0`);
        colours = new Float32Array(n * 4);
        for (let i = 0; i < n; i += 1) for (let k = 0; k < 4; k += 1) colours[i * 4 + k] = k < c.comps ? c.data[i * c.comps + k]! : 1;
      }
      let joints: Uint16Array | undefined, weights: Float32Array | undefined;
      if (at["JOINTS_0"] !== undefined && at["WEIGHTS_0"] !== undefined) {
        const j = readAccessor(num(at["JOINTS_0"], -1), `${where} JOINTS_0`), w = readAccessor(num(at["WEIGHTS_0"], -1), `${where} WEIGHTS_0`);
        if (j.comps !== 4 || w.comps !== 4 || j.count !== n || w.count !== n) fail(`${where}: JOINTS_0 and WEIGHTS_0 must be VEC4, one per vertex`);
        joints = Uint16Array.from(j.data);
        weights = f32(w.data);
      }
      let idx: Uint32Array;
      if (p["indices"] !== undefined) {
        const ix = readAccessor(num(p["indices"], -1), `${where} indices`);
        idx = Uint32Array.from(ix.data);
        for (const v of idx) if (v >= n) fail(`${where}: index ${v} past its ${n} vertices`);
      } else idx = Uint32Array.from({ length: n }, (_, i) => i);
      if (mode === 5 || mode === 6) {
        const tri: number[] = [];
        for (let i = 2; i < idx.length; i += 1) {
          if (mode === 5) { if (i % 2) tri.push(idx[i - 1]!, idx[i - 2]!, idx[i]!); else tri.push(idx[i - 2]!, idx[i - 1]!, idx[i]!); }
          else tri.push(idx[0]!, idx[i - 1]!, idx[i]!);
        }
        idx = Uint32Array.from(tri);
      }
      if (idx.length % 3) { warnings.push(`${where}: ${idx.length} indices isn't whole triangles: the last ${idx.length % 3} dropped`); idx = idx.subarray(0, idx.length - (idx.length % 3)); }
      const mat = p["material"] !== undefined ? num(p["material"], -1) : -1;
      prims.push({ positions: f32(pos.data), ...(uvs.length ? { uvs } : {}), ...(colours ? { colours } : {}), ...(joints && weights ? { joints, weights } : {}), indices: idx, material: mat < materials.length ? mat : -1 });
    });
    return { name: String(m["name"] ?? `mesh${mi}`), primitives: prims };
  });

  // Nodes: transforms, then the scene's roots decide what's drawn.
  const rawNodes = arr(json["nodes"]);
  const parent = new Array<number>(rawNodes.length).fill(-1);
  rawNodes.forEach((n, i) => arr(n["children"]).forEach((c) => {
    const ci = c as unknown as number;
    if (!Number.isInteger(ci) || !rawNodes[ci]) fail(`node ${i}'s child ${String(c)} doesn't exist`);
    if (parent[ci] !== -1) fail(`node ${ci} has two parents`);
    parent[ci] = i;
  }));
  const locals: Mat4[] = rawNodes.map((n) => {
    const m = n["matrix"] as number[] | undefined;
    if (Array.isArray(m) && m.length === 16) return Float64Array.from(m);
    return fromTRS(n["translation"] as number[] | undefined, n["rotation"] as number[] | undefined, n["scale"] as number[] | undefined);
  });
  const worlds = worldTransforms(rawNodes.map((_n, i) => ({ parent: parent[i]!, local: locals[i]! })));
  const scenes = arr(json["scenes"]);
  const which = opts.scene ?? num(json["scene"], 0);
  const roots = scenes.length ? arr(scenes[which]?.["nodes"]) as unknown as number[] : rawNodes.map((_n, i) => i).filter((i) => parent[i] === -1);
  if (scenes.length && !scenes[which]) fail(`scene ${which} doesn't exist (${scenes.length} scenes)`);
  const drawn = new Set<number>();
  const walk = (i: number): void => { if (drawn.has(i)) return; drawn.add(i); arr(rawNodes[i]?.["children"]).forEach((c) => walk(c as unknown as number)); };
  roots.forEach(walk);
  const skins = arr(json["skins"]).map((s, si): ImportSkin => {
    const joints = arr(s["joints"]) as unknown as number[];
    for (const j of joints) if (!rawNodes[j]) fail(`skin ${si}: joint ${j} doesn't exist`);
    let inverseBind: Mat4[] = joints.map(() => identity());
    if (s["inverseBindMatrices"] !== undefined) {
      const a = readAccessor(num(s["inverseBindMatrices"], -1), `skin ${si} inverseBindMatrices`);
      if (a.comps !== 16 || a.count < joints.length) fail(`skin ${si}: inverseBindMatrices must be one MAT4 per joint`);
      inverseBind = joints.map((_j, i) => Float64Array.from(a.data.subarray(i * 16, i * 16 + 16)));
    }
    return { name: String(s["name"] ?? `skin${si}`), joints, inverseBind, ...(s["skeleton"] !== undefined ? { skeleton: num(s["skeleton"], -1) } : {}) };
  });
  const nodes = rawNodes.map((n, i): ImportNode => {
    const mesh = n["mesh"] !== undefined && drawn.has(i) ? num(n["mesh"], -1) : undefined;
    if (mesh !== undefined && !meshes[mesh]) fail(`node ${i}: mesh ${mesh} doesn't exist`);
    const skin = n["skin"] !== undefined ? num(n["skin"], -1) : undefined;
    if (skin !== undefined && !skins[skin]) fail(`node ${i}: skin ${skin} doesn't exist`);
    return {
      name: String(n["name"] ?? (mesh !== undefined ? meshes[mesh]!.name : `node${i}`)), parent: parent[i]!, children: arr(n["children"]) as unknown as number[],
      local: locals[i]!, world: worlds[i]!, ...(mesh !== undefined ? { mesh } : {}), ...(skin !== undefined ? { skin } : {}),
    };
  });
  const base = emptyScene(input instanceof Uint8Array && isGlb(input) ? "glb" : "gltf", opts.name ?? String(scenes[which]?.["name"] ?? "gltf"), GLTF_AXES, 1);
  return { ...base, nodes, meshes, materials, textures, images, skins, warnings };
}
