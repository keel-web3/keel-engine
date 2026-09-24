import {
  HEIGHT_STEPS, LayerInstances, createSpriteRenderer, LOOKS_PER_ROW, LOOK_TEXELS, WORN_SLOT, bakeCamera, bakeSize,
  createLookTable, createSpriteCache, dressPopulation, heightAt, paintRoles, paintSlots, pixelPoint, pixelView,
  planBake, pointDepth, populateShapes, raycastWorld, renderIndexedSprites, spriteRect, thinned,
} from "@keel-engine/bake";
import type { BakeWorld, BodyShape, IndexedBakeRenderer, PixelView, SpriteJob } from "@keel-engine/bake";
import { cameraBasis } from "@keel-engine/core";
import { bakeDesignOf, lookFor, placeContent } from "@keel-engine/object";
import type { ContentPack, StyledBakeDesign } from "@keel-engine/object";
import { FLOOR, LIT_SPRITE_FLOATS } from "../src/index.ts";
import type { DungeonDressing, DungeonRenderer } from "../src/index.ts";
import { createPixelRenderer } from "@keel-engine/render";
import {
  FLAG, WATER_NONE, autoTile, createGpuGround, createGpuTerrain, createGroundBaker, createGroundRenderer,
  groundSurface, spritePosition, surfacePalette, viewAxes,
} from "@keel-engine/terrain";
import { randomTerrain } from "../../terrain/test/helpers.ts";
import { pack as dungeonPack } from "@keel-engine/dungeon";
import { pack as humans } from "@keel-engine/humans";
import { pack as animals } from "@keel-engine/animals";

export const YAW = Math.PI / 4;
const STUB = 0.7;

/** One subject a frame draws: what it is, where, which sprite. */
export interface Subject {
  readonly design: string;
  readonly world: BakeWorld;
  readonly clip: string;
  readonly frame: number;
  readonly dir: number;
  readonly x: number;
  readonly z: number;
  readonly look: number;
  readonly flags: number;
  readonly kind: string;
  readonly where: string;
}
export interface Rect { x: number; y: number; w: number; h: number; ax: number; ay: number; page: number }
export interface Tally { subject: number; shown: number; falseHidden: number; falseVisible: number; unjudged: number; edge: number }
export const tally = (): Tally => ({ subject: 0, shown: 0, falseHidden: 0, falseVisible: 0, unjudged: 0, edge: 0 });
export const add = (a: Tally, b: Tally): void => { a.subject += b.subject; a.shown += b.shown; a.falseHidden += b.falseHidden; a.falseVisible += b.falseVisible; a.unjudged += b.unjudged; a.edge += b.edge; };
export const rate = (t: Tally) => ({ falseHidden: t.subject ? t.falseHidden / t.subject : 0, falseVisible: t.shown ? t.falseVisible / t.shown : 0 });
const bayer4 = (x: number, y: number): number => { const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; return (m[(y & 3) * 4 + (x & 3)]! + 0.5) / 16; };
const smoothstep = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- the terrain: cliffs and slopes

export interface TerrainCheckOptions {
  readonly ks?: readonly number[];
  readonly pitches?: readonly number[];
  readonly yaws?: readonly number[];
  readonly frames?: number;
  readonly subjects?: number;
  readonly width?: number;
  readonly height?: number;
  /** "gpu" (keel/terrain's GPU ground) or "cpu" (its baked layers). */
  readonly ground?: "gpu" | "cpu";
  readonly heatmaps?: boolean;
  readonly log?: (s: string) => void;
}

/**
 * The same judgement on keel/terrain's ground (plateaus, cliffs, ramps, water) with keel/bake's layer renderer --
 * the model's other axis, the ground's ("ground": heights ignored, sprites placed by spritePosition). Subjects stand
 * at cliff tops and feet and on ramps; the truth for the ground is its own depth as it draws it.
 */
function prepareTerrain(canvas: HTMLCanvasElement, o: TerrainCheckOptions) {
  const log = o.log ?? ((s2: string) => console.log(s2));
  const W = o.width ?? 480, H = o.height ?? 270;
  const sr = createSpriteRenderer(canvas, { width: W, height: H, capacity: 4096 });
  sr.setTarget(W, H);
  const gl = sr.gl;
  const t = randomTerrain(21, 96, 96, { chunk: 32, ramps: 40 });
  const biomes = [{ name: "meadow" }, { name: "dry", tint: { hue: 25, chroma: 0.8 } }];
  const biome = new Uint8Array(96 * 96);
  const palette = surfacePalette(t.types, biomes);
  const surface = groundSurface({ biomes, biome });
  const auto = autoTile(t, { seed: 1 });
  const gpu = createGpuGround(gl, { palette, seed: 1 });
  const gT = createGpuTerrain(gpu, { terrain: t, auto, surface, prefetch: 0, seed: 1 });
  gT.preload();
  const cpuGround = createGroundRenderer(gl);
  cpuGround.setPalette(palette);
  const baker = createGroundBaker({ terrain: t, palette, style: { name: "pixel" }, surface, prefetch: 0, seed: 1 });
  // (An FBO whose depth is a texture: the ground's depth read back through a packing pass.)
  const color = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, color); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
  const depthT = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, depthT); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, W, H);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthT, 0);
  const packC = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, packC); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
  const packF = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, packF); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, packC, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const packP = (() => {
    const sh = (type: number, src: string) => { const x = gl.createShader(type)!; gl.shaderSource(x, src); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x) ?? ""); return x; };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, "#version 300 es\nvoid main() { vec2 q = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4.0 - 1.0; gl_Position = vec4(q, 0.0, 1.0); }"));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, "#version 300 es\nprecision highp float; uniform highp sampler2D uD; out vec4 o; void main() { float z = texelFetch(uD, ivec2(gl_FragCoord.xy), 0).r; uint v = uint(clamp(z, 0.0, 1.0) * 16777215.0 + 0.5); o = vec4(float(v >> 16u) / 255.0, float((v >> 8u) & 255u) / 255.0, float(v & 255u) / 255.0, 1.0); }"));
    gl.linkProgram(p);
    return p;
  })();
  const read = (fb: WebGLFramebuffer | null): Uint8Array => { const a = new Uint8Array(W * H * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, a); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return a; };

  // Subjects: every packs/dungeon prop, every body.
  const PACKS: readonly ContentPack[] = [dungeonPack];
  const props: Array<StyledBakeDesign & { id: string; built: never }> = dungeonPack.objects.map((def) => { const placed = placeContent(PACKS, { pack: "packs/dungeon", id: def.id, seed: `t:${def.id}`, style: "pixel", pins: {} }); return Object.assign(bakeDesignOf(placed.built), { id: def.id, built: placed.built as never }); });
  const entities = [...humans.entities.map((def) => ({ def, pack: "packs/humans" })), ...animals.entities.map((def) => ({ def, pack: "packs/animals" }))];
  const pop = dressPopulation(populateShapes({ seed: "occ-t", count: entities.length, entities: entities.map((e) => ({ def: e.def as never, pack: e.pack, shapes: 1, weight: 1 })), attributes: [], shapes: 1, wear: [0, 0], clipsFor: () => [{ name: "idle", frames: 1, loop: true }, { name: "walk", frames: 8, loop: true }], pins: new Map(entities.map((e, i) => [i, { body: { entity: e.def.id } }])) as never }));
  const table = createLookTable({ rampLength: 5 });
  const propLook = props.map((d) => table.add(paintRoles(lookFor(d.built, `t:${d.id}`))));
  const unitLook = pop.units.map((u) => table.add(paintSlots(u.look, pop.bodies[u.body]!.slotRoles(u.coverage), u.wornLook, WORN_SLOT)));
  const lookTex = table.texture();
  const painted = (look: number, slot: number): boolean => lookTex.data[(Math.floor(look / LOOKS_PER_ROW) * lookTex.width + (look % LOOKS_PER_ROW) * LOOK_TEXELS + (slot >> 2)) * 4 + (slot & 3)] !== 0;
  sr.setLooks({ palette: table.palette(), paints: table.paintTexture(), looks: lookTex });

  // Spots: cliff tops and feet (a tile beside one a step or more different), ramps, and a few flats.
  interface TSpot { x: number; z: number; where: string }
  const spots: TSpot[] = [];
  const T = t.tileSize;
  for (let j = 1; j < t.depth - 1; j += 1) for (let i = 1; i < t.width - 1; i += 1) {
    const k0 = t.index(i, j), h0 = t.height[k0]!;
    if (t.water[k0] !== WATER_NONE) continue;
    const ramp = (t.flags[k0]! & FLAG.RAMP) !== 0;
    let cliff = "";
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { const h1 = t.height[t.index(i + di, j + dj)]!; if (h1 !== h0 && !ramp) { cliff = h1 > h0 ? "cliff-foot" : "cliff-top"; spots.push({ x: (i + 0.5 + di * 0.3) * T, z: (j + 0.5 + dj * 0.3) * T, where: cliff }); } }
    if (ramp) spots.push({ x: (i + 0.5) * T, z: (j + 0.5) * T, where: "slope" });
    else if (!cliff && (i * 7 + j * 13) % 23 === 0) spots.push({ x: (i + 0.5) * T, z: (j + 0.5) * T, where: "flat" });
  }
  log(`terrain 96x96: ${spots.length} spots (${["cliff-top", "cliff-foot", "slope", "flat"].map((w) => `${spots.filter((s2) => s2.where === w).length} ${w}`).join(", ")})`);
  let rs = 987654;
  const rnd = (): number => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  const totals = { before: tally(), after: tally() };
  const byWhere = new Map<string, { before: Tally; after: Tally }>();
  const rows: unknown[] = [];
  const heatmaps: string[] = [];
  const insts = new LayerInstances(4096);
  const px = createPixelRenderer(new OffscreenCanvas(64, 64) as never, { width: 64, height: 64 }) as unknown as IndexedBakeRenderer;
  return { o, log, W, H, sr, gl, t, T, palette, surface, gpu, gT, cpuGround, baker, fbo, depthT, packF, packP, read, props, entities, pop, propLook, unitLook, painted, spots, rnd, totals, byWhere, rows, heatmaps, insts, px };
}
type TerrainContext = ReturnType<typeof prepareTerrain>;

export async function runTerrain(canvas: HTMLCanvasElement, o: TerrainCheckOptions = {}): Promise<unknown> {
  const context = prepareTerrain(canvas, o);
  await runTerrainScales(context);
  return terrainResult(context);
}

async function runTerrainScales(context: TerrainContext): Promise<void> {
  const { o, log, W, H, sr, gl, t, T, palette, surface, gpu, gT, cpuGround, baker, fbo, depthT, packF, packP, read, props, entities, pop, propLook, unitLook, painted, spots, rnd, totals, byWhere, rows, heatmaps, insts, px } = context;
  for (const yaw of o.yaws ?? [0, Math.PI / 4]) for (const pitch of o.pitches ?? [0.5, 0.72]) for (const k of o.ks ?? [16, 24, 32, 48]) {
    const designs = [...props, ...pop.bodies];
    const plan = planBake(designs as never, { directions: 8, pixelsPerMetre: k, pitch, style: "occ-t" });
    const jobs = plan.sprites.filter((j) => j.clip === "still" || j.clip === "walk");
    const cache = createSpriteCache();
    cache.add(renderIndexedSprites(px, jobs, new Map(designs.map((d) => [d.key, d] as const)) as never, { heights: true }).baked);
    const atlas = cache.atlas(jobs.map((j) => j.key), { size: 4096 });
    sr.setPages(atlas.pages);
    const rects = new Map<string, Rect>(), jobOf = new Map<string, SpriteJob>();
    for (const j of jobs) { const r = atlas.sprites.get(j.key); if (r) { rects.set(`${j.design}|${j.clip}|${j.frame}|${j.direction}`, r); jobOf.set(`${j.design}|${j.clip}|${j.frame}|${j.direction}`, j); } }
    for (let f = 0; f < (o.frames ?? 3); f += 1) {
      // (Middles among the cliffs, away from the map's edge.)
      const mids = spots.filter((s2) => s2.where !== "flat" && s2.x > 24 && s2.z > 24 && s2.x < t.width * T - 24 && s2.z < t.depth * T - 24);
      const c0 = mids[Math.floor(rnd() * mids.length)]!;
      const view = viewAt({ x: c0.x, z: c0.z, pitch, k, width: W, height: H, yaw });
      const a = viewAxes({ yaw, pitch, pixelsPerMetre: k });
      const inView = (x: number, z: number): boolean => { const q = view.project([x, t.heightAt(x, z), z]); return q[0] > 30 && q[0] < W - 30 && q[1] > 60 && q[1] < H - 10; };
      const near = spots.filter((s2) => inView(s2.x, s2.z));
      for (let n = near.length - 1; n > 0; n -= 1) { const m = Math.floor(rnd() * (n + 1)); [near[n], near[m]] = [near[m]!, near[n]!]; }
      const subjects: Array<Subject & { y: number }> = [];
      for (let n = 0; n < Math.min(o.subjects ?? 30, near.length); n += 1) {
        const sp = near[n]!, dir = Math.floor(rnd() * 8);
        if (rnd() < 0.5) { const u = Math.floor(rnd() * pop.units.length), b = pop.bodies[pop.units[u]!.body]!, frame = Math.floor(rnd() * 8); subjects.push({ design: b.key, world: b.pose("walk", frame), clip: "walk", frame, dir, x: sp.x, z: sp.z, y: t.heightAt(sp.x, sp.z), look: unitLook[u]!, flags: 0, kind: entities[u]!.def.id, where: sp.where }); }
        else { const pi = Math.floor(rnd() * props.length), d = props[pi]!; subjects.push({ design: d.key, world: d.pose("still", 0), clip: "still", frame: 0, dir: d.symmetric ? 0 : dir, x: sp.x, z: sp.z, y: t.heightAt(sp.x, sp.z), look: propLook[pi]!, flags: 0, kind: d.id, where: sp.where }); }
      }
      insts.clear();
      const texels = subjects.map((sub) => {
        const key = `${sub.design}|${sub.clip}|${sub.frame}|${sub.dir}`;
        const r = rects.get(key)!, job = jobOf.get(key)!;
        const p = spritePosition(a, [sub.x, sub.y, sub.z]);
        insts.push(p[0], p[1], p[2], r.x, r.y, r.w, r.h, r.ax, r.ay, r.page, sub.look, 0, 1);
        return subjectTexels({ view, sub, r, job, page: atlas.pages[r.page]!, painted, ground: sub.y, axis: "ground" });
      });
      // The ground (its depth kept), then the sprites as ids against it -- with heights, and without.
      const drawGround = () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, W, H);
        if (o.ground === "cpu") { baker.plan({ ...view, pixelsPerMetre: k }); for (let q = 0; q < 120 && !baker.ready; q += 1) baker.bake(250); cpuGround.draw(view, baker.layers(), { clear: [0, 0, 0] }); }
        else gpu.draw(view, { clear: [0, 0, 0], keys: gT.plan(view), framebuffer: fbo });
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      };
      drawGround();
      // (Its depth, packed.)
      gl.bindFramebuffer(gl.FRAMEBUFFER, packF); gl.viewport(0, 0, W, H); gl.disable(gl.DEPTH_TEST); gl.useProgram(packP);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, depthT); gl.uniform1i(gl.getUniformLocation(packP, "uD"), 0);
      gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3);
      const surf = read(packF);
      const colourShot = o.heatmaps && f === 0 ? (() => { drawGround(); sr.drawLayers(view, insts, { clear: null }); return read(fbo); })() : null;
      const idsWith = (heights: boolean): Uint8Array => { drawGround(); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); sr.drawLayers(view, insts, { clear: null, ids: true, heights, screen: 0, outline: 0 }); return read(fbo); };
      const after = idsWith(true), before = idsWith(false);
      const range = (Math.max(W, H) / k) * 4;
      const surfaceAt = (x: number, y: number): number => { const q = ((H - 1 - y) * W + x) * 4; const v = (surf[q]! << 16) | (surf[q + 1]! << 8) | surf[q + 2]!; return v >= 16777215 ? Infinity : (v / 16777215 - 0.5) * range; };
      const idAt = (pic: Uint8Array, x: number, y: number): number => { const q = ((H - 1 - y) * W + x) * 4; return (pic[q]! | (pic[q + 1]! << 8) | (pic[q + 2]! << 16)) - 1; };
      const cand = new Map<number, Array<{ i: number; depth: number; tol: number }>>();
      const edge = new Set<number>();
      texels.forEach((list, i) => { for (const tx of list) { const q = tx.py * W + tx.px; if (Number.isNaN(tx.depth)) { edge.add(q); continue; } (cand.get(q) ?? cand.set(q, []).get(q)!).push({ i, depth: tx.depth, tol: tx.quant }); } });
      const tb = tally(), ta = tally();
      const hm = colourShot ? { before: new Uint8Array(W * H), after: new Uint8Array(W * H) } : null;
      for (const [q, list] of cand) {
        const x = q % W, y = Math.floor(q / W), ts = surfaceAt(x, y);
        list.sort((p1, p2) => p1.depth - p2.depth);
        const best = list[0]!, second = list[1];
        // (The ground's own depth steps and the sprites' 5 mm tie: 8 mm.)
        const close = Math.abs(ts - best.depth) < best.tol + 0.008 || (second !== undefined && second.depth - best.depth < best.tol + second.tol + 0.004) || edge.has(q);
        const expect = ts < best.depth ? -1 : best.i;
        const w = subjects[best.i]!.where;
        const wt = byWhere.get(w) ?? byWhere.set(w, { before: tally(), after: tally() }).get(w)!;
        for (const [which, pic, T2] of [["before", before, tb], ["after", after, ta]] as const) {
          const g = idAt(pic, x, y);
          if (close) { T2.unjudged += 1; wt[which].unjudged += 1; continue; }
          if (expect >= 0) { T2.subject += 1; wt[which].subject += 1; }
          if (g >= 0) { T2.shown += 1; wt[which].shown += 1; }
          if (expect >= 0 && g !== expect) { T2.falseHidden += 1; wt[which].falseHidden += 1; if (hm) hm[which][q] = 1; }
          else if (g >= 0 && g !== expect) { T2.falseVisible += 1; wt[which].falseVisible += 1; if (hm) hm[which][q] = 2; }
        }
      }
      for (const [which, pic, T2] of [["before", before, tb], ["after", after, ta]] as const) for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
        const g = idAt(pic, x, y);
        if (g < 0) continue;
        const q = y * W + x;
        if (cand.get(q)?.some((c2) => c2.i === g) || edge.has(q)) continue;
        T2.shown += 1; T2.falseVisible += 1; if (hm) hm[which][q] = 3;
      }
      add(totals.before, tb); add(totals.after, ta);
      rows.push({ yaw: +yaw.toFixed(3), pitch, k, frame: f, subjects: subjects.length, before: { ...tb, ...rate(tb) }, after: { ...ta, ...rate(ta) } });
      if (hm && colourShot) for (const which of ["before", "after"] as const) heatmaps.push(await putHeatmap({ name: `occlusion-terrain-heatmap-${which}-k${k}-p${Math.round(pitch * 100)}-y${Math.round(yaw * 100)}`, colour: colourShot, marks: hm[which], W, H }));
    }
    log(`terrain yaw ${yaw.toFixed(2)} pitch ${pitch} k ${k}: after ${JSON.stringify(rate(totals.after))}`);
  }
}

function terrainResult({ totals, byWhere, rows, heatmaps }: TerrainContext): unknown {
  return {
    totals: { before: { ...totals.before, ...rate(totals.before) }, after: { ...totals.after, ...rate(totals.after) } },
    byWhere: Object.fromEntries([...byWhere].map(([k2, v]) => [k2, { before: rate(v.before), after: rate(v.after), subject: v.after.subject }])),
    rows, heatmaps,
  };
}

/** The demo's view: yaw 45 degrees (or `yaw`), the centre snapped to whole pixels (as the crawl's). */
interface ViewAtOptions { x: number; z: number; pitch: number; k: number; width: number; height: number; yaw?: number }
export function viewAt({ x, z, pitch, k, width: W, height: H, yaw = YAW }: ViewAtOptions): PixelView {
  const v0 = pixelView({ center: [x, 0, z], yaw, pitch, pixelsPerMetre: k, width: W, height: H });
  const a = v0.axes;
  const gx = Math.round((x * a.right[0] + z * a.right[2]) * k) / k;
  const gy = Math.round((x * a.up[0] + z * a.up[2]) * k) / k;
  const fw = x * a.forward[0] + z * a.forward[2];
  return pixelView({ center: [a.right[0] * gx + a.up[0] * gy + a.forward[0] * fw, a.up[1] * gy + a.forward[1] * fw, a.right[2] * gx + a.up[2] * gy + a.forward[2] * fw], yaw, pitch, pixelsPerMetre: k, width: W, height: H });
}

/**
 * A subject's texels as drawn: the picture pixel each lands on, and the point it shows -- its bake camera's ray
 * through that texel against its design's solids (the truth for its height), set on the drawn pixel's ray at that
 * height: its depth. NaN where the ray misses (a silhouette's edge: not judged). `quant`: half the height byte's step,
 * as depth.
 */
interface SubjectTexelOptions {
  view: PixelView; sub: Subject; r: Rect; job: SpriteJob;
  page: { width: number; rgba: Uint8Array; heights?: Uint8Array | undefined };
  painted: (look: number, slot: number) => boolean; ground?: number; axis?: "view" | "ground";
}
export function subjectTexels({ view, sub, r, job, page, painted, ground = 0, axis = "view" }: SubjectTexelOptions): Array<{ px: number; py: number; y: number; depth: number; quant: number; gy: number }> {
  const out: Array<{ px: number; py: number; y: number; depth: number; quant: number; gy: number }> = [];
  const [x0, y0] = spriteRect(view, { at: [sub.x, ground, sub.z], w: r.w, h: r.h, ax: r.ax, ay: r.ay });
  // The bake's camera for this job (renderIndexedSprites rounds a job's box up to 16 px first).
  const margin = 3, up16 = (v: number) => Math.ceil(v / 16) * 16;
  const size = bakeSize(job, margin);
  const j2 = { ...job, w: up16(size.width) - 2 * margin, h: up16(size.height) - 2 * margin };
  const cam = bakeCamera(j2, { margin });
  const B = cameraBasis(cam.eye, cam.target);
  const tanF = Math.tan(cam.fov / 2), aspect = cam.width / cam.height;
  const bx0 = cam.ox - r.ax, by0 = cam.oy - r.ay; // (the trimmed sprite's corner in the bake's picture)
  // (The solids as the bake drew them: thinned by its hit tolerance, then met a tolerance out -- a part thinner than a
  // texel comes out a texel thick. The sprite's pixels are that shape; what's judged is how they're hidden.)
  const shown = shownWorld(sub.world, cam.eps);
  const sp = -view.axes.forward[1];
  const quant = (1 / HEIGHT_STEPS / 2 / view.pixelsPerMetre) / Math.max(sp, 0.05);
  for (let ty = 0; ty < r.h; ty += 1) for (let tx = 0; tx < r.w; tx += 1) {
    const o = ((r.y + ty) * page.width + r.x + tx) * 4;
    const v = page.rgba[o]!;
    const slot = (v & 63) - 1;
    if (slot < 0 || !painted(sub.look, slot)) continue;
    const pxD = x0 + tx, pyD = y0 + ty;
    if (pxD < 0 || pyD < 0 || pxD >= view.width || pyD >= view.height) continue;
    // (The bake's ray through this texel's centre, in the design's own frame.)
    const fxb = bx0 + tx + 0.5, fyb = cam.height - (by0 + ty) - 0.5;
    const u = (fxb / cam.width) * 2 - 1, w = (fyb / cam.height) * 2 - 1;
    const d: [number, number, number] = [B.forward[0] + u * tanF * aspect * B.right[0] + w * tanF * B.up[0], B.forward[1] + u * tanF * aspect * B.right[1] + w * tanF * B.up[1], B.forward[2] + u * tanF * aspect * B.right[2] + w * tanF * B.up[2]];
    const dl = Math.hypot(d[0], d[1], d[2]);
    d[0] /= dl; d[1] /= dl; d[2] /= dl;
    const t = shellHit(sub.world, cam.eps, shown, cam.eye as [number, number, number], d);
    const gy = page.heights ? (heightAt(page.heights, (r.y + ty) * page.width + r.x + tx) - 1) / HEIGHT_STEPS / view.pixelsPerMetre : NaN;
    if (!Number.isFinite(t)) { out.push({ px: pxD, py: pyD, y: NaN, depth: NaN, quant, gy }); continue; }
    const y = Math.max(0, cam.eye[1] + d[1] * t);
    // (On the drawn pixel's ray, at that height: the point a perfect depth sprite shows there.)
    const P = pixelPoint(view, pxD + 0.5, pyD + 0.5, ground + y);
    out.push({ px: pxD, py: pyD, y, depth: pointDepth(view, P, axis), quant, gy });
  }
  return out;
}

// The bake's solids as its raymarcher draws them: thinned by eps, a hit once within 0.0015 x the ray's length (keel/render
// shaders.ts). The truth for what a texel shows: that shell's first point along the texel's ray.
const sdBox = (x: number, y: number, z: number, h: ArrayLike<number>): number => { const qx = Math.abs(x) - h[0]!, qy = Math.abs(y) - h[1]!, qz = Math.abs(z) - h[2]!; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0); };
function sdSection(px: number, py: number, hx: number, hy: number, lo: number): number {
  const v = [[-hx, -hy], [hx, -hy], [hx, -hy + 2 * hy * lo], [-hx, hy]] as const;
  let out2 = 1e18, far = -1e9, inside = true;
  for (let i = 0; i < 4; i += 1) {
    const a = v[i]!, b = v[(i + 1) & 3]!, ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey;
    if (L2 < 1e-12) continue;
    const wx = px - a[0], wy = py - a[1], h = Math.max(0, Math.min(1, (wx * ex + wy * ey) / L2)), qx = wx - ex * h, qy = wy - ey * h;
    out2 = Math.min(out2, qx * qx + qy * qy);
    const sgn = (wx * ey - wy * ex) / Math.sqrt(L2);
    if (sgn > 0) inside = false;
    far = Math.max(far, sgn);
  }
  return inside ? far : Math.sqrt(out2);
}
function sdfWorld(w: BakeWorld, x: number, y: number, z: number): number {
  let m = 1e9;
  const turn = (b: { c: ArrayLike<number>; yaw?: number | undefined }) => { const c = Math.cos(b.yaw ?? 0), sn = Math.sin(b.yaw ?? 0), dx = x - b.c[0]!, dz = z - b.c[2]!; return [c * dx - sn * dz, y - b.c[1]!, sn * dx + c * dz] as const; };
  for (const b of w.boxes ?? []) { const q = turn(b); if (b.kind === "wedge") { const a = Math.abs(q[0]) - b.h[0]!, s2 = sdSection(q[2], q[1], b.h[2]!, b.h[1]!, Math.max(0, Math.min(0.98, b.lo ?? 0))); m = Math.min(m, Math.hypot(Math.max(a, 0), Math.max(s2, 0)) + Math.min(Math.max(a, s2), 0)); } else m = Math.min(m, sdBox(q[0], q[1], q[2], b.h)); }
  for (const b of w.wedges ?? []) { const q = turn(b); const a = Math.abs(q[0]) - b.h[0]!, s2 = sdSection(q[2], q[1], b.h[2]!, b.h[1]!, Math.max(0, Math.min(0.98, b.lo ?? 0))); m = Math.min(m, Math.hypot(Math.max(a, 0), Math.max(s2, 0)) + Math.min(Math.max(a, s2), 0)); }
  for (const c of w.capsules ?? []) {
    const bax = c.b[0]! - c.a[0]!, bay = c.b[1]! - c.a[1]!, baz = c.b[2]! - c.a[2]!, pax = x - c.a[0]!, pay = y - c.a[1]!, paz = z - c.a[2]!;
    const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / Math.max(bax * bax + bay * bay + baz * baz, 1e-6)));
    m = Math.min(m, Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - c.r);
  }
  return m;
}
const thinCache = new WeakMap<BakeWorld, Map<number, BakeWorld>>();
function shellHit(world: BakeWorld, eps: number, shown: BakeWorld, o: readonly [number, number, number], d: readonly [number, number, number]): number {
  const m = thinCache.get(world) ?? thinCache.set(world, new Map()).get(world)!;
  const thin = m.get(eps) ?? (m.set(eps, thinned(world, eps)), m.get(eps)!);
  // (From just before the sharp shape a tolerance out -- nothing's hit before it -- then the march.)
  const t0 = raycastWorld(shown, o, d);
  if (!Number.isFinite(t0)) return Infinity;
  let t = Math.max(0.05, t0 - 0.02);
  for (let i = 0; i < 200; i += 1) {
    const h = sdfWorld(thin, o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t) - 0.0015 * t;
    if (h < 0.0002) return t;
    t += h;
    if (t > t0 + 4 * eps + 0.5) return Infinity;
  }
  return t;
}

const shownCache = new WeakMap<BakeWorld, Map<number, BakeWorld>>();
/** A world as a bake draws it: thinned by `eps`, then met `eps` out (a part thinner than a texel comes out a texel thick). */
export function shownWorld(w: BakeWorld, eps: number): BakeWorld {
  const m = shownCache.get(w) ?? shownCache.set(w, new Map()).get(w)!;
  const hit = m.get(eps);
  if (hit) return hit;
  const g = (h: number) => Math.max(1e-4, h - eps) + eps * 1.6;
  const out: BakeWorld = {
    capsules: (w.capsules ?? []).map((c) => ({ ...c, r: g(c.r) })),
    boxes: (w.boxes ?? []).map((b) => ({ ...b, h: [g(b.h[0] ?? 0), g(b.h[1] ?? 0), g(b.h[2] ?? 0)] })),
    wedges: (w.wedges ?? []).map((b) => ({ ...b, h: [g(b.h[0] ?? 0), g(b.h[1] ?? 0), g(b.h[2] ?? 0)] })),
  };
  m.set(eps, out);
  return out;
}

/**
 * The flags' cut rules (the dungeon sprite shader's), by a texel's true height: 0 kept, 1 cut away in this state, 2
 * too close to the cut to call (the shader cuts by the height byte).
 */
type CutAwayOptions = { sub: Subject; t: { px: number; py: number; y: number; quant: number }; cutaway: "stub" | "dither" | "off"; focus: readonly [number, number]; view: PixelView };
export function cutAway({ sub, t, cutaway, focus, view }: CutAwayOptions): 0 | 1 | 2 {
  if (!(sub.flags & 4) || cutaway === "off") return 0;
  const stands = (sub.flags & 16) !== 0;
  const hq = t.quant * Math.max(-view.axes.forward[1], 0.05) + 0.004; // (the height byte's half step, in metres)
  const vs = (line: number): 0 | 1 | 2 => (Math.abs(t.y - line) < hq ? 2 : t.y > line ? 1 : 0);
  if (cutaway === "stub") return stands ? vs(STUB) : 1;
  const hx = view.axes.forward[0], hz = view.axes.forward[2], hl = Math.hypot(hx, hz) || 1;
  const dx = sub.x - focus[0], dz = sub.z - focus[1];
  const e = [(dx * view.axes.right[0] + dz * view.axes.right[2]) / 6.5, ((dx * hx + dz * hz) / hl + 3.3) / 3.8];
  const cut = 1 - smoothstep(0.72, 1, Math.hypot(e[0]!, e[1]!));
  return cut > 0 ? vs(STUB + (1 - cut) * 3.2 + (bayer4(t.px, view.height - 1 - t.py) - 0.5) * 0.25) : 0;
}

/** A heatmap: the picture dimmed, false-hidden red, false-visible cyan (unexplained: magenta). PUT /out/<name>.png. */
interface HeatmapOptions { name: string; colour: Uint8Array; marks: Uint8Array; W: number; H: number }
export async function putHeatmap({ name, colour, marks, W, H }: HeatmapOptions): Promise<string> {
  const c = new OffscreenCanvas(W * 2, H * 2);
  const x = c.getContext("2d")!;
  const img = new ImageData(W, H);
  for (let y = 0; y < H; y += 1) for (let i = 0; i < W; i += 1) {
    const s = ((H - 1 - y) * W + i) * 4, d = (y * W + i) * 4, m = marks[y * W + i]!;
    const col = m === 1 ? [255, 40, 40] : m === 2 ? [40, 230, 255] : m === 3 ? [255, 40, 255] : [colour[s]! * 0.55, colour[s + 1]! * 0.55, colour[s + 2]! * 0.55];
    img.data[d] = col[0]!; img.data[d + 1] = col[1]!; img.data[d + 2] = col[2]!; img.data[d + 3] = 255;
  }
  const tmp = new OffscreenCanvas(W, H);
  tmp.getContext("2d")!.putImageData(img, 0, 0);
  x.imageSmoothingEnabled = false;
  x.drawImage(tmp, 0, 0, W * 2, H * 2);
  const blob = await c.convertToBlob({ type: "image/png" });
  await fetch(`/out/${name}.png`, { method: "PUT", body: blob });
  return name;
}

export interface WalkTestContext {
  S: DungeonDressing;
  T: number;
  floorAt: (i: number, j: number) => boolean;
  bodies: Array<{ kind: string; body: BodyShape; unit: number }>;
  unitLook: number[];
  painted: (look: number, slot: number) => boolean;
  px: IndexedBakeRenderer;
  R: DungeonRenderer;
  gl: WebGL2RenderingContext;
  W: number;
  H: number;
}

export async function walkTest({ bodies, floorAt, S, T, unitLook, painted, px, R, gl, W, H }: WalkTestContext): Promise<unknown> {
    const k = 24, pitch = Math.asin(0.5);
    const designs = bodies.map((b) => b.body);
    const plan = planBake(designs as never, { directions: 8, pixelsPerMetre: k, pitch, style: "occ-walk" });
    const jobs = plan.sprites.filter((j) => j.clip === "walk");
    const cache = createSpriteCache();
    cache.add(renderIndexedSprites(px, jobs, new Map(designs.map((d) => [d.key, d] as const)) as never, { heights: true }).baked);
    const atlas = cache.atlas(jobs.map((j) => j.key), { size: 4096 });
    R.setPages(atlas.pages);
    const rects = new Map<string, Rect>(), jobOf = new Map<string, SpriteJob>();
    for (const j of jobs) { const r = atlas.sprites.get(j.key); if (r) { rects.set(`${j.design}|${j.frame}|${j.direction}`, r); jobOf.set(`${j.design}|${j.frame}|${j.direction}`, j); } }
    // A path across every kind of floor there is: from each kind's cells to the next's, straight lines between cell middles.
    const kinds = new Map<string, number[]>();
    for (let q = 0; q < S.w * S.d; q += 1) {
      if (!floorAt(q % S.w, Math.floor(q / S.w)) && S.floor[q] !== FLOOR.BRIDGE) continue;
      const f = S.floor[q]!, dec = S.decor[q]!;
      const kind = S.doors.some((dr) => dr.cell === q) ? "doorway" : f === FLOOR.BRIDGE ? "bridge" : f === FLOOR.CORRIDOR ? "corridor" : S.rugs.some((r) => q % S.w >= r.i0 && q % S.w < r.i1 && Math.floor(q / S.w) >= r.j0 && Math.floor(q / S.w) < r.j1) ? "rug" : dec & 8 ? "grate" : dec & 4 ? "puddle" : dec & 2 ? "moss" : f === FLOOR.CAVE ? "cave" : "room";
      (kinds.get(kind) ?? kinds.set(kind, []).get(kind)!).push(q);
    }
    const perKind: Record<string, { frames: number; feet: number; hidden: number; hiddenBefore: number; worst: number }> = {};
    let frames = 0, feet = 0, hidden = 0, hiddenBefore = 0, worst = 0, worstBefore = 0;
    for (const [kind, cells] of kinds) {
      const rec = (perKind[kind] = { frames: 0, feet: 0, hidden: 0, hiddenBefore: 0, worst: 0 });
      for (let n = 0; n < Math.min(4, cells.length); n += 1) {
        const q = cells[Math.floor((n + 0.5) * cells.length / Math.min(4, cells.length))]!;
        const cx = (q % S.w + 0.5) * T, cz = (Math.floor(q / S.w) + 0.5) * T;
        const b = bodies[(n + frames) % bodies.length]!;
        // (Walk across the cell, a full stride cycle, one of the 8 headings.)
        const dirIdx = (n * 3 + kind.length) % 8;
        const yaw = YAW + Math.PI + (dirIdx / 8) * Math.PI * 2;
        for (let step = 0; step < 8; step += 1) {
          const s = (step / 7 - 0.5) * 1.2;
          const x = cx + Math.sin(yaw) * s, z = cz + Math.cos(yaw) * s;
          const view = viewAt({ x: cx, z: cz, pitch, k, width: W, height: H });
          const key = `${b.body.key}|${step}|${dirIdx}`;
          const r = rects.get(key)!, job = jobOf.get(key)!;
          const sub: Subject = { design: b.body.key, world: b.body.pose("walk", step), clip: "walk", frame: step, dir: dirIdx, x, z, look: unitLook[b.unit]!, flags: 0, kind: b.kind, where: kind };
          const data = new Float32Array(LIT_SPRITE_FLOATS);
          data.set([x, 0, z, r.x, r.y, r.w, r.h, r.ax, r.ay, r.page, sub.look, 0, 1, 0]);
          R.setFog(null);
          const angles = new Float32Array(S.doors.length).fill(Math.PI / 2);
          const base = { time: 0, focus: [x, z] as [number, number], cutaway: "stub" as const, fog: false, lights: false, doors: angles, sprites: { data, count: 1 } };
          R.draw(view, { ...base, debug: { surfaceDepth: true } });
          const surf = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, surf);
          R.draw(view, { ...base, debug: { ids: true } });
          const ids = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, ids);
          R.draw(view, { ...base, heights: false, debug: { ids: true } });
          const old = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, old);
          const range = (Math.max(W, H) / k) * 4;
          let fe = 0, hid = 0, hidOld = 0;
          for (const t of subjectTexels({ view, sub, r, job, page: atlas.pages[r.page]!, painted })) {
            if (Number.isNaN(t.depth) || t.y > 0.12) continue;
            const qq = ((H - 1 - t.py) * W + t.px) * 4;
            const v = (surf[qq]! << 16) | (surf[qq + 1]! << 8) | surf[qq + 2]!;
            const ts = v === 0 ? Infinity : (v / 16777215 - 0.5) * range;
            if (ts < t.depth - t.quant - 0.004) continue; // (a wall really is in front: not the floor's doing)
            fe += 1;
            if ((ids[qq]! | (ids[qq + 1]! << 8) | (ids[qq + 2]! << 16)) !== 1) hid += 1;
            if ((old[qq]! | (old[qq + 1]! << 8) | (old[qq + 2]! << 16)) !== 1) hidOld += 1;
          }
          frames += 1; feet += fe; hidden += hid; hiddenBefore += hidOld; rec.frames += 1; rec.feet += fe; rec.hidden += hid; rec.hiddenBefore += hidOld;
          if (fe && hidOld / fe > worstBefore) worstBefore = hidOld / fe;
          const share = fe ? hid / fe : 0;
          worst = Math.max(worst, share); rec.worst = Math.max(rec.worst, share);
        }
      }
    }
    return { frames, feet, hidden, share: feet ? hidden / feet : 0, worstFrame: worst, before: { hidden: hiddenBefore, share: feet ? hiddenBefore / feet : 0, worstFrame: worstBefore }, perKind };
}
