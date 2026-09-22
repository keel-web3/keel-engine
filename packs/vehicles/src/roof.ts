// Convertible hardware, in the same boxes, sheets, tubes and finish slots as the car. Pieces stay rigid as their
// hinges move: hard roof panels nest in the rear well; fabric folds over several articulated bows.
import { meshMatrix } from "@keel-engine/bake";
import type { BakeWorld } from "@keel-engine/bake";
import type { Car, Colour } from "./car.ts";
import { drawsOf, clamp } from "./draws.ts";
import { BODY_SLOT as P } from "./slots.ts";
import { solids, box, cap, both, sheet } from "./solids.ts";

export interface ConvertibleSpec {
  readonly kind: "hard" | "soft";
  readonly finish: "body" | "contrast";
  readonly colour: Colour;
  readonly panels: number;
  readonly seconds: number;
  readonly halfWidth: number;
  readonly front: number;
  readonly rear: number;
  readonly top: number;
  readonly stow: number;
}
export interface RoofPiece {
  readonly id: string;
  readonly world: BakeWorld;
  readonly matrix: Float32Array;
  readonly pane?: "left" | "right" | "rear";
}
const specs = new WeakMap<Car, ConvertibleSpec | null>();
export function convertibleOf(car: Car): ConvertibleSpec | null {
  if (specs.has(car)) return specs.get(car)!;
  if (!car.parts.open || car.archetype === "buggy") { specs.set(car, null); return null; }
  const D = drawsOf(car.seed), g = car.body;
  const kind = D.u("convertible.kind") < (car.archetype === "hyper" ? 0.8 : car.archetype === "kei" ? 0.3 : 0.5) ? "hard" : "soft";
  const finish = D.u("convertible.finish") < (kind === "hard" ? 0.65 : 0.3) ? "body" : "contrast";
  const body = car.paints.body;
  // A contrast roof takes its hue from the car and separates by lightness: dark cloth on a pale car, warm/pale
  // cloth on a dark one. No unrelated random colour, and a painted hard roof can match the body exactly.
  const colour: Colour = finish === "body" ? { ...body } : { hue: body.hue, chroma: Math.min(0.035, body.chroma * 0.25), light: body.light > 0.52 ? 0.2 : 0.76 };
  const h = Math.min(0.32, g.roof - g.belt);
  const spec: ConvertibleSpec = { kind, finish, colour, panels: kind === "hard" ? (D.u("convertible.panels") < 0.7 ? 2 : 3) : (D.u("convertible.bows") < 0.5 ? 4 : 5), seconds: kind === "hard" ? 5.5 : 4.5,
    halfWidth: g.cabWidth / 2, front: g.cabFront - h * 0.9, rear: g.cabRear + 0.11, top: g.belt + h + 0.018, stow: g.belt + 0.075 };
  specs.set(car, spec); return spec;
}
const ease = (a: number, b: number, p: number): number => { const x = clamp((p - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };
const worlds = new WeakMap<Car, Map<string, BakeWorld>>();
function worldOf(car: Car, id: string, build: () => BakeWorld): BakeWorld {
  let map = worlds.get(car); if (!map) { map = new Map(); worlds.set(car, map); }
  let w = map.get(id); if (!w) { w = build(); map.set(id, w); } return w;
}

/** 0 closed, 1 stowed. Geometry is cached; only small hinge transforms change each frame. */
export function convertiblePose(car: Car, open: number): readonly RoofPiece[] {
  const r = convertibleOf(car); if (!r) return [];
  const p = clamp(open, 0, 1), out: RoofPiece[] = [], n = r.panels, len = (r.front - r.rear) / n;
  // Unlatch and lift the leading panels UP first; only then rotate the folded stack behind the seats.
  // A positive local fold sends the leading hard panel down through the cabin.
  const root = -Math.PI * ease(0.38, 0.84, p), fold = -Math.PI * ease(0.12, 0.4, p), sink = ease(0.84, 1, p);
  let y = r.top + Math.sin(Math.PI * ease(0, 0.85, p)) * 0.13 - (r.top - r.stow) * sink, z = r.rear - sink * 0.08;
  const rootY = y, rootZ = z;
  for (let i = 0; i < n; i++) {
    const angle = root + (i % 2 ? fold : 0), id = `panel:${i}`;
    const half = r.halfWidth * (0.96 + 0.04 * (i + 1) / n);
    const world = worldOf(car, id, () => {
      const S = solids(), thick = r.kind === "hard" ? 0.037 : 0.016;
      box(S, P.roof, -half, -thick, 0, half, 0.006, len);
      // A slight crown, seams, side seals and a bow/hinge beneath each panel.
      box(S, P.roof, -half * 0.86, 0.006, 0.012, half * 0.86, r.kind === "hard" ? 0.025 : 0.016, len - 0.012);
      both(s => cap(S, P.trim, [s * half, -0.02, 0], [s * half, -0.02, len], 0.014));
      cap(S, r.kind === "soft" ? P.trim : P.metal, [-half, -0.025, 0.012], [half, -0.025, 0.012], r.kind === "soft" ? 0.017 : 0.012);
      both(s => cap(S, P.metal, [s * half * 0.92, -0.026, 0], [s * half * 0.92, -0.026, 0.04], 0.022));
      return S;
    });
    out.push({ id, world, matrix: meshMatrix({ y: y + i * 0.014 * ease(0.7, 1, p), z, pitch: angle }) });
    y -= Math.sin(angle) * len; z += Math.cos(angle) * len;
  }
  // The small rear window and its surround move with the rear bow. At full stow it lies in the rear well.
  const rear = worldOf(car, "rear", () => {
    const S = solids(), height = r.top - car.body.belt, run = Math.min(0.22, height * 0.7);
    sheet(S, P.glass, r.halfWidth * 0.72, -run, 0, z => -height + height * (z + run) / run);
    return S;
  });
  const rearHeight = r.top - car.body.belt, rearRun = Math.min(0.22, rearHeight * 0.7);
  // This hinge goes the OTHER way: lift the rear glass outward over the deck. Its angle is independent of
  // the main stack, so the last fold never swings the window and its frame forward across the headrests.
  const rearPitch = (Math.PI / 2 - Math.atan2(rearRun, rearHeight)) * ease(0.02, 0.3, p);
  out.push({ id: "rear", pane: "rear", world: rear, matrix: meshMatrix({ y: rootY, z: rootZ, pitch: rearPitch }) });
  const surround = worldOf(car, "rear-frame", () => {
    const S = solids(), h = r.top - car.body.belt, run = Math.min(0.22, h * 0.7);
    both(s => cap(S, P.roof, [s * r.halfWidth * 0.75, -h, -run], [s * r.halfWidth * 0.96, 0, 0], 0.035));
    cap(S, P.trim, [-r.halfWidth * 0.75, -h, -run], [r.halfWidth * 0.75, -h, -run], 0.018);
    return S;
  });
  out.push({ id: "rear-frame", world: surround, matrix: meshMatrix({ y: rootY, z: rootZ, pitch: rearPitch }) });
  // Paired lifting links remain attached to the rear deck throughout the motion.
  const link = worldOf(car, "link", () => { const S = solids(); cap(S, P.metal, [0, 0, 0], [0, 0, 1], 0.012); return S; });
  for (const side of [-1, 1]) {
    const baseY = car.body.belt + 0.01, baseZ = r.rear - 0.1;
    const jointY = (baseY + rootY) / 2 + 0.05, jointZ = (baseZ + rootZ) / 2 - 0.12 * Math.sin(p * Math.PI);
    const ends = [[baseY, baseZ, jointY, jointZ], [jointY, jointZ, rootY - 0.025, rootZ]] as const;
    ends.forEach(([ay, az, by, bz], i) => {
      const dy = by - ay, dz = bz - az, len = Math.max(0.01, Math.hypot(dy, dz));
      const matrix = meshMatrix({ x: side * r.halfWidth * 0.93, y: ay, z: az, pitch: -Math.atan2(dy, dz) });
      for (let k = 8; k < 11; k++) matrix[k] = matrix[k]! * len;
      out.push({ id: `link:${side}:${i}`, world: link, matrix });
    });
  }
  // Side windows lower before the roof folds and rise after it latches. Do not draw glass beneath the belt line.
  const windowH = (r.top - car.body.belt - 0.025) * (1 - ease(0, 0.2, p));
  if (windowH > 0.003) for (const side of [-1, 1]) {
    const id = side < 0 ? "left" : "right";
    const world = worldOf(car, id, () => {
      const S = solids(); box(S, P.glass, side * r.halfWidth - 0.008, 0, r.rear, side * r.halfWidth + 0.008, 1, r.front); return S;
    });
    const matrix = meshMatrix({ y: car.body.belt + 0.01 }); matrix[5] = windowH;
    out.push({ id, pane: id, world, matrix });
  }
  return out;
}
