// Wavefront OBJ (+ MTL): v (with the common "v x y z r g b" vertex colour
// extension), vt, f (any polygon, fanned into triangles; negative indices;
// v, v/vt, v//vn, v/vt/vn), o and g (each object/group its own node and mesh),
// usemtl, mtllib. MTL: newmtl, Kd (diffuse colour), d / Tr (opacity), Ke
// (emissive), map_Kd (a PNG handed in by name).
//
//   parseObj(text, { mtl: { "crate.mtl": mtlText }, images: { "wood.png": bytes } })

import { GLTF_AXES, identity } from "./math.ts";
import type { Axes } from "./math.ts";
import { decodePng, isPng } from "./png.ts";
import { ImportError, emptyScene, srgbToLinear } from "./scene.ts";
import type { ImportImage, ImportMaterial, ImportMesh, ImportNode, ImportPrimitive, ImportScene, ImportTexture } from "./scene.ts";

export interface ObjOptions {
  /** MTL files by name (what mtllib names). */
  readonly mtl?: Readonly<Record<string, string>>;
  /** Texture images by name (what map_Kd names): PNG bytes, or decoded RGBA. */
  readonly images?: Readonly<Record<string, Uint8Array | ImportImage>>;
  /** Metres per OBJ unit (default 1). */
  readonly metres?: number;
  readonly axes?: Axes;
  readonly name?: string;
}

interface MtlDef { name: string; kd: [number, number, number]; d: number; ke: [number, number, number]; map?: string }

/** MTL text -> materials by name (colours as written: sRGB 0..1). */
export function parseMtl(text: string): MtlDef[] {
  const out: MtlDef[] = [];
  let cur: MtlDef | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(/\s+/);
    const nums = rest.map(Number);
    if (k === "newmtl") { cur = { name: rest.join(" "), kd: [0.8, 0.8, 0.8], d: 1, ke: [0, 0, 0] }; out.push(cur); continue; }
    if (!cur) continue;
    if (k === "Kd" && nums.length >= 3 && nums.slice(0, 3).every(Number.isFinite)) cur.kd = [nums[0]!, nums[1]!, nums[2]!];
    else if (k === "Ke" && nums.length >= 3 && nums.slice(0, 3).every(Number.isFinite)) cur.ke = [nums[0]!, nums[1]!, nums[2]!];
    else if (k === "d" && Number.isFinite(nums[0])) cur.d = nums[0]!;
    else if (k === "Tr" && Number.isFinite(nums[0])) cur.d = 1 - nums[0]!;
    else if (k === "map_Kd" && rest.length) cur.map = rest[rest.length - 1]!;
  }
  return out;
}

/** OBJ text -> an ImportScene: one node and mesh per o/g, a primitive per material. */
export function parseObj(text: string, opts: ObjOptions = {}): ImportScene {
  const pos: number[] = [], col: number[] = [], uv: number[] = [];
  let hasColour = false;
  const warnings: string[] = [];
  const mtls = new Map<string, MtlDef>();
  const libs: string[] = [];
  // Groups: name -> material -> corner list (position, uv indices).
  interface Group { name: string; byMat: Map<string, number[]> }
  const groups: Group[] = [];
  let group: Group | null = null;
  let mat = "";
  const start = (name: string): void => { group = groups.find((g) => g.name === name) ?? null; if (!group) { group = { name, byMat: new Map() }; groups.push(group); } };
  const lines = text.split(/\r?\n/);
  for (let ln = 0; ln < lines.length; ln += 1) {
    let line = lines[ln]!;
    while (line.endsWith("\\") && ln + 1 < lines.length) line = line.slice(0, -1) + " " + lines[++ln]!;
    line = line.replace(/#.*$/, "").trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const k = parts[0]!;
    const where = `line ${ln + 1}`;
    if (k === "v") {
      const n = parts.slice(1).map(Number);
      if (n.length < 3 || n.slice(0, 3).some((v) => !Number.isFinite(v))) throw new ImportError("OBJ", `${where}: "v" needs three numbers ("${line}")`);
      pos.push(n[0]!, n[1]!, n[2]!);
      if (n.length >= 6 && n.slice(3, 6).every(Number.isFinite)) { col.push(n[3]!, n[4]!, n[5]!); hasColour = true; } else col.push(1, 1, 1);
    } else if (k === "vt") {
      const n = parts.slice(1).map(Number);
      uv.push(Number.isFinite(n[0]) ? n[0]! : 0, Number.isFinite(n[1]) ? n[1]! : 0);
    } else if (k === "f") {
      if (!group) start("default");
      const corners = parts.slice(1).map((c) => {
        const [a, b] = c.split("/");
        let vi = parseInt(a ?? "", 10), ti = b ? parseInt(b, 10) : 0;
        if (!Number.isFinite(vi) || vi === 0) throw new ImportError("OBJ", `${where}: face corner "${c}" isn't a vertex index`);
        vi = vi < 0 ? pos.length / 3 + vi : vi - 1;
        ti = !Number.isFinite(ti) || ti === 0 ? -1 : ti < 0 ? uv.length / 2 + ti : ti - 1;
        if (vi < 0 || vi >= pos.length / 3) throw new ImportError("OBJ", `${where}: vertex ${a} doesn't exist (${pos.length / 3} so far)`);
        return [vi, ti] as const;
      });
      if (corners.length < 3) { warnings.push(`${where}: a face with ${corners.length} corners: skipped`); continue; }
      const g = group!;
      const list = g.byMat.get(mat) ?? [];
      for (let i = 2; i < corners.length; i += 1) for (const c of [corners[0]!, corners[i - 1]!, corners[i]!]) list.push(c[0], c[1]);
      g.byMat.set(mat, list);
    } else if (k === "o" || k === "g") start(parts.slice(1).join(" ") || `group${groups.length}`);
    else if (k === "usemtl") mat = parts.slice(1).join(" ");
    else if (k === "mtllib") libs.push(...parts.slice(1));
  }
  for (const lib of libs) {
    const t = opts.mtl?.[lib];
    if (t === undefined) { warnings.push(`mtllib ${lib} wasn't given: its materials are grey`); continue; }
    for (const m of parseMtl(t)) mtls.set(m.name, m);
  }
  // Materials, with their textures.
  const images: ImportImage[] = [];
  const textures: ImportTexture[] = [];
  const materials: ImportMaterial[] = [];
  const matIndex = new Map<string, number>();
  const materialOf = (name: string): number => {
    if (!name) return -1;
    const had = matIndex.get(name);
    if (had !== undefined) return had;
    const m = mtls.get(name);
    if (!m) warnings.push(`usemtl ${name}: no such material in the MTL files given`);
    let texture: ImportMaterial["texture"];
    if (m?.map) {
      const src = opts.images?.[m.map];
      let img: ImportImage | null = null;
      if (src instanceof Uint8Array) { try { if (isPng(src)) img = decodePng(src); } catch (e) { warnings.push(`map_Kd ${m.map}: ${(e as Error).message}`); } }
      else if (src) img = src;
      if (img) { images.push(img); textures.push({ image: images.length - 1, wrapS: "repeat", wrapT: "repeat", nearest: false }); texture = { texture: textures.length - 1, texCoord: 0 }; }
      else warnings.push(`map_Kd ${m.map} wasn't given as PNG: the material's colour stands in`);
    }
    const kd = m?.kd ?? [0.8, 0.8, 0.8];
    const ke = m?.ke ?? [0, 0, 0];
    materials.push({
      name, colour: [srgbToLinear(kd[0]), srgbToLinear(kd[1]), srgbToLinear(kd[2]), m?.d ?? 1],
      ...(texture ? { texture } : {}), ...(ke.some((v) => v > 0) ? { emissive: [srgbToLinear(ke[0]), srgbToLinear(ke[1]), srgbToLinear(ke[2])] as const } : {}),
    });
    matIndex.set(name, materials.length - 1);
    return materials.length - 1;
  };
  const meshes: ImportMesh[] = [];
  const nodes: ImportNode[] = [];
  for (const g of groups) {
    const prims: ImportPrimitive[] = [];
    for (const [mname, list] of g.byMat) {
      const n = list.length / 2;
      const positions = new Float32Array(n * 3), uvs = new Float32Array(n * 2), colours = hasColour ? new Float32Array(n * 4) : undefined;
      let anyUv = false;
      for (let i = 0; i < n; i += 1) {
        const vi = list[i * 2]!, ti = list[i * 2 + 1]!;
        positions.set([pos[vi * 3]!, pos[vi * 3 + 1]!, pos[vi * 3 + 2]!], i * 3);
        // (OBJ's v runs up from the image's bottom; glTF's, which the sampler reads, down from the top.)
        if (ti >= 0 && ti * 2 + 1 < uv.length) { uvs[i * 2] = uv[ti * 2]!; uvs[i * 2 + 1] = 1 - uv[ti * 2 + 1]!; anyUv = true; }
        if (colours) colours.set([srgbToLinear(col[vi * 3]!), srgbToLinear(col[vi * 3 + 1]!), srgbToLinear(col[vi * 3 + 2]!), 1], i * 4);
      }
      prims.push({ positions, ...(anyUv ? { uvs: [uvs] } : {}), ...(colours ? { colours } : {}), indices: Uint32Array.from({ length: n }, (_, i) => i), material: materialOf(mname) });
    }
    if (!prims.length) continue;
    meshes.push({ name: g.name, primitives: prims });
    nodes.push({ name: g.name, parent: -1, children: [], local: identity(), world: identity(), mesh: meshes.length - 1 });
  }
  if (!meshes.length) throw new ImportError("OBJ", "no faces");
  const base = emptyScene("obj", opts.name ?? "obj", opts.axes ?? GLTF_AXES, opts.metres ?? 1);
  return { ...base, nodes, meshes, materials, textures, images, warnings };
}
