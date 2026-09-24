// What a city runs on besides its shops: schools with their playing fields and
// a college's quad round its clock tower, a city hall or library behind its
// columns under a dome, a stadium's bowl and light towers on the skyline, a
// cemetery's walls and rows of stones, a railway station's platform canopy, a
// freight yard's container stacks under gantry cranes, a substation's fenced
// transformers and gantries (where the power lines come in), a suburb's water
// tower, a tank farm or a gasholder, a factory's smokestacks.

import type { Build } from "./frame.ts";
import { addBox, addCapsule, addMass, addPlant, count, pick, toWorld, within } from "./frame.ts";
import type { SlotName } from "./slots.ts";
import type { MassOp } from "./types.ts";
import { mast, vehicle } from "./business.ts";

type Op<K extends MassOp["op"]> = (b: Build, op: Extract<MassOp, { op: K }>) => void;
type SolidArgs = { readonly x: number; readonly z: number; readonly hw: number; readonly hd: number; readonly y1: number; readonly slot?: SlotName };
type GableArgs = { readonly x: number; readonly z: number; readonly hw: number; readonly hd: number; readonly y: number; readonly rise: number; readonly slot: SlotName };

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const snap = (b: Build, h: number): number => Math.max(b.storey, Math.round(h / b.storey) * b.storey);
/** The eight points of a unit octagon (no trig: the same everywhere). */
const R2 = 0.7071067811865476;
const OCT: readonly (readonly [number, number])[] = [[1, 0], [R2, R2], [0, 1], [-R2, R2], [-1, 0], [-R2, -R2], [0, -1], [R2, -R2]];

/** A mass a car hits whose look is drawn apart: its record only. */
const solid = (b: Build, { x, z, hw, hd, y1, slot = "metal" }: SolidArgs): void => { b.masses.push({ x, z, hw, hd, y0: 0, y1, slot }); };

/** A gable whose ridge runs across the front (x): its ends face the sides. */
function gableX(b: Build, { x, z, hw, hd, y, rise, slot }: GableArgs): void {
  for (const side of [1, -1]) addBox(b, 1, x, y + rise / 2, z + (side * hd) / 2, hw, rise / 2, hd / 2, slot, { wedge: true, turn: side > 0 ? 0 : Math.PI });
}
/** A gable whose ridge runs front to back (z): its end -- a pediment -- faces the street. */
function gableZ(b: Build, { x, z, hw, hd, y, rise, slot }: GableArgs): void {
  for (const side of [1, -1]) addBox(b, 1, x + (side * hw) / 2, y + rise / 2, z, hd, rise / 2, hw / 2, slot, { wedge: true, turn: (side * Math.PI) / 2 });
}

/** A playing field: grass, a running track round it, its lines, the goals. */
function field(b: Build, x0: number, x1: number, z0: number, z1: number): void {
  const x = (x0 + x1) / 2, z = (z0 + z1) / 2, hw = (x1 - x0) / 2, hd = (z1 - z0) / 2;
  if (hw < 6 || hd < 5) return;
  for (const sz of [-1, 1]) addBox(b, 1, x, 0.05, z + sz * (hd - 0.8), hw, 0.05, 0.8, "redBrick");
  for (const sx of [-1, 1]) addBox(b, 1, x + sx * (hw - 0.8), 0.05, z, 0.8, 0.05, hd - 1.6, "redBrick");
  addBox(b, 2, x, 0.04, z, hw - 1.6, 0.04, hd - 1.6, "grass");
  addBox(b, 0, x, 0.09, z, 0.06, 0.01, hd - 2.2, "trim");
  for (const sx of [-1, 1]) {
    const gx = x + sx * (hw - 2.4);
    for (const sz of [-1, 1]) addBox(b, 0, gx, 1.1, z + sz * 1.8, 0.06, 1.1, 0.06, "trim");
    addBox(b, 0, gx, 2.2, z, 0.06, 0.06, 1.86, "trim");
  }
}

/** A school (low wings, a playing field out front) or a college (a quad of halls round a lawn, a clock tower). */
const campus: Op<"campus"> = (b, op) => {
  const s = b.site, h = b.height;
  if (op.kind === "school") {
    const d = clamp(s.hd * 0.26, 5, 9), backFront = s.z - s.hd + 2 * d;
    addMass(b, { x: s.x, z: s.z - s.hd + d, hw: Math.max(4, s.hw - 1), hd: d, y0: 0, y1: h, slot: b.wall });
    const side = b.D.u("wing") < 0.5 ? -1 : 1, end = s.z - s.hd * 0.05;
    if (end - backFront > 4 && s.hw > 10) addMass(b, { x: s.x + side * (s.hw - 1 - d * 0.8), z: (backFront + end) / 2, hw: d * 0.8, hd: (end - backFront) / 2, y0: 0, y1: h, slot: b.wall });
    // (The entrance canopy, the field, the floodlights, a school bus.)
    addBox(b, 1, s.x - side * s.hw * 0.3, 3.4, backFront + 1.5, 3, 0.2, 1.5, "trim");
    const fz0 = Math.max(backFront, end) + 2, fz1 = s.z + s.hd - 1.2;
    field(b, s.x - s.hw + 1, s.x + s.hw - 1, fz0, fz1);
    if (fz1 - fz0 > 14) for (const sx of [-1, 1]) mast(b, s.x + sx * (s.hw - 0.5), (fz0 + fz1) / 2, 12, "led");
    if (s.hw > 12 && end - backFront > 14) vehicle(b, "bus", s.x - side * (s.hw - 2), (backFront + end) / 2, 0, 1, 0, "buffBrick");
    return;
  }
  // The quad: a hall across the back (the clock tower at its middle), halls down each side, the front one split by a gate.
  const d = clamp(Math.min(s.hw, s.hd) * 0.22, 5, 10), side = snap(b, h * 0.8);
  const bars: [number, number, number, number, number][] = [
    [s.x, s.z - s.hd + d, s.hw, d, h],
    [s.x - s.hw + d, s.z, d, s.hd - 2 * d, side], [s.x + s.hw - d, s.z, d, s.hd - 2 * d, side],
  ];
  const gate = Math.min(5, s.hw * 0.25), fw = (s.hw - gate) / 2;
  if (fw > 3) for (const sx of [-1, 1]) bars.push([s.x + sx * (gate + fw), s.z + s.hd - d, fw, d, side]);
  for (const [x, z, hw, hd, top] of bars) {
    if (hw < 2 || hd < 2) continue;
    addMass(b, { x, z, hw, hd, y0: 0, y1: top, slot: b.wall });
    const rise = Math.min(hw, hd) * 0.6;
    if (hw >= hd) gableX(b, { x, z, hw: hw + 0.3, hd: hd + 0.3, y: top, rise, slot: "roof" }); else gableZ(b, { x, z, hw: hw + 0.3, hd: hd + 0.3, y: top, rise, slot: "roof" });
  }
  const ix = s.hw - 2 * d, iz = s.hd - 2 * d;
  if (ix > 2 && iz > 2) {
    addBox(b, 2, s.x, 0.04, s.z, ix, 0.04, iz, "grass");
    addBox(b, 1, s.x, 0.09, s.z, 1, 0.02, iz, "gravel");
    addBox(b, 1, s.x, 0.09, s.z, ix, 0.02, 1, "gravel");
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) if (ix > 5 && iz > 5) addPlant(b, "tree", s.x + sx * ix * 0.55, 0, s.z + sz * iz * 0.55, 0.9, Math.floor(b.D.u("quadTree", sx * 3 + sz) * 1e6));
  }
  // (The clock tower: a shaft, a lit face each way, a pyramid on top.)
  const tz = s.z - s.hd + d, tw = 2.6, th = h + within(b.D, "clockH", [10, 18]);
  addBox(b, 2, s.x, th / 2, tz, tw, th / 2, tw, b.wall, { grid: true });
  addBox(b, 1, s.x, th - 2, tz, tw + 0.1, 1.3, 1.3, "backlit");
  addBox(b, 1, s.x, th - 2, tz, 1.3, 1.3, tw + 0.1, "backlit");
  gableX(b, { x: s.x, z: tz, hw: tw + 0.3, hd: tw + 0.3, y: th, rise: 3.5, slot: "roof" });
  gableZ(b, { x: s.x, z: tz, hw: tw + 0.3, hd: tw + 0.3, y: th, rise: 3.5, slot: "roof" });
};

/** A city hall, a library, a courthouse: steps, a portico of columns under a pediment, a dome or a clock tower. */
const hall: Op<"hall"> = (b, op) => {
  const s = b.site, hw = clamp(s.hw - 3, 5, 20), hd = clamp(s.hd - 7, 5, 16), z0 = s.z - s.hd + hd + 1, front = z0 + hd, h = b.height;
  addMass(b, { x: s.x, z: z0, hw, hd, y0: 0, y1: h, slot: b.wall });
  addBox(b, 1, s.x, h + 0.4, z0, hw + 0.4, 0.4, hd + 0.4, "trim");
  // (Steps up to the portico; the columns; the entablature and the pediment over them.)
  const pw = Math.min(hw * 0.65, 11);
  for (let k = 0; k < 3; k += 1) { const d = 1.8 - k * 0.45; addBox(b, 1, s.x, 0.15 + k * 0.3, front + d, pw + 1 - k * 0.3, 0.15, d, "limestone"); }
  const colH = Math.min(h - 1, 11), n = clamp(Math.round(pw / 2), 4, 10);
  for (let k = 0; k < n; k += 1) {
    const x = s.x - pw + (2 * pw * (k + 0.5)) / n;
    addCapsule(b, 1, [x, 0.9, front + 2.4], [x, colH, front + 2.4], 0.42, "limestone");
  }
  addBox(b, 1, s.x, colH + 0.55, front + 1.5, pw + 0.5, 0.55, 1.5, "limestone");
  gableZ(b, { x: s.x, z: front + 1.5, hw: pw + 0.5, hd: 1.5, y: colH + 1.1, rise: Math.min(4, pw * 0.3), slot: "limestone" });
  if (pick(b.D, "hallTop", op.tops) === "clock") {
    const tw = Math.min(3, hw * 0.3), th = h + within(b.D, "towerH", [8, 14]);
    addBox(b, 1, s.x, (h + th) / 2, z0, tw, (th - h) / 2, tw, b.wall, { grid: true });
    addBox(b, 1, s.x, th - 2, z0, tw + 0.1, 1.2, 1.2, "backlit");
    addBox(b, 1, s.x, th - 2, z0, 1.2, 1.2, tw + 0.1, "backlit");
    addCapsule(b, 1, [s.x, th, z0], [s.x, th + within(b.D, "clockSpire", [4, 9]), z0], 0.5, "roof");
    return;
  }
  // (The dome: a drum, the dome, a lantern with its light.)
  const r = Math.min(hw, hd) * 0.42;
  addBox(b, 1, s.x, h + 1.6, z0, r * 0.9, 1.6, r * 0.9, b.wall);
  addCapsule(b, 1, [s.x, h + 3.2, z0], [s.x, h + 3.3, z0], r, pick(b.D, "domeSlot", { glassGreen: 2, metal: 1, limestone: 1 }) ?? "metal");
  addBox(b, 1, s.x, h + 3.2 + r + 0.9, z0, 0.6, 0.9, 0.6, b.derelict ? "limestone" : "backlit");
};

/** A stadium: stands raked round a pitch, lit round their rim, its light towers at the corners. */
const stadium: Op<"stadium"> = (b) => {
  const s = b.site, sw = clamp(Math.min(s.hw, s.hd) * 0.3, 8, 18), H = clamp(b.height, 12, 26);
  const ends: [number, number, number, number, number][] = [
    // (x, z, half width, half depth -- in the frame -- and the turn that rakes it down to the pitch.)
    [s.x, s.z - s.hd + sw / 2, s.hw, sw / 2, 0], [s.x, s.z + s.hd - sw / 2, s.hw, sw / 2, Math.PI],
    [s.x + s.hw - sw / 2, s.z, sw / 2, s.hd - sw, -Math.PI / 2], [s.x - s.hw + sw / 2, s.z, sw / 2, s.hd - sw, Math.PI / 2],
  ];
  ends.forEach(([x, z, hw, hd, turn], k) => {
    solid(b, { x, z, hw, hd, y1: H, slot: b.wall });
    const along = k < 2;
    // (The rake -- a wedge -- and the stand's back wall, windowed.)
    addBox(b, 2, x, H / 2, z, along ? hw : hd, H / 2, along ? hd : hw, "concreteLight", { wedge: true, lo: 0.12, turn });
    const ox = along ? 0 : Math.sign(x - s.x) * (hw - 0.3), oz = along ? Math.sign(z - s.z) * (hd - 0.3) : 0;
    addBox(b, 2, x + ox, H / 2, z + oz, along ? hw : 0.3, H / 2, along ? 0.3 : hd, b.wall, { grid: true });
    if (!b.derelict) addBox(b, 1, x + ox * 1.02, H - 0.3, z + oz * 1.02, along ? hw : 0.1, 0.15, along ? 0.1 : hd, b.neon);
    // (A roof out over the long stands.)
    if (along) addBox(b, 1, x, H + 1.6, z + Math.sign(z - s.z) * sw * 0.15, hw, 0.15, sw * 0.4, "metal");
  });
  addBox(b, 2, s.x, 0.05, s.z, s.hw - sw, 0.05, s.hd - sw, "grass");
  addBox(b, 0, s.x, 0.11, s.z, 0.08, 0.01, s.hd - sw - 1, "trim");
  addBox(b, 0, s.x, 0.11, s.z, s.hw - sw - 1, 0.01, 0.08, "trim");
  const top = H + within(b.D, "lightTowers", [14, 22]);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const x = s.x + sx * (s.hw - 1.2), z = s.z + sz * (s.hd - 1.2), turn = sz > 0 ? (sx > 0 ? -0.75 : 0.75) * Math.PI : (sx > 0 ? -0.25 : 0.25) * Math.PI;
    addBox(b, 1, x, top / 2, z, 0.45, top / 2, 0.45, "metal");
    addBox(b, 1, x, top + 1, z, 2.6, 1.4, 0.3, b.derelict ? "metal" : "led", { turn });
    if (!b.derelict) { const [wx, , wz] = toWorld(b, s.x + sx * s.hw * 0.4, 0, s.z + sz * s.hd * 0.4); b.lights.push({ x: wx, z: wz, r: 40 }); }
  }
};

/** A cemetery: a wall with a gate, a path up to the chapel, rows of stones, cypresses. */
const cemetery: Op<"cemetery"> = (b) => {
  const s = b.site, ch = { hw: Math.min(3.5, s.hw * 0.3), hd: Math.min(5, s.hd * 0.2) }, cz = s.z - s.hd + ch.hd + 1.5, h = 6.5;
  addMass(b, { x: s.x, z: cz, hw: ch.hw, hd: ch.hd, y0: 0, y1: h, slot: b.wall });
  gableZ(b, { x: s.x, z: cz, hw: ch.hw + 0.3, hd: ch.hd + 0.3, y: h, rise: ch.hw * 0.9, slot: "roof" });
  addBox(b, 1, s.x, h + 3, cz + ch.hd - 1, 0.8, 3, 0.8, b.wall);
  addCapsule(b, 1, [s.x, h + 6, cz + ch.hd - 1], [s.x, h + 9, cz + ch.hd - 1], 0.35, "roof");
  addBox(b, 2, s.x, 0.04, s.z, s.hw, 0.04, s.hd, "grass");
  addBox(b, 1, s.x, 0.09, (cz + ch.hd + s.z + s.hd) / 2, 0.9, 0.02, (s.z + s.hd - cz - ch.hd) / 2, "gravel");
  // (The wall round it all, the gate a gap in its front.)
  const wh = 1.7, wall = b.wall === "stoneArched" ? "limestone" : b.wall;
  const walls: [number, number, number, number][] = [[s.x, s.z - s.hd + 0.2, s.hw, 0.2], [s.x - s.hw + 0.2, s.z, 0.2, s.hd], [s.x + s.hw - 0.2, s.z, 0.2, s.hd]];
  const gw = (s.hw - 2) / 2;
  for (const sx of [-1, 1]) walls.push([s.x + sx * (2 + gw), s.z + s.hd - 0.2, gw, 0.2]);
  for (const [x, z, hw, hd] of walls) { solid(b, { x, z, hw, hd, y1: wh, slot: wall }); addBox(b, 2, x, wh / 2, z, hw, wh / 2, hd, wall); }
  // The stones, in rows either side of the path, a cross or an obelisk among them.
  let n = 0;
  for (let r = 0; n < 180; r += 1) {
    const z = cz + ch.hd + 2 + r * 2.8;
    if (z > s.z + s.hd - 1.5) break;
    for (let c = 0; ; c += 1) {
      const x = s.x - s.hw + 1.4 + c * 2.2;
      if (x > s.x + s.hw - 1.2) break;
      if (Math.abs(x - s.x) < 1.8 || b.D.u("grave", r * 64 + c) < 0.2) continue;
      const i = r * 64 + c, kind = b.D.u("stone", i), slot = pick(b.D, "stoneSlot", { limestone: 3, concreteLight: 2, concreteDark: 1 }, i) ?? "limestone";
      if (kind < 0.12) { addBox(b, 0, x, 0.6, z, 0.07, 0.6, 0.07, slot); addBox(b, 0, x, 0.85, z, 0.32, 0.07, 0.07, slot); }
      else if (kind < 0.16) addBox(b, 0, x, 0.9, z, 0.2, 0.9, 0.2, slot);
      else addBox(b, 0, x, 0.42, z, 0.32, 0.42, 0.08, slot);
      n += 1;
    }
  }
  for (let k = 0; ; k += 1) {
    const z = cz + ch.hd + 3 + k * 7;
    if (z > s.z + s.hd - 3) break;
    for (const sx of [-1, 1]) addPlant(b, "conifer", s.x + sx * 1.6, 0, z, 0.75, Math.floor(b.D.u("cypress", k * 2 + (sx + 1) / 2) * 1e6));
  }
};

/** A railway station: the building on the street, its glazed hall, the platform behind under its canopy, the track, a train in. */
const station: Op<"station"> = (b) => {
  const s = b.site, bh = clamp(s.hd * 0.28, 4, 8), bw = Math.max(4, Math.min(s.hw - 2, 18)), h = b.height, bz = s.z + s.hd - bh - 1;
  addMass(b, { x: s.x, z: bz, hw: bw, hd: bh, y0: 0, y1: h, slot: b.wall });
  const gw = Math.min(5, bw * 0.35);
  addMass(b, { x: s.x, z: bz + 0.8, hw: gw, hd: bh - 0.2, y0: 0, y1: h + 3, slot: "glassBlue" });
  if (!b.derelict) {
    addBox(b, 1, s.x, h + 1.8, bz + bh + 0.9, 1.2, 1.2, 0.1, "backlit");
    addBox(b, 1, s.x, h - 0.6, bz + bh + 0.3, Math.min(bw * 0.6, 9), 0.5, 0.1, b.neon);
  }
  // Behind it: the platform, its canopy on posts, the track, and (most of the time) a train.
  const pz = bz - bh - 3, tz = pz - 2.5 - 2.2;
  if (tz - 2 < s.z - s.hd) return;
  const pw = s.hw - 0.5;
  solid(b, { x: s.x, z: pz, hw: pw, hd: 2.5, y1: 1, slot: "concreteLight" });
  addBox(b, 2, s.x, 0.5, pz, pw, 0.5, 2.5, "concreteLight");
  for (let x = -pw + 1; x <= pw - 1; x += 8) addBox(b, 1, s.x + x, 2.7, pz, 0.15, 1.7, 0.15, "metal");
  addBox(b, 1, s.x, 4.5, pz - 0.3, pw, 0.15, 2.9, "metal");
  if (!b.derelict) addBox(b, 1, s.x, 4.33, pz - 0.3, pw - 0.3, 0.03, 2.6, "led");
  addBox(b, 1, s.x, 0.08, tz, s.hw, 0.08, 1.8, "gravel");
  for (const sz of [-1, 1]) addBox(b, 0, s.x, 0.2, tz + sz * 0.72, s.hw, 0.05, 0.05, "metal");
  if (b.D.u("trainIn") < 0.65) {
    const n = Math.floor((2 * s.hw - 1) / 13.2), paint = pick(b.D, "livery", { trim: 2, glassBlue: 1, metal: 2, redBrick: 1 }) ?? "metal";
    for (let k = 0; k < n; k += 1) {
      const x = s.x - s.hw + 0.5 + 13.2 * (k + 0.5);
      solid(b, { x, z: tz, hw: 6.4, hd: 1.45, y1: 4, slot: paint });
      addBox(b, 1, x, 2.2, tz, 6.4, 1.8, 1.45, paint);
      addBox(b, 0, x, 2.7, tz, 6.1, 0.55, 1.5, "darkGlass");
    }
  }
  if (!b.derelict) mast(b, s.x + s.hw - 0.5, pz, 8, "led");
};

/** A freight yard: container stacks in blocks, gantry cranes straddling them, trucks in the lane. */
const containers: Op<"containers"> = (b) => {
  const s = b.site;
  addBox(b, 1, s.x, 0.03, s.z, s.hw, 0.03, s.hd, "roof");
  const x0 = s.x - s.hw + 2.6, x1 = s.x + s.hw - 2.6, z0 = s.z - s.hd + 1, z1 = s.z + s.hd - 7;
  const cols = Math.max(0, Math.floor((x1 - x0) / 2.6)), rows = Math.max(0, Math.floor((z1 - z0) / 6.8));
  const PAINT = { redBrick: 3, glassBlue: 2, glassGreen: 2, buffBrick: 2, corrugated: 2, trim: 2, concreteLight: 1, glassBronze: 1 } as const;
  let stacks = 0;
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    if (c % 5 === 4 || stacks >= 80) continue;
    const i = r * 64 + c, u = b.D.u("stack", i);
    if (u < 0.15) continue;
    const tiers = 1 + Math.floor(b.D.u("tiers", i) * (u < 0.5 ? 2 : 4)), x = x0 + 2.6 * (c + 0.5), z = z0 + 6.8 * (r + 0.5);
    for (let t = 0; t < tiers; t += 1) addBox(b, t === 0 ? 2 : 1, x, 1.3 + 2.6 * t, z, 1.22, 1.3, 3.05, pick(b.D, "box", PAINT, i * 8 + t) ?? "corrugated");
    solid(b, { x, z, hw: 1.22, hd: 3.05, y1: 2.6 * tiers, slot: "corrugated" });
    stacks += 1;
  }
  // (The cranes: legs outside the stacks, beams across the yard, a trolley and its hoist.)
  const n = rows > 1 ? 1 + count(b.D, "cranes", [0, 1]) : 0, H = within(b.D, "craneH", [17, 23]), span = s.hw - 1;
  for (let k = 0; k < n; k += 1) {
    const z = z0 + (z1 - z0) * (n === 1 ? 0.5 : k ? 0.72 : 0.28);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { addBox(b, 1, s.x + sx * span, H / 2, z + sz * 3.4, 0.4, H / 2, 0.4, "buffBrick"); solid(b, { x: s.x + sx * span, z: z + sz * 3.4, hw: 0.4, hd: 0.4, y1: H, slot: "buffBrick" }); }
    for (const sz of [-1, 1]) addBox(b, 1, s.x, H, z + sz * 3.4, span + 0.4, 0.6, 0.45, "buffBrick");
    for (const sx of [-1, 1]) addBox(b, 1, s.x + sx * span, H, z, 0.45, 0.6, 3.4, "buffBrick");
    const tx = s.x + b.D.flat("trolley", k) * (span - 3);
    addBox(b, 1, tx, H - 1, z, 1.6, 0.7, 3.2, "metal");
    addBox(b, 0, tx, H * 0.6, z, 0.05, H * 0.35, 0.05, "metal");
    if (!b.derelict) addBox(b, 0, tx, H + 0.9, z, 0.3, 0.3, 0.3, "beacon");
  }
  for (let k = 0; k < count(b.D, "trucks", [0, 2]); k += 1) {
    const x = s.x - s.hw + 8.5 + k * 16.5;
    if (x + 8 < s.x + s.hw) vehicle(b, "truck", x, s.z + s.hd - 3.4, Math.PI / 2, 1200 + k);
  }
  if (!b.derelict) for (const sx of [-1, 1]) mast(b, s.x + sx * (s.hw - 0.5), s.z + s.hd - 6, 14);
};

/** A substation: a fence round gravel, transformers, the gantries the lines come in to, a control hut. */
const substation: Op<"substation"> = (b) => {
  const s = b.site, hx = s.x + (b.D.u("hut") < 0.5 ? -1 : 1) * (s.hw - 3.5), hz = s.z + s.hd - 3.4;
  addMass(b, { x: hx, z: hz, hw: 2.8, hd: 2.2, y0: 0, y1: 3.4, slot: b.wall });
  addBox(b, 1, s.x, 0.04, s.z, s.hw, 0.04, s.hd, "gravel");
  const fh = 2.4;
  for (const [x, z, hw, hd] of [[s.x, s.z - s.hd + 0.05, s.hw, 0.05], [s.x, s.z + s.hd - 0.05, s.hw, 0.05], [s.x - s.hw + 0.05, s.z, 0.05, s.hd], [s.x + s.hw - 0.05, s.z, 0.05, s.hd]] as const) {
    solid(b, { x, z, hw, hd, y1: fh });
    addBox(b, 1, x, fh / 2, z, hw, fh / 2, hd, "metal");
  }
  // (The transformers: tanks with their cooling fins and bushings.)
  const n = clamp(Math.floor((2 * s.hw - 4) / 5), 1, 4) - count(b.D, "fewer", [0, 1]), tz = s.z + (s.hd > 12 ? 1 : 0);
  for (let k = 0; k < Math.max(1, n); k += 1) {
    const x = s.x - s.hw + 2.5 + (2 * s.hw - 5) * (k + 0.5) / Math.max(1, n);
    solid(b, { x, z: tz, hw: 1.4, hd: 1.8, y1: 2.6, slot: "concreteDark" });
    addBox(b, 2, x, 1.3, tz, 1.4, 1.3, 1.8, "concreteDark");
    for (const sx of [-1, 1]) addBox(b, 0, x + sx * 1.55, 1.2, tz, 0.15, 1, 1.4, "metal");
    for (let j = -1; j <= 1; j += 1) addCapsule(b, 0, [x + j * 0.8, 2.6, tz], [x + j * 0.8, 3.6, tz], 0.14, "trim");
  }
  // The gantries: steel frames at the back, insulators hanging where the lines tie on (the anchors).
  const gs = Math.min(s.hw - 1.5, 9), H = 11;
  for (const [g, gz] of [[0, s.z - s.hd + 2.5], [1, s.z - s.hd * 0.25]] as const) {
    if (g === 1 && gz - (s.z - s.hd + 2.5) < 5) continue;
    for (const sx of [-1, 1]) { addBox(b, 1, s.x + sx * gs, H / 2, gz, 0.3, H / 2, 0.3, "metal"); solid(b, { x: s.x + sx * gs, z: gz, hw: 0.3, hd: 0.3, y1: H }); }
    addBox(b, 1, s.x, H, gz, gs + 0.3, 0.3, 0.3, "metal");
    for (let j = -1; j <= 1; j += 1) {
      const x = s.x + (j * gs) / 2;
      addCapsule(b, 0, [x, H - 1.4, gz], [x, H - 0.3, gz], 0.16, "trim");
      if (g === 0) { const [wx, wy, wz] = toWorld(b, x, H - 1.4, gz); b.anchors.push({ kind: "substation", x: wx, y: wy, z: wz }); }
    }
  }
  if (!b.derelict) mast(b, hx, hz - 3.4, 7);
};

/** A water tower: legs, a riser, a round tank with a catwalk, a light on top. */
const waterTower: Op<"waterTower"> = (b) => {
  const s = b.site, H = within(b.D, "towerH", [22, 32]), R = Math.min(within(b.D, "tankR", [4.5, 6.5]), s.hw - 0.5, s.hd - 0.5), leg = Math.min(R * 0.7, 4);
  addBox(b, 2, s.x, 0.04, s.z, s.hw, 0.04, s.hd, "grass");
  const slot = pick(b.D, "tank", { concreteLight: 2, trim: 2, glassBlue: 1, siding: 1 }) ?? "trim";
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    solid(b, { x: s.x + sx * leg, z: s.z + sz * leg, hw: 0.3, hd: 0.3, y1: H, slot: "metal" });
    addBox(b, 2, s.x + sx * leg, H / 2, s.z + sz * leg, 0.25, H / 2, 0.25, "metal");
  }
  for (const y of [H * 0.35, H * 0.7]) { for (const sz of [-1, 1]) addBox(b, 0, s.x, y, s.z + sz * leg, leg, 0.08, 0.08, "metal"); for (const sx of [-1, 1]) addBox(b, 0, s.x + sx * leg, y, s.z, 0.08, 0.08, leg, "metal"); }
  addCapsule(b, 1, [s.x, 0, s.z], [s.x, H, s.z], 0.7, slot);
  addCapsule(b, 2, [s.x, H + R * 0.55, s.z], [s.x, H + R * 0.75, s.z], R, slot);
  for (const sz of [-1, 1]) addBox(b, 0, s.x, H + 0.3, s.z + sz * (R + 0.4), R + 0.4, 0.06, 0.06, "metal");
  for (const sx of [-1, 1]) addBox(b, 0, s.x + sx * (R + 0.4), H + 0.3, s.z, 0.06, 0.06, R + 0.4, "metal");
  if (!b.derelict) { addBox(b, 1, s.x, H + R * 0.75 + R + 0.4, s.z, 0.3, 0.3, 0.3, "beacon"); addBox(b, 1, s.x, H + R * 0.65, s.z + R + 0.05, R * 0.55, 0.6, 0.05, b.neon); }
};

/** A tank farm (round tanks in a bund, pipes between) or a gasholder (one great drum in its guide frame). */
const tanks: Op<"tanks"> = (b, op) => {
  const s = b.site;
  if (op.kind === "gasometer") {
    const R = clamp(Math.min(s.hw, s.hd) - 2, 5, 18), H = clamp(R * 1.8, 16, 40);
    const slot = pick(b.D, "holder", { metal: 2, concreteDark: 1, glassGreen: 1 }) ?? "metal";
    solid(b, { x: s.x, z: s.z, hw: R * 0.9, hd: R * 0.9, y1: H, slot });
    addCapsule(b, 2, [s.x, R * 0.35, s.z], [s.x, H * within(b.D, "full", [0.55, 1]) - R * 0.4, s.z], R * 0.92, slot);
    const rr = R + 0.4;
    for (const [ux, uz] of OCT) addBox(b, 1, s.x + ux * rr, (H + 2) / 2, s.z + uz * rr, 0.3, (H + 2) / 2, 0.3, "metal");
    for (const y of [H * 0.35, H * 0.7, H + 1.6]) for (let k = 0; k < 8; k += 1) {
      const [ax, az] = OCT[k]!, [bx, bz] = OCT[(k + 1) % 8]!;
      addCapsule(b, 1, [s.x + ax * rr, y, s.z + az * rr], [s.x + bx * rr, y, s.z + bz * rr], 0.18, "metal");
    }
    return;
  }
  const R = clamp(Math.min(s.hw, s.hd) * 0.28, 3, 7), cols = Math.max(1, Math.floor((2 * s.hw - 2) / (2 * R + 3))), rows = Math.max(1, Math.floor((2 * s.hd - 2) / (2 * R + 3)));
  const pw = (2 * s.hw) / cols, ph = (2 * s.hd) / rows;
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const i = r * 16 + c, x = s.x - s.hw + pw * (c + 0.5), z = s.z - s.hd + ph * (r + 0.5), h = within(b.D, "tankH", [R * 1.2, R * 2.6], i);
    const slot = pick(b.D, "tankSlot", { trim: 3, concreteLight: 2, metal: 2 }, i) ?? "trim";
    solid(b, { x, z, hw: R * 0.85, hd: R * 0.85, y1: h, slot });
    addCapsule(b, 2, [x, R * 0.35, z], [x, h - R * 0.6, z], R, slot);
    if (c + 1 < cols) addBox(b, 0, x + pw / 2, 1.4, z, pw / 2 - R, 0.15, 0.15, "metal");
  }
  for (const [x, z, hw, hd] of [[s.x, s.z - s.hd + 0.2, s.hw, 0.2], [s.x, s.z + s.hd - 0.2, s.hw, 0.2], [s.x - s.hw + 0.2, s.z, 0.2, s.hd], [s.x + s.hw - 0.2, s.z, 0.2, s.hd]] as const) addBox(b, 1, x, 0.5, z, hw, 0.5, hd, "concreteDark");
};

/** Smokestacks off the back of the building's roof, banded, a light on each. */
const stacks: Op<"stacks"> = (b, op) => {
  const m = b.masses[0];
  if (!m) return;
  const n = count(b.D, "stacks", op.count);
  for (let k = 0; k < n; k += 1) {
    const x = m.x + clamp((k - (n - 1) / 2) * 4.5, -(m.hw - 2), m.hw - 2), z = m.z - m.hd + 2.5, r = within(b.D, "stackR", [0.9, 1.6], k);
    const top = m.y1 + within(b.D, "stackH", [14, 34], k), slot = pick(b.D, "stackSlot", { redBrick: 3, concreteLight: 2, concreteDark: 1 }, k) ?? "redBrick";
    addCapsule(b, 2, [x, m.y1, z], [x, top, z], r, slot);
    for (const y of [top - 2, top - 5]) addCapsule(b, 1, [x, y - 0.4, z], [x, y + 0.4, z], r * 1.1, slot === "redBrick" ? "trim" : "redBrick");
    if (!b.derelict) addBox(b, 1, x, top + r + 0.3, z, 0.3, 0.3, 0.3, "beacon");
  }
};

export const CIVIC_OPS = { campus, hall, stadium, cemetery, station, containers, substation, waterTower, tanks, stacks };
