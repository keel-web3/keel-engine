// Two checks the ground must pass by design (in the browser: they draw with WebGL2):
//
//   ZOOM SWEEP     a fast wheel zoom -- 128 px/m out to 2 and back in 40 frames, the pitch bucket switching at 16 --
//                  and per frame, how much of the ground the picture should show IS shown: the GPU ground streaming
//                  its chunks (createGpuTerrain: visible chunks always uploaded) against one with every chunk
//                  uploaded. And the same sweep through two CPU bakers (one per pitch bucket: what a game did), for
//                  comparison.
//   BUILDINGS      box-shaped building sprites on flat ground, drawn over the ground with the depth test, against
//                  the same sprites with no depth test (the reference): how many of a building's pixels the ground
//                  hides -- with spritePosition's footprint (its front edge's depth) and without (its middle's) --
//                  at scales from 4 to 128 px/m, both pitches, between rungs too.
//
//   node packages/terrain/tools/build.mjs   ->  http://localhost:4300/packages/terrain/tools/ground-checks.html
//   globalThis.checks.run() -> { sweep: {...}, buildings: [...] }

import { LayerInstances, createLookTable, createSpriteRenderer, pixelView } from "@keel-engine/bake";
import type { PixelView } from "@keel-engine/bake";
import {
  autoTile, createGpuGround, createGpuTerrain, createGroundBaker, createGroundRenderer, createTerrain, footprintToward, groundSurface, spritePosition, surfacePalette, viewAxes,
} from "../src/index.ts";
import type { Terrain } from "../src/index.ts";
import { randomTerrain } from "../test/helpers.ts";

const W = 480, H = 270;
const biomes = [{ name: "meadow" }, { name: "dry", tint: { hue: 25, chroma: 0.8 } }, { name: "cold", tint: { hue: -30, light: 1.06 } }];

/** A 128 x 128 map: plateaus, ramps, a lake, three biomes. */
function world(): { t: Terrain; biome: Uint8Array } {
  const t = randomTerrain(21, 128, 128, { chunk: 32, ramps: 30 });
  const biome = new Uint8Array(128 * 128);
  for (let j = 0; j < 128; j += 1) for (let i = 0; i < 128; i += 1) biome[j * 128 + i] = Math.sin(i * 0.05) + Math.cos(j * 0.04) > 0.6 ? 1 : j > 90 ? 2 : 0;
  return { t, biome };
}

/** The demo's view: yaw 0, the centre snapped to the global pixel grid. */
function viewAt(cx: number, cz: number, pitch: number, k: number): PixelView {
  const a = viewAxes({ yaw: 0, pitch, pixelsPerMetre: k });
  const gx = Math.round((cx * a.right[0] + cz * a.right[2]) * k) / k;
  const gy = Math.round((cx * a.up[0] + cz * a.up[2]) * k) / k;
  const f = cx * a.forward[0] + cz * a.forward[2];
  return pixelView({ center: [a.right[0] * gx + a.up[0] * gy + a.forward[0] * f, a.up[1] * gy + a.forward[1] * f, a.right[2] * gx + a.up[2] * gy + a.forward[2] * f], yaw: 0, pitch, pixelsPerMetre: k, width: W, height: H });
}

export async function run(canvas: HTMLCanvasElement): Promise<unknown> {
  const sr = createSpriteRenderer(canvas, { width: W, height: H, capacity: 4096 });
  sr.setTarget(W, H);
  const gl = sr.gl;
  const { t, biome } = world();
  const palette = surfacePalette(t.types, biomes);
  const surface = groundSurface({ biomes, biome });
  const auto = autoTile(t, { seed: 1 });
  const read = (): Uint8Array => { const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
  const lit = (px: Uint8Array, o: number): boolean => px[o]! + px[o + 1]! + px[o + 2]! > 0;

  // ---------------------------------------------------------------- the zoom sweep
  const gpu = createGpuGround(gl, { palette, seed: 1 });
  const stream = createGpuTerrain(gpu, { terrain: t, auto, surface, prefetch: 1, seed: 1 });
  const refGpu = createGpuGround(gl, { palette, seed: 1 });
  const ref = createGpuTerrain(refGpu, { terrain: t, auto, surface, prefetch: 0, seed: 1 });
  ref.preload();
  const cpuGround = createGroundRenderer(gl);
  cpuGround.setPalette(palette);
  // The CPU bake as a game ran it (two bakers, one per pitch bucket, no floor) and as the engine has it now (a floor
  // scale of 2 px/m baked for every chunk at load, the last complete layer kept as the stand-in).
  const bakers = [0.72, 0.5].map(() => createGroundBaker({ terrain: t, palette, style: { name: "pixel" }, surface, prefetch: 1, seed: 1 }));
  const floored = [0.72, 0.5].map(() => createGroundBaker({ terrain: t, palette, style: { name: "pixel" }, surface, prefetch: 1, seed: 1, floor: 2 }));
  const f0 = performance.now();
  floored.forEach((b, i) => b.bakeFloor({ yaw: 0, pitch: i === 0 ? 0.72 : 0.5, pixelsPerMetre: 2 }));
  const floorMs = performance.now() - f0;
  const frames: Array<{ k: number; pitch: number; gpu: number; cpu: number; cpuFloor: number; uploads: number; ms: number }> = [];
  const N = 40;
  let cx = 120, cz = 118;
  for (let f = 0; f <= N; f += 1) {
    // 128 -> 2 over 20 frames, back to 128 over 20 (a rung and a half a frame: faster than any wheel), panning.
    const u = f <= N / 2 ? f / (N / 2) : (N - f) / (N / 2);
    const k = 128 * Math.pow(2 / 128, u);
    const pitch = k > 16 * 1.12 ? 0.5 : 0.72;
    cx += 1.5; cz -= 0.5;
    const view = viewAt(cx, cz, pitch, k);
    // The reference: every chunk there.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    refGpu.draw(view, { clear: [0, 0, 0], keys: ref.plan(view) });
    const R = read();
    // The GPU ground as a game runs it: plan, upload (2 ms budget for the ring; the visible always), draw.
    const u0 = gpu.stats.uploads, t0 = performance.now();
    const keys = stream.plan(view);
    stream.upload(2, 2);
    gpu.draw(view, { clear: [0, 0, 0], keys });
    const G = read();
    const ms = performance.now() - t0;
    // Two CPU bakers (one per pitch bucket), 2 ms of bake a frame, drawing their layers (stand-ins included).
    const b = bakers[pitch === 0.72 ? 0 : 1]!;
    b.plan({ ...view, pixelsPerMetre: Math.min(32, k) });
    b.bake(2);
    cpuGround.draw(view, b.layers(), { clear: [0, 0, 0] });
    const C = read();
    const bf = floored[pitch === 0.72 ? 0 : 1]!;
    bf.plan({ ...view, pixelsPerMetre: Math.min(32, k) });
    bf.bake(2);
    cpuGround.draw(view, bf.layers(), { clear: [0, 0, 0] });
    const CF = read();
    let want = 0, g = 0, c = 0, cf = 0;
    for (let o = 0; o < W * H * 4; o += 4) { if (!lit(R, o)) continue; want += 1; if (lit(G, o)) g += 1; if (lit(C, o)) c += 1; if (lit(CF, o)) cf += 1; }
    frames.push({ k: +k.toFixed(1), pitch, gpu: +(g / Math.max(1, want)).toFixed(4), cpu: +(c / Math.max(1, want)).toFixed(4), cpuFloor: +(cf / Math.max(1, want)).toFixed(4), uploads: gpu.stats.uploads - u0, ms: +ms.toFixed(1) });
    await new Promise((r) => setTimeout(r, 0));
  }
  const sweep = {
    frames: frames.length,
    gpuMin: Math.min(...frames.map((x) => x.gpu)), gpuUnder99: frames.filter((x) => x.gpu < 0.99).length,
    cpuMin: Math.min(...frames.map((x) => x.cpu)), cpuUnder99: frames.filter((x) => x.cpu < 0.99).length,
    cpuFloorMin: Math.min(...frames.map((x) => x.cpuFloor)), cpuFloorUnder99: frames.filter((x) => x.cpuFloor < 0.99).length, floorBakeMs: +floorMs.toFixed(0),
    worstGpuFrameMs: Math.max(...frames.map((x) => x.ms)), uploadsTotal: frames.reduce((n, x) => n + x.uploads, 0),
    list: frames,
  };

  // ---------------------------------------------------------------- buildings on flat ground
  // Flat sites: a 5 x 5 tile square at one level, dry, no ramps -- a house's footprint (7 x 5 m) sits well inside one.
  const flat = createTerrain({ width: 128, depth: 128, chunk: 32, fill: "grass", level: 2 });
  flat.batch(() => { for (let j = 0; j < 128; j += 1) for (let i = 0; i < 128; i += 1) { const v = Math.sin(i * 0.3) + Math.cos(j * 0.23); flat.setType(i, j, v > 0.9 ? "dirt" : v < -1 ? "sand" : "grass"); } });
  const fGpu = createGpuGround(gl, { palette, seed: 1 });
  const fT = createGpuTerrain(fGpu, { terrain: flat, surface, prefetch: 0, seed: 1 });
  fT.preload();
  const hx = 3.5, hz = 2.5, hy = 4;
  const flatCpu = createGroundBaker({ terrain: flat, palette, style: { name: "pixel" }, surface, prefetch: 0, seed: 1, floor: 2 });
  const buildings: Array<{ k: number; pitch: number; pixels: number; hiddenFootprint: number; hiddenMiddle: number; cpuExact: number; cpuStandIn: number }> = [];
  const insts = new LayerInstances(256);
  const looks = createLookTable();
  sr.setLooks({ palette: looks.palette(), paints: looks.paintTexture(), looks: looks.texture() });
  for (const [k, pitch] of [[4, 0.72], [8, 0.72], [11.3, 0.72], [16, 0.72], [22.6, 0.5], [32, 0.5], [45.3, 0.5], [64, 0.5], [90.5, 0.5], [128, 0.5], [16, 0.5], [64, 0.72]] as const) {
    const view = viewAt(64, 64, pitch, k);
    const a = viewAxes({ yaw: 0, pitch, pixelsPerMetre: k });
    // Sites: a grid every 14 m round the view's middle (two footprints apart), on the flat map.
    const sites: Array<[number, number]> = [];
    for (let dz = -5; dz <= 5; dz += 1) for (let dx = -8; dx <= 8; dx += 1) { const x = 64 + dx * 14 + 0.37, z = 64 + dz * 14 + 0.61; if (x > 8 && z > 8 && x < 248 && z < 248) sites.push([x, z]); }
    // The building's sprite at this scale: its box's silhouette (8 corners, their hull), its anchor the footprint's middle.
    const pts: Array<[number, number]> = [];
    for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) { const p = [sx * hx, sy * hy, sz * hz] as const; pts.push([(p[0] * a.right[0] + p[2] * a.right[2]) * k, -(p[0] * a.up[0] + p[1] * a.up[1] + p[2] * a.up[2]) * k]); }
    const minX = Math.floor(Math.min(...pts.map((p) => p[0]))) - 1, maxX = Math.ceil(Math.max(...pts.map((p) => p[0]))) + 1;
    const minY = Math.floor(Math.min(...pts.map((p) => p[1]))) - 1, maxY = Math.ceil(Math.max(...pts.map((p) => p[1]))) + 1;
    const sw = maxX - minX, sh = maxY - minY;
    const hull = convexHull(pts);
    const rgba = new Uint8Array(sw * sh * 4);
    for (let y = 0; y < sh; y += 1) for (let x = 0; x < sw; x += 1) if (insideHull(hull, x + minX + 0.5, y + minY + 0.5)) { const o = (y * sw + x) * 4; rgba[o] = 255; rgba[o + 1] = 0; rgba[o + 2] = 255; rgba[o + 3] = 255; }
    sr.setPages([{ width: Math.max(sw, 16), height: Math.max(sh, 16), rgba: pad(rgba, sw, sh, Math.max(sw, 16), Math.max(sh, 16)) }]);
    const draw = (footprint: boolean, depth: boolean, ground: "gpu" | "cpu" | "standin" = "gpu"): Uint8Array => {
      insts.clear();
      const fp = footprint ? footprintToward(a, hx, hz, 0) : 0;
      for (const [x, z] of sites) {
        const p = spritePosition(a, [x, flat.heightAt(x, z), z], [0, 0, 0], fp);
        insts.push(p[0], p[1], p[2], 0, 0, sw, sh, -minX, -minY, 0, -1, 0, 1);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (depth) {
        if (ground === "gpu") fGpu.draw(view, { clear: [0, 0, 0] });
        else {
          // (The CPU bake: its own scale baked (exact), or only the floor's 2 px/m layers standing in, drawn k / 2 times bigger.)
          flatCpu.bakeFloor({ yaw: 0, pitch, pixelsPerMetre: 2 });
          flatCpu.plan({ ...view, pixelsPerMetre: ground === "cpu" ? Math.min(32, k) : 2 });
          for (let q = 0; q < 200 && !flatCpu.ready; q += 1) flatCpu.bake(1000);
          cpuGround.draw(view, flatCpu.layers(), { clear: [0, 0, 0] });
        }
        sr.drawLayers(view, insts, { clear: null, screen: 0, outline: 0 });
      }
      else sr.drawLayers(view, insts, { clear: [0, 0, 0], screen: 0, outline: 0 });
      return read();
    };
    const Rf = draw(true, false);
    const withFp = draw(true, true), withMid = draw(false, true), cpuE = draw(true, true, "cpu"), cpuS = draw(true, true, "standin");
    let pixels = 0, hf = 0, hm = 0, he = 0, hs = 0;
    const mag = (px: Uint8Array, o: number): boolean => px[o] === 255 && px[o + 1] === 0 && px[o + 2] === 255;
    for (let o = 0; o < W * H * 4; o += 4) { if (!mag(Rf, o)) continue; pixels += 1; if (!mag(withFp, o)) hf += 1; if (!mag(withMid, o)) hm += 1; if (!mag(cpuE, o)) he += 1; if (!mag(cpuS, o)) hs += 1; }
    buildings.push({ k, pitch, pixels, hiddenFootprint: hf, hiddenMiddle: hm, cpuExact: he, cpuStandIn: hs });
    await new Promise((r) => setTimeout(r, 0));
  }
  return { sweep, buildings };
}

const pad = (src: Uint8Array, w: number, h: number, W2: number, H2: number): Uint8Array => { const out = new Uint8Array(W2 * H2 * 4); for (let y = 0; y < h; y += 1) out.set(src.subarray(y * w * 4, (y + 1) * w * 4), y * W2 * 4); return out; };
function convexHull(p: Array<[number, number]>): Array<[number, number]> {
  const s = p.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Array<[number, number]> = [], hi: Array<[number, number]> = [];
  for (const q of s) { while (lo.length >= 2 && cross(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (const q of s.slice().reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2]!, hi[hi.length - 1]!, q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
function insideHull(h: Array<[number, number]>, x: number, y: number): boolean {
  for (let i = 0; i < h.length; i += 1) { const a = h[i]!, b = h[(i + 1) % h.length]!; if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false; }
  return true;
}
