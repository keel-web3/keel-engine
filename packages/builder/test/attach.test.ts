// Groups worn as attributes: merge, attach (and move to another socket),
// detach (mark as body again) through the op list; the body leaves them out
// (the rig and the entity don't see them), buildSession turns each into an
// attribute sized to its socket, and the bake design wears them. And a group
// op re-meshes only the chunks under its region in the live preview.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoll, stream } from "@keel-engine/core";
import { entityOf, placeAttribute, posed, socketsOf, wear } from "@keel-engine/entity";
import { applyOp, attachmentModel, bodyOf, buildSession, createSession, livePreview, opsOf, runOps, sameVoxels, streamOps, validateOps } from "../src/index.ts";
import type { AgentOp } from "../src/index.ts";
import { blockPerson } from "./models.ts";

const S = () => stream(createRoll("0x51"), 0);

/** A block person wearing a hat (a group on its head) and holding a sword (a group by its right hand). */
function wornOps(): AgentOp[] {
  return [
    ...opsOf(blockPerson()),
    { op: "box", from: [-4, 32, -4], to: [3, 33, 3], role: "accent" },
    { op: "box", from: [-2, 34, -2], to: [1, 37, 1], role: "accent" },
    { op: "group", name: "hat", from: [-4, 32, -4], to: [3, 37, 3] },
    { op: "box", from: [6, 12, 2], to: [6, 13, 3], role: "trim" },
    { op: "group", name: "grip", from: [6, 12, 2], to: [6, 13, 3] },
    { op: "box", from: [6, 12, 4], to: [6, 13, 12], role: "trim" },
    { op: "group", name: "blade", from: [6, 12, 4], to: [6, 13, 12] },
  ];
}

test("merge, attach, detach: validated, undoable, and the body leaves attached groups out", () => {
  assert.deepEqual(validateOps([
    { op: "merge", groups: ["blade", "grip"], into: "sword" },
    { op: "attach", group: "sword", socket: "hand.R", fill: 1.2, anchor: "center", offset: [0, 0, 1.5] },
    { op: "detach", group: "sword" },
  ]).errors, []);
  const s = createSession();
  const r = runOps(wornOps(), s);
  assert.ok(r.ok, JSON.stringify(r.errors));
  const count = s.editor.model.count;
  const socketOf = (g: string): string | undefined => s.attachments[g]?.socket;
  // Merge: one group, where the first was in the order; the rest forgotten; cells unchanged.
  const m = applyOp(s, { op: "merge", groups: ["grip", "blade"], into: "sword" });
  assert.ok(m.ok && m.event.kind === "group");
  assert.deepEqual([...s.editor.model.groups.keys()].slice(-2), ["hat", "sword"]);
  assert.equal(attachmentModel(s, "sword").count, 2 * 2 + 2 * 9);
  // Attach: a known socket (a typo gets a suggestion), then it's out of the body.
  const bad = applyOp(s, { op: "attach", group: "hat", socket: "haed" });
  assert.ok(!bad.ok && /no socket "haed" -- did you mean "head"\?/.test(bad.error.message));
  assert.ok(applyOp(s, { op: "attach", group: "hat", socket: "head" }).ok);
  assert.ok(applyOp(s, { op: "attach", group: "sword", socket: "hand.L" }).ok);
  const moved = applyOp(s, { op: "attach", group: "sword", socket: "hand.R" });
  assert.ok(moved.ok && moved.event.kind === "attach" && moved.event.did === "sword: hand.L -> hand.R");
  assert.equal(bodyOf(s).count, count - attachmentModel(s, "hat").count - attachmentModel(s, "sword").count);
  assert.equal(bodyOf(s).groups.has("hat"), false);
  assert.equal(s.editor.model.count, count, "attaching moves nothing");
  // Detach: body again; undo puts the attachment back.
  assert.ok(applyOp(s, { op: "detach", group: "sword" }).ok);
  assert.equal(s.attachments["sword"], undefined);
  assert.ok(applyOp(s, { op: "undo" }).ok);
  assert.equal(socketOf("sword"), "hand.R");
  const nd = applyOp(s, { op: "detach", group: "legs" });
  assert.ok(!nd.ok && /isn't attached/.test(nd.error.message));
  // Ungrouping an attached group drops its attachment too.
  assert.ok(applyOp(s, { op: "ungroup", name: "hat" }).ok);
  assert.equal(s.attachments["hat"], undefined);
  assert.ok(applyOp(s, { op: "undo" }).ok);
  assert.equal(socketOf("hat"), "head");
});

test("an entity built with attached groups: rigged without them, each an attribute on its socket, worn by the bake design", () => {
  const ops: AgentOp[] = [
    ...wornOps(),
    { op: "merge", groups: ["grip", "blade"], into: "sword" },
    { op: "attach", group: "hat", socket: "head", id: "block-hat" },
    { op: "attach", group: "sword", socket: "hand.R" },
    { op: "rig", as: "humanoid" },
    { op: "target", as: "entity", id: "block-knight" },
  ];
  const r = runOps(ops);
  assert.ok(r.ok, JSON.stringify(r.errors));
  const built = buildSession(r.session);
  assert.equal(built.kind, "entity");
  // The rig is the plain person's: the hat and sword changed nothing.
  const plain = buildSession(runOps([...opsOf(blockPerson()), { op: "rig", as: "humanoid" }, { op: "target", as: "entity", id: "p" }]).session);
  assert.deepEqual(built.rig!.spec.rig.bones, plain.rig!.spec.rig.bones);
  assert.ok(sameVoxels(built.rig!.model, blockPerson()), "the rigged body is the person, nothing worn");
  // Two attributes, targeting the rig's body, each with its own pack file.
  const byId = Object.fromEntries((built.attributes ?? []).map((a) => [a.attribute.id, a]));
  assert.deepEqual(Object.keys(byId).sort(), ["block-hat", "sword"]);
  assert.equal(byId["block-hat"]!.slot, "head");
  assert.deepEqual(byId["sword"]!.attribute.targets, [{ body: "body/humanoid@^1" }]);
  assert.match(byId["sword"]!.code, /slot: "hand\.R"/);
  // Worn by the bake design: its frames hold more than the body's.
  const bodyOnly = plain.design!.pose("idle", 0);
  const wearing = built.design!.pose("idle", 0);
  assert.ok(wearing.boxes.length > bodyOnly.boxes.length);
  // And on another body -- a catalogue human -- the hat sits on its head socket, sized to it.
  const human = entityOf("5", { kind: "humanoid" });
  const worn = wear(byId["block-hat"]!.attribute, human, S());
  const fitted = placeAttribute(posed(human, "idle", { t: 0 }), worn.socket, worn.design);
  assert.ok(fitted.boxes.length > 0);
  const w = Math.max(...fitted.boxes.map((b) => b.c[0] + b.h[0])) - Math.min(...fitted.boxes.map((b) => b.c[0] - b.h[0]));
  assert.ok(Math.abs(w - socketsOf(human)["head"]!.size[0]) < 1e-6, `the hat is the head socket's width (${w})`);
});

test("a group op re-meshes only the chunks under its region, and the preview still matches a fresh one", () => {
  const s = createSession();
  const live = livePreview(s);
  for (const r of streamOps([
    { op: "new", name: "wall", unit: 0.1 },
    { op: "box", from: [0, 0, 0], to: [79, 7, 1], role: "primary" },
    { op: "box", from: [70, 0, 0], to: [79, 7, 1], role: "secondary" },
  ], s)) { assert.ok(r.ok); live.apply(r.event); }
  const g = applyOp(s, { op: "group", name: "door", from: [2, 0, 0], to: [4, 5, 1] });
  assert.ok(g.ok && g.event.rebuild === "none" && g.event.region);
  live.apply(g.event);
  assert.equal(live.stats.lastMeshed, 1, "one chunk");
  const key = (x: ReturnType<typeof live.solids>) => x.solids.boxes.map((b) => [...b.c.map((v) => v.toFixed(5)), ...b.h.map((v) => v.toFixed(5)), b.mat].join()).sort().join(";");
  assert.equal(key(live.solids()), key(livePreview(s).solids()));
  assert.match(g.event.did, /^group door: 36 voxels in \[2,0,0\]\.\.\[4,5,1\]$/);
});
