// Streaming: ops applied one at a time with small change events, undo per op
// of any kind, a live preview updated from the events (only the chunks a
// stroke touches), and character designs -- the capsule-and-rig kind the
// games use -- through the same op list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { HUMANOID_BODY, QUADRUPED_BODY, missingSockets, posed } from "@keel-engine/entity";
import {
  applyOp, attributeFromVoxels, buildSession, characterLook, characterSolids, characterSpec, createSession, createVoxels, generate, livePreview, opsOf, runOps, sameVoxels, streamOps,
} from "../src/index.ts";
import type { AgentOp, ChangeEvent, Session } from "../src/index.ts";
import { topHat } from "./models.ts";

const HUT: AgentOp[] = [
  { op: "new", name: "hut", unit: 0.1 },
  { op: "symmetry", mode: "x" },
  { op: "box", from: [0, 0, -4], to: [5, 6, 4], role: "primary", hollow: true },
  { op: "box", from: [0, 7, -5], to: [6, 7, 5], role: "secondary" },
  { op: "box", from: [0, 8, -4], to: [4, 8, 4], role: "secondary" },
  { op: "symmetry", mode: "none" },
  { op: "box", from: [-1, 0, 4], to: [0, 3, 4], role: "dark" },
  { op: "group", name: "door", from: [-1, 0, 4], to: [0, 3, 4] },
  { op: "animate", group: "door", motion: "hinge", axis: "y", to: -1.2 },
  { op: "set", at: [3, 3, 5], role: "glow" },
  { op: "recolour", from: "secondary", to: "trim" },
];

test("every op streams a small change event; voxel events carry exactly the cells that changed", () => {
  const s = createSession();
  const mirror = createVoxels();
  const events: ChangeEvent[] = [];
  for (const r of streamOps(HUT, s)) {
    assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
    events.push(r.event);
    if (r.event.op === "new") mirror.clear();
    if (r.event.cells) {
      const { at, now, roles } = r.event.cells;
      for (let i = 0; i < now.length; i += 1) mirror.set(at[i * 3]!, at[i * 3 + 1]!, at[i * 3 + 2]!, now[i] ? roles[now[i]! - 1]! : null);
    }
  }
  assert.deepEqual(events.map((e) => e.kind), ["model", "voxels", "voxels", "voxels", "voxels", "voxels", "voxels", "group", "animation", "voxels", "voxels"]);
  assert.deepEqual(events.map((e) => e.seq), events.map((_, i) => i));
  // (Replaying only the events' cells rebuilds the model: a preview never needs the op itself.)
  const m = s.editor.model;
  let same = mirror.count === m.count;
  m.forEach((x, y, z) => { if (mirror.roleAt(x, y, z) !== m.roleAt(x, y, z)) same = false; });
  assert.ok(same);
  const roof = events[3]!;
  assert.equal(roof.added, 14 * 11);
  assert.deepEqual(roof.region, { min: [-7, 7, -5], max: [6, 7, 5] });
  assert.equal(events[10]!.recoloured, 14 * 11 + 10 * 9, "the roof, recoloured");
  assert.equal(events[7]!.name, "door");
  assert.equal(events[8]!.rebuild, "none");
});

test("undo takes back one op of any kind -- a box, a group, a joint, a pin, a part -- and redo applies it again", () => {
  const s = createSession();
  assert.ok(runOps(HUT, s).ok);
  const cells = (x: Session) => { const out: string[] = []; x.editor.model.forEach((a, b, c, v) => out.push(`${a},${b},${c}:${v}`)); return out.join(";"); };
  const full = cells(s);
  // Undo the recolour: its event hands back the cells as they were.
  const u = applyOp(s, { op: "undo" });
  assert.ok(u.ok && u.event.kind === "undo" && u.event.of === "voxels" && u.event.recoloured === 14 * 11 + 10 * 9);
  assert.equal(s.editor.model.roleAt(0, 7, 0), "secondary");
  // Undo the lamp, the animation, the group.
  assert.ok(applyOp(s, { op: "undo", steps: 3 }).ok);
  assert.equal(s.animation.clips["idle"], undefined);
  assert.equal(s.editor.model.groups.has("door"), false);
  const r = applyOp(s, { op: "redo", steps: 4 });
  assert.ok(r.ok && r.event.kind === "redo");
  assert.equal(cells(s), full);
  assert.ok(s.animation.clips["idle"]);
  // A new op drops the redo branch.
  assert.ok(applyOp(s, { op: "undo" }).ok);
  assert.ok(applyOp(s, { op: "set", at: [9, 9, 9], role: "dark" }).ok);
  assert.equal(applyOp(s, { op: "redo" }).ok, false);
  // Rig ops undo too.
  const c = createSession();
  assert.ok(runOps([{ op: "generate", kind: "critter", seed: "4", plan: "quadruped" }, { op: "rig" }, { op: "joint", bone: "neck", at: [0, 14, 6] }], c).ok);
  assert.ok(c.rig?.joints?.["neck"]);
  applyOp(c, { op: "undo" });
  assert.equal(c.rig?.joints?.["neck"], undefined);
});

test("the live preview updates from events, re-meshing only the chunks a stroke touches", () => {
  const s = createSession();
  const live = livePreview(s);
  const big: AgentOp[] = [{ op: "new", name: "wall", unit: 0.1 }, { op: "box", from: [-40, 0, 0], to: [39, 20, 3], role: "primary" }];
  for (const r of streamOps(big, s)) { assert.ok(r.ok); live.apply(r.event); }
  const chunks = live.stats.chunks;
  assert.ok(chunks >= 10);
  const r = applyOp(s, { op: "box", from: [2, 2, 4], to: [3, 3, 4], role: "glow" });
  assert.ok(r.ok);
  live.apply(r.event);
  assert.equal(live.stats.lastMeshed, 1, "one chunk re-meshed");
  // The preview is what a fresh one of the final model is.
  const fresh = livePreview(s);
  const key = (x: ReturnType<typeof live.solids>) => x.solids.boxes.map((b) => [...b.c.map((v) => v.toFixed(5)), ...b.h.map((v) => v.toFixed(5)), b.mat].join()).sort().join(";");
  assert.equal(key(live.solids()), key(fresh.solids()));
  // Undo streams back through it as well.
  const u = applyOp(s, { op: "undo" });
  assert.ok(u.ok);
  live.apply(u.event);
  assert.equal(key(live.solids()), key(livePreview(s).solids()));
  assert.ok(!key(live.solids()).includes(`,${live.solids().look.table["glow"]}`));
});

test("characters through the op list: kind and species (the contract), pins, proportions, parts, worn attributes", () => {
  const hat = attributeFromVoxels(topHat(), { id: "top-hat", slot: "head" });
  const s = createSession(undefined, { attributes: [hat] });
  const live = livePreview(s);
  const ops: AgentOp[] = [
    { op: "character", kind: "anthro", species: "fox", seed: "7" },
    { op: "pin", choice: "top", value: "hoodie" },
    { op: "pin", choice: "pack", value: "none" },
    { op: "proportion", name: "headR", scale: 1.2 },
    { op: "proportion", name: "tailLen", scale: 1.5 },
    { op: "part", id: "horn.L", shape: "capsule", on: "head", a: [-0.25, 0, 0.1], b: [-0.4, 0.8, 0], r: 0.1, role: "furAlt" },
    { op: "part", id: "horn.R", shape: "capsule", on: "head", a: [0.25, 0, 0.1], b: [0.4, 0.8, 0], r: 0.1, role: "furAlt" },
    { op: "part", id: "fin", shape: "wedge", on: "back", c: [0, 0.2, -0.3], h: [0.08, 0.3, 0.3], lo: 0.1, role: "accent" },
    { op: "part", id: "badge", shape: "box", on: "chest", c: [0.2, 0, 0.1], h: [0.1, 0.1, 0.05], role: "trim" },
    { op: "wear", attribute: "top-hat" },
    { op: "part", id: "horn.R", shape: "capsule", on: "head", a: [0.25, 0, 0.1], b: [0.5, 0.9, 0], r: 0.12, role: "furAlt" },
    { op: "target", as: "entity", id: "horned-fox", title: "Horned fox" },
  ];
  const events: ChangeEvent[] = [];
  for (const r of streamOps(ops, s)) { assert.ok(r.ok, JSON.stringify(!r.ok && r.error)); events.push(r.event); live.apply(r.event); }
  assert.deepEqual(events.map((e) => [e.kind, e.action ?? ""]), [["character", ""], ["character", "add"], ["character", "add"], ["proportion", "edit"], ["proportion", "edit"], ["part", "add"], ["part", "add"], ["part", "add"], ["part", "add"], ["wear", "add"], ["part", "edit"], ["target", ""]]);
  assert.match(events[3]!.did, /^headR \d\.\d+ -> \d\.\d+ m$/);
  const spec = characterSpec(s.design!);
  assert.equal(spec.outfit.top, "hoodie");
  assert.equal(spec.species, "fox");
  const plain = characterSpec({ ...s.design!, body: {} });
  assert.ok(Math.abs(spec.body.headR - plain.body.headR * 1.2) < 1e-12);
  // Drawn: its skin, the parts (a wedge among them), the hat.
  const look = characterLook(spec);
  const solids = characterSolids(s.design!, posed(spec, "run", { phase: 0.3 }), look, s.attributes, spec);
  assert.ok(solids.boxes.some((b) => b.kind === "wedge"));
  assert.ok(solids.capsules.length > 20);
  assert.ok(live.solids().solids.boxes.length >= 3);
  // Built: the engine's entity on its contract, a bake design, pack code.
  const b = buildSession(s, { pack: "packs/mine" });
  assert.equal(b.kind, "character");
  assert.equal(b.character!.body, HUMANOID_BODY.ref);
  const built = b.character!.build({ f: () => 0.5, between: (a: number) => a, int: (a: number) => a, pick: <T>(l: readonly T[]) => l[0]!, chance: () => false }, { seed: "7" });
  assert.deepEqual(missingSockets(HUMANOID_BODY, b.character!.sockets(built)), []);
  assert.equal(built.parts.length, 4);
  assert.ok(b.design!.key.startsWith("packs/mine:character/anthro/fox#7+top-hat~"));
  for (let f = 0; f < 8; f += 1) assert.ok(b.design!.pose("walk", f).boxes.length >= 4);
  assert.match(b.code, /export default characterEntity\(\{/);
  // Four legs work the same way.
  const q = runOps([{ op: "character", kind: "animal", species: "deer", seed: "3" }, { op: "proportion", name: "neckLen", scale: 1.3 }, { op: "part", id: "bell", shape: "capsule", on: "neck", a: [0, -0.6, 0.5], b: [0, -0.6, 0.5], r: 0.3, role: "accent" }]);
  assert.ok(q.ok, JSON.stringify(q.errors));
  assert.equal(buildSession(q.session).character!.body, QUADRUPED_BODY.ref);
});

test("character ops say what's wrong", () => {
  const s = createSession();
  const msg = (ops: AgentOp[]) => { const r = runOps(ops, s); assert.equal(r.ok, false); return r.errors[0]!.message; };
  assert.match(msg([{ op: "pin", choice: "ears", value: "tall" }]), /is for characters: start one with \{ "op": "character"/);
  assert.ok(runOps([{ op: "character", kind: "anthro", species: "cat" }], s).ok);
  assert.match(msg([{ op: "pin", choice: "eras", value: "tall" }]), /no choice "eras" -- did you mean "ears"\?/);
  assert.match(msg([{ op: "pin", choice: "ears", value: "antennae" }]), /ears = "antennae" is not one of/);
  assert.match(msg([{ op: "proportion", name: "headr", scale: 2 }]), /no proportion "headr" on a anthro -- did you mean "headR"\?/);
  assert.match(msg([{ op: "part", id: "x", shape: "capsule", on: "wing", a: [0, 0, 0], b: [0, 1, 0], r: 0.1, role: "fur" }]), /"wing" is no socket/);
  assert.match(msg([{ op: "part", id: "x", shape: "box", on: "head", c: [0, 0, 0], h: [0.1, 0.1, 0.1], role: "furalt" }]), /did you mean "furAlt"\?/);
  assert.match(msg([{ op: "wear", attribute: "beanie" }]), /no attribute "beanie"/);
  assert.match(msg([{ op: "box", from: [0, 0, 0], to: [1, 1, 1], role: "primary" }]), /designing a character/);
  assert.match(msg([{ op: "character", kind: "animal", species: "frog" }]), /frog/);
  // (Each failure changed nothing.)
  assert.equal(s.design!.kind, "anthro");
  assert.deepEqual(s.design!.pins, {});
});

test("any model as an op list (its boxes, then its groups) replays to itself", () => {
  for (const kind of ["critter", "windmill", "banner"] as const) {
    const g = generate(kind, "6");
    const r = runOps(opsOf(g.model));
    assert.ok(r.ok, JSON.stringify(r.errors));
    const m = r.session.editor.model;
    m.origin = g.model.origin;
    assert.ok(sameVoxels(m, g.model), kind);
  }
});
