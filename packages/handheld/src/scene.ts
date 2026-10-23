// A handheld on the studio renderer: its parts uploaded once per detail level, its prints drawn and baked (normals,
// occlusion), its AO baked per vertex, and -- for the grid -- the inside of a clear shell baked into an impostor.
// A look (a shell colour and finish) is only materials: thirteen handhelds share one kit.

import {
  type DrawItem, type GpuMesh, type Impostor, type Ink, type Mat4, type Material, type Rgb, type StudioRenderer, type StudioTexture,
  compose, identity, multiply, scaling, translation,
} from "@keel-engine/studio";
import { type Part, type Role, buildParts, insides } from "./parts.ts";
import { type CartArt, type CartKind, type SurfaceFactory, backHeight, boardMasks, cartFace, cartKindOf, faceHeight, faceMasks, glassPrint } from "./prints.ts";
import { type KeyState, keyTransform } from "./keys.ts";
import { type Detail, MM, SEGMENTS, UNIT } from "./spec.ts";

/** A shell's look: colours as CSS hex, and what it is made of. */
export interface Look {
  readonly id: string;
  readonly material: "metal" | "clear";
  readonly shell: string;
  readonly buttons: string;
  readonly dpad: string;
  /** The wordmark, bars, big stripe and labels. */
  readonly accent: string;
  /** The small stripe. */
  readonly accentLight: string;
  /** Start / select rubber (default a soft charcoal). */
  readonly pills?: string;
  /** The cart in its back slot (default by material: clear gets smoke, metal black; see cartKindOf). */
  readonly cart?: CartKind;
}

export const hexRgb = (hex: string): Rgb => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export interface KitOptions {
  readonly detail: Detail;
  readonly font?: string;
  readonly surface?: SurfaceFactory;
  /** Print density, pixels per millimetre (default: solo 13.5, grid 7). */
  readonly density?: number;
  /** AO bake directions (default 80; 0 skips the bake). */
  readonly aoDirections?: number;
}

interface Uploaded { readonly part: Part; readonly gpu: GpuMesh }

export interface HandheldKit {
  readonly detail: Detail;
  readonly renderer: StudioRenderer;
  readonly metal: readonly Uploaded[];
  readonly clear: readonly Uploaded[];
  readonly screenRect: readonly [number, number, number, number];
  readonly tex: {
    readonly masksMetal: StudioTexture;
    readonly masksClear: StudioTexture;
    readonly faceNormal: StudioTexture;
    readonly backNormal: StudioTexture;
    readonly glass: StudioTexture;
    readonly board: StudioTexture | null;
  };
  readonly impostor: Impostor | null;
  /** Milliseconds each stage took to prepare (geometry, prints, bakes). */
  readonly timings: Readonly<Record<string, number>>;
  readonly materials: Map<string, Map<Role, Material>>;
  readonly options: KitOptions;
}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function createHandheldKit(r: StudioRenderer, o: KitOptions): HandheldKit {
  const timings: Record<string, number> = {};
  let t = now();
  const lap = (name: string) => { const n = now(); timings[name] = Math.round((n - t) * 10) / 10; t = n; };
  const metalParts = buildParts(o.detail, true), clearParts = buildParts(o.detail, false);
  lap("geometry");
  const density = o.density ?? (o.detail === "solo" ? 13.5 : 7);
  const P = { density, ...(o.font ? { font: o.font } : {}), ...(o.surface ? { surface: o.surface } : {}) };
  const masksMetal = r.texture(faceMasks({ ...P, stripes: true }).canvas, { anisotropy: 8 });
  const masksClear = r.texture(faceMasks({ ...P, stripes: false }).canvas, { anisotropy: 8 });
  const heightTex = r.texture(faceHeight(P).canvas, { filter: "linear" });
  const faceNormal = r.bakeHeight(heightTex, { depth: 1.6 * density, aoRadius: 0.9 * density, aoStrength: 1.3 });
  const backTex = r.texture(backHeight(P).canvas, { filter: "linear" });
  const backNormal = r.bakeHeight(backTex, { depth: 0.9 * density, aoRadius: 0.5 * density, aoStrength: 1.0 });
  const glass = r.texture(glassPrint({ ...P, density: density * 1.25 }).canvas, { anisotropy: 8 });
  const board = r.texture(boardMasks({ ...P, density: Math.max(8, density) }).canvas, { anisotropy: 8 });
  lap("prints");
  const up = (ps: readonly Part[]): Uploaded[] => ps.map((part) => ({ part, gpu: r.upload(part.mesh) }));
  const metal = up(metalParts.parts), clear = up(clearParts.parts);
  lap("upload");
  const dirs = o.aoDirections ?? 80;
  if (dirs > 0) {
    for (const set of [metal, clear]) {
      const outside = set.filter((u) => !u.part.inside), inside = set.filter((u) => u.part.inside);
      bakeGroup(r, outside, outside, dirs);
      if (inside.length) bakeGroup(r, inside, [...inside, ...set.filter((u) => u.part.role === "cart")], dirs);
    }
  }
  lap("ao");
  const kit: HandheldKit = {
    detail: o.detail, renderer: r, metal, clear, screenRect: metalParts.screenRect,
    tex: { masksMetal, masksClear, faceNormal, backNormal, glass, board }, impostor: null, timings, materials: new Map(), options: o,
  };
  if (o.detail === "grid") {
    // Only the front uses this baked height field. Rear shells look through to
    // the actual low-detail AA tray, rather than repeating the front PCB.
    const parts = insides(SEGMENTS.grid.round);
    const ups = parts.map((part) => ({ part, gpu: r.upload(part.mesh) }));
    if (dirs > 0) bakeGroup(r, ups, ups, Math.min(dirs, 48));
    const mats = roleMaterials(kit, { id: "impostor", material: "clear", shell: "#888888", buttons: "#333333", dpad: "#333333", accent: "#ffffff", accentLight: "#ffffff" }, null, null);
    const items: DrawItem[] = ups.map((u) => ({ mesh: u.gpu, model: identity(), material: mats.get(u.part.role)! }));
    const imp = r.bakeImpostor(items, { rect: [-MM.w / 2, -MM.h / 2, MM.w / 2, MM.h / 2], z: [-1.2, -28.6], behind: [0.09, 0.09, 0.1], size: [384, 666] });
    for (const u of ups) r.release(u.gpu);
    (kit as { impostor: Impostor | null }).impostor = imp;
    lap("impostor");
  }
  return kit;
}

/** Ambient visibility for each receiver against the occluders (all at rest, plan mm). */
function bakeGroup(r: StudioRenderer, receivers: readonly Uploaded[], occluders: readonly Uploaded[], dirs: number): void {
  const occ = occluders.map((u) => ({ mesh: u.gpu, model: identity() }));
  for (const u of receivers) {
    const ao = r.bakeAO(u.gpu, identity(), occ, { directions: dirs, size: 768 });
    // Soften: sky visibility is harsh where a shell meets a key; keep 70% of it.
    for (let i = 0; i < ao.length; i += 1) ao[i] = 0.3 + 0.7 * ao[i]!;
    r.setAO(u.gpu, ao);
  }
}

/** A cartridge face for a token (its own art). */
export function cartTexture(kit: HandheldKit, art: CartArt): StudioTexture {
  const o = kit.options;
  return kit.renderer.texture(cartFace({ density: o.detail === "solo" ? 12 : 6, art, ...(o.font ? { font: o.font } : {}), ...(o.surface ? { surface: o.surface } : {}) }).canvas, { anisotropy: 8 });
}

const ink = (hex: string, rough: number, metal = 0): Ink => ({ colour: hexRgb(hex), rough, metal });

/** The materials for each role of a look. Cached per look; the screen and cart textures are per handheld. */
export function roleMaterials(kit: HandheldKit, look: Look, screen: StudioTexture | null, cart: StudioTexture | null): Map<Role, Material> {
  const cartKind = look.cart ?? cartKindOf(look.material);
  const key = `${look.id}|${look.material}|${look.shell}|${look.accent}|${cartKind}`;
  let base = kit.materials.get(key);
  if (!base) {
    base = new Map<Role, Material>();
    const shell = hexRgb(look.shell), metal = look.material === "metal";
    const inks: [Ink, Ink, Ink] = [ink(look.accent, 0.42), ink(look.accentLight, 0.42), ink(look.accent, 0.48)];
    if (metal) {
      // Thixomolded magnesium, coloured and bead-blasted; the front edge diamond-cut bright.
      const m = { kind: "standard" as const, base: shell, metal: 0.55, rough: 0.38, grain: [5.5, 1] as const, edge: [0.1, 0.22, -1.4] as const };
      base.set("shellFront", { ...m, masks: kit.tex.masksMetal, inks, normalMap: kit.tex.faceNormal, normalScale: 1 });
      base.set("shellBack", { ...m, normalMap: kit.tex.backNormal });
      base.set("hump", { ...m, normalMap: kit.tex.backNormal });
      base.set("screw", { kind: "standard", base: shell.map((v) => v * 0.85) as unknown as Rgb, metal: 1, rough: 0.3 });
    } else {
      const tint: Rgb = shell;
      const c = { kind: "clear" as const, tint, thickness: 0.9, rough: 0.05, refract: 0.018, haze: 0.35 };
      base.set("shellFront", { ...c, masks: kit.tex.masksClear, inks: [ink("#f2f2f4", 0.4), ink("#f2f2f4", 0.4), ink("#f2f2f4", 0.45)], normalMap: kit.tex.faceNormal, ...(kit.impostor ? { impostor: kit.impostor } : {}) });
      base.set("shellBack", { ...c, normalMap: kit.tex.backNormal });
      base.set("hump", { ...c, normalMap: kit.tex.backNormal });
      base.set("screw", { kind: "standard", base: [0.72, 0.72, 0.74], metal: 1, rough: 0.28 });
    }
    // PBT keys: satin; the d-pad matte; start and select soft rubber.
    base.set("dpad", { kind: "standard", base: hexRgb(look.dpad), metal: 0, rough: 0.52, aoFloor: 0.4 });
    base.set("a", { kind: "standard", base: hexRgb(look.buttons), metal: 0, rough: metal ? 0.34 : 0.22, aoFloor: 0.4 });
    base.set("b", base.get("a")!);
    base.set("select", { kind: "standard", base: hexRgb(look.pills ?? "#2a2a2e"), metal: 0, rough: 0.78, aoFloor: 0.4 });
    base.set("start", base.get("select")!);
    base.set("trimDark", { kind: "standard", base: [0.06, 0.06, 0.07], metal: 0, rough: 0.45 });
    base.set("power",base.get("trimDark")!);
    base.set("trimMetal", { kind: "standard", base: [0.8, 0.8, 0.82], metal: 1, rough: 0.22 });
    base.set("connectorCore",{kind:"standard",base:[.22,.23,.25],metal:0,rough:.58});
    base.set("hole", { kind: "standard", base: [0.012, 0.012, 0.014], metal: 0, rough: 0.9, aoFloor: 0.05 });
    // The cart: matte black, or smoke -- dark, glossy, see-through plastic.
    base.set("cart", cartKind === "smoke" ? { kind: "standard", base: [0.05, 0.052, 0.062], metal: 0, rough: 0.16 } : { kind: "standard", base: [0.028, 0.029, 0.036], metal: 0, rough: 0.66 });
    // Inside parts.
    base.set("board", { kind: "standard", base: [0.025, 0.027, 0.03], metal: 0, rough: 0.28, ...(kit.tex.board ? { masks: kit.tex.board } : {}), inks: [ink("#2b2f35", 0.3), ink("#d9ad55", 0.22, 1), ink("#e6e6e2", 0.55)] });
    base.set("chip", { kind: "standard", base: [0.05, 0.05, 0.055], metal: 0, rough: 0.5 });
    base.set("ceramic", { kind: "standard", base: hexRgb("#a8916a"), metal: 0, rough: 0.5 });
    base.set("silver", { kind: "standard", base: [0.82, 0.82, 0.84], metal: 1, rough: 0.26 });
    base.set("gold", { kind: "standard", base: hexRgb("#e2b45c"), metal: 1, rough: 0.22 });
    base.set("brass", { kind: "standard", base: hexRgb("#c8a04c"), metal: 1, rough: 0.3 });
    base.set("flex", { kind: "standard", base: hexRgb("#c27b1e"), metal: 0, rough: 0.25 });
    base.set("battery", { kind: "standard", base: hexRgb("#b9b9b0"), metal: 0.2, rough: 0.36 });
    base.set("batteryBand", { kind: "standard", base: hexRgb("#292735"), metal: 0.2, rough: 0.34 });
    base.set("batteryContact", { kind: "standard", base: [0.8,0.81,0.83], metal: 1, rough: 0.24 });
    base.set("tray", { kind: "standard", base: hexRgb("#8d8d93"), metal: 0, rough: 0.6 });
    base.set("lcd", { kind: "standard", base: hexRgb("#4f5157"), metal: 0.9, rough: 0.35 });
    kit.materials.set(key, base);
  }
  const out = new Map(base);
  out.set("glass", { kind: "glass", print: kit.tex.glass, screen, screenRect: kit.screenRect, screenGain: 1.2, rough: 0.03 });
  out.set("cartLabel", { kind: "standard", base: [0.15, 0.15, 0.17], metal: 0, rough: cartKind === "smoke" ? 0.2 : 0.58, ...(cart ? { map: cart } : {}) });
  return out;
}

export interface HandheldState {
  /** Where the handheld stands (scene units; applied after the mm-to-unit scale). */
  readonly model: Mat4;
  readonly keys: KeyState;
  readonly screen: StudioTexture | null;
  readonly cart: StudioTexture | null;
  /** Defaults to ON; the physical slide follows the screen power state. */
  readonly powerOn?: boolean;
}

export interface HandheldDraw {
  readonly items: DrawItem[];
  readonly casters: DrawItem[];
  readonly bloom: DrawItem[];
}

/** The draw items for one handheld in one look and state. */
export function handheldDraw(kit: HandheldKit, look: Look, s: HandheldState): HandheldDraw {
  const mats = roleMaterials(kit, look, s.screen, s.cart);
  const base = multiply(s.model, scaling(UNIT, UNIT, UNIT));
  const set = look.material === "metal" ? kit.metal : kit.clear;
  const items: DrawItem[] = [], casters: DrawItem[] = [], bloom: DrawItem[] = [];
  for (const u of set) {
    const material = mats.get(u.part.role);
    if (!material) continue;
    const model = u.part.key ? compose(base, keyTransform(u.part.key, s.keys)) : u.part.role === "power" ? compose(base,translation(s.powerOn===false?-2.1:2.1,0,0)) : base;
    const it: DrawItem = { mesh: u.gpu, model, material };
    items.push(it);
    if (!u.part.inside && (u.part.role === "shellFront" || u.part.role === "shellBack" || u.part.role === "hump")) casters.push(it);
    if (u.part.role === "glass") bloom.push(it);
  }
  return { items, casters, bloom };
}

/** The handheld's size in scene units: width, height, depth (front face at z 0). */
export const SIZE = { w: MM.w * UNIT, h: MM.h * UNIT, front: 2.4 * UNIT, back: -MM.hump.z1 * UNIT } as const;
