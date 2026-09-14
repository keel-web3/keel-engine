// The STYLE contract: one design, drawn any way. A style turns a design
// (design.ts: solids with roles, colliders, sockets) into parts with roles --
//
//   interface ObjectStyle {
//     name: "pixel" | "voxel" | "<yours>";
//     contract: "style/<name>@1.0.0";
//     fallback?: "<another style>";                     (tried when this one isn't available)
//     build(design, params) -> { parts, stats?, model? } | null
//                                   (parts: box / wedge / capsule part-likes, each with its role; null: declined)
//   }
//
// -- and every style's parts go through the same defineObject, with the
// DESIGN's colliders and sockets: a style changes how a thing looks, never how
// it plays. Two come with the engine: `pixel` (this package: the renderer's own
// solids; always there) and `voxel` (@keel-engine/builder: a VoxelModel
// rasterised from the same solids, greedy-merged into boxes). Any module adds
// its own by providing the contract `style/<name>@1.0.0` in its manifest and
// registering the style (`registerStyle`, or its own registry) when it loads.
//
// Which style a thing is drawn in is the caller's pick, and a LOCKABLE
// setting: `styleSetting("voxel", { locked: true })` makes a whole world voxel
// whatever each placement asks for. What happens when the pick can't be drawn
// (resolveStyle, the fallback chain):
//
//   1. wanted = the setting's style if it is locked, else the placement's
//      request, else the setting's style, else the asset's default, else "pixel";
//   2. the asset's own builder for that style, else the registry's style;
//   3. not there (a module not loaded, a name nobody provides) or it declines
//      the design (build returns null): the style's declared `fallback`, then
//      the asset's `fallback`, then "pixel" -- which is always there and draws
//      everything. The built thing says it fell back, and why.

import type { Design } from "./design.ts";
import { pixelStyle } from "./pixel.ts";
import type { WedgePartLike } from "./wedge.ts";
import type { PartLike } from "@keel-engine/scene";

/** A part a style makes: a box, wedge or capsule part-like with its role (its `mat` is the role too). */
export type StyledPart = (PartLike | WedgePartLike) & {
  readonly name: string;
  readonly role: string;
  readonly mat: string;
  readonly group?: string | null | undefined;
};

/** What a style hands back: parts, and whatever it wants to report (counts), and its own model (a VoxelModel). */
export interface StyledParts {
  readonly parts: readonly StyledPart[];
  readonly stats?: Readonly<Record<string, number>> | undefined;
  /** The style's own intermediate (the voxel style's VoxelModel: open it in the builder). */
  readonly model?: unknown;
}

/** A style's knobs: `detail` (every style), `unit` / `resolution` (voxels), or its own. Part of the bake key. */
export type StyleParams = Readonly<Record<string, unknown>>;

/** A style: the contract `style/<name>@1.0.0`. */
export interface ObjectStyle {
  readonly name: string;
  /** "style/<name>@<exact version>": what its module provides. */
  readonly contract: string;
  readonly title?: string | undefined;
  /** Another style to try when this one is asked for but can't be drawn. */
  readonly fallback?: string | undefined;
  /** The parts, or null to decline a design it can't draw (its fallback, then pixel, draws it). */
  build(design: Design, params: StyleParams): StyledParts | null;
}

/** An asset's own builder for a style (it knows better than the generic one): the same contract, per asset. Null: it declines this design (the next style in the chain draws it). */
export type StyleBuilder = (design: Design, params: StyleParams) => StyledParts | null;

const NAME = /^[a-z][a-z0-9-]*$/;
const CONTRACT = /^style\/([a-z][a-z0-9-]*)@\d+\.\d+\.\d+$/;

/** Check a style against the contract: a name, "style/<name>@x.y.z", and a build. Throws with the reason. */
export function checkStyle(style: ObjectStyle): ObjectStyle {
  if (!style || typeof style !== "object") throw new TypeError("A style is an object { name, contract, build }.");
  if (!NAME.test(style.name)) throw new TypeError(`Style name "${style.name}": lower-case letters, digits and dashes.`);
  const m = CONTRACT.exec(style.contract);
  if (!m || m[1] !== style.name) throw new TypeError(`Style ${style.name}: contract must be "style/${style.name}@<exact version>" (got "${style.contract}").`);
  if (typeof style.build !== "function") throw new TypeError(`Style ${style.name}: build(design, params) is missing.`);
  return style;
}

// ---------------------------------------------------------------- the registry

export interface StyleRegistry {
  /** Add (or replace) a style; checked against the contract. */
  add(style: ObjectStyle): void;
  get(name: string): ObjectStyle | undefined;
  has(name: string): boolean;
  /** Every style's name, "pixel" first. */
  names(): string[];
}

export function createStyleRegistry(styles: readonly ObjectStyle[] = [pixelStyle]): StyleRegistry {
  const map = new Map<string, ObjectStyle>();
  const add = (s: ObjectStyle): void => { map.set(checkStyle(s).name, s); };
  for (const s of styles) add(s);
  if (!map.has("pixel")) add(pixelStyle);
  return {
    add,
    get: (name) => map.get(name),
    has: (name) => map.has(name),
    names: () => ["pixel", ...[...map.keys()].filter((n) => n !== "pixel").sort()],
  };
}

/** The page's styles: pixel, and whatever style modules register as they load (keel/builder registers voxel). */
export const defaultStyles: StyleRegistry = createStyleRegistry();

/** Register a style with the page's registry (a style module does this when it loads). */
export const registerStyle = (style: ObjectStyle): void => defaultStyles.add(style);

// ---------------------------------------------------------------- the setting

/** The style a world is drawn in: a setting, which may be locked (every placement drawn in it, whatever it asks). */
export interface StyleSetting {
  readonly style: string;
  readonly locked: boolean;
  /** Knobs for the setting's style (voxel unit, detail...). */
  readonly params?: StyleParams | undefined;
}
export const styleSetting = (style: string, { locked = false, params }: { locked?: boolean; params?: StyleParams } = {}): StyleSetting =>
  Object.freeze({ style, locked, ...(params ? { params } : {}) });

// ---------------------------------------------------------------- resolving

export interface ResolveInput {
  /** What the placement asks for. */
  readonly requested?: string | undefined;
  readonly setting?: StyleSetting | undefined;
  /** The asset's own builders (by style name), its default and its fallback. */
  readonly own?: Readonly<Record<string, StyleBuilder>> | undefined;
  readonly assetDefault?: string | undefined;
  readonly assetFallback?: string | undefined;
  readonly registry?: StyleRegistry | undefined;
}
/** A style that may draw it: its name, and how. */
export interface StyleCandidate { readonly name: string; readonly build: StyleBuilder }
export interface StyleChain {
  /** What was wanted (after the setting). */
  readonly wanted: string;
  /** Every style to try, in order: the wanted one (if it is there), its fallback, the asset's, pixel. */
  readonly candidates: readonly StyleCandidate[];
  /** A note when a locked setting overrode what was asked for. */
  readonly note: string;
}

/** The styles to try, in the order at the top of this file. */
export function styleChain({ requested, setting, own = {}, assetDefault, assetFallback, registry = defaultStyles }: ResolveInput): StyleChain {
  const wanted = setting?.locked ? setting.style : requested ?? setting?.style ?? assetDefault ?? "pixel";
  const how = (name: string): StyleBuilder | undefined => {
    const mine = own[name];
    if (mine) return mine;
    const s = registry.get(name);
    return s ? (d, p) => s.build(d, p) : undefined;
  };
  const names = [wanted, registry.get(wanted)?.fallback, assetFallback, "pixel"].filter((n): n is string => !!n);
  const candidates: StyleCandidate[] = [];
  for (const name of [...new Set(names)]) { const build = how(name); if (build) candidates.push({ name, build }); }
  // (A registry always has pixel; a hand-made one without it still draws.)
  if (!candidates.some((c) => c.name === "pixel")) candidates.push({ name: "pixel", build: (d, p) => pixelStyle.build(d, p) });
  const note = setting?.locked && requested !== undefined && requested !== setting.style ? ` (the setting is locked to ${setting.style}; ${requested} was asked for)` : "";
  return { wanted, candidates, note };
}

export interface ResolvedStyle {
  /** The style it will be drawn in (unless that style declines the design: see buildStyled). */
  readonly name: string;
  readonly wanted: string;
  readonly fellBack: boolean;
  readonly why: string;
}

/** Which style a thing will be drawn in, and why (no building). */
export function resolveStyle(input: ResolveInput): ResolvedStyle {
  const c = styleChain(input);
  const name = c.candidates[0]!.name;
  const fellBack = name !== c.wanted;
  return { name, wanted: c.wanted, fellBack, why: fellBack ? `${c.wanted} isn't available (nothing provides style/${c.wanted}); drawn in ${name}${c.note}` : `${name}${c.note}` };
}
