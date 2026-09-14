// What every parser hands on: one in-memory scene -- nodes with transforms,
// meshes of triangle primitives, materials (a base colour, maybe a texture,
// maybe emissive), decoded images, skins (joints, inverse bind matrices,
// per-vertex joints and weights) -- or, for .vox, a voxel grid straight away.
// Colours are LINEAR RGB 0..1 throughout (sRGB sources are decoded on the way in).
//
// soupOf(scene) flattens it into world triangles in the engine's frame, each
// remembering its node, mesh and material and carrying its uvs, colours and
// skin weights, for the voxeliser.

import { GLTF_AXES, applyPoint, axesToEngine, identity, invert4, mul4 } from "./math.ts";
import type { Axes, Mat4, V3 } from "./math.ts";

export type Format = "gltf" | "glb" | "obj" | "stl" | "vox";

/** A decoded image: RGBA bytes (sRGB), row 0 at the top. */
export interface ImportImage { readonly width: number; readonly height: number; readonly data: Uint8Array; readonly name?: string }

export interface ImportTexture {
  readonly image: number;
  readonly wrapS: "repeat" | "clamp" | "mirror";
  readonly wrapT: "repeat" | "clamp" | "mirror";
  readonly nearest: boolean;
}

export interface ImportMaterial {
  readonly name: string;
  /** Base colour, linear RGBA. */
  readonly colour: readonly [number, number, number, number];
  /** Base colour texture (times `colour`), with which uv set. */
  readonly texture?: { readonly texture: number; readonly texCoord: number };
  /** Emitted light, linear RGB (0 for most). */
  readonly emissive?: readonly [number, number, number];
  readonly metallic?: number;
}

export interface ImportPrimitive {
  /** xyz per vertex (the mesh's own frame). */
  readonly positions: Float32Array;
  /** uv per vertex (glTF convention: v down from the image's top), for up to two sets. */
  readonly uvs?: readonly Float32Array[];
  /** Linear RGBA per vertex. */
  readonly colours?: Float32Array;
  /** Four joints per vertex (indices into the skin's joints) and their weights. */
  readonly joints?: Uint16Array;
  readonly weights?: Float32Array;
  /** Triangles, three vertex indices each. */
  readonly indices: Uint32Array;
  /** Material index, -1 for none. */
  readonly material: number;
}

export interface ImportMesh { readonly name: string; readonly primitives: readonly ImportPrimitive[] }

export interface ImportNode {
  readonly name: string;
  readonly parent: number;
  readonly children: readonly number[];
  /** Local transform (column-major). */
  readonly local: Mat4;
  /** World transform, source frame. */
  readonly world: Mat4;
  readonly mesh?: number;
  readonly skin?: number;
}

export interface ImportSkin {
  readonly name: string;
  /** Node indices of its joints. */
  readonly joints: readonly number[];
  readonly inverseBind: readonly Mat4[];
  readonly skeleton?: number;
}

/** A .vox's voxels as they were (no mesh): cells, a palette, which model each came from. */
export interface VoxelSource {
  /** Grid size, engine frame (x right, y up, z front). */
  readonly size: V3;
  /** Palette index per cell (0 empty), index x + sx * (y + sy * z). */
  readonly cells: Uint8Array;
  /** Which shape/model (a source part) each cell came from (0 based; -1 empty). */
  readonly model: Int16Array;
  /** 256 colours, linear RGBA; entry i is palette index i (0 unused). */
  readonly palette: Float32Array;
  readonly modelNames: readonly string[];
}

export interface ImportScene {
  readonly format: Format;
  readonly name: string;
  readonly nodes: readonly ImportNode[];
  readonly meshes: readonly ImportMesh[];
  readonly materials: readonly ImportMaterial[];
  readonly textures: readonly ImportTexture[];
  readonly images: readonly ImportImage[];
  readonly skins: readonly ImportSkin[];
  /** The source frame (converted to the engine's by soupOf). */
  readonly axes: Axes;
  /** Metres per source unit (glTF: 1). */
  readonly metres: number;
  readonly voxels?: VoxelSource;
  /** Things the parser noticed and worked round. */
  readonly warnings: readonly string[];
}

/** A file couldn't be read: says which format, where and why. */
export class ImportError extends Error {
  readonly format: string;
  constructor(format: string, message: string) {
    super(`${format}: ${message}`);
    this.name = "ImportError";
    this.format = format;
  }
}

/** World transforms from locals, parents first. */
export function worldTransforms(nodes: ReadonlyArray<{ parent: number; local: Mat4 }>): Mat4[] {
  const out: Array<Mat4 | undefined> = new Array(nodes.length);
  const visiting = new Set<number>();
  const at = (i: number): Mat4 => {
    const had = out[i];
    if (had) return had;
    if (visiting.has(i)) throw new RangeError(`Node ${i} is its own ancestor.`);
    visiting.add(i);
    const n = nodes[i]!;
    const w = n.parent >= 0 ? mul4(at(n.parent), n.local) : n.local;
    out[i] = w;
    return w;
  };
  return nodes.map((_n, i) => at(i));
}

// ---------------------------------------------------------------- the soup

/** World triangles in the engine's frame, and what each vertex carries. */
export interface Soup {
  /** xyz per corner, three corners per triangle (engine frame, metres). */
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  /** Linear RGBA per corner (1 where the source has none). */
  readonly colours: Float32Array;
  /** Per corner: four joints as NODE indices (-1 none) and weights. */
  readonly joints: Int32Array;
  readonly weights: Float32Array;
  /** Per triangle. */
  readonly node: Int32Array;
  readonly mesh: Int32Array;
  readonly material: Int32Array;
  readonly count: number;
  readonly skinned: boolean;
}

export interface SoupOptions {
  /** Override the source frame. */
  readonly axes?: Axes;
  /** Extra scale onto metres (after the scene's own). */
  readonly scale?: number;
}

/** Every triangle in the world, engine frame, metres (skinned meshes posed through their joints, as glTF draws them). */
export function soupOf(scene: ImportScene, { axes = scene.axes ?? GLTF_AXES, scale = 1 }: SoupOptions = {}): Soup {
  const toEngine = axesToEngine(axes);
  const k = scene.metres * scale;
  let tris = 0;
  for (const n of scene.nodes) if (n.mesh !== undefined) for (const p of scene.meshes[n.mesh]!.primitives) tris += p.indices.length / 3;
  const positions = new Float32Array(tris * 9), uvs = new Float32Array(tris * 6), colours = new Float32Array(tris * 12).fill(1);
  const joints = new Int32Array(tris * 12).fill(-1), weights = new Float32Array(tris * 12);
  const node = new Int32Array(tris), mesh = new Int32Array(tris), material = new Int32Array(tris);
  let t = 0;
  let skinned = false;
  scene.nodes.forEach((n, ni) => {
    if (n.mesh === undefined) return;
    const skin = n.skin !== undefined ? scene.skins[n.skin] : undefined;
    // (A skinned mesh is drawn through its joints -- glTF ignores the mesh node's own transform then.)
    const jointMats = skin ? skin.joints.map((j, i) => mul4(scene.nodes[j]!.world, skin.inverseBind[i] ?? identity())) : null;
    const base = mul4(toEngine, n.world);
    for (const p of scene.meshes[n.mesh]!.primitives) {
      const texCoord = p.material >= 0 ? scene.materials[p.material]?.texture?.texCoord ?? 0 : 0;
      const uv = p.uvs?.[texCoord] ?? p.uvs?.[0];
      const vertex = (vi: number): V3 => {
        const v = [p.positions[vi * 3]!, p.positions[vi * 3 + 1]!, p.positions[vi * 3 + 2]!];
        if (jointMats && p.joints && p.weights) {
          const acc: V3 = [0, 0, 0];
          let wsum = 0;
          for (let j = 0; j < 4; j += 1) {
            const w = p.weights[vi * 4 + j]!;
            const m = jointMats[p.joints[vi * 4 + j]!];
            if (!w || !m) continue;
            const q = applyPoint(m, v);
            acc[0] += q[0] * w; acc[1] += q[1] * w; acc[2] += q[2] * w; wsum += w;
          }
          if (wsum > 1e-9) return applyPoint(toEngine, [acc[0] / wsum, acc[1] / wsum, acc[2] / wsum]);
        }
        return applyPoint(base, v);
      };
      for (let i = 0; i + 2 < p.indices.length; i += 3) {
        for (let c = 0; c < 3; c += 1) {
          const vi = p.indices[i + c]!;
          const q = vertex(vi);
          const o = t * 3 + c;
          positions[o * 3] = q[0] * k; positions[o * 3 + 1] = q[1] * k; positions[o * 3 + 2] = q[2] * k;
          if (uv) { uvs[o * 2] = uv[vi * 2]!; uvs[o * 2 + 1] = uv[vi * 2 + 1]!; }
          if (p.colours) for (let j = 0; j < 4; j += 1) colours[o * 4 + j] = p.colours[vi * 4 + j]!;
          if (skin && p.joints && p.weights) {
            skinned = true;
            for (let j = 0; j < 4; j += 1) {
              const w = p.weights[vi * 4 + j]!;
              if (w <= 0) continue;
              joints[o * 4 + j] = skin.joints[p.joints[vi * 4 + j]!] ?? -1;
              weights[o * 4 + j] = w;
            }
          }
        }
        node[t] = ni; mesh[t] = n.mesh; material[t] = p.material;
        t += 1;
      }
    }
  });
  return { positions, uvs, colours, joints, weights, node, mesh, material, count: t, skinned };
}

/** Where a node's joint is in the engine frame (metres). */
export function jointPosition(scene: ImportScene, nodeIndex: number, { axes = scene.axes, scale = 1 }: SoupOptions = {}): V3 {
  const w = scene.nodes[nodeIndex]!.world;
  const p = applyPoint(axesToEngine(axes), [w[12]!, w[13]!, w[14]!]);
  const k = scene.metres * scale;
  return [p[0] * k, p[1] * k, p[2] * k];
}

/** A node's bind-pose position (from its inverse bind matrix, when a skin has it), engine frame. */
export function bindPosition(scene: ImportScene, nodeIndex: number, opts: SoupOptions = {}): V3 {
  for (const s of scene.skins) {
    const i = s.joints.indexOf(nodeIndex);
    const ib = i >= 0 ? s.inverseBind[i] : undefined;
    if (ib) {
      const w = invert4(ib);
      const p = applyPoint(axesToEngine(opts.axes ?? scene.axes), [w[12]!, w[13]!, w[14]!]);
      const k = scene.metres * (opts.scale ?? 1);
      return [p[0] * k, p[1] * k, p[2] * k];
    }
  }
  return jointPosition(scene, nodeIndex, opts);
}

// ---------------------------------------------------------------- colour helpers

/** sRGB byte / 255 -> linear. */
export const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (c: number): number => { const v = Math.max(0, Math.min(1, c)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };

/** Sample a texture at (u, v) (glTF: v from the top), bilinear unless nearest; linear RGBA. */
export function sampleTexture(scene: ImportScene, texIndex: number, u: number, v: number): [number, number, number, number] {
  const tex = scene.textures[texIndex];
  const img = tex ? scene.images[tex.image] : undefined;
  if (!tex || !img || !img.width || !img.height) return [1, 1, 1, 1];
  const wrap = (x: number, n: number, mode: ImportTexture["wrapS"]): number => {
    if (mode === "clamp") return Math.max(0, Math.min(n - 1, x));
    if (mode === "mirror") { const p = ((x % (2 * n)) + 2 * n) % (2 * n); return p < n ? p : 2 * n - 1 - p; }
    return ((x % n) + n) % n;
  };
  const px = (x: number, y: number): [number, number, number, number] => {
    const i = (wrap(y, img.height, tex.wrapT) * img.width + wrap(x, img.width, tex.wrapS)) * 4;
    return [srgbToLinear(img.data[i]! / 255), srgbToLinear(img.data[i + 1]! / 255), srgbToLinear(img.data[i + 2]! / 255), img.data[i + 3]! / 255];
  };
  const fx = u * img.width - 0.5, fy = v * img.height - 0.5;
  if (tex.nearest) return px(Math.round(fx), Math.round(fy));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const a = px(x0, y0), b = px(x0 + 1, y0), c = px(x0, y0 + 1), d = px(x0 + 1, y0 + 1);
  return [0, 1, 2, 3].map((i) => (a[i]! * (1 - tx) + b[i]! * tx) * (1 - ty) + (c[i]! * (1 - tx) + d[i]! * tx) * ty) as [number, number, number, number];
}

/** An empty scene to fill (parsers start from it). */
export function emptyScene(format: Format, name: string, axes: Axes = GLTF_AXES, metres = 1): ImportScene {
  return { format, name, nodes: [], meshes: [], materials: [], textures: [], images: [], skins: [], axes, metres, warnings: [] };
}
