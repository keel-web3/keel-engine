// A district's look: the catalogue's materials painted for one district --
// its neon hues in the four neon slots, its wall ramps a touch richer where
// it's wealthy and dirtier where it's run down, its windows lit to its share
// and warmth at night (dark glass by day) -- and the bloom each slot burns with.

import { drawsFor } from "@keel-engine/city";
import type { District } from "@keel-engine/city";
import { oklch } from "@keel-engine/core";
import type { PatternLook, RoleLook } from "@keel-engine/core";
import type { LayerPaint, SlotPaint } from "@keel-engine/bake";
import { SLOT, STREET_SLOT } from "./slots.ts";
import type { Catalogue, DistrictLook, MaterialSpec, StreetCatalogue, WindowType } from "./types.ts";

const WINDOW_TYPES: readonly WindowType[] = ["punched", "tall", "ribbon", "curtain", "arched", "boarded"];
const SLOTS = 32;
const NONE: PatternLook = { kind: "none", freq: 1, angle: 0, width: 4, shift: 0, ink: null };
/** Fifteenths (the paint's four-bit fields). */
const q15 = (v: number): number => Math.max(0, Math.min(15, Math.round(v * 15)));
const bucket = (v: number): number => Math.round(v * 2) / 2;

/** One of a district's looks (by variant): its kind's look spec, its hues turned by the variant. */
export function lookOf(cat: Catalogue, district: District, variant: number): DistrictLook {
  const specs = cat.looks[district.kind], spec = specs[((variant % specs.length) + specs.length) % specs.length]!;
  const n = district.hues.length, hues = district.hues.map((_, i) => district.hues[(i + variant) % n]!);
  const wealth = bucket(district.wealth), dirt = bucket(Math.min(1, spec.dirt + district.decay));
  return { key: `${cat.version}|${district.kind}|${variant % specs.length}|${hues.join(".")}|${wealth}|${dirt}`, kind: district.kind, hues, share: spec.share, warm: spec.warm, dirt, wealth };
}

/** Which of its district's looks a block wears. */
export function blockVariant(cat: Catalogue, seed: string, district: District, block: number): number {
  return Math.floor(drawsFor(seed, "looks").u("variant", block) * cat.looks[district.kind].length);
}

const role = (m: Pick<MaterialSpec, "hue" | "chroma" | "light" | "span" | "finish">, pattern: PatternLook = NONE): RoleLook => ({ hue: m.hue, chroma: m.chroma, light: m.light, span: m.span, finish: m.finish, pattern });

/** A lit window's colour: warm (tungsten, apartments) or cool (fluorescent, offices), the look's warmth bending it. */
const litInk = (warm: boolean, look: DistrictLook): RoleLook => warm
  ? role({ hue: 58 + 20 * look.warm, chroma: 0.11, light: 0.8, span: 0.25, finish: "glow" })
  : role({ hue: 205 - 30 * look.warm, chroma: 0.05, light: 0.84, span: 0.2, finish: "glow" });

/** A slot's paint in this look, and its bloom (rgb, strength). `hue`: a neon slot's district hue; `next`: the one after. */
function slotPaint(m: MaterialSpec, look: DistrictLook, night: boolean, hue: number | null, next: number | null): { paint: SlotPaint; bloom: [number, number, number, number] | null } {
  const lit = m.finish === "glow";
  const wall = !!m.windows;
  // (Walls: richer where it's rich, darker and greyer where it's dirty.)
  const base = { ...m, hue: hue ?? m.hue, chroma: wall ? m.chroma * (0.75 + 0.5 * look.wealth) * (1 - 0.4 * look.dirt) : m.chroma, light: wall ? m.light * (1 - 0.22 * look.dirt) : m.light };
  const glowOff = lit && !night ? { finish: "leather" as const, light: base.light * 0.55, chroma: base.chroma * 0.6 } : {};
  const mirror = m.mirror ? { mirror: m.mirror } : {};
  if (m.windows) {
    const w = m.windows;
    const pattern: PatternLook = { kind: "windows", freq: night ? q15(w.share * look.share) : 0, angle: WINDOW_TYPES.indexOf(w.type), width: q15(w.fill), shift: 0, ink: null };
    const ink = w.type === "boarded" ? role({ hue: 50, chroma: 0.05, light: 0.42, span: 0.25, finish: "matte" }) : litInk(w.warm, look);
    // (Its surface detail, if it has one: a dirty district's walls streak and blacken at the foot more.)
    const detail = m.detail ? { detail: { ...m.detail, grime: Math.min(1, (m.detail.grime ?? 0.4) + 0.45 * look.dirt) } } : {};
    return { paint: { look: role(base, pattern), ink, screen: m.screen ?? "bayer4", dither: m.dither ?? 0.9, ...mirror, ...detail }, bloom: null };
  }
  if (m.pattern) {
    // (A mural: its marks in the district's next hue.)
    const pattern: PatternLook = { kind: m.pattern.kind, freq: m.pattern.freq, angle: m.pattern.angle, width: m.pattern.width, shift: 0, ink: null };
    const ink = role({ hue: next ?? base.hue + 150, chroma: 0.16, light: 0.62, span: 0.25, finish: "matte" });
    return { paint: { look: role({ ...base, ...glowOff }, pattern), ink, screen: "bayer4", dither: 0.4 }, bloom: null };
  }
  const paint: SlotPaint = { look: role({ ...base, ...glowOff }), ink: null, screen: lit ? "none" : m.screen ?? "bayer4", dither: lit ? 0 : m.dither ?? 0.8, ...mirror };
  const bloom = lit && night && m.bloom ? oklch(Math.min(0.85, base.light + 0.05), base.chroma, base.hue) : null;
  return { paint, bloom: bloom ? [bloom[0] / 255, bloom[1] / 255, bloom[2] / 255, m.bloom!] : null };
}

/** One layer's paint (32 slots) and bloom: each named slot's material, neon slots taking the district's hues in turn. */
function layerPaint<K extends string>(materials: Readonly<Partial<Record<K, MaterialSpec>>>, slots: Readonly<Record<K, number>>, look: DistrictLook, night: boolean): { paint: LayerPaint; bloom: Float32Array } {
  const paint: (SlotPaint | null)[] = new Array<SlotPaint | null>(SLOTS).fill(null);
  const bloom = new Float32Array(SLOTS * 4);
  const n = look.hues.length;
  let ni = 0;
  for (const name of Object.keys(slots) as K[]) {
    const m = materials[name];
    if (!m) continue;
    const hue = m.neon && n ? look.hues[ni % n]! : null, next = n ? look.hues[(ni + 1) % n]! : null;
    if (m.neon) ni += 1;
    const p = slotPaint(m, look, night, hue, next);
    paint[slots[name]] = p.paint;
    if (p.bloom) bloom.set(p.bloom, slots[name] * 4);
  }
  return { paint, bloom };
}

/** A district look's paint for its buildings (32 slots) and bloom (per slot: r, g, b, strength), for day or night. */
export function districtPaint(cat: Catalogue, look: DistrictLook, night = true): { paint: LayerPaint; bloom: Float32Array } {
  return layerPaint(cat.materials, SLOT, look, night);
}

/** A district look's paint for its street layer: lamps, furniture, parks, murals, art. */
export function streetPaint(sc: StreetCatalogue, look: DistrictLook, night = true): { paint: LayerPaint; bloom: Float32Array } {
  return layerPaint(sc.materials, STREET_SLOT, look, night);
}
