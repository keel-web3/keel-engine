import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { buildEngineFeatures } from "../src/features.ts";

test("live bake, entity, buildings and particles entries preserve their complete selected contract", async () => {
  for (const [name, group] of [["bake", "packages"], ["entity", "packages"], ["buildings", "packs"], ["particles", "packages"]]) {
    const profile = JSON.parse(await readFile(new URL(`../../../tools/profiles/${name}-runtime.json`, import.meta.url), "utf8"));
    const broad = await import(`../../../${group}/${name}/src/index.ts`);
    const runtime = await import(`../../../${group}/${name}/src/runtime.ts`);
    for (const value of profile.features[0].exports) {
      assert.ok(value in runtime, `${name}: ${value} exists`);
      if (value !== "createRuntimeParticlePool") assert.equal(runtime[value], broad[value], `${name}: ${value} shares its implementation`);
    }
    const built = await buildEngineFeatures(profile);
    assert.deepEqual(gunzipSync(built.gzip), Buffer.from(built.bytes));
    assert.deepEqual(brotliDecompressSync(built.brotli), Buffer.from(built.bytes));
    assert.ok(built.report.gzipBytes <= profile.maxGzipBytes);
    assert.ok(built.report.brotliBytes <= profile.maxBrotliBytes);
    console.log({ profile: profile.name, rawBytes: built.report.rawBytes, gzipBytes: built.report.gzipBytes, brotliBytes: built.report.brotliBytes });
  }
});

test("runtime and persistence contracts reject names from the other surface", async () => {
  await assert.rejects(buildEngineFeatures({ name: "runtime-contract", features: [{ module: "@keel-engine/particles/runtime", exports: ["createParticlePool"] }] }), /No matching runtime export/);
  const profile = { name: "runtime-budget", features: [{ module: "@keel-engine/particles/runtime", exports: ["createRuntimeParticlePool"] }] };
  await assert.rejects(buildEngineFeatures({ ...profile, maxBrotliBytes: 1 }), /Brotli budget/);
  await assert.rejects(buildEngineFeatures({ ...profile, forbidInputs: ["particles/src/pool-runtime.ts"] }), /Forbidden engine dependency/);
  const saved = await buildEngineFeatures({ name: "runtime-persistence", features: [profile.features[0]!, { module: "@keel-engine/particles/persistence", exports: ["withParticlePersistence"] }] });
  assert.ok(saved.report.inputs.some(input => input.file.includes("particles/src/persistence.ts")));
  assert.ok(saved.report.inputs.some(input => input.file.includes("codec/")));
});
