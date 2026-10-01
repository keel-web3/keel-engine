/** Constructive voxel geometry attached to the original glTF rig and TRS clips.
 * Source surfaces/images are compile-time inputs, not retained in the recipe. */
import { unpackAsset } from './asset-binary-v3.ts';
import { writeNativeGlb } from './asset-native-base-v3.ts';
import { decodeBuffer } from './asset-buffer-codec.ts';
import { replayVoxelSnapshot } from './styled-voxel-codec.ts';
import { worldTransforms } from './scene.ts';
import { addBox, meshData } from './write.ts';
import { applyPoint, fromTRS, identity, invert4, mul4 } from './math.ts';
import type { Mat4 } from './math.ts';

export const ANIMATED_VOXEL_FORMAT = 'KEEL-RIGGED-VOXEL-V1';
const ctors: Record<number, any> = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const components: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function readWire(r: any, length: number): Uint8Array { if (!Number.isSafeInteger(length) || length < 0 || length > 64 * 1024 * 1024 || r?.sourceLength !== length || !(r.data instanceof Uint8Array)) throw Error('Invalid animated voxel buffer'); return decodeBuffer(r, length); }
function worlds(json: any): Mat4[] {
  const parents = new Array(json.nodes.length).fill(-1);
  json.nodes.forEach((n: any, i: number) => { for (const child of n.children ?? []) { if (!Number.isInteger(child) || child < 0 || child >= parents.length || parents[child] !== -1) throw Error('Invalid voxel rig hierarchy'); parents[child] = i; } });
  return worldTransforms(json.nodes.map((n: any, i: number) => ({ parent: parents[i], local: n.matrix ? Float64Array.from(n.matrix) : fromTRS(n.translation, n.rotation, n.scale) })));
}
function inverse(m: Mat4): Mat4 {
  const inv = invert4(m), proof = mul4(m, inv);
  if (Array.from(proof).some((v, i) => !Number.isFinite(v) || Math.abs(v - Number(i % 5 === 0)) > 1e-5)) throw Error('Animated voxels require a nonsingular rest transform');
  return inv;
}
function blended(jointMatrices: Mat4[], joints: number[], weights: number[]): Mat4 {
  const out = new Float64Array(16); out[15] = 1;
  for (let k = 0; k < 4; k++) {
    const weight = weights[k]!, matrix = jointMatrices[joints[k]!];
    if (!Number.isInteger(joints[k]) || joints[k]! < 0 || joints[k]! >= jointMatrices.length) throw Error('Invalid animated voxel joint slot');
    if (!Number.isFinite(weight) || weight < 0 || weight > 1 || (weight && !matrix)) throw Error('Invalid animated voxel influence');
    if (weight) for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) out[c * 4 + r]! += matrix![c * 4 + r]! * weight;
  }
  if (Math.abs(weights.reduce((n, w) => n + w, 0) - 1) > 1e-5) throw Error('Animated voxel weights must sum to one');
  return out;
}

export async function buildAnimatedVoxelAsset(recipe: any) {
  if (recipe?.format !== ANIMATED_VOXEL_FORMAT || recipe.version !== 1 || !Array.isArray(recipe.parts) || recipe.parts.length > 512 || !Array.isArray(recipe.motion) || recipe.motion.length > 8192) throw Error('Invalid animated voxel recipe');
  const json = structuredClone(recipe.scene);
  if (!Array.isArray(json?.nodes) || json.nodes.length > 10000 || !Array.isArray(json.skins) || json.skins.length > 512 || !Array.isArray(json.animations) || json.animations.length > 256) throw Error('Animated voxel scene limits exceeded');
  if (json.meshes || json.images || json.textures || json.buffers || json.bufferViews || json.accessors) throw Error('Animated voxel recipe must not retain source geometry/images');
  for (const node of json.nodes) {
    if (!node || typeof node !== 'object' || node.mesh !== undefined || node.weights !== undefined || node.extensions !== undefined) throw Error('Unsupported animated voxel node');
    if (node.matrix !== undefined && (node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined)) throw Error('Voxel node cannot combine matrix and TRS');
    for (const [key, size] of [['matrix', 16], ['translation', 3], ['rotation', 4], ['scale', 3]] as const) if (node[key] !== undefined && (!Array.isArray(node[key]) || node[key].length !== size || !node[key].every((v: any) => Number.isFinite(v) && Math.abs(v) <= 1e20))) throw Error('Invalid animated voxel transform');
  }
  let motionBytes = 0;
  const arrays: any[] = recipe.motion.map((r: any) => { const C = ctors[r.componentType], n = components[r.type]; if (!C || !n || !Number.isSafeInteger(r.count) || r.count < 0) throw Error('Invalid voxel motion descriptor'); const size = r.count * n * C.BYTES_PER_ELEMENT; motionBytes += size; if (motionBytes > 64 * 1024 * 1024) throw Error('Voxel motion budget exceeded'); return new C(readWire(r.buffer, size).buffer); });
  const validNode = (n: any) => Number.isInteger(n) && n >= 0 && n < json.nodes.length;
  if (!Array.isArray(json.scenes) || !Number.isInteger(json.scene) || !json.scenes[json.scene]) throw Error('Invalid voxel scene selection');
  for (const scene of json.scenes) if (!Array.isArray(scene?.nodes) || !scene.nodes.every(validNode)) throw Error('Invalid voxel scene roots');
  for (const node of json.nodes) if (node.skin !== undefined && (!Number.isInteger(node.skin) || !json.skins[node.skin])) throw Error('Invalid voxel node skin');
  for (const skin of json.skins) {
    if (!Array.isArray(skin?.joints) || !skin.joints.length || skin.joints.length > 65536 || !skin.joints.every(validNode) || new Set(skin.joints).size !== skin.joints.length || (skin.skeleton !== undefined && !validNode(skin.skeleton))) throw Error('Invalid animated voxel skin');
    if (skin.inverseBindMatrices !== undefined) { const d = recipe.motion[skin.inverseBindMatrices]; if (!Number.isInteger(skin.inverseBindMatrices) || d?.componentType !== 5126 || d.type !== 'MAT4' || d.count < skin.joints.length) throw Error('Invalid animated voxel inverse binds'); }
  }
  let channels = 0;
  for (const animation of json.animations) {
    if (!Array.isArray(animation?.samplers) || !Array.isArray(animation.channels) || animation.samplers.length > 10000 || (channels += animation.channels.length) > 32768) throw Error('Invalid animated voxel clip');
    const used = new Set<string>();
    for (const channel of animation.channels) {
      const target = channel?.target, sampler = animation.samplers[channel?.sampler], input = recipe.motion[sampler?.input], output = recipe.motion[sampler?.output];
      if (!validNode(target?.node) || !['translation', 'rotation', 'scale'].includes(target?.path) || !Number.isInteger(channel?.sampler) || !sampler || !Number.isInteger(sampler.input) || !Number.isInteger(sampler.output) || input?.componentType !== 5126 || input.type !== 'SCALAR' || input.count < 1 || output?.componentType !== 5126 || output.type !== (target.path === 'rotation' ? 'VEC4' : 'VEC3') || !['LINEAR', 'STEP', 'CUBICSPLINE'].includes(sampler.interpolation ?? 'LINEAR') || output.count !== input.count * (sampler.interpolation === 'CUBICSPLINE' ? 3 : 1)) throw Error('Invalid animated voxel track');
      const key = target.node + ':' + target.path; if (used.has(key)) throw Error('Duplicate animated voxel track'); used.add(key);
      const times = arrays[sampler.input]; for (let i = 0; i < times.length; i++) if (!Number.isFinite(times[i]) || times[i] < 0 || i && times[i] < times[i - 1]) throw Error('Invalid animated voxel key times');
    }
  }
  for (const array of arrays) for (const value of array) if (!Number.isFinite(value)) throw Error('Nonfinite animated voxel motion');
  json.accessors = recipe.motion.map((r: any) => ({ componentType: r.componentType, type: r.type, count: r.count, ...(r.normalized ? { normalized: true } : {}), ...(r.min ? { min: r.min } : {}), ...(r.max ? { max: r.max } : {}) }));
  const rest = worlds(json), seen = new Set<number>(), primitives: any[] = [];
  if (rest.some(m => Array.from(m).some(v => !Number.isFinite(v)))) throw Error('Nonfinite animated voxel world transform');
  const add = (a: any, type: string, componentType: number, bounds?: { min: number[]; max: number[] }) => { const id = arrays.length; arrays.push(a); json.accessors.push({ componentType, type, count: a.length / components[type]!, ...bounds }); return id; };
  json.materials = [{ name: 'Voxel sampled linear colors', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: .8 } }]; json.meshes = [];
  let cubes = 0, restMaxError = 0;
  for (const part of recipe.parts) {
    const node = part?.node;
    if (!Number.isInteger(node) || node < 0 || node >= json.nodes.length || seen.has(node) || json.nodes[node].mesh !== undefined) throw Error('Invalid voxel part owner'); seen.add(node);
    const snapshot = replayVoxelSnapshot(part.snapshot), count = snapshot.indices.length;
    cubes += count; if (cubes > 20000) throw Error('Animated voxel cube budget exceeded');
    const skinIndex = json.nodes[node].skin, skin = skinIndex === undefined ? null : json.skins[skinIndex];
    let joints: Uint16Array | null = null, weights: Float32Array | null = null, matrices: Mat4[] = [];
    if (skin) {
      if (!Array.isArray(skin.joints) || skin.joints.length > 65536) throw Error('Invalid voxel skin');
      const ibm = skin.inverseBindMatrices === undefined ? null : arrays[skin.inverseBindMatrices];
      if (ibm && ibm.length < skin.joints.length * 16) throw Error('Voxel inverse bind extent differs');
      matrices = skin.joints.map((j: number, i: number) => { if (!rest[j]) throw Error('Invalid voxel joint node'); return mul4(rest[j]!, ibm ? Float64Array.from(ibm.subarray(i * 16, i * 16 + 16)) : identity()); });
      joints = new Uint16Array(readWire(part.joints, count * 8).buffer); weights = new Float32Array(readWire(part.weights, count * 16).buffer);
    } else if (skinIndex !== undefined || part.joints || part.weights) throw Error('Voxel skin binding has no skin');
    const rigidInverse = skin ? null : inverse(rest[node]!), mesh = meshData();
    for (let i = 0; i < count; i++) {
      const cell = snapshot.indices[i]!, [sx, sy] = snapshot.size, center: [number, number, number] = [snapshot.origin[0] + (cell % sx + .5) * snapshot.unit, snapshot.origin[1] + (Math.floor(cell / sx) % sy + .5) * snapshot.unit, snapshot.origin[2] + (Math.floor(cell / (sx * sy)) + .5) * snapshot.unit];
      const js = joints ? Array.from(joints.subarray(i * 4, i * 4 + 4)) : [0, 0, 0, 0], ws = weights ? Array.from(weights.subarray(i * 4, i * 4 + 4)) : [1, 0, 0, 0];
      const bind = skin ? blended(matrices, js, ws) : rest[node]!, inv = rigidInverse ?? inverse(bind), start = mesh.positions.length;
      addBox(mesh, center, [snapshot.unit / 2, snapshot.unit / 2, snapshot.unit / 2], { colour: [...snapshot.colors.slice(i * 3, i * 3 + 3), 1], joints: js, weights: ws });
      for (let p = start; p < mesh.positions.length; p += 3) { const world = mesh.positions.slice(p, p + 3), local = applyPoint(inv, world).map(Math.fround), restored = applyPoint(bind, local); restMaxError = Math.max(restMaxError, Math.hypot(...restored.map((v, k) => v - world[k]!))); for (let k = 0; k < 3; k++) mesh.positions[p + k] = local[k]!; }
    }
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < mesh.positions.length; i++) { const axis = i % 3; min[axis] = Math.min(min[axis]!, mesh.positions[i]!); max[axis] = Math.max(max[axis]!, mesh.positions[i]!); }
    const attributes: any = { POSITION: add(Float32Array.from(mesh.positions), 'VEC3', 5126, { min, max }), COLOR_0: add(Float32Array.from(mesh.colours), 'VEC4', 5126) };
    if (skin) { attributes.JOINTS_0 = add(Uint16Array.from(mesh.joints), 'VEC4', 5123); attributes.WEIGHTS_0 = add(Float32Array.from(mesh.weights), 'VEC4', 5126); }
    const indices = add(Uint32Array.from(mesh.indices), 'SCALAR', 5125), meshId = json.meshes.length;
    json.meshes.push({ name: json.nodes[node].name ?? 'Animated voxel part', primitives: [{ attributes, indices, material: 0, mode: 4 }] }); json.nodes[node].mesh = meshId;
    primitives.push({ mesh: meshId, primitive: 0, mode: 4, material: 0, geometry: mesh, attributes, targets: [] });
  }
  const glb = writeNativeGlb(json, arrays, []), scene = { format: 'KEEL-NATIVE-SCENE', version: 2, json, accessors: arrays, images: [], primitives };
  return { glb, scene, accessors: arrays, images: [], cubes, restMaxError };
}

export async function buildAnimatedVoxelPackage(data: Uint8Array) { return buildAnimatedVoxelAsset(unpackAsset(data)); }
