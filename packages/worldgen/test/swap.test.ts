import { test } from "node:test";
import assert from "node:assert/strict";
import { autoTile, bakeChunk, createGroundBaker, groundSurface, surfacePalette } from "@keel-engine/terrain";
import {
  createBiomePainter, createBiomeTable, createWorldStream, defineRecipe, foliageProfile, reskin, runPipeline, scatterIn, seasonPaletteFor, toTerrain, worldSurface,
} from "../src/index.ts";

const RECIPE = defineRecipe({ seed: "swap-1", width: 128, depth: 128, stages: [{ id: "ground", use: "overworld@1", params: { land: 0.9, scale: 0.35, biomes: ["forest", "plains", "birch-forest", "river", "beach", "ocean"] } }] });

test("re-skin: a region becomes another biome and keeps its shape (heights, water); paving stays", () => {
  const map = runPipeline(RECIPE);
  const table = createBiomeTable();
  const H = map.height.slice(), Wt = map.water.slice();
  const n = reskin(map, table, map.types, "desert", (i, j) => i >= 32 && i < 96 && j >= 32 && j < 96);
  assert.ok(n > 2000, `${n} tiles changed`);
  assert.deepEqual([...map.height], [...H]);
  assert.deepEqual([...map.water], [...Wt]);
  const desert = table.index("desert");
  let inside = 0;
  for (let j = 32; j < 96; j += 1) for (let i = 32; i < 96; i += 1) if (map.biome[j * 128 + i] === desert) inside += 1;
  assert.equal(inside, 64 * 64);
  const sand = map.types.id("sand");
  let sandy = 0;
  for (let j = 32; j < 96; j += 1) for (let i = 32; i < 96; i += 1) if (map.type[j * 128 + i] === sand) sandy += 1;
  assert.ok(sandy > 64 * 64 * 0.5, `${sandy} sand tiles`);
});

test("seasons: a palette per season over one layout; foliage wears the season's profile (looks: nothing bakes)", () => {
  const map = runPipeline(RECIPE);
  const table = createBiomeTable();
  const { palette } = worldSurface(map, table);
  for (const s of ["spring", "summer", "autumn", "winter"]) {
    const p = seasonPaletteFor(map.types, table, s);
    assert.deepEqual(p.ramps, palette.ramps, s);
    assert.equal(p.key, palette.key);
  }
  assert.equal(foliageProfile("forest", "autumn"), "autumn");
  assert.equal(foliageProfile("forest", "winter"), "winter");
  assert.equal(foliageProfile("desert", "winter"), "desert");
  assert.equal(foliageProfile("jungle", "spring"), "tropical");
});

test("runtime swap: creep spreads a ragged front; only the chunks it reaches rebake (measured)", () => {
  const map = runPipeline(RECIPE);
  const table = createBiomeTable();
  const t = toTerrain(map, { chunk: 32 });
  const biome = map.biome.slice();
  const biomes = table.surfaceBiomes();
  const pal = surfacePalette(t.types, biomes);
  const baker = createGroundBaker({ terrain: t, palette: pal, style: { name: "pixel" }, surface: groundSurface({ biomes, biome }), prefetch: 0 });
  const view = { center: [128, 0, 128] as [number, number, number], yaw: 0, pitch: 0.6, pixelsPerMetre: 4, width: 1400, height: 1000 };
  baker.plan(view);
  const t0 = performance.now();
  while (!baker.ready) baker.bake(1000);
  const full = performance.now() - t0, chunks = baker.stats.baked;
  assert.equal(chunks, 16, "every chunk visible");
  const painter = createBiomePainter({ terrain: t, biome, table, seed: "creep" });
  // A seed of creep in the middle of chunk (1, 1); five steps of spread.
  let seedTile = 48 * 128 + 48;
  while (t.waterDepth(seedTile % 128, Math.floor(seedTile / 128)) > 0 || t.flags[seedTile]) seedTile += 1;
  const taken = painter.spread("corruption", { steps: 8, rate: 0.6, seeds: [seedTile] });
  assert.ok(taken.length > 20, `${taken.length} tiles taken`);
  assert.equal(painter.count("corruption"), taken.length);
  // The front is ragged: not a diamond (its extent differs by direction).
  const xs = taken.map((k) => k % 128), zs = taken.map((k) => Math.floor(k / 128));
  assert.ok(Math.max(...xs) - Math.min(...xs) !== Math.max(...zs) - Math.min(...zs) || taken.length < 4 * 6 * 6, "ragged");
  baker.plan(view);
  const queued = baker.queue.size();
  const r0 = performance.now();
  while (!baker.ready) baker.bake(1000);
  const rebake = performance.now() - r0;
  assert.ok(queued >= 1 && queued <= 4, `${queued} chunks rebake of ${chunks}`);
  assert.equal(baker.stats.baked - chunks, queued);
  console.log(`# swap: 16 chunks (32 x 32, 4 px/m) baked in ${full.toFixed(0)} ms (${(full / 16).toFixed(0)} each); creep took ${taken.length} tiles in 8 steps, ${queued} chunk(s) rebaked in ${rebake.toFixed(0)} ms`);
  // The creep's tiles wear its ground.
  const creep = t.types.id("creep"), ash = t.types.id("ash");
  assert.ok(taken.every((k) => t.type[k] === creep || t.type[k] === ash || t.waterDepth(k % 128, Math.floor(k / 128)) > 0));
});

test("measured: chunk bake with and without the surface; scatter per chunk", () => {
  const S = createWorldStream(defineRecipe({ seed: "bench", width: 0, depth: 0, stages: [{ id: "ground", use: "overworld@1", params: { land: 0.9, biomes: ["forest", "plains", "river"] } }] }));
  const table = S.table;
  const c = S.chunk(0, 0);
  const t = toTerrain(c.layers, { chunk: 36 });
  const auto = autoTile(t);
  const { surface, palette } = worldSurface(c.layers, table);
  const time = (f: () => void): number => { f(); const t0 = performance.now(); for (let n = 0; n < 3; n += 1) f(); return (performance.now() - t0) / 3; };
  for (const k of [4, 8]) {
    const view = { yaw: 0, pitch: 0.6, pixelsPerMetre: k };
    const plain = time(() => bakeChunk({ terrain: t, auto, chunk: 0, rect: [2, 2, 34, 34], origin: [-2, -2], view, palette, style: { name: "pixel" } }));
    const surf = time(() => bakeChunk({ terrain: t, auto, chunk: 0, rect: [2, 2, 34, 34], origin: [-2, -2], view, palette, style: { name: "pixel" }, surface }));
    console.log(`# chunk bake 32 x 32 at ${k} px/m: ${plain.toFixed(0)} ms classic, ${surf.toFixed(0)} ms with the surface`);
  }
  const gen = time(() => { S.chunk(3, 5); });
  const B = S.block(-4, -4, 40, 40);
  let plants = 0;
  const sc = time(() => { plants = scatterIn(B, [0, 0, 64, 64], { seed: "bench", table, types: S.types }).length; });
  console.log(`# chunk gen (pipeline, 32 x 32 + apron): ${gen.toFixed(1)} ms; scatter: ${plants} plants in ${sc.toFixed(1)} ms`);
  assert.ok(plants > 100);
});
