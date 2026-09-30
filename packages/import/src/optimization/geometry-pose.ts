import type { GltfJSON, NormalizedAccessor, NormalizedAsset } from '../asset-normalize-v3.ts';

/** A finite set of samples, not a bound on motion between samples. */
export interface GeometryPose {
  name: string;
  positions: Float32Array;
  node: number | null;
  animation: number | null;
  time: number | null;
}
export interface GeometryPoseOptions { samplesPerClip?: number }

export class UnsupportedGeometryPoseError extends Error {
  constructor(message: string) {
    super(`Geometry pose: ${message}`);
    this.name = 'UnsupportedGeometryPoseError';
  }
}

const fail = (message: string): never => { throw new UnsupportedGeometryPoseError(message); };
const IDENTITY = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const ARITY: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const ARRAY_TYPES: Record<number, string> = { 5120: 'Int8Array', 5121: 'Uint8Array', 5122: 'Int16Array', 5123: 'Uint16Array', 5125: 'Uint32Array', 5126: 'Float32Array' };

function list(value: unknown, label: string): any[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value as any[];
}
function object(value: any, label: string): GltfJSON {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`invalid ${label}`);
  if (value.extensions && Object.keys(value.extensions).length) fail(`${label} has unsupported extensions`);
  return value;
}
function ref<T>(values: T[], index: any, label: string): T {
  if (!Number.isSafeInteger(index) || index < 0 || index >= values.length) fail(`invalid ${label} index`);
  return values[index]!;
}
function vector(value: any, length: number, fallback: number[], label: string): number[] {
  if (value === undefined) return fallback.slice();
  if (!Array.isArray(value) || value.length !== length || value.some(v => typeof v !== 'number' || !Number.isFinite(v))) fail(`invalid ${label}`);
  return value.slice();
}
function quaternion(value: number[], label: string): number[] {
  const length = Math.hypot(...value);
  if (!Number.isFinite(length) || length < 1e-12) fail(`${label} is not a valid quaternion`);
  return value.map(v => v / length);
}
function affine(matrix: ArrayLike<number>, label: string): void {
  if (matrix.length !== 16 || Array.from(matrix).some(v => !Number.isFinite(v)) ||
      matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1) fail(`${label} must be a finite affine matrix`);
}
function multiply(a: Float64Array, b: Float64Array): Float64Array {
  const result = new Float64Array(16);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    result[column * 4 + row] = a[row]! * b[column * 4]! + a[4 + row]! * b[column * 4 + 1]! + a[8 + row]! * b[column * 4 + 2]! + a[12 + row]! * b[column * 4 + 3]!;
  }
  affine(result, 'computed transform');
  return result;
}

interface NodeState { translation: number[]; rotation: number[]; scale: number[]; matrix: Float64Array | null; weights: number[] }
function localMatrix(state: NodeState): Float64Array {
  if (state.matrix) return state.matrix;
  const [x, y, z, w] = state.rotation as [number, number, number, number];
  const [sx, sy, sz] = state.scale as [number, number, number];
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  const matrix = new Float64Array([
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    state.translation[0]!, state.translation[1]!, state.translation[2]!, 1,
  ]);
  affine(matrix, 'computed TRS');
  return matrix;
}

/** Evaluate source vertices in world space, with glTF morphing before skinning.
 * Includes every node referencing the mesh, even outside the default scene.
 * A mesh without instances is evaluated in its local coordinates (node=null).
 * Each instance gets its default pose and evenly spaced samples including both
 * endpoints of every clip. Clips are applied separately to the default pose.
 * Skin weights are normalized across all JOINTS_n/WEIGHTS_n sets, as recommended
 * by glTF. Duplicate animation times retained by the normalizer are interpreted
 * right-continuously: the last key at an exact timestamp wins. This is a defined
 * fallback for nonconforming source animation, not a claim about every renderer.
 * Other unsupported/malformed deformation fails closed for the optimizer.
 */
export function evaluateGeometryPoses(
  asset: NormalizedAsset, meshIndex: number, primitive: GltfJSON, options: GeometryPoseOptions = {},
): GeometryPose[] {
  const samples = options.samplesPerClip ?? 5;
  if (!Number.isSafeInteger(samples) || samples < 2) fail('samplesPerClip must be an integer of at least 2');
  const json = object(asset.json, 'asset');
  const meshes = list(json.meshes, 'meshes'), nodes = list(json.nodes, 'nodes');
  const mesh = object(ref(meshes, meshIndex, 'mesh'), 'mesh');
  object(primitive, 'primitive');
  const attributes = object(primitive.attributes, 'attributes');
  const decoded = new Map<number, Float64Array>();
  const descriptor = (index: any, type: string, label: string): NormalizedAccessor => {
    const a = ref(asset.accessors, index, label);
    if (!a || a.type !== type || !Number.isSafeInteger(a.count) || a.count < 1 ||
        a.array?.constructor.name !== ARRAY_TYPES[a.componentType] ||
        a.array.length !== a.count * ARITY[type]!) fail(`invalid ${label} accessor`);
    if (a.normalized && ![5120, 5121, 5122, 5123].includes(a.componentType)) fail(`invalid normalized ${label} accessor`);
    return a;
  };
  const values = (index: any, type: string, label: string): Float64Array => {
    const a = descriptor(index, type, label);
    if (!decoded.has(index)) {
      const result = new Float64Array(a.array.length);
      for (let i = 0; i < result.length; i++) {
        let v = a.array[i]!;
        if (a.normalized) {
          if (a.componentType === 5120) v = Math.max(-1, v / 127);
          else if (a.componentType === 5121) v /= 255;
          else if (a.componentType === 5122) v = Math.max(-1, v / 32767);
          else if (a.componentType === 5123) v /= 65535;
        }
        if (!Number.isFinite(v)) fail(`${label} contains non-finite components`);
        result[i] = v;
      }
      decoded.set(index, result);
    }
    return decoded.get(index)!;
  };
  const floats = (index: any, type: string, label: string): Float64Array => {
    const a = descriptor(index, type, label);
    if (a.componentType !== 5126 || a.normalized) fail(`${label} must have float components`);
    return values(index, type, label);
  };
  const position = floats(attributes.POSITION, 'VEC3', 'POSITION'), vertexCount = position.length / 3;
  const morphs = list(primitive.targets, 'morph targets').map((target, index) => {
    object(target, `morph target ${index}`);
    for (const semantic of Object.keys(target)) if (!['POSITION', 'NORMAL', 'TANGENT'].includes(semantic)) fail(`unsupported morph semantic ${semantic}`);
    if (target.POSITION === undefined) return null;
    const result = floats(target.POSITION, 'VEC3', `morph POSITION ${index}`);
    if (result.length !== position.length) fail('morph POSITION count mismatch');
    return result;
  });
  const morphCount = (definition: GltfJSON): number => {
    let count = 0;
    for (const p of list(definition.primitives, 'mesh primitives')) {
      const n = list(object(p, 'mesh primitive').targets, 'morph targets').length;
      if (n && count && n !== count) fail('mesh has inconsistent morph target counts');
      count = Math.max(count, n);
    }
    return count;
  };
  const meshMorphCounts = meshes.map(m => morphCount(object(m, 'mesh')));
  if (morphs.length && morphs.length !== meshMorphCounts[meshIndex]) fail('primitive morph count differs from its mesh');
  const defaults = meshes.map((m, i) => vector(m.weights, meshMorphCounts[i]!, Array(meshMorphCounts[i]!).fill(0), 'mesh weights'));
  const parent = new Int32Array(nodes.length).fill(-1);
  const rest: NodeState[] = nodes.map((raw, i) => {
    const node = object(raw, `node ${i}`);
    if (node.matrix !== undefined && ['translation', 'rotation', 'scale'].some(k => node[k] !== undefined)) fail('node mixes matrix and TRS');
    for (const child of list(node.children, 'node children')) {
      ref(nodes, child, 'child');
      if (parent[child] !== -1) fail('node has multiple parents or duplicate child');
      parent[child] = i;
    }
    const matrix = node.matrix === undefined ? null : new Float64Array(vector(node.matrix, 16, [], 'node matrix'));
    if (matrix) affine(matrix, 'node matrix');
    let weights: number[] = [];
    if (node.mesh !== undefined) {
      ref(meshes, node.mesh, 'node mesh');
      weights = vector(node.weights, meshMorphCounts[node.mesh]!, defaults[node.mesh]!, 'node weights');
    } else if (node.weights !== undefined || node.skin !== undefined) fail('node weights or skin without mesh');
    return { matrix, translation: vector(node.translation, 3, [0, 0, 0], 'translation'),
      rotation: quaternion(vector(node.rotation, 4, [0, 0, 0, 1], 'rotation'), 'node rotation'),
      scale: vector(node.scale, 3, [1, 1, 1], 'scale'), weights };
  });
  const order: number[] = [];
  for (let i = 0; i < nodes.length; i++) if (parent[i] === -1) order.push(i);
  for (let i = 0; i < order.length; i++) for (const child of nodes[order[i]!]!.children ?? []) order.push(child);
  if (order.length !== nodes.length) fail('node hierarchy contains a cycle');
  const instances: Array<number | null> = nodes.flatMap((node, i) => node.mesh === meshIndex ? [i] : []);
  if (!instances.length) instances.push(null);

  interface Skin { joints: number[]; inverseBind: Float64Array[] }
  const skins = new Map<number, Skin>();
  for (const instance of instances) {
    if (instance === null || nodes[instance].skin === undefined) continue;
    const raw = object(ref(list(json.skins, 'skins'), nodes[instance].skin, 'skin'), 'skin');
    const joints = list(raw.joints, 'skin joints');
    if (!joints.length || new Set(joints).size !== joints.length) fail('skin requires unique joints');
    for (const joint of joints) ref(nodes, joint, 'joint');
    const ibm = raw.inverseBindMatrices === undefined ? null : floats(raw.inverseBindMatrices, 'MAT4', 'inverse bind matrices');
    if (ibm && ibm.length < joints.length * 16) fail('missing inverse bind matrices');
    const inverseBind = joints.map((_, i) => {
      const matrix = ibm ? ibm.slice(i * 16, i * 16 + 16) : IDENTITY;
      affine(matrix, 'inverse bind matrix');
      return matrix;
    });
    skins.set(instance, { joints, inverseBind });
  }
  const influences: Array<{ joints: Float64Array; weights: Float64Array }> = [];
  const weightTotals = new Float64Array(vertexCount);
  if (skins.size) {
    const sets = new Set<number>();
    for (const semantic of Object.keys(attributes)) if (/^(JOINTS|WEIGHTS)_/.test(semantic)) {
      const match = /^(JOINTS|WEIGHTS)_(0|[1-9][0-9]*)$/.exec(semantic);
      if (!match) fail(`invalid skin attribute ${semantic}`);
      sets.add(Number(match![2]));
    }
    if (!sets.has(0)) fail('skinned primitive has no JOINTS_0/WEIGHTS_0');
    for (const set of Array.from(sets).sort((a, b) => a - b)) {
      const ji = attributes[`JOINTS_${set}`], wi = attributes[`WEIGHTS_${set}`];
      const j = descriptor(ji, 'VEC4', `JOINTS_${set}`), w = descriptor(wi, 'VEC4', `WEIGHTS_${set}`);
      if (![5121, 5123].includes(j.componentType) || j.normalized ||
          !(w.componentType === 5126 && !w.normalized || [5121, 5123].includes(w.componentType) && w.normalized) ||
          j.count !== vertexCount || w.count !== vertexCount) fail('invalid skin attribute type/count');
      const jointValues = values(ji, 'VEC4', 'skin joints'), weightValues = values(wi, 'VEC4', 'skin weights');
      for (let i = 0; i < weightValues.length; i++) {
        const weight = weightValues[i]!;
        if (weight < 0 || weight > 1) fail('skin weight outside [0,1]');
        for (const skin of skins.values()) if (jointValues[i]! >= skin.joints.length) fail('skin joint index out of bounds');
        weightTotals[Math.floor(i / 4)]! += weight;
      }
      influences.push({ joints: jointValues, weights: weightValues });
    }
    if (weightTotals.some(total => !(total > 0))) fail('vertex has zero total skin weight');
  }

  type AnimationPath = 'translation' | 'rotation' | 'scale' | 'weights';
  interface Channel { node: number; path: AnimationPath; times: Float64Array; output: Float64Array; size: number; interpolation: string }
  const clips = list(json.animations, 'animations').map((raw, index) => {
    const animation = object(raw, `animation ${index}`);
    let start = Infinity, end = -Infinity;
    const samplers = list(animation.samplers, 'animation samplers').map(rawSampler => {
      const sampler = object(rawSampler, 'animation sampler');
      const times = floats(sampler.input, 'SCALAR', 'animation times');
      for (let k = 0; k < times.length; k++) if (times[k]! < 0 || k > 0 && times[k]! < times[k - 1]!) fail('animation times must be nondecreasing and nonnegative');
      const interpolation = sampler.interpolation ?? 'LINEAR';
      if (!['LINEAR', 'STEP', 'CUBICSPLINE'].includes(interpolation)) fail(`unsupported interpolation ${interpolation}`);
      if (interpolation === 'CUBICSPLINE' && times.length < 2) fail('CUBICSPLINE requires at least two keys');
      start = Math.min(start, times[0]!); end = Math.max(end, times[times.length - 1]!);
      return { times, interpolation, output: sampler.output };
    });
    const seen = new Set<string>(), channels: Channel[] = [];
    for (const rawChannel of list(animation.channels, 'animation channels')) {
      const channel = object(rawChannel, 'animation channel'), target = object(channel.target, 'animation target');
      const sampler = ref(samplers, channel.sampler, 'animation sampler');
      if (target.node === undefined) continue; // Explicitly inert in glTF 2.0.
      const node = ref(nodes, target.node, 'animation node'), path = target.path as AnimationPath;
      if (!['translation', 'rotation', 'scale', 'weights'].includes(path)) fail(`unsupported animation path ${String(path)}`);
      const key = `${target.node}/${path}`;
      if (seen.has(key)) fail('duplicate animation channel target');
      seen.add(key);
      if (node.matrix !== undefined && path !== 'weights') fail('TRS animation targets a matrix node');
      const size = path === 'weights' ? (meshMorphCounts[node.mesh] ?? 0) : path === 'rotation' ? 4 : 3;
      if (!size) fail('weights animation has no morph targets');
      const type = path === 'weights' ? 'SCALAR' : path === 'rotation' ? 'VEC4' : 'VEC3';
      const desc = descriptor(sampler.output, type, 'animation output');
      if (!(desc.componentType === 5126 && !desc.normalized ||
          ['rotation', 'weights'].includes(path) && desc.normalized && [5120, 5121, 5122, 5123].includes(desc.componentType))) fail('unsupported animation output components');
      const output = values(sampler.output, type, 'animation output');
      const multiplier = sampler.interpolation === 'CUBICSPLINE' ? 3 : 1;
      if (output.length !== sampler.times.length * size * multiplier) fail('animation output count mismatch');
      if (path === 'rotation') for (let k = 0; k < sampler.times.length; k++) {
        const offset = (k * multiplier + (multiplier === 3 ? 1 : 0)) * size;
        quaternion(Array.from(output.subarray(offset, offset + size)), 'rotation key');
      }
      channels.push({ node: target.node, path, times: sampler.times, output, size, interpolation: sampler.interpolation });
    }
    return { name: typeof animation.name === 'string' ? animation.name : `animation ${index}`, start: start === Infinity ? 0 : start, end: end === -Infinity ? 0 : end, channels };
  });

  const sampleChannel = (channel: Channel, time: number): number[] => {
    const { times, output, size, interpolation, path } = channel;
    const cubic = interpolation === 'CUBICSPLINE', stride = size * (cubic ? 3 : 1);
    const key = (k: number): number[] => Array.from(output.subarray(k * stride + (cubic ? size : 0), k * stride + (cubic ? size : 0) + size));
    let result: number[];
    if (time < times[0]!) result = key(0);
    else if (time >= times[times.length - 1]!) result = key(times.length - 1);
    else {
      let low = 0, high = times.length - 1;
      while (high - low > 1) { const middle = (low + high) >>> 1; if (times[middle]! <= time) low = middle; else high = middle; }
      const duration = times[high]! - times[low]!, t = (time - times[low]!) / duration;
      const a = key(low), b = key(high);
      if (interpolation === 'STEP') result = a;
      else if (cubic) {
        const t2 = t * t, t3 = t2 * t;
        result = a.map((v, i) => (2 * t3 - 3 * t2 + 1) * v + (t3 - 2 * t2 + t) * duration * output[low * stride + 2 * size + i]! + (-2 * t3 + 3 * t2) * b[i]! + (t3 - t2) * duration * output[high * stride + i]!);
      } else if (path === 'rotation') {
        const qa = quaternion(a, 'rotation key'), qb = quaternion(b, 'rotation key');
        let dot = qa.reduce((sum, v, i) => sum + v * qb[i]!, 0);
        if (dot < 0) { dot = -dot; for (let i = 0; i < 4; i++) qb[i] = -qb[i]!; }
        dot = Math.min(1, dot);
        const angle = Math.acos(dot), sine = Math.sin(angle);
        const left = sine < 1e-8 ? 1 - t : Math.sin((1 - t) * angle) / sine;
        const right = sine < 1e-8 ? t : Math.sin(t * angle) / sine;
        result = qa.map((v, i) => left * v + right * qb[i]!);
      } else result = a.map((v, i) => v + (b[i]! - v) * t);
    }
    if (result.some(v => !Number.isFinite(v))) fail('non-finite interpolated value');
    return path === 'rotation' ? quaternion(result, 'interpolated rotation') : result;
  };

  const result: GeometryPose[] = [];
  const emit = (states: NodeState[], animation: number | null, time: number | null, name: string): void => {
    const world: Float64Array[] = [];
    for (const node of order) {
      const local = localMatrix(states[node]!);
      world[node] = parent[node] === -1 ? local : multiply(world[parent[node]!]!, local);
    }
    for (const instance of instances) {
      const weights = instance === null ? defaults[meshIndex]! : states[instance]!.weights;
      const transform = instance === null ? IDENTITY : world[instance]!;
      const skin = instance === null ? undefined : skins.get(instance);
      const jointMatrices = skin?.joints.map((joint, i) => multiply(world[joint]!, skin.inverseBind[i]!));
      const positions = new Float32Array(position.length);
      for (let vertex = 0; vertex < vertexCount; vertex++) {
        const offset = vertex * 3;
        let x = position[offset]!, y = position[offset + 1]!, z = position[offset + 2]!;
        for (let target = 0; target < morphs.length; target++) {
          const delta = morphs[target], weight = weights[target]!;
          if (delta && weight) { x += delta[offset]! * weight; y += delta[offset + 1]! * weight; z += delta[offset + 2]! * weight; }
        }
        let px = 0, py = 0, pz = 0;
        if (jointMatrices) {
          for (const influence of influences) for (let component = 0; component < 4; component++) {
            const index = vertex * 4 + component, weight = influence.weights[index]! / weightTotals[vertex]!;
            if (!weight) continue;
            const m = jointMatrices[influence.joints[index]!]!;
            px += weight * (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!);
            py += weight * (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!);
            pz += weight * (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!);
          }
        } else {
          px = transform[0]! * x + transform[4]! * y + transform[8]! * z + transform[12]!;
          py = transform[1]! * x + transform[5]! * y + transform[9]! * z + transform[13]!;
          pz = transform[2]! * x + transform[6]! * y + transform[10]! * z + transform[14]!;
        }
        positions[offset] = px; positions[offset + 1] = py; positions[offset + 2] = pz;
        if (!Number.isFinite(positions[offset]) || !Number.isFinite(positions[offset + 1]) || !Number.isFinite(positions[offset + 2])) fail('posed position exceeds finite float range');
      }
      result.push({ name: `${name}; ${instance === null ? 'uninstanced mesh' : `node ${instance}`}`, positions, node: instance, animation, time });
    }
  };
  emit(rest, null, null, 'default');
  clips.forEach((clip, animation) => {
    const count = clip.start === clip.end ? 1 : samples;
    for (let k = 0; k < count; k++) {
      const time = count === 1 ? clip.start : k === count - 1 ? clip.end : clip.start + (clip.end - clip.start) * k / (count - 1);
      const states = rest.map(state => ({ ...state }));
      for (const channel of clip.channels) states[channel.node]![channel.path] = sampleChannel(channel, time);
      emit(states, animation, time, `${clip.name} [${animation}] at ${time}`);
    }
  });
  return result;
}
