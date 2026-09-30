/** Generic deterministic semantic-lossless image recipes. No asset names, dimensions,
 * reference palettes or model identifiers participate in selection. Unsupported image
 * encodings/metadata retain their original bytes. Optimized PNGs retain every RGBA byte,
 * including RGB under transparent alpha; original PNG container bytes may differ.
 */
import { zlibSync } from 'fflate';
import { crc32, decodePng, encodePng, isPng } from './png.ts';
import { decodeBuffer } from './asset-buffer-codec.ts';

export const IMAGE_CODEC_VERSION = 3;
export const IMAGE_MAX_BYTES = 64 * 1024 * 1024;
export const IMAGE_MAX_PIXELS = 16 * 1024 * 1024;
const MAX_PLAIN = 128 * 1024 * 1024, MAX_COLORS = 65536;
/** Conservative measured cold-runtime charge. See v3-images/decoder-size.json. The
 * caller may supply its measured marginal shared-runtime bytes when bundling once. */
export const IMAGE_SHARED_DECODER_COST_BYTES = 6724;
type Codec = 'original' | 'original-zlib' | 'rgba-zlib' | 'palette-rows-zlib' | 'palette-blend-zlib';
export interface ImageColourMetadata {
  interpretation: 'source-image-and-material-unchanged';
  sourceBitDepth: number;
  sourceColourType: number;
  /** Supported non-color ancillary records copied exactly; profiles cause byte fallback. */
  ancillaryChunks: Array<{ type: 'pHYs'; data: number[] }>;
}
export interface ImageRecipe {
  version: 3; codec: Codec; mimeType: string; sourceBytes: number;
  data: Uint8Array;
  /** Expected bounded length after zlib inflation (or original byte length). */
  decodedLength: number;
  width?: number; height?: number; rgbaCRC32?: number;
  colourMetadata?: ImageColourMetadata;
}
export interface ImageCandidateCost { codec: Codec; paletteSize?: number; payloadBytes: number; metadataBytes: number; decoderBytes: number; totalBytes: number }
export interface ImageEncodeOptions { /** The complete measured incremental decoder cost, charged per decision. */ decoderCostBytes?: number }
export interface ImageEncodeResult {
  recipe: ImageRecipe;
  metrics: { sourceBytes: number; eligiblePNG: boolean; fallbackReason: string | null; selected: Codec; fileBytesExact: boolean; decodedRGBAExact: boolean | null; dimensions?: readonly [number, number]; uniqueColours?: number; candidates: ImageCandidateCost[]; selectionBasis: string; sourceCRC32: number; rgbaCRC32?: number };
}
export type DecodedImageRecipe =
  | { kind: 'original'; mimeType: string; data: Uint8Array; fileBytesExact: true }
  | { kind: 'rgba'; mimeType: 'image/png'; width: number; height: number; rgba: Uint8Array; colourMetadata: ImageColourMetadata; fileBytesExact: false };
function fail(message: string): never { throw new Error('Image codec v3: ' + message); }
function integer(n: unknown, lo: number, hi: number, name: string): number { if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < lo || n > hi) fail('invalid ' + name); return n; }
function same(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((v, i) => v === b[i]); }
function inflate(data: Uint8Array, length: number): Uint8Array { return decodeBuffer({ codec: 'zlib', data, sourceLength: length, parameters: { version: 1 } }, MAX_PLAIN); }
function metaBytes(recipe: ImageRecipe): number { const { data: _, ...metadata } = recipe; return new TextEncoder().encode(JSON.stringify(metadata)).length; }
function rgbaWord(a: Uint8Array, i: number): number { return ((a[i]! << 24) | (a[i + 1]! << 16) | (a[i + 2]! << 8) | a[i + 3]!) >>> 0; }
function wordBytes(word: number): number[] { return [word >>> 24, word >>> 16 & 255, word >>> 8 & 255, word & 255]; }
interface PngInfo { width: number; height: number; metadata: ImageColourMetadata }
/** Strict eligibility gate before native decodePng. Its 16-bit truncation and RGB
 * tRNS paths are deliberately ineligible. Unknown/profile/animation chunks fallback. */
function inspectPng(data: Uint8Array): PngInfo {
  if (!isPng(data)) fail('not PNG');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 8, width = 0, height = 0, depth = 0, colour = -1, ihdr = false, ended = false, idatSeen = false, idatEnded = false, paletteLength = 0, trnsSeen = false;
  const chunks: Uint8Array[] = [], ancillary: ImageColourMetadata['ancillaryChunks'] = [];
  while (at < data.length) {
    if (at + 12 > data.length) fail('truncated PNG chunk');
    const n = view.getUint32(at), end = at + 12 + n;
    if (end > data.length) fail('PNG chunk exceeds file');
    const type = String.fromCharCode(...data.subarray(at + 4, at + 8));
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(data, at + 4, end - 4) !== view.getUint32(end - 4)) fail('invalid PNG chunk CRC/type');
    const content = data.subarray(at + 8, end - 4);
    if (!ihdr && type !== 'IHDR') fail('IHDR must be first');
    if (type === 'IHDR') {
      if (ihdr || n !== 13) fail('invalid IHDR'); ihdr = true;
      width = integer(view.getUint32(at + 8), 1, IMAGE_MAX_PIXELS, 'PNG width'); height = integer(view.getUint32(at + 12), 1, IMAGE_MAX_PIXELS, 'PNG height');
      if (width * height > IMAGE_MAX_PIXELS) fail('PNG pixel budget exceeded');
      depth = content[8]!; colour = content[9]!;
      if (content[10] || content[11] || content[12]) fail('unsupported PNG compression/filter/interlace');
      if (!((colour === 2 || colour === 6) && depth === 8) && !(colour === 3 && [1, 2, 4, 8].includes(depth))) fail('unsupported PNG sample format');
    } else if (type === 'PLTE') {
      if (idatSeen || paletteLength || !n || n % 3 || n > 768 || (colour === 3 && n / 3 > 2 ** depth)) fail('invalid palette'); paletteLength = n / 3;
    } else if (type === 'tRNS') {
      if (colour !== 3 || idatSeen || trnsSeen || !paletteLength || !n || n > paletteLength) fail('unsupported/invalid tRNS'); trnsSeen = true;
    } else if (type === 'pHYs') {
      if (idatSeen || ancillary.length || n !== 9 || content[8]! > 1) fail('invalid pHYs');
      ancillary.push({ type: 'pHYs', data: Array.from(content) });
    } else if (type === 'IDAT') {
      if (idatEnded || (colour === 3 && !paletteLength)) fail('invalid IDAT order'); idatSeen = true; chunks.push(content);
    } else if (type === 'IEND') {
      if (n || !idatSeen || end !== data.length) fail('invalid IEND/trailing bytes'); ended = true;
    } else fail('unsupported PNG metadata/chunk: ' + type);
    if (idatSeen && type !== 'IDAT') idatEnded = true;
    at = end;
  }
  if (!ended) fail('missing IEND');
  const length = chunks.reduce((n, c) => n + c.length, 0), compressed = new Uint8Array(length); let p = 0;
  for (const c of chunks) { compressed.set(c, p); p += c.length; }
  const channels = colour === 2 ? 3 : colour === 6 ? 4 : 1;
  // Bounded DEFLATE validation/checksum BEFORE native PNG allocation/inflation.
  inflate(compressed, height * (Math.ceil(width * channels * depth / 8) + 1));
  return { width, height, metadata: { interpretation: 'source-image-and-material-unchanged', sourceBitDepth: depth, sourceColourType: colour, ancillaryChunks: ancillary } };
}
class Writer {
  a: number[] = [];
  byte(n: number): void { this.a.push(n); if (this.a.length > MAX_PLAIN) fail('recipe payload budget exceeded'); }
  uint(n: number): void { do { const k = n % 128; n = Math.floor(n / 128); this.byte(k | (n ? 128 : 0)); } while (n); }
  signed(n: number): void { this.uint(n < 0 ? -n * 2 - 1 : n * 2); }
  finish(): Uint8Array { return Uint8Array.from(this.a); }
}
class Reader {
  data: Uint8Array; at = 0;
  constructor(data: Uint8Array) { this.data = data; }
  byte(): number { if (this.at >= this.data.length) fail('truncated recipe'); return this.data[this.at++]!; }
  uint(max = 0xffffffff): number {
    let n = 0, multiplier = 1;
    for (let i = 0; i < 5; i++) { const b = this.byte(); n += (b & 127) * multiplier; if (!(b & 128)) { if (n > max || (i && !(b & 127))) fail('invalid/noncanonical varint'); return n; } multiplier *= 128; }
    return fail('varint too long');
  }
  signed(): number { const n = this.uint(); return n & 1 ? -(n + 1) / 2 : n / 2; }
  end(): void { if (this.at !== this.data.length) fail('trailing recipe bytes'); }
}
function rowRuns(ids: Uint32Array, start: number, width: number): { colours: number[]; lengths: number[] } {
  const colours: number[] = [], lengths: number[] = [];
  for (let x = 0; x < width;) { const c = ids[start + x]!; let end = x + 1; while (end < width && ids[start + end] === c) end++; colours.push(c); lengths.push(end - x); x = end; }
  return { colours, lengths };
}
function writeRows(w: Writer, ids: Uint32Array, width: number, height: number): void {
  let previous = { colours: [] as number[], lengths: [] as number[] };
  for (let y = 0; y < height; y++) {
    const row = rowRuns(ids, y * width, width), equal = row.colours.length === previous.colours.length && row.colours.every((v, i) => v === previous.colours[i]);
    if (equal) { if (row.lengths.every((v, i) => v === previous.lengths[i])) w.byte(0); else { w.byte(1); row.lengths.forEach((v, i) => w.signed(v - previous.lengths[i]!)); } }
    else { w.byte(2); w.uint(row.colours.length); row.colours.forEach(v => w.uint(v)); row.lengths.forEach(v => w.uint(v)); }
    previous = row;
  }
}
function readRows(r: Reader, width: number, height: number, palette: Uint8Array): Uint8Array {
  const out = new Uint8Array(width * height * 4), nc = palette.length / 4;
  let colours: number[] = [], lengths: number[] = [];
  for (let y = 0; y < height; y++) {
    const type = r.byte();
    if (type === 2) { const n = r.uint(width); if (!n) fail('empty row'); colours = Array.from({ length: n }, () => r.uint(nc - 1)); lengths = Array.from({ length: n }, () => r.uint(width)); }
    else if ((type === 0 || type === 1) && y) { if (type === 1) lengths = lengths.map(v => v + r.signed()); }
    else fail('invalid row command');
    let x = 0;
    for (let k = 0; k < colours.length; k++) { const n = lengths[k]!; if (!Number.isSafeInteger(n) || n <= 0 || x + n > width) fail('invalid row run'); const p = colours[k]! * 4; for (let j = 0; j < n; j++) out.set(palette.subarray(p, p + 4), ((y * width) + x++) * 4); }
    if (x !== width) fail('incomplete row');
  }
  return out;
}
function writePalette(w: Writer, words: readonly number[]): void { w.uint(words.length); words.forEach(v => wordBytes(v).forEach(b => w.byte(b))); }
function readPalette(r: Reader, maximum: number): Uint8Array { const n = r.uint(maximum); if (!n) fail('empty palette'); const p = new Uint8Array(n * 4); for (let i = 0; i < p.length; i++) p[i] = r.byte(); return p; }
function dictionary(rgba: Uint8Array): { words: number[]; counts: Map<number, number> } | null {
  const counts = new Map<number, number>();
  for (let i = 0; i < rgba.length; i += 4) { const key = rgbaWord(rgba, i); counts.set(key, (counts.get(key) ?? 0) + 1); if (counts.size > MAX_COLORS) return null; }
  const words = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a - b);
  return { words, counts };
}
function paletteRows(rgba: Uint8Array, width: number, height: number, words: readonly number[]): Uint8Array {
  const map = new Map(words.map((v, i) => [v, i])), ids = new Uint32Array(width * height), w = new Writer();
  for (let i = 0; i < ids.length; i++) ids[i] = map.get(rgbaWord(rgba, i * 4))!;
  writePalette(w, words); writeRows(w, ids, width, height); return w.finish();
}
function paletteBlend(rgba: Uint8Array, width: number, height: number, words: readonly number[]): Uint8Array {
  const base = words.map(wordBytes), ids = new Uint32Array(width * height), exceptions: number[] = [], map = new Map(words.map((v, i) => [v, i]));
  for (let i = 0; i < ids.length; i++) {
    const at = i * 4, exact = map.get(rgbaWord(rgba, at)); if (exact !== undefined) { ids[i] = exact; continue; }
    let best = Infinity, choice = 0;
    for (let k = 0; k < base.length; k++) { let e = 0; for (let c = 0; c < 4; c++) e += (rgba[at + c]! - base[k]![c]!) ** 2; if (e < best) { best = e; choice = k; } }
    ids[i] = choice; exceptions.push(i);
  }
  const pairs: Array<readonly [number, number]> = []; for (let a = 0; a < base.length; a++) for (let b = a + 1; b < base.length; b++) pairs.push([a, b]);
  const pairIds = new Uint8Array(exceptions.length), alphas = new Uint8Array(exceptions.length), deltas = new Int16Array(exceptions.length * 4);
  exceptions.forEach((pixel, i) => {
    let best = Infinity, pairId = 0, alpha = 0, predicted: number[] = [];
    pairs.forEach(([lo, hi], k) => {
      let numerator = 0, denominator = 0;
      for (let c = 0; c < 4; c++) { const d = base[hi]![c]! - base[lo]![c]!; numerator += (rgba[pixel * 4 + c]! - base[lo]![c]!) * d; denominator += d * d; }
      const t = Math.floor(Math.max(0, Math.min(1, numerator / denominator)) * 255 + 0.5), values: number[] = []; let error = 0;
      for (let c = 0; c < 4; c++) { const v = Math.floor((base[lo]![c]! * (255 - t) + base[hi]![c]! * t) / 255 + 0.5); values.push(v); error += (rgba[pixel * 4 + c]! - v) ** 2; }
      if (error < best) { best = error; pairId = k; alpha = t; predicted = values; }
    });
    pairIds[i] = pairId; alphas[i] = alpha; for (let c = 0; c < 4; c++) deltas[i * 4 + c] = rgba[pixel * 4 + c]! - predicted[c]!;
  });
  const w = new Writer(); writePalette(w, words); writeRows(w, ids, width, height); w.uint(exceptions.length); let previous = -1;
  for (const i of exceptions) { w.uint(i - previous - 1); previous = i; }
  pairIds.forEach(v => w.byte(v)); alphas.forEach(v => w.byte(v)); deltas.forEach(v => w.signed(v)); return w.finish();
}
export function encodeImage(input: { mimeType: string; data: Uint8Array }, options: ImageEncodeOptions = {}): ImageEncodeResult {
  if (!(input.data instanceof Uint8Array) || typeof input.mimeType !== 'string' || input.mimeType.length > 128) fail('invalid image input');
  integer(input.data.length, 0, IMAGE_MAX_BYTES, 'source byte length');
  const decoderCost = integer(options.decoderCostBytes ?? IMAGE_SHARED_DECODER_COST_BYTES, 0, IMAGE_MAX_BYTES, 'decoder cost');
  const candidates: ImageCandidateCost[] = []; let winner: ImageRecipe | undefined, minimum = Infinity;
  const consider = (codec: Codec, data: Uint8Array, decodedLength: number, info?: PngInfo, rgbaCRC32?: number, paletteSize?: number): void => {
    const recipe: ImageRecipe = { version: 3, codec, mimeType: input.mimeType, sourceBytes: input.data.length, decodedLength, ...(info ? { width: info.width, height: info.height, colourMetadata: info.metadata, rgbaCRC32: rgbaCRC32! } : {}), data };
    const overhead = codec === 'original' || codec === 'original-zlib' ? 0 : decoderCost, metadataBytes = metaBytes(recipe), totalBytes = data.length + metadataBytes + overhead;
    candidates.push({ codec, ...(paletteSize === undefined ? {} : { paletteSize }), payloadBytes: data.length, metadataBytes, decoderBytes: overhead, totalBytes });
    if (totalBytes < minimum) { minimum = totalBytes; winner = recipe; }
  };
  consider('original', new Uint8Array(input.data), input.data.length);
  consider('original-zlib', zlibSync(input.data, { level: 9 }), input.data.length);
  let info: PngInfo | undefined, rgba: Uint8Array | undefined, unique: number | undefined, reason: string | null = null;
  if (input.mimeType !== 'image/png') reason = 'Unsupported image MIME type: original bytes retained';
  else {
    try { info = inspectPng(input.data); rgba = decodePng(input.data).data; }
    catch (e) { reason = (e as Error).message; }
  }
  let checksum: number | undefined;
  if (info && rgba) {
    checksum = crc32(rgba); consider('rgba-zlib', zlibSync(rgba, { level: 9 }), rgba.length, info, checksum);
    const dict = dictionary(rgba);
    if (dict) {
      unique = dict.words.length;
      const rows = paletteRows(rgba, info.width, info.height, dict.words); consider('palette-rows-zlib', zlibSync(rows, { level: 9 }), rows.length, info, checksum, dict.words.length);
      // Bound expensive blend fitting to images whose leading colors explain most
      // texels; this is an input-statistics gate, never an asset/dimension identity.
      for (const n of [2, 4, 8]) if (dict.words.length > n) {
        const words = dict.words.slice(0, n), coverage = words.reduce((s, v) => s + dict.counts.get(v)!, 0) / (rgba.length / 4);
        if (coverage < 0.95) continue;
        const encoded = paletteBlend(rgba, info.width, info.height, words); consider('palette-blend-zlib', zlibSync(encoded, { level: 9 }), encoded.length, info, checksum, n);
      }
    }
  }
  const recipe = winner!, decoded = decodeImageRecipe(recipe);
  if (decoded.kind === 'original' ? !same(decoded.data, input.data) : !rgba || !same(decoded.rgba, rgba)) fail('encoder roundtrip differs');
  return { recipe, metrics: { sourceBytes: input.data.length, eligiblePNG: !!rgba, fallbackReason: reason ?? (decoded.kind === 'original' ? 'Original image has the lowest measured payload + metadata + decoder cost' : null), selected: recipe.codec, fileBytesExact: decoded.kind === 'original', decodedRGBAExact: rgba ? true : null, ...(info && rgba ? { dimensions: [info.width, info.height] as const, rgbaCRC32: checksum! } : {}), ...(unique === undefined ? {} : { uniqueColours: unique }), candidates, selectionBasis: 'Deterministic zlib level 9 payload bytes + UTF-8 recipe metadata bytes + supplied/measured shared decoder bytes; stable candidate order breaks ties. Original byte codecs charge no image-specific decoder.', sourceCRC32: crc32(input.data) } };
}
function validateMetadata(value: ImageColourMetadata | undefined): ImageColourMetadata {
  if (!value || value.interpretation !== 'source-image-and-material-unchanged' || ![1, 2, 4, 8].includes(value.sourceBitDepth) || ![2, 3, 6].includes(value.sourceColourType) || !Array.isArray(value.ancillaryChunks) || value.ancillaryChunks.length > 1) fail('invalid color metadata');
  if (Object.keys(value).some(k => !['interpretation', 'sourceBitDepth', 'sourceColourType', 'ancillaryChunks'].includes(k))) fail('unsupported color metadata');
  if (value.sourceColourType !== 3 && value.sourceBitDepth !== 8) fail('invalid source sample metadata');
  for (const c of value.ancillaryChunks) { if (c.type !== 'pHYs' || Object.keys(c).some(k => k !== 'type' && k !== 'data') || !Array.isArray(c.data) || c.data.length !== 9 || c.data.some(v => !Number.isInteger(v) || v < 0 || v > 255) || c.data[8]! > 1) fail('invalid ancillary metadata'); }
  return { ...value, ancillaryChunks: value.ancillaryChunks.map(c => ({ type: c.type, data: [...c.data] })) };
}
export function decodeImageRecipe(recipe: ImageRecipe): DecodedImageRecipe {
  if (!recipe || recipe.version !== 3 || !(recipe.data instanceof Uint8Array) || typeof recipe.mimeType !== 'string' || recipe.mimeType.length > 128 || recipe.data.length > MAX_PLAIN) fail('invalid image recipe');
  integer(recipe.sourceBytes, 0, IMAGE_MAX_BYTES, 'original image length');
  if (recipe.codec === 'original' || recipe.codec === 'original-zlib') {
    if (recipe.decodedLength !== recipe.sourceBytes) fail('invalid original length');
    const data = recipe.codec === 'original' ? new Uint8Array(recipe.data) : inflate(recipe.data, recipe.sourceBytes);
    if (data.length !== recipe.sourceBytes) fail('original length mismatch'); return { kind: 'original', mimeType: recipe.mimeType, data, fileBytesExact: true };
  }
  if (!['rgba-zlib', 'palette-rows-zlib', 'palette-blend-zlib'].includes(recipe.codec) || recipe.mimeType !== 'image/png') fail('unsupported image recipe');
  const width = integer(recipe.width, 1, IMAGE_MAX_PIXELS, 'width'), height = integer(recipe.height, 1, IMAGE_MAX_PIXELS, 'height'), count = width * height;
  if (count > IMAGE_MAX_PIXELS) fail('pixel budget exceeded');
  const metadata = validateMetadata(recipe.colourMetadata), checksum = integer(recipe.rgbaCRC32, 0, 0xffffffff, 'RGBA checksum');
  const length = integer(recipe.decodedLength, 1, Math.min(MAX_PLAIN, count * 24 + MAX_COLORS * 4 + 32), 'recipe decoded length');
  const payload = inflate(recipe.data, length); let rgba: Uint8Array;
  if (recipe.codec === 'rgba-zlib') { if (payload.length !== count * 4) fail('RGBA length mismatch'); rgba = payload; }
  else {
    const r = new Reader(payload), palette = readPalette(r, recipe.codec === 'palette-blend-zlib' ? 8 : MAX_COLORS);
    rgba = readRows(r, width, height, palette);
    if (recipe.codec === 'palette-blend-zlib') {
      const nc = palette.length / 4; if (nc < 2) fail('blend needs two colors');
      const pairs: Array<readonly [number, number]> = []; for (let a = 0; a < nc; a++) for (let b = a + 1; b < nc; b++) pairs.push([a, b]);
      const n = r.uint(count), positions = new Uint32Array(n); let previous = -1;
      for (let i = 0; i < n; i++) { previous += r.uint(count) + 1; if (previous >= count) fail('exception position out of range'); positions[i] = previous; }
      const ids = new Uint8Array(n), alpha = new Uint8Array(n); for (let i = 0; i < n; i++) { ids[i] = r.byte(); if (ids[i]! >= pairs.length) fail('blend pair out of range'); } for (let i = 0; i < n; i++) alpha[i] = r.byte();
      for (let i = 0; i < n; i++) { const [a, b] = pairs[ids[i]!]!, t = alpha[i]!; for (let c = 0; c < 4; c++) { const predicted = Math.floor((palette[a * 4 + c]! * (255 - t) + palette[b * 4 + c]! * t) / 255 + 0.5), v = predicted + r.signed(); if (v < 0 || v > 255) fail('color residual out of range'); rgba[positions[i]! * 4 + c] = v; } }
    }
    r.end();
  }
  if (crc32(rgba) !== checksum) fail('RGBA checksum mismatch');
  return { kind: 'rgba', mimeType: 'image/png', width, height, rgba, colourMetadata: metadata, fileBytesExact: false };
}
/** Standards-compliant PNG output for a reconstructed image. No profile inference or
 * pixel conversion. The original encoder's exact PNG file bytes are not reconstructed. */
export function imageRecipeToBytes(recipe: ImageRecipe): { mimeType: string; data: Uint8Array } {
  const image = decodeImageRecipe(recipe); if (image.kind === 'original') return { mimeType: image.mimeType, data: image.data };
  const png = encodePng({ width: image.width, height: image.height, data: image.rgba }), extras: Uint8Array[] = [];
  for (const record of image.colourMetadata.ancillaryChunks) {
    const chunk = new Uint8Array(12 + record.data.length), dv = new DataView(chunk.buffer); dv.setUint32(0, record.data.length); chunk.set(new TextEncoder().encode(record.type), 4); chunk.set(record.data, 8); dv.setUint32(chunk.length - 4, crc32(chunk, 4, chunk.length - 4)); extras.push(chunk);
  }
  const extraBytes = extras.reduce((n, b) => n + b.length, 0); if (!extraBytes) return { mimeType: 'image/png', data: png };
  const out = new Uint8Array(png.length + extraBytes); out.set(png.subarray(0, 33)); let at = 33; for (const b of extras) { out.set(b, at); at += b.length; } out.set(png.subarray(33), at); return { mimeType: 'image/png', data: out };
}
