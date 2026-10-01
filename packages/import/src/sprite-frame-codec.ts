/** Compact, source-derived raster animation. Input frames are already at the
 * intended sprite resolution. Version 1 fixes global palette sampling, RGB ties,
 * screen coordinates, little-endian fields and candidate order. Replay uses no
 * source model, texture, random state, DOM or platform image decoder.
 */
import { SCREENS } from '@keel-engine/core';
import type { ScreenId } from '@keel-engine/core';
import { encodeBuffer, decodeBuffer } from './asset-buffer-codec.ts';
import { packAsset } from './asset-binary-v3.ts';
import { crc32 } from './png.ts';

export const SPRITE_FRAME_VERSION = 1;
export const SPRITE_FRAME_MAX_DIMENSION = 512;
export const SPRITE_FRAME_MAX_FRAMES = 256;
export const SPRITE_FRAME_MAX_PIXELS = 16_777_216;
const MAX_SAMPLES = 8192, TILE = 8, MAX_TILES = 4096;
export interface SpriteFrameInput {
  width: number;
  height: number;
  frames: Uint8Array[];
  paletteSize: 8 | 16 | 32 | 64;
  kind: 'pixel' | 'dither';
  screen: ScreenId;
}
export type SpriteFrameEncoding = 'rgba' | 'indexed' | 'delta' | 'tiles';
export interface SpriteFrameRecipe {
  version: 1;
  kind: 'pixel' | 'dither';
  encoding: SpriteFrameEncoding;
  width: number;
  height: number;
  frameCount: number;
  screen: ScreenId;
  /** Global RGB8 palette. Alpha is exact and stored independently of RGB. */
  palette: number[];
  alpha: number | 'plane';
  frameCRC32: number[];
  codec: string;
  parameters: Record<string, number>;
  sourceLength: number;
  data: Uint8Array;
  /** Present only for the fixed 8x8 tile dictionary candidate. */
  dictionaryTiles?: number;
}
export interface SpriteFrameError {
  rgbMAE: number;
  rgbRMSE: number;
  rgbMaxError: number;
  alphaMAE: 0;
  alphaMaxError: 0;
  alphaChangedPixels: 0;
}
export interface SpriteFrameCandidate {
  encoding: SpriteFrameEncoding;
  payloadBytes: number;
  serializedBytes: number;
  repeatFrames?: number;
  fillRegions?: number;
  changedRegionPixels?: number;
  dictionaryTiles?: number;
}
export interface SpriteFrameReport {
  selected: SpriteFrameEncoding;
  width: number;
  height: number;
  frameCount: number;
  paletteSize: number;
  sourceRGBABytes: number;
  quantizedRGBABytes: number;
  payloadBytes: number;
  serializedBytes: number;
  metadataBytes: number;
  alphaExact: true;
  quantizationError: SpriteFrameError;
  candidates: SpriteFrameCandidate[];
  skippedCandidates: Array<{ encoding: SpriteFrameEncoding; reason: string }>;
  selectionBasis: string;
}
export interface EncodedSpriteFrames {
  recipe: SpriteFrameRecipe;
  frames: Uint8Array[];
  report: SpriteFrameReport;
}
function fail(message: string): never { throw new Error('Sprite frames: ' + message); }
function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail('invalid ' + label);
  return value;
}
function validateShape(width: number, height: number, count: number): number {
  integer(width, 1, SPRITE_FRAME_MAX_DIMENSION, 'width'); integer(height, 1, SPRITE_FRAME_MAX_DIMENSION, 'height');
  integer(count, 1, SPRITE_FRAME_MAX_FRAMES, 'frame count');
  integer(width * height * count, 1, SPRITE_FRAME_MAX_PIXELS, 'total pixels');
  return width * height;
}
function validateScreen(screen: unknown): asserts screen is ScreenId {
  if (typeof screen !== 'string' || !Object.hasOwn(SCREENS, screen)) fail('unknown KEEL screen');
}
function join(parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
function bitsFor(size: number): number { return Math.max(1, Math.ceil(Math.log2(size))); }
function packedLength(count: number, bits: number): number { return Math.ceil(count * bits / 8); }
function pack(indices: Uint8Array, bits: number): Uint8Array {
  const bytes = new Uint8Array(packedLength(indices.length, bits));
  for (let i = 0; i < indices.length; i++) {
    const bit = i * bits, at = bit >>> 3, shift = bit & 7;
    bytes[at] = bytes[at]! | indices[i]! << shift;
    if (shift + bits > 8) bytes[at + 1] = bytes[at + 1]! | indices[i]! >>> (8 - shift);
  }
  return bytes;
}
function indexAt(bytes: Uint8Array, i: number, bits: number): number {
  const bit = i * bits, at = bit >>> 3, shift = bit & 7;
  return ((bytes[at]! | (bytes[at + 1] ?? 0) << 8) >>> shift) & ((1 << bits) - 1);
}
function validateIndices(bytes: Uint8Array, count: number, bits: number, size: number): void {
  if (bytes.length !== packedLength(count, bits)) fail('index field length');
  const used = count * bits % 8;
  if (used && bytes[bytes.length - 1]! >>> used) fail('nonzero index padding');
  for (let i = 0; i < count; i++) if (indexAt(bytes, i, bits) >= size) fail('palette index out of range');
}
interface Color { rgb: number[]; key: number; count: number }
interface Box { colors: Color[]; axis: number; score: number }
function box(colors: Color[]): Box {
  const lo = [255, 255, 255], hi = [0, 0, 0]; let count = 0;
  for (const color of colors) { count += color.count; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, color.rgb[k]!); hi[k] = Math.max(hi[k]!, color.rgb[k]!); } }
  let axis = 0; for (let k = 1; k < 3; k++) if (hi[k]! - lo[k]! > hi[axis]! - lo[axis]!) axis = k;
  return { colors, axis, score: (hi[axis]! - lo[axis]!) * count };
}
/** Weighted median cut follows styled-texture-codec's stable RGB/axis tie rules.
 * Each frame gets the same bounded number of stratified, integer-jitter samples,
 * including hidden RGB. One palette is then used at every animation time. */
function globalPalette(input: SpriteFrameInput, pixels: number): number[] {
  const colors = new Map<number, Color>(), samples = Math.min(pixels, Math.floor(MAX_SAMPLES / input.frames.length));
  for (let f = 0; f < input.frames.length; f++) for (let s = 0; s < samples; s++) {
    const start = Math.floor(s * pixels / samples), end = Math.floor((s + 1) * pixels / samples);
    let hash = (Math.imul(s + 1, 0x9e3779b1) ^ Math.imul(f + 1, 0x85ebca6b)) >>> 0;
    hash = Math.imul(hash ^ hash >>> 16, 0x7feb352d) >>> 0;
    hash = (hash ^ hash >>> 15) >>> 0;
    const at = (start + hash % (end - start)) * 4, frame = input.frames[f]!;
    const r = frame[at]!, g = frame[at + 1]!, b = frame[at + 2]!, key = r * 65536 + g * 256 + b, previous = colors.get(key);
    if (previous) previous.count++;
    else colors.set(key, { rgb: [r, g, b], key, count: 1 });
  }
  const boxes = [box([...colors.values()].sort((a, b) => a.key - b.key))];
  while (boxes.length < input.paletteSize) {
    let chosen = -1;
    for (let i = 0; i < boxes.length; i++) if (boxes[i]!.colors.length > 1 && (chosen < 0 || boxes[i]!.score > boxes[chosen]!.score)) chosen = i;
    if (chosen < 0) break;
    const current = boxes[chosen]!, sorted = current.colors.sort((a, b) => a.rgb[current.axis]! - b.rgb[current.axis]! || a.key - b.key);
    const half = sorted.reduce((sum, c) => sum + c.count, 0) / 2; let accumulated = 0, split = 0;
    while (split < sorted.length - 1 && accumulated < half) accumulated += sorted[split++]!.count;
    boxes.splice(chosen, 1, box(sorted.slice(0, split)), box(sorted.slice(split)));
  }
  const palette = boxes.map(b => {
    const sum = [0, 0, 0]; let count = 0;
    for (const c of b.colors) { count += c.count; for (let k = 0; k < 3; k++) sum[k] = sum[k]! + c.rgb[k]! * c.count; }
    return sum.map(n => Math.round(n / count));
  }).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!);
  return palette.filter((c, i) => !i || c.some((v, k) => v !== palette[i - 1]![k])).flat();
}
function quantize(input: SpriteFrameInput, palette: number[], pixels: number) {
  const frames: Uint8Array[] = [], indices: Uint8Array[] = [], alphas: Uint8Array[] = [], size = palette.length / 3;
  const threshold = SCREENS[input.screen].at, cache = new Map<number, [number, number, number]>();
  let sum = 0, squared = 0, maximum = 0, constantAlpha = true;
  const firstAlpha = input.frames[0]![3]!;
  for (const source of input.frames) {
    const frame = new Uint8Array(pixels * 4), ids = new Uint8Array(pixels), alpha = new Uint8Array(pixels);
    for (let i = 0; i < pixels; i++) {
      const r = source[i * 4]!, g = source[i * 4 + 1]!, b = source[i * 4 + 2]!, key = r * 65536 + g * 256 + b;
      let pair = cache.get(key);
      if (!pair) {
        let nearest = 0, best = Infinity;
        for (let j = 0; j < size; j++) {
          const dr = r - palette[j * 3]!, dg = g - palette[j * 3 + 1]!, db = b - palette[j * 3 + 2]!, error = dr * dr + dg * dg + db * db;
          if (error < best) { best = error; nearest = j; }
        }
        let a = nearest, other = nearest, fraction = 0;
        if (input.kind === 'dither' && best > 0) {
          const ar = palette[a * 3]!, ag = palette[a * 3 + 1]!, ab = palette[a * 3 + 2]!;
          for (let j = 0; j < size; j++) {
            if (j === a) continue;
            const dr = palette[j * 3]! - ar, dg = palette[j * 3 + 1]! - ag, db = palette[j * 3 + 2]! - ab;
            const t = Math.max(0, Math.min(15, Math.round(((r - ar) * dr + (g - ag) * dg + (b - ab) * db) * 16 / (dr * dr + dg * dg + db * db))));
            const er = r - ar - dr * t / 16, eg = g - ag - dg * t / 16, eb = b - ab - db * t / 16, error = er * er + eg * eg + eb * eb;
            if (error < best) { best = error; other = j; fraction = t; }
          }
          if (fraction && a > other) { const swap = a; a = other; other = swap; fraction = 16 - fraction; }
        }
        pair = [a, other, fraction];
        if (cache.size < 65536) cache.set(key, pair);
      }
      const id = pair[2] && threshold(i % input.width, Math.floor(i / input.width)) < pair[2] / 16 ? pair[1] : pair[0];
      ids[i] = id;
      for (let k = 0; k < 3; k++) {
        const value = palette[id * 3 + k]!; frame[i * 4 + k] = value;
        const error = Math.abs(value - source[i * 4 + k]!); sum += error; squared += error * error; maximum = Math.max(maximum, error);
      }
      frame[i * 4 + 3] = alpha[i] = source[i * 4 + 3]!;
      if (alpha[i] !== firstAlpha) constantAlpha = false;
    }
    frames.push(frame); indices.push(ids); alphas.push(alpha);
  }
  const channels = pixels * input.frames.length * 3;
  const error: SpriteFrameError = { rgbMAE: sum / channels, rgbRMSE: Math.sqrt(squared / channels), rgbMaxError: maximum, alphaMAE: 0, alphaMaxError: 0, alphaChangedPixels: 0 };
  return { frames, indices, alphas, alpha: constantAlpha ? firstAlpha : 'plane' as const, error };
}
/** Opcodes: 0 repeat previous; 1 whole-frame fill; 2 indexed rectangle;
 * 3 filled rectangle. Rectangles carry x/y/w/h as four LE uint16s. Index
 * bitplanes are LSB-first and byte-aligned per rectangle; alpha follows them. */
function deltas(width: number, height: number, indices: Uint8Array[], alphas: Uint8Array[], bits: number, plane: boolean) {
  const parts: Uint8Array[] = []; let repeatFrames = 0, fillRegions = 0, changedRegionPixels = 0;
  for (let f = 0; f < indices.length; f++) {
    const ids = indices[f]!, alpha = alphas[f]!; let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!f || ids[i] !== indices[f - 1]![i] || (plane && alpha[i] !== alphas[f - 1]![i])) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    if (x1 < 0) { parts.push(Uint8Array.of(0)); repeatFrames++; continue; }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, count = w * h;
    const region = new Uint8Array(count), regionAlpha = plane ? new Uint8Array(count) : new Uint8Array(0); let uniform = true;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const src = (y + y0) * width + x + x0, dst = y * w + x;
      region[dst] = ids[src]!; if (plane) regionAlpha[dst] = alpha[src]!;
      if (region[dst] !== region[0] || (plane && regionAlpha[dst] !== regionAlpha[0])) uniform = false;
    }
    changedRegionPixels += count;
    const fullFill = uniform && w === width && h === height;
    const header = new Uint8Array(fullFill ? 1 : 9); header[0] = fullFill ? 1 : uniform ? 3 : 2;
    if (!fullFill) { const view = new DataView(header.buffer); [x0, y0, w, h].forEach((n, i) => view.setUint16(1 + i * 2, n, true)); }
    parts.push(header);
    if (uniform) { parts.push(plane ? Uint8Array.of(region[0]!, regionAlpha[0]!) : Uint8Array.of(region[0]!)); fillRegions++; }
    else { parts.push(pack(region, bits)); if (plane) parts.push(regionAlpha); }
  }
  return { bytes: join(parts), repeatFrames, fillRegions, changedRegionPixels };
}
function tiles(width: number, height: number, indices: Uint8Array[], alphas: Uint8Array[], bits: number, plane: boolean) {
  const dictionary: Uint8Array[] = [], ids: number[] = [], lookup = new Map<string, number>();
  for (let f = 0; f < indices.length; f++) for (let y0 = 0; y0 < height; y0 += TILE) for (let x0 = 0; x0 < width; x0 += TILE) {
    const colors = new Uint8Array(TILE * TILE), alpha = new Uint8Array(TILE * TILE);
    for (let y = 0; y < TILE && y + y0 < height; y++) for (let x = 0; x < TILE && x + x0 < width; x++) {
      const src = (y0 + y) * width + x0 + x, dst = y * TILE + x;
      colors[dst] = indices[f]![src]!; if (plane) alpha[dst] = alphas[f]![src]!;
    }
    const tile = join(plane ? [pack(colors, bits), alpha] : [pack(colors, bits)]);
    const key = String.fromCharCode(...tile); let id = lookup.get(key);
    if (id === undefined) {
      if (dictionary.length === MAX_TILES) return null;
      id = dictionary.length; dictionary.push(tile); lookup.set(key, id);
    }
    ids.push(id);
  }
  const indexBytes = dictionary.length <= 256 ? 1 : 2, references = new Uint8Array(ids.length * indexBytes);
  for (let i = 0; i < ids.length; i++) { references[i * indexBytes] = ids[i]! & 255; if (indexBytes === 2) references[i * 2 + 1] = ids[i]! >>> 8; }
  return { bytes: join([...dictionary, references]), dictionaryTiles: dictionary.length };
}
export function encodeSpriteFrames(input: SpriteFrameInput): EncodedSpriteFrames {
  if (!input || !Array.isArray(input.frames)) fail('RGBA frame array required');
  const pixels = validateShape(input.width, input.height, input.frames.length);
  for (const frame of input.frames) if (!(frame instanceof Uint8Array) || frame.length !== pixels * 4) fail('RGBA frame length mismatch');
  if (![8, 16, 32, 64].includes(input.paletteSize) || !['pixel', 'dither'].includes(input.kind)) fail('invalid options');
  validateScreen(input.screen);
  const palette = globalPalette(input, pixels), bits = bitsFor(palette.length / 3), quantized = quantize(input, palette, pixels), plane = quantized.alpha === 'plane';
  const frameCRC32 = quantized.frames.map(frame => crc32(frame)), candidates: SpriteFrameCandidate[] = [], skippedCandidates: SpriteFrameReport['skippedCandidates'] = [];
  let selected: SpriteFrameRecipe | undefined, cost = Infinity;
  const consider = (encoding: SpriteFrameEncoding, bytes: Uint8Array, details: Partial<SpriteFrameCandidate> = {}) => {
    const encoded = encodeBuffer(bytes);
    const recipe: SpriteFrameRecipe = { version: 1, kind: input.kind, encoding, width: input.width, height: input.height, frameCount: input.frames.length, screen: input.screen, palette: [...palette], alpha: quantized.alpha, frameCRC32: [...frameCRC32], codec: encoded.codec, parameters: encoded.parameters, sourceLength: encoded.sourceLength, data: encoded.data };
    if (encoding === 'tiles') recipe.dictionaryTiles = details.dictionaryTiles!;
    const serializedBytes = packAsset(recipe).length;
    candidates.push({ ...details, encoding, payloadBytes: recipe.data.length, serializedBytes });
    if (serializedBytes < cost) { selected = recipe; cost = serializedBytes; }
  };
  // This fixed order also breaks exact byte-cost ties; only the selected payload survives.
  const fullParts: Uint8Array[] = [];
  for (let f = 0; f < input.frames.length; f++) { fullParts.push(pack(quantized.indices[f]!, bits)); if (plane) fullParts.push(quantized.alphas[f]!); }
  consider('indexed', join(fullParts));
  const delta = deltas(input.width, input.height, quantized.indices, quantized.alphas, bits, plane);
  consider('delta', delta.bytes, { repeatFrames: delta.repeatFrames, fillRegions: delta.fillRegions, changedRegionPixels: delta.changedRegionPixels });
  const tiled = tiles(input.width, input.height, quantized.indices, quantized.alphas, bits, plane);
  if (tiled) consider('tiles', tiled.bytes, { dictionaryTiles: tiled.dictionaryTiles });
  else skippedCandidates.push({ encoding: 'tiles', reason: 'More than 4096 unique 8x8 tiles; bounded dictionary search stopped.' });
  consider('rgba', join(quantized.frames));
  const recipe = selected!, frames = decodeSpriteFrames(recipe);
  for (let f = 0; f < frames.length; f++) if (frames[f]!.some((v, i) => v !== quantized.frames[f]![i])) fail('internal replay differs');
  return { recipe, frames, report: {
    selected: recipe.encoding, width: input.width, height: input.height, frameCount: input.frames.length, paletteSize: palette.length / 3,
    sourceRGBABytes: pixels * input.frames.length * 4, quantizedRGBABytes: pixels * input.frames.length * 4,
    payloadBytes: recipe.data.length, serializedBytes: cost, metadataBytes: cost - recipe.data.length, alphaExact: true, quantizationError: quantized.error, candidates, skippedCandidates,
    selectionBasis: 'Smallest complete packAsset(recipe) byte length; indexed, delta, tiles, then RGBA break ties. At most four candidates, 8192 palette samples and 4096 unique tiles. RGB quantization is lossy; replay and alpha are exact at the supplied resolution. Raw fallback contains quantized pixels only. Shared decoder/runtime and outer packaging are additional costs, counted once separately; small or already-compressed inputs can grow.',
  } };
}

interface Region { op: number; x: number; y: number; w: number; h: number; color: number; alpha: number; colors: Uint8Array; alphas: Uint8Array }
/** Validate all record lengths, coordinates, references, indices and padding before
 * allocating any RGBA frames. decodeBuffer separately bounds DEFLATE inflation. */
export function decodeSpriteFrames(recipe: SpriteFrameRecipe): Uint8Array[] {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe) || ![Object.prototype, null].includes(Object.getPrototypeOf(recipe))) fail('invalid recipe');
  const required = ['version', 'kind', 'encoding', 'width', 'height', 'frameCount', 'screen', 'palette', 'alpha', 'frameCRC32', 'codec', 'parameters', 'sourceLength', 'data'];
  const allowed = recipe.encoding === 'tiles' ? [...required, 'dictionaryTiles'] : required;
  if (Object.keys(recipe).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(recipe, k))) fail('invalid recipe fields');
  if (recipe.version !== 1 || !['pixel', 'dither'].includes(recipe.kind) || !['rgba', 'indexed', 'delta', 'tiles'].includes(recipe.encoding)) fail('unsupported recipe');
  const pixels = validateShape(recipe.width, recipe.height, recipe.frameCount), total = pixels * recipe.frameCount;
  validateScreen(recipe.screen);
  if (!Array.isArray(recipe.palette) || !recipe.palette.length || recipe.palette.length > 64 * 3 || recipe.palette.length % 3) fail('invalid palette');
  for (let i = 0; i < recipe.palette.length; i++) integer(recipe.palette[i], 0, 255, 'palette byte');
  if (!Array.isArray(recipe.frameCRC32) || recipe.frameCRC32.length !== recipe.frameCount) fail('frame checksum count');
  for (let f = 0; f < recipe.frameCount; f++) integer(recipe.frameCRC32[f], 0, 0xffffffff, 'frame checksum');
  const plane = recipe.alpha === 'plane'; if (!plane) integer(recipe.alpha, 0, 255, 'alpha');
  if (!['raw', 'zlib'].includes(recipe.codec)) fail('unsupported buffer codec');
  const bits = bitsFor(recipe.palette.length / 3), colorBytes = packedLength(pixels, bits), stride = colorBytes + (plane ? pixels : 0);
  const tileCount = Math.ceil(recipe.width / TILE) * Math.ceil(recipe.height / TILE) * recipe.frameCount, tileColorBytes = packedLength(TILE * TILE, bits), tileStride = tileColorBytes + (plane ? TILE * TILE : 0);
  let dictionaryTiles = 0, referenceBytes = 0, expected = 0;
  if (recipe.encoding === 'rgba') expected = total * 4;
  else if (recipe.encoding === 'indexed') expected = stride * recipe.frameCount;
  else if (recipe.encoding === 'tiles') {
    dictionaryTiles = integer(recipe.dictionaryTiles, 1, Math.min(MAX_TILES, tileCount), 'tile dictionary size');
    referenceBytes = dictionaryTiles <= 256 ? 1 : 2;
    expected = dictionaryTiles * tileStride + tileCount * referenceBytes;
  } else integer(recipe.sourceLength, recipe.frameCount, recipe.frameCount * (9 + stride), 'delta length');
  if (recipe.encoding !== 'delta' && recipe.sourceLength !== expected) fail('field length mismatch');
  const bytes = decodeBuffer(recipe, recipe.encoding === 'delta' ? recipe.frameCount * (9 + stride) : expected);
  const size = recipe.palette.length / 3, regions: Region[] = [];
  if (recipe.encoding === 'indexed') {
    for (let f = 0; f < recipe.frameCount; f++) validateIndices(bytes.subarray(f * stride, f * stride + colorBytes), pixels, bits, size);
  } else if (recipe.encoding === 'tiles') {
    for (let i = 0; i < dictionaryTiles; i++) validateIndices(bytes.subarray(i * tileStride, i * tileStride + tileColorBytes), TILE * TILE, bits, size);
    for (let i = dictionaryTiles * tileStride; i < bytes.length; i += referenceBytes) if (bytes[i]! + (referenceBytes === 2 ? bytes[i + 1]! * 256 : 0) >= dictionaryTiles) fail('tile reference out of range');
  } else if (recipe.encoding === 'delta') {
    let offset = 0;
    const need = (count: number) => { if (offset + count > bytes.length) fail('truncated delta record'); };
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let f = 0; f < recipe.frameCount; f++) {
      need(1); const op = bytes[offset++]!;
      const region: Region = { op, x: 0, y: 0, w: recipe.width, h: recipe.height, color: 0, alpha: 0, colors: bytes.subarray(0, 0), alphas: bytes.subarray(0, 0) };
      if (op > 3 || (!f && op === 0)) fail('invalid delta opcode');
      if (op === 0) { regions.push(region); continue; }
      if (op >= 2) {
        need(8); region.x = view.getUint16(offset, true); region.y = view.getUint16(offset + 2, true); region.w = view.getUint16(offset + 4, true); region.h = view.getUint16(offset + 6, true); offset += 8;
        if (!region.w || !region.h || region.x + region.w > recipe.width || region.y + region.h > recipe.height) fail('delta rectangle out of bounds');
        if (!f && (region.x || region.y || region.w !== recipe.width || region.h !== recipe.height)) fail('first delta must cover frame');
      }
      if (op === 1 || op === 3) {
        need(plane ? 2 : 1); region.color = bytes[offset++]!;
        if (region.color >= size) fail('palette index out of range');
        if (plane) region.alpha = bytes[offset++]!;
      } else {
        const count = region.w * region.h, colorsLength = packedLength(count, bits);
        need(colorsLength + (plane ? count : 0)); region.colors = bytes.subarray(offset, offset + colorsLength); offset += colorsLength;
        validateIndices(region.colors, count, bits, size);
        if (plane) { region.alphas = bytes.subarray(offset, offset + count); offset += count; }
      }
      regions.push(region);
    }
    if (offset !== bytes.length) fail('trailing delta data');
  } else if (!plane) {
    for (let i = 3; i < bytes.length; i += 4) if (bytes[i] !== recipe.alpha) fail('RGBA alpha disagrees with metadata');
  }
  const frames: Uint8Array[] = [], write = (frame: Uint8Array, pixel: number, id: number, alpha: number) => {
    for (let k = 0; k < 3; k++) frame[pixel * 4 + k] = recipe.palette[id * 3 + k]!;
    frame[pixel * 4 + 3] = alpha;
  };
  let tileReference = dictionaryTiles * tileStride;
  for (let f = 0; f < recipe.frameCount; f++) {
    let frame: Uint8Array;
    if (recipe.encoding === 'rgba') frame = bytes.slice(f * pixels * 4, (f + 1) * pixels * 4);
    else {
      frame = recipe.encoding === 'delta' && f ? new Uint8Array(frames[f - 1]!) : new Uint8Array(pixels * 4);
      if (recipe.encoding === 'indexed') {
        const colors = bytes.subarray(f * stride, f * stride + colorBytes);
        for (let i = 0; i < pixels; i++) write(frame, i, indexAt(colors, i, bits), plane ? bytes[f * stride + colorBytes + i]! : recipe.alpha as number);
      } else if (recipe.encoding === 'tiles') {
        for (let y0 = 0; y0 < recipe.height; y0 += TILE) for (let x0 = 0; x0 < recipe.width; x0 += TILE) {
          const id = bytes[tileReference]! + (referenceBytes === 2 ? bytes[tileReference + 1]! * 256 : 0); tileReference += referenceBytes;
          const colors = bytes.subarray(id * tileStride, id * tileStride + tileColorBytes);
          for (let y = 0; y < TILE && y + y0 < recipe.height; y++) for (let x = 0; x < TILE && x + x0 < recipe.width; x++) {
            const i = y * TILE + x;
            write(frame, (y0 + y) * recipe.width + x0 + x, indexAt(colors, i, bits), plane ? bytes[id * tileStride + tileColorBytes + i]! : recipe.alpha as number);
          }
        }
      } else {
        const region = regions[f]!;
        if (region.op) for (let y = 0; y < region.h; y++) for (let x = 0; x < region.w; x++) {
          const i = y * region.w + x, fill = region.op !== 2;
          write(frame, (region.y + y) * recipe.width + region.x + x, fill ? region.color : indexAt(region.colors, i, bits), plane ? fill ? region.alpha : region.alphas[i]! : recipe.alpha as number);
        }
      }
    }
    if (crc32(frame) !== recipe.frameCRC32[f]) fail('frame checksum mismatch');
    frames.push(frame);
  }
  return frames;
}
