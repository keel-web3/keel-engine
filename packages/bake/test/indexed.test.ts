// Indexed sprites: the texel encoding, the trim, and the indexed bake through
// a software stand-in for the renderer's bake mode (the GPU side -- INDEX_FS,
// BAKE_WORLD_FS -- is keel/render's, tested there and on the page).

import { test } from "node:test";
import assert from "node:assert/strict";
import { SLOTS, SLOT_MAT, bakeCamera, decodeTexel, encodeTexel, planBake, renderIndexedSprites, slotWorld, trimIndexed } from "../src/index.ts";
import type { IndexedSource } from "../src/index.ts";
import { softIndexed } from "./soft-indexed.ts";

test("a texel round-trips: slot, edge, shade, surface coordinate; slot 0 is not empty", () => {
  for (let slot = 0; slot < SLOTS; slot += 1) for (const edge of [false, true]) for (const behind of [false, true]) for (const [shade, u, v] of [[0, 0, 0], [255, 255, 255], [17, 128, 3], [200.4, 99.6, 250]]) {
    const bytes = encodeTexel({ slot, edge, behind, shade: shade!, u: u!, v: v! });
    assert.ok(bytes[0] !== 0, "never the empty texel");
    assert.deepEqual(decodeTexel(...bytes), { slot, edge, behind, shade: Math.round(shade!), u: Math.round(u!), v: Math.round(v!) });
  }
  assert.equal(decodeTexel(0, 9, 9, 9), null);
  assert.throws(() => encodeTexel({ slot: SLOTS, edge: false, shade: 0, u: 0, v: 0 }), /Slot/);
  // Slots ride on the renderer's materials from SLOT_MAT.
  const w = slotWorld({ capsules: [{ a: [0, 0, 0], b: [0, 1, 0], r: 0.1, mat: 3 }], boxes: [{ c: [0, 0, 0], h: [1, 1, 1], mat: 31 }] });
  assert.equal(w.capsules![0]!.mat, SLOT_MAT + 3);
  assert.equal(w.boxes![0]!.mat, SLOT_MAT + 31);
  assert.ok(SLOT_MAT + SLOTS - 1 <= 31, "every slot's material fits INDEX_FS's five bits");
});

test("trimming an index picture: covered pixels only, slot back from the material, the edge flag carried, the anchor kept", () => {
  const W = 12, H = 10, SW = 20;
  const buf = new Uint8Array(SW * 16 * 4); // (a picture at (4, 2), bottom row first)
  const put = (x: number, y: number, mat: number, edge: boolean, shade: number, u: number, v: number, behind = false) => { const o = ((2 + H - 1 - y) * SW + 4 + x) * 4; buf.set([128 + (edge ? 64 : 0) + (behind ? 32 : 0) + mat, shade, u, v], o); };
  put(3, 2, SLOT_MAT + 5, false, 120, 10, 20, true);
  put(8, 7, SLOT_MAT + 0, true, 40, 250, 1);
  buf.set([0, 77, 77, 77], ((2 + H - 1 - 5) * SW + 4 + 5) * 4); // (not covered: ignored however it reads)
  const s = trimIndexed("k", buf, SW, 4, 2, W, H, 6, 9);
  assert.deepEqual([s.w, s.h, s.ax, s.ay], [6, 6, 3, 7]);
  const at = (x: number, y: number) => decodeTexel(...(Array.from(s.rgba.subarray((y * s.w + x) * 4, (y * s.w + x) * 4 + 4)) as [number, number, number, number]));
  assert.deepEqual(at(0, 0), { slot: 5, edge: false, behind: true, shade: 120, u: 10, v: 20 });
  assert.deepEqual(at(5, 5), { slot: 0, edge: true, behind: false, shade: 40, u: 250, v: 1 });
  assert.equal(at(2, 3), null);
});

test("renderIndexedSprites: every job drawn in bake mode, slots and coordinates back per texel, anchored", () => {
  const src: IndexedSource = { pose: () => ({ capsules: [{ a: [0, 0.02, 0], b: [0, 0.02, 0], r: 0.05, mat: 2 }, { a: [0, 1, 0], b: [0, 1, 0], r: 0.09, mat: 17 }] }) };
  const plan = planBake([{ key: "d", clips: [{ name: "c", frames: 2 }], height: 1.2, radius: 0.4 }], { directions: 4, pixelsPerMetre: 20, pitch: 0.6 });
  const R = softIndexed();
  const r = renderIndexedSprites(R, plan.sprites, new Map([["d", src]]), { staging: 64, distance: 80, compensate: false });
  assert.equal(R.draws, 8);
  assert.equal(r.baked.length, 8);
  for (const s of r.baked) {
    const texels: Array<[number, number, NonNullable<ReturnType<typeof decodeTexel>>]> = [];
    for (let y = 0; y < s.h; y += 1) for (let x = 0; x < s.w; x += 1) { const t = decodeTexel(s.rgba[(y * s.w + x) * 4]!, s.rgba[(y * s.w + x) * 4 + 1]!, s.rgba[(y * s.w + x) * 4 + 2]!, s.rgba[(y * s.w + x) * 4 + 3]!); if (t) texels.push([x, y, t]); }
    assert.deepEqual(texels.map(([, , t]) => t.slot).sort((a, b) => a - b), [2, 17]);
    const foot = texels.find(([, , t]) => t.slot === 2)!;
    assert.ok(Math.abs(foot[0] - s.ax) <= 1 && Math.abs(foot[1] - s.ay) <= 1, "the foot is at the anchor");
    assert.equal(texels.find(([, , t]) => t.slot === 17)![2].u, 9, "the surface coordinate carried");
    const cam = bakeCamera(plan.sprites.find((j) => j.key === s.key)!, { distance: 80 });
    assert.ok(cam.width >= s.w && cam.height >= s.h);
  }
});

test("the bake queue: most wanted design first, a design's jobs together, no job twice, cleared by scale", async () => {
  const { createBakeQueue } = await import("../src/index.ts");
  const plan = planBake([{ key: "a", clips: [{ name: "c", frames: 2 }], height: 1, radius: 0.3 }, { key: "b", clips: [{ name: "c", frames: 2 }], height: 1, radius: 0.3 }], { directions: 2, pixelsPerMetre: 8 });
  const other = planBake([{ key: "a", clips: [{ name: "c", frames: 2 }], height: 1, radius: 0.3 }], { directions: 2, pixelsPerMetre: 16 });
  const q = createBakeQueue();
  q.enqueue(plan.sprites, 0);
  q.enqueue(plan.sprites, 0);
  assert.equal(q.size(), 8, "no job twice");
  q.prioritise("b", 5);
  const first = q.take(3);
  assert.deepEqual(first.map((j) => j.design), ["b", "b", "b"]);
  assert.equal(q.size("b"), 1);
  q.enqueue(other.sprites, 9);
  assert.deepEqual(q.take(4).map((j) => `${j.design}@${j.pixelsPerMetre}`), ["a@8", "a@8", "a@8", "a@8"], "a's bucket now leads (its queued jobs go first, in order)");
  assert.equal(q.clear((j) => j.pixelsPerMetre === 16), 4);
  assert.deepEqual(q.take(10).map((j) => j.design), ["b"]);
  assert.equal(q.size(), 0);
});
