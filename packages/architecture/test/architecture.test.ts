import assert from "node:assert/strict";
import { test } from "node:test";
import { cityHeight, generateCity, sidewalkReach, streetsOf } from "@keel-engine/city";
import type { City, Lot } from "@keel-engine/city";
import { roadField } from "@keel-engine/road";
import { DOOR_LIFT, RISER, SLOT, blockWorld, districtPaint, frameOf, lookOf, planCity, planCitySteps, planLot, planStreets, planStreetsSteps } from "../src/index.ts";
import type { Archetype, Catalogue, StreetCatalogue } from "../src/index.ts";

// (A small catalogue of its own: the engine's tests never import a pack.)
const arch = (id: string, massing: Archetype["massing"], extra: Partial<Archetype> = {}): Archetype => ({
  id, fits: { minFront: 8, minDepth: 8 }, storeys: [2, 60], setbacks: [0, 0, 0], massing, facades: ["f"], materials: { redBrick: 1, glassBlue: 1 },
  signs: [{ kind: "storefront", chance: 1 }, { kind: "blade", chance: 0.5 }], roof: [{ kind: "waterTower", chance: 0.5 }, { kind: "hvac", chance: 1, count: [1, 3] }], ...extra,
});
const every = { box: 1, cake: 1, tower: 1, wings: 1 };
const CAT: Catalogue = {
  version: "test@1",
  archetypes: [
    arch("box", [{ op: "extrude" }, { op: "cornice" }, { op: "roof", kinds: { flat: 1, gable: 1 } }]),
    arch("cake", [{ op: "setbacks", tiers: [2, 4], step: [2, 4] }, { op: "crown", kinds: { stepped: 1, spire: 1, mast: 1 } }], { storeys: [14, 60] }),
    arch("tower", [{ op: "podium", storeys: [2, 4] }, { op: "tower", inset: [3, 6], tiers: [1, 3] }, { op: "crown", kinds: { fins: 1, helipad: 1, slant: 1 } }], { storeys: [12, 60], signs: [{ kind: "ledCrown", chance: 1 }] }),
    arch("wings", [{ op: "wings", shapes: ["L", "U"], depth: [6, 8] }, { op: "roof", kinds: { flat: 1 } }], { storeys: [2, 2], fits: { minFront: 20, minDepth: 20 } }),
  ],
  facades: { f: { id: "f", bay: [3, 3.5], storey: [3, 3.5], groundH: [4, 5] } },
  materials: {
    redBrick: { hue: 30, chroma: 0.09, light: 0.4, span: 0.3, finish: "matte", windows: { type: "punched", fill: 0.5, share: 0.4, warm: true } },
    glassBlue: { hue: 230, chroma: 0.08, light: 0.3, span: 0.3, finish: "leather", windows: { type: "curtain", fill: 0.9, share: 0.5, warm: false } },
    neonA: { hue: 0, chroma: 0.24, light: 0.66, span: 0.3, finish: "glow", bloom: 0.9, neon: true },
  },
  looks: { core: [{ share: 1, warm: 0.5, dirt: 0 }], midtown: [{ share: 1, warm: 0.5, dirt: 0 }], oldtown: [{ share: 1, warm: 1, dirt: 0.2 }], industrial: [{ share: 0.3, warm: 0.5, dirt: 0.4 }], docks: [{ share: 0.3, warm: 0.3, dirt: 0.4 }], strip: [{ share: 0.7, warm: 0.7, dirt: 0.1 }], suburb: [{ share: 0.8, warm: 1, dirt: 0 }] },
  weights: { core: every, midtown: every, oldtown: every, industrial: every, docks: every, strip: every, suburb: every },
};

let city: City | null = null;
const neon = (): City => (city ??= generateCity("neon"));

test("planLot: a pure function of the catalogue, the city's seed and the lot", () => {
  const c = neon(), lot = c.lots[7]!;
  assert.deepEqual(planLot(CAT, c, lot), planLot(CAT, c, lot));
  // (Its plan doesn't depend on where the lot sits in the list.)
  const shuffled = { ...c, lots: [...c.lots].reverse() };
  assert.deepEqual(planLot(CAT, shuffled, lot), planLot(CAT, c, lot));
});

test("planLot: every building stands on its lot, in its footprint, and rises to its storeys", () => {
  const c = neon();
  for (const lot of c.lots) {
    const p = planLot(CAT, c, lot);
    if (lot.height[1] <= 0) { assert.equal(p.solids.length, 0); continue; }
    assert.ok(p.solids.length >= 2 && p.footprint.length >= 1, `${lot.key}: ${p.archetype}`);
    // (Every footprint's middle is on the lot's box.)
    const { x, z, hw, hd, yaw } = lot.obb, cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (const f of p.footprint) {
      const dx = f.x - x, dz = f.z - z, u = dx * cy - dz * sy, v = dx * sy + dz * cy;
      assert.ok(Math.abs(u) <= hw + 0.01 && Math.abs(v) <= hd + 0.01, `${lot.key}: footprint off its lot`);
    }
    assert.ok(p.height > 2 && p.height < 400);
  }
});

test("planLot: buildings differ -- silhouettes, crowns and walls vary across a city", () => {
  const c = neon(), plans = c.lots.map((l) => planLot(CAT, c, l)).filter((p) => p.solids.length);
  const kinds = new Set(plans.map((p) => p.archetype)), walls = new Set(plans.map((p) => p.wall)), heights = new Set(plans.map((p) => Math.round(p.height / 10)));
  assert.ok(kinds.size === 4 && walls.size === 2 && heights.size > 8, `${[...kinds]} ${[...walls]} ${heights.size}`);
  // Masses carry the metric facade grid; wedges and capsules show up (gables, spires, water tanks).
  const boxes = plans.flatMap((p) => p.solids.map((s) => s.box).filter((b) => b !== undefined));
  assert.ok(boxes.some((b) => b.grid) && boxes.some((b) => b.kind === "wedge") && plans.some((p) => p.solids.some((s) => s.capsule)));
  // (A mass's grid is its storey height and bay: a tall tower's side face spans many storeys.)
  const tall = boxes.filter((b) => b.grid).reduce((m, b) => ((b.h[1] ?? 0) > (m.h[1] ?? 0) ? b : m));
  assert.ok((2 * (tall.h[1] ?? 0)) / tall.grid![1] > 20);
});

test("planLot: the anti-repeat rule -- neighbours rarely share an archetype and walls", () => {
  const c = neon(), byKey = new Map(c.lots.map((l) => [l.key, planLot(CAT, c, l)]));
  let same = 0, pairs = 0;
  for (const lot of c.lots) {
    if (!lot.left) continue;
    const a = byKey.get(lot.key)!, b = byKey.get(lot.left)!;
    if (!a.solids.length || !b.solids.length) continue;
    pairs += 1;
    if (a.archetype === b.archetype && a.wall === b.wall) same += 1;
  }
  // (With 4 archetypes x 2 walls a pair would match 1 in 8 by chance; the re-roll brings it down to about 1 in 64.)
  assert.ok(same / pairs < 0.07, `${same}/${pairs}`);
});

test("frameOf: a building faces its most important road, width and depth swapped when that's a side", () => {
  const lot: Lot = { obb: { x: 0, z: 0, hw: 10, hd: 20, yaw: 0 }, height: [1, 2], use: "shop", frontage: 0, block: 0, key: "0:0:0", district: 0, left: null, right: null, fronts: [{ edge: 1, face: 0, cls: "street" }, { edge: 2, face: 1, cls: "arterial" }] };
  const f = frameOf(lot);
  assert.equal(f.yaw, Math.PI / 2);
  assert.deepEqual([f.hw, f.hd], [20, 10]);
});

test("planCity: a plan a lot, grouped by block, a look a block; blockWorld merges a block", () => {
  const c = neon(), blocks = planCity(CAT, c);
  assert.equal(blocks.reduce((n, b) => n + b.plans.length, 0), c.lots.length);
  const w = blockWorld(blocks[0]!.plans, 0), far = blockWorld(blocks[0]!.plans, 2);
  assert.ok((w.boxes?.length ?? 0) > (far.boxes?.length ?? 0) && (far.boxes?.length ?? 0) > 0);
  assert.ok(blocks[0]!.look.key.startsWith("test@1|"));
});

test("city and street step plans yield and preserve their synchronous output for distinct seeds", () => {
  for (const seed of ["neon", "docks"]) {
    const c = seed === "neon" ? neon() : generateCity(seed);
    const citySteps = planCitySteps(CAT, c);
    let cityYields = 0, planned: ReturnType<typeof planCity>;
    for (;;) { const r = citySteps.next(); if (r.done) { planned = r.value; break; } cityYields++; }
    assert.ok(cityYields > 1, `${seed}: city lots must pause more than once`);
    assert.deepEqual(planned, planCity(CAT, c));
    const streetSteps = planStreetsSteps(STREETS, c);
    let streetYields = 0, dressed: ReturnType<typeof planStreets>;
    for (;;) { const r = streetSteps.next(); if (r.done) { dressed = r.value; break; } streetYields++; }
    assert.ok(streetYields > 1, `${seed}: street placement must pause more than once`);
    assert.deepEqual(dressed, planStreets(STREETS, c));
  }
});

test("districtPaint: walls wear the windows pattern, lit at night and dark by day; neon burns in the district's hues", () => {
  const c = neon(), look = lookOf(CAT, c.districts[0]!, 0);
  const night = districtPaint(CAT, look, true), day = districtPaint(CAT, look, false);
  const brick = night.paint[SLOT.redBrick]!;
  assert.equal(brick.look.pattern.kind, "windows");
  assert.ok(brick.look.pattern.freq > 0 && day.paint[SLOT.redBrick]!.look.pattern.freq === 0);
  assert.equal(night.paint[SLOT.glassBlue]!.look.pattern.angle, 3);
  assert.equal(night.paint[SLOT.neonA]!.look.hue, look.hues[0]);
  assert.ok(night.bloom[SLOT.neonA * 4 + 3]! > 0.5 && day.bloom[SLOT.neonA * 4 + 3] === 0);
  assert.equal(night.paint.length, 32);
});

// ---------------------------------------------------------------- streets, parks, plazas

const STREETS: StreetCatalogue = {
  version: "streets-test@1",
  lampStyles: { arm: { kind: "arm", height: 8, arm: 2, heads: 1, head: "lampCool", reach: 14 }, mast: { kind: "mast", height: 16, arm: 2.4, heads: 3, head: "lampSodium", reach: 22 } },
  lamps: { core: "arm", midtown: "arm", oldtown: "arm", industrial: "arm", docks: "arm", strip: "arm", suburb: "arm", highway: "mast" },
  spacing: { highway: 70, arterial: 34, street: 30, alley: 0, ramp: 0, freeway: 0 },
  furniture: Object.fromEntries(["core", "midtown", "oldtown", "industrial", "docks", "strip", "suburb"].map((k) => [k, [
    { kind: "bin", every: 40, chance: 1, roads: ["arterial", "street"] }, { kind: "hydrant", every: 90, chance: 1, roads: ["arterial", "street"] },
    { kind: "busStop", every: 220, chance: 1, roads: ["arterial"] }, { kind: "tree", every: 25, chance: 0.6, roads: ["arterial", "street"] },
  ]])) as unknown as StreetCatalogue["furniture"],
  crowns: { street: 1.8, tree: 3.5 },
  materials: { pole: { hue: 240, chroma: 0.01, light: 0.3, span: 0.3, finish: "metal" }, lampCool: { hue: 205, chroma: 0.04, light: 0.9, span: 0.3, finish: "glow", bloom: 0.7 } },
};

test("planStreets: lamps along every road, signals at the junctions, furniture on the pavements -- a pure function of the city", () => {
  const c = neon(), a = planStreets(STREETS, c), b = planStreets(STREETS, c);
  assert.deepEqual(a, b);
  const kinds = new Map<string, number>();
  for (const p of a.props) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1);
  assert.ok((kinds.get("lamp") ?? 0) > 200 && (kinds.get("signal") ?? 0) > 20 && (kinds.get("busStop") ?? 0) > 3 && (kinds.get("bin") ?? 0) > 20 && (kinds.get("tree") ?? 0) > 20, JSON.stringify([...kinds]));
  assert.ok(a.lights.length >= kinds.get("lamp")!);
  assert.ok(a.chunks.length > 10 && a.chunks.every((ch) => ch.solids.every((s) => s.layer === 1)));
});

test("planStreets: each street prop's parts are its own solids -- in its chunk, round where it stands, and no two props share one", () => {
  const c = neon(), a = planStreets(STREETS, c), parts = a.parts ?? [];
  assert.equal(parts.length, a.props.length);
  const byKey = new Map(a.chunks.map((ch) => [ch.key, ch]));
  const owned = new Map<string, Set<number>>();
  let furniture = 0;
  a.props.forEach((q, i) => {
    const part = parts[i];
    if (q.kind === "lamp" || q.kind === "bin" || q.kind === "hydrant" || q.kind === "signal" || q.kind === "busStop") {
      assert.ok(part && part.to > part.from, `${q.kind} at ${q.x.toFixed(1)},${q.z.toFixed(1)} has its solids`);
      furniture += 1;
    }
    if (!part) return;
    const ch = byKey.get(part.chunk)!, seen = owned.get(part.chunk) ?? new Set<number>();
    assert.ok(ch && part.to <= ch.solids.length);
    for (let k = part.from; k < part.to; k += 1) {
      assert.ok(!seen.has(k), "a solid owned twice"); seen.add(k);
      const s = ch.solids[k]!, at = s.box ? s.box.c : s.capsule!.a;
      assert.ok(Math.hypot((at[0] ?? 0) - q.x, (at[2] ?? 0) - q.z) < 6, `${q.kind}'s solid ${k} stands by it`);
    }
    owned.set(part.chunk, seen);
  });
  assert.ok(furniture > 100);
});

test("planStreets: nothing in the road -- every footprint clear of the carriageway (kerb returns and all), every tree's crown over the pavement, nothing on a crossing, in a junction's box or its sight lines", () => {
  for (const seed of ["neon", "docks"]) {
    const c = seed === "neon" ? neon() : generateCity(seed), st = streetsOf(c.graph), plan = planStreets(STREETS, c);
    for (const p of plan.props) {
      const at = st.at(p.x, p.z);
      if (!at) continue;
      assert.ok(at.kerb - p.r >= 0, `${seed}: ${p.kind} at ${p.x.toFixed(1)},${p.z.toFixed(1)} is ${(p.r - at.kerb).toFixed(2)} m into the road`);
      assert.ok(!at.crossing && !at.box, `${seed}: ${p.kind} at ${p.x.toFixed(1)},${p.z.toFixed(1)} on a crossing or in a junction`);
      if (p.kind !== "lamp" && p.kind !== "signal" && p.kind !== "signpost") assert.ok(!at.sight, `${seed}: ${p.kind} in a junction's sight line`);
    }
    for (const t of plan.plants) {
      const at = st.at(t.x, t.z), crown = (STREETS.crowns?.[t.kind] ?? 2) * t.scale;
      if (at && t.kind !== "bush") assert.ok(at.kerb >= crown, `${seed}: a ${t.kind}'s crown hangs ${(crown - at.kerb).toFixed(2)} m over the road at ${t.x.toFixed(1)},${t.z.toFixed(1)}`);
    }
    // (Nothing stands on anything else.)
    for (let i = 0; i < plan.props.length; i += 1) for (let j = i + 1; j < plan.props.length; j += 1) {
      const p = plan.props[i]!, q = plan.props[j]!;
      assert.ok((p.x - q.x) * (p.x - q.x) + (p.z - q.z) * (p.z - q.z) >= (p.r + q.r) * (p.r + q.r), `${seed}: ${p.kind} and ${q.kind} touch at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
    }
  }
});

test("planStreets' infrastructure: pylons out past the ring, poles on the side streets, the highway's gantries, signs, walls, rails and billboards -- none of it in a carriageway, nothing low over one, a pure function of the city", () => {
  const INFRA: StreetCatalogue = {
    ...STREETS,
    lampStyles: { ...STREETS.lampStyles, globe: { kind: "globe", height: 4.6, arm: 0, heads: 1, head: "lampCool", reach: 11 } },
    lampsBy: { midtown: { street: "globe" } },
    infra: {
      power: { spacing: [72, 88], offset: 18, height: 32, sag: 0.035, whole: 1, radial: 1 },
      poles: { districts: ["suburb", "strip", "industrial", "oldtown", "midtown", "core", "docks"], roads: ["street"], every: 42, height: 9, transformer: 0.3 },
      highway: { railCurve: 1 / 400, gantryMin: 200, soundWalls: ["suburb", "midtown", "core", "oldtown"], wallHeight: 4, billboards: [200, 300], cameras: 1 },
      masts: { count: [2, 2], height: [40, 40] },
      cover: { density: { suburb: 1, oldtown: 1, midtown: 1, docks: 1, industrial: 1, strip: 1, core: 1, highway: 1 }, lush: ["suburb", "midtown"] },
    },
    crowns: { ...STREETS.crowns, bush: 1.1, hedge: 1.75, flowers: 0.8, grass: 0.35 },
  };
  const c = neon(), h = cityHeight(c), st = streetsOf(c.graph);
  const plain = planStreets(STREETS, c, h), a = planStreets(INFRA, c, h), b = planStreets(INFRA, c, h);
  assert.deepEqual(a, b);
  assert.equal(plain.barriers.length + plain.signs.length, 0, "no infrastructure without the catalogue's");
  const kinds = new Map<string, number>();
  for (const p of a.props) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1);
  for (const k of ["pylon", "pole", "gantry", "sign", "billboard", "camera", "mast"]) assert.ok((kinds.get(k) ?? 0) > 0, `some ${k}: ${JSON.stringify([...kinds])}`);
  assert.ok(a.barriers.length > 10 && a.signs.length > 1 && a.signs.every((s) => /^EXIT \d+ {2}[A-Z ]+$/.test(s.text)), JSON.stringify(a.signs.map((s) => s.text)));
  // (Every billboard face is its own ad slot.)
  const bb = a.ads.filter((x) => x.kind === "billboard");
  assert.equal(bb.length, 2 * kinds.get("billboard")!);
  assert.equal(new Set(a.ads.map((x) => x.id)).size, a.ads.length);
  // Nothing in a carriageway: every prop's disc, every barrier's length (past the kerb), every pylon clear of the road.
  for (const p of a.props) {
    const at = st.at(p.x, p.z);
    if (at) assert.ok(at.kerb - p.r >= 0, `${p.kind} at ${p.x.toFixed(1)},${p.z.toFixed(1)} is ${(p.r - at.kerb).toFixed(2)} m into the road`);
    if (at && at.kerb < at.kerbW + at.slabW + 1 && p.kind !== "lamp" && p.kind !== "signal" && p.kind !== "signpost") assert.ok(!at.sight && !at.crossing, `${p.kind} in a sight line or on a crossing`);
  }
  for (const r of a.barriers) for (const t of [-r.hd, 0, r.hd]) {
    const x = r.x + Math.sin(r.yaw) * t, z = r.z + Math.cos(r.yaw) * t, at = st.at(x, z);
    if (at) assert.ok(at.kerb - r.hw >= at.kerbW, `a barrier ${(at.kerbW - at.kerb + r.hw).toFixed(2)} m onto the kerb at ${x.toFixed(1)},${z.toFixed(1)}`);
  }
  // Nothing new hangs over a carriageway lower than a truck (the signals' heads are the lowest thing meant to be there).
  for (const ch of a.chunks) for (const s of ch.solids) {
    const pts = s.capsule ? [s.capsule.a, s.capsule.b].map((q) => [q[0]!, q[1]! - s.capsule!.r, q[2]!]) : [[s.box!.c[0]!, s.box!.c[1]! - s.box!.h[1]!, s.box!.c[2]!]];
    for (const [x, y, z] of pts) {
      const clear = y! - h.heightAt(x!, z!), at = st.at(x!, z!);
      if (clear > 0.3 && at && at.kerb < -0.05) assert.ok(clear >= 4.3, `${clear.toFixed(2)} m over the road at ${x!.toFixed(1)},${z!.toFixed(1)}`);
    }
  }
  // Ground cover: plenty of it, every plant's spread off the carriageway and the walk, nothing taller than grass in a
  // junction's sight line or box, nothing on a crossing.
  const cover = a.plants.filter((p) => p.kind === "grass" || p.kind === "flowers" || p.kind === "bush" || p.kind === "hedge");
  assert.ok(cover.length > 300 && cover.some((p) => p.kind === "bush") && cover.some((p) => p.kind === "flowers"), `${cover.length} plants of cover`);
  for (const p of cover) {
    const at = st.at(p.x, p.z), r = INFRA.crowns![p.kind]! * p.scale;
    if (!at) continue;
    assert.ok(at.kerb - r >= at.kerbW + at.slabW - 0.5 && !at.crossing, `a ${p.kind} over the road or the walk at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
    if (p.kind === "bush" || p.kind === "hedge") assert.ok(!(at.kerb < at.kerbW + at.slabW + 1 && (at.sight || at.box)), `a ${p.kind} in a sight line at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
  }
  // The pylons stand outside the ring, well clear of it.
  const ring = c.graph.edges.filter((e) => e.cls === "highway");
  const rMax = Math.max(...ring.flatMap((e) => Array.from(e.path.x, (x, i) => Math.hypot(x, e.path.z[i]!)))), rMin = Math.min(...ring.flatMap((e) => Array.from(e.path.x, (x, i) => Math.hypot(x, e.path.z[i]!))));
  for (const p of a.props) if (p.kind === "pylon" && p.r > 1) assert.ok(Math.hypot(p.x, p.z) > rMin + 7.4, `a pylon inside the ring at ${p.x.toFixed(0)},${p.z.toFixed(0)}`);
  assert.ok(rMax > 0);
});

test("parks and plazas: open space by the district weights, with trees, benches, lamps and a piece; murals on side walls", () => {
  const open: Catalogue = {
    ...CAT,
    archetypes: [...CAT.archetypes, { ...CAT.archetypes[0]!, id: "park", massing: [{ op: "park", art: { fountain: 1 } }] }, { ...CAT.archetypes[0]!, id: "plaza", massing: [{ op: "plaza", art: { sculpture: 1 } }] }],
    weights: Object.fromEntries(Object.entries(CAT.weights).map(([k, w]) => [k, { ...w, park: 2, plaza: 2 }])) as unknown as Catalogue["weights"],
    murals: { oldtown: 1, midtown: 1, core: 1, industrial: 1, docks: 1, strip: 1, suburb: 1 },
  };
  const c = neon(), plans = c.lots.map((l) => planLot(open, c, l));
  const parks = plans.filter((p) => p.archetype === "park"), plazas = plans.filter((p) => p.archetype === "plaza");
  assert.ok(parks.length > 5 && plazas.length > 5);
  for (const p of [...parks, ...plazas]) {
    assert.equal(p.footprint.length, 0);
    assert.ok(p.solids.every((s) => s.layer === 1) && (p.lights?.length ?? 0) >= 1 && (p.props?.some((q) => q.kind === "bench") ?? false));
  }
  assert.ok(plans.some((p) => p.archetype !== "park" && p.archetype !== "plaza" && p.solids.some((s) => s.layer === 1)), "a mural somewhere");
});

test("on a hilly city: each building stands level on its terrace -- its door at the pavement or up its stoop, its plinth down to the ground all round, what stands free on the lot on the ground", () => {
  const c = neon(), h = cityHeight(c);
  // (Houses up stoops, and car parks: slabs, cars and lamp masts standing free on the lot.)
  const cat: Catalogue = {
    ...CAT,
    archetypes: [...CAT.archetypes, arch("house", [{ op: "extrude" }, { op: "roof", kinds: { gable: 1 } }], { storeys: [1, 2], setbacks: [5, 1, 3], stoop: [0.5, 0.9], signs: [] }), arch("lot", [{ op: "parking" }], { storeys: [1, 1], signs: [] })],
    weights: Object.fromEntries(Object.entries(CAT.weights).map(([k, w]) => [k, { ...w, house: 2, lot: 1 }])) as unknown as Catalogue["weights"],
  };
  let stoops = 0, level = 0, near = 0, shown = 0, slabs = 0, sloped = 0;
  for (const lot of c.lots) {
    const p = planLot(cat, c, lot, h);
    if (!p.footprint.length || !p.door) continue;
    const a = cat.archetypes.find((x) => x.id === p.archetype)!;
    const masses = p.solids.filter((s) => s.box?.grid);
    const floor = Math.min(...masses.map((s) => (s.box!.c[1] ?? 0) - (s.box!.h[1] ?? 0)));
    assert.ok(Math.abs(floor - p.base!) < 1e-6, `${lot.key}: floor ${floor.toFixed(2)} vs base ${p.base}`);
    // The door: a hair over the ground in front of it -- a car drives in -- or up its stoop's steps; and from the
    // pavement to it, the terrace: flush with the pavement where the door is by it, a gentle grade where it's set back.
    const rise = p.base! - p.door.ground, field = roadField(c.graph), f = frameOf(lot), fx = Math.sin(f.yaw), fz = Math.cos(f.yaw);
    if (a.stoop && rise > DOOR_LIFT + 1e-6) {
      stoops += 1;
      assert.ok(rise >= 2 * RISER - 1e-6 && rise <= a.stoop[1] + 1e-6, `${lot.key}: a stoop ${rise.toFixed(2)} m up`);
      // (Its steps: treads from the door down toward the road, none of them on the road.)
      const steps = p.solids.filter((s) => s.box && s.box.kind !== "wedge" && Math.abs(s.box.h[0]! - 1.4) < 1e-9 && s.lod <= 1 && s.box.mat === SLOT.concreteLight);
      assert.ok(steps.length >= 2, `${lot.key}: ${steps.length} steps up its ${rise.toFixed(2)} m stoop`);
      for (const st of steps) { const at = field.at(st.box!.c[0]!, st.box!.c[2]!); assert.ok(!at || Math.abs(at.d) > at.half + 0.4, `${lot.key}: a step on the road`); }
    } else {
      level += 1;
      assert.ok(Math.abs(rise - DOOR_LIFT) < 1e-6, `${lot.key}: its door ${rise.toFixed(3)} m over the ground`);
      let prev = h.heightAt(p.door.x, p.door.z), k = 0.5, pave = Infinity;
      assert.ok(Math.abs(prev - p.base!) <= 0.03 + DOOR_LIFT, `${lot.key}: the ground at its door is ${(prev - p.base!).toFixed(2)} m off its floor`);
      for (; k < 45; k += 0.5) {
        const x = p.door.x + fx * k, z = p.door.z + fz * k, y = h.heightAt(x, z), at = field.at(x, z);
        assert.ok(Math.abs(y - prev) <= 0.06, `${lot.key}: a ${(y - prev).toFixed(2)} m step ${k} m out of its door`);
        prev = y;
        if (at && Math.abs(at.d) <= sidewalkReach(c.graph.edges[at.edge]!.cls, at.half)) pave = Math.min(pave, k);
        if (at && Math.abs(at.d) <= at.half) break;
      }
      if (pave <= 2.5) { near += 1; assert.ok(Math.abs(p.base! - p.door.pave) <= 0.03 + DOOR_LIFT, `${lot.key}: its door by the pavement, ${(p.base! - p.door.pave).toFixed(2)} m off it`); }
    }
    // Its plinth: under every footprint, from under the lowest ground round it up to the floor -- no air, anywhere.
    const plinths = p.solids.filter((s) => s.box && s.lod === 2 && s.box.mat === SLOT.concreteDark && (s.box.c[1] ?? 0) + (s.box.h[1] ?? 0) <= p.base! + 0.03);
    for (const f of p.footprint) {
      const cy = Math.cos(f.yaw), sy = Math.sin(f.yaw);
      // (A building's footprint -- walls with a facade grid stand on it -- not a parked car's.)
      if (!masses.some((s) => Math.hypot(s.box!.c[0]! - f.x, s.box!.c[2]! - f.z) < Math.max(f.hw, f.hd))) continue;
      const under = plinths.filter((s) => Math.hypot(s.box!.c[0]! - f.x, s.box!.c[2]! - f.z) < Math.hypot(f.hw, f.hd));
      assert.ok(under.length, `${lot.key}: a plinth under its footprint`);
      const bottom = Math.min(...under.map((s) => s.box!.c[1]! - s.box!.h[1]!)), top = Math.max(...under.map((s) => s.box!.c[1]! + s.box!.h[1]!));
      assert.ok(top >= p.base! - 0.01, `${lot.key}: its plinth stops ${(p.base! - top).toFixed(2)} m under the floor`);
      let low = Infinity;
      for (let t = -1; t <= 1; t += 0.125) for (const [u, v] of [[t, -1], [t, 1], [-1, t], [1, t]] as const) {
        const x = f.x + u * (f.hw + 0.1) * cy + v * (f.hd + 0.1) * sy, z = f.z - u * (f.hw + 0.1) * sy + v * (f.hd + 0.1) * cy, y = h.heightAt(x, z);
        low = Math.min(low, y);
        assert.ok(bottom <= y - 0.1, `${lot.key}: ${(bottom - y).toFixed(2)} m of air under its plinth at ${x.toFixed(1)},${z.toFixed(1)}`);
      }
      if (p.base! - low > 0.3) shown += 1;
    }
    // What stands free on the lot stands on the ground: every slab laid on it lies on the ground under it.
    for (const s of p.solids) {
      const B = s.box;
      // (The car parks' surfaces: roof-slot slabs down on the lot, not a building's roof.)
      if (!B || (B.mat !== SLOT.roof) || B.h[0]! < 2 || B.h[2]! < 2 || B.h[1]! > 1 || B.c[1]! - B.h[1]! > p.base! + 0.5) continue;
      const g = h.heightAt(B.c[0]!, B.c[2]!), topMid = B.kind === "wedge" ? B.c[1]! - B.h[1]! + B.h[1]! * (1 + (B.lo ?? 0)) : B.c[1]! + B.h[1]!;
      slabs += 1;
      if (B.kind === "wedge") {
        // (A wedge's foot -- lo of its height -- is at its local +z, its full height at -z: both ends over the ground.)
        sloped += 1;
        const fx = Math.sin(B.yaw ?? 0), fz = Math.cos(B.yaw ?? 0), d = 0.9 * B.h[2]!, bottom = B.c[1]! - B.h[1]!;
        for (const [k, top] of [[d, bottom + 2 * B.h[1]! * ((B.lo ?? 0) + (1 - (B.lo ?? 0)) * (1 - 0.9) / 2)], [-d, bottom + 2 * B.h[1]! * (1 - (1 - (B.lo ?? 0)) * (1 - 0.9) / 2)]] as const) {
          const ge = h.heightAt(B.c[0]! + fx * k, B.c[2]! + fz * k);
          assert.ok(Math.abs(top - ge - 0.06) < 0.15, `${lot.key}: a sloped slab's end ${(top - ge).toFixed(2)} m over the ground`);
        }
      }
      assert.ok(Math.abs(topMid - g - 0.06) < 0.12, `${lot.key}: a slab ${(topMid - g).toFixed(2)} m over the ground (${B.kind ?? "box"} ${JSON.stringify([B.c, B.h, B.lo, B.yaw])} base ${p.base})`);
    }
  }
  assert.ok(stoops > 5 && level > 20 && near > 5 && shown > 3, `${stoops} stoops, ${level} level doors (${near} by the pavement), ${shown} plinths standing out of falling ground`);
  assert.ok(slabs > 5 && sloped > 2, `${slabs} car parks (${sloped} of them sloped)`);
  const st = planStreets(STREETS, c, h);
  for (const ch of st.chunks.slice(0, 5)) for (const s of ch.solids) if (s.box) {
    const [x, y, z] = [s.box.c[0]!, s.box.c[1]! - s.box.h[1]!, s.box.c[2]!];
    assert.ok(y > h.heightAt(x, z) - 4, "nothing buried deep");
  }
});
