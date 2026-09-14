// packs/humans: a person and every anthro builds for 100 seeds on
// body/humanoid@1.0.0 with every socket its contract requires; the surfaced
// choices pin (and only those); the manifest carries the pack's contents.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, deriveSeed, stream } from "@keel-engine/core";
import type { Stream } from "@keel-engine/core";
import { HUMANOID_BODY, contractOf, missingSockets } from "@keel-engine/entity";
import type { EntitySpec } from "@keel-engine/entity";
import { human, pack } from "../src/index.ts";
import { manifest } from "../src/module.ts";

const S = (label: string, i: number): Stream => stream(createRoll(deriveSeed(label, i)), 0);
const IDS = ["human", "anthro-cat", "anthro-fox", "anthro-bunny", "anthro-bear", "anthro-mouse", "anthro-frog", "anthro-dog"];

test("the manifest: body/humanoid@1.0.0, the pack's contents, cloth as its one compatible pack", () => {
  assert.equal(manifest.id, "packs/humans");
  assert.deepEqual(manifest.provides, [HUMANOID_BODY.ref]);
  assert.deepEqual(manifest.compatible, ["packs/cloth@^1"]);
  assert.deepEqual(manifest.contents?.entities?.map((e) => e.id), IDS);
  for (const e of manifest.contents?.entities ?? []) assert.equal(e.body, HUMANOID_BODY.ref);
  assert.deepEqual(manifest.contents?.attributes, []);
});

test("every character builds for 100 seeds, keeps body/humanoid@1.0.0 and has every socket it requires", () => {
  for (const e of pack.entities) {
    assert.equal(e.body, HUMANOID_BODY.ref);
    for (let i = 0; i < 100; i += 1) {
      const spec = e.build(S(e.id, i), {}) as EntitySpec;
      assert.equal(spec.plan, "humanoid");
      assert.equal(spec.kind, e.id === "human" ? "humanoid" : "anthro");
      assert.equal(e.id === "human" ? spec.species : `anthro-${spec.species}`, e.id);
      assert.equal(contractOf(spec).ref, e.body);
      const sockets = e.sockets(spec);
      assert.deepEqual(missingSockets(HUMANOID_BODY, sockets), [], `${e.id} #${i}`);
      for (const s of Object.values(sockets)) for (const v of s.size) assert.ok(Number.isFinite(v) && v > 0);
    }
    assert.deepEqual(e.build(S(e.id, 3), {}), e.build(S(e.id, 3), {}));
  }
});

test("each character's surfaced choices pin, sizes pin in range, and nothing else pins", () => {
  for (const e of pack.entities) {
    for (const [name, choice] of Object.entries(e.choices ?? {})) {
      if (name === "size") continue;
      const values = Array.isArray(choice) ? choice : [(choice as { range: readonly [number, number] }).range[1]];
      for (const v of values) {
        // (A hood hangs off a jacket or a hoodie: pin one with it.)
        const pins = name === "hood" ? { hood: v, top: "hoodie" } : { [name]: v };
        const spec = e.build(S("pins", 2), pins) as EntitySpec;
        assert.equal((spec.choices as unknown as Record<string, unknown>)[name], v, `${e.id} ${name}=${String(v)}`);
      }
    }
    const [lo, hi] = (e.choices?.["size"] as { range: readonly [number, number] }).range;
    assert.ok(lo > 0 && hi > lo);
    const tall = e.build(S("pins", 2), { size: hi }) as EntitySpec;
    assert.ok(tall.plan === "humanoid" && Math.abs(tall.body.H - hi) < 1e-12);
    assert.throws(() => e.build(S("pins", 2), { size: lo / 2 }), RangeError);
    assert.throws(() => e.build(S("pins", 2), { antlers: true }), /isn't one of its choices/);
  }
  assert.ok((human.choices?.["hair"] as readonly string[]).includes("bun"));
  assert.equal(human.choices?.["ears"], undefined, "a person's ears aren't a choice");
});
