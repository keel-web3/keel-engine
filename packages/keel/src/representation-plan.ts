/** Host-only selection by complete emitted graph cost, with a bounded search.
 * Candidate values are opaque: encoders/construction compilers own equivalence.
 * Logical resources remain separate and each helper is charged once by identity.
 */
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

export interface RepresentationCandidate<T> {
  readonly id: string;
  readonly value: T;
  readonly requires?: readonly string[];
}
export interface RepresentationAsset<T> {
  readonly id: string;
  readonly candidates: readonly RepresentationCandidate<T>[];
}
export interface RepresentationDependency {
  readonly id: string;
  readonly requires?: readonly string[];
}
export interface RepresentationSelection<T> {
  readonly assets: readonly { readonly id: string; readonly candidate: RepresentationCandidate<T> }[];
  readonly dependencies: readonly string[];
}
export interface CostResource {
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly scope: 'shared' | 'creator';
  /** Already-packed resources use none; browser source units use their codec. */
  readonly compression: 'none' | 'gzip' | 'brotli';
  /** Capabilities bundled into this resource, established by the target builder. */
  readonly provides?: readonly string[];
}
export interface ResourceCost {
  readonly id: string;
  readonly rawBytes: number;
  readonly storedBytes: number;
  readonly sha256: string;
  readonly scope: 'shared' | 'creator';
  readonly compression: CostResource['compression'];
  readonly provides: readonly string[];
}
export interface GraphCost {
  readonly fullBytes: number;
  readonly creatorBytes: number;
  readonly resources: readonly ResourceCost[];
}
export interface RepresentationPlanOptions<T> {
  readonly assets: readonly RepresentationAsset<T>[];
  readonly dependencies?: readonly RepresentationDependency[];
  readonly baseline?: Readonly<Record<string, string>>;
  readonly objective?: 'full' | 'creator';
  readonly maxEvaluations?: number;
  readonly beamWidth?: number;
  /** Return complete logical resources, including shell/header/license/glue.
   * Shared helpers must be separate resources or included in bundled source.
   * Never return isolated per-asset estimates for a concatenated program.
   */
  readonly build: (selection: RepresentationSelection<T>) => Promise<readonly CostResource[]>;
  /** Run the target's reconstruction or behavior checks before counting a trial. */
  readonly validate: (selection: RepresentationSelection<T>) => Promise<boolean>;
}

function compareIndices(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}
function validId(id: string): boolean { return typeof id === 'string' && id.length > 0 && id.length <= 256; }
function fail(message: string): never { throw Error('Representation planner: ' + message); }

export function measureResourceGraph(resources: readonly CostResource[]): GraphCost {
  return measureGraph(resources);
}
function measureGraph(resources: readonly CostResource[], cache?: Map<string, number>): GraphCost {
  const ids = new Set<string>(), rows: ResourceCost[] = [];
  let fullBytes = 0, creatorBytes = 0;
  for (const resource of resources) {
    if (!validId(resource.id) || ids.has(resource.id)) fail('duplicate or invalid resource identity');
    ids.add(resource.id);
    if (!(resource.bytes instanceof Uint8Array) || !['shared', 'creator'].includes(resource.scope)) fail('invalid resource');
    const sha256 = createHash('sha256').update(resource.bytes).digest('hex');
    const key = sha256 + ':' + resource.compression;
    let storedBytes = cache?.get(key);
    if (storedBytes === undefined) {
      const stored = resource.compression === 'none' ? resource.bytes
      : resource.compression === 'gzip' ? gzipSync(resource.bytes, { level: 9 })
      : resource.compression === 'brotli' ? brotliCompressSync(resource.bytes, { params: {
        [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 22,
      } }) : fail('unsupported target compression');
      storedBytes = stored.byteLength;
      // Cache content identities, never mutable buffer identities. Bound host memory.
      if (cache !== undefined && cache.size < 4096) cache.set(key, storedBytes);
    }
    fullBytes += storedBytes;
    if (resource.scope === 'creator') creatorBytes += storedBytes;
    const provides = [...new Set(resource.provides ?? [])];
    if (provides.some(id => !validId(id))) fail('invalid provided capability');
    rows.push({ id: resource.id, scope: resource.scope, compression: resource.compression, provides,
      rawBytes: resource.bytes.byteLength, storedBytes,
      sha256 });
  }
  return { fullBytes, creatorBytes, resources: rows };
}

export async function planRepresentations<T>(options: RepresentationPlanOptions<T>) {
  const limit = options.maxEvaluations ?? 32, objective = options.objective ?? 'full', width = options.beamWidth ?? 4;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 4096 || !['full', 'creator'].includes(objective)) fail('invalid search bounds');
  if (!Number.isSafeInteger(width) || width < 1 || width > 64) fail('invalid beam width');
  if (!options.assets.length || options.assets.length > 4096) fail('invalid asset count');
  const assets = options.assets, assetIds = new Set<string>(), dependencies = new Map<string, RepresentationDependency>();
  for (const dependency of options.dependencies ?? []) {
    if (!validId(dependency.id) || dependencies.has(dependency.id)) fail('duplicate or invalid dependency');
    dependencies.set(dependency.id, dependency);
  }
  if (dependencies.size > 4096) fail('too many dependencies');
  const indegrees = new Map<string, number>(), parents = new Map<string, string[]>();
  for (const dependency of dependencies.values()) {
    const children = [...new Set(dependency.requires ?? [])];
    indegrees.set(dependency.id, children.length);
    for (const id of children) {
      if (!dependencies.has(id)) fail('unknown dependency ' + id);
      const list = parents.get(id) ?? []; list.push(dependency.id); parents.set(id, list);
    }
  }
  // Iterative topological validation handles deep dependency chains without recursion.
  const queue = [...indegrees].filter(([, count]) => count === 0).map(([id]) => id);
  for (let n = 0; n < queue.length; n++) for (const parent of parents.get(queue[n]!) ?? []) {
    const left = indegrees.get(parent)! - 1; indegrees.set(parent, left); if (left === 0) queue.push(parent);
  }
  if (queue.length !== dependencies.size) fail('cyclic dependencies');
  const choice = assets.map(asset => {
    if (!validId(asset.id) || assetIds.has(asset.id) || !asset.candidates.length || asset.candidates.length > 256) fail('invalid asset or candidates');
    assetIds.add(asset.id);
    const ids = new Set<string>();
    for (const candidate of asset.candidates) {
      if (!validId(candidate.id) || ids.has(candidate.id)) fail('duplicate or invalid candidate');
      ids.add(candidate.id);
      for (const id of candidate.requires ?? []) if (!dependencies.has(id)) fail('unknown candidate dependency ' + id);
    }
    const baseline = options.baseline !== undefined && Object.hasOwn(options.baseline, asset.id) ? options.baseline[asset.id] : undefined;
    const at = baseline === undefined ? 0 : asset.candidates.findIndex(candidate => candidate.id === baseline);
    if (at < 0) fail('missing baseline candidate');
    return at;
  });
  for (const id of Object.keys(options.baseline ?? {})) if (!assetIds.has(id)) fail('unknown baseline asset');
  const selection = (indices: readonly number[]): RepresentationSelection<T> => {
    const selected = assets.map((asset, at) => ({ id: asset.id, candidate: asset.candidates[indices[at]!]! }));
    const closure = new Set<string>(), pending = selected.flatMap(asset => [...(asset.candidate.requires ?? [])]);
    for (let at = 0; at < pending.length; at++) {
      const id = pending[at]!; if (closure.has(id)) continue;
      closure.add(id); pending.push(...(dependencies.get(id)!.requires ?? []));
    }
    return { assets: selected, dependencies: queue.filter(id => closure.has(id)) };
  };
  type Trial = { indices: readonly number[]; selection: RepresentationSelection<T>; cost: GraphCost | null };
  const trials: Trial[] = [], cache = new Map<string, Trial>(), compressedSizes = new Map<string, number>();
  const evaluate = async (indices: readonly number[]): Promise<Trial | undefined> => {
    const key = JSON.stringify(indices), prior = cache.get(key); if (prior) return prior;
    if (trials.length === limit) return undefined;
    const chosen = selection(indices);
    const valid = await options.validate(chosen);
    if (typeof valid !== 'boolean') fail('validator must return boolean');
    const trial = { indices: indices.slice(), selection: chosen, cost: valid ? measureGraph(await options.build(chosen), compressedSizes) : null };
    if (trial.cost) {
      const emitted = new Set(trial.cost.resources.flatMap(resource => [resource.id, ...resource.provides]));
      for (const asset of chosen.assets) if (!emitted.has(asset.id)) fail('build omitted asset ' + asset.id);
      for (const id of chosen.dependencies) if (!emitted.has(id)) fail('build omitted required helper ' + id);
    }
    trials.push(trial); cache.set(key, trial); return trial;
  };
  const baseline = await evaluate(choice); if (!baseline?.cost) fail('baseline validation failed');
  let best = baseline, beam: Trial[] = [baseline];
  const better = (cost: GraphCost, old: GraphCost): boolean => objective === 'full'
    ? cost.fullBytes < old.fullBytes
    : cost.creatorBytes < old.creatorBytes || (cost.creatorBytes === old.creatorBytes && cost.fullBytes < old.fullBytes);
  // Keep temporarily larger partial selections so multiple assets can amortize
  // a shared helper. A single-coordinate greedy search misses these joint wins.
  for (let at = 0; at < assets.length && trials.length < limit; at++) {
    const expanded = new Map<string, Trial>(beam.map(trial => [JSON.stringify(trial.indices), trial]));
    const order = assets[at]!.candidates.map((candidate, index) => ({ id: candidate.id, index })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const previous of beam) for (const { index } of order) {
      const candidate = previous.indices.slice(); candidate[at] = index;
      const trial = await evaluate(candidate);
      if (trial?.cost) {
        expanded.set(JSON.stringify(candidate), trial);
        if (better(trial.cost, best.cost!)) best = trial;
      }
    }
    beam = [...expanded.values()].sort((a, b) => {
      const key = objective === 'full' ? 'fullBytes' : 'creatorBytes';
      return a.cost![key] - b.cost![key] || a.cost!.fullBytes - b.cost!.fullBytes
        || compareIndices(a.indices, b.indices);
    }).slice(0, width);
  }
  return { selection: best.selection, cost: best.cost!, baselineCost: baseline.cost,
    savedFullBytes: baseline.cost.fullBytes - best.cost!.fullBytes,
    savedCreatorBytes: baseline.cost.creatorBytes - best.cost!.creatorBytes,
    evaluations: trials.length, limitReached: trials.length === limit, objective, trials,
    note: 'Bounded beam search; not a global-minimum proof. Costs depend on the complete resources returned by the target build.' };
}
