import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BODY_SLOT, BODY_STYLES, SERVICE_STYLES, SPECIAL_STYLES, beaconFlash, beaconLamps, bodyPaint, carDecals, carDesigns, carLights, dumpTipPose, exhaustTips, generateCar,
  glasshouse, mechanicalBounds, panelSlot, physicsOf, plateFit, wheelPaint,
} from "../src/index.ts";
import type { Car, DumpBed } from "../src/index.ts";

const STYLES = Object.values(SERVICE_STYLES);
const N = 40;
const fleet = (style: string, n = N): Car[] => Array.from({ length: n }, (_, i) => generateCar(`svc:${i}`, { style }));
const solidsOf = (car: Car) => { const w = carDesigns(car).body.pose("still", 0); return [...(w.boxes ?? []), ...(w.wedges ?? []), ...(w.capsules ?? [])]; };

/** Each style's size band (m): length, width, and its roof's height; and how many wheels it stands on. */
const BANDS: Readonly<Record<string, { length: [number, number]; width: [number, number]; roof: [number, number]; wheels: number[] }>> = {
  "City Bus": { length: [11.5, 12.5], width: [2.5, 2.6], roof: [2.85, 3.1], wheels: [4] },
  "Fire Engine": { length: [9.7, 12.3], width: [2.4, 2.6], roof: [2.9, 3.3], wheels: [4, 6] },
  Ambulance: { length: [6.7, 7.4], width: [2.2, 2.4], roof: [2.7, 3.0], wheels: [4] },
  "Police Cruiser": { length: [4.2, 5.2], width: [1.7, 2.1], roof: [1.1, 1.6], wheels: [4] },
  "Dump Truck": { length: [8.1, 9.0], width: [2.4, 2.6], roof: [3.0, 3.4], wheels: [6] },
};

test("service vehicles are special styles: built by name, never drawn for a seed, never in the odds", () => {
  for (const name of STYLES) {
    const s = SPECIAL_STYLES.find((x) => x.name === name);
    assert.ok(s && s.weight === 0 && s.service, name);
    assert.ok(!BODY_STYLES.some((x) => x.name === name), name);
  }
  for (let i = 0; i < 800; i += 1) assert.ok(!STYLES.includes(generateCar(`drawn:${i}`).style));
  assert.deepEqual(generateCar("same", { style: "Fire Engine" }), generateCar("same", { style: "Fire Engine" }));
});

test("each style generates for many seeds, within its size band, on the right wheels", () => {
  for (const style of STYLES) {
    const band = BANDS[style]!;
    for (const car of fleet(style)) {
      const g = car.body, sv = car.parts.service!;
      assert.equal(car.style, style);
      assert.ok(g.length >= band.length[0] && g.length <= band.length[1], `${style} ${car.seed} length ${g.length}`);
      assert.ok(g.width >= band.width[0] && g.width <= band.width[1], `${style} width ${g.width}`);
      assert.ok(g.roof >= band.roof[0] && g.roof <= band.roof[1], `${style} roof ${g.roof}`);
      assert.ok(band.wheels.includes(car.mounts.length), `${style} ${car.mounts.length} wheels`);
      assert.equal(car.mounts.filter((m) => m.steers).length, 2);
      // (Every axle under the body, the front one steering, wheels inside the body's width.)
      for (const m of car.mounts) {
        assert.ok(Math.abs(m.z) < g.length / 2 && Math.abs(m.x) + car.wheels[m.shape].width / 2 <= g.width / 2 + 0.12, `${style} wheel at ${m.x},${m.z}`);
      }
      assert.equal(sv.axles.length, new Set(car.mounts.map((m) => m.z)).size);
      // (Their handling is a lorry's, their physics sane.)
      const { spec } = physicsOf(car);
      assert.ok(spec.mass === car.handling.massKg && spec.mass > 1000 && Number.isFinite(spec.finalDrive) && spec.finalDrive > 0, style);
      if (style !== "Police Cruiser") assert.ok(car.handling.massKg > 5000 && car.handling.topSpeed < 40, `${style} ${car.handling.massKg} kg`);
      assert.ok(car.paints.type === null && car.paints.neon === null && car.paints.effect === null && car.wheels[0].spinner === "none", style);
    }
  }
  // Seeds vary the details within the kind.
  assert.deepEqual(new Set(fleet("Fire Engine").map((c) => c.parts.service!.form)), new Set(["pumper", "aerial"]));
  assert.ok(new Set(fleet("City Bus").map((c) => c.parts.service!.livery)).size === 3);
  assert.ok(new Set(fleet("City Bus").map((c) => c.parts.service!.form)).size === 3);
  assert.ok(new Set(fleet("Ambulance").map((c) => JSON.stringify(c.paints.alt))).size >= 3);
  assert.ok(new Set(fleet("Dump Truck").map((c) => (c.parts.bed as DumpBed).top)).size >= 5);
  assert.ok(fleet("Fire Engine").filter((c) => c.parts.service!.form === "aerial").every((c) => c.mounts.length === 6));
});

test("a fleet's paint: red fire engines, white ambulances, black-and-white cruisers -- and a game can pin another", () => {
  const hue = (c: Car) => c.paints.family;
  assert.ok(fleet("Fire Engine").every((c) => hue(c) === "Rosso Red"));
  assert.ok(fleet("Ambulance").every((c) => hue(c) === "Glacier White"));
  for (const c of fleet("Police Cruiser")) {
    assert.equal(hue(c), "Midnight Black");
    assert.deepEqual(c.paints.panels.map((p) => [p.panel, p.kind]), [["doorL", "livery"], ["doorR", "livery"]]);
    assert.equal(c.parts.roof, "contrast");
  }
  assert.equal(generateCar("x", { style: "Fire Engine", traits: { Paint: "Signal Yellow" } }).paints.family, "Signal Yellow");
});

test("the dump truck's bed: its inside volume in parts.bed, inside the truck, tipping about its hinge", () => {
  for (const car of fleet("Dump Truck")) {
    const bed = car.parts.bed as DumpBed, g = car.body;
    assert.ok(typeof bed === "object" && bed.x0 < bed.x1 && bed.z0 < bed.z1 && bed.y < bed.top, car.seed);
    assert.ok(bed.x1 - bed.x0 > 2.2 && bed.z1 - bed.z0 > 5 && bed.top - bed.y > 0.89 && bed.top - bed.y < 1.36, car.seed);
    assert.ok(-g.length / 2 <= bed.z0 && bed.z1 < g.cabRear && bed.x1 <= g.width / 2, car.seed);
    // (Nothing of the body stands inside the bed.)
    const bedSolids = carDesigns(car).body;
    const names = bedSolids.components ?? [];
    const all = solidsOf(car);
    all.forEach((s, i) => {
      if (!("c" in s) || names[i] === "dumpBed") return;
      const b = s as { c: ArrayLike<number>; h: ArrayLike<number> };
      const inside = Math.abs(b.c[0]!) + b.h[0]! < bed.x1 && b.c[1]! - b.h[1]! > bed.y + 0.01 && b.c[1]! + b.h[1]! < bed.top && b.c[2]! - b.h[2]! > bed.z0 && b.c[2]! + b.h[2]! < bed.z1;
      assert.ok(!inside, `${car.seed}: a ${names[i] ?? "body"} solid inside the bed`);
    });
    const down = dumpTipPose(car, 0), up = dumpTipPose(car, 1);
    assert.deepEqual(Array.from(down.bed), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    // Tipped, the bed's front rises well over the cab and its hinge stays put.
    const at = (m: Float32Array, y: number, z: number) => [m[5]! * y + m[9]! * z + m[13]!, m[6]! * y + m[10]! * z + m[14]!];
    const [yFront] = at(up.bed, bed.y, bed.z1), [yHinge, zHinge] = at(up.bed, bed.hingeY, bed.hingeZ);
    assert.ok(yFront > g.roof + 2, `${car.seed} tipped front at ${yFront}`);
    assert.ok(Math.abs(yHinge! - bed.hingeY) < 1e-4 && Math.abs(zHinge! - bed.hingeZ) < 1e-4);
    assert.ok(up.ram[5]! > 1, "the ram draws out");
  }
  // A pickup's bed is still `true`; anything else has none.
  assert.equal(generateCar("7", { style: "Pickup" }).parts.bed, true);
  assert.equal(generateCar("7", { style: "City Bus" }).parts.bed, false);
  assert.deepEqual(Array.from(dumpTipPose(generateCar("7", { style: "Pickup" }), 1).bed), Array.from(dumpTipPose(generateCar("7", { style: "City Bus" }), 1).bed));
});

test("beacons: slots 30 and 31 on every vehicle that has them (not the bus), dark without a phase, flashing with one", () => {
  for (const style of STYLES) for (const car of fleet(style, 12)) {
    const lamps = car.parts.service!.beacons, solids = solidsOf(car), paint = bodyPaint(car);
    if (style === "City Bus") {
      assert.ok(!car.parts.beacons && !lamps.length && !car.paints.beacon && !solids.some((s) => s.mat === 30 || s.mat === 31));
      continue;
    }
    assert.equal(car.parts.beacons, true);
    assert.ok(lamps.some((l) => l.slot === BODY_SLOT.beaconA) && lamps.some((l) => l.slot === BODY_SLOT.beaconB), style);
    assert.equal(beaconLamps(car).length, lamps.length);
    // Both halves are built, and painted as lenses.
    for (const slot of [BODY_SLOT.beaconA, BODY_SLOT.beaconB]) { assert.ok(solids.some((s) => s.mat === slot), `${style} ${slot}`); assert.equal(paint[slot]!.look.finish, "glow"); }
    // No phase: both dark. A phase: one half lit at a time, and each half has its turn.
    for (const night of [true, false]) {
      const dark = carLights(car, { night, braking: 0, neon: 0 });
      assert.ok(dark.glow[30]! < 0 && dark.glow[31]! < 0 && dark.bloom[123] === 0 && dark.bloom[127] === 0);
      let a = 0, b = 0;
      for (let t = 0; t < 1; t += 0.01) {
        const l = carLights(car, { night, braking: 0, neon: 0, beacon: t + 3 });
        const onA = l.glow[30]! > 0, onB = l.glow[31]! > 0;
        assert.ok(!(onA && onB));
        a += onA ? 1 : 0; b += onB ? 1 : 0;
        assert.equal(l.bloom[123]! > 0, onA); assert.equal(l.bloom[127]! > 0, onB);
      }
      assert.ok(a > 15 && b > 15 && Math.abs(a - b) <= 2, `${a} ${b}`);
    }
  }
  const colours = (style: string) => { const c = generateCar("c", { style }); return [c.paints.beacon!.a.hue, c.paints.beacon!.b.hue, c.paints.beacon!.b.chroma]; };
  assert.deepEqual(colours("Police Cruiser").slice(0, 2), [25, 262]);
  assert.ok(colours("Fire Engine")[2]! < 0.05 && colours("Ambulance")[2]! < 0.05); // (red and white)
  assert.deepEqual(beaconFlash(0.05), [1, 0]); assert.deepEqual(beaconFlash(0.55), [0, 1]); assert.deepEqual(beaconFlash(0.4), [0, 0]); assert.deepEqual(beaconFlash(7.05), [1, 0]);
});

test("a beacon phase changes nothing on a car without beacons: every drawn car's lights stay as they were", () => {
  for (let i = 0; i < 150; i += 1) {
    const car = generateCar(`lit:${i}`);
    assert.ok(!car.parts.beacons && !car.parts.service && !car.paints.beacon);
    for (const night of [true, false]) {
      const s = { night, braking: 0.4, neon: 1 };
      assert.deepEqual(carLights(car, { ...s, beacon: 0.05 }), carLights(car, s));
      const l = carLights(car, s);
      assert.ok(l.glow[30] === 0 && l.glow[31] === 0 && l.bloom[123] === 0 && l.bloom[127] === 0);
    }
    assert.ok(!solidsOf(car).some((s) => s.mat === 30 || s.mat === 31));
  }
});

test("bodies: within the renderer's limits, parted into panels, every slot painted, lettering on its panels", () => {
  for (const style of STYLES) for (const car of fleet(style, 16)) {
    const { body, glass, wheels } = carDesigns(car);
    const w = body.pose("still", 0), gw = glass.pose("still", 0);
    assert.ok((w.boxes?.length ?? 0) <= 256 && (w.wedges?.length ?? 0) <= 128 && (w.capsules?.length ?? 0) <= 256, `${style} ${w.boxes?.length}/${w.wedges?.length}/${w.capsules?.length}`);
    assert.ok([...(gw.boxes ?? []), ...(gw.wedges ?? []), ...(gw.capsules ?? [])].length > 0, `${style} has glass`);
    const solids = solidsOf(car), paint = bodyPaint(car), wp = wheelPaint(car);
    for (const s of new Set(solids.map((x) => x.mat ?? 0))) assert.ok(paint[s], `${style}: slot ${s} unpainted`);
    for (const c of wheels[1].pose("spin", 0).capsules!) assert.ok(wp[c.mat ?? 0]);
    // (A decal lands once: the doors, the boot, the bonnet are each one solid.)
    for (const p of ["doorL", "doorR", "trunk", "hood"] as const) assert.ok(solids.filter((s) => s.mat === panelSlot(p)).length <= 1, `${style} ${p}`);
    for (const p of ["doorL", "doorR", "quarterL", "quarterR", "hood", "trunk"] as const) assert.ok(solids.some((s) => s.mat === panelSlot(p)), `${style} has its ${p}`);
    const placed = carDecals(car);
    const lettering = placed.filter((d) => d.kind === "lettering");
    assert.ok(lettering.length >= 2, `${style}: ${placed.map((d) => d.kind + ":" + d.panel)}`);
    for (const d of placed) { assert.ok(paint[panelSlot(d.panel)]!.decal, `${style} ${d.kind} ${d.panel}`); assert.ok(d.rect[0] >= 0 && d.rect[2] <= 1 && d.rect[0] < d.rect[2]); }
    if (style === "Fire Engine") assert.ok(placed.some((d) => d.kind === "chevrons" && d.panel === "trunk"));
    // (Its own cab, not a car's glasshouse -- the cruiser keeps its sedan's -- and no plate recess on a truck.)
    assert.equal(glasshouse(car) === null, style !== "Police Cruiser");
    if (style !== "Police Cruiser") assert.equal(plateFit(car, "ABC 123"), null);
    // (Its exhaust comes out where its pipe is drawn, and the damage layout finds its engine.)
    assert.ok(exhaustTips(car).length >= 1);
    assert.ok(mechanicalBounds(car).engineBlock, style);
  }
  // The bus's destination sign is lit, and carries its route.
  const bus = generateCar("sign", { style: "City Bus" });
  assert.ok(bodyPaint(bus)[BODY_SLOT.neon]!.decal);
  assert.ok(carLights(bus, { night: true, braking: 0, neon: 0 }).glow[BODY_SLOT.neon]! > 0);
});
