// Generated screens: one call gives a whole themed screen as a layout
// document -- a HUD, a menu, a loading screen -- and every part can be pinned
// (the theme's pins, the layout's choices) or overridden by id afterwards.
//
//   const hud = generateHud({ seed: race.seed, culture: race.flavour });
//   const ui = createUi({ theme: hud.theme, width, height });
//   ui.load(hud.screen);
//   ui.set("res.mass", { text: "{icon:mass} {tab}350{/}" });
//
// The seed picks the layout (a full-width console or floating islands, which
// side the minimap is on, a top strip or resource pills, button size and
// spacing) within what the culture likes; the same seed and culture always
// give the same screen.

import { createRoll, deriveSeed, stream } from "@keel-engine/core";
import type { Stream } from "@keel-engine/core";
import { overrideDoc } from "./doc.ts";
import type { NodeDoc, ScreenDoc } from "./doc.ts";
import { frameShape, frameTemplate } from "./frames.ts";
import type { EdgeKind, TrimKind } from "./silhouette.ts";
import { cultureOf, generateTheme } from "./theme.ts";
import type { Culture, Theme, ThemePins } from "./theme.ts";

export interface ResourceSlot { readonly id: string; readonly icon: string; readonly value?: string; readonly tip?: string }
export interface CommandButton { readonly icon: string; readonly hotkey?: string; readonly tip?: string; readonly action?: string; readonly text?: string }

export interface HudSlots {
  /** Resource readouts (default: mass, energy, supply). A number takes that many of the defaults. */
  readonly resources?: number | readonly ResourceSlot[];
  /** The command card (default 5 x 3; row 1 is move, stop, hold, patrol, attack). false leaves it out. */
  readonly commandCard?: boolean | { readonly cols?: number; readonly rows?: number; readonly buttons?: readonly (CommandButton | null)[] };
  readonly minimap?: boolean | { readonly hole?: boolean };
  /** The selection panel: the unit's name, health, shield, armour and damage -- and a group of units. */
  readonly selection?: boolean | { readonly group?: number };
  readonly portrait?: boolean;
  /** Production queue slots (0 for none). */
  readonly queue?: number;
  readonly clock?: boolean;
  readonly alerts?: boolean;
  readonly idle?: boolean;
  readonly menu?: boolean;
  /** The classic console's top-left buttons (default: the menu, F10). Ids are `menu.<id>`, except the menu's own `menu`. */
  readonly menuButtons?: readonly MenuButton[];
}

/** A top-left button of the classic console. */
export interface MenuButton { readonly id: string; readonly text?: string; readonly icon?: string; readonly hotkey?: string; readonly tip?: string; readonly action?: string }

/** Layout choices a HUD's seed makes; pin any of them. */
export interface HudLayout {
  /** "console": one full-width bottom panel; "islands": floating panels in the corners. */
  readonly style?: "console" | "islands";
  /** Minimap on the right, command card on the left. */
  readonly mirror?: boolean;
  /** Resources in a full-width strip, or as pills top right. */
  readonly top?: "strip" | "pills";
  /** A command button's side (px). */
  readonly cell?: number;
  readonly gap?: number;
  /** See-through panels (every other fill pixel). */
  readonly mesh?: boolean;
  /**
   * "classic": the late-90s strategy console. One full-width bottom panel `console` high; in it the minimap
   * bottom-left, the selection in the centre (one unit's readout -- name, rank, health, shield, energy, attack,
   * armour, the production queue and its progress bar -- or a grid of the group's wireframes), the portrait
   * centre-right and the command card bottom-right; menu buttons top-left, resources top-right, the alert lines
   * and the idle-worker button just above the console. The same layout for every seed and culture: only the theme
   * (frames, font, icons, palette) and the console's silhouette change, so races look different and play the same.
   */
  readonly preset?: "classic";
  /** The bottom console's height as a share of the UI's height (0.15..0.4; the classic preset's default 0.25). */
  readonly console?: number;
}

export interface GenerateOptions {
  readonly seed?: string | number;
  /** A culture, or an RTS race's flavour (Machine, Biotic...). */
  readonly culture?: Culture | string;
  /** The UI's own size (layer pixels: the screen over the UI scale). Default 640 x 360. */
  readonly width?: number;
  readonly height?: number;
  readonly pins?: ThemePins;
  /** Use this theme instead of generating one. */
  readonly theme?: Theme;
  /** Props by node id, applied last (null removes a node). */
  readonly overrides?: Readonly<Record<string, Partial<NodeDoc> | null>>;
}

export interface HudOptions extends GenerateOptions {
  readonly slots?: HudSlots;
  readonly layout?: HudLayout;
}

export interface Generated {
  readonly theme: Theme;
  readonly screen: ScreenDoc;
}

const DEFAULT_RESOURCES: readonly ResourceSlot[] = [
  { id: "mass", icon: "mass", value: "0", tip: "{accent}Mass{/}: builds and trains" },
  { id: "energy", icon: "energy", value: "0", tip: "{warn}Energy{/}: powers abilities" },
  { id: "supply", icon: "supply", value: "0/10", tip: "{warn}Supply{/}: used / cap" },
  { id: "crystal", icon: "crystal", value: "0" },
  { id: "flux", icon: "flux", value: "0" },
];
const GRID_KEYS = ["QWERT", "ASDFG", "ZXCVB", "12345"];
const DEFAULT_COMMANDS: readonly (CommandButton | null)[] = [
  { icon: "move", tip: "{bright}Move{/}" }, { icon: "stop", tip: "Stop" }, { icon: "hold", tip: "Hold position" }, { icon: "patrol", tip: "Patrol" }, { icon: "attack", tip: "{bad}Attack{/}" },
  { icon: "gather", tip: "Gather" }, { icon: "repair", tip: "Repair" }, { icon: "build", tip: "Build" }, { icon: "upgrade", tip: "Upgrade" }, { icon: "research", tip: "Research" },
  { icon: "train", tip: "Train" }, { icon: "rally", tip: "Set rally point" }, { icon: "ability", tip: "Ability" }, { icon: "cloak", tip: "Cloak" }, { icon: "cancel", tip: "Cancel" },
];

const hudStream = (seed: string | number, culture: string, what: string): Stream => stream(createRoll(deriveSeed(`${seed}/${culture}`, `ui/${what}`)), 0);

const ISLANDS: Readonly<Record<Culture, number>> = { industrial: 0.25, organic: 0.75, crystalline: 0.7, arcane: 0.55, brutal: 0.1, clean: 0.8 };

/** A whole RTS HUD from a seed and a culture: the theme, and the screen's layout document. */
export function generateHud(o: HudOptions = {}): Generated {
  const seed = o.seed ?? 1;
  const culture = cultureOf(String(o.culture ?? o.theme?.culture ?? "clean"));
  const theme = o.theme ?? generateTheme({ seed, culture, pins: o.pins ?? {} });
  const W = o.width ?? 640, H = o.height ?? 360;
  const S = hudStream(seed, culture, "hud");
  const slots = o.slots ?? {};
  const L = o.layout ?? {};
  // (Every choice drawn, pinned or not, so a pin never moves another.)
  const drawn = {
    style: S.chance(ISLANDS[culture]) ? "islands" as const : "console" as const,
    mirror: S.chance(0.2),
    top: S.chance(culture === "brutal" || culture === "industrial" ? 0.75 : 0.35) ? "strip" as const : "pills" as const,
    cell: Math.max(14, Math.min(28, Math.floor(H / 16) + S.int(-1, 1))),
    gap: S.pick([1, 1, 2]),
    mesh: S.chance(culture === "crystalline" ? 0.4 : 0.08),
  };
  if (L.preset === "classic" || L.console !== undefined) {
    const root = classicConsole(theme, W, H, slots, L, meshOf(L.mesh ?? false));
    return { theme, screen: { screen: "hud", theme: theme.recipe, root: o.overrides ? overrideDoc(root, o.overrides) : root } };
  }
  const style = L.style ?? drawn.style, mirror = L.mirror ?? drawn.mirror, top = L.top ?? drawn.top;
  const cell = L.cell ?? drawn.cell, gap = L.gap ?? drawn.gap, mesh = L.mesh ?? drawn.mesh;
  const meshProp = mesh ? { mesh: true } : {};
  const u = theme.space.unit;

  // --- Top: resources, clock, menu.
  const resources = typeof slots.resources === "number" ? DEFAULT_RESOURCES.slice(0, slots.resources) : slots.resources ?? DEFAULT_RESOURCES.slice(0, 3);
  const readout = (r: ResourceSlot): NodeDoc => ({ type: "label", id: `res.${r.id}`, text: `{icon:${r.icon}} {tab}${r.value ?? "0"}{/}`, font: "body", ...(r.tip ? { tip: r.tip } : {}), minW: cell * 2 + 12 });
  const topKids: NodeDoc[] = [];
  const clock: NodeDoc | null = slots.clock === false ? null : { type: "label", id: "clock", text: "{tab}00:00{/}", tone: "dim" };
  const menu: NodeDoc | null = slots.menu === false ? null : { type: "button", id: "menu", icon: "menu", hotkey: "F10", iconSize: Math.max(10, cell - 8), tip: "Menu", action: "menu", w: cell, h: cell - 4 };
  const topStrip: NodeDoc = top === "strip"
    ? { type: "panel", id: "top", anchor: "t", w: "fill", dir: "row", align: "center", gap: u * 2, pad: Math.max(2, u), ...meshProp, children: [
        ...resources.map(readout), { type: "spacer", w: "fill" }, ...(clock ? [clock] : []), ...(menu ? [menu] : []),
      ] }
    : { type: "row", id: "top", anchor: "tr", x: 2, y: 2, gap: u, align: "center", children: [
        ...resources.map((r) => ({ type: "panel" as const, dir: "row" as const, pad: Math.max(2, u), ...meshProp, children: [readout(r)] })),
        ...(clock ? [{ type: "panel" as const, pad: Math.max(2, u), ...meshProp, children: [clock] }] : []), ...(menu ? [menu] : []),
      ] };
  topKids.push(topStrip);

  // --- Command card.
  const cc = slots.commandCard === false ? null : typeof slots.commandCard === "object" ? slots.commandCard : {};
  let card: NodeDoc | null = null;
  if (cc) {
    const cols = cc.cols ?? 5, rows = cc.rows ?? 3;
    const buttons = cc.buttons ?? DEFAULT_COMMANDS;
    const kids: NodeDoc[] = [];
    for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
      const b = buttons[r * cols + c];
      const key = GRID_KEYS[r]?.[c];
      kids.push(b
        ? { type: "button", id: `cmd.${r}.${c}`, icon: b.icon, iconSize: Math.max(10, cell - 6), ...(b.hotkey ?? key ? { hotkey: b.hotkey ?? key! } : {}), ...(b.tip ? { tip: b.tip } : {}), action: b.action ?? b.icon, ...(b.text ? { text: b.text } : {}) }
        : { type: "button", id: `cmd.${r}.${c}`, disabled: true, focusable: false });
    }
    card = { type: "grid", id: "cmd", cols, gap, cellH: cell, w: cols * cell + (cols - 1) * gap, children: kids };
  }

  // --- Minimap.
  const mm = slots.minimap === false ? null : typeof slots.minimap === "object" ? slots.minimap : {};
  const mapSide = cell * 3 + gap * 2 + Math.max(8, Math.round(cell * 0.6));
  const minimap: NodeDoc | null = mm ? { type: "minimap", id: "minimap", w: mapSide, h: mapSide, view: [0.1, 0.15, 0.3, 0.2], ...(mm.hole ? { hole: true } : {}) } : null;

  // --- Selection: portrait, name, bars, armour/damage glyphs, a group, a queue.
  const sel = slots.selection === false ? null : typeof slots.selection === "object" ? slots.selection : {};
  const queue = slots.queue ?? 5;
  const small = Math.max(10, cell - 6);
  let selection: NodeDoc | null = null;
  if (sel) {
    const info: NodeDoc = { type: "col", id: "unit", gap: Math.max(1, gap), w: "fill", children: [
      { type: "label", id: "unit.name", text: "{bright}Worker{/}", font: "body", maxLines: 1 },
      { type: "bar", id: "unit.hp", tone: "health", value: 40, max: 50, segments: 5, text: "40/50", w: "fill" },
      { type: "bar", id: "unit.shield", tone: "accent", value: 20, max: 20, w: "fill", h: 4 },
      { type: "row", gap: u * 2, children: [
        { type: "label", id: "unit.armor", text: "{icon:armor} {tab}1{/}", tip: "Armour" },
        { type: "label", id: "unit.damage", text: "{icon:damage} {tab}5{/}", tip: "Damage" },
        { type: "label", id: "unit.speed", text: "{icon:speed} {tab}3{/}", tip: "Speed" },
      ] },
      ...(queue > 0 ? [{ type: "row" as const, id: "queue", gap, children: Array.from({ length: queue }, (_, i): NodeDoc => ({ type: "button", id: `queue.${i}`, w: small + 4, h: small + 4, iconSize: small - 2, ...(i === 0 ? { icon: "train", cooldown: 0.6 } : { disabled: true, focusable: false }) })) }] : []),
    ] };
    const group = sel.group ?? 0;
    const groupGrid: NodeDoc | null = group > 0 ? { type: "grid", id: "group", cols: Math.min(8, group), gap: 1, cellH: small, w: Math.min(8, group) * (small + 1), children: Array.from({ length: group }, (_, i): NodeDoc => ({ type: "button", id: `group.${i}`, icon: "train", iconSize: small - 4, frame: "inset" })) } : null;
    const portrait: NodeDoc | null = slots.portrait === false ? null : { type: "portrait", id: "portrait", w: Math.round(mapSide * 0.72), h: Math.round(mapSide * 0.72) };
    selection = { type: "row", id: "selection", gap: u * 2, grow: 1, w: "fill", children: [...(portrait ? [portrait] : []), info, ...(groupGrid ? [groupGrid] : [])] };
  }

  // --- Alerts, idle workers.
  const alerts: NodeDoc | null = slots.alerts === false ? null : { type: "col", id: "alerts", gap: 1, children: [0, 1, 2].map((i): NodeDoc => ({ type: "label", id: `alert.${i}`, text: "", tone: "warn", shadow: true, font: "small" })) };
  const idle: NodeDoc | null = slots.idle === false ? null : { type: "button", id: "idle", icon: "worker", iconSize: Math.max(10, cell - 6), count: 0, hotkey: "F1", tip: "Idle workers", w: cell + 2, h: cell + 2 };

  // --- Bottom.
  const bottomKids: NodeDoc[] = [];
  if (style === "console") {
    const left = [minimap, selection, card].filter((n): n is NodeDoc => !!n);
    const ordered = mirror ? [card, selection, minimap].filter((n): n is NodeDoc => !!n) : left;
    bottomKids.push({ type: "panel", id: "bottom", anchor: "b", w: "fill", dir: "row", align: "end", gap: u * 2, ...meshProp, children: ordered });
    if (idle) bottomKids.push({ ...idle, anchor: mirror ? "br" : "bl", x: 3, y: mapSide + 14 });
  } else {
    if (minimap) bottomKids.push({ type: "panel", id: "map.panel", anchor: mirror ? "br" : "bl", x: 2, y: 2, ...meshProp, children: [minimap] });
    if (card) bottomKids.push({ type: "panel", id: "cmd.panel", anchor: mirror ? "bl" : "br", x: 2, y: 2, ...meshProp, children: [card] });
    if (selection) bottomKids.push({ type: "panel", id: "sel.panel", anchor: "b", y: 2, w: Math.min(Math.round(W * 0.38), W - 2 * (mapSide + 60)), ...meshProp, children: [selection] });
    if (idle) bottomKids.push({ ...idle, anchor: mirror ? "br" : "bl", x: 4, y: mapSide + 16 });
  }
  const alertBox: NodeDoc[] = alerts ? [{ ...alerts, anchor: "l", x: 3, y: 0 }] : [];

  const root: NodeDoc = { type: "canvas", id: "hud", w: "fill", h: "fill", children: [...topKids, ...alertBox, ...bottomKids] };
  const doc: ScreenDoc = { screen: "hud", theme: theme.recipe, root: o.overrides ? overrideDoc(root, o.overrides) : root };
  return { theme, screen: doc };
}

const meshOf = (on: boolean): { mesh?: boolean } => (on ? { mesh: true } : {});

/** The classic console's silhouette: the highest a trim rises over its top edge, in `lift`s (H / 60). */
const TRIM_RISE = 4;
/** Each culture's trim over the minimap, the selection, the portrait and the card: [kind, rise in lifts] (null: none). */
const TRIMS: Readonly<Record<Culture, ReadonlyArray<readonly [TrimKind | null, number]>>> = {
  organic: [["lobe", 4], [null, 0], ["lobe", 3.6], ["lobe", 3.2]],
  industrial: [["plate", 3], ["plate", 3], ["plate", 3], ["plate", 3]],
  crystalline: [[null, 0], ["spikes", 2.5], ["spikes", 2], ["facet", 4]],
  arcane: [[null, 0], ["arch", 4], [null, 0], [null, 0]],
  brutal: [["teeth", 3], ["teeth", 2], ["teeth", 3], [null, 0]],
  clean: [["rail", 3], ["rail", 3], ["rail", 3], ["rail", 3]],
};
/** Each culture's cut along the console's top edge (silhouette.ts edgeProfile). */
const EDGES: Readonly<Record<Culture, EdgeKind>> = { organic: "bites", industrial: "steps", crystalline: "vees", arcane: "arcs", brutal: "crenel", clean: "flat" };

/** The classic preset (see HudLayout.preset): every size from the UI's height, the same for every theme. */
function classicConsole(theme: Theme, W: number, H: number, slots: HudSlots, L: HudLayout, mesh: { mesh?: boolean }): NodeDoc {
  const u = theme.space.unit;
  const share = Math.max(0.15, Math.min(0.4, L.console ?? 0.25));
  const consoleH = Math.round(H * share);
  const band = frameTemplate(frameShape(theme, "panel")).band;
  // (The console's padding and gaps are explicit and the same for every theme -- room for the widest frame band --
  // so every size inside it is known here, whole pixels, and two races' consoles line up pixel for pixel.)
  const pad = Math.max(6, Math.round(H / 60));
  const gap = L.gap ?? 2;
  const wide = Math.max(3, Math.round(H / 120));
  const IH = consoleH - 2 * pad;
  const kids: NodeDoc[] = [];
  // --- The command card: its cells fill the console's height.
  const cc = slots.commandCard === false ? null : typeof slots.commandCard === "object" ? slots.commandCard : {};
  const cols = cc?.cols ?? 5, rows = cc?.rows ?? 3;
  const cell = L.cell ?? Math.max(10, Math.floor((IH - gap * (rows - 1)) / rows));
  let card: NodeDoc | null = null;
  if (cc) {
    const buttons = cc.buttons ?? DEFAULT_COMMANDS;
    const cells: NodeDoc[] = [];
    for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
      const b = buttons[r * cols + c];
      const key = GRID_KEYS[r]?.[c];
      cells.push(b
        ? { type: "button", id: `cmd.${r}.${c}`, icon: b.icon, iconSize: Math.max(8, cell - 2 * band - 2), ...(b.hotkey ?? key ? { hotkey: b.hotkey ?? key! } : {}), ...(b.tip ? { tip: b.tip } : {}), action: b.action ?? b.icon, ...(b.text ? { text: b.text } : {}) }
        : { type: "button", id: `cmd.${r}.${c}`, disabled: true, focusable: false });
    }
    card = { type: "grid", id: "cmd", cols, gap, cellH: cell, w: cols * cell + (cols - 1) * gap, h: rows * cell + (rows - 1) * gap, children: cells };
  }
  // --- The minimap: a square the console's inner height.
  const mm = slots.minimap === false ? null : typeof slots.minimap === "object" ? slots.minimap : {};
  const minimap: NodeDoc | null = mm ? { type: "minimap", id: "minimap", w: IH, h: IH, view: [0.1, 0.15, 0.3, 0.2], ...(mm.hole ? { hole: true } : {}) } : null;
  // --- The portrait: a little narrower than tall.
  const portrait: NodeDoc | null = slots.portrait === false ? null : { type: "portrait", id: "portrait", w: Math.round(IH * 0.86), h: IH };
  // --- The selection, centre: one unit's readout, or the group grid (the game shows one, hides the other).
  const sel = slots.selection === false ? null : typeof slots.selection === "object" ? slots.selection : {};
  let selection: NodeDoc | null = null;
  if (sel) {
    const queue = slots.queue ?? 5;
    const q = Math.max(10, Math.min(cell - 4, Math.floor(IH * 0.26)));
    const barH = Math.max(5, theme.type.small + 5);
    // (A wrapping line needs its width up front: what the console leaves the readout.)
    const infoW = Math.max(40, W - 2 * pad - (minimap ? IH + wide : 0) - (portrait ? Math.round(IH * 0.86) + wide : 0) - (card ? cols * cell + (cols - 1) * gap + wide : 0) - 2);
    const stat = (id: string, icon: string, tip: string): NodeDoc => ({ type: "label", id, text: `{icon:${icon}} {tab}0{/}`, tip, font: "small", maxLines: 1 });
    const queueRow: NodeDoc = { type: "row", id: "queue", gap, align: "center", w: "fill", children: [
      ...Array.from({ length: queue }, (_, i): NodeDoc => ({ type: "button", id: `queue.${i}`, w: q, h: q, iconSize: Math.max(6, q - 2 * band - 2), ...(i === 0 ? { icon: "train", cooldown: 0.6 } : { disabled: true, focusable: false }) })),
      { type: "bar", id: "queue.bar", tone: "accent", value: 0.4, max: 1, w: "fill", h: barH, text: "" },
    ] };
    // One unit, top to bottom: its name, its rank, health (and shield), the stats in a row, what it is; and at the
    // bottom the production queue (a building) or its detail line (a unit: orders, cargo) -- the panel used top to bottom.
    const info: NodeDoc = { type: "col", id: "unit", gap: 1, w: "fill", h: "fill", children: [
      { type: "row", gap: wide * 2, w: "fill", align: "center", children: [
        { type: "label", id: "unit.name", text: "{bright}Worker{/}", font: "body", maxLines: 1, w: "fill" },
        { type: "row", id: "unit.stats", gap: wide * 2, children: [stat("unit.damage", "damage", "Attack"), stat("unit.armor", "armor", "Armour"), stat("unit.speed", "speed", "Speed")] },
      ] },
      { type: "label", id: "unit.rank", text: "", tone: "dim", font: "small", maxLines: 1 },
      { type: "row", id: "unit.bars", gap: 2, w: "fill", children: [
        { type: "bar", id: "unit.hp", tone: "health", value: 40, max: 50, segments: 10, text: "40/50", w: "fill", h: barH },
        { type: "bar", id: "unit.shield", tone: "accent", value: 20, max: 20, w: "38%", h: barH, text: "" },
      ] },
      { type: "bar", id: "unit.energy", tone: "warn", value: 0, max: 1, w: "fill", h: Math.max(3, Math.floor(barH / 2)), hidden: true },
      { type: "label", id: "unit.info", text: "", tone: "dim", font: "small", wrap: true, maxLines: 2, w: infoW },
      { type: "spacer", h: "fill" },
      { type: "label", id: "unit.detail", text: "", font: "small", wrap: true, maxLines: 2, w: infoW, hidden: true },
      ...(queue > 0 ? [queueRow] : []),
    ] };
    // The group fills the panel: its cells in the rows that keep them squarest (2 x 6 for 12 units), as big as the
    // console allows, across the panel's width; what's in it (a line a type) in a column at the right, centred up and
    // down. Every size is from the console's own numbers, so every theme's group lines up too. (Hide `group.summary`
    // and the cells widen into its column.)
    const group = sel.group ?? 12;
    const selW = W - 2 * pad - (minimap ? IH + wide : 0) - (portrait ? Math.round(IH * 0.86) + wide : 0) - (card ? cols * cell + (cols - 1) * gap + wide : 0);
    const room = Math.max(10, selW - Math.max(36, Math.round(selW * 0.28)) - wide);
    let gRows = 1, gCols = Math.max(1, group), gW = 8, gH = 8, best = -Infinity;
    for (let r = 1; r <= 4; r += 1) {
      const c = Math.max(1, Math.ceil(group / r));
      const cw = Math.floor((room - gap * (c - 1)) / c), ch = Math.floor((IH - gap * (r - 1)) / r);
      const score = Math.min(cw, ch) - Math.abs(cw - ch) * 0.25;
      if (cw >= 8 && ch >= 8 && score > best) { best = score; gRows = r; gCols = c; gW = cw; gH = ch; }
    }
    const groupGrid: NodeDoc | null = group > 0 ? { type: "row", id: "group", gap: wide, w: "fill", h: "fill", align: "stretch", hidden: true, children: [
      // (Reflowing: the cells that show fill the grid -- one unit one big cell, 3-4 one row, 6 two rows of three, 12 two
      // of six -- and each icon as big as its cell: `ui.iconSizeOf("group.<i>")` says how big, for a game's wireframes.)
      { type: "grid", id: "group.cells", cols: gCols, gap, cellH: gH, reflow: true, w: "fill", h: gRows * gH + (gRows - 1) * gap, children: Array.from({ length: group }, (_, i): NodeDoc => ({ type: "button", id: `group.${i}`, icon: "train", iconSize: Math.max(8, Math.min(gW, gH) - 2 * band - 2), iconFill: true, frame: "inset", action: `group.${i}` })) },
      { type: "label", id: "group.summary", text: "", font: "small", w: Math.max(8, selW - (gCols * gW + (gCols - 1) * gap) - wide), h: "fill", textAlign: "center", wrap: true, maxLines: Math.max(2, Math.floor(IH / (theme.type.small + 5))) },
    ] } : null;
    selection = { type: "row", id: "selection", gap: wide, w: "fill", h: "fill", align: "stretch", children: [info, ...(groupGrid ? [groupGrid] : [])] };
  }
  const row = [minimap, selection, portrait, card].filter((n): n is NodeDoc => !!n);
  // --- The console's silhouette, from the culture: the same layout, a different outline against the world. Four trim
  // nodes stand behind the console's top edge, one over each part (minimap, selection, portrait, card) -- the same
  // rectangles for every culture -- and the culture draws its own shape in each (silhouette.ts): organic lobes over the
  // minimap, portrait and card with the edge between bitten; industrial stepped, bolted plates the whole width;
  // crystalline shards over the selection and a cut crest over the card; one arcane arch over the selection, the
  // edge cut in shallow arcs; brutal toothed slabs; a clean thin rail held high on posts. Only what rises above the
  // console shows; the console's own top edge is cut the culture's way too (EDGES).
  const portraitW = portrait ? Math.round(IH * 0.86) : 0, cardW = card ? cols * cell + (cols - 1) * gap : 0;
  const lift = Math.max(4, Math.round(H / 60));
  const rise = TRIM_RISE * lift, foot = Math.max(3, Math.round(lift / 2));
  const half = wide >> 1;
  const cardX = W - pad - cardW, portraitX = cardX - (card ? wide : 0) - portraitW, mapR = minimap ? pad + IH : pad - wide;
  const edges = [0, mapR + half, portraitX - wide + half, cardX - (card ? wide : 0) + half, W];
  const kinds = TRIMS[theme.culture];
  for (let i = 0; i < 4; i += 1) {
    const [kind, up] = kinds[i]!;
    kids.push({ type: "panel", id: `trim.${i}`, anchor: "bl", x: edges[i]!, y: consoleH - foot, w: Math.max(1, edges[i + 1]! - edges[i]!), h: rise + foot, ...(kind ? { trim: `${kind} ${Math.max(2, Math.round(up * lift))} ${foot}` } : { frame: "none" as const }), ...mesh });
  }
  // (And the console's own top edge, cut the culture's way -- as deep as its padding allows, never into what's in it.)
  const edge = EDGES[theme.culture];
  kids.push({ type: "panel", id: "bottom", anchor: "b", w: "fill", h: consoleH, pad, dir: "row", align: "center", gap: wide, tipDock: true, ...(edge !== "flat" ? { edge: `${edge} ${Math.max(2, pad - 2)}` } : {}), ...mesh, children: row });
  // --- Top right: the resources and the clock, as pills.
  const resources = typeof slots.resources === "number" ? DEFAULT_RESOURCES.slice(0, slots.resources) : slots.resources ?? DEFAULT_RESOURCES.slice(0, 3);
  const pill = (child: NodeDoc): NodeDoc => ({ type: "panel", dir: "row", pad: Math.max(3, u + 1), ...mesh, children: [child] });
  kids.push({ type: "row", id: "top", anchor: "tr", x: 2, y: 2, gap: u, align: "center", children: [
    ...resources.map((r) => pill({ type: "label", id: `res.${r.id}`, text: `{icon:${r.icon}} {tab}${r.value ?? "0"}{/}`, font: "body", ...(r.tip ? { tip: r.tip } : {}), minW: Math.max(40, cell * 2) })),
    ...(slots.clock === false ? [] : [pill({ type: "label", id: "clock", text: "{tab}00:00{/}", tone: "dim" })]),
  ] });
  // --- Top left: the menu buttons. Their icons drawn big enough to read (11 px at 640x360) with the buttons tall enough
  // for them, and every size from the UI's height -- room for the widest culture's type -- so each race's buttons
  // have the same rectangles.
  if (slots.menu !== false) {
    const list = slots.menuButtons ?? [{ id: "menu", text: "Menu", icon: "menu", hotkey: "F10", tip: "Game menu {dim}(F10){/}", action: "menu" }];
    const mIcon = Math.max(9, Math.round(H / 32)), mPad = 4, charW = Math.max(8, Math.round(H / 36));
    kids.push({ type: "row", id: "menus", anchor: "tl", x: 2, y: 2, gap: 2, children: list.map((b): NodeDoc => ({
      type: "button", id: b.id === "menu" ? "menu" : `menu.${b.id}`, ...(b.text ? { text: b.text, font: "small" as const } : {}), ...(b.icon ? { icon: b.icon, iconSize: mIcon } : {}),
      ...(b.hotkey ? { hotkey: b.hotkey } : {}), ...(b.tip ? { tip: b.tip } : {}), action: b.action ?? b.id, pad: mPad,
      w: 2 * mPad + (b.icon ? mIcon + 3 : 0) + (b.text?.length ?? 0) * charW + (b.hotkey && b.text ? b.hotkey.length * charW + 6 : 0), h: mIcon + 2 * mPad,
    })) });
  }
  // --- Just above the console (over its silhouette): the idle-worker button, the alert lines beside it.
  const idleW = cell + 2;
  if (slots.idle !== false) kids.push({ type: "button", id: "idle", icon: "worker", iconSize: Math.max(8, cell - 2 * band - 4), count: 0, hotkey: "F1", tip: "Idle workers {dim}(F1){/}", anchor: "bl", x: 2, y: consoleH + rise + 2, w: idleW, h: idleW });
  // (Each alert line on its own backing strip -- readable over any ground -- hidden while it has nothing to say.)
  if (slots.alerts !== false) kids.push({ type: "col", id: "alerts", anchor: "bl", x: idleW + 6, y: consoleH + rise + 2, gap: 1, children: [0, 1, 2].map((i): NodeDoc => ({ type: "label", id: `alert.${i}`, text: "", tone: "warn", frame: "tooltip", font: "small", maxW: Math.round(W * 0.6), maxLines: 1, hidden: true })) });
  return { type: "canvas", id: "hud", w: "fill", h: "fill", children: kids };
}

export interface MenuItem { readonly text: string; readonly action?: string; readonly hotkey?: string; readonly primary?: boolean; readonly disabled?: boolean }
export interface MenuOptions extends GenerateOptions {
  readonly title?: string;
  readonly subtitle?: string;
  readonly items?: readonly MenuItem[];
  readonly footer?: string;
  readonly layout?: { readonly style?: "center" | "left" | "bottom"; readonly mesh?: boolean };
}

/** A menu screen: a title, a column (or row) of buttons, a backdrop in the theme's texture. */
export function generateMenu(o: MenuOptions = {}): Generated {
  const seed = o.seed ?? 1;
  const culture = cultureOf(String(o.culture ?? o.theme?.culture ?? "clean"));
  const theme = o.theme ?? generateTheme({ seed, culture, pins: o.pins ?? {} });
  const S = hudStream(seed, culture, "menu");
  const drawnStyle = S.pick(["center", "center", "left", "bottom"] as const);
  const style = o.layout?.style ?? drawnStyle;
  const items = o.items ?? [{ text: "Play", action: "play", primary: true }, { text: "Armies", action: "armies" }, { text: "Settings", action: "settings" }, { text: "Quit", action: "quit" }];
  const W = o.width ?? 640;
  const bw = Math.max(80, Math.round(W * (style === "bottom" ? 0.14 : 0.22)));
  const buttons: NodeDoc[] = items.map((it, i) => ({
    type: "button", id: `menu.${it.action ?? i}`, text: it.text, action: it.action ?? `item${i}`, w: bw, h: theme.type.body + 12,
    ...(it.hotkey ? { hotkey: it.hotkey } : {}), ...(it.primary ? { primary: true } : {}), ...(it.disabled ? { disabled: true } : {}),
  }));
  const title: NodeDoc = { type: "label", id: "menu.title", text: o.title ?? "MYRIAD", font: "display", tone: "bright", shadow: true, caps: theme.type.caps };
  const subtitle: NodeDoc | null = o.subtitle ? { type: "label", id: "menu.subtitle", text: o.subtitle, tone: "accent" } : null;
  const heading: NodeDoc = { type: "col", gap: 2, align: style === "left" ? "start" : "center", children: [title, ...(subtitle ? [subtitle] : [])] };
  const list: NodeDoc = { type: style === "bottom" ? "row" : "col", id: "menu.items", gap: theme.space.gap + 1, children: buttons };
  const footer: NodeDoc = { type: "label", id: "menu.footer", text: o.footer ?? "v0.1", tone: "dim", font: "small", anchor: "br", x: 4, y: 3 };
  const kids: NodeDoc[] = style === "center"
    ? [{ type: "panel", id: "menu.panel", anchor: "c", align: "center", gap: theme.space.gap * 3, pad: theme.space.pad + 6, children: [heading, list] }]
    : style === "left"
      ? [{ ...heading, anchor: "tl", x: 24, y: 24 }, { type: "panel", id: "menu.panel", anchor: "l", x: 24, y: 20, children: [list] }]
      : [{ ...heading, anchor: "t", y: 30 }, { type: "panel", id: "menu.panel", anchor: "b", y: 24, children: [list] }];
  const root: NodeDoc = { type: "panel", id: "menu", w: "fill", h: "fill", pad: 0, dir: "free", ...(o.layout?.mesh ? { mesh: true } : {}), children: [...kids, footer] };
  return { theme, screen: { screen: "menu", theme: theme.recipe, root: o.overrides ? overrideDoc(root, o.overrides) : root } };
}

export interface LoadingOptions extends GenerateOptions {
  readonly title?: string;
  readonly tip?: string;
  readonly status?: string;
}

/** A loading screen: a title, a segmented progress bar (loading.bar), a status line, a spinner, a tip. */
export function generateLoading(o: LoadingOptions = {}): Generated {
  const seed = o.seed ?? 1;
  const culture = cultureOf(String(o.culture ?? o.theme?.culture ?? "clean"));
  const theme = o.theme ?? generateTheme({ seed, culture, pins: o.pins ?? {} });
  const S = hudStream(seed, culture, "loading");
  const W = o.width ?? 640;
  const low = S.chance(0.5);
  const segments = S.pick([0, 10, 16, 20]);
  const barW = Math.round(W * S.between(0.4, 0.6));
  const block: NodeDoc = { type: "col", id: "loading.block", anchor: low ? "b" : "c", y: low ? 28 : 0, align: "center", gap: theme.space.gap * 2, children: [
    { type: "label", id: "loading.title", text: o.title ?? "Entering the arena", font: "title", tone: "bright", shadow: true, caps: theme.type.caps },
    { type: "row", gap: theme.space.gap * 2, align: "center", children: [
      { type: "spinner", id: "loading.spinner", iconSize: 12 },
      { type: "bar", id: "loading.bar", value: 0, max: 1, segments, w: barW, h: theme.type.small + 6, tone: "accent" },
    ] },
    { type: "label", id: "loading.status", text: o.status ?? "Baking sprites…", tone: "dim", font: "small" },
  ] };
  const tip: NodeDoc = { type: "label", id: "loading.tip", text: o.tip ?? "{accent}Tip:{/} hold {warn}Shift{/} to queue orders.", anchor: low ? "t" : "b", y: low ? 24 : 20, maxW: Math.round(W * 0.7), wrap: true, textAlign: "center" };
  const root: NodeDoc = { type: "panel", id: "loading", w: "fill", h: "fill", pad: 0, dir: "free", children: [block, tip] };
  return { theme, screen: { screen: "loading", theme: theme.recipe, root: o.overrides ? overrideDoc(root, o.overrides) : root } };
}
