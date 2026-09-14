// The agent op list: validation with clear errors, atomic runs, building a
// session into an object, an attribute or an entity -- and the exported pack
// file: it typechecks (strict, the repo's settings) and round-trips.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { createRoll, stream } from "@keel-engine/core";
import { QUADRUPED_BODY, entityOf, missingSockets, socketsOf, wear } from "@keel-engine/entity";
import { OPS, buildSession, createSession, loadData, loadOps, loadVoxels, opReference, opSchema, runOps, sameVoxels, storeData, storeOps, storeVoxels, validateOps } from "../src/index.ts";
import type { AgentOp, VoxelAttributeShape, VoxelSpec } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const S = () => stream(createRoll("0x77"), 0);

test("validation names the op, the field and the fix", () => {
  assert.equal(validateOps("box").ok, false);
  const v = validateOps([
    { op: "bx", from: [0, 0, 0] },
    { op: "box", from: [0, 0, 0], role: "primary" },
    { op: "box", from: [0, 0.5, 0], to: [1, 1, 1], role: "Primary" },
    { op: "sphere", center: [0, 0, 0], radius: 2, role: "skin", colour: "red" },
    { op: "animate", group: "flag", motion: "flap" },
    { nope: true },
  ]);
  assert.equal(v.ok, false);
  const msgs = v.errors.map((e) => e.message);
  assert.match(msgs[0]!, /no op "bx" -- did you mean "box"\?/);
  assert.match(msgs.find((m) => m.startsWith("ops[1]"))!, /"to" is required -- the other corner\. e\.g\. \{"op":"box"/);
  assert.ok(msgs.some((m) => m.startsWith("ops[2]") && m.includes('"from" must be [x, y, z] whole numbers')));
  assert.ok(msgs.some((m) => m.startsWith("ops[2]") && m.includes('"role" must be a role')));
  assert.ok(msgs.some((m) => m.startsWith("ops[3]") && m.includes('no field "colour"')));
  assert.ok(msgs.some((m) => m.startsWith("ops[4]") && m.includes('"motion" must be one of "hinge"')));
  assert.ok(msgs.some((m) => m.startsWith("ops[5]") && m.includes('has no "op"')));
  assert.equal(v.errors.find((e) => e.index === 2 && e.field === "from")?.op, "box");
  // Every example in the table is itself valid.
  assert.deepEqual(validateOps(Object.values(OPS).map((o) => o.example)).errors, []);
});

test("runs are atomic: an op failing leaves the session as it was, and says why", () => {
  const s = createSession();
  const first = runOps([{ op: "new", name: "thing", unit: 0.05 }, { op: "box", from: [0, 0, 0], to: [3, 3, 3], role: "primary" }, { op: "group", name: "lid", from: [0, 3, 0], to: [3, 3, 3] }], s);
  assert.ok(first.ok, JSON.stringify(first.errors));
  assert.equal(first.results[1]!.did, "64 voxels changed");
  const count = s.editor.model.count;
  const bad = runOps([
    { op: "box", from: [0, 4, 0], to: [3, 6, 3], role: "trim" },
    { op: "group", name: "extra", from: [0, 0, 0], to: [1, 1, 1] },
    { op: "unit", metres: 0.2 },
    { op: "animate", group: "lidd", motion: "hinge", axis: "x", to: -1 },
  ], s);
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0]!.message, /ops\[3\] \(animate\): no group "lidd" -- did you mean "lid"\?/);
  assert.equal(s.editor.model.count, count, "the box came off");
  assert.equal(s.editor.model.unit, 0.05, "the unit came back");
  assert.deepEqual([...s.editor.model.groups.keys()], ["lid"], "the group came off");
  const joint = runOps([{ op: "joint", bone: "hips", at: [0, 1, 0] }], s);
  assert.match(joint.errors[0]!.message, /needs a rig/);
  // Undo and redo are ops too.
  const u = runOps([{ op: "box", from: [0, 4, 0], to: [0, 4, 0], role: "glow" }, { op: "undo" }, { op: "redo" }, { op: "undo" }], s);
  assert.ok(u.ok);
  assert.equal(s.editor.model.count, count);
});

test('"wave the flag at 0.5 Hz": a generated banner, animated, built into an object and a bake design', () => {
  const r = runOps([
    { op: "generate", kind: "banner", seed: "4" },
    { op: "animate", group: "cloth", motion: "wave", hz: 0.5, clip: "wind" },
    { op: "target", as: "object", id: "war-banner" },
  ]);
  assert.ok(r.ok, JSON.stringify(r.errors));
  const b = buildSession(r.session);
  assert.equal(b.kind, "object");
  assert.equal(b.object!.key, "war-banner");
  assert.deepEqual(Object.keys((b.object!.meta.builder["animation"] as { clips: object }).clips).sort(), ["idle", "wind"]);
  assert.deepEqual(b.design!.clips.map((c) => c.name).sort(), ["idle", "wind"]);
  assert.equal(b.design!.clip("wind").period, 2);
  assert.notDeepEqual(b.design!.pose("wind", 1), b.design!.pose("wind", 3));
  assert.match(b.code, /export default objectFromVoxels\(VOXELS, \{/);
});

test("a hat by hand, as ops: symmetry, boxes, a band, fitted to the head socket of anything that wears it", () => {
  const ops: AgentOp[] = [
    { op: "new", name: "bucket-hat", unit: 0.02 },
    { op: "symmetry", mode: "xz" },
    { op: "box", from: [0, 0, 0], to: [6, 0, 6], role: "primary" },
    { op: "box", from: [0, 1, 0], to: [4, 5, 4], role: "primary" },
    { op: "box", from: [0, 2, 0], to: [4, 2, 4], role: "accent" },
    { op: "group", name: "band", from: [-5, 2, -5], to: [4, 2, 4] },
    { op: "vary", group: "band", optional: 0.5 },
    { op: "target", as: "attribute", slot: "head", fit: "width", fill: 1.05 },
  ];
  const r = runOps(ops);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(r.session.editor.model.count, 14 * 14 + 10 * 10 * 5);
  const b = buildSession(r.session);
  const hat = b.attribute!;
  assert.equal(hat.slot, "head");
  assert.deepEqual(hat.choices, { band: [true, false] });
  for (const spec of [entityOf("3", { kind: "anthro" }), entityOf("3", { kind: "animal", species: "deer" })]) {
    const worn = wear(hat, spec, S(), { band: false });
    const head = socketsOf(spec)["head"]!;
    const xs = worn.design.boxes.flatMap((bx) => [bx.c[0] - bx.h[0], bx.c[0] + bx.h[0]]);
    assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - head.size[0] * 1.05) < 1e-9);
    assert.ok(!worn.design.boxes.some((bx) => bx.part === "band"), "pinned off");
  }
});

test('"rig as quadruped": a generated critter, a joint moved, a saddle socket -- an entity on the contract', () => {
  const r = runOps([
    { op: "generate", kind: "critter", seed: "12", plan: "quadruped" },
    { op: "rig", as: "quadruped", limbs: "rigid" },
    { op: "joint", bone: "tail0", at: [0, 9, -7] },
    { op: "socket", name: "saddle", bone: "spine", at: [0, 11, 0], size: [6, 2, 6] },
    { op: "vary", group: "legs", y: [0.9, 1.2], anchor: "top" },
    { op: "target", as: "entity", id: "blocky-beast", title: "Blocky beast" },
  ]);
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.match(r.results[1]!.did, /^rigged as quadruped/);
  const b = buildSession(r.session, { pack: "packs/mine" });
  assert.equal(b.entity!.body, QUADRUPED_BODY.ref);
  const spec = b.entity!.build(S(), { legs: { y: 1.1 } });
  assert.deepEqual(missingSockets(QUADRUPED_BODY, b.entity!.sockets(spec)), []);
  assert.ok(b.entity!.sockets(spec)["saddle"]);
  assert.equal(spec.voxel.skin.capsules.length, 0, "rigid limbs");
  assert.ok(b.design!.key.startsWith("packs/mine:voxel/"));
  assert.match(runOps([{ op: "joint", bone: "wing.L", at: [0, 0, 0] }], r.session).errors[0]!.message, /no bone "wing.L"/);
});

test("the op reference and schema cover every op", () => {
  const md = opReference();
  for (const name of Object.keys(OPS)) assert.ok(md.includes(`| \`${name}\` |`), name);
  const schema = opSchema() as { oneOf: Array<{ properties: { op: { const: string } }; required: string[] }> };
  assert.equal(schema.oneOf.length, Object.keys(OPS).length);
  assert.deepEqual(schema.oneOf.find((o) => o.properties.op.const === "box")!.required, ["op", "from", "to", "role"]);
});

test("exported pack files typecheck under the repo's strict settings and round-trip to the same thing", async () => {
  const dir = resolve(here, "..", `.export-check-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  try {
    const sessions: Record<string, AgentOp[]> = {
      "banner-object": [{ op: "generate", kind: "banner", seed: "9" }, { op: "target", as: "object", id: "banner", tags: ["decor"] }],
      "hat-attribute": [{ op: "new", name: "cap", unit: 0.02 }, { op: "symmetry", mode: "xz" }, { op: "box", from: [0, 0, 0], to: [4, 3, 4], role: "primary" }, { op: "box", from: [0, 0, 5], to: [4, 0, 7], role: "trim" }, { op: "vary", size: [0.8, 1.2] }, { op: "target", as: "attribute", slot: "head", fit: "width", bodies: ["body/humanoid@^1"] }],
      "beast-entity": [{ op: "generate", kind: "critter", seed: "21", plan: "quadruped" }, { op: "rig" }, { op: "joint", bone: "neck", at: [0, 12, 6] }, { op: "target", as: "entity", id: "beast" }],
      "fox-character": [{ op: "character", kind: "anthro", species: "fox", seed: "7" }, { op: "pin", choice: "ears", value: "tall" }, { op: "proportion", name: "headR", scale: 1.2 }, { op: "part", id: "fin", shape: "wedge", on: "back", c: [0, 0.2, -0.3], h: [0.08, 0.3, 0.3], lo: 0.1, role: "accent" }, { op: "target", as: "entity", id: "finned-fox" }],
    };
    const built = Object.fromEntries(Object.entries(sessions).map(([name, ops]) => {
      const r = runOps(ops);
      assert.ok(r.ok, `${name}: ${JSON.stringify(r.errors)}`);
      return [name, { r, b: buildSession(r.session) }];
    }));
    const files = Object.entries(built).map(([name, { b }]) => { const f = join(dir, `${name}.ts`); writeFileSync(f, b.code); return f; });
    // Typecheck: the repo's base config, strict, over just these files (their imports pulled in).
    const base = ts.readConfigFile(resolve(here, "../../../tsconfig.base.json"), ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(base.config, ts.sys, resolve(here, "../../.."));
    const program = ts.createProgram(files, { ...parsed.options, noEmit: true, types: ["node"] });
    const diags = files.flatMap((f) => ts.getPreEmitDiagnostics(program, program.getSourceFile(f)));
    assert.deepEqual(diags.map((d) => `${d.file?.fileName}:${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`), []);
    // Round trip: the files load and make the same things.
    const load = async (name: string) => (await import(pathToFileURL(join(dir, `${name}.ts`)).href) as { default: unknown }).default;
    const obj = await load("banner-object") as { key: string; parts: unknown[]; colliders: unknown[]; front: number | null };
    const ob = built["banner-object"]!.b.object!;
    assert.equal(obj.key, ob.key);
    assert.equal(obj.parts.length, ob.parts.length);
    assert.equal(obj.colliders.length, ob.colliders.length);
    assert.equal(obj.front, ob.front);
    const hat = await load("hat-attribute") as { id: string; targets: unknown; choices: unknown; build: (S: unknown, fit: unknown, pins: object) => VoxelAttributeShape };
    const hb = built["hat-attribute"]!.b.attribute!;
    assert.equal(hat.id, hb.id);
    assert.deepEqual(hat.targets, hb.targets);
    assert.deepEqual(hat.choices, hb.choices);
    const socket = socketsOf(entityOf("4", { kind: "humanoid" }))["head"]!;
    assert.deepEqual(hat.build(S(), socket, {}), hb.build(S(), socket, {}));
    const beast = await load("beast-entity") as { body: string; build: (S: unknown, pins: object) => VoxelSpec; sockets: (s: VoxelSpec) => object };
    const eb = built["beast-entity"]!.b.entity!;
    assert.equal(beast.body, eb.body);
    const a = beast.build(S(), {}), c = eb.build(S(), {});
    assert.deepEqual(a.voxel.skin, c.voxel.skin);
    assert.deepEqual(a.rig.bones, c.rig.bones);
    assert.deepEqual(Object.keys(beast.sockets(a)), Object.keys(eb.sockets(c)));
    const fox = await load("fox-character") as { body: string; build: (S: unknown, pins: object) => { body: object; parts: unknown[] } };
    const fb = built["fox-character"]!.b.character!;
    assert.equal(fox.body, fb.body);
    assert.deepEqual(fox.build(S(), { seed: "7" }).body, fb.build(S(), { seed: "7" }).body);
    assert.equal(fox.build(S(), {}).parts.length, 1);
    // (The voxels in the file are the session's.)
    const text = /loadVoxels\(([\s\S]*?)\);/.exec(built["beast-entity"]!.b.code)![1]!.replace(/[\s"+,]/g, "");
    assert.ok(sameVoxels(loadVoxels(text), built["beast-entity"]!.r.session.editor.model));
    console.log(`\n${built["hat-attribute"]!.b.code}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the storage seam: voxels, op lists and asset data store and load through one file, tagged by format", () => {
  const ops: AgentOp[] = [{ op: "generate", kind: "crate", seed: "3" }, { op: "vary", size: [0.8, 1.2] }, { op: "target", as: "object", id: "crate" }];
  const bytes = storeOps(ops);
  assert.deepEqual(loadOps(bytes), ops);
  const r = runOps(loadOps(bytes));
  assert.ok(r.ok);
  const m = r.session.editor.model;
  assert.ok(sameVoxels(loadVoxels(storeVoxels(m)), m));
  const edits = { plan: "quadruped", joints: { neck: [0, 12, 6] } };
  assert.deepEqual(loadData(storeData(edits)), edits);
  assert.throws(() => loadVoxels(Uint8Array.of(1, 2, 3)), /unknown format/);
  assert.throws(() => loadOps(Uint8Array.of(7, 7)), /unknown format/);
});
