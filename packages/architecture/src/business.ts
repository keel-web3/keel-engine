// The roadside, and the car culture a street racer's city runs on: a
// dealership's glass showroom behind rows of cars on display, a big box store
// set far back behind its parking lot, a drive-thru's lane round its little
// box, a garage's roll-up bays with cars waiting and tyres stacked (a tuner's
// lit in neon, a fire station's engines, a depot's buses), a car wash's
// tunnel, a surface lot, a trailer park. Parked vehicles are simple boxes a
// car can hit; lamp masts light the lots. All of it inside the lot's
// envelope, all of it from the lot's draws.

import { dcos, dsin } from "@keel-engine/core";
import type { Build, Mass } from "./frame.ts";
import { addBox, addCapsule, addMass, addPlant, count, pick, toWorld, within } from "./frame.ts";
import type { SlotName } from "./slots.ts";
import type { MassOp, VehicleKind } from "./types.ts";

type Op<K extends MassOp["op"]> = (b: Build, op: Extract<MassOp, { op: K }>) => void;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Car paints: the walls' slots a body wears well (no glow, no windows without a grid). */
const PAINTS: Readonly<Partial<Record<SlotName, number>>> = { trim: 3, metal: 3, darkGlass: 3, redBrick: 2, glassBlue: 2, concreteDark: 2, buffBrick: 1, glassBronze: 1, glassGreen: 1, concreteLight: 2 };

/** A mass a car hits that's drawn another way (or not at all): its record only. */
function solid(b: Build, x: number, z: number, hw: number, hd: number, y1: number, slot: SlotName = "metal"): void {
  b.masses.push({ x, z, hw, hd, y0: 0, y1, slot });
}

/**
 * A parked vehicle at (x, z) of the building's frame, turned `turn` from facing +z, standing on y: its body, its
 * glass, a patrol car's light bar. Solid (a car hits it) when it's on the ground.
 */
export function vehicle(b: Build, kind: VehicleKind, x: number, z: number, turn: number, i: number, y = 0, paint?: SlotName): void {
  const c = Math.abs(dcos(turn)), s = Math.abs(dsin(turn)), o = { turn };
  // (Nothing parks off its lot: a vehicle that would stand outside the envelope isn't there.)
  const [lw, ld] = kind === "truck" ? [1.25, 7.5] : kind === "bus" ? [1.3, 6] : kind === "ambulance" ? [1.05, 2.9] : [0.9, 2.2];
  const ew = lw * c + ld * s, ed = lw * s + ld * c, site = b.site;
  if (Math.abs(x - site.x) + ew > site.hw + 0.01 || Math.abs(z - site.z) + ed > site.hd + 0.01) return;
  const slot = paint ?? pick(b.D, "paint", PAINTS, i) ?? "metal";
  let hw = 0.9, hd = 2.2, h = 1.45;
  switch (kind) {
    case "truck": {
      // (A cab and a box trailer behind it.)
      hw = 1.25; hd = 7.5; h = 3.9;
      const ax = dsin(turn), az = dcos(turn);
      addBox(b, 1, x + ax * 5.6, y + 1.5, z + az * 5.6, 1.2, 1.3, 1.3, slot, o);
      addBox(b, 0, x + ax * 6.95, y + 2.1, z + az * 6.95, 1.1, 0.5, 0.06, "darkGlass", o);
      addBox(b, 1, x - ax * 1.4, y + 2.25, z - az * 1.4, 1.25, 1.65, 5.9, pick(b.D, "trailer", { trim: 3, corrugated: 3, metal: 2, redBrick: 1, glassBlue: 1 }, i) ?? "trim", o);
      break;
    }
    case "bus": {
      hw = 1.3; hd = 6; h = 3.2;
      addBox(b, 1, x, y + 1.7, z, 1.3, 1.4, 6, paint ?? pick(b.D, "busPaint", { buffBrick: 3, trim: 2, glassBlue: 1, glassGreen: 1 }, i) ?? "trim", o);
      addBox(b, 0, x, y + 2.25, z, 1.34, 0.5, 5.4, "darkGlass", o);
      break;
    }
    default: {
      const body = kind === "patrol" ? "trim" : kind === "ambulance" ? "trim" : slot;
      const big = kind === "ambulance";
      if (big) { hw = 1.05; hd = 2.9; h = 2.6; }
      addBox(b, 1, x, y + (big ? 1.35 : 0.58), z, hw, big ? 1.1 : 0.36, hd, body, o);
      if (!big) addBox(b, 0, x, y + 1.18, z, 0.8, 0.26, 1.15, "darkGlass", o);
      if (kind === "patrol" || big) {
        // (The light bar: one end red, the other cool.)
        const top = big ? 2.55 : 1.48, ax = dcos(turn) * 0.32, az = -dsin(turn) * 0.32;
        addBox(b, 0, x - ax, y + top, z - az, 0.3, 0.07, 0.14, "beacon", o);
        addBox(b, 0, x + ax, y + top, z + az, 0.3, 0.07, 0.14, "led", o);
      }
      if (kind === "patrol") addBox(b, 0, x, y + 0.62, z, 0.92, 0.12, 1.4, "darkGlass", o);
    }
  }
  if (y < 0.01) solid(b, x, z, hw * c + hd * s, hw * s + hd * c, h, slot);
}

/** A lamp mast in a lot: a pole, a sodium head, its pool of light. */
export function mast(b: Build, x: number, z: number, h: number, head: SlotName = "sodium"): void {
  addBox(b, 1, x, h / 2, z, 0.14, h / 2, 0.14, "metal");
  addBox(b, 1, x, h + 0.1, z, 0.9, 0.12, 0.35, head);
  const [wx, , wz] = toWorld(b, x, 0, z);
  // (Its light only: it stands in the lot, off the street -- not one of the street's props.)
  b.lights.push({ x: wx, z: wz, r: 18 });
}

/**
 * A parking lot's rows between x0..x1 and z0..z1: a dark surface, bays in rows (cars nosed in, facing alternate
 * ways, `fill` of them taken), lamp masts on the row ends. Returns how many rows it laid.
 */
export function parkingRows(b: Build, x0: number, x1: number, z0: number, z1: number, fill: number, lamps = true): number {
  if (x1 - x0 < 6 || z1 - z0 < 5.4) return 0;
  addBox(b, 1, (x0 + x1) / 2, 0.03, (z0 + z1) / 2, (x1 - x0) / 2, 0.03, (z1 - z0) / 2, "roof");
  const rows = Math.max(1, Math.floor((z1 - z0 + 1) / 6.4)), cols = Math.max(1, Math.floor((x1 - x0 - 1) / 2.8));
  const pitch = (z1 - z0) / rows, w = (x1 - x0) / cols;
  for (let r = 0; r < rows; r += 1) {
    const z = z0 + pitch * (r + 0.5), turn = r % 2 ? Math.PI : 0;
    for (let k = 0; k < cols; k += 1) {
      const x = x0 + w * (k + 0.5), i = r * 64 + k;
      // (The bay's painted line on its left.)
      addBox(b, 0, x - w / 2, 0.07, z, 0.06, 0.02, 2.4, "trim");
      if (b.D.u("bayTaken", i) < fill) vehicle(b, "car", x, z + (b.D.flat("bayJog", i) * 0.25), turn + b.D.flat("bayYaw", i) * 0.05, i);
    }
  }
  if (lamps) for (let r = 0; r < rows; r += 2) for (const x of [x0 + 0.4, x1 - 0.4]) if (x1 - x0 > 16 || x === x0 + 0.4) mast(b, x, z0 + pitch * (r + 0.5), 9);
  return rows;
}

/** A dealership: a tall glazed showroom at the back, a forecourt of cars on display, one up on a plinth, bunting. */
const showroom: Op<"showroom"> = (b) => {
  const s = b.site, hd = clamp(s.hd * 0.36, 4, 10), hw = Math.max(4, Math.min(s.hw - 1, 18)), h = clamp(b.height, 6, 8.5);
  const z0 = s.z - s.hd + hd, front = z0 + hd;
  addMass(b, { x: s.x, z: z0, hw, hd, y0: 0, y1: h, slot: b.derelict ? "boarded" : b.wall });
  // The glass: the showroom's whole front, floor to fascia; the fascia a metal band with the maker's name lit on it.
  if (!b.derelict) addBox(b, 1, s.x, (h - 1.4) / 2 + 0.1, front + 0.07, hw - 0.5, (h - 1.4) / 2, 0.07, "shopCool");
  addBox(b, 1, s.x, h - 0.65, front + 0.2, hw + 0.15, 0.65, 0.2, "metal");
  if (!b.derelict) addBox(b, 1, s.x + (b.D.u("brandAt") - 0.5) * hw, h - 0.65, front + 0.45, Math.min(hw * 0.4, 5), 0.42, 0.06, b.D.u("brand") < 0.5 ? b.neon : "backlit");
  // (The entrance: a portal frame standing proud of the glass.)
  const px = s.x + (b.D.u("portal") < 0.5 ? -1 : 1) * hw * 0.5;
  for (const sx of [-1, 1]) addBox(b, 1, px + sx * 2.2, (h + 0.6) / 2, front + 1, 0.25, (h + 0.6) / 2, 0.9, "trim");
  addBox(b, 1, px, h + 0.3, front + 1, 2.45, 0.3, 0.95, "trim");
  // The forecourt: rows of cars angled to the road, a gap for the drive; one up on a plinth at the front.
  const za = front + 3.2, zb = s.z + s.hd - 3.2, cols = Math.max(1, Math.floor((2 * s.hw - 3) / 2.9));
  const pitch = (2 * s.hw - 3) / cols, rows = Math.max(0, Math.floor((zb - za) / 5.6) + 1), aisle = count(b.D, "aisle", [0, cols - 1]);
  for (let r = 0; r < rows; r += 1) {
    const z = za + r * 5.6, turn = (r % 2 ? 1 : -1) * 0.35;
    for (let k = 0; k < cols; k += 1) {
      if (k === aisle && cols > 3) continue;
      const i = r * 64 + k, x = s.x - s.hw + 1.5 + pitch * (k + 0.5);
      if (r === rows - 1 && k === (aisle === 0 ? cols - 1 : 0) && s.hw > 7) {
        // (The plinth: a low stage with the car of the month on it.)
        solid(b, x, z, 2.2, 2.9, 0.55, "concreteLight");
        addBox(b, 1, x, 0.275, z, 2.2, 0.275, 2.9, "concreteLight");
        vehicle(b, "car", x, z, 0.6, i, 0.55);
        if (!b.derelict) addBox(b, 0, x, 0.6, z + 2.95, 2.2, 0.05, 0.05, b.neon);
        continue;
      }
      if (b.D.u("onShow", i) < (b.derelict ? 0.85 : 0.12)) continue;
      vehicle(b, "car", x, z, turn, i);
    }
  }
  // Bunting: poles along the front, pennant lines strung between them, flags on top.
  if (!b.derelict) {
    const n = clamp(Math.round(s.hw / 6), 2, 5), zf = s.z + s.hd - 0.6, ph = 6.5;
    for (let k = 0; k <= n; k += 1) {
      const x = s.x - s.hw + 0.6 + ((2 * s.hw - 1.2) * k) / n;
      addBox(b, 0, x, ph / 2, zf, 0.06, ph / 2, 0.06, "metal");
      addBox(b, 0, x + 0.5, ph - 0.4, zf, 0.45, 0.3, 0.02, k % 2 ? b.neon : "trim");
      if (k < n) addBox(b, 0, x + (s.hw - 0.6) / n, ph - 1.2, zf, (s.hw - 0.6) / n, 0.05, 0.04, k % 2 ? "trim" : b.neon);
    }
    if (rows > 1) for (const sx of [-1, 1]) mast(b, s.x + sx * (s.hw - 0.4), za + 2.8, 9, "led");
  }
};

/** A big box store (or a mall): a big low box far back, its entrance lit, a parking lot out front, cart corrals. */
const bigbox: Op<"bigbox"> = (b, op) => {
  const s = b.site, mall = !!op.mall, hd = clamp(s.hd * (mall ? 0.45 : 0.4), 6, mall ? 26 : 20), hw = Math.max(4, s.hw - 1);
  const h = mall ? clamp(b.height, 9, 13) : clamp(b.height, 6.5, 9), z0 = s.z - s.hd + hd, front = z0 + hd;
  addMass(b, { x: s.x, z: z0, hw, hd, y0: 0, y1: h, slot: b.derelict ? "derelict" : b.wall });
  const lit = !b.derelict;
  if (mall) {
    // (Two anchor stores at the ends, taller and proud of the mall, each with its sign; a glazed atrium in the middle.)
    const aw = Math.min(hw * 0.22, 14);
    for (const sx of [-1, 1]) {
      const ax = s.x + sx * (hw - aw);
      addMass(b, { x: ax, z: z0 + 1, hw: aw, hd: hd + 1, y0: 0, y1: h + 3, slot: pick(b.D, "anchor", { limestone: 1, concreteLight: 1, buffBrick: 1, stucco: 1 }, sx + 1) ?? "concreteLight" });
      if (lit) addBox(b, 1, ax, h + 1.2, front + 2.1, aw * 0.6, 0.9, 0.12, b.D.u("anchorSign", sx + 1) < 0.5 ? b.neon : "backlit");
    }
    addBox(b, 1, s.x, h + 1.6, z0, Math.min(8, hw * 0.2), 1.6, Math.min(hd * 0.6, 10), "glassBlue");
  }
  // The entrance: a taller bay proud of the front, glass doors, the store's name lit over them.
  const ew = Math.min(6, hw * 0.3), ex = mall ? s.x : s.x + (b.D.u("door") - 0.5) * (hw - ew) * 0.8;
  addMass(b, { x: ex, z: front + 0.6, hw: ew, hd: 1.2, y0: 0, y1: h + 2.5, slot: mall ? "glassBlue" : "trim" }, 2);
  if (lit) addBox(b, 1, ex, 1.6, front + 1.85, ew * 0.6, 1.5, 0.06, "shopCool");
  if (lit) addBox(b, 1, ex, h + 1.1, front + 1.9, ew * 0.85, 1, 0.1, b.D.u("storeSign") < 0.6 ? "backlit" : b.neon);
  // (A band along the fascia; a loading dock round the side.)
  addBox(b, 1, s.x, h - 0.4, front + 0.1, hw + 0.1, 0.4, 0.1, "trim");
  addBox(b, 0, s.x - hw - 0.3, 1.8, z0 - hd * 0.4, 0.3, 1.6, 2, "corrugated");
  // The lot: rows from the drive along the front to the road, lamp masts, a cart corral or two.
  const rows = parkingRows(b, s.x - s.hw + 0.5, s.x + s.hw - 0.5, front + 5, s.z + s.hd - 2, b.derelict ? 0.05 : within(b.D, "busy", [0.3, 0.6]));
  // (The corrals stand along the drive, either side of the doors.)
  for (let k = 0; k < (rows ? 2 : 0); k += 1) {
    const x = ex + (k ? 1 : -1) * (ew + 4), z = front + 3.4;
    if (Math.abs(x - s.x) > hw - 2.5) continue;
    addBox(b, 0, x, 0.95, z, 2.2, 0.04, 0.8, "metal");
    for (const sz of [-1, 1]) addBox(b, 0, x, 0.5, z + sz * 0.8, 2.2, 0.5, 0.04, "metal");
  }
};

/** A drive-thru: a small box, its lane wrapping round the side and back, the menu board, the window, cars queued. */
const drivethru: Op<"drivethru"> = (b) => {
  const s = b.site, side = b.D.u("lane") < 0.5 ? -1 : 1, lane = 3.6;
  // (A lot too narrow for the lane round it -- one it was squeezed onto -- gets the box alone.)
  const wide = s.hw >= lane + 4, deep = s.hd >= 9;
  const hw = wide ? clamp(s.hw - lane - 1, 2.5, 7) : Math.max(2, s.hw - 0.5), hd = clamp(s.hd * 0.3, Math.min(3.5, s.hd - 0.5), 6.5), h = 4.2;
  const bx = wide ? s.x + side * (s.hw - lane - 0.6 - hw) : s.x;
  const bz = Math.min(s.z + s.hd - hd - 0.5, Math.max(s.z + s.hd * 0.1, s.z - s.hd + (deep ? lane + 0.8 : 0.5) + hd)), front = bz + hd;
  addBox(b, 1, s.x, 0.03, s.z, s.hw, 0.03, s.hd, "roof");
  addMass(b, { x: bx, z: bz, hw, hd, y0: 0, y1: h, slot: b.derelict ? "boarded" : b.wall });
  // (A mansard of roof round the top, the brand's colour lit along its edge; glass along the front.)
  for (const sz of [-1, 1]) addBox(b, 1, bx, h + 0.45, bz + sz * (hd - 0.3), hw + 0.3, 0.45, 0.6, "roof", { wedge: true, lo: 0.3, turn: sz > 0 ? 0 : Math.PI });
  if (!b.derelict) {
    addBox(b, 1, bx, h - 0.1, front + 0.08, hw + 0.05, 0.14, 0.08, b.neon);
    addBox(b, 1, bx, 1.5, front + 0.06, hw - 0.6, 1.1, 0.06, "shopWarm");
    if (wide) addBox(b, 1, bx + side * (hw + 0.06), 1.6, bz, 0.06, 0.7, 1, "shopWarm");
  }
  if (!wide) return;
  // The lane: along the side, round the back, back out to the front.
  const lx = s.x + side * (s.hw - lane / 2 - 0.3), back = Math.max(s.z - s.hd + lane / 2 + 0.3, bz - hd - lane / 2 - 0.3), zf = Math.min(s.z + s.hd - 0.5, front + 3);
  addBox(b, 1, lx, 0.04, (back - lane / 2 + zf) / 2, lane / 2, 0.04, (zf - back + lane / 2) / 2, "concreteDark");
  if (deep) addBox(b, 1, bx - side * lane / 4, 0.04, back, hw + lane / 4 + 0.6, 0.04, lane / 2, "concreteDark");
  // (The menu board at the lane's outer edge, behind the window: a post and a lit board facing the car.)
  const mx = s.x + side * (s.hw - 0.4), mz = bz - hd * 0.4;
  addBox(b, 0, mx, 1.1, mz, 0.08, 1.1, 0.08, "metal");
  if (!b.derelict) addBox(b, 1, mx, 1.9, mz, 0.08, 0.8, 1.1, "backlit");
  // Cars: a queue in the lane, a few parked out front.
  const queue = b.derelict ? 0 : count(b.D, "queue", [0, 3]);
  for (let k = 0; k < queue; k += 1) vehicle(b, "car", lx, bz + hd - 1 - k * 5.4, Math.PI, 200 + k);
  const room = s.z + s.hd - front - 1;
  if (room > 5.5) {
    const n = Math.floor((2 * hw + 2) / 2.8);
    for (let k = 0; k < n; k += 1) if (b.D.u("eatIn", k) < (b.derelict ? 0.1 : 0.45)) vehicle(b, "car", bx - hw + 1.4 + k * 2.8, front + 3, Math.PI, 300 + k);
  }
};

/** Service bays: a low box with roll-up doors onto an apron (a garage's cars, a tuner's neon, a fire station's engines, a depot's buses). */
const bays: Op<"bays"> = (b, op) => {
  const s = b.site, kind = op.kind, bus = kind === "bus", fire = kind === "fire";
  const dw = bus ? 2.2 : fire ? 1.95 : 1.6, dh = bus ? 4.8 : fire ? 4.4 : 3.6, h = Math.max(dh + 1.4, Math.min(b.height, 8));
  const apron = bus ? clamp(s.hd * 0.9, 8, 26) : clamp(s.hd * 0.5, 5, 11);
  const hd = Math.max(4, s.hd - apron / 2), z0 = s.z - s.hd + hd, front = z0 + hd, hw = Math.max(4, s.hw - 0.5);
  if (s.z + s.hd - front > 0.5) addBox(b, 1, s.x, 0.03, (front + s.z + s.hd) / 2, s.hw, 0.03, (s.z + s.hd - front) / 2, "roof");
  addMass(b, { x: s.x, z: z0, hw, hd, y0: 0, y1: h, slot: b.derelict ? "derelict" : b.wall });
  const most = Math.max(1, Math.floor((2 * hw - 5) / (2 * dw + 1.2))), n = Math.min(most, count(b.D, "doors", op.doors));
  const off = (b.D.u("doorsAt") - 0.5) * Math.max(0, 2 * hw - 5 - n * (2 * dw + 1.2));
  const doors: number[] = [];
  for (let k = 0; k < n; k += 1) doors.push(s.x + off + (k - (n - 1) / 2) * (2 * dw + 1.2));
  doors.forEach((x, k) => {
    const openDoor = !b.derelict && b.D.u("open", k) < (kind === "tuning" ? 0.7 : fire ? 0.25 : 0.45);
    const slot: SlotName = b.derelict ? "boarded" : openDoor ? (kind === "tuning" ? "shopCool" : "concreteDark") : fire ? "redBrick" : "corrugated";
    addBox(b, 1, x, dh / 2, front + 0.06, dw, dh / 2, 0.06, slot);
    if (!b.derelict) addBox(b, 0, x, dh + 0.35, front + 0.25, 0.35, 0.12, 0.25, kind === "tuning" ? b.neon : "sodium");
    // (What's in the bay: a car waiting its turn, an engine, a bus nosed in.)
    if (b.derelict) return;
    const ahead = b.D.u("waiting", k);
    if (bus) { if (ahead < 0.7) vehicle(b, "bus", x, front + 6.6, Math.PI, 500 + k); }
    else if (fire) { if (openDoor || ahead < 0.2) vehicle(b, "truck", x, front + 7.8, 0, 500 + k, 0, "redBrick"); }
    else if (ahead < 0.6) vehicle(b, "car", x, front + 3, Math.PI + b.D.flat("wait", k) * 0.15, 500 + k);
  });
  if (fire && !b.derelict) {
    // (Red trim along the top, the hose tower at one end.)
    addBox(b, 1, s.x, h - 0.35, front + 0.15, hw + 0.1, 0.35, 0.15, "redBrick");
    const tx = s.x + (b.D.u("hoseSide") < 0.5 ? -1 : 1) * (hw - 2.2);
    addMass(b, { x: tx, z: z0 - hd + 2.2, hw: 2, hd: 2, y0: 0, y1: h + 7, slot: b.wall });
  }
  if (kind === "tuning" && !b.derelict) addBox(b, 1, s.x, h - 0.6, front + 0.12, hw, 0.08, 0.1, b.neon);
  if ((kind === "garage" || kind === "tuning") && !b.derelict) {
    // Tyres, stacked by the corner of the front.
    const tx = s.x + (b.D.u("tyreSide") < 0.5 ? -1 : 1) * (hw - 1), n = 1 + count(b.D, "tyreStacks", [1, 3]);
    for (let k = 0; k < n; k += 1) {
      const x = tx - Math.sign(tx - s.x) * k * 0.85, top = 0.35 + 0.24 * count(b.D, "tyres", [2, 6], k);
      addCapsule(b, 0, [x, 0.36, front + 0.9], [x, top, front + 0.9], 0.36, "roof");
    }
  }
  if (bus) for (let k = 0; k < 2; k += 1) mast(b, s.x + (k ? 1 : -1) * (s.hw - 0.5), front + apron * 0.5, 10);
};

/** A car wash: a long tunnel down one side, its mouth to the road, brushes, arches over it; vacuum bays down the other. */
const carwash: Op<"carwash"> = (b) => {
  const s = b.site, side = b.D.u("tunnelSide") < 0.5 ? -1 : 1, hw = clamp(s.hw * 0.3, 2.8, 3.6);
  const hd = Math.max(4, Math.min(s.hd - 4, 15)), tx = s.x + side * (s.hw - hw - 0.4), tz = s.z - s.hd + hd + 0.3, mouth = tz + hd, h = 5;
  addMass(b, { x: tx, z: tz, hw, hd, y0: 0, y1: h, slot: b.derelict ? "derelict" : b.wall });
  const lit = !b.derelict;
  // The mouth: dark, framed in the district's neon, two brushes standing in it.
  addBox(b, 1, tx, 1.8, mouth + 0.05, hw - 0.6, 1.8, 0.05, "darkGlass");
  addBox(b, 1, tx, 3.85, mouth + 0.2, hw + 0.2, 0.25, 0.2, lit ? b.neon : "metal");
  for (const sx of [-1, 1]) {
    addBox(b, 1, tx + sx * (hw - 0.3), 1.8, mouth + 0.2, 0.3, 1.8, 0.2, lit ? b.neon : "metal");
    if (lit) addCapsule(b, 0, [tx + sx * (hw - 1.3), 0.5, mouth + 0.35], [tx + sx * (hw - 1.3), 3, mouth + 0.35], 0.5, sx > 0 ? "glassBlue" : b.neon);
  }
  // (Arches over the roof, one every few metres.)
  for (let k = 0; k < 3; k += 1) {
    const z = tz + hd * (0.6 - 0.6 * k);
    for (const sx of [-1, 1]) addBox(b, 1, tx + sx * (hw + 0.15), (h + 1.2) / 2, z, 0.15, (h + 1.2) / 2, 0.2, "metal");
    addBox(b, 1, tx, h + 1.2, z, hw + 0.3, 0.2, 0.2, lit && k === 0 ? b.neon : "metal");
  }
  // The queue at the mouth, the vacuum bays down the other side under their canopy.
  const q = lit ? count(b.D, "washQueue", [0, 2]) : 0;
  for (let k = 0; k < q; k += 1) { const z = mouth + 3 + k * 5.2; if (z < s.z + s.hd - 2.3) vehicle(b, "car", tx, z, Math.PI, 700 + k); }
  const vx = s.x - side * (s.hw - 1.6), room = 2 * s.hw - 2 * hw - 1;
  if (room > 5) {
    const n = Math.max(2, Math.floor((2 * hd) / 4));
    for (let k = 0; k <= n; k += 1) addBox(b, 0, vx, 1.4, tz - hd + (2 * hd * k) / n, 0.2, 1.4, 0.2, "metal");
    addBox(b, 1, vx + side * 1, 3, tz, 1.4, 0.12, hd, "metal");
    if (lit) addBox(b, 1, vx + side * 1, 2.86, tz, 1.3, 0.03, hd - 0.2, "led");
    for (let k = 0; k < n; k += 1) if (lit && b.D.u("vacuum", k) < 0.35) vehicle(b, "car", vx + side * 2.6, tz - hd + (2 * hd * (k + 0.5)) / n, side > 0 ? Math.PI / 2 : -Math.PI / 2, 750 + k);
  }
};

/** A surface lot: a booth at the gate, rows of bays, lamp masts. */
const parking: Op<"parking"> = (b) => {
  const s = b.site, bx = s.x + (b.D.u("booth") < 0.5 ? -1 : 1) * (s.hw - 1.6);
  addMass(b, { x: bx, z: s.z + s.hd - 1.8, hw: 1.2, hd: 1.2, y0: 0, y1: 2.6, slot: b.wall });
  if (!b.derelict) addBox(b, 0, bx, 1.6, s.z + s.hd - 0.55, 0.9, 0.5, 0.05, "shopWarm");
  addBox(b, 1, bx, 2.75, s.z + s.hd - 1.8, 1.5, 0.15, 1.5, "roof");
  parkingRows(b, s.x - s.hw + 0.3, s.x + s.hw - 0.3, s.z - s.hd + 0.3, s.z + s.hd - 3.6, b.derelict ? 0.08 : within(b.D, "full", [0.45, 0.85]));
};

/** Vehicles parked in front of the building (its first mass): a police station's patrol cars, a hospital's ambulances, a motel's guests. */
const forecourt: Op<"forecourt"> = (b, op) => {
  const s = b.site, m = b.masses[0];
  if (!m) return;
  // (Out to the lot's front, setbacks and all: the forecourt is what the setback was for.)
  const z0 = m.z + m.hd + 1, z1 = b.frame.hd - 1.5, fill = within(b.D, "courtFill", op.fill);
  const big = op.vehicle === "bus" || op.vehicle === "truck";
  const len = big ? 13 : op.vehicle === "ambulance" ? 6.2 : 4.8, pitch = big ? 3.4 : op.vehicle === "ambulance" ? 3 : 2.8;
  if (z1 - z0 < len) return;
  const n = Math.floor((2 * s.hw - 2) / pitch), z = z0 + len / 2 + (big ? 0 : 0.2);
  for (let k = 0; k < n; k += 1) if (!b.derelict && b.D.u("court", k) < fill) vehicle(b, op.vehicle, s.x - s.hw + 1 + pitch * (k + 0.5), z, Math.PI, 900 + k);
};

/** A trailer park: an office at the gate, rows of trailers on blocks, a car by some, trees between. */
const trailers: Op<"trailers"> = (b) => {
  const s = b.site, ox = s.x + (b.D.u("office") < 0.5 ? -1 : 1) * (s.hw - 3);
  addMass(b, { x: ox, z: s.z + s.hd - 3, hw: 2.8, hd: 2.4, y0: 0, y1: 3, slot: b.wall });
  addBox(b, 1, ox, 3.2, s.z + s.hd - 3, 3, 0.2, 2.6, "roof");
  const cols = Math.max(1, Math.floor((2 * s.hw - 1) / 7.5)), rows = Math.max(1, Math.floor((2 * s.hd - 7) / 12.5));
  const cw = (2 * s.hw) / cols, rh = (2 * s.hd - 7) / rows;
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const i = r * 32 + c, x = s.x - s.hw + cw * (c + 0.5), z = s.z - s.hd + rh * (r + 0.5);
    if (b.D.u("lotEmpty", i) < 0.12) continue;
    const slot = pick(b.D, "trailer", { siding: 3, metal: 2, stucco: 2, trim: 2, corrugated: 1 }, i) ?? "siding";
    const tx = x - 1.3, hd = Math.min(5, rh / 2 - 1);
    const t: Mass = { x: tx, z, hw: 1.3, hd, y0: 0, y1: 3.1, slot: b.derelict ? "derelict" : slot };
    b.masses.push(t);
    addBox(b, 1, tx, 1.75, z, 1.3, 1.35, hd, t.slot, { grid: true });
    addBox(b, 0, tx, 0.2, z, 1.1, 0.2, hd - 0.4, "concreteDark");
    addBox(b, 0, tx + 1.7, 0.35, z + hd * 0.3, 0.45, 0.35, 1.2, "timber");
    if (b.D.u("trailerCar", i) < 0.5) vehicle(b, "car", x + 2.4, z - hd * 0.3, 0, 1000 + i);
    else if (b.D.u("trailerTree", i) < 0.6) addPlant(b, b.D.u("trailerTreeKind", i) < 0.7 ? "tree" : "bush", x + 2.4, 0, z - hd * 0.3, 0.7, Math.floor(b.D.u("trailerSeed", i) * 1e6));
  }
};

export const BUSINESS_OPS = { showroom, bigbox, drivethru, bays, carwash, parking, forecourt, trailers };
