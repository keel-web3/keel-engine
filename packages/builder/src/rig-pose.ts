import type { Skeleton } from "@keel-engine/entity";
import { datan2, dhypot } from "@keel-engine/core";
import { materialOf } from "./look.ts";
import type { Look } from "./look.ts";
import type { V3 } from "./voxels.ts";
import type { VoxelSkin, VoxelSpec } from "./rig.ts";

// ---------------------------------------------------------------- posing

/** Solids for the pixel renderer: { boxes (turned about y), capsules }. */
export interface PosedSolids {
  boxes: Array<{ c: V3; h: V3; yaw: number; mat: number }>;
  capsules: Array<{ a: V3; b: V3; r: number; mat: number }>;
}

/** The skin on a posed skeleton: every piece through its bone. Materials by role from a look's table. */
export function poseVoxels(rig: { readonly skin: VoxelSkin } | { readonly voxel: { readonly skin: VoxelSkin } } | { readonly spec: VoxelSpec }, skel: Skeleton, table: Pick<Look, "table"> = { table: {} }): PosedSolids {
  const skin = "skin" in rig ? rig.skin : "voxel" in rig ? rig.voxel.skin : rig.spec.voxel.skin;
  const out: PosedSolids = { boxes: [], capsules: [] };
  const W = (bone: string, p: V3): V3 => {
    const b = skel.bones[bone]!;
    const m = b.m;
    return [b.p[0] + m[0] * p[0] + m[1] * p[1] + m[2] * p[2], b.p[1] + m[3] * p[0] + m[4] * p[1] + m[5] * p[2], b.p[2] + m[6] * p[0] + m[7] * p[1] + m[8] * p[2]];
  };
  for (const bx of skin.boxes) {
    const b = skel.bones[bx.bone];
    if (!b) continue;
    const m = b.m;
    // (The renderer turns boxes about y only: the bone's heading, from its front -- or its right, when its front points up or down.)
    const fx = m[2], fz = m[8];
    const yaw = dhypot(fx, fz) > 0.3 ? datan2(fx, fz) : datan2(m[0], m[6]) - Math.PI / 2;
    out.boxes.push({ c: W(bx.bone, bx.c), h: [...bx.h], yaw, mat: materialOf(table, bx.role) });
  }
  for (const c of skin.capsules) {
    if (!skel.bones[c.bone]) continue;
    out.capsules.push({ a: W(c.bone, c.a), b: W(c.bone, c.b), r: c.r, mat: materialOf(table, c.role) });
  }
  return out;
}
