/** Source-derived lossy color textures. The recipe contains only a small palette,
 * packed color fields and resized alpha, never the original texture as a fallback.
 * Version 1 fixes center-nearest resize, median-cut sampling, ties, field packing
 * and screen coordinates (integer texture pixels, top left, no screen tiling).
 */
import { SCREENS } from '@keel-engine/core';
import type { ScreenId } from '@keel-engine/core';
import { encodeBuffer, decodeBuffer } from './asset-buffer-codec.ts';
import { packAsset } from './asset-binary-v3.ts';
import { crc32 } from './png.ts';

export const STYLIZED_TEXTURE_VERSION = 1;
export const STYLIZED_TEXTURE_MAX_SOURCE_PIXELS = 16_777_216;
export const STYLIZED_TEXTURE_MAX_PIXELS = 512 * 512;
const MAX_SOURCE_DIMENSION = 16_384;
const SAMPLE_SIDE = 64;
export interface StylizedTextureOptions {
  maxDimension: number;
  paletteSize: 8 | 16 | 32 | 64;
  kind: 'pixel' | 'dither';
  screen: ScreenId;
}
export interface StylizedTextureInput { width: number; height: number; data: Uint8Array }
export type StylizedTextureEncoding = 'palette-indices' | 'screen-pairs';
export interface StylizedTextureRecipe {
  version: 1;
  kind: 'pixel' | 'dither';
  encoding: StylizedTextureEncoding;
  width: number;
  height: number;
  screen: ScreenId;
  /** Flat RGB8 triples. Alpha is never quantized into this palette. */
  palette: number[];
  /** A constant byte, or an exact byte plane following the packed color fields. */
  alpha: number | 'plane';
  codec: string;
  parameters: Record<string, number>;
  sourceLength: number;
  data: Uint8Array;
  rgbaCRC32: number;
}
export interface StylizedTextureError {
  rgbMAE: number;
  rgbRMSE: number;
  rgbMaxError: number;
  alphaMAE: number;
  alphaMaxError: number;
  alphaChangedPixels: number;
}
export interface StylizedTextureCandidate {
  encoding: StylizedTextureEncoding;
  payloadBytes: number;
  serializedBytes: number;
}
export interface StylizedTextureReport {
  selected: StylizedTextureEncoding;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  paletteSize: number;
  sourceRGBABytes: number;
  resizedRGBABytes: number;
  payloadBytes: number;
  serializedBytes: number;
  metadataBytes: number;
  resized: boolean;
  alphaExactAtResizedResolution: true;
  alphaLossFromResize: boolean;
  alphaPolicy: string;
  resize: 'center-nearest';
  quantizationError: StylizedTextureError;
  /** Measured against every source texel, using nearest expansion of the output. */
  sourceError: StylizedTextureError;
  candidates: StylizedTextureCandidate[];
  selectionBasis: string;
}
export interface ReplayedStylizedTexture { rgba: Uint8Array; width: number; height: number }
export interface EncodedStylizedTexture extends ReplayedStylizedTexture {
  recipe: StylizedTextureRecipe;
  report: StylizedTextureReport;
}
function fail(message: string): never { throw new Error('Stylized texture: ' + message); }
function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail('invalid ' + label);
  return value;
}
function screen(value: unknown): asserts value is ScreenId {
  if (typeof value !== 'string' || !Object.hasOwn(SCREENS, value)) fail('unknown KEEL screen');
}
function center(index: number, from: number, to: number): number { return Math.min(from - 1, Math.floor((index + 0.5) * from / to)); }
function resize(input: StylizedTextureInput, maxDimension: number): ReplayedStylizedTexture {
  const scale = Math.min(1, maxDimension / Math.max(input.width, input.height));
  const width = Math.max(1, Math.floor(input.width * scale)), height = Math.max(1, Math.floor(input.height * scale));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = (center(y, input.height, height) * input.width + center(x, input.width, width)) * 4;
    rgba.set(input.data.subarray(source, source + 4), (y * width + x) * 4);
  }
  return { width, height, rgba };
}
interface Color { rgb: [number, number, number]; count: number; key: number }
interface Box { colors: Color[]; axis: number; score: number }
function box(colors: Color[]): Box {
  const lo = [255, 255, 255], hi = [0, 0, 0]; let count = 0;
  for (const c of colors) { count += c.count; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, c.rgb[k]!); hi[k] = Math.max(hi[k]!, c.rgb[k]!); } }
  let axis = 0; for (let k = 1; k < 3; k++) if (hi[k]! - lo[k]! > hi[axis]! - lo[axis]!) axis = k;
  return { colors, axis, score: (hi[axis]! - lo[axis]!) * count };
}
/** At most 4096 spatially distributed samples; weighted median cut, stable ties.
 * Fixed integer jitter within strata avoids sampling only one checkerboard phase.
 * This is a deterministic sampling rule, not a random state or asset-specific seed. */
function inferPalette(image: ReplayedStylizedTexture, requested: number): number[] {
  const colors = new Map<number, Color>(), sw = Math.min(SAMPLE_SIDE, image.width), sh = Math.min(SAMPLE_SIDE, image.height);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let hash = (Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca6b)) >>> 0;
    hash = Math.imul(hash ^ hash >>> 16, 0x7feb352d) >>> 0;
    hash = (hash ^ hash >>> 15) >>> 0;
    const x0 = Math.floor(x * image.width / sw), y0 = Math.floor(y * image.height / sh);
    const sx = x0 + hash % (Math.floor((x + 1) * image.width / sw) - x0);
    const sy = y0 + (hash >>> 16) % (Math.floor((y + 1) * image.height / sh) - y0);
    const at = (sy * image.width + sx) * 4;
    const r = image.rgba[at]!, g = image.rgba[at + 1]!, b = image.rgba[at + 2]!, key = r * 65536 + g * 256 + b;
    const prior = colors.get(key);
    if (prior) prior.count++;
    else colors.set(key, { rgb: [r, g, b], count: 1, key });
  }
  const boxes = [box([...colors.values()].sort((a, b) => a.key - b.key))];
  while (boxes.length < requested) {
    let selected = -1;
    for (let i = 0; i < boxes.length; i++) if (boxes[i]!.colors.length > 1 && (selected < 0 || boxes[i]!.score > boxes[selected]!.score)) selected = i;
    if (selected < 0) break;
    const current = boxes[selected]!, sorted = current.colors.sort((a, b) => a.rgb[current.axis]! - b.rgb[current.axis]! || a.key - b.key);
    const half = sorted.reduce((n, c) => n + c.count, 0) / 2; let accumulated = 0, split = 0;
    while (split < sorted.length - 1 && accumulated < half) accumulated += sorted[split++]!.count;
    boxes.splice(selected, 1, box(sorted.slice(0, split)), box(sorted.slice(split)));
  }
  const palette = boxes.map(b => {
    const sum = [0, 0, 0]; let count = 0;
    for (const c of b.colors) { count += c.count; for (let k = 0; k < 3; k++) sum[k] = sum[k]! + c.rgb[k]! * c.count; }
    return sum.map(n => Math.round(n / count));
  }).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!);
  return palette.filter((c, i) => !i || c.some((v, k) => v !== palette[i - 1]![k])).flat();
}
function bitsFor(palette: number[]): number { return Math.max(1, Math.ceil(Math.log2(palette.length / 3))); }
function packedLength(count: number, bits: number): number { return Math.ceil(count * bits / 8); }
function pack(values: Uint8Array, bits: number): Uint8Array {
  const out = new Uint8Array(packedLength(values.length, bits));
  for (let i = 0; i < values.length; i++) {
    const bit = i * bits, at = bit >>> 3, shift = bit & 7;
    out[at] = out[at]! | values[i]! << shift;
    if (shift + bits > 8) out[at + 1] = out[at + 1]! | values[i]! >>> (8 - shift);
  }
  return out;
}
function unpack(data: Uint8Array, count: number, bits: number): Uint8Array {
  const used = count * bits % 8;
  if (used && data[data.length - 1]! >>> used) fail('nonzero packed padding');
  const out = new Uint8Array(count), mask = (1 << bits) - 1;
  for (let i = 0; i < count; i++) { const bit = i * bits, at = bit >>> 3, shift = bit & 7; out[i] = ((data[at]! | (data[at + 1] ?? 0) << 8) >>> shift) & mask; }
  return out;
}
function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; } return out;
}
/** Use one nearest palette endpoint and fit the best other endpoint/mix (16 levels).
 * Work is O(pixels * paletteSize), not an exhaustive pair search per pixel. */
function colorFields(image: ReplayedStylizedTexture, palette: number[], options: StylizedTextureOptions) {
  const count = image.width * image.height, indices = new Uint8Array(count), first = new Uint8Array(count), second = new Uint8Array(count), mix = new Uint8Array(count);
  const size = palette.length / 3, threshold = SCREENS[options.screen].at;
  for (let i = 0; i < count; i++) {
    const r = image.rgba[i * 4]!, g = image.rgba[i * 4 + 1]!, b = image.rgba[i * 4 + 2]!;
    let nearest = 0, best = Infinity;
    for (let j = 0; j < size; j++) {
      const dr = r - palette[j * 3]!, dg = g - palette[j * 3 + 1]!, db = b - palette[j * 3 + 2]!, error = dr * dr + dg * dg + db * db;
      if (error < best) { best = error; nearest = j; }
    }
    let a = nearest, other = nearest, fraction = 0;
    if (options.kind === 'dither' && best > 0) {
      const ar = palette[a * 3]!, ag = palette[a * 3 + 1]!, ab = palette[a * 3 + 2]!;
      for (let j = 0; j < size; j++) {
        if (j === a) continue;
        const dr = palette[j * 3]! - ar, dg = palette[j * 3 + 1]! - ag, db = palette[j * 3 + 2]! - ab, length = dr * dr + dg * dg + db * db;
        const t = Math.max(0, Math.min(15, Math.round(((r - ar) * dr + (g - ag) * dg + (b - ab) * db) * 16 / length)));
        const er = r - ar - dr * t / 16, eg = g - ag - dg * t / 16, eb = b - ab - db * t / 16, error = er * er + eg * eg + eb * eb;
        if (error < best) { best = error; other = j; fraction = t; }
      }
      if (fraction && a > other) { const swap = a; a = other; other = swap; fraction = 16 - fraction; }
    }
    first[i] = a; second[i] = other; mix[i] = fraction;
    indices[i] = fraction && threshold(i % image.width, Math.floor(i / image.width)) < fraction / 16 ? other : a;
  }
  return { indices, first, second, mix };
}
function errorAgainst(input: StylizedTextureInput, output: ReplayedStylizedTexture): StylizedTextureError {
  let absolute = 0, squared = 0, maximum = 0, alpha = 0, alphaMax = 0, alphaChanged = 0;
  for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
    const from = (y * input.width + x) * 4, to = (center(y, output.height, input.height) * output.width + center(x, output.width, input.width)) * 4;
    for (let k = 0; k < 3; k++) { const difference = Math.abs(input.data[from + k]! - output.rgba[to + k]!); absolute += difference; squared += difference * difference; maximum = Math.max(maximum, difference); }
    const difference = Math.abs(input.data[from + 3]! - output.rgba[to + 3]!); alpha += difference; alphaMax = Math.max(alphaMax, difference); if (difference) alphaChanged++;
  }
  const count = input.width * input.height;
  return { rgbMAE: absolute / (count * 3), rgbRMSE: Math.sqrt(squared / (count * 3)), rgbMaxError: maximum, alphaMAE: alpha / count, alphaMaxError: alphaMax, alphaChangedPixels: alphaChanged };
}

export function encodeStylizedTexture(input: StylizedTextureInput, options: StylizedTextureOptions): EncodedStylizedTexture {
  if (!input || !(input.data instanceof Uint8Array)) fail('RGBA bytes required');
  integer(input.width, 1, MAX_SOURCE_DIMENSION, 'source width'); integer(input.height, 1, MAX_SOURCE_DIMENSION, 'source height');
  const count = integer(input.width * input.height, 1, STYLIZED_TEXTURE_MAX_SOURCE_PIXELS, 'source pixels');
  if (input.data.length !== count * 4) fail('RGBA length mismatch');
  if (!options || (!Number.isSafeInteger(options.maxDimension) || options.maxDimension < 1 || options.maxDimension > 512) || ![8, 16, 32, 64].includes(options.paletteSize) || !['pixel', 'dither'].includes(options.kind)) fail('invalid options');
  screen(options.screen);
  const image = resize(input, options.maxDimension), palette = inferPalette(image, options.paletteSize), bits = bitsFor(palette), n = image.width * image.height;
  const fields = colorFields(image, palette, options), alphaPlane = new Uint8Array(n); let constantAlpha = true;
  const rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const index = fields.indices[i]! * 3;
    for (let k = 0; k < 3; k++) rgba[i * 4 + k] = palette[index + k]!;
    rgba[i * 4 + 3] = alphaPlane[i] = image.rgba[i * 4 + 3]!;
    if (alphaPlane[i] !== alphaPlane[0]) constantAlpha = false;
  }
  const alpha: number | 'plane' = constantAlpha ? alphaPlane[0]! : 'plane', tail = constantAlpha ? [] : [alphaPlane], checksum = crc32(rgba);
  const candidates: StylizedTextureCandidate[] = []; let recipe: StylizedTextureRecipe | undefined, best = Infinity;
  const consider = (encoding: StylizedTextureEncoding, parts: Uint8Array[]) => {
    const encoded = encodeBuffer(join([...parts, ...tail]));
    const candidate: StylizedTextureRecipe = { version: 1, kind: options.kind, encoding, width: image.width, height: image.height, screen: options.screen, palette: [...palette], alpha, codec: encoded.codec, parameters: encoded.parameters, sourceLength: encoded.sourceLength, data: encoded.data, rgbaCRC32: checksum };
    const serializedBytes = packAsset(candidate).length;
    candidates.push({ encoding, payloadBytes: candidate.data.length, serializedBytes });
    if (serializedBytes < best) { best = serializedBytes; recipe = candidate; }
  };
  consider('palette-indices', [pack(fields.indices, bits)]);
  if (options.kind === 'dither') consider('screen-pairs', [pack(fields.first, bits), pack(fields.second, bits), pack(fields.mix, 4)]);
  const selected = recipe!, replay = replayStylizedTexture(selected);
  if (replay.rgba.some((v, i) => v !== rgba[i])) fail('internal replay differs');
  const quantizationError = errorAgainst({ width: image.width, height: image.height, data: image.rgba }, replay), sourceError = errorAgainst(input, replay);
  return { recipe: selected, ...replay, report: {
    selected: selected.encoding, sourceWidth: input.width, sourceHeight: input.height, width: replay.width, height: replay.height, paletteSize: palette.length / 3,
    sourceRGBABytes: input.data.length, resizedRGBABytes: rgba.length, payloadBytes: selected.data.length, serializedBytes: best, metadataBytes: best - selected.data.length,
    resized: input.width !== image.width || input.height !== image.height, alphaExactAtResizedResolution: true, alphaLossFromResize: sourceError.alphaChangedPixels > 0, resize: 'center-nearest',
    alphaPolicy: 'Separate exact alpha samples at the resized resolution. Center-nearest resize can discard thin transparent/opaque features; sourceError measures the resulting alpha differences.',
    quantizationError, sourceError, candidates,
    selectionBasis: 'Smallest actual packAsset(recipe) byte length; palette-indices wins ties. Both candidates replay identical pixels. Shared decoder and outer asset costs are additional; compressed source images can be smaller.',
  } };
}

/** Reject malformed dimensions/fields before bounded inflation. Returned pixels are
 * owned. Source alpha is exact at this resized resolution; resize itself is lossy. */
export function replayStylizedTexture(recipe: StylizedTextureRecipe): ReplayedStylizedTexture {
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe) || ![Object.prototype, null].includes(Object.getPrototypeOf(recipe))) fail('invalid recipe');
  const allowed = ['version', 'kind', 'encoding', 'width', 'height', 'screen', 'palette', 'alpha', 'codec', 'parameters', 'sourceLength', 'data', 'rgbaCRC32'];
  if (Object.keys(recipe).some(k => !allowed.includes(k))) fail('unknown recipe field');
  if (recipe.version !== 1 || !['pixel', 'dither'].includes(recipe.kind) || !['palette-indices', 'screen-pairs'].includes(recipe.encoding) || (recipe.encoding === 'screen-pairs' && recipe.kind !== 'dither')) fail('unsupported recipe');
  const width = integer(recipe.width, 1, 512, 'width'), height = integer(recipe.height, 1, 512, 'height'), count = integer(width * height, 1, STYLIZED_TEXTURE_MAX_PIXELS, 'pixels');
  screen(recipe.screen);
  if (!Array.isArray(recipe.palette) || !recipe.palette.length || recipe.palette.length > 64 * 3 || recipe.palette.length % 3) fail('invalid palette');
  for (let i = 0; i < recipe.palette.length; i++) integer(recipe.palette[i], 0, 255, 'palette byte');
  if (recipe.alpha !== 'plane') integer(recipe.alpha, 0, 255, 'alpha');
  integer(recipe.rgbaCRC32, 0, 0xffffffff, 'RGBA checksum');
  if (!['raw', 'zlib'].includes(recipe.codec)) fail('unsupported field codec');
  const bits = bitsFor(recipe.palette), indicesLength = packedLength(count, bits), mixLength = packedLength(count, 4);
  const colorLength = recipe.encoding === 'palette-indices' ? indicesLength : indicesLength * 2 + mixLength, expected = colorLength + (recipe.alpha === 'plane' ? count : 0);
  if (recipe.sourceLength !== expected) fail('field length mismatch');
  const plain = decodeBuffer(recipe, expected), first = unpack(plain.subarray(0, indicesLength), count, bits);
  const second = recipe.encoding === 'screen-pairs' ? unpack(plain.subarray(indicesLength, indicesLength * 2), count, bits) : first;
  const mix = recipe.encoding === 'screen-pairs' ? unpack(plain.subarray(indicesLength * 2, colorLength), count, 4) : null;
  const rgba = new Uint8Array(count * 4), size = recipe.palette.length / 3, threshold = SCREENS[recipe.screen].at;
  for (let i = 0; i < count; i++) {
    const a = first[i]!, b = second[i]!, fraction = mix?.[i] ?? 0;
    if (a >= size || b >= size) fail('palette index out of range');
    if (mix && ((fraction === 0 && a !== b) || (fraction !== 0 && a >= b))) fail('noncanonical palette pair');
    const index = (fraction && threshold(i % width, Math.floor(i / width)) < fraction / 16 ? b : a) * 3;
    for (let k = 0; k < 3; k++) rgba[i * 4 + k] = recipe.palette[index + k]!;
    rgba[i * 4 + 3] = recipe.alpha === 'plane' ? plain[colorLength + i]! : recipe.alpha;
  }
  if (crc32(rgba) !== recipe.rgbaCRC32) fail('RGBA checksum mismatch');
  return { rgba, width, height };
}
