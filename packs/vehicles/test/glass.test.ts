import { test } from "node:test";
import assert from "node:assert/strict";
import { lookMesh, raycastWorld } from "@keel-engine/bake";
import type { BakeWorld } from "@keel-engine/bake";
import { BODY_SLOT, BODY_STYLES, bodyDesign, cabinMargin, carDesigns, generateCar, glasshouse, standIn } from "../src/index.ts";
import type { Car } from "../src/index.ts";

// Every body style, many seeds each: the glass the generator makes, and what it keeps inside it.
const cars: Car[] = [];
for (const s of BODY_STYLES) for (let i = 0; i < 24; i += 1) cars.push(generateCar(`glass-${s.name}-${i}`, { style: s.name }));
const closed = cars.filter((c) => glasshouse(c)?.kind === "closed");

const near = (a: readonly number[], b: readonly number[], e = 1e-9): boolean => a.every((v, k) => Math.abs(v - b[k]!) < e);

test("the glasshouse: four planar panes, their edges the pillars they share, their feet on the belt", () => {
  assert.ok(closed.length > 100, `closed cars: ${closed.length}`);
  for (const car of closed) {
    const h = glasshouse(car)!, { screen, rear, left, right } = h.panes as Required<typeof h.panes>;
    for (const p of [screen!, rear!, left!, right!]) {
      // (Planar: every corner on the plane of the pane's normal.)
      const d = p.corners.map((c) => c[0] * p.normal[0] + c[1] * p.normal[1] + c[2] * p.normal[2]);
      assert.ok(Math.max(...d) - Math.min(...d) < 1e-9, `${car.seed} ${p.name} is not flat`);
      assert.ok(p.corners[0][1] < car.body.belt && p.corners[2][1] > h.headlining, `${car.seed} ${p.name}: foot under the belt, top in the roof`);
    }
    // (The screen's side edges are the side windows' front edges; the rear glass's their back ones.)
    const edges = (p: typeof screen) => [[p!.corners[0], p!.corners[3]], [p!.corners[1], p!.corners[2]]];
    const shares = (a: typeof screen, b: typeof screen): boolean => edges(a).some(([p, q]) => edges(b).some(([r, s]) => (near(p!, r!) && near(q!, s!)) || (near(p!, s!) && near(q!, r!))))
      || [[a!.corners[0], a!.corners[3]], [a!.corners[1], a!.corners[2]]].some(([p, q]) => b!.corners.some((r) => near(p!, r)) && b!.corners.some((r) => near(q!, r)));
    for (const side of [left, right]) { assert.ok(shares(screen, side), `${car.seed} screen/${side!.name}`); assert.ok(shares(rear, side), `${car.seed} rear/${side!.name}`); }
  }
});

test("nothing pokes through the glass: no solid is part inside the cabin and part out of it", () => {
  // (The glass and what holds it -- the roof slab and its pillars -- are the boundary itself; everything else is either
  // in the cabin or out of it. A seal that sits on the belt under the glass's foot is neither.)
  const P = BODY_SLOT, frame = new Set<number>([P.glass, P.screen, P.roof]);
  let inside = 0, cages = 0;
  for (const car of closed) {
    const h = glasshouse(car)!, world = bodyDesign(car).pose("still", 0), belt = car.body.belt;
    if (car.parts.cage !== "none") cages += 1;
    const solids: BakeWorld[] = [...(world.boxes ?? []).map((b) => ({ boxes: [b] })), ...(world.wedges ?? []).map((w) => ({ wedges: [w] })), ...(world.capsules ?? []).map((c) => ({ capsules: [c] }))];
    for (const one of solids) {
      const s = (one.boxes ?? one.wedges ?? one.capsules)![0]! as { mat?: number };
      if (frame.has(s.mat ?? 0)) continue;
      const m = lookMesh(one), n = m.positions.length / 3;
      let top = -Infinity, deepest = 0, worst = 0, at: readonly number[] = [];
      for (let v = 0; v < n; v += 1) top = Math.max(top, m.positions[v * 3 + 1]!);
      if (top < belt + 0.03) continue;
      for (let v = 0; v < n; v += 1) {
        const p = [m.positions[v * 3]!, m.positions[v * 3 + 1]!, m.positions[v * 3 + 2]!] as const;
        if (p[1] < belt + 0.01) continue;
        const q = cabinMargin(h, p);
        if (q > deepest) deepest = q;
        if (q < worst) { worst = q; at = p; }
      }
      if (deepest > 1e-3) inside += 1;
      assert.ok(!(deepest > 1e-3 && worst < -1e-4), `${car.style} ${car.seed}: slot ${s.mat} at [${at.map((q) => q.toFixed(3))}] is ${(-worst * 1000).toFixed(1)} mm through the glass`);
    }
  }
  assert.ok(inside > closed.length * 5 && cages > 3, `solids inside: ${inside}, cars with cages: ${cages}`);
});

test("the stand-in driver sits inside the glass with room to spare, and the drawn one is where standIn says", () => {
  for (const car of closed) {
    const h = glasshouse(car)!, who = standIn(car)!;
    assert.ok(cabinMargin(h, who.helmet) >= who.helmetR + 0.029, `${car.seed}: the helmet's ${(cabinMargin(h, who.helmet) - who.helmetR).toFixed(3)} m from the glass`);
    const caps = bodyDesign(car).pose("still", 0).capsules ?? [];
    assert.ok(caps.some((c) => c.mat === BODY_SLOT.accent && near(c.a, who.helmet) && c.r === who.helmetR), `${car.seed}: no helmet at standIn's place`);
  }
});

test("the panes are thin sheets on their planes, and a ray through the screen meets its outer face", () => {
  for (const car of closed.slice(0, 40)) {
    const h = glasshouse(car)!, glass = carDesigns(car).glass;
    const world = glass.pose("still", 0), parts = glass.components ?? [];
    for (const name of ["screen", "rear", "left", "right"] as const) {
      const p = h.panes[name]!, k = parts.indexOf(`pane:${name}`);
      assert.ok(k >= 0, `${car.seed}: no pane:${name} component`);
      // (Straight in at the pane's middle from a metre out: the first thing hit is its outer face.)
      const o = [p.centre[0] + p.normal[0], p.centre[1] + p.normal[1], p.centre[2] + p.normal[2]] as const;
      const t = raycastWorld(world, o, [-p.normal[0], -p.normal[1], -p.normal[2]]);
      assert.ok(Math.abs(t - 1) < 2e-3, `${car.seed} ${name}: hit at ${t.toFixed(4)} m`);
    }
  }
});
