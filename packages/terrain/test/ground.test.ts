import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyBridge, autoTile, bakeChunk, bridgeSpans, buildPathGrid, chunkBakeJob, chunksIn, composeGround, createGroundBaker, createTerrain, globalPixel, groundDepth, groundJob, groundKey,
  groundPalette, groundPriority, regions, spritePosition, tierPriority, viewAxes,
} from "../src/index.ts";
import type { GroundLayer, GroundStyle, GroundView } from "../src/index.ts";
import { randomTerrain } from "./helpers.ts";

const VIEW: GroundView = { yaw: 0, pitch: 0.6, pixelsPerMetre: 4 };
const PIXEL: GroundStyle = { name: "pixel" };

test("every texel is a palette entry (or empty), and chunks meet without a seam", () => {
  const t = randomTerrain(21, 48, 40, { chunk: 16 });
  const pal = groundPalette(t.types);
  const auto = autoTile(t);
  const layers: GroundLayer[] = [];
  for (let c = 0; c < t.chunksX * t.chunksZ; c += 1) layers.push(bakeChunk({ terrain: t, auto, chunk: c, view: VIEW, palette: pal, style: PIXEL }));
  for (const L of layers) for (let o = 0; o < L.w * L.h; o += 1) {
    const code = L.data[o * 4]! | (L.data[o * 4 + 1]! << 8);
    assert.ok(code === 0 || code - 1 < pal.colours.length);
  }
  // Compose the whole map: inside the map's picture, nothing is empty (no gaps between chunks).
  const a = viewAxes(VIEW);
  const [gxa] = globalPixel(a, [0, 0, 0]);
  const [gxb] = globalPixel(a, [t.width * t.tileSize, 0, 0]);
  const gyTop = Math.ceil(globalPixel(a, [0, 10, t.depth * t.tileSize])[1]);
  const gyBot = Math.floor(globalPixel(a, [0, 0, 0])[1]);
  const W = Math.floor(gxb - gxa), H = gyBot - gyTop;
  const pic = composeGround(layers, pal, { width: W, height: H, gx: Math.ceil(gxa), gy: gyTop });
  let holes = 0;
  // (Rows well inside the map: below its far edge's highest ground, above its near edge.)
  const y0 = Math.ceil(globalPixel(a, [0, 2, t.depth * t.tileSize - 2])[1]) - gyTop;
  for (let y = y0; y < H - 2; y += 1) for (let x = 2; x < W - 2; x += 1) if (pic.index[y * W + x] === -1) holes += 1;
  assert.equal(holes, 0, `${holes} empty pixels inside the map`);
});

test("depth: a texel's depth is its ground-plane depth; a cliff hides what's behind it", () => {
  const t = createTerrain({ width: 16, depth: 16, chunk: 16, level: 0 });
  // A wall of plateau 3 steps high across z = 6..7.
  for (let i = 0; i < 16; i += 1) for (const j of [6, 7]) t.setHeight(i, j, 3);
  const pal = groundPalette(t.types);
  const L = bakeChunk({ terrain: t, auto: autoTile(t), chunk: 0, view: VIEW, palette: pal, style: PIXEL });
  const a = viewAxes(VIEW);
  const pic = composeGround([L], pal, { width: L.w, height: L.h, gx: L.gx0, gy: L.gy0 });
  // The pixel where the ground behind the plateau (z = 17 m, y = 0) would be is covered by the plateau's top, nearer.
  const [gx, gy] = globalPixel(a, [16, 0, 17]);
  const o = (Math.floor(gy) - L.gy0) * L.w + (Math.floor(gx) - L.gx0);
  assert.ok(pic.depth[o]! < groundDepth(a, 16, 17) - 1, "the plateau hides the ground behind it");
  // A sprite standing behind the plateau (z = 17) gets a depth greater than the plateau's there: hidden.
  const p = spritePosition(a, [16, 0, 17]);
  const unitDepth = p[0] * a.forward[0] + p[1] * a.forward[1] + p[2] * a.forward[2];
  assert.ok(unitDepth > pic.depth[o]!);
  // A sprite on the plateau's top gets the ground-plane depth of where it stands, whatever its height.
  const q = spritePosition(a, [16, 3, 13]);
  assert.ok(Math.abs(q[0] * a.forward[0] + q[1] * a.forward[1] + q[2] * a.forward[2] - groundDepth(a, 16, 13)) < 1e-9);
  const g1 = globalPixel(a, [16, 3, 13]), g2 = globalPixel(a, q);
  assert.ok(Math.abs(g1[0] - g2[0]) < 1e-9 && Math.abs(g1[1] - g2[1]) < 1e-9, "the same pixel");
});

test("a bake in slices is the same bake; styles differ and so do their keys", () => {
  const t = randomTerrain(22, 32, 32, { chunk: 16 });
  const s = bridgeSpans(t, { regions: regions(buildPathGrid(t)).label })[0];
  if (s) applyBridge(t, s);
  const pal = groundPalette(t.types);
  const auto = autoTile(t);
  const whole = bakeChunk({ terrain: t, auto, chunk: 1, view: VIEW, palette: pal, style: PIXEL });
  const job = chunkBakeJob({ terrain: t, auto, chunk: 1, view: VIEW, palette: pal, style: PIXEL });
  let steps = 0;
  // (Zero-millisecond slices: a few faces or rows each.)
  while (!job.step(0)) steps += 1;
  const sliced = job.result();
  assert.ok(steps > 3, `baked in ${steps} slices`);
  assert.deepEqual([sliced.w, sliced.h, sliced.gx0, sliced.gy0], [whole.w, whole.h, whole.gx0, whole.gy0]);
  assert.ok(Buffer.from(sliced.data).equals(Buffer.from(whole.data)));
  const vox = bakeChunk({ terrain: t, auto, chunk: 1, view: VIEW, palette: pal, style: { name: "voxel", voxels: 2 } });
  assert.ok(!Buffer.from(vox.data).equals(Buffer.from(whole.data)));
  const custom: GroundStyle = { name: "custom", id: "stone-age", paint: (x) => (x.kind === "top" ? { ramp: "rock", t: x.t } : null) };
  const cus = bakeChunk({ terrain: t, auto, chunk: 1, view: VIEW, palette: pal, style: custom });
  assert.ok(!Buffer.from(cus.data).equals(Buffer.from(whole.data)));
  const keys = new Set([PIXEL, { name: "voxel", voxels: 2 } as GroundStyle, custom].map((st) => groundKey(t, 1, VIEW, st, pal.key)));
  assert.equal(keys.size, 3);
});

test("bake keys: an edit changes the keys of the chunks it reaches and no others; the scale is in the key", () => {
  const t = randomTerrain(23, 64, 64, { chunk: 16 });
  const pal = groundPalette(t.types);
  const before = Array.from({ length: t.chunksX * t.chunksZ }, (_, c) => groundKey(t, c, VIEW, PIXEL, pal.key));
  t.setHeight(20, 20, 9); // (inside chunk (1, 1), away from its borders)
  const after = Array.from({ length: t.chunksX * t.chunksZ }, (_, c) => groundKey(t, c, VIEW, PIXEL, pal.key));
  const changed = before.map((k, c) => (k !== after[c] ? c : -1)).filter((c) => c >= 0);
  assert.deepEqual(changed, [t.chunksX + 1]);
  // On a border: the neighbours too (their edges and outlines read two tiles round).
  t.setHeight(31, 20, 9);
  const again = Array.from({ length: t.chunksX * t.chunksZ }, (_, c) => groundKey(t, c, VIEW, PIXEL, pal.key));
  assert.deepEqual(after.map((k, c) => (k !== again[c] ? c : -1)).filter((c) => c >= 0), [t.chunksX + 1, t.chunksX + 2]);
  assert.notEqual(groundKey(t, 0, VIEW, PIXEL, pal.key), groundKey(t, 0, { ...VIEW, pixelsPerMetre: 8 }, PIXEL, pal.key));
  const j = groundJob(t, 0, VIEW, PIXEL, pal.key);
  assert.equal(j.tier, "background");
  assert.equal(j.design, `ground:${t.id}:0`);
});

test("priorities: visible chunks first, nearest the view's middle first, then the prefetch ring; tiers are bands", () => {
  const t = createTerrain({ width: 128, depth: 128, chunk: 16 });
  const list = chunksIn(t, [40, 40, 120, 100], 1, [80, 70]);
  const pr = list.map((c) => groundPriority(c.dist, c.ring));
  for (let n = 1; n < pr.length; n += 1) assert.ok(pr[n - 1]! >= pr[n]!, "sorted by priority");
  assert.ok(list[0]!.ring === 0 && list[list.length - 1]!.ring === 1);
  const firstRing = list.findIndex((c) => c.ring === 1);
  assert.ok(pr.slice(0, firstRing).every((p) => p > pr[firstRing]!));
  assert.ok(tierPriority("main", -1e6) > tierPriority("foreground", 1e6));
  assert.ok(tierPriority("foreground", -1e6) > tierPriority("background", 1e6));
});

test("the baker: plans a view, bakes the visible chunks first, stands a baked scale in for another, rebakes an edit", () => {
  const t = randomTerrain(24, 96, 96, { chunk: 16 });
  const pal = groundPalette(t.types);
  const baker = createGroundBaker({ terrain: t, palette: pal, style: PIXEL, prefetch: 1 });
  const view = { ...VIEW, center: [96, 0, 96] as [number, number, number], width: 160, height: 90 };
  const visible = baker.plan(view);
  assert.ok(visible.length > 0);
  assert.equal(baker.ready, false);
  // Bake the visible ones: they come off the queue before any prefetch chunk.
  let firstBaked: number[] = [];
  while (!baker.ready) { baker.bake(0); firstBaked = baker.layers().map((l) => l.chunk); }
  assert.deepEqual(new Set(firstBaked), new Set(visible));
  const bakedSoFar = baker.stats.baked;
  assert.ok(bakedSoFar <= visible.length + 1, `${bakedSoFar} baked for ${visible.length} visible (at most one prefetch in flight)`);
  // Zoom: the old scale stands in until the new one is baked.
  baker.plan({ ...view, pixelsPerMetre: 8 });
  const standIn = baker.layers();
  assert.ok(standIn.length > 0 && standIn.every((l) => l.k === 4));
  while (!baker.ready) baker.bake(50);
  assert.ok(baker.layers().every((l) => l.k === 8));
  // An edit: that chunk's layer is rebaked (new key), the rest stay.
  const keys = new Map(baker.layers().map((l) => [l.chunk, l.key]));
  const [ci0, cj0] = t.chunkRect(visible[0]!);
  t.setType(ci0 + 5, cj0 + 5, "lava");
  baker.plan({ ...view, pixelsPerMetre: 8 });
  while (!baker.ready) baker.bake(50);
  const now = new Map(baker.layers().map((l) => [l.chunk, l.key]));
  const changed = [...now].filter(([c, k]) => keys.get(c) !== k).map(([c]) => c);
  assert.deepEqual(changed, [visible[0]]);
  // The cache holds them as sprites: save/load round-trips.
  const saved = baker.cache.save();
  assert.equal(saved.table.length, baker.cache.size);
});
