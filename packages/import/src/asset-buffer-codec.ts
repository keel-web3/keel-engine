/** Deterministic, reversible byte codecs. No floating-point interpretation or asset templates.
 * Candidate cost is stored payload + canonical UTF-8 metadata. The identical shared decoder
 * runtime is a package-level cost (charged once by the outer compiler), not hidden per segment.
 * Version 1 fixes candidate order, zlib level 9 and first-occurrence dictionary ordering.
 */
import { zlibSync, unzlibSync } from 'fflate';

export const BUFFER_CODEC_VERSION = 1;
export const BUFFER_CODEC_MAX_BYTES = 536870912;
const MAX_STRIDE = 4096;
const MAX_DICTIONARY_ROWS = 262144;
const CODECS = ['raw', 'zlib', 'byteplanes-zlib', 'delta-zlib', 'xor-zlib', 'delta-byteplanes-zlib', 'xor-byteplanes-zlib', 'row-dictionary-zlib', 'float32-runs-zlib'] as const;
type Codec = typeof CODECS[number];
export interface BufferHints { stride?: number; componentBytes?: number }
export interface EncodedBuffer {
  codec: string;
  data: Uint8Array;
  parameters: Record<string, number>;
  sourceLength: number;
  /** Actual candidate payload + canonical metadata bytes; ties use CODECS order. */
  candidates: Array<{ codec: string; bytes: number }>;
}
function integer(n: unknown, min: number, max: number, name: string): number {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid ${name}`);
  return n;
}
function shape(hints: BufferHints | undefined, length: number): { stride: number; componentBytes: number } | null {
  if (!hints || (hints.stride === undefined && hints.componentBytes === undefined)) return null;
  const componentBytes = integer(hints.componentBytes === undefined ? 1 : hints.componentBytes, 1, 8, 'componentBytes');
  if (![1, 2, 4, 8].includes(componentBytes)) throw new Error('Invalid componentBytes');
  const stride = integer(hints.stride === undefined ? componentBytes : hints.stride, 1, MAX_STRIDE, 'stride');
  if (stride % componentBytes) throw new Error('Stride must contain complete components');
  return length % stride === 0 ? { stride, componentBytes } : null;
}
function metadata(record: Pick<EncodedBuffer, 'codec' | 'parameters' | 'sourceLength'>): Uint8Array {
  const parameters: Record<string, number> = {};
  for (const k of Object.keys(record.parameters).sort()) parameters[k] = record.parameters[k]!;
  return new TextEncoder().encode(JSON.stringify({ codec: record.codec, parameters, sourceLength: record.sourceLength }));
}
export function bufferCodecMetadataBytes(record: Pick<EncodedBuffer, 'codec' | 'parameters' | 'sourceLength'>): number {
  return metadata(record).length;
}
function planes(source: Uint8Array, width: number, inverse = false): Uint8Array {
  const out = new Uint8Array(source.length), words = source.length / width;
  for (let word = 0; word < words; word++) for (let lane = 0; lane < width; lane++) {
    if (inverse) out[word * width + lane] = source[lane * words + word]!;
    else out[lane * words + word] = source[word * width + lane]!;
  }
  return out;
}
/** Bytewise little-endian modular arithmetic also handles 64-bit words exactly. */
function predict(source: Uint8Array, stride: number, width: number, xor: boolean, inverse = false): Uint8Array {
  const out = new Uint8Array(source.length);
  for (let i = 0; i < source.length; i += width) {
    let carry = 0;
    for (let lane = 0; lane < width; lane++) {
      const previous = i >= stride ? (inverse ? out : source)[i - stride + lane]! : 0;
      const current = source[i + lane]!;
      if (xor) out[i + lane] = current ^ previous;
      else {
        const value = inverse ? current + previous + carry : current - previous - carry;
        out[i + lane] = value & 255;
        carry = inverse ? (value > 255 ? 1 : 0) : (value < 0 ? 1 : 0);
      }
    }
  }
  return out;
}
function dictionary(source: Uint8Array, stride: number): { data: Uint8Array; dictionaryRows: number; indexBytes: number } | null {
  const rows = source.length / stride;
  if (!rows || rows > MAX_DICTIONARY_ROWS) return null;
  const buckets = new Map<number, number[]>(), unique: number[] = [], indices = new Uint32Array(rows);
  for (let row = 0; row < rows; row++) {
    let hash = 2166136261;
    for (let k = 0; k < stride; k++) hash = Math.imul(hash ^ source[row * stride + k]!, 16777619) >>> 0;
    const bucket = buckets.get(hash) ?? [];
    let found = -1;
    for (const candidate of bucket) {
      let equal = true;
      for (let k = 0; k < stride; k++) if (source[row * stride + k] !== source[unique[candidate]! * stride + k]) { equal = false; break; }
      if (equal) { found = candidate; break; }
    }
    if (found < 0) {
      // Explicit collision/work bound, independent of wall time or nondeterministic hash maps.
      if (bucket.length >= 64) return null;
      found = unique.length; unique.push(row); bucket.push(found); buckets.set(hash, bucket);
    }
    indices[row] = found;
  }
  if (unique.length === rows) return null;
  const indexBytes = unique.length <= 256 ? 1 : unique.length <= 65536 ? 2 : 4;
  const data = new Uint8Array(unique.length * stride + rows * indexBytes);
  unique.forEach((row, i) => data.set(source.subarray(row * stride, row * stride + stride), i * stride));
  const offset = unique.length * stride;
  for (let row = 0; row < rows; row++) for (let lane = 0; lane < indexBytes; lane++) data[offset + row * indexBytes + lane] = indices[row]! >>> (8 * lane) & 255;
  return { data, dictionaryRows: unique.length, indexBytes };
}
/** Infer arithmetic only when the regenerated IEEE754 words are exactly identical.
 * Runs are source-derived; no model names, geometry templates, tolerances or quantization.
 */
function float32Runs(source: Uint8Array, stride: number): Uint8Array | null {
  const rows = source.length / stride;
  if (rows < 2 || rows > MAX_DICTIONARY_ROWS) return null;
  const sourceView = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const scratch = new DataView(new ArrayBuffer(4));
  type Run = { type: number; start: number; count: number; steps?: Uint8Array };
  const runs: Run[] = [];
  const infer = (start: number): Run | null => {
    let count = 1;
    same: while (start + count < rows) {
      for (let k = 0; k < stride; k++) if (source[start * stride + k] !== source[(start + count) * stride + k]) break same;
      count++;
    }
    if (count >= 2) return { type: 1, start, count };
    if (start + 4 > rows) return null;
    const steps = new Uint8Array(stride), stepView = new DataView(steps.buffer);
    for (let k = 0; k < stride; k += 4) {
      const first = sourceView.getFloat32(start * stride + k, true);
      const second = sourceView.getFloat32((start + 1) * stride + k, true);
      const step = Math.fround(second - first);
      if (!Number.isFinite(first) || !Number.isFinite(step)) return null;
      stepView.setFloat32(k, step, true);
    }
    count = 1;
    affine: while (start + count < rows) {
      for (let k = 0; k < stride; k += 4) {
        const first = sourceView.getFloat32(start * stride + k, true), step = stepView.getFloat32(k, true);
        scratch.setFloat32(0, Math.fround(first + step * count), true);
        if (scratch.getUint32(0, true) !== sourceView.getUint32((start + count) * stride + k, true)) break affine;
      }
      count++;
    }
    return count >= 4 ? { type: 2, start, count, steps } : null;
  };
  let row = 0, literal = -1, inferred = false;
  while (row < rows) {
    const run = infer(row);
    if (run) { if (literal >= 0) runs.push({ type: 0, start: literal, count: row - literal }); literal = -1; runs.push(run); row += run.count; inferred = true; }
    else { if (literal < 0) literal = row; row++; }
  }
  if (literal >= 0) runs.push({ type: 0, start: literal, count: rows - literal });
  if (!inferred) return null;
  const length = runs.reduce((n, run) => n + 5 + (run.type === 0 ? run.count * stride : run.type === 1 ? stride : 2 * stride), 0);
  const output = new Uint8Array(length), view = new DataView(output.buffer); let cursor = 0;
  for (const run of runs) {
    output[cursor++] = run.type; view.setUint32(cursor, run.count, true); cursor += 4;
    const literalLength = run.type === 0 ? run.count * stride : stride;
    output.set(source.subarray(run.start * stride, run.start * stride + literalLength), cursor); cursor += literalLength;
    if (run.type === 2) { output.set(run.steps!, cursor); cursor += stride; }
  }
  return output;
}
function restoreFloat32Runs(data: Uint8Array, length: number, stride: number): Uint8Array {
  const out = new Uint8Array(length), input = new DataView(data.buffer, data.byteOffset, data.byteLength), output = new DataView(out.buffer);
  let cursor = 0, row = 0; const rows = length / stride;
  while (cursor < data.length) {
    if (cursor + 5 > data.length) throw new Error('Truncated procedural run');
    const type = data[cursor++]!, count = input.getUint32(cursor, true); cursor += 4;
    if (!count || count > rows - row || type > 2 || (type === 1 && count < 2) || (type === 2 && count < 4)) throw new Error('Invalid procedural run');
    const stored = type === 0 ? count * stride : type === 1 ? stride : 2 * stride;
    if (cursor + stored > data.length) throw new Error('Truncated procedural data');
    if (type === 0) out.set(data.subarray(cursor, cursor + stored), row * stride);
    else if (type === 1) for (let i = 0; i < count; i++) out.set(data.subarray(cursor, cursor + stride), (row + i) * stride);
    else {
      for (let k = 0; k < stride; k += 4) {
        const first = input.getFloat32(cursor + k, true), step = input.getFloat32(cursor + stride + k, true);
        if (!Number.isFinite(first) || !Number.isFinite(step)) throw new Error('Invalid affine seed or step');
        // The seed is copied bit-for-bit, including signed zero. Later rows execute arithmetic.
        output.setUint32(row * stride + k, input.getUint32(cursor + k, true), true);
        for (let i = 1; i < count; i++) output.setFloat32((row + i) * stride + k, Math.fround(first + step * i), true);
      }
    }
    row += count; cursor += stored;
  }
  if (row !== rows) throw new Error('Incomplete procedural rows');
  return out;
}
export function encodeBuffer(bytes: Uint8Array, hints?: BufferHints): EncodedBuffer {
  if (!(bytes instanceof Uint8Array)) throw new Error('Expected Uint8Array');
  integer(bytes.length, 0, BUFFER_CODEC_MAX_BYTES, 'source length');
  const layout = shape(hints, bytes.length), candidates: EncodedBuffer['candidates'] = [];
  let winner: EncodedBuffer | undefined, winnerCost = Infinity;
  const consider = (codec: Codec, data: Uint8Array, parameters: Record<string, number>) => {
    const record: EncodedBuffer = { codec, data, parameters: { version: BUFFER_CODEC_VERSION, ...parameters }, sourceLength: bytes.length, candidates: [] };
    const cost = data.length + bufferCodecMetadataBytes(record);
    candidates.push({ codec, bytes: cost });
    if (cost < winnerCost) { winner = record; winnerCost = cost; }
  };
  consider('raw', new Uint8Array(bytes), {});
  consider('zlib', zlibSync(bytes, { level: 9 }), {});
  if (layout && bytes.length) {
    const { stride, componentBytes } = layout, params = { stride, componentBytes };
    if (componentBytes > 1) consider('byteplanes-zlib', zlibSync(planes(bytes, componentBytes), { level: 9 }), params);
    consider('delta-zlib', zlibSync(predict(bytes, stride, componentBytes, false), { level: 9 }), params);
    consider('xor-zlib', zlibSync(predict(bytes, stride, componentBytes, true), { level: 9 }), params);
    if (componentBytes > 1) {
      consider('delta-byteplanes-zlib', zlibSync(planes(predict(bytes, stride, componentBytes, false), componentBytes), { level: 9 }), params);
      consider('xor-byteplanes-zlib', zlibSync(planes(predict(bytes, stride, componentBytes, true), componentBytes), { level: 9 }), params);
    }
    const dict = dictionary(bytes, stride);
    if (dict) consider('row-dictionary-zlib', zlibSync(dict.data, { level: 9 }), { stride, dictionaryRows: dict.dictionaryRows, indexBytes: dict.indexBytes });
    if (componentBytes === 4) { const runs = float32Runs(bytes, stride); if (runs) consider('float32-runs-zlib', zlibSync(runs, { level: 9 }), { stride, componentBytes, decodedLength: runs.length }); }
  }
  winner!.candidates = candidates;
  return winner!;
}

/** Validate the DEFLATE output length BEFORE inflation/allocation. Unlike relying on a
 * fixed output buffer (which can silently truncate), this rejects overlong streams.
 * Huffman tables and all parser state are bounded; backreferences only update a count.
 */
function deflateLength(data: Uint8Array, expected: number): void {
  if (data.length < 6 || (data[0]! & 15) !== 8 || data[0]! >>> 4 > 7 || ((data[0]! << 8) | data[1]!) % 31 || (data[1]! & 32)) throw new Error('Invalid zlib header');
  let bit = 16, produced = 0;
  const end = (data.length - 4) * 8;
  const read = (count: number): number => {
    if (bit + count > end) throw new Error('Truncated DEFLATE stream');
    let value = 0; for (let i = 0; i < count; i++, bit++) value |= (data[Math.floor(bit / 8)]! >>> (bit % 8) & 1) << i;
    return value;
  };
  type Huffman = { table: Map<number, number>; max: number };
  const huffman = (lengths: number[], allowEmpty = false): Huffman => {
    const counts = new Uint16Array(16), next = new Uint16Array(16), table = new Map<number, number>();
    let max = 0; for (const length of lengths) { if (length > 15) throw new Error('Invalid Huffman length'); if (length) { counts[length] = counts[length]! + 1; max = Math.max(max, length); } }
    if (!max) { if (allowEmpty) return { table, max }; throw new Error('Empty Huffman tree'); }
    let available = 1, code = 0;
    for (let bits = 1; bits <= 15; bits++) { available = available * 2 - counts[bits]!; if (available < 0) throw new Error('Oversubscribed Huffman tree'); code = (code + counts[bits - 1]!) * 2; next[bits] = code; }
    for (let symbol = 0; symbol < lengths.length; symbol++) { const length = lengths[symbol]!; if (!length) continue; let value = next[length]!, reversed = 0; next[length] = value + 1; for (let i = 0; i < length; i++) { reversed = reversed * 2 + (value & 1); value >>>= 1; } table.set((1 << length) | reversed, symbol); }
    return { table, max };
  };
  const symbol = (tree: Huffman): number => { let value = 0; for (let length = 1; length <= tree.max; length++) { value |= read(1) << (length - 1); const found = tree.table.get((1 << length) | value); if (found !== undefined) return found; } throw new Error('Invalid Huffman code'); };
  const add = (n: number) => { produced += n; if (produced > expected) throw new Error('Inflated length exceeds declared length'); };
  const lengthBase = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const lengthExtra = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const distanceBase = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const distanceExtra = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  let final = 0;
  do {
    final = read(1); const type = read(2);
    if (type === 0) {
      bit = Math.ceil(bit / 8) * 8; const n = read(16), complement = read(16);
      if ((n ^ complement) !== 65535) throw new Error('Invalid stored block');
      add(n); if (bit + n * 8 > end) throw new Error('Truncated stored block'); bit += n * 8; continue;
    }
    if (type === 3) throw new Error('Invalid DEFLATE block type');
    let literals: Huffman, distances: Huffman;
    if (type === 1) {
      literals = huffman(Array.from({ length: 288 }, (_, i) => i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8));
      distances = huffman(Array(32).fill(5));
    } else {
      const literalCount = read(5) + 257, distanceCount = read(5) + 1, codeCount = read(4) + 4;
      if (literalCount > 286) throw new Error('Invalid literal alphabet');
      const order = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
      const codeLengths = Array(19).fill(0); for (let i = 0; i < codeCount; i++) codeLengths[order[i]!] = read(3);
      const codes = huffman(codeLengths), lengths: number[] = [], total = literalCount + distanceCount;
      while (lengths.length < total) {
        const value = symbol(codes);
        if (value <= 15) lengths.push(value);
        else {
          if (value === 16 && !lengths.length) throw new Error('Missing repeat prefix');
          const repeat = value === 16 ? read(2) + 3 : value === 17 ? read(3) + 3 : value === 18 ? read(7) + 11 : -1;
          if (repeat < 0 || lengths.length + repeat > total) throw new Error('Invalid Huffman repeat');
          const previous = value === 16 ? lengths[lengths.length - 1]! : 0;
          for (let i = 0; i < repeat; i++) lengths.push(previous);
        }
      }
      if (!lengths[256]) throw new Error('Missing end-of-block code');
      literals = huffman(lengths.slice(0, literalCount)); distances = huffman(lengths.slice(literalCount), true);
    }
    while (true) {
      const literal = symbol(literals);
      if (literal < 256) add(1);
      else if (literal === 256) break;
      else {
        if (literal > 285) throw new Error('Invalid length code');
        const index = literal - 257, length = lengthBase[index]! + read(lengthExtra[index]!);
        const distanceCode = symbol(distances); if (distanceCode > 29) throw new Error('Invalid distance code');
        const distance = distanceBase[distanceCode]! + read(distanceExtra[distanceCode]!);
        if (distance > produced) throw new Error('Invalid backward distance');
        add(length);
      }
    }
  } while (!final);
  if (produced !== expected || Math.ceil(bit / 8) !== data.length - 4) throw new Error('Unexpected inflated length or trailing bytes');
}
function inflateExact(data: Uint8Array, expected: number): Uint8Array {
  deflateLength(data, expected);
  const out = unzlibSync(data, { out: new Uint8Array(expected) });
  if (out.length !== expected) throw new Error('Unexpected decoded length');
  let a = 1, b = 0;
  for (let i = 0; i < out.length; i++) { a = (a + out[i]!) % 65521; b = (b + a) % 65521; }
  const checksum = ((b << 16) | a) >>> 0, end = data.length;
  const stored = ((data[end - 4]! << 24) | (data[end - 3]! << 16) | (data[end - 2]! << 8) | data[end - 1]!) >>> 0;
  if (checksum !== stored) throw new Error('Invalid zlib checksum');
  return out;
}
export function decodeBuffer(encoded: Omit<EncodedBuffer, 'candidates'> & { candidates?: EncodedBuffer['candidates'] }, maxBytes = BUFFER_CODEC_MAX_BYTES): Uint8Array {
  integer(maxBytes, 0, BUFFER_CODEC_MAX_BYTES, 'maximum length');
  if (!encoded || !(encoded.data instanceof Uint8Array) || !CODECS.includes(encoded.codec as Codec)) throw new Error('Invalid encoded buffer');
  const length = integer(encoded.sourceLength, 0, maxBytes, 'source length'), p = encoded.parameters;
  if (!p || typeof p !== 'object' || Array.isArray(p) || p.version !== BUFFER_CODEC_VERSION) throw new Error('Unsupported codec version');
  if (Object.values(p).some(value => typeof value !== 'number' || !Number.isSafeInteger(value))) throw new Error('Invalid numeric codec parameters');
  const allowed = encoded.codec === 'raw' || encoded.codec === 'zlib' ? ['version'] : encoded.codec === 'row-dictionary-zlib' ? ['version','stride','dictionaryRows','indexBytes'] : encoded.codec === 'float32-runs-zlib' ? ['version','stride','componentBytes','decodedLength'] : ['version','stride','componentBytes'];
  if (Object.keys(p).some(k => !allowed.includes(k)) || allowed.some(k => !Object.hasOwn(p, k))) throw new Error('Invalid codec parameters');
  if (encoded.codec === 'raw') { if (encoded.data.length !== length) throw new Error('Invalid raw length'); return new Uint8Array(encoded.data); }
  let decodedLength = length, stride = 0, width = 0, dictionaryRows = 0, indexBytes = 0;
  if (encoded.codec === 'row-dictionary-zlib') {
    stride = integer(p.stride, 1, MAX_STRIDE, 'stride');
    if (!length || length % stride) throw new Error('Invalid dictionary shape');
    const rows = length / stride;
    integer(rows, 1, MAX_DICTIONARY_ROWS, 'dictionary row count');
    dictionaryRows = integer(p.dictionaryRows, 1, rows, 'dictionary size');
    indexBytes = integer(p.indexBytes, 1, 4, 'dictionary index size');
    if (indexBytes !== (dictionaryRows <= 256 ? 1 : dictionaryRows <= 65536 ? 2 : 4)) throw new Error('Noncanonical dictionary index size');
    decodedLength = dictionaryRows * stride + rows * indexBytes;
    if (!Number.isSafeInteger(decodedLength) || decodedLength > 2 * maxBytes) throw new Error('Dictionary exceeds allocation bound');
  } else if (encoded.codec === 'float32-runs-zlib') {
    const layout = shape({ stride: p.stride!, componentBytes: p.componentBytes! }, length);
    if (!layout || !length || layout.componentBytes !== 4 || length / layout.stride > MAX_DICTIONARY_ROWS) throw new Error('Invalid procedural shape');
    stride = layout.stride;
    decodedLength = integer(p.decodedLength, 1, Math.min(2 * maxBytes + 5, length + 5 * length / stride), 'procedural encoded length');
  } else if (encoded.codec !== 'zlib') {
    const layout = shape({ stride: p.stride!, componentBytes: p.componentBytes! }, length);
    if (!layout || !length) throw new Error('Invalid predictive shape');
    stride = layout.stride; width = layout.componentBytes;
    if (encoded.codec.includes('byteplanes') && width === 1) throw new Error('Invalid byte-plane width');
  }
  if (encoded.data.length > decodedLength + Math.ceil(decodedLength / 16) + 1024) throw new Error('Oversized compressed payload');
  let decoded = inflateExact(encoded.data, decodedLength);
  if (encoded.codec === 'row-dictionary-zlib') {
    const rows = length / stride, start = dictionaryRows * stride, out = new Uint8Array(length);
    for (let row = 0; row < rows; row++) {
      let index = 0; for (let lane = 0; lane < indexBytes; lane++) index += decoded[start + row * indexBytes + lane]! * 2 ** (8 * lane);
      if (index >= dictionaryRows) throw new Error('Dictionary index out of range');
      out.set(decoded.subarray(index * stride, index * stride + stride), row * stride);
    }
    return out;
  }
  if (encoded.codec === 'float32-runs-zlib') return restoreFloat32Runs(decoded, length, stride);
  if (encoded.codec.includes('byteplanes')) decoded = planes(decoded, width, true);
  if (encoded.codec.startsWith('delta-') || encoded.codec.startsWith('xor-')) decoded = predict(decoded, stride, width, encoded.codec.startsWith('xor-'), true);
  return decoded;
}
