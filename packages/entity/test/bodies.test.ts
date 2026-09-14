// The standard body contracts and their sockets: every entity of every kind
// exposes the sockets its contract promises, each riding the right bone, on
// (or in) the right part of the skin, in the own frame (+z front), and sized
// by the body -- a bear's head socket is bigger than a mouse's. And the
// catalogue's species as runtime entities that packs can list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, frontOf, rightOf, stream } from "@keel-engine/core";
import type { Vec3, Vec3Like } from "@keel-engine/core";
import { contentsOf, defineAttribute, defineManifest, definePack, fits } from "@keel-engine/runtime";
import {
  BODY_CONTRACTS, HUMANOID_BODY, KINDS, QUADRUPED_BODY, apply, clipsFor, contractOf, entityOf, missingSockets, poseSkeleton, posed, restJoints, skinOf,
  socketFrame, socketsOf, speciesEntities, speciesEntity, seedFromStream,
} from "../src/index.ts";
import type { Capsule, EntitySocket, EntitySpec } from "../src/index.ts";
import { manifest } from "../src/module.ts";

const SEEDS = Array.from({ length: 200 }, (_, i) => String(i));
const YAWS = [-2.7, -1.1, 0.4, 1.9];
const sub = (a: Vec3Like, b: Vec3Like): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3Like, b: Vec3Like): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const specsOf = (kind: (typeof KINDS)[number]): EntitySpec[] => SEEDS.map((s) => entityOf(s, { kind }));
/** The signed distance from p to the capsules of one part (negative inside). */
const sdPart = (caps: readonly Capsule[], part: string, p: Vec3Like): number => {
  const mine = caps.filter((c) => c.part === part);
  assert.ok(mine.length, `the skin has a ${part}`);
  return Math.min(...mine.map((c) => sdSeg(p, c.a, c.b) - c.r));
};
// (Distance to a segment; a ball's two ends are one point, which core's sdCapsule divides by.)
function sdSeg(p: Vec3Like, a: Vec3Like, b: Vec3Like): number {
  const e = sub(b, a);
  const ee = dot(e, e);
  const h = ee > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), e) / ee)) : 0;
  return Math.hypot(...sub(p, [a[0] + e[0] * h, a[1] + e[1] * h, a[2] + e[2] * h]));
}
const centreOf = (caps: readonly Capsule[], part: string): Vec3 => {
  const c = caps.find((q) => q.part === part)!;
  return [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2, (c.a[2] + c.b[2]) / 2];
};
const scaleOf = (s: EntitySocket): number => Math.max(...s.size);

test("the contracts: refs, bones, chains and clips every entity of them has", () => {
  assert.equal(HUMANOID_BODY.ref, "body/humanoid@1.0.0");
  assert.equal(QUADRUPED_BODY.ref, "body/quadruped@1.0.0");
  assert.equal(HUMANOID_BODY.range, "body/humanoid@^1");
  assert.deepEqual(Object.keys(BODY_CONTRACTS), ["humanoid", "quadruped"]);
  for (const kind of KINDS) {
    for (const spec of specsOf(kind).slice(0, 50)) {
      const c = contractOf(spec);
      assert.equal(c.plan, spec.plan);
      assert.deepEqual([...c.bones].sort(), spec.rig.bones.map((b) => b.name).sort(), `${kind} bones`);
      assert.deepEqual([...c.chains].sort(), Object.keys(spec.rig.chains).sort());
      for (const clip of c.clips) assert.ok(clipsFor(spec)[clip], `${kind} plays ${clip}`);
    }
  }
  // (Conventions name real bones, unit outs, and say where and how big.)
  for (const c of Object.values(BODY_CONTRACTS)) {
    for (const s of c.sockets) {
      for (const bone of s.bone.split(" | ")) assert.ok(c.bones.includes(bone), `${c.name} ${s.name} rides ${bone}`);
      assert.ok(Math.abs(Math.hypot(...s.out) - 1) < 1e-3, `${c.name} ${s.name} out is a unit`);
      assert.ok(s.what.length > 10 && s.size.startsWith("["));
    }
  }
});

test("every seed x kind: the sockets its contract promises, on the bones they ride, in the own frame at rest", () => {
  for (const kind of KINDS) {
    for (const spec of specsOf(kind)) {
      const c = contractOf(spec);
      const sockets = socketsOf(spec);
      const where = `${kind} ${spec.species} seed ${spec.seed}`;
      assert.deepEqual(missingSockets(c, sockets), [], where);
      // Only the contract's sockets, and the tail exactly when it has one.
      for (const name of Object.keys(sockets)) assert.ok(c.sockets.some((s) => s.name === name), `${where}: ${name} is in the contract`);
      const hasTail = spec.features.tail.shape !== "none" && spec.features.tail.len > 0;
      assert.equal(Boolean(sockets["tail"]), hasTail, `${where}: a tail socket iff a tail`);
      const rest = restJoints(spec.rig);
      // (The rest pose at the origin, heading 0: the world IS the own frame.)
      const skel = poseSkeleton(spec.rig, {}, {});
      const caps = skinOf(spec, skel);
      for (const s of Object.values(sockets)) {
        const conv = c.sockets.find((q) => q.name === s.name)!;
        assert.ok(conv.bone.split(" | ").includes(s.bone) && spec.rig.index[s.bone] !== undefined, `${where}: ${s.name} rides ${s.bone}`);
        assert.equal(s.yaw, 0);
        assert.equal(s.sits, conv.sits);
        assert.ok(s.size.every((v) => v > 0 && Number.isFinite(v)), `${where}: ${s.name} size ${s.size}`);
        assert.deepEqual(s.pos, [rest[s.bone]![0] + s.at[0], rest[s.bone]![1] + s.at[1], rest[s.bone]![2] + s.at[2]]);
        // At rest its frame is the own frame: +z front, +x right, +y up.
        const f = socketFrame(skel, s);
        assert.deepEqual(f.m, [1, 0, 0, 0, 1, 0, 0, 0, 1], `${where}: ${s.name}'s frame at rest`);
        assert.ok(Math.hypot(...sub(f.p, s.pos)) < 1e-12, `${where}: ${s.name} at its pos`);
        // On the right part: ON its skin (surface), or inside it (around).
        const sd = sdPart(caps, s.part, s.pos);
        if (s.sits === "surface") assert.ok(Math.abs(sd) < 0.01 * scaleOf(s), `${where}: ${s.name} on the ${s.part}'s skin (${sd})`);
        else assert.ok(sd < 1e-9, `${where}: ${s.name} in the ${s.part} (${sd})`);
        // A surface socket's out points off the part (the way attachments grow).
        if (s.sits === "surface") {
          const off = [s.pos[0] + s.out[0] * scaleOf(s) * 0.5, s.pos[1] + s.out[1] * scaleOf(s) * 0.5, s.pos[2] + s.out[2] * scaleOf(s) * 0.5] as Vec3;
          assert.ok(sdPart(caps, s.part, off) > sd, `${where}: ${s.name}'s out leaves the ${s.part}`);
        }
      }
    }
  }
});

test("posed at any yaw: the head socket on top of the head, the face in front of it, the back behind, right on the right", () => {
  for (const kind of KINDS) {
    for (const spec of specsOf(kind).slice(0, 80)) {
      const sockets = socketsOf(spec);
      const hr = spec.body.headR;
      for (const yaw of YAWS) {
        const skel = posed(spec, "idle", { yaw, pos: [2, 0.5, -3], t: 1.3 });
        const caps = skinOf(spec, skel);
        const where = `${kind} ${spec.species} seed ${spec.seed} yaw ${yaw}`;
        const P = (name: string): Vec3 => socketFrame(skel, sockets[name]!).p;
        const f = frontOf(yaw);
        const r = rightOf(yaw);
        const head = centreOf(caps, "head");
        assert.ok(Math.abs(Math.hypot(...sub(P("head"), head)) - hr) < 1e-9 * (1 + hr), `${where}: the head socket is a head radius from its centre`);
        assert.ok(P("head")[1] - head[1] > 0.9 * hr, `${where}: the head socket on top of the head`);
        assert.ok(dot(sub(P("face"), head), f) > 0.8 * hr, `${where}: the face socket in front of the head`);
        assert.ok(Math.abs(Math.hypot(...sub(P("face"), head)) - hr) < 1e-9 * (1 + hr), `${where}: the face socket on the head's skin`);
        const body = spec.plan === "quadruped" ? centreOf(caps, "body") : centreOf(caps, "chest");
        if (spec.plan === "quadruped") assert.ok(P("back")[1] - body[1] > 0.5 * spec.body.bodyR, `${where}: the back socket on top of the body`);
        else assert.ok(dot(sub(P("back"), body), f) < -0.5 * spec.body.torsoR && dot(sub(P("chest"), body), f) > 0.5 * spec.body.torsoR, `${where}: back behind, chest ahead`);
        const pairs = spec.plan === "quadruped" ? [["paw.FL", "paw.FR"], ["paw.HL", "paw.HR"]] : [["hand.L", "hand.R"], ["foot.L", "foot.R"]];
        for (const [L, R] of pairs) assert.ok(dot(sub(P(R!), P(L!)), r) > 0, `${where}: ${R} right of ${L}`);
        // Every socket frame is its bone's: the torso ones face the heading (idle barely turns them).
        for (const name of ["chest", "back"]) assert.ok(dot(apply(socketFrame(skel, sockets[name]!).m, [0, 0, 1]), f) > 0.95, `${where}: ${name}'s +z is the front`);
        // And the sockets that wrap a part are in it, posed.
        for (const s of Object.values(sockets)) if (s.sits === "around") assert.ok(sdPart(caps, s.part, P(s.name)) < 1e-9, `${where}: ${s.name} in its ${s.part}`);
      }
    }
  }
});

test("sockets scale with the body: twice the size, twice every socket; a bear's head socket is bigger than a mouse's", () => {
  for (const kind of KINDS) {
    for (const seed of SEEDS.slice(0, 60)) {
      const a = entityOf(seed, { kind, size: kind === "animal" ? 0.4 : 1 });
      const b = entityOf(seed, { kind, size: kind === "animal" ? 0.8 : 2 });
      const sa = socketsOf(a);
      const sb = socketsOf(b);
      for (const [name, s] of Object.entries(sa)) {
        const t = sb[name]!;
        for (let i = 0; i < 3; i += 1) {
          assert.ok(Math.abs(t.size[i]! - 2 * s.size[i]!) < 1e-12, `${kind} seed ${seed}: ${name} size doubles`);
          assert.ok(Math.abs(t.pos[i]! - 2 * s.pos[i]!) < 1e-12, `${kind} seed ${seed}: ${name} pos doubles`);
          assert.ok(Math.abs(t.out[i]! - s.out[i]!) < 1e-12, `${kind} seed ${seed}: ${name} out stays`);
        }
      }
      // (Sized from the proportions the contract names: the head socket is the head's diameter.)
      assert.ok(Math.abs(sa["head"]!.size[0] - 2 * a.body.headR) < 1e-15);
    }
  }
  for (const kind of ["anthro", "animal"] as const) {
    for (const seed of SEEDS.slice(0, 30)) {
      const bear = socketsOf(entityOf(seed, { kind, species: "bear" }));
      const mouse = socketsOf(entityOf(seed, { kind, species: "mouse" }));
      for (const name of ["head", "face", "neck", "back", "chest"]) assert.ok(bear[name]!.size[0] > mouse[name]!.size[0], `${kind} seed ${seed}: a bear's ${name} is bigger than a mouse's`);
    }
  }
});

test("species as runtime entities: defineEntity, build from a stream and pins, sockets; packs and fits()", () => {
  const cat = speciesEntity("animal", "cat");
  assert.equal(cat.type, "entity");
  assert.equal(cat.id, "cat");
  assert.equal(cat.body, "body/quadruped@1.0.0");
  assert.equal(speciesEntity("anthro", "cat").id, "anthro-cat");
  assert.equal(speciesEntity("humanoid", "human").body, "body/humanoid@1.0.0");
  assert.deepEqual(cat.choices!["ears"], ["point", "tuft"]);
  assert.deepEqual(cat.choices!["height"], { range: [0.9, 1.1] });
  assert.throws(() => speciesEntity("animal", "frog"), RangeError);
  // build(S, pins): the seed from the stream, then entityOf.
  for (let i = 0; i < 30; i += 1) {
    const S = stream(createRoll(`0x${(i + 1).toString(16)}`), 3);
    const T = stream(createRoll(`0x${(i + 1).toString(16)}`), 3);
    const spec = cat.build(S, { coat: "socks" });
    assert.deepEqual(spec, entityOf(seedFromStream(T), { kind: "animal", species: "cat", pins: { coat: "socks" } }));
    assert.equal(spec.choices.coat, "socks");
    assert.deepEqual(cat.sockets(spec), socketsOf(spec));
  }
  // A token's seed pinned; a size pinned; pins that can't be.
  const S = stream(createRoll("0x1"), 0);
  assert.deepEqual(cat.build(S, { seed: "42", size: 0.3 }), entityOf("42", { kind: "animal", species: "cat", size: 0.3 }));
  assert.throws(() => cat.build(S, { kind: "anthro" }), RangeError);
  assert.throws(() => cat.build(S, { wings: 2 }), TypeError);
  // Every species of every kind makes a body that keeps its contract.
  const all = speciesEntities();
  assert.equal(all.length, 15);
  for (const def of all) {
    const spec = def.build(stream(createRoll("0xbeef"), 1), {});
    const c = contractOf(spec);
    assert.equal(def.body, c.ref);
    assert.deepEqual(missingSockets(c, def.sockets(spec)), []);
  }
  // A pack of them, and attributes that fit them by body contract.
  const pack = definePack({
    entities: speciesEntities("animal"),
    attributes: [
      defineAttribute({ id: "beanie", slot: "head", targets: [{ body: HUMANOID_BODY.range }, { body: QUADRUPED_BODY.range }], build: (_S, fit) => ({ w: fit.size[0] }) }),
      defineAttribute({ id: "saddle", slot: "back", targets: [{ body: QUADRUPED_BODY.range }], build: (_S, fit) => ({ w: fit.size[0] }) }),
    ],
  });
  const animals = defineManifest({ id: "packs/animals", version: "1.0.0", kind: "pack", needs: [manifest.id + "@^0.1"], provides: [QUADRUPED_BODY.ref], contents: contentsOf(pack) });
  const people = defineManifest({ id: "packs/people", version: "1.0.0", kind: "pack", provides: [HUMANOID_BODY.ref] });
  const dog = pack.entities.find((e) => e.id === "dog")!;
  assert.ok(fits({ def: pack.attributes[0]!, pack: animals }, { def: dog, pack: animals }).ok);
  assert.ok(fits({ def: pack.attributes[1]!, pack: animals }, { def: dog, pack: animals }).ok);
  assert.equal(fits({ def: pack.attributes[1]!, pack: animals }, { def: speciesEntity("humanoid", "human"), pack: people }).ok, false, "a saddle is for four legs");
  assert.deepEqual(animals.contents!.entities!.map((e) => e.body), Array(7).fill("body/quadruped@1.0.0"));
});

test("keel/entity defines the contracts and provides none (packs provide them)", () => {
  assert.equal(manifest.id, "keel/entity");
  assert.deepEqual(manifest.provides, []);
  assert.deepEqual([...manifest.needs].sort(), ["keel/core@^0.1", "keel/runtime@^0.1", "keel/scene@^0.1"]);
});
