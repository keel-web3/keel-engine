// packs/creatures: every body plan builds for 100 seeds, deterministically;
// its choices pin (and move nothing else); it poses through bake's bodyShape
// with its explicit skin (idle, walk, attack, a fall); its parts land in real
// slots, one role a slot, the team colour a real share of what the game's
// camera sees; the plans' silhouettes and portraits read apart; a frame is
// cheap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lookOf } from "@keel-engine/core";
import type { LookRoles } from "@keel-engine/core";
import { BODY_SLOTS, bodyShape, createLookTable, createPortraits, headOf, paintSlots, portraitDistance, portraitMask, slotOfPart, softBake, softMask, withFall, worldFloor } from "@keel-engine/bake";
import type { BodyShape, PortraitSheet, PortraitSubject } from "@keel-engine/bake";
import { clipOf, poseSkeleton } from "@keel-engine/entity";
import type { Role } from "@keel-engine/entity";
import { CREATURE_CHOICES, CREATURE_PLANS, CREATURE_RIGS, FLOATER_LIFT, creatureOf, groupOf } from "../src/index.ts";
import type { Creature, CreaturePlan } from "../src/index.ts";

const CLIPS = [{ name: "idle", frames: 4 }, { name: "walk", frames: 6 }, { name: "attack", frames: 8 }] as const;
const VIEW = { pixelsPerMetre: 12, pitch: (55 * Math.PI) / 180, direction: 0, directions: 8 };
const shape = (c: Creature): BodyShape => bodyShape(c.spec, { pack: "packs/creatures", clips: CLIPS, skin: (s) => c.skin(s), sockets: c.sockets });
const make = (seed: string, plan: CreaturePlan, size = 1.6, pins: Record<string, unknown> = {}): BodyShape => shape(creatureOf(seed, plan, { size, pins }));
const ROLES: ReadonlySet<Role> = new Set(["fur", "furAlt", "accent", "dark", "eye"]);
const RIDER_ROLES: ReadonlySet<Role> = new Set([...ROLES, "cloth", "clothAlt", "skin"]);

test("every plan builds for 100 seeds, deterministically, on the rig it names", () => {
  for (const plan of CREATURE_PLANS) {
    for (let i = 0; i < 100; i += 1) {
      const c = creatureOf(`s${i}`, plan, { size: 1.6 });
      assert.equal(c.plan, plan);
      assert.equal(c.spec.plan, CREATURE_RIGS[plan], `${plan} rides a ${CREATURE_RIGS[plan]} rig`);
      assert.ok(Number.isFinite(c.height) && c.height > 0.3 && c.height < 1.6 * 1.4, `${plan} #${i} height ${c.height}`);
      for (const [name, def] of Object.entries(CREATURE_CHOICES[plan])) {
        const v = c.pins[name];
        if (Array.isArray(def)) assert.ok(def.includes(v as never), `${plan} ${name} = ${String(v)}`);
        else { const [lo, hi] = (def as { range: readonly [number, number] }).range; assert.ok(typeof v === "number" && v >= lo && v <= hi); }
      }
      const skel = poseSkeleton(c.spec.rig, clipOf(c.spec, "idle")!(c.spec, 0.3, { phase: 0.1 }, {}));
      const k = c.skin(skel);
      assert.ok(k.capsules.length > 5 && k.capsules.length <= 80 && k.boxes.length <= 40, `${plan} #${i}: ${k.capsules.length} capsules, ${k.boxes.length} boxes`);
      for (const p of k.capsules) for (const x of [...p.a, ...p.b, p.r]) assert.ok(Number.isFinite(x), `${plan} #${i} ${p.part}`);
    }
    const a = creatureOf("det", plan, { size: 2 }), b = creatureOf("det", plan, { size: 2 });
    assert.deepEqual(a.pins, b.pins);
    assert.equal(a.height, b.height);
    const skel = poseSkeleton(a.spec.rig, clipOf(a.spec, "walk")!(a.spec, 0, { phase: 0.3 }, {}));
    assert.deepEqual(a.skin(skel), b.skin(skel), `${plan}: the same seed, the same creature`);
    assert.notDeepEqual(creatureOf("other", plan, { size: 2 }).skin(skel), a.skin(skel), `${plan}: another seed, another creature`);
  }
  assert.throws(() => creatureOf("x", "crawler", { size: 0.5 }), RangeError);
  assert.throws(() => creatureOf("x", "crawler", { size: 8 }), RangeError);
  assert.throws(() => creatureOf("x", "nope" as CreaturePlan, { size: 1 }), RangeError);
});

test("every pinned choice pins, and moves nothing else; a bad pin throws", () => {
  for (const plan of CREATURE_PLANS) {
    for (const seed of ["p1", "p2"]) {
      const plain = creatureOf(seed, plan, { size: 1.6 });
      for (const [name, def] of Object.entries(CREATURE_CHOICES[plan])) {
        const values = Array.isArray(def) ? def : [...(def as { range: readonly [number, number] }).range];
        for (const v of values) {
          const c = creatureOf(seed, plan, { size: 1.6, pins: { [name]: v } });
          assert.equal(c.pins[name], v, `${plan} ${name}=${String(v)}`);
          for (const other of Object.keys(plain.pins)) if (other !== name) assert.deepEqual(c.pins[other], plain.pins[other], `${plan}: pinning ${name} moved ${other}`);
        }
        if (Array.isArray(def)) assert.throws(() => creatureOf(seed, plan, { size: 1.6, pins: { [name]: "not-a-value" } }), RangeError);
        else assert.throws(() => creatureOf(seed, plan, { size: 1.6, pins: { [name]: 99 } }), RangeError);
      }
    }
    assert.throws(() => creatureOf("p", plan, { size: 1.6, pins: { nonsense: 1 } }), TypeError);
  }
  // A pin changes what it names: a crawler with eight legs has more legs than one with six.
  const legs = (n: number) => creatureOf("L", "crawler", { size: 1.6, pins: { legs: n } });
  const count = (c: Creature) => { const s = c.skin(poseSkeleton(c.spec.rig, clipOf(c.spec, "idle")!(c.spec, 0, { phase: 0 }, {}))); return s.capsules.filter((p) => groupOf(p.part) === "lower").length; };
  assert.equal(count(legs(6)), 6);
  assert.equal(count(legs(8)), 8);
});

test("bodyShape poses every plan through idle (4), walk (6) and attack (8) with its explicit skin; withFall; stable keys; heights scale", () => {
  for (const plan of CREATURE_PLANS) {
    for (const seed of ["b1", "b2", "b3"]) {
      const c = creatureOf(seed, plan, { size: 1.6 });
      const b = shape(c);
      for (const clip of CLIPS) {
        assert.equal(b.clip(clip.name).frames, clip.frames);
        const seen = new Set<string>();
        for (let f = 0; f < clip.frames; f += 1) {
          const w = b.pose(clip.name, f);
          assert.ok((w.capsules?.length ?? 0) <= 80 && (w.boxes?.length ?? 0) <= 40, `${plan} ${clip.name} ${f}: under budget`);
          assert.ok(worldFloor(w) > -0.03, `${plan} ${clip.name} ${f}: nothing sinks into the ground (${worldFloor(w).toFixed(3)})`);
          seen.add(JSON.stringify(w));
        }
        assert.ok(seen.size > (clip.name === "idle" ? 1 : 3), `${plan} ${clip.name}: it moves (${seen.size} distinct frames)`);
      }
      // A fall: its idle tipping over, never through the ground.
      const fall = withFall(b, { frames: 4, way: c.spec.plan === "quadruped" ? "side" : "forward" });
      for (let f = 0; f < 4; f += 1) assert.ok(worldFloor(fall.pose("fall", f)) >= -1e-6, `${plan} fall ${f}`);
      assert.equal(fall.clip("idle").frames, 4, "the fall keeps the body's own clips");
      // Its key: equal inputs, equal keys; another seed, another key.
      assert.equal(shape(creatureOf(seed, plan, { size: 1.6 })).key, b.key);
      assert.ok(b.key.startsWith("packs/creatures:"));
    }
    assert.notEqual(make("b1", plan).key, make("b2", plan).key);
    // Heights scale with the size (everything is built in proportion to it).
    for (const seed of ["h1", "h2"]) {
      const small = creatureOf(seed, plan, { size: 1.2 }), big = creatureOf(seed, plan, { size: 2.4 });
      assert.ok(Math.abs(big.height / small.height - 2) < 0.02, `${plan}: ${small.height.toFixed(3)} -> ${big.height.toFixed(3)}`);
      assert.ok(small.height / 1.2 > 0.25 && small.height / 1.2 < 1.4, `${plan}: its height is its size class's (${(small.height / 1.2).toFixed(2)} of it)`);
    }
  }
});

test("sockets: head, crown, back, and hand.R or mount on every plan, on real bones, near what they name", () => {
  for (const plan of CREATURE_PLANS) {
    for (const seed of ["k1", "k2"]) {
      const c = creatureOf(seed, plan, { size: 2 });
      for (const n of ["head", "crown", "back"]) assert.ok(c.sockets[n], `${plan} has a ${n} socket`);
      assert.ok(c.sockets["hand.R"] || c.sockets["mount"], `${plan} has a hand.R or a mount`);
      for (const [name, s] of Object.entries(c.sockets)) {
        assert.ok(c.spec.rig.index[s.bone] !== undefined, `${plan} ${name} rides ${s.bone}`);
        assert.ok(s.size.every((v) => v > 0) && s.pos.every(Number.isFinite), `${plan} ${name}`);
      }
      // The head socket sits on the head the portrait frames (within a third of the size).
      const b = shape(c);
      const head = headOf(b)!;
      const hs = c.sockets["head"]!.pos;
      assert.ok(Math.hypot(hs[0] - head.c[0], hs[1] - head.c[1], hs[2] - head.c[2]) < 0.34 * 2, `${plan}: head socket by the head`);
      // Recorded per frame for the layered draw.
      const rec = b.records(8, VIEW.pitch);
      assert.ok(rec.sockets.includes("head") && rec.data.every(Number.isFinite));
    }
  }
});

test("parts: every part lands in a real slot (accessory only when it says so), each slot wears exactly one role, from the plan's roles", () => {
  const accessory = BODY_SLOTS.indexOf("accessory");
  for (const plan of CREATURE_PLANS) {
    for (const seed of ["r1", "r2", "r3", "r4", "r5", "r6"]) {
      const c = creatureOf(seed, plan, { size: 1.6 });
      const b = shape(c);
      const roleOfSlot = new Map<number, Set<Role>>();
      const allowed = plan === "rider" ? RIDER_ROLES : ROLES;
      for (const clip of CLIPS) for (let f = 0; f < clip.frames; f += 1) {
        const k = c.skin(b.skeleton(clip.name, f));
        for (const p of [...k.capsules, ...k.boxes]) {
          const s = slotOfPart(p.part);
          assert.ok(s >= 0, `${plan} ${p.part}`);
          if (s === accessory) assert.equal(groupOf(p.part), "accessory", `${plan}: ${p.part} fell to the accessory slot`);
          assert.ok(allowed.has(p.role), `${plan} ${p.part} wears ${p.role}`);
          const set = roleOfSlot.get(s) ?? new Set<Role>();
          set.add(p.role);
          roleOfSlot.set(s, set);
        }
      }
      const slotRoles = b.slotRoles();
      for (const [s, set] of roleOfSlot) {
        assert.equal(set.size, 1, `${plan} slot ${BODY_SLOTS[s]} wears ${[...set].join(" and ")}`);
        assert.equal(slotRoles[s], [...set][0], `${plan}: bodyShape paints slot ${BODY_SLOTS[s]} as its pieces say`);
      }
      assert.ok([...roleOfSlot.values()].some((x) => x.has("eye")), `${plan} has eyes`);
      assert.ok([...roleOfSlot.values()].some((x) => x.has("accent")), `${plan} wears the team colour`);
    }
  }
});

// ---------------------------------------------------------------- the game's view

/** A silhouette's cells, its lowest row at y = 0 and its box centred on x = 0 (feet aligned, centred). */
function cells(b: BodyShape): Set<number> {
  const m = softMask(b, "idle", 0, VIEW);
  let x0 = m.w, x1 = -1, y1 = -1;
  for (let y = 0; y < m.h; y += 1) for (let x = 0; x < m.w; x += 1) if (m.solid[y * m.w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const cx = Math.floor((x0 + x1) / 2);
  const out = new Set<number>();
  for (let y = 0; y < m.h; y += 1) for (let x = 0; x < m.w; x += 1) if (m.solid[y * m.w + x]) out.add((x - cx + 512) * 1024 + (y1 - y));
  return out;
}
const iou = (a: Set<number>, b: Set<number>): number => { let i = 0; for (const k of a) if (b.has(k)) i += 1; return i / (a.size + b.size - i); };

test("the team colour: 8-30% of what the game's camera sees, on every plan", () => {
  const shares: string[] = [];
  for (const plan of CREATURE_PLANS) {
    const got: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const b = make(`a${i}`, plan);
      const m = softMask(b, "idle", 0, VIEW);
      const roles = b.slotRoles();
      let n = 0, acc = 0;
      for (const s of m.slots) { if (!s) continue; n += 1; if (roles[s - 1] === "accent") acc += 1; }
      got.push(acc / n);
      assert.ok(acc / n >= 0.08 && acc / n <= 0.3, `${plan} a${i}: the team colour is ${((acc / n) * 100).toFixed(1)}% of it`);
    }
    shares.push(`${plan} ${(Math.min(...got) * 100).toFixed(0)}-${(Math.max(...got) * 100).toFixed(0)}%`);
  }
  console.log(`# accent share (12 seeds each): ${shares.join(", ")}`);
});

test("silhouettes read apart: every pair of plans at one size <= 0.60 IoU (feet aligned, centred), a plan at 1.2 m against 2.4 m <= 0.45", () => {
  const seeds = ["v0", "v1", "v2", "v3", "v4", "v5"];
  const masks = CREATURE_PLANS.map((p) => seeds.map((s) => cells(make(s, p))));
  let worst = 0, pair = "";
  const table: string[] = [];
  for (let i = 0; i < CREATURE_PLANS.length; i += 1) for (let j = i + 1; j < CREATURE_PLANS.length; j += 1) {
    let max = 0;
    // (Every seed of one against every seed of the other.)
    for (const a of masks[i]!) for (const b of masks[j]!) max = Math.max(max, iou(a, b));
    table.push(`${CREATURE_PLANS[i]}/${CREATURE_PLANS[j]} ${max.toFixed(2)}`);
    if (max > worst) { worst = max; pair = `${CREATURE_PLANS[i]} vs ${CREATURE_PLANS[j]}`; }
    assert.ok(max <= 0.6, `${CREATURE_PLANS[i]} vs ${CREATURE_PLANS[j]}: IoU ${max.toFixed(3)}`);
  }
  console.log(`# silhouette IoU at 1.6 m, max over ${seeds.length}x${seeds.length} seed pairs: worst ${worst.toFixed(3)} (${pair}); ${table.join(", ")}`);
  let self = 0;
  for (const plan of CREATURE_PLANS) for (const s of seeds.slice(0, 3)) {
    const v = iou(cells(make(s, plan, 1.2)), cells(make(s, plan, 2.4)));
    self = Math.max(self, v);
    assert.ok(v <= 0.45, `${plan} ${s}: 1.2 m against 2.4 m IoU ${v.toFixed(3)}`);
  }
  console.log(`# a plan at 1.2 m against itself at 2.4 m: IoU at most ${self.toFixed(3)}`);
});

test("a floater hovers and a flyer sits at its own origin; a serpent lies on the ground", () => {
  for (const seed of ["f1", "f2", "f3"]) {
    const f = make(seed, "floater", 2);
    for (const clip of CLIPS) for (let i = 0; i < clip.frames; i += 1) assert.ok(worldFloor(f.pose(clip.name, i)) > 2 * 0.08, `floater ${clip.name} ${i}: off the ground (${worldFloor(f.pose(clip.name, i)).toFixed(2)})`);
    const fl = make(seed, "flyer", 2);
    assert.ok(worldFloor(fl.pose("idle", 0)) < 0.3 && worldFloor(fl.pose("idle", 0)) > -0.01, "a flyer's body sits at its origin (the game lifts it)");
    const sp = make(seed, "serpent", 2);
    for (const clip of CLIPS) assert.ok(Math.abs(worldFloor(sp.pose(clip.name, 0))) < 0.02, `serpent ${clip.name}: on the ground`);
  }
});

// ---------------------------------------------------------------- portraits

const LOOK_ROLES: LookRoles = { fur: { stuff: "fur" }, furAlt: { stuff: "fur" }, accent: { stuff: "paint" }, dark: { stuff: "dark" }, eye: { stuff: "glow" }, cloth: { stuff: "cloth" }, clothAlt: { stuff: "cloth" }, skin: { stuff: "skin" } };

test("portraits: every plan has a head a portrait frames, a sheet with eyes, and every pair of plans' portraits >= 0.25 apart", () => {
  const mins: string[] = [];
  for (const [s, race] of ["q0", "q1", "q2"].entries()) {
    // (One race's look for every plan: the colours can't tell them apart, only their shapes and where each role goes.)
    const table = createLookTable({ rampLength: 5 });
    const look = lookOf(`race-${race}`, LOOK_ROLES, { pins: { "eye.finish": "glow", "accent.hue": 20 + s * 110, "accent.chroma": 0.2 } });
    const P = createPortraits(table);
    const sheets: PortraitSheet[] = CREATURE_PLANS.map((plan) => {
      const b = make(race, plan);
      const head = headOf(b);
      assert.ok(head, `${plan}: a head to frame`);
      assert.ok(head.r > 0.04 && head.r < b.height * 0.5, `${plan}: a head-sized head (${head.r.toFixed(3)} m of ${b.height.toFixed(2)})`);
      const subject: PortraitSubject = { spec: b, kind: "unit", head, quadruped: b.spec.plan === "quadruped" };
      for (const j of P.need(subject)) P.offer(j, softBake(b, j));
      const sheet = P.sheet(subject, table.add(paintSlots(look, b.slotRoles())));
      assert.ok(sheet, `${plan}: a sheet`);
      assert.ok(sheet.views[0]!.eyes.length >= 2, `${plan}: eyes to blink (${sheet.views[0]!.eyes.length})`);
      const closed = sheet.views[0]!.closed[0]!, open = sheet.views[0]!.frames[0]!;
      assert.ok(open.some((c, i) => c !== closed[i]), `${plan}: it blinks`);
      return sheet;
    });
    let min = Infinity, pair = "";
    for (let i = 0; i < sheets.length; i += 1) for (let j = i + 1; j < sheets.length; j += 1) {
      const d = portraitDistance(sheets[i]!.views[0]!.frames[0]!, sheets[j]!.views[0]!.frames[0]!, { a: portraitMask(sheets[i]!), b: portraitMask(sheets[j]!) });
      if (d < min) { min = d; pair = `${CREATURE_PLANS[i]} vs ${CREATURE_PLANS[j]}`; }
      assert.ok(d >= 0.25, `${race}: ${CREATURE_PLANS[i]} vs ${CREATURE_PLANS[j]} portraits ${d.toFixed(3)} apart`);
    }
    mins.push(`${race} ${min.toFixed(3)} (${pair})`);
  }
  console.log(`# portrait distance, closest pair per race: ${mins.join("; ")}`);
});

test("a rider's portrait is its rider's: only the rider's head uses the head's part names", () => {
  for (const seed of ["w1", "w2", "w3", "w4"]) {
    const c = creatureOf(seed, "rider", { size: 2 });
    const k = c.skin(poseSkeleton(c.spec.rig, clipOf(c.spec, "idle")!(c.spec, 0, { phase: 0 }, {})));
    const core = k.capsules.filter((p) => ["head", "snout", "nose", "eye", "brow"].includes(groupOf(p.part)));
    assert.ok(core.length >= 3);
    const top = Math.max(...k.capsules.filter((p) => groupOf(p.part) === "pack").map((p) => p.a[1]));
    for (const p of core) assert.ok(p.a[1] > top, `${p.part} is the rider's (above the saddle)`);
    assert.ok(k.capsules.some((p) => p.part.startsWith("body.head")), "the mount's head is drawn, under another name");
  }
});

test("cost: posing and skinning a frame well under 2 ms; under 80 capsules and 40 boxes every frame", () => {
  let n = 0, maxCaps = 0, maxBoxes = 0;
  const t0 = performance.now();
  for (const plan of CREATURE_PLANS) for (const seed of ["c1", "c2", "c3", "c4"]) {
    const c = creatureOf(seed, plan, { size: 1.6 });
    for (const clip of CLIPS) {
      const fn = clipOf(c.spec, clip.name)!;
      for (let f = 0; f < clip.frames; f += 1) {
        const k = c.skin(poseSkeleton(c.spec.rig, fn(c.spec, f * 0.1, { phase: f / clip.frames, landT: 0 }, { speed: 1 }), { pos: [0, 0, 0], yaw: 0 }));
        maxCaps = Math.max(maxCaps, k.capsules.length); maxBoxes = Math.max(maxBoxes, k.boxes.length);
        n += 1;
      }
    }
  }
  const ms = (performance.now() - t0) / n;
  console.log(`# pose + skin: ${ms.toFixed(3)} ms a frame over ${n} frames; at most ${maxCaps} capsules and ${maxBoxes} boxes`);
  if (process.env["KEEL_PERF"] === "1") assert.ok(ms < 2, `${ms.toFixed(3)} ms a frame`);
  assert.ok(maxCaps <= 80 && maxBoxes <= 40);
});

test("the pack: one entity a plan, keeping its rig's body contract (every required socket), built from a stream and pins", async () => {
  const { pack } = await import("../src/index.ts");
  const { manifest } = await import("../src/module.ts");
  const { createRoll, deriveSeed, stream } = await import("@keel-engine/core");
  const { BODY_CONTRACTS, missingSockets } = await import("@keel-engine/entity");
  assert.equal(manifest.id, "packs/creatures");
  assert.equal(manifest.kind, "pack");
  assert.deepEqual(manifest.provides, ["creatures/plans@1.0.0"], "its own contract, not the body contracts an animal AI binds to");
  assert.deepEqual(manifest.contents?.entities?.map((e) => e.id), [...CREATURE_PLANS]);
  assert.deepEqual(JSON.parse(JSON.stringify(manifest.contents)), manifest.contents);
  for (const e of pack.entities) {
    const plan = e.id as CreaturePlan;
    const contract = BODY_CONTRACTS[CREATURE_RIGS[plan]];
    assert.equal(e.body, contract.ref);
    const S = () => stream(createRoll(deriveSeed("pack", plan)), 0);
    const c = e.build(S(), {}) as Creature;
    assert.equal(c.plan, plan);
    assert.deepEqual((e.build(S(), {}) as Creature).pins, c.pins, "deterministic from the stream");
    assert.deepEqual(missingSockets(contract, e.sockets(c)), [], `${plan} keeps ${contract.ref}'s sockets`);
    // (A token's seed, a size and a choice, as pins.)
    const [name, values] = Object.entries(CREATURE_CHOICES[plan]).find(([, d]) => Array.isArray(d)) as [string, readonly unknown[]];
    const pinned = e.build(S(), { seed: "tok", size: 3, [name]: values[values.length - 1] }) as Creature;
    assert.equal(pinned.seed, "tok");
    assert.equal(pinned.pins[name], values[values.length - 1]);
    assert.ok(Math.abs(pinned.height / creatureOf("tok", plan, { size: 1.5, pins: { [name]: values[values.length - 1] } }).height - 2) < 0.02, "pins.size is its size");
  }
});
