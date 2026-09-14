// The engine's schemas on the engine's own data: every record comes back as
// what it was made from -- objects to the millimetre (rebuilt through
// defineObject), looks, pins and populations exactly, a world snapshot so
// exactly that a restored world runs on identically, a particle pool the
// same, scripts through bytecode and back, and a VM that runs them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FINISHES as CORE_FINISHES, LOOK_ROLES as CORE_ROLES, PATTERNS as CORE_PATTERNS, PROFILES as CORE_PROFILES, lookOf, lookSignature } from "@keel-engine/core";
import { PIECE_KEYS, bakeForPhysics, buildPiece, defineObject, placeObject } from "@keel-engine/object";
import type { ObjectSpec } from "@keel-engine/object";
import { entityOf } from "@keel-engine/entity";
import { PRESETS, createParticlePool } from "@keel-engine/particles";
import {
  BLOCKS, BYTECODE, ENTITY_MAKE, FINISHES, LOOK, LOOK_ROLES, OBJECT, PARTICLE_POOL, PATTERNS, PLACED, POPULATION, PROFILES, WORLD_SNAPSHOT,
  compileScript, createScriptVM, decode, decodeRaw, decompileScript, encode, encodeRaw, lookOfRecord, lookRecordOf, objectRecordOf, objectSpecOf,
  placedRecordOf, populationRecordOf, registerEngineSchemas, createRegistry, readDocument, explainBits, same,
} from "../src/index.ts";
import type { Expr, InstanceLike, Json, ObjectDefLike, Script, ScriptHost, Stmt } from "../src/index.ts";
import { levelOf } from "../../object/test/wallrun-level.ts";
import { makeWorld } from "../../world/test/fixtures.ts";
import { GUARD_SCRIPT } from "../tools/samples.ts";
import { rng } from "./gen.ts";

const near = (a: number, b: number, tol: number, what: string): void => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const nearDeep = (a: unknown, b: unknown, tol: number, what: string): void => {
  if (typeof a === "number" && typeof b === "number") return near(a, b, tol, what);
  if (Array.isArray(a) && Array.isArray(b)) { assert.equal(a.length, b.length, `${what}: length`); a.forEach((x, i) => nearDeep(x, b[i], tol, `${what}[${i}]`)); return; }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => (a as Record<string, unknown>)[k] !== undefined || (b as Record<string, unknown>)[k] !== undefined));
    for (const k of keys) nearDeep((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], tol, `${what}.${k}`);
    return;
  }
  assert.equal(a, b, what);
};

// ---------------------------------------------------------------- objects

test("objects: every catalogue piece comes back through its record and defineObject, to the millimetre", () => {
  for (const key of PIECE_KEYS) for (let s = 1; s <= 12; s += 1) {
    const def = buildPiece(key, `0x${s.toString(16)}`);
    const rec = objectRecordOf(def as unknown as ObjectDefLike);
    const back = decode(OBJECT, encode(OBJECT, rec));
    const again = defineObject(objectSpecOf(back) as unknown as ObjectSpec);
    const what = `${key} ${s}`;
    assert.equal(again.parts.length, def.parts.length, what);
    // (Rounding to the millimetre moves a corner half a millimetre at most; a yaw by half a 65536th of a turn.)
    nearDeep(again.colliders.map((c) => [c.c, c.h]), def.colliders.map((c) => [c.c, c.h]), 0.0006, `${what} colliders`);
    nearDeep(again.colliders.map((c) => c.yaw), def.colliders.map((c) => c.yaw), 0.0001, `${what} collider yaws`);
    nearDeep(again.rails, def.rails, 0.0006, `${what} rails`);
    nearDeep(again.bounds, def.bounds, 0.0011, `${what} bounds`);
    assert.deepEqual(Object.keys(again.sockets).sort(), Object.keys(def.sockets).sort(), `${what} sockets`);
    for (const [k, sock] of Object.entries(def.sockets)) nearDeep(again.sockets[k]!.pos, sock.pos, 0.02, `${what} socket ${k}`);
    assert.deepEqual(again.tags, def.tags);
    // A record is a fixed point: through the codec twice, the same bytes.
    assert.deepEqual(encodeRaw(OBJECT, { ...objectRecordOf(again as unknown as ObjectDefLike), realm: rec.realm!, seed: rec.seed! }), encodeRaw(OBJECT, back), `${what} fixed point`);
  }
});

test("objects: a WALLRUN course, placed, bakes the same physics boxes", () => {
  for (const seed of ["1", "7", "wallrun"]) {
    const course = levelOf(seed);
    const rec = placedRecordOf(course.objects as unknown as InstanceLike[]);
    const back = decode(PLACED, encode(PLACED, rec));
    const defs = back.defs.map((d) => defineObject(objectSpecOf(d) as unknown as ObjectSpec));
    const insts = back.objects.map((o) => placeObject(defs[o.def]!, { pos: o.pos, yaw: o.yaw, scale: o.scale, id: o.id, tags: o.tags }));
    const a = bakeForPhysics(course.objects);
    const b = bakeForPhysics(insts);
    assert.equal(b.boxes.length, a.boxes.length);
    nearDeep(b.boxes.map((x) => [x.c, x.h]), a.boxes.map((x) => [x.c, x.h]), 0.0015, `course ${seed} boxes`);
    nearDeep(b.rails, a.rails, 0.0015, `course ${seed} rails`);
  }
});

// ---------------------------------------------------------------- looks, pins, populations

test("looks: core's lists match, and 3,000 looks come back exactly (signature and all)", () => {
  assert.deepEqual([...LOOK_ROLES], [...CORE_ROLES]);
  assert.deepEqual([...PROFILES], [...CORE_PROFILES]);
  assert.deepEqual([...PATTERNS], [...CORE_PATTERNS]);
  assert.deepEqual([...FINISHES], [...CORE_FINISHES]);
  const S = rng("looks");
  const roleSets = [
    { primary: { stuff: "knit" }, secondary: { stuff: "knit" }, trim: {} },
    { cloth: {}, clothAlt: {}, skin: {}, hair: {}, accent: {}, dark: {}, blush: {} },
    { fur: {}, furAlt: {}, accent: { stuff: "leather" }, dark: {}, blush: {} },
    { metal: {}, glow: {}, detail: {}, primary: { stuff: "paint" } },
  ];
  for (let n = 0; n < 3000; n += 1) {
    const roles = roleSets[n % roleSets.length]!;
    const pins = S.chance(0.2) ? { "primary.hue": S.int(0, 359), "cloth.light": S.f(), profile: S.pick([...CORE_PROFILES]) } : {};
    const look = lookOf(`0x${n.toString(16)}`, roles, { pins, ...(S.chance(0.2) ? { team: S.int(0, 359) } : {}) });
    const back = lookOfRecord(decodeRaw(LOOK, encodeRaw(LOOK, lookRecordOf(look))), lookSignature as never);
    assert.deepEqual(back, look, `look ${n}`);
  }
});

test("entity makes: seeds and pins come back and make the same entity", () => {
  const makes = [
    { seed: "0x1234", kind: "animal" as const, species: "fox" as const },
    { seed: "hero", kind: "humanoid" as const, pins: { height: 1.05, top: "hoodie" as const, hood: true, hairColour: [0.4, 0.07, 55] as const } },
    { seed: "0xb203894d3fbfd002f1c69c6ce9b9389d2956f4b98fc02be2f74e36408518d965|entity:animal-1", kind: "animal" as const, species: "rabbit" as const, size: 0.2 },
    { seed: "7", kind: "anthro" as const, species: "cat" as const, pins: { ears: "tuft" as const, furColour: [0.72, 0.12, 60] as const, stride: 1.0371234 } },
  ];
  for (const m of makes) {
    const back = decode(ENTITY_MAKE, encode(ENTITY_MAKE, m));
    assert.deepEqual(back, m);
    assert.deepEqual(JSON.stringify(entityOf(back.seed, back as never)), JSON.stringify(entityOf(m.seed, m as never)));
  }
});

test("a population: a cast and 400 units, every look and wear exactly", async () => {
  const { armyPopulation } = await import("../../bake/test/cast.ts");
  const pop = armyPopulation("codec", 400);
  const rec = populationRecordOf("codec", pop as never);
  const bytes = encode(POPULATION, rec);
  const back = decode(POPULATION, bytes);
  assert.ok(same(back, rec));
  back.units.forEach((u, i) => assert.deepEqual(lookOfRecord(u.look, lookSignature as never), pop.units[i]!.look, `unit ${i}`));
});

// ---------------------------------------------------------------- the world

test("a world snapshot comes back exactly: a fresh world restored from the codec runs on identically", () => {
  for (const at of [0.7, 3.2, 10]) {
    const w = makeWorld();
    w.simulate(at);
    // (Some particles in the air, so the snapshot carries them.)
    for (let k = 0; k < 4; k += 1) w.particles.emit("dust", [k, 0.3, -k], { count: 6 });
    w.simulate(0.1);
    const snap = w.snapshot();
    const bytes = encode(WORLD_SNAPSHOT, snap as never);
    const back = decode(WORLD_SNAPSHOT, bytes);
    assert.equal(JSON.stringify(back), JSON.stringify(snap), `at ${at}: the snapshot's JSON`);
    assert.ok(bytes.length < JSON.stringify(snap).length / 2);
    w.simulate(1);
    const straight = JSON.stringify(w.snapshot());
    const fresh = makeWorld();
    fresh.restore(back as never);
    fresh.simulate(1);
    assert.equal(JSON.stringify(fresh.snapshot()), straight, `at ${at}: the restored world ran on the same`);
  }
});

test("a particle pool snapshot comes back exactly: loaded into a fresh pool, it steps the same", () => {
  const make = () => createParticlePool({ capacity: 2048, emitters: 64, seed: 11, recipes: PRESETS });
  const a = make();
  const names = Object.keys(PRESETS);
  for (let k = 0; k < 10; k += 1) a.emit(names[k % names.length]!, k, 0, -k);
  for (let k = 0; k < 30; k += 1) a.step(1 / 60);
  const plain = (v: unknown): unknown => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : Array.isArray(v) ? v.map(plain) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)])) : v);
  const snap = plain(a.save()) as never;
  const back = decode(PARTICLE_POOL, encode(PARTICLE_POOL, snap));
  assert.ok(same(back, snap));
  const b = make();
  b.load(back as never);
  for (let k = 0; k < 30; k += 1) { a.step(1 / 60); b.step(1 / 60); }
  assert.ok(same(plain(b.save()), plain(a.save())), "the loaded pool stepped the same");
});

// ---------------------------------------------------------------- scripts

/** A random script (every block kind), from a seeded stream. */
function randomScript(seed: number, plain = false): Script {
  const S = rng(seed, 3);
  const vars = ["a", "b", "c", "hp"];
  const expr = (d: number): Expr => {
    const k = S.int(0, d <= 0 ? 3 : 9);
    switch (k) {
      case 0: return { op: "num", value: S.chance(0.5) ? S.int(-10, 100) : Math.round(S.f() * 1000) / 100 };
      case 1: return { op: "flag", value: S.chance(0.5) };
      case 2: return { op: "text", value: S.pick(["idle", "run", "hello", ""]) };
      case 3: return { op: "var", name: S.pick(vars) };
      case 4: return { op: "arith", fn: S.pick(["+", "-", "*", "/", "%", "min", "max"] as const), a: expr(d - 1), b: expr(d - 1) };
      case 5: return { op: "compare", fn: S.pick(["<", "<=", "==", "!=", ">=", ">"] as const), a: expr(d - 1), b: expr(d - 1) };
      case 6: return { op: "logic", fn: S.pick(["and", "or"] as const), a: expr(d - 1), b: expr(d - 1) };
      case 7: return { op: "not", a: expr(d - 1) };
      case 8: return { op: "random", lo: expr(d - 1), hi: expr(d - 1) };
      default: return { op: "sense", name: S.pick(["distance", "health", "time"]), args: Array.from({ length: S.int(0, 2) }, () => expr(d - 1)) };
    }
  };
  const block = (d: number): Stmt[] => Array.from({ length: S.int(0, d <= 0 ? 2 : 4) }, () => stmt(d));
  const stmt = (d: number): Stmt => {
    const k = S.int(0, d <= 0 ? 4 : 8);
    switch (k) {
      case 0: return { op: "set", name: S.pick(vars), value: expr(2) };
      case 1: return { op: "change", name: S.pick(vars), by: expr(1) };
      case 2: return { op: "do", action: S.pick(["move", "play", "shoot"]), args: Array.from({ length: S.int(0, 3) }, () => expr(1)) };
      case 3: return S.chance(0.5) && !plain ? { op: "send", message: S.pick(["hit", "go"]) } : { op: "wait", seconds: expr(1) };
      case 4: return { op: "stop" };
      case 5: case 6: return { op: "if", cond: expr(2), then: block(d - 1), else: S.chance(0.5) ? block(d - 1) : [] };
      case 7: case 8: if (k === 7 || plain) return { op: "repeat", times: expr(1), body: block(d - 1) };
      default: return { op: "while", cond: expr(2), body: block(d - 1) };
    }
  };
  return { name: `s${seed}`, vars: vars.map((name) => ({ name, init: 0 })), handlers: Array.from({ length: S.int(1, 4) }, () => ({ on: S.pick(["start", "tick", "message", "hit"]), ...(S.chance(0.3) ? { arg: "go" } : {}), body: block(3) })) };
}

test("scripts: blocks -> bytecode -> blocks is exact, and both forms round-trip the codec (2,000 random scripts)", () => {
  for (let n = 0; n < 2000; n += 1) {
    const s = n === 0 ? GUARD_SCRIPT : randomScript(n);
    // (Canonical blocks: an if with an empty else and one without are the same block.)
    const code = compileScript(s);
    const again = decompileScript(code);
    assert.deepEqual(again, JSON.parse(JSON.stringify(s)), `script ${n}`);
    assert.deepEqual(decode(BYTECODE, encode(BYTECODE, code)), code, `bytecode ${n}`);
    assert.deepEqual(decode(BLOCKS, encode(BLOCKS, s as never)), JSON.parse(JSON.stringify(s)), `blocks ${n}`);
  }
  assert.throws(() => compileScript({ name: "x", vars: [], handlers: [{ on: "start", body: [{ op: "set", name: "nope", value: { op: "num", value: 1 } }] }] }), /no variable called nope/);
  assert.throws(() => decompileScript({ name: "x", vars: [], handlers: [{ on: "start", code: [{ op: "+" }] }] }), /takes a value the code never pushed/);
});

/** The block tree run directly (the reference the VM must match): the same semantics, no bytecode. */
function treeRun(script: Script, host: ScriptHost & { log: unknown[] }, steps: number): Json[] {
  const vars: Record<string, Json> = Object.fromEntries(script.vars.map((v) => [v.name, v.init]));
  const n = (v: Json): number => (typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : Number(v) || 0);
  const truthy = (v: Json): boolean => (typeof v === "number" ? v !== 0 : Boolean(v));
  const ev = (e: Expr): Json => {
    switch (e.op) {
      case "num": case "flag": case "text": return e.value;
      case "var": return vars[e.name] ?? null;
      case "not": return !truthy(ev(e.a));
      case "random": { const lo = n(ev(e.lo)), hi = n(ev(e.hi)); return lo + (hi - lo) * host.random(); }
      case "sense": return host.sense(e.name, e.args.map(ev));
      default: {
        const a = ev(e.a), b = ev(e.b);
        switch (e.fn) {
          case "+": return typeof a === "string" || typeof b === "string" ? `${String(a)}${String(b)}` : n(a) + n(b);
          case "-": return n(a) - n(b);
          case "*": return n(a) * n(b);
          case "/": return n(b) === 0 ? 0 : n(a) / n(b);
          case "%": return n(b) === 0 ? 0 : n(a) % n(b);
          case "min": return Math.min(n(a), n(b));
          case "max": return Math.max(n(a), n(b));
          case "<": return n(a) < n(b);
          case "<=": return n(a) <= n(b);
          case "==": return a === b || (typeof a !== "string" && typeof b !== "string" && n(a) === n(b));
          case "!=": return !(a === b || (typeof a !== "string" && typeof b !== "string" && n(a) === n(b)));
          case ">=": return n(a) >= n(b);
          case ">": return n(a) > n(b);
          case "and": return truthy(a) && truthy(b);
          default: return truthy(a) || truthy(b);
        }
      }
    }
  };
  // (Generators: a wait yields its seconds; the thread sleeps them off on the fixed step.)
  type Gen = Generator<number, "stop" | undefined, void>;
  const queue: { g: Gen; sleep: number }[] = [];
  const fire = (on: string, arg?: string): void => { for (const h of script.handlers) if (h.on === on && (h.arg === undefined || h.arg === arg)) queue.push({ g: body(h.body), sleep: 0 }); };
  function* body(list: readonly Stmt[]): Gen {
    for (const s of list) {
      switch (s.op) {
        case "set": vars[s.name] = ev(s.value); break;
        case "change": vars[s.name] = n(vars[s.name] ?? 0) + n(ev(s.by)); break;
        case "do": host.act(s.action, s.args.map(ev)); break;
        case "send": fire("message", s.message); break;
        case "wait": yield n(ev(s.seconds)); break;
        case "stop": return "stop";
        case "if": { const r = yield* body(truthy(ev(s.cond)) ? s.then : s.else); if (r === "stop") return r; break; }
        case "repeat": { const t = Math.floor(n(ev(s.times))); for (let k = 0; k < t; k += 1) { const r = yield* body(s.body); if (r === "stop") return r; } break; }
        case "while": { let guard = 0; while (truthy(ev(s.cond)) && guard++ < 50) { const r = yield* body(s.body); if (r === "stop") return r; } break; }
      }
    }
    return undefined;
  }
  fire("start");
  for (let step = 0; step < steps; step += 1) {
    if (step % 3 === 0) fire("tick");
    if (step % 7 === 0) fire("hit");
    // (As the VM does: the threads that go on first, then those fired this step.)
    const live = queue.splice(0);
    const keep: typeof queue = [];
    for (const t of live) {
      if (t.sleep > 0) { t.sleep -= 0.1; if (t.sleep > 1e-9) { keep.push(t); continue; } t.sleep = 0; }
      const r = t.g.next();
      if (!r.done) { t.sleep = r.value; keep.push(t); }
    }
    queue.unshift(...keep);
  }
  return script.vars.map((v) => vars[v.name] ?? null);
}

test("the VM runs bytecode as the block tree runs: the same actions, in order, the same variables", () => {
  const host = (seed: number): ScriptHost & { log: unknown[] } => {
    const S = rng(seed, 9);
    const log: unknown[] = [];
    return { log, act: (name, args) => { log.push([name, ...args]); }, sense: (name, args) => { const v = name === "canSee" ? true : name === "waypoints" ? 3 : S.int(0, 40); log.push(["sense", name, args.length, v]); return v; }, random: () => S.f() };
  };
  // (Scripts without while loops -- the tree reference caps a while's turns where the VM caps ops per step --
  // and random ones without sends: a handler that sends to itself doubles its threads every step.)
  const noWhile = (s: Script): boolean => !JSON.stringify(s).includes('"while"');
  const noSend = (s: Script): boolean => !JSON.stringify(s).includes('"send"');
  let compared = 0;
  for (let n = 0; n < 400 && compared < 150; n += 1) {
    const s = n === 0 ? { ...GUARD_SCRIPT, handlers: GUARD_SCRIPT.handlers.filter((h) => noWhile({ ...GUARD_SCRIPT, handlers: [h] })) } : randomScript(n + 5000, true);
    if (!noWhile(s) || (n > 0 && !noSend(s))) continue;
    compared += 1;
    const a = host(n), b = host(n);
    const want = treeRun(s, a, 60);
    const vm = createScriptVM(decode(BYTECODE, encode(BYTECODE, compileScript(s))), b);
    vm.fire("start");
    for (let step = 0; step < 60; step += 1) {
      if (step % 3 === 0) vm.fire("tick");
      if (step % 7 === 0) vm.fire("hit");
      vm.step(0.1, 1e7);
    }
    assert.deepEqual(b.log, a.log, `script ${n}: the actions`);
    assert.deepEqual(vm.vars, want, `script ${n}: the variables`);
  }
  assert.ok(compared >= 100);
});

// ---------------------------------------------------------------- the registry

test("the engine's schemas register, and a generic reader decodes an engine document with no code for it", () => {
  const reg = createRegistry();
  const ids = registerEngineSchemas(reg);
  assert.equal(new Set(ids).size, ids.length);
  const doc = encode(OBJECT, objectRecordOf(buildPiece("bench", "0x7") as unknown as ObjectDefLike));
  const got = readDocument(doc, { registry: reg });
  assert.equal(reg.get("keel/object@1")?.id, got.id);
  const x = explainBits(doc, { registry: reg });
  assert.equal(x.schema.name, "keel/object");
  let at = 0;
  for (const s of x.spans) { assert.equal(s.bit, at, s.path); at += s.bits; }
  assert.equal(at, doc.length * 8);
});
