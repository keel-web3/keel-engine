/** Isolated exact-image experiment. Keep PNG filtered sample bytes and all supported
 * non-IDAT chunks unchanged, but defer their compression to the complete asset's
 * outer transport. Replay recreates ordinary PNG bytes with pinned fflate 0.8.2.
 * This preserves dimensions, sample depth/type, palette, transparency and supported
 * color metadata, but is not file-byte exact. No lossy conversion is involved.
 */
import { zlibSync } from 'fflate';
import { crc32, isPng } from '../png.ts';
import { decodeBuffer } from '../asset-buffer-codec.ts';

const MAX_BYTES = 64 * 1024 * 1024, MAX_PIXELS = 16 * 1024 * 1024;
export interface ExactPngRecipe {
  kind: 'exact-png-scanlines-v1';
  prefix: Uint8Array;
  suffix: Uint8Array;
  scanlines: Uint8Array;
  width: number;
  height: number;
  sourceBytes: number;
  scanlineCRC32: number;
}
interface PngInfo { prefix: Uint8Array; suffix: Uint8Array; compressed: Uint8Array; width: number; height: number; length: number }
function fail(message: string): never { throw Error('Exact image experiment: ' + message); }
function same(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((v, i) => v === b[i]); }
function join(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((n, c) => n + c.length, 0); if (length > MAX_BYTES * 2) fail('byte budget exceeded');
  const out = new Uint8Array(length); let at = 0; for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; } return out;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12), view = new DataView(out.buffer); view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4); out.set(data, 8); view.setUint32(out.length - 4, crc32(out, 4, out.length - 4)); return out;
}
/** Preserve profiles and color interpretation verbatim. Unknown chunks, animation,
 * signatures, 16-bit samples and interlace are conservatively ineligible. */
function inspect(data: Uint8Array): PngInfo {
  if (!(data instanceof Uint8Array) || !isPng(data) || data.length > MAX_BYTES) fail('unsupported PNG input');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength), idat: Uint8Array[] = [];
  let at = 8, width = 0, height = 0, depth = 0, color = 0, first = -1, last = -1, ended = false, palette = 0;
  const seen = new Set<string>();
  while (at < data.length) {
    if (at + 12 > data.length) fail('truncated chunk');
    const n = view.getUint32(at), end = at + n + 12;
    if (end > data.length) fail('chunk exceeds file');
    const type = String.fromCharCode(...data.subarray(at + 4, at + 8)), bytes = data.subarray(at + 8, end - 4);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(data, at + 4, end - 4) !== view.getUint32(end - 4)) fail('chunk CRC/type mismatch');
    if (at === 8 && type !== 'IHDR') fail('IHDR must be first');
    if (type !== 'IDAT' && seen.has(type)) fail('duplicate chunk');
    if (type === 'IHDR') {
      if (at !== 8 || n !== 13) fail('invalid IHDR');
      width = view.getUint32(at + 8); height = view.getUint32(at + 12); depth = bytes[8]!; color = bytes[9]!;
      if (!width || !height || width * height > MAX_PIXELS || bytes[10] || bytes[11] || bytes[12]) fail('unsupported dimensions/interlace');
      if (!([0, 2, 3, 4, 6].includes(color)) || !(depth === 8 || (color === 0 || color === 3) && [1, 2, 4].includes(depth))) fail('unsupported samples');
    } else if (type === 'IDAT') {
      if (first >= 0 && at !== last || color === 3 && !palette) fail('invalid IDAT ordering');
      if (first < 0) first = at; last = end; idat.push(bytes);
    } else if (type === 'PLTE') {
      if (first >= 0 || !n || n > 768 || n % 3 || color === 0 || color === 4) fail('invalid palette');
      palette = n / 3; if (color === 3 && palette > 2 ** depth) fail('palette exceeds bit depth');
    } else if (type === 'tRNS') {
      if (first >= 0 || color === 3 && (!palette || !n || n > palette) || color === 0 && n !== 2 || color === 2 && n !== 6 || ![0, 2, 3].includes(color)) fail('invalid transparency');
    } else if (type === 'pHYs') { if (first >= 0 || n !== 9 || bytes[8]! > 1) fail('invalid pHYs'); }
    else if (type === 'gAMA') { if (first >= 0 || palette || n !== 4 || !view.getUint32(at + 8)) fail('invalid gAMA'); }
    else if (type === 'cHRM') { if (first >= 0 || palette || n !== 32) fail('invalid cHRM'); }
    else if (type === 'sRGB') { if (first >= 0 || palette || n !== 1 || bytes[0]! > 3 || seen.has('iCCP')) fail('invalid sRGB'); }
    else if (type === 'iCCP') { const zero = bytes.indexOf(0); if (first >= 0 || palette || zero < 1 || zero > 79 || zero + 2 >= n || bytes[zero + 1] !== 0 || seen.has('sRGB')) fail('invalid iCCP'); }
    else if (type === 'IEND') { if (n || first < 0 || end !== data.length) fail('invalid IEND'); ended = true; }
    else fail('unsupported PNG chunk ' + type);
    seen.add(type); at = end;
  }
  if (!ended) fail('missing IEND');
  const channels = color === 0 || color === 3 ? 1 : color === 2 ? 3 : color === 4 ? 2 : 4;
  return { prefix: data.slice(0, first), suffix: data.slice(last), compressed: join(idat), width, height, length: height * (Math.ceil(width * channels * depth / 8) + 1) };
}
export function encodeExactPngScanlines(input: { mimeType: string; data: Uint8Array }): { recipe: ExactPngRecipe | null; reason: string; fileBytesExact: boolean; decodedSamplesExact: boolean | null } {
  if (input.mimeType !== 'image/png') return { recipe: null, reason: 'non-PNG retained byte-exact', fileBytesExact: true, decodedSamplesExact: null };
  try {
    const info = inspect(input.data), scanlines = decodeBuffer({ codec: 'zlib', data: info.compressed, sourceLength: info.length, parameters: { version: 1 } }, MAX_BYTES + 16384);
    const stride = scanlines.length / info.height;
    for (let y = 0; y < info.height; y++) if (scanlines[y * stride]! > 4) fail('invalid PNG row filter');
    const recipe: ExactPngRecipe = { kind: 'exact-png-scanlines-v1', prefix: info.prefix, suffix: info.suffix, scanlines, width: info.width, height: info.height, sourceBytes: input.data.length, scanlineCRC32: crc32(scanlines) };
    const replay = inspect(replayExactPngScanlines(recipe)), actual = decodeBuffer({ codec: 'zlib', data: replay.compressed, sourceLength: replay.length, parameters: { version: 1 } }, MAX_BYTES + 16384);
    if (!same(actual, scanlines) || !same(replay.prefix, info.prefix) || !same(replay.suffix, info.suffix)) fail('roundtrip sample/metadata mismatch');
    return { recipe, reason: 'unchanged filtered samples and non-IDAT bytes; PNG compression only is regenerated', fileBytesExact: false, decodedSamplesExact: true };
  } catch (error) { return { recipe: null, reason: error instanceof Error ? error.message : String(error), fileBytesExact: true, decodedSamplesExact: null }; }
}
export function replayExactPngScanlines(recipe: ExactPngRecipe): Uint8Array {
  if (recipe?.kind !== 'exact-png-scanlines-v1' || !(recipe.prefix instanceof Uint8Array) || !(recipe.suffix instanceof Uint8Array) || !(recipe.scanlines instanceof Uint8Array) || recipe.scanlines.length > MAX_BYTES + 16384 || !Number.isSafeInteger(recipe.sourceBytes) || recipe.sourceBytes < 0 || recipe.sourceBytes > MAX_BYTES || !Number.isInteger(recipe.scanlineCRC32) || recipe.scanlineCRC32 < 0 || recipe.scanlineCRC32 > 0xffffffff || crc32(recipe.scanlines) !== recipe.scanlineCRC32) fail('invalid recipe/checksum');
  // Stored DEFLATE is fast and deterministic. Outer transport already compressed
  // samples; replayed PNG bytes are ephemeral and need no second slow compression.
  const data = join([recipe.prefix, chunk('IDAT', zlibSync(recipe.scanlines, { level: 0 })), recipe.suffix]), info = inspect(data);
  if (info.width !== recipe.width || info.height !== recipe.height || info.length !== recipe.scanlines.length || !same(info.prefix, recipe.prefix) || !same(info.suffix, recipe.suffix)) fail('recipe dimensions/scanline layout mismatch');
  const stride = info.length / info.height; for (let y = 0; y < info.height; y++) if (recipe.scanlines[y * stride]! > 4) fail('invalid PNG row filter');
  return data;
}
