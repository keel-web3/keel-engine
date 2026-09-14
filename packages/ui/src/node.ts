// The retained tree: nodes with plain-data props (what a layout document
// holds), a laid-out rectangle, and interaction state. A node never draws
// itself when nothing about it changed: `set()` compares, and tells the UI
// only what did -- a paint (its own rectangle is redrawn) or a layout (the tree
// is laid out again and whatever moved is redrawn).

import type { Bitmap, Rect } from "./bitmap.ts";
import type { FrameKind, FrameState } from "./frames.ts";

export const WIDGETS = [
  "root", "canvas", "row", "col", "grid", "panel", "button", "label", "icon", "bar", "list", "tooltip", "minimap", "portrait", "tabs", "toast", "modal",
  "slider", "toggle", "spinner", "spacer", "image",
] as const;
export type WidgetType = (typeof WIDGETS)[number];

export const ANCHORS = ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"] as const;
export type Anchor = (typeof ANCHORS)[number];
/** A size: pixels, "fit" (the content's), "fill" (what's left), or a share of the parent ("50%"). */
export type Size = number | "fit" | "fill" | `${number}%`;
export type Align = "start" | "center" | "end" | "stretch";
export type Justify = "start" | "center" | "end" | "between";
export type FontRole = "small" | "body" | "title" | "display";

/** Everything a node can say -- all plain data, so a layout document carries it (see doc.ts). */
export interface NodeProps {
  // Layout.
  anchor?: Anchor;
  x?: number;
  y?: number;
  w?: Size;
  h?: Size;
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
  /** How children are placed: free (by anchors), row, col, grid. */
  dir?: "free" | "row" | "col" | "grid";
  gap?: number;
  pad?: number;
  align?: Align;
  justify?: Justify;
  grow?: number;
  cols?: number;
  /** A grid cell's height (default: square cells). */
  cellH?: number;
  hidden?: boolean;
  // Look.
  frame?: FrameKind | "none";
  /** A see-through fill (every other pixel). */
  mesh?: boolean;
  tone?: string;
  font?: FontRole;
  textAlign?: "left" | "center" | "right";
  wrap?: boolean;
  maxLines?: number;
  caps?: boolean;
  shadow?: boolean;
  // Content.
  text?: string;
  title?: string;
  icon?: string;
  iconSize?: number;
  value?: number;
  max?: number;
  segments?: number;
  /** A bar's recent loss, shown fading behind its value. */
  trail?: number;
  hotkey?: string;
  /** Remaining share of a cooldown (0 ready .. 1 just used). */
  cooldown?: number;
  count?: number;
  disabled?: boolean;
  active?: boolean;
  primary?: boolean;
  items?: string[];
  selected?: number;
  /** A minimap's camera rectangle, in 0..1 of the map: [x, y, w, h]. */
  view?: [number, number, number, number];
  /** Tooltip text (rich) shown on hover. */
  tip?: string;
  /** Tooltips of the nodes inside this one show just above it (right-aligned to the hovered node), never over it: a console. */
  tipDock?: boolean;
  focusable?: boolean;
  /** The event name a click sends (default: the node's id). */
  action?: string;
  /** Picture content (a portrait, a minimap): drawn at its own size, centred (never scaled). */
  image?: Bitmap;
  /** Leave a hole (transparent) where the game draws itself (a GL minimap). */
  hole?: boolean;
  /**
   * A panel drawn as a silhouette instead of a frame: "<kind> <rise>" (silhouette.ts: lobe, scallop, plate, facet,
   * spikes, arch, teeth, rail), the shape rising `rise` px from the node's bottom rows (its foot). The classic console's
   * `trim.*` nodes: the same rectangles for every culture, a different outline inside.
   */
  trim?: string;
  /**
   * A panel's top edge, carved: "<kind> <depth>" (silhouette.ts: bites, steps, vees, arcs, crenel, flat). What's under
   * the cut shows through (a trim behind it, or the game). Its rectangle -- its hit area -- doesn't change.
   */
  edge?: string;
  /**
   * A modal's backdrop where the game shows through: "solid" (the default) paints it one very dark colour, a flat
   * blackout behind the menu; "dither" leaves every other pixel to the game. Drawn UI under it is darkened either way.
   */
  scrim?: "solid" | "dither";
  /** A grid that picks its rows and columns from how many children show, its cells filling its whole box (the classic group). */
  reflow?: boolean;
  /** A button's icon drawn as big as its cell allows (iconSize then only names the size a layout starts from). */
  iconFill?: boolean;
  /** A health strip along the bottom of a button (0..1; null: none): good over 66%, warn over 33%, bad under -- a group cell's unit. */
  hp?: number | null;
}

// (Props whose change only repaints the node; any other change lays the tree out again.)
export const PAINT_ONLY: ReadonlySet<string> = new Set([
  "tone", "value", "max", "trail", "cooldown", "count", "disabled", "active", "primary", "selected", "view", "tip", "image", "mesh", "shadow", "hole", "action", "focusable", "trim", "edge", "scrim", "hp",
]);

// (Props that change what a node shows and how big its content is, but not how it places its children: when
// one changes and the node's measured size doesn't, nothing moves, so only the node is redrawn.)
export const CONTENT: ReadonlySet<string> = new Set(["text", "title", "icon", "iconSize", "items", "hotkey", "font", "caps", "maxLines", "wrap", "textAlign", "segments"]);

export interface UiNodeHost {
  /** `content`: only CONTENT props changed (the host may find the size unchanged and just repaint). */
  invalidate(node: UiNode, layout: boolean, content?: boolean): void;
  /** A node's hotkey (or whether it shows) changed: the host's key table is stale, even when nothing moves. */
  rekey?(node: UiNode): void;
}

let serial = 0;

export class UiNode {
  readonly id: string;
  /** The id was made up (no id given): a document leaves it out. */
  readonly auto: boolean;
  readonly type: WidgetType;
  props: NodeProps;
  children: UiNode[] = [];
  parent: UiNode | null = null;
  /** Laid-out rectangle, layer pixels. */
  rect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  /** What it may paint (its rectangle plus glow and shadow). */
  paint: Rect = { x: 0, y: 0, w: 0, h: 0 };
  /** Its content size at the last layout (what "fit" gave it). */
  fit: { w: number; h: number } | null = null;
  hover = false;
  press = false;
  focus = false;
  /** Free per-node animation state (spinners, toasts, press pops). */
  anim = 0;
  host: UiNodeHost | null = null;

  constructor(type: WidgetType, props: NodeProps = {}, id?: string) {
    this.type = type;
    this.props = { ...props };
    this.auto = id === undefined;
    this.id = id ?? `${type}-${++serial}`;
  }

  /** Change props: repaint or relayout, only when something changed. */
  set(p: Partial<NodeProps>): this {
    let paint = false, layout = false, content = true, rekey = false;
    for (const k of Object.keys(p) as Array<keyof NodeProps>) {
      const a = this.props[k], b = p[k];
      if (same(a, b, k)) continue;
      (this.props as Record<string, unknown>)[k] = b;
      if (k === "hotkey" || k === "hidden") rekey = true;
      if (PAINT_ONLY.has(k)) paint = true;
      else { layout = true; if (!CONTENT.has(k)) content = false; }
    }
    if (rekey) this.host?.rekey?.(this);
    if ((paint || layout) && this.host) this.host.invalidate(this, layout, layout && content);
    return this;
  }

  add(...kids: UiNode[]): this {
    for (const k of kids) { k.parent = this; this.children.push(k); adopt(k, this.host); }
    this.host?.invalidate(this, true);
    return this;
  }
  remove(kid: UiNode): this {
    const i = this.children.indexOf(kid);
    if (i >= 0) { this.children.splice(i, 1); kid.parent = null; this.host?.invalidate(this, true); adopt(kid, null); }
    return this;
  }
  get visible(): boolean { for (let n: UiNode | null = this; n; n = n.parent) if (n.props.hidden) return false; return true; }
  *walk(): Generator<UiNode> { yield this; for (const c of this.children) yield* c.walk(); }
}

function adopt(n: UiNode, host: UiNodeHost | null): void { for (const k of n.walk()) k.host = host; }

// (Cooldowns compare in 64ths and values in 1000ths of their max: a bar that
// moves less than a pixel doesn't repaint -- the painter rounds the same way.)
function same(a: unknown, b: unknown, k: string): boolean {
  if (a === b) return true;
  if (k === "cooldown" && typeof a === "number" && typeof b === "number") return Math.ceil(a * 64) === Math.ceil(b * 64);
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return false;
}

/** The frame state a node draws in now. */
export function stateOf(n: UiNode): FrameState {
  const p = n.props;
  if (p.disabled) return "disabled";
  if (n.press) return "press";
  if (p.active || n.focus) return "active";
  if (n.hover) return "hover";
  if (p.primary) return "primary";
  return "normal";
}
