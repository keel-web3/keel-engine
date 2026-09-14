// The TypeScript objects against the JavaScript proof of concept they were
// ported from (src/object/object.js and catalogue.js, imported from its repo,
// never written to): every catalogue piece over many seeds and sizes, random
// hand-made definitions, placements (colliders, rails, sockets, footprints,
// bounds), settling and resting, baking for the renderer and physics, fronts,
// and WALLRUN's whole course built both ways -- to the bit.
//
// Gated on the one fix (movedObject/settle keep an instance's own tags): the
// instances settled here have no tags of their own, where the two must agree;
// test/object.test.ts shows the fix.

import { test } from "node:test";
import { seedFromToken } from "@keel-engine/core";
import type { Vec3 } from "@keel-engine/core";
import { box, mk, sphere } from "@keel-engine/scene";
import type { PartLike } from "@keel-engine/scene";
import * as tObj from "../src/object.ts";
import * as tCat from "../src/catalogue.ts";
import type { ObjectDef, ObjectInstance, ObjectSpec, Support } from "../src/object.ts";
import type { PieceContexts, PieceKey } from "../src/catalogue.ts";
import { levelOf } from "./wallrun-level.ts";
import { POC, counter, hasPoc, poc, rand } from "./reference.ts";

const skip = hasPoc ? false : `the proof of concept not found at ${POC}`;
const [J, JC, JL] = hasPoc
  ? await Promise.all([poc<typeof tObj>("src/object/object.js"), poc<typeof tCat>("src/object/catalogue.js"), poc<{ levelOf: typeof levelOf }>("projects/wallrun/level.js")])
  : ([null, null, null] as unknown as [typeof tObj, typeof tCat, { levelOf: typeof levelOf }]);
const { same, summary } = counter();

// Data without its functions or its ids (part ids count up per process, per module).
const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x: unknown) => (typeof x === "function" || k === "id" ? undefined : x === undefined ? "__undefined" : x)));
const sameData = (k: string, a: unknown, b: unknown, msg?: string): void => same(k, plain(a), plain(b), msg);
const instData = (i: ObjectInstance<object>): unknown => ({ id: i.id, key: i.key, tags: i.tags, transform: i.transform, components: i.components, def: i.def.key });
const r3 = (r: () => number, s = 1): Vec3 => [(r() * 2 - 1) * s, (r() * 2 - 1) * s, (r() * 2 - 1) * s];

// Random sizes for a piece (some given, most drawn).
function ctxOf(key: PieceKey, r: () => number): PieceContexts[PieceKey] {
  const maybe = (v: number): number | undefined => (r() < 0.3 ? v : undefined);
  const flag = (): boolean | undefined => (r() < 0.2 ? r() < 0.5 : undefined);
  const c: Record<string, unknown> = {};
  const put = (k: string, v: unknown): void => { if (v !== undefined) c[k] = v; };
  put("w", maybe(0.5 + r() * 5)); put("d", maybe(0.5 + r() * 5)); put("h", maybe(0.3 + r() * 8)); put("sink", maybe(r() * 3));
  put("length", maybe(2 + r() * 20)); put("thick", maybe(0.2 + r() * 0.6));
  if (key === "pad") put("lip", flag());
  if (key === "ramp") put("steps", maybe(1 + Math.floor(r() * 20)));
  if (key === "stairs") { put("steps", maybe(2 + Math.floor(r() * 10))); put("rise", maybe(0.1 + r() * 0.2)); put("tread", maybe(0.2 + r() * 0.2)); }
  if (key === "rail") { put("bend", maybe(r() * 10 - 5)); put("rise", maybe(r() * 2)); put("y", maybe(r() * 2)); put("segments", maybe(2 + Math.floor(r() * 14))); put("r", maybe(0.03 + r() * 0.1)); put("posts", flag()); if (r() < 0.3) c["shape"] = r() < 0.5 ? "arc" : "ease"; }
  if (key === "arch") { put("span", maybe(1 + r() * 4)); put("post", maybe(0.3 + r() * 0.5)); }
  if (key === "tunnel") { put("span", maybe(2 + r() * 4)); put("roof", maybe(0.2 + r() * 0.5)); put("floor", flag()); }
  if (key === "crate") { put("size", maybe(0.3 + r())); put("tall", maybe(0.6 + r() * 0.8)); }
  if (key === "bench") { put("seatH", maybe(0.3 + r() * 0.3)); put("seatD", maybe(0.3 + r() * 0.3)); put("back", flag()); put("backH", maybe(0.2 + r() * 0.4)); }
  if (key === "sign") { put("lift", maybe(0.5 + r() * 2)); put("twoPosts", flag()); put("glow", flag()); }
  if (key === "lampPost") { put("reach", maybe(0.4 + r())); put("r", maybe(0.04 + r() * 0.08)); }
  return c;
}

// One piece and its placements, both ways, every output compared.
function checkDef(tDef: ObjectDef<object>, jDef: ObjectDef<object>, r: () => number, label: string): void {
  sameData("definitions", tDef, jDef, label);
  same("bottomOf", tObj.bottomOf(tDef), J.bottomOf(jDef), label);
  sameData("topsOf", tObj.topsOf(tDef.parts), J.topsOf(jDef.parts), label);
  sameData("collidersFromParts", tObj.collidersFromParts(tDef.parts), J.collidersFromParts(jDef.parts), label);
  for (let k = 0; k < 3; k += 1) {
    const place = { pos: r3(r, 20), yaw: (r() * 2 - 1) * 7, scale: r() < 0.5 ? 1 : 0.3 + r() * 2, id: `${label}#${k}` };
    const a = tObj.placeObject(tDef, place);
    const b = J.placeObject(jDef, place);
    sameData("instances", instData(a), instData(b), label);
    same("placements", tObj.worldColliders(a), J.worldColliders(b), label);
    same("placements", tObj.worldRails(a), J.worldRails(b), label);
    sameData("placements", tObj.worldSockets(a), J.worldSockets(b), label);
    same("placements", tObj.footprint(a), J.footprint(b), label);
    same("placements", tObj.worldAabb(a), J.worldAabb(b), label);
    same("placements", tObj.localAabb(a), J.localAabb(b), label);
    for (const name of Object.keys(tDef.sockets)) {
      const s = tObj.socketOf(a, name)!;
      const p: Vec3 = r() < 0.5 ? [s.pos[0] + (r() - 0.5) * 0.4, s.pos[1] + (r() - 0.5) * 0.05, s.pos[2] + (r() - 0.5) * 0.4] : r3(r, 20);
      same("onSocket", tObj.onSocket(a, name, p), J.onSocket(b, name, p), label);
    }
    const eye = r3(r, 30);
    same("yawToShow", tObj.yawToShow(tDef, place.pos, eye), J.yawToShow(jDef, place.pos, eye), label);
    const mats = r() < 0.5 ? null : { wall: 0, floor: 1, rail: 2, metal: 3, glow: 4, wood: 5 };
    const bounds = r() < 0.5;
    same("bakes", tObj.bakeForRenderer([a], { mats, bounds }), J.bakeForRenderer([b], { mats, bounds }), label);
    same("bakes", tObj.bakeForPhysics([a], { mats }), J.bakeForPhysics([b], { mats }), label);
  }
}

test("catalogue: every piece x 80 seeds (sizes given and drawn), definitions and placements to the bit", { skip }, () => {
  same("PIECE_KEYS", [...tCat.PIECE_KEYS], [...JC.PIECE_KEYS]);
  same("PIECES", tCat.PIECES.map(([k, w, role]) => [k, w, role]), JC.PIECES.map(([k, w, role]) => [k, w, role]));
  for (const key of tCat.PIECE_KEYS) {
    for (let i = 0; i < 80; i += 1) {
      const r = rand(i * 131 + key.length);
      const seed = seedFromToken(i, `objects-${key}`);
      const ctx = i % 3 === 0 ? {} : ctxOf(key, r);
      const a = tCat.buildPiece(key, seed, ctx) as unknown as ObjectDef<object>;
      const b = JC.buildPiece(key, seed, ctx) as unknown as ObjectDef<object>;
      checkDef(a, b, r, `${key} ${i}`);
      // (From a stream you have: the pieces draw the same and leave the stream in step.)
      const S1 = tCat.pieceStream(seed, 1 + (i % 5));
      const S2 = JC.pieceStream(seed, 1 + (i % 5));
      sameData("buildPieceFrom", tCat.buildPieceFrom(key, S1, ctx), JC.buildPieceFrom(key, S2, ctx), key);
      same("streams in step", S1.f(), S2.f());
    }
  }
});

test("definitions: 300 random hand-made objects -- boxes, capsules at any slant, SDF parts, given colliders, sockets, fronts, rests", { skip }, () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const r = rand(seed);
    const parts: PartLike[] = [];
    const n = 1 + Math.floor(r() * 7);
    for (let k = 0; k < n; k += 1) {
      const kind = r();
      const extra = { name: ["top", "leg", "screen", "back", "knob", "door", "tail", "base"][Math.floor(r() * 8)]!, mat: ["wood", "metal", "glow", 3][Math.floor(r() * 4)]!, ...(r() < 0.2 ? { collide: false } : {}), ...(r() < 0.1 ? { render: false } : {}) };
      if (kind < 0.45) parts.push({ box: { c: r3(r, 1), h: [0.02 + r(), 0.02 + r(), 0.02 + r()], yaw: r() < 0.5 ? 0 : r() * 6 }, ...extra } as PartLike);
      else if (kind < 0.7) {
        const a = r3(r, 1);
        const slant = r();
        const b: Vec3 = slant < 0.33 ? [a[0], a[1] + 0.2 + r(), a[2]] : slant < 0.66 ? [a[0] + r() - 0.5, a[1], a[2] + r() - 0.5] : r3(r, 1);
        parts.push({ capsule: { a, b, r: 0.01 + r() * 0.2 }, ...extra } as PartLike);
      } else if (kind < 0.85) parts.push(mk(sphere(r3(r, 1), 0.1 + r() * 0.5), { name: extra.name, ...(r() < 0.5 ? { collide: "bounds" } : {}) }) as unknown as PartLike);
      else parts.push(mk(box(r3(r, 1), [0.1 + r() * 0.4, 0.1 + r() * 0.4, 0.1 + r() * 0.4]), { name: extra.name }) as unknown as PartLike);
    }
    const sockets: Record<string, { kind?: string; pos: Vec3; yaw?: number | string; extent?: [number, number]; normal?: Vec3; meta?: unknown }> = {};
    const ns = Math.floor(r() * 4);
    for (let k = 0; k < ns; k += 1) {
      const name = ["seat", "grab", "hook", "top", "view", "spawn", "light"][Math.floor(r() * 7)]!;
      sockets[name] = { pos: r3(r, 1), ...(r() < 0.5 ? { kind: ["anchor", "hang", "seat"][Math.floor(r() * 3)]! } : {}), ...(r() < 0.7 ? { yaw: r() < 0.3 ? ["+z", "-x", "back"][Math.floor(r() * 3)]! : r() * 6 } : {}), ...(r() < 0.4 ? { extent: [r(), r()] as [number, number] } : {}), ...(r() < 0.3 ? { normal: [0, 1, 0] as Vec3 } : {}), ...(r() < 0.2 ? { meta: { n: k } } : {}) };
    }
    const fronts = [null, "+z", "-x", "+x", 0.7, [1, 0, 1], { yaw: 2 }];
    const spec = {
      key: `thing${seed}`, parts, front: fronts[Math.floor(r() * fronts.length)], ...(r() < 0.2 ? { show: r() * 6 } : {}),
      tags: r() < 0.5 ? ["prop", "b", "prop", "a"] : [], sockets, rest: (["base", "hang", "float"] as const)[Math.floor(r() * 3)]!,
      ...(r() < 0.2 ? { colliders: [{ c: r3(r), h: [0.3, 0.3, 0.3], ...(r() < 0.5 ? { yaw: 1 } : {}), ...(r() < 0.5 ? { mat: "x" } : {}), ...(r() < 0.5 ? { part: "p" } : {}) }] } : {}),
      ...(r() < 0.3 ? { rails: [[r3(r), r3(r), r3(r)]] } : {}), meta: { seed },
    } as unknown as ObjectSpec;
    const a = tObj.defineObject(spec);
    const b = J.defineObject(spec);
    checkDef(a as ObjectDef<object>, b as ObjectDef<object>, r, `thing ${seed}`);
    same("fronts", plain(tObj.frontOfObject(a)), plain(J.frontOfObject(b)), `thing ${seed}`);
  }
});

test("resting: settle and restsOn over random stacks of pieces, boxes, floors and planes", { skip }, () => {
  for (let seed = 1; seed <= 120; seed += 1) {
    const r = rand(seed * 3);
    const s = seedFromToken(seed, "rest");
    const make = (key: PieceKey, place: { pos: Vec3; yaw: number; scale: number; id: string }, ctx: PieceContexts[PieceKey] = {}): [ObjectInstance<object>, ObjectInstance<object>] =>
      [tObj.placeObject(tCat.buildPiece(key, s, ctx) as unknown as ObjectDef<object>, place), J.placeObject(JC.buildPiece(key, s, ctx) as unknown as ObjectDef<object>, place)];
    const [padA, padB] = make("pad", { pos: [r() - 0.5, r() * 0.5, r() - 0.5], yaw: r() * 6, scale: 1, id: "pad" }, { w: 3 + r() * 4, d: 3 + r() * 4 });
    const [stairsA, stairsB] = make("stairs", { pos: [r() * 2 - 1, 0, r() * 2 - 1], yaw: r() * 6, scale: 1, id: "stairs" });
    const boxSupport = { c: [r() - 0.5, r(), r() - 0.5] as Vec3, h: [0.5 + r(), 0.2, 0.5 + r()] as Vec3, yaw: r() * 3, name: "slab" };
    const plane = r() < 0.5 ? { y: -0.5, name: "sea" } : -1;
    const supportsA: Support[] = [padA, stairsA, boxSupport, plane];
    const supportsB: Support[] = [padB, stairsB, boxSupport, plane];
    for (const key of ["crate", "bench", "sign", "lampPost", "pillar", "tunnel"] as const) {
      const place = { pos: [(r() - 0.5) * 3, 0.5 + r() * 4, (r() - 0.5) * 3] as Vec3, yaw: r() * 6, scale: r() < 0.7 ? 1 : 0.5 + r(), id: `${key}` };
      const [a, b] = make(key, place);
      const opts = r() < 0.5 ? {} : { stepUp: r() * 0.2, maxDrop: r() < 0.5 ? Infinity : r() * 4, minCover: r() * 0.6 };
      const ra = tObj.settle(a, supportsA, opts);
      const rb = J.settle(b, supportsB, opts);
      sameData("settle", { ...ra, instance: instData(ra.instance) }, { ...rb, instance: instData(rb.instance) }, `${seed} ${key}`);
      for (const [sa, sb] of [[padA, padB], [stairsA, stairsB], [boxSupport, boxSupport], [plane, plane]] as const) {
        same("restsOn", tObj.restsOn(ra.instance, sa), J.restsOn(rb.instance, sb), `${seed} ${key}`);
      }
      // (And on the one before it, as a stack.)
      supportsA.push(ra.instance);
      supportsB.push(rb.instance);
    }
    const all = supportsA.filter((x): x is ObjectInstance<object> => typeof x === "object" && "def" in x);
    const allB = supportsB.filter((x): x is ObjectInstance<object> => typeof x === "object" && "def" in x);
    same("bakes", tObj.bakeForPhysics(all, { mats: { floor: 1, wood: 2, metal: 3 } }), J.bakeForPhysics(allB, { mats: { floor: 1, wood: 2, metal: 3 } }));
    same("bakes", tObj.bakeForRenderer(all, { mats: { floor: 1, glow: 7 } }), J.bakeForRenderer(allB, { mats: { floor: 1, glow: 7 } }));
  }
});

test("WALLRUN: 100 courses built from the TypeScript catalogue are the proof of concept's, box for box", { skip }, () => {
  for (let s = 1; s <= 100; s += 1) {
    const seed = String(s);
    const a = levelOf(seed);
    const b = JL.levelOf(seed);
    same("wallrun boxes", a.boxes, b.boxes, seed);
    same("wallrun rails", a.rails, b.rails, seed);
    same("wallrun capsules", a.capsules, b.capsules, seed);
    same("wallrun route", a.route, b.route, seed);
    same("wallrun course", [a.spawn, a.end, a.waterY], [b.spawn, b.end, b.waterY], seed);
    sameData("wallrun objects", a.objects.map(instData), b.objects.map(instData), seed);
    sameData("wallrun objects", a.objects.map((o) => o.def.meta), b.objects.map((o) => o.def.meta), seed);
  }
  console.log(summary("object equality (TS vs the proof of concept)"));
});
