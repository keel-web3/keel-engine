// THE OCCLUSION CHECK (in the browser: it draws with WebGL2). The engine's one
// occlusion model (keel/bake depth.ts, docs/ARCHITECTURE.md "Occlusion and
// layers") judged against geometry, pixel by pixel.
//
//   subjects   every packs/dungeon prop and every packs/humans + packs/animals
//              body (walking frames, 8 facings) set against the walls, in the
//              doorways and out on the floor of a dressed dungeon -- and the
//              act's own dressing, flags and all, as the game places it
//   views      zooms (16 24 32 48 px/m) x two pitches (30 degrees, 0.7 rad)
//   states     cutaway stub / dither / off x fog visible / explored x doors
//              shut / open
//   truth      for each texel a subject shows: the point it really shows,
//              from its design's solids (keel/bake raycastWorld, the bake
//              camera's ray through that texel) -- its true height -- set on
//              the ray of the pixel it's drawn at; the surfaces' depth as the
//              dungeon renderer rasterises their geometry (walls as the
//              cutaway leaves them, doors at their angles); the flags' cut
//              rules. Whichever is nearest owns the pixel. Too close to call
//              (within the height byte's step and a few mm) is not judged.
//   judged     an ID picture: which subject each pixel shows. FALSE-HIDDEN:
//              a subject should show and doesn't; FALSE-VISIBLE: it shows
//              where something should hide it. Both with depth sprites (after)
//              and with the old card depth (before) against the same truth.
//   walk       each body walks a path across the floor's kinds (rooms,
//              corridors, rugs, grates, puddles, bridges, doorways), its feet
//              (texels under 12 cm) checked every frame.
//
//   node packages/worldgen/tools/build.mjs  ->  http://localhost:4300/packages/worldgen/tools/occlusion-check.html
//   globalThis.occlusion.run({ ks, pitches, frames }) -> { rows, totals, walk, heatmaps }

import {
  HEIGHT_STEPS, LOOKS_PER_ROW, LayerInstances, createSpriteRenderer, LOOK_TEXELS, PAINTS_PER_ROW, PALETTE_ROW, SLOTS, WORN_SLOT, bakeCamera, bakeSize, createLookTable, createSpriteCache, directionFor, dressPopulation, heightAt, paintRoles,
  paintSlots, pixelPoint, pixelView, planBake, pointDepth, populateShapes, raycastWorld, renderIndexedSprites, spriteRect, thinned,
} from "@keel-engine/bake";
import type { BakeWorld, BodyShape, IndexedBakeRenderer, LookTable, PixelView, SpriteJob } from "@keel-engine/bake";
import { cameraBasis } from "@keel-engine/core";
import { bakeDesignOf, lookFor, placeContent } from "@keel-engine/object";
import type { ContentPack, StyledBakeDesign } from "@keel-engine/object";
import { createPixelRenderer } from "@keel-engine/render";
import { FLAG, WATER_NONE, autoTile, createGpuGround, createGpuTerrain, createGroundBaker, createGroundRenderer, groundSurface, spritePosition, surfacePalette, viewAxes } from "@keel-engine/terrain";
import { randomTerrain } from "../../terrain/test/helpers.ts";
import { pack as dungeonPack } from "@keel-engine/dungeon";
import { pack as humans } from "@keel-engine/humans";
import { pack as animals } from "@keel-engine/animals";
import { CELL, DIR_X, DIR_Z, FLOOR, LIT_SPRITE_FLOATS, ROOM_TEMPLATES, buildDungeonScene, createDungeonRenderer, dressDungeon, generateDungeon } from "../src/index.ts";
import type { DungeonDressing, DungeonRenderer, DungeonScene } from "../src/index.ts";

import { add, cutAway, putHeatmap, rate, runTerrain, subjectTexels, tally, viewAt, walkTest, YAW } from "./occlusion-check-helpers.ts";
import type { Rect, Subject, Tally, TerrainCheckOptions } from "./occlusion-check-helpers.ts";
export { runTerrain };
export type { TerrainCheckOptions };

const HANGS = new Set(["torch", "banner", "chains", "roots", "cobweb"]);
const STANDS = new Set(["bookshelf", "weapon-rack", "statue", "furnace"]);
const now = (): number => performance.now();

/** One subject a frame draws: what it is, where, which sprite. */

export interface CheckOptions {
  readonly seed?: string;
  readonly act?: string;
  readonly ks?: readonly number[];
  readonly pitches?: readonly number[];
  readonly cutaways?: ReadonlyArray<"stub" | "dither" | "off">;
  readonly fogs?: ReadonlyArray<"visible" | "explored">;
  readonly doors?: ReadonlyArray<"shut" | "open">;
  /** Frames (views of rooms, each its own subjects) per zoom and pitch. */
  readonly frames?: number;
  /** Test subjects set against walls and doors per frame (besides the room's own dressing). */
  readonly subjects?: number;
  readonly width?: number;
  readonly height?: number;
  /** Heatmaps (PUT /out/occlusion-heatmap-*.png) of the first frame, each state. */
  readonly heatmaps?: boolean;
  readonly walk?: boolean;
  readonly log?: (s: string) => void;
}

interface WallDoorSpot { x: number; z: number; where: string }
interface CheckTexel { px: number; py: number; y: number; depth: number; quant: number; gy: number }
interface CheckStats {
  rows: unknown[];
  totals: { before: Tally; after: Tally };
  byState: Map<string, { before: Tally; after: Tally }>;
  byWhere: Map<string, { before: Tally; after: Tally }>;
  heatmaps: string[];
  cases: unknown[];
  why: { surface: number; subjects: number; edge: number };
}
interface StateCheckContext {
  R: DungeonRenderer;
  gl: WebGL2RenderingContext;
  o: CheckOptions;
  S: DungeonDressing;
  view: PixelView;
  W: number;
  H: number;
  k: number;
  pitch: number;
  f: number;
  fx: number;
  fz: number;
  subjects: Subject[];
  texels: CheckTexel[][];
  spr: { data: Float32Array; count: number };
  stats: CheckStats;
}

async function checkFrameStates({ R, gl, o, S, view, W, H, k, pitch, f, fx, fz, subjects, texels, spr, stats }: StateCheckContext): Promise<void> {
  const { totals, byState, byWhere, rows, heatmaps, cases, why } = stats;
  for (const cutaway of o.cutaways ?? ["stub", "dither", "off"] as const) for (const fog of o.fogs ?? ["visible", "explored"] as const) for (const doors of o.doors ?? ["shut", "open"] as const) {
    const state = `${cutaway}/${fog}/${doors}`;
    R.setFog(fog === "explored" ? new Uint8Array(S.w * S.d).fill(100) : null);
    const angles = new Float32Array(S.doors.length).fill(doors === "open" ? Math.PI / 2 : 0);
    const base = { time: 0, focus: [fx, fz] as [number, number], cutaway, fog: fog === "explored", lights: false, doors: angles, sprites: spr } as const;
    const read = (): Uint8Array => { const a = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, a); return a; };
    R.draw(view, { ...base, debug: { surfaceDepth: true } });
    const surf = read();
    R.draw(view, { ...base, debug: { ids: true } });
    const after = read();
    R.draw(view, { ...base, heights: false, debug: { ids: true } });
    const before = read();
    const range = (Math.max(W, H) / k) * 4;
    const surfaceAt = (x: number, y: number): number => { const q = ((H - 1 - y) * W + x) * 4; const v = (surf[q]! << 16) | (surf[q + 1]! << 8) | surf[q + 2]!; return v === 0 ? Infinity : (v / 16777215 - 0.5) * range; };
    const idAt = (a: Uint8Array, x: number, y: number): number => { const q = ((H - 1 - y) * W + x) * 4; return (a[q]! | (a[q + 1]! << 8) | (a[q + 2]! << 16)) - 1; };
    const cand = new Map<number, Array<{ i: number; depth: number; tol: number }>>();
    const texAt = (i: number, q: number): number => texels[i]!.find((t) => t.py * W + t.px === q)?.y ?? NaN;
    const gpuAt = (i: number, q: number): number => texels[i]!.find((t) => t.py * W + t.px === q)?.gy ?? NaN;
    const edge = new Set<number>();
    subjects.forEach((sub, i) => {
      for (const t of texels[i]!) {
        const q = t.py * W + t.px;
        if (Number.isNaN(t.depth)) { edge.add(q); continue; }
        const cutState = cutAway({ sub, t, cutaway, focus: [fx, fz], view });
        if (cutState === 2) { edge.add(q); continue; }
        if (cutState === 1) continue;
        (cand.get(q) ?? cand.set(q, []).get(q)!).push({ i, depth: t.depth, tol: t.quant });
      }
    });
    const tb = tally(), ta = tally();
    const whereT = new Map<string, { before: Tally; after: Tally }>();
    const hm = o.heatmaps && f === 0 ? { before: new Uint8Array(W * H), after: new Uint8Array(W * H) } : null;
    for (const [q, list] of cand) {
      const x = q % W, y = Math.floor(q / W);
      const ts = surfaceAt(x, y);
      list.sort((a, b) => a.depth - b.depth);
      const best = list[0]!, second = list[1];
      const tol = best.tol + 0.004;
      const tieS = Math.abs(ts - best.depth) < tol, tieO = second !== undefined && second.depth - best.depth < best.tol + second.tol + 0.004, onEdge = edge.has(q);
      const close = tieS || tieO || onEdge;
      if (close) { why[tieS ? "surface" : tieO ? "subjects" : "edge"] += 1; }
      const expect = ts < best.depth ? -1 : best.i;
      const w = subjects[best.i]!.where;
      const wt = whereT.get(w) ?? whereT.set(w, { before: tally(), after: tally() }).get(w)!;
      for (const [which, pic, T2] of [["before", before, tb], ["after", after, ta]] as const) {
        const g = idAt(pic, x, y);
        const WT = wt[which];
        if (close) { T2.unjudged += 1; WT.unjudged += 1; continue; }
        if (expect >= 0) { T2.subject += 1; WT.subject += 1; }
        if (g >= 0) { T2.shown += 1; WT.shown += 1; }
        if (expect >= 0 && g !== expect) {
          T2.falseHidden += 1; WT.falseHidden += 1; if (hm) hm[which][q] = 1;
          if (which === "after" && cases.length < 400) cases.push({ k, state, x, y, kind: subjects[best.i]!.kind, where: w, by: g >= 0 ? subjects[g]!.kind : "surface", y0: +texAt(best.i, q).toFixed(3), gy: +gpuAt(best.i, q).toFixed(3), d: +best.depth.toFixed(3), ts: +ts.toFixed(3), tol: +tol.toFixed(3), other: second ? +second.depth.toFixed(3) : null });
        }
        else if (g >= 0 && g !== expect) {
          T2.falseVisible += 1; WT.falseVisible += 1; if (hm) hm[which][q] = 2;
          if (which === "after" && cases.length < 400) cases.push({ k, state, x, y, fv: true, kind: subjects[g]!.kind, over: expect >= 0 ? subjects[expect]!.kind : "surface", d: +best.depth.toFixed(3), ts: +ts.toFixed(3), tol: +tol.toFixed(3) });
        }
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
    const st = byState.get(state) ?? byState.set(state, { before: tally(), after: tally() }).get(state)!;
    add(st.before, tb); add(st.after, ta);
    for (const [w, v] of whereT) { const bw = byWhere.get(w) ?? byWhere.set(w, { before: tally(), after: tally() }).get(w)!; add(bw.before, v.before); add(bw.after, v.after); }
    rows.push({ k, pitch: +pitch.toFixed(3), frame: f, state, subjects: subjects.length, before: { ...tb, ...rate(tb) }, after: { ...ta, ...rate(ta) } });
    if (hm) {
      R.draw(view, { ...base, lights: true });
      const colour = read();
      for (const which of ["before", "after"] as const) heatmaps.push(await putHeatmap({ name: `occlusion-heatmap-${which}-k${k}-p${Math.round(pitch * 100)}-${state.replaceAll("/", "-")}`, colour, marks: hm[which], W, H }));
    }
  }
}

function prepareDungeon(seed: string, act: string, R: DungeonRenderer, log: (s: string) => void) {
  const D = generateDungeon(seed, 56, 44, { algorithm: "rooms", rooms: 9, templates: ROOM_TEMPLATES });
  const S: DungeonDressing = dressDungeon(D, act, { seed, density: 1.2 });
  const scene: DungeonScene = buildDungeonScene(S);
  R.setScene(scene, S);
  const T = S.tile;

  const PACKS: readonly ContentPack[] = [dungeonPack];
  const props = new Map<string, StyledBakeDesign & { id: string }>();
  const propDesign = (id: string, pins: Readonly<Record<string, string | number | boolean>>, n: number) => {
    const key = `${id}|${JSON.stringify(pins)}|${n % 3}`;
    let d = props.get(key);
    if (!d) { const placed = placeContent(PACKS, { pack: "packs/dungeon", id, seed: key, style: "pixel", pins: { ...pins } }); d = Object.assign(bakeDesignOf(placed.built), { id, built: placed.built }); props.set(key, d); }
    return d;
  };
  const allProps = dungeonPack.objects.map((def) => def.id);
  for (const id of allProps) propDesign(id, {}, 0);
  for (const p of S.props) propDesign(p.id, p.pins, p.seed);
  const entities = [...humans.entities.map((def) => ({ def, pack: "packs/humans" })), ...animals.entities.map((def) => ({ def, pack: "packs/animals" }))];
  const clipsFor = () => [{ name: "idle", frames: 1, loop: true }, { name: "walk", frames: 8, loop: true }];
  const shapesP = populateShapes({
    seed: `occ:${seed}`, count: entities.length, entities: entities.map((e) => ({ def: e.def as never, pack: e.pack, shapes: 1, weight: 1 })), attributes: [], shapes: 1, wear: [0, 0], clipsFor,
    pins: new Map(entities.map((e, i) => [i, { body: { entity: e.def.id } }])) as never,
  });
  const pop = dressPopulation(shapesP);
  const bodies: Array<{ kind: string; body: BodyShape; unit: number }> = pop.units.map((u, i) => ({ kind: entities[i]!.def.id, body: pop.bodies[u.body]!, unit: i }));

  let table: LookTable = createLookTable({ rampLength: 5 });
  const profile = dungeonPack.profile(S.theme.profile);
  const propLook = new Map<string, number>();
  for (const [key, d] of props) propLook.set(key, table.add(paintRoles(lookFor((d as unknown as { built: never }).built, `${key}#${S.theme.id}`, profile ? { profile } : {}))));
  const unitLook = pop.units.map((u) => table.add(paintSlots(u.look, pop.bodies[u.body]!.slotRoles(u.coverage), u.wornLook, WORN_SLOT)));
  const lookTex = table.texture();
  const painted = (look: number, slot: number): boolean => {
    const x = (look % LOOKS_PER_ROW) * LOOK_TEXELS + (slot >> 2), y = Math.floor(look / LOOKS_PER_ROW);
    return lookTex.data[(y * lookTex.width + x) * 4 + (slot & 3)] !== 0;
  };
  R.setLooks({ palette: table.palette(), paints: table.paintTexture(), looks: lookTex });

  const floorAt = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < S.w && j < S.d && S.cells[j * S.w + i] !== CELL.WALL && S.floor[j * S.w + i] !== FLOOR.PIT && S.floor[j * S.w + i] !== FLOOR.WATER && S.floor[j * S.w + i] !== FLOOR.LAVA && S.floor[j * S.w + i] !== FLOOR.STAIRS_DOWN && S.floor[j * S.w + i] !== FLOOR.STAIRS_UP;
  const wallAt = (i: number, j: number): boolean => i < 0 || j < 0 || i >= S.w || j >= S.d || S.cells[j * S.w + i] === CELL.WALL;
  const spots: WallDoorSpot[] = [];
  for (let j = 0; j < S.d; j += 1) for (let i = 0; i < S.w; i += 1) {
    if (!floorAt(i, j)) continue;
    const cx = (i + 0.5) * T, cz = (j + 0.5) * T;
    for (let dir = 0; dir < 4; dir += 1) if (wallAt(i + DIR_X[dir]!, j + DIR_Z[dir]!)) spots.push({ x: cx + DIR_X[dir]! * 0.45, z: cz + DIR_Z[dir]! * 0.45, where: dir >= 2 ? "front-wall" : "back-wall" });
  }
  for (const dr of S.doors) { const i = dr.cell % S.w, j = Math.floor(dr.cell / S.w); for (const s of [-0.75, 0, 0.75]) { const along = dr.axis === 0 ? [s, 0] : [0, s]; spots.push({ x: (i + 0.5) * T + along[0]!, z: (j + 0.5) * T + along[1]!, where: "door" }); } }
  log(`dungeon ${S.w}x${S.d}: ${S.rooms.length} rooms, ${S.doors.length} doors, ${S.props.length} props dressed; ${spots.length} wall and door spots; ${props.size} prop designs, ${bodies.length} bodies`);

  let rs = 1234567;
  const rnd = (): number => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  return { S, T, props, propDesign, allProps, bodies, propLook, unitLook, painted, floorAt, spots, rnd };
}

export async function run(canvas: HTMLCanvasElement, o: CheckOptions = {}): Promise<unknown> {
  const log = o.log ?? ((s: string) => console.log(s));
  const W = o.width ?? 480, H = o.height ?? 270;
  canvas.width = W; canvas.height = H;
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: true, preserveDrawingBuffer: true })!;
  const bakeCanvas = new OffscreenCanvas(64, 64);
  const px = createPixelRenderer(bakeCanvas as never, { width: 64, height: 64 }) as unknown as IndexedBakeRenderer;
  const R: DungeonRenderer = createDungeonRenderer(gl, { looks: { slots: SLOTS, looksPerRow: LOOKS_PER_ROW, lookTexels: LOOK_TEXELS, paintsPerRow: PAINTS_PER_ROW, paletteRow: PALETTE_ROW } });
  const seed = o.seed ?? "occlusion-1";
  const { S, T, props, propDesign, allProps, bodies, propLook, unitLook, painted, floorAt, spots, rnd } = prepareDungeon(seed, o.act ?? "crypt", R, log);

  const stats: CheckStats = {
    rows: [], totals: { before: tally(), after: tally() }, byState: new Map(), byWhere: new Map(), heatmaps: [], cases: [], why: { surface: 0, subjects: 0, edge: 0 },
  };
  const { rows, totals, byState, byWhere, heatmaps, cases, why } = stats;
  let bakeMsAll = 0, sprites = 0, clampedTexels = 0, allTexels = 0;

  for (const pitch of o.pitches ?? [Math.asin(0.5), 0.7]) for (const k of o.ks ?? [16, 24, 32, 48]) {
    // ---------------------------------------------------------------- bake at this scale and pitch (heights on)
    const t0 = now();
    const designs = [...props.values(), ...bodies.map((b) => b.body)];
    const plan = planBake(designs as never, { directions: 8, pixelsPerMetre: k, pitch, style: "occ" });
    const jobs = plan.sprites.filter((j) => j.clip === "still" || j.clip === "walk" || (j.clip === "idle" && j.frame === 0));
    const sources = new Map<string, unknown>(designs.map((d) => [d.key, d] as const));
    const cache = createSpriteCache();
    cache.add(renderIndexedSprites(px, jobs, sources as never, { heights: true }).baked);
    const atlas = cache.atlas(jobs.map((j) => j.key), { size: 4096 });
    R.setPages(atlas.pages);
    const bakeMs = now() - t0;
    bakeMsAll += bakeMs; sprites += jobs.length;
    const rects = new Map<string, Rect>();
    const jobOf = new Map<string, SpriteJob>();
    for (const j of jobs) { const r = atlas.sprites.get(j.key); if (r) { rects.set(`${j.design}|${j.clip}|${j.frame}|${j.direction}`, r); jobOf.set(`${j.design}|${j.clip}|${j.frame}|${j.direction}`, j); } }
    for (const p of atlas.pages) if (p.heights) for (let q = 0; q < p.width * p.height; q += 1) { const hv = heightAt(p.heights, q); if (hv) { allTexels += 1; if (hv === 65535) clampedTexels += 1; } }
    log(`k ${k} pitch ${pitch.toFixed(3)}: baked ${jobs.length} sprites with heights in ${bakeMs.toFixed(0)} ms (${atlas.pages.length} pages)`);

    for (let f = 0; f < (o.frames ?? 2); f += 1) {
      // ---------------------------------------------------------------- a frame: a room, its dressing, test subjects
      const room = S.rooms[(f * 5 + Math.round(k) + Math.round(pitch * 10)) % S.rooms.length]!;
      const c = room.cells[Math.floor(room.cells.length / 2)]!;
      const fx = (c % S.w + 0.5) * T, fz = (Math.floor(c / S.w) + 0.5) * T;
      const view = viewAt({ x: fx, z: fz, pitch, k, width: W, height: H });
      const inView = (x: number, z: number, m = 24): boolean => { const p = view.project([x, 0, z]); return p[0] > m && p[0] < W - m && p[1] > m * 2 && p[1] < H - m / 2; };
      const subjects: Subject[] = [];
      S.props.forEach((p) => {
        if (!inView(p.x, p.z, 0)) return;
        const d = propDesign(p.id, p.pins, p.seed);
        const dir = d.symmetric ? 0 : directionFor(p.yaw, YAW, 8);
        const front = p.wall === 2 || p.wall === 3;
        subjects.push({ design: d.key, world: d.pose("still", 0), clip: "still", frame: 0, dir, x: p.x, z: p.z, look: propLook.get(`${p.id}|${JSON.stringify(p.pins)}|${p.seed % 3}`)!, flags: front && HANGS.has(p.id) ? 4 : front && STANDS.has(p.id) ? 20 : 0, kind: p.id, where: "dressing" });
      });
      const near = spots.filter((s) => inView(s.x, s.z));
      // (Each spot once a frame: two things on one spot would tie everywhere.)
      for (let n = near.length - 1; n > 0; n -= 1) { const m = Math.floor(rnd() * (n + 1)); [near[n], near[m]] = [near[m]!, near[n]!]; }
      for (let n = 0; n < Math.min(o.subjects ?? 28, near.length); n += 1) {
        const s = near[n]!;
        const dir = Math.floor(rnd() * 8);
        if (rnd() < 0.5) {
          const b = bodies[Math.floor(rnd() * bodies.length)]!;
          const frame = Math.floor(rnd() * 8);
          subjects.push({ design: b.body.key, world: b.body.pose("walk", frame), clip: "walk", frame, dir, x: s.x + (rnd() - 0.5) * 0.3, z: s.z + (rnd() - 0.5) * 0.3, look: unitLook[b.unit]!, flags: 0, kind: b.kind, where: s.where });
        } else {
          const id = allProps[Math.floor(rnd() * allProps.length)]!;
          if (HANGS.has(id) || STANDS.has(id)) { if (s.where !== "front-wall") continue; }
          const d = propDesign(id, {}, 0);
          subjects.push({ design: d.key, world: d.pose("still", 0), clip: "still", frame: 0, dir: d.symmetric ? 0 : dir, x: s.x, z: s.z, look: propLook.get(`${id}|{}|0`)!, flags: s.where === "front-wall" && HANGS.has(id) ? 4 : s.where === "front-wall" && STANDS.has(id) ? 20 : 0, kind: id, where: s.where });
        }
      }
      // The instances, and each subject's texels: the point each shows (its true height), the pixel it's drawn at.
      const data = new Float32Array(Math.max(1, subjects.length) * LIT_SPRITE_FLOATS);
      const texels: CheckTexel[][] = [];
      const pages = atlas.pages;
      subjects.forEach((sub, i) => {
        const key = `${sub.design}|${sub.clip}|${sub.frame}|${sub.dir}`;
        const r = rects.get(key)!, job = jobOf.get(key)!;
        data.set([sub.x, 0, sub.z, r.x, r.y, r.w, r.h, r.ax, r.ay, r.page, sub.look, sub.flags, 1, 0], i * LIT_SPRITE_FLOATS);
        texels.push(subjectTexels({ view, sub, r, job, page: pages[r.page]!, painted }));
      });
      const spr = { data, count: subjects.length };

      await checkFrameStates({ R, gl, o, S, view, W, H, k, pitch, f, fx, fz, subjects, texels, spr, stats });
    }
  }
  const out = {
    totals: { before: { ...totals.before, ...rate(totals.before) }, after: { ...totals.after, ...rate(totals.after) } },
    byState: Object.fromEntries([...byState].map(([k2, v]) => [k2, { before: rate(v.before), after: rate(v.after), subject: v.after.subject, unjudged: v.after.unjudged }])),
    byWhere: Object.fromEntries([...byWhere].map(([k2, v]) => [k2, { before: rate(v.before), after: rate(v.after), subject: v.after.subject }])),
    bake: { ms: +bakeMsAll.toFixed(0), sprites, heightTexels: allTexels, clamped: clampedTexels },
    rows, heatmaps, cases, unjudgedWhy: why,
    walk: o.walk === false ? null : await walkTest({ S, T, floorAt, bodies, unitLook, painted, px, R, gl, W, H }),
  };
  return out;
}

// ---------------------------------------------------------------- the cost

/**
 * What depth sprites cost a frame: `units` walking bodies (every humans and animals body, 8 facings, their walk)
 * over keel/terrain's GPU ground at 1920 x 1080, drawn by the layer renderer with heights and without, each frame
 * waited for on the GPU. Also the height planes' bytes against the colour pages'.
 */
export async function bench(canvas: HTMLCanvasElement, { units = [2000, 4000], ks = [8, 24, 48], frames = 90, width = 1920, height = 1080 }: { units?: readonly number[]; ks?: readonly number[]; frames?: number; width?: number; height?: number } = {}): Promise<unknown> {
  const W = width, H = height;
  const sr = createSpriteRenderer(canvas, { width: W, height: H, capacity: 1 << 14 });
  sr.setTarget(W, H);
  const gl = sr.gl;
  const t = randomTerrain(22, 160, 160, { chunk: 32, ramps: 60 });
  const biomes = [{ name: "meadow" }];
  const palette = surfacePalette(t.types, biomes);
  const surface = groundSurface({ biomes, biome: new Uint8Array(160 * 160) });
  const gpu = createGpuGround(gl, { palette, seed: 1 });
  const gT = createGpuTerrain(gpu, { terrain: t, auto: autoTile(t, { seed: 1 }), surface, prefetch: 0, seed: 1 });
  gT.preload();
  const entities = [...humans.entities.map((def) => ({ def, pack: "packs/humans" })), ...animals.entities.map((def) => ({ def, pack: "packs/animals" }))];
  const pop = dressPopulation(populateShapes({ seed: "occ-b", count: entities.length, entities: entities.map((e) => ({ def: e.def as never, pack: e.pack, shapes: 1, weight: 1 })), attributes: [], shapes: 1, wear: [0, 0], clipsFor: () => [{ name: "walk", frames: 8, loop: true }], pins: new Map(entities.map((e, i) => [i, { body: { entity: e.def.id } }])) as never }));
  const table = createLookTable({ rampLength: 5 });
  const look = pop.units.map((u) => table.add(paintSlots(u.look, pop.bodies[u.body]!.slotRoles(u.coverage), u.wornLook, WORN_SLOT)));
  sr.setLooks({ palette: table.palette(), paints: table.paintTexture(), looks: table.texture() });
  const px = createPixelRenderer(new OffscreenCanvas(64, 64) as never, { width: 64, height: 64 }) as unknown as IndexedBakeRenderer;
  const pixel = new Uint8Array(4);
  const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  const out: unknown[] = [];
  let rs = 4242;
  const rnd = (): number => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  for (const k of ks) {
    const pitch = 0.6;
    const plan = planBake(pop.bodies as never, { directions: 8, pixelsPerMetre: k, pitch, style: "occ-b" });
    const cache = createSpriteCache();
    const b0 = performance.now();
    cache.add(renderIndexedSprites(px, plan.sprites, new Map(pop.bodies.map((d) => [d.key, d] as const)) as never, { heights: false }).baked);
    const plainMs = performance.now() - b0;
    const cacheH = createSpriteCache();
    const b1 = performance.now();
    cacheH.add(renderIndexedSprites(px, plan.sprites, new Map(pop.bodies.map((d) => [d.key, d] as const)) as never, { heights: true }).baked);
    const heightMs = performance.now() - b1;
    const atlas = cacheH.atlas(plan.sprites.map((j) => j.key), { size: 4096 });
    sr.setPages(atlas.pages);
    const colourBytes = atlas.pages.reduce((n, p) => n + p.width * p.height * 4, 0);
    const view = viewAt({ x: 160, z: 160, pitch, k, width: W, height: H, yaw: 0 });
    const a = viewAxes({ yaw: 0, pitch, pixelsPerMetre: k });
    const [x0, z0, x1, z1] = view.groundRect(2);
    for (const n of units) {
      const insts = new LayerInstances(n);
      for (let u = 0; u < n; u += 1) {
        const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0), who = Math.floor(rnd() * pop.units.length);
        const j = plan.sprites.find((q) => q.design === pop.bodies[pop.units[who]!.body]!.key && q.frame === Math.floor(rnd() * 8) && q.direction === Math.floor(rnd() * 8)) ?? plan.sprites[0]!;
        const r = atlas.sprites.get(j.key)!;
        const p = spritePosition(a, [x, t.heightAt(x, z), z]);
        insts.push(p[0], p[1], p[2], r.x, r.y, r.w, r.h, r.ax, r.ay, r.page, look[who]!, 0, 1);
      }
      const time = (heights: boolean): { median: number; p95: number } => {
        const ts: number[] = [];
        for (let f = 0; f < frames + 10; f += 1) {
          const f0 = performance.now();
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gpu.draw(view, { clear: [0, 0, 0], keys: gT.plan(view) });
          sr.drawLayers(view, insts, { clear: null, heights });
          finish();
          if (f >= 10) ts.push(performance.now() - f0);
        }
        ts.sort((p1, p2) => p1 - p2);
        return { median: +ts[ts.length >> 1]!.toFixed(2), p95: +ts[Math.floor(ts.length * 0.95)]!.toFixed(2) };
      };
      const off = time(false), on = time(true), off2 = time(false), on2 = time(true);
      out.push({ k, units: n, sprites: plan.sprites.length, heightsOff: [off, off2], heightsOn: [on, on2], bakeMs: { plain: Math.round(plainMs), heights: Math.round(heightMs) }, colourMB: +(colourBytes / 1048576).toFixed(2), heightMB: +(sr.heightBytes / 1048576).toFixed(2) });
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return out;
}
