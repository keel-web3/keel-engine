// packs/cloth: what fits where -- the fits() matrix over every cloth
// attribute and every packs/humans and packs/animals entity matches what the
// manifests declare, and a hat fits packs/animals' dog but not a dog from a
// pack that hasn't agreed; every attribute builds to every entity it fits
// over 20 seeds, inside its socket's reach, on the side it grows from, sized
// to the socket; pins win, are checked, and never reshuffle the rest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, deriveSeed, stream } from "@keel-engine/core";
import type { Stream } from "@keel-engine/core";
import { pack as animals, dog } from "@keel-engine/animals";
import { manifest as animalsManifest } from "@keel-engine/animals/module";
import { pack as humans } from "@keel-engine/humans";
import { manifest as humansManifest } from "@keel-engine/humans/module";
import { QUADRUPED_BODY, placeAttribute, posed, wear } from "@keel-engine/entity";
import type { AttributeShape, EntitySocket, EntitySpec } from "@keel-engine/entity";
import { defineManifest, definePack, fits, satisfies, splitRef } from "@keel-engine/runtime";
import type { AnyAttributeDef, AnyEntityDef, ModuleManifest, Socket } from "@keel-engine/runtime";
import { beanie, bootsLeft, bootsRight, pack } from "../src/index.ts";
import { manifest } from "../src/module.ts";

const S = (label: string, i: number): Stream => stream(createRoll(deriveSeed(label, i)), 0);
const ENTITIES: Array<{ def: AnyEntityDef; pack: ModuleManifest }> = [
  ...humans.entities.map((def) => ({ def, pack: humansManifest })),
  ...animals.entities.map((def) => ({ def, pack: animalsManifest })),
];
const lists = (refs: readonly string[], m: ModuleManifest) => refs.some((r) => r === "*" || (splitRef(r).name === m.id && satisfies(m.version, splitRef(r).range)));

/** What the declarations say, read straight off them: a target for the body naming the pack, and the two packs naming each other. */
function declared(a: AnyAttributeDef, e: { def: AnyEntityDef; pack: ModuleManifest }): boolean {
  const body = splitRef(e.def.body);
  const target = a.targets.some((t) => { const r = splitRef(t.body); return r.name === body.name && satisfies(body.range, r.range) && (!t.packs || lists(t.packs, e.pack)); });
  return target && lists(manifest.compatible, e.pack) && lists(e.pack.compatible, manifest);
}

test("the manifest: attributes only, the wearable contract, and packs/humans and packs/animals named -- and naming cloth back", () => {
  assert.equal(manifest.id, "packs/cloth");
  assert.deepEqual(manifest.provides, ["attributes/wearable@1.0.0"]);
  assert.deepEqual(manifest.needs, ["keel/runtime@^0.1", "keel/core@^0.1"]);
  assert.deepEqual(manifest.contents?.entities, []);
  assert.deepEqual(manifest.contents?.attributes?.map((a) => `${a.id}:${a.slot}`), [
    "beanie:head", "cap:head", "top-hat:head", "hood:head", "horned-helmet:head", "backpack-round:back", "backpack-tall:back", "flag:back", "cape:back", "scarf:neck", "glasses:face", "boots-l:foot.L", "boots-r:foot.R",
    "wizard-hat:head", "circlet:head", "horns:head", "mask:face", "pauldrons:chest", "breastplate:chest", "belt:waist", "quiver:back", "beard:face",
  ]);
  assert.ok(lists(manifest.compatible, humansManifest) && lists(manifest.compatible, animalsManifest));
  assert.ok(lists(humansManifest.compatible, manifest) && lists(animalsManifest.compatible, manifest));
});

test("the fits() matrix (cloth x humans and animals) is what the manifests declare", () => {
  const counts: Record<string, number> = {};
  for (const a of pack.attributes) {
    for (const e of ENTITIES) {
      const r = fits({ def: a, pack: manifest }, e);
      assert.equal(r.ok, declared(a, e), `${a.id} on ${e.pack.id}/${e.def.id}: ${r.why}`);
      if (r.ok) counts[a.id] = (counts[a.id] ?? 0) + 1;
    }
  }
  // 8 characters on two legs, 7 animals on four.
  assert.deepEqual(counts, { beanie: 15, cap: 15, "top-hat": 15, hood: 8, "horned-helmet": 15, "backpack-round": 15, "backpack-tall": 15, flag: 15, cape: 15, scarf: 15, glasses: 15, "boots-l": 8, "boots-r": 8,
    // (The fantasy trappings are built to two legs.)
    "wizard-hat": 8, circlet: 8, horns: 8, mask: 8, pauldrons: 8, breastplate: 8, belt: 8, quiver: 8, beard: 8 });
});

test("a cloth hat fits packs/animals' dog -- but not a dog from a pack that hasn't agreed", () => {
  const theirDog = definePack({ entities: [dog], attributes: [] }).entities[0]!;
  const stranger = defineManifest({ id: "packs/strays", version: "1.0.0", kind: "pack", provides: [QUADRUPED_BODY.ref] });
  const keen = defineManifest({ id: "packs/strays", version: "1.0.0", kind: "pack", provides: [QUADRUPED_BODY.ref], compatible: ["packs/cloth@^1"] });
  assert.ok(fits({ def: beanie, pack: manifest }, { def: dog, pack: animalsManifest }).ok);
  assert.equal(fits({ def: beanie, pack: manifest }, { def: theirDog, pack: stranger }).ok, false, "a stranger's dog: nobody agreed");
  assert.equal(fits({ def: beanie, pack: manifest }, { def: theirDog, pack: keen }).ok, false, "it lists cloth, but cloth never named it");
  // Same dog, same body contract: only the pack differs.
  assert.equal(theirDog.body, dog.body);
});

/** How far a design reaches from the socket's origin (capsule ends plus radius, box corners). */
function reach(d: AttributeShape): number {
  let far = 0;
  for (const c of d.capsules ?? []) for (const p of [c.a, c.b]) far = Math.max(far, Math.hypot(p[0], p[1], p[2]) + c.r);
  for (const b of d.boxes ?? []) far = Math.max(far, Math.hypot(Math.abs(b.c[0]) + b.h[0], Math.abs(b.c[1]) + b.h[1], Math.abs(b.c[2]) + b.h[2]));
  return far;
}
/** Its furthest point along a direction. */
function furthest(d: AttributeShape, dir: readonly number[]): number {
  let far = -Infinity;
  const along = (p: readonly number[]) => p[0]! * dir[0]! + p[1]! * dir[1]! + p[2]! * dir[2]!;
  for (const c of d.capsules ?? []) for (const p of [c.a, c.b]) far = Math.max(far, along(p) + c.r);
  for (const b of d.boxes ?? []) far = Math.max(far, along(b.c) + Math.abs(b.h[0] * dir[0]!) + Math.abs(b.h[1] * dir[1]!) + Math.abs(b.h[2] * dir[2]!));
  return far;
}

const REACH: Readonly<Record<string, number>> = { flag: 5.5, cape: 3, breastplate: 2.2, quiver: 2.4, belt: 2.4, beard: 3.2 };

test("every cloth attribute builds on every entity it fits x 20 seeds: lean, inside its socket's reach, out the socket's side, riding a pose", () => {
  for (const a of pack.attributes) {
    for (const e of ENTITIES) {
      if (!fits({ def: a, pack: manifest }, e).ok) continue;
      for (let i = 0; i < 20; i += 1) {
        const spec = e.def.build(S(`${a.id}/${e.def.id}`, i), {}) as EntitySpec;
        const worn = wear(a as never, spec, S(`${a.id}/wear`, i));
        const d = worn.design as AttributeShape;
        const s: EntitySocket = worn.socket;
        const big = Math.max(...s.size);
        const parts = (d.capsules?.length ?? 0) + (d.boxes?.length ?? 0);
        assert.ok(parts >= 1 && parts <= 10, `${a.id} on ${e.def.id}: ${parts} parts`);
        // (A flag's pole stands well over its carrier's head, a cape falls past the hips: they reach further, by design.)
        assert.ok(reach(d) <= (REACH[a.id] ?? 1.75) * big, `${a.id} on ${e.def.id}: reach ${reach(d).toFixed(3)} vs socket ${big.toFixed(3)}`);
        for (const c of d.capsules ?? []) assert.ok(c.r > 0 && c.r <= big, `${a.id} radius`);
        for (const b of d.boxes ?? []) for (const h of b.h) assert.ok(h > 0 && h <= big, `${a.id} box`);
        // (A surface socket's wear stands off the skin: something reaches out along its `out`.)
        if (s.sits === "surface") assert.ok(furthest(d, s.out) > 0.05 * big, `${a.id} on ${e.def.id} stands out of its ${s.name}`);
        const placed = placeAttribute(posed(spec, spec.plan === "quadruped" ? "gallop" : "run", { phase: 0.4 }), s, d);
        for (const c of placed.capsules) for (const v of [...c.a, ...c.b]) assert.ok(Number.isFinite(v));
        for (const b of placed.boxes) for (const v of b.c) assert.ok(Number.isFinite(v));
      }
    }
  }
});

test("built to the socket: twice the socket, twice the design (same draws)", () => {
  const scale = (x: AttributeShape, k: number): AttributeShape => ({
    capsules: (x.capsules ?? []).map((c) => ({ ...c, a: c.a.map((v) => v * k) as never, b: c.b.map((v) => v * k) as never, r: c.r * k })),
    boxes: (x.boxes ?? []).map((b) => ({ ...b, c: b.c.map((v) => v * k) as never, h: b.h.map((v) => v * k) as never })),
  });
  const close = (x: AttributeShape, y: AttributeShape) => {
    const flat = (z: AttributeShape) => [...(z.capsules ?? []).flatMap((c) => [...c.a, ...c.b, c.r]), ...(z.boxes ?? []).flatMap((b) => [...b.c, ...b.h])];
    const [p, q] = [flat(x), flat(y)];
    assert.equal(p.length, q.length);
    p.forEach((v, i) => assert.ok(Math.abs(v - q[i]!) < 1e-9 * Math.max(1, Math.abs(v)), `${v} vs ${q[i]}`));
  };
  for (const a of pack.attributes) {
    for (const e of ENTITIES) {
      if (!fits({ def: a, pack: manifest }, e).ok) continue;
      const spec = e.def.build(S("twice", 0), {}) as EntitySpec;
      const s = e.def.sockets(spec)[a.slot] as EntitySocket;
      const doubled: Socket = { ...s, pos: s.pos.map((v) => v * 2) as never, size: s.size.map((v) => v * 2) as never, ...({ at: s.at.map((v) => v * 2) } as object) };
      close(scale(a.build(S("twice", 1), s, {}) as AttributeShape, 2), a.build(S("twice", 1), doubled, {}) as AttributeShape);
    }
  }
});

test("pins win, are checked, and never reshuffle the rest (every choice draws, pinned or not)", () => {
  const spec = dog.build(S("pins", 0), {}) as EntitySpec;
  const person = humans.entities[0]!.build(S("pins", 0), {}) as EntitySpec;
  for (const a of pack.attributes) {
    const on = a.targets.some((t) => t.body.startsWith("body/quadruped")) ? spec : person;
    const socket = (on.plan === "quadruped" ? animals.entities[0]! : humans.entities[0]!).sockets(on)[a.slot]!;
    for (const [name, choice] of Object.entries(a.choices ?? {})) {
      const values = Array.isArray(choice) ? choice : [(choice as { range: readonly [number, number] }).range[0], (choice as { range: readonly [number, number] }).range[1]];
      for (const v of values) {
        const A = S("draws", 1);
        const B = S("draws", 1);
        a.build(A, socket, {});
        a.build(B, socket, { [name]: v });
        assert.equal(A.f(), B.f(), `${a.id}: pinning ${name} left the stream where the unpinned build did`);
      }
      assert.throws(() => a.build(S("bad", 0), socket, { [name]: "nonsense" }), RangeError, `${a.id}.${name}`);
    }
  }
});

test("boots are a pair: the same design on each foot from the same draws and pins", () => {
  const person = humans.entities[0]!.build(S("boots", 0), {}) as EntitySpec;
  const left = wear(bootsLeft as never, person, S("boots", 1), { shaft: "tall" });
  const right = wear(bootsRight as never, person, S("boots", 1), { shaft: "tall" });
  assert.equal(left.socket.name, "foot.L");
  assert.equal(right.socket.name, "foot.R");
  assert.deepEqual(left.design, right.design);
});

test("shape and look: every attribute has at least three shape variants, names its look roles, and builds only roles it names", () => {
  const variants = (a: AnyAttributeDef) => Object.values(a.choices ?? {}).reduce((n, c) => n * (Array.isArray(c) ? c.length : 3), 1);
  for (const a of pack.attributes) {
    assert.ok(variants(a) >= 3, `${a.id}: ${variants(a)} shape variants`);
    const roles = Object.keys(a.look?.roles ?? {});
    assert.ok(roles.length >= 2, `${a.id} names its roles`);
    const person = humans.entities[0]!.build(S("roles", 0), {}) as EntitySpec;
    const on = a.targets.some((t) => t.body.startsWith("body/humanoid")) ? person : (dog.build(S("roles", 0), {}) as EntitySpec);
    const socket = (on.plan === "quadruped" ? animals.entities[0]! : humans.entities[0]!).sockets(on)[a.slot]!;
    for (let i = 0; i < 30; i += 1) {
      const d = a.build(S(`roles/${a.id}`, i), socket, {}) as AttributeShape;
      for (const p of [...(d.capsules ?? []), ...(d.boxes ?? [])]) assert.ok(p.role && roles.includes(p.role), `${a.id}: a ${p.part} carries "${p.role}", not one of ${roles.join(", ")}`);
    }
  }
});
