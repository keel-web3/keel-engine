// A background asset compiler, not a JavaScript-to-ROM compiler. All rows are top first.
import { fromRgb555, nearestColour, reduceColours, rgb555, targetProfile } from "@keel-engine/core";
import type { RGB, TargetId } from "@keel-engine/core";

export type GameBoyTarget = Extract<TargetId, "game-boy" | "game-boy-color" | "chromatic">;
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array | Uint8ClampedArray;
}
export interface GameBoyExportOptions {
  readonly target?: GameBoyTarget;
  /** Output dimensions, multiples of 8 up to 256. Default: the target's 160 × 144 screen. */
  readonly width?: number;
  readonly height?: number;
  /** Contain keeps the aspect ratio and pads; stretch is explicit. Nearest-neighbour in both. */
  readonly fit?: "contain" | "stretch";
  /** Backgrounds are opaque. Composite transparency onto this colour before conversion. */
  readonly background?: Readonly<RGB>;
}
export interface GameBoyBackground {
  readonly target: GameBoyTarget;
  readonly width: number;
  readonly height: number;
  readonly mapWidth: number;
  readonly mapHeight: number;
  /** Two separate native 2bpp tile banks, uploaded at $8000; tile numbers are unsigned. */
  readonly tiles: readonly [Uint8Array, Uint8Array];
  readonly tileCount: number;
  /** Compact row-major map; copy rows into the hardware's 32-wide map (GBDK set_bkg_tiles does this). */
  readonly tilemap: Uint8Array;
  /** CGB map in VRAM bank 1: palette in bits 0..2, tile data bank in bit 3. DMG: all zero. */
  readonly attributes: Uint8Array;
  /** CGB palettes: four little-endian RGB555 words each. Empty for DMG. */
  readonly palettes: Uint8Array;
  readonly paletteCount: number;
  /** DMG BGP register: index 0 light through index 3 dark. */
  readonly dmgPalette: number;
  /** Decoded from the emitted tiles, map and palettes; exact native asset preview. */
  readonly preview: Uint8Array;
  /** Against the resized, composited source, including colour-space and palette loss. */
  readonly changedPixels: number;
}

const key = (c: Readonly<RGB>): number => (c[0] << 16) | (c[1] << 8) | c[2];
const ordered = (colours: readonly RGB[]): RGB[] => [...colours].sort((a, b) => key(a) - key(b));
const signature = (colours: readonly RGB[]): string => ordered(colours).map(key).join(",");
const distance = (a: Readonly<RGB>, b: Readonly<RGB>): number => (a[0] - b[0]) ** 2 * 299 + (a[1] - b[1]) ** 2 * 587 + (a[2] - b[2]) ** 2 * 114;
interface Candidate { colours: RGB[]; weights: number[]; count: number }

// When exact palette packing needs more than eight slots, spend slots on the biggest
// remaining color error. Eight nearly identical gray palettes should not erase a bright accent.
function choosePalettes(candidates: readonly Candidate[]): RGB[][] {
  const errors = candidates.map((tile) => Float64Array.from(candidates.map((palette) => tile.colours.reduce((n, c, i) => n + distance(c, palette.colours[nearestColour(c, palette.colours)]!) * tile.weights[i]!, 0))));
  const best = new Float64Array(candidates.length).fill(Infinity), selected: number[] = [];
  for (let slot = 0; slot < Math.min(8, candidates.length); slot += 1) {
    let winner = -1, total = Infinity;
    for (let p = 0; p < candidates.length; p += 1) {
      if (selected.includes(p)) continue;
      let error = 0;
      for (let t = 0; t < candidates.length; t += 1) error += Math.min(best[t]!, errors[t]![p]!);
      if (error < total) { total = error; winner = p; }
    }
    if (winner < 0) break;
    selected.push(winner);
    for (let t = 0; t < candidates.length; t += 1) best[t] = Math.min(best[t]!, errors[t]![winner]!);
    if (total === 0) break;
  }
  return selected.map((i) => candidates[i]!.colours);
}

function resized(image: RgbaImage, width: number, height: number, fit: "contain" | "stretch", bg: Readonly<RGB>): RGB[] {
  const scale = Math.min(width / image.width, height / image.height);
  const w = fit === "stretch" ? width : Math.max(1, Math.round(image.width * scale));
  const h = fit === "stretch" ? height : Math.max(1, Math.round(image.height * scale));
  const left = Math.floor((width - w) / 2), top = Math.floor((height - h) / 2);
  return Array.from({ length: width * height }, (_, i): RGB => {
    const x = i % width - left, y = Math.floor(i / width) - top;
    if (x < 0 || y < 0 || x >= w || y >= h) return [...bg];
    const sx = Math.min(image.width - 1, Math.floor(x * image.width / w));
    const sy = Math.min(image.height - 1, Math.floor(y * image.height / h));
    const p = (sy * image.width + sx) * 4, alpha = image.rgba[p + 3]!;
    return [0, 1, 2].map((a) => Math.round((image.rgba[p + a]! * alpha + bg[a]! * (255 - alpha)) / 255)) as RGB;
  });
}

/** Convert to the real per-tile constraints, then reject a tile count that cannot be addressed. */
export function exportGameBoyBackground(image: RgbaImage, options: GameBoyExportOptions = {}): GameBoyBackground {
  const target = options.target ?? "chromatic", profile = targetProfile(target);
  if (profile.kind !== "hardware" || !profile.hardware) throw new RangeError("Choose a Game Boy hardware target for native export");
  const width = options.width ?? profile.width, height = options.height ?? profile.height;
  if (![width, height].every((n) => Number.isSafeInteger(n) && n > 0 && n % 8 === 0)) throw new RangeError("Native dimensions must be positive multiples of 8");
  if (width > 256 || height > 256) throw new RangeError("A background map is at most 256 × 256 pixels");
  if (![image.width, image.height].every((n) => Number.isSafeInteger(n) && n > 0) || image.width * image.height > 16777216 || image.rgba.length !== image.width * image.height * 4) throw new RangeError("Invalid RGBA image dimensions or byte length");
  const fit = options.fit ?? "contain";
  if (fit !== "contain" && fit !== "stretch") throw new RangeError("Unknown image fit");
  const bg = options.background ?? [255, 255, 255];
  if (bg.length !== 3 || !bg.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) throw new RangeError("Background must be three RGB bytes");
  const source = resized(image, width, height, fit, bg);
  const mono = profile.hardware === "game-boy";
  const pixels = source.map((c): RGB => mono ? [...c] : fromRgb555(rgb555(c)));
  const mapWidth = width / 8, mapHeight = height / 8;
  const tilePixels: RGB[][] = [];
  for (let ty = 0; ty < mapHeight; ty += 1) for (let tx = 0; tx < mapWidth; tx += 1) {
    const tile: RGB[] = [];
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) tile.push(pixels[(ty * 8 + y) * width + tx * 8 + x]!);
    tilePixels.push(tile);
  }
  let paletteList: RGB[][] = [[[255, 255, 255], [170, 170, 170], [85, 85, 85], [0, 0, 0]]];
  if (!mono) {
    const candidates = new Map<string, Candidate>();
    for (const tile of tilePixels) {
      const colours = ordered(reduceColours(tile, 4)), id = signature(colours);
      const candidate = candidates.get(id) ?? { colours, count: 0, weights: Array<number>(colours.length).fill(0) };
      candidate.count += 1;
      for (const c of tile) { const i = nearestColour(c, colours); candidate.weights[i] = candidate.weights[i]! + 1; }
      candidates.set(id, candidate);
    }
    paletteList = [];
    let overflow = false;
    // Frequently used tile palettes get first choice; compatible palettes share a hardware slot.
    for (const candidate of [...candidates.values()].sort((a, b) => {
      const sa = signature(a.colours), sb = signature(b.colours);
      return b.count - a.count || (sa < sb ? -1 : sa > sb ? 1 : 0);
    })) {
      let merged = false;
      for (let i = 0; i < paletteList.length; i += 1) {
        const union = reduceColours([...paletteList[i]!, ...candidate.colours], 8);
        if (union.length <= 4) { paletteList[i] = ordered(union); merged = true; break; }
      }
      if (!merged) {
        if (paletteList.length < 8) paletteList.push(candidate.colours); else overflow = true;
      }
    }
    if (overflow) paletteList = choosePalettes([...candidates.values()].sort((a, b) => {
      const sa = signature(a.colours), sb = signature(b.colours);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    }));
    paletteList = paletteList.map((p) => [...p, ...Array.from({ length: 4 - p.length }, () => p[0]!)]);
  }
  const tilemap = new Uint8Array(tilePixels.length), attributes = new Uint8Array(tilePixels.length);
  const unique: Uint8Array[] = [], ids = new Map<string, number>();
  for (let t = 0; t < tilePixels.length; t += 1) {
    const tile = tilePixels[t]!;
    let selected = 0, best = Infinity, selectedIndices: number[] = [];
    for (let p = 0; p < paletteList.length; p += 1) {
      const pal = paletteList[p]!, indices = tile.map((c) => nearestColour(c, pal));
      let error = 0;
      tile.forEach((c, i) => { error += distance(c, pal[indices[i]!]!); });
      if (error < best) { best = error; selected = p; selectedIndices = indices; }
    }
    const data = new Uint8Array(16);
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
      const index = selectedIndices[y * 8 + x]!;
      data[y * 2] = data[y * 2]! | ((index & 1) << (7 - x));
      data[y * 2 + 1] = data[y * 2 + 1]! | ((index >> 1) << (7 - x));
    }
    const id = String(data);
    let number = ids.get(id);
    if (number === undefined) {
      number = unique.length;
      if (number >= (mono ? 256 : 512)) throw new RangeError(`${profile.label} background exceeds ${mono ? 256 : 512} unique tiles; simplify the image or export smaller sections`);
      ids.set(id, number); unique.push(data);
    }
    tilemap[t] = number & 255;
    attributes[t] = selected | (number >= 256 ? 8 : 0);
  }
  const tiles: [Uint8Array, Uint8Array] = [new Uint8Array(Math.min(256, unique.length) * 16), new Uint8Array(Math.max(0, unique.length - 256) * 16)];
  unique.forEach((data, i) => tiles[i < 256 ? 0 : 1].set(data, (i % 256) * 16));
  const palettes = new Uint8Array(mono ? 0 : paletteList.length * 8);
  if (!mono) paletteList.forEach((pal, p) => pal.forEach((c, i) => { const word = rgb555(c), at = p * 8 + i * 2; palettes[at] = word & 255; palettes[at + 1] = word >> 8; }));
  const preview = new Uint8Array(width * height * 4);
  let changedPixels = 0;
  // Decode the output, not an intermediate quantized image.
  for (let ty = 0; ty < mapHeight; ty += 1) for (let tx = 0; tx < mapWidth; tx += 1) {
    const t = ty * mapWidth + tx, attr = attributes[t]!, bank = attr & 8 ? 1 : 0;
    const data = tiles[bank], start = tilemap[t]! * 16, pal = paletteList[attr & 7]!;
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) {
      const shift = 7 - x, index = (data[start + y * 2]! >> shift & 1) | (data[start + y * 2 + 1]! >> shift & 1) << 1;
      const c = pal[index]!, i = (ty * 8 + y) * width + tx * 8 + x;
      preview.set([...c, 255], i * 4);
      if (key(c) !== key(source[i]!)) changedPixels += 1;
    }
  }
  return { target, width, height, mapWidth, mapHeight, tiles, tileCount: unique.length, tilemap, attributes, palettes, paletteCount: paletteList.length, dmgPalette: 0xe4, preview, changedPixels };
}

/** A single portable C source containing the native arrays (GBDK uses stdint.h too). */
export function gameBoyCSource(asset: GameBoyBackground, name = "keel_scene"): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new RangeError("Asset name must be a C identifier");
  const bytes = (label: string, data: Uint8Array): string => {
    if (!data.length) return "";
    const lines = Array.from({ length: Math.ceil(data.length / 16) }, (_, i) => `  ${[...data.subarray(i * 16, i * 16 + 16)].map((b) => `0x${b.toString(16).padStart(2, "0")}`).join(", ")}`);
    return `const uint8_t ${name}_${label}[${data.length}] = {\n${lines.join(",\n")}\n};\n`;
  };
  const words = Array.from({ length: asset.palettes.length / 2 }, (_, i) => `0x${(asset.palettes[i * 2]! | asset.palettes[i * 2 + 1]! << 8).toString(16).padStart(4, "0")}`);
  return `/* KEEL ${asset.target} background assets. Rows top first; LCDC.4 = 1 (unsigned tile IDs).\n * Load tile banks at $8000, tilemap to VRAM bank 0, attributes to bank 1 in CGB mode.\n * Compact ${asset.mapWidth} x ${asset.mapHeight} maps: use set_bkg_tiles, not a contiguous VRAM memcpy.\n * These are graphics assets. Game logic and cartridge compilation are separate. */\n#include <stdint.h>\n\nconst uint8_t ${name}_map_width = ${asset.mapWidth};\nconst uint8_t ${name}_map_height = ${asset.mapHeight};\nconst uint16_t ${name}_tile_count = ${asset.tileCount};\nconst uint8_t ${name}_palette_count = ${asset.paletteCount};\nconst uint8_t ${name}_dmg_palette = 0xe4;\n\n${bytes("tiles0", asset.tiles[0])}\n${bytes("tiles1", asset.tiles[1])}\n${bytes("tilemap", asset.tilemap)}\n${bytes("attributes", asset.attributes)}\n${words.length ? `const uint16_t ${name}_palettes[${words.length}] = { ${words.join(", ")} };\n` : ""}`;
}

/** Binary files plus the single-file C equivalent. No filesystem or browser dependency. */
export function gameBoyFiles(asset: GameBoyBackground, name = "keel_scene"): ReadonlyMap<string, Uint8Array> {
  const files = new Map<string, Uint8Array>([[`${name}.c`, new TextEncoder().encode(gameBoyCSource(asset, name))], [`${name}.tiles0.2bpp`, asset.tiles[0]], [`${name}.tilemap`, asset.tilemap]]);
  if (asset.tiles[1].length) files.set(`${name}.tiles1.2bpp`, asset.tiles[1]);
  if (asset.target !== "game-boy") { files.set(`${name}.attrmap`, asset.attributes); files.set(`${name}.pal`, asset.palettes); }
  return files;
}
