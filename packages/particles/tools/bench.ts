// The particle bench and demo: an army marching over a map (bake's sprite
// renderer, synthetic creatures) kicking up dust, firing (muzzle flashes on
// the hand.R socket), bleeding, burning, exploding, in the rain -- then a
// 100k stress. Every frame steps the pool on the fixed step, culls and fills
// the sprites, draws them, then the particles into the same depth buffer;
// timed with the GPU finished, at 480×270, 960×540 and 1920×1080. It saves
// screenshots to out/particles/ (the dev server takes PUTs there).
//
//   node packages/particles/tools/build.mjs; open packages/particles/tools/bench.html on the dev server
import { createGrid, createSpriteRenderer, directionFor, packAtlas, pixelView, SpriteInstances } from "@keel-engine/bake";
import type { PixelView, SpriteRenderer } from "@keel-engine/bake";
import { PRESETS, createDamageStates, createParticlePool, createParticleRenderer, frameFromYaw, particlePalette } from "../src/index.ts";
import type { ParticleHost, ParticlePool, ParticleRenderer } from "../src/index.ts";

const DT = 1 / 120;
const MAP = 256;
const SIZES: readonly (readonly [number, number])[] = [[480, 270], [960, 540], [1920, 1080]];

export interface Row { mode: string; size: string; viewMetres: number; live: number; sprites: number; sim: number; sprite: number; particles: number; sync: number; frame: number; p95: number; uploadKB: number; written: number }

// ---------------------------------------------------------------- sprites (synthetic: the bake bench's creatures, and some props)

function makeSprites() {
  const W = 16, H = 20;
  const rects: { w: number; h: number }[] = [];
  const pix: Uint8Array[] = [];
  const add = (w: number, h: number, paint: (set: (x: number, y: number, r: number, g: number, b: number) => void) => void) => {
    const px = new Uint8Array(w * h * 4);
    paint((x, y, r, g, b) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const o = (y * w + x) * 4; px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255; });
    rects.push({ w, h }); pix.push(px);
  };
  // 4 designs x 8 directions: a body, a head facing the direction, a team stripe.
  for (let d = 0; d < 4; d += 1) for (let dir = 0; dir < 8; dir += 1) {
    add(W, H, (set) => {
      const hue = [210, 20, 110, 280][d]!;
      const c = (l: number) => { const k = (n: number) => { const a = 0.45 * Math.min(l, 1 - l); const q = (n + hue / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(q - 3, 9 - q, 1)))); }; return [k(0), k(8), k(4)] as const; };
      for (let y = 8; y < 19; y += 1) for (let x = 4; x < 12; x += 1) { const [r, g, b] = c(x < 6 ? 0.28 : x > 9 ? 0.36 : 0.45); set(x, y, r, g, b); }
      for (let x = 4; x < 12; x += 1) set(x, 19, 20, 18, 24);
      const ang = (dir / 8) * Math.PI * 2;
      const hx = 8 + Math.round(Math.sin(ang) * 2);
      for (let y = 2; y <= 7; y += 1) for (let x = hx - 3; x <= hx + 2; x += 1) { const [r, g, b] = c(0.62); set(x, y, r, g, b); }
      if (Math.cos(ang) > -0.3) { set(hx - 1 + Math.round(Math.sin(ang)), 4, 16, 16, 24); set(hx + 1 + Math.round(Math.sin(ang)), 4, 16, 16, 24); }
      for (let x = 4; x < 12; x += 1) set(x, 12, 200, 170, 60);
      // (A rifle in the right hand.)
      for (let y = 9; y < 17; y += 1) set(Math.cos(ang) > 0 ? 13 : 2, y, 60, 50, 40);
    });
  }
  // Props: a rock, a tuft, a wreck.
  add(12, 8, (set) => { for (let y = 2; y < 8; y += 1) for (let x = 1; x < 11; x += 1) if ((x - 5.5) ** 2 / 25 + (y - 5) ** 2 / 9 < 1) set(x, y, 90 + (x < 5 ? -20 : 10), 88, 82); });
  add(8, 6, (set) => { for (let k = 0; k < 7; k += 1) for (let y = 6 - (k % 3) - 2; y < 6; y += 1) set(k, y, 70, 110 + k * 5, 50); });
  add(24, 14, (set) => { for (let y = 3; y < 14; y += 1) for (let x = 1; x < 23; x += 1) if (y > 6 || (x > 6 && x < 16)) set(x, y, 55 + (y < 7 ? 20 : 0), 58, 62 + (x % 5 === 0 ? 12 : 0)); });
  const atlas = packAtlas(rects, { size: 256, pad: 1 });
  const pages = atlas.pages.map((p) => ({ width: p.w, height: p.h, rgba: new Uint8Array(p.w * p.h * 4) }));
  atlas.places.forEach((pl, i) => { const page = pages[pl.page]!; const { w, h } = rects[i]!; for (let y = 0; y < h; y += 1) page.rgba.set(pix[i]!.subarray(y * w * 4, (y + 1) * w * 4), ((pl.y + y) * page.width + pl.x) * 4); });
  return { atlas, pages, rects };
}

// ---------------------------------------------------------------- the world

interface World {
  n: number;
  x: Float64Array; z: Float64Array; yaw: Float64Array; kind: Uint8Array; team: Uint8Array;
  props: { x: number; z: number; s: number }[];
  host: ParticleHost;
  move(dt: number, t: number): void;
}

function makeWorld(n: number, seed: number): World {
  let a = seed >>> 0;
  const f = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
  const x = new Float64Array(n), z = new Float64Array(n), yaw = new Float64Array(n), kind = new Uint8Array(n), team = new Uint8Array(n);
  // Formations: blocks of 10×10 marching along a heading.
  for (let i = 0; i < n; i += 1) {
    const block = Math.floor(i / 100);
    const bx = (block * 37) % (MAP - 40) + 20, bz = (block * 61) % (MAP - 40) + 20;
    x[i] = bx + (i % 10) * 1.6 + f() * 0.3;
    z[i] = bz + Math.floor((i % 100) / 10) * 1.6 + f() * 0.3;
    yaw[i] = (block % 4) * (Math.PI / 2) + 0.4;
    kind[i] = block % 4; team[i] = block % 2;
  }
  const props = Array.from({ length: 600 }, () => ({ x: f() * MAP, z: f() * MAP, s: Math.floor(f() * 3) }));
  // (Hand.R: in the unit's frame, right, up and ahead: where its rifle's muzzle is.)
  const host: ParticleHost = {
    locate(u, socket, out) {
      const c = Math.cos(yaw[u]!), s = Math.sin(yaw[u]!);
      let lx = 0, ly = 0, lz = 0;
      if (socket === "hand.R") { lx = 0.3; ly = 1.1; lz = 0.55; }
      out[0] = x[u]! + c * lx + s * lz; out[1] = ly; out[2] = z[u]! - s * lx + c * lz;
      out[3] = c; out[4] = 0; out[5] = s; out[6] = 0; out[7] = 1; out[8] = 0; out[9] = -s; out[10] = 0; out[11] = c;
      return true;
    },
  };
  return {
    n, x, z, yaw, kind, team, props, host,
    move(dt, t) {
      for (let i = 0; i < n; i += 1) {
        const y = yaw[i]! + Math.sin(t * 0.3 + Math.floor(i / 100)) * 0.002;
        yaw[i] = y;
        x[i] = (x[i]! + Math.sin(y) * 1.4 * dt + MAP) % MAP;
        z[i] = (z[i]! + Math.cos(y) * 1.4 * dt + MAP) % MAP;
      }
    },
  };
}

// ---------------------------------------------------------------- a frame

interface Rig {
  sr: SpriteRenderer; pr: ParticleRenderer; inst: SpriteInstances; grid: ReturnType<typeof createGrid>;
  sprites: ReturnType<typeof makeSprites>; vis: number[];
}

function fillSprites(rig: Rig, world: World, view: PixelView) {
  const { inst, grid, sprites, vis } = rig;
  const [x0, z0, x1, z1] = view.groundRect(2);
  vis.length = 0;
  grid.rect(x0, z0, x1, z1, vis);
  inst.clear();
  const s = (1.8 * view.pixelsPerMetre) / 20; // (units ~1.8 m tall at any scale)
  for (const i of vis) {
    const pl = sprites.atlas.places[world.kind[i]! * 8 + directionFor(world.yaw[i]!, view.yaw, 8)]!;
    inst.push(world.x[i]!, 0, world.z[i]!, pl.x, pl.y, 16, 20, 8, 19, pl.page, 0, s);
  }
  for (const p of world.props) {
    if (p.x < x0 || p.x > x1 || p.z < z0 || p.z > z1) continue;
    const k = 32 + p.s;
    const pl = sprites.atlas.places[k]!;
    const r = sprites.rects[k]!;
    inst.push(p.x, 0, p.z, pl.x, pl.y, r.w, r.h, r.w / 2, r.h - 1, pl.page, 0, s);
  }
}

const now = () => performance.now();
const pick = (a: number[], q: number) => { const b = [...a].sort((p, r) => p - r); return b[Math.min(b.length - 1, Math.floor(b.length * q))]!; };
// (The GPU finished: a one-pixel read waits for everything before it. The page's clock is coarse -- 0.1 ms
// -- so each phase is summed over the run and divided, not a median of per-frame readings.)
const sync1 = new Uint8Array(4);
const finish = (gl: WebGL2RenderingContext) => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, sync1);

/** Save the canvas (nearest-neighbour upscaled to at least 960 wide) to out/particles/<name>.png. */
async function snap(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, name: string) {
  const w = canvas.width, h = canvas.height;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const k = Math.max(1, Math.round(960 / w));
  const flip = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) flip.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  const small = new OffscreenCanvas(w, h);
  small.getContext("2d")!.putImageData(new ImageData(flip, w, h), 0, 0);
  const big = new OffscreenCanvas(w * k, h * k);
  const g = big.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.drawImage(small, 0, 0, w * k, h * k);
  const blob = await big.convertToBlob({ type: "image/png" });
  await fetch(`/out/particles/${name}.png`, { method: "PUT", body: blob });
}

// ---------------------------------------------------------------- scenes

/** The battle: units marching with dust, firing, bleeding, fires, smoke, explosions, magic, rain. */
function battle(pool: ParticlePool, world: World, center: [number, number]) {
  let a = 99;
  const f = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
  for (let u = 0; u < world.n; u += 1) pool.emit("footstep-dust", 0, 0, 0, { unit: u });
  for (let i = 0; i < 40; i += 1) {
    const x = center[0] + (f() - 0.5) * 120, z = center[1] + (f() - 0.5) * 70;
    pool.emit(i % 3 === 0 ? "smoke-column" : "fire", x, 0, z);
    if (i % 3 === 1) pool.emit("smoke-column", x, 0, z);
  }
  for (let i = 0; i < 8; i += 1) pool.emit("magic-swirl", center[0] + (f() - 0.5) * 60, 0, center[1] + (f() - 0.5) * 30);
  for (let i = 0; i < 6; i += 1) pool.emit("spark-shower", center[0] + (f() - 0.5) * 60, 0.5, center[1] + (f() - 0.5) * 30);
  pool.emit("rain", 0, 0, 0);
  pool.wind.set([2.5, 0, 0.8]);
  return (step: number) => {
    // Every so often: a volley (a unit in 30 fires), an explosion, a splat.
    if (step % 12 === 0) for (let u = step % 30; u < world.n; u += 30) pool.emit("muzzle-flash", 0, 0, 0, { unit: u, socket: "hand.R" });
    if (step % 30 === 0) pool.emit("explosion", center[0] + (f() - 0.5) * 80, 0, center[1] + (f() - 0.5) * 45);
    if (step % 20 === 5) { const u = Math.floor(f() * world.n); pool.emit(f() < 0.5 ? "blood-splat" : "ichor-splat", world.x[u]!, 0.8, world.z[u]!); }
    if (step % 45 === 0) pool.emit("water-splash", center[0] + (f() - 0.5) * 40, 0, center[1] + (f() - 0.5) * 20);
  };
}

/** Enough continuous emitters to hold ~`target` live particles (LOD off), over the whole map. */
function stress(pool: ParticlePool, target: number, [cx, cz, hw, hd]: readonly [number, number, number, number]) {
  let a = 7;
  const f = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
  const kinds = ["smoke-column", "fire", "spark-shower", "magic-swirl", "embers"];
  // (Roughly: smoke 14/s × 4 s, fire 40/s × 0.6 s + embers, sparks 60/s × 0.5, swirl 50/s × 1.1 -- ~40 live each.)
  const n = Math.round(target / 40);
  const at = () => [cx + (f() * 2 - 1) * hw, cz + (f() * 2 - 1) * hd] as const;
  for (let i = 0; i < n; i += 1) { const [x, z] = at(); pool.emit(kinds[i % kinds.length]!, x, 0, z); }
  return (step: number) => { if (step % 10 === 0) { const [x, z] = at(); pool.emit("explosion", x, 0, z); } };
}

// ---------------------------------------------------------------- the bench

export async function bench(canvas: HTMLCanvasElement, log: (s: string) => void, { frames = 120, save = true } = {}): Promise<Row[]> {
  const rows: Row[] = [];
  const sprites = makeSprites();
  const { colours, ramps } = particlePalette();
  type RunOptions = { mode: string; w: number; h: number; viewMetres: number; units: number; make: (pool: ParticlePool, world: World) => (s: number) => void; poolOpts: Parameters<typeof createParticlePool>[0]; shot: string | null };
  const run = async ({ mode, w, h, viewMetres, units, make, poolOpts, shot }: RunOptions) => {
    const world = makeWorld(units, 3);
    const sr = createSpriteRenderer(canvas, { width: w, height: h, capacity: 65536 });
    sr.setPages(sprites.pages);
    const pool = createParticlePool({ ...poolOpts, recipes: PRESETS, host: world.host, seed: 1234 });
    const pr = createParticleRenderer(sr.gl, { capacity: pool.capacity });
    pr.setPalette(colours, ramps);
    const rig: Rig = { sr, pr, inst: new SpriteInstances(65536), grid: createGrid({ cell: 8, capacity: units + 1 }), sprites, vis: [] };
    const each = make(pool, world);
    const center: [number, number] = [MAP / 2, MAP / 2];
    const viewAt = (t: number) => pixelView({ center: [center[0] + Math.sin(t * 0.2) * 3, 0, center[1]], yaw: 0.35, pitch: 0.62, pixelsPerMetre: w / viewMetres, width: w, height: h });
    let sim = 0, spr = 0, par = 0, syn = 0, n = 0;
    const tot: number[] = [];
    let uploaded = 0, written = 0;
    const total = 240 + frames;
    for (let s = 0; s < total; s += 1) {
      const t = s * DT;
      const view = viewAt(t);
      world.move(DT, t);
      for (let i = 0; i < units; i += 1) rig.grid.set(i, world.x[i]!, world.z[i]!, 0.5);
      const t0 = now();
      pool.setView(view);
      each(s);
      pool.step(DT);
      const t1 = now();
      fillSprites(rig, world, view);
      sr.draw(view, rig.inst, [0.2, 0.21, 0.17]);
      finish(sr.gl);
      const t2 = now();
      pr.draw(view, pool);
      finish(sr.gl);
      const t3 = now();
      // (The sync alone, with nothing to wait for: the round trip every phase above includes once.)
      finish(sr.gl);
      const t4 = now();
      if (s >= 240) { sim += t1 - t0; spr += t2 - t1; par += t3 - t2; syn += t4 - t3; n += 1; tot.push(t3 - t0); uploaded += pr.uploaded; written += pr.written; }
      if (s % 60 === 59) await new Promise((r) => setTimeout(r, 0));
    }
    if (shot && save) {
      // One more frame, read straight back (the drawing buffer isn't preserved past the task).
      const view = viewAt(total * DT);
      pool.step(DT); fillSprites(rig, world, view); sr.draw(view, rig.inst, [0.2, 0.21, 0.17]); pr.draw(view, pool);
      await snap(canvas, sr.gl, shot);
    }
    const r3 = (v: number) => +v.toFixed(3);
    const row: Row = { mode, size: `${w}x${h}`, viewMetres, live: pool.count, sprites: rig.inst.count, sim: r3(sim / n), sprite: r3(spr / n), particles: r3(par / n), sync: r3(syn / n), frame: r3((sim + spr + par) / n), p95: r3(pick(tot, 0.95)), uploadKB: Math.round(uploaded / n / 1024), written: Math.round(written / n) };
    rows.push(row);
    log(`${mode.padEnd(16)} ${row.size.padEnd(10)} ${String(viewMetres).padStart(4)} m  live ${String(row.live).padStart(6)}  sprites ${String(row.sprites).padStart(5)}  sim ${row.sim.toFixed(2)}  sprites ${row.sprite.toFixed(2)}  particles ${row.particles.toFixed(2)} (sync ${row.sync.toFixed(2)})  frame ${row.frame.toFixed(2)} (p95 ${row.p95.toFixed(1)}) ms  ${row.written} slots / ${row.uploadKB} KB up a frame (${pr.path})`);
    pr.dispose();
  };
  // (A run thrown away first: the JIT and the driver's shader cache.)
  await run({ mode: "warm-up", w: 480, h: 270, viewMetres: 72, units: 3000, make: (pool, world) => battle(pool, world, [MAP / 2, MAP / 2]), poolOpts: { capacity: 65536, emitters: 8192 }, shot: null });
  rows.length = 0;
  // The battle, the same framing at three resolutions: LOD does the rest.
  for (const [w, h] of SIZES) await run({ mode: "battle", w, h, viewMetres: 72, units: 3000, make: (pool, world) => battle(pool, world, [MAP / 2, MAP / 2]), poolOpts: { capacity: 65536, emitters: 8192 }, shot: `battle-${w}x${h}` });
  // The stress: ~100k live, LOD and pressure off, the whole map in view, then close up.
  const stressPool = { capacity: 131072, emitters: 8192, minPixels: 0, pressure: false, reserve: [1, 1, 1, 1] } as const;
  for (const [w, h] of SIZES) await run({ mode: "stress-map", w, h, viewMetres: 400, units: 2000, make: (pool) => stress(pool, 100000, [MAP / 2, MAP / 2, MAP / 2, MAP / 2]), poolOpts: stressPool, shot: w === 1920 ? "stress-map-1920x1080" : null });
  for (const [w, h] of SIZES) await run({ mode: "stress-close", w, h, viewMetres: 72, units: 2000, make: (pool) => stress(pool, 100000, [MAP / 2, MAP / 2, 34, 30]), poolOpts: stressPool, shot: w === 1920 ? "stress-close-1920x1080" : null });
  // And 50k, at 1920×1080.
  await run({ mode: "stress-map 50k", w: 1920, h: 1080, viewMetres: 400, units: 2000, make: (pool) => stress(pool, 50000, [MAP / 2, MAP / 2, MAP / 2, MAP / 2]), poolOpts: stressPool, shot: null });
  await run({ mode: "stress-close 50k", w: 1920, h: 1080, viewMetres: 72, units: 2000, make: (pool) => stress(pool, 50000, [MAP / 2, MAP / 2, 34, 30]), poolOpts: stressPool, shot: null });
  return rows;
}

/** The preset sheet: every preset side by side at 24 px/m, twelve to a page, snapped at four moments. */
export async function sheet(canvas: HTMLCanvasElement): Promise<void> {
  const w = 960, h = 540;
  const sprites = makeSprites();
  const { colours, ramps } = particlePalette();
  const world = makeWorld(0, 1);
  const sr = createSpriteRenderer(canvas, { width: w, height: h, capacity: 4096 });
  sr.setPages(sprites.pages);
  const pool = createParticlePool({ capacity: 65536, recipes: PRESETS, host: world.host, seed: 5 });
  const pr = createParticleRenderer(sr.gl, { capacity: pool.capacity });
  pr.setPalette(colours, ramps);
  const view = pixelView({ center: [0, 0, 0], yaw: 0, pitch: 0.62, pixelsPerMetre: 24, width: w, height: h });
  const all = Object.keys(PRESETS).filter((n) => n !== "rain" && n !== "snow" && n !== "embers");
  const inst = new SpriteInstances(4096);
  const spot = (i: number): [number, number] => [((i % 4) - 1.5) * 9, (Math.floor(i / 4) - 1) * 7 - 1];
  const place = (names: readonly string[]) => {
    inst.clear();
    names.forEach((_, i) => {
      const [x, z] = spot(i);
      // A soldier beside each effect (for scale and depth: effects behind and in front).
      const pl = sprites.atlas.places[(i % 4) * 8 + 1]!;
      inst.push(x + 1.6, 0, z + 0.6, pl.x, pl.y, 16, 20, 8, 19, pl.page, 0, 1.8 * 24 / 20);
    });
  };
  // (Splats thrown from a little up, so they land; a tracer streams along its shot; a trail needs moving.)
  const high = new Set(["blood-splat", "ichor-splat", "impact-acid", "impact-flesh", "death-burst", "bleed-drip"]);
  const optionsFor = (n: string) => (n === "muzzle-flash" ? { yaw: Math.PI / 2 } : n === "tracer" ? { velocity: [8, 0, 0] as const, duration: Infinity } : {});
  const moments = [0.03, 0.15, 0.5, 1.2];
  // Twelve to a page (the first page keeps its old file names: sheet-30ms and so on; then sheet-p2-30ms...).
  for (let page = 0; page * 12 < all.length; page += 1) {
    const names = all.slice(page * 12, page * 12 + 12);
    for (const m of moments) {
      pool.clear();
      const trails: [number, number, number][] = [];
      names.forEach((n, i) => {
        const [x, z] = spot(i);
        const handle = pool.emit(n, x, n === "spark-shower" ? 0.5 : high.has(n) ? 0.8 : 0, z, optionsFor(n));
        if (PRESETS[n]!.mode === "trail") trails.push([handle, x, z]);
      });
      // (Continuous ones get a head start so they're in full flow; the bursts are at `m` seconds.)
      const steps = Math.round(m / DT);
      for (let s = 0; s < steps; s += 1) {
        for (const [handle, x, z] of trails) pool.move(handle, x + Math.cos(s * DT * 2) * 2, 0, z + Math.sin(s * DT * 2) * 1.5);
        pool.step(DT);
      }
      place(names);
      sr.draw(view, inst, [0.2, 0.21, 0.17]);
      pr.draw(view, pool);
      await snap(canvas, sr.gl, page === 0 ? `sheet-${Math.round(m * 1000)}ms` : `sheet-p${page + 1}-${Math.round(m * 1000)}ms`);
    }
  }
  // Weather: rain and snow over a few soldiers.
  for (const weather of ["rain", "snow"]) {
    pool.clear();
    pool.wind.set([3, 0, 0]);
    pool.setView(view);
    pool.emit(weather, 0, 0, 0);
    pool.emit("fire", -6, 0, 2);
    for (let s = 0; s < 480; s += 1) pool.step(DT);
    place(all.slice(0, 12));
    sr.draw(view, inst, [0.2, 0.21, 0.17]);
    pr.draw(view, pool);
    await snap(canvas, sr.gl, `weather-${weather}`);
    pool.setView(null);
  }
  pr.dispose();
}

/**
 * The RTS damage scene at an RTS zoom (16 px/m): buildings at each damage stage through createDamageStates (a 6 m
 * and a 4 m machine one, a 4 m organic, a 3 m crystal), damaged units driving circles, and the six tracer classes
 * in flight -- snapped at 1, 3 and 5 seconds (out/particles/damage-*.png).
 */
export async function damageScene(canvas: HTMLCanvasElement): Promise<void> {
  const w = 960, h = 540;
  const sprites = makeSprites();
  const { colours, ramps } = particlePalette();
  const sr = createSpriteRenderer(canvas, { width: w, height: h, capacity: 4096 });
  sr.setPages(sprites.pages);
  const units = new Float64Array(8 * 3);
  const host: ParticleHost = { locate: (u, _s, out) => { frameFromYaw(units[u * 3]!, 0, units[u * 3 + 2]!, units[u * 3 + 1]!, out); return true; } };
  const pool = createParticlePool({ capacity: 32768, emitters: 4096, recipes: PRESETS, host, seed: 3, maxLod: 2 });
  const pr = createParticleRenderer(sr.gl, { capacity: pool.capacity });
  pr.setPalette(colours, ramps);
  const view = pixelView({ center: [0, 0, 2], yaw: 0, pitch: 0.62, pixelsPerMetre: 16, width: w, height: h });
  pool.setView(view);
  pool.wind.set([0.8, 0, 0.3]);
  const damage = createDamageStates(pool);
  const buildings = [
    { x: -19, z: -5, size: 6, hp01: 0.2, material: "metal" }, { x: -7, z: -5, size: 4, hp01: 0.5, material: "metal" },
    { x: 5, z: -5, size: 4, hp01: 0.2, material: "organic" }, { x: 16, z: -5, size: 3, hp01: 0.5, material: "crystal" },
  ] as const;
  const kinds = ["metal", "organic", "crystal", "stone"] as const;
  const tracers = ["tracer-kinetic", "tracer-piercing", "tracer-energy", "tracer-acid", "tracer-blast", "tracer-siege"];
  const inst = new SpriteInstances(4096);
  const bs = { x: 0, y: 0, z: 0, hp01: 1, material: "metal" as (typeof kinds)[number], kind: "building" as const, size: 1 };
  const us = { x: 0, y: 0, z: 0, hp01: 0.2, material: "metal" as (typeof kinds)[number], kind: "unit" as const, size: 0.5, unit: 0 };
  const TICK = 1 / 30;
  let t = 0;
  for (const at of [1, 3, 5]) {
    for (; t < at; t += TICK) {
      buildings.forEach((b, i) => { bs.x = b.x; bs.z = b.z; bs.hp01 = b.hp01; bs.material = b.material; bs.size = b.size; damage.set(i, bs); });
      kinds.forEach((m, k) => {
        const a = t * 0.8 + k * 1.6;
        units[k * 3] = -18 + k * 12 + Math.cos(a) * 3; units[k * 3 + 2] = 6 + Math.sin(a) * 2; units[k * 3 + 1] = a + Math.PI / 2;
        us.x = units[k * 3]!; us.z = units[k * 3 + 2]!; us.material = m; us.unit = k;
        damage.set(100 + k, us);
      });
      tracers.forEach((n, k) => { const x = -26 + ((t * 18) % 52); pool.emit(n, x, 1, 10 + k * 1.2, { velocity: [18, 0, 0] }); });
      for (let q = 0; q < 4; q += 1) pool.step(DT);
    }
    inst.clear();
    kinds.forEach((_, k) => { const pl = sprites.atlas.places[k * 8 + 1]!; inst.push(units[k * 3]!, 0, units[k * 3 + 2]!, pl.x, pl.y, 16, 20, 8, 19, pl.page, 0, 1.8 * 16 / 20); });
    buildings.forEach((b, k) => { const pl = sprites.atlas.places[k * 8 + 2]!; inst.push(b.x + b.size * 0.7, 0, b.z + b.size * 0.4, pl.x, pl.y, 16, 20, 8, 19, pl.page, 0, 1.8 * 16 / 20); });
    sr.draw(view, inst, [0.2, 0.21, 0.17]);
    pr.draw(view, pool);
    await snap(canvas, sr.gl, `damage-${at}s`);
  }
  pr.dispose();
}
