// The import's test page: every sample (written here, nothing downloaded)
// through the pipeline at 128 and 256 px -- the source mesh, its voxels in the
// source colours, the parts (segmentation), the body / attribute split, and the
// fitted generative asset through the engine's pixel renderer -- then the
// fitted creatures walking on the engine's animator wearing what they came
// with, their worn things on other bodies (the engine's own characters), and
// the op list replayed live, a few ops a frame. Build with
// `node packages/import/tools/build.mjs`, open
// http://localhost:4300/packages/import/tools/import.html -- it saves its
// sheets to out/import-*.png.
import { cameraBasis, createRoll, stream } from "@keel-engine/core";
import { animator, placeAttribute, wear } from "@keel-engine/entity";
import { createPixelRenderer } from "@keel-engine/render";
import type { PixelRenderer } from "@keel-engine/render";
import { builderLook, createSession, entityMaterials, livePreview, poseVoxels, streamOps } from "@keel-engine/builder";
import type { Look, ObjectSolids, VoxelModel } from "@keel-engine/builder";
import { SAMPLES, importModel, linearToSrgb, sampleTexture, soupOf } from "../src/index.ts";
import type { ImportResult, Prim, Sample } from "../src/index.ts";

type V3 = [number, number, number];
type RGB = [number, number, number];

// ---------------------------------------------------------------- a camera shared by every view

interface Cam { eye: V3; target: V3; fov: number }
function camFor(height: number, yaw = 0.62, across = 0): Cam {
  const h = Math.max(0.2, height, across * 1.1);
  const dist = h * 1.85 + 0.12;
  return { eye: [Math.sin(yaw) * dist, h * 0.45 + dist * 0.42, Math.cos(yaw) * dist], target: [0, h * 0.45, 0], fov: 0.8 };
}
// (The pixel renderer's own camera: core's cameraBasis, so the CPU views line up with the GPU ones.)
function basis(c: Cam): { f: V3; r: V3; u: V3 } {
  const b = cameraBasis(c.eye, c.target);
  return { f: [...b.forward], r: [...b.right], u: [...b.up] };
}
const norm = (v: readonly number[]): V3 => { const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1; return [v[0]! / l, v[1]! / l, v[2]! / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const BG: RGB = [22, 24, 34];

/** Voxels ray-cast (a DDA through the dense grid), each cell a colour, faces lit by their normal. */
function castVoxels(m: VoxelModel, colourOf: (x: number, y: number, z: number) => RGB | null, size: number, cam: Cam): ImageData {
  const img = new ImageData(size, size);
  const d = m.dense();
  const [sx, sy, sz] = d.size;
  const u = m.unit, pv = m.pivot();
  // (Model frame metres -> voxel coordinates: v = p / u + pivot.)
  const B = basis(cam);
  const tan = Math.tan(cam.fov / 2);
  const light = norm([0.5, 0.85, 0.4]);
  const cells = new Map<number, RGB | null>();
  const col = (x: number, y: number, z: number): RGB | null => {
    const k = x + sx * (y + sy * z);
    if (cells.has(k)) return cells.get(k)!;
    const c = d.data[k] ? colourOf(x + d.min[0], y + d.min[1], z + d.min[2]) : null;
    cells.set(k, c);
    return c;
  };
  for (let py = 0; py < size; py += 1) for (let px = 0; px < size; px += 1) {
    const sxn = ((px + 0.5) / size * 2 - 1) * tan, syn = (1 - (py + 0.5) / size * 2) * tan;
    const dir = norm([B.f[0] + B.r[0] * sxn + B.u[0] * syn, B.f[1] + B.r[1] * sxn + B.u[1] * syn, B.f[2] + B.r[2] * sxn + B.u[2] * syn]);
    // Ray origin in grid coordinates.
    const o: V3 = [cam.eye[0] / u + pv[0] - d.min[0], cam.eye[1] / u + pv[1] - d.min[1], cam.eye[2] / u + pv[2] - d.min[2]];
    // Clip to the box.
    let t0 = 0, t1 = Infinity;
    for (let a = 0; a < 3; a += 1) {
      const dd = dir[a]!, lo = 0, hi = d.size[a]!;
      if (Math.abs(dd) < 1e-12) { if (o[a]! < lo || o[a]! > hi) { t0 = Infinity; } continue; }
      let ta = (lo - o[a]!) / dd, tb = (hi - o[a]!) / dd;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    }
    let out: RGB = BG;
    if (t0 < t1) {
      const p: V3 = [o[0] + dir[0] * (t0 + 1e-6), o[1] + dir[1] * (t0 + 1e-6), o[2] + dir[2] * (t0 + 1e-6)];
      let x = Math.min(sx - 1, Math.max(0, Math.floor(p[0]))), y = Math.min(sy - 1, Math.max(0, Math.floor(p[1]))), z = Math.min(sz - 1, Math.max(0, Math.floor(p[2])));
      const step = [Math.sign(dir[0]), Math.sign(dir[1]), Math.sign(dir[2])];
      const tMax = [0, 1, 2].map((a) => { const cell = [x, y, z][a]!; const next = step[a]! > 0 ? cell + 1 : cell; return Math.abs(dir[a]!) < 1e-12 ? Infinity : (next - p[a]!) / dir[a]!; });
      const tDelta = [0, 1, 2].map((a) => (Math.abs(dir[a]!) < 1e-12 ? Infinity : Math.abs(1 / dir[a]!)));
      let face = t0 === 0 ? -1 : [0, 1, 2].reduce((best, a) => { const dd = dir[a]!; const ta = Math.abs(dd) < 1e-12 ? -Infinity : (((dd > 0 ? 0 : d.size[a]!) - o[a]!) / dd); return Math.abs(ta - t0) < 1e-6 ? a : best; }, 0);
      for (let n = 0; n < sx + sy + sz + 4; n += 1) {
        const c = col(x, y, z);
        if (c) {
          const nrm: V3 = [0, 0, 0];
          if (face >= 0) nrm[face] = -step[face]!;
          const k = face < 0 ? 0.8 : 0.45 + 0.55 * Math.max(0, dot(nrm, light));
          out = [c[0] * k, c[1] * k, c[2] * k];
          break;
        }
        const a = tMax[0]! < tMax[1]! ? (tMax[0]! < tMax[2]! ? 0 : 2) : tMax[1]! < tMax[2]! ? 1 : 2;
        if (a === 0) x += step[0]!; else if (a === 1) y += step[1]!; else z += step[2]!;
        tMax[a]! += tDelta[a]!;
        face = a;
        if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) break;
      }
    }
    const i = (py * size + px) * 4;
    img.data[i] = out[0]; img.data[i + 1] = out[1]; img.data[i + 2] = out[2]; img.data[i + 3] = 255;
  }
  return img;
}

/** The source triangles rasterised (a z-buffer, flat light), coloured by material x vertex colour. */
function rasterSource(r: ImportResult, size: number, cam: Cam): ImageData {
  const img = new ImageData(size, size);
  for (let i = 0; i < size * size; i += 1) img.data.set([...BG, 255], i * 4);
  const zb = new Float32Array(size * size).fill(Infinity);
  if (r.scene.voxels) return castVoxels(r.model, (x, y, z) => srgbOf(r, x, y, z), size, cam);
  const soup = soupOf(r.scene, { scale: r.grid.scale / r.scene.metres });
  const u = r.grid.unit, pv = r.model.pivot();
  const toModel = (i: number): V3 => {
    const p = [soup.positions[i * 3]!, soup.positions[i * 3 + 1]!, soup.positions[i * 3 + 2]!];
    return [0, 1, 2].map((a) => (((p[a]! - r.grid.origin[a]!) / u - r.offset[a]! - pv[a]!) * u)) as V3;
  };
  const B = basis(cam);
  const tan = Math.tan(cam.fov / 2);
  const light = norm([0.5, 0.85, 0.4]);
  const project = (p: V3): V3 => {
    const q: V3 = [p[0] - cam.eye[0], p[1] - cam.eye[1], p[2] - cam.eye[2]];
    const zc = dot(q, B.f);
    return [((dot(q, B.r) / zc / tan) + 1) * size / 2, (1 - dot(q, B.u) / zc / tan) * size / 2, zc];
  };
  for (let t = 0; t < soup.count; t += 1) {
    const P = [toModel(t * 3), toModel(t * 3 + 1), toModel(t * 3 + 2)];
    const n = norm(cross([P[1]![0] - P[0]![0], P[1]![1] - P[0]![1], P[1]![2] - P[0]![2]], [P[2]![0] - P[0]![0], P[2]![1] - P[0]![1], P[2]![2] - P[0]![2]]));
    const mat = soup.material[t]!;
    const m = mat >= 0 ? r.scene.materials[mat] : undefined;
    let c: RGB = m ? [m.colour[0], m.colour[1], m.colour[2]] : [0.7, 0.7, 0.7];
    const vc = [0, 1, 2].map((k) => (soup.colours[t * 12 + k]! + soup.colours[t * 12 + 4 + k]! + soup.colours[t * 12 + 8 + k]!) / 3);
    c = [c[0] * vc[0]!, c[1] * vc[1]!, c[2] * vc[2]!];
    if (m?.texture) {
      const tu = (soup.uvs[t * 6]! + soup.uvs[t * 6 + 2]! + soup.uvs[t * 6 + 4]!) / 3, tv = (soup.uvs[t * 6 + 1]! + soup.uvs[t * 6 + 3]! + soup.uvs[t * 6 + 5]!) / 3;
      const tx = sampleTexture(r.scene, m.texture.texture, tu, tv);
      c = [c[0] * tx[0], c[1] * tx[1], c[2] * tx[2]];
    }
    const k = 0.45 + 0.55 * Math.abs(dot(n, light));
    const rgb: RGB = [linearToSrgb(c[0] * k) * 255, linearToSrgb(c[1] * k) * 255, linearToSrgb(c[2] * k) * 255];
    const s = P.map(project);
    if (s.some((q) => q[2] <= 0.01)) continue;
    const x0 = Math.max(0, Math.floor(Math.min(s[0]![0], s[1]![0], s[2]![0]))), x1 = Math.min(size - 1, Math.ceil(Math.max(s[0]![0], s[1]![0], s[2]![0])));
    const y0 = Math.max(0, Math.floor(Math.min(s[0]![1], s[1]![1], s[2]![1]))), y1 = Math.min(size - 1, Math.ceil(Math.max(s[0]![1], s[1]![1], s[2]![1])));
    const area = (s[1]![0] - s[0]![0]) * (s[2]![1] - s[0]![1]) - (s[2]![0] - s[0]![0]) * (s[1]![1] - s[0]![1]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((s[1]![0] - px) * (s[2]![1] - py) - (s[2]![0] - px) * (s[1]![1] - py)) / area;
      const w1 = ((s[2]![0] - px) * (s[0]![1] - py) - (s[0]![0] - px) * (s[2]![1] - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * s[0]![2] + w1 * s[1]![2] + w2 * s[2]![2];
      const i = y * size + x;
      if (z >= zb[i]!) continue;
      zb[i] = z;
      img.data.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
    }
  }
  return img;
}

// A cell's source colour (sRGB bytes), from the grid behind the model.
function srgbOf(r: ImportResult, x: number, y: number, z: number): RGB {
  const g = r.grid;
  const gx = x + r.offset[0], gz = z + r.offset[2];
  const i = gx + g.size[0] * (y + g.size[1] * gz);
  return [linearToSrgb(g.colour[i * 3]!) * 255, linearToSrgb(g.colour[i * 3 + 1]!) * 255, linearToSrgb(g.colour[i * 3 + 2]!) * 255];
}

const HUES: RGB[] = [[230, 90, 80], [90, 170, 240], [120, 210, 110], [240, 190, 70], [190, 120, 230], [80, 210, 200], [240, 140, 190], [170, 170, 90], [120, 130, 240], [250, 120, 40], [110, 230, 170], [200, 90, 150]];

// ---------------------------------------------------------------- the pixel renderer

function pageLook(look: Look): { look: Look; ground: number } {
  const colourList = [...look.palette.colours];
  const ramps = { ...look.palette.ramps };
  const add = (name: string, list: Array<[number, number, number]>): void => { ramps[name] = [colourList.length, list.length]; colourList.push(...list); };
  add("sky", [[22, 24, 34], [30, 33, 46], [40, 44, 60], [52, 57, 76]]);
  add("ground", [[34, 38, 44], [48, 54, 60], [64, 72, 78], [82, 92, 96], [104, 114, 116]]);
  const materials = [...look.materials];
  materials[4] = { ramp: "ground" };
  materials[5] = { ramp: "sky" };
  materials.push({ ramp: "ground", light: 1, pattern: 1 });
  return { look: { ...look, palette: { colours: colourList, ramps }, materials }, ground: materials.length - 1 };
}

function draw(px: PixelRenderer, solids: ObjectSolids & { wedges?: Array<{ c: V3; h: V3; yaw: number; lo: number; mat: number }> }, look: Look, size: number, cam: Cam): ImageData {
  const { look: L, ground } = pageLook(look);
  px.setTarget(size, size);
  px.setPalette(L.palette.colours, L.palette.ramps);
  px.setMaterials(L.materials);
  px.setStyle({ screen: size <= 128 ? 4 : 8, dither: 0.9, outline: 1 });
  px.setFx([]);
  px.setWorld({ boxes: [...solids.boxes, { c: [0, -0.5, 0], h: [40, 0.5, 40], yaw: 0, mat: ground }], wedges: solids.wedges ?? [], capsules: solids.capsules });
  px.render({ eye: cam.eye, target: cam.target, fov: cam.fov, sun: [0.5, 0.85, 0.4], waterY: -50, fogNear: 60, fogFar: 200 });
  const rgba = px.read();
  const img = new ImageData(size, size);
  for (let y = 0; y < size; y += 1) img.data.set(rgba.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
  return img;
}

/** Primitives (voxel coordinates) as renderer solids about the model's pivot. */
function primSolids(prims: readonly Prim[], m: VoxelModel, look: Look): ObjectSolids & { wedges: Array<{ c: V3; h: V3; yaw: number; lo: number; mat: number }> } {
  const u = m.unit, pv = m.pivot();
  const P = (p: V3): V3 => [(p[0] - pv[0]) * u, (p[1] - pv[1]) * u, (p[2] - pv[2]) * u];
  const mat = (role: string): number => look.table[role] ?? look.table["primary"] ?? 6;
  const out = { boxes: [] as ObjectSolids["boxes"], capsules: [] as ObjectSolids["capsules"], wedges: [] as Array<{ c: V3; h: V3; yaw: number; lo: number; mat: number }> };
  for (const q of prims) {
    if (q.shape === "capsule") out.capsules.push({ a: P(q.a), b: P(q.b), r: q.r * u, mat: mat(q.role) });
    else if (q.shape === "box") out.boxes.push({ c: P(q.c), h: [q.h[0] * u, q.h[1] * u, q.h[2] * u], yaw: q.yaw, mat: mat(q.role) });
    else out.wedges.push({ c: P(q.c), h: [q.h[0] * u, q.h[1] * u, q.h[2] * u], yaw: q.yaw, lo: q.lo, mat: mat(q.role) });
  }
  return out;
}

const heightOf = (s: ObjectSolids): number => Math.max(0.1, ...s.boxes.map((b) => b.c[1] + b.h[1]), ...s.capsules.map((c) => Math.max(c.a[1], c.b[1]) + c.r));

// ---------------------------------------------------------------- sheets

function sheet(cells: Array<{ img: ImageData; label: string }>, cols: number, scale: number, title?: string): HTMLCanvasElement {
  const cell = cells[0]!.img.width * scale;
  const pad = 6, labelH = 16, titleH = title ? 20 : 0;
  const c = document.createElement("canvas");
  c.width = cols * (cell + pad) + pad;
  c.height = Math.ceil(cells.length / cols) * (cell + pad + labelH) + pad + titleH;
  const g = c.getContext("2d")!;
  g.fillStyle = "#101116"; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingEnabled = false;
  if (title) { g.fillStyle = "#e3e6f3"; g.font = "12px ui-monospace, monospace"; g.fillText(title, pad, 14); }
  cells.forEach((k, i) => {
    const x = pad + (i % cols) * (cell + pad), y = titleH + pad + Math.floor(i / cols) * (cell + pad + labelH);
    const tmp = document.createElement("canvas");
    tmp.width = k.img.width; tmp.height = k.img.height;
    tmp.getContext("2d")!.putImageData(k.img, 0, 0);
    g.drawImage(tmp, x, y, cell, cell);
    g.fillStyle = "#cfd3e6"; g.font = "11px ui-monospace, monospace";
    g.fillText(k.label.slice(0, Math.floor(cell / 6.6)), x + 2, y + cell + 12);
  });
  return c;
}

// ---------------------------------------------------------------- the page

export async function importPage(out: HTMLElement): Promise<Record<string, unknown>> {
  const canvas = document.createElement("canvas");
  const px = createPixelRenderer(canvas, { width: 128, height: 128 });
  const saves: Array<Promise<unknown>> = [];
  const save = (name: string, c: HTMLCanvasElement): void => {
    out.append(Object.assign(document.createElement("h3"), { textContent: name }), c);
    saves.push(new Promise((ok) => c.toBlob((b) => ok(fetch(`/out/${name}.png`, { method: "PUT", body: b })))));
  };
  const report: Record<string, unknown> = {};
  const results = new Map<string, { s: Sample; r: ImportResult }>();
  for (const s of SAMPLES()) {
    const t0 = performance.now();
    const r = importModel(s.bytes ?? s.text!, { name: s.name, ...(s.mtl ? { mtl: s.mtl } : {}), ...(s.options as object) });
    results.set(s.name, { s, r });
    report[s.name] = {
      ms: Math.round(performance.now() - t0), kind: r.proposal.kind, plan: r.proposal.creature?.plan, source: r.proposal.creature?.source,
      grid: r.proposal.grid.size, voxels: r.model.count, roles: r.proposal.roles.map((x) => x.role),
      parts: r.proposal.parts.map((p) => `${p.id}${p.socket ? `@${p.socket}` : ""}`), attributes: r.attributes.map((a) => `${a.part}@${a.slot} ${Math.round(a.confidence * 100)}%/${Math.round(a.socketConfidence * 100)}%`),
      fit: { prims: r.fitted.prims.length, iou: r.fitted.iou }, ops: r.ops.length,
    };
  }

  // 1. The pipeline, per sample: source -> voxels -> parts -> body / worn -> fitted primitives.
  const views = (r: ImportResult, size: number): Array<{ img: ImageData; label: string }> => {
    const look = builderLook(r.roles.look.colours, { extra: [...r.model.roles] });
    const b = r.model.bounds()!;
    const across = Math.max(b.max[0] - b.min[0] + 1, b.max[2] - b.min[2] + 1) * r.model.unit;
    const cam = camFor((b.max[1] - b.min[1] + 1) * r.model.unit, 0.62, across);
    const partIndex = new Map(r.proposal.parts.map((p, i) => [p.id, i]));
    const kindOf = new Map(r.proposal.parts.map((p) => [p.id, p.kind]));
    const partAt = (x: number, y: number, z: number): string | null => r.model.groupAt(x, y, z);
    const cells = [
      { img: rasterSource(r, size, cam), label: `${r.proposal.name}: ${r.scene.format} source` },
      { img: castVoxels(r.model, (x, y, z) => srgbOf(r, x, y, z), size, cam), label: `${r.model.count} voxels` },
      { img: castVoxels(r.model, (x, y, z) => { const g = partAt(x, y, z); return g ? HUES[(partIndex.get(g) ?? 0) % HUES.length]! : [90, 90, 90]; }, size, cam), label: `${r.proposal.parts.length} parts` },
      { img: castVoxels(r.model, (x, y, z) => { const g = partAt(x, y, z); const k = g ? kindOf.get(g) : undefined; if (k === "attribute") return HUES[(partIndex.get(g!) ?? 0) % HUES.length]!; const c = srgbOf(r, x, y, z); const l = (c[0] + c[1] + c[2]) / 3; return [l * 0.55 + 40, l * 0.55 + 40, l * 0.55 + 48]; }, size, cam), label: r.attributes.length ? `worn: ${r.attributes.map((a) => a.slot).join(" ")}` : `${r.proposal.kind}` },
    ];
    // The fitted asset through the pixel renderer: a creature's primitive skin at rest wearing its attributes; a prop's primitives.
    let solids: ObjectSolids & { wedges?: Array<{ c: V3; h: V3; yaw: number; lo: number; mat: number }> };
    if (r.fitted.spec) {
      const spec = r.fitted.spec;
      const anim = animator(spec);
      anim.step(1 / 60, { pos: [0, 0, 0], vel: [0, 0, 0], facing: 0, mode: "ground" });
      const skel = anim.skeleton({ pos: [0, 0, 0], yaw: 0 });
      solids = poseVoxels(spec, skel, look);
      addWorn(r, skel, look, solids);
    } else solids = primSolids(r.fitted.prims, r.model, look);
    cells.push({ img: draw(px, solids, look, size, cam), label: `fitted: ${r.fitted.prims.length} prims, IoU ${r.fitted.iou}` });
    return cells;
  };
  const addWorn = (r: ImportResult, skel: ReturnType<ReturnType<typeof animator>["skeleton"]>, look: Look, solids: ObjectSolids): void => {
    const mats = entityMaterials(look);
    for (const a of r.attributes) {
      const w = wear(a.def, r.fitted.spec!, stream(createRoll("0x1"), 0));
      const f = placeAttribute(skel, w.socket, w.design, { materials: mats });
      for (const b of f.boxes) solids.boxes.push({ c: b.c, h: b.h, yaw: b.yaw, mat: b.mat });
      for (const c of f.capsules) solids.capsules.push({ a: c.a, b: c.b, r: c.r, mat: c.mat });
    }
  };
  const small: Array<{ img: ImageData; label: string }> = [];
  for (const { r } of results.values()) small.push(...views(r, 128));
  save("import-pipeline-128", sheet(small, 5, 2, "source -> voxels -> parts -> body / worn -> fitted primitives (pixel renderer), 128 px"));
  const big: Array<{ img: ImageData; label: string }> = [];
  for (const name of ["knight", "dog", "chest"]) big.push(...views(results.get(name)!.r, 256));
  save("import-pipeline-256", sheet(big, 5, 1, "the same at 256 px"));

  // 2. The fitted creatures walking on the engine's animator, wearing what they came with.
  const walk: Array<{ img: ImageData; label: string }> = [];
  for (const name of ["knight", "dog", "robot"]) {
    const r = results.get(name)!.r;
    const spec = r.fitted.spec!;
    const look = builderLook(r.roles.look.colours, { extra: [...r.model.roles] });
    const anim = animator(spec);
    const speed = spec.plan === "quadruped" ? 1.6 : 1.2;
    const frames: ObjectSolids[] = [];
    for (let f = 0; f < 150; f += 1) {
      anim.step(1 / 60, { pos: [0, 0, f < 30 ? 0 : (f - 30) / 60 * speed], vel: [0, 0, f < 30 ? 0 : speed], facing: 0, mode: "ground" });
      if (f >= 90 && f % 8 === 2 && frames.length < 4) {
        const skel = anim.skeleton({ pos: [0, 0, 0], yaw: 0 });
        const s = poseVoxels(spec, skel, look);
        addWorn(r, skel, look, s);
        frames.push(s);
      }
    }
    const h = Math.max(...frames.map(heightOf));
    frames.forEach((s, i) => walk.push({ img: draw(px, s, look, 256, camFor(h, 1.2)), label: `${name} walking ${i}: ${spec.voxel.skin.boxes.length}b ${spec.voxel.skin.capsules.length}c` }));
  }
  save("import-walk-256", sheet(walk, 4, 1, "fitted generative assets on the engine's animator, wearing their imported attributes"));

  // 3. Worn things on other bodies: the knight's helmet, shield, cape and sword and the dog's collar on the engine's own characters.
  const worn: Array<{ img: ImageData; label: string }> = [];
  const knight = results.get("knight")!.r, dog = results.get("dog")!.r;
  const cast: Array<[string, Record<string, unknown>, ImportResult]> = [
    ["a person", { op: "character", kind: "humanoid", seed: "3" }, knight],
    ["an anthro fox", { op: "character", kind: "anthro", species: "fox", seed: "7" }, knight],
    ["an anthro bear", { op: "character", kind: "anthro", species: "bear", seed: "4" }, knight],
    ["a cat, the dog's collar", { op: "character", kind: "animal", species: "cat", seed: "2" }, dog],
  ];
  for (const [label, op, r] of cast) {
    const session = createSession(undefined, { attributes: r.attributes.map((a) => a.def) });
    const ops = [op, ...r.attributes.map((a) => ({ op: "wear", attribute: a.id }))];
    for (const res of streamOps(ops as never, session)) if (!res.ok) throw new Error(res.error.message);
    const live = livePreview(session);
    const { solids, look } = live.solids();
    worn.push({ img: draw(px, solids, look, 256, camFor(heightOf(solids), 0.75)), label });
  }
  save("import-worn-256", sheet(worn, 4, 1, "imported attributes, built to other bodies' sockets"));

  // 4. The op list replayed live: the knight drawing itself, a few ops a frame (the voxels, the parts, attached, rigged).
  const liveCanvas = document.createElement("canvas");
  liveCanvas.width = 256; liveCanvas.height = 256; liveCanvas.style.width = "512px";
  const liveLabel = document.createElement("div");
  out.prepend(Object.assign(document.createElement("h3"), { textContent: "live: the knight's op list drawing" }), liveCanvas, liveLabel);
  const lg = liveCanvas.getContext("2d")!;
  const strip: Array<{ img: ImageData; label: string }> = [];
  const ops = knight.ops;
  const session = createSession();
  const b = knight.model.bounds()!;
  const cam = camFor((b.max[1] - b.min[1] + 1) * knight.model.unit, 0.62, 1.1);
  const snaps = new Set(Array.from({ length: 8 }, (_, i) => Math.round(((i + 1) / 8) * ops.length) - 1));
  let i = 0;
  for (const res of streamOps(ops, session)) {
    if (!res.ok) throw new Error(res.error.message);
    if (i % 24 === 23 || snaps.has(i)) {
      const m = session.editor.model;
      const attached = new Set(Object.keys(session.attachments));
      const img = castVoxels(m, (x, y, z) => {
        const role = m.roleAt(x, y, z)!;
        const c = session.colours[role] ?? knight.roles.look.colours[role] ?? [0.6, 0.05, 60];
        const g = attached.size ? m.groupAt(x, y, z) : null;
        const rgb = oklchRgb(c);
        return g && attached.has(g) ? [Math.min(255, rgb[0] * 0.6 + 100), Math.min(255, rgb[1] * 0.6 + 60), rgb[2] * 0.6] : rgb;
      }, 256, cam);
      lg.putImageData(img, 0, 0);
      liveLabel.textContent = `op ${i + 1}/${ops.length} ${res.event.op} -- ${res.event.did}`;
      if (snaps.has(i)) strip.push({ img, label: `${i + 1}/${ops.length} ${res.event.op}` });
      await new Promise((ok) => setTimeout(ok, 8));
    }
    i += 1;
  }
  save("import-live-256", sheet(strip, 4, 1, "the knight's op list replayed through streamOps (attached parts tinted)"));
  report["proposal:knight"] = { attributes: knight.proposal.attributes.map((a) => ({ part: a.part, slot: a.slot, fill: a.fill, anchor: a.anchor, offset: a.offset, confidence: a.confidence })) };
  await Promise.all(saves);
  return report;
}

// OKLCH [L, C, h] -> sRGB bytes (a small copy of core's, for the replay's colours).
function oklchRgb([L, C, h]: readonly number[]): RGB {
  const a = C! * Math.cos((h! * Math.PI) / 180), b = C! * Math.sin((h! * Math.PI) / 180);
  const l_ = L! + 0.3963377774 * a + 0.2158037573 * b, m_ = L! - 0.1055613458 * a - 0.0638541728 * b, s_ = L! - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((v) => linearToSrgb(v) * 255) as RGB;
}

(globalThis as { importPage?: typeof importPage }).importPage = importPage;
