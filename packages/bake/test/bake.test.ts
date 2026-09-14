import { test } from "node:test";
import assert from "node:assert/strict";
import { createGrid, directionFor, packAtlas, pixelView, planBake } from "../src/index.ts";

// A tiny seeded stream for the tests.
const rng = (seed: number) => { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

test("grid queries match brute force, through moves and removals", () => {
  const f = rng(7);
  const N = 3000;
  const grid = createGrid({ cell: 4, capacity: N });
  const pos = Array.from({ length: N }, () => [f() * 400 - 200, f() * 400 - 200, f() * 1.5] as [number, number, number]);
  pos.forEach(([x, z, r], id) => grid.set(id, x, z, r));
  const alive = new Set(pos.map((_, i) => i));
  for (let round = 0; round < 40; round += 1) {
    // Move a third, remove a few.
    for (let k = 0; k < N / 3; k += 1) { const id = Math.floor(f() * N); if (!alive.has(id)) continue; const p = pos[id]!; p[0] += f() * 10 - 5; p[1] += f() * 10 - 5; grid.set(id, p[0], p[1], p[2]); }
    for (let k = 0; k < 5; k += 1) { const id = Math.floor(f() * N); if (alive.delete(id)) grid.remove(id); }
    const qx = f() * 300 - 150;
    const qz = f() * 300 - 150;
    const rad = f() * 25;
    const brute = [...alive].filter((id) => { const [x, z, r] = pos[id]!; return Math.hypot(x - qx, z - qz) <= rad + r; }).sort((a, b) => a - b);
    assert.deepEqual(grid.near(qx, qz, rad).sort((a, b) => a - b), brute);
    const [x0, z0, x1, z1] = [qx - rad, qz - rad * 0.5, qx + rad * 1.5, qz + rad];
    const bruteRect = [...alive].filter((id) => { const [x, z, r] = pos[id]!; const cx = Math.max(x0, Math.min(x, x1)); const cz = Math.max(z0, Math.min(z, z1)); return Math.hypot(x - cx, z - cz) <= r; }).sort((a, b) => a - b);
    assert.deepEqual(grid.rect(x0, z0, x1, z1).sort((a, b) => a - b), bruteRect);
    const nb = grid.nearest(qx, qz, 60);
    let best = -1; let bd = Infinity;
    for (const id of alive) { const [x, z, r] = pos[id]!; const d = Math.hypot(x - qx, z - qz) - r; if (d < bd || (d === bd && id < best)) { bd = d; best = id; } }
    assert.equal(nb, bd <= 60 ? best : -1);
  }
  assert.equal(grid.size, alive.size);
});

test("grid queries are fast enough for thousands of units a frame", () => {
  const f = rng(3);
  const N = 4096;
  const grid = createGrid({ cell: 4, capacity: N });
  for (let id = 0; id < N; id += 1) grid.set(id, f() * 512, f() * 512, 0.6);
  const out: number[] = [];
  const t0 = performance.now();
  // Every unit moves and looks for neighbours once: an RTS frame's separation pass.
  for (let id = 0; id < N; id += 1) { grid.set(id, f() * 512, f() * 512, 0.6); out.length = 0; grid.near(f() * 512, f() * 512, 3, out); }
  const ms = performance.now() - t0;
  if (process.env["KEEL_PERF"] === "1") assert.ok(ms < 40, `${ms.toFixed(1)} ms for ${N} moves + queries`);
});

test("atlases pack without overlaps, deterministically, and open pages when full", () => {
  const f = rng(11);
  const rects = Array.from({ length: 900 }, () => ({ w: 4 + Math.floor(f() * 40), h: 6 + Math.floor(f() * 48) }));
  const a = packAtlas(rects, { size: 512, pad: 1 });
  const b = packAtlas(rects, { size: 512, pad: 1 });
  assert.deepEqual(a, b, "same sprites, same atlas");
  assert.ok(a.pages.length > 1, "several pages");
  // No two overlap on a page, and all are inside it.
  const byPage = new Map<number, Array<[number, number, number, number]>>();
  a.places.forEach((p, i) => { const r = rects[i]!; assert.ok(p.x + r.w <= 512 && p.y + r.h <= 512); (byPage.get(p.page) ?? byPage.set(p.page, []).get(p.page)!).push([p.x, p.y, p.x + r.w + 1, p.y + r.h + 1]); });
  for (const list of byPage.values()) {
    for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
      const [a0, a1, a2, a3] = list[i]!; const [b0, b1, b2, b3] = list[j]!;
      assert.ok(a2 <= b0 || b2 <= a0 || a3 <= b1 || b3 <= a1, "overlap");
    }
  }
  assert.ok(a.fill > 0.7, `fill ${a.fill.toFixed(2)}`);
});

test("bake plans share designs and key sprites by everything that changes their pixels", () => {
  const plan = planBake([
    { key: "packs/animals/dog#7", clips: [{ name: "walk", frames: 8, loop: true }, { name: "idle", frames: 4, loop: true }], height: 0.7, radius: 0.4 },
    { key: "packs/animals/dog#7", clips: [{ name: "walk", frames: 8 }], height: 0.7, radius: 0.4 },
    { key: "props/barrel#1", clips: [{ name: "still", frames: 1 }], height: 1, radius: 0.4, symmetric: true },
  ], { directions: 8, pixelsPerMetre: 24, style: "night" });
  assert.equal(plan.perDesign.get("packs/animals/dog#7"), 12 * 8);
  assert.equal(plan.perDesign.get("props/barrel#1"), 1);
  assert.equal(plan.sprites.length, 97);
  assert.equal(new Set(plan.sprites.map((s) => s.key)).size, plan.sprites.length, "unique keys");
  assert.ok(plan.sprites.every((s) => s.key.includes("night") && s.key.includes("|24|")));
});

test("the direction shown: front toward the camera is direction 0, and it turns the right way", () => {
  const cam = 0; // (looking along +z)
  assert.equal(directionFor(Math.PI, cam, 8), 0, "facing the camera");
  assert.equal(directionFor(0, cam, 8), 4, "facing away");
  assert.equal(directionFor(Math.PI + Math.PI / 4, cam, 8), 1);
});

test("the pixel view: ground and project invert; the centre is the picture's middle; culling covers the picture", () => {
  const f = rng(5);
  for (let i = 0; i < 200; i += 1) {
    const v = pixelView({ center: [f() * 100, 0, f() * 100], yaw: f() * 6.28, pitch: 0.3 + f() * 0.8, pixelsPerMetre: 8 + f() * 40, width: 320, height: 180 });
    const [px, py] = v.project(v.center);
    assert.ok(Math.abs(px - 160) < 1e-9 && Math.abs(py - 90) < 1e-9);
    const sx = f() * 320;
    const sy = f() * 180;
    const g = v.ground(sx, sy);
    const [bx, by] = v.project(g);
    assert.ok(Math.abs(bx - sx) < 1e-6 && Math.abs(by - sy) < 1e-6, "ground -> project round-trips");
    // Everything projected inside the picture lies inside groundRect.
    const [x0, z0, x1, z1] = v.groundRect();
    assert.ok(g[0] >= x0 - 1e-6 && g[0] <= x1 + 1e-6 && g[2] >= z0 - 1e-6 && g[2] <= z1 + 1e-6);
    // Screen right is the camera's right, and a point up the screen is farther from the camera.
    assert.ok(v.project([v.center[0] + v.axes.right[0], 0, v.center[2] + v.axes.right[2]])[0] > 160);
    const far = v.project([v.center[0] + Math.sin(v.yaw) * 5, 0, v.center[2] + Math.cos(v.yaw) * 5]);
    assert.ok(far[1] < 90 && far[2] < 0, "ahead of the camera: up the picture, farther away");
  }
});
