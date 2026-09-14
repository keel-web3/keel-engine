// The port of the proof of concept's tests/scene.test.mjs: entities and
// bounds, registry determinism. (Its config tests stay behind: config.js --
// settings and locks -- is @keel-engine/world's to port.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, seedFromToken, stream } from "@keel-engine/core";
import type { Stream } from "@keel-engine/core";
import { createEntity, dirToLocal, dirToWorld, entitySdf, toLocal, toWorld, withComponent, withTransform, byTag, hasTag } from "../src/entity.ts";
import { aabbOf, containsPoint, distance, localAabbOf, nearestPart, normalAt, overlaps, rayAabb, raycast, sphereOf, touching } from "../src/bounds.ts";
import { box, mk, sphere } from "../src/kit.ts";
import { createRegistry, roleMatches } from "../src/registry.ts";
import type { Asset, Registry } from "../src/registry.ts";
import { NOCTURNES, hasNocturnes, noct } from "./reference.ts";

const near = (a: number, b: number, eps = 1e-9, msg = ""): void => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);
const nearV = (a: readonly number[], b: readonly number[], eps = 1e-9): void => a.forEach((v, i) => near(v, b[i]!, eps, `[${i}]`));

// ---- entities and bounds ----

const ballPart = mk(sphere([0, 0.5, 0], 0.5), { name: "ball", mat: "rubber" });
const slab = mk(box([0, 0, 0], [1, 0.1, 0.5], 0), { name: "slab", mat: "stone" });

test("entity: transform round trips and world SDFs", () => {
  const e = createEntity({ id: "a", transform: { pos: [2, 1, -3], yaw: 0.7, scale: 2 }, parts: [ballPart, slab], tags: ["b", "a", "b"] });
  assert.deepEqual(e.tags, ["a", "b"]);
  const r = [0.3, -0.2, 0.9] as const;
  nearV(toLocal(e, toWorld(e, r)), r, 1e-12);
  nearV(dirToLocal(e, dirToWorld(e, [0, 0, 1])), [0, 0, 1], 1e-12);
  // The ball's centre is at local (0,0.5,0): world pos + (0, 1, 0).
  nearV(toWorld(e, [0, 0.5, 0]), [2, 2, -3], 1e-12);
  // A world point 1 unit above the ball's top: local distance 0.5, world 1.
  near(distance(e, [2, 2 + 1 + 1, -3]), 1, 1e-9, "distance");
  near(entitySdf(e)(2, 2, -3), -1, 1e-9, "inside the ball");
  assert.equal(nearestPart(e, [2, 4, -3])!.part.name, "ball");
  nearV(normalAt(e, [2, 3.2, -3]), [0, 1, 0], 1e-6);
  // @ts-expect-error -- (no id)
  assert.throws(() => createEntity({ parts: [] }));
  // @ts-expect-error -- (a part with no sdf)
  assert.throws(() => createEntity({ id: 1, parts: [{ name: "x", bounds: [0, 0, 0, 1, 1, 1] }] }));
  assert.throws(() => createEntity({ id: 1, transform: { scale: 0 } }));
});

test("entity: tags and components", () => {
  const a = createEntity({ id: "a", tags: ["prop", "lamp"], components: { light: { power: 2 } } });
  const b = createEntity({ id: "b", tags: ["prop"] });
  assert.equal(hasTag(a, "lamp"), true);
  assert.deepEqual(byTag([a, b], "prop").map((e) => e.id), ["a", "b"]);
  assert.deepEqual(byTag([a, b], "prop", "lamp").map((e) => e.id), ["a"]);
  const c = withComponent(a, "physics", { mass: 1 });
  assert.deepEqual(c.components, { light: { power: 2 }, physics: { mass: 1 } });
  assert.deepEqual(withComponent(c, "light", undefined).components, { physics: { mass: 1 } });
  assert.deepEqual(a.components, { light: { power: 2 } }); // (copies: the original is untouched)
});

test("bounds: AABB, sphere, overlaps, ray vs box and raycast", () => {
  const e = createEntity({ id: "e", transform: { pos: [1, 0, 0] }, parts: [ballPart, slab] });
  assert.deepEqual(localAabbOf(e), [-1, -0.1, -0.5, 1, 1, 0.5]);
  assert.deepEqual(aabbOf(e), [0, -0.1, -0.5, 2, 1, 0.5]);
  const turned = withTransform(e, { yaw: Math.PI / 2 });
  const tb = aabbOf(turned);
  nearV(tb, [0.5, -0.1, -1, 1.5, 1, 1], 1e-12);
  const s = sphereOf(e);
  nearV(s.center, [1, 0.45, 0], 1e-12);
  near(s.radius, Math.hypot(2, 1.1, 1) / 2, 1e-12, "radius");
  // Every surface point of the entity is in its AABB and sphere.
  for (let i = 0; i < 200; i += 1) {
    const a = (i / 200) * Math.PI * 2;
    const p = toWorld(turned, [0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a), 0]);
    assert.ok(containsPoint(turned, p));
  }
  const far = createEntity({ id: "f", transform: { pos: [5, 0, 0] }, parts: [ballPart] });
  const close = createEntity({ id: "c", transform: { pos: [2.4, 0, 0] }, parts: [ballPart] });
  assert.equal(overlaps(e, far), false);
  assert.equal(overlaps(e, close), true);
  assert.equal(overlaps(e, far, 2.6), true);
  assert.equal(overlaps([0, 0, 0, 1, 1, 1], [1, 1, 1, 2, 2, 2]), true); // (touching counts)
  // Ray vs AABB.
  assert.deepEqual(rayAabb([-5, 0.5, 0], [1, 0, 0], [0, 0, 0, 1, 1, 1]), [5, 6]);
  assert.equal(rayAabb([-5, 2, 0], [1, 0, 0], [0, 0, 0, 1, 1, 1]), null);
  assert.equal(rayAabb([5, 0.5, 0.5], [1, 0, 0], [0, 0, 0, 1, 1, 1]), null);
  assert.deepEqual(rayAabb([0.5, 0.5, 0.5], [0, 1, 0], [0, 0, 0, 1, 1, 1]), [0, 0.5]);
  // Raycast lands on the ball's top from above.
  const hit = raycast(e, [1, 5, 0], [0, -1, 0]);
  near(hit!.t, 4, 1e-3, "hit t");
  assert.equal(raycast(e, [1, 5, 0], [0, 1, 0]), null);
  assert.equal(raycast(e, [1, 5, 0], [0, -1, 0], { far: 3 }), null);
  // Surfaces: the two balls 1.4 apart (radius 0.5 each) do not touch; 0.9 apart they do.
  const b1 = createEntity({ id: 1, parts: [ballPart] });
  const b2 = createEntity({ id: 2, transform: { pos: [1.4, 0, 0] }, parts: [ballPart] });
  const b3 = createEntity({ id: 3, transform: { pos: [0.9, 0, 0] }, parts: [ballPart] });
  assert.equal(touching(b1, b2, { n: 16 }), false);
  assert.equal(touching(b1, b3, { n: 16 }), true);
});

// ---- registry ----

function catalogue(): Registry {
  const reg = createRegistry();
  const relic = reg.defineRealm("Relic", { weight: 3 });
  const decor = reg.defineRealm("Decor", { weight: 2 });
  relic
    .add({ key: "lamp", weight: 3, role: "hero", build: (S) => ({ size: S.between(1, 2) }) })
    .add({ key: "coin", weight: 2, role: "small", build: (S) => ({ size: S.between(0.1, 0.2) }) })
    .add({ key: "clock", weight: 1, role: "both", build: (S, ctx) => ({ size: S.between(0.5, 1), tint: ctx["tint"] ?? null }) })
    .add({ key: "keyboard", weight: 1, role: "peripheral", keyOnly: true, build: (S) => ({ keys: S.int(60, 104) }) });
  decor.add({ key: "vase", weight: 1, build: (S) => ({ size: S.between(0.3, 0.9) }) });
  return reg;
}

test("registry: makeAsset is deterministic and stamps key, realm, seed", () => {
  const a = catalogue();
  const b = catalogue();
  const seen = new Set<string>();
  for (let t = 1; t <= 300; t += 1) {
    const seed = seedFromToken(t);
    const x = a.makeAsset(seed)!;
    const y = b.makeAsset(seed);
    assert.deepEqual(x, y);
    assert.equal(x.seed, seed);
    assert.ok(["Relic", "Decor"].includes(x.realm));
    seen.add(`${x.realm}/${String(x.key)}`);
    assert.ok(x.key !== "keyboard"); // (key-only builders never come at random)
  }
  assert.deepEqual([...seen].sort(), ["Decor/vase", "Relic/clock", "Relic/coin", "Relic/lamp"]);
  // Roles filter the pool.
  for (let t = 1; t <= 100; t += 1) {
    assert.notEqual(a.makeAsset(seedFromToken(t), { realm: "Relic", role: "hero" })!.key, "coin");
    assert.notEqual(a.makeAsset(seedFromToken(t), { realm: "Relic", role: "small" })!.key, "lamp");
  }
  // A forced key: its draw still happens, so the build stream is where it would be.
  for (let t = 1; t <= 50; t += 1) {
    const seed = seedFromToken(t);
    const free = a.makeAsset(seed, { realm: "Relic" }) as Asset;
    const forced = a.makeAsset(seed, { realm: "Relic", key: free.key as string });
    assert.deepEqual(forced, free);
    const kb = a.makeAsset(seed, { realm: "Relic", key: "keyboard" })!;
    assert.equal(kb.key, "keyboard");
  }
  assert.equal(a.makeAsset(seedFromToken(1), { realm: "Relic", key: "clock", ctx: { tint: 2 } })!["tint"], 2);
  assert.throws(() => a.makeAsset(seedFromToken(1), { realm: "Nowhere" }));
  assert.throws(() => a.realm("Relic")!.add({ key: "lamp", build: () => ({}) }));
  assert.ok(roleMatches("both", "hero") && roleMatches(["hero", "small"], "small") && !roleMatches("small", "hero"));
});

// NOCTURNES' kit.js pickBuilder: [key, weight, build, role][] -> a builder.
interface NKit { pickBuilder(S: Stream, list: ReadonlyArray<readonly [string, number, (S: Stream) => unknown, string]>, role: string): (S: Stream) => unknown }
interface NGenome { stream: typeof stream }

test("registry: realm.pick draws exactly like NOCTURNES' kit.js pickBuilder", { skip: hasNocturnes ? false : `NOCTURNES not found at ${NOCTURNES}` }, async () => {
  const nKit = await noct<NKit>("kit.js");
  const nGenome = await noct<NGenome>("genome.js");
  const specs: Array<[string, number, string]> = [["lamp", 3, "hero"], ["coin", 2, "small"], ["clock", 1, "both"], ["bowl", 4, "both"], ["kb", 1, "peripheral"]];
  const list = specs.map(([key, w, role]) => [key, w, (S: Stream) => ({ v: S.f() }), role] as const);
  const realm = createRegistry().defineRealm("R");
  for (const [key, weight, role] of specs) realm.add({ key, weight, role, keyOnly: role === "peripheral", build: (S) => ({ v: S.f() }) });
  let n = 0;
  for (let t = 1; t <= 400; t += 1) {
    for (const role of ["hero", "small"]) {
      const seed = seedFromToken(t);
      const Sn = nGenome.stream(createRoll(seed), 1);
      const Se = stream(createRoll(seed), 1);
      const a = nKit.pickBuilder(Sn, list, role)(Sn);
      const b = realm.pick(Se, role)(Se);
      assert.deepEqual(b, a);
      n += 1;
    }
  }
  assert.equal(n, 800);
});
