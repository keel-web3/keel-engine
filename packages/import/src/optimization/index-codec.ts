/** Exact meshoptimizer 0.25 index SEQUENCE candidate.
 * No mesh reordering or triangle codec: every element retains its original slot.
 * Selection belongs to the enclosing package's measured complete-closure gate.
 * In particular, raw sequence bytes can grow while the Brotli closure shrinks.
 */
import { MeshoptDecoder } from 'meshoptimizer/meshopt_decoder.module.js';
import { zlibSync } from 'fflate';
import { decodeBuffer } from '../asset-buffer-codec.ts';
import type { ExactBuffer } from './exact-encoding.ts';

const MAX_INDICES = 16 * 1024 * 1024, MAX_PAYLOAD = MAX_INDICES * 5 + 5, MAX_INDEX = 0x3fffffff;
export type IndexArray = Uint8Array | Uint16Array | Uint32Array;
export interface ExactIndexRecipe { version: 1; kind: 'meshopt-index-sequence'; componentType: 5121 | 5123 | 5125; count: number; data: ExactBuffer }
function fail(message: string): never { throw Error('Exact index codec: ' + message); }
function integer(n: unknown, low: number, high: number, label: string): number { if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < low || n > high) fail('invalid ' + label); return n; }
function sourceBytes(indices: IndexArray): Uint8Array {
  const width = indices instanceof Uint32Array ? 4 : 2, bytes = new Uint8Array(indices.length * width), view = new DataView(bytes.buffer);
  for (let i = 0; i < indices.length; i++) if (width === 2) view.setUint16(i * 2, indices[i]!, true); else view.setUint32(i * 4, indices[i]!, true);
  return bytes;
}
/** Emits a candidate, not a claim that it beats the complete residual package. */
export async function encodeExactIndexSequence(indices: IndexArray, options: { compress?: boolean } = {}) {
  if (!(indices instanceof Uint8Array) && !(indices instanceof Uint16Array) && !(indices instanceof Uint32Array)) fail('expected unsigned indices');
  integer(indices.length, 0, MAX_INDICES, 'index count');
  // The sequence stream dedicates two low bits to prediction/zigzag. Do not
  // silently accept large Uint32 values that this codec can wrap. Native surface
  // vertex limits are already far below this bound; other callers retain residuals.
  for (const index of indices) if (index > MAX_INDEX) fail('index exceeds exact sequence range; retain residual');
  // Dynamic import is removed from a replay-only bundle; do not make the full
  // encoder/WASM a runtime dependency of decodeExactIndexSequence.
  const { MeshoptEncoder } = await import('meshoptimizer/meshopt_encoder.module.js');
  await MeshoptEncoder.ready;
  const size = indices instanceof Uint32Array ? 4 : 2, source = sourceBytes(indices), encoded = MeshoptEncoder.encodeIndexSequence(source, indices.length, size);
  const data: ExactBuffer = { codec: options.compress ? 'zlib' : 'raw', parameters: { version: 1 }, sourceLength: encoded.length, data: options.compress ? zlibSync(encoded, { level: 6 }) : encoded };
  const recipe: ExactIndexRecipe = { version: 1, kind: 'meshopt-index-sequence', componentType: indices instanceof Uint8Array ? 5121 : indices instanceof Uint16Array ? 5123 : 5125, count: indices.length, data };
  const replay = await decodeExactIndexSequence(recipe);
  for (let i = 0; i < indices.length; i++) if (replay[i] !== indices[i]) fail('encoder changed index at ' + i);
  return { recipe, metrics: { sourceBytes: indices.byteLength, encodedBytes: encoded.length, payloadBytes: data.data.length, compressed: !!options.compress, exactIndexOrder: true as const, indexTypePreserved: true as const, candidateOnly: true as const, runtime: 'Full meshoptimizer 0.25 decoder, including embedded WASM, and its MIT license must be counted once in the outer closure' } };
}
export async function decodeExactIndexSequence(recipe: ExactIndexRecipe, vertexCount?: number): Promise<IndexArray> {
  if (!recipe || recipe.version !== 1 || recipe.kind !== 'meshopt-index-sequence' || ![5121, 5123, 5125].includes(recipe.componentType)) fail('unsupported recipe');
  const count = integer(recipe.count, 0, MAX_INDICES, 'index count');
  if (vertexCount !== undefined) integer(vertexCount, 0, 0x100000000, 'vertex count');
  const wire = recipe.data;
  if (!wire || !['raw', 'zlib'].includes(wire.codec) || !(wire.data instanceof Uint8Array)) fail('invalid sequence payload');
  integer(wire.sourceLength, 5, Math.min(MAX_PAYLOAD, count * 5 + 5), 'sequence extent');
  if (wire.data.length > MAX_PAYLOAD) fail('sequence payload exceeds limit');
  const encoded = decodeBuffer(wire, MAX_PAYLOAD), output = new Uint8Array(count * 4);
  await MeshoptDecoder.ready;
  // Decode wide first so a forged narrow descriptor cannot silently truncate.
  MeshoptDecoder.decodeIndexSequence(output, count, 4, encoded);
  const view = new DataView(output.buffer), result: IndexArray = recipe.componentType === 5121 ? new Uint8Array(count) : recipe.componentType === 5123 ? new Uint16Array(count) : new Uint32Array(count);
  const maximum = recipe.componentType === 5121 ? 255 : recipe.componentType === 5123 ? 65535 : MAX_INDEX;
  for (let i = 0; i < count; i++) {
    const index = view.getUint32(i * 4, true);
    if (index > maximum || (vertexCount !== undefined && index >= vertexCount)) fail('decoded index out of range');
    result[i] = index;
  }
  return result;
}
