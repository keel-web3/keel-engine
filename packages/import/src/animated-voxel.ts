/** Source-driven rigid/skinned voxel compiler with sampled morph displacement. */
import { packAsset } from './asset-binary-v3.ts';
import { buildFromPackage as buildNative } from './asset-replay-v6.ts';
import { parseGltf } from './gltf.ts';
import { soupOf } from './scene.ts';
import { prepareVoxelMorphs } from './animated-voxel-morph.ts';
import { voxelize } from './voxelize.ts';
import { encodeBuffer } from './asset-buffer-codec.ts';
import { encodeVoxelSnapshot, VOXEL_SNAPSHOT_MAX_CELLS } from './styled-voxel-codec.ts';
import { decodeTexturePixels } from './optimization/textures.ts';
import { ANIMATED_VOXEL_FORMAT, MORPH_VOXEL_FORMAT, buildAnimatedVoxelAsset } from './animated-voxel-replay.ts';
import { allocateVoxelBudget, voxelCubeWorkingBytes, voxelGridWorkingBytes, VOXEL_REPLAY_MEMORY_BYTES, VoxelResourceLimitError } from './voxel-budget.ts';
export { VoxelResourceLimitError } from './voxel-budget.ts';
export { ANIMATED_VOXEL_FORMAT, buildAnimatedVoxelAsset, buildAnimatedVoxelPackage } from './animated-voxel-replay.ts';
const AXES = { up: '+y', front: '+z', handed: 'left' } as const;
const components: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
function wire(a: ArrayBufferView, width = 1) { const r = encodeBuffer(bytes(a), { stride: width * (a as any).BYTES_PER_ELEMENT, componentBytes: (a as any).BYTES_PER_ELEMENT }); return { codec: r.codec, parameters: r.parameters, sourceLength: r.sourceLength, data: r.data }; }
export interface AnimatedVoxelSettings {
  packageBytes: Uint8Array; voxels?: number; maxCubes?: number;
  budgetPolicy?: 'force-target' | 'preserve-quality';
  /** Conservative working-memory ceiling, including expanded geometry. */
  memoryBudgetBytes?: number;
  fill?: 'none' | 'flood' | 'parity'; allowOpaqueApproximation?: boolean; dracoDecoder?: any;
  onProgress?: (event: { stage: string; done: number; total: number }) => void;
}
export async function compileAnimatedVoxels(input: AnimatedVoxelSettings) {
  input.onProgress?.({ stage: 'voxel-source-replay', done: 0, total: 1 });
  const started = performance.now(), source = await buildNative(input.packageBytes, { dracoDecoder: input.dracoDecoder }), j = source.scene.json;
  if ((j.animations ?? []).some((a: any) => a.channels.some((c: any) => !['translation', 'rotation', 'scale', 'weights'].includes(c.target?.path)))) throw Error('Animated voxels support skeletal, node TRS and morph-weight clips; other animation paths are unsupported');
  if ((j.meshes ?? []).some((m: any) => m.primitives.some((p: any) => p.attributes?.JOINTS_1 !== undefined))) throw Error('Animated voxels currently support four source joint influences per vertex');
  if (!input.allowOpaqueApproximation && (j.materials ?? []).some((m: any) => m.alphaMode && m.alphaMode !== 'OPAQUE')) throw Error('Animated voxel colors are opaque; transparent/masked materials require explicit opaque approximation');
  const voxels = input.voxels ?? 32, maxCubes = input.maxCubes ?? 12000, budgetPolicy = input.budgetPolicy ?? 'preserve-quality';
  const requestedMemoryBudgetBytes = input.memoryBudgetBytes ?? VOXEL_REPLAY_MEMORY_BYTES, memoryBudgetBytes = requestedMemoryBudgetBytes;
  if (![voxels, maxCubes, requestedMemoryBudgetBytes].every(v => Number.isSafeInteger(v) && v > 0) || !['force-target', 'preserve-quality'].includes(budgetPolicy)) throw Error('Animated voxel dimensions, cube budget and memory budget must be positive safe integers with an explicit supported budget policy');
  const baseParsed = parseGltf(source.glb, { decodeImage: (data, mimeType) => decodeTexturePixels({ data, mimeType, sourceIndex: 0 }) });
  if (baseParsed.warnings.length) throw Error('Animated voxel parser warning: ' + baseParsed.warnings.join('; '));
  const { parsed, bindings } = prepareVoxelMorphs(baseParsed, j, source.accessors);
  if ((j.animations ?? []).some((a: any) => a.channels.some((c: any) => c.target.path === 'weights' && !bindings.has(c.target.node)))) throw Error('Animated voxel weight track targets an unavailable surface');
  const soup = soupOf(parsed, { axes: AXES }), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  if (!soup.count) throw Error('No nondegenerate source surface could be voxelized');
  for (let i = 0; i < soup.positions.length; i++) { const axis = i % 3; lo[axis] = Math.min(lo[axis]!, soup.positions[i]!); hi[axis] = Math.max(hi[axis]!, soup.positions[i]!); }
  const longest = Math.max(...hi.map((v, i) => v - lo[i]!), 1e-9), fill = input.fill ?? 'none';
  const nodeBounds = new Map<number, { min: number[]; max: number[]; triangles: number }>();
  for (let triangle = 0; triangle < soup.count; triangle++) {
    const node = soup.node[triangle]!, bounds = nodeBounds.get(node) ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], triangles: 0 }; bounds.triangles++;
    for (let corner = 0; corner < 3; corner++) for (let axis = 0; axis < 3; axis++) { const v = soup.positions[triangle * 9 + corner * 3 + axis]!; bounds.min[axis] = Math.min(bounds.min[axis]!, v); bounds.max[axis] = Math.max(bounds.max[axis]!, v); }
    nodeBounds.set(node, bounds);
  }
  const partNodes = [...nodeBounds.keys()].sort((a, b) => a - b), sourceWorkingBytes = source.glb.byteLength + source.accessors.reduce((n: number, a: ArrayBufferView) => n + a.byteLength * 2, 0) + source.images.reduce((n: number, image: any) => n + image.data.byteLength, 0) + Object.values(soup).reduce<number>((n, value) => n + (ArrayBuffer.isView(value) ? value.byteLength * 2 : 0), 0) + [...bindings.values()].reduce((n, binding) => n + binding.corners.reduce((sum, array) => sum + array.byteLength, 0), 0);
  const bytesPerCube = Math.max(...partNodes.map(node => voxelCubeWorkingBytes(parsed.nodes[node]!.skin !== undefined, bindings.get(node)?.weights.length ?? 0)));
  const preflight = (grid: number) => {
    const unit = longest / grid;
    const parts = partNodes.map(node => {
      const bounds = nodeBounds.get(node)!, size = bounds.max.map((v, axis) => Math.max(1, Math.ceil((v - bounds.min[axis]!) / unit - 1e-6))), cells = size.reduce((n, v) => n * v, 1);
      return { node, size, cells, estimatedWorkingBytes: voxelGridWorkingBytes(size, true, bindings.has(node), fill) };
    });
    const totalCells = parts.reduce((n, p) => n + p.cells, 0), possibleCubes = Math.min(maxCubes, totalCells), gridWorkingBytes = Math.max(...parts.map(p => p.estimatedWorkingBytes)), estimatedWorkingBytes = sourceWorkingBytes + gridWorkingBytes + possibleCubes * bytesPerCube;
    return { grid, unit, parts, totalCells, possibleCubes, gridWorkingBytes, estimatedWorkingBytes, fits: parts.every(p => Number.isSafeInteger(p.cells) && p.cells <= VOXEL_SNAPSHOT_MAX_CELLS) && estimatedWorkingBytes <= memoryBudgetBytes };
  };
  const requestedPreflight = preflight(voxels);
  const budgetContext = { requestedGrid: voxels, requestedMaxCubes: maxCubes, requestedMemoryBudgetBytes, memoryBudgetBytes, runtimeReplayMemoryBudgetBytes: memoryBudgetBytes, memoryBudgetClampedByRuntime: false };
  let acceptedPreflight = requestedPreflight;
  if (!requestedPreflight.fits) {
    if (!preflight(1).fits) throw new VoxelResourceLimitError('Source data and the minimum voxel output exceed the working-memory budget', { ...budgetContext, ...preflight(1), adjustments: Number.isSafeInteger(Math.ceil(preflight(1).estimatedWorkingBytes)) ? [{ control: 'memoryBudgetBytes', value: Math.ceil(preflight(1).estimatedWorkingBytes), reason: 'Minimum source/grid/output working-memory estimate.' }] : [], limitingResource: 'requested-working-memory' });
    let lower = 1, upper = voxels;
    while (lower < upper) { const middle = lower + Math.ceil((upper - lower) / 2); if (preflight(middle).fits) lower = middle; else upper = middle - 1; }
    if (budgetPolicy === 'preserve-quality') {
      const adjustments: Array<{ control: string; value: number; reason: string }> = [{ control: 'voxels', value: lower, reason: 'Explicitly reduce the grid to fit the current memory budget; this changes quality.' }];
      if (Number.isSafeInteger(Math.ceil(requestedPreflight.estimatedWorkingBytes)) && requestedPreflight.parts.every(p => Number.isSafeInteger(p.cells) && p.cells <= VOXEL_SNAPSHOT_MAX_CELLS)) adjustments.unshift({ control: 'memoryBudgetBytes', value: Math.ceil(requestedPreflight.estimatedWorkingBytes), reason: 'Increase working memory to retain the requested grid.' });
      throw new VoxelResourceLimitError('Requested voxel grid exceeds the working-memory/transport budget; preserve-quality does not resize it', { ...budgetContext, ...requestedPreflight, adjustments, limitingResource: 'requested-working-memory', estimation: 'Conservative occupied-cell upper bound, dense working arrays, source data, and expanded geometry.' });
    }
    acceptedPreflight = preflight(lower);
  }
  const unit = acceptedPreflight.unit, effectiveMaxCubes = Math.min(maxCubes, acceptedPreflight.totalCells), allocated = allocateVoxelBudget(partNodes.map(node => nodeBounds.get(node)!.triangles), effectiveMaxCubes), quotas = new Map(partNodes.map((node, i) => [node, allocated[i]!]));
  const partReports: Array<{ node: number; targetCubes: number | null; occupiedBeforePruning: number | null; achievedCubes: number; reason: string }> = [];
  const scene: any = { asset: structuredClone(j.asset), scene: j.scene ?? 0, scenes: structuredClone(j.scenes ?? [{ nodes: [] }]), nodes: structuredClone(j.nodes ?? []), skins: structuredClone(j.skins ?? []), animations: structuredClone(j.animations ?? []) };
  for (const node of scene.nodes) { delete node.mesh; delete node.camera; delete node.weights; if (node.extensions) throw Error('Animated voxel node extensions are unsupported'); }
  const ids = new Set<number>(); for (const skin of scene.skins) if (skin.inverseBindMatrices !== undefined) ids.add(skin.inverseBindMatrices);
  for (const animation of scene.animations) for (const sampler of animation.samplers) { ids.add(sampler.input); ids.add(sampler.output); }
  const oldIds = [...ids].sort((a, b) => a - b), remap = new Map(oldIds.map((id, i) => [id, i]));
  const motion = oldIds.map(id => { const descriptor = j.accessors[id], array = source.accessors[id]; if (!descriptor || !array) throw Error('Missing source motion accessor'); return { type: descriptor.type, componentType: descriptor.componentType, count: descriptor.count, normalized: descriptor.normalized === true, ...(descriptor.min ? { min: descriptor.min } : {}), ...(descriptor.max ? { max: descriptor.max } : {}), buffer: wire(array, components[descriptor.type] ?? 1) }; });
  for (const skin of scene.skins) if (skin.inverseBindMatrices !== undefined) skin.inverseBindMatrices = remap.get(skin.inverseBindMatrices);
  for (const animation of scene.animations) for (const sampler of animation.samplers) { sampler.input = remap.get(sampler.input); sampler.output = remap.get(sampler.output); }
  const parts: any[] = []; let total = 0, maxDiscardedWeight = 0;
  for (let ni = 0; ni < parsed.nodes.length; ni++) {
    input.onProgress?.({ stage: 'voxel-bindings', done: ni, total: parsed.nodes.length });
    const owner = parsed.nodes[ni]!; if (owner.mesh === undefined) continue;
    if (budgetPolicy === 'force-target' && !quotas.get(ni)) { partReports.push({ node: ni, targetCubes: 0, occupiedBeforePruning: null, achievedCubes: 0, reason: 'Global cube allocation assigned zero to this part; voxelization skipped.' }); continue; }
    const nodes = parsed.nodes.map((n, i) => { const result = { ...n }; if (i !== ni) delete result.mesh; return result; });
    const morph = bindings.get(ni);
    const grid = voxelize({ ...parsed, nodes }, { unit, axes: AXES, fill, surface: 'conservative', maxCells: VOXEL_SNAPSHOT_MAX_CELLS, maxWorkingBytes: acceptedPreflight.gridWorkingBytes, retainSkinning: true, retainSurfaceBindings: !!morph });
    const occupied = grid.occ.reduce((n, v) => n + Number(v > 0), 0), quota = budgetPolicy === 'force-target' ? Math.min(occupied, quotas.get(ni) ?? 0) : occupied;
    if (budgetPolicy === 'preserve-quality' && total + occupied > maxCubes) throw new VoxelResourceLimitError('Requested voxel result exceeds the cube budget; preserve-quality does not prune it', { ...budgetContext, requiredCubesAtLeast: total + occupied, node: ni, estimatedWorkingBytes: sourceWorkingBytes + acceptedPreflight.gridWorkingBytes + (total + occupied) * bytesPerCube, limitingResource: 'requested-cube-budget', adjustments: [{ control: 'maxCubes', value: total + occupied, reason: 'Minimum cells needed by the parts examined so far; remaining parts may require more.' }] });
    const indices: number[] = [], colors: number[] = [], js: number[] = [], ws: number[] = [], skin = owner.skin === undefined ? null : parsed.skins[owner.skin]!, slots = skin ? new Map(skin.joints.map((n, i) => [n, i])) : null;
    const morphs = morph?.corners.map(() => [] as number[]);
    let ordinal = 0;
    for (let cell = 0; cell < grid.occ.length; cell++) if (grid.occ[cell]) {
      const take = ordinal++ === Math.floor((indices.length + .5) * occupied / quota);
      if (quota < occupied && !take) continue;
      indices.push(cell); colors.push(...grid.colour.subarray(cell * 3, cell * 3 + 3));
      if (skin) for (let k = 0; k < 4; k++) { const w = grid.skinning!.weights[cell * 4 + k]!, joint = grid.skinning!.joints[cell * 4 + k]!; if (w && !slots!.has(joint)) throw Error('Transferred voxel joint is outside source skin'); js.push(w ? slots!.get(joint)! : 0); ws.push(w); }
      if (morph) {
        const binding = grid.surfaceBindings!, triangle = binding.triangles[cell]!;
        if (triangle < 0) throw Error('Animated voxel has no morph surface binding');
        for (let target = 0; target < morph.corners.length; target++) for (let axis = 0; axis < 3; axis++) {
          let delta = 0; for (let corner = 0; corner < 3; corner++) delta += morph.corners[target]![(triangle * 3 + corner) * 3 + axis]! * binding.barycentrics[cell * 3 + corner]!;
          morphs![target]!.push(Math.fround(delta));
        }
      }
      maxDiscardedWeight = Math.max(maxDiscardedWeight, grid.skinning!.discardedWeight[cell]!);
    }
    partReports.push({ node: ni, targetCubes: budgetPolicy === 'force-target' ? quotas.get(ni)! : null, occupiedBeforePruning: occupied, achievedCubes: indices.length, reason: indices.length < occupied ? 'Deterministic spatial cell selection enforces the allocated cube cap; missing surface and volume are intentional.' : 'All occupied cells at the achieved grid were retained.' });
    if (!indices.length) continue; total += indices.length; if (total > maxCubes) throw Error('Animated voxel hard cube budget invariant failed');
    const snapshot = encodeVoxelSnapshot({ version: 1, kind: 'keel-static-voxel-style', coordinateSpace: 'source-world', colorSpace: 'linear-srgb', pose: 'static', size: grid.size, origin: grid.origin, unit: grid.unit, indices, colors }, { maxWorkingBytes: memoryBudgetBytes }).recipe;
    parts.push({ node: ni, snapshot, ...(morph ? { morphWeights: morph.weights, morphs: morphs!.map(delta => wire(Float32Array.from(delta), 3)), ...(morph.names ? { morphTargetNames: morph.names } : {}) } : {}), ...(skin ? { joints: wire(Uint16Array.from(js), 4), weights: wire(Float32Array.from(ws), 4) } : {}) });
  }
  if (!parts.length) throw Error('No nondegenerate source surface could be voxelized');
  const retainedNodes = new Set(parts.map(part => part.node)), removedWeightChannels: Array<{ clip: number; name: string | null; channel: number; node: number; sampler: number }> = [], removedClips: Array<{ clip: number; name: string | null }> = [];
  if (budgetPolicy === 'force-target') scene.animations = scene.animations.filter((animation: any, clip: number) => {
    animation.channels = animation.channels.filter((channel: any, index: number) => {
      if (channel.target.path !== 'weights' || retainedNodes.has(channel.target.node)) return true;
      removedWeightChannels.push({ clip, name: animation.name ?? null, channel: index, node: channel.target.node, sampler: channel.sampler }); return false;
    });
    if (!animation.channels.length) { removedClips.push({ clip, name: animation.name ?? null }); return false; } return true;
  });
  input.onProgress?.({ stage: 'voxel-animation-replay', done: 0, total: 1 });
  const recipe = { format: bindings.size ? MORPH_VOXEL_FORMAT : ANIMATED_VOXEL_FORMAT, version: bindings.size ? 2 : 1, scene, motion, parts }, packageBytes = packAsset(recipe), replay = await buildAnimatedVoxelAsset(recipe, { maxWorkingBytes: memoryBudgetBytes });
  for (let i = 0; i < oldIds.length; i++) if (!same(bytes(source.accessors[oldIds[i]!]), bytes(replay.accessors[i]))) throw Error('Source rig/clip accessor changed');
  const budget = { ...budgetContext, policy: budgetPolicy, achievedGrid: acceptedPreflight.grid, gridReduced: voxels !== acceptedPreflight.grid, effectiveMaxCubes, achievedCubes: total, cubeTargetMet: total <= maxCubes, sourceWorkingBytes, estimatedWorkingBytes: acceptedPreflight.estimatedWorkingBytes, requestedEstimatedWorkingBytes: requestedPreflight.estimatedWorkingBytes, generatedBytesPerCubeUpperBound: bytesPerCube, parts: partReports, removedWeightChannels, removedClips, estimation: 'Conservative full-occupancy bound; sequential dense grids and bounded selected-cell arrays, including source and expanded replay memory.' };
  return { recipe, packageBytes, ...replay, report: { mode: 'animated-voxel-lossy', budget, sourceClips: (j.animations ?? []).length, outputClips: scene.animations.length, sourceSkins: scene.skins.length, cubes: total, parts: parts.length, unit, maxDiscardedWeight, restMaxError: replay.restMaxError, rigAndClipDataExact: !removedWeightChannels.length, sourceMotionAccessorBytesExact: true, sourceGeometryAndTexturesRetained: false, morphAnimationSupported: true, morphTargets: [...bindings.values()].reduce((n, m) => n + m.weights.length, 0), morphTransfer: 'nearest-source-triangle-barycentric-displacement', warnings: [removedWeightChannels.length ? `${removedWeightChannels.length} morph-weight channels targeted parts assigned zero cubes and were removed; ${removedClips.length} clips became empty and were removed. Original sampler arrays remain stored byte-exactly. See budget.removedWeightChannels and budget.removedClips.` : 'Source rig, TRS and morph-weight keyframes are retained; voxel skin weights are resampled to cells and limited to four influences.', 'Cubes may deform and gaps can appear under animation. This is not an exact source-surface reconstruction.', 'Morph position displacement is sampled per cube at its nearest source triangle, before skinning. Cubes translate per target; sub-cell facial detail and source normal/tangent morph shading are not retained. Singular rest transforms are unsupported; static output is a separate explicit choice.', ...(budgetPolicy === 'force-target' ? ['Target-first mode may reduce the requested grid to fit working memory and discard cells or whole parts to enforce the global cube cap. Shape and animated appearance may become unrecognizable.'] : []), ...(input.allowOpaqueApproximation ? ['Source transparency/masking is approximated by opaque voxel colors.'] : [])] }, timings: { total: performance.now() - started } };
}
