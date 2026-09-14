// A voxel creature as a runtime entity: defineEntity on the body contract its
// shape picked (or the one asked for), a build that varies the model by
// seed and rigs it, and its sockets -- so packs list it, attributes fit it,
// the animator drives it, like any of the engine's own.
//
//   export default entityFromVoxels(model, { id: "blocky-fox", variation: { scale: { legs: { region: "legs", y: [0.8, 1.2], anchor: "top" } } } });
//   const spec = def.build(S, pins);      // a VoxelSpec: an EntitySpec with its voxel skin
//   animator(spec).step(dt, body); poseVoxels(spec, anim.skeleton(), look);

import { contractOf } from "@keel-engine/entity";
import type { EntitySocket, Plan } from "@keel-engine/entity";
import { defineEntity } from "@keel-engine/runtime";
import type { Choice, EntityDef, Pins, Stream } from "@keel-engine/runtime";
import { analyseShape, autoRig } from "./rig.ts";
import type { RigEdits, VoxelSpec } from "./rig.ts";
import { applyVariation, variationChoices } from "./variation.ts";
import type { VariationRules } from "./variation.ts";
import type { VoxelModel } from "./voxels.ts";

export interface EntityOptions {
  readonly id: string;
  readonly title?: string;
  readonly tags?: readonly string[];
  /** Manual rig edits (plan, joints, assignments, sockets, limbs). The plan is fixed for every variant. */
  readonly rig?: RigEdits;
  readonly variation?: VariationRules;
}

/** An entity's build(S, pins) from a voxel model: varied by seed (pins win), auto-rigged with the edits. */
export function voxelEntity(model: VoxelModel, opts: Pick<EntityOptions, "rig" | "variation"> = {}): (S: Stream, pins: Pins) => VoxelSpec {
  const base = model.clone();
  const plan: Plan = opts.rig?.plan ?? analyseShape(base).plan;
  const edits: RigEdits = { ...(opts.rig ?? {}), plan };
  const memo = new Map<string, VoxelSpec>();
  // (The unvaried model rigs once, up front: a bad model fails where it's defined, not at first use.)
  const plain = autoRig(base, edits).spec;
  return (S, pins) => {
    if (!opts.variation) return plain;
    const v = applyVariation(base, opts.variation, S, pins);
    const key = JSON.stringify(v.picked);
    let spec = memo.get(key);
    if (!spec) {
      spec = autoRig(v.model, edits).spec;
      // (A few dozen variants kept: an army of one design rigs each variant once.)
      if (memo.size > 64) memo.delete(memo.keys().next().value!);
      memo.set(key, spec);
    }
    return spec;
  };
}

/** An entity's sockets: its contract's, from the rig, and any marked by hand. */
export const voxelSockets = (spec: VoxelSpec): Readonly<Record<string, EntitySocket>> => spec.voxel.sockets;

/** A runtime entity from a voxel model (see the top). */
export function entityFromVoxels(model: VoxelModel, opts: EntityOptions): EntityDef<VoxelSpec> {
  const plan: Plan = opts.rig?.plan ?? analyseShape(model).plan;
  const choices: Record<string, Choice> = opts.variation ? variationChoices(opts.variation) : {};
  return defineEntity<VoxelSpec>({
    id: opts.id,
    body: contractOf({ plan }).ref,
    ...(opts.title ? { title: opts.title } : {}),
    tags: [...(opts.tags ?? []), "voxel", plan],
    ...(Object.keys(choices).length ? { choices } : {}),
    build: voxelEntity(model, { rig: { ...(opts.rig ?? {}), plan }, ...(opts.variation ? { variation: opts.variation } : {}) }),
    sockets: voxelSockets,
  });
}
