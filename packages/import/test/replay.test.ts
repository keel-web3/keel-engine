// The op list IS the import: replayed into a fresh builder session it draws
// the same voxels, names the same parts, attaches the same worn things to the
// same sockets and builds the same attributes and rig; streamed op by op it
// drives the live preview; and a person or an agent adjusts it with ops --
// merge parts, move a worn thing to another socket, mark one as body,
// change a part's role.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, stream } from "@keel-engine/core";
import { applyOp, buildSession, createSession, livePreview, sameVoxels, streamOps, validateOps } from "@keel-engine/builder";
import { SAMPLES, importModel, replayImport } from "../src/index.ts";
import type { ImportResult } from "../src/index.ts";

const S = () => stream(createRoll("0x99"), 0);
const load = (name: string): ImportResult => { const s = SAMPLES().find((x) => x.name === name)!; return importModel(s.bytes ?? s.text!, { name, ...(s.mtl ? { mtl: s.mtl } : {}), ...(s.options as object) }); };

test("replaying the op list reproduces the proposal: voxels, parts, attachments, attributes, rig, object", () => {
  for (const name of ["knight", "dog", "chest", "robot"]) {
    const r = load(name);
    assert.deepEqual(validateOps(r.ops).errors, [], `${name}: a valid op list`);
    const b = replayImport(r.ops);
    const s = b.session;
    assert.ok(sameVoxels(s.editor.model, r.model), `${name}: the same voxels and groups`);
    assert.deepEqual([...s.editor.model.groups.keys()], r.proposal.parts.map((p) => p.id));
    assert.deepEqual(Object.fromEntries(Object.entries(s.attachments).map(([g, a]) => [g, a.socket])), Object.fromEntries(r.attributes.map((a) => [a.part, a.slot])));
    assert.deepEqual(s.colours, r.roles.look.colours, "the source look");
    // The same attributes, built the same, to the same body.
    const built = new Map((b.attributes ?? []).map((w) => [w.attribute.id, w.attribute]));
    for (const a of r.attributes) {
      const def = built.get(a.id);
      assert.ok(def, `${name}: ${a.id} built`);
      const spec = r.rig!.spec;
      assert.deepEqual(def!.build(S(), spec.voxel.sockets[a.slot]!, {}), a.def.build(S(), spec.voxel.sockets[a.slot]!, {}), `${name}: ${a.id} builds the same design`);
    }
    if (r.creature) {
      assert.equal(b.kind, "entity");
      assert.deepEqual(b.rig!.spec.rig.bones, r.rig!.spec.rig.bones, `${name}: the same rig`);
      assert.deepEqual(b.rig!.sockets, r.rig!.sockets);
      // Its bake design wears what it was built wearing.
      assert.equal(b.design!.pose("walk", 2).boxes.length > 0, true);
    } else {
      assert.equal(b.kind, "object");
      assert.equal(b.object!.parts.length, r.object!.parts.length);
      assert.equal(b.object!.colliders.length, r.object!.colliders.length);
    }
  }
});

test("streamed op by op, every op a change event the live preview draws from, ending where a fresh preview would", () => {
  const r = load("dog");
  const s = createSession();
  const live = livePreview(s);
  let n = 0;
  const kinds = new Set<string>();
  for (const res of streamOps(r.ops, s)) {
    assert.ok(res.ok, !res.ok ? res.error.message : "");
    live.apply(res.event);
    kinds.add(res.event.kind);
    n += 1;
  }
  assert.equal(n, r.ops.length);
  assert.deepEqual([...kinds].sort(), ["attach", "group", "look", "model", "rig", "target", "voxels"]);
  const key = (x: ReturnType<typeof live.solids>) => x.solids.boxes.map((b) => [...b.c.map((v) => v.toFixed(5)), ...b.h.map((v) => v.toFixed(5)), b.mat].join()).sort().join(";");
  assert.equal(key(live.solids()), key(livePreview(s).solids()));
});

test("adjusting with ops: merge parts, move a worn thing to another socket, mark one as body, change a part's role", () => {
  const r = load("knight");
  const s = replayImport(r.ops).session;
  const step = (op: Parameters<typeof applyOp>[1]): void => { const res = applyOp(s, op); assert.ok(res.ok, !res.ok ? res.error.message : ""); };
  // The shield slung on the back instead of held; the cape made part of the body; the legs one part; the helmet gold.
  step({ op: "attach", group: "shield", socket: "back" });
  step({ op: "detach", group: "cape" });
  step({ op: "merge", groups: ["leg.L", "leg.R"], into: "legs" });
  const helmetCells = (): Map<string, number> => { const m = new Map<string, number>(); s.editor.model.forEach((x, y, z) => { if (s.editor.model.groupAt(x, y, z) === "helmet") { const role = s.editor.model.roleAt(x, y, z)!; m.set(role, (m.get(role) ?? 0) + 1); } }); return m; };
  const before = helmetCells();
  step({ op: "recolour", from: [...before.keys()][0]!, to: "accent-2", group: "helmet" });
  assert.equal(helmetCells().get("accent-2"), [...before.values()][0]! + (before.get("accent-2") ?? 0));
  const b = buildSession(s);
  const slots = Object.fromEntries((b.attributes ?? []).map((w) => [w.group, w.slot]));
  assert.deepEqual(slots, { helmet: "head", shield: "back", belt: "waist", sword: "hand.R" });
  assert.ok(b.rig!.model.groups.has("cape"), "the cape is body now");
  assert.ok(b.rig!.model.groups.has("legs") && !b.rig!.model.groups.has("leg.L"));
  // Every adjustment is one undo away.
  for (let i = 0; i < 4; i += 1) assert.ok(applyOp(s, { op: "undo" }).ok);
  assert.ok(sameVoxels(s.editor.model, r.model));
  assert.equal(s.attachments["cape"]?.socket, "back");
});
