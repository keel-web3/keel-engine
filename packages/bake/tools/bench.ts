// The sprite bench: N units wander a 512 m map; each frame moves them, culls
// to the view through the grid, fills instances and draws -- timed with the
// GPU finished, at several unit counts and picture sizes. (Synthetic sprites:
// little pixel creatures in 8 directions, so the measurement is the engine's
// frame cost, not any one pack's.)
import { createGrid, createSpriteRenderer, directionFor, packAtlas, pixelView, SpriteInstances } from "../src/index.ts";

type Result = { units: number; size: string; visible: number; msCpu: number; msFrame: number; fps: number };

function makeSprites() {
  // 6 designs x 8 directions: a body, a head facing the direction, a team stripe.
  const W = 16, H = 20;
  const rects = [], pix: Uint8Array[] = [];
  for (let d = 0; d < 6; d += 1) for (let dir = 0; dir < 8; dir += 1) {
    const px = new Uint8Array(W * H * 4);
    const hue = d * 60;
    const set = (x: number, y: number, r: number, g: number, b: number) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 4; px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255; };
    const c = (l: number) => { const k = (n: number) => { const a = 0.6 * Math.min(l, 1 - l); const q = (n + hue / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(q - 3, 9 - q, 1)))); }; return [k(0), k(8), k(4)] as const; };
    for (let y = 8; y < 18; y += 1) for (let x = 4; x < 12; x += 1) { const [r, g, b] = c(x < 6 ? 0.35 : 0.55); set(x, y, r, g, b); }
    const ang = (dir / 8) * Math.PI * 2;
    const hx = 8 + Math.round(Math.sin(ang) * 2), hy = 5;
    for (let y = hy - 3; y <= hy + 2; y += 1) for (let x = hx - 3; x <= hx + 2; x += 1) { const [r, g, b] = c(0.7); set(x, y, r, g, b); }
    set(hx - 1 + Math.round(Math.sin(ang)), hy - 1, 20, 20, 30); set(hx + 1 + Math.round(Math.sin(ang)), hy - 1, 20, 20, 30);
    for (let x = 4; x < 12; x += 1) set(x, 12, 230, 60, 60);
    rects.push({ w: W, h: H }); pix.push(px);
  }
  const atlas = packAtlas(rects, { size: 256, pad: 1 });
  const pages = atlas.pages.map((p) => ({ width: p.w, height: p.h, rgba: new Uint8Array(p.w * p.h * 4) }));
  atlas.places.forEach((pl, i) => { const page = pages[pl.page]!; for (let y = 0; y < H; y += 1) page.rgba.set(pix[i]!.subarray(y * W * 4, (y + 1) * W * 4), ((pl.y + y) * page.width + pl.x) * 4); });
  return { atlas, pages, W, H };
}

type BenchOptions = {
  readonly canvas: HTMLCanvasElement;
  readonly counts: number[];
  readonly sizes: Array<[number, number]>;
  readonly viewMetres?: number;
};

export async function bench({ canvas, counts, sizes, viewMetres = 30 }: BenchOptions): Promise<Result[]> {
  const { atlas, pages, W, H } = makeSprites();
  const results: Result[] = [];
  for (const [w, h] of sizes) {
    const sr = createSpriteRenderer(canvas, { width: w, height: h, capacity: 65536 });
    sr.setPages(pages);
    for (const N of counts) {
      let a = 12345;
      const f = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
      const x = new Float32Array(N), z = new Float32Array(N), yaw = new Float32Array(N), design = new Uint8Array(N);
      for (let i = 0; i < N; i += 1) { x[i] = f() * 512; z[i] = f() * 512; yaw[i] = f() * 6.28; design[i] = Math.floor(f() * 6); }
      const grid = createGrid({ cell: 8, capacity: N });
      const inst = new SpriteInstances(65536);
      const vis: number[] = [];
      const frames = 120;
      let cpu = 0;
      const t0 = performance.now();
      for (let fr = 0; fr < frames; fr += 1) {
        const c0 = performance.now();
        // Move everyone (a steering stand-in), re-grid, cull, fill.
        for (let i = 0; i < N; i += 1) { yaw[i] = yaw[i]! + (f() - 0.5) * 0.2; x[i] = (x[i]! + Math.sin(yaw[i]!) * 0.05 + 512) % 512; z[i] = (z[i]! + Math.cos(yaw[i]!) * 0.05 + 512) % 512; grid.set(i, x[i]!, z[i]!, 0.5); }
        const view = pixelView({ center: [256 + Math.sin(fr / 40) * 20, 0, 256], yaw: 0.3, pitch: 0.7, pixelsPerMetre: w / viewMetres, width: w, height: h });
        const [x0, z0, x1, z1] = view.groundRect(2);
        vis.length = 0; grid.rect(x0, z0, x1, z1, vis);
        inst.clear();
        for (const i of vis) {
          const s = design[i]! * 8 + directionFor(yaw[i]!, view.yaw, 8);
          const pl = atlas.places[s]!;
          inst.push(x[i]!, 0, z[i]!, pl.x, pl.y, W, H, W / 2, H - 1, pl.page);
        }
        cpu += performance.now() - c0;
        sr.draw(view, inst);
      }
      sr.gl.finish();
      const ms = (performance.now() - t0) / frames;
      results.push({ units: N, size: `${w}x${h}@${viewMetres}m`, visible: vis.length, msCpu: +(cpu / frames).toFixed(2), msFrame: +ms.toFixed(2), fps: Math.round(1000 / ms) });
    }
  }
  return results;
}
