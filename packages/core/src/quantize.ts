// The palette quantize step: a shade buffer to palette indices -- ported
// from the proof of concept's src/core/quantize.js (NOCTURNES render.js's
// quantize, BAYER4Q, accentCode, HALO_SCREEN, the lums table and the ramp
// map, lifted out of the renderer's closure into a factory).
// test/*-equality.test.ts proves its output identical, on real NOCTURNES shade
// buffers and on random ones.
//
// A shade buffer (`buf`) is per pixel, n = width * height:
//   L       Float32Array  light, 0..1 (can run over: bloom, fx)
//   accent  Uint8Array    ink code (accentCode): 0 none, 1/2 an accent ramp in
//                         full; a partial share rides in bits 2..5 (sixteenths)
//   layer   Uint8Array    which layer screen the pixel wears (index into `screens`;
//                         layer 0 reads the "outside" ramp, the rest the key ramp)
//   halo    Uint8Array    1 = a glow's halo: wears HALO_SCREEN whatever its layer
//   cyc     Uint8Array    1 = colour-cycles (water, glowing glass) on a slow wave

import { screenIndex } from "./dither.ts";
import type { LayerScreen } from "./dither.ts";
import { buildPalette } from "./palette.ts";
import type { Palette, PaletteSpec, RampSlot, RGB } from "./palette.ts";
import { TAU } from "./math.ts";

/** A full shade buffer (NOCTURNES' newBuf layout). */
export interface ShadeBuf {
  size: number;
  w: number;
  h: number;
  L: Float32Array;
  accent: Uint8Array;
  layer: Uint8Array;
  depth: Float32Array;
  glass: Uint8Array;
  pane: Uint8Array;
  halo: Uint8Array;
  cyc: Uint8Array;
}

/** The fields the quantizer reads. */
export type QuantizeInput = Pick<ShadeBuf, "L" | "accent" | "layer" | "halo" | "cyc">;

/** The four ramps quantize reads, every one present (rampsOf fills the missing ones in). */
export interface QuantizeRamps {
  key: RampSlot;
  accent: RampSlot;
  outside: RampSlot;
  accent2: RampSlot;
}

/** [x0, y0, x1, y1], inclusive. */
export type Region = readonly [number, number, number, number];

export interface QuantizerSpec {
  width: number;
  height: number;
  /** Layer screens, indexed by buf.layer. */
  screens: readonly LayerScreen[];
  ramps: QuantizeRamps;
  /** Each palette entry's lightness (lumsOf). */
  lums: Float32Array;
  /** The halo screen (default HALO_SCREEN). */
  halo?: LayerScreen;
}

/** quantize(buf, region, out, t) -> out: palette indices for the pixels in region. */
export type Quantize = (buf: QuantizeInput, region?: Region | null, out?: Uint8Array, t?: number) => Uint8Array;

/** A pixel's colour, as accentCode reads it: an accent ramp (1 or 2, or true) and the share of it. */
export interface AccentSample {
  accent?: number | boolean | undefined;
  share?: number | undefined;
}

export type LayerKey = "outside" | "room" | "subject" | "companion" | "fx";
/** NOCTURNES' layer order: screens[i] is the screen of layer i. */
export const LAYER_KEYS: readonly LayerKey[] = ["outside", "room", "subject", "companion", "fx"];
/** The screen a glow's halo wears: ordered, few steps -- light spreading reads as an even falloff. */
export const HALO_SCREEN: LayerScreen = { id: "bayer4", steps: 3, bias: 0 };

// A pixel's ink: 0 none, 1 or 2 an accent ramp in full; a partial share of a
// coloured light rides in the upper bits (sixteenths), and the quantizer
// orders it -- so a lamp's colour fades in over a wash instead of stopping
// at a line.
export const BAYER4Q: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export function accentCode(s: AccentSample): number {
  const ink = s.accent === 2 ? 2 : s.accent ? 1 : 0;
  if (!ink || s.share === undefined || s.share >= 0.97) return ink;
  return ink | (Math.max(1, Math.min(15, Math.round(s.share * 16))) << 2);
}

/** Each palette entry's lightness (OKLab L), for mixing two tones in light (screenIndex). */
export function lumsOf(colours: ReadonlyArray<Readonly<RGB> | null | undefined>): Float32Array {
  return Float32Array.from(colours, (c) => {
    if (!c) return 0;
    const lin = (v: number): number => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const R = lin(c[0]);
    const G = lin(c[1]);
    const B = lin(c[2]);
    return 0.2104542553 * Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B) + 0.793617785 * Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B) - 0.0040720468 * Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  });
}

/** The four ramps quantize reads, from a buildPalette result (missing ones fall back as NOCTURNES does). */
export function rampsOf(pal: Pick<Palette, "ramps">): QuantizeRamps {
  return { key: pal.ramps.key, accent: pal.ramps.accent, outside: pal.ramps.outside ?? pal.ramps.key, accent2: pal.ramps.accent2 ?? pal.ramps.accent };
}

/** An empty shade buffer (NOCTURNES' newBuf layout). */
export function makeBuf(width: number, height: number): ShadeBuf {
  const n = width * height;
  return { size: height, w: width, h: height, L: new Float32Array(n), accent: new Uint8Array(n), layer: new Uint8Array(n), depth: new Float32Array(n), glass: new Uint8Array(n), pane: new Uint8Array(n), halo: new Uint8Array(n), cyc: new Uint8Array(n) };
}

/**
 * A quantizer for one target: `quantize(buf, region, out, t)` writes palette
 * indices into `out` (a new Uint8Array(width*height) by default) for the
 * pixels in `region` ([x0,y0,x1,y1], default the whole frame) and returns it.
 * `t` is the loop time 0..1 (colour cycling).
 */
export function createQuantizer({ width, height, screens, ramps, lums, halo = HALO_SCREEN }: QuantizerSpec): Quantize {
  const n = width * height;
  const HALO = halo;
  return function quantize(buf, region = null, out = new Uint8Array(n), t = 0) {
    // Colour cycling: water, glowing glass and flames step their entries one
    // up or down the ramp on a slow wave that drifts across them, once a loop
    // (so the seam holds) -- the old way pixel art made them flow. (Turned
    // right round the ramp, the brightest came back as the darkest: a pulse.)
    const cycOf = (i: number, len: number, x: number, y: number): number => {
      const w = Math.sin(TAU * (t + x * 0.09 + y * 0.05));
      const j = i + (w > 0.5 ? 1 : w < -0.5 ? -1 : 0);
      return j < 0 ? 0 : j >= len ? len - 1 : j;
    };
    const [x0, y0, x1, y1] = region ?? [0, 0, width - 1, height - 1];
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const k = y * width + x;
        const raw = buf.L[k]!;
        // Toe: near-black stays black, so a coarse screen never peppers the dark.
        const L = raw < 0.035 ? 0 : ((raw - 0.035) / 0.965) ** 1.15;
        // A glow's halo wears an ordered screen with few steps, whatever the
        // surface under it wears: light spreading reads as a clean, even
        // falloff, not as the wall's pattern turned up.
        const layer = buf.layer[k]!;
        const screen = buf.halo[k] ? HALO : (screens[layer] as LayerScreen);
        const a = buf.accent[k]!;
        // (A partial share of a coloured light: ordered, so its ink fades in.)
        if ((a & 3) && L > 0.14 && (a < 4 || (a >> 2) / 16 > BAYER4Q[(y & 3) * 4 + (x & 3)]!)) {
          const ar = (a & 3) === 2 ? ramps.accent2 : ramps.accent;
          const i = screenIndex((L - 0.14) / 0.86, x, y, screen, ar.len, lums.subarray(ar.base, ar.base + ar.len));
          out[k] = ar.base + (buf.cyc[k] || (layer === 4 && a) ? cycOf(i, ar.len, x, y) : i);
        } else {
          const ramp = layer === 0 ? ramps.outside : ramps.key;
          const i = screenIndex(L, x, y, screen, ramp.len, lums.subarray(ramp.base, ramp.base + ramp.len));
          out[k] = ramp.base + (buf.cyc[k] ? cycOf(i, ramp.len, x, y) : i);
        }
      }
    }
    return out;
  };
}

/** Convenience: a quantizer straight from a palette SPEC and layer screens (as NOCTURNES' renderer builds one). */
export function quantizerFor(palette: PaletteSpec, screens: readonly LayerScreen[], width: number, height: number): { pal: Palette; quantize: Quantize } {
  const pal = buildPalette(palette);
  return { pal, quantize: createQuantizer({ width, height, screens, ramps: rampsOf(pal), lums: lumsOf(pal.colours) }) };
}
