import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { defineManifest } from "@keel-engine/runtime";
import { PIPELINE_SCHEMA, canonicalJson, runPipeline } from "../src/index.ts";
import type { Artifact, PipelineModule, Recipe } from "../src/index.ts";
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const bytesOf = (v: string): Uint8Array => new TextEncoder().encode(v);
const artifact = (v: string): Artifact => ({ bytes: bytesOf(v), mediaType: "application/json", sha256: digest(bytesOf(v)) });
const module = (id: string, run?: PipelineModule["run"], needs: string[] = [], provides: string[] = []): PipelineModule => ({
  manifest: defineManifest({ id, version: "0.1.0", kind: "runtime", needs, provides }),
  sha256: digest(bytesOf(id)), ...(run ? { run } : {}),
});
function fixture() {
  const counts = { generate: 0, compile: 0 };
  const modules = [
    module("tools/generate", (inputs) => { counts.generate++; return artifact(`${new TextDecoder().decode(inputs[0]!.bytes)}:generated`); }),
    module("tools/compile", (inputs, options) => { counts.compile++; return artifact(`${inputs[0]!.sha256}:${canonicalJson(options)}`); }),
  ];
  const recipe: Recipe = { schema: PIPELINE_SCHEMA, sources: { design: artifact("seed:crucible") }, stages: [
    { id: "generation", module: "tools/generate@0.1.0", inputs: ["design"], options: {} },
    { id: "gbc", module: "tools/compile@0.1.0", inputs: ["generation"], options: { detail: 0 } },
    { id: "phone", module: "tools/compile@0.1.0", inputs: ["generation"], options: { detail: 1 } },
  ] };
  const entries = new Map<string, Artifact>();
  const host = { digest, cache: { get: (key: string) => entries.get(key), set: (key: string, a: Artifact) => { entries.set(key, a); } } };
  return { modules, recipe, counts, host, entries };
}
test("multiple outputs generate once, then reuse exact artifacts", async () => {
  const f = fixture();
  const first = await runPipeline(f.recipe, f.modules, f.host);
  assert.deepEqual(f.counts, { generate: 1, compile: 2 });
  const second = await runPipeline(f.recipe, f.modules, f.host);
  assert.deepEqual(f.counts, { generate: 1, compile: 2 });
  assert.ok(second.stages.every((s) => s.reused));
  assert.deepEqual(first.artifacts, second.artifacts);
});
test("a compiler update rebuilds outputs while generation remains cached", async () => {
  const f = fixture(); await runPipeline(f.recipe, f.modules, f.host);
  const changed = f.modules.map((m) => m.manifest.id === "tools/compile" ? { ...m, sha256: digest(bytesOf("compiler-v2")) } : m);
  const out = await runPipeline(f.recipe, changed, f.host);
  assert.deepEqual(f.counts, { generate: 1, compile: 4 });
  assert.equal(out.stages.find((s) => s.id === "generation")!.reused, true);
  assert.equal(out.stages.find((s) => s.id === "phone")!.reused, false);
});
test("one changed target option rebuilds only that target", async () => {
  const f = fixture(); await runPipeline(f.recipe, f.modules, f.host);
  const changed: Recipe = { ...f.recipe, stages: f.recipe.stages.map((s) => s.id === "phone" ? { ...s, options: { detail: 2 } } : s) };
  const out = await runPipeline(changed, f.modules, f.host);
  assert.deepEqual(f.counts, { generate: 1, compile: 3 });
  assert.equal(out.stages.find((s) => s.id === "gbc")!.reused, true);
});
test("equivalent outputs share a cache entry even without a persistent cache", async () => {
  const f = fixture();
  const recipe = { ...f.recipe, stages: f.recipe.stages.map((s) => s.id === "phone" ? { ...s, options: { detail: 0 } } : s) };
  const out = await runPipeline(recipe, f.modules, { digest });
  assert.deepEqual(f.counts, { generate: 1, compile: 1 });
  assert.equal(out.stages.find((s) => s.id === "phone")!.reused, true);
});
test("unavailable backends, cycles and missing inputs fail before generation", async () => {
  for (const alter of [
    (r: Recipe): Recipe => ({ ...r, stages: r.stages.map((s) => s.id === "phone" ? { ...s, module: "tools/absent@0.1.0" } : s) }),
    (r: Recipe): Recipe => ({ ...r, stages: r.stages.map((s) => s.id === "generation" ? { ...s, inputs: ["phone"] } : s) }),
    (r: Recipe): Recipe => ({ ...r, stages: r.stages.map((s) => s.id === "phone" ? { ...s, inputs: ["absent"] } : s) }),
  ]) {
    const f = fixture(); await assert.rejects(runPipeline(alter(f.recipe), f.modules, f.host));
    assert.deepEqual(f.counts, { generate: 0, compile: 0 });
  }
});
test("real KEEL dependency contracts resolve and their digests invalidate downstream stages", async () => {
  const f = fixture();
  const renderer = module("tools/renderer", undefined, [], ["render/specimen@1.0.0"]);
  const compile = { ...f.modules[1]!, manifest: defineManifest({ ...f.modules[1]!.manifest, needs: ["contract:render/specimen@1"] }) };
  await assert.rejects(runPipeline(f.recipe, [f.modules[0]!, compile], f.host), /none does/);
  await runPipeline(f.recipe, [f.modules[0]!, compile, renderer], f.host);
  await runPipeline(f.recipe, [f.modules[0]!, compile, { ...renderer, sha256: digest(bytesOf("renderer-v2")) }], f.host);
  assert.deepEqual(f.counts, { generate: 1, compile: 4 });
});
test("corrupt input and cache bytes fail closed", async () => {
  const f = fixture();
  await assert.rejects(runPipeline({ ...f.recipe, sources: { design: { ...artifact("source"), bytes: bytesOf("corrupt") } } }, f.modules, f.host), /digest mismatch/);
  assert.equal(f.counts.generate, 0);
  const out = await runPipeline(f.recipe, f.modules, f.host);
  const k = out.stages[0]!.key, prior = f.entries.get(k)!;
  f.entries.set(k, { ...prior, bytes: bytesOf("corrupt") });
  await assert.rejects(runPipeline(f.recipe, f.modules, f.host), /cache: artifact digest mismatch/);
});
test("module handlers cannot mutate a shared input used by another target", async () => {
  const f = fixture();
  const original = f.modules[1]!;
  const compiler: PipelineModule = { ...original, run: (inputs, opts) => {
    const a = inputs[0]!; const before = a.sha256; a.bytes.fill(0);
    return artifact(`${before}:${canonicalJson(opts)}`);
  } };
  const out = await runPipeline(f.recipe, [f.modules[0]!, compiler], f.host);
  const generated = out.artifacts.generation!;
  assert.equal(digest(generated.bytes), generated.sha256);
});
test("canonical options are order-independent and reject invalid values", () => {
  assert.equal(canonicalJson({ b: 2, a: [1] }), canonicalJson({ a: [1], b: 2 }));
  assert.throws(() => canonicalJson({ detail: NaN }), /non-finite/);
  assert.throws(() => canonicalJson({ detail: undefined } as never), /JSON data/);
});
