/** A bounded static snapshot of the already accepted voxel result. No source model,
 * textures, materials, rig or animation data are needed to rebuild its cubes.
 * Version 1 preserves occupied-cell order and the exact RGB Float32 words written
 * by the legacy GLB builder, including negative zero. Grid transforms stay doubles.
 */
import { encodeBuffer, decodeBuffer } from './asset-buffer-codec.ts';
import { packAsset } from './asset-binary-v3.ts';
import { crc32 } from './png.ts';

export const VOXEL_SNAPSHOT_VERSION = 1;
export const VOXEL_SNAPSHOT_KIND = 'keel-static-voxel-snapshot';
export const VOXEL_SNAPSHOT_MAX_CUBES = 50_000;
/** Sparse occupied-cell indices use signed-safe 31-bit arithmetic. The snapshot
 * allocates by occupied count, never by the full grid volume. */
export const VOXEL_SNAPSHOT_MAX_CELLS = 0x7fffffff;
/** At most 31 occupied-index bits + 12 RGB bytes + 16 palette-index bits/cube. */
export const VOXEL_SNAPSHOT_MAX_BYTES = VOXEL_SNAPSHOT_MAX_CUBES * (4 + 12 + 2);
export interface VoxelSnapshotOptions { maxWorkingBytes?: number }
function snapshotLimits(options: VoxelSnapshotOptions) {
  const maxBytes = options.maxWorkingBytes ?? VOXEL_SNAPSHOT_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) fail('maxWorkingBytes must be a positive safe integer');
  // Explicit host budgets replace the conservative legacy count bound. Account
  // for numeric input/output arrays, dictionary rows, and intermediate payloads.
  return { maxBytes, maxCubes: options.maxWorkingBytes === undefined ? VOXEL_SNAPSHOT_MAX_CUBES : Math.min(0x7fffffff, Math.floor(maxBytes / 128)) };
}
const MAX_SOURCE_JSON = 16 * 1024 * 1024;
type Vector = [number, number, number];
export interface VoxelSourcePose { animation?: string | null; time?: number }
export interface VoxelSnapshotFidelity {
  pose: 'static';
  color: 'sampled-linear-base-color';
  alpha: 'opaque' | 'mask-sampled' | 'opaque-approximation' | 'mask-sampled+opaque-approximation';
}
interface SnapshotMetadata {
  sourcePose?: VoxelSourcePose;
  fidelity?: VoxelSnapshotFidelity;
  warnings?: string[];
}
export interface ReplayedVoxelSnapshot extends SnapshotMetadata {
  version: 1;
  kind: 'keel-static-voxel-style';
  coordinateSpace: 'source-world';
  colorSpace: 'linear-srgb';
  pose: 'static';
  size: Vector;
  origin: Vector;
  unit: number;
  indices: number[];
  colors: number[];
}
export type VoxelSnapshotEncoding = 'palette-f32' | 'raw-f32';
export interface VoxelSnapshotRecipe extends SnapshotMetadata {
  version: 1;
  kind: typeof VOXEL_SNAPSHOT_KIND;
  coordinateSpace: 'source-world';
  colorSpace: 'linear-srgb';
  pose: 'static';
  size: Vector;
  origin: Vector;
  unit: number;
  count: number;
  encoding: VoxelSnapshotEncoding;
  /** Zero for raw-f32. Palette rows are exact little-endian RGB Float32 words. */
  paletteSize: number;
  codec: string;
  parameters: Record<string, number>;
  sourceLength: number;
  data: Uint8Array;
  payloadCRC32: number;
}
export interface VoxelSnapshotCandidate {
  encoding: VoxelSnapshotEncoding;
  payloadBytes: number;
  serializedBytes: number;
}
export interface VoxelSnapshotReport {
  selected: VoxelSnapshotEncoding;
  cubeCount: number;
  gridCells: number;
  paletteSize: number;
  sourceSampleBytes: number;
  payloadBytes: number;
  serializedBytes: number;
  metadataBytes: number;
  exactOccupiedOrder: true;
  exactFloat32Colors: true;
  exactGridTransform: true;
  staticPose: true;
  omittedFields: string[];
  retainedPoseMetadata: boolean;
  candidates: VoxelSnapshotCandidate[];
  selectionBasis: string;
}
function fail(message: string): never { throw new TypeError('Voxel snapshot: ' + message); }
function finite(value: unknown, min: number, max: number, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('invalid ' + name);
  return value;
}
function integer(value: unknown, min: number, max: number, name: string): number {
  const n = finite(value, min, max, name);
  if (!Number.isSafeInteger(n)) fail('invalid ' + name);
  return n;
}
/** Inspect descriptors before reading values, so no getter is executed. */
function record(value: unknown, name: string, allowed?: readonly string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid ' + name);
  const keys = Reflect.ownKeys(value);
  if (keys.length > 64) fail(name + ' exceeds field limit');
  for (const key of keys) {
    if (typeof key !== 'string' || key.length > 120 || ['__proto__', 'constructor', 'prototype'].includes(key)) fail('unsafe ' + name + ' key');
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor) || !descriptor.enumerable) fail(name + ' must contain enumerable data fields');
    if (allowed && !allowed.includes(key)) fail('unknown ' + name + ' field ' + key);
  }
  return value as Record<string, any>;
}
function array(value: unknown, length: number, name: string): any[] {
  if (!Array.isArray(value) || value.length !== length || Object.getPrototypeOf(value) !== Array.prototype) fail('invalid ' + name + ' length');
  // A dense numeric data array only; holes and getters cannot silently become NaN.
  if (Reflect.ownKeys(value).length !== length + 1) fail('invalid ' + name + ' fields');
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, i);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) fail('invalid ' + name + ' sample');
  }
  return value;
}
function vector(value: unknown, name: string): Vector {
  const v = array(value, 3, name);
  return v.map(n => finite(n, -1e20, 1e20, name)) as Vector;
}
function transform(v: Record<string, any>) {
  const size = vector(v.size, 'grid size'), origin = vector(v.origin, 'grid origin');
  size.forEach(n => integer(n, 1, VOXEL_SNAPSHOT_MAX_CELLS, 'grid dimension'));
  const cells = integer(size[0] * size[1] * size[2], 1, VOXEL_SNAPSHOT_MAX_CELLS, 'grid volume');
  const unit = finite(v.unit, Number.MIN_VALUE, 1e15, 'grid unit');
  return { size, origin, unit, cells };
}
function poseMetadata(value: unknown): VoxelSourcePose {
  const v = record(value, 'source pose', ['animation', 'time']);
  const result: VoxelSourcePose = {};
  if (Object.hasOwn(v, 'animation')) {
    if (v.animation !== null && (typeof v.animation !== 'string' || v.animation.length > 240)) fail('invalid source animation label');
    result.animation = v.animation;
  }
  if (Object.hasOwn(v, 'time')) result.time = finite(v.time, 0, 1e12, 'source pose time');
  return result;
}
function metadata(v: Record<string, any>): SnapshotMetadata {
  const result: SnapshotMetadata = {};
  if (Object.hasOwn(v, 'sourcePose')) result.sourcePose = poseMetadata(v.sourcePose);
  if (Object.hasOwn(v, 'fidelity')) {
    const f = record(v.fidelity, 'fidelity', ['pose', 'color', 'alpha']);
    if (f.pose !== 'static' || f.color !== 'sampled-linear-base-color' || !['opaque', 'mask-sampled', 'opaque-approximation', 'mask-sampled+opaque-approximation'].includes(f.alpha)) fail('unsupported fidelity');
    result.fidelity = { pose: f.pose, color: f.color, alpha: f.alpha };
  }
  if (Object.hasOwn(v, 'warnings')) {
    if (!Array.isArray(v.warnings) || v.warnings.length > 16) fail('warnings exceed limit');
    result.warnings = array(v.warnings, v.warnings.length, 'warnings').map(message => {
      if (typeof message !== 'string' || message.length > 512) fail('invalid warning');
      return message;
    });
  }
  return result;
}
function semantics(v: Record<string, any>, kind: string): void {
  if (v.version !== 1 || v.kind !== kind || v.coordinateSpace !== 'source-world' || v.colorSpace !== 'linear-srgb' || v.pose !== 'static') fail('unsupported recipe');
}
function bitWidth(size: number): number { return Math.ceil(Math.log2(size)); }
function packedLength(count: number, bits: number): number { return Math.ceil(count * bits / 8); }
/** Low bits first within each byte. Width is inferred from validated grid/palette. */
function packIndices(values: ArrayLike<number>, bits: number): Uint8Array {
  const bytes = new Uint8Array(packedLength(values.length, bits));
  for (let i = 0; i < values.length; i++) {
    let value = values[i]!, bit = i * bits, remaining = bits;
    while (remaining) {
      const at = bit >>> 3, shift = bit & 7, take = Math.min(8 - shift, remaining);
      bytes[at] = bytes[at]! | (value & ((1 << take) - 1)) << shift;
      value >>>= take; bit += take; remaining -= take;
    }
  }
  return bytes;
}
function unpackIndices(bytes: Uint8Array, count: number, bits: number, bound: number, name: string): number[] {
  const used = count * bits % 8;
  if (used && bytes[bytes.length - 1]! >>> used) fail('nonzero ' + name + ' padding');
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    let value = 0, bit = i * bits, remaining = bits, offset = 0;
    while (remaining) {
      const at = bit >>> 3, shift = bit & 7, take = Math.min(8 - shift, remaining);
      value |= (bytes[at]! >>> shift & ((1 << take) - 1)) << offset;
      offset += take; bit += take; remaining -= take;
    }
    if (value >= bound) fail(name + ' index out of range');
    out[i] = value;
  }
  return out;
}
function join(parts: Uint8Array[], maxBytes: number): Uint8Array {
  const length = integer(parts.reduce((n, p) => n + p.length, 0), 1, maxBytes, 'payload length');
  const out = new Uint8Array(length); let offset = 0;
  for (const p of parts) { out.set(p, offset); offset += p.length; }
  return out;
}
const REQUIRED_SOURCE_FIELDS = ['version', 'kind', 'coordinateSpace', 'colorSpace', 'pose', 'size', 'origin', 'unit', 'indices', 'colors', 'sourcePose', 'fidelity', 'warnings'];

export function encodeVoxelSnapshot(input: unknown, options: VoxelSnapshotOptions = {}): { recipe: VoxelSnapshotRecipe; report: VoxelSnapshotReport } {
  const limits = snapshotLimits(options);
  if (typeof input === 'string') {
    if (input.length > MAX_SOURCE_JSON) fail('source JSON exceeds limit');
    input = JSON.parse(input);
  }
  const v = record(input, 'source recipe');
  semantics(v, 'keel-static-voxel-style');
  const { size, origin, unit, cells } = transform(v);
  if (!Array.isArray(v.indices)) fail('occupied indices required');
  const count = integer(v.indices.length, 1, limits.maxCubes, 'cube count');
  const indices = array(v.indices, count, 'occupied indices'), colors = array(v.colors, count * 3, 'colors');
  const seen = new Set<number>();
  for (const index of indices) {
    integer(index, 0, cells - 1, 'occupied index');
    if (seen.has(index)) fail('duplicate occupied index');
    seen.add(index);
  }
  for (const label of ['occupancy', 'material', 'node']) if (Object.hasOwn(v, label)) {
    const samples = array(v[label], count, label);
    if (label === 'occupancy') samples.forEach(n => integer(n, 1, 2, 'occupancy'));
  }
  const preserved = metadata(v);
  const occupied = packIndices(indices, bitWidth(cells));
  const rgb = new Uint8Array(count * 12), view = new DataView(rgb.buffer);
  for (let i = 0; i < colors.length; i++) view.setFloat32(i * 4, finite(colors[i], 0, 1, 'linear color'), true);
  const dictionary = new Map<string, number>(), rows: number[] = [], ids = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const at = i * 12, key = view.getUint32(at, true) + ':' + view.getUint32(at + 4, true) + ':' + view.getUint32(at + 8, true);
    let id = dictionary.get(key);
    if (id === undefined) { id = rows.length; rows.push(i); dictionary.set(key, id); }
    ids[i] = id;
  }
  const palette = new Uint8Array(rows.length * 12);
  rows.forEach((row, i) => palette.set(rgb.subarray(row * 12, row * 12 + 12), i * 12));
  const candidates: VoxelSnapshotCandidate[] = [];
  let recipe: VoxelSnapshotRecipe | undefined, best = Infinity;
  const consider = (encoding: VoxelSnapshotEncoding, paletteSize: number, parts: Uint8Array[]) => {
    const payload = join([occupied, ...parts], limits.maxBytes), encoded = encodeBuffer(payload);
    const candidate: VoxelSnapshotRecipe = {
      version: 1, kind: VOXEL_SNAPSHOT_KIND, coordinateSpace: 'source-world', colorSpace: 'linear-srgb', pose: 'static',
      size: [...size], origin: [...origin], unit, count, encoding, paletteSize,
      codec: encoded.codec, parameters: encoded.parameters, sourceLength: payload.length, data: encoded.data, payloadCRC32: crc32(payload),
      ...preserved,
    };
    const serializedBytes = packAsset(candidate).length;
    candidates.push({ encoding, payloadBytes: candidate.data.length, serializedBytes });
    if (serializedBytes < best) { best = serializedBytes; recipe = candidate; }
  };
  consider('palette-f32', rows.length, [palette, packIndices(ids, bitWidth(rows.length))]);
  consider('raw-f32', 0, [rgb]);
  const selected = recipe!, replay = replayVoxelSnapshot(selected, options);
  if (replay.indices.some((index, i) => index !== indices[i]) || replay.colors.some((color, i) => !Object.is(color, Math.fround(colors[i]!)))) fail('internal replay differs');
  return { recipe: selected, report: {
    selected: selected.encoding, cubeCount: count, gridCells: cells, paletteSize: rows.length, sourceSampleBytes: count * 16,
    payloadBytes: selected.data.length, serializedBytes: best, metadataBytes: best - selected.data.length,
    exactOccupiedOrder: true, exactFloat32Colors: true, exactGridTransform: true, staticPose: true,
    omittedFields: Object.keys(v).filter(key => !REQUIRED_SOURCE_FIELDS.includes(key)).sort(), retainedPoseMetadata: preserved.sourcePose !== undefined,
    candidates,
    selectionBasis: 'Smallest actual packAsset(recipe) byte length; palette-f32 wins ties. Both preserve the accepted static voxel GLB, including Float32 color bits. Source geometry, textures, rig and animation are omitted; voxelization was already lossy. Shared decoder and outer asset costs are additional.',
  } };
}

/** Extents, counts, parameters and metadata are checked before bounded inflation.
 * Returned numeric arrays and transforms are owned, independent of the recipe. */
export function replayVoxelSnapshot(input: unknown, options: VoxelSnapshotOptions = {}): ReplayedVoxelSnapshot {
  const limits = snapshotLimits(options);
  const v = record(input, 'recipe', ['version', 'kind', 'coordinateSpace', 'colorSpace', 'pose', 'size', 'origin', 'unit', 'count', 'encoding', 'paletteSize', 'codec', 'parameters', 'sourceLength', 'data', 'payloadCRC32', 'sourcePose', 'fidelity', 'warnings']);
  semantics(v, VOXEL_SNAPSHOT_KIND);
  const { size, origin, unit, cells } = transform(v);
  const count = integer(v.count, 1, Math.min(cells, limits.maxCubes), 'cube count');
  if (v.encoding !== 'palette-f32' && v.encoding !== 'raw-f32') fail('unsupported color encoding');
  const paletteSize = integer(v.paletteSize, v.encoding === 'palette-f32' ? 1 : 0, v.encoding === 'palette-f32' ? count : 0, 'palette size');
  const preserved = metadata(v);
  const occupiedBits = bitWidth(cells), occupiedLength = packedLength(count, occupiedBits), colorRows = paletteSize || count;
  const colorLength = colorRows * 12, idBits = bitWidth(paletteSize || 1), idLength = paletteSize ? packedLength(count, idBits) : 0;
  const length = integer(occupiedLength + colorLength + idLength, 1, limits.maxBytes, 'payload extent');
  if (v.sourceLength !== length) fail('payload extent mismatch');
  integer(v.payloadCRC32, 0, 0xffffffff, 'payload checksum');
  if (!['raw', 'zlib'].includes(v.codec)) fail('unsupported payload codec');
  const parameters = record(v.parameters, 'codec parameters', ['version']);
  if (parameters.version !== 1) fail('unsupported payload codec version');
  if (!(v.data instanceof Uint8Array) || !v.data.length || v.data.length > length + Math.ceil(length / 16) + 1024) fail('invalid compressed payload extent');
  const payload = decodeBuffer({ codec: v.codec, parameters, sourceLength: length, data: v.data }, length);
  if (crc32(payload) !== v.payloadCRC32) fail('payload checksum mismatch');
  const indices = unpackIndices(payload.subarray(0, occupiedLength), count, occupiedBits, cells, 'occupied');
  if (new Set(indices).size !== count) fail('duplicate occupied index');
  const rgb = new DataView(payload.buffer, payload.byteOffset + occupiedLength, colorLength), colors = new Array<number>(count * 3);
  for (let i = 0; i < colorRows * 3; i++) finite(rgb.getFloat32(i * 4, true), 0, 1, 'linear color');
  const ids = paletteSize ? unpackIndices(payload.subarray(occupiedLength + colorLength), count, idBits, paletteSize, 'palette') : null;
  if (ids) {
    const seen = new Set<number>(), rows = new Set<string>();
    for (const id of ids) if (!seen.has(id)) {
      if (id !== seen.size) fail('noncanonical palette order');
      seen.add(id);
    }
    if (seen.size !== paletteSize) fail('unused palette row');
    for (let i = 0; i < paletteSize; i++) {
      const at = i * 12, key = rgb.getUint32(at, true) + ':' + rgb.getUint32(at + 4, true) + ':' + rgb.getUint32(at + 8, true);
      if (rows.has(key)) fail('duplicate palette row');
      rows.add(key);
    }
  }
  for (let i = 0; i < count; i++) {
    const row = ids ? ids[i]! : i;
    for (let c = 0; c < 3; c++) colors[i * 3 + c] = rgb.getFloat32(row * 12 + c * 4, true);
  }
  return {
    version: 1, kind: 'keel-static-voxel-style', coordinateSpace: 'source-world', colorSpace: 'linear-srgb', pose: 'static',
    size, origin, unit, indices, colors, ...preserved,
  };
}
