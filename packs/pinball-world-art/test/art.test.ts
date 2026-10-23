import { test } from "node:test";
import assert from "node:assert/strict";
import { WORLD_ART_ASSET_IDS, worldArtAsset, pack, manifest, FIELD_ROLES, biomeLookKey, worldArtPaint, quantizedBiomeBlend } from "../src/index.ts";
import { builtArtMesh } from "../../../packages/pinball-arena-view/src/geometry.ts";
import type { ArenaBiomeBlend } from "@keel-engine/pinball-arena";

const GARDEN: ArenaBiomeBlend = { forge: 0, neon: 0, garden: 1, glacier: 0, ruins: 0 };

test("the framing pack imports inherited foliage profiles without urban or district assemblies", () => {
  assert.equal(WORLD_ART_ASSET_IDS.length, 28);
  assert.equal(pack.objects.length, 28);
  assert.equal(manifest.id, "packs/pinball-world-art");
  for (const rejected of ["neon-tower", "neon-sign", "neon-block", "forge-foundry", "garden-grove", "glacier-terrace", "ruin-sanctum"]) assert.throws(() => worldArtAsset(rejected), /Unknown/);
  assert.throws(() => worldArtAsset("unregistered-prop"), /Unknown/);
});

test("seeded built objects compile through canonical KEEL mesh lowering, with finite near and far geometry", () => {
  for (const id of WORLD_ART_ASSET_IDS) for (let variant = 0; variant < 4; variant++) {
    const args = { seed: `art-check/${id}/${variant}`, pins: { variant }, style: "pixel" };
    const built = worldArtAsset(id).build(args), repeated = worldArtAsset(id).build(args);
    assert.deepEqual(built.def.parts, repeated.def.parts, `${id}/${variant} deterministic construction`);
    const near = builtArtMesh(built), far = builtArtMesh(built, true);
    assert.ok(near.indices.length > 0, id);
    assert.ok(near.positions.length < 300_000, `${id} bounded template`);
    assert.ok(far.indices.length <= near.indices.length, `${id} far geometry`);
    for (const value of [near, far]) {
      assert.ok([...value.positions, ...value.normals, ...value.attrs, ...value.bodies].every(Number.isFinite), id);
      assert.ok([...value.indices].every(i => i < value.positions.length / 3), id);
    }
  }
});

test("material buckets are normalized, bounded and independent of first-seen region order", () => {
  const a = { forge: .21, neon: .01, garden: .78, glacier: 0, ruins: 0 };
  const b = { forge: .22, neon: 0, garden: .78, glacier: 0, ruins: 0 };
  assert.equal(biomeLookKey(a), biomeLookKey(b));
  assert.deepEqual(worldArtPaint(FIELD_ROLES, "same-material-seed", a), worldArtPaint(FIELD_ROLES, "same-material-seed", b));
  assert.equal(Object.values(quantizedBiomeBlend(a)).reduce((n, w) => n + w, 0), 1);
  assert.deepEqual(quantizedBiomeBlend({ forge: NaN, neon: -1, garden: 0, glacier: Infinity, ruins: 0 }), GARDEN);
  assert.notDeepEqual(worldArtPaint(FIELD_ROLES, "same-material-seed", GARDEN), worldArtPaint(FIELD_ROLES, "same-material-seed", { ...GARDEN, garden: 0, forge: 1 }));
});
