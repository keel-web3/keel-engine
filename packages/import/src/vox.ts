// MagicaVoxel .vox (versions 150 and 200): the voxels themselves, no mesh.
// SIZE/XYZI per model, the RGBA palette (or MagicaVoxel's default), and the
// scene graph (nTRN translations and 90-degree rotations, nGRP groups, nSHP
// shapes) that places each model -- so a multi-model file lands as one grid,
// each cell remembering which model it came from (a source part) and its
// palette index (a colour region). Converted to the engine's frame
// (MagicaVoxel is +z up, the front -y).

import { Z_UP_AXES, identity } from "./math.ts";
import { ImportError, emptyScene, srgbToLinear } from "./scene.ts";
import type { ImportScene, VoxelSource } from "./scene.ts";

/** MagicaVoxel's default palette (index 1..255; 0 empty): its colour cube without black, then red, green, blue and grey ramps. */
export function defaultVoxPalette(): Uint8Array {
  const out = new Uint8Array(256 * 4);
  const steps = [0xff, 0xcc, 0x99, 0x66, 0x33, 0x00];
  let i = 1;
  for (const r of steps) for (const g of steps) for (const b of steps) { if (i > 215) break; out.set([r, g, b, 255], i * 4); i += 1; }
  const ramp = [0xee, 0xdd, 0xbb, 0xaa, 0x88, 0x77, 0x55, 0x44, 0x22, 0x11];
  for (const ch of [0, 1, 2, 3]) for (const v of ramp) { out.set(ch === 3 ? [v, v, v, 255] : [ch === 0 ? v : 0, ch === 1 ? v : 0, ch === 2 ? v : 0, 255], i * 4); i += 1; }
  return out;
}

interface Model { size: [number, number, number]; voxels: Uint8Array }
type Dict = Record<string, string>;
interface Node { kind: "trn" | "grp" | "shp"; attrs: Dict; child?: number; t?: [number, number, number]; r?: number; children?: number[]; models?: number[] }

/** Rotation byte -> a 3x3 row-major matrix of -1/0/1. */
function rotation(r: number): number[] {
  const i0 = r & 3, i1 = (r >> 2) & 3;
  const i2 = [0, 1, 2].find((i) => i !== i0 && i !== i1) ?? 2;
  const m = new Array<number>(9).fill(0);
  m[i0] = r & 16 ? -1 : 1;
  m[3 + i1] = r & 32 ? -1 : 1;
  m[6 + i2] = r & 64 ? -1 : 1;
  return m;
}

export const isVox = (b: Uint8Array): boolean => b.length >= 8 && b[0] === 0x56 && b[1] === 0x4f && b[2] === 0x58 && b[3] === 0x20;

export function parseVox(b: Uint8Array, { name = "vox", metres = 0.1 }: { name?: string; metres?: number } = {}): ImportScene {
  if (!isVox(b)) throw new ImportError("VOX", 'no "VOX " magic');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const models: Model[] = [];
  let palette: Uint8Array | null = null;
  const nodes = new Map<number, Node>();
  const warnings: string[] = [];
  let pos = 8;
  const str = (p: number): [string, number] => { const n = dv.getInt32(p, true); if (n < 0 || p + 4 + n > b.length) throw new ImportError("VOX", `a string at ${p} runs past the end`); return [new TextDecoder().decode(b.subarray(p + 4, p + 4 + n)), p + 4 + n]; };
  const dict = (p: number): [Dict, number] => {
    const n = dv.getInt32(p, true);
    p += 4;
    const d: Dict = {};
    for (let i = 0; i < n; i += 1) { const [k, p1] = str(p); const [v, p2] = str(p1); d[k] = v; p = p2; }
    return [d, p];
  };
  // (MAIN's content is empty; its children are every other chunk, read flat.)
  if (b.length < 20 || String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!) !== "MAIN") throw new ImportError("VOX", "no MAIN chunk");
  pos = 20 + dv.getInt32(12, true);
  let pendingSize: [number, number, number] | null = null;
  while (pos + 12 <= b.length) {
    const id = String.fromCharCode(b[pos]!, b[pos + 1]!, b[pos + 2]!, b[pos + 3]!);
    const len = dv.getInt32(pos + 4, true);
    const c = pos + 12;
    if (len < 0 || c + len > b.length) throw new ImportError("VOX", `chunk ${id} at ${pos} runs past the end`);
    if (id === "SIZE") pendingSize = [dv.getInt32(c, true), dv.getInt32(c + 4, true), dv.getInt32(c + 8, true)];
    else if (id === "XYZI") {
      if (!pendingSize) throw new ImportError("VOX", "XYZI before its SIZE");
      const n = dv.getInt32(c, true);
      if (n < 0 || c + 4 + n * 4 > c + len) throw new ImportError("VOX", `XYZI says ${n} voxels, the chunk holds ${(len - 4) / 4}`);
      models.push({ size: pendingSize, voxels: b.slice(c + 4, c + 4 + n * 4) });
      pendingSize = null;
    } else if (id === "RGBA") {
      palette = new Uint8Array(256 * 4);
      // (Entry i of the chunk is palette index i + 1.)
      for (let i = 0; i < 255; i += 1) palette.set(b.subarray(c + i * 4, c + i * 4 + 4), (i + 1) * 4);
    } else if (id === "nTRN") {
      const nid = dv.getInt32(c, true);
      const [attrs, p0] = dict(c + 4);
      let p = p0;
      const child = dv.getInt32(p, true);
      p += 12;
      const frames = dv.getInt32(p, true);
      p += 4;
      let t: [number, number, number] = [0, 0, 0], r = 4;
      if (frames > 0) {
        const [f] = dict(p);
        if (f["_t"]) { const v = f["_t"].split(/\s+/).map(Number); if (v.length === 3 && v.every(Number.isFinite)) t = [v[0]!, v[1]!, v[2]!]; }
        if (f["_r"]) r = Number(f["_r"]);
      }
      nodes.set(nid, { kind: "trn", attrs, child, t, r });
    } else if (id === "nGRP") {
      const nid = dv.getInt32(c, true);
      const [attrs, p] = dict(c + 4);
      const n = dv.getInt32(p, true);
      const children: number[] = [];
      for (let i = 0; i < n; i += 1) children.push(dv.getInt32(p + 4 + i * 4, true));
      nodes.set(nid, { kind: "grp", attrs, children });
    } else if (id === "nSHP") {
      const nid = dv.getInt32(c, true);
      const [attrs, p0] = dict(c + 4);
      const n = dv.getInt32(p0, true);
      let p = p0 + 4;
      const ms: number[] = [];
      for (let i = 0; i < n; i += 1) { ms.push(dv.getInt32(p, true)); const [, p2] = dict(p + 4); p = p2; }
      nodes.set(nid, { kind: "shp", attrs, models: ms });
    }
    pos = c + len + dv.getInt32(pos + 8, true);
  }
  if (!models.length) throw new ImportError("VOX", "no models (SIZE/XYZI)");
  const pal = palette ?? defaultVoxPalette();
  if (!palette) warnings.push("no RGBA chunk: MagicaVoxel's default palette");
  // Place the models: walk the scene graph (translations add, rotations compose), or each at the origin.
  interface Placed { model: number; t: [number, number, number]; r: number[]; name: string; hidden: boolean }
  const placed: Placed[] = [];
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const mul3 = (a: number[], m: number[]): number[] => Array.from({ length: 9 }, (_, k) => { const i = Math.floor(k / 3), j = k % 3; return a[i * 3]! * m[j]! + a[i * 3 + 1]! * m[3 + j]! + a[i * 3 + 2]! * m[6 + j]!; });
  const app3 = (m: number[], v: readonly number[]): [number, number, number] => [m[0]! * v[0]! + m[1]! * v[1]! + m[2]! * v[2]!, m[3]! * v[0]! + m[4]! * v[1]! + m[5]! * v[2]!, m[6]! * v[0]! + m[7]! * v[1]! + m[8]! * v[2]!];
  const seen = new Set<number>();
  const walk = (id: number, t: [number, number, number], r: number[], name: string, hidden: boolean): void => {
    const n = nodes.get(id);
    if (!n || seen.has(id)) return;
    seen.add(id);
    if (n.kind === "trn") {
      const nt = app3(r, n.t ?? [0, 0, 0]);
      walk(n.child ?? -1, [t[0] + nt[0], t[1] + nt[1], t[2] + nt[2]], mul3(r, rotation(n.r ?? 4)), n.attrs["_name"] ?? name, hidden || n.attrs["_hidden"] === "1");
    } else if (n.kind === "grp") for (const c of n.children ?? []) walk(c, t, r, name, hidden);
    else for (const m of n.models ?? []) placed.push({ model: m, t, r, name: name || `model${m}`, hidden });
  };
  if (nodes.size) walk(0, [0, 0, 0], I3, "", false);
  if (!placed.length) models.forEach((_m, i) => placed.push({ model: i, t: [0, 0, 0], r: I3, name: `model${i}`, hidden: false }));
  // Every voxel in MagicaVoxel's frame, then into the engine's (x -> -x, z up -> y, -y front -> +z).
  const cells: Array<[number, number, number, number, number]> = [];
  placed.forEach((p, pi) => {
    if (p.hidden) { warnings.push(`${p.name} is hidden: left out`); return; }
    const m = models[p.model];
    if (!m) throw new ImportError("VOX", `a shape names model ${p.model}; there are ${models.length}`);
    const half = [Math.floor(m.size[0] / 2), Math.floor(m.size[1] / 2), Math.floor(m.size[2] / 2)];
    for (let i = 0; i + 3 < m.voxels.length; i += 4) {
      const v = app3(p.r, [m.voxels[i]! - half[0]!, m.voxels[i + 1]! - half[1]!, m.voxels[i + 2]! - half[2]!]);
      const w = [v[0] + p.t[0], v[1] + p.t[1], v[2] + p.t[2]];
      cells.push([-w[0]! - 1, w[2]!, -w[1]! - 1, m.voxels[i + 3]!, pi]);
    }
  });
  if (!cells.length) throw new ImportError("VOX", "every model is empty or hidden");
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const c of cells) for (let k = 0; k < 3; k += 1) { min[k] = Math.min(min[k]!, c[k]!); max[k] = Math.max(max[k]!, c[k]!); }
  const size: [number, number, number] = [max[0]! - min[0]! + 1, max[1]! - min[1]! + 1, max[2]! - min[2]! + 1];
  const grid = new Uint8Array(size[0] * size[1] * size[2]);
  const model = new Int16Array(grid.length).fill(-1);
  for (const [x, y, z, ci, pi] of cells) {
    const k = x - min[0]! + size[0] * (y - min[1]! + size[1] * (z - min[2]!));
    grid[k] = ci; model[k] = pi;
  }
  const linear = new Float32Array(256 * 4);
  for (let i = 0; i < 256; i += 1) linear.set([srgbToLinear(pal[i * 4]! / 255), srgbToLinear(pal[i * 4 + 1]! / 255), srgbToLinear(pal[i * 4 + 2]! / 255), pal[i * 4 + 3]! / 255], i * 4);
  const voxels: VoxelSource = { size, cells: grid, model, palette: linear, modelNames: placed.map((p) => p.name) };
  const nodeList = placed.map((p) => ({ name: p.name, parent: -1, children: [], local: identity(), world: identity() }));
  return { ...emptyScene("vox", name, Z_UP_AXES, metres), nodes: nodeList, voxels, warnings };
}
