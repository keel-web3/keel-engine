// The modular building generator: one function from a handful of parameters
// to a building's design -- every variant (cottage, tower, hall, workshop,
// shop, the sci-fi hab, dome and pylon, the biotic hive, the factory) is this
// with its own choices.
//
//   footprint   rect | L | T | round        wings: rectangles (L: a wing back
//                                           from the right end; T: one back
//                                           from the middle), or an octagon
//   size        width x depth, floors x floor height
//   walls       a plinth (stone), the wall mass, floor bands, a frame
//               (timber posts and beams, sci-fi panel ribs, or none)
//   roof        gable | hip | flat | dome | spire | vault | saucer | shell
//               (per wing: a gable's ridge runs along the wing's long side;
//               wall-coloured gable ends; a hip is stepped -- the renderer's
//               solids can add, never cut, and a stepped hip is the pixel one)
//   openings    a door on the front (+z) face of the main wing -- single,
//               double, barn, arch or airlock -- with a step, maybe a porch;
//               windows along every outer face per floor (few, many, a band,
//               portholes, none), faces where two wings meet left blank
//   extras      chimneys, a balcony, an awning and a sign (a shop), antennas,
//               vents, smokestacks
//
// Sockets: `door` (on the threshold, facing out), `entrance` (a spawn point in
// front of it), `sign` (above the door), `roof` (the flat roof's middle),
// `chimney0..` (their tops: smoke), `balcony`, `antenna`. Colliders are the
// wall masses (v1 interiors are solid: meta.walkable false), roofs and
// chimneys; details never collide. The front is declared +z and a part named
// "door" is on it, so front detection agrees.

import { solid } from "@keel-engine/object";
import type { DesignSolid, SocketSpec } from "@keel-engine/object";
import type { Stream, Vec3 } from "@keel-engine/core";
import { post } from "./kit.ts";

export type Footprint = "rect" | "L" | "T" | "round";
export type Roof = "gable" | "hip" | "flat" | "dome" | "spire" | "vault" | "saucer" | "shell";
export type Door = "single" | "double" | "barn" | "arch" | "airlock" | "none";
export type Windows = "none" | "few" | "many" | "band" | "porthole";
export type Frame = "none" | "timber" | "panels";

export interface BuildingParams {
  readonly footprint: Footprint;
  readonly width: number;
  readonly depth: number;
  readonly floors: number;
  readonly floorH: number;
  readonly roof: Roof;
  /** Roof rise over half its span (gable, hip), or its height over the width (spire). */
  readonly pitch: number;
  readonly door: Door;
  readonly windows: Windows;
  readonly frame: Frame;
  readonly plinth: boolean;
  readonly chimneys: number;
  readonly porch: boolean;
  readonly balcony: boolean;
  readonly shutters: boolean;
  readonly awning: boolean;
  readonly sign: boolean;
  readonly antennas: number;
  readonly stacks: number;
  readonly vents: boolean;
  /** Where the door sits along the front: -1 left .. 1 right. */
  readonly doorAt: number;
}

export const DEFAULT_PARAMS: BuildingParams = {
  footprint: "rect", width: 6, depth: 5, floors: 1, floorH: 2.8, roof: "gable", pitch: 0.8, door: "single", windows: "few", frame: "none",
  plinth: true, chimneys: 1, porch: false, balcony: false, shutters: false, awning: false, sign: false, antennas: 0, stacks: 0, vents: false, doorAt: 0,
};

interface Wing { cx: number; cz: number; w: number; d: number; floors: number }

const PLINTH = 0.35;
const OUT = 0.04; // (how far details stand proud of a wall: never flush -- two faces in one plane flicker)

/** The wings a footprint is made of (the main one first). */
export function wingsOf(p: Pick<BuildingParams, "footprint" | "width" | "depth" | "floors">): Wing[] {
  const main: Wing = { cx: 0, cz: 0, w: p.width, d: p.depth, floors: p.floors };
  if (p.footprint === "L") {
    const a = Math.min(p.width * 0.45, p.depth * 0.9), b = p.depth * 0.85;
    return [main, { cx: p.width / 2 - a / 2, cz: -(p.depth / 2 + b / 2) + 0.01, w: a, d: b, floors: Math.max(1, p.floors - (p.floors > 1 ? 1 : 0)) }];
  }
  if (p.footprint === "T") {
    const a = Math.min(p.width * 0.42, p.depth), b = p.depth * 0.9;
    return [main, { cx: 0, cz: -(p.depth / 2 + b / 2) + 0.01, w: a, d: b, floors: p.floors }];
  }
  return [main];
}

const inside = (wings: readonly Wing[], x: number, z: number, skip: Wing): boolean =>
  wings.some((w) => w !== skip && Math.abs(x - w.cx) < w.w / 2 - 1e-3 && Math.abs(z - w.cz) < w.d / 2 - 1e-3);

/** The design of a building: its solids, sockets and meta (see the top). `J` jitters nothing structural -- only small things (a chimney's side). */
export function buildingDesign(J: Stream, p: BuildingParams): { solids: DesignSolid[]; sockets: Record<string, SocketSpec>; meta: Record<string, unknown>; tags: string[] } {
  const solids: DesignSolid[] = [];
  const sockets: Record<string, SocketSpec> = {};
  const base = p.plinth ? PLINTH : 0.05;
  const round = p.footprint === "round";
  const wings = round ? [{ cx: 0, cz: 0, w: p.width, d: p.width, floors: p.floors }] : wingsOf(p);
  const scifi = p.door === "airlock" || p.windows === "band" || p.windows === "porthole";
  const tops: number[] = [];

  // ---- walls, plinth, floor bands, frame
  for (const [wi, w] of wings.entries()) {
    const H = w.floors * p.floorH;
    const top = base + H;
    tops.push(top);
    if (round) {
      const r = w.w / 2;
      if (p.plinth) solids.push(solid.cylinder("stone", [0, 0, 0], r + 0.1, base, { name: "plinth" }));
      solids.push(solid.cylinder("wall", [0, base, 0], r, H, { name: "wall" }));
      for (let f = 1; f < w.floors; f += 1) solids.push(solid.cylinder("trim", [0, base + f * p.floorH - 0.08, 0], r + OUT, 0.16, { name: "band", collide: false }));
      solids.push(solid.cylinder("trim", [0, top - 0.14, 0], r + OUT * 1.5, 0.14, { name: "cornice", collide: false }));
      continue;
    }
    if (p.plinth) solids.push(solid.box("stone", [w.cx, base / 2, w.cz], [w.w / 2 + 0.08, base / 2, w.d / 2 + 0.08], 0, { name: "plinth" }));
    solids.push(solid.box("wall", [w.cx, base + H / 2, w.cz], [w.w / 2, H / 2, w.d / 2], 0, { name: wi ? "wing" : "wall" }));
    const beamRole = p.frame === "timber" ? "wood" : "trim";
    for (let f = 1; f < w.floors; f += 1) solids.push(solid.box(beamRole, [w.cx, base + f * p.floorH, w.cz], [w.w / 2 + OUT, 0.08, w.d / 2 + OUT], 0, { name: "band", collide: false }));
    if (p.frame !== "none") {
      const role = p.frame === "timber" ? "wood" : "metal";
      const t = p.frame === "timber" ? 0.09 : 0.06;
      // Corner posts, and posts along the long faces every ~2.4 m.
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        if (inside(wings, w.cx + sx * (w.w / 2 + 0.2), w.cz + sz * (w.d / 2 - 0.2), w)) continue;
        solids.push(post(role, w.cx + sx * (w.w / 2 - t + OUT), w.cz + sz * (w.d / 2 - t + OUT), base, top, t, { name: "frame" }));
      }
      const n = Math.max(1, Math.round(w.w / 2.4));
      for (let i = 1; i < n; i += 1) {
        const x = w.cx - w.w / 2 + (w.w * i) / n;
        for (const sz of [-1, 1]) if (!inside(wings, x, w.cz + sz * (w.d / 2 + 0.2), w)) solids.push(solid.box(role, [x, base + H / 2, w.cz + sz * (w.d / 2 + OUT / 2)], [t, H / 2, OUT], 0, { name: "frame", collide: false }));
      }
      solids.push(solid.box(role, [w.cx, top - 0.06, w.cz], [w.w / 2 + OUT, 0.06, w.d / 2 + OUT], 0, { name: "frame", collide: false }));
    }
  }
  const mainTop = tops[0]!;
  const main = wings[0]!;
  const front = round ? main.w / 2 : main.d / 2;

  // ---- windows: along every outer face, per floor
  const windowSolids = (cx: number, cy: number, cz: number, yaw: number, ww: number, wh: number): DesignSolid[] => {
    // (A pane on the face -- yaw turns a box's +z to face out -- and a sill under it.)
    const out: DesignSolid[] = [];
    const nx = Math.sin(yaw), nz = Math.cos(yaw);
    if (p.windows === "porthole") {
      // (A porthole: a glass bead set in the wall, a metal one a little bigger behind it for its rim -- a capsule each.)
      out.push(solid.ball("glass", [cx - nx * ww * 0.3, cy, cz - nz * ww * 0.3], ww * 0.4, { name: "window", collide: false }));
      out.push(solid.ball("metal", [cx - nx * ww * 0.42, cy, cz - nz * ww * 0.42], ww * 0.52, { name: "frame", collide: false }));
      return out;
    }
    out.push(solid.box("glass", [cx + nx * OUT, cy, cz + nz * OUT], [ww / 2, wh / 2, 0.05], yaw, { name: "window", collide: false }));
    out.push(solid.box("trim", [cx + nx * OUT * 2, cy - wh / 2 - 0.05, cz + nz * OUT * 2], [ww / 2 + 0.08, 0.05, 0.07], yaw, { name: "sill", collide: false }));
    if (p.shutters) for (const s of [-1, 1]) {
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      out.push(solid.box("wood", [cx + nx * OUT + rx * s * (ww / 2 + 0.2), cy, cz + nz * OUT + rz * s * (ww / 2 + 0.2)], [0.18, wh / 2, 0.04], yaw, { name: "shutter", collide: false }));
    }
    return out;
  };
  // (Windows are gathered first, then thinned evenly to a budget: a four-floor L with many windows would be
  // hundreds of solids, and a design must fit the renderer's 256 boxes.)
  const panes: Array<[number, number, number, number, number, number]> = [];
  const pane = (cx: number, cy: number, cz: number, yaw: number, ww: number, wh: number): void => { panes.push([cx, cy, cz, yaw, ww, wh]); };
  if (p.windows !== "none") {
    const ww = p.windows === "band" ? 0 : p.windows === "porthole" ? 0.7 : 0.8;
    const wh = p.windows === "porthole" ? 0.7 : Math.min(1.3, p.floorH * 0.42);
    const spacing = p.windows === "many" ? 2.0 : 2.8;
    for (const w of wings) {
      for (let f = 0; f < w.floors; f += 1) {
        const cy = base + f * p.floorH + p.floorH * 0.55;
        if (round) {
          const r = w.w / 2;
          const n = Math.max(3, Math.min(10, Math.round((Math.PI * 2 * r) / spacing)));
          for (let i = 0; i < n; i += 1) {
            const a = ((i + 0.5) / n) * Math.PI * 2;
            if (f === 0 && Math.abs(Math.sin(a / 2 - 0)) < 0.35) continue; // (not over the door, at +z)
            if (p.windows === "band") continue;
            pane(Math.sin(a) * r, cy, Math.cos(a) * r, a, ww || 0.8, wh);
          }
          if (p.windows === "band") solids.push(solid.cylinder("glass", [0, cy - 0.3, 0], r + OUT, 0.6, { name: "window", collide: false }));
          continue;
        }
        // Faces: +z, -z (along x), +x, -x (along z).
        const faces: Array<{ len: number; at: (t: number) => [number, number]; yaw: number; normal: [number, number] }> = [
          { len: w.w, at: (t) => [w.cx - w.w / 2 + t, w.cz + w.d / 2], yaw: 0, normal: [0, 1] },
          { len: w.w, at: (t) => [w.cx - w.w / 2 + t, w.cz - w.d / 2], yaw: Math.PI, normal: [0, -1] },
          { len: w.d, at: (t) => [w.cx + w.w / 2, w.cz - w.d / 2 + t], yaw: Math.PI / 2, normal: [1, 0] },
          { len: w.d, at: (t) => [w.cx - w.w / 2, w.cz - w.d / 2 + t], yaw: -Math.PI / 2, normal: [-1, 0] },
        ];
        for (const face of faces) {
          if (p.windows === "band") {
            const [x0, z0] = face.at(0), [x1, z1] = face.at(face.len);
            const mx = (x0 + x1) / 2 + face.normal[0] * OUT, mz = (z0 + z1) / 2 + face.normal[1] * OUT;
            if (inside(wings, mx + face.normal[0] * 0.3, mz + face.normal[1] * 0.3, w)) continue;
            solids.push(solid.box("glass", [mx, cy, mz], [face.len / 2 - 0.4, 0.28, 0.05], face.yaw, { name: "window", collide: false }));
            continue;
          }
          const n = Math.min(4, Math.max(1, Math.floor(face.len / spacing)));
          for (let i = 0; i < n; i += 1) {
            const t = (face.len * (i + 0.5)) / n;
            const [x, z] = face.at(t);
            if (inside(wings, x + face.normal[0] * 0.3, z + face.normal[1] * 0.3, w)) continue;
            // (Not where the door is.)
            if (w === main && face.yaw === 0 && f === 0 && p.door !== "none" && Math.abs(x - p.doorAt * main.w * 0.3) < 1.3) continue;
            pane(x, cy, z, face.yaw, ww, wh);
          }
        }
      }
    }
  }

  const budget = p.shutters ? 24 : 36;
  const keep = panes.length <= budget ? panes : panes.filter((_, i) => Math.floor((i * budget) / panes.length) !== Math.floor(((i - 1) * budget) / panes.length));
  for (const w of keep) solids.push(...windowSolids(...w));

  // ---- the door, its step and porch, on the main wing's front
  const doorSize: Record<Exclude<Door, "none">, [number, number]> = { single: [0.95, 2.05], double: [1.7, 2.3], barn: [2.8, 3], arch: [1.2, 2.2], airlock: [1.6, 2.3] };
  const dx = round ? 0 : p.doorAt * main.w * 0.3;
  if (p.door !== "none") {
    const [dw, dh0] = doorSize[p.door];
    const dh = Math.min(dh0, p.floorH * (p.door === "barn" ? 0.95 : 0.8));
    const dz = front;
    solids.push(solid.box(p.door === "airlock" ? "metal" : "trim", [dx, base + dh / 2 + 0.05, dz + OUT / 2], [dw / 2 + 0.12, dh / 2 + 0.1, OUT], 0, { name: "doorframe", collide: false }));
    solids.push(solid.box("door", [dx, base + dh / 2, dz + OUT * 1.5], [dw / 2, dh / 2, OUT], 0, { name: "door", collide: false }));
    // (An arch: the door's head stepped in, the pixel way.)
    if (p.door === "arch") for (const [k, f] of [[0.72, 0.16], [0.4, 0.3]] as const) solids.push(solid.box("door", [dx, base + dh + dw * f * 0.5, dz + OUT * 1.5], [(dw / 2) * k, dw * 0.1, OUT], 0, { name: "door", collide: false }));
    if (p.door === "airlock") solids.push(solid.box("glow", [dx, base + dh + 0.18, dz + OUT * 2.5], [dw / 2, 0.05, OUT], 0, { name: "light", collide: false }));
    if (p.door === "double" || p.door === "barn") solids.push(solid.box("wood", [dx, base + dh / 2, dz + OUT * 2.5], [0.04, dh / 2, OUT / 2], 0, { name: "door", collide: false }));
    if (p.plinth) solids.push(solid.box("stone", [dx, base / 2, dz + 0.35], [dw / 2 + 0.25, base / 2, 0.3], 0, { name: "step", collide: false }));
    if (p.porch) {
      const pz = dz + 1.1, ph = base + dh + 0.35;
      for (const s of [-1, 1]) solids.push(post("wood", dx + s * (dw / 2 + 0.5), pz, base, ph, 0.07, { name: "porch" }));
      solids.push(solid.wedge("roof", [dx, ph + 0.2, dz + 0.65], [dw / 2 + 0.75, 0.2, 0.7], 0, 0.15, { name: "porch", collide: false }));
    }
    sockets["door"] = { kind: "anchor", pos: [dx, base, dz + 0.1], yaw: 0, extent: [dw / 2, 0] };
    sockets["entrance"] = { kind: "spawn", pos: [dx, 0, dz + (p.porch ? 1.8 : 1.2)], yaw: 0 };
    if (p.sign || p.awning) sockets["sign"] = { kind: "anchor", pos: [dx, base + dh + 0.55, dz + 0.15], yaw: 0, normal: [0, 0, 1] };
  }

  // ---- shop front: an awning over the front, a sign board
  if (p.awning && !round) {
    const ay = base + Math.min(p.floorH * 0.85, 2.6);
    solids.push(solid.wedge("cloth", [0, ay + 0.25, front + 0.6], [main.w / 2 - 0.2, 0.25, 0.6], 0, 0.1, { name: "awning", collide: false }));
  }
  if (p.sign && p.door !== "none") {
    const [dw] = doorSize[p.door];
    const sy = base + Math.min(p.floorH * 0.8, 2.3) + 0.55;
    solids.push(solid.box("sign", [dx, sy, front + OUT * 3 + (p.awning ? 0.02 : 0)], [Math.max(0.7, dw / 2 + 0.3), 0.28, 0.04], 0, { name: "sign", collide: false }));
  }

  // ---- a balcony on the upper floor's front
  if (p.balcony && main.floors > 1 && !round) {
    const by = base + p.floorH;
    const bw = Math.min(main.w * 0.5, 3);
    const bx = -dx * 0.5;
    solids.push(solid.box("wood", [bx, by, front + 0.55], [bw / 2, 0.07, 0.55], 0, { name: "balcony", collide: false }));
    for (const s of [-1, 1]) solids.push(post("wood", bx + s * (bw / 2 - 0.05), front + 1.05, by, by + 0.95, 0.04, { name: "balcony" }));
    solids.push(solid.box("wood", [bx, by + 0.95, front + 1.05], [bw / 2, 0.04, 0.04], 0, { name: "balcony", collide: false }));
    solids.push(solid.box("wood", [bx, by + 0.5, front + 1.05], [bw / 2, 0.02, 0.02], 0, { name: "balcony", collide: false }));
    sockets["balcony"] = { kind: "anchor", pos: [bx, by + 0.07, front + 0.6], yaw: 0 };
  }

  // ---- roofs, per wing
  let roofTop = mainTop;
  for (const [wi, w] of wings.entries()) {
    const top = tops[wi]!;
    const along: "x" | "z" = w.w >= w.d ? "x" : "z";
    const len = along === "x" ? w.w : w.d;
    const span = along === "x" ? w.d : w.w;
    const o = 0.3; // (eave overhang)
    const g = wi ? "roof.wing" : "roof";
    switch (round ? (p.roof === "gable" || p.roof === "hip" || p.roof === "vault" ? "spire" : p.roof) : p.roof) {
      case "gable": {
        const rise = (span / 2) * p.pitch;
        const half = span / 2 + o;
        for (const s of [1, -1]) {
          // (Each side a wedge: its foot at the eave, rising to the ridge. yaw turns its +z foot outward.)
          const yaw = along === "x" ? (s > 0 ? 0 : Math.PI) : (s > 0 ? Math.PI / 2 : -Math.PI / 2);
          const off = s * half / 2;
          const c: Vec3 = along === "x" ? [w.cx, top + rise / 2, w.cz + off] : [w.cx + off, top + rise / 2, w.cz];
          solids.push(solid.wedge("roof", c, [len / 2 + 0.12, rise / 2, half / 2], yaw, 0, { name: "roof", group: g }));
          // The gable end under it: wall-coloured, a roof's thickness lower, a hair past the roof's ends.
          const riseW = rise * (span / 2) / half - 0.14;
          const cw: Vec3 = along === "x" ? [w.cx, top + riseW / 2, w.cz + s * span / 4] : [w.cx + s * span / 4, top + riseW / 2, w.cz];
          if (riseW > 0.1) solids.push(solid.wedge("wall", cw, [len / 2 + 0.14, riseW / 2, span / 4], yaw, 0, { name: "gable", group: g, collide: false }));
        }
        roofTop = Math.max(roofTop, top + rise);
        break;
      }
      case "hip": {
        const rise = (span / 2) * p.pitch;
        const steps = Math.max(3, Math.min(6, Math.round(rise / 0.35)));
        for (let i = 0; i < steps; i += 1) {
          const k = i / steps;
          const hw = (w.w / 2 + o) - (span / 2 + o) * k * 0.98, hd = (w.d / 2 + o) - (span / 2 + o) * k * 0.98;
          if (hw <= 0.05 || hd <= 0.05) break;
          solids.push(solid.box("roof", [w.cx, top + (rise / steps) * (i + 0.5), w.cz], [hw, rise / steps / 2, hd], 0, { name: "roof", group: g, collide: i === 0 }));
        }
        roofTop = Math.max(roofTop, top + rise);
        break;
      }
      case "flat": {
        solids.push(solid.box("roof", [w.cx, top + 0.08, w.cz], [w.w / 2 + 0.1, 0.08, w.d / 2 + 0.1], 0, { name: "roof", group: g }));
        for (const [cx, cz, hx, hz] of [[w.cx, w.cz + w.d / 2, w.w / 2 + 0.1, 0.1], [w.cx, w.cz - w.d / 2, w.w / 2 + 0.1, 0.1], [w.cx + w.w / 2, w.cz, 0.1, w.d / 2], [w.cx - w.w / 2, w.cz, 0.1, w.d / 2]] as const) {
          if (inside(wings, cx + Math.sign(cx - w.cx) * 0.3 * (hx < 0.2 ? 1 : 0), cz + Math.sign(cz - w.cz) * 0.3 * (hz < 0.2 ? 1 : 0), w)) continue;
          solids.push(solid.box("trim", [cx, top + 0.3, cz], [hx, 0.16, hz], 0, { name: "parapet", group: g, collide: false }));
        }
        if (wi === 0) sockets["roof"] = { kind: "top", pos: [w.cx, top + 0.16, w.cz], yaw: 0, extent: [w.w / 2 - 0.2, w.d / 2 - 0.2] };
        roofTop = Math.max(roofTop, top + 0.46);
        break;
      }
      case "dome": {
        const R = Math.min(w.w, w.d) / 2 * 0.98;
        // (Its lower half is inside the walls; on a squat building it flattens rather than reach through the ground.)
        const ry = Math.min(R * 0.85, top * 0.98);
        solids.push(solid.ball("roof", [w.cx, top, w.cz], [R, ry, R], { name: "dome", group: g }));
        solids.push(solid.cylinder("trim", [w.cx, top - 0.1, w.cz], R + 0.05, 0.2, { name: "drum", group: g, collide: false }));
        solids.push(solid.capsule("metal", [w.cx, top + ry * 0.95, w.cz], [w.cx, top + ry + 0.6, w.cz], 0.06, { name: "finial", group: g, collide: false }));
        roofTop = Math.max(roofTop, top + ry + 0.66);
        break;
      }
      case "spire": {
        const R = (round ? w.w / 2 : Math.min(w.w, w.d) / 2) + 0.25;
        const h = R * 2 * Math.max(0.8, p.pitch * 1.6);
        solids.push(solid.cone("roof", [w.cx, top, w.cz], R, h, 0.05, { name: "spire", group: g, sides: round ? 8 : 4 }));
        solids.push(solid.capsule("metal", [w.cx, top + h, w.cz], [w.cx, top + h + 0.7, w.cz], 0.05, { name: "finial", group: g, collide: false }));
        roofTop = Math.max(roofTop, top + h + 0.75);
        break;
      }
      case "vault": {
        const r = span / 2 + 0.05;
        const hl = len / 2 - r;
        const a: Vec3 = along === "x" ? [w.cx - Math.max(0, hl), top, w.cz] : [w.cx, top, w.cz - Math.max(0, hl)];
        const b: Vec3 = along === "x" ? [w.cx + Math.max(0, hl), top, w.cz] : [w.cx, top, w.cz + Math.max(0, hl)];
        solids.push(solid.capsule("roof", a, b, r, { name: "vault", group: g }));
        // (Ribs across it: the hab module's hoops.)
        const n = Math.max(2, Math.round(len / 2.2));
        for (let i = 0; i <= n; i += 1) {
          const t = -len / 2 + 0.3 + ((len - 0.6) * i) / n;
          const c: Vec3 = along === "x" ? [w.cx + t, top, w.cz] : [w.cx, top, w.cz + t];
          // (A hoop: three bands stepping in over the vault -- the pixel arch -- each a hair proud of it.)
          for (const [y0, y1] of [[0, 0.42], [0.42, 0.78], [0.78, 1.04]] as const) {
            const half = Math.sqrt(Math.max(0, 1 - y0 * y0)) * r + 0.05;
            const hy = ((y1 - y0) * r) / 2;
            solids.push(solid.box("metal", [c[0], top + y0 * r + hy, c[2]], along === "x" ? [0.08, hy, half] : [half, hy, 0.08], 0, { name: "rib", group: g, collide: false }));
          }
        }
        roofTop = Math.max(roofTop, top + r);
        break;
      }
      case "saucer": {
        const R = Math.min(w.w, w.d) / 2;
        solids.push(solid.ball("roof", [w.cx, top + 0.2, w.cz], [R * 1.25, R * 0.28, R * 1.25], { name: "saucer", group: g }));
        solids.push(solid.ball("glow", [w.cx, top + 0.2, w.cz], [R * 1.28, 0.1, R * 1.28], { name: "ring", group: g, collide: false }));
        solids.push(solid.ball("glass", [w.cx, top + R * 0.3, w.cz], [R * 0.5, R * 0.35, R * 0.5], { name: "cupola", group: g, collide: false }));
        roofTop = Math.max(roofTop, top + R * 0.65);
        break;
      }
      case "shell": {
        const R = Math.min(w.w, w.d) / 2;
        let y = top;
        for (let i = 0; i < 3; i += 1) {
          const r = R * (1 - i * 0.28);
          solids.push(solid.ball("roof", [w.cx, y + r * 0.4, w.cz], [r, r * 0.6, r], { name: "shell", group: g, collide: i === 0 }));
          y += r * 0.75;
        }
        roofTop = Math.max(roofTop, y + R * 0.2);
        break;
      }
    }
  }

  // ---- chimneys, stacks, antennas, vents
  for (let i = 0; i < p.chimneys; i += 1) {
    const w = wings[Math.min(i, wings.length - 1)]!;
    const side = i % 2 ? -1 : 1;
    const along = w.w >= w.d;
    const cx = along ? w.cx + side * w.w * 0.3 : w.cx + side * w.w * 0.18;
    const cz = along ? w.cz - w.d * 0.18 * J.between(0.6, 1) : w.cz + side * w.d * 0.3;
    const h0 = tops[Math.min(i, wings.length - 1)]!;
    const rise = p.roof === "gable" || p.roof === "hip" ? (Math.min(w.w, w.d) / 2) * p.pitch : 0.4;
    const ch = h0 + rise * 0.85 + 0.6;
    solids.push(solid.box("stone", [cx, (h0 + ch) / 2, cz], [0.3, (ch - h0) / 2 + 0.2, 0.3], 0, { name: "chimney" }));
    solids.push(solid.box("trim", [cx, ch, cz], [0.36, 0.08, 0.36], 0, { name: "chimney", collide: false }));
    sockets[`chimney${i}`] = { kind: "anchor", pos: [cx, ch + 0.08, cz], normal: [0, 1, 0] };
    roofTop = Math.max(roofTop, ch + 0.1);
  }
  for (let i = 0; i < p.stacks; i += 1) {
    const x = main.w / 2 - 0.8 - i * 1.3, z = -main.d / 2 + 0.9;
    const h = mainTop + 2.5 + i * 0.8;
    solids.push(solid.cylinder("metal", [x, mainTop - 0.2, z], 0.4, h - mainTop + 0.2, { name: "stack" }));
    solids.push(solid.cylinder("trim", [x, h - 0.5, z], 0.46, 0.25, { name: "band", collide: false }));
    sockets[`stack${i}`] = { kind: "anchor", pos: [x, h, z], normal: [0, 1, 0] };
    roofTop = Math.max(roofTop, h);
  }
  for (let i = 0; i < p.antennas; i += 1) {
    const x = (i % 2 ? -1 : 1) * main.w * 0.25, z = -main.d * 0.2;
    const y0 = roofTop - (p.roof === "vault" ? 0.2 : 0.4), h = 1.6 + i * 0.7;
    solids.push(solid.capsule("metal", [x, y0, z], [x, y0 + h, z], 0.05, { name: "antenna", collide: false }));
    solids.push(solid.ball("glow", [x, y0 + h, z], 0.13, { name: "beacon", collide: false }));
    if (i === 0) sockets["antenna"] = { kind: "anchor", pos: [x, y0 + h, z] };
    roofTop = Math.max(roofTop, y0 + h + 0.13);
  }
  if (p.vents && !round) for (let i = 0; i < 2; i += 1) {
    const s = i ? -1 : 1;
    solids.push(solid.box("metal", [s * (main.w / 2 + 0.15), base + 0.5, -main.d * 0.2], [0.15, 0.3, 0.45], 0, { name: "vent", collide: false }));
    solids.push(solid.box("dark", [s * (main.w / 2 + 0.31), base + 0.5, -main.d * 0.2], [0.01, 0.2, 0.35], 0, { name: "vent", collide: false }));
  }

  const footprintTiles = round ? { kind: "round", r: main.w / 2 } : { kind: p.footprint, wings: wings.map((w) => ({ x: w.cx, z: w.cz, w: w.w, d: w.d })) };
  return {
    solids,
    sockets,
    tags: ["building", round ? "round" : p.footprint, scifi ? "scifi" : "classic"],
    meta: { building: { footprint: footprintTiles, floors: p.floors, floorH: p.floorH, roof: p.roof, height: roofTop, walkable: false, entrances: p.door === "none" ? [] : ["door"] } },
  };
}
