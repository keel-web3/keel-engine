// Mechanical assemblies use the body's own solids, seeded draws and finish slots. The design's component names
// survive meshing so damage releases these exact assemblies, including their pipes, brackets and fasteners.
import type { Car, Colour } from "./car.ts";
import { clamp, drawsOf, snap } from "./draws.ts";
import { BODY_SLOT as P } from "./slots.ts";
import { both, box, cap, component, solids } from "./solids.ts";
import type { Solids, V3 } from "./solids.ts";

export interface MechanicalUpgrades { readonly engine?: number; readonly turbo?: number; readonly transmission?: number }
export interface MechanicalSpec {
  readonly cylinders: 4 | 6 | 8;
  readonly configuration: "I4" | "I6" | "V6" | "V8";
  readonly location: "front" | "rear";
  readonly transverse: boolean;
  readonly engineLevel: number;
  readonly turboLevel: number;
  readonly transmissionLevel: number;
  readonly cover: "engine";
  readonly finish: "body" | "contrast";
  readonly colour: Colour;
  readonly bay: "closed" | "open" | "stacks";
  readonly engine: { readonly x: number; readonly y: number; readonly z: number; readonly width: number; readonly height: number; readonly length: number };
  readonly radiatorZ: number;
  readonly pipeY: number;
}
export const MECHANICAL_PARTS = ["engineBlock", "radiator", "transmission", "exhaust", "frontShield"] as const;
export type MechanicalPart = (typeof MECHANICAL_PARTS)[number];
export interface ExhaustEnd { readonly x: number; readonly y: number; readonly z: number; readonly dx: number; readonly dy: number; readonly dz: number; readonly r: number }
const mechanicalSpecs = new WeakMap<Car, MechanicalSpec>();

export function mechanicsOf(car: Car): MechanicalSpec {
  const cached = mechanicalSpecs.get(car); if (cached) return cached;
  const D = drawsOf(car.seed), g = car.body, a = car.archetype;
  const cylinders: 4 | 6 | 8 = car.parts.semi ? 6 : a === "muscle" || a === "hyper" || a === "proto" ? 8
    : a === "kei" || a === "rally" || a === "buggy" ? 4 : D.pick("mechanical.cylinders", [[6, 3], [8, 2]]);
  const configuration = cylinders === 4 ? "I4" : cylinders === 8 ? "V8" : car.parts.semi || D.u("mechanical.six") < 0.45 ? "I6" : "V6";
  const rear = a === "hyper" || a === "proto" || a === "buggy";
  const transverse = !rear && cylinders === 4;
  const level = (n = 0) => Number.isFinite(n) ? clamp(Math.floor(n), 0, 3) : 0;
  const engineLevel = level(car.mechanical?.engine), turboLevel = level(car.mechanical?.turbo), transmissionLevel = level(car.mechanical?.transmission);
  const lo = rear ? -g.length / 2 + 0.22 : g.cabFront + 0.06;
  const hi = rear ? g.cabRear - 0.06 : g.length / 2 - 0.32;
  const room = Math.max(0.18, hi - lo), z = (hi + lo) / 2;
  const inner = Math.max(0.22, Math.min(g.width * (a === "buggy" ? 0.25 : 0.36), g.track[0] - car.wheels[0].width / 2 - 0.06));
  const length = Math.min(room * 0.76, (configuration === "I6" ? 0.98 : transverse ? 0.4 : 0.68) * (car.parts.semi ? 1.5 : 1));
  const width = Math.min(inner * 1.55, transverse ? 0.78 : cylinders === 4 || configuration === "I6" ? 0.42 : 0.68);
  const roof = rear ? g.ride + (g.belt - g.ride) * (g.tailLo + (1 - g.tailLo) * (z + g.length / 2) / Math.max(0.1, g.cabRear + g.length / 2))
    : g.ride + (g.belt - g.ride) * (g.noseLo + (1 - g.noseLo) * (g.length / 2 - z) / Math.max(0.1, g.length / 2 - g.cabFront));
  const height = Math.max(0.1, Math.min(car.parts.semi ? 0.85 : 0.44, (roof - g.ride - 0.065) * 0.76));
  const finish = D.u("mechanical.finish") < .5 ? "body" : "contrast", body = car.paints.body;
  const colour: Colour = finish === "body" ? { ...body } : { hue: car.paints.accent.hue, chroma: Math.min(.17, Math.max(.04, car.paints.accent.chroma)), light: body.light > .52 ? .29 : .78 };
  const trait = car.traits.find(t => t.category === "Engine Bay")?.name;
  const spec: MechanicalSpec = { cylinders, configuration, location: rear ? "rear" : "front", transverse, engineLevel, turboLevel, transmissionLevel,
    cover: "engine", finish, colour, bay: car.parts.semi ? "closed" : trait === "Velocity Stacks" ? "stacks" : trait === "Open Engine Bay" ? "open" : "closed",
    engine: { x: 0, y: g.ride + height / 2 + 0.012, z, width: snap(width, 0.005), height, length },
    radiatorZ: g.length / 2 - 0.18, pipeY: Math.max(0.09, g.ride - 0.035) };
  mechanicalSpecs.set(car, spec); return spec;
}

export function mechanicalSolids(car: Car, tips: readonly ExhaustEnd[]): Solids {
  const S = solids(), m = mechanicsOf(car), e = m.engine, g = car.body;
  const hw = g.width / 2, y0 = e.y - e.height / 2, y1 = e.y + e.height / 2;
  const x0 = -e.width / 2, x1 = e.width / 2, z0 = e.z - e.length / 2, z1 = e.z + e.length / 2;
  const pipeR = Math.min(0.048, Math.max(0.023, car.parts.pipe * 0.65)) + m.turboLevel * 0.003;
  const tube = (points: readonly V3[], radius: number, mat: number = P.metal): void => {
    for (let i = 1; i < points.length; i++) cap(S, mat, points[i - 1]!, points[i]!, radius);
  };
  component(S, "engineBlock", () => {
    box(S, P.dark, x0 * 0.85, y0 - 0.02, z0, x1 * 0.85, y0 + e.height * 0.28, z1); // sump
    box(S, P.metal, x0, y0 + e.height * 0.2, z0, x1, y1 - e.height * 0.24, z1);
    const banks = m.configuration.startsWith("V") ? 2 : 1, count = m.cylinders / banks;
    for (let bank = 0; bank < banks; bank++) {
      const bx = banks === 2 ? (bank ? 1 : -1) * e.width * 0.32 : 0;
      const cover = P[m.cover];
      if (m.transverse) box(S, cover, x0, y1 - 0.05, e.z - e.length * 0.24, x1, y1, e.z + e.length * 0.24);
      else box(S, cover, bx - e.width / (banks * 2.6), y1 - 0.05, z0, bx + e.width / (banks * 2.6), y1, z1);
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count, x = m.transverse ? x0 + e.width * t : bx, z = m.transverse ? e.z : z0 + e.length * t;
        cap(S, P.dark, [x, y1, z], [x, y1 + 0.018, z], 0.018); // a coil / plug per cylinder
        tube([[x, y1 - 0.06, z], [x + (bank ? 1 : -1) * 0.07, y1 - 0.09, z]], 0.013, P.metal);
      }
    }
    // Intake plenum, ribbed upgrade cover, front pulley, mount feet on the chassis rails.
    box(S, P.trim, -e.width * 0.18, y1 - 0.04, z0 + e.length * 0.1, e.width * 0.18, y1 + 0.025, z1 - e.length * 0.1);
    for (let i = 0; i < 2 + m.engineLevel; i++) {
      const z = z0 + e.length * (i + 1) / (3 + m.engineLevel);
      box(S, P.metal, -e.width * 0.16, y1 + 0.025, z - 0.009, e.width * 0.16, y1 + 0.035, z + 0.009);
    }
    component(S, "engineBlock:pulley", () => {
      const r = e.height * .27, z = z1 + .035;
      cap(S, P.dark, [0, e.y, z1], [0, e.y, z], r);
      // Contrasting spokes make rotation legible at the game's pixel scale.
      box(S, P.metal, -r * .85, e.y - .014, z, r * .85, e.y + .014, z + .01);
      box(S, P.metal, -.014, e.y - r * .85, z, .014, e.y + r * .85, z + .01);
    });
    if (m.bay === "stacks") for (let i = 0; i < m.cylinders; i++) {
      const v = m.configuration.startsWith("V"), bank = v ? i % 2 : 0, t = (Math.floor(i / (v ? 2 : 1)) + .5) / (m.cylinders / (v ? 2 : 1));
      const x = m.transverse ? x0 + e.width * t : v ? (bank ? 1 : -1) * e.width * .28 : 0;
      const z = m.transverse ? e.z : z0 + e.length * t, top = Math.max(y1 + .13, g.belt + .07);
      cap(S, P.engine, [x, y1, z], [x, top - .025, z], .033);
      box(S, P.metal, x - .047, top - .035, z - .047, x + .047, top, z + .047);
      box(S, P.dark, x - .032, top, z - .032, x + .032, top + .003, z + .032);
    }
    both(s => box(S, P.dark, s * e.width * 0.36, y0, e.z - 0.06, s * hw * 0.58, y0 + 0.045, e.z + 0.06));
    if (m.turboLevel > 0) component(S, "engineBlock:turbo", () => {
      // The snail on the exhaust side of the head: its housing, the compressor's inlet, a heat shield over the hot side
      // and a wastegate can, charge pipe round to the plenum.
      const x = x1 + 0.045, r = 0.055 + m.turboLevel * 0.012;
      cap(S, P.metal, [x, e.y, z0], [x, e.y, z0 + 0.085], r);
      cap(S, P.dark, [x, e.y, z0 + 0.085], [x, e.y, z0 + 0.1], r * 0.62);
      box(S, P.trim, x - r * 0.9, e.y + r * 0.7, z0 - 0.01, x + r * 0.9, e.y + r * 0.7 + 0.012, z0 + 0.075);
      cap(S, P.accent, [x + r * 0.7, e.y - r * 0.4, z0 + 0.02], [x + r * 0.7, e.y - r * 0.4 + 0.045, z0 + 0.02], 0.018);
      tube([[x, e.y, z0 + 0.085], [x, y1 - 0.025, e.z], [0, y1 - 0.025, e.z]], 0.03, P.accent);
    });
    if (m.bay !== "stacks") component(S, "engineBlock:intake", () => {
      // The air box on the cool side, its lid clipped on, and the intake hose over to the plenum.
      const aw = 0.13, al = Math.min(0.24, e.length * 0.5), ah = Math.min(0.1, e.height * 0.55);
      const ax = -(e.width / 2 + 0.03 + aw / 2), az = e.z + e.length * 0.18, ay = y1 - ah / 2 - 0.02;
      if (Math.abs(ax) + aw / 2 > hw * 0.74) return;
      box(S, P.dark, ax - aw / 2, ay - ah / 2, az - al / 2, ax + aw / 2, ay + ah / 2 - 0.018, az + al / 2);
      box(S, m.turboLevel > 1 ? P.accent : P.trim, ax - aw / 2 - 0.004, ay + ah / 2 - 0.018, az - al / 2 - 0.004, ax + aw / 2 + 0.004, ay + ah / 2, az + al / 2 + 0.004);
      for (const z of [az - al * 0.3, az + al * 0.3]) box(S, P.metal, ax - aw / 2 - 0.008, ay, z - 0.008, ax - aw / 2, ay + ah / 2 - 0.02, z + 0.008);
      tube([[ax, ay + 0.01, az - al / 2], [ax * 0.55, y1 - 0.01, e.z - e.length * 0.05], [-e.width * 0.18, y1 - 0.01, e.z]], 0.026, P.dark);
    });
  });
  component(S, "transmission", () => {
    const rear = m.location === "rear", z = rear ? z1 + 0.05 : z0 - 0.05, end = z + (rear ? 1 : -1) * Math.min(0.46, g.wheelbase * 0.22);
    const ty = Math.max(g.ride + 0.07, e.y - e.height * 0.2);
    cap(S, P.metal, [0, ty, z], [0, ty, end], Math.min(0.13, e.height * 0.38));
    for (let i = 0; i < 3 + m.transmissionLevel; i++) {
      const at = z + (end - z) * (i + 0.5) / (3 + m.transmissionLevel);
      box(S, m.transmissionLevel > 0 ? P.accent : P.trim, -0.105, ty - 0.06, at - 0.012, 0.105, ty + 0.06, at + 0.012);
    }
    if (!m.transverse && !rear) {
      tube([[0, ty, end], [0, m.pipeY + 0.04, g.rearAxle]], 0.028, P.dark);
      cap(S, P.dark, [-0.11, m.pipeY + 0.06, g.rearAxle], [0.11, m.pipeY + 0.06, g.rearAxle], 0.09);
    }
    const axle = m.transverse ? g.frontAxle : g.rearAxle;
    cap(S, P.metal, [-hw * 0.8, m.pipeY + 0.06, axle], [hw * 0.8, m.pipeY + 0.06, axle], 0.025);
  });
  component(S, "radiator", () => {
    const rz = m.radiatorZ, ry0 = g.ride + 0.05, ry1 = Math.max(ry0 + 0.08, g.ride + (g.belt - g.ride) * g.noseLo - 0.05), rw = hw * 0.55;
    box(S, P.grille, -rw, ry0, rz - 0.04 - m.turboLevel * 0.014, rw, ry1, rz + 0.035);
    both(s => box(S, P.metal, s * rw, ry0, rz - 0.05, s * (rw + 0.045), ry1, rz + 0.035));
    for (let i = 1; i <= 6; i++) {
      const y = ry0 + (ry1 - ry0) * i / 7;
      box(S, P.metal, -rw, y, rz + 0.036, rw, y + 0.009, rz + 0.042);
    }
    component(S, "radiator:fan", () => {
      const y = (ry0 + ry1) / 2, r = Math.min(.16, (ry1 - ry0) * .4);
      cap(S, P.dark, [0, y, rz - .055], [0, y, rz - .08], r);
      box(S, P.metal, -r, y - .019, rz - .092, r, y + .019, rz - .082);
      box(S, P.metal, -.019, y - r, rz - .092, .019, y + r, rz - .082);
    });
    tube([[rw, ry1 - 0.02, rz], [rw, g.ride + 0.12, e.z], [x1, e.y, e.z]], 0.024, P.dark);
    cap(S, P.metal, [rw, ry1, rz], [rw, ry1 + 0.02, rz], 0.024);
    // Boosted: an intercooler's core ahead of the radiator, and its charge pipe back to the turbo's outlet.
    if (m.turboLevel > 0) component(S, "radiator:intercooler", () => {
      const iw = rw * 0.92, iy1 = ry0 + (ry1 - ry0) * (0.5 + m.turboLevel * 0.1);
      box(S, P.metal, -iw, ry0 + 0.01, rz + 0.045, iw, iy1, rz + 0.072);
      for (let i = 1; i <= 4; i++) { const y = ry0 + (iy1 - ry0) * i / 5; box(S, P.dark, -iw, y, rz + 0.072, iw, y + 0.007, rz + 0.076); }
      both(s => box(S, P.trim, s * iw, ry0 + 0.01, rz + 0.04, s * (iw + 0.03), iy1, rz + 0.076));
      tube([[iw + 0.02, (ry0 + iy1) / 2, rz + 0.058], [iw + 0.02, e.y, rz - 0.1], [x1 + 0.045, e.y + 0.05, z0 + 0.09]], 0.028, P.accent);
    });
  });
  component(S, "frontShield", () => {
    const z = g.length / 2 - 0.035, top = g.ride + (g.belt - g.ride) * g.noseLo;
    // What bolts to the front of the bay round the engine (or fills the frunk of a mid-engined car): the battery on
    // its tray, the coolant and brake fluid reservoirs, and a strut brace tying the towers together -- each under the
    // bonnet's line where it stands, or not fitted at all.
    const front = m.location === "front", zb = g.cabFront + 0.1, zf = m.radiatorZ - 0.13;
    const lid = (zz: number) => g.ride + (g.belt - g.ride) * (g.noseLo + (1 - g.noseLo) * (g.length / 2 - zz) / Math.max(0.1, g.length / 2 - g.cabFront)) - 0.05;
    const floor = g.ride + 0.05;
    component(S, "frontShield:battery", () => {
      const bw = 0.17, bl = 0.24, bz = Math.max(zb + bl / 2, Math.min(zf - bl / 2, front ? e.z + e.length * 0.28 : (zb + zf) / 2));
      const bx = front ? e.width / 2 + 0.04 + bw / 2 : hw * 0.36, bh = Math.min(0.17, lid(bz + bl / 2) - floor - 0.01);
      if (bh < 0.08 || bx + bw / 2 > hw * 0.74 || zf - zb < bl) return;
      box(S, P.dark, bx - bw / 2 - 0.012, floor - 0.012, bz - bl / 2 - 0.012, bx + bw / 2 + 0.012, floor, bz + bl / 2 + 0.012);
      box(S, P.dark, bx - bw / 2, floor, bz - bl / 2, bx + bw / 2, floor + bh - 0.012, bz + bl / 2);
      box(S, P.trim, bx - bw / 2, floor + bh - 0.012, bz - bl / 2, bx + bw / 2, floor + bh, bz + bl / 2);
      cap(S, P.light, [bx - bw * 0.28, floor + bh, bz + bl * 0.32], [bx - bw * 0.28, floor + bh + 0.018, bz + bl * 0.32], 0.014);
      cap(S, P.metal, [bx + bw * 0.28, floor + bh, bz + bl * 0.32], [bx + bw * 0.28, floor + bh + 0.018, bz + bl * 0.32], 0.014);
      box(S, P.metal, bx - bw / 2 - 0.006, floor + bh, bz - 0.012, bx + bw / 2 + 0.006, floor + bh + 0.008, bz + 0.012);
    });
    component(S, "frontShield:reservoir", () => {
      const rz = zb + 0.07, rx = -Math.min(hw * 0.52, Math.max(e.width / 2 + 0.1, hw * 0.4)), top = lid(rz) - 0.015;
      if (top - floor < 0.14) return;
      const tankTop = Math.min(top, floor + 0.2);
      cap(S, P.trim, [rx, floor + 0.05, rz], [rx, tankTop - 0.04, rz], 0.05);
      cap(S, P.accent, [rx, tankTop - 0.035, rz], [rx, tankTop - 0.02, rz], 0.024);
      const mx = rx * 0.55, mt = Math.min(top, floor + 0.17);
      cap(S, P.metal, [mx, mt - 0.07, rz - 0.03], [mx, mt - 0.07, rz + 0.07], 0.035);
      cap(S, P.trim, [mx, mt - 0.04, rz + 0.03], [mx, mt - 0.02, rz + 0.03], 0.022);
    });
    component(S, "frontShield:brace", () => {
      const bz = Math.min(zf - 0.05, Math.max(zb + 0.05, g.frontAxle)), by = lid(bz) - 0.022;
      if (front && by < e.y + e.height / 2 + 0.05) return;
      const tx = hw * 0.64;
      both(s => { box(S, P.dark, s * tx - 0.045, by - 0.05, bz - 0.045, s * tx + 0.045, by + 0.006, bz + 0.045); });
      cap(S, m.engineLevel > 1 ? P.accent : P.metal, [-tx, by, bz], [tx, by, bz], 0.017);
    });
    // Radiator support and bolted lower splash / skid shield behind the bumper.
    box(S, P.dark, -hw * 0.77, g.ride, z - 0.07, hw * 0.77, g.ride + 0.05, z + 0.015);
    both(s => box(S, P.metal, s * hw * 0.68, g.ride, z - 0.045, s * hw * 0.73, top, z));
    box(S, P.metal, -hw * 0.73, top - 0.04, z - 0.04, hw * 0.73, top, z);
    box(S, car.archetype === "rally" || car.archetype === "pickup" ? P.metal : P.dark, -hw * 0.62, g.ride - 0.025, z - 0.36, hw * 0.62, g.ride + 0.005, z);
    both(s => cap(S, P.metal, [s * hw * 0.54, g.ride - 0.028, z - 0.2], [s * hw * 0.54, g.ride - 0.038, z - 0.2], 0.018));
  });
  component(S, "exhaust", () => {
    for (const t of tips) {
      const side = Math.sign(t.x) || car.parts.exhaustSide || 1, lane = car.parts.exhaust === "center" ? 0 : side * Math.min(hw * 0.38, 0.32);
      const start: V3 = [side * e.width / 2, e.y, e.z];
      const elbow: V3 = [lane, m.pipeY, e.z];
      const tailZ = t.dy > 0 ? t.z : Math.max(-g.length / 2 + 0.38, g.rearAxle - car.wheels[1].radius - 0.12);
      const canZ = t.dy > 0 ? t.z : Math.min(e.z - 0.12, tailZ + 0.16);
      // A proper underfloor resonator, centred between the axles. Its flattened can clears the road while the
      // pipe enters/exits the end faces; clamps and hangers make its attachment to the floor legible.
      const midZ = m.location === "rear" ? (e.z + tailZ) / 2 : (g.frontAxle + g.rearAxle) / 2;
      const midHalf = Math.min(0.27, Math.max(0.1, Math.abs(e.z - tailZ) * 0.13));
      const canHalfW = pipeR * 2.1, canHalfH = Math.min(0.07, m.pipeY - 0.035);
      const midLane = car.parts.exhaust === "center" ? 0 : lane;
      // Continuous header -> downpipe -> underfloor run -> silencer -> outlet, with hangers to the floor.
      tube([start, [side * (e.width / 2 + 0.06), e.y - 0.07, e.z], elbow, [midLane, m.pipeY, midZ + midHalf], [midLane, m.pipeY, midZ - midHalf], [lane, m.pipeY, canZ]], pipeR);
      box(S, P.metal, midLane - canHalfW, m.pipeY - canHalfH, midZ - midHalf, midLane + canHalfW, m.pipeY + canHalfH, midZ + midHalf);
      for (const z of [midZ - midHalf * 0.65, midZ + midHalf * 0.65]) {
        box(S, P.trim, midLane - canHalfW - 0.008, m.pipeY - canHalfH - 0.008, z - 0.014, midLane + canHalfW + 0.008, m.pipeY + canHalfH + 0.008, z + 0.014);
        cap(S, P.dark, [midLane + canHalfW, m.pipeY, z], [midLane + canHalfW + 0.035, g.ride + 0.045, z], 0.012);
      }
      const canR = Math.min(0.075, Math.max(0.048, pipeR * (1.8 - m.turboLevel * 0.1)));
      cap(S, P.metal, [lane, m.pipeY, canZ], [lane, m.pipeY, tailZ], canR);
      box(S, P.metal, lane - canR * 1.5, m.pipeY - Math.min(canR, m.pipeY - 0.03), Math.min(canZ, tailZ) - 0.045, lane + canR * 1.5, m.pipeY + canR, Math.max(canZ, tailZ) + 0.045);
      for (const z of [canZ, tailZ]) {
        box(S, P.trim, lane - canR - 0.01, m.pipeY - canR, z - 0.012, lane + canR + 0.01, m.pipeY + canR, z + 0.012);
        cap(S, P.dark, [lane, m.pipeY + canR, z], [lane + side * 0.06, g.ride + 0.04, z], 0.012);
      }
      const end: V3 = [t.x, t.y, t.z];
      tube([[lane, m.pipeY, tailZ], [t.x, m.pipeY, t.z + (t.dy > 0 ? 0 : 0.16)], end], pipeR);
      const outlets = car.parts.exhaust === "quad" ? [-1, 1] : [0];
      for (const n of outlets) {
        const x = t.x + n * t.r * 1.15;
        tube([end, [x, t.y, t.z], [x + t.dx * 0.08, t.y + t.dy * 0.08, t.z + t.dz * 0.08]], t.r * (n ? 0.86 : 1.2));
        const a: V3 = [x + t.dx * 0.11, t.y + t.dy * 0.11, t.z + t.dz * 0.11];
        cap(S, P.dark, a, [a[0] + t.dx * 0.003, a[1] + t.dy * 0.003, a[2] + t.dz * 0.003], t.r * 0.7);
      }
    }
  });
  // Frame rails remain when the detachable assemblies have gone.
  both(s => box(S, P.dark, s * hw * 0.55, g.ride, g.rearAxle, s * hw * 0.61, g.ride + 0.06, g.frontAxle));
  return S;
}

/** Bounds of the actual generated assembly, in car mesh coordinates. Shared by collision damage and the mesh. */
export function componentBounds(S: Solids): Record<string, readonly [number, number, number, number, number, number]> {
  const out: Record<string, [number, number, number, number, number, number]> = {};
  for (const [solid, componentName] of S.components ?? []) {
    const name = componentName.split(":")[0]!;
    const b = out[name] ??= [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    if ("c" in solid && "h" in solid) {
      const q = solid as { c: ArrayLike<number>; h: ArrayLike<number> };
      for (let i = 0; i < 3; i++) { b[i] = Math.min(b[i]!, q.c[i]! - q.h[i]!); b[i + 3] = Math.max(b[i + 3]!, q.c[i]! + q.h[i]!); }
    } else {
      const q = solid as { a: ArrayLike<number>; b: ArrayLike<number>; r: number };
      for (let i = 0; i < 3; i++) { b[i] = Math.min(b[i]!, q.a[i]! - q.r, q.b[i]! - q.r); b[i + 3] = Math.max(b[i + 3]!, q.a[i]! + q.r, q.b[i]! + q.r); }
    }
  }
  return out;
}
