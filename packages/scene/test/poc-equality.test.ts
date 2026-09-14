// The TypeScript scene against the JavaScript proof of concept it was ported
// from (src/scene/*.js and src/object/prims.js, imported from its repo, never
// written to): the same outputs, bit for bit, over many seeds and inputs --
// shapes and rotations, transforms, bounds and rays, registries, primitives,
// and front detection (whole results, reasons included).

import { test } from "node:test";
import assert from "node:assert/strict";
import { seedFromToken, wrapAngle } from "@keel-engine/core";
import type { Stream, Vec3 } from "@keel-engine/core";
import * as tKit from "../src/kit.ts";
import * as tEnt from "../src/entity.ts";
import * as tBounds from "../src/bounds.ts";
import * as tReg from "../src/registry.ts";
import * as tPrims from "../src/prims.ts";
import * as tFront from "../src/front.ts";
import type { Shape } from "../src/kit.ts";
import type { Body, TransformInput } from "../src/entity.ts";
import type { PartLike } from "../src/prims.ts";
import { POC, counter, hasPoc, poc, rand } from "./reference.ts";

const skip = hasPoc ? false : `the proof of concept not found at ${POC}`;
const ref = hasPoc
  ? await Promise.all([
    poc<typeof tKit>("src/scene/kit.js"), poc<typeof tEnt>("src/scene/entity.js"), poc<typeof tBounds>("src/scene/bounds.js"),
    poc<typeof tReg>("src/scene/registry.js"), poc<typeof tPrims>("src/object/prims.js"), poc<typeof tFront>("src/scene/front.js"),
  ])
  : null;
const [jKit, jEnt, jBounds, jReg, jPrims, jFront] = ref ?? ([] as unknown as NonNullable<typeof ref>);
const { same, exact, summary } = counter();

// A part's data without its functions or its id (ids count up per process, per module).
const plain = (p: unknown): string => JSON.stringify(p, (k, v: unknown) => (typeof v === "function" || k === "id" ? undefined : v));
const r3 = (r: () => number, s = 1): Vec3 => [(r() * 2 - 1) * s, (r() * 2 - 1) * s, (r() * 2 - 1) * s];

type Kit = typeof tKit;
// The same assembly of shapes from either kit, driven by one seed.
function shapesOf(K: Kit, seed: number): Shape[] {
  const r = rand(seed);
  const m = K.rotation(r() * 6, r() * 2 - 1, r() - 0.5);
  const a = K.box(r3(r, 0.3), [0.05 + r() * 0.3, 0.05 + r() * 0.3, 0.05 + r() * 0.3], r() * 0.03);
  const b = K.cyl(r3(r, 0.3), 0.05 + r() * 0.2, 0.05 + r() * 0.3, (["x", "y", "z"] as const)[seed % 3], r() * 0.02);
  const c = K.sphere(r3(r, 0.3), 0.05 + r() * 0.3);
  const d = K.ellipsoid(r3(r, 0.3), [0.05 + r() * 0.3, 0.05 + r() * 0.3, 0.05 + r() * 0.3]);
  const e = K.capsule(r3(r, 0.3), r3(r, 0.3), 0.02 + r() * 0.1);
  const f = K.torus(r3(r, 0.3), 0.1 + r() * 0.2, 0.02 + r() * 0.05, (["x", "y", "z"] as const)[(seed + 1) % 3]);
  return [a, b, c, d, e, f, K.U(a, c, e), K.cut(d, c), K.inter(a, d), K.turned(K.U(b, f), m, r3(r, 0.2))];
}

test("kit: rotations, bounds, shapes, placement, lowest and parts", { skip }, () => {
  const r = rand(5);
  for (let i = 0; i < 3000; i += 1) {
    const [y, p, q] = [r() * 8 - 4, r() * 8 - 4, r() * 8 - 4];
    const m = tKit.rotation(y, p, q);
    same("kit rotations", m, jKit.rotation(y, p, q));
    const m2 = tKit.rotation(q, y, p);
    same("kit rotations", tKit.mat3mul(m, m2), jKit.mat3mul(m, m2));
    const b: tKit.Bounds = [-r(), -r(), -r(), r(), r(), r()];
    const piv = r3(r);
    same("kit bounds", tKit.rotateBounds(b, m, piv), jKit.rotateBounds(b, m, piv));
    same("kit bounds", tKit.unionBounds([b, tKit.ball(y, p, q, 0.2)]), jKit.unionBounds([b, jKit.ball(y, p, q, 0.2)]));
    exact("kit rotations", tKit.angleOf(y, p), jKit.angleOf(y, p));
    const u = r3(r);
    const v = i % 100 === 0 ? ([-u[0], -u[1], -u[2]] as Vec3) : r3(r);
    const nu = Math.hypot(...u);
    const nv = Math.hypot(...v);
    const un: Vec3 = [u[0] / nu, u[1] / nu, u[2] / nu];
    const vn: Vec3 = [v[0] / nv, v[1] / nv, v[2] / nv];
    same("kit rotations", tKit.rotateOnto(un, vn), jKit.rotateOnto(un, vn));
  }
  for (let seed = 1; seed <= 40; seed += 1) {
    const A = shapesOf(tKit, seed);
    const B = shapesOf(jKit, seed);
    A.forEach((s, k) => same("kit bounds", s.b, B[k]!.b));
    const m = tKit.rotation(seed, 0.3, -0.2);
    const pa = tKit.placed(A[6]!.f, [0.1, 0.2, 0.3], m);
    const pb = jKit.placed(B[6]!.f, [0.1, 0.2, 0.3], m);
    const qa = tKit.rotatedSdf(A[7]!.f, m);
    const qb = jKit.rotatedSdf(B[7]!.f, m);
    const pr = rand(seed * 31);
    for (let i = 0; i < 400; i += 1) {
      const [x, y, z] = r3(pr, 0.6);
      A.forEach((s, k) => exact("kit shape SDFs", s.f(x, y, z, 0), B[k]!.f(x, y, z, 0)));
      exact("kit shape SDFs", pa(x, y, z, 0), pb(x, y, z, 0));
      exact("kit shape SDFs", qa(x, y, z, 0), qb(x, y, z, 0));
    }
    if (seed <= 10) exact("kit lowest", tKit.lowest(A.slice(6).map((s) => ({ sdf: s.f, bounds: s.b }))), jKit.lowest(B.slice(6).map((s) => ({ sdf: s.f, bounds: s.b }))));
  }
  const mats = { rubber: { albedo: 0.3 } };
  const specs: Array<[Shape, tKit.PartFields & Record<string, unknown>]> = [
    [tKit.sphere([0, 0, 0], 1), { name: "ball", mat: "rubber", accent: 2 }],
    [tKit.box([0, 0, 0], [1, 1, 1]), { mat: "wood" }],
    [tKit.box([0, 0, 0], [1, 1, 1]), {}],
    [tKit.box([0, 0, 0], [1, 1, 1]), { m: { shine: 1 } }],
  ];
  for (const [shape, spec] of specs) same("kit parts", plain(tKit.mk(shape, spec, mats)), plain(jKit.mk(shape, spec, mats)));
  const lathe = { name: "vase", points: [[0.18, 0], [0.32, 0.25], [0.3, 0.5], [0.14, 0.85], [0.18, 1]] as Array<[number, number]>, y: 0.1, mat: "glass" };
  const la = tKit.lathePart(lathe);
  const lb = jKit.lathePart(lathe);
  same("kit parts", plain(la), plain(lb));
  for (let i = 0; i < 2000; i += 1) { const [x, y, z] = r3(r, 0.6); exact("kit shape SDFs", la.sdf(x, y + 0.5, z), lb.sdf(x, y + 0.5, z)); }
});

// ---- entities and bounds ----

const randomParts = (K: Kit, seed: number): tKit.Part[] => shapesOf(K, seed).slice(0, 7).map((s, i) => K.mk(s, { name: `p${i}` }));
const randomTransform = (r: () => number): TransformInput => ({ pos: r3(r, 4), yaw: r() * 7 - 3.5, pitch: r() < 0.5 ? 0 : r() - 0.5, roll: r() < 0.7 ? 0 : r() - 0.5, scale: 0.3 + r() * 2 });

test("entity and bounds: transforms, world SDFs, boxes, spheres, rays and contact", { skip }, () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    const r = rand(seed);
    const tr = randomTransform(r);
    same("entity transforms", tEnt.makeTransform(tr), jEnt.makeTransform(tr));
    same("entity transforms", tEnt.rotationOf(tEnt.makeTransform(tr)), jEnt.rotationOf(jEnt.makeTransform(tr)));
    const a = tEnt.createEntity({ id: seed, transform: tr, parts: randomParts(tKit, seed), tags: ["z", "a", "z", "m"], components: { c: 1 } });
    const b = jEnt.createEntity({ id: seed, transform: tr, parts: randomParts(jKit, seed), tags: ["z", "a", "z", "m"], components: { c: 1 } });
    same("entity transforms", plain(a), plain(b));
    const moved = { yaw: r(), pos: r3(r) };
    same("entity transforms", tEnt.withTransform(a, moved).transform, jEnt.withTransform(b, moved).transform);
    same("entity transforms", plain(tEnt.withComponent(a, "d", { x: 2 })), plain(jEnt.withComponent(b, "d", { x: 2 })));
    same("entity transforms", tEnt.byTag([a], "a", "m").length, jEnt.byTag([b], "a", "m").length);
    const fa = tEnt.entitySdf(a);
    const fb = jEnt.entitySdf(b);
    const wa = tEnt.worldSdf(a, a.parts[0]!);
    const wb = jEnt.worldSdf(b, b.parts[0]!);
    for (let i = 0; i < 200; i += 1) {
      const p: Vec3 = [a.transform.pos[0] + (r() * 2 - 1) * 2, a.transform.pos[1] + (r() * 2 - 1) * 2, a.transform.pos[2] + (r() * 2 - 1) * 2];
      same("entity points", tEnt.toWorld(a, p), jEnt.toWorld(b, p));
      same("entity points", tEnt.toLocal(a, p), jEnt.toLocal(b, p));
      same("entity points", tEnt.dirToWorld(a, p), jEnt.dirToWorld(b, p));
      same("entity points", tEnt.dirToLocal(a, p), jEnt.dirToLocal(b, p));
      exact("entity SDFs", fa(p[0], p[1], p[2], 0), fb(p[0], p[1], p[2], 0));
      exact("entity SDFs", wa(p[0], p[1], p[2]), wb(p[0], p[1], p[2]));
      exact("bounds distance", tBounds.distance(a, p), jBounds.distance(b, p));
      const na = tBounds.nearestPart(a, p)!;
      const nb = jBounds.nearestPart(b, p)!;
      same("bounds distance", [na.part.name, na.distance], [nb.part.name, nb.distance]);
      if (i % 10 === 0) same("bounds distance", tBounds.normalAt(a, p), jBounds.normalAt(b, p));
      same("bounds boxes", tBounds.containsPoint(a, p), jBounds.containsPoint(b, p));
      // Rays from the point toward the entity (and away).
      const d = tEnt.toWorld(a, [0, 0, 0]).map((v, k) => v - p[k]!);
      const l = Math.hypot(...d) || 1;
      const dir: Vec3 = i % 3 ? [d[0]! / l, d[1]! / l, d[2]! / l] : [-d[0]! / l, -d[1]! / l, -d[2]! / l];
      same("bounds rays", tBounds.rayAabb(p, dir, tBounds.aabbOf(a)), jBounds.rayAabb(p, dir, jBounds.aabbOf(b)));
      if (i % 4 === 0) same("bounds rays", tBounds.raycast(a, p, dir, { far: i % 8 ? Infinity : 2 }), jBounds.raycast(b, p, dir, { far: i % 8 ? Infinity : 2 }));
    }
    same("bounds boxes", tBounds.localAabbOf(a), jBounds.localAabbOf(b));
    same("bounds boxes", tBounds.aabbOf(a), jBounds.aabbOf(b));
    same("bounds boxes", tBounds.partAabbOf(a, a.parts[1]!), jBounds.partAabbOf(b, b.parts[1]!));
    same("bounds boxes", tBounds.transformAabb(a.parts[2]!.bounds, a.transform), jBounds.transformAabb(b.parts[2]!.bounds, b.transform));
    same("bounds boxes", tBounds.sphereOf(a), jBounds.sphereOf(b));
    // Contact against a neighbour somewhere near.
    const tr2 = { ...randomTransform(r), pos: tEnt.toWorld(a, r3(r, 0.8)) };
    const a2 = tEnt.createEntity({ id: "n", transform: tr2, parts: randomParts(tKit, seed + 100) });
    const b2 = jEnt.createEntity({ id: "n", transform: tr2, parts: randomParts(jKit, seed + 100) });
    for (const margin of [0, 0.05, 0.5]) {
      same("bounds contact", tBounds.overlaps(a, a2, margin), jBounds.overlaps(b, b2, margin));
      same("bounds contact", tBounds.touching(a, a2, { margin, n: 6 }), jBounds.touching(b, b2, { margin, n: 6 }));
    }
    same("bounds boxes", tBounds.mergeAabb(tBounds.aabbOf(a), tBounds.aabbOf(a2)), jBounds.mergeAabb(jBounds.aabbOf(b), jBounds.aabbOf(b2)));
  }
  const none = { transform: tEnt.makeTransform(), parts: [] };
  same("bounds boxes", [tBounds.aabbOf(none), tBounds.localAabbOf(none), tBounds.sphereOf(none)], [jBounds.aabbOf(none), jBounds.localAabbOf(none), jBounds.sphereOf(none)]);
});

// ---- registry ----

function catalogue(R: typeof tReg): tReg.Registry {
  const reg = R.createRegistry();
  const relic = reg.defineRealm("Relic", { weight: 3 });
  reg.defineRealm("Decor", { weight: 2 }).add({ key: "vase", build: (S: Stream) => ({ size: S.between(0.3, 0.9), n: S.int(1, 5) }) });
  reg.defineRealm("Tool", { weight: 1.5 }).add({ key: "saw", role: ["hero", "small"], build: (S: Stream) => ({ teeth: S.int(10, 40) }) });
  relic
    .add({ key: "lamp", weight: 3, role: "hero", build: (S: Stream) => ({ size: S.between(1, 2), on: S.chance(0.5) }) })
    .add({ key: "coin", weight: 2, role: "small", build: (S: Stream) => ({ size: S.between(0.1, 0.2) }) })
    .add({ key: "clock", weight: 1, role: "both", build: (S: Stream, ctx: tReg.BuildContext, info: tReg.BuildInfo) => ({ size: S.between(0.5, 1), tint: ctx["tint"] ?? null, state: info.state, role: info.role }) })
    .add({ key: "keyboard", weight: 1, role: "peripheral", keyOnly: true, build: (S: Stream) => ({ keys: S.int(60, 104) }) })
    .add({ key: "nothing", weight: 0.5, build: () => null });
  return reg;
}

test("registry: makeAsset and pick over 600 seeds, every option", { skip }, () => {
  const a = catalogue(tReg);
  const b = catalogue(jReg);
  same("registry", a.realms().map((x) => [x.name, x.weight, x.keys()]), b.realms().map((x) => [x.name, x.weight, x.keys()]));
  const opts: tReg.MakeAssetOptions[] = [{}, { realm: "Relic" }, { realm: "Relic", role: "hero" }, { realm: "Relic", role: "small" }, { realm: "Relic", key: "keyboard" }, { realm: "Relic", key: "clock", ctx: { tint: 3 }, state: "open" }, { role: "small" }];
  for (let t = 0; t < 600; t += 1) {
    const seed = seedFromToken(t, "registry");
    for (const o of opts) same("registry assets", a.makeAsset(seed, o), b.makeAsset(seed, o));
  }
  for (const [e, w] of [["both", "hero"], ["any", "small"], [undefined, "x"], [["a", "b"], "b"], [["a", "b"], "c"], ["small", "hero"], ["small", null], ["small", "any"]] as const) {
    same("registry", tReg.roleMatches(e, w), jReg.roleMatches(e, w));
  }
  same("registry", tReg.ASSET_SLOTS, jReg.ASSET_SLOTS);
});

// ---- primitives ----

test("prims: bounds, SDFs, parts and toPart in every spelling", { skip }, () => {
  const r = rand(17);
  for (let i = 0; i < 300; i += 1) {
    const bx = { c: r3(r, 2), h: [0.05 + r(), 0.05 + r(), 0.05 + r()] as Vec3, yaw: r() * 7 - 3.5, round: r() * 0.02 };
    const cp = { a: r3(r, 2), b: r3(r, 2), r: 0.02 + r() * 0.3 };
    same("prims bounds", tPrims.boxBounds(bx), jPrims.boxBounds(bx));
    same("prims bounds", tPrims.capsuleBounds(cp), jPrims.capsuleBounds(cp));
    const sa = tPrims.boxSdf(bx);
    const sb = jPrims.boxSdf(bx);
    const ca = tPrims.capsuleSdf(cp);
    const cb = jPrims.capsuleSdf(cp);
    for (let k = 0; k < 50; k += 1) {
      const [x, y, z] = r3(r, 3);
      exact("prims SDFs", sa(x, y, z), sb(x, y, z));
      exact("prims SDFs", ca(x, y, z), cb(x, y, z));
      same("prims", tPrims.overTop([x, y, z], bx, 0.1), jPrims.overTop([x, y, z], bx, 0.1));
    }
    const likes: PartLike[] = [
      { box: bx, name: "crate", mat: "wood" }, { capsule: cp, name: "pipe" }, { shape: tKit.sphere(bx.c, 0.3), name: "orb", accent: 1 },
      { name: "bare box", c: bx.c, h: bx.h, yaw: bx.yaw }, { a: cp.a, b: cp.b, r: cp.r }, { c: bx.c, h: bx.h },
    ];
    for (const like of likes) {
      const pa = tPrims.toPart(like);
      const pb = jPrims.toPart(like);
      same("prims parts", plain(pa), plain(pb));
      const [x, y, z] = r3(r, 2);
      exact("prims SDFs", pa.sdf(x, y, z, 0, null), pb.sdf(x, y, z, 0, null));
    }
  }
  for (const bad of [null, {}, { name: "x" }, { c: [0, 0], h: [1, 1, 1] }, { a: [0, 0, 0], b: [0, 1, 0], r: -1 }, { box: { c: [0, 0, 0], h: [0, 1, 1] } }] as unknown as PartLike[]) {
    assert.throws(() => tPrims.toPart(bad));
    assert.throws(() => jPrims.toPart(bad));
  }
});

// ---- front detection ----

const WORDS = ["cabinet", "screen", "knob", "seat", "backrest", "leg", "cone", "tweeter", "door", "handle", "body", "eye", "nose", "mouth", "stand", "neck", "panel", "post", "head", "shelf", "back", "tail", "part", "leftEye", "Buttons", "vent"];
type Raw = { name: string; c: Vec3; h: Vec3; yaw?: number } | { name: string; a: Vec3; b: Vec3; r: number };
// A random assembly: a body and a few named bits stuck to it.
function assembly(seed: number): Raw[] {
  const r = rand(seed);
  const out: Raw[] = [{ name: WORDS[Math.floor(r() * WORDS.length)]!, c: [0, 0.5, 0], h: [0.2 + r() * 0.4, 0.2 + r() * 0.4, 0.2 + r() * 0.4], yaw: r() < 0.3 ? r() : 0 }];
  for (let k = 0; k < 1 + Math.floor(r() * 4); k += 1) {
    const name = WORDS[Math.floor(r() * WORDS.length)]!;
    if (r() < 0.6) out.push({ name, c: [r() * 0.8 - 0.4, 0.2 + r() * 0.8, r() * 0.8 - 0.4], h: [0.02 + r() * 0.2, 0.02 + r() * 0.2, 0.01 + r() * 0.1] });
    else { const a: Vec3 = [r() * 0.6 - 0.3, 0.2 + r() * 0.7, r() * 0.6 - 0.3]; out.push({ name, a, b: [a[0] + r() * 0.1, a[1] + r() * 0.1, a[2] + 0.02], r: 0.02 + r() * 0.12 }); }
  }
  return out;
}
const split = (raw: readonly Raw[]) => ({ boxes: raw.filter((p): p is Extract<Raw, { c: Vec3 }> => "c" in p), capsules: raw.filter((p): p is Extract<Raw, { a: Vec3 }> => "a" in p) });
const toPartLike = (p: Raw): PartLike => ("c" in p ? { box: { c: p.c, h: p.h, yaw: p.yaw ?? 0 }, name: p.name } : { capsule: { a: p.a, b: p.b, r: p.r }, name: p.name });

test("front: whole detectFront results for 80 random assemblies, raw and placed, declared and not", { skip }, () => {
  const fronts = [undefined, "+z", "-x", Math.PI / 3, [1, 0, 1], { yaw: 2 }, true] as const;
  for (let seed = 1; seed <= 80; seed += 1) {
    const raw = assembly(seed);
    const opts = seed % 5 === 0 ? { dirs: 16, grid: 10 } : {};
    same("front raw", JSON.stringify(tFront.detectFront(split(raw), opts)), JSON.stringify(jFront.detectFront(split(raw), opts)));
    const front = fronts[seed % fronts.length];
    const r = rand(seed * 7);
    const transform = { pos: r3(r, 3), yaw: r() * 7 - 3.5 };
    const ta = tEnt.createEntity({ id: seed, transform, parts: raw.map(toPartLike).map(tPrims.toPart) });
    const tb = jEnt.createEntity({ id: seed, transform, parts: raw.map(toPartLike).map(jPrims.toPart) });
    const withFront = front === undefined ? {} : { front };
    same("front placed", JSON.stringify(tFront.detectFront({ ...ta, ...withFront })), JSON.stringify(jFront.detectFront({ ...tb, ...withFront })));
    // (The same objects handed to both: the parts are only read.)
    same("front shared input", JSON.stringify(tFront.detectFront(raw.map(toPartLike), withFront)), JSON.stringify(jFront.detectFront(raw.map(toPartLike), withFront)));
    if (seed % 4 === 0) {
      const E = tFront.frontEvidence(ta.parts);
      same("front evidence", JSON.stringify(E), JSON.stringify(jFront.frontEvidence(tb.parts)));
      same("front evidence", JSON.stringify(tFront.detectFront(ta, { evidence: E })), JSON.stringify(jFront.detectFront(tb, { evidence: E })));
    }
  }
});

test("front: kit-built things (faces, lathes, rounds) at many yaws, and the vocabulary", { skip }, () => {
  const build = (K: Kit): Array<[string, tKit.Part[]]> => [
    ["face", [K.mk(K.sphere([0, 1.5, 0], 0.2), { name: "head" }), K.mk(K.sphere([-0.07, 1.55, 0.17], 0.035), { name: "left eye" }), K.mk(K.sphere([0.07, 1.55, 0.17], 0.035), { name: "right eye" }), K.mk(K.capsule([0, 1.52, 0.18], [0, 1.47, 0.22], 0.025), { name: "nose" }), K.mk(K.capsule([0, 0.8, 0], [0, 1.3, 0], 0.15), { name: "body" })]],
    ["vase", [K.lathePart({ name: "vase", points: [[0.18, 0], [0.32, 0.25], [0.3, 0.5], [0.14, 0.85], [0.18, 1]] })]],
    ["pod", [K.mk(K.sphere([0, 0.5, 0], 0.45), { name: "cabinet" }), K.mk(K.torus([0, 0.5, 0.43], 0.12, 0.03, "z"), { name: "cone" })]],
    ["table", [K.mk(K.box([0, 0.72, 0], [0.8, 0.03, 0.5]), { name: "top" }), ...([[-1, -1], [1, -1], [-1, 1], [1, 1]] as const).map(([x, z]) => K.mk(K.box([x * 0.72, 0.35, z * 0.42], [0.03, 0.35, 0.03]), { name: "leg" }))]],
    ["tv", [K.mk(K.box([0, 0.45, 0], [0.5, 0.4, 0.35]), { name: "cabinet" }), K.mk(K.box([0, 0.5, 0.36], [0.38, 0.28, 0.015]), { name: "panel", mat: "screen", normal: [0, 0, 1] })]],
  ];
  const A = build(tKit);
  const B = build(jKit);
  for (let k = 0; k < A.length; k += 1) {
    for (let i = 0; i < 6; i += 1) {
      const yaw = wrapAngle(0.3 + i * 1.1);
      const ea: Body = tEnt.createEntity({ id: k, transform: { yaw, pos: [i, 0, -i] }, parts: A[k]![1] });
      const eb = jEnt.createEntity({ id: k, transform: { yaw, pos: [i, 0, -i] }, parts: B[k]![1] });
      same("front kit things", JSON.stringify(tFront.detectFront(ea)), JSON.stringify(jFront.detectFront(eb)));
    }
  }
  for (const name of ["leftEye", "Knobs", "tweeter", "backrest", "porthole", "front-panel", "rearVents", "", "screenBezel"]) {
    const p = { name, role: name.length > 5 ? "display" : undefined, mat: name === "" ? "lcd" : "x" };
    same("front vocabulary", tFront.featureOf(p), jFront.featureOf(p));
    same("front vocabulary", tFront.wordsOf(p), jFront.wordsOf(p));
  }
  for (const f of ["+z", "-z", "+x", "-x", "front", "back", "left", "right", "z", "x", 0.4, -7, [1, 0, -1], { yaw: 1 }, { dir: [0, 0, -1] }, true, false, null]) {
    same("front spellings", tFront.parseFront(f as tFront.FrontSpec), jFront.parseFront(f as tFront.FrontSpec));
  }
  const r = rand(3);
  for (let i = 0; i < 500; i += 1) {
    const [a, b] = [r() * 20 - 10, r() * 20 - 10];
    exact("front spellings", tFront.angleBetween(a, b), jFront.angleBetween(a, b));
    const [pos, eye] = [r3(r), r3(r, 5)];
    exact("front spellings", tFront.frontOffFrom(pos, a, eye), jFront.frontOffFrom(pos, a, eye));
  }
});

test("summary", { skip }, () => {
  console.log(summary("scene vs the proof of concept (all identical)"));
});
