// Portraits, stages and per-instance effects: a unit's or building's own design
// close up (framed on its head, painted through its look, animated from its
// pixels), a death's fall and a building's construction stages made from its
// own solids, and the flash/dissolve a layer instance carries. The GPU bake is
// stood in for by a software ray-caster (soft-raster.ts): the same indexed
// bytes, so everything built on them is tested here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lookOf } from "@keel-engine/core";
import type { LookRoles } from "@keel-engine/core";
import { entityOf, rolesFor } from "@keel-engine/entity";
import {
  FLASH_WHITE, bodyShape, createLookTable, createPortraits, drawPortrait, fxDropped, fxIndex, headOf, packFx, paintRoles, paintSlots, portraitDistance, portraitMask, portraitPlan,
  slotOfRole, unpackFx, withFall, withStages, worldBounds, worldFloor,
} from "../src/index.ts";
import type { BakeWorld, DesignSpec, IndexedSource, LookTable, PortraitSheet, PortraitSubject } from "../src/index.ts";
import { softBake } from "./soft-raster.ts";

// ---------------------------------------------------------------- subjects

const body = (seed: string, kind: "humanoid" | "anthro" | "animal") => bodyShape(entityOf(seed, kind === "anthro" ? { kind, species: "fox", pins: { pack: "none", accessory: "none", hood: false } } : { kind }), { clips: [{ name: "idle", frames: 4, loop: true }, { name: "walk", frames: 6, loop: true }] });
const bodyLook = (table: LookTable, b: ReturnType<typeof body>, seed: string, kind: "humanoid" | "anthro" | "animal", hue: number) =>
  table.add(paintSlots(lookOf(`${seed}|look`, rolesFor(kind) as LookRoles, { pins: { "cloth.hue": hue, "cloth.chroma": 0.18, "accent.hue": hue } }), b.slotRoles({})));

const R = (role: string) => slotOfRole(role as never);
/** A small building: a hall, a tower, a roof ridge, a glowing band -- its slots are look roles. */
function building(key: string, tall: number): IndexedSource & DesignSpec {
  const world: BakeWorld = {
    boxes: [
      { c: [0, 0.9, 0], h: [1.6, 0.9, 1.3], yaw: 0, mat: R("primary") },
      { c: [0.9, 0.9 + tall / 2, -0.5], h: [0.45, tall / 2 + 0.9, 0.45], yaw: 0, mat: R("secondary") },
      { c: [0, 1.95, 0.2], h: [1.7, 0.12, 1.1], yaw: 0, mat: R("dark") },
      { c: [0, 1.2, 1.31], h: [1.2, 0.08, 0.02], yaw: 0, mat: R("glow") },
    ],
    capsules: [{ a: [-1, 2.1, 0], b: [0.5, 2.1, 0], r: 0.18, mat: R("trim") }],
  };
  return { key, clips: [{ name: "still", frames: 1 }], height: 2 + tall + 0.9, radius: 2.2, symmetric: true, pose: () => world };
}
const buildingLook = (table: LookTable, seed: string, hue: number) => table.add(paintRoles(lookOf(`${seed}|b`, { primary: { stuff: "metal" }, secondary: { stuff: "plaster" }, dark: { stuff: "dark" }, trim: { stuff: "paint" }, glow: { stuff: "paint" } } as LookRoles, { pins: { "trim.hue": hue, "glow.hue": hue, "glow.finish": "glow", "glow.light": 0.8, "trim.pattern": "none", "primary.pattern": "none", "secondary.pattern": "none" } })));

/** Bake everything a subject needs in software and offer it. */
function bakeAll(P: ReturnType<typeof createPortraits>, s: PortraitSubject, src: IndexedSource & DesignSpec): number {
  const jobs = P.need(s);
  for (const j of jobs) P.offer(j, softBake(src, j));
  return jobs.length;
}

// ---------------------------------------------------------------- stages

test("withFall: a fall clip from the idle pose, tipping onto the ground and never through it; the rest inherited", () => {
  for (const kind of ["humanoid", "anthro", "animal"] as const) {
    const b = body("7", kind);
    const f = withFall(b, { frames: 4, way: kind === "animal" ? "side" : "forward" });
    assert.notEqual(f.key, b.key);
    assert.deepEqual(f.clips.map((c) => c.name), ["idle", "walk", "fall"]);
    assert.deepEqual(f.pose("walk", 2), b.pose("walk", 2), "the design's own clips are untouched");
    assert.equal(f.clip("idle").frames, b.clip("idle").frames, "a BodyShape's methods are inherited");
    const standing = worldBounds(b.pose("idle", 0))[4];
    const tops = [0, 1, 2, 3].map((i) => worldBounds(f.pose("fall", i))[4]);
    for (let i = 0; i < 4; i += 1) assert.ok(worldFloor(f.pose("fall", i)) >= -1e-6, `${kind} frame ${i} stays above the ground`);
    for (let i = 1; i < 4; i += 1) assert.ok(tops[i]! <= tops[i - 1]! + 1e-6, `${kind}: it keeps going down (${tops.map((t) => t.toFixed(2))})`);
    assert.ok(tops[3]! < standing * (kind === "humanoid" ? 0.5 : 0.8), `${kind}: lying, it's low (${tops[3]!.toFixed(2)} of ${standing.toFixed(2)} m)`);
    assert.ok(f.radius >= b.height, "its footprint holds it lying down");
  }
});

test("withStages: footprint, frame, most of it -- rising, each distinct, dressed by its mechanic; the complete pose untouched", () => {
  const b = building("hall", 2);
  for (const mechanic of ["scaffold", "grow", "warp"] as const) {
    const s = withStages(b, { mechanic, scaffold: R("dark"), accent: R("trim") });
    assert.deepEqual(s.pose("still", 0), b.pose("still", 0));
    const frames = [0, 1, 2, 3].map((i) => s.pose("stage", i));
    const own = (w: BakeWorld, mat: number) => (w.capsules ?? []).filter((c) => c.mat === mat).length + (w.boxes ?? []).filter((x) => x.mat === mat).length;
    const primaryTop = frames.map((w) => Math.max(0, ...(w.boxes ?? []).filter((x) => x.mat === R("secondary")).map((x) => (x.c[1] ?? 0) + (x.h[1] ?? 0))));
    assert.equal(primaryTop[0], 0, `${mechanic}: the first stage is the bare footprint`);
    assert.ok(primaryTop[1]! < primaryTop[2]! && primaryTop[2]! < primaryTop[3]!, `${mechanic}: it rises (${primaryTop.map((v) => v.toFixed(2))})`);
    assert.ok(primaryTop[3]! < worldBounds(b.pose("still", 0))[4], "the last stage isn't finished yet");
    if (mechanic !== "grow") assert.ok(frames.every((w) => (w.boxes ?? []).some((x) => x.mat === R("dark") && (x.c[1] ?? 1) < 0.1)), "every stage stands on a footprint slab");
    const dress = mechanic === "scaffold" ? R("dark") : R("trim");
    assert.ok(frames.slice(1).every((w) => own(w, dress) >= (mechanic === "scaffold" ? 8 : 5)), `${mechanic}: dressed (${frames.map((w) => own(w, dress))})`);
    assert.ok(own(frames[0]!, dress) >= 1, `${mechanic}: the footprint is marked`);
    assert.notDeepEqual(frames[0], frames[1]); assert.notDeepEqual(frames[1], frames[2]); assert.notDeepEqual(frames[2], frames[3]);
  }
  assert.notEqual(withStages(b, { mechanic: "grow", scaffold: 1 }).key, withStages(b, { mechanic: "warp", scaffold: 1 }).key);
});

// ---------------------------------------------------------------- effects

test("fx: flash and dissolve pack into the spare float and back; the shader's rules as code", () => {
  for (const f of [0, 0.25, 0.5, 0.9]) for (const d of [0, 0.25, 0.5, 1]) { const u = unpackFx(packFx(f, d)); assert.ok(Math.abs(u.flash - Math.min(0.999, f)) < 1e-6); assert.equal(u.dissolve, d); }
  assert.equal(packFx(0, 0), 0);
  assert.equal(fxIndex(1, 5, 0), 1);
  assert.equal(fxIndex(1, 5, 0.3), 3);
  assert.equal(fxIndex(1, 5, FLASH_WHITE + 0.01), 4);
  assert.equal(fxIndex(0, 5, 0.9, true), 0, "the outline stays dark");
  for (const d of [0.25, 0.5, 0.75]) { let n = 0; for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) if (fxDropped(x, y, d)) n += 1; assert.equal(n / 256, d); }
});

// ---------------------------------------------------------------- portraits

test("portrait plans: a unit is three views x two breaths at a head-sized scale; a building all of it, with its stages", () => {
  const b = body("3", "humanoid");
  const head = headOf(b)!;
  assert.ok(head && head.r > 0.05 && head.c[1] > worldBounds(b.pose("idle", 0))[4] * 0.6, "the head is up top");
  const p = portraitPlan({ spec: b, kind: "unit", head });
  assert.equal(p.jobs.length, 6);
  assert.ok(Math.abs(2 * head.r * p.k - 0.36 * 56) < 0.6, "the head is 36% of the frame high");
  const bs = withStages(building("hall", 2), { mechanic: "scaffold", scaffold: R("dark") });
  const q = portraitPlan({ spec: bs, kind: "building", stage: "stage" });
  assert.equal(q.jobs.length, 1 + 4);
  assert.ok(q.jobs.every((j) => j.key.startsWith("portrait|")));
});

function world() {
  const table = createLookTable({ rampLength: 5 });
  const units = (["humanoid", "anthro", "animal"] as const).flatMap((kind) => ["11", "42"].map((seed, si) => {
    const b = body(seed, kind);
    return { name: `${kind}/${seed}`, src: b, subject: { spec: b, kind: "unit", head: headOf(b), quadruped: kind === "animal" } as PortraitSubject, look: bodyLook(table, b, seed, kind, si ? 205 : 28) };
  }));
  const buildings = [2, 4].map((tall, i) => {
    const src = withStages(building(`b${tall}`, tall), { mechanic: i ? "grow" : "scaffold", scaffold: R("dark"), accent: R("trim") });
    return { name: `building/${tall}`, src, subject: { spec: src, kind: "building", stage: "stage" } as PortraitSubject, look: buildingLook(table, `b${i}`, i ? 205 : 28) };
  });
  return { table, units, buildings };
}

test("portraits: baked once per design, painted once per look, deterministic frame for frame", () => {
  const { table, units, buildings } = world();
  const make = () => {
    const P = createPortraits(table);
    const sheets: PortraitSheet[] = [];
    for (const u of [...units, ...buildings]) { bakeAll(P, u.subject, u.src); sheets.push(P.sheet(u.subject, u.look)!); }
    return { P, sheets };
  };
  const a = make(), b = make();
  for (let i = 0; i < a.sheets.length; i += 1) {
    assert.ok(a.sheets[i], `sheet ${i} made`);
    assert.deepEqual([...a.sheets[i]!.views[0]!.frames[0]!], [...b.sheets[i]!.views[0]!.frames[0]!], "the same painting");
    for (const st of [{ t: 0.4 }, { t: 3.3, talk: 0.2 }, { t: 7.1, hp01: 0.2, flash: 0.5 }, { t: 9.9, working: true }]) {
      const x = new Uint32Array(60 * 56), y = new Uint32Array(60 * 56);
      drawPortrait(a.sheets[i]!, { ...st, team: [224, 112, 58] }, x); drawPortrait(b.sheets[i]!, { ...st, team: [224, 112, 58] }, y);
      assert.deepEqual([...x], [...y]);
    }
  }
  // The cache: nothing baked twice, nothing painted twice.
  const u = units[0]!;
  assert.equal(a.P.need(u.subject).length, 0);
  assert.equal(a.P.sheet(u.subject, u.look), a.sheets[0]);
  assert.equal(a.P.stats.sheets, units.length + buildings.length);
  // The figure is palette-true: every pixel one of the look table's colours.
  const pal = new Set<number>();
  const rgba = table.palette().rgba;
  for (let i = 0; i < rgba.length; i += 4) pal.add((((255 << 24) | (rgba[i + 2]! << 16) | (rgba[i + 1]! << 8) | rgba[i]!) >>> 0));
  for (const s of a.sheets) for (const c of s.views[0]!.frames[0]!) if (c) assert.ok(pal.has(c), "a palette entry");
});

test("portraits animate: a blink closes only the eyes, talk moves the mouth, hurt adds noise, a hit flashes; buildings work and burn", () => {
  const { table, units, buildings } = world();
  const P = createPortraits(table);
  const frame = (s: PortraitSheet, st: Parameters<typeof drawPortrait>[1]) => { const o = new Uint32Array(60 * 56); drawPortrait(s, { team: [58, 166, 224], ...st }, o); return o; };
  const differ = (a: Uint32Array, b: Uint32Array) => { let n = 0; for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) n += 1; return n; };
  for (const u of units) {
    bakeAll(P, u.subject, u.src);
    const s = P.sheet(u.subject, u.look)!;
    const v = s.views[0]!;
    assert.ok(v.eyes.length >= 2, `${u.name}: it has eyes (${v.eyes.length})`);
    assert.ok(v.mouth.length >= 1 || v.visor.length >= 1, `${u.name}: a mouth or a visor`);
    // Its head is framed: head pixels in the upper half, centred.
    const eyeY = [...v.eyes].reduce((a, i) => a + Math.floor(i / 60), 0) / v.eyes.length;
    assert.ok(eyeY > 8 && eyeY < 34, `${u.name}: eyes at y ${eyeY.toFixed(1)}`);
    // A blink: the closed frame differs from the open one exactly at the eyes.
    const changed: number[] = [];
    v.frames[0]!.forEach((c, i) => { if (c !== v.closed[0]![i]) changed.push(i); });
    assert.ok(changed.length > 0 && changed.every((i) => v.eyes.includes(i)), `${u.name}: a blink closes the eyes only`);
    // Talking changes the picture where the mouth (or visor) is.
    let talked = 0;
    for (let k = 0; k < 8; k += 1) talked += differ(frame(s, { t: 1 + k * 0.09 }), frame(s, { t: 1 + k * 0.09, talk: k * 0.09 }));
    assert.ok(talked > 0, `${u.name}: talk shows`);
    // Hurt: noise; a hit: brighter.
    assert.ok(differ(frame(s, { t: 2 }), frame(s, { t: 2, hp01: 0.15 })) > 40, `${u.name}: noise when hurt`);
    const L = (a: Uint32Array) => a.reduce((m, c) => m + ((c & 255) + ((c >>> 8) & 255) + ((c >>> 16) & 255)), 0) / a.length;
    assert.ok(L(frame(s, { t: 2, flash: 0.8 })) > L(frame(s, { t: 2 })) * 1.4, `${u.name}: a hit flashes`);
  }
  for (const b of buildings) {
    bakeAll(P, b.subject, b.src);
    const s = P.sheet(b.subject, b.look)!;
    assert.equal(s.stages.length, 4, "its four stages painted");
    assert.ok(s.views[0]!.lights.length > 0, "it has lights");
    assert.ok(differ(frame(s, { t: 1.2 }), frame(s, { t: 1.2, working: true })) > 0, "working shows");
    assert.ok(differ(frame(s, { t: 1.2 }), frame(s, { t: 1.2, hp01: 0.5 })) > 10, "cracks and smoke at half health");
    assert.ok(differ(frame(s, { t: 1.2, hp01: 0.5 }), frame(s, { t: 1.2, hp01: 0.2 })) > 20, "fire below a third");
    assert.ok(differ(frame(s, { t: 1.2 }), frame(s, { t: 1.2, stage: 0 })) > 100, "a construction stage is its own picture");
  }
  // A hero's frame.
  const u = units[0]!;
  const hero = P.sheet({ ...u.subject, hero: true }, u.look)!;
  assert.ok(differ(frame(hero, { t: 1 }), frame(P.sheet(u.subject, u.look)!, { t: 1 })) > 150, "a hero's portrait is distinct");
});

test("portraits are distinct: across body kinds, seeds and buildings (the distance metric)", () => {
  const { table, units, buildings } = world();
  const P = createPortraits(table);
  const all = [...units, ...buildings].map((u) => { bakeAll(P, u.subject, u.src); return { name: u.name, s: P.sheet(u.subject, u.look)! }; });
  let min = Infinity, minPair = "";
  const ds: number[] = [];
  for (let i = 0; i < all.length; i += 1) for (let j = i + 1; j < all.length; j += 1) {
    const d = portraitDistance(all[i]!.s.views[0]!.frames[0]!, all[j]!.s.views[0]!.frames[0]!, { a: portraitMask(all[i]!.s), b: portraitMask(all[j]!.s) });
    ds.push(d);
    if (d < min) { min = d; minPair = `${all[i]!.name} vs ${all[j]!.name}`; }
  }
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  // Shift-tolerant: a portrait against its own other breath is near nothing; every pair of subjects stays well apart.
  let breath = 0, minShift = Infinity;
  for (const x of all) { const v = x.s.views[0]!; if (v.frames.length > 1) breath = Math.max(breath, portraitDistance(v.frames[0]!, v.frames[1]!, { a: portraitMask(x.s), b: portraitMask(x.s) }, { shift: 2 })); }
  for (let i = 0; i < all.length; i += 1) for (let j = i + 1; j < all.length; j += 1) minShift = Math.min(minShift, portraitDistance(all[i]!.s.views[0]!.frames[0]!, all[j]!.s.views[0]!.frames[0]!, { a: portraitMask(all[i]!.s), b: portraitMask(all[j]!.s) }, { shift: 2 }));
  console.log(`# shift-tolerant (+-2 px): closest pair ${minShift.toFixed(3)}; a portrait against its own other breath at most ${breath.toFixed(3)}`);
  assert.ok(minShift > 0.1, `shift-tolerant closest pair ${minShift.toFixed(3)}`);
  console.log(`# portrait distance over ${all.length} subjects: min ${min.toFixed(3)} (${minPair}), mean ${mean.toFixed(3)}`);
  assert.ok(min > 0.12, `every pair clearly different (min ${min.toFixed(3)}: ${minPair})`);
});

test("portrait cost: painting a sheet and drawing a frame", () => {
  const { table, units, buildings } = world();
  const P = createPortraits(table);
  for (const u of [...units, ...buildings]) bakeAll(P, u.subject, u.src);
  const t0 = performance.now();
  const sheets = [...units, ...buildings].map((u) => P.sheet(u.subject, u.look)!);
  const paint = (performance.now() - t0) / sheets.length;
  const out = new Uint32Array(60 * 56);
  const t1 = performance.now();
  let n = 0;
  for (let f = 0; f < 200; f += 1) for (const s of sheets) { P.draw(s, { t: f / 60, talk: (f % 40) / 60, hp01: (f % 10) / 10, working: f % 2 === 0, team: [200, 100, 50] }, out); n += 1; }
  const draw = (performance.now() - t1) / n;
  console.log(`# portrait sheet paint ${paint.toFixed(2)} ms each; a frame ${draw.toFixed(3)} ms`);
  assert.ok(paint < 60, `paint ${paint.toFixed(1)} ms`);
  assert.ok(draw < 1, `draw ${draw.toFixed(3)} ms`);
});

test("talking reads at the console's size: a mouth a third of the face wide, an open syllable changes 30+ pixels and drops the jaw", () => {
  const { table, units } = world();
  const P = createPortraits(table);
  const frame = (s: PortraitSheet, st: Parameters<typeof drawPortrait>[1]) => { const o = new Uint32Array(60 * 56); drawPortrait(s, { team: [58, 166, 224], ...st }, o); return o; };
  for (const u of units) {
    bakeAll(P, u.subject, u.src);
    const s = P.sheet(u.subject, u.look)!;
    const v = s.views[0]!;
    if (!v.mouth.length) continue; // (a visor talks by its glow)
    assert.ok(v.mouth.length >= 7, `${u.name}: the mouth is ${v.mouth.length} px wide`);
    // The most a syllable changes (open vs closed at the same moment), over a second of talk.
    let most = 0;
    for (let k = 0; k < 12; k += 1) {
      const a = frame(s, { t: 1 + k * 0.09 }), b = frame(s, { t: 1 + k * 0.09, talk: k * 0.09, talkFor: 1.2 });
      let n = 0; for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) n += 1;
      most = Math.max(most, n);
    }
    assert.ok(most >= 30, `${u.name}: an open syllable changes ${most} px`);
  }
});
