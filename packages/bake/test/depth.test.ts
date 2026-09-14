// Depth sprites (src/depth.ts): the one occlusion model's maths -- a texel's pixel and height give the depth of the
// point it shows, exactly; the ground under a thing never hides it; picking by what's drawn; the layer table; the
// height bytes through trim, atlas and codec; the analytic ray against a design's solids.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HEIGHT_STEPS, OCCLUSION_LAYERS, anchorPixel, atlasOf, boundsRect, decodeBake, decodeHeight, depthKappa, designBounds, encodeBake, encodeHeight, heightAt, layerOf, overlayShows, pickSprite, pixelPoint,
  pixelView, placeWorld, placedBounds, pointDepth, rayBox, rayCapsule, raycastWorld, rayWedge, spriteTexelAt, spritesOf, texelDepth, trimIndexed,
} from "../src/index.ts";
import type { BakeWorld, DepthAxis, PickSprite, PixelView } from "../src/index.ts";

const rng = (seed: number) => { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const views = (): PixelView[] => {
  const out: PixelView[] = [];
  for (const pitch of [0.5, Math.asin(0.5), 0.7, 0.95]) for (const yaw of [0, Math.PI / 4, 2.1]) for (const k of [8, 24, 48]) out.push(pixelView({ center: [3.3, 0.4, -1.7], yaw, pitch, pixelsPerMetre: k, width: 480, height: 270 }));
  return out;
};
const groundDepth = (v: PixelView, p: readonly [number, number, number]) => { const cp = v.axes.up[1], f = v.axes.forward; return cp * (p[0] * f[0] / cp + p[2] * f[2] / cp) - (v.center[0] * f[0] + v.center[1] * f[1] + v.center[2] * f[2]); };

test("depth sprites: a texel's pixel and height give its point's depth exactly, on both axes", () => {
  const f = rng(3);
  for (const v of views()) for (let n = 0; n < 60; n += 1) {
    const A: [number, number, number] = [f() * 20 - 10, f() * 3 - 1, f() * 20 - 10];
    // (A point somewhere on a thing anchored at A: up to 2 m off it, up to 4 m above.)
    const P: [number, number, number] = [A[0] + f() * 4 - 2, A[1] + f() * 4, A[2] + f() * 4 - 2];
    const row = v.project(P)[1];
    for (const axis of ["view", "ground"] as DepthAxis[]) {
      const want = axis === "view" ? pointDepth(v, P, "view") : groundDepth(v, P);
      const got = texelDepth(v, A, row, P[1] - A[1], axis);
      assert.ok(Math.abs(got - want) < 1e-9, `${axis}: ${got} vs ${want}`);
    }
    // (pixelPoint inverts it: the ray through that pixel at that height is the point.)
    const [px, py] = v.project(P);
    const Q = pixelPoint(v, px, py, P[1]);
    assert.ok(Math.hypot(Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]) < 1e-9);
  }
});

test("depth sprites: the ground under a thing never hides it (a height >= 0 is at or before the ground its pixel meets)", () => {
  const f = rng(9);
  for (const v of views()) for (let n = 0; n < 200; n += 1) {
    const A: [number, number, number] = [f() * 20 - 10, f() * 2, f() * 20 - 10];
    const row = anchorPixel(v, A)[1] + (f() * 60 - 30) + 0.5;
    const y = f() < 0.3 ? 0 : f() * 3;
    const px = v.width / 2;
    for (const axis of ["view", "ground"] as DepthAxis[]) {
      const ground = axis === "view" ? pointDepth(v, pixelPoint(v, px, row, A[1]), "view") : groundDepth(v, pixelPoint(v, px, row, A[1]));
      const texel = texelDepth(v, A, row, y, axis);
      assert.ok(texel <= ground + 1e-9, `${axis} y ${y}: texel ${texel} behind the ground ${ground}`);
      if (y === 0) assert.ok(Math.abs(texel - ground) < 1e-9, "on the ground: a tie (the sprite's tie bias decides it)");
    }
  }
  assert.equal(depthKappa("view", 0.8), 1);
  assert.ok(Math.abs(depthKappa("ground", 0.8) - 0.64) < 1e-12);
});

test("depth sprites: the anchor's snap to a whole pixel drops out (the depth follows the pixel as drawn)", () => {
  const v = pixelView({ center: [0, 0, 0], yaw: Math.PI / 4, pitch: Math.asin(0.5), pixelsPerMetre: 24, width: 480, height: 270 });
  // (Two anchors a third of a pixel apart snap to the same pixel: a texel on the same row at the same height has one depth -- the point it shows.)
  const A: [number, number, number] = [1, 0, 1];
  const B: [number, number, number] = [1 + 0.33 / 24 * v.axes.up[0] / (v.axes.up[0] ** 2 + v.axes.up[2] ** 2) * 0.2, 0, 1];
  assert.deepEqual(anchorPixel(v, A), anchorPixel(v, B));
  const row = anchorPixel(v, A)[1] - 10.5;
  const yA = texelDepth(v, A, row, 0.3), yB = texelDepth(v, B, row, 0.3);
  assert.ok(Math.abs(yA - yB) < 1e-9);
});

test("heights: 16 bits a texel, sixteenths of a texel plus one, 0 none; exact on the ground", () => {
  assert.equal(encodeHeight(0), 1);
  assert.equal(decodeHeight(1), 0);
  assert.ok(Number.isNaN(decodeHeight(0)));
  for (let t = 0; t < 4000; t += 0.37) assert.ok(Math.abs(decodeHeight(encodeHeight(t)) - t) <= 0.5 / HEIGHT_STEPS + 1e-9);
  assert.equal(encodeHeight(1e9), 65535);
  assert.equal(encodeHeight(-5), 1);
  const plane = new Uint8Array([0x12, 0x34, 0, 1]);
  assert.equal(heightAt(plane, 0), 0x1234);
  assert.equal(heightAt(plane, 1), 1);
});

test("heights: trimmed with their sprite, packed into the atlas, through the bake codec", () => {
  // A 6 x 5 picture (bottom row first), texels in a 3 x 2 box; heights as HEIGHT_FS writes them (sixteenths + 1).
  const W = 6, H = 5, src = new Uint8Array(W * H * 4), hs = new Uint8Array(W * H * 4);
  const put = (x: number, yTop: number, texels: number) => { const o = ((H - 1 - yTop) * W + x) * 4; src[o] = 128 | 3; src[o + 1] = 200; const v = encodeHeight(texels); hs[o] = v >> 8; hs[o + 1] = v & 255; };
  put(2, 1, 0); put(3, 1, 1.5); put(4, 1, 3); put(2, 2, 0); put(3, 2, 0.5); put(4, 2, 2);
  const s = trimIndexed("k", src, W, 0, 0, W, H, 3, 3, false, hs);
  assert.equal(s.w, 3); assert.equal(s.h, 2);
  assert.ok(s.heights);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => decodeHeight(heightAt(s.heights!, i))), [0, 1.5, 3, 0, 0.5, 2]);
  const plain = trimIndexed("p", src, W, 0, 0, W, H, 3, 3);
  assert.equal(plain.heights, undefined);
  const atlas = atlasOf([s, plain]);
  assert.ok(atlas.pages[0]!.heights);
  const r = atlas.sprites.get("k")!;
  assert.equal(heightAt(atlas.pages[0]!.heights!, r.y * atlas.pages[0]!.width + r.x + 2), heightAt(s.heights!, 2));
  const rp = atlas.sprites.get("p")!;
  assert.equal(heightAt(atlas.pages[0]!.heights!, rp.y * atlas.pages[0]!.width + rp.x), 0, "a sprite without heights leaves 0s: drawn as before");
  const saved = { format: "keel-bake@1" as const, pages: atlas.pages, table: [...atlas.sprites].map(([k, q]) => [k, q.page, q.x, q.y, q.w, q.h, q.ax, q.ay] as const) };
  const back = spritesOf(decodeBake(encodeBake(saved)));
  assert.deepEqual([...back.find((b) => b.key === "k")!.heights!], [...s.heights!]);
  // (Without heights the codec's bytes are as they were.)
  const flat = atlasOf([plain]);
  assert.equal(flat.pages[0]!.heights, undefined);
  const bytes = encodeBake({ format: "keel-bake@1", pages: flat.pages, table: [...flat.sprites].map(([k, q]) => [k, q.page, q.x, q.y, q.w, q.h, q.ax, q.ay] as const) });
  assert.ok(!new TextDecoder().decode(bytes.subarray(8, 8 + new DataView(bytes.buffer).getUint32(4, true))).includes("heights"));
});

test("picking by what's drawn: the nearest texel wins, as the depth test did", () => {
  const v = pixelView({ center: [0, 0, 0], yaw: Math.PI / 4, pitch: Math.asin(0.5), pixelsPerMetre: 24, width: 320, height: 200 });
  // Two 10 x 20 sprites, every texel there, standing as cards (heights: rows above their anchors, over cos pitch).
  const card = (at: [number, number, number]): PickSprite => {
    const w = 10, h = 20, rgba = new Uint8Array(w * h * 4), heights = new Uint8Array(w * h * 2);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) { rgba[(y * w + x) * 4] = 1; const hv = encodeHeight((h - 1 - y + 0.5) / v.axes.up[1]); heights[(y * w + x) * 2] = hv >> 8; heights[(y * w + x) * 2 + 1] = hv & 255; }
    return { at, w, h, ax: 5, ay: 19, rgba, heights };
  };
  const back = card([0.3, 0, 0.3]), front = card([-0.3, 0, -0.3]);
  const [ax, ay] = anchorPixel(v, front.at);
  assert.equal(pickSprite(v, [back, front], ax, ay - 8), 1, "the front one");
  assert.equal(pickSprite(v, [front, back], ax, ay - 8), 0, "whatever the order");
  assert.equal(pickSprite(v, [back, front], ax + 60, ay - 8), -1, "nothing there");
  assert.equal(pickSprite(v, [back, front], ax, ay - 8, { hiddenBy: () => true }), -1, "a wall before both: nothing");
  const t = spriteTexelAt(v, front, ax, ay - 8)!;
  assert.ok(t && t.y > 0);
});

test("footprints: a design's box turned and placed, and the picture rectangle it covers", () => {
  const world: BakeWorld = { boxes: [{ c: [0, 0.5, 0], h: [1, 0.5, 0.25] }], capsules: [{ a: [0, 1, 0], b: [0, 1.6, 0], r: 0.2 }] };
  const b = designBounds(world);
  assert.deepEqual(b.map((x) => +x.toFixed(6)), [-1, 0, -0.25, 1, 1.8, 0.25]);
  const p = placedBounds(b, [10, 0, 5], Math.PI / 2);
  assert.deepEqual(p.map((x) => +x.toFixed(6)), [9.75, 0, 4, 10.25, 1.8, 6]);
  const v = pixelView({ center: [10, 0, 5], yaw: 0, pitch: 0.6, pixelsPerMetre: 16, width: 200, height: 200 });
  const r = boundsRect(v, p);
  assert.ok(r[0] < 100 && r[2] > 100 && r[1] < 100 && r[3] > 100);
});

test("the layers: one table, in order, with fixed depth rules", () => {
  assert.deepEqual(OCCLUSION_LAYERS.map((l) => l.name), ["ground", "decals", "objects", "translucent", "through", "overlays", "fog", "ui"]);
  // (Nothing standing is ever hidden by a decal: decals never write depth. Only ground and objects write.)
  assert.deepEqual(OCCLUSION_LAYERS.filter((l) => l.write).map((l) => l.name), ["ground", "objects"]);
  assert.equal(layerOf("through").test, "greater");
  assert.equal(layerOf("translucent").sort, "back-to-front");
  for (const n of ["overlays", "fog", "ui"] as const) assert.equal(layerOf(n).test, "none");
  assert.equal(overlayShows(0), false);
  assert.equal(overlayShows(3), true);
  assert.equal(overlayShows(0, { selected: true }), true);
});

// A brute-force distance-field march: what keel/render draws.
function march(world: BakeWorld, o: readonly [number, number, number], d: readonly [number, number, number]): number {
  const sdBox = (p: number[], h: ArrayLike<number>) => { const q = [Math.abs(p[0]!) - h[0]!, Math.abs(p[1]!) - h[1]!, Math.abs(p[2]!) - h[2]!]; return Math.hypot(Math.max(q[0]!, 0), Math.max(q[1]!, 0), Math.max(q[2]!, 0)) + Math.min(Math.max(q[0]!, q[1]!, q[2]!), 0); };
  const sdf = (p: number[]) => {
    let m = Infinity;
    for (const b of world.boxes ?? []) { const c = Math.cos(b.yaw ?? 0), s = Math.sin(b.yaw ?? 0); const x = p[0]! - b.c[0]!, y = p[1]! - b.c[1]!, z = p[2]! - b.c[2]!; m = Math.min(m, sdBox([c * x - s * z, y, s * x + c * z], b.h)); }
    for (const c of world.capsules ?? []) { const ba = [c.b[0]! - c.a[0]!, c.b[1]! - c.a[1]!, c.b[2]! - c.a[2]!], pa = [p[0]! - c.a[0]!, p[1]! - c.a[1]!, p[2]! - c.a[2]!]; const bb = ba[0]! ** 2 + ba[1]! ** 2 + ba[2]! ** 2; const h = Math.max(0, Math.min(1, (pa[0]! * ba[0]! + pa[1]! * ba[1]! + pa[2]! * ba[2]!) / Math.max(bb, 1e-9))); m = Math.min(m, Math.hypot(pa[0]! - ba[0]! * h, pa[1]! - ba[1]! * h, pa[2]! - ba[2]! * h) - c.r); }
    return m;
  };
  let t = 0;
  for (let i = 0; i < 400; i += 1) { const dd = sdf([o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t]); if (dd < 1e-6) return t; t += dd; if (t > 50) break; }
  return Infinity;
}

test("the analytic ray against a design's solids agrees with the distance-field march", () => {
  const f = rng(5);
  for (let n = 0; n < 300; n += 1) {
    const world: BakeWorld = {
      boxes: [{ c: [f() - 0.5, 0.5 + f(), f() - 0.5], h: [0.2 + f() * 0.5, 0.1 + f() * 0.4, 0.2 + f() * 0.5], yaw: f() * 6 }],
      capsules: [{ a: [f() - 0.5, f(), f() - 0.5], b: [f() - 0.5, 1 + f(), f() - 0.5], r: 0.05 + f() * 0.2 }, { a: [f(), 1.5, f()], b: [f(), 1.5, f()], r: 0.1 + f() * 0.2 }],
    };
    const o: [number, number, number] = [f() * 6 - 3, 3 + f() * 2, f() * 6 - 3];
    const aim: [number, number, number] = [f() - 0.5, 0.2 + f() * 1.3, f() - 0.5];
    const l = Math.hypot(aim[0] - o[0], aim[1] - o[1], aim[2] - o[2]);
    const d: [number, number, number] = [(aim[0] - o[0]) / l, (aim[1] - o[1]) / l, (aim[2] - o[2]) / l];
    const a = raycastWorld(world, o, d), b = march(world, o, d);
    if (Number.isFinite(a) || Number.isFinite(b)) assert.ok(Math.abs(a - b) < 2e-3, `ray ${n}: analytic ${a} vs march ${b}`);
  }
  // (A wedge: its foot at +z, lo x its height, the top at -z.)
  const w = { c: [0, 1, 0], h: [1, 1, 1], lo: 0, kind: "wedge" } as const;
  assert.ok(Math.abs(rayWedge(w, [0, 5, -0.5], [0, -1, 0]) - (5 - 1.5)) < 1e-9, "the slope over -z is high");
  assert.ok(Math.abs(rayWedge(w, [0, 5, 0.5], [0, -1, 0]) - (5 - 0.5)) < 1e-9, "and low over +z");
  assert.equal(rayWedge(w, [0, 5, 3], [0, -1, 0]), Infinity);
  assert.ok(Math.abs(rayBox({ c: [0, 0, 0], h: [1, 1, 1], yaw: Math.PI / 4 }, [0, 0, -5], [0, 0, 1]) - (5 - Math.SQRT2)) < 1e-9);
  assert.ok(Math.abs(rayCapsule([0, 0, 0], [0, 2, 0], 0.5, [0, 1, -5], [0, 0, 1]) - 4.5) < 1e-9);
  // (Placed: turned by the frame convention, +z toward (sin yaw, cos yaw).)
  const moved = placeWorld({ boxes: [{ c: [0, 0.5, 2], h: [0.1, 0.5, 0.1] }] }, [10, 0, 0], Math.PI / 2);
  assert.ok(Math.abs(raycastWorld(moved, [12, 3, 0], [0, -1, 0]) - 2) < 1e-9);
});
