// GPU ground vs the CPU ground baker, pixel for pixel, in the browser (there's
// no headless WebGL2 in this repo's Node): the same view drawn both ways --
// the baker's chunk layers composed on the CPU (keel/terrain composeGround)
// and keel/terrain's GPU ground read back -- over three scenes that between
// them use every path the shader has:
//
//   overworld   an infinite world's chunks (own small terrains at an origin),
//               the surface with climate biomes, rivers, lakes, beaches
//   mixed       one big map: noise world, caves, a WFC town (roads, kerbs), a
//               crypt with its light layer, a re-skinned desert
//   valley      keel/level's valley in the CLASSIC look (no surface): fringes,
//               shores, a river, a bridge deck, and houses baked in (extras)
//
//   node packages/worldgen/tools/build.mjs    ->  /packages/worldgen/tools/ground-parity.html
//   globalThis.parity.run({ scenes, scales }) -> [{ scene, k, pitch, covered, differ, share, cpuMs, gpuMs }]

import { autoTile, bakeChunk, composeGround, createGpuGround, groundPalette, groundRectFor, groundSurface, surfacePalette, viewAxes, GROUND_MATERIALS } from "@keel-engine/terrain";
import type { AutoTiles, GroundExtra, GroundLayer, GroundPalette, GroundStyle, GroundSurface, GpuChunkInput, Terrain } from "@keel-engine/terrain";
import { generateLevel } from "@keel-engine/level";
import { createWorldStream, defineRecipe, runPipeline, toTerrain } from "../src/index.ts";

export interface ParityResult { scene: string; k: number; pitch: number; covered: number; differ: number; share: number; nearOne: number; border: number; holes: number; cpuMs: number; gpuMs: number; chunks: number }

interface Piece { key: string; input: GpuChunkInput & { terrain: Terrain; auto: AutoTiles } }
interface Scene { name: string; palette: GroundPalette; pieces: Piece[]; center: [number, number, number]; lo: number; hi: number }

const style: GroundStyle = { name: "pixel", screen: 4, dither: 0.9, outline: 2 };

function overworld(seed: string): Scene {
  const recipe = defineRecipe({ seed, width: 0, depth: 0, stages: [{ id: "ground", use: "overworld@1", params: { scale: 0.45, land: 0.12 } }] });
  const stream = createWorldStream(recipe);
  const biomes = stream.table.surfaceBiomes();
  const palette = surfacePalette(stream.types, biomes);
  const pieces: Piece[] = [];
  const C = stream.chunkSize;
  for (let cz = -1; cz <= 1; cz += 1) for (let cx = -1; cx <= 1; cx += 1) {
    const c = stream.chunk(cx, cz, 2);
    const L = c.layers;
    const terrain = toTerrain(L, { types: stream.types, chunk: C + 4, id: `ow:${cx},${cz}` });
    const lit = L.light.some((v) => v !== 255);
    const surface = groundSurface({ biomes, biome: L.biome, ...(lit ? { light: L.light } : {}) });
    pieces.push({ key: `ow${cx},${cz}`, input: { terrain, auto: autoTile(terrain), chunk: 0, rect: [2, 2, 2 + C, 2 + C], origin: [L.i0, L.j0], surface, seed: 1 } });
  }
  return { name: "overworld", palette, pieces, center: [8, 0, 8], lo: -6, hi: 24 };
}

function mixed(seed: string): Scene {
  const recipe = defineRecipe({
    seed, width: 96, depth: 96,
    stages: [
      { id: "ground", use: "overworld@1", params: { land: 0.75, scale: 0.3, biomes: ["plains", "forest", "birch-forest", "river", "beach", "ocean", "alpine", "mountains", "dark-forest"] } },
      { id: "town", use: "town@1", mask: { kind: "rect", rect: [40, 10, 88, 50] } },
      { id: "crypt", use: "dungeon@1", params: { algorithm: "rooms", rooms: 6 }, mask: { kind: "rect", rect: [6, 50, 50, 90] } },
      { id: "dunes", use: "biome@1", params: { biome: "desert" }, mask: { kind: "circle", at: [70, 70], r: 16, feather: 3 } },
    ],
  });
  const map = runPipeline(recipe);
  const s0 = createWorldStream({ ...recipe, width: 0, depth: 0 });
  const biomes = s0.table.surfaceBiomes();
  const terrain = toTerrain(map, { chunk: 32, id: `mixed:${seed}` });
  const lit = map.light.some((v) => v !== 255);
  const surface: GroundSurface = groundSurface({ biomes, biome: map.biome.slice(), ...(lit ? { light: map.light } : {}) });
  const palette = surfacePalette(terrain.types, biomes);
  const auto = autoTile(terrain, { seed: 1 });
  const pieces: Piece[] = [];
  for (let c = 0; c < terrain.chunksX * terrain.chunksZ; c += 1) pieces.push({ key: `mx${c}`, input: { terrain, auto, chunk: c, surface, seed: 1 } });
  return { name: "mixed", palette, pieces, center: [120, 0, 60], lo: -6, hi: 24 };
}

function valley(seed: string): Scene {
  const level = generateLevel({ seed, width: 96, depth: 96, players: 1, chunk: 32, settings: "scene/level.template=valley;scene/level.biome=temperate;scene/level.towns=2" }).level;
  const terrain = level.terrain;
  const palette = groundPalette(terrain.types, { materials: GROUND_MATERIALS });
  const auto = autoTile(terrain, { seed: 1 });
  // (Houses of boxes and a wedge roof on flat ground near the middle: the extras path.)
  const extras = new Map<number, GroundExtra[]>();
  for (let n = 0; n < 6; n += 1) {
    const x = 70 + (n % 3) * 9, z = 80 + Math.floor(n / 3) * 10;
    const y = terrain.heightAt(x, z);
    const chunk = terrain.chunkOf(Math.floor(x / 2), Math.floor(z / 2));
    const list = extras.get(chunk) ?? [];
    const yaw = n * 0.4;
    list.push({ c: [x, y + 1.2, z], h: [2.2, 1.2, 1.6], yaw, mat: "plaster" });
    list.push({ c: [x, y + 3.0, z], h: [2.4, 0.6, 1.8], yaw, kind: "wedge", lo: 0.1, mat: "roof" });
    list.push({ c: [x, y + 0.8, z + 1.62], h: [0.4, 0.8, 0.05], yaw, mat: "wood" });
    extras.set(chunk, list);
  }
  const pieces: Piece[] = [];
  for (let c = 0; c < terrain.chunksX * terrain.chunksZ; c += 1) pieces.push({ key: `va${c}`, input: { terrain, auto, chunk: c, surface: null, seed: 1, extras: extras.get(c) ?? [] } });
  const bridge = [...level.things.values()].find((th) => th.layer === "bridges");
  return { name: "valley", palette, pieces, center: bridge ? [bridge.pos[0], 0, bridge.pos[2]] : [80, 0, 86], lo: -4, hi: 20 };
}

/** The demo's view: the centre snapped to the global pixel grid. */
interface ViewOptions { center: readonly [number, number, number]; yaw: number; pitch: number; k: number; width: number; height: number }
function viewOf({ center, yaw, pitch, k, width: W, height: H }: ViewOptions) {
  const a = viewAxes({ yaw, pitch, pixelsPerMetre: k });
  const gx = Math.round((center[0] * a.right[0] + center[2] * a.right[2]) * k) / k;
  const gy = Math.round((center[0] * a.up[0] + center[1] * a.up[1] + center[2] * a.up[2]) * k) / k;
  const f = center[0] * a.forward[0] + center[1] * a.forward[1] + center[2] * a.forward[2];
  const c: [number, number, number] = [a.right[0] * gx + a.up[0] * gy + a.forward[0] * f, a.up[1] * gy + a.forward[1] * f, a.right[2] * gx + a.up[2] * gy + a.forward[2] * f];
  return { center: c, yaw, pitch, pixelsPerMetre: k, width: W, height: H, axes: { right: a.right, up: a.up, forward: a.forward } };
}

const scenes = new Map<string, Scene>();
const sceneOf = (name: string, seed: string): Scene => {
  const key = `${name}|${seed}`;
  let s = scenes.get(key);
  if (!s) { s = name === "overworld" ? overworld(seed) : name === "mixed" ? mixed(seed) : valley(seed); scenes.set(key, s); }
  return s;
};

export interface RunOptions {
  readonly scenes?: readonly string[]; readonly scales?: readonly number[]; readonly pitch?: number; readonly size?: readonly [number, number]; readonly seed?: string; readonly show?: HTMLElement | null;
  /** Art-scale checks: [view k, art scale] pairs -- the GPU at k with artScale must be the CPU's bake at k / n in n x n blocks. */
  readonly art?: ReadonlyArray<readonly [number, number]>;
}

interface ComparisonImages {
  show: HTMLElement; width: number; height: number; scene: string; scale: number;
  cpu: Uint8ClampedArray<ArrayBuffer>; gpu: Uint8Array; diff: Uint8ClampedArray<ArrayBuffer>;
  cpuMs: number; gpuMs: number; differ: number; covered: number;
}

function appendComparisonImages({ show, width: W, height: H, scene, scale, cpu, gpu, diff, cpuMs, gpuMs, differ, covered }: ComparisonImages): void {
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;margin:6px 0;align-items:flex-start";
  const pic = (data: Uint8ClampedArray<ArrayBuffer>, label: string) => {
    const c = document.createElement("canvas");
    c.width = W; c.height = H; c.title = label;
    c.style.cssText = `width:${W * 2}px;image-rendering:pixelated`;
    c.getContext("2d")!.putImageData(new ImageData(data, W, H), 0, 0);
    const box = document.createElement("figure"); box.style.margin = "0";
    const cap = document.createElement("figcaption"); cap.textContent = label; cap.style.font = "11px ui-monospace,monospace";
    box.append(c, cap); row.append(box);
  };
  const flipped = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) flipped.set(gpu.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  pic(cpu, `${scene} ${scale} px/m -- CPU bake (${cpuMs.toFixed(0)} ms)`);
  pic(flipped, `GPU (${gpuMs.toFixed(1)} ms incl. readback)`);
  pic(diff, `diff: ${differ} of ${covered} (${((differ / Math.max(1, covered)) * 100).toFixed(3)}%)`);
  show.append(row);
}

/** Draw each scene at each scale both ways and count the pixels that differ. */
export async function run(canvas: HTMLCanvasElement, opts: RunOptions = {}): Promise<ParityResult[]> {
  const [W, H] = opts.size ?? [320, 200];
  const gl = canvas.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true })!;
  canvas.width = W; canvas.height = H;
  const out: ParityResult[] = [];
  for (const name of opts.scenes ?? ["overworld", "mixed", "valley"]) {
    const scene = sceneOf(name, opts.seed ?? "parity-1");
    const gpu = createGpuGround(gl, { palette: scene.palette, style, seed: 1 });
    for (const k of opts.scales ?? [4, 8, 16, 32]) {
      const pitch = opts.pitch ?? (k > 16 ? 0.5 : 0.72);
      const view = viewOf({ center: scene.center, yaw: 0, pitch, k, width: W, height: H });
      const rect = groundRectFor(view, scene.lo - 4, scene.hi + 40); // (generous: a peak past the picture's top edge still rises into it)
      // The CPU: every chunk the view reaches, only its tiles near the view (a 64 m chunk at 32 px/m is seconds).
      const layers: GroundLayer[] = [];
      const keys: string[] = [];
      const c0 = performance.now();
      for (const p of scene.pieces) {
        const t = p.input.terrain;
        const [oi, oj] = p.input.origin ?? [0, 0];
        const [i0, j0, i1, j1] = p.input.rect ?? t.chunkRect(p.input.chunk ?? 0);
        const ts = t.tileSize;
        const vi0 = Math.floor(rect[0] / ts) - oi - 3, vj0 = Math.floor(rect[1] / ts) - oj - 3, vi1 = Math.ceil(rect[2] / ts) - oi + 3, vj1 = Math.ceil(rect[3] / ts) - oj + 3;
        const r: [number, number, number, number] = [Math.max(i0, vi0), Math.max(j0, vj0), Math.min(i1, vi1), Math.min(j1, vj1)];
        if (r[0] >= r[2] || r[1] >= r[3]) continue;
        keys.push(p.key);
        layers.push(bakeChunk({ terrain: t, auto: p.input.auto, chunk: p.input.chunk ?? 0, rect: r, origin: [oi, oj], view: { yaw: 0, pitch, pixelsPerMetre: k }, palette: scene.palette, style, extras: p.input.extras ?? [], seed: 1, ...(p.input.surface ? { surface: p.input.surface } : {}) }));
        if (!gpu.has(p.key)) gpu.setChunk(p.key, p.input);
      }
      const cpuMs = performance.now() - c0;
      const R = view.axes.right, U = view.axes.up, C = view.center;
      const offX = Math.floor(W / 2 - (C[0] * R[0] + C[1] * R[1] + C[2] * R[2]) * k + 0.5), offY = Math.floor(H / 2 + (C[0] * U[0] + C[1] * U[1] + C[2] * U[2]) * k + 0.5);
      const cpu = composeGround(layers, scene.palette, { width: W, height: H, gx: -offX, gy: -offY, clear: [0, 0, 0] });
      // The GPU.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const g0 = performance.now();
      gpu.draw(view, { clear: [0, 0, 0], keys });
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const gpuMs = performance.now() - g0;
      // Compare (GL rows are bottom first).
      let covered = 0, differ = 0, nearOne = 0, border = 0, holes = 0;
      const diff = new Uint8ClampedArray(W * H * 4);
      const idxOf = new Map<number, number>();
      scene.palette.colours.forEach((c, i) => { const key = (c[0] << 16) | (c[1] << 8) | c[2]; if (!idxOf.has(key)) idxOf.set(key, i); });
      for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
        const o = (y * W + x) * 4, g = ((H - 1 - y) * W + x) * 4;
        const cr = cpu.rgba[o]!, cg = cpu.rgba[o + 1]!, cb = cpu.rgba[o + 2]!;
        const same = cr === px[g] && cg === px[g + 1] && cb === px[g + 2];
        const any = cpu.index[y * W + x]! >= 0 || px[g]! + px[g + 1]! + px[g + 2]! > 0;
        if (any) covered += 1;
        if (!same) {
          differ += 1;
          // (One step along the same ramp: a threshold landing the other side.)
          const gi = idxOf.get((px[g]! << 16) | (px[g + 1]! << 8) | px[g + 2]!) ?? -9, ci = cpu.index[y * W + x]!;
          if (Math.abs(gi - ci) === 1) nearOne += 1;
          if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border += 1;
          if (ci < 0 || px[g]! + px[g + 1]! + px[g + 2]! === 0) holes += 1;
        }
        diff[o] = same ? cr >> 2 : 255; diff[o + 1] = same ? cg >> 2 : 40; diff[o + 2] = same ? cb >> 2 : 40; diff[o + 3] = 255;
      }
      out.push({ scene: name, k, pitch, covered, differ, share: +(differ / Math.max(1, covered)).toFixed(5), nearOne, border, holes, cpuMs: +cpuMs.toFixed(1), gpuMs: +gpuMs.toFixed(2), chunks: keys.length });
      if (opts.show) appendComparisonImages({ show: opts.show, width: W, height: H, scene: name, scale: k, cpu: new Uint8ClampedArray(cpu.rgba), gpu: px, diff, cpuMs, gpuMs, differ, covered });
      await new Promise((r) => setTimeout(r, 0));
    }
    for (const [kF, art] of opts.art ?? []) {
      // The GPU at kF with artScale `art`: its picture is the CPU's bake at kF / n, each texel an n x n block.
      const n = Math.max(1, Math.ceil(kF / art - 1e-9)), kA = kF / n;
      const pitch = opts.pitch ?? (kF > 16 ? 0.5 : 0.72);
      const view = viewOf({ center: scene.center, yaw: 0, pitch, k: kF, width: W, height: H });
      const rect = groundRectFor(view, scene.lo - 4, scene.hi + 40);
      const layers: GroundLayer[] = [], keys: string[] = [];
      const c0 = performance.now();
      for (const p of scene.pieces) {
        const t = p.input.terrain;
        const [oi, oj] = p.input.origin ?? [0, 0];
        const [i0, j0, i1, j1] = p.input.rect ?? t.chunkRect(p.input.chunk ?? 0);
        const ts = t.tileSize;
        const r: [number, number, number, number] = [Math.max(i0, Math.floor(rect[0] / ts) - oi - 3), Math.max(j0, Math.floor(rect[1] / ts) - oj - 3), Math.min(i1, Math.ceil(rect[2] / ts) - oi + 3), Math.min(j1, Math.ceil(rect[3] / ts) - oj + 3)];
        if (r[0] >= r[2] || r[1] >= r[3]) continue;
        keys.push(p.key);
        layers.push(bakeChunk({ terrain: t, auto: p.input.auto, chunk: p.input.chunk ?? 0, rect: r, origin: [oi, oj], view: { yaw: 0, pitch, pixelsPerMetre: kA }, palette: scene.palette, style, extras: p.input.extras ?? [], seed: 1, ...(p.input.surface ? { surface: p.input.surface } : {}) }));
        if (!gpu.has(p.key)) gpu.setChunk(p.key, p.input);
      }
      const cpuMs = performance.now() - c0;
      const R = view.axes.right, U = view.axes.up, C = view.center;
      const offFX = Math.floor(W / 2 - (C[0] * R[0] + C[1] * R[1] + C[2] * R[2]) * kF + 0.5), offFY = Math.floor(H / 2 + (C[0] * U[0] + C[1] * U[1] + C[2] * U[2]) * kF + 0.5);
      const ax0 = Math.floor(-offFX / n), ay0 = Math.floor(-offFY / n);
      const WA = Math.floor((W - 1 - offFX) / n) - ax0 + 1, HA = Math.floor((H - 1 - offFY) / n) - ay0 + 1;
      const cpu = composeGround(layers, scene.palette, { width: WA, height: HA, gx: ax0, gy: ay0, clear: [0, 0, 0] });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const g0 = performance.now();
      gpu.draw(view, { clear: [0, 0, 0], keys, artScale: art });
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const gpuMs = performance.now() - g0;
      let covered = 0, differ = 0, border = 0;
      for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
        const ax = Math.floor((x - offFX) / n) - ax0, ay = Math.floor((y - offFY) / n) - ay0;
        const o = (ay * WA + ax) * 4, g = ((H - 1 - y) * W + x) * 4;
        const same = cpu.rgba[o] === px[g] && cpu.rgba[o + 1] === px[g + 1] && cpu.rgba[o + 2] === px[g + 2];
        if (cpu.index[ay * WA + ax]! >= 0 || px[g]! + px[g + 1]! + px[g + 2]! > 0) covered += 1;
        if (!same) { differ += 1; if (ax === 0 || ay === 0 || ax === WA - 1 || ay === HA - 1) border += 1; }
      }
      out.push({ scene: `${name} art ${art} (${n}x${n})`, k: kF, pitch, covered, differ, share: +(differ / Math.max(1, covered)).toFixed(5), nearOne: 0, border, holes: 0, cpuMs: +cpuMs.toFixed(1), gpuMs: +gpuMs.toFixed(2), chunks: keys.length });
      await new Promise((r) => setTimeout(r, 0));
    }
    gpu.dispose();
  }
  return out;
}

/** What the CPU's layers hold at a picture pixel (debugging a difference): per layer its code and depth. */
export function probe({ sceneName, k, pitch, x, y, size = [320, 200], seed = "parity-1" }: { sceneName: string; k: number; pitch: number; x: number; y: number; size?: readonly [number, number]; seed?: string }): unknown[] {
  const [W, H] = size;
  const scene = sceneOf(sceneName, seed);
  const view = viewOf({ center: scene.center, yaw: 0, pitch, k, width: W, height: H });
  const R = view.axes.right, U = view.axes.up, C = view.center;
  const offX = Math.floor(W / 2 - (C[0] * R[0] + C[1] * R[1] + C[2] * R[2]) * k + 0.5), offY = Math.floor(H / 2 + (C[0] * U[0] + C[1] * U[1] + C[2] * U[2]) * k + 0.5);
  const gx = x - offX, gy = y - offY;
  const out: unknown[] = [{ gx, gy, offX, offY }];
  for (const p of scene.pieces) {
    const t = p.input.terrain;
    const L = bakeChunk({ terrain: t, auto: p.input.auto, chunk: p.input.chunk ?? 0, ...(p.input.rect ? { rect: p.input.rect } : {}), origin: p.input.origin ?? [0, 0], view: { yaw: 0, pitch, pixelsPerMetre: k }, palette: scene.palette, style, extras: p.input.extras ?? [], seed: 1, ...(p.input.surface ? { surface: p.input.surface } : {}) });
    const lx = gx - L.gx0, ly = gy - L.gy0;
    if (lx < 0 || ly < 0 || lx >= L.w || ly >= L.h) continue;
    const q = (ly * L.w + lx) * 4;
    const code = L.data[q]! | (L.data[q + 1]! << 8);
    const ramp = Object.entries(scene.palette.ramps).find(([, r]) => code - 1 >= r[0] && code - 1 < r[0] + r[1]);
    out.push({ key: p.key, code, ramp: ramp ? `${ramp[0]}+${code - 1 - ramp[1][0]}` : null, depth: L.depthRef + ((L.data[q + 2]! | (L.data[q + 3]! << 8)) - 32768) * L.depthStep, rect: [L.gx0, L.gy0, L.w, L.h] });
  }
  return out;
}
