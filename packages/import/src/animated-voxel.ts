/** Source-driven rigid/skinned voxel compiler. Morph animation is explicitly unsupported. */
import { packAsset } from './asset-binary-v3.ts';
import { buildFromPackage as buildNative } from './asset-replay-v6.ts';
import { parseGltf } from './gltf.ts';
import { soupOf } from './scene.ts';
import { voxelize } from './voxelize.ts';
import { encodeBuffer } from './asset-buffer-codec.ts';
import { encodeVoxelSnapshot } from './styled-voxel-codec.ts';
import { decodeTexturePixels } from './optimization/textures.ts';
import { ANIMATED_VOXEL_FORMAT, buildAnimatedVoxelAsset } from './animated-voxel-replay.ts';
export { ANIMATED_VOXEL_FORMAT, buildAnimatedVoxelAsset, buildAnimatedVoxelPackage } from './animated-voxel-replay.ts';
const AXES = { up: '+y', front: '+z', handed: 'left' } as const;
const components: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
function wire(a: ArrayBufferView, width = 1) { const r = encodeBuffer(bytes(a), { stride: width * (a as any).BYTES_PER_ELEMENT, componentBytes: (a as any).BYTES_PER_ELEMENT }); return { codec: r.codec, parameters: r.parameters, sourceLength: r.sourceLength, data: r.data }; }
export async function compileAnimatedVoxels(input: { packageBytes: Uint8Array; voxels?: number; maxCubes?: number; fill?: 'none' | 'flood' | 'parity'; allowOpaqueApproximation?: boolean; dracoDecoder?: any; onProgress?: (event: { stage: string; done: number; total: number }) => void }) {
  input.onProgress?.({ stage: 'voxel-source-replay', done: 0, total: 1 });
  const started = performance.now(), source = await buildNative(input.packageBytes, { dracoDecoder: input.dracoDecoder }), j = source.scene.json;
  if ((j.meshes ?? []).some((m: any) => m.primitives.some((p: any) => (p.targets ?? []).length)) || (j.animations ?? []).some((a: any) => a.channels.some((c: any) => !['translation', 'rotation', 'scale'].includes(c.target?.path)))) throw Error('Animated voxels currently support skeletal and node TRS clips; morph/other animation is unsupported. Choose an explicit static snapshot or keep the original/pixel/dither model.');
  if ((j.meshes ?? []).some((m: any) => m.primitives.some((p: any) => p.attributes?.JOINTS_1 !== undefined))) throw Error('Animated voxels currently support four source joint influences per vertex');
  if (!input.allowOpaqueApproximation && (j.materials ?? []).some((m: any) => m.alphaMode && m.alphaMode !== 'OPAQUE')) throw Error('Animated voxel colors are opaque; transparent/masked materials require explicit opaque approximation');
  const voxels = input.voxels ?? 32, maxCubes = input.maxCubes ?? 12000;
  if (!Number.isInteger(voxels) || voxels < 8 || voxels > 64 || !Number.isInteger(maxCubes) || maxCubes < 1 || maxCubes > 20000) throw Error('Invalid animated voxel quality limits');
  const parsed = parseGltf(source.glb, { decodeImage: (data, mimeType) => decodeTexturePixels({ data, mimeType, sourceIndex: 0 }) });
  if (parsed.warnings.length) throw Error('Animated voxel parser warning: ' + parsed.warnings.join('; '));
  const soup = soupOf(parsed, { axes: AXES }), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < soup.positions.length; i++) { const axis = i % 3; lo[axis] = Math.min(lo[axis]!, soup.positions[i]!); hi[axis] = Math.max(hi[axis]!, soup.positions[i]!); }
  const unit = Math.max(...hi.map((v, i) => v - lo[i]!), 1e-9) / voxels;
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
    const nodes = parsed.nodes.map((n, i) => { const result = { ...n }; if (i !== ni) delete result.mesh; return result; });
    const grid = voxelize({ ...parsed, nodes }, { unit, axes: AXES, fill: input.fill ?? 'none', surface: 'conservative', maxCells: 1000000, retainSkinning: true });
    const indices: number[] = [], colors: number[] = [], js: number[] = [], ws: number[] = [], skin = owner.skin === undefined ? null : parsed.skins[owner.skin]!, slots = skin ? new Map(skin.joints.map((n, i) => [n, i])) : null;
    for (let cell = 0; cell < grid.occ.length; cell++) if (grid.occ[cell]) {
      indices.push(cell); colors.push(...grid.colour.subarray(cell * 3, cell * 3 + 3));
      if (skin) for (let k = 0; k < 4; k++) { const w = grid.skinning!.weights[cell * 4 + k]!, joint = grid.skinning!.joints[cell * 4 + k]!; if (w && !slots!.has(joint)) throw Error('Transferred voxel joint is outside source skin'); js.push(w ? slots!.get(joint)! : 0); ws.push(w); }
      maxDiscardedWeight = Math.max(maxDiscardedWeight, grid.skinning!.discardedWeight[cell]!);
    }
    if (!indices.length) continue; total += indices.length; if (total > maxCubes) throw Error('Animated voxel cube budget exceeded; reduce resolution');
    const snapshot = encodeVoxelSnapshot({ version: 1, kind: 'keel-static-voxel-style', coordinateSpace: 'source-world', colorSpace: 'linear-srgb', pose: 'static', size: grid.size, origin: grid.origin, unit: grid.unit, indices, colors }).recipe;
    parts.push({ node: ni, snapshot, ...(skin ? { joints: wire(Uint16Array.from(js), 4), weights: wire(Float32Array.from(ws), 4) } : {}) });
  }
  if (!parts.length) throw Error('No nondegenerate source surface could be voxelized');
  input.onProgress?.({ stage: 'voxel-animation-replay', done: 0, total: 1 });
  const recipe = { format: ANIMATED_VOXEL_FORMAT, version: 1, scene, motion, parts }, packageBytes = packAsset(recipe), replay = await buildAnimatedVoxelAsset(recipe);
  for (let i = 0; i < oldIds.length; i++) if (!same(bytes(source.accessors[oldIds[i]!]), bytes(replay.accessors[i]))) throw Error('Source rig/clip accessor changed');
  return { recipe, packageBytes, ...replay, report: { mode: 'animated-voxel-lossy', sourceClips: scene.animations.length, sourceSkins: scene.skins.length, cubes: total, parts: parts.length, unit, maxDiscardedWeight, restMaxError: replay.restMaxError, rigAndClipDataExact: true, sourceGeometryAndTexturesRetained: false, morphAnimationSupported: false, warnings: ['Source rig and TRS keyframes are retained; voxel skin weights are resampled to cells and limited to four influences.', 'Cubes may deform and gaps can appear under animation. This is not an exact source-surface reconstruction.', 'Morph animation and singular rest transforms are unsupported; static output is a separate explicit choice.', ...(input.allowOpaqueApproximation ? ['Source transparency/masking is approximated by opaque voxel colors.'] : [])] }, timings: { total: performance.now() - started } };
}
