// Every biome plants and paints from its own data, the same each time; the
// land's shapes differ by kind; and climates find the right place on Earth.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANTS } from "@keel-engine/flora";
import { BIOMES, BIOME_IDS, biomeForClimate, PLANTER_SOILS, createBiome, createBiomePlot, reliefHeight } from "../src/index.ts";

test("every biome names plants and ground that exist", () => {
  assert.ok(BIOME_IDS.length >= 30);
  for (const id of BIOME_IDS) {
    const b = BIOMES[id]!;
    assert.equal(b.id, id);
    assert.ok(b.ground.length >= 1 && b.ground.length <= 8, id);
    const names = b.ground.map((l) => l.name);
    assert.equal(new Set(names).size, names.length, `${id} repeats a ground layer`);
    for (const rule of b.plants) {
      assert.ok(rule.kind in PLANTS, `${id} grows an unknown ${rule.kind}`);
      for (const on of rule.on ?? []) assert.ok(names.includes(on), `${id}: ${rule.kind} on unknown ${on}`);
    }
    if (b.vines) assert.ok(b.plants.some((r) => r.kind === b.vines!.on), `${id}: vines on nothing`);
    if (b.ground.some((l) => l.when?.shore) || b.plants.some((r) => r.water && r.water !== "dry")) assert.ok(b.water, `${id} needs water`);
  }
});

test("a biome's land is the same from the same seed and differs by kind", () => {
  const at = (kind: Parameters<typeof reliefHeight>[0]["kind"], seed: number): number => reliefHeight({ kind, amp: 10, scale: 20 }, 13.4, -7.2, seed);
  assert.equal(at("ridges", 3), at("ridges", 3));
  assert.notEqual(at("ridges", 3), at("ridges", 4));
  assert.equal(new Set((["plain", "hills", "ridges", "dunes", "hummocks", "terraces", "crags"] as const).map((k) => at(k, 3))).size, 7);
});

test("hanging plants hang from something: no biome leaves them in the air", () => {
  for (const id of BIOME_IDS) {
    const b = BIOMES[id]!;
    const hangs = b.plants.filter((r) => r.hangFrom && !r.on);
    if (hangs.length > 0) assert.ok((b.trees?.length ?? 0) > 0 || b.plants.some((r) => r.bears), `${id} has hangers and nothing to hang them from`);
  }
});

test("climates find their biomes", () => {
  assert.equal(biomeForClimate(26, 3100).id, "rainforest");
  assert.equal(biomeForClimate(29, 30).id, "erg");
  assert.equal(biomeForClimate(-24, 150).id, "glacier");
});

test("every biome builds, plants something, and is the same from the same seed", () => {
  for (const id of BIOME_IDS) {
    const a = createBiome(id, { size: 16, seed: 2, detail: 0.3, thick: 0.3, layers: 2 });
    const b = createBiome(id, { size: 16, seed: 2, detail: 0.3, thick: 0.3, layers: 2 });
    assert.deepEqual(a.stats, b.stats, id);
    assert.ok(a.stats.plants + a.stats.triangles > 0, id);
    assert.equal(a.heightAt(3.3, -2.1), b.heightAt(3.3, -2.1));
    a.update({ time: 1, dt: 1 / 60, bodies: [{ x: 0, z: 0, radius: 1 }] });
    a.impact({ x: 2, z: 2, radius: 2 });
    a.dispose();
    b.dispose();
  }
});

test("water biomes set plants in it, afloat at its level", () => {
  const swamp = createBiome("swamp", { size: 30, seed: 5, detail: 0.5, layers: 0 });
  swamp.update({ time: 0, dt: 0, view: [0, 12, 0] });
  assert.ok(swamp.stats.levels[2] > 20, "sketched from afar");
  swamp.update({ time: 0, dt: 0, view: [0, 1.6, 0] });
  assert.ok(swamp.stats.levels[0] > 0, "rich up close");
  swamp.dispose();
});

test("a plot grows a biome's small plants only inside its bounds, at its scale", () => {
  const plot = createBiomePlot("plains", { bounds: [-5, -5, 5, 5], inside: (x, z) => Math.hypot(x, z) < 5, height: 2, seed: 3 });
  assert.ok(plot.stats.plants > 10);
  plot.update({ time: 1, dt: 1 / 60, bodies: [{ x: 0, z: 0, radius: 1 }], view: [0, 4, 8] });
  assert.ok(plot.motion.at(0.6, 0)[2] > 0);
  plot.dispose();
});

test("a plot grows what its ground can hold, and few bushes on any", () => {
  const plot = (soil: "soil" | "sand" | "stone" | "gem" | "fire"): ReturnType<typeof createBiomePlot> => createBiomePlot("deciduous", { bounds: [-6, -6, 6, 6], inside: () => true, height: 0, seed: 3, soil });
  const soil = plot("soil").stats.plants, stone = plot("stone").stats.plants, gem = plot("gem").stats.plants;
  assert.ok(soil > stone && stone > gem, `${String(soil)} > ${String(stone)} > ${String(gem)}`);
  assert.equal(plot("fire").stats.plants, 0);
  assert.equal(PLANTER_SOILS.sandstone, "sand");
});
