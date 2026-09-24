// The world-content showcase: every packs/foliage kind and packs/buildings
// variant in the pixel and voxel styles side by side at 128 and 256 px, a
// wind strip (baked sway frames, and the sprite shader's row shift on one
// baked picture), a bridge over water, a village. Build with
// `node packs/buildings/tools/build.mjs`, open
// http://localhost:4300/packs/buildings/tools/showcase.html -- it saves its
// sheets to out/world-*.png.
import "@keel-engine/builder";
import { bakeForRenderer, defineObject, lookFor, placeObject, rendererLook, swayPose, swayShift } from "@keel-engine/object";
import type { BuiltObject, ContentPack, ObjectInstance, PlacedContent, StyledMeta, StyledObjectDef, WorldMaterial } from "@keel-engine/object";
import { createPixelRenderer } from "@keel-engine/render";
import type { PixelRenderer, RenderBox, RenderCapsule } from "@keel-engine/render";
import { pack as foliage } from "@keel-engine/foliage";
import type { RGB } from "@keel-engine/core";
import { alongPath, bridgeFor, pack as buildings } from "@keel-engine/buildings";
import { placeContent, styleSetting } from "@keel-engine/object";
import type { ContentRecord } from "@keel-engine/object";

type V3 = [number, number, number];

// ---------------------------------------------------------------- a scene: many things, each in its own look

export interface Drawn { inst: ObjectInstance<StyledMeta>; built: BuiltObject; look: ReturnType<typeof lookFor> }

/** A palette, materials and solids for a set of placed things, each wearing its own look. */
export function sceneOf(things: readonly Drawn[], { ground = true, extra = [] }: { ground?: boolean | [number, number, number]; extra?: ReadonlyArray<{ c: V3; h: V3 }> } = {}) {
  const colours: RGB[] = [];
  const ramps: Record<string, [number, number]> = {};
  const materials: WorldMaterial[] = [];
  const boxes: RenderBox[] = [];
  const capsules: RenderCapsule[] = [];
  const perThing: Array<{ boxes: RenderBox[]; capsules: RenderCapsule[]; mats: Set<number> }> = [];
  const addRamp = (name: string, list: RGB[]): void => { ramps[name] = [colours.length, list.length]; colours.push(...list); };
  const pad = (): void => { while (materials.length === 4 || materials.length === 5) materials.push({ ramp: materials.length === 4 ? "water" : "sky" }); };
  addRamp("sky", [[20, 22, 30], [28, 31, 42], [38, 42, 56], [50, 55, 72]]);
  addRamp("water", [[18, 40, 62], [26, 58, 86], [40, 82, 112], [62, 110, 140], [96, 146, 170]]);
  const groundRamp: RGB[] = typeof ground === "object" ? [[ground[0] * 0.5, ground[1] * 0.5, ground[2] * 0.5], [ground[0] * 0.75, ground[1] * 0.75, ground[2] * 0.75], ground, [Math.min(255, ground[0] * 1.2), Math.min(255, ground[1] * 1.2), Math.min(255, ground[2] * 1.2)]] as RGB[] : [[34, 38, 44], [48, 54, 60], [64, 72, 78], [82, 92, 96]];
  addRamp("ground", groundRamp);
  things.forEach((t, i) => {
    const rl = rendererLook(t.built.roles, t.look, 6);
    const mats: Record<string, number> = {};
    for (const [role, [base, len]] of Object.entries(rl.ramps)) {
      if (role === "water" || role === "sky") continue;
      const name = `${i}:${role}`;
      ramps[name] = [colours.length, len];
      colours.push(...rl.colours.slice(base, base + len));
      pad();
      mats[role] = materials.length;
      const m = rl.materials[rl.mats[role]!]!;
      materials.push({ ...m, ramp: name });
    }
    const r = bakeForRenderer([t.inst], { mats });
    boxes.push(...r.boxes);
    capsules.push(...r.capsules);
    perThing.push({ boxes: r.boxes, capsules: r.capsules, mats: new Set(Object.values(mats)) });
  });
  pad();
  const groundMat = materials.length;
  materials.push({ ramp: "ground", light: 1, pattern: 1 });
  const world: RenderBox[] = [];
  if (ground && !extra.length) world.push({ c: [0, -0.5, 0], h: [80, 0.5, 80], yaw: 0, mat: groundMat });
  for (const e of extra) world.push({ c: e.c, h: e.h, yaw: 0, mat: groundMat });
  boxes.push(...world);
  materials[4] = { ramp: "water" };
  materials[5] = { ramp: "sky" };
  return { colours, ramps, materials, boxes, capsules, groundMat, world, perThing };
}

export type Scene = ReturnType<typeof sceneOf>;
export function draw(px: PixelRenderer, scene: Pick<Scene, "colours" | "ramps" | "materials" | "boxes" | "capsules">, { size, eye, target, waterY = -50, screen }: { size: [number, number]; eye: V3; target: V3; waterY?: number; screen?: 2 | 4 | 8 }): ImageData {
  px.setTarget(size[0], size[1]);
  px.setPalette(scene.colours, scene.ramps);
  px.setMaterials(scene.materials);
  px.setStyle({ screen: screen ?? (Math.min(size[0], size[1]) <= 128 ? 4 : 8), dither: 0.9, outline: 1 });
  px.setFx([]);
  const counts = px.setWorld({ boxes: scene.boxes, capsules: scene.capsules });
  if (counts.dropped) console.warn(`dropped ${counts.dropped} solids`);
  px.render({ eye, target, fov: 0.8, sun: [0.55, 0.85, 0.35], waterY, fogNear: 80, fogFar: 260 });
  const rgba = px.read();
  const img = new ImageData(size[0], size[1]);
  for (let y = 0; y < size[1]; y += 1) img.data.set(rgba.subarray((size[1] - 1 - y) * size[0] * 4, (size[1] - y) * size[0] * 4), y * size[0] * 4);
  return img;
}

/**
 * A scene too big for one raymarch (the renderer holds 256 boxes): the world alone, then each thing with it,
 * far to near, copied over where it shows -- its own pixels always, its shadow only onto bare ground.
 */
type View = { size: [number, number]; eye: V3; target: V3; waterY?: number; screen?: 2 | 4 | 8 };

export function composite({ px, things, world, view }: { px: PixelRenderer; things: readonly Drawn[]; world: Parameters<typeof sceneOf>[1]; view: View }): ImageData {
  // (Each thing in a scene of its own -- its palette, its materials -- over the same world: palettes never run out.)
  const bare = sceneOf([], world);
  const base = draw(px, { ...bare, boxes: bare.world, capsules: [] }, view);
  const out = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
  const mask = new Uint8Array(base.width * base.height);
  const order = things.map((t, i) => ({ i, d: Math.hypot(t.inst.transform.pos[0] - view.eye[0], t.inst.transform.pos[2] - view.eye[2]) })).sort((a, b) => b.d - a.d);
  for (const { i } of order) {
    const scene = sceneOf([things[i]!], world);
    const mine = scene.perThing[0]!;
    const img = draw(px, scene, view);
    const data = px.readData();
    const [W, H] = view.size;
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      const o = (y * W + x) * 4;
      if (img.data[o] === base.data[o] && img.data[o + 1] === base.data[o + 1] && img.data[o + 2] === base.data[o + 2]) continue;
      const own = mine.mats.has(data.data[((H - 1 - y) * W + x) * 4 + 2]!);
      if (!own && mask[y * W + x]) continue;
      out.data.set(img.data.subarray(o, o + 4), o);
      if (own) mask[y * W + x] = 1;
    }
  }
  return out;
}

/** A camera that frames a thing: pitch down, turned a little, far enough to fit its bounds. */
export function frame(b: readonly number[], yaw = 0.55, pitch = 0.5): { eye: V3; target: V3 } {
  const h = b[4]! - Math.min(0, b[1]!);
  const w = Math.max(b[3]! - b[0]!, b[5]! - b[2]!);
  const size = Math.max(h, w * 0.9, 0.3);
  const target: V3 = [(b[0]! + b[3]!) / 2, Math.min(0, b[1]!) + h * 0.45, (b[2]! + b[5]!) / 2];
  const dist = size * (pitch > 0.55 ? 1.75 : 1.5) + 0.05;
  return { target, eye: [target[0] + Math.sin(yaw) * Math.cos(pitch) * dist, target[1] + Math.sin(pitch) * dist, target[2] + Math.cos(yaw) * Math.cos(pitch) * dist] };
}

export interface Cell { img: ImageData; label: string }

/** A sheet of cells, each a picture and its label, scaled by `scale`. */
export function sheet({ cells, cols, scale, title = "" }: { cells: readonly Cell[]; cols: number; scale: number; title?: string }): HTMLCanvasElement {
  const cw = cells[0]!.img.width * scale, ch = cells[0]!.img.height * scale;
  const pad = 6, labelH = 14, top = title ? 20 : 0;
  const c = document.createElement("canvas");
  c.width = cols * (cw + pad) + pad;
  c.height = top + Math.ceil(cells.length / cols) * (ch + pad + labelH) + pad;
  const g = c.getContext("2d")!;
  g.fillStyle = "#101116"; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingEnabled = false;
  g.font = "11px ui-monospace, monospace";
  if (title) { g.fillStyle = "#e3e6f3"; g.fillText(title, pad, 14); }
  cells.forEach((k, i) => {
    const x = pad + (i % cols) * (cw + pad), y = top + pad + Math.floor(i / cols) * (ch + pad + labelH);
    const tmp = document.createElement("canvas");
    tmp.width = k.img.width; tmp.height = k.img.height;
    tmp.getContext("2d")!.putImageData(k.img, 0, 0);
    g.drawImage(tmp, x, y, cw, ch);
    g.fillStyle = "#9ba1bd";
    g.fillText(k.label, x, y + ch + 11);
  });
  return c;
}

const saves: Promise<unknown>[] = [];
function show(out: HTMLElement, name: string, canvas: HTMLCanvasElement, save: boolean, title: string): void {
  const h = document.createElement("h3");
  h.textContent = `${title} -- out/${name}.png`;
  out.append(h, canvas);
  if (save) saves.push(new Promise((ok) => canvas.toBlob((b) => ok(fetch(`/out/${name}.png`, { method: "PUT", body: b })))));
}

// ---------------------------------------------------------------- cells: one asset in both styles

/** A profile per asset for the sheet (its first, unless it's worth showing another). */
function lookOfDef(pack: ContentPack, def: StyledObjectDef, seed: string, profileId?: string) {
  const id = profileId ?? def.look.profiles?.[0];
  const profile = id ? pack.profile(id) : undefined;
  return lookFor(def, seed, profile ? { profile } : {});
}

export function assetCells({ px, pack, def, size, seed, pins = {}, profile, label }: { px: PixelRenderer; pack: ContentPack; def: StyledObjectDef; size: number; seed: string; pins?: Record<string, unknown>; profile?: string; label?: string }): Cell[] {
  const cells: Cell[] = [];
  const look = lookOfDef(pack, def, seed, profile);
  const builds = (["pixel", "voxel"] as const).map((style) => def.build({ seed, pins, style }));
  // (Both framed alike: by the larger of the two's bounds.)
  const b = builds.map((x) => x.def.bounds).reduce((a, c) => [Math.min(a[0]!, c[0]!), Math.min(a[1]!, c[1]!), Math.min(a[2]!, c[2]!), Math.max(a[3]!, c[3]!), Math.max(a[4]!, c[4]!), Math.max(a[5]!, c[5]!)]);
  const cam = frame(b, 0.55, def.tags.includes("building") || def.tags.includes("bridge") ? 0.62 : 0.42);
  for (const built of builds) {
    const inst = placeObject(built.def, {});
    const scene = sceneOf([{ inst, built, look }]);
    cells.push({ img: draw(px, scene, { size: [size, size], ...cam }), label: `${label ?? def.id} ${built.style}${built.fellBack ? "*" : ""}` });
  }
  return cells;
}

// ---------------------------------------------------------------- the wind

function windStrip(px: PixelRenderer, size: number): Cell[] {
  const cells: Cell[] = [];
  const specs: Array<{ def: StyledObjectDef; pins: Record<string, unknown>; seed: string }> = [
    { def: foliage.get("oak")!, pins: { crown: "round", height: 7 }, seed: "wind" },
    { def: foliage.get("grass")!, pins: { height: 0.5, blades: 9, spread: "fan", seeds: true }, seed: "wind" },
  ];
  for (const s of specs) {
    const built = s.def.build({ seed: s.seed, pins: s.pins, style: "pixel" });
    const look = lookOfDef(foliage, s.def, s.seed);
    const cam = frame(built.def.bounds.map((v, i) => (i === 0 || i === 2 ? v - built.def.bounds[4] * 0.12 : i === 3 || i === 5 ? v + built.def.bounds[4] * 0.12 : v)), 0.0, 0.25);
    const top = built.def.bounds[4];
    // Baked frames: the parts bent (four frames a cycle).
    for (let f = 0; f < 4; f += 1) {
      const posed = defineObject({
        key: built.id, colliders: [],
        parts: swayPose(built.def.parts, top, built.sway!, f, 4).map((p) => ({
          ...(p.box ? { box: p.box } : p.capsule ? { capsule: p.capsule } : { wedge: p.wedge! }), name: p.part.name, mat: String(p.part.mat), role: (p.part as { role?: string }).role,
        })),
      });
      cells.push({ img: draw(px, sceneOf([{ inst: placeObject(posed, {}) as ObjectInstance<StyledMeta>, built, look }]), { size: [size, size], ...cam }), label: `${s.def.id} baked ${f + 1}/4` });
    }
    // The shader's way: one baked picture, each row shifted by swayShift (whole pixels).
    const still = draw(px, sceneOf([{ inst: placeObject(built.def, {}), built, look }]), { size: [size, size], ...cam });
    const groundRow = groundRowOf(still);
    const heightPx = Math.max(8, groundRow - topRowOf(still));
    for (let f = 0; f < 4; f += 1) {
      const t = f / (4 * built.sway!.hz);
      const img = new ImageData(size, size);
      for (let y = 0; y < size; y += 1) {
        const shift = swayShift(Math.max(0, groundRow - y), heightPx, heightPx / top, built.sway!, t, 0.1);
        for (let x = 0; x < size; x += 1) {
          const sx = Math.min(size - 1, Math.max(0, x - shift));
          const o = (y * size + x) * 4, so = (y * size + sx) * 4;
          img.data[o] = still.data[so]!; img.data[o + 1] = still.data[so + 1]!; img.data[o + 2] = still.data[so + 2]!; img.data[o + 3] = 255;
        }
      }
      cells.push({ img, label: `${s.def.id} shader t=${t.toFixed(2)}` });
    }
  }
  return cells;
}
// (Rows of a still picture that differ from its sky/ground, to find where the thing is.)
function topRowOf(img: ImageData): number {
  const bg = [img.data[0], img.data[1], img.data[2]];
  for (let y = 0; y < img.height; y += 1) for (let x = 0; x < img.width; x += 1) { const o = (y * img.width + x) * 4; if (img.data[o] !== bg[0] || img.data[o + 1] !== bg[1] || img.data[o + 2] !== bg[2]) return y; }
  return 0;
}
function groundRowOf(img: ImageData): number { return Math.round(img.height * 0.78); }

// ---------------------------------------------------------------- scenes: records placed through placeContent

const PACKS = [foliage, buildings];
function placeAll(records: readonly ContentRecord[], style?: string): Drawn[] {
  const setting = style ? styleSetting(style, { locked: true }) : undefined;
  return records.map((r) => { const p = placeContent(PACKS, r, setting ? { setting } : {}); return { inst: p.instance, built: p.built, look: p.look }; });
}
function big(img: ImageData, scale: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width * scale; c.height = img.height * scale;
  const t = document.createElement("canvas");
  t.width = img.width; t.height = img.height;
  t.getContext("2d")!.putImageData(img, 0, 0);
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.drawImage(t, 0, 0, c.width, c.height);
  return c;
}
/** A seeded scatter of points in a rectangle, away from `avoid` circles. */
function scatterPts(seed: number, n: number, [x0, z0, x1, z1]: readonly [number, number, number, number], avoid: ReadonlyArray<readonly [number, number, number]> = []): Array<[number, number]> {
  let a = seed >>> 0;
  const f = (): number => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out: Array<[number, number]> = [];
  for (let tries = 0; out.length < n && tries < n * 30; tries += 1) {
    const x = x0 + (x1 - x0) * f(), z = z0 + (z1 - z0) * f();
    if (avoid.some(([ax, az, r]) => Math.hypot(x - ax, z - az) < r)) continue;
    out.push([x, z]);
  }
  return out;
}

function bridgeScene(px: PixelRenderer): { canvas: HTMLCanvasElement; report: unknown } {
  const kinds = ["beam", "arch", "rope", "plank"] as const;
  const records: ContentRecord[] = [];
  const ends: Array<{ kind: string; a: V3; b: V3 }> = [];
  kinds.forEach((kind, i) => {
    const x = -16.5 + i * 11;
    const a: V3 = [x, 0, 6], b: V3 = [x + (i % 2 ? 1.5 : -1), i === 1 ? 0 : 0.6, -6];
    ends.push({ kind, a, b });
    records.push(bridgeFor(a, b, { kind, width: kind === "plank" ? 1.6 : 2.6, seed: i }));
  });
  records.push({ pack: "packs/buildings", id: "dock", seed: 3, pins: { length: 5, width: 2 }, pos: [23, 0, -6.2], yaw: Math.PI });
  for (const [k, [x, z]] of scatterPts(7, 26, [-26, 6.6, 26, 9]).entries()) records.push({ pack: "packs/foliage", id: "reeds", seed: k, pins: { height: 1.2 }, pos: [x, 0, z], yaw: k });
  for (const [k, [x, z]] of scatterPts(9, 8, [-26, -12, 26, -7.5]).entries()) records.push({ pack: "packs/foliage", id: k % 2 ? "rock" : "pine", seed: k, pins: k % 2 ? { size: 1.2 } : { height: 7 }, pos: [x, 0, z], yaw: k });
  const things = placeAll(records);
  // Banks either side of a river 12 m wide, the bed under water.
  const extra = [{ c: [0, -1, 26] as V3, h: [60, 1, 20] as V3 }, { c: [0, -0.4, -26] as V3, h: [60, 1, 20] as V3 }, { c: [0, -3, 0] as V3, h: [60, 0.5, 8] as V3 }];
  const view = { size: [480, 240] as [number, number], eye: [0, 17, 24] as V3, target: [0, -0.5, 0] as V3, waterY: -0.9, screen: 4 as const };
  const img = composite({ px, things, world: { extra, ground: [82, 104, 62] }, view });
  // (Every bridge's two end sockets, where they landed against where they were asked to.)
  const report = things.slice(0, 4).map((t, i) => {
    const s = t.inst.def.sockets;
    const w = (n: string) => { const p = s[n]!.pos; const c = Math.cos(t.inst.transform.yaw), sn = Math.sin(t.inst.transform.yaw); return [t.inst.transform.pos[0] + p[0] * c + p[2] * sn, t.inst.transform.pos[1] + p[1], t.inst.transform.pos[2] - p[0] * sn + p[2] * c]; };
    const e = ends[i]!;
    return { kind: e.kind, endA: Math.hypot(...w("endA").map((v, k) => v - e.a[k]!)).toFixed(4), endB: Math.hypot(...w("endB").map((v, k) => v - e.b[k]!)).toFixed(4) };
  });
  return { canvas: big(img, 2), report };
}

function villageRecords(): ContentRecord[] {
  const B = "packs/buildings", F = "packs/foliage";
  const r: ContentRecord[] = [
    { pack: B, id: "hall", seed: 1, pins: { footprint: "T", width: 12, floors: 1 }, pos: [0, 0, -9], yaw: 0 },
    { pack: B, id: "cottage", seed: 2, pins: { footprint: "L", floors: 2 }, pos: [-10, 0, -1], yaw: 0.5 },
    { pack: B, id: "cottage", seed: 3, pins: { footprint: "rect", floors: 1, roof: "hip" }, pos: [-11, 0, 8], yaw: 1.2 },
    { pack: B, id: "shop", seed: 4, pins: { floors: 2 }, pos: [9, 0, -1], yaw: -0.5 },
    { pack: B, id: "workshop", seed: 5, pins: { footprint: "rect", stacks: 1 }, pos: [11, 0, 9], yaw: -1.3 },
    { pack: B, id: "tower", seed: 6, pins: { footprint: "round", floors: 4, roof: "spire" }, pos: [17, 0, -12], yaw: 0 },
    { pack: B, id: "path-stones", seed: 7, pins: { kind: "flags", length: 6, width: 1.6 }, pos: [0, 0, 1], yaw: Math.PI / 2 },
    { pack: B, id: "path-stones", seed: 8, pins: { kind: "flags", length: 6, width: 1.6 }, pos: [0, 0, 7], yaw: Math.PI / 2 },
  ];
  r.push(...alongPath([[-18, 0, 14], [-6, 0, 16], [6, 0, 16], [18, 0, 14]], { id: "fence", pins: { kind: "picket", height: 1 }, gates: [2], gatePins: { kind: "wooden", height: 2.4 }, seed: 9 }));
  r.push(...alongPath([[22, 0, -18], [22, 0, 4]], { id: "wall", pins: { kind: "stone", height: 2.6, thick: 0.8, crenels: true }, seed: 10 }));
  const avoid: Array<[number, number, number]> = [[0, -9, 9], [-10, -1, 6], [-11, 8, 5], [9, -1, 5], [11, 9, 6], [17, -12, 4], [0, 4, 3], [22, -7, 2]];
  for (const [k, [x, z]] of scatterPts(11, 9, [-26, -22, 26, -14], avoid).entries()) r.push({ pack: F, id: ["oak", "pine", "birch"][k % 3]!, seed: k, pins: {}, pos: [x, 0, z], yaw: k });
  for (const [k, [x, z]] of scatterPts(12, 7, [-24, -12, 24, 13], avoid).entries()) r.push({ pack: F, id: k % 3 === 0 ? "rock" : "bush", seed: k, pins: k % 3 === 0 ? { size: 0.9 } : { size: 1.1 }, pos: [x, 0, z], yaw: k });
  for (const [k, [x, z]] of scatterPts(13, 40, [-24, -13, 24, 14], avoid).entries()) r.push({ pack: F, id: k % 4 === 0 ? "flowers" : "grass", seed: k % 6, pins: k % 4 === 0 ? { count: 3 } : { height: 0.4 }, pos: [x, 0, z], yaw: k * 0.7 });
  return r;
}

function villageScene(px: PixelRenderer, style: "pixel" | "voxel"): { canvas: HTMLCanvasElement; report: unknown } {
  const things = placeAll(villageRecords(), style);
  const img = composite({ px, things, world: { ground: [74, 96, 58] }, view: { size: [480, 300], eye: [-4, 30, 34], target: [0, 0, -1], screen: 4 } });
  const keys = new Set(things.map((t) => t.built.key));
  return { canvas: big(img, 2), report: { things: things.length, shapes: keys.size, fellBack: things.filter((t) => t.built.fellBack).length } };
}

function colonyScene(px: PixelRenderer): { canvas: HTMLCanvasElement; report: unknown } {
  const B = "packs/buildings", F = "packs/foliage";
  const r: ContentRecord[] = [
    { pack: B, id: "dome", seed: 1, pins: { width: 10, roof: "dome" }, pos: [-8, 0, -6] },
    { pack: B, id: "hab", seed: 2, pins: { footprint: "L" }, pos: [5, 0, -8], yaw: -0.4 },
    { pack: B, id: "hab", seed: 3, pins: { footprint: "rect", windows: "band" }, pos: [-12, 0, 6], yaw: 0.9 },
    { pack: B, id: "pylon", seed: 4, pins: { rings: 2 }, pos: [2, 0, 3] },
    { pack: B, id: "factory", seed: 5, pins: {}, pos: [15, 0, 4], yaw: -1.2 },
    { pack: B, id: "hive", seed: 6, pins: { size: 8 }, pos: [-20, 0, -14] },
    { pack: B, id: "dome", seed: 7, pins: { width: 7, roof: "saucer" }, pos: [16, 0, -12] },
  ];
  r.push(...alongPath([[-16, 0, 14], [0, 0, 16], [16, 0, 14]], { id: "fence", pins: { kind: "wire", height: 1.4 }, gates: [1], gatePins: { kind: "scifi", height: 3 }, seed: 8 }));
  const avoid: Array<[number, number, number]> = [[-8, -6, 7], [5, -8, 6], [-12, 6, 5], [2, 3, 3], [15, 4, 7], [-20, -14, 6], [16, -12, 5]];
  for (const [k, [x, z]] of scatterPts(21, 10, [-26, -22, 26, 13], avoid).entries()) r.push({ pack: F, id: ["alien-tree", "crystal", "mushroom", "rock"][k % 4]!, seed: k, pins: {}, look: { profile: k % 4 === 2 ? "fungal" : "alien" }, pos: [x, 0, z], yaw: k });
  for (const [k, [x, z]] of scatterPts(22, 24, [-26, -20, 26, 13], avoid).entries()) r.push({ pack: F, id: "grass", seed: k % 5, pins: { height: 0.35 }, look: { profile: "alien" }, pos: [x, 0, z], yaw: k });
  const things = placeAll(r);
  const img = composite({ px, things, world: { ground: [70, 62, 84] }, view: { size: [480, 300], eye: [-4, 30, 34], target: [0, 0, -2], screen: 4 } });
  return { canvas: big(img, 2), report: { things: things.length } };
}

// ---------------------------------------------------------------- the page

export async function showcasePage(out: HTMLElement, q: URLSearchParams): Promise<Record<string, unknown>> {
  const only = q.get("only");
  const save = q.get("save") !== "0";
  const want = (k: string): boolean => !only || only.split(",").includes(k);
  const canvas = new OffscreenCanvas(256, 256);
  const px = createPixelRenderer(canvas, { width: 256, height: 256 });
  const report: Record<string, unknown> = {};
  const t0 = performance.now();
  if (want("foliage")) {
    for (const size of [128, 256] as const) {
      const cells = foliage.objects.flatMap((def) => assetCells({ px, pack: foliage, def, size, seed: "sheet-1" }));
      show(out, `world-foliage-${size}`, sheet({ cells, cols: size === 128 ? 8 : 6, scale: size === 128 ? 2 : 1, title: `packs/foliage: every kind, pixel | voxel (${size} px)` }), save, `foliage ${size}`);
    }
    // Seasons: one oak and one bush through the profiles (looks only: the same baked shape).
    const seasons = ["spring", "summer", "autumn", "winter", "dry", "alien"].flatMap((p) => assetCells({ px, pack: foliage, def: foliage.get("oak")!, size: 128, seed: "season", pins: { crown: "round" }, profile: p, label: `oak ${p}` }).slice(0, 1));
    show(out, "world-foliage-seasons", sheet({ cells: seasons, cols: 6, scale: 2, title: "one oak shape, six profiles (looks, not bakes)" }), save, "seasons");
  }
  if (want("wind")) show(out, "world-wind", sheet({ cells: windStrip(px, 128), cols: 8, scale: 2, title: "wind: baked frames (sway clip) | the sprite shader's row shift on one baked picture" }), save, "wind");
  if (want("buildings")) {
    for (const size of [128, 256] as const) {
      const cells = buildings.objects.flatMap((def) => assetCells({ px, pack: buildings, def, size, seed: "sheet-1" }));
      show(out, `world-buildings-${size}`, sheet({ cells, cols: size === 128 ? 8 : 6, scale: size === 128 ? 2 : 1, title: `packs/buildings: every variant and piece, pixel | voxel (${size} px)` }), save, `buildings ${size}`);
    }
    const cultures = ["village", "stone", "desert", "nordic", "scifi", "machine"].flatMap((p) => assetCells({ px, pack: buildings, def: buildings.get("cottage")!, size: 128, seed: "culture", pins: { footprint: "L", floors: 2 }, profile: p, label: `cottage ${p}` }).slice(0, 1));
    show(out, "world-buildings-cultures", sheet({ cells: cultures, cols: 6, scale: 2, title: "one cottage shape, six cultures (looks, not bakes)" }), save, "cultures");
  }
  if (want("bridge")) {
    const r = bridgeScene(px);
    show(out, "world-bridge", r.canvas, save, "bridges over water: beam, arch, rope, plank -- placed end to end by bridgeFor()");
    report["bridge"] = r.report;
  }
  if (want("village")) {
    for (const style of ["pixel", "voxel"] as const) {
      const r = villageScene(px, style);
      show(out, `world-village-${style}`, r.canvas, save, `a village, ${style} (a locked style setting: every placement drawn ${style})`);
      report[`village-${style}`] = r.report;
    }
    const c = colonyScene(px);
    show(out, "world-colony", c.canvas, save, "an RTS colony: hab, dome, pylon, factory, hive, alien flora, crystals");
    report["colony"] = c.report;
  }
  report["ms"] = Math.round(performance.now() - t0);
  await Promise.all(saves);
  report["saved"] = save;
  return report;
}
(globalThis as { showcasePage?: typeof showcasePage }).showcasePage = showcasePage;
export type { PlacedContent };
