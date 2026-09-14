// The UI: a retained tree drawn into ONE pixel layer at the UI's own
// resolution (the screen divided by a whole UI scale), redrawn only where
// something changed. A static HUD costs nothing per frame: no node changed,
// so render() returns no rectangles and the presenter has nothing to upload.
// A cooldown sweep or a bar that moves repaints its own rectangle.
//
//   const ui = createUi({ theme, width: canvas.width, height: canvas.height });
//   ui.load(hud.screen);                          // a layout document (doc.ts)
//   ui.set("res.mass", { text: "{icon:mass} 350" });
//   ui.on("click", (id) => orders.push(id));
//   // each frame:
//   ui.update(dt); const rects = ui.render(); presenter.present(rects);
//
// Input comes in as screen pixels (pointer), key codes and pad states; the UI
// hit-tests, keeps focus (Tab, arrows, the d-pad), fires hotkeys, shows
// tooltips, and reports what it used so the game can take the rest.

import { createAtlas } from "./atlas.ts";
import type { UiAtlas } from "./atlas.ts";
import { createBitmap, fillRect } from "./bitmap.ts";
import type { Bitmap, Clip, Rect } from "./bitmap.ts";
import type { Rgba } from "./color.ts";
import type { PixelFont } from "./font.ts";
import { frameColours, frameShape, frameTemplate } from "./frames.ts";
import type { FrameColours, FrameKind, FrameState, FrameTemplate } from "./frames.ts";
import { fontParamsKey, generateFont } from "./genfont.ts";
import { ICON_RECIPES, iconBitmap, rampOf } from "./icons.ts";
import type { IconFamily } from "./iconfamily.ts";
import { arrange, measure, padOf } from "./layout.ts";
import type { LayoutContext } from "./layout.ts";
import { UiNode } from "./node.ts";
import type { FontRole, NodeProps } from "./node.ts";
import { buttonContent, marginOf, paintNode, tabRects } from "./paint.ts";
import type { PaintContext } from "./paint.ts";
import { layoutText, parseRich } from "./text.ts";
import type { TextLayout } from "./text.ts";
import type { Theme } from "./theme.ts";
import { buildNode } from "./doc.ts";
import { isLevelIcon, paintLevels } from "./wireframe.ts";
import type { LevelIcon } from "./wireframe.ts";
import type { ScreenDoc } from "./doc.ts";

export interface SafeArea { readonly top?: number; readonly right?: number; readonly bottom?: number; readonly left?: number }

export interface UiOptions {
  readonly theme: Theme;
  /** The screen, in device pixels. */
  readonly width: number;
  readonly height: number;
  /** A whole UI scale (default: uiScaleFor). */
  readonly scale?: number;
  /** The design size the default scale aims for (default 640 x 360: 1080p is x3, 1440p x4, 4K x6). */
  readonly reference?: readonly [number, number];
  /** Insets in device pixels (notches, TV overscan). */
  readonly safe?: SafeArea;
  /** Fonts to use instead of the theme's generated ones (imported TTF, BMFont...). */
  readonly fonts?: Partial<Record<FontRole, PixelFont>>;
  readonly atlas?: UiAtlas;
  /**
   * Keyboard navigation outside a modal (a modal always has it): Tab / Shift-Tab, the arrow keys, and Enter / Space
   * on the focused node. A game that uses those keys itself (arrows pan, Tab cycles a selection, Space jumps the
   * camera) turns them off here -- `false` for all three -- and `key()` then leaves them to it (returns false).
   */
  readonly navigation?: boolean | Navigation;
  /** The tooltip's font and width (default body, 160 layer px): a dense console's tips in its own small type. */
  readonly tooltip?: { readonly font?: FontRole; readonly maxW?: number };
}

/** Which navigation keys the UI takes outside a modal (default: all of them). */
export interface Navigation { readonly tab?: boolean; readonly arrows?: boolean; readonly enter?: boolean }

/** A pointer event's button: 0 left (primary), 1 middle, 2 right -- a DOM PointerEvent's `button`. */
export interface PointerOptions { readonly button?: number }

/**
 * What the `minimap` event carries: where on the minimap's PICTURE (inside its frame) the pointer is, 0..1 each way
 * (clamped; `inside` says whether it really is over it), which button, and the phase: `down` when pressed on it,
 * `drag` as it moves while held (anywhere on screen), `up` when released.
 */
export interface MinimapPoint { readonly x: number; readonly y: number; readonly button: number; readonly phase: "down" | "drag" | "up"; readonly inside: boolean }

export type UiEvent = "click" | "change" | "hover" | "minimap" | "back" | "modal";
export type UiListener = (id: string, value: unknown, node: UiNode | null) => void;

export interface UiStats {
  nodes: number;
  /** Nodes painted by the last render. */
  painted: number;
  /** Pixels cleared and redrawn by the last render. */
  pixels: number;
  /** Rectangles the last render redrew. */
  rects: number;
  layouts: number;
}

export interface PadState { up?: boolean; down?: boolean; left?: boolean; right?: boolean; a?: boolean; b?: boolean }

/** The whole scale that fits the reference size into the screen. */
export const uiScaleFor = (width: number, height: number, reference: readonly [number, number] = [640, 360]): number =>
  Math.max(1, Math.floor(Math.min(width / reference[0], height / reference[1])));

const INTERACTIVE = new Set(["button", "list", "tabs", "slider", "toggle", "minimap"]);

export class Ui implements LayoutContext {
  theme: Theme;
  scale: number;
  layer: Bitmap;
  readonly atlas: UiAtlas;
  readonly root: UiNode;
  readonly content: UiNode;
  readonly overlay: UiNode;
  readonly stats: UiStats = { nodes: 0, painted: 0, pixels: 0, rects: 0, layouts: 0 };
  time = 0;
  focusVisible = false;
  private screenW: number;
  private screenH: number;
  private readonly reference: readonly [number, number];
  private readonly scaleFixed: number | undefined;
  private safe: SafeArea;
  private fontOverrides: Partial<Record<FontRole, PixelFont>>;
  private fonts = new Map<string, PixelFont>();
  private frames = new Map<string, { t: FrameTemplate; c: FrameColours }>();
  private texts = new Map<string, TextLayout>();
  private customIcons = new Map<string, Bitmap | LevelIcon>();
  private ids = new Map<string, UiNode>();
  private dirty: Rect[] = [];
  private after: UiNode[] = [];
  private needsLayout = true;
  private listeners = new Map<UiEvent, Set<UiListener>>();
  private hovered: UiNode | null = null;
  private pressed: UiNode | null = null;
  private focused: UiNode | null = null;
  private hoverTime = 0;
  private pointerAt = { x: -1, y: -1 };
  private tooltip: UiNode;
  private hotkeys = new Map<string, UiNode>();
  private keyDown: UiNode | null = null;
  private hotkeysStale = false;
  private pressButton = 0;
  /** The navigation keys the UI takes outside a modal (see UiOptions.navigation); change it any time. */
  navigation: Required<Navigation>;
  private padPrev: PadState = {};
  private spinners: UiNode[] = [];
  private toasts: Array<{ node: UiNode; age: number; life: number }> = [];

  constructor(o: UiOptions) {
    this.theme = o.theme;
    this.screenW = o.width;
    this.screenH = o.height;
    this.reference = o.reference ?? [640, 360];
    this.scaleFixed = o.scale;
    this.scale = o.scale ?? uiScaleFor(o.width, o.height, this.reference);
    this.safe = o.safe ?? {};
    this.fontOverrides = { ...(o.fonts ?? {}) };
    this.atlas = o.atlas ?? createAtlas(1024);
    this.layer = createBitmap(Math.ceil(o.width / this.scale), Math.ceil(o.height / this.scale));
    const nav = o.navigation ?? true;
    this.navigation = typeof nav === "boolean" ? { tab: nav, arrows: nav, enter: nav } : { tab: nav.tab ?? true, arrows: nav.arrows ?? true, enter: nav.enter ?? true };
    const host = { invalidate: (n: UiNode, layout: boolean, content?: boolean) => this.invalidate(n, layout, content), rekey: () => { this.hotkeysStale = true; } };
    this.root = new UiNode("root", {}, "#root");
    this.content = new UiNode("canvas", { w: "fill", h: "fill" }, "#content");
    this.overlay = new UiNode("canvas", { w: "fill", h: "fill" }, "#overlay");
    this.tooltip = new UiNode("tooltip", { hidden: true, maxW: o.tooltip?.maxW ?? 160, wrap: true, ...(o.tooltip?.font ? { font: o.tooltip.font } : {}) }, "#tooltip");
    this.overlay.children.push(this.tooltip);
    this.tooltip.parent = this.overlay;
    this.root.children.push(this.content, this.overlay);
    this.content.parent = this.root;
    this.overlay.parent = this.root;
    for (const n of this.root.walk()) n.host = host;
  }

  /** The UI's own size (layer pixels). */
  get width(): number { return this.layer.w; }
  get height(): number { return this.layer.h; }

  // --- Fonts, frames, icons, text (the paint context) -------------------------

  font(role: FontRole): PixelFont {
    const o = this.fontOverrides[role];
    if (o) return o;
    const size = this.theme.type[role];
    const key = `${fontParamsKey(this.theme.type.font)}@${size}`;
    let f = this.fonts.get(key);
    if (!f) { f = generateFont(this.theme.type.font, size, `${this.theme.culture}-${role}`); this.fonts.set(key, f); }
    return f;
  }
  /** Use a font for a role (an imported one); null goes back to the theme's. */
  setFont(role: FontRole, font: PixelFont | null): void {
    if (font) this.fontOverrides[role] = font; else delete this.fontOverrides[role];
    this.texts.clear();
    this.needsLayout = true;
    this.dirtyAll();
  }
  frame(kind: FrameKind, state: FrameState): { t: FrameTemplate; c: FrameColours } {
    const key = `${kind}/${state}`;
    let f = this.frames.get(key);
    if (!f) { f = { t: frameTemplate(frameShape(this.theme, kind, state)), c: frameColours(this.theme, kind, state) }; this.frames.set(key, f); }
    return f;
  }
  /**
   * Add an icon by name: a bitmap (an imported PNG or SVG, already themed or snapped) or a LEVEL icon (a wireframe:
   * painted in the tone each node asks for). It wins over the grammar's. Re-registering a name replaces it.
   */
  registerIcon(name: string, icon: Bitmap | LevelIcon): void {
    this.customIcons.set(name, icon);
    this.iconVersions.set(name, (this.iconVersions.get(name) ?? 0) + 1);
    this.dirtyAll();
  }
  /** Is there a registered icon by this name? */
  hasIcon(name: string): boolean { return this.customIcons.has(name); }
  private iconVersions = new Map<string, number>();
  /** A themed icon's sprite: drawn in the theme's culture's family (iconfamily.ts), or in `family` ("plain": the grammar's own). */
  icon(name: string, size: number, tone?: string, family?: IconFamily, on?: Rgba) {
    const custom = this.customIcons.get(name);
    const t = this.theme;
    const over = on !== undefined && !custom ? on : undefined;
    return this.atlas.sprite(`icon/${name}/${size}/${tone ?? ""}/${t.key}/${t.icon.style}${family ? `/${family}` : ""}${over !== undefined ? `/on${over.toString(16)}` : ""}${custom ? `/c${this.iconVersions.get(name) ?? 0}` : ""}`, () => {
      if (custom) return isLevelIcon(custom) ? paintLevels(custom, rampOf(t, tone ?? "good"), t.palette.outline) : custom;
      const known = ICON_RECIPES[name] ? name : "ability";
      return iconBitmap(known, size, t, { seed: `${t.recipe.seed}/${t.culture}${known === name ? "" : `/${name}`}`, ...(tone ? { tone } : {}), ...(family ? { family } : {}), ...(over !== undefined ? { on: over } : {}) });
    });
  }
  /**
   * The size a button's icon is drawn at, as laid out now (inside its frame, less a keycap and a health strip; a
   * `iconFill` cell as big as its room): what to bake a registered icon at -- the classic group's wireframes, whose
   * cells grow as the selection shrinks.
   */
  iconSizeOf(id: string): number {
    const n = this.node(id);
    return n ? buttonContent(n, this).icon : 0;
  }
  tone(name: string | undefined): Rgba {
    const p = this.theme.palette;
    switch (name) {
      case undefined: case "ink": return p.ink[1]!;
      case "dim": return p.ink[0]!;
      case "bright": return p.ink[2]!;
      case "onAccent": return p.onAccent;
      case "outline": return p.outline;
      // (A tone's light end reads on dark panels, its dark end on light ones.)
      default: return rampOf(this.theme, name)[p.tone === "light" ? 0 : 3]!;
    }
  }
  text(n: UiNode, src: string, role: FontRole, width: number | undefined, opts: { align?: "left" | "center" | "right"; caps?: boolean; maxLines?: number; wrap?: boolean } = {}): TextLayout {
    const font = this.font(role);
    const key = `${font.key}|${width ?? ""}|${opts.align ?? ""}|${opts.caps ? 1 : 0}|${opts.maxLines ?? ""}|${opts.wrap === false ? 0 : 1}|${src}`;
    let t = this.texts.get(key);
    if (!t) {
      if (this.texts.size > 4000) this.texts.clear();
      t = layoutText(parseRich(src), { font, ...(width !== undefined ? { width } : {}), align: opts.align ?? "left", caps: !!opts.caps, ...(opts.maxLines !== undefined ? { maxLines: opts.maxLines } : {}), ...(opts.wrap === false ? { wrap: false } : {}) });
      this.texts.set(key, t);
    }
    void n;
    return t;
  }

  // --- The tree ----------------------------------------------------------------

  /** Show a screen (a layout document): it replaces what the content showed. */
  load(doc: ScreenDoc | UiNode): UiNode {
    const node = doc instanceof UiNode ? doc : buildNode(doc.root);
    for (const c of [...this.content.children]) this.content.remove(c);
    this.content.add(node);
    this.hovered = this.pressed = this.focused = null;
    return node;
  }
  node(id: string): UiNode | undefined { if (this.needsLayout) this.layout(); return this.ids.get(id); }
  /** Set a node's props by id (a no-op for an id that isn't there). */
  set(id: string, props: Partial<NodeProps>): void { this.node(id)?.set(props); }

  on(type: UiEvent, fn: UiListener): () => void {
    let s = this.listeners.get(type);
    if (!s) { s = new Set(); this.listeners.set(type, s); }
    s.add(fn);
    return () => s.delete(fn);
  }
  private emit(type: UiEvent, id: string, value: unknown, node: UiNode | null): void { for (const f of this.listeners.get(type) ?? []) f(id, value, node); }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.frames.clear();
    this.texts.clear();
    this.needsLayout = true;
    this.dirtyAll();
  }
  resize(width: number, height: number, safe?: SafeArea): void {
    this.screenW = width; this.screenH = height;
    if (safe) this.safe = safe;
    this.scale = this.scaleFixed ?? uiScaleFor(width, height, this.reference);
    this.layer = createBitmap(Math.ceil(width / this.scale), Math.ceil(height / this.scale));
    this.needsLayout = true;
    this.dirtyAll();
  }
  get screen(): { width: number; height: number } { return { width: this.screenW, height: this.screenH }; }

  invalidate(n: UiNode, layout: boolean, content = false): void {
    this.dirty.push(n.paint);
    if (!layout || this.needsLayout && this.after.includes(n)) return;
    // (A counter's text changed: if its content measures the same, nothing can move -- repaint it, no layout.)
    if (content && n.fit && !this.needsLayout) {
      const m = measure(n, this, new Map());
      if (m.w === n.fit.w && m.h === n.fit.h) return;
    }
    this.needsLayout = true;
    this.after.push(n);
  }
  dirtyAll(): void { this.dirty = [{ x: 0, y: 0, w: this.layer.w, h: this.layer.h }]; }

  private layout(): void {
    this.needsLayout = false;
    this.stats.layouts += 1;
    const before = new Map<UiNode, Rect>();
    for (const n of this.root.walk()) before.set(n, n.paint);
    const s = this.safe, k = this.scale;
    const l = Math.ceil((s.left ?? 0) / k), t = Math.ceil((s.top ?? 0) / k), r = Math.ceil((s.right ?? 0) / k), b = Math.ceil((s.bottom ?? 0) / k);
    const cache = new Map<UiNode, { w: number; h: number }>();
    const box = { x: l, y: t, w: this.layer.w - l - r, h: this.layer.h - t - b };
    this.root.rect = box;
    for (const c of this.root.children) arrange(c, box, this, cache);
    for (const [n, m] of cache) n.fit = m;
    this.ids.clear();
    this.hotkeys.clear();
    this.spinners = [];
    let count = 0;
    const ctx = this.paintContext({ x0: 0, y0: 0, x1: 0, y1: 0 });
    for (const n of this.root.walk()) {
      count += 1;
      this.ids.set(n.id, n);
      const m = n.props.hidden ? 0 : marginOf(n, ctx);
      n.paint = { x: n.rect.x - m, y: n.rect.y - m, w: n.rect.w + 2 * m, h: n.rect.h + 2 * m };
      const old = before.get(n);
      if (!old || old.x !== n.paint.x || old.y !== n.paint.y || old.w !== n.paint.w || old.h !== n.paint.h) { if (old) this.dirty.push(old); this.dirty.push(n.paint); }
      if (n.props.hotkey && n.visible) this.hotkeys.set(keyName(n.props.hotkey), n);
      if (n.type === "spinner") this.spinners.push(n);
    }
    for (const n of this.after) this.dirty.push(n.paint);
    this.after = [];
    this.stats.nodes = count;
    this.hotkeysStale = false;
  }
  /** The key table again (a hotkey changed without anything moving: no layout needed, but the old key mustn't fire). */
  private rekey(): void {
    this.hotkeysStale = false;
    this.hotkeys.clear();
    for (const n of this.root.walk()) if (n.props.hotkey && n.visible) this.hotkeys.set(keyName(n.props.hotkey), n);
  }

  private paintContext(clip: Clip): PaintContext {
    // (The Ui is its own paint context; the clip and time are read off it.)
    const self = this as unknown as PaintContext & { clip: Clip };
    self.clip = clip;
    return self;
  }
  clip: Clip = { x0: 0, y0: 0, x1: 0, y1: 0 };

  /** Redraw what changed; the rectangles redrawn (layer pixels). Nothing changed: none, and no work. */
  render(): Rect[] {
    if (this.needsLayout) this.layout();
    if (!this.dirty.length) { this.stats.painted = 0; this.stats.pixels = 0; this.stats.rects = 0; return []; }
    const rects = mergeRects(this.dirty, this.layer.w, this.layer.h);
    this.dirty = [];
    let painted = 0, pixels = 0;
    for (const r of rects) {
      const clip = { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h };
      this.paintContext(clip);
      fillRect(this.layer, r.x, r.y, r.w, r.h, 0, clip);
      pixels += r.w * r.h;
      const walk = (n: UiNode) => {
        if (n.props.hidden) return;
        const p = n.paint;
        if (p.x < clip.x1 && p.x + p.w > clip.x0 && p.y < clip.y1 && p.y + p.h > clip.y0) { paintNode(n, this as unknown as PaintContext); painted += 1; this.clip = clip; }
        for (const c of n.children) walk(c);
      };
      walk(this.root);
    }
    this.stats.painted = painted;
    this.stats.pixels = pixels;
    this.stats.rects = rects.length;
    return rects;
  }
  /** Redraw everything (a benchmark's worst case). */
  paintAll(): Rect[] { this.dirtyAll(); return this.render(); }

  /** Advance animations (spinners, toasts, tooltip delay) by dt seconds. */
  update(dt: number): void {
    const t0 = this.time;
    this.time += dt;
    for (const s of this.spinners) if (s.visible && Math.floor(t0 * 10) !== Math.floor(this.time * 10)) this.dirty.push(s.paint);
    if (this.hovered?.props.tip && this.tooltip.props.hidden) {
      this.hoverTime += dt;
      if (this.hoverTime >= 0.35) this.showTip(this.hovered);
    }
    if (this.toasts.length) {
      const m = this.theme.motion;
      for (const t of this.toasts) {
        t.age += dt;
        const inT = m.ms ? Math.min(1, (t.age * 1000) / m.ms) : 1;
        const e = m.kind === "none" ? 1 : inT >= 1 ? 1 : ease(m.kind, inT, m.overshoot);
        const y = Math.round((1 - e) * -16) + 4 + this.toasts.indexOf(t) * (t.node.rect.h + 2);
        t.node.set({ y });
      }
      const gone = this.toasts.filter((t) => t.age >= t.life);
      for (const g of gone) { this.overlay.remove(g.node); this.dirty.push(g.node.paint); }
      if (gone.length) this.toasts = this.toasts.filter((t) => t.age < t.life);
    }
  }

  // --- Overlays ---------------------------------------------------------------

  toast(text: string, { tone, seconds = 3 }: { tone?: string; seconds?: number } = {}): UiNode {
    const n = new UiNode("toast", { text, anchor: "t", y: -16, maxW: 200, ...(tone ? { tone } : {}) });
    this.overlay.add(n);
    this.toasts.push({ node: n, age: 0, life: seconds });
    return n;
  }
  modal({ title, text, buttons = [{ text: "OK", action: "ok", primary: true }], scrim }: { title?: string; text?: string; buttons?: ReadonlyArray<{ text: string; action: string; primary?: boolean; hotkey?: string }>; scrim?: "solid" | "dither" }): UiNode {
    const box = new UiNode("panel", { anchor: "c", maxW: 220, ...(title ? { title } : {}) }, "#modal-panel");
    if (text) box.add(new UiNode("label", { text, wrap: true, maxW: 200 }));
    const row = new UiNode("row", { justify: "end", w: "fill" });
    for (const b of buttons) row.add(new UiNode("button", { text: b.text, action: `modal:${b.action}`, ...(b.primary ? { primary: true } : {}), ...(b.hotkey ? { hotkey: b.hotkey } : {}) }));
    box.add(row);
    const back = new UiNode("modal", { w: "fill", h: "fill", ...(scrim ? { scrim } : {}) }, "#modal");
    back.add(box);
    this.overlay.add(back);
    const first = row.children.find((c) => c.props.primary) ?? row.children[0];
    if (first) this.setFocus(first, false);
    return back;
  }
  close(node: UiNode): void { node.parent?.remove(node); if (this.focused && !this.focused.visible) this.focused = null; }
  private get activeModal(): UiNode | null { for (let i = this.overlay.children.length - 1; i >= 0; i -= 1) { const c = this.overlay.children[i]!; if (c.type === "modal" && !c.props.hidden) return c; } return null; }

  private showTip(n: UiNode): void {
    const tip = this.tooltip;
    tip.set({ text: n.props.tip!, hidden: false });
    if (this.needsLayout) this.layout();
    const w = tip.rect.w, h = tip.rect.h;
    // (Above the node when there's room, else below; kept on screen. Inside a tip dock -- a console -- just above the
    // dock, right-aligned to the node, so the tooltip never covers the panel it explains.)
    let dock: UiNode | null = n.parent;
    while (dock && !dock.props.tipDock) dock = dock.parent;
    let x = dock ? n.rect.x + n.rect.w - w : n.rect.x + Math.floor((n.rect.w - w) / 2);
    let y = (dock ?? n).rect.y - h - 2;
    if (y < 0) y = n.rect.y + n.rect.h + 2;
    x = Math.max(0, Math.min(this.layer.w - w, x));
    y = Math.max(0, Math.min(this.layer.h - h, y));
    tip.set({ x, y });
  }
  private hideTip(): void { if (!this.tooltip.props.hidden) { this.dirty.push(this.tooltip.paint); this.tooltip.set({ hidden: true }); } this.hoverTime = 0; }

  // --- Input ------------------------------------------------------------------

  /** The interactive node at a layer point (topmost), or null. */
  hitTest(x: number, y: number): UiNode | null {
    if (this.needsLayout) this.layout();
    const modal = this.activeModal;
    const scan = (n: UiNode): UiNode | null => {
      if (n.props.hidden) return null;
      for (let i = n.children.length - 1; i >= 0; i -= 1) { const h = scan(n.children[i]!); if (h) return h; }
      const r = n.rect;
      if ((INTERACTIVE.has(n.type) || n.props.tip || n.props.action) && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) return n;
      return null;
    };
    return modal ? scan(modal) : scan(this.overlay) ?? scan(this.content);
  }
  private toLayer(sx: number, sy: number): { x: number; y: number } { return { x: Math.floor(sx / this.scale), y: Math.floor(sy / this.scale) }; }

  /** Where a screen point falls on a minimap node's picture (inside its frame), 0..1 each way, clamped. */
  private minimapPoint(n: UiNode, sx: number, sy: number, phase: MinimapPoint["phase"]): MinimapPoint {
    const p = padOf(n, this), r = n.rect;
    const ix = r.x + p.l, iy = r.y + p.t, iw = Math.max(1, r.w - p.l - p.r), ih = Math.max(1, r.h - p.t - p.b);
    const fx = sx / this.scale, fy = sy / this.scale;
    const u = (fx - ix) / iw, v = (fy - iy) / ih;
    return { x: Math.max(0, Math.min(1, u)), y: Math.max(0, Math.min(1, v)), button: this.pressButton, phase, inside: u >= 0 && v >= 0 && u < 1 && v < 1 };
  }

  /** The pointer moved to screen pixel (sx, sy). Returns whether it's over the UI (or dragging on the minimap). */
  pointerMove(sx: number, sy: number): boolean {
    const { x, y } = this.toLayer(sx, sy);
    this.pointerAt = { x, y };
    if (this.pressed?.type === "minimap") { const n = this.pressed; this.emit("minimap", n.id, this.minimapPoint(n, sx, sy, "drag"), n); return true; }
    const hit = this.hitTest(x, y);
    if (hit !== this.hovered) {
      if (this.hovered) { this.hovered.hover = false; this.invalidate(this.hovered, false); }
      this.hideTip();
      this.hovered = hit;
      if (hit) { hit.hover = true; this.invalidate(hit, false); }
      this.emit("hover", hit?.id ?? "", null, hit);
    }
    if (hit && (hit.type === "list" || hit.type === "tabs")) { const i = this.subIndex(hit, x, y); if (i !== hit.anim) { hit.anim = i; this.invalidate(hit, false); } }
    if (this.pressed?.type === "slider") this.slide(this.pressed, x);
    return !!hit || this.overUi(x, y);
  }
  /** Is a layer point over any drawn UI (not only interactive nodes): the game shouldn't take the click. */
  overUi(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.layer.w || y >= this.layer.h) return false;
    return this.layer.px[y * this.layer.w + x] !== 0 || !!this.activeModal;
  }
  /** A button went down at screen pixel (sx, sy) (`button`: 0 left, 1 middle, 2 right). Returns whether the UI took it. */
  pointerDown(sx: number, sy: number, { button = 0 }: PointerOptions = {}): boolean {
    this.pointerMove(sx, sy);
    const n = this.hovered;
    this.focusVisible = false;
    this.pressButton = button;
    if (!n || n.props.disabled) return this.overUi(this.pointerAt.x, this.pointerAt.y);
    if (n.type === "minimap") {
      // (The minimap answers the press itself -- a jump, an order there -- and every move while held: a drag.)
      this.pressed = n;
      this.hideTip();
      this.emit("minimap", n.id, this.minimapPoint(n, sx, sy, "down"), n);
      return true;
    }
    n.press = true;
    this.pressed = n;
    this.invalidate(n, false);
    if (n.props.focusable !== false && INTERACTIVE.has(n.type)) this.setFocus(n, false);
    if (n.type === "slider") this.slide(n, this.pointerAt.x);
    this.hideTip();
    return true;
  }
  pointerUp(sx: number, sy: number, { button }: PointerOptions = {}): boolean {
    const { x, y } = this.toLayer(sx, sy);
    const n = this.pressed;
    this.pressed = null;
    if (button !== undefined) this.pressButton = button;
    if (!n) return this.overUi(x, y);
    if (n.type === "minimap") { this.emit("minimap", n.id, this.minimapPoint(n, sx, sy, "up"), n); return true; }
    n.press = false;
    this.invalidate(n, false);
    if (this.hitTest(x, y) === n) this.activate(n, x, y);
    return true;
  }
  /** Scroll the list under the pointer. */
  wheel(dy: number): boolean {
    const n = this.hovered;
    if (!n || n.type !== "list") return false;
    const rows = n.props.items?.length ?? 0;
    n.set({ value: Math.max(0, Math.min(Math.max(0, rows - 1), Math.floor(n.props.value ?? 0) + Math.sign(dy))) });
    return true;
  }

  /** A key went down or up (a KeyboardEvent's code or key). Returns whether the UI used it. */
  key(code: string, down: boolean, { shift = false }: { shift?: boolean } = {}): boolean {
    const k = keyName(code);
    const modal = this.activeModal;
    if (this.hotkeysStale && !this.needsLayout) this.rekey();
    else if (this.needsLayout) this.layout();
    // (Outside a modal, the navigation keys the game claimed are the game's.)
    const nav = modal ? { tab: true, arrows: true, enter: true } : this.navigation;
    const arrow = k === "UP" || k === "DOWN" || k === "LEFT" || k === "RIGHT";
    if ((k === "TAB" && !nav.tab) || (arrow && !nav.arrows) || ((k === "ENTER" || k === "SPACE") && !nav.enter && !this.hotkeys.has(k))) return false;
    if (!down) {
      const n = this.keyDown;
      if (n && (this.hotkeys.get(k) === n || k === "ENTER" || k === "SPACE")) { this.keyDown = null; n.press = false; this.invalidate(n, false); this.pressButton = 0; this.activate(n); return true; }
      return false;
    }
    const f = this.focused;
    if (k === "TAB") { this.moveFocus(shift ? -1 : 1); return true; }
    if (k === "ESCAPE") {
      if (modal) { this.emit("modal", "cancel", null, modal); this.close(modal); return true; }
      this.emit("back", "", null, null);
      return false;
    }
    if (f && f.visible) {
      if (f.type === "slider" && (k === "LEFT" || k === "RIGHT")) { this.nudge(f, k === "LEFT" ? -1 : 1); return true; }
      if ((f.type === "list" || f.type === "tabs") && (k === (f.type === "list" ? "UP" : "LEFT") || k === (f.type === "list" ? "DOWN" : "RIGHT"))) {
        const items = f.props.items?.length ?? 0;
        const next = Math.max(0, Math.min(items - 1, (f.props.selected ?? -1) + (k === "UP" || k === "LEFT" ? -1 : 1)));
        f.set({ selected: next });
        this.emit("change", f.id, next, f);
        return true;
      }
      if (k === "ENTER" || k === "SPACE") { this.keyDown = f; f.press = true; this.invalidate(f, false); return true; }
    }
    if (k === "UP" || k === "DOWN" || k === "LEFT" || k === "RIGHT") { this.spatial(k); return true; }
    const hk = this.hotkeys.get(k);
    if (hk && hk.visible && !hk.props.disabled && (!modal || isInside(hk, modal))) { this.keyDown = hk; hk.press = true; this.invalidate(hk, false); return true; }
    return false;
  }
  /** A gamepad's buttons this frame: the d-pad moves focus, A presses, B backs out. */
  pad(s: PadState): void {
    const edge = (b: keyof PadState) => !!s[b] && !this.padPrev[b];
    const up = (b: keyof PadState) => !s[b] && !!this.padPrev[b];
    if (edge("up")) this.key("ArrowUp", true);
    if (edge("down")) this.key("ArrowDown", true);
    if (edge("left")) this.key("ArrowLeft", true);
    if (edge("right")) this.key("ArrowRight", true);
    if (edge("a")) this.key("Enter", true);
    if (up("a")) this.key("Enter", false);
    if (edge("b")) this.key("Escape", true);
    this.padPrev = { ...s };
  }

  get focus(): UiNode | null { return this.focused; }
  setFocus(n: UiNode | null, visible = true): void {
    if (this.focused === n) { this.focusVisible = visible; return; }
    if (this.focused) { this.focused.focus = false; this.invalidate(this.focused, false); }
    this.focused = n;
    this.focusVisible = visible;
    if (n) { n.focus = visible; this.invalidate(n, false); }
  }
  private focusables(): UiNode[] {
    if (this.needsLayout) this.layout();
    const scope = this.activeModal ?? this.root;
    const out: UiNode[] = [];
    const walk = (n: UiNode) => { if (n.props.hidden) return; if (INTERACTIVE.has(n.type) && n.type !== "minimap" && !n.props.disabled && n.props.focusable !== false) out.push(n); for (const c of n.children) walk(c); };
    walk(scope);
    return out;
  }
  private moveFocus(dir: 1 | -1): void {
    const all = this.focusables();
    if (!all.length) return;
    const i = this.focused ? all.indexOf(this.focused) : -1;
    this.setFocus(all[(i + dir + all.length) % all.length]!, true);
  }
  private spatial(k: string): void {
    const all = this.focusables();
    const f = this.focused;
    if (!f || !all.includes(f)) { if (all[0]) this.setFocus(all[0], true); return; }
    const cx = (r: Rect) => r.x + r.w / 2, cy = (r: Rect) => r.y + r.h / 2;
    const [dx, dy] = k === "LEFT" ? [-1, 0] : k === "RIGHT" ? [1, 0] : k === "UP" ? [0, -1] : [0, 1];
    let best: UiNode | null = null, bs = Infinity;
    for (const n of all) {
      if (n === f) continue;
      const ex = cx(n.rect) - cx(f.rect), ey = cy(n.rect) - cy(f.rect);
      const along = ex * dx + ey * dy;
      if (along <= 0) continue;
      const across = Math.abs(ex * dy - ey * dx);
      const score = along + across * 2;
      if (score < bs) { bs = score; best = n; }
    }
    if (best) this.setFocus(best, true);
  }

  private subIndex(n: UiNode, x: number, y: number): number {
    if (n.type === "tabs") { const rs = tabRects(n, this as unknown as PaintContext); return rs.findIndex((r) => x >= r.x && x < r.x + r.w); }
    const f = this.font(n.props.font ?? "body");
    const band = this.frame("inset", "normal").t.band + this.theme.space.unit;
    return Math.floor(n.props.value ?? 0) + Math.floor((y - n.rect.y - band) / (f.lineHeight + 2));
  }
  private slide(n: UiNode, x: number): void {
    const max = n.props.max ?? 1;
    const v = Math.max(0, Math.min(1, (x - n.rect.x) / Math.max(1, n.rect.w - 1))) * max;
    const snapped = Math.round(v * 100) / 100;
    if (snapped !== n.props.value) { n.set({ value: snapped }); this.emit("change", n.id, snapped, n); }
  }
  private nudge(n: UiNode, dir: number): void {
    const max = n.props.max ?? 1;
    const v = Math.max(0, Math.min(max, (n.props.value ?? 0) + (dir * max) / 20));
    n.set({ value: Math.round(v * 100) / 100 });
    this.emit("change", n.id, n.props.value, n);
  }
  private activate(n: UiNode, x = -1, y = -1): void {
    if (n.props.disabled) return;
    switch (n.type) {
      case "toggle": { const v = (n.props.value ?? 0) > 0 ? 0 : 1; n.set({ value: v }); this.emit("change", n.id, v, n); return; }
      case "list": case "tabs": {
        const i = x >= 0 ? this.subIndex(n, x, y) : n.props.selected ?? 0;
        if (i >= 0 && i < (n.props.items?.length ?? 0)) { n.set({ selected: i }); this.emit("change", n.id, i, n); }
        return;
      }
      default: break;
    }
    const action = n.props.action ?? n.id;
    if (action.startsWith("modal:")) {
      let m: UiNode | null = n;
      while (m && m.type !== "modal") m = m.parent;
      this.emit("modal", action.slice(6), null, n);
      if (m) this.close(m);
      return;
    }
    this.emit("click", action, { button: this.pressButton }, n);
  }
}

function isInside(n: UiNode, root: UiNode): boolean { for (let p: UiNode | null = n; p; p = p.parent) if (p === root) return true; return false; }

/** A key code or key as one name: "KeyQ" and "q" are "Q", "ArrowLeft" is "LEFT", " " is "SPACE". */
export function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return code.slice(6);
  const m: Record<string, string> = { " ": "SPACE", Space: "SPACE", Enter: "ENTER", NumpadEnter: "ENTER", Escape: "ESCAPE", Esc: "ESCAPE", Tab: "TAB", ArrowLeft: "LEFT", ArrowRight: "RIGHT", ArrowUp: "UP", ArrowDown: "DOWN" };
  return m[code] ?? code.toUpperCase();
}

function ease(kind: string, t: number, overshoot: number): number {
  if (kind === "snappy") return 1 - (1 - t) ** 3;
  const s = 1.70158 * (1 + overshoot * 2), u = t - 1;
  return 1 + u * u * ((s + 1) * u + s);
}

/** Dirty rectangles merged: overlapping or touching ones joined, clipped to the layer; many small ones become their bounds. */
export function mergeRects(rs: readonly Rect[], W: number, H: number): Rect[] {
  let list: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  for (const r of rs) {
    const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(W, r.x + r.w), y1 = Math.min(H, r.y + r.h);
    if (x1 > x0 && y1 > y0) list.push({ x0, y0, x1, y1 });
  }
  let merged = true;
  while (merged && list.length > 1) {
    merged = false;
    const out: typeof list = [];
    for (const r of list) {
      const hit = out.find((o) => r.x0 <= o.x1 && r.x1 >= o.x0 && r.y0 <= o.y1 && r.y1 >= o.y0);
      if (hit) { hit.x0 = Math.min(hit.x0, r.x0); hit.y0 = Math.min(hit.y0, r.y0); hit.x1 = Math.max(hit.x1, r.x1); hit.y1 = Math.max(hit.y1, r.y1); merged = true; }
      else out.push({ ...r });
    }
    list = out;
  }
  if (list.length > 32) {
    const b = list.reduce((a, r) => ({ x0: Math.min(a.x0, r.x0), y0: Math.min(a.y0, r.y0), x1: Math.max(a.x1, r.x1), y1: Math.max(a.y1, r.y1) }));
    list = [b];
  }
  return list.map((r) => ({ x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 }));
}

export const createUi = (o: UiOptions): Ui => new Ui(o);
