import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GENERATIVE_LIMITS, GENERATIVE_PROGRAM_FORMAT, GENERATIVE_RECIPE_FORMAT, GENERATIVE_RUNTIME_VERSION,
  buildGenerativeProgram, generativeProgramReference, parseGenerativeRecipe,
  resolveGenerativeProgram, runGenerativeProgram, serializeGenerativeRecipe, validateGenerativeProgram,
} from "@keel-engine/builder/generative";
import type { AgentOp } from "../src/ops.ts";
import { contentHash } from "../src/design.ts";

const program = (ops: readonly AgentOp[], id = "test-shape") => ({ format: GENERATIVE_PROGRAM_FORMAT, id, title: "Test shape", ops });
const prop = () => program([
  { op: "new", unit: 0.05 },
  { op: "box", from: [-2, 0, -2], to: [2, { $range: [3, 8], integer: true, key: "height" }, 2], role: "primary" },
  { op: "sphere", center: [0, 9, 0], radius: { $range: [1, 2], key: "crown" }, role: { $pick: ["accent", "trim"], key: "crown-role" } },
  { op: "look", role: "primary", colour: [0.65, 0.12, { $range: [20, 100], key: "hue" }] },
]);
const fox = () => program([
  { op: "character", kind: "anthro", species: "fox", seed: { $seed: true }, size: { $range: [0.9, 1.2], key: "height" } },
  { op: "pin", choice: "top", value: { $pick: ["jacket", "hoodie", "vest"] } },
  { op: "proportion", name: "headR", scale: { $range: [1, 1.3] } },
  { op: "pin", choice: "outfitColour", value: { cloth: [0.6, 0.1, { $range: [20, 80] }], clothAlt: [0.4, 0.05, 90], accent: [0.8, 0.1, 180] } },
  { op: "part", id: "crest", shape: "capsule", on: "head", a: [0, 0.2, 0], b: [0, { $range: [0.5, 0.9] }, 0], r: 0.12, role: "accent" },
]);
const rejected = (p: unknown, pattern?: RegExp) => {
  const result = validateGenerativeProgram(p);
  assert.equal(result.ok, false);
  if (!result.ok && pattern) assert.match(result.errors.map((e) => `${e.path}: ${e.message}`).join("\n"), pattern);
  assert.equal(runGenerativeProgram(p, "seed").ok, false);
  assert.equal(buildGenerativeProgram(p, "seed").ok, false);
};

test("seeded primitives resolve reproducibly and vary silhouette and palette across seeds", () => {
  const p = prop(), before = JSON.stringify(p);
  const a = resolveGenerativeProgram(p, "1"), b = resolveGenerativeProgram(JSON.stringify(p), 1);
  assert.ok(a.ok && b.ok); assert.deepEqual(a, b);
  assert.equal(a.budget.ops, a.ops.length);
  assert.equal(JSON.stringify(p), before, "input template stays untouched");
  const variants = new Set<string>();
  for (let i = 0; i < 12; i += 1) { const r = resolveGenerativeProgram(p, String(i)); assert.ok(r.ok); variants.add(JSON.stringify(r.ops)); }
  assert.equal(variants.size, 12);
  assert.equal(a.ops.at(-1)!.op, "target"); assert.equal(a.ops.at(-1)!["id"], p.id);
  const built = buildGenerativeProgram(p, "1"); assert.ok(built.ok, JSON.stringify(built));
  assert.equal(built.built.kind, "object"); assert.ok(built.built.design!.pose("idle", 0).boxes.length > 0);
  assert.ok(built.budget.voxelVisits <= GENERATIVE_LIMITS.voxelVisits);
});

test("capsule characters use native rigs, seeded choices, authored parts, and isolated sessions", () => {
  const a = buildGenerativeProgram(fox(), "first"), b = buildGenerativeProgram(fox(), "first"), c = buildGenerativeProgram(fox(), "next");
  assert.ok(a.ok && b.ok && c.ok, JSON.stringify([a, b, c]));
  assert.equal(a.built.kind, "character"); assert.equal(a.built.spec!.species, "fox");
  assert.equal(a.session.attributes.size, 0); assert.notEqual(a.session, b.session);
  assert.equal(a.session.design!.parts.length, 1);
  assert.deepEqual(a.built.design!.pose("idle", 0), b.built.design!.pose("idle", 0));
  assert.notDeepEqual(a.built.design!.pose("idle", 0), c.built.design!.pose("idle", 0));
  assert.ok(a.built.design!.clips.some((clip) => clip.name === "walk"));
  a.session.design!.parts.length = 0;
  assert.equal(b.session.design!.parts.length, 1);
});

test("missing character.seed uses the program seed", () => {
  const p = program([{ op: "character", kind: "humanoid" }]);
  const a = resolveGenerativeProgram(p, "a"), b = resolveGenerativeProgram(p, "b");
  assert.ok(a.ok && b.ok); assert.match(a.ops[0]!["seed"] as string, /^0x[0-9a-f]{64}$/); assert.notEqual(a.ops[0]!["seed"], b.ops[0]!["seed"]);
});

test("named slots are correlated and unaffected by unrelated op order or object key order", () => {
  const shared = { $range: [1, 2], key: "shared" };
  const p = program([{ op: "character", kind: "anthro", species: "fox" }, { op: "proportion", name: "headR", scale: shared }, { op: "proportion", name: "tailLen", scale: shared }]);
  const q = program([p.ops[0]!, { op: "pin", choice: "hood", value: true }, ...p.ops.slice(1)]);
  const a = resolveGenerativeProgram(p, "seed"), b = resolveGenerativeProgram(q, "seed"); assert.ok(a.ok && b.ok);
  assert.equal(a.ops[1]!["scale"], a.ops[2]!["scale"]); assert.equal(a.ops[1]!["scale"], b.ops[2]!["scale"]);
  const rekey = JSON.parse(JSON.stringify(p), (_k: string, v: unknown) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v) as unknown;
  const r = resolveGenerativeProgram(rekey, "seed"); assert.ok(r.ok); assert.deepEqual(r.ops, a.ops);
});

test("recipe serialization retains program+seed and replays exactly", () => {
  const p = fox(), text = serializeGenerativeRecipe(p, "0x1234");
  const stored = JSON.parse(text) as { format: string; runtime: string; program: unknown; seed: string };
  assert.equal(stored.format, GENERATIVE_RECIPE_FORMAT); assert.deepEqual(stored.program, p); assert.equal(stored.seed, "0x1234");
  assert.equal(stored.runtime, GENERATIVE_RUNTIME_VERSION);
  const a = parseGenerativeRecipe(text), b = resolveGenerativeProgram(p, "0x1234"); assert.deepEqual(a, b);
  assert.equal(parseGenerativeRecipe({ ...stored, format: "keel-generative-recipe@2" }).ok, false);
  assert.equal(parseGenerativeRecipe({ ...stored, execute: "evil" }).ok, false);
  assert.equal(parseGenerativeRecipe({ ...stored, runtime: "keel-generative-runtime@2.0.0" }).ok, false);
  const { runtime: _runtime, ...unversioned } = stored; assert.equal(parseGenerativeRecipe(unversioned).ok, false);
  assert.throws(() => serializeGenerativeRecipe({ bad: true }, "a"), TypeError);
  const signedZero = program([{ op: "new" }, { op: "set", at: [-0, 0, 0], role: "primary" }]);
  assert.deepEqual(parseGenerativeRecipe(serializeGenerativeRecipe(signedZero, "zero")), resolveGenerativeProgram(signedZero, "zero"));
});

test("strict envelope, op and field validation rejects code and unsupported capabilities", () => {
  for (const format of [undefined, "keel-generative-program@2", "javascript"]) rejected({ ...prop(), format }, /JSON|format/);
  rejected({ ...prop(), code: "fetch('https://example.com')" }, /Unknown field/);
  for (const separator of ["\n", "\r", "\u2028", "\u2029"]) {
    const title = `Safe${separator}globalThis.injected=true;//`;
    rejected({ ...prop(), title }, /single-line/);
    rejected(program([{ op: "new" }, { op: "target", as: "object", title: { $pick: ["Safe", title] } }]), /single-line/);
  }
  for (const op of ["eval", "fetch", "generate", "wear", "undo", "animate", "vary", "rig", "attach", "constructor", "toString"]) rejected(program([{ op: "new" }, { op }]), /Unsupported/);
  rejected(program([{ op: "new", import: "arbitrary" }]), /Unknown field/);
  rejected("```json\n{}\n```", /JSON/);
  rejected(program([{ op: "new" }, { op: "box", from: [0, 0, 0], to: [1, 1, 1] }]), /Required/);
});

test("mode and ordering are explicit; source replacement and auto-rig are not available", () => {
  rejected(program([{ op: "box", from: [0, 0, 0], to: [1, 1, 1], role: "primary" }]), /Start/);
  rejected(program([{ op: "new" }, { op: "new" }]), /exactly one/);
  rejected(program([{ op: "new" }, { op: "pin", choice: "top", value: "vest" }]), /incompatible/);
  rejected(program([{ op: "character", kind: "humanoid" }, { op: "look", role: "primary", colour: [0.5, 0.1, 20] }]), /incompatible/);
  rejected(program([{ op: "new" }, { op: "target", as: "entity" }]), /target object/);
  rejected(program([{ op: "character", kind: "humanoid" }, { op: "target", as: "object" }]), /target entity/);
  rejected(program([{ op: "new" }, { op: "target", as: "object" }, { op: "set", at: [0, 0, 0], role: "primary" }]), /last/);
});

test("every expression alternative is type-checked, including unsampled bad branches", () => {
  const make = (v: unknown) => program([{ op: "new" }, { op: "box", from: [0, 0, 0], to: [v, 1, 1], role: "primary" }]);
  rejected(make({ $range: [1, 2] }), /integer:true/);
  rejected(make({ $range: [3, 1], integer: true }), /ordered/);
  rejected(make({ $range: [1, 2.5], integer: true }), /whole-number/);
  rejected(make({ $range: [1, 2], integer: false }), /integer/);
  rejected(make({ $pick: [1, "2"] }), /integer/);
  rejected(make({ $pick: [1, { $range: [1, 2] }] }), /literal finite scalars/);
  rejected(make({ $pick: [] }), /1..32/);
  rejected(make({ $pick: new Array(33).fill(1) }), /1..32/);
  rejected(make({ $range: [1, 2], integer: true, execute: true }), /Unknown/);
  rejected(make({ $seed: true }), /only in character.seed/);
  rejected(make({ $range: [1, Infinity], integer: true }), /finite/);
  rejected(make(NaN), /finite/);
});

test("worst-case voxel work, dense volume and dimensions are rejected before building", () => {
  rejected(program([{ op: "new" }, { op: "box", from: [-50, -50, -50], to: [50, 50, 50], role: "primary" }]), /work/);
  rejected(program([{ op: "new" }, ...Array.from({ length: 100 }, () => ({ op: "box", from: [0, 0, 0], to: [11, 11, 11], role: "primary" }))]), /work/);
  rejected(program([{ op: "new" }, { op: "sphere", center: [0, 0, 0], radius: { $range: [1, 32] }, scale: [4, 4, 4], role: "primary" }]), /within -64/);
  rejected(program([{ op: "new" }, { op: "line", from: [-60, 0, 0], to: [60, 0, 0], radius: 8, role: "primary" }]), /within -64/);
  rejected(program([{ op: "new" }, { op: "set", at: [-64, -64, -64], role: "primary" }, { op: "set", at: [64, 64, 64], role: "primary" }]), /dense bounding volume/);
  rejected(program([{ op: "new" }, { op: "set", at: [0, 0, { $pick: [0, 65] }], role: "primary" }]), /-64..64/);
  rejected(program([{ op: "new", unit: { $pick: [0.05, 1e10] } }]), /0.0001..64/);
  rejected(program([{ op: "new" }, ...Array.from({ length: 17 }, (_, i) => ({ op: "group", name: `g${i}`, from: [0, 0, 0], to: [1, 1, 1] }))]), /16 group/);
});

test("character domains, dimension ranges and shape-required fields are bounded", () => {
  const base: AgentOp = { op: "character", kind: "anthro", species: "fox" };
  rejected(program([{ ...base, kind: { $pick: ["humanoid", "anthro"] } }]), /literal/);
  rejected(program([{ ...base, species: { $pick: ["fox", "human"] } }]), /Species/);
  rejected(program([base, { op: "pin", choice: "height", value: { $range: [0.9, 100] } }]), /0.9..1.1/);
  rejected(program([base, { op: "pin", choice: "ears", value: { $pick: ["tall", "not-an-ear"] } }]), /valid for every/);
  rejected(program([base, { op: "proportion", name: "headR", scale: 1, value: 0.1 }]), /exactly one/);
  rejected(program([base, { op: "part", id: "a", shape: "capsule", on: "head", r: 0.1, role: "accent" }]), /three components/);
  rejected(program([base, { op: "part", id: "a", shape: "box", on: "head", c: [0, 0, 0], h: [1, -1, 1], role: "accent" }]), /0.001..2/);
  rejected(program([base, { op: "part", id: "a", shape: "capsule", on: "head", a: [0, 0, 0], b: [0, 1, 0], r: 0.1, yaw: 1, role: "accent" }]), /Unknown/);
  rejected(program([base, ...Array.from({ length: 65 }, (_, i) => ({ op: "part", id: `p${i}`, shape: "capsule", on: "head", a: [0, 0, 0], b: [0, 1, 0], r: 0.1, role: "accent" }))]), /64 character parts/);
});

test("plain data boundary rejects prototypes, getters, hooks, cycles, sparse arrays and oversized input", () => {
  const p = prop() as unknown as Record<string, unknown>;
  let calls = 0;
  Object.defineProperty(p, "code", { enumerable: true, get() { calls += 1; return "bad"; } }); rejected(p, /plain JSON data/); assert.equal(calls, 0);
  rejected({ ...prop(), toJSON() { calls += 1; return {}; } }, /plain JSON/); assert.equal(calls, 0);
  rejected(JSON.parse('{"format":"keel-generative-program@1","id":"bad","title":"Bad","ops":[],"__proto__":{"polluted":true}}'), /Forbidden/);
  rejected(Object.assign(Object.create({ sneaky: true }) as object, prop()), /plain JSON/);
  const cyc: Record<string, unknown> = { ...prop() }; cyc["cycle"] = cyc; rejected(cyc, /Cycles/);
  rejected({ ...prop(), ops: new Array(3) }, /dense/);
  rejected({ ...prop(), ops: new Array(129).fill({ op: "new" }) }, /128/);
  rejected(program([{ op: "new" }, ...Array.from({ length: 127 }, () => ({ op: "set", at: [0, 0, 0], role: "primary" }))]), /implicit final target/);
  rejected(" ".repeat(GENERATIVE_LIMITS.jsonBytes + 1), /byte budget/);
  rejected({ ...prop(), title: "x".repeat(257) }, /256/);
  for (const id of ["constructor", "__proto__", "prototype"]) rejected({ ...prop(), id }, /identifier/);
  assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
});

test("failure returns errors without exposing partially mutated sessions", () => {
  const badSocket = program([{ op: "character", kind: "humanoid" }, { op: "part", id: "a", shape: "capsule", on: "not-a-bone", a: [0, 0, 0], b: [0, 1, 0], r: 0.1, role: "accent" }]);
  const r = runGenerativeProgram(badSocket, "one"); assert.equal(r.ok, false); assert.equal("session" in r, false);
  const empty = buildGenerativeProgram(program([{ op: "new" }]), "one"); assert.equal(empty.ok, false); if (!empty.ok) assert.match(empty.errors[0]!.message, /empty/);
  const checked = validateGenerativeProgram(prop()); assert.ok(checked.ok);
  (checked.program.ops[1] as Record<string, unknown>)["to"] = [1e9, 1e9, 1e9];
  assert.equal(runGenerativeProgram(checked.program, "one").ok, false, "validation never grants a mutable-object trust bypass");
  for (const seed of [undefined, null, {}, [], Infinity, 1.5, "", "x".repeat(129)]) assert.equal(resolveGenerativeProgram(prop(), seed).ok, false);
});

test("repeated proportions replace a rule on the base body rather than compounding it", () => {
  const base: AgentOp = { op: "character", kind: "anthro", species: "fox", size: 1 };
  const scale: AgentOp = { op: "proportion", name: "headR", scale: 2 };
  const one = buildGenerativeProgram(program([base, scale]), "safe");
  const many = buildGenerativeProgram(program([base, ...Array.from({ length: 100 }, () => ({ ...scale }))]), "safe");
  assert.ok(one.ok && many.ok);
  assert.deepEqual(many.built.spec!.body, one.built.spec!.body);
  assert.deepEqual(many.built.design!.pose("idle", 0), one.built.design!.pose("idle", 0));
  assert.ok(many.built.design!.height < 4);
});

test("prompt reference matches supported format, bounds, native ops and buildable example", () => {
  const r = JSON.parse(generativeProgramReference()) as { format: string; limits: unknown; example: unknown; operations: Record<string, unknown> };
  assert.equal(r.format, GENERATIVE_PROGRAM_FORMAT); assert.deepEqual(r.limits, GENERATIVE_LIMITS);
  assert.equal("generate" in r.operations, false); assert.equal("wear" in r.operations, false);
  assert.equal(buildGenerativeProgram(r.example, "reference").ok, true);
});

test("runtime v1 golden pins native resolution and character geometry", () => {
  assert.equal(GENERATIVE_RUNTIME_VERSION, "keel-generative-runtime@1.0.0");
  const p = { format: GENERATIVE_PROGRAM_FORMAT, id: "golden-character", title: "Golden character", ops: [
    { op: "character", kind: "anthro", species: "fox", seed: { $seed: true }, size: { $range: [0.9, 1.2], key: "height" } },
    { op: "pin", choice: "top", value: { $pick: ["jacket", "hoodie", "vest"], key: "top" } },
    { op: "proportion", name: "headR", scale: { $range: [1, 1.3], key: "head" } },
    { op: "part", id: "crest", shape: "box", on: "head", c: [0, 0.2, 0], h: [0.1, 0.1, 0.1], role: "accent" },
  ] };
  const r = buildGenerativeProgram(p, "0x7"); assert.ok(r.ok);
  assert.equal(r.ops[0]!["seed"], "0x03c9e9bb9f6cf58e961a876049130b018620d4fbe69e319a96ea4a30c4f1381d");
  assert.equal(r.ops[0]!["size"], 1.0864700317382812); assert.equal(r.ops[1]!["value"], "vest"); assert.equal(r.ops[2]!["scale"], 1.2005416870117187);
  assert.equal(contentHash(JSON.stringify(r.built.design!.pose("idle", 0))), "996f64c3e791cf86");
  assert.equal(contentHash(JSON.stringify(r.built.spec)), "1a5ef598f17476d5");
});
