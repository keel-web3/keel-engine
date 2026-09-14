import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLOB47, SEASONS, a2Quarter, autoTile, bakeChunk, composeGround, createGroundBaker, createSurfaceShader, createTerrain, globalPixel, groundSurface, importTileset, seasonPalette,
  surfacePalette, tileVariant, tilesetPalette, tilesetStyle, viewAxes, wangIndex,
} from "../src/index.ts";
import type { GroundLayer, GroundView, Terrain } from "../src/index.ts";

const VIEW: GroundView = { yaw: 0, pitch: 0.6, pixelsPerMetre: 8 };
const LAND = ["grass", "dirt", "sand", "rock", "snow", "mud", "ash", "gravel", "moss", "clay", "litter", "path", "ice", "sandstone", "crystal", "creep"];

// The material a shader picks at a world point (the texel's own answer).
function shader(t: Terrain, biomes = [{ name: "a" }], biome: Uint8Array | null = null) {
  const pal = surfacePalette(t.types, biomes);
  return createSurfaceShader({ terrain: t, surface: groundSurface({ biomes, biome }), palette: pal, origin: [0, 0], seed: 1, k: 8, texture: () => 0, topOf: (i, j) => t.height[t.index(i, j)]! });
}

test("blending: every pair of land materials has a transition -- both within a band of the border, never a straight line", () => {
  let pairs = 0;
  for (const a of LAND) for (const b of LAND) {
    if (a === b) continue;
    // Two halves: a to the west, b to the east; the border at x = 8 m.
    const t = createTerrain({ width: 8, depth: 12, chunk: 8, fill: a, level: 1 });
    for (let j = 0; j < 12; j += 1) for (let i = 4; i < 8; i += 1) t.setType(i, j, b);
    const S = shader(t);
    const A = t.types.id(a), B = t.types.id(b);
    const borderX: number[] = [];
    let mixed = 0;
    for (let row = 0; row < 80; row += 1) {
      const z = 4 + row * 0.2;
      let last = -1, cross = 0;
      for (let x = 2; x < 14; x += 0.125) {
        const m = S.materialAt(x, z, Math.round(x * 8), Math.round(-z * 8 * 0.56)).type;
        assert.ok(m === A || m === B || t.types.get(m).name === "path", `${a}|${b}: ${t.types.get(m).name} at ${x}`);
        if (m === B && last === A && !cross) { borderX.push(x); cross = 1; }
        if (m !== last && last >= 0) mixed += 1;
        last = m;
      }
    }
    // Both sides are there, the border sits near x = 8 m, and it wanders (not the grid's straight line).
    assert.ok(borderX.length > 60, `${a}|${b}: a border in ${borderX.length} rows`);
    const mean = borderX.reduce((s, v) => s + v, 0) / borderX.length;
    assert.ok(Math.abs(mean - 8) < 1.6, `${a}|${b}: border at ${mean.toFixed(2)} m`);
    const spread = Math.max(...borderX) - Math.min(...borderX);
    assert.ok(spread > 0.35, `${a}|${b}: border spread ${spread.toFixed(2)} m -- a straight line`);
    assert.ok(mixed >= borderX.length, `${a}|${b}: no border pixels`);
    pairs += 1;
  }
  assert.equal(pairs, LAND.length * (LAND.length - 1));
});

test("blending: four materials at a corner all show; a crisp road keeps its edge and wears its neighbours; a cliff doesn't blend", () => {
  const t = createTerrain({ width: 4, depth: 4, chunk: 4, fill: "grass", level: 1 });
  t.setType(2, 1, "dirt"); t.setType(1, 2, "sand"); t.setType(2, 2, "snow");
  const S = shader(t);
  const seen = new Set<string>();
  for (let z = 3; z < 5; z += 0.05) for (let x = 3; x < 5; x += 0.05) seen.add(t.types.get(S.materialAt(x, z, Math.round(x * 8), Math.round(z * 8)).type).name);
  for (const m of ["grass", "dirt", "sand", "snow"]) assert.ok(seen.has(m), `${m} at the corner (${[...seen].join(", ")})`);
  // A road: within its own tile only cobbles; beside it, the path it wears into the grass.
  const r = createTerrain({ width: 6, depth: 4, chunk: 4, fill: "grass", level: 1 });
  for (let i = 0; i < 6; i += 1) r.setType(i, 2, "road");
  const R = shader(r);
  for (let x = 1; x < 11; x += 0.1) for (let z = 4.02; z < 5.98; z += 0.1) assert.equal(r.types.get(R.materialAt(x, z, 0, 0).type).name, "road");
  let wear = 0;
  for (let x = 1; x < 11; x += 0.1) for (let z = 3.3; z < 4; z += 0.1) if (r.types.get(R.materialAt(x, z, Math.round(x * 8), Math.round(z * 8)).type).name === "path") wear += 1;
  assert.ok(wear > 20, `path wear beside the road: ${wear}`);
  // Across a cliff (a step up), nothing blends: each top keeps its own.
  const c = createTerrain({ width: 4, depth: 4, chunk: 4, fill: "grass", level: 1 });
  for (let j = 0; j < 4; j += 1) { c.setType(2, j, "sand"); c.setType(3, j, "sand"); c.setHeight(2, j, 2); c.setHeight(3, j, 2); }
  const C = shader(c);
  for (let x = 0.1; x < 4; x += 0.1) for (let z = 0.5; z < 7.5; z += 0.25) assert.equal(c.types.get(C.materialAt(x, z, Math.round(x * 8), Math.round(z * 8)).type).name, "grass");
});

test("variants: weighted, and never the same as the tile west or south", () => {
  const counts = [0, 0, 0, 0];
  let repeats = 0;
  for (let j = 0; j < 60; j += 1) for (let i = 0; i < 60; i += 1) {
    const v = tileVariant(i, j, 7);
    counts[v] = counts[v]! + 1;
    if (v === tileVariant(i - 1, j, 7) || v === tileVariant(i, j - 1, 7)) repeats += 1;
  }
  assert.equal(repeats, 0, `${repeats} of 3600 tiles repeat a neighbour`);
  assert.ok(counts.every((n) => n > 500), counts.join(","));
  const heavy = [0, 0, 0, 0];
  for (let j = 0; j < 60; j += 1) for (let i = 0; i < 60; i += 1) heavy[tileVariant(i, j, 7, 4, [6, 1, 1, 1])]! += 1;
  assert.ok(heavy[0]! > heavy[1]! * 1.5, `weights: ${heavy.join(",")}`);
});

function bakeAll(t: Terrain, surface: ReturnType<typeof groundSurface>, pal: ReturnType<typeof surfacePalette>): GroundLayer[] {
  const auto = autoTile(t);
  const out: GroundLayer[] = [];
  for (let c = 0; c < t.chunksX * t.chunksZ; c += 1) out.push(bakeChunk({ terrain: t, auto, chunk: c, view: VIEW, palette: pal, style: { name: "pixel" }, surface }));
  return out;
}

test("the surface bakes palette-true, and a world chunk's own small terrain (origin + rect) lands on exactly the same pixels", () => {
  const W = 48, D = 40;
  const big = createTerrain({ width: W, depth: D, chunk: 16, fill: "grass", level: 1 });
  const biomes = [{ name: "a" }, { name: "b", tint: { hue: 30 } }];
  const biome = new Uint8Array(W * D);
  for (let j = 0; j < D; j += 1) for (let i = 0; i < W; i += 1) {
    const v = Math.sin(i * 0.4) + Math.cos(j * 0.5);
    big.setType(i, j, v > 0.8 ? "rock" : v > 0 ? "dirt" : v > -0.8 ? "sand" : "litter");
    if (i > 20 && j > 18 && j < 25) big.setHeight(i, j, 2);
    biome[j * W + i] = i > 19 ? 1 : 0;
  }
  const pal = surfacePalette(big.types, biomes);
  const surface = groundSurface({ biomes, biome });
  const layers = bakeAll(big, surface, pal);
  for (const L of layers) for (let o = 0; o < L.w * L.h; o += 1) { const code = L.data[o * 4]! | (L.data[o * 4 + 1]! << 8); assert.ok(code === 0 || code - 1 < pal.colours.length); }
  // Chunk (1, 1) (tiles 16..32 x 16..32) from its own 20 x 20 terrain (an apron of 2), world tile (14, 14) at its (0, 0).
  const small = createTerrain({ width: 20, depth: 20, chunk: 16, fill: "grass" });
  const sb = new Uint8Array(20 * 20);
  for (let j = 0; j < 20; j += 1) for (let i = 0; i < 20; i += 1) {
    const wi = 14 + i, wj = 14 + j;
    const k = small.index(i, j);
    const q = big.index(wi, wj);
    small.height[k] = big.height[q]!; small.type[k] = big.type[q]!; sb[k] = biome[q]!;
  }
  const L1 = bakeChunk({ terrain: small, auto: autoTile(small), chunk: 0, rect: [2, 2, 18, 18], origin: [14, 14], view: VIEW, palette: pal, style: { name: "pixel" }, surface: groundSurface({ biomes, biome: sb }) });
  const B1 = layers[1 * big.chunksX + 1]!;
  let n = 0, diff = 0;
  for (let y = 0; y < B1.h; y += 1) for (let x = 0; x < B1.w; x += 1) {
    const gx = B1.gx0 + x, gy = B1.gy0 + y;
    const lx = gx - L1.gx0, ly = gy - L1.gy0;
    if (lx < 0 || ly < 0 || lx >= L1.w || ly >= L1.h) continue;
    const p = (y * B1.w + x) * 4, q = (ly * L1.w + lx) * 4;
    if (!(B1.data[p] || B1.data[p + 1])) continue;
    n += 1;
    if (B1.data[p] !== L1.data[q] || B1.data[p + 1] !== L1.data[q + 1]) diff += 1;
  }
  assert.ok(n > 5000, `${n} texels compared`);
  assert.equal(diff, 0, `${diff} of ${n} texels differ`);
});

test("seasons swap the palette, not the bakes: the same layout, other colours", () => {
  const t = createTerrain({ width: 8, depth: 8, chunk: 8 });
  const biomes = [{ name: "a" }, { name: "b", tint: { hue: 20 } }];
  const summer = surfacePalette(t.types, biomes);
  for (const s of Object.values(SEASONS)) {
    const p = seasonPalette(t.types, biomes, s);
    assert.deepEqual(p.ramps, summer.ramps, s.name);
    assert.equal(p.key, summer.key, `${s.name}: a bake key doesn't move`);
    if (s.name !== "summer") assert.notDeepEqual(p.colours.slice(summer.ramps["grass@0"]![0], summer.ramps["grass@0"]![0] + 8), summer.colours.slice(summer.ramps["grass@0"]![0], summer.ramps["grass@0"]![0] + 8), `${s.name} recolours grass`);
  }
});

test("a light layer darkens the ground between torches, smoothly; its key follows it", () => {
  const t = createTerrain({ width: 16, depth: 16, chunk: 16, fill: "flagstone", level: 0 });
  const biomes = [{ name: "a" }];
  const light = new Uint8Array(256).fill(60);
  for (let j = 5; j < 10; j += 1) for (let i = 5; i < 10; i += 1) light[j * 16 + i] = 255;
  const pal = surfacePalette(t.types, biomes);
  const dark = bakeAll(t, groundSurface({ biomes, biome: null, light }), pal)[0]!;
  const lit = bakeAll(t, groundSurface({ biomes, biome: null }), pal)[0]!;
  const lum = (L: GroundLayer, wx: number, wz: number): number => {
    const a = viewAxes(VIEW);
    const [gx, gy] = globalPixel(a, [wx, 0, wz]);
    let s = 0, n = 0;
    for (let dy = -3; dy <= 3; dy += 1) for (let dx = -3; dx <= 3; dx += 1) {
      const x = Math.floor(gx) - L.gx0 + dx, y = Math.floor(gy) - L.gy0 + dy;
      const code = L.data[(y * L.w + x) * 4]! | (L.data[(y * L.w + x) * 4 + 1]! << 8);
      const c = pal.colours[code - 1]!;
      s += c[0] + c[1] + c[2]; n += 1;
    }
    return s / n;
  };
  assert.ok(lum(dark, 15, 15) > lum(dark, 4, 4) + 40, "the torch pool is brighter than the dark");
  assert.ok(Math.abs(lum(lit, 15, 15) - lum(dark, 15, 15)) < 25, "full light is the unlit look");
  const baker = createGroundBaker({ terrain: t, palette: pal, style: { name: "pixel" }, surface: groundSurface({ biomes, biome: null, light }) });
  baker.plan({ center: [16, 0, 16], yaw: 0, pitch: 0.6, pixelsPerMetre: 8, width: 64, height: 64 });
  const before = baker.queue.size();
  light[0] = 255;
  baker.plan({ center: [16, 0, 16], yaw: 0, pitch: 0.6, pixelsPerMetre: 8, width: 64, height: 64 });
  assert.equal(baker.queue.size(), before, "a queued job's key moved with the light");
});

// A tileset atlas: every tile a flat colour per (material, index) with a 1 px darker rim, so a sample names its tile.
function atlas(layout: "blob47" | "wang16" | "rpgmaker-a2", T = 8) {
  const cols = layout === "blob47" ? 8 : layout === "wang16" ? 4 : 2, rows = layout === "blob47" ? 6 : layout === "wang16" ? 4 : 3;
  const width = cols * T * 2, height = rows * T;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    const o = (y * width + x) * 4;
    // (Material A in the left block, B in the right; the tile index in red/green.)
    const idx = (tx % cols) + ty * cols;
    const rim = x % T === 0 || y % T === 0;
    rgba[o] = tx >= cols ? 200 : 40; rgba[o + 1] = 4 + idx * 4 - (rim ? 2 : 0); rgba[o + 2] = layout === "rpgmaker-a2" ? ((x >> 2) & 3) * 60 + ((y >> 2) % 6) * 7 : 90; rgba[o + 3] = 255;
  }
  return { width, height, rgba, cols };
}

test("tilesets: blob-47, Wang-16 and RPG Maker A2 atlases import; the painter picks each tile by its neighbours", () => {
  for (const layout of ["blob47", "wang16", "rpgmaker-a2"] as const) {
    const img = atlas(layout);
    const ts = importTileset(img, { id: `t-${layout}`, layout, tile: 8, materials: [{ type: "grass", at: [0, 0] }, { type: "dirt", at: [img.cols, 0] }] });
    assert.ok(ts.colours.length > 4 && ts.colours.length < 4096);
    for (let i = 0; i < 47; i += 1) { const tile = ts.tileFor("grass", BLOB47[i]!); assert.ok(tile && tile.length === 64, `${layout} ${i}`); }
    if (layout === "blob47") {
      // Blob index i is the atlas's tile i.
      for (const i of [0, 5, 17, 46]) {
        const tile = ts.tileFor("grass", BLOB47[i]!)!;
        const c = ts.colours[tile[9]!]!; // (a pixel inside the rim)
        assert.equal(c[1], 4 + i * 4, `blob tile ${i}`);
      }
    }
    if (layout === "wang16") {
      assert.equal(wangIndex(0), 0);
      assert.equal(wangIndex(255), 15);
      assert.equal(wangIndex(0b111), 1); // (N, NE, E: the NE corner)
      const tile = ts.tileFor("grass", 255)!;
      assert.equal(ts.colours[tile[9]!]![1], 4 + 15 * 4);
    }
    if (layout === "rpgmaker-a2") {
      // Full: four centre quarters; alone: four outer corners; the quarters the A2 rules name.
      assert.deepEqual(a2Quarter(0, true, true, true), [2, 4]);
      assert.deepEqual(a2Quarter(0, false, false, false), [0, 2]);
      assert.deepEqual(a2Quarter(3, true, true, false), [3, 1]);
      assert.notDeepEqual([...ts.tileFor("grass", 255)!], [...ts.tileFor("grass", 0)!]);
    }
    // Bake a small map with the tileset: grass tiles show the tileset's colours exactly (no dither), dirt too.
    const t = createTerrain({ width: 8, depth: 8, chunk: 8, fill: "grass", level: 1 });
    for (let j = 0; j < 8; j += 1) for (let i = 4; i < 8; i += 1) t.setType(i, j, "dirt");
    t.setType(6, 6, "sand");
    const pal = tilesetPalette(surfacePalette(t.types, [{ name: "a" }]), ts);
    const L = bakeChunk({ terrain: t, auto: autoTile(t), chunk: 0, view: { yaw: 0, pitch: Math.PI / 2 - 0.001, pixelsPerMetre: 4 }, palette: pal, style: tilesetStyle(ts, t) });
    const [base, len] = pal.ramps[ts.ramp]!;
    let inRamp = 0, total = 0;
    for (let o = 0; o < L.w * L.h; o += 1) { const code = L.data[o * 4]! | (L.data[o * 4 + 1]! << 8); if (!code) continue; total += 1; if (code - 1 >= base && code - 1 < base + len) inRamp += 1; }
    assert.ok(inRamp / total > 0.85, `${layout}: ${inRamp}/${total} texels from the tileset`);
  }
});

test("the ground baker takes a surface: its key follows the biome map; a change rebakes only the chunks it reaches", () => {
  const t = createTerrain({ width: 64, depth: 64, chunk: 16, fill: "grass", level: 1 });
  const biomes = [{ name: "a" }, { name: "b", tint: { hue: 60 } }];
  const biome = new Uint8Array(64 * 64);
  const pal = surfacePalette(t.types, biomes);
  const baker = createGroundBaker({ terrain: t, palette: pal, style: { name: "pixel" }, surface: groundSurface({ biomes, biome }), prefetch: 0 });
  const view = { center: [64, 0, 64] as [number, number, number], yaw: 0, pitch: 0.6, pixelsPerMetre: 2, width: 400, height: 300 };
  baker.plan(view);
  while (!baker.ready) baker.bake(1000);
  const baked = baker.stats.baked;
  // Paint a patch of the biome map (the middle of chunk 5): a few chunks' keys move, the rest stay baked.
  for (let j = 20; j < 24; j += 1) for (let i = 20; i < 24; i += 1) biome[j * 64 + i] = 1;
  baker.plan(view);
  const queued = baker.queue.size();
  assert.ok(queued >= 1 && queued <= 4, `${queued} chunks to rebake`);
  while (!baker.ready) baker.bake(1000);
  assert.equal(baker.stats.baked - baked, queued);
});
