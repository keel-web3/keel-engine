// The GPU ground's CPU side: what a chunk uploads (its mesh -- the baker's faces as triangles -- and its tiles), that
// a paint re-packs only the tiles, and that the surface the shader ports is a pure function of the texel. (The pixels
// themselves are compared GPU vs CPU in the browser: packages/worldgen/tools/ground-parity.html -- no WebGL2 in Node.)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GPU_APRON, GPU_KIND, WATER_NONE, autoTile, cliffFace, cornerLevels, createGroundBaker, createSurfaceShader, createTerrain, footprintToward, globalPixel, gpuChunkData, gpuTileData, groundDepth, groundPalette,
  groundSurface, spritePosition, surfacePalette, tileVariant, viewAxes,
} from "../src/index.ts";
import { randomTerrain } from "./helpers.ts";

const biomes = [{ name: "a" }, { name: "b", tint: { hue: 30 } }, { name: "c", tint: { hue: -40 } }];

test("a chunk's mesh is the baker's faces: every top, every cliff face toward a lower neighbour, every water surface, as triangles", () => {
  const t = randomTerrain(7, 48, 40, { chunk: 16 });
  const auto = autoTile(t);
  for (let c = 0; c < t.chunksX * t.chunksZ; c += 1) {
    const d = gpuChunkData({ terrain: t, auto, chunk: c });
    const [i0, j0, i1, j1] = t.chunkRect(c);
    let floor = Infinity;
    for (let k = 0; k < t.height.length; k += 1) floor = Math.min(floor, t.height[k]!);
    const kinds = new Map<number, number>();
    for (let v = 0; v < d.count; v += 3) { const k = d.info[v * 2]! & 15; kinds.set(k, (kinds.get(k) ?? 0) + 1); }
    let sides = 0, water = 0;
    for (let j = j0; j < j1; j += 1) for (let i = i0; i < i1; i += 1) {
      for (let q = 0; q < 4; q += 1) if (cliffFace(t, i, j, q, floor - 2)) sides += 1;
      const k = t.index(i, j);
      if (t.water[k] !== WATER_NONE && t.water[k]! > t.height[k]!) water += 1;
    }
    assert.equal(kinds.get(GPU_KIND.top), (i1 - i0) * (j1 - j0) * 2, `chunk ${c}: two triangles a top`);
    assert.equal(kinds.get(GPU_KIND.side) ?? 0, sides * 2, `chunk ${c}: two triangles a cliff face`);
    assert.equal(kinds.get(GPU_KIND.water) ?? 0, water * 2, `chunk ${c}: water surfaces`);
    // Positions are local to the chunk's corner; bounds hold them.
    for (let v = 0; v < d.count; v += 1) {
      const x = d.vertices[v * 6]! + d.anchor[0], z = d.vertices[v * 6 + 2]! + d.anchor[2];
      assert.ok(x >= d.bounds[0] - 1e-3 && x <= d.bounds[3] + 1e-3 && z >= d.bounds[2] - 1e-3 && z <= d.bounds[5] + 1e-3);
    }
  }
});

test("a chunk's tiles carry what the shader reads: types, levels, the auto-tile masks, contact shade, variants, biome corners", () => {
  const t = randomTerrain(11, 48, 40, { chunk: 16 });
  const auto = autoTile(t);
  const biome = new Uint8Array(t.width * t.depth);
  for (let j = 0; j < t.depth; j += 1) for (let i = 0; i < t.width; i += 1) biome[j * t.width + i] = i < 20 ? 0 : j < 18 ? 1 : 2;
  const surface = groundSurface({ biomes, biome });
  const c = 4;
  const tiles = gpuTileData({ terrain: t, auto, chunk: c, surface, seed: 3 });
  const [ci0, cj0] = t.chunkRect(c);
  assert.equal(tiles.i0, ci0 - GPU_APRON);
  assert.equal(tiles.j0, cj0 - GPU_APRON);
  const rShore = auto.rule("shore"), rRoad = auto.rule("road");
  let checked = 0;
  for (let lj = 0; lj < tiles.dd; lj += 1) for (let li = 0; li < tiles.dw; li += 1) {
    const i = tiles.i0 + li, j = tiles.j0 + lj;
    const A = (lj * tiles.tw + li) * 4, B = ((lj + tiles.dd) * tiles.tw + li) * 4;
    if (!t.inside(i, j)) { assert.equal(tiles.texels[A + 3]! >>> 24, 0, "off the map: not a tile"); continue; }
    const k = t.index(i, j);
    assert.equal(tiles.texels[A]! & 255, t.type[k]);
    assert.equal(((tiles.texels[A]! >>> 16) & 255), biome[k]);
    assert.equal((tiles.texels[A + 1]! & 0xffff) - 32768, t.height[k]);
    assert.equal((tiles.texels[A + 1]! >>> 16) - 32768, Math.max(...cornerLevels(t, i, j)));
    assert.equal(tiles.texels[A + 2]! & 255, auto.masks[rShore]![k]);
    assert.equal(tiles.texels[A + 2]! >>> 24, auto.masks[rRoad]![k]);
    assert.equal((tiles.texels[B + 1]! >>> 8) & 255, tileVariant(i, j, (3 * 7919 + 101) | 0, 4));
    checked += 1;
  }
  assert.ok(checked > 300);
  // Biome corners: three biomes at most, shares that sum to one, the majority first.
  for (let q = 0; q < (tiles.dw + 1) * (tiles.dd + 1); q += 1) {
    const cj = Math.floor(q / (tiles.dw + 1)), ci = q % (tiles.dw + 1);
    const o = ((2 * tiles.dd + cj) * tiles.tw + ci) * 4;
    const f = new Float32Array(new Uint32Array([tiles.texels[o + 1]!, tiles.texels[o + 2]!, tiles.texels[o + 3]!]).buffer);
    const ids = [tiles.texels[o]! & 255, (tiles.texels[o]! >>> 8) & 255, (tiles.texels[o]! >>> 16) & 255];
    let sum = 0;
    ids.forEach((id, s) => { if (id !== 255) sum += f[s]!; });
    assert.ok(Math.abs(sum - 1) < 1e-5, `corner ${ci},${cj}: shares sum to ${sum}`);
    if (ids[1] !== 255) assert.ok(f[0]! >= f[1]!);
  }
});

test("a biome paint re-packs a chunk's tiles (a new hash) and leaves its mesh; an unrelated chunk's tiles don't change", () => {
  const t = createTerrain({ width: 64, depth: 32, chunk: 32, fill: "grass", level: 1 });
  const biome = new Uint8Array(64 * 32);
  const surface = groundSurface({ biomes, biome });
  const auto = autoTile(t);
  const a0 = gpuChunkData({ terrain: t, auto, chunk: 0, surface });
  const b0 = gpuTileData({ terrain: t, auto, chunk: 1, surface });
  for (let j = 4; j < 10; j += 1) for (let i = 4; i < 10; i += 1) biome[j * 64 + i] = 2;
  const a1 = gpuChunkData({ terrain: t, auto, chunk: 0, surface });
  const b1 = gpuTileData({ terrain: t, auto, chunk: 1, surface });
  assert.notEqual(a1.tiles.hash, a0.tiles.hash, "the painted chunk's tiles change");
  assert.deepEqual(a1.vertices, a0.vertices, "its mesh doesn't");
  assert.equal(b1.hash, b0.hash, "the other chunk's tiles don't");
});

test("the surface is a pure function of the texel: a texel's answer doesn't depend on the texel shaded before it", () => {
  const t = randomTerrain(5, 40, 32, { chunk: 16, water: false });
  const pal = surfacePalette(t.types, biomes);
  const surface = groundSurface({ biomes, biome: null });
  const topOf = (i: number, j: number): number => Math.max(...cornerLevels(t, i, j));
  const make = () => createSurfaceShader({ terrain: t, surface, palette: pal, origin: [0, 0], seed: 1, k: 8, texture: () => 0, topOf });
  const out = { base: 0, len: 1, tv: 0, exact: false, material: 0, biome: 0 };
  // A texel in a tile's middle (one material there), shaded fresh and just after a texel on a border (where the rim
  // applies): the same answer. (The GPU ground shades every texel alone; the CPU once let the border's rim leak on.)
  let diffs = 0, pairs = 0;
  for (let j = 1; j < t.depth - 1; j += 1) for (let i = 1; i < t.width - 1; i += 1) {
    const k = t.index(i, j);
    const X = (i + 0.5) * t.tileSize, Z = (j + 0.5) * t.tileSize, Y = t.height[k]!;
    const fresh = make();
    const a = { ...fresh.top(k, X, Y, Z, i * 16, j * 16, 0.8, out) };
    const other = make();
    const kb = t.index(i - 1, j);
    other.top(kb, i * t.tileSize - 0.02, t.height[kb]!, Z, i * 16 - 1, j * 16, 0.8, out);
    const b = { ...other.top(k, X, Y, Z, i * 16, j * 16, 0.8, out) };
    pairs += 1;
    if (a.tv !== b.tv || a.base !== b.base) diffs += 1;
  }
  assert.ok(pairs > 800);
  assert.equal(diffs, 0, `${diffs} of ${pairs} texels answered differently after a border texel`);
});

test("a sprite's footprint: the same pixel, its depth its base's front edge's -- a rectangle's reach toward the camera by its turn", () => {
  const a = viewAxes({ yaw: 0.6, pitch: 0.72, pixelsPerMetre: 16 });
  const p: [number, number, number] = [40, 3, 22];
  const mid = spritePosition(a, p), front = spritePosition(a, p, [0, 0, 0], 2.5);
  // (The same pixel: the shift is along the view's forward.)
  const px = (q: readonly number[]): [number, number] => globalPixel(a, q as [number, number, number]);
  assert.ok(Math.abs(px(mid)[0] - px(front)[0]) < 1e-6 && Math.abs(px(mid)[1] - px(front)[1]) < 1e-6);
  // Depth: the ground-plane depth of the point 2.5 m (and a pixel row) toward the camera along the heading.
  const d = (q: readonly number[]): number => q[0]! * a.forward[0] + q[1]! * a.forward[1] + q[2]! * a.forward[2];
  const edge = groundDepth(a, p[0] - a.sy * 2.5, p[2] - a.cy * 2.5);
  assert.ok(Math.abs(d(mid) - groundDepth(a, p[0], p[2])) < 1e-9);
  assert.ok(d(front) < edge && edge - d(front) < (1 / (16 * a.sp)) * a.cp + 1e-9, "the front edge's depth, a pixel row's slack");
  // A rectangle's reach: its half-extent along the heading, whatever its turn.
  assert.ok(Math.abs(footprintToward(a, 3, 2, 0.6) - 2) < 1e-9, "turned with the view: its z half-extent");
  assert.ok(Math.abs(footprintToward(a, 3, 2, 0.6 + Math.PI / 2) - 3) < 1e-9);
  assert.ok(footprintToward(a, 3, 2, 0.6 + Math.PI / 4) > 3);
});

test("the CPU bake's stand-ins: a floor scale for every chunk, and a chunk's last layer kept while its new scale bakes -- a fast zoom never leaves a chunk empty", () => {
  const t = randomTerrain(9, 96, 64, { chunk: 32 });
  const palette = groundPalette(t.types);
  const b = createGroundBaker({ terrain: t, palette, style: { name: "pixel" }, prefetch: 0, seed: 1, floor: 2 });
  const view = (k: number) => ({ yaw: 0, pitch: 0.72, pixelsPerMetre: k, center: [96, 0, 64] as [number, number, number], width: 480, height: 270 });
  assert.equal(b.bakeFloor(view(2)), t.chunksX * t.chunksZ);
  // Zoom through five scales with no time to bake: every visible chunk always has a layer (the floor, or its last).
  for (const k of [4, 6, 8, 12, 16]) {
    const vis = b.plan(view(k));
    assert.equal(b.layers().length, vis.length, `at ${k} px/m every visible chunk draws something`);
    assert.ok(b.covered);
  }
  // Let 8 px/m bake, then zoom on through scales past keepScales: the 8 px/m layers stay (the chunks' last) and so does the floor.
  b.plan(view(8));
  while (!b.ready) b.bake(1000);
  for (const k of [11.3, 16, 22.6, 32]) { b.plan(view(k)); b.bake(0.01); }
  const shown = b.layers();
  assert.ok(shown.length > 0 && shown.every((l) => l.k === 8 || l.k === 2 || l.k === 32 || l.k === 22.6), shown.map((l) => l.k).join(","));
  assert.ok(shown.some((l) => l.k === 8), "the last complete layer stands in");
});
