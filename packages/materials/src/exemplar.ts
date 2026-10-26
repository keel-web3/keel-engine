// A material exemplar: an exact sheet distilled to what it is made of. Each
// family is a small stack of layers at art resolution (its colour with the
// light divided out, its light, any overlay or mask), how they composite, the
// recipe that recombines them from a seed, and the pixel-art finish that
// makes the composite read as pixel art (a palette, an ordered dither, clean
// clusters). Small enough to ship onchain, and readable: a JSON header, then
// each layer's packed bytes.
//
//   "KMX2" | u32 header length | header JSON (UTF-8) | each layer's body, in
//   order: a palette layer's indices (two to a byte at 16 colours or fewer,
//   else one), a scalar layer's bytes (one per sample).

import type { MaterialFamily } from "./atlas.ts";

/**
 * A layer's pixels. A palette layer holds colours, alpha included (an
 * overlay's transparent parts, a sprite's holes). A scalar layer holds one
 * value per sample, 0..255, every `scale` art pixels (light is smooth, so it
 * keeps a sample every few pixels and is read back bilinearly).
 */
export type ExemplarLayer =
  | { readonly name: string; readonly kind: "palette"; readonly palette: Uint8Array; readonly indices: Uint8Array }
  | { readonly name: string; readonly kind: "scalar"; readonly scale: number; readonly values: Uint8Array };

/**
 * How a layer joins the picture, bottom first. base: its colour. multiply: a
 * scalar times the colour, 128 = x1 (shade and light), or a palette layer's
 * colour times it. screen and add: brightens (highlights, glow). over: alpha
 * over (overlays). strength scales the effect, 0..1 (default 1).
 */
export interface Composite {
  readonly layer: string;
  readonly blend: "base" | "multiply" | "screen" | "add" | "over";
  readonly strength?: number;
}

/**
 * One step of a recipe, applied in order to every generated block. Moves take
 * `layers`, the layers they move (default: every layer, so colour and light
 * move together); leave the light out and it stays where it was while the
 * colour beneath it changes.
 *  - strips: rebuilds each column of cells from plates cut at their gap rows
 *    (bark), moving a plate at most `band` cell rows.
 *  - cells: draws each cell from cells at most `band` rows away (omit for any).
 *  - quilt: joins a `share` of cells to a second cell along their darkest
 *    vertical seam (textures without rims; a seam through a whole object shows).
 *  - lean: moves a `share` of cells to the palette's other hue.
 *  - paint: replaces a `share` of cells in one layer with a procedural painter's
 *    field: in a palette layer by rank through its colours, in a scalar layer
 *    (relighting) fitted to that cell's own light range.
 */
export type MaterialLayer =
  | { readonly layer: "strips"; readonly band?: number; readonly layers?: readonly string[] }
  | { readonly layer: "cells"; readonly band?: number; readonly layers?: readonly string[] }
  | { readonly layer: "quilt"; readonly share: number; readonly layers?: readonly string[] }
  | { readonly layer: "lean"; readonly share: number; readonly target?: string }
  | { readonly layer: "paint"; readonly painter: MaterialFamily; readonly share: number; readonly target?: string };

/** The ordered-dither screens, as keel/voxel-dither names them. */
export const DITHER_SCREENS = ["none", "bayer2", "bayer4", "bayer8"] as const;
export type DitherScreen = (typeof DITHER_SCREENS)[number];

/**
 * The pixel-art finish. Every pixel ends as one of `palette` (RGBA, darkest
 * first); between two of its colours, the screen's threshold map picks which,
 * with `amount` (0..1) of the gap between neighbouring colours as spread; and
 * `clean` gives a lone pixel its neighbours' colour.
 */
export interface Finish {
  readonly palette: Uint8Array;
  readonly dither: DitherScreen;
  readonly amount: number;
  readonly clean: boolean;
}

export interface ExemplarFamily {
  readonly name: string;
  readonly layers: readonly ExemplarLayer[];
  readonly compose: readonly Composite[];
  readonly recipe: readonly MaterialLayer[];
  readonly finish?: Finish;
}

export interface MaterialExemplar {
  /** Art pixels per cell side. */
  readonly pixels: number;
  /** Cells per block side. */
  readonly columns: number;
  /** Family blocks per sheet row. */
  readonly blocks: number;
  readonly families: readonly ExemplarFamily[];
}

const MAGIC = [0x4b, 0x4d, 0x58, 0x32];
const PAINTERS = new Set(["bark", "foliage", "autumn", "blossom", "snow"]);
const BLENDS = new Set(["base", "multiply", "screen", "add", "over"]);
const NAME = /^[a-z][a-z0-9-]{0,31}$/u;

const share = (v: unknown): boolean => typeof v === "number" && v >= 0 && v <= 1;
const band = (v: unknown): boolean => v === undefined || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 64);
const names = (v: unknown): boolean => v === undefined || (Array.isArray(v) && v.every((n) => typeof n === "string" && NAME.test(n)));
const target = (v: unknown): boolean => v === undefined || (typeof v === "string" && NAME.test(v));

export function checkLayer(layer: MaterialLayer): MaterialLayer {
  const ok =
    ((layer.layer === "strips" || layer.layer === "cells") && band(layer.band) && names(layer.layers)) ||
    (layer.layer === "quilt" && share(layer.share) && names(layer.layers)) ||
    (layer.layer === "lean" && share(layer.share) && target(layer.target)) ||
    (layer.layer === "paint" && share(layer.share) && PAINTERS.has(layer.painter) && target(layer.target));
  if (!ok) throw new TypeError(`Invalid material recipe step ${JSON.stringify(layer)}.`);
  return layer;
}

/** A scalar layer's samples per side. */
export const samplesPerSide = (side: number, scale: number): number => Math.ceil(side / scale) + 1;

export function checkExemplar(exemplar: MaterialExemplar): MaterialExemplar {
  const { pixels, columns, blocks, families } = exemplar;
  if (!Number.isInteger(pixels) || pixels < 4 || pixels > 64) throw new RangeError("An exemplar cell is 4..64 art pixels a side.");
  if (!Number.isInteger(columns) || columns < 1 || columns > 16) throw new RangeError("An exemplar block is 1..16 cells a side.");
  if (!Number.isInteger(blocks) || blocks < 1 || blocks > 8) throw new RangeError("An exemplar sheet is 1..8 blocks wide.");
  if (families.length < 1 || families.length > 64) throw new RangeError("An exemplar has 1..64 families.");
  const side = pixels * columns;
  const familyNames = new Set<string>();
  for (const f of families) {
    if (!NAME.test(f.name) || familyNames.has(f.name)) throw new TypeError(`Exemplar family names are unique lowercase slugs, not ${f.name}.`);
    familyNames.add(f.name);
    const layerNames = new Set<string>();
    for (const l of f.layers) {
      if (!NAME.test(l.name) || layerNames.has(l.name)) throw new TypeError(`The ${f.name} layers need unique lowercase names, not ${l.name}.`);
      layerNames.add(l.name);
      if (l.kind === "palette") {
        const colours = l.palette.length / 4;
        if (!Number.isInteger(colours) || colours < 1 || colours > 256) throw new RangeError(`The ${f.name} ${l.name} palette has 1..256 RGBA colours.`);
        if (l.indices.length !== side * side) throw new RangeError(`The ${f.name} ${l.name} layer is ${String(side)} x ${String(side)} indices.`);
        for (const i of l.indices) if (i >= colours) throw new RangeError(`The ${f.name} ${l.name} layer names a colour its palette lacks.`);
      } else if (l.kind === "scalar") {
        if (!Number.isInteger(l.scale) || l.scale < 1 || l.scale > side) throw new RangeError(`The ${f.name} ${l.name} scale is 1..${String(side)} art pixels.`);
        if (l.values.length !== samplesPerSide(side, l.scale) ** 2) throw new RangeError(`The ${f.name} ${l.name} layer has ${String(samplesPerSide(side, l.scale))}^2 samples.`);
      } else throw new TypeError(`Unknown layer kind in ${f.name}.`);
    }
    if (f.compose.length === 0 || f.compose[0]!.blend !== "base") throw new TypeError(`The ${f.name} composite starts with a base layer.`);
    for (const c of f.compose) {
      if (!layerNames.has(c.layer) || !BLENDS.has(c.blend) || (c.strength !== undefined && !share(c.strength))) throw new TypeError(`Invalid ${f.name} composite step ${JSON.stringify(c)}.`);
    }
    for (const step of f.recipe) {
      checkLayer(step);
      const named = "layers" in step && step.layers !== undefined ? step.layers : "target" in step && step.target !== undefined ? [step.target] : [];
      for (const n of named) if (!layerNames.has(n)) throw new TypeError(`The ${f.name} recipe names a layer it lacks: ${n}.`);
    }
    if (f.finish !== undefined) {
      const { palette, dither, amount, clean } = f.finish;
      if (palette.length % 4 !== 0 || palette.length < 8 || palette.length > 1024) throw new RangeError(`The ${f.name} finish palette has 2..256 RGBA colours.`);
      if (!DITHER_SCREENS.includes(dither) || !share(amount) || typeof clean !== "boolean") throw new TypeError(`Invalid ${f.name} finish.`);
    }
  }
  return exemplar;
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (text: unknown): Uint8Array => {
  if (typeof text !== "string" || !/^(?:[0-9a-f]{8})+$/u.test(text)) throw new TypeError("An exemplar palette is lowercase rrggbbaa colours.");
  return Uint8Array.from(text.match(/../gu)!, (b) => Number.parseInt(b, 16));
};

export function encodeMaterialExemplar(exemplar: MaterialExemplar): Uint8Array {
  checkExemplar(exemplar);
  const bodies: Uint8Array[] = [];
  const header = new TextEncoder().encode(JSON.stringify({
    pixels: exemplar.pixels,
    columns: exemplar.columns,
    blocks: exemplar.blocks,
    families: exemplar.families.map((f) => ({
      name: f.name,
      layers: f.layers.map((l) => {
        if (l.kind === "scalar") { bodies.push(l.values); return { name: l.name, kind: l.kind, scale: l.scale }; }
        if (l.palette.length / 4 > 16) bodies.push(l.indices);
        else {
          const packed = new Uint8Array(Math.ceil(l.indices.length / 2));
          for (let i = 0; i < l.indices.length; i += 1) packed[i >> 1]! |= i % 2 === 0 ? l.indices[i]! << 4 : l.indices[i]!;
          bodies.push(packed);
        }
        return { name: l.name, kind: l.kind, palette: hex(l.palette) };
      }),
      compose: f.compose,
      recipe: f.recipe,
      ...(f.finish === undefined ? {} : { finish: { ...f.finish, palette: hex(f.finish.palette) } }),
    })),
  }));
  const out = new Uint8Array(8 + header.length + bodies.reduce((s, b) => s + b.length, 0));
  out.set(MAGIC);
  new DataView(out.buffer).setUint32(4, header.length);
  out.set(header, 8);
  let at = 8 + header.length;
  for (const body of bodies) { out.set(body, at); at += body.length; }
  return out;
}

interface HeaderLayer { name: string; kind: string; palette?: string; scale?: number }
interface HeaderFamily { name: string; layers: HeaderLayer[]; compose: Composite[]; recipe: MaterialLayer[]; finish?: Omit<Finish, "palette"> & { palette: string } }

export function decodeMaterialExemplar(bytes: Uint8Array): MaterialExemplar {
  if (bytes.length < 8 || MAGIC.some((b, i) => bytes[i] !== b)) throw new TypeError("Not a KEEL material exemplar (KMX2).");
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4);
  if (8 + length > bytes.length) throw new RangeError("The exemplar header runs past its bytes.");
  const header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(8, 8 + length))) as { pixels: number; columns: number; blocks: number; families: HeaderFamily[] };
  if (!Array.isArray(header.families)) throw new TypeError("An exemplar header lists its families.");
  const side = header.pixels * header.columns;
  let at = 8 + length;
  const take = (size: number, what: string): Uint8Array => {
    if (at + size > bytes.length) throw new RangeError(`${what} runs past the exemplar's bytes.`);
    const body = bytes.subarray(at, at + size);
    at += size;
    return body;
  };
  const families = header.families.map((f): ExemplarFamily => ({
    name: f.name,
    layers: (Array.isArray(f.layers) ? f.layers : []).map((l): ExemplarLayer => {
      if (l.kind === "scalar") {
        const scale = Number(l.scale);
        return { name: l.name, kind: "scalar", scale, values: take(samplesPerSide(side, scale) ** 2, `The ${f.name} ${l.name} layer`).slice() };
      }
      if (l.kind !== "palette") throw new TypeError(`Unknown layer kind ${String(l.kind)}.`);
      const palette = unhex(l.palette);
      if (palette.length / 4 > 16) return { name: l.name, kind: "palette", palette, indices: take(side * side, `The ${f.name} ${l.name} layer`).slice() };
      const body = take(Math.ceil((side * side) / 2), `The ${f.name} ${l.name} layer`);
      return { name: l.name, kind: "palette", palette, indices: Uint8Array.from({ length: side * side }, (_, i) => (i % 2 === 0 ? body[i >> 1]! >> 4 : body[i >> 1]! & 15)) };
    }),
    compose: Array.isArray(f.compose) ? f.compose : [],
    recipe: Array.isArray(f.recipe) ? f.recipe : [],
    ...(f.finish === undefined ? {} : { finish: { palette: unhex(f.finish.palette), dither: f.finish.dither, amount: f.finish.amount, clean: f.finish.clean } }),
  }));
  if (at !== bytes.length) throw new RangeError("The exemplar has bytes past its last layer.");
  return checkExemplar({ pixels: header.pixels, columns: header.columns, blocks: header.blocks, families });
}
