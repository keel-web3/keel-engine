// packs/animals: every animal builds for 100 seeds on body/quadruped@1.0.0
// with every socket its contract requires; its surfaced choices pin (and only
// those); the manifest carries the pack's contents; the collar and saddlebags
// fit this pack's animals only, built to each one's socket.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, deriveSeed, stream } from "@keel-engine/core";
import type { Stream } from "@keel-engine/core";
import { QUADRUPED_BODY, contractOf, missingSockets, placeAttribute, posed, socketsOf, wear } from "@keel-engine/entity";
import type { AttributeShape, EntitySpec } from "@keel-engine/entity";
import { defineManifest, definePack, fits } from "@keel-engine/runtime";
import { collar, dog, pack, saddlebag } from "../src/index.ts";
import { manifest } from "../src/module.ts";

const S = (label: string, i: number): Stream => stream(createRoll(deriveSeed(label, i)), 0);
const IDS = ["dog", "cat", "fox", "bear", "rabbit", "mouse", "deer"];

test("the manifest: body/quadruped@1.0.0, the pack's contents, cloth as its one compatible pack", () => {
  assert.equal(manifest.id, "packs/animals");
  assert.equal(manifest.version, "1.0.0");
  assert.deepEqual(manifest.provides, [QUADRUPED_BODY.ref, "attributes/wearable@1.0.0"]);
  assert.deepEqual(manifest.compatible, ["packs/cloth@^1"]);
  assert.deepEqual(manifest.contents?.entities?.map((e) => e.id), IDS);
  for (const e of manifest.contents?.entities ?? []) assert.equal(e.body, "body/quadruped@1.0.0");
  assert.deepEqual(manifest.contents?.attributes?.map((a) => `${a.id}:${a.slot}`), ["collar:neck", "saddlebag:back"]);
  // (JSON-safe: tools read it without running the pack.)
  assert.deepEqual(JSON.parse(JSON.stringify(manifest.contents)), manifest.contents);
});

test("every animal builds for 100 seeds, keeps body/quadruped@1.0.0 and has every socket it requires", () => {
  for (const e of pack.entities) {
    assert.equal(e.body, QUADRUPED_BODY.ref);
    for (let i = 0; i < 100; i += 1) {
      const spec = e.build(S(e.id, i), {}) as EntitySpec;
      assert.equal(spec.plan, "quadruped");
      assert.equal(spec.species, e.id);
      assert.equal(contractOf(spec).ref, e.body);
      const sockets = e.sockets(spec);
      assert.deepEqual(missingSockets(QUADRUPED_BODY, sockets), [], `${e.id} #${i}`);
      for (const [name, s] of Object.entries(sockets)) for (const v of [...s.pos, ...s.size]) assert.ok(Number.isFinite(v) && (s.size.includes(v) ? v > 0 : true), `${e.id} ${name}`);
    }
    // Deterministic from the stream.
    assert.deepEqual(e.build(S(e.id, 7), {}), e.build(S(e.id, 7), {}));
  }
});

test("each animal's surfaced choices pin, a pin moves nothing else, and nothing else pins", () => {
  for (const e of pack.entities) {
    const plain = e.build(S("pins", 1), {}) as EntitySpec;
    for (const [name, choice] of Object.entries(e.choices ?? {})) {
      if (name === "size") continue;
      const values = Array.isArray(choice) ? choice : [(choice as { range: readonly [number, number] }).range[0]];
      for (const v of values) {
        const spec = e.build(S("pins", 1), { [name]: v }) as EntitySpec;
        assert.equal((spec.choices as unknown as Record<string, unknown>)[name], v, `${e.id} ${name}=${String(v)}`);
        assert.equal(spec.seed, plain.seed, "the seed is the stream's, pinned or not");
        if (name === "coat" || name === "antlers") assert.equal(spec.choices.height, plain.choices.height, `${e.id}: pinning ${name} kept its height`);
      }
    }
    const range = (e.choices?.["size"] as { range: readonly [number, number] }).range;
    const sized = e.build(S("pins", 1), { size: range[1] }) as EntitySpec;
    assert.ok(sized.plan === "quadruped" && Math.abs(sized.body.shoulderH - range[1]) < 1e-12, `${e.id} size`);
    assert.throws(() => e.build(S("pins", 1), { size: range[1] * 2 }), RangeError);
    assert.throws(() => e.build(S("pins", 1), { top: "jacket" }), /isn't one of its choices/);
    assert.equal((e.build(S("pins", 1), { seed: "0x42" }) as EntitySpec).seed, "0x42");
  }
  assert.ok(Array.isArray(dog.choices?.["ears"]) && (dog.choices["ears"] as readonly string[]).includes("flop"), "a dog's ears are its species'");
});

test("the collar and saddlebags fit this pack's animals, and another pack's quadruped not at all", () => {
  const foreign = defineManifest({ id: "packs/other-zoo", version: "1.0.0", kind: "pack", provides: [QUADRUPED_BODY.ref], compatible: ["*"] });
  const theirDog = definePack({ entities: [dog], attributes: [] }).entities[0]!;
  for (const a of pack.attributes) {
    for (const e of pack.entities) assert.ok(fits({ def: a, pack: manifest }, { def: e, pack: manifest }).ok, `${a.id} on ${e.id}`);
    assert.equal(fits({ def: a, pack: manifest }, { def: theirDog, pack: foreign }).ok, false, `${a.id} stays off another pack's dog, even one open to everything`);
  }
});

/** Every point of a design, as a sphere's reach (a capsule's ends plus its radius, a box's corners). */
function reach(d: AttributeShape): number {
  let far = 0;
  for (const c of d.capsules ?? []) for (const p of [c.a, c.b]) far = Math.max(far, Math.hypot(p[0], p[1], p[2]) + c.r);
  for (const b of d.boxes ?? []) far = Math.max(far, Math.hypot(Math.abs(b.c[0]) + b.h[0], Math.abs(b.c[1]) + b.h[1], Math.abs(b.c[2]) + b.h[2]));
  return far;
}

test("the collar and saddlebags build to every animal's socket over 20 seeds, inside the socket's reach, and ride a pose", () => {
  for (const a of [collar, saddlebag]) {
    for (const e of pack.entities) {
      for (let i = 0; i < 20; i += 1) {
        const spec = e.build(S(`${a.id}-${e.id}`, i), {}) as EntitySpec;
        const worn = wear(a, spec, S(`${a.id}-wear`, i));
        const big = Math.max(...worn.socket.size);
        const parts = (worn.design.capsules?.length ?? 0) + (worn.design.boxes?.length ?? 0);
        assert.ok(parts >= 1 && parts <= 10, `${a.id} on ${e.id}: ${parts} parts (lean)`);
        assert.ok(reach(worn.design) <= 1.75 * big, `${a.id} on ${e.id}: reach ${reach(worn.design)} vs socket ${big}`);
        for (const c of worn.design.capsules ?? []) assert.ok(c.r > 0 && c.r <= big);
        const placed = placeAttribute(posed(spec, "move", { phase: 0.3, params: { speed: 3 } }), worn.socket, worn.design);
        for (const c of placed.capsules) for (const v of [...c.a, ...c.b]) assert.ok(Number.isFinite(v));
      }
    }
  }
  // Pins win, and are checked.
  const spec = dog.build(S("pin", 0), {}) as EntitySpec;
  const bell = wear(collar, spec, S("pin", 1), { charm: "bell" });
  assert.ok(bell.design.capsules?.some((c) => c.part === "collar.bell"));
  assert.throws(() => wear(collar, spec, S("pin", 1), { charm: "bow" }), RangeError);
  // Sized to the socket: a bear's collar is bigger than a mouse's.
  const bear = pack.entities.find((x) => x.id === "bear")!;
  const mouse = pack.entities.find((x) => x.id === "mouse")!;
  const radius = (e: typeof bear) => wear(collar, e.build(S("size", 0), {}) as EntitySpec, S("size", 1)).design.capsules![0]!.r;
  assert.ok(radius(bear) > radius(mouse) * 5);
  assert.ok(socketsOf(spec)["neck"]);
});
