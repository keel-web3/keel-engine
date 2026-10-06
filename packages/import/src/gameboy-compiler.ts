/** Explicit hardware lowering of the existing animated model converter.
 * Four-color rasterization is a style conversion; subsequent tile storage is lossless. */
import { encodeRetroClip, decodeRetroClipFrame, encodeRetroAsset } from "@keel-engine/codec/retro";
import { normalizeAsset } from "./asset-normalize-v3.ts";
import type { NormalizeAssetInput } from "./asset-normalize-v3.ts";
import { renderSpriteFrames } from "./sprite-raster.ts";
import type { SpriteRasterOptions } from "./sprite-raster.ts";

export type GameBoyCompileInput = NormalizeAssetInput & Omit<SpriteRasterOptions, "resolution" | "directions"> & {
  /** RGB555; slot zero is transparent for native object sprites. */
  palette: readonly [number, number, number, number];
};
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const rgb = (p: number) => [(p & 31) * 255 / 31, ((p >> 5) & 31) * 255 / 31, ((p >> 10) & 31) * 255 / 31];

export function gameBoyTiles(frame: Uint8Array, palette: readonly number[]): Uint8Array {
  if (frame.length !== 4096 || palette.length !== 4 || palette.some(p => !Number.isInteger(p) || p < 0 || p > 32767)) throw Error("Invalid Game Boy sprite or palette");
  const colors = palette.map(rgb), out = new Uint8Array(256);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const at = (y * 32 + x) * 4, threshold = (BAYER[(y % 4) * 4 + x % 4]! + .5) / 16;
    let color = 0;
    if (frame[at + 3]! / 255 > threshold) {
      const pixel = [frame[at]!, frame[at + 1]!, frame[at + 2]!];
      const nearest = [1, 2, 3].sort((a, b) => colors[a]!.reduce((n, c, k) => n + (c - pixel[k]!) ** 2, 0) - colors[b]!.reduce((n, c, k) => n + (c - pixel[k]!) ** 2, 0));
      const a = colors[nearest[0]!]!, b = colors[nearest[1]!]!, direction = b.map((v, k) => v - a[k]!);
      const length = direction.reduce((n, v) => n + v * v, 0);
      const blend = length ? Math.max(0, Math.min(1, direction.reduce((n, v, k) => n + v * (pixel[k]! - a[k]!), 0) / length)) : 0;
      color = blend > threshold ? nearest[1]! : nearest[0]!;
    }
    const row = ((y >> 3) * 4 + (x >> 3)) * 16 + (y & 7) * 2, bit = 7 - (x & 7);
    out[row] = out[row]! | (color & 1) << bit;
    out[row + 1] = out[row + 1]! | (color >> 1) << bit;
  }
  return out;
}

/** Parse once, retain real mesh/rig/morph animation, sample eight coherent views. */
export async function compileGameBoySourceAsset(input: GameBoyCompileInput) {
  if (input.palette.length !== 4 || input.palette.some(p => !Number.isInteger(p) || p < 0 || p > 32767)) throw Error("Invalid Game Boy sprite or palette");
  const source = await normalizeAsset(input);
  const raster = renderSpriteFrames(source, { ...input, resolution: 32, directions: 8 });
  const phases = raster.animation.frameCount, frames: Uint8Array[] = [];
  for (let phase = 0; phase < phases; phase++) for (let view = 0; view < 8; view++) frames.push(gameBoyTiles(raster.frames[view * phases + phase]!, input.palette));
  const clip = encodeRetroClip(frames, 8);
  frames.forEach((f, i) => { const back = decodeRetroClipFrame(clip, i); if (f.some((v, j) => v !== back[j])) throw Error("Native clip changed baked tiles"); });
  const packets = Array.from({ length: phases }, (_, i) => encodeRetroAsset({ palette: input.palette, frames: frames.slice(i * 8, i * 8 + 8), shadeMasks: new Uint16Array(8) }));
  return { clip, packets, palette: [...input.palette], animation: { ...raster.animation, order: "phase-major" as const }, bounds: raster.bounds,
    report: { sourceTriangles: raster.report.sourceTriangles, views: 8, phases, rawTileBytes: frames.length * 256,
      romBytes: clip.data.length + clip.offsets.byteLength + clip.bases.byteLength, cachePacketBytes: packets.reduce((n, p) => n + p.length, 0),
      maxDecodeFrames: 2, decoderBufferBytes: 512, tileStorageLossless: true,
      fidelity: "Explicit 32px four-color sampled sprite conversion; not lossless source-model or GPU/PBR replay", warnings: raster.report.warnings } };
}
