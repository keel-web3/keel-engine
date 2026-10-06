// Host-only converter selection. Standalone storeModel retains its existing policy.
import { createHash } from 'node:crypto';
import { compileVoxelConstructionCandidates, loadModel } from '../../builder/src/construction.ts';
import { storeVoxels } from '../../builder/src/voxel-store.ts';
import type { VoxelModel } from '../../builder/src/voxels.ts';
import { planRepresentations } from './representation-plan.ts';
import type { RepresentationDependency, RepresentationPlanOptions, RepresentationSelection } from './representation-plan.ts';

export interface ModelConstructionCandidate { readonly kind: string; readonly bytes: Uint8Array }
export const MODEL_RUNTIME_DEPENDENCIES: readonly RepresentationDependency[] = [
  { id: 'model:voxels' },
  { id: 'model:construction', requires: ['model:voxels'] },
  { id: 'model:generator', requires: ['model:construction'] },
];
export type ModelPlanOptions = Pick<RepresentationPlanOptions<ModelConstructionCandidate>,
  'build' | 'objective' | 'maxEvaluations' | 'beamWidth' | 'baseline'> & {
  readonly models: readonly { readonly id: string; readonly model: VoxelModel }[];
  /** The target builder must provide these identities in its complete resource graph. */
  readonly dependencies?: readonly RepresentationDependency[];
  readonly requires?: (candidate: ModelConstructionCandidate, modelId: string) => readonly string[];
  /** Target decoder/render checks are additional to mandatory exact host replay. */
  readonly validate?: (selection: RepresentationSelection<ModelConstructionCandidate>) => Promise<boolean>;
};

/** Price every data representation together with the actual target runtime closure.
 * A build callback is mandatory: raw packet bytes alone cannot select a runtime.
 * Original model bytes include all voxel roles, metadata and groups.
 */
export async function planModelRepresentations(options: ModelPlanOptions) {
  const snapshots = new Map(options.models.map(({ id, model }) => [id, storeVoxels(model)]));
  const assets = options.models.map(({ id, model }) => ({ id,
    candidates: compileVoxelConstructionCandidates(model).map(value => ({ id: value.kind, value,
      requires: options.requires?.(value, id) ?? [value.kind === 'voxels' ? 'model:voxels'
        : value.kind === 'generator' ? 'model:generator' : 'model:construction'],
    })),
  }));
  // Match the ordinary converter's stable raw-byte tie policy for the baseline.
  const baseline = options.baseline ?? Object.fromEntries(assets.map(asset => [asset.id,
    asset.candidates.reduce((a, b) => b.value.bytes.length < a.value.bytes.length ? b : a).id,
  ]));
  const checked = new Map<ModelConstructionCandidate, { hash: string; valid: boolean }>();
  const exactReplay = (selection: RepresentationSelection<ModelConstructionCandidate>): boolean => selection.assets.every(asset => {
    const value = asset.candidate.value, hash = createHash('sha256').update(value.bytes).digest('hex'), prior = checked.get(value);
    if (prior?.hash === hash) return prior.valid;
    let valid = false;
    try { valid = Buffer.from(storeVoxels(loadModel(value.bytes))).equals(snapshots.get(asset.id)!); } catch { /* Unsupported or damaged candidates are excluded. */ }
    checked.set(value, { hash, valid }); return valid;
  });
  const result = await planRepresentations({ assets, baseline,
    dependencies: options.dependencies ?? MODEL_RUNTIME_DEPENDENCIES,
    ...(options.objective !== undefined ? { objective: options.objective } : {}),
    ...(options.maxEvaluations !== undefined ? { maxEvaluations: options.maxEvaluations } : {}),
    ...(options.beamWidth !== undefined ? { beamWidth: options.beamWidth } : {}),
    build: options.build,
    validate: async selection => exactReplay(selection) && (options.validate ? await options.validate(selection) : true),
  });
  // A target callback cannot invalidate chosen data after the first replay check.
  if (!exactReplay(result.selection)) throw Error('Model planner: selected data changed after validation');
  return result;
}
