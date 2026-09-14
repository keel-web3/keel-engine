// The classic strategy console and what a game needs from the UI while it
// plays: hotkeys that follow a changed button at once, a minimap that answers
// the press and the drag and says which button, navigation keys a game can
// claim, the classic preset's proportions, wireframe level icons tinted per
// node, and pixel cursors from the theme.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CURSOR_KINDS, WIRE_LEVELS, createUi, generateCursor, generateHud, generateTheme, hashBitmap, wireframeOf } from "../src/index.ts";
import type { MinimapPoint, Silhouette } from "../src/index.ts";

const CULTURES = ["industrial", "organic", "crystalline", "arcane", "brutal", "clean"] as const;

test("hotkeys follow a changed button at once, even when nothing moves (no stale letter shows or fires)", () => {
  const hud = generateHud({ seed: 4, culture: "industrial" });
  const ui = createUi({ theme: hud.theme, width: 640, height: 360, scale: 1 });
  ui.load(hud.screen);
  ui.render();
  const clicks: string[] = [];
  ui.on("click", (id) => clicks.push(id));
  // The same-width letter: the badge measures the same, so no layout runs -- the key table must still follow.
  ui.set("cmd.0.0", { hotkey: "Y", action: "moved" });
  const layouts = ui.stats.layouts;
  ui.render();
  assert.equal(ui.stats.layouts, layouts, "(no layout was needed)");
  assert.ok(!ui.key("KeyQ", true), "the old letter no longer fires");
  ui.key("KeyQ", false);
  assert.ok(ui.key("KeyY", true)); ui.key("KeyY", false);
  assert.deepEqual(clicks, ["moved"]);
  // Cleared: nothing fires; given to another button: that one fires.
  ui.set("cmd.0.0", { hotkey: "" });
  assert.ok(!ui.key("KeyY", true));
  ui.set("cmd.0.1", { hotkey: "Y" });
  ui.key("KeyY", true); ui.key("KeyY", false);
  assert.deepEqual(clicks, ["moved", "stop"]);
  // Hidden: its key goes with it.
  ui.set("cmd.0.1", { hidden: true });
  assert.ok(!ui.key("KeyY", true));
});

test("the minimap answers the press, every move while held, and the release -- with the button, on its picture", () => {
  const theme = generateTheme({ seed: 3, culture: "clean" });
  const ui = createUi({ theme, width: 960, height: 540, scale: 3 });
  ui.load({ screen: "t", root: { type: "canvas", w: "fill", h: "fill", children: [
    { type: "minimap", id: "mm", anchor: "bl", x: 4, y: 4, w: 60, h: 60 },
    { type: "button", id: "b", anchor: "br", x: 4, y: 4, w: 20, h: 20, icon: "attack" },
  ] } });
  ui.render();
  const got: MinimapPoint[] = [];
  ui.on("minimap", (_id, v) => got.push(v as MinimapPoint));
  const r = ui.node("mm")!.rect;
  // Pressed with the right button at the middle of the node: a "down" at once (no waiting for the release).
  const cx = (r.x + 30) * 3, cy = (r.y + 30) * 3;
  assert.ok(ui.pointerDown(cx, cy, { button: 2 }));
  assert.equal(got.length, 1);
  assert.equal(got[0]!.phase, "down");
  assert.equal(got[0]!.button, 2);
  assert.ok(Math.abs(got[0]!.x - 0.5) < 0.03 && Math.abs(got[0]!.y - 0.5) < 0.03, `the picture's middle: ${JSON.stringify(got[0])}`);
  assert.ok(got[0]!.inside);
  // Dragged -- off the minimap too: clamped to its edge, `inside` false.
  ui.pointerMove((r.x + 45) * 3, (r.y + 30) * 3);
  ui.pointerMove((r.x + 200) * 3, (r.y - 50) * 3);
  assert.deepEqual(got.slice(1).map((p) => p.phase), ["drag", "drag"]);
  assert.ok(got[1]!.x > 0.7 && got[1]!.x < 0.8);
  assert.equal(got[2]!.x, 1); assert.equal(got[2]!.y, 0); assert.equal(got[2]!.inside, false);
  ui.pointerUp((r.x + 200) * 3, (r.y - 50) * 3, { button: 2 });
  assert.equal(got.at(-1)!.phase, "up");
  assert.equal(got.at(-1)!.button, 2);
  // A move after the release is not a drag.
  ui.pointerMove(cx, cy);
  assert.equal(got.length, 4);
  // The picture starts inside the frame: the frame's top-left corner is the picture's 0 (clamped), not a sliver in.
  ui.pointerDown((r.x + 1) * 3, (r.y + 1) * 3, { button: 0 });
  assert.equal(got.at(-1)!.x, 0);
  assert.equal(got.at(-1)!.button, 0);
  ui.pointerUp((r.x + 1) * 3, (r.y + 1) * 3);
  // A button's click says which button pressed it.
  const clicks: unknown[] = [];
  ui.on("click", (_id, v) => clicks.push(v));
  const b = ui.node("b")!.rect;
  ui.pointerDown((b.x + 5) * 3, (b.y + 5) * 3, { button: 0 }); ui.pointerUp((b.x + 5) * 3, (b.y + 5) * 3, { button: 0 });
  assert.deepEqual(clicks, [{ button: 0 }]);
});

test("navigation keys a game claims are the game's (Tab, arrows, Enter/Space), except inside a modal", () => {
  const hud = generateHud({ seed: 4, culture: "industrial" });
  const ui = createUi({ theme: hud.theme, width: 640, height: 360, scale: 1, navigation: false });
  ui.load(hud.screen);
  ui.render();
  const clicks: string[] = [];
  ui.on("click", (id) => clicks.push(id));
  // A click focuses the button it pressed; with navigation claimed, Space and Enter don't re-fire it.
  const r = ui.node("cmd.0.1")!.rect;
  ui.pointerDown(r.x + 3, r.y + 3); ui.pointerUp(r.x + 3, r.y + 3);
  assert.deepEqual(clicks, ["stop"]);
  for (const k of ["Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space", "Enter"]) {
    assert.equal(ui.key(k, true), false, `${k} is the game's`);
    ui.key(k, false);
  }
  assert.deepEqual(clicks, ["stop"], "nothing re-fired");
  assert.equal(ui.focus?.id, "cmd.0.1", "focus didn't move");
  // Hotkeys still work.
  ui.key("KeyQ", true); ui.key("KeyQ", false);
  assert.deepEqual(clicks, ["stop", "move"]);
  // A modal gets navigation back: Tab moves between its buttons.
  ui.modal({ title: "Menu", buttons: [{ text: "Resume", action: "resume" }, { text: "Quit", action: "quit" }] });
  ui.render();
  const before = ui.focus;
  assert.ok(ui.key("Tab", true));
  assert.notEqual(ui.focus, before);
  // Per key: arrows claimed, Tab left to the UI.
  const ui2 = createUi({ theme: hud.theme, width: 640, height: 360, scale: 1, navigation: { arrows: false } });
  ui2.load(hud.screen);
  assert.equal(ui2.key("ArrowLeft", true), false);
  assert.equal(ui2.key("Tab", true), true);
  ui2.navigation = { tab: false, arrows: false, enter: false };
  assert.equal(ui2.key("Tab", true), false);
});

test("the classic console preset: 22-28% of the height, minimap left, selection centre, portrait centre-right, card right; the same layout for every theme", () => {
  for (const [W, H] of [[640, 360], [480, 270], [683, 384], [640, 400]] as const) {
    let first: string | null = null;
    for (const culture of CULTURES) for (const seed of [1, 7, 42]) {
      const hud = generateHud({ seed, culture, width: W, height: H, layout: { preset: "classic" }, slots: { queue: 5, clock: true, alerts: true, idle: true, selection: { group: 12 } } });
      const ui = createUi({ theme: hud.theme, width: W, height: H, scale: 1 });
      ui.load(hud.screen);
      ui.render();
      const r = (id: string) => { const n = ui.node(id); assert.ok(n, `${id} is there`); return n.rect; };
      const bottom = r("bottom"), mm = r("minimap"), card = r("cmd"), pt = r("portrait"), sel = r("selection");
      const share = bottom.h / H;
      assert.ok(share >= 0.22 && share <= 0.28, `${culture}/${seed} ${W}x${H}: console ${bottom.h} px = ${(share * 100).toFixed(1)}%`);
      assert.equal(bottom.y + bottom.h, H, "on the bottom edge");
      assert.equal(bottom.w, W, "full width");
      assert.ok(mm.x < W * 0.05 && mm.w === mm.h && mm.y >= bottom.y, `minimap bottom-left, square: ${JSON.stringify(mm)}`);
      assert.ok(card.x + card.w >= W - 12 && card.y >= bottom.y, `card bottom-right: ${JSON.stringify(card)}`);
      const pc = pt.x + pt.w / 2, sc = sel.x + sel.w / 2;
      assert.ok(pc > W * 0.5 && pc < W * 0.85 && pt.x > sel.x + sel.w - 1 && pt.x + pt.w <= card.x, `portrait centre-right, between the selection and the card: ${JSON.stringify(pt)}`);
      assert.ok(sc > W * 0.3 && sc < W * 0.6 && sel.x >= mm.x + mm.w, `selection centre: ${JSON.stringify(sel)}`);
      assert.ok(r("top").x + r("top").w >= W - 4 && r("res.mass").x > W * 0.35 && r("res.mass").y < H * 0.1, "resources top-right");
      assert.ok(r("menu").x < W * 0.15 && r("menu").y < H * 0.1, "menu top-left");
      assert.ok(r("idle").y + r("idle").h <= bottom.y, "idle button above the console");
      assert.equal(ui.node("group")!.props.hidden, true, "the group grid waits for a multi-selection");
      // The card's cells fill the console: 3 rows of buttons as tall as it allows.
      assert.ok(r("cmd.2.4").y + r("cmd.2.4").h <= bottom.y + bottom.h - 1 && card.h >= bottom.h * 0.75, `card ${card.h} of ${bottom.h} px`);
      for (const n of ui.root.walk()) if (n.visible && n.type !== "root" && n.type !== "canvas" && n.id !== "#tooltip") {
        const q = n.rect;
        assert.ok(q.x >= 0 && q.y >= 0 && q.x + q.w <= W && q.y + q.h <= H, `${culture} ${n.id} on screen ${JSON.stringify(q)}`);
      }
      const layout = JSON.stringify(["minimap", "cmd", "portrait", "selection", "bottom"].map((id) => { const q = r(id); return [q.x, q.w, q.h]; }));
      first ??= layout;
      assert.equal(layout, first, `${culture}/${seed}: the same layout, to the pixel`);
    }
  }
  // A multi-selection: the group grid shows, the single readout hides -- 12 cells, inside the console.
  const hud = generateHud({ seed: 5, culture: "organic", layout: { preset: "classic" }, slots: { selection: { group: 12 } } });
  const ui = createUi({ theme: hud.theme, width: 640, height: 360, scale: 1 });
  ui.load(hud.screen);
  ui.set("unit", { hidden: true }); ui.set("group", { hidden: false });
  ui.render();
  const g = ui.node("group")!.rect, b = ui.node("bottom")!.rect;
  assert.ok(g.w > 0 && g.y >= b.y && g.y + g.h <= b.y + b.h, `group in the console: ${JSON.stringify(g)}`);
  assert.ok(ui.node("group.11")!.rect.w >= 20, "cells big enough to read a wireframe");
  // A custom console height.
  const tall = generateHud({ seed: 5, culture: "brutal", layout: { console: 0.3 } });
  const ut = createUi({ theme: tall.theme, width: 640, height: 360, scale: 1 });
  ut.load(tall.screen);
  assert.equal(ut.node("bottom")!.rect.h, 108);
});

/** A test silhouette: a little walker -- head, body, two legs -- with the edges between its parts. */
function walker(): Silhouette {
  const w = 14, h = 22, solid = new Uint8Array(w * h), edges = new Uint8Array(w * h);
  const box = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) solid[y * w + x] = 1; };
  box(4, 0, 9, 5); box(2, 6, 11, 14); box(3, 15, 5, 21); box(8, 15, 10, 21);
  for (let x = 2; x <= 11; x += 1) edges[6 * w + x] = 1; // (the neck line)
  for (let y = 7; y <= 14; y += 1) edges[y * w + 7] = 1; // (a seam down the chest)
  return { w, h, solid, edges };
}

test("wireframes: a silhouette as a line-drawn level icon -- contour, part edges, dithered body, a shadow ring; tinted per node", () => {
  const src = walker();
  const a = wireframeOf(src, 24), b = wireframeOf(src, 24);
  assert.deepEqual(a.levels, b.levels, "deterministic");
  const count = (lv: number, x = a) => x.levels.filter((v) => v === lv).length;
  assert.ok(count(WIRE_LEVELS.line) > 20, `a contour: ${count(WIRE_LEVELS.line)}`);
  assert.ok(count(WIRE_LEVELS.detail) > 3, `part edges: ${count(WIRE_LEVELS.detail)}`);
  assert.ok(count(WIRE_LEVELS.fill) > 5, "a sparse body");
  assert.ok(count(WIRE_LEVELS.shadow) > count(WIRE_LEVELS.line), "a shadow ring round the line");
  // Whole-pixel fit: 22 rows into 22 px of room is x1; into 46 px it's x2 (never a blurry 1.5).
  let top = 99, bottom = -1;
  for (let y = 0; y < 48; y += 1) for (let x = 0; x < 48; x += 1) if (wireframeOf(src, 48).levels[y * 48 + x]! >= WIRE_LEVELS.line) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
  assert.equal(bottom - top + 1, 44, "22 rows x 2");
  // Down: a big sprite fits a small cell by coverage, still a closed outline.
  const big: Silhouette = { w: 60, h: 40, solid: new Uint8Array(60 * 40).map((_, i) => (Math.hypot((i % 60) - 30, Math.floor(i / 60) - 20) < 18 ? 1 : 0)) };
  const small = wireframeOf(big, 16);
  assert.ok(small.levels.filter((v) => v === WIRE_LEVELS.line).length > 16);
  assert.equal(small.levels.slice(0, 16).filter((v) => v >= WIRE_LEVELS.line).length, 0, "margin kept");
  // Hollow when asked.
  assert.equal(wireframeOf(src, 24, { fill: "none" }).levels.filter((v) => v === WIRE_LEVELS.fill).length, 0);
  // Registered in a UI, each node's tone paints it: green, yellow, red -- one icon.
  const theme = generateTheme({ seed: 9, culture: "industrial" });
  const ui = createUi({ theme, width: 200, height: 60, scale: 1 });
  ui.registerIcon("wf/walker", a);
  ui.load({ screen: "t", root: { type: "row", gap: 2, children: (["good", "warn", "bad"] as const).map((tone) => ({ type: "button" as const, id: tone, icon: "wf/walker", iconSize: 24, tone, w: 30, h: 30, frame: "inset" as const })) } });
  ui.render();
  const colours = (id: string) => { const r = ui.node(id)!.rect; const s = new Set<number>(); for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) s.add(ui.layer.px[y * ui.width + x]!); return s; };
  const g = colours("good"), w = colours("warn"), r = colours("bad");
  const only = (x: Set<number>, ...others: Set<number>[]) => [...x].filter((c) => others.every((o) => !o.has(c))).length;
  assert.ok(only(g, w, r) >= 2 && only(w, g, r) >= 2 && only(r, g, w) >= 2, "three tints of one wireframe");
  // Re-registering a name repaints (a new silhouette arrived).
  const before = hashBitmap(ui.layer);
  ui.registerIcon("wf/walker", wireframeOf(big, 24));
  ui.render();
  assert.notEqual(hashBitmap(ui.layer), before);
});

test("cursors: every kind from the theme, whole-scaled, hotspot on the art, distinct per kind and per theme", () => {
  const t1 = generateTheme({ seed: 1, culture: "industrial" }), t2 = generateTheme({ seed: 2, culture: "organic" });
  for (const scale of [1, 2, 3, 6]) {
    const hashes = new Set<string>();
    for (const kind of CURSOR_KINDS) {
      const c = generateCursor(kind, t1, { scale });
      assert.equal(hashBitmap(c.bitmap), hashBitmap(generateCursor(kind, t1, { scale }).bitmap), "deterministic");
      assert.ok(c.bitmap.w <= 128 && c.bitmap.h <= 128, `${kind} x${scale}: ${c.bitmap.w}x${c.bitmap.h} (browsers cap cursors at 128)`);
      assert.equal(c.bitmap.w % c.scale, 0); assert.equal(c.bitmap.h % c.scale, 0);
      assert.ok(c.scale >= 1 && c.scale <= scale, "never more than asked");
      assert.ok(c.hotspot[0] >= 0 && c.hotspot[1] >= 0 && c.hotspot[0] < c.bitmap.w && c.hotspot[1] < c.bitmap.h, `${kind}: hotspot on the art`);
      assert.ok(c.bitmap.px.some((p) => p !== 0));
      // Whole-pixel scaling: every k x k block one colour.
      const k = c.scale;
      for (let y = 0; y < c.bitmap.h; y += k) for (let x = 0; x < c.bitmap.w; x += k) { const v = c.bitmap.px[y * c.bitmap.w + x]; assert.equal(c.bitmap.px[(y + k - 1) * c.bitmap.w + x + k - 1], v); }
      hashes.add(hashBitmap(c.bitmap));
    }
    assert.equal(hashes.size, CURSOR_KINDS.length, `x${scale}: every kind its own picture`);
  }
  // Crosshairs centre their hotspot; the pointer's is its tip.
  const tc = generateCursor("target", t1);
  assert.equal(tc.hotspot[0], (tc.bitmap.w - 1) / 2);
  assert.deepEqual(generateCursor("select", t1).hotspot, [1, 1]);
  let differ = 0;
  for (const kind of CURSOR_KINDS) if (hashBitmap(generateCursor(kind, t1, { scale: 2 }).bitmap) !== hashBitmap(generateCursor(kind, t2, { scale: 2 }).bitmap)) differ += 1;
  assert.equal(differ, CURSOR_KINDS.length, "two themes, two sets");
});

test("a labelled button keeps its hotkey in a keycap beside the label, never over it", () => {
  const theme = generateTheme({ seed: 6, culture: "industrial" });
  const ui = createUi({ theme, width: 200, height: 60, scale: 1 });
  ui.load({ screen: "t", root: { type: "row", gap: 4, children: [
    { type: "button", id: "plain", text: "Menu" },
    { type: "button", id: "keyed", text: "Menu", hotkey: "F10" },
  ] } });
  ui.render();
  const a = ui.node("plain")!.rect, b = ui.node("keyed")!.rect;
  assert.ok(b.w >= a.w + 12, `room for the keycap: ${a.w} -> ${b.w}`);
  // The label draws the same pixels in both, shifted right by the keycap: compare the rightmost columns.
  const col = (r: { x: number; y: number; w: number; h: number }, dx: number) => Array.from({ length: r.h }, (_, y) => ui.layer.px[(r.y + y) * ui.width + r.x + r.w - dx]);
  let same = 0;
  for (let dx = 3; dx < a.w - 3; dx += 1) if (JSON.stringify(col(a, dx)) === JSON.stringify(col(b, dx))) same += 1;
  assert.ok(same >= a.w - 8, `the label is intact (${same} of ${a.w - 6} columns match)`);
});

test("a console docks its tooltips: they show just above it, never over the panel they explain; disabled icons still read", () => {
  const hud = generateHud({ seed: 3, culture: "industrial", layout: { preset: "classic" }, slots: { commandCard: { buttons: [{ icon: "attack", tip: "{bad}Attack{/} [T]\nA long enough line to make a real tooltip box." }] } } });
  const ui = createUi({ theme: hud.theme, width: 640, height: 360, scale: 1 });
  ui.load(hud.screen);
  ui.render();
  const b = ui.node("cmd.0.0")!.rect, bottom = ui.node("bottom")!.rect;
  ui.pointerMove(b.x + 4, b.y + 4);
  ui.update(0.5); ui.render();
  const tip = ui.node("#tooltip")!;
  assert.ok(!tip.props.hidden);
  assert.ok(tip.rect.y + tip.rect.h <= bottom.y, `above the console: tip ${JSON.stringify(tip.rect)}, console at ${bottom.y}`);
  assert.ok(tip.rect.x + tip.rect.w <= 640 && tip.rect.x >= 0);
  // A disabled cell with an icon: the icon's pixels survive the dimming (it's drawn over it).
  ui.set("cmd.0.0", { disabled: true });
  ui.pointerMove(1, 1);
  ui.render();
  const colours = new Set<number>();
  for (let y = b.y + 3; y < b.y + b.h - 3; y += 1) for (let x = b.x + 3; x < b.x + b.w - 3; x += 1) colours.add(ui.layer.px[y * ui.width + x]!);
  assert.ok(colours.size >= 4, `the disabled icon still draws (${colours.size} colours)`);
});
