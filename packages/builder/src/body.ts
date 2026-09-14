// A voxel model as a population's EXPLICIT BODY: a hand-built hero that keeps
// everything else a population draws -- its look, the things it wears (built
// to its own sockets), its walk. The model is auto-rigged onto the engine's
// body contract (rig.ts), and its skin is posed through the rig's bones: each
// piece by its bone (the part: bake's body slots read "forearm.L" as the
// forearm) and its role as an entity role (ENTITY_ROLE_OF: primary is cloth,
// skin is fur...), so a population's looks paint it like any body.
//
//   const hero = voxelBody(model);                       // { spec, skin(skel), sockets, doc }
//   populate({ ..., explicit: new Map([[0, { body: hero }]]) });
//   populationOf(record, { parts: [voxelBodyReader()] }) // a stored record's voxel bodies, read back
//
// The shape is bake's (ExplicitBody), written structurally: the builder
// doesn't need the baker. `doc` is the model's codec document (VOXELS): what a
// hybrid record stores.

import { VOXELS } from "@keel-engine/codec";
import type { Role as EntityRole, Skeleton } from "@keel-engine/entity";
import type { EntitySocket } from "@keel-engine/entity";
import { entityRoleOf } from "./look.ts";
import { autoRig } from "./rig.ts";
import type { RigEdits, VoxelSpec } from "./rig.ts";
import { loadVoxels, storeVoxels } from "./store.ts";
import type { VoxelModel } from "./voxels.ts";
import { datan2, dhypot } from "@keel-engine/core";

type V3 = [number, number, number];
/** A voxel body's skin on a posed skeleton: pieces by bone (part) and entity role. */
export interface VoxelBodySkin {
  readonly capsules: { a: V3; b: V3; r: number; part: string; role: EntityRole }[];
  readonly boxes: { c: V3; h: V3; yaw: number; part: string; role: EntityRole }[];
}
/** A voxel model as an explicit body (bake's ExplicitBody). */
export interface VoxelBody {
  readonly spec: VoxelSpec;
  readonly skin: (skel: Skeleton) => VoxelBodySkin;
  readonly sockets: Readonly<Record<string, EntitySocket>>;
  /** The model's codec document (VOXELS). */
  readonly doc: Uint8Array;
}

/** A voxel model (or its stored bytes) as an explicit body: auto-rigged (with `rig` edits), its skin through the bones. */
export function voxelBody(model: VoxelModel | Uint8Array, { rig: edits = {} }: { readonly rig?: RigEdits } = {}): VoxelBody {
  const m = model instanceof Uint8Array ? loadVoxels(model) : model;
  const doc = model instanceof Uint8Array ? model : storeVoxels(m);
  const rig = autoRig(m, edits);
  const skin = rig.spec.voxel.skin;
  return {
    spec: rig.spec, sockets: rig.sockets, doc,
    skin(skel) {
      const out: VoxelBodySkin = { capsules: [], boxes: [] };
      const W = (bone: string, p: readonly number[]): V3 => {
        const b = skel.bones[bone]!;
        const q = b.m;
        return [b.p[0] + q[0] * p[0]! + q[1] * p[1]! + q[2] * p[2]!, b.p[1] + q[3] * p[0]! + q[4] * p[1]! + q[5] * p[2]!, b.p[2] + q[6] * p[0]! + q[7] * p[1]! + q[8] * p[2]!];
      };
      for (const bx of skin.boxes) {
        const b = skel.bones[bx.bone];
        if (!b) continue;
        const q = b.m;
        // (Boxes turn about y only, as poseVoxels turns them: the bone's heading, from its front -- or its right, when its front points up or down.)
        const yaw = dhypot(q[2], q[8]) > 0.3 ? datan2(q[2], q[8]) : datan2(q[0], q[6]) - Math.PI / 2;
        out.boxes.push({ c: W(bx.bone, bx.c), h: [bx.h[0], bx.h[1], bx.h[2]], yaw, part: bx.bone, role: entityRoleOf(bx.role) });
      }
      for (const c of skin.capsules) {
        if (!skel.bones[c.bone]) continue;
        out.capsules.push({ a: W(c.bone, c.a), b: W(c.bone, c.b), r: c.r, part: c.bone, role: entityRoleOf(c.role) });
      }
      return out;
    },
  };
}

/** A part reader for hybrid records (bake's PartReader): VOXELS documents as explicit bodies. */
export const voxelBodyReader = ({ rig }: { readonly rig?: RigEdits } = {}) => ({
  schema: VOXELS,
  body: (doc: Uint8Array): VoxelBody => voxelBody(doc, rig ? { rig } : {}),
});
