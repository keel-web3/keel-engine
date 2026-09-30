// Era labels are art presets. Hardware targets additionally name a native asset format.
import type { RGB } from "./palette.ts";

export type RetroBits = 8 | 16 | 32 | 64;
export type TargetId = "native" | "8-bit" | "16-bit" | "32-bit" | "64-bit" | "game-boy" | "game-boy-color" | "chromatic";
export type TargetInput = TargetId | RetroBits;
export type TargetColour = Readonly<RGB> | ArrayLike<number>;
export interface TargetProfile {
  readonly id: TargetId;
  readonly label: string;
  readonly kind: "native" | "style" | "hardware";
  readonly width: number;
  readonly height: number;
  readonly paletteLimit: number;
  readonly channelBits: 5 | 8;
  readonly screen: 0 | 2 | 4 | 8;
  readonly dither: number;
  readonly hardware: "game-boy" | "game-boy-color" | null;
}

const preset = (id: TargetId, label: string, kind: TargetProfile["kind"], width: number, height: number, paletteLimit: number, channelBits: 5 | 8, screen: TargetProfile["screen"], hardware: TargetProfile["hardware"] = null): TargetProfile =>
  Object.freeze({ id, label, kind, width, height, paletteLimit, channelBits, screen, dither: screen ? 0.9 : 0, hardware });

export const TARGET_PROFILES: Readonly<Record<TargetId, TargetProfile>> = Object.freeze({
  native: preset("native", "Original", "native", 128, 128, 65536, 8, 4),
  "8-bit": preset("8-bit", "8-bit style", "style", 256, 240, 16, 8, 2),
  "16-bit": preset("16-bit", "16-bit style", "style", 320, 240, 256, 5, 4),
  "32-bit": preset("32-bit", "32-bit style", "style", 512, 384, 32768, 5, 4),
  "64-bit": preset("64-bit", "64-bit style", "style", 640, 480, 65536, 8, 8),
  "game-boy": preset("game-boy", "Game Boy", "hardware", 160, 144, 4, 8, 2, "game-boy"),
  "game-boy-color": preset("game-boy-color", "Game Boy Color", "hardware", 160, 144, 32, 5, 2, "game-boy-color"),
  chromatic: preset("chromatic", "ModRetro Chromatic", "hardware", 160, 144, 32, 5, 2, "game-boy-color"),
});

export function targetProfile(input: TargetInput): TargetProfile {
  const id = typeof input === "number" ? `${input}-bit` : input;
  if (!Object.hasOwn(TARGET_PROFILES, id)) throw new RangeError(`Unknown target: ${id}`);
  return TARGET_PROFILES[id as TargetId];
}

const byte = (n: number): number => {
  if (!Number.isFinite(n)) throw new RangeError("Colour channels must be finite");
  return Math.max(0, Math.min(255, Math.round(n)));
};
const colour = (c: TargetColour): RGB => [byte(c[0] ?? 0), byte(c[1] ?? 0), byte(c[2] ?? 0)];
const key = (c: Readonly<RGB>): number => (c[0] << 16) | (c[1] << 8) | c[2];
const light = (c: Readonly<RGB>): number => c[0] * 299 + c[1] * 587 + c[2] * 114;

/** Game Boy Color's R0..4, G5..9, B10..14 word (write low byte first). */
export function rgb555(c: TargetColour): number {
  const [r, g, b] = colour(c).map((v) => Math.round(v * 31 / 255));
  return r! | (g! << 5) | (b! << 10);
}
export function fromRgb555(word: number): RGB {
  return [Math.round((word & 31) * 255 / 31), Math.round(((word >> 5) & 31) * 255 / 31), Math.round(((word >> 10) & 31) * 255 / 31)];
}

/** Stable tie breaking: the first equally close palette entry wins. */
export function nearestColour(c: Readonly<RGB>, palette: readonly Readonly<RGB>[]): number {
  if (!palette.length) throw new RangeError("A palette must contain a colour");
  let best = 0, distance = Infinity;
  for (let i = 0; i < palette.length; i += 1) {
    const p = palette[i]!;
    const d = (c[0] - p[0]) ** 2 * 299 + (c[1] - p[1]) ** 2 * 587 + (c[2] - p[2]) ** 2 * 114;
    if (d < distance) { distance = d; best = i; }
  }
  return best;
}

interface Sample { c: RGB; count: number }
interface Box { samples: Sample[]; axis: number; score: number }
function box(samples: Sample[]): Box {
  let axis = 0, range = -1;
  for (let a = 0; a < 3; a += 1) {
    let lo = 255, hi = 0;
    for (const s of samples) { lo = Math.min(lo, s.c[a]!); hi = Math.max(hi, s.c[a]!); }
    if (hi - lo > range) { axis = a; range = hi - lo; }
  }
  return { samples, axis, score: samples.length > 1 ? range * samples.reduce((n, s) => n + s.count, 0) : -1 };
}

/** Weighted median cut. Representatives stay in the source colour space, including RGB555. */
export function reduceColours(input: readonly TargetColour[], limit: number): RGB[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Palette limit must be a positive integer");
  const histogram = new Map<number, Sample>();
  for (const raw of input) {
    const c = colour(raw), k = key(c), old = histogram.get(k);
    if (old) old.count += 1; else histogram.set(k, { c, count: 1 });
  }
  const samples = [...histogram.values()].sort((a, b) => key(a.c) - key(b.c));
  if (samples.length <= limit) return samples.map((s) => [...s.c]);
  const boxes = [box(samples)];
  while (boxes.length < limit) {
    let selected = 0;
    for (let i = 1; i < boxes.length; i += 1) if (boxes[i]!.score > boxes[selected]!.score) selected = i;
    const b = boxes[selected]!;
    if (b.score < 0) break;
    b.samples.sort((a, z) => a.c[b.axis]! - z.c[b.axis]! || key(a.c) - key(z.c));
    const half = b.samples.reduce((n, s) => n + s.count, 0) / 2;
    let total = 0, split = 0;
    do { total += b.samples[split++]!.count; } while (total < half && split < b.samples.length - 1);
    boxes.splice(selected, 1, box(b.samples.slice(0, split)), box(b.samples.slice(split)));
  }
  return boxes.map((b): RGB => {
    const weight = b.samples.reduce((n, s) => n + s.count, 0);
    const mean: RGB = [0, 0, 0];
    for (const s of b.samples) for (let a = 0; a < 3; a += 1) mean[a] = mean[a]! + s.c[a]! * s.count / weight;
    return [...b.samples[nearestColour(mean, b.samples.map((s) => s.c))]!.c];
  }).sort((a, b) => light(a) - light(b) || key(a) - key(b));
}

/** Keep ramp bases and palette indices valid; repeated entries reduce the visible colour count. */
export function adaptTargetPalette(input: readonly TargetColour[], target: TargetInput): RGB[] {
  const profile = targetProfile(target);
  const colours = input.map((c): RGB => {
    const rgb = colour(c);
    if (profile.hardware === "game-boy") {
      const v = Math.round(light(rgb) / 85000) * 85;
      return [v, v, v];
    }
    return profile.channelBits === 5 ? fromRgb555(rgb555(rgb)) : rgb;
  });
  const palette = reduceColours(colours, profile.paletteLimit);
  const cache = new Map(palette.map((c) => [key(c), c]));
  return colours.map((c): RGB => {
    const k = key(c);
    let found = cache.get(k);
    if (!found) { found = palette[nearestColour(c, palette)]!; cache.set(k, found); }
    return [...found];
  });
}
