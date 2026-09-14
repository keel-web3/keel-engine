// The style contract: wedge parts (physics' and the renderer's ramp), the
// pixel style's primitives, the style registry and its fallback chain, the
// lockable setting, styled objects (pins, shape vs look, keys, determinism),
// world looks and profiles, wind, the bake design, content packs and placing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOOK_ROLES } from "@keel-engine/core";
import { createCharacter } from "@keel-engine/physics";
import {
  bakeDesignOf, bakeForPhysics, bakeForRenderer, ballPrims, checkStyle, checkWorldRoles, collidersOfDesign, conePrims, createStyleRegistry, cylinderPrims,
  defineContentPack, defineObject, defineProfile, defineStyledObject, lookFor, phaseAt, pixelStyle, placeContent, placeObject, rendererLook, resolveStyle,
  shapeCount, shapeGrid, solid, solidSdf, styleSetting, swayPose, swayShift, swayWeight, topsOf, worldColliders, worldLook, worldSockets,
} from "../src/index.ts";
import type { Design, ObjectStyle, StyledPart } from "../src/index.ts";
import { createRoll, deriveSeed, stream } from "@keel-engine/core";

const near = (a: number, b: number, eps: number, msg = ""): void => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);

// ---------------------------------------------------------------- wedges

test("a wedge part: its SDF is physics' wedge, it collides as a wedge, bakes as one for physics and the renderer", () => {
  const def = defineObject({ key: "slope", parts: [{ wedge: { c: [0, 1, 0], h: [1.5, 1, 3], yaw: 0, lo: 0 }, name: "slope", mat: "floor" }], front: "+z" });
  assert.equal(def.colliders.length, 1);
  assert.equal(def.colliders[0]!.kind, "wedge");
  // (A slope isn't a place to put things: no auto top.)
  assert.equal(topsOf(def.parts, def.colliders).length, 0);
  const p = def.parts[0]!;
  assert.ok(p.wedge);
  assert.ok(p.sdf(0, 0.1, 2, 0, null) < 0, "inside near the foot");
  assert.ok(p.sdf(0, 1.9, 2.9, 0, null) > 0, "above the foot is air");
  assert.ok(p.sdf(0, 1.9, -2.9, 0, null) < 0, "inside at the top end");
  const inst = placeObject(def, { pos: [5, 0, 0], yaw: Math.PI / 2 });
  const wc = worldColliders(inst)[0]!;
  assert.equal(wc.kind, "wedge");
  near(wc.yaw, Math.PI / 2, 1e-12);
  const phys = bakeForPhysics([inst]);
  assert.equal(phys.boxes[0]!.kind, "wedge");
  const ren = bakeForRenderer([inst], { mats: { floor: 3 } });
  assert.equal(ren.boxes[0]!.kind, "wedge");
  assert.equal(ren.boxes[0]!.mat, 3);
});

test("a body walks up a wedge ramp built as an object (its foot at +z, rising to -z)", () => {
  const def = defineObject({ key: "ramp", parts: [{ wedge: { c: [0, 0.75, 0], h: [2, 0.75, 4] }, name: "slope" }, { box: { c: [0, 0.75, -6], h: [2, 0.75, 2] }, name: "landing" }] });
  const floor = { c: [0, -0.5, 0] as [number, number, number], h: [30, 0.5, 30] as [number, number, number] };
  const body = createCharacter({ boxes: [floor, ...bakeForPhysics([placeObject(def)]).boxes], spawn: [0, 0.5, 6], waterY: -10 });
  for (let i = 0; i < 400 && body.pos[2] > -5; i += 1) body.step(1 / 60, { move: [0, -1] });
  assert.ok(body.pos[1] > 1.3, `on the landing, not stopped at the foot (y ${body.pos[1].toFixed(2)})`);
});

// ---------------------------------------------------------------- the pixel style's primitives

test("pixel: a round ball is one sphere, a long one a capsule, a flat one a cloud of spheres inside its extents", () => {
  const round = ballPrims({ kind: "ball", role: "leaf", c: [0, 1, 0], r: [1, 1.1, 0.95] });
  assert.equal(round.length, 1);
  const long = ballPrims({ kind: "ball", role: "leaf", c: [0, 1, 0], r: [0.3, 0.3, 2] });
  assert.equal(long.length, 1);
  near(long[0]!.b[2] - long[0]!.a[2], 2 * (2 - 0.3), 1e-9);
  const flat = ballPrims({ kind: "ball", role: "leaf", c: [0, 1, 0], r: [2, 0.5, 2] });
  assert.ok(flat.length >= 6);
  for (const s of flat) assert.ok(Math.hypot(s.a[0], s.a[2]) + s.r <= 2 + 1e-9 && Math.abs(s.a[1] - 1) + s.r <= 0.5 * 1.2 + 1e-9);
});

test("pixel: cones step (a star by default, an octagon, a square), cylinders are capsules or true octagons", () => {
  const cone = (sides?: 4 | 8 | "star") => conePrims({ kind: "cone", role: "roof", c: [0, 0, 0], r: 1, h: 2, top: 0, ...(sides ? { sides } : {}) });
  const star = cone(), oct = cone(8), sq = cone(4);
  assert.equal(star.length % 2, 0);
  assert.equal(oct.length, (star.length / 2) * 4);
  assert.equal(sq.length, star.length / 2);
  assert.ok(cylinderPrims({ kind: "cylinder", role: "bark", c: [0, 0, 0], r: 0.05, h: 1 }).capsule);
  // An octagon of four bars: a point is in the union exactly when it's in the regular octagon of that apothem.
  const bars = cylinderPrims({ kind: "cylinder", role: "wall", c: [0, 0, 0], r: 1, h: 2 }).boxes;
  assert.equal(bars.length, 4);
  const a = Math.cos(Math.PI / 8);
  for (let i = 0; i < 400; i += 1) {
    const x = ((i * 37) % 100) / 50 - 1, z = ((i * 61) % 100) / 50 - 1;
    const inOct = Math.abs(x) <= a && Math.abs(z) <= a && (Math.abs(x) + Math.abs(z)) / Math.SQRT2 <= a;
    const inBars = bars.some((b) => { const c = Math.cos(b.yaw), s = Math.sin(b.yaw); const lx = x * c - z * s, lz = x * s + z * c; return Math.abs(lx) <= b.h[0] + 1e-9 && Math.abs(lz) <= b.h[2] + 1e-9; });
    if (Math.abs((Math.abs(x) + Math.abs(z)) / Math.SQRT2 - a) > 1e-3 && Math.abs(Math.max(Math.abs(x), Math.abs(z)) - a) > 1e-3) assert.equal(inBars, inOct, `${x},${z}`);
  }
});

test("design SDFs: a square cone and cylinder are square; a design's colliders come from its solids", () => {
  const sq = solidSdf({ kind: "cylinder", role: "wall", c: [0, 0, 0], r: 1, h: 1, sides: 4 });
  assert.ok(sq(0.69, 0.5, 0.69) < 0 && sq(0.72, 0.5, 0) > 0);
  const cols = collidersOfDesign({ solids: [solid.box("wall", [0, 1, 0], [1, 1, 1]), solid.ball("leaf", [0, 3, 0], 1, { collide: false }), solid.wedge("roof", [0, 2.5, 0], [1, 0.5, 1]), solid.capsule("bark", [0, 0, 0], [0, 2, 0], 0.2)] });
  assert.deepEqual(cols.map((c) => [c.part, c.kind ?? "box"]), [["wall", "box"], ["roof", "wedge"], ["bark", "box"]]);
});

// ---------------------------------------------------------------- the contract, the registry, the chain

const tree = defineStyledObject({
  id: "t",
  choices: { h: { range: [4, 8] }, crown: ["round", "tall"], season: ["summer", "winter"] },
  look: { roles: { leaf: { as: "primary", stuff: "cloth" }, bark: { as: "detail", stuff: "wood" } }, choices: ["season"] },
  tier: "background",
  sway: { amp: 0.04, hz: 0.4, bend: 1.6, from: 1 },
  design: (J, v) => ({
    solids: [
      solid.cylinder("bark", [0, 0, 0], 0.3, (v["h"] as number) * 0.6, { name: "trunk" }),
      solid.ball("leaf", [J.between(-0.1, 0.1), (v["h"] as number) * 0.72, 0], v["crown"] === "tall" ? [1.4, 2.2, 1.4] : [2, 1.5, 2], { collide: false, group: "crown" }),
    ],
    front: null,
    sockets: { base: { kind: "anchor", pos: [0, 0, 0] } },
  }),
});

test("styles are checked against the contract; a registry always has pixel", () => {
  assert.throws(() => checkStyle({ name: "Bad", contract: "style/Bad@1.0.0", build: () => null }), /lower-case/);
  assert.throws(() => checkStyle({ name: "chunky", contract: "style/other@1.0.0", build: () => null }), /contract/);
  assert.throws(() => checkStyle({ name: "chunky", contract: "style/chunky@1", build: () => null }), /contract/);
  const reg = createStyleRegistry([]);
  assert.deepEqual(reg.names(), ["pixel"]);
});

// A custom style: every solid its bounds, as one box (a "blocky" style any module could provide).
const blocky: ObjectStyle = {
  name: "blocky", contract: "style/blocky@1.0.0", fallback: "pixel",
  build(design: Design) {
    if (design.solids.some((s) => s.role === "glow")) return null; // (it declines what it can't draw)
    const parts: StyledPart[] = design.solids.map((s) => {
      const b = s.kind === "ball" ? [s.c[0] - s.r[0], s.c[1] - s.r[1], s.c[2] - s.r[2], s.c[0] + s.r[0], s.c[1] + s.r[1], s.c[2] + s.r[2]] : s.kind === "cylinder" ? [s.c[0] - s.r, s.c[1], s.c[2] - s.r, s.c[0] + s.r, s.c[1] + s.h, s.c[2] + s.r] : [0, 0, 0, 0.1, 0.1, 0.1];
      return { box: { c: [(b[0]! + b[3]!) / 2, (b[1]! + b[4]!) / 2, (b[2]! + b[5]!) / 2], h: [(b[3]! - b[0]!) / 2, (b[4]! - b[1]!) / 2, (b[5]! - b[2]!) / 2] }, name: s.name ?? s.role, role: s.role, mat: s.role, collide: false };
    });
    return { parts };
  },
};

test("the fallback chain: a missing style draws pixel and says why; a registered custom style draws; a locked setting wins", () => {
  const reg = createStyleRegistry([pixelStyle]);
  const missing = tree.build({ seed: 1, style: "voxel", registry: reg });
  assert.equal(missing.style, "pixel");
  assert.equal(missing.fellBack, true);
  assert.match(missing.why, /voxel isn't available/);
  reg.add(blocky);
  const b = tree.build({ seed: 1, style: "blocky", registry: reg });
  assert.equal(b.style, "blocky");
  assert.equal(b.fellBack, false);
  assert.match(b.key, /@blocky~/);
  // (A locked setting: the placement's request is overridden, and the reason says so.)
  const locked = tree.build({ seed: 1, style: "pixel", setting: styleSetting("blocky", { locked: true }), registry: reg });
  assert.equal(locked.style, "blocky");
  assert.match(locked.why, /locked to blocky/);
  // (An unlocked setting is a default: the request wins.)
  assert.equal(tree.build({ seed: 1, style: "pixel", setting: styleSetting("blocky"), registry: reg }).style, "pixel");
  assert.equal(tree.build({ seed: 1, setting: styleSetting("blocky"), registry: reg }).style, "blocky");
  assert.equal(resolveStyle({ requested: "nope", registry: reg }).name, "pixel");
});

test("a style that declines a design hands it down its chain; the colliders and sockets never change with the style", () => {
  const reg = createStyleRegistry([pixelStyle, blocky]);
  const lamp = defineStyledObject({
    id: "lamp", look: { roles: { metal: { as: "metal" }, glow: { as: "glow" } } },
    design: () => ({ solids: [solid.cylinder("metal", [0, 0, 0], 0.05, 2), solid.ball("glow", [0, 2.1, 0], 0.15, { collide: false })], front: null }),
  });
  const b = lamp.build({ style: "blocky", registry: reg });
  assert.equal(b.style, "pixel");
  assert.match(b.why, /declined/);
  const p = tree.build({ seed: 4, style: "pixel", registry: reg });
  const k = tree.build({ seed: 4, style: "blocky", registry: reg });
  assert.deepEqual(k.def.colliders, p.def.colliders);
  assert.deepEqual(k.def.sockets, p.def.sockets);
});

test("an asset's own builder for a style wins over the registry's; a style's parts must carry the asset's roles", () => {
  const own = defineStyledObject({
    id: "own", look: { roles: { wall: { as: "primary" } } },
    styles: { pixel: (d) => ({ parts: [{ box: { c: [0, 0.5, 0], h: [0.5, 0.5, 0.5] }, name: "cube", role: "wall", mat: "wall" }] as StyledPart[], stats: { mine: 1 } }) },
    design: () => ({ solids: [solid.box("wall", [0, 1, 0], [1, 1, 1])] }),
  });
  assert.equal(own.build().stats["mine"], 1);
  const liar = defineStyledObject({
    id: "liar", look: { roles: { wall: { as: "primary" } } },
    styles: { pixel: () => ({ parts: [{ box: { c: [0, 0.5, 0], h: [0.5, 0.5, 0.5] }, name: "cube", role: "roof", mat: "roof" }] as StyledPart[] }) },
    design: () => ({ solids: [solid.box("wall", [0, 1, 0], [1, 1, 1])] }),
  });
  assert.throws(() => liar.build(), /role "roof"/);
  assert.throws(() => defineStyledObject({ id: "bad", look: { roles: { a: { as: "primary" }, b: { as: "primary" } } }, design: () => ({ solids: [] }) }), /both paint primary/);
});

// ---------------------------------------------------------------- styled objects

test("styled objects: every choice draws (pins never move the rest), pins are checked, a variant choice is implicit", () => {
  assert.ok(tree.choices["variant"]);
  assert.ok(tree.shape.includes("variant") && !tree.shape.includes("season"));
  for (let s = 0; s < 30; s += 1) {
    const free = tree.values(s);
    const pinned = tree.values(s, { crown: "tall" });
    assert.equal(pinned["crown"], "tall");
    assert.equal(pinned["h"], free["h"]);
    assert.equal(pinned["season"], free["season"]);
  }
  assert.throws(() => tree.build({ pins: { crown: "square" } }), /not one of/);
  assert.throws(() => tree.build({ pins: { h: 20 } }), /outside/);
});

test("styled objects: the shape is a pure function of its shape values -- a look pin never changes the key, and equal keys are equal parts", () => {
  const a = tree.build({ seed: 5, pins: { h: 6, crown: "round", variant: 2, season: "summer" } });
  const b = tree.build({ seed: 99, pins: { h: 6, crown: "round", variant: 2, season: "winter" } });
  assert.equal(a.key, b.key);
  assert.equal(a.values["season"], "summer");
  assert.equal(b.values["season"], "winter");
  const c = tree.build({ seed: 5, pins: { h: 6, crown: "round", variant: 3 } });
  assert.notEqual(a.key, c.key, "another variant, another jitter");
  // (The same definition made again from its spec builds the same geometry.)
  const again = defineStyledObject(tree.spec).build({ seed: 5, pins: { h: 6, crown: "round", variant: 2 } });
  assert.equal(again.key, a.key);
  assert.deepEqual(again.def.parts.map((p) => p.prim), a.def.parts.map((p) => p.prim));
  assert.equal(a.tier, "background");
  assert.ok(a.def.tags.includes("tier:background") && a.def.tags.includes("style:pixel"));
});

test("a population on a grid of shape values makes few shapes", () => {
  const S = stream(createRoll(deriveSeed("pop", 0)), 0);
  const keys = new Set<string>();
  for (let i = 0; i < 400; i += 1) keys.add(tree.build({ seed: i, pins: shapeGrid(tree, S, { steps: 3 }) }).key);
  assert.ok(keys.size <= shapeCount(tree, 3), `${keys.size} shapes <= ${shapeCount(tree, 3)}`);
});

// ---------------------------------------------------------------- looks, profiles

test("world roles paint distinct slots; a profile's ranges hold; pins by world role; the renderer's look leaves 4 and 5 alone", () => {
  assert.throws(() => checkWorldRoles("x", { a: { as: "nope" as never } }), /isn't a look role/);
  const summer = defineProfile({ id: "summer", roles: { leaf: { hue: [140, 150], light: [0.4, 0.5] }, bark: { finish: "matte" } } });
  for (let i = 0; i < 40; i += 1) {
    const look = worldLook(tree.look.roles, `s${i}`, { profile: summer });
    const leaf = look.roles.primary!;
    assert.ok(leaf.hue >= 140 && leaf.hue <= 150, `hue ${leaf.hue}`);
    assert.ok(leaf.light >= 0.4 - 0.011 && leaf.light <= 0.5 + 0.011, `light ${leaf.light}`);
  }
  const pinned = worldLook(tree.look.roles, "p", { profile: summer, pins: { "leaf.hue": 300 } });
  assert.equal(pinned.roles.primary!.hue, 300);
  const rl = rendererLook(tree.look.roles, lookFor(tree, "x"));
  assert.ok(rl.mats["leaf"] !== 4 && rl.mats["leaf"] !== 5 && rl.mats["bark"] !== 4 && rl.mats["bark"] !== 5);
  assert.equal(rl.materials[4]!.ramp, "water");
});

// ---------------------------------------------------------------- wind

test("wind: nothing below `from`, all of it at the top; the shader's shift is whole pixels, none at the ground; baked frames bend the top most", () => {
  const sway = tree.sway!;
  assert.equal(swayWeight(0.5, 6, sway), 0);
  near(swayWeight(6, 6, sway), 1, 1e-12);
  for (let t = 0; t < 3; t += 0.25) {
    assert.equal(swayShift(0, 100, 16, sway, t, 0.2), 0);
    assert.ok(Number.isInteger(swayShift(80, 100, 16, sway, t, 0.2)));
  }
  assert.equal(phaseAt(3, 4, 0.5), phaseAt(3, 4, 0.5));
  const built = tree.build({ seed: 2 });
  const top = built.def.bounds[4];
  const posed = swayPose(built.def.parts, top, sway, 1, 4);
  const moved = posed.map((p, i) => { const q = p.capsule ?? p.box; const o = built.def.parts[i]!.prim!; return q && "a" in q && o.type === "capsule" ? Math.abs(q.a[0] - o.a[0]) : q && "c" in q && o.type === "box" ? Math.abs(q.c[0] - o.c[0]) : 0; });
  assert.ok(Math.max(...moved) > 0.05);
  const bake = bakeDesignOf(built, { swayFrames: 4 });
  assert.deepEqual(bake.clips.map((c) => c.name), ["still", "sway"]);
  assert.match(bake.key, /\|sway4$/);
});

test("the bake design: parts on their roles' slots, a key with the style, a tier", () => {
  const built = tree.build({ seed: 3 });
  const d = bakeDesignOf(built);
  const w = d.pose("still", 0);
  const slots = new Set([...w.boxes, ...w.capsules].map((s) => s.mat));
  assert.deepEqual([...slots].sort(), [LOOK_ROLES.indexOf("primary"), LOOK_ROLES.indexOf("detail")].sort());
  assert.ok(d.key.startsWith("obj:-/t@pixel~"));
  assert.equal(d.tier, "background");
  assert.ok(d.roles["primary"] && d.roles["detail"]);
});

// ---------------------------------------------------------------- packs and placing

test("a content pack binds its objects to it, lists them for the manifest, and places records", () => {
  const summer = defineProfile({ id: "summer", roles: { leaf: { hue: [140, 150] } } });
  const winter = defineProfile({ id: "winter", roles: { leaf: { hue: [220, 230], light: [0.9, 0.95] } } });
  const withProfiles = defineStyledObject({ ...tree.spec, look: { ...tree.spec.look, profiles: ["summer", "winter"] } });
  const pack = defineContentPack({ id: "packs/test", version: "1.0.0", objects: [withProfiles], profiles: [summer, winter] });
  assert.equal(pack.get("t")!.pack, "packs/test");
  assert.deepEqual(pack.contents().objects[0]!.tags, ["tier:background"]);
  const placed = placeContent([pack], { pack: "packs/test", id: "t", seed: 7, pins: { season: "winter" }, pos: [3, 0, 4], yaw: 1 });
  assert.ok(placed.built.key.startsWith("obj:packs/test/t@pixel~"));
  // (The season choice names a profile: winter's leaf.)
  assert.ok(placed.look.roles.primary!.hue >= 220 && placed.look.roles.primary!.hue <= 230);
  assert.deepEqual(worldSockets(placed.instance)["base"]!.pos, [3, 0, 4]);
  assert.throws(() => placeContent([pack], { pack: "packs/none", id: "t" }), /No pack/);
  assert.throws(() => defineContentPack({ id: "packs/x", version: "1.0.0", objects: [withProfiles] }), /profile "summer"/);
});
