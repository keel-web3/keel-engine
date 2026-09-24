import { test } from "node:test";
import assert from "node:assert/strict";
import { raycastWorld } from "@keel-engine/bake";
import type { BakeWorld } from "@keel-engine/bake";
import { PAINT_FAMILIES, carDesigns, generateCar } from "../src/index.ts";
import type { Car } from "../src/index.ts";

/** semi.ts's measurements: the cab's floor and roof, the bumper's depth ahead of the grille. */
const FLOOR = 1.08, ROOF = 3.02, BUMPER = 0.3, STEP = 0.05;
const semiOf = (i: number): Car => generateCar(`semi-closed:${i}`, { style: "Semi Truck" });
/** A semi's body and its glass, posed still: what a ray from outside meets. */
const worldOf = (car: Car): BakeWorld => {
  const d = carDesigns(car), body = d.body.pose("still", 0), glass = d.glass.pose("still", 0);
  return { boxes: [...(body.boxes ?? []), ...(glass.boxes ?? [])], wedges: [...(body.wedges ?? []), ...(glass.wedges ?? [])], capsules: [...(body.capsules ?? []), ...(glass.capsules ?? [])] };
};
const range = (a: number, b: number): number[] => { const out: number[] = []; for (let v = a; v <= b + 1e-9; v += STEP) out.push(v); return out; };

/**
 * Where a semi lets daylight through or shows its inside: rays from each side, from behind and from above, across its
 * nose (the bonnet from the grille back to the cab), its cab and its sleeper, each of which must meet the skin -- the
 * bonnet's side (or the wing over it) within 0.1 of its edge, the cab's and the sleeper's walls within 0.14 of theirs.
 */
function openings(car: Car): string[] {
  const g = car.body, sp = car.parts.semi!, world = worldOf(car), W = g.width / 2 - 0.02, L2 = g.length / 2;
  const nose = L2 - BUMPER, zc = g.cabFront, zB = g.cabRear, zS = zB - sp.sleeper, top = sp.raised ? ROOF + 0.62 : ROOF;
  const bonnet = (z: number): number => 2.06 - 0.13 * (z - zc) / (nose - 0.06 - zc);
  const bad = new Map<string, number>(), note = (k: string): void => { bad.set(k, (bad.get(k) ?? 0) + 1); };
  for (const s of [-1, 1] as const) {
    const side = s > 0 ? "right" : "left", from = (y: number, z: number): number => 4 - raycastWorld(world, [s * 4, y, z], [-s, 0, 0]);
    for (const z of range(zc + 0.1, nose - 0.15)) for (const y of range(1.15, bonnet(z) - 0.06)) if (!(from(y, z) >= 0.5)) note(`${side} of the nose`);
    for (const z of range(zB + 0.08, zc - 0.3)) for (const y of range(FLOOR + 0.06, ROOF - 0.12)) if (!(from(y, z) >= W - 0.14)) note(`${side} of the cab`);
    for (const z of range(zS + 0.08, zB - 0.02)) for (const y of range(FLOOR + 0.06, top - 0.12)) if (!(from(y, z) >= W - 0.14)) note(`${side} of the sleeper`);
  }
  const back = sp.sleeper > 0 ? zS : zB;
  for (const x of range(-W + 0.1, W - 0.1)) for (const y of range(FLOOR + 0.06, (sp.sleeper > 0 ? top : ROOF) - 0.12)) if (!(raycastWorld(world, [x, y, back - 4], [0, 0, 1]) - 4 <= 0.14)) note("back");
  for (const x of range(-W + 0.1, W - 0.1)) for (const z of range(zS + 0.08, zc - 0.3)) if (!(8 - raycastWorld(world, [x, 8, z], [0, -1, 0]) >= (z < zB ? top : ROOF) - 0.14)) note("roof");
  for (const x of range(-0.5, 0.5)) for (const z of range(zc + 0.1, nose - 0.15)) if (!(8 - raycastWorld(world, [x, 8, z], [0, -1, 0]) >= bonnet(z) - 0.1)) note("bonnet");
  return [...bad].map(([k, n]) => `${k} (${n} rays)`);
}

test("a semi is closed: nose, cab and sleeper meet every ray at their skin -- no daylight through the bonnet's sides", () => {
  const open: string[] = [];
  let sleepers = 0, raised = 0, fairings = 0;
  for (let i = 0; i < 160; i += 1) {
    const car = semiOf(i), sp = car.parts.semi!;
    sleepers += sp.sleeper > 0 ? 1 : 0; raised += sp.raised ? 1 : 0; fairings += sp.fairing ? 1 : 0;
    const o = openings(car);
    if (o.length) open.push(`semi-closed:${i}: ${o.join(", ")}`);
  }
  assert.deepEqual(open.slice(0, 8), [], `${open.length} of 160 semis are open`);
  // (Every form was in the draw: day cabs and sleepers, raised roofs, fairings.)
  assert.ok(sleepers > 20 && sleepers < 140 && raised > 10 && fairings > 10, `${sleepers} sleepers, ${raised} raised, ${fairings} fairings`);
});

test("a semi wears a fleet's colours: mostly white, black, silver and grey; red now and then, never the rule", () => {
  const byName = new Map(Object.values(PAINT_FAMILIES).map((f) => [f.name, f]));
  const count = new Map<string, number>(), N = 1200;
  for (let i = 0; i < N; i += 1) {
    const car = semiOf(i), fam = car.paints.family;
    assert.ok(byName.has(fam), fam);
    count.set(fam, (count.get(fam) ?? 0) + 1);
  }
  const share = (...names: string[]): number => names.reduce((a, n) => a + (count.get(n) ?? 0), 0) / N;
  const top = [...count].sort((a, b) => b[1] - a[1]);
  assert.equal(top[0]![0], "Glacier White", JSON.stringify(top));
  assert.ok(share("Glacier White") > 0.25 && share("Glacier White") < 0.45, `white ${share("Glacier White")}`);
  assert.ok(share("Glacier White", "Midnight Black", "Liquid Silver", "Gunmetal") > 0.55, "the neutrals are most of a fleet");
  const red = share("Rosso Red", "Burgundy", "Brick", "Copper Rust");
  assert.ok(red > 0.03 && red < 0.15, `red ${red}`);
  assert.ok(count.size >= 10, `${count.size} colours`);
  assert.equal(generateCar("semi-closed:7", { style: "Semi Truck" }).paints.family, semiOf(7).paints.family, "the same seed, the same paint");
  // (A pickup keeps its own earth tones: only the special style has its own table.)
  const pickups = new Map<string, number>();
  for (let i = 0; i < 400; i += 1) { const f = generateCar(`pickup:${i}`, { archetype: "pickup" }).paints.family; pickups.set(f, (pickups.get(f) ?? 0) + 1); }
  assert.ok(pickups.has("Brick") && pickups.has("Desert Tan") && !pickups.has("Liquid Silver"));
});
