/** Bounded exact encoder. Uses the frozen v3 replay formats, never source files.
 * Version 1 fixes an 8 KiB screen, level-6 DEFLATE and at most one screened full
 * buffer candidate. The actual packed candidate must beat the fixed residual;
 * sample estimates alone never authorize a replacement. No timing/name gates.
 */
import { zlibSync } from 'fflate';
import { packAsset } from '../asset-binary-v3.ts';
import type { BufferHints } from '../asset-buffer-codec.ts';
import type { AttributeInput } from '../asset-attribute-codec-v3.ts';
import type { SurfaceInput, SurfaceRecipe, SurfaceMetrics } from '../asset-native-surface-v3.ts';

export const EXACT_ENCODING_POLICY = Object.freeze({ version: 2, mirrorSamples: 1024, mirrorFullCandidates: 1, sampleBytes: 8192, sampleBlocks: 4, fullCandidates: 2, gridCandidates: 16, gridSamples: 64, topologyTriangles: 262144, compressionLevel: 6 });
const MAX_BYTES = 256 * 1024 * 1024, MAX_SURFACE_BYTES = 64 * 1024 * 1024, MAX_STRIDE = 4096;
const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const components: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const ctors = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
type Codec = 'raw' | 'zlib' | 'byteplanes-zlib' | 'delta-zlib' | 'xor-zlib' | 'delta-byteplanes-zlib' | 'xor-byteplanes-zlib' | 'row-dictionary-zlib';
type Layout = { stride: number; componentBytes: number };
export interface ExactBuffer { codec: string; parameters: Record<string, number>; sourceLength: number; data: Uint8Array }
export interface ExactBufferMetrics { sourceBytes: number; recipeBytes: number; residualRecipeBytes: number; selected: string; screenedBytes: number; fullCandidates: number; candidates: Array<{ codec: string; bytes: number }>; exact: true; costBasis: string }
const costBasis = 'Actual packAsset bytes, including binary payload, metadata, references and directory; shared frozen decoder charged once by the enclosing package';
function fail(message: string): never { throw Error('Bounded exact encoder: ' + message); }
function integer(n: unknown, low: number, high: number, label: string): number { if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < low || n > high) fail('invalid ' + label); return n; }
/** Exact complete binary transport cost, not JSON typed-array expansion or a payload estimate. */
export function exactRecipeBytes(recipe: unknown): number { return packAsset(recipe).length; }
function layoutFor(hints: BufferHints | undefined, length: number): Layout | null {
  if (!hints || (hints.stride === undefined && hints.componentBytes === undefined)) return null;
  const componentBytes = integer(hints.componentBytes ?? 1, 1, 8, 'component width');
  if (![1, 2, 4, 8].includes(componentBytes)) fail('unsupported component width');
  const stride = integer(hints.stride ?? componentBytes, 1, MAX_STRIDE, 'stride');
  if (stride % componentBytes) fail('partial component stride');
  return length % stride ? null : { stride, componentBytes };
}
function planes(source: Uint8Array, width: number): Uint8Array {
  const out = new Uint8Array(source.length), count = source.length / width;
  for (let lane = 0; lane < width; lane++) for (let i = 0; i < count; i++) out[lane * count + i] = source[i * width + lane]!;
  return out;
}
function predict(source: Uint8Array, stride: number, width: number, xor: boolean): Uint8Array {
  const out = new Uint8Array(source.length);
  for (let i = 0; i < source.length; i += width) {
    let carry = 0;
    for (let lane = 0; lane < width; lane++) {
      const previous = i >= stride ? source[i - stride + lane]! : 0, current = source[i + lane]!;
      if (xor) out[i + lane] = current ^ previous;
      else { const value = current - previous - carry; out[i + lane] = value & 255; carry = value < 0 ? 1 : 0; }
    }
  }
  return out;
}
function dictionary(source: Uint8Array, stride: number): { data: Uint8Array; parameters: Record<string, number> } | null {
  const rows = source.length / stride;
  if (!rows || rows > 262144) return null;
  const buckets = new Map<number, number[]>(), unique: number[] = [], codes = new Uint32Array(rows);
  for (let row = 0; row < rows; row++) {
    let hash = 2166136261;
    for (let k = 0; k < stride; k++) hash = Math.imul(hash ^ source[row * stride + k]!, 16777619) >>> 0;
    let bucket = buckets.get(hash);
    if (!bucket) { bucket = []; buckets.set(hash, bucket); }
    let code = -1;
    for (const candidate of bucket) {
      let equal = true;
      for (let k = 0; k < stride; k++) if (source[row * stride + k] !== source[unique[candidate]! * stride + k]) { equal = false; break; }
      if (equal) { code = candidate; break; }
    }
    if (code < 0) { if (bucket.length === 64) return null; code = unique.length; unique.push(row); bucket.push(code); }
    codes[row] = code;
  }
  if (unique.length === rows) return null;
  const indexBytes = unique.length <= 256 ? 1 : unique.length <= 65536 ? 2 : 4;
  const data = new Uint8Array(unique.length * stride + rows * indexBytes), at = unique.length * stride;
  for (let i = 0; i < unique.length; i++) data.set(source.subarray(unique[i]! * stride, (unique[i]! + 1) * stride), i * stride);
  for (let row = 0; row < rows; row++) for (let lane = 0; lane < indexBytes; lane++) data[at + row * indexBytes + lane] = codes[row]! >>> (8 * lane) & 255;
  return { data, parameters: { stride, dictionaryRows: unique.length, indexBytes } };
}
function encodeCandidate(source: Uint8Array, codec: Codec, layout: Layout | null): ExactBuffer | null {
  let data = source, parameters: Record<string, number> = { version: 1 };
  if (codec !== 'raw' && codec !== 'zlib') {
    if (!layout) return null;
    const { stride, componentBytes } = layout;
    if (codec === 'row-dictionary-zlib') { const dict = dictionary(source, stride); if (!dict) return null; data = dict.data; parameters = { version: 1, ...dict.parameters }; }
    else {
      parameters = { version: 1, stride, componentBytes };
      if (codec.startsWith('delta-')) data = predict(source, stride, componentBytes, false);
      else if (codec.startsWith('xor-')) data = predict(source, stride, componentBytes, true);
      if (codec.includes('byteplanes')) data = planes(data, componentBytes);
    }
  }
  return { codec, parameters, sourceLength: source.length, data: codec === 'raw' ? new Uint8Array(data) : zlibSync(data, { level: EXACT_ENCODING_POLICY.compressionLevel }) };
}
/** Fixed reference policy: level-6 component byteplanes (or plain DEFLATE), with raw fallback. */
export function encodeFixedResidual(source: Uint8Array, hints?: BufferHints): ExactBuffer {
  if (!(source instanceof Uint8Array)) fail('expected byte array');
  integer(source.length, 0, MAX_BYTES, 'buffer length');
  const layout = layoutFor(hints, source.length), codec = layout && layout.componentBytes > 1 ? 'byteplanes-zlib' : 'zlib';
  const raw = encodeCandidate(source, 'raw', layout)!, compressed = encodeCandidate(source, codec, layout)!;
  return exactRecipeBytes(compressed) < exactRecipeBytes(raw) ? compressed : raw;
}
function sample(source: Uint8Array, stride: number): Uint8Array {
  const rows = source.length / stride, blockRows = Math.max(1, Math.floor(EXACT_ENCODING_POLICY.sampleBytes / EXACT_ENCODING_POLICY.sampleBlocks / stride));
  const blocks = Math.min(EXACT_ENCODING_POLICY.sampleBlocks, Math.floor(rows / blockRows), Math.floor(EXACT_ENCODING_POLICY.sampleBytes / (blockRows * stride)));
  const out = new Uint8Array(blocks * blockRows * stride);
  for (let i = 0; i < blocks; i++) { const row = blocks === 1 ? 0 : Math.floor(i * (rows - blockRows) / (blocks - 1)); out.set(source.subarray(row * stride, (row + blockRows) * stride), i * blockRows * stride); }
  return out;
}
export function encodeExactBuffer(source: Uint8Array, hints?: BufferHints): { recipe: ExactBuffer; fixedResidual: ExactBuffer; metrics: ExactBufferMetrics } {
  const baseline = encodeFixedResidual(source, hints), layout = layoutFor(hints, source.length);
  const residualRecipeBytes = exactRecipeBytes(baseline), candidates = [{ codec: baseline.codec, bytes: residualRecipeBytes }];
  let recipe = baseline, recipeBytes = residualRecipeBytes, screenedBytes = 0, fullCandidates = 1;
  if (layout && source.length > EXACT_ENCODING_POLICY.sampleBytes * 2) {
    const probe = sample(source, layout.stride); screenedBytes = probe.length;
    const codecs: Codec[] = ['zlib', 'byteplanes-zlib', 'delta-zlib', 'xor-zlib', 'delta-byteplanes-zlib', 'xor-byteplanes-zlib', 'row-dictionary-zlib'];
    let chosen: Codec = layout.componentBytes > 1 ? 'byteplanes-zlib' : 'zlib', best = Infinity;
    for (const codec of codecs) {
      if (layout.componentBytes === 1 && codec.includes('byteplanes')) continue;
      const encoded = encodeCandidate(probe, codec, layout); if (!encoded) continue;
      const bytes = exactRecipeBytes(encoded); if (bytes < best) { best = bytes; chosen = codec; }
    }
    const fixed = layout.componentBytes > 1 ? 'byteplanes-zlib' : 'zlib';
    if (chosen !== fixed) {
      const encoded = encodeCandidate(source, chosen, layout); fullCandidates++;
      if (encoded) { const bytes = exactRecipeBytes(encoded); candidates.push({ codec: encoded.codec, bytes }); if (bytes < recipeBytes) { recipe = encoded; recipeBytes = bytes; } }
    }
  }
  return { recipe, fixedResidual: baseline, metrics: { sourceBytes: source.length, recipeBytes, residualRecipeBytes, selected: recipe.codec, screenedBytes, fullCandidates, candidates, exact: true, costBasis } };
}
/** Canonical little-endian bytes retain Float32 NaN payloads and signed zero. */
function typedBytes(array: AttributeInput['array']): Uint8Array {
  const raw = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
  if (littleEndian || array.BYTES_PER_ELEMENT === 1) return raw;
  const out = new Uint8Array(raw.length), width = array.BYTES_PER_ELEMENT;
  for (let i = 0; i < raw.length; i += width) for (let lane = 0; lane < width; lane++) out[i + lane] = raw[i + width - lane - 1]!;
  return out;
}
export function encodeResidualAttribute(input: AttributeInput): { recipe: ExactBuffer; metrics: ExactBufferMetrics } {
  const C = ctors[input.componentType as keyof typeof ctors], width = components[input.type];
  if (!C || !width || !(input.array instanceof C) || typeof input.normalized !== 'boolean') fail('attribute descriptor differs');
  integer(input.count, 0, MAX_BYTES, 'attribute count');
  if (input.array.length !== input.count * width) fail('attribute extent differs');
  return encodeExactBuffer(typedBytes(input.array), { stride: width * C.BYTES_PER_ELEMENT, componentBytes: C.BYTES_PER_ELEMENT });
}
type PositionRecipe = SurfaceRecipe['positions'];
type Counts = Pick<SurfaceMetrics, 'explicitResidualTriangles' | 'filledContourTriangles' | 'stripTriangles' | 'mirroredTriangles'>;
function inferPositions(positions: Float32Array): { recipe: PositionRecipe; generated: number } | null {
  const count = positions.length / 3;
  if (count < 2) return null;
  const words = new Uint32Array(positions.buffer, positions.byteOffset, positions.length), u = new Float32Array(3), scratch = new Float32Array(1), scratchWord = new Uint32Array(scratch.buffer);
  for (let k = 0; k < 3; k++) { u[k] = Math.fround(positions[k + 3]! - positions[k]!); if (!Number.isFinite(positions[k]) || !Number.isFinite(u[k])) return null; }
  const start = Array.from(words.subarray(0, 3)), step = Array.from(new Uint32Array(u.buffer));
  const matches = (columns: number, v: Float32Array, sampled: boolean): boolean => {
    const n = sampled ? Math.min(count, EXACT_ENCODING_POLICY.gridSamples) : count;
    for (let sample = 1; sample < n; sample++) {
      const i = sampled ? Math.floor(sample * (count - 1) / (n - 1)) : sample;
      for (let k = 0; k < 3; k++) { scratch[0] = Math.fround(positions[k]! + u[k]! * (i % columns) + v[k]! * Math.floor(i / columns)); if (scratchWord[0] !== words[i * 3 + k]) return false; }
    }
    return true;
  };
  const zero = new Float32Array(3);
  if (matches(count, zero, true) && matches(count, zero, false)) return { recipe: { kind: 'affine', start, u: step }, generated: count - 1 };
  // A grid's first departure from its row direction identifies a source-derived
  // width. The remaining budget is deterministic divisor screening.
  const widths: number[] = [];
  for (let i = 2; i < Math.min(count, 4096); i++) {
    let differs = false;
    for (let k = 0; k < 3; k++) { scratch[0] = Math.fround(positions[k]! + u[k]! * i); if (scratchWord[0] !== words[i * 3 + k]) differs = true; }
    if (differs) { if (count % i === 0) widths.push(i); break; }
  }
  for (let i = 2; i * i <= count && widths.length < EXACT_ENCODING_POLICY.gridCandidates; i++) if (count % i === 0) { if (!widths.includes(i)) widths.push(i); if (widths.length < EXACT_ENCODING_POLICY.gridCandidates && count / i !== i && !widths.includes(count / i)) widths.push(count / i); }
  for (const columns of widths) {
    const v = new Float32Array(3); for (let k = 0; k < 3; k++) v[k] = Math.fround(positions[columns * 3 + k]! - positions[k]!);
    if (v.some(x => !Number.isFinite(x))) continue;
    if (matches(columns, v, true) && matches(columns, v, false)) return { recipe: { kind: 'grid', start, u: step, v: Array.from(new Uint32Array(v.buffer)), columns }, generated: count - 1 };
  }
  return null;
}
function planarFan(positions: Float32Array, indices: NonNullable<SurfaceInput['indices']>, start: number, count: number): boolean {
  const a = indices[start * 3]! * 3, b = indices[start * 3 + 1]! * 3, c = indices[start * 3 + 2]! * 3;
  const ux = positions[b]! - positions[a]!, uy = positions[b + 1]! - positions[a + 1]!, uz = positions[b + 2]! - positions[a + 2]!;
  const vx = positions[c]! - positions[a]!, vy = positions[c + 1]! - positions[a + 1]!, vz = positions[c + 2]! - positions[a + 2]!;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if ((nx === 0 && ny === 0 && nz === 0) || !Number.isFinite(nx + ny + nz)) return false;
  for (let i = 0; i < count; i++) { const at = indices[(start + i) * 3 + 2]! * 3; if (nx * (positions[at]! - positions[a]!) + ny * (positions[at + 1]! - positions[a + 1]!) + nz * (positions[at + 2]! - positions[a + 2]!) !== 0) return false; }
  return true;
}
function topologyOperations(positions: Float32Array, indices: NonNullable<SurfaceInput['indices']>): { program: Uint32Array; counts: Counts } | null {
  const triangles = indices.length / 3, program: number[] = [], counts: Counts = { explicitResidualTriangles: 0, filledContourTriangles: 0, stripTriangles: 0, mirroredTriangles: 0 };
  let triangle = 0, literal = -1, generated = 0;
  const flush = () => { if (literal < 0) return; const n = triangle - literal; program.push(0, n); for (let i = literal * 3; i < triangle * 3; i++) program.push(indices[i]!); counts.explicitResidualTriangles += n; literal = -1; };
  while (triangle < triangles) {
    const at = triangle * 3, a = indices[at]!, b = indices[at + 1]!, c = indices[at + 2]!;
    let fan = 1, strip = 1;
    while (triangle + fan < triangles) { const i = (triangle + fan) * 3; if (indices[i] !== a || indices[i + 1] !== indices[i - 1]) break; fan++; }
    let previousA = b, previousB = c;
    while (triangle + strip < triangles) { const i = (triangle + strip) * 3, nextA = strip % 2 ? previousB : previousA, nextB = strip % 2 ? previousA : previousB; if (indices[i] !== nextA || indices[i + 1] !== nextB) break; previousA = previousB; previousB = indices[i + 2]!; strip++; }
    if (fan >= 3 || strip >= 3) {
      flush(); const useFan = fan >= strip, n = useFan ? fan : strip, planar = useFan && planarFan(positions, indices, triangle, n); program.push(useFan ? planar ? 4 : 1 : 2, n, a, b, c);
      for (let i = 1; i < n; i++) program.push(indices[(triangle + i) * 3 + 2]!);
      if (planar) counts.filledContourTriangles += n; else if (useFan) counts.explicitResidualTriangles += n; else counts.stripTriangles += n;
      generated += n; triangle += n;
    } else { if (literal < 0) literal = triangle; triangle++; }
  }
  flush(); return generated ? { program: new Uint32Array(program), counts } : null;
}
/** One screened exact coordinate reuse/mirror candidate. No axis sweep of
 * compressed outputs; the existing decoder flips stored Float32 sign words. */
function inferMirrorReuse(positions:Float32Array){
 const count=positions.length/3;if(count<32||count>262144)return null;const words=new Uint32Array(positions.buffer,positions.byteOffset,positions.length),samples=Math.min(count,1024);let axis=-1,best=samples;
 for(let k=0;k<3;k++){const keys=new Set<string>();for(let j=0;j<samples;j++){const i=Math.floor(j*count/samples)*3,a=words[i]!,b=words[i+1]!,c=words[i+2]!;keys.add((k===0?a&0x7fffffff:a)+','+(k===1?b&0x7fffffff:b)+','+(k===2?c&0x7fffffff:c));}if(keys.size<best){best=keys.size;axis=k;}}
 if(axis<0||best>samples*.75)return null;const table=new Map<string,number>(),canonical:number[]=[],codes=new Uint32Array(count);
 for(let i=0;i<count;i++){const row=[words[i*3]!,words[i*3+1]!,words[i*3+2]!],sign=row[axis]!>>>31;row[axis]=row[axis]!&0x7fffffff;const key=row.join(',');let id=table.get(key);if(id===undefined){id=table.size;table.set(key,id);canonical.push(...row);}codes[i]=id*2+sign;}
 if(table.size*12+codes.byteLength>=positions.byteLength)return null;
 const a=encodeExactBuffer(typedBytes(new Uint32Array(canonical)),{stride:12,componentBytes:4}),b=encodeExactBuffer(typedBytes(codes),{stride:4,componentBytes:4});
 return{recipe:{kind:'mirror' as const,axis,canonicalCount:table.size,canonical:a.recipe,codes:b.recipe},generated:count-table.size,candidates:a.metrics.fullCandidates+b.metrics.fullCandidates,screened:a.metrics.screenedBytes+b.metrics.screenedBytes};
}
export interface ExactSurfaceMetrics extends SurfaceMetrics { fixedBudget: typeof EXACT_ENCODING_POLICY; bufferCandidates: number; screenedBytes: number; costBasis: string }
export function encodeSurface(input: SurfaceInput): { recipe: SurfaceRecipe; metrics: ExactSurfaceMetrics } {
  if (!(input.positions instanceof Float32Array) || input.positions.length % 3 || input.positions.byteLength > MAX_SURFACE_BYTES) fail('invalid positions');
  if (input.indices !== null && !(input.indices instanceof Uint8Array) && !(input.indices instanceof Uint16Array) && !(input.indices instanceof Uint32Array)) fail('invalid indices');
  const vertexCount = input.positions.length / 3, mode = integer(input.mode ?? 4, 0, 6, 'mode'), indexType = input.indices === null ? 0 : input.indices instanceof Uint8Array ? 5121 : input.indices instanceof Uint16Array ? 5123 : 5125;
  if (input.indices && input.indices.byteLength > MAX_SURFACE_BYTES) fail('indices exceed limit');
  for (const i of input.indices ?? []) if (i >= vertexCount) fail('index out of range');
  const encodedPosition = encodeExactBuffer(typedBytes(input.positions), { stride: 12, componentBytes: 4 });
  const encodedIndex = input.indices ? encodeExactBuffer(typedBytes(input.indices), { stride: input.indices.BYTES_PER_ELEMENT, componentBytes: input.indices.BYTES_PER_ELEMENT }) : null;
  const baseline: SurfaceRecipe = { version: 2, vertexCount, mode, indexType, indexCount: input.indices?.length ?? 0, positions: { kind: 'residual', buffer: encodedPosition.fixedResidual }, topology: encodedIndex ? { kind: 'residual', buffer: encodedIndex.fixedResidual } : { kind: 'unindexed' } };
  const residualRecipeBytes = exactRecipeBytes(baseline), recipe: SurfaceRecipe = { ...baseline, positions: { kind: 'residual', buffer: encodedPosition.recipe }, topology: encodedIndex ? { kind: 'residual', buffer: encodedIndex.recipe } : { kind: 'unindexed' } };
  let generated = 0, mirrorGenerated = 0, bufferCandidates = encodedPosition.metrics.fullCandidates + (encodedIndex?.metrics.fullCandidates ?? 0), screenedBytes = encodedPosition.metrics.screenedBytes + (encodedIndex?.metrics.screenedBytes ?? 0);
  const inferred = inferPositions(input.positions);
  if (inferred && exactRecipeBytes(inferred.recipe) < exactRecipeBytes(recipe.positions)) { recipe.positions = inferred.recipe; generated = inferred.generated; }
  const reused=inferMirrorReuse(input.positions);if(reused){bufferCandidates+=reused.candidates;screenedBytes+=reused.screened;if(exactRecipeBytes(reused.recipe)<exactRecipeBytes(recipe.positions)){recipe.positions=reused.recipe;generated=0;mirrorGenerated=reused.generated;}}
  let counts: Counts = { explicitResidualTriangles: mode === 4 ? Math.floor((input.indices?.length ?? vertexCount) / 3) : 0, filledContourTriangles: 0, stripTriangles: 0, mirroredTriangles: 0 };
  if (mode === 4 && input.indices && input.indices.length % 3 === 0 && input.indices.length / 3 <= EXACT_ENCODING_POLICY.topologyTriangles) {
    const operations = topologyOperations(input.positions, input.indices);
    if (operations) {
      const encoded = encodeExactBuffer(typedBytes(operations.program), { stride: 4, componentBytes: 4 }), topology: SurfaceRecipe['topology'] = { kind: 'operations', program: encoded.recipe };
      bufferCandidates += encoded.metrics.fullCandidates; screenedBytes += encoded.metrics.screenedBytes;
      if (exactRecipeBytes(topology) < exactRecipeBytes(recipe.topology)) { recipe.topology = topology; counts = operations.counts; }
    }
  }
  // Component wins can alter block deduplication, so enforce the complete surface gate too.
  if (exactRecipeBytes(recipe) > residualRecipeBytes) { recipe.positions = baseline.positions; recipe.topology = baseline.topology; generated = 0; mirrorGenerated = 0; counts = { explicitResidualTriangles: mode === 4 ? Math.floor((input.indices?.length ?? vertexCount) / 3) : 0, filledContourTriangles: 0, stripTriangles: 0, mirroredTriangles: 0 }; }
  return { recipe, metrics: { recipeBytes: exactRecipeBytes(recipe), residualRecipeBytes, positionOperation: recipe.positions.kind, topologyOperation: recipe.topology.kind, ...counts, affineGeneratedVertices: generated, mirrorGeneratedVertices: mirrorGenerated, exactPositions: true, exactIndexOrder: true, decoderCost: 'Existing native surface and buffer decoder; include complete shared decoder once in the enclosing package', fixedBudget: EXACT_ENCODING_POLICY, bufferCandidates, screenedBytes, costBasis } };
}
