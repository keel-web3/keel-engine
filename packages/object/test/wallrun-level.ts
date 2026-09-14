// WALLRUN's course, built from this package's catalogue: the proof of
// concept's projects/wallrun/level.js (and its seed.js stream), line for line,
// on the TypeScript objects -- so test/poc-equality.test.ts can build every
// course both ways and compare them box for box and rail point for rail point.
// (A game fixture, not an engine part: games/wallrun will own the real one.)

import type { Stream, Vec3 } from "@keel-engine/core";
import { buildPieceFrom } from "../src/catalogue.ts";
import type { PieceContexts, PieceKey } from "../src/catalogue.ts";
import { bakeForPhysics, bakeForRenderer, footprint, placeObject, settle, yawToShow } from "../src/object.ts";
import type { ObjectInstance, PhysicsBake, RendererCapsule } from "../src/object.ts";

// Seeded streams (exact integer steps: the same on every machine) -- WALLRUN's seed.js.
function hash(text: string): number { let h = 2166136261; for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; }
export function streamOf(text: string): Stream {
  let a = hash(String(text)) || 1;
  const f = (): number => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const weighted = <T>(l: ReadonlyArray<readonly [T, number]>): T => { let s = 0; for (const [, w] of l) s += w; let r = f() * s; for (const [v, w] of l) { if ((r -= w) < 0) return v; } return l[l.length - 1]![0]; };
  return { f, between: (x, y) => x + (y - x) * f(), int: (x, y) => x + Math.floor(f() * (y - x + 1)), pick: <T>(l: readonly T[]): T => l[Math.floor(f() * l.length)]!, chance: (p) => f() < p, weighted };
}

// Piece materials -> WALLRUN's materials (palette.js).
export const PIECE_MATS = { wall: 0, floor: 1, trim: 0, rail: 2, metal: 2, dark: 3, wood: 14, paint: 8, glow: 15 };
const SINK = 3; // (everything stands in the water this deep)

export type RouteAct = "run" | "jump" | "wall" | "rail";
export interface Level extends PhysicsBake {
  objects: ObjectInstance<object>[];
  capsules: RendererCapsule[];
  route: { p: Vec3; act: RouteAct }[];
  waterY: number;
  spawn: Vec3;
  end: number;
}

export function levelOf(seed: string): Level {
  const S = streamOf(`${seed}|level`);
  const P = streamOf(`${seed}|pieces`); // (the pieces' own draws; every size given here overrides them)
  const objects: ObjectInstance<object>[] = [];
  const route: Level["route"] = [];
  const top = 0.35; // (pads stand this far out of the water)
  const put = <K extends PieceKey>(key: K, ctx: PieceContexts[K], pos: Vec3, yaw = 0): ObjectInstance<object> => {
    const o = placeObject(buildPieceFrom(key, P, ctx), { pos, yaw, id: `${key}${objects.length}` }) as ObjectInstance<object>;
    objects.push(o);
    return o;
  };
  // (A floor: a pad from the bottom of the water to `y`.)
  const floor = (x0: number, x1: number, z0: number, z1: number, y = top): ObjectInstance<object> => put("pad", { w: x1 - x0, d: z1 - z0, h: y + SINK, lip: false }, [(x0 + x1) / 2, -SINK, (z0 + z1) / 2]);
  // (A wall along z at x: a wall piece turned a quarter, so its length runs down the course.)
  const wall = (x: number, z0: number, z1: number, h: number, thick = 0.5): ObjectInstance<object> => put("wall", { length: z1 - z0, h: h + SINK, thick }, [x, -SINK, (z0 + z1) / 2], Math.PI / 2);
  const pillar = (x: number, z: number, w: number, d: number, h: number): ObjectInstance<object> => put("pillar", { w, d, h: h + SINK }, [x, -SINK, z]);

  // 1. The start: a pad among tall maze walls.
  floor(-7, 7, -8, 12);
  for (let i = 0; i < 7; i += 1) {
    const side = i % 2 ? 1 : -1;
    pillar(side * S.between(8, 16), S.between(-10, 20), S.between(0.6, 3.5), S.between(3, 10), S.between(6, 13));
  }
  pillar(S.between(-3, 3), -9, S.between(4, 8), 0.6, S.between(6, 10));
  route.push({ p: [0, top, -4], act: "run" }, { p: [0, top, 10], act: "run" });
  let z = 12;

  // 2. The corridor: walls either side, water between -- run along one, kick across, run the other.
  const cw = S.between(2.6, 3.4);
  const clen = S.between(15, 21);
  const side = S.pick([-1, 1]);
  wall(-cw, z - 1, z + clen, S.between(8, 12));
  wall(cw, z - 1, z + clen + 1, S.between(8, 12));
  route.push(
    { p: [side * (cw - 0.7), top + 1.2, z + 2], act: "wall" }, { p: [side * (cw - 0.7), top + 1.2, z + clen * 0.45], act: "wall" },
    { p: [-side * (cw - 0.7), top + 1.2, z + clen * 0.62], act: "wall" }, { p: [-side * (cw - 0.7), top + 1, z + clen - 1], act: "wall" },
  );
  z += clen;
  floor(-4.5, 4.5, z, z + 9);
  route.push({ p: [0, top, z + 3], act: "run" });
  pillar(-6.5, z + 4, 1.2, 7, S.between(7, 11));
  z += 9;

  // 3. A rail across the open water on its posts, bending and rising a little.
  const rlen = S.between(18, 26);
  const bend = S.pick([-1, 1]) * S.between(3, 7);
  const rise = S.between(0.4, 1.6);
  const railObj = put("rail", { length: rlen, bend, rise, y: 1.15, segments: 12, shape: "ease" }, [0, 0, z + 1.5]);
  const rail = railObj.def.rails[0]!.map((p): Vec3 => [p[0], p[1], p[2] + z + 1.5]);
  route.push({ p: [0, top, z - 1.5], act: "jump" }, { p: rail[1]!, act: "rail" }, { p: rail[rail.length - 2]!, act: "rail" });
  z += rlen + 3;
  floor(-3.5, 3.5, z, z + 7);
  route.push({ p: [0, top, z + 3.5], act: "run" });
  z += 7;

  // 4. Pads to hop, stepping about.
  const hops = S.int(3, 5);
  let x = 0;
  for (let i = 0; i < hops; i += 1) {
    const gap = S.between(2.2, 3.4);
    const w = S.between(2.6, 3.6);
    const y = top + S.between(-0.1, 0.9);
    x = Math.max(-5, Math.min(5, x + S.between(-2.5, 2.5)));
    z += gap;
    floor(x - w / 2, x + w / 2, z, z + w, y);
    route.push({ p: [x, y, z - 0.6], act: "jump" }, { p: [x, y, z + w / 2], act: "run" });
    z += w;
  }

  // 5. A tunnel: walls, a roof, dark inside.
  z += 2.5;
  const tlen = S.between(11, 16);
  const tx = x;
  floor(tx - 3.2, tx + 3.2, z - 2.8, z + tlen);
  put("tunnel", { length: tlen, span: 4.9, h: 3.35 + SINK, thick: 0.5, roof: 0.7, floor: false }, [tx, -SINK, z + tlen / 2], Math.PI);
  route.push({ p: [tx, top, z - 1.5], act: "run" }, { p: [tx, top, z + tlen / 2], act: "run" }, { p: [tx * 0.5, top, z + tlen], act: "run" });
  z += tlen;

  // 6. The plaza at the end, the maze round it again.
  const plaza = floor(-10, 10, z, z + 16);
  for (let i = 0; i < 5; i += 1) pillar(S.pick([-1, 1]) * S.between(11, 18), z + S.between(0, 16), S.between(0.6, 3), S.between(3, 9), S.between(6, 12));
  route.push({ p: [0, top, z + 12], act: "run" });
  dressPlaza(`${seed}|props`, objects, plaza, [0, top, z], P);

  const { boxes, rails } = bakeForPhysics(objects, { mats: PIECE_MATS });
  const { capsules } = bakeForRenderer(objects, { mats: PIECE_MATS });
  return { objects, boxes, rails, capsules, route, waterY: 0, spawn: [0, top + 0.1, -5], end: z + 16 };
}

// The plaza's props, off the runner's line (|x| >= 4), each settled onto the plaza -- nothing floats.
function dressPlaza(seed: string, objects: ObjectInstance<object>[], plaza: ObjectInstance<object>, [cx, top, z0]: Vec3, P: Stream): void {
  const S = streamOf(seed);
  const comer: Vec3 = [cx, top + 1.2, z0 - 2]; // (where a runner comes out of the tunnel: what's shown faces them)
  const place = <K extends PieceKey>(key: K, ctx: PieceContexts[K], x: number, z: number, yaw: number | null = null): ObjectInstance<object> | null => {
    const def = buildPieceFrom(key, P, ctx);
    const pos: Vec3 = [x, top + 2, z];
    const { instance: inst, rests } = settle(placeObject(def, { pos, yaw: yaw ?? yawToShow(def, pos, comer), id: `${key}${objects.length}` }), [plaza]);
    if (!rests) return null;
    const f = footprint(inst).rect;
    if (objects.some((o) => o !== plaza && o.def.tags.includes("prop") && overlapXZ(f, footprint(o).rect))) return null;
    objects.push(inst as ObjectInstance<object>);
    return inst as ObjectInstance<object>;
  };
  for (const sx of [-1, 1]) if (S.chance(0.85)) place("lampPost", {}, sx * S.between(5, 8), z0 + S.between(2, 13), sx > 0 ? -Math.PI / 2 : Math.PI / 2);
  for (let i = 0; i < S.int(1, 2); i += 1) place("bench", {}, S.pick([-1, 1]) * S.between(4.5, 8.5), z0 + S.between(4, 14));
  if (S.chance(0.7)) place("sign", {}, S.pick([-1, 1]) * S.between(4.5, 7), z0 + S.between(6, 12));
  for (let i = 0; i < S.int(1, 4); i += 1) place("crate", {}, S.pick([-1, 1]) * S.between(4.5, 9.5), z0 + S.between(1, 15), S.between(0, Math.PI));
}

const overlapXZ = (a: readonly number[], b: readonly number[]): boolean => a[0]! < b[2]! + 0.3 && a[2]! > b[0]! - 0.3 && a[1]! < b[3]! + 0.3 && a[3]! > b[1]! - 0.3; // (rects [x0, z0, x1, z1], a hand apart)
