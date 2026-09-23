// The KDCL decal doc (Hashers SPEC 9.1): what a registry contract validates and stores on-chain.
// Two kinds -- a four-ink pixel image, or styled text in the KEEL alphabet -- each carrying its
// own inks as quantised OKLCH, so a sponsor's brand colours ride with the decal.
//
//   bytes4 "KDCL" · u8 version 1 · u8 kind (0 image, 1 text) · u8 inks (1..4) · inks x {u8 L, u8 C, u8 H}
//   image: u8 w (1..96) · u8 h (1..64) · ceil(w*h/2) bytes of 4-bit texels (high nibble first; 0 empty, 1..inks)
//   text : u8 font (0 big, 1 small) · u8 style (bit0 plate, bit1 outline, bit2 shadow, bit3 slant) · u8 len · len glyphs

import { createPacker, createReader } from "@keel-engine/proof";
import { LINE_BREAK, toGlyphs } from "./alphabet.ts";

export const MAX_W = 96, MAX_H = 64, MAX_GLYPHS = 96, MAX_LINES = 4, MAX_LINE = 24;
export const STYLE = { plate: 1, outline: 2, shadow: 4, slant: 8 } as const;

/** OKLCH, the engine's colour: light 0..1, chroma 0..0.4, hue degrees. */
export interface Ink { readonly light: number; readonly chroma: number; readonly hue: number }

export type DecalDoc =
  | { readonly kind: "image"; readonly inks: readonly Ink[]; readonly width: number; readonly height: number; readonly texels: Uint8Array }
  | { readonly kind: "text"; readonly inks: readonly Ink[]; readonly font: 0 | 1; readonly style: number; readonly glyphs: readonly number[] };

const q = (v: number, max: number): number => Math.max(0, Math.min(255, Math.round((v / max) * 255)));
const inkBytes = (k: Ink): [number, number, number] => [q(k.light, 1), q(k.chroma, 0.4), q(((k.hue % 360) + 360) % 360, 360)];
const inkOf = (l: number, c: number, h: number): Ink => ({ light: l / 255, chroma: (c * 0.4) / 255, hue: (h * 360) / 255 });

/** Why a doc is invalid, or null -- the same rules the contract enforces. */
export function checkDoc(d: DecalDoc): string | null {
  if (d.inks.length < 1 || d.inks.length > 4) return "1..4 inks";
  if (d.kind === "image") {
    if (d.width < 1 || d.width > MAX_W || d.height < 1 || d.height > MAX_H) return `an image is 1..${MAX_W} x 1..${MAX_H}`;
    if (d.texels.length !== d.width * d.height) return "one texel per pixel";
    if (d.texels.some((t) => t > d.inks.length)) return "a texel names an ink the decal doesn't have";
    return null;
  }
  if (d.font !== 0 && d.font !== 1) return "font 0 or 1";
  if (d.style < 0 || d.style > 15) return "style bits 0..15";
  if (d.glyphs.length < 1 || d.glyphs.length > MAX_GLYPHS) return `1..${MAX_GLYPHS} glyphs`;
  if (d.glyphs.some((g) => !Number.isInteger(g) || g < 0 || g > 63)) return "glyphs are 0..63";
  const lines = splitLines(d.glyphs);
  if (lines.length > MAX_LINES) return `at most ${MAX_LINES} lines`;
  if (lines.some((l) => l.length > MAX_LINE)) return `at most ${MAX_LINE} glyphs a line`;
  return null;
}

export function splitLines(glyphs: readonly number[]): number[][] {
  const lines: number[][] = [[]];
  for (const g of glyphs) if (g === LINE_BREAK) lines.push([]); else lines[lines.length - 1]!.push(g);
  return lines;
}

export function encodeDecal(d: DecalDoc): Uint8Array {
  const bad = checkDoc(d);
  if (bad) throw new RangeError(`invalid decal: ${bad}`);
  const p = createPacker().bytes4("KDCL").u8(1).u8(d.kind === "image" ? 0 : 1).u8(d.inks.length);
  for (const k of d.inks) { const [l, c, h] = inkBytes(k); p.u8(l).u8(c).u8(h); }
  if (d.kind === "image") {
    p.u8(d.width).u8(d.height);
    for (let i = 0; i < d.texels.length; i += 2) p.u8((d.texels[i]! << 4) | (d.texels[i + 1] ?? 0));
  } else {
    p.u8(d.font).u8(d.style).u8(d.glyphs.length);
    for (const g of d.glyphs) p.u8(g);
  }
  return p.finish();
}

export function decodeDecal(b: Uint8Array): DecalDoc {
  const r = createReader(b);
  r.magic("KDCL");
  if (r.u8() !== 1) throw new RangeError("unknown decal version");
  const kind = r.u8();
  const n = r.u8();
  if (n < 1 || n > 4) throw new RangeError("1..4 inks");
  const inks = Array.from({ length: n }, () => inkOf(r.u8(), r.u8(), r.u8()));
  let d: DecalDoc;
  if (kind === 0) {
    const width = r.u8(), height = r.u8();
    const texels = new Uint8Array(width * height);
    const packed = r.raw(Math.ceil((width * height) / 2));
    for (let i = 0; i < texels.length; i += 1) texels[i] = i % 2 === 0 ? packed[i >> 1]! >> 4 : packed[i >> 1]! & 15;
    if (texels.length % 2 === 1 && (packed[packed.length - 1]! & 15) !== 0) throw new RangeError("the pad nibble must be zero");
    d = { kind: "image", inks, width, height, texels };
  } else if (kind === 1) {
    const font = r.u8(), style = r.u8(), len = r.u8();
    d = { kind: "text", inks, font: font as 0 | 1, style, glyphs: Array.from(r.raw(len)) };
  } else throw new RangeError("unknown decal kind");
  r.end();
  const bad = checkDoc(d);
  if (bad) throw new RangeError(`invalid decal: ${bad}`);
  return d;
}

/** A text decal from typed text: converted into the KEEL alphabet (see `dropped` for what didn't make it). */
export function textDecal(text: string, { inks, font = 0, style = 0 }: { inks: readonly Ink[]; font?: 0 | 1; style?: number }): { doc: DecalDoc; bytes: Uint8Array; text: string; dropped: string[] } {
  const c = toGlyphs(text);
  const doc: DecalDoc = { kind: "text", inks, font, style, glyphs: c.glyphs };
  return { doc, bytes: encodeDecal(doc), text: c.text, dropped: c.dropped };
}
