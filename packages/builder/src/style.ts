// The voxel style (`style/voxel@1.0.0`): a styled object's design (see
// @keel-engine/object design.ts / style.ts) rasterised into a builder
// VoxelModel -- the same solids, the same roles, painted in order into cells
// `unit` metres on a side -- then greedy-merged into as few boxes as the shape
// allows (mesh.ts), one role (and group) a box. So an oak, a cottage or a
// bridge written once comes out blocky, exactly on a grid, and the model is a
// real VoxelModel: open it in the builder, edit it, export it.
//
//   unit        params.unit, else the design's voxel.unit hint, else its
//               largest size / params.resolution (default 20 voxels), on a 5 mm grid
//   a cell      is filled when its centre is inside a solid; a solid thinner
//               than 1.5 voxels, a cone or a wedge keeps its cells within half a
//               voxel (a grass blade, a railing, a spire's tip, a ramp's foot
//               doesn't vanish)
//   too many    boxes for one design (the renderer draws 256 a scene): the unit
//               grows a quarter at a time, up to seven times; then it declines
//               (the next style in the chain -- pixel -- draws it)
//   nothing     (a design finer than its unit): it declines
//
// Colliders and sockets stay the design's (the style contract): a voxel world
// plays exactly as the pixel one does.

import { designBounds, drawnIn, solidBounds, solidSdf, thicknessOf } from "@keel-engine/object";
import type { Design, ObjectStyle, StyleParams, StyledPart, StyledParts } from "@keel-engine/object";
import { greedyBoxes } from "./mesh.ts";
import { createVoxels } from "./voxels.ts";
import type { V3, VoxelModel } from "./voxels.ts";

/** Most boxes one design may become (the renderer's per-scene box limit). */
export const VOXEL_BOX_LIMIT = 256;

/** The unit a design is voxelised at (see the top). */
export function voxelUnitFor(design: Design, params: StyleParams = {}): number {
  const snap = (u: number): number => Math.max(0.005, Math.round(u * 200) / 200);
  if (typeof params["unit"] === "number" && params["unit"] > 0) return params["unit"];
  if (design.voxel?.unit && design.voxel.unit > 0) return snap(design.voxel.unit);
  const b = designBounds(design.solids.filter((s) => drawnIn(s, "voxel")));
  const size = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2], 0.05);
  const resolution = typeof params["resolution"] === "number" && params["resolution"] > 0 ? params["resolution"] : 20;
  return snap(size / resolution);
}

/**
 * A design as a VoxelModel at `unit`: its solids painted in order (a later one wins a cell), each cell its role;
 * `groups` says which group (index into `names`, 0 none) each filled cell's solid belonged to. The model's origin
 * is the design's (a cell (x, y, z) is [x, x+1] x ... voxels from it).
 */
export function designVoxels(design: Design, unit: number): { model: VoxelModel; cellGroups: Map<number, number>; groupNames: string[] } {
  const model = createVoxels({ unit, origin: [0, 0, 0], name: "design" });
  const cellGroups = new Map<number, number>();
  const groupNames: string[] = [];
  const key = (x: number, y: number, z: number): number => ((x + 2048) * 4096 + (y + 2048)) * 4096 + (z + 2048);
  for (const s of design.solids) {
    if (!drawnIn(s, "voxel")) continue;
    const b = solidBounds(s);
    const f = solidSdf(s);
    // (A thin solid, a cone or a wedge -- which thin to a point, an edge -- keeps its cells within half a voxel:
    // a spike keeps its tip, a ramp its foot.)
    const thin = thicknessOf(s) < unit * 1.5 || s.kind === "cone" || s.kind === "wedge";
    const reach = thin ? unit * 0.5 : 0;
    const role = model.roleIndex(s.role);
    let g = 0;
    if (s.group) { g = groupNames.indexOf(s.group) + 1; if (!g) { groupNames.push(s.group); g = groupNames.length; } }
    const x0 = Math.floor((b[0] - reach) / unit), x1 = Math.ceil((b[3] + reach) / unit) - 1;
    const y0 = Math.floor((b[1] - reach) / unit), y1 = Math.ceil((b[4] + reach) / unit) - 1;
    const z0 = Math.floor((b[2] - reach) / unit), z1 = Math.ceil((b[5] + reach) / unit) - 1;
    for (let z = z0; z <= z1; z += 1) for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      if (f((x + 0.5) * unit, (y + 0.5) * unit, (z + 0.5) * unit) > reach) continue;
      model.setIndex(x, y, z, role);
      if (g) cellGroups.set(key(x, y, z), g); else cellGroups.delete(key(x, y, z));
    }
  }
  return { model, cellGroups, groupNames };
}

/** A design's voxel parts at a unit: greedy boxes by group and role, in metres about the design's origin. */
export function voxelParts(design: Design, unit: number): { parts: StyledPart[]; model: VoxelModel; boxes: number } {
  const { model, cellGroups, groupNames } = designVoxels(design, unit);
  if (!model.count) return { parts: [], model, boxes: 0 };
  const key = (x: number, y: number, z: number): number => ((x + 2048) * 4096 + (y + 2048)) * 4096 + (z + 2048);
  const boxes = greedyBoxes(model, { label: (x, y, z, v) => (cellGroups.get(key(x, y, z)) ?? 0) * 256 + v });
  const parts: StyledPart[] = boxes.map((b) => {
    const role = model.roles[(b.label & 255) - 1] ?? "primary";
    const g = b.label >> 8;
    const group = g ? groupNames[g - 1] ?? null : null;
    const c: V3 = [(b.min[0] + b.size[0] / 2) * unit, (b.min[1] + b.size[1] / 2) * unit, (b.min[2] + b.size[2] / 2) * unit];
    const h: V3 = [(b.size[0] / 2) * unit, (b.size[1] / 2) * unit, (b.size[2] / 2) * unit];
    // (Colliders are the design's: parts never make their own.)
    return { box: { c, h, yaw: 0 }, name: group ?? role, mat: role, role, group, collide: false };
  });
  return { parts, model, boxes: boxes.length };
}

/** The voxel style. Registered with the page's styles when keel/builder loads (index.ts). */
export const voxelStyle: ObjectStyle = {
  name: "voxel",
  contract: "style/voxel@1.0.0",
  title: "Voxel (builder models, greedy boxes)",
  fallback: "pixel",
  build(design: Design, params: StyleParams): StyledParts | null {
    let unit = voxelUnitFor(design, params);
    for (let tries = 0; tries < 8; tries += 1) {
      const r = voxelParts(design, unit);
      if (!r.parts.length) return null;
      if (r.boxes <= VOXEL_BOX_LIMIT) return { parts: r.parts, model: r.model, stats: { voxels: r.model.count, boxes: r.boxes, unit } };
      unit = Math.round(unit * 1.25 * 1000) / 1000;
    }
    return null;
  },
};
