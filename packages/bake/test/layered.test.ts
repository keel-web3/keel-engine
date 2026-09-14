// Shapes, looks and layers: a body shape is its geometry (never its colours
// or its outfit's coverage), an attribute shape is baked once per socket class,
// a body records where its sockets land on every frame, the look table shares
// what it can, and a population is all different for the price of a few shapes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lookDistance, lookOf, rampColours } from "@keel-engine/core";
import { entityOf, socketsOf, speciesEntity } from "@keel-engine/entity";
import type { AttributeShape, EntitySpec } from "@keel-engine/entity";
import { defineAttribute } from "@keel-engine/runtime";
import {
  BODY_SLOTS, LOOK_TEXELS, LOOKS_PER_ROW, SLOTS, WORN_SLOT, attributeShape, bakeCost, bodyShape, createLookTable, directionAxes, paintRoles, paintSlots, planBake, populate,
  slotOfPart, socketClass,
} from "../src/index.ts";

const both = [{ body: "body/humanoid@^1" }, { body: "body/quadruped@^1" }] as const;
const hat = defineAttribute<AttributeShape>({
  id: "hat", slot: "head", targets: both, choices: { crown: ["low", "high", "tall"], brim: { range: [0.5, 1] } },
  look: { roles: { primary: { stuff: "cloth" }, trim: { stuff: "paint" } } },
  build: (S, fit, pins) => {
    const crown = pins["crown"] ?? S.pick(["low", "high", "tall"]);
    const brim = Number(pins["brim"] ?? S.between(0.5, 1));
    const h = { low: 0.4, high: 0.7, tall: 1 }[crown as "low"] * fit.size[1];
    return {
      capsules: [{ a: [0, 0, 0], b: [0, h, 0], r: fit.size[0] * 0.3, role: "primary" }],
      boxes: [{ c: [0, 0, 0], h: [fit.size[0] * 0.5 * brim, fit.size[1] * 0.05, fit.size[2] * 0.5 * brim], role: "trim" }],
    };
  },
});
const pack = defineAttribute<AttributeShape>({
  id: "pack", slot: "back", targets: both, choices: { size: ["small", "big", "huge"] },
  look: { roles: { primary: { stuff: "cloth" }, detail: { stuff: "leather" } } },
  build: (S, fit, pins) => { const k = { small: 0.3, big: 0.4, huge: 0.5 }[(pins["size"] ?? S.pick(["small", "big", "huge"])) as "small"]; return { boxes: [{ c: [0, 0, 0], h: [fit.size[0] * k, fit.size[1] * k, fit.size[2] * k], role: "primary" }] }; },
});
const boot = (side: "L" | "R") => defineAttribute<AttributeShape>({
  id: `boot-${side.toLowerCase()}`, slot: `foot.${side}`, targets: [both[0]], layer: "body", choices: { tall: [1, 2, 3] },
  look: { roles: { primary: { stuff: "leather" }, dark: {} } },
  build: (S, fit, pins) => ({ capsules: [{ a: [0, 0, 0], b: [0, fit.size[1] * Number(pins["tall"] ?? S.pick([1, 2, 3])), 0], r: fit.size[0] * 0.6, role: "primary" }] }),
});

const fox = (seed: string, pins: Record<string, unknown> = {}) => entityOf(seed, { kind: "anthro", species: "fox", pins: { pack: "none", accessory: "none", hood: false, ...pins } });

test("slots by part: every skin part has one, the worn slots follow, 32 in all", () => {
  assert.equal(BODY_SLOTS.length, SLOTS);
  assert.equal(slotOfPart("forearm.L"), slotOfPart("forearm.R"));
  assert.equal(slotOfPart("tail.tip"), BODY_SLOTS.indexOf("tailTip"));
  assert.equal(slotOfPart("upper.FL"), BODY_SLOTS.indexOf("legUpper"));
  assert.equal(slotOfPart("hair.back"), BODY_SLOTS.indexOf("hair"));
  for (const kind of ["humanoid", "anthro", "animal"] as const) for (const seed of ["1", "2", "3"]) {
    const b = bodyShape(entityOf(seed, { kind }));
    for (const c of b.capsules("idle", 0)) assert.ok(c.mat >= 0 && c.mat < WORN_SLOT, `${c.part} -> slot ${c.mat}`);
  }
});

test("a body shape is its geometry: the same for any colours and coverage, different for any shape change", () => {
  const a = bodyShape(fox("7"));
  // Colours and coverage (top, pants, shoes, coat) move roles between parts, never capsules.
  const same = [
    fox("7", { furColour: [0.4, 0.1, 200], outfitColour: { cloth: [0.5, 0.2, 10], clothAlt: [0.3, 0.02, 90], accent: [0.6, 0.1, 300] } }),
    fox("7", { top: "tee" }), fox("7", { pants: "long", shoes: "bare" }), fox("7", { coat: "socks" }),
  ];
  for (const s of same) assert.equal(bodyShape(s).key, a.key);
  const different = [fox("7", { height: 1.08 }), fox("7", { ears: "tall", earSize: 1.1 }), fox("8"), fox("7", { hood: true, top: "hoodie" })];
  for (const s of different) assert.notEqual(bodyShape(s).key, a.key);
  // Its coverage decides what each slot wears.
  const tee = a.slotRoles({ top: "tee" });
  const jacket = a.slotRoles({ top: "jacket" });
  const S = (n: string) => BODY_SLOTS.indexOf(n as never);
  assert.equal(jacket[S("forearm")], "cloth");
  assert.equal(tee[S("forearm")], "fur", "a tee's forearms are bare");
  assert.equal(a.slotRoles({ pants: "long" })[S("shin")], "clothAlt");
  assert.equal(a.slotRoles({ shoes: "bare" })[S("foot")], "fur");
  assert.equal(a.slotRoles({ coat: "muzzle" })[S("snout")], "furAlt");
  assert.equal(jacket[S("tail")], "fur");
  assert.equal(jacket[WORN_SLOT], null, "nothing baked in");
});

test("boots baked into the body change its shape and fill the worn slots", () => {
  const spec = entityOf("3", { kind: "humanoid" });
  const plain = bodyShape(spec);
  const booted = bodyShape(spec, { wear: [{ def: boot("L"), pins: { tall: 2 } }, { def: boot("R"), pins: { tall: 2 } }] });
  assert.notEqual(plain.key, booted.key);
  assert.equal(booted.key, bodyShape(spec, { wear: [{ def: boot("L"), pins: { tall: 2 } }, { def: boot("R"), pins: { tall: 2 } }] }).key);
  assert.ok(booted.capsules("walk", 3).some((c) => c.mat === WORN_SLOT));
  assert.deepEqual(booted.slotRoles().slice(WORN_SLOT), ["primary", "secondary", "trim", "dark"]);
});

test("socket records: where each socket lands per clip, frame and direction, and what's in front", () => {
  const spec = fox("11");
  const b = bodyShape(spec);
  const rec = b.records(8, 0.6);
  const s = (n: string) => rec.sockets.indexOf(n);
  const posed = b.capsules("walk", 2);
  const head = posed.find((c) => c.part === "head")!;
  for (let d = 0; d < 8; d += 1) {
    const ax = directionAxes(d, 8, 0.6);
    const o = rec.at(1, 2, d, s("head"));
    // The head socket sits on the crown: up the screen from the head ball's centre, within a head radius across.
    const hx = head.a[0] * ax.right[0] + head.a[1] * ax.right[1] + head.a[2] * ax.right[2];
    const hy = head.a[0] * ax.up[0] + head.a[1] * ax.up[1] + head.a[2] * ax.up[2];
    assert.ok(Math.abs(rec.data[o]! - hx) < head.r * 1.1 && rec.data[o + 1]! > hy, `dir ${d}: the crown above the head's centre`);
    assert.equal(rec.data[o + 2], 1, "a hat is in front from every side");
  }
  // A pack: behind the body from the front, in front from behind; the neck (around) always in front.
  assert.equal(rec.data[rec.at(0, 0, 0, s("back")) + 2], 0);
  assert.equal(rec.data[rec.at(0, 0, 4, s("back")) + 2], 1);
  assert.equal(rec.data[rec.at(0, 0, 0, s("face")) + 2], 1);
  assert.equal(rec.data[rec.at(0, 0, 4, s("face")) + 2], 0, "glasses are hidden from behind");
  for (let d = 0; d < 8; d += 1) assert.equal(rec.data[rec.at(0, 0, d, s("neck")) + 2], 1);
  // The records follow the pose: the head bobs through a run.
  const ys = Array.from({ length: 8 }, (_, f) => rec.data[rec.at(2, f, 0, s("head")) + 1]!);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.005, "the crown moves through the run");
  assert.equal(b.records(8, 0.6), rec, "cached");
});

test("attribute shapes: one per (shape pins, socket class), whoever wears it; look pins never touch them", () => {
  const specs: EntitySpec[] = ["1", "2", "3", "4", "5", "6"].map((s) => fox(s));
  const classes = new Set(specs.map((s) => socketClass(socketsOf(s).head!, s.plan).key));
  assert.ok(classes.size < specs.length, `${classes.size} head classes for ${specs.length} foxes: neighbours share`);
  const keys = new Set(specs.map((s) => attributeShape(hat, socketClass(socketsOf(s).head!, s.plan), { crown: "high", brim: 0.75 }).key));
  assert.equal(keys.size, classes.size, "one shape per class");
  const cls = socketClass(socketsOf(specs[0]!).head!, "humanoid");
  const k = attributeShape(hat, cls, { crown: "high", brim: 0.75 });
  assert.equal(attributeShape(hat, cls, { crown: "high", brim: 0.75, "primary.hue": 200, profile: "neon" }).key, k.key, "look pins: the same shape");
  assert.notEqual(attributeShape(hat, cls, { crown: "tall", brim: 0.75 }).key, k.key);
  assert.deepEqual([...k.roles].sort(), ["primary", "trim"]);
  // Lifted clear of the ground anchor, sized, one still frame, planned for every direction.
  for (const c of k.pose("still", 0).capsules ?? []) assert.ok(Math.min(c.a[1]!, c.b[1]!) - c.r >= 0);
  assert.equal(planBake([k], { directions: 8, pixelsPerMetre: 24 }).sprites.length, 8);
});

test("the look table: ramps and paints shared by value, looks by paint, the textures laid out as the shader reads them", () => {
  const roles = { primary: { stuff: "cloth" }, trim: { stuff: "paint" } };
  const table = createLookTable({ rampLength: 5 });
  const a = lookOf("a", roles), b = lookOf("b", roles);
  const ia = table.add(paintRoles(a));
  assert.equal(table.add(paintRoles(lookOf("a", roles))), ia, "the same look twice is one look");
  const ib = table.add(paintRoles(b));
  assert.notEqual(ia, ib);
  assert.ok(table.ramps <= 4 && table.colours === table.ramps * 5 && table.paints <= 4);
  const tex = table.texture();
  const paints = table.paintTexture();
  assert.equal(tex.width, LOOKS_PER_ROW * LOOK_TEXELS);
  const slot = 10; // (primary's place in LOOK_ROLES)
  const at = (ib % LOOKS_PER_ROW) * LOOK_TEXELS * 4 + slot;
  const p = tex.data[at]! - 1;
  assert.ok(p >= 0, "the slot names a paint");
  const pal = table.palette();
  const base = paints.data[p * 8]!;
  assert.deepEqual(Array.from(pal.rgba.subarray(base * 4, base * 4 + 3)), rampColours(b.roles.primary!, 5)[0], "the paint points at its ramp");
  assert.equal(paints.data[p * 8 + 1]! & 255, 5);
  assert.equal(paints.data[p * 8 + 7], 1);
  assert.equal(tex.data[(ib % LOOKS_PER_ROW) * LOOK_TEXELS * 4 + 0], 0, "slot 0 (skin): not painted");
  // Paints are shared between looks: another trim on the same primary makes one new paint, not two.
  const before = table.paints;
  table.add(paintRoles(lookOf("a", roles, { pins: { "trim.hue": (a.roles.trim!.hue + 90) % 360 } })));
  assert.equal(table.paints, before + 1, "the primary's paint is shared");
  // A body's paint: each slot its role's ramp from the body's look, the worn slots from the worn thing's.
  const body = bodyShape(fox("5"));
  const look = lookOf("body", { cloth: {}, fur: { stuff: "fur" }, clothAlt: {}, furAlt: {}, accent: {}, hair: {}, dark: {}, blush: {} });
  const paint = paintSlots(look, body.slotRoles({ top: "jacket" }));
  assert.equal(paint[BODY_SLOTS.indexOf("forearm")]!.look, look.roles.cloth);
  assert.equal(paint[BODY_SLOTS.indexOf("head")]!.look, look.roles.fur);
  assert.equal(paint[WORN_SLOT], null);
});

test("a population: every unit different (signature and look distance), from a few shapes -- and deterministic", () => {
  const ents = [speciesEntity("anthro", "fox"), speciesEntity("anthro", "cat"), speciesEntity("humanoid", "human"), speciesEntity("animal", "dog")];
  const make = () => populate({
    seed: "pop", count: 600, shapes: 2, wear: [1, 2], threshold: 0.08,
    entities: ents.map((def) => ({ def, pack: "test", pins: def.body.startsWith("body/humanoid") ? { pack: "none", accessory: "none" } : {}, ...(def.id === "human" ? { wear: [{ defs: [boot("L"), boot("R")], chance: 0.5 }] } : {}) })),
    attributes: [{ def: hat }, { def: pack }],
    clips: [{ name: "idle", frames: 2 }, { name: "walk", frames: 2 }],
  });
  const pop = make();
  assert.ok(pop.bodies.length <= 8 && pop.bodies.length >= 4, `${pop.bodies.length} bodies`);
  assert.equal(new Set(pop.units.map((u) => u.signature)).size, pop.units.length, "every signature distinct");
  // Visibly different: any two units of one entity in one coverage are at least the threshold apart.
  const groups = new Map<string, typeof pop.units[number][]>();
  for (const u of pop.units) { const g = `${u.entity}|${JSON.stringify(Object.entries(u.coverage).sort())}`; (groups.get(g) ?? groups.set(g, []).get(g)!).push(u); }
  for (const us of groups.values()) {
    for (let i = 0; i < us.length; i += 1) for (let j = i + 1; j < us.length; j += 1) assert.ok(lookDistance(us[i]!.look, us[j]!.look) >= 0.08, "two looks too close");
  }
  for (const u of pop.units) {
    assert.ok(u.wears.length >= 1 && u.wears.length <= 2);
    assert.equal(new Set(u.wears.map((w) => pop.attributes[w.shape]!.socket)).size, u.wears.length, "one per socket");
    if (ents[u.entity]!.id === "dog") assert.equal(u.coverage["top"], undefined, "a dog has no top to cover");
  }
  assert.deepEqual(make().units.map((u) => u.signature), pop.units.map((u) => u.signature), "deterministic");
  const cost = bakeCost(pop);
  assert.ok(cost.layered < cost.combined && cost.combined < cost.perUnit, JSON.stringify(cost));
  assert.equal(cost.perUnit, pop.units.reduce((n, u) => n + pop.bodies[u.body]!.clips.reduce((m, c) => m + c.frames, 0) * 8, 0));
});
