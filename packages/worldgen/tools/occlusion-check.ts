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

const YAW = Math.PI / 4;
const HANGS = new Set(["torch", "banner", "chains", "roots", "cobweb"]);
const STANDS = new Set(["bookshelf", "weapon-rack", "statue", "furnace"]);
const STUB = 0.7;
const now = (): number => performance.now();

/** One subject a frame draws: what it is, where, which sprite. */
interface Subject {
  readonly design: string;          // (the bake design's key)
  readonly world: BakeWorld;        // (its solids at the frame drawn, in its own frame)
  readonly clip: string;
  readonly frame: number;
  readonly dir: number;
  readonly x: number;
  readonly z: number;
  readonly look: number;
  readonly flags: number;
  readonly kind: string;            // (prop id or body entity)
  readonly where: string;           // (front-wall, back-wall, door, open, dressing)
}
interface Rect { x: number; y: number; w: number; h: number; ax: number; ay: number; page: number }
interface Tally { subject: number; shown: number; falseHidden: number; falseVisible: number; unjudged: number; edge: number }
const tally = (): Tally => ({ subject: 0, shown: 0, falseHidden: 0, falseVisible: 0, unjudged: 0, edge: 0 });
const add = (a: Tally, b: Tally): void => { a.subject += b.subject; a.shown += b.shown; a.falseHidden += b.falseHidden; a.falseVisible += b.falseVisible; a.unjudged += b.unjudged; a.edge += b.edge; };
const rate = (t: Tally) => ({ falseHidden: t.subject ? t.falseHidden / t.subject : 0, falseVisible: t.shown ? t.falseVisible / t.shown : 0 });

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

const bayer4 = (x: number, y: number): number => { const m = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]; return (m[(y & 3) * 4 + (x & 3)]! + 0.5) / 16; };
const smoothstep = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export async function run(canvas: HTMLCanvasElement, o: CheckOptions = {}): Promise<unknown> {
  const log = o.log ?? ((s: string) => console.log(s));
  const W = o.width ?? 480, H = o.height ?? 270;
  canvas.width = W; canvas.height = H;
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: true, preserveDrawingBuffer: true })!;
  const bakeCanvas = new OffscreenCanvas(64, 64);
  const px = createPixelRenderer(bakeCanvas as never, { width: 64, height: 64 }) as unknown as IndexedBakeRenderer;
  const R: DungeonRenderer = createDungeonRenderer(gl, { looks: { slots: SLOTS, looksPerRow: LOOKS_PER_ROW, lookTexels: LOOK_TEXELS, paintsPerRow: PAINTS_PER_ROW, paletteRow: PALETTE_ROW } });
  const seed = o.seed ?? "occlusion-1";
  const D = generateDungeon(seed, 56, 44, { algorithm: "rooms", rooms: 9, templates: ROOM_TEMPLATES });
  const S: DungeonDressing = dressDungeon(D, o.act ?? "crypt", { seed, density: 1.2 });
  const scene: DungeonScene = buildDungeonScene(S);
  R.setScene(scene, S);
  const T = S.tile;

  // ---------------------------------------------------------------- the subjects' designs
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
  // Bodies: one of every humans and animals entity (their walk and idle).
  const entities = [...humans.entities.map((def) => ({ def, pack: "packs/humans" })), ...animals.entities.map((def) => ({ def, pack: "packs/animals" }))];
  const clipsFor = () => [{ name: "idle", frames: 1, loop: true }, { name: "walk", frames: 8, loop: true }];
  const shapesP = populateShapes({
    seed: `occ:${seed}`, count: entities.length, entities: entities.map((e) => ({ def: e.def as never, pack: e.pack, shapes: 1, weight: 1 })), attributes: [], shapes: 1, wear: [0, 0], clipsFor,
    pins: new Map(entities.map((e, i) => [i, { body: { entity: e.def.id } }])) as never,
  });
  const pop = dressPopulation(shapesP);
  const bodies: Array<{ kind: string; body: BodyShape; unit: number }> = pop.units.map((u, i) => ({ kind: entities[i]!.def.id, body: pop.bodies[u.body]!, unit: i }));

  // Looks: every slot painted (what the id picture needs: an unpainted slot is dropped by the shader).
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

  // ---------------------------------------------------------------- spots against walls and doors
  const floorAt = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < S.w && j < S.d && S.cells[j * S.w + i] !== CELL.WALL && S.floor[j * S.w + i] !== FLOOR.PIT && S.floor[j * S.w + i] !== FLOOR.WATER && S.floor[j * S.w + i] !== FLOOR.LAVA && S.floor[j * S.w + i] !== FLOOR.STAIRS_DOWN && S.floor[j * S.w + i] !== FLOOR.STAIRS_UP;
  const wallAt = (i: number, j: number): boolean => i < 0 || j < 0 || i >= S.w || j >= S.d || S.cells[j * S.w + i] === CELL.WALL;
  interface Spot { x: number; z: number; where: string }
  const spots: Spot[] = [];
  for (let j = 0; j < S.d; j += 1) for (let i = 0; i < S.w; i += 1) {
    if (!floorAt(i, j)) continue;
    const cx = (i + 0.5) * T, cz = (j + 0.5) * T;
    for (let dir = 0; dir < 4; dir += 1) if (wallAt(i + DIR_X[dir]!, j + DIR_Z[dir]!)) spots.push({ x: cx + DIR_X[dir]! * 0.45, z: cz + DIR_Z[dir]! * 0.45, where: dir >= 2 ? "front-wall" : "back-wall" });
  }
  for (const dr of S.doors) { const i = dr.cell % S.w, j = Math.floor(dr.cell / S.w); for (const s of [-0.75, 0, 0.75]) { const along = dr.axis === 0 ? [s, 0] : [0, s]; spots.push({ x: (i + 0.5) * T + along[0]!, z: (j + 0.5) * T + along[1]!, where: "door" }); } }
  log(`dungeon ${S.w}x${S.d}: ${S.rooms.length} rooms, ${S.doors.length} doors, ${S.props.length} props dressed; ${spots.length} wall and door spots; ${props.size} prop designs, ${bodies.length} bodies`);

  // A seeded stream for the choices.
  let rs = 1234567;
  const rnd = (): number => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };

  const rows: unknown[] = [];
  const totals = { before: tally(), after: tally() };
  const byState = new Map<string, { before: Tally; after: Tally }>();
  const byWhere = new Map<string, { before: Tally; after: Tally }>();
  const heatmaps: string[] = [];
  const cases: unknown[] = [];
  const why = { surface: 0, subjects: 0, edge: 0 };
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
      const view = viewAt(fx, fz, pitch, k, W, H);
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
      interface Tx { px: number; py: number; y: number; depth: number; quant: number; gy: number }
      const texels: Tx[][] = [];
      const pages = atlas.pages;
      subjects.forEach((sub, i) => {
        const key = `${sub.design}|${sub.clip}|${sub.frame}|${sub.dir}`;
        const r = rects.get(key)!, job = jobOf.get(key)!;
        data.set([sub.x, 0, sub.z, r.x, r.y, r.w, r.h, r.ax, r.ay, r.page, sub.look, sub.flags, 1, 0], i * LIT_SPRITE_FLOATS);
        texels.push(subjectTexels(view, sub, r, job, pages[r.page]!, painted));
      });
      const spr = { data, count: subjects.length };

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
        // Who should own each pixel: the nearest of the surface there and every subject's texel drawn there.
        const cand = new Map<number, Array<{ i: number; depth: number; tol: number }>>();
        const texAt = (i: number, q: number): number => texels[i]!.find((t) => t.py * W + t.px === q)?.y ?? NaN;
        const gpuAt = (i: number, q: number): number => texels[i]!.find((t) => t.py * W + t.px === q)?.gy ?? NaN;
        const edge = new Set<number>();
        subjects.forEach((sub, i) => {
          for (const t of texels[i]!) {
            const q = t.py * W + t.px;
            if (Number.isNaN(t.depth)) { edge.add(q); continue; }
            const cutState = cutAway(sub, t, cutaway, fx, fz, view, H);
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
          // (Too close to call: the surface or another subject within the height step and a few mm.)
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
        // (Pixels a subject shows where no texel of it should be at all: false-visible too.)
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
          for (const which of ["before", "after"] as const) heatmaps.push(await putHeatmap(`occlusion-heatmap-${which}-k${k}-p${Math.round(pitch * 100)}-${state.replaceAll("/", "-")}`, colour, hm[which], W, H));
        }
      }
    }
  }
  const out = {
    totals: { before: { ...totals.before, ...rate(totals.before) }, after: { ...totals.after, ...rate(totals.after) } },
    byState: Object.fromEntries([...byState].map(([k2, v]) => [k2, { before: rate(v.before), after: rate(v.after), subject: v.after.subject, unjudged: v.after.unjudged }])),
    byWhere: Object.fromEntries([...byWhere].map(([k2, v]) => [k2, { before: rate(v.before), after: rate(v.after), subject: v.after.subject }])),
    bake: { ms: +bakeMsAll.toFixed(0), sprites, heightTexels: allTexels, clamped: clampedTexels },
    rows, heatmaps, cases, unjudgedWhy: why,
    walk: o.walk === false ? null : await walkTest(),
  };
  return out;

  // ---------------------------------------------------------------- the walk test
  async function walkTest(): Promise<unknown> {
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
          const view = viewAt(cx, cz, pitch, k, W, H);
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
          for (const t of subjectTexels(view, sub, r, job, atlas.pages[r.page]!, painted)) {
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
}

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
export async function runTerrain(canvas: HTMLCanvasElement, o: TerrainCheckOptions = {}): Promise<unknown> {
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
      const view = viewAt(c0.x, c0.z, pitch, k, W, H, yaw);
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
        return subjectTexels(view, sub, r, job, atlas.pages[r.page]!, painted, sub.y, "ground");
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
      if (hm && colourShot) for (const which of ["before", "after"] as const) heatmaps.push(await putHeatmap(`occlusion-terrain-heatmap-${which}-k${k}-p${Math.round(pitch * 100)}-y${Math.round(yaw * 100)}`, colourShot, hm[which], W, H));
    }
    log(`terrain yaw ${yaw.toFixed(2)} pitch ${pitch} k ${k}: after ${JSON.stringify(rate(totals.after))}`);
  }
  return {
    totals: { before: { ...totals.before, ...rate(totals.before) }, after: { ...totals.after, ...rate(totals.after) } },
    byWhere: Object.fromEntries([...byWhere].map(([k2, v]) => [k2, { before: rate(v.before), after: rate(v.after), subject: v.after.subject }])),
    rows, heatmaps,
  };
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
    const view = viewAt(160, 160, pitch, k, W, H, 0);
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

/** The demo's view: yaw 45 degrees (or `yaw`), the centre snapped to whole pixels (as the crawl's). */
function viewAt(x: number, z: number, pitch: number, k: number, W: number, H: number, yaw = YAW): PixelView {
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
function subjectTexels(view: PixelView, sub: Subject, r: Rect, job: SpriteJob, page: { width: number; rgba: Uint8Array; heights?: Uint8Array | undefined }, painted: (look: number, slot: number) => boolean, ground = 0, axis: "view" | "ground" = "view"): Array<{ px: number; py: number; y: number; depth: number; quant: number; gy: number }> {
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
function shownWorld(w: BakeWorld, eps: number): BakeWorld {
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
function cutAway(sub: Subject, t: { px: number; py: number; y: number; quant: number }, cutaway: "stub" | "dither" | "off", fx: number, fz: number, view: PixelView, H: number): 0 | 1 | 2 {
  if (!(sub.flags & 4) || cutaway === "off") return 0;
  const stands = (sub.flags & 16) !== 0;
  const hq = t.quant * Math.max(-view.axes.forward[1], 0.05) + 0.004; // (the height byte's half step, in metres)
  const vs = (line: number): 0 | 1 | 2 => (Math.abs(t.y - line) < hq ? 2 : t.y > line ? 1 : 0);
  if (cutaway === "stub") return stands ? vs(STUB) : 1;
  const hx = view.axes.forward[0], hz = view.axes.forward[2], hl = Math.hypot(hx, hz) || 1;
  const dx = sub.x - fx, dz = sub.z - fz;
  const e = [(dx * view.axes.right[0] + dz * view.axes.right[2]) / 6.5, ((dx * hx + dz * hz) / hl + 3.3) / 3.8];
  const cut = 1 - smoothstep(0.72, 1, Math.hypot(e[0]!, e[1]!));
  return cut > 0 ? vs(STUB + (1 - cut) * 3.2 + (bayer4(t.px, H - 1 - t.py) - 0.5) * 0.25) : 0;
}

/** A heatmap: the picture dimmed, false-hidden red, false-visible cyan (unexplained: magenta). PUT /out/<name>.png. */
async function putHeatmap(name: string, colour: Uint8Array, marks: Uint8Array, W: number, H: number): Promise<string> {
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
