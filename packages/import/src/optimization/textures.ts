/** Compile-time texture reduction. No canvas, renderer, filesystem, or ambient network.
 * Pinned jpeg-js, fast-png and fflate process ordinary JPEG/PNG; replay needs none.
 * Lossless mode bypasses all decoding and copies original bytes exactly. Lossy mode
 * is source/material driven, bounded to two encodes per image, and checks every
 * source texel against the decoded candidate reconstructed at source resolution.
 */
import jpeg from 'jpeg-js';
import { decode as decodePNG } from 'fast-png';
import { zlibSync } from 'fflate';
import type { NormalizedAsset, NormalizedImage } from '../asset-normalize-v3.ts';
import { crc32, isPng } from '../png.ts';
import { decodeBuffer } from '../asset-buffer-codec.ts';

export type TextureUsage = 'srgb' | 'linear' | 'normal' | 'unknown';
export interface TextureOptimizationOptions {
  mode: 'lossless' | 'lossy';
  /** Target longest edge. A source is retained when this target cannot pass error bounds. */
  maxDimension?: number;
  /** JPEG quality, 1..100. Alpha, normal and linear data maps always use PNG. */
  quality?: number;
  /** Errors are measured in 8-bit RGBA units, including RGB under transparent alpha. */
  maxRgbaRmse?: number;
  maxRgbaError?: number;
  maxAlphaRmse?: number;
  maxAlphaError?: number;
  /** Maximum per-texel normal angular error after material normal scale. */
  maxNormalAngleDegrees?: number;
  /** Maximum source-resolution alpha-mask coverage change, 0..1. */
  maxAlphaCoverageError?: number;
  /** 1..2 candidates per image, never an unbounded quality/dimension search. */
  maxCandidates?: number;
  /** Resource bounds, independent of the selected lossy quality. */
  maxSourcePixels?: number;
  maxTotalSourcePixels?: number;
}
export interface TextureError {
  rgbaRmse: number;
  rgbaMax: number;
  channelRmse: [number, number, number, number];
  alphaRmse: number;
  alphaMax: number;
  normalAngleRmseDegrees: number;
  normalAngleMaxDegrees: number;
  alphaCoverageMaxDifference: number;
  comparedPixels: number;
}
export interface TextureCandidateReport {
  mimeType: string;
  dimensions: [number, number];
  bytes: number;
  /** Null when rejected by byte size before decoding/measuring the candidate. */
  error: TextureError | null;
  accepted: boolean;
  reason: string;
}
export interface TextureImageReport {
  imageIndex: number;
  sourceIndex: number;
  usages: TextureUsage[];
  materialSlots: string[];
  sourceMimeType: string;
  outputMimeType: string;
  sourceBytes: number;
  outputBytes: number;
  sourceDimensions: [number, number] | null;
  outputDimensions: [number, number] | null;
  changed: boolean;
  reason: string;
  error: TextureError;
  candidates: TextureCandidateReport[];
}
export interface TextureOptimizationReport {
  mode: 'lossless' | 'lossy';
  settings: Required<TextureOptimizationOptions>;
  sourceBytes: number;
  outputBytes: number;
  savedBytes: number;
  changedImages: number;
  sourcePixels: number;
  outputPixels: number;
  images: TextureImageReport[];
  codecs: { jpeg: 'jpeg-js@0.4.4'; png: 'fast-png@6.2.0'; pngCompression: 'fflate@0.8.2'; pngFilter: 'minimum-signed-residual'; runtimeRequired: false };
  measurement: string;
}
interface Pixels { width: number; height: number; data: Uint8Array }
interface Usage { kinds: Set<TextureUsage>; slots: string[]; cutoffs: number[]; normalScales: number[] }
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
const HARD_MAX_PIXELS = 16 * 1024 * 1024;
const SRGB = Float64Array.from({ length: 256 }, (_, i) => { const x = i / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
const toSrgb = (x: number): number => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(0, x) ** (1 / 2.4) - 0.055);
const byte = (x: number): number => Math.max(0, Math.min(255, Math.round(x)));
const zeroError = (): TextureError => ({ rgbaRmse: 0, rgbaMax: 0, channelRmse: [0, 0, 0, 0], alphaRmse: 0, alphaMax: 0, normalAngleRmseDegrees: 0, normalAngleMaxDegrees: 0, alphaCoverageMaxDifference: 0, comparedPixels: 0 });
function fail(message: string): never { throw new Error('Texture optimizer: ' + message); }
function bounded(value: number, low: number, high: number, name: string, integral = false): number {
  if (!Number.isFinite(value) || value < low || value > high || integral && !Number.isInteger(value)) fail('invalid ' + name);
  return value;
}
function settings(options: TextureOptimizationOptions): Required<TextureOptimizationOptions> {
  if (options.mode !== 'lossless' && options.mode !== 'lossy') fail('invalid mode');
  return {
    mode: options.mode,
    maxDimension: bounded(options.maxDimension ?? 1024, 1, 16384, 'maxDimension', true),
    quality: bounded(options.quality ?? 85, 1, 100, 'quality', true),
    maxRgbaRmse: bounded(options.maxRgbaRmse ?? 18, 0, 255, 'maxRgbaRmse'),
    maxRgbaError: bounded(options.maxRgbaError ?? 255, 0, 255, 'maxRgbaError'),
    maxAlphaRmse: bounded(options.maxAlphaRmse ?? 8, 0, 255, 'maxAlphaRmse'),
    maxAlphaError: bounded(options.maxAlphaError ?? 64, 0, 255, 'maxAlphaError'),
    maxNormalAngleDegrees: bounded(options.maxNormalAngleDegrees ?? 12, 0, 180, 'maxNormalAngleDegrees'),
    maxAlphaCoverageError: bounded(options.maxAlphaCoverageError ?? 0.01, 0, 1, 'maxAlphaCoverageError'),
    maxCandidates: bounded(options.maxCandidates ?? 2, 1, 2, 'maxCandidates', true),
    maxSourcePixels: bounded(options.maxSourcePixels ?? HARD_MAX_PIXELS, 1, HARD_MAX_PIXELS, 'maxSourcePixels', true),
    maxTotalSourcePixels: bounded(options.maxTotalSourcePixels ?? 64 * 1024 * 1024, 1, 256 * 1024 * 1024, 'maxTotalSourcePixels', true),
  };
}
function usages(asset: NormalizedAsset): Usage[] {
  const result: Usage[] = asset.images.map(() => ({ kinds: new Set(), slots: [], cutoffs: [], normalScales: [] }));
  for (const [i, material] of (asset.json.materials ?? []).entries()) {
    const visit = (value: any, path: string): void => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === 'extras') continue;
        const slot = path ? path + '.' + key : key;
        if (key.endsWith('Texture') && child && typeof child === 'object') {
          const info = child as Record<string, any>, source = asset.json.textures?.[info.index]?.source;
          const usage = result[source];
          if (!usage) continue;
          // Unknown extension slots are never guessed from a suggestive name.
          const kind: TextureUsage = slot === 'pbrMetallicRoughness.baseColorTexture' || slot === 'emissiveTexture' ? 'srgb'
            : slot === 'normalTexture' ? 'normal'
            : slot === 'pbrMetallicRoughness.metallicRoughnessTexture' || slot === 'occlusionTexture' ? 'linear' : 'unknown';
          usage.kinds.add(kind); usage.slots.push(`materials[${i}].${slot}`);
          if (kind === 'normal') usage.normalScales.push(Number.isFinite(info.scale) ? info.scale : 1);
          if (slot === 'pbrMetallicRoughness.baseColorTexture' && material.alphaMode === 'MASK') {
            const factor = material.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1;
            usage.cutoffs.push(factor > 0 ? (material.alphaCutoff ?? 0.5) / factor : Infinity);
          }
        } else visit(child, slot);
      }
    };
    visit(material, '');
  }
  return result;
}
interface Header { width: number; height: number; pngInflatedBytes?: number; pngIDAT?: Uint8Array }
function imageHeader(image: NormalizedImage, maxPixels: number): Header {
  const b = image.data;
  if (b.length > MAX_IMAGE_BYTES) fail('source image byte limit exceeded');
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let width = 0, height = 0;
  if (image.mimeType === 'image/png') {
    if (!isPng(b)) fail('invalid PNG signature');
    let at = 8, color = -1, depth = 0, ended = false, seenIDAT = false, closedIDAT = false;
    const chunks: Uint8Array[] = [];
    while (at < b.length) {
      if (at + 12 > b.length) fail('truncated PNG chunk');
      const n = view.getUint32(at), end = at + n + 12;
      if (end > b.length) fail('PNG chunk exceeds file');
      const type = String.fromCharCode(...b.subarray(at + 4, at + 8));
      if (crc32(b, at + 4, end - 4) !== view.getUint32(end - 4)) fail('PNG CRC mismatch');
      if (at === 8 && type !== 'IHDR') fail('missing PNG IHDR');
      if (type === 'IHDR') {
        if (at !== 8 || n !== 13) fail('invalid PNG IHDR');
        width = view.getUint32(at + 8); height = view.getUint32(at + 12); depth = b[at + 16]!; color = b[at + 17]!;
        if (depth !== 8 || ![0, 2, 3, 4, 6].includes(color) || b[at + 18] !== 0 || b[at + 19] !== 0 || b[at + 20] !== 0) fail('unsupported PNG bit depth/interlace; original retained');
      } else if (type === 'IDAT') {
        if (closedIDAT) fail('noncontiguous PNG IDAT');
        seenIDAT = true; chunks.push(b.subarray(at + 8, end - 4));
      } else if (type === 'IEND') {
        if (n || end !== b.length || !seenIDAT) fail('invalid PNG IEND');
        ended = true;
      } else if (!['PLTE', 'tRNS', 'pHYs'].includes(type)) {
        // Retain unknown metadata/profiles rather than silently change their interpretation.
        fail('unsupported PNG metadata ' + type + '; original retained');
      }
      if (seenIDAT && type !== 'IDAT') closedIDAT = true;
      at = end;
    }
    if (!ended) fail('missing PNG IEND');
    bounded(width * height, 1, maxPixels, 'source pixel count', true);
    if (!width || !height) fail('invalid PNG dimensions');
    const channels = color === 0 || color === 3 ? 1 : color === 2 ? 3 : color === 4 ? 2 : 4;
    const joined = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
    let pos = 0; for (const c of chunks) { joined.set(c, pos); pos += c.length; }
    return { width, height, pngInflatedBytes: height * (width * channels + 1), pngIDAT: joined };
  }
  if (image.mimeType !== 'image/jpeg' || b[0] !== 255 || b[1] !== 216) fail('unsupported image encoding');
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at++] !== 255) fail('invalid JPEG marker');
    while (b[at] === 255) at++;
    const marker = b[at++]!;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    if (at + 2 > b.length) fail('truncated JPEG marker');
    const length = view.getUint16(at);
    if (length < 2 || at + length > b.length) fail('JPEG segment exceeds file');
    if (marker === 0xe1 || marker === 0xe2) fail('JPEG EXIF/ICC metadata retained conservatively');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8 || b[at + 2] !== 8 || ![1, 3].includes(b[at + 7]!)) fail('unsupported JPEG precision/components');
      height = view.getUint16(at + 3); width = view.getUint16(at + 5);
    }
    at += length;
  }
  if (!width || !height) fail('missing JPEG dimensions');
  bounded(width * height, 1, maxPixels, 'source pixel count', true);
  return { width, height };
}
function decode(image: NormalizedImage, header: Header, maxPixels: number): Pixels {
  if (image.mimeType === 'image/jpeg') {
    const result = jpeg.decode(image.data, { useTArray: true, formatAsRGBA: true, tolerantDecoding: false, maxResolutionInMP: maxPixels / 1e6, maxMemoryUsageInMB: 256 });
    return { width: result.width, height: result.height, data: new Uint8Array(result.data) };
  }
  // Validate bounded inflation before either the codec or its dependency can allocate
  // an attacker-controlled decompression result. The PNG parser validates CRC as well.
  decodeBuffer({ codec: 'zlib', data: header.pngIDAT!, sourceLength: header.pngInflatedBytes!, parameters: { version: 1 } }, maxPixels * 4 + 16384);
  const p = decodePNG(image.data, { checkCrc: true }), out = new Uint8Array(p.width * p.height * 4);
  if (p.depth !== 8) fail('unsupported decoded PNG depth');
  for (let i = 0; i < p.width * p.height; i++) {
    const at = i * p.channels, to = i * 4;
    if (p.palette) {
      const c = p.palette[p.data[at]!]; if (!c) fail('invalid PNG palette index');
      out.set([c[0]!, c[1]!, c[2]!, c[3] ?? 255], to);
    } else {
      const grey = p.channels < 3;
      out[to] = p.data[at]!; out[to + 1] = p.data[at + (grey ? 0 : 1)]!; out[to + 2] = p.data[at + (grey ? 0 : 2)]!;
      out[to + 3] = p.channels === 2 || p.channels === 4 ? p.data[at + p.channels - 1]! : 255;
      if (p.transparency && p.transparency.length && p.transparency.every((v, c) => p.data[at + c] === v)) out[to + 3] = 0;
    }
  }
  return { width: p.width, height: p.height, data: out };
}
/** PNG's five specified reversible row filters, selected by signed residual cost.
 * The fast-png 6.2 encoder only supports filter 0, which can expand source textures.
 * fflate provides the pinned DEFLATE implementation; fast-png independently decodes
 * every competitive result before measurement. This introduces no color loss. */
function encodeTexturePNG(image: Pixels): Uint8Array {
  const count = image.width * image.height;
  let grey = true, opaque = true;
  for (let i = 0; i < image.data.length; i += 4) { grey &&= image.data[i] === image.data[i + 1] && image.data[i] === image.data[i + 2]; opaque &&= image.data[i + 3] === 255; }
  const channels = (grey ? 1 : 3) + (opaque ? 0 : 1), row = image.width * channels, raw = new Uint8Array(count * channels);
  for (let i = 0; i < count; i++) {
    const from = i * 4, to = i * channels; raw[to] = image.data[from]!;
    if (!grey) { raw[to + 1] = image.data[from + 1]!; raw[to + 2] = image.data[from + 2]!; }
    if (!opaque) raw[to + channels - 1] = image.data[from + 3]!;
  }
  const filtered = new Uint8Array((row + 1) * image.height), trial = new Uint8Array(row), best = new Uint8Array(row);
  for (let y = 0; y < image.height; y++) {
    let minimum = Infinity, choice = 0;
    for (let filter = 0; filter <= 4; filter++) {
      let cost = 0;
      for (let x = 0; x < row; x++) {
        const at = y * row + x, a = x >= channels ? raw[at - channels]! : 0, b = y ? raw[at - row]! : 0, c = y && x >= channels ? raw[at - row - channels]! : 0;
        let prediction = 0;
        if (filter === 1) prediction = a;
        else if (filter === 2) prediction = b;
        else if (filter === 3) prediction = (a + b) >>> 1;
        else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); prediction = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        const residual = (raw[at]! - prediction) & 255;
        trial[x] = residual; cost += Math.min(residual, 256 - residual);
      }
      if (cost < minimum) { minimum = cost; choice = filter; best.set(trial); }
    }
    filtered[y * (row + 1)] = choice; filtered.set(best, y * (row + 1) + 1);
  }
  const ihdr = new Uint8Array(13), iv = new DataView(ihdr.buffer); iv.setUint32(0, image.width); iv.setUint32(4, image.height); ihdr[8] = 8; ihdr[9] = grey ? opaque ? 0 : 4 : opaque ? 2 : 6;
  const payloads: Array<[string, Uint8Array]> = [['IHDR', ihdr], ['IDAT', zlibSync(filtered, { level: 6 })], ['IEND', new Uint8Array()]];
  const result = new Uint8Array(8 + payloads.reduce((n, [, data]) => n + data.length + 12, 0)), view = new DataView(result.buffer);
  result.set([137, 80, 78, 71, 13, 10, 26, 10]); let at = 8;
  for (const [type, data] of payloads) { view.setUint32(at, data.length); result.set(new TextEncoder().encode(type), at + 4); result.set(data, at + 8); view.setUint32(at + 8 + data.length, crc32(result, at + 4, at + 8 + data.length)); at += 12 + data.length; }
  return result;
}
/** Exact area weights, linear-light premultiplied color, or averaged unit normals.
 * Only output quantization is to RGBA8. No source pixels or material fields change. */
function resize(source: Pixels, width: number, height: number, kind: TextureUsage): Pixels {
  if (source.width === width && source.height === height) return { width, height, data: source.data.slice() };
  const data = new Uint8Array(width * height * 4), sx = source.width / width, sy = source.height / height;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let r = 0, g = 0, b = 0, a = 0, sum = 0;
    const left = x * sx, right = (x + 1) * sx, top = y * sy, bottom = (y + 1) * sy;
    for (let iy = Math.floor(top); iy < Math.min(source.height, Math.ceil(bottom)); iy++) for (let ix = Math.floor(left); ix < Math.min(source.width, Math.ceil(right)); ix++) {
      const w = (Math.min(right, ix + 1) - Math.max(left, ix)) * (Math.min(bottom, iy + 1) - Math.max(top, iy));
      const at = (iy * source.width + ix) * 4, alpha = source.data[at + 3]! / 255;
      let cr = source.data[at]!, cg = source.data[at + 1]!, cb = source.data[at + 2]!;
      if (kind === 'srgb') { cr = SRGB[cr]! * alpha; cg = SRGB[cg]! * alpha; cb = SRGB[cb]! * alpha; }
      else if (kind === 'normal') { cr = cr / 127.5 - 1; cg = cg / 127.5 - 1; cb = cb / 127.5 - 1; const n = Math.hypot(cr, cg, cb); if (n) { cr /= n; cg /= n; cb /= n; } }
      r += cr * w; g += cg * w; b += cb * w; a += alpha * w; sum += w;
    }
    const at = (y * width + x) * 4;
    if (kind === 'srgb') { data[at] = byte(a ? toSrgb(r / a) : 0); data[at + 1] = byte(a ? toSrgb(g / a) : 0); data[at + 2] = byte(a ? toSrgb(b / a) : 0); }
    else if (kind === 'normal') { const n = Math.hypot(r, g, b); data[at] = byte(127.5 * (n ? r / n + 1 : 1)); data[at + 1] = byte(127.5 * (n ? g / n + 1 : 1)); data[at + 2] = byte(127.5 * (n ? b / n + 1 : 2)); }
    else { data[at] = byte(r / sum); data[at + 1] = byte(g / sum); data[at + 2] = byte(b / sum); }
    data[at + 3] = byte(255 * a / sum);
  }
  return { width, height, data };
}
function measure(source: Pixels, candidate: Pixels, kind: TextureUsage, usage: Usage): TextureError {
  const result = zeroError(), sums = [0, 0, 0, 0], srcCoverage = usage.cutoffs.map(() => 0), dstCoverage = usage.cutoffs.map(() => 0);
  const pixels = source.width * source.height, scales = [...new Set(usage.normalScales)], v = [0, 0, 0, 0];
  if (source.width === candidate.width && source.height === candidate.height && source.data.every((value, i) => value === candidate.data[i])) {
    result.comparedPixels = pixels;
    return result;
  }
  let angleSum = 0;
  for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
    const fx = (x + 0.5) * candidate.width / source.width - 0.5, fy = (y + 0.5) * candidate.height / source.height - 0.5;
    const bx = Math.floor(fx), by = Math.floor(fy), tx = fx - bx, ty = fy - by;
    const x0 = Math.max(0, bx), x1 = Math.min(candidate.width - 1, bx + 1), y0 = Math.max(0, by), y1 = Math.min(candidate.height - 1, by + 1);
    const a = (y0 * candidate.width + x0) * 4, b = (y0 * candidate.width + x1) * 4, c = (y1 * candidate.width + x0) * 4, d = (y1 * candidate.width + x1) * 4;
    const wa = (1 - tx) * (1 - ty), wb = tx * (1 - ty), wc = (1 - tx) * ty, wd = tx * ty, at = (y * source.width + x) * 4;
    for (let ch = 0; ch < 4; ch++) {
      const ca = candidate.data[a + ch]!, cb = candidate.data[b + ch]!, cc = candidate.data[c + ch]!, cd = candidate.data[d + ch]!;
      const value = kind === 'srgb' && ch < 3 ? toSrgb(SRGB[ca]! * wa + SRGB[cb]! * wb + SRGB[cc]! * wc + SRGB[cd]! * wd) : ca * wa + cb * wb + cc * wc + cd * wd;
      v[ch] = value;
      const error = Math.abs(source.data[at + ch]! - value);
      sums[ch]! += error * error; result.rgbaMax = Math.max(result.rgbaMax, error);
      if (ch === 3) result.alphaMax = Math.max(result.alphaMax, error);
    }
    if (kind === 'normal') {
      let maxAngle = 0;
      for (const scale of scales) {
        const ax = (source.data[at]! / 127.5 - 1) * scale, ay = (source.data[at + 1]! / 127.5 - 1) * scale, az = source.data[at + 2]! / 127.5 - 1;
        const bx = (v[0]! / 127.5 - 1) * scale, by = (v[1]! / 127.5 - 1) * scale, bz = v[2]! / 127.5 - 1;
        const norm = Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz);
        const angle = norm ? Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / norm))) * 180 / Math.PI : 180;
        maxAngle = Math.max(maxAngle, angle);
      }
      angleSum += maxAngle * maxAngle; result.normalAngleMaxDegrees = Math.max(result.normalAngleMaxDegrees, maxAngle);
    }
    usage.cutoffs.forEach((cutoff, i) => { if (source.data[at + 3]! / 255 >= cutoff) srcCoverage[i]!++; if (v[3]! / 255 >= cutoff) dstCoverage[i]!++; });
  }
  result.channelRmse = sums.map(s => Math.sqrt(s / pixels)) as TextureError['channelRmse'];
  result.rgbaRmse = Math.sqrt(sums.reduce((s, n) => s + n, 0) / (pixels * 4));
  result.alphaRmse = result.channelRmse[3]; result.comparedPixels = pixels;
  result.normalAngleRmseDegrees = Math.sqrt(angleSum / pixels);
  result.alphaCoverageMaxDifference = srcCoverage.reduce((max, count, i) => Math.max(max, Math.abs(count - dstCoverage[i]!) / pixels), 0);
  return result;
}
function rejection(error: TextureError, s: Required<TextureOptimizationOptions>): string | null {
  if (error.rgbaRmse > s.maxRgbaRmse || error.rgbaMax > s.maxRgbaError) return 'RGBA error limit exceeded';
  if (error.alphaRmse > s.maxAlphaRmse || error.alphaMax > s.maxAlphaError) return 'alpha error limit exceeded';
  if (error.normalAngleMaxDegrees > s.maxNormalAngleDegrees) return 'normal angular error limit exceeded';
  if (error.alphaCoverageMaxDifference > s.maxAlphaCoverageError) return 'alpha mask coverage limit exceeded';
  return null;
}

/** The returned asset owns all its arrays and JSON. Geometry, source provenance,
 * materials, texture indices, samplers, factors, alpha modes, UVs and extensions
 * remain intact. Shared mixed color/data/normal images and unknown usages are kept
 * exact; no silent texture splitting or reinterpretation is performed. */
export function optimizeTextures(input: NormalizedAsset, options: TextureOptimizationOptions): { asset: NormalizedAsset; report: TextureOptimizationReport } {
  const s = settings(options), asset: NormalizedAsset = structuredClone(input), usage = usages(input);
  const report: TextureOptimizationReport = {
    mode: s.mode, settings: s, sourceBytes: 0, outputBytes: 0, savedBytes: 0, changedImages: 0, sourcePixels: 0, outputPixels: 0, images: [],
    codecs: { jpeg: 'jpeg-js@0.4.4', png: 'fast-png@6.2.0', pngCompression: 'fflate@0.8.2', pngFilter: 'minimum-signed-residual', runtimeRequired: false },
    measurement: 'Every source texel versus emitted bytes decoded by the pinned codec and bilinearly reconstructed at source texel centers, clamped at image edges; RGB color interpolation in linear light, RGBA error in 0..255 units. Normal angle includes each referencing material normal scale. Alpha mask coverage includes baseColorFactor alpha. This image metric is not a rendered-view similarity claim.',
  };
  let processedPixels = 0;
  for (const [index, original] of input.images.entries()) {
    const use = usage[index]!, kinds = [...use.kinds].sort(), entry: TextureImageReport = {
      imageIndex: index, sourceIndex: original.sourceIndex, usages: kinds, materialSlots: use.slots,
      sourceMimeType: original.mimeType, outputMimeType: original.mimeType, sourceBytes: original.data.length, outputBytes: original.data.length,
      sourceDimensions: null, outputDimensions: null, changed: false, reason: 'lossless: original image bytes retained without decoding', error: zeroError(), candidates: [],
    };
    report.images.push(entry); report.sourceBytes += original.data.length;
    if (s.mode === 'lossless') continue;
    try {
      const header = imageHeader(original, s.maxSourcePixels), count = header.width * header.height;
      entry.sourceDimensions = [header.width, header.height]; entry.outputDimensions = [...entry.sourceDimensions];
      report.sourcePixels += count; report.outputPixels += count;
      if (kinds.length !== 1 || kinds[0] === 'unknown') { entry.reason = kinds.length > 1 ? 'shared mixed-use image retained exactly' : 'unused or unknown material use retained exactly'; continue; }
      if (processedPixels + count > s.maxTotalSourcePixels) { entry.reason = 'total source-pixel processing budget reached'; continue; }
      processedPixels += count;
      const source = decode(original, header, s.maxSourcePixels), kind = kinds[0]!, factor = Math.min(1, s.maxDimension / Math.max(source.width, source.height));
      const width = Math.max(1, Math.floor(source.width * factor)), height = Math.max(1, Math.floor(source.height * factor));
      const reduced = resize(source, width, height, kind), opaque = source.data.every((v, i) => i % 4 !== 3 || v === 255);
      // JPEG first for opaque color; PNG is a second bounded competitor, often best
      // for flat colors. No quantized JPEG is allowed for data, normals, or alpha.
      const mimes = kind === 'srgb' && opaque ? ['image/jpeg', 'image/png'].slice(0, s.maxCandidates) : ['image/png'];
      let winner: { image: NormalizedImage; candidate: TextureCandidateReport } | undefined;
      for (const mimeType of mimes) {
        const data = mimeType === 'image/jpeg' ? new Uint8Array(jpeg.encode(reduced, s.quality).data) : encodeTexturePNG(reduced);
        const image = { sourceIndex: original.sourceIndex, mimeType, data };
        // A candidate that cannot beat source size cannot win at any quality.
        // Avoid its decode and O(sourcePixels) metric pass; report this explicitly.
        if (data.length >= original.data.length || winner && data.length >= winner.image.data.length) {
          entry.candidates.push({ mimeType, dimensions: [width, height], bytes: data.length, error: null, accepted: false, reason: 'candidate is not smaller than current best; error evaluation skipped' });
          continue;
        }
        const decoded = decode(image, imageHeader(image, s.maxSourcePixels), s.maxSourcePixels), error = measure(source, decoded, kind, use);
        const reason = rejection(error, s);
        const candidate: TextureCandidateReport = { mimeType, dimensions: [width, height], bytes: data.length, error, accepted: reason === null, reason: reason ?? 'passes all image error bounds and saves bytes' };
        entry.candidates.push(candidate);
        if (!reason && (!winner || data.length < winner.image.data.length)) winner = { image, candidate };
      }
      if (winner) {
        asset.images[index] = winner.image;
        if (asset.json.images?.[index]) asset.json.images[index].mimeType = winner.image.mimeType;
        entry.changed = true; entry.outputBytes = winner.image.data.length; entry.outputMimeType = winner.image.mimeType;
        entry.outputDimensions = winner.candidate.dimensions; entry.error = winner.candidate.error!;
        entry.reason = 'smallest bounded candidate passing all error limits';
        report.changedImages++; report.outputPixels += width * height - count;
      } else entry.reason = 'original retained: no smaller candidate passes every error limit';
    } catch (error) { entry.reason = error instanceof Error ? error.message : String(error); }
  }
  report.outputBytes = asset.images.reduce((sum, image) => sum + image.data.length, 0);
  report.savedBytes = report.sourceBytes - report.outputBytes;
  if (s.mode === 'lossy' && report.changedImages) {
    asset.validation.imageBytes = report.outputBytes;
    asset.validation.decodedBytes = input.validation.decodedBytes - report.savedBytes;
  }
  return { asset, report };
}
