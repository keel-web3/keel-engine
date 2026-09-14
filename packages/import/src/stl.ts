// STL, binary or ASCII. Binary is told apart by its size (84 + 50 per
// triangle) rather than by a header starting "solid" (many binary files do).
// Binary files may carry a colour per facet in the attribute word (the
// VisCAM/SolidView convention: bit 15 set means "has a colour"; bits 0-4
// blue, 5-9 green, 10-14 red) -- kept as vertex colours. ASCII: each "solid" block is
// its own node and mesh. Units are whatever the file meant (usually mm): pass
// `metres` (0.001 for mm), or let the importer size it.

import { Z_UP_AXES, identity } from "./math.ts";
import type { Axes } from "./math.ts";
import { ImportError, emptyScene, srgbToLinear } from "./scene.ts";
import type { ImportMesh, ImportNode, ImportScene } from "./scene.ts";

export interface StlOptions {
  readonly metres?: number;
  readonly axes?: Axes;
  readonly name?: string;
}

export const isBinaryStl = (b: Uint8Array): boolean => b.length >= 84 && new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(80, true) * 50 + 84 === b.length;

export function parseStl(input: Uint8Array | string, opts: StlOptions = {}): ImportScene {
  const meshes: ImportMesh[] = [];
  const warnings: string[] = [];
  if (typeof input !== "string" && isBinaryStl(input)) {
    const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const n = dv.getUint32(80, true);
    const positions = new Float32Array(n * 9);
    let colours: Float32Array | null = null;
    for (let i = 0; i < n; i += 1) {
      const o = 84 + i * 50;
      for (let k = 0; k < 9; k += 1) {
        const v = dv.getFloat32(o + 12 + k * 4, true);
        if (!Number.isFinite(v)) throw new ImportError("STL", `triangle ${i} has a coordinate that isn't a number`);
        positions[i * 9 + k] = v;
      }
      const attr = dv.getUint16(o + 48, true);
      if (attr & 0x8000) {
        colours ??= new Float32Array(n * 12).fill(1);
        const b = srgbToLinear((attr & 31) / 31), g = srgbToLinear(((attr >> 5) & 31) / 31), r = srgbToLinear(((attr >> 10) & 31) / 31);
        for (let c = 0; c < 3; c += 1) colours.set([r, g, b, 1], (i * 3 + c) * 4);
      }
    }
    meshes.push({ name: new TextDecoder().decode(input.subarray(0, 80)).replace(/\0.*$/s, "").replace(/^solid\s*/, "").trim() || "stl", primitives: [{ positions, ...(colours ? { colours } : {}), indices: Uint32Array.from({ length: n * 3 }, (_, i) => i), material: -1 }] });
  } else {
    const text = typeof input === "string" ? input : new TextDecoder().decode(input);
    if (!/^\s*solid/.test(text)) throw new ImportError("STL", input instanceof Uint8Array ? `${input.length} bytes is neither a binary STL (84 + 50 per triangle) nor ASCII ("solid ...")` : 'ASCII STL starts with "solid"');
    const re = /solid\s*([^\n]*)\n([\s\S]*?)endsolid/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const verts: number[] = [];
      for (const v of m[2]!.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) {
        const xyz = [Number(v[1]), Number(v[2]), Number(v[3])];
        if (xyz.some((x) => !Number.isFinite(x))) throw new ImportError("STL", `solid ${m[1]!.trim()}: "vertex ${v[1]} ${v[2]} ${v[3]}" isn't three numbers`);
        verts.push(...xyz);
      }
      if (verts.length % 9) throw new ImportError("STL", `solid ${m[1]!.trim()}: ${verts.length / 3} vertices isn't whole triangles`);
      if (verts.length) meshes.push({ name: m[1]!.trim() || `solid${meshes.length}`, primitives: [{ positions: Float32Array.from(verts), indices: Uint32Array.from({ length: verts.length / 3 }, (_, i) => i), material: -1 }] });
    }
    if (!meshes.length && /facet/.test(text)) throw new ImportError("STL", 'ASCII STL with facets but no "endsolid"');
  }
  if (!meshes.length) throw new ImportError("STL", "no triangles");
  const nodes: ImportNode[] = meshes.map((me, i) => ({ name: me.name, parent: -1, children: [], local: identity(), world: identity(), mesh: i }));
  if (!meshes.some((me) => me.primitives.some((p) => p.colours))) warnings.push("STL carries no colour: one role");
  return { ...emptyScene("stl", opts.name ?? meshes[0]!.name, opts.axes ?? Z_UP_AXES, opts.metres ?? 1), nodes, meshes, warnings };
}
