// Widgets: layout in whole pixels, hit-testing and clicks, hotkeys, focus
// (keyboard and pad), tooltips, dirty rectangles, layout documents through
// the codec, overrides, and the generated screens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { UI_SCREEN, UiNode, buildNode, createUi, decodeScreen, docOf, encodeScreen, generateHud, generateLoading, generateMenu, generateTheme, hashBitmap, keyName, mergeRects, uiScaleFor } from "../src/index.ts";
import type { NodeDoc } from "../src/index.ts";
import { toJSON } from "@keel-engine/codec";

const theme = generateTheme({ seed: 11, culture: "clean" });
const ui1 = (doc: NodeDoc, w = 320, h = 180) => { const ui = createUi({ theme, width: w, height: h, scale: 1 }); ui.load({ screen: "t", root: doc }); ui.render(); return ui; };

test("layout: rows, columns and grids in whole pixels; fill and grow share leftovers; anchors place", () => {
  const ui = ui1({ type: "canvas", w: "fill", h: "fill", children: [
    { type: "row", id: "r", w: 101, h: 20, gap: 2, children: [{ type: "spacer", id: "a", w: "fill" }, { type: "spacer", id: "b", w: "fill", grow: 2 }, { type: "spacer", id: "c", w: 10 }] },
    { type: "grid", id: "g", anchor: "br", x: 3, y: 4, cols: 3, gap: 1, cellH: 10, w: 32, children: Array.from({ length: 6 }, (_, i): NodeDoc => ({ type: "button", id: `g${i}` })) },
    { type: "label", id: "l", anchor: "c", text: "centred" },
  ] });
  const r = (id: string) => ui.node(id)!.rect;
  // 101 - 2 gaps - 10 = 87 to share 1:2 -> 29 and 58.
  assert.deepEqual([r("a").w, r("b").w, r("c").w], [29, 58, 10]);
  assert.equal(r("b").x, r("a").x + 29 + 2);
  const g = r("g");
  assert.equal(g.x + g.w, 320 - 3, "anchored bottom-right, inset 3");
  assert.equal(g.y + g.h, 180 - 4);
  assert.equal(r("g0").w, 10, "(32 - 2 gaps) / 3 = 10");
  assert.equal(r("g4").x, r("g0").x + 11);
  assert.equal(r("g4").y, r("g0").y + 11);
  const l = r("l");
  assert.equal(l.x, Math.floor((320 - l.w) / 2));
  for (const n of ui.root.walk()) for (const v of [n.rect.x, n.rect.y, n.rect.w, n.rect.h]) assert.ok(Number.isInteger(v));
});

test("scale and safe area: the layer is the screen over a whole scale; insets move the root", () => {
  assert.equal(uiScaleFor(1920, 1080), 3);
  assert.equal(uiScaleFor(2560, 1440), 4);
  assert.equal(uiScaleFor(3840, 2160), 6);
  assert.equal(uiScaleFor(1920, 1080, [480, 270]), 4);
  const ui = createUi({ theme, width: 1920, height: 1080, safe: { top: 30, left: 60 } });
  assert.equal(ui.scale, 3);
  assert.deepEqual([ui.width, ui.height], [640, 360]);
  ui.load({ screen: "t", root: { type: "canvas", w: "fill", h: "fill", children: [{ type: "button", id: "b", anchor: "tl", w: 20, h: 20 }] } });
  ui.render();
  assert.deepEqual([ui.node("b")!.rect.x, ui.node("b")!.rect.y], [20, 10]);
  ui.resize(1280, 720);
  ui.render();
  assert.equal(ui.scale, 2);
  assert.deepEqual([ui.width, ui.height], [640, 360]);
});

test("hit-testing and clicks: the topmost button under the pointer; disabled ones don't fire; screen pixels map through the scale", () => {
  const ui = createUi({ theme, width: 960, height: 540, scale: 3 });
  ui.load({ screen: "t", root: { type: "canvas", w: "fill", h: "fill", children: [
    { type: "panel", id: "p", anchor: "tl", x: 10, y: 10, w: 100, h: 60, dir: "free", children: [{ type: "button", id: "go", anchor: "tl", w: 30, h: 16, text: "Go" }, { type: "button", id: "off", anchor: "tr", w: 30, h: 16, disabled: true }] },
  ] } });
  ui.render();
  const clicks: string[] = [];
  ui.on("click", (id) => clicks.push(id));
  const go = ui.node("go")!.rect;
  const sx = (go.x + 2) * 3 + 1, sy = (go.y + 2) * 3 + 1;
  assert.equal(ui.hitTest(go.x + 2, go.y + 2)?.id, "go");
  assert.equal(ui.hitTest(ui.node("p")!.rect.x + 50, ui.node("p")!.rect.y + 40), null, "a panel isn't interactive");
  assert.ok(ui.pointerDown(sx, sy));
  assert.ok(ui.node("go")!.press);
  ui.pointerUp(sx, sy);
  assert.deepEqual(clicks, ["go"]);
  // Press on it, release off it: no click.
  ui.pointerDown(sx, sy); ui.pointerUp(0, 0);
  assert.deepEqual(clicks, ["go"]);
  const off = ui.node("off")!.rect;
  ui.pointerDown((off.x + 2) * 3, (off.y + 2) * 3); ui.pointerUp((off.x + 2) * 3, (off.y + 2) * 3);
  assert.deepEqual(clicks, ["go"], "disabled");
  // Over the panel's pixels counts as over the UI (the game shouldn't take that click); over nothing doesn't.
  assert.ok(ui.overUi(ui.node("p")!.rect.x + 50, ui.node("p")!.rect.y + 40));
  assert.ok(!ui.overUi(300, 170));
});

test("hotkeys, focus and pad: Q fires cmd.0.0; Tab and arrows move focus; Enter and the pad's A activate; Escape closes a modal", () => {
  const hud = generateHud({ seed: 4, culture: "industrial" });
  const ui = createUi({ theme: hud.theme, width: 640, height: 360, scale: 1 });
  ui.load(hud.screen);
  ui.render();
  const clicks: string[] = [];
  ui.on("click", (id) => clicks.push(id));
  assert.ok(ui.key("KeyQ", true));
  assert.ok(ui.node("cmd.0.0")!.press, "pressed while held");
  assert.ok(ui.key("KeyQ", false));
  assert.deepEqual(clicks, ["move"]);
  assert.ok(!ui.key("KeyJ", true), "an unbound key is the game's");
  ui.key("Tab", true);
  const first = ui.focus;
  assert.ok(first);
  ui.key("Tab", true);
  assert.notEqual(ui.focus, first);
  // Arrow navigation inside the command card.
  ui.setFocus(ui.node("cmd.0.0")!);
  ui.key("ArrowRight", true);
  assert.equal(ui.focus?.id, "cmd.0.1");
  ui.key("ArrowDown", true);
  assert.equal(ui.focus?.id, "cmd.1.1");
  ui.pad({ left: true }); ui.pad({});
  assert.equal(ui.focus?.id, "cmd.1.0");
  ui.pad({ a: true }); ui.pad({});
  assert.deepEqual(clicks, ["move", "gather"]);
  // A modal takes the keys; Escape closes it.
  const modal: string[] = [];
  ui.on("modal", (a) => modal.push(a));
  const m = ui.modal({ title: "Surrender?", text: "Your army will be lost.", buttons: [{ text: "Stay", action: "stay" }, { text: "Leave", action: "leave", primary: true, hotkey: "L" }] });
  ui.render();
  assert.ok(!ui.key("KeyQ", true), "the command card's hotkeys are blocked under a modal");
  ui.key("KeyL", true); ui.key("KeyL", false);
  assert.deepEqual(modal, ["leave"]);
  assert.equal(m.parent, null, "closed");
  ui.modal({ text: "again" });
  ui.key("Escape", true);
  assert.deepEqual(modal, ["leave", "cancel"]);
  assert.equal(keyName("ArrowLeft"), "LEFT");
  assert.equal(keyName("q"), "Q");
});

test("tooltips appear after a hover delay; lists, tabs, sliders and toggles change and report", () => {
  const ui = ui1({ type: "canvas", w: "fill", h: "fill", children: [
    { type: "button", id: "b", anchor: "c", w: 20, h: 20, icon: "attack", tip: "{bad}Attack{/}: strike a target" },
    { type: "list", id: "list", anchor: "tl", x: 4, y: 4, w: 60, items: ["One", "Two", "Three"] },
    { type: "tabs", id: "tabs", anchor: "tr", x: 4, y: 4, items: ["Army", "Tech"], selected: 0 },
    { type: "slider", id: "vol", anchor: "bl", x: 4, y: 4, w: 60, value: 0.5, max: 1 },
    { type: "toggle", id: "fs", anchor: "br", x: 4, y: 4, text: "Fullscreen" },
  ] });
  const changes: Array<[string, unknown]> = [];
  ui.on("change", (id, v) => changes.push([id, v]));
  const b = ui.node("b")!.rect;
  ui.pointerMove((b.x + 5), (b.y + 5));
  ui.update(0.1); ui.render();
  assert.ok(ui.node("#tooltip")!.props.hidden, "not yet");
  ui.update(0.4); ui.render();
  const tip = ui.node("#tooltip")!;
  assert.ok(!tip.props.hidden, "shown");
  assert.ok(tip.rect.y + tip.rect.h <= b.y, "above the button");
  ui.pointerMove(1, 170);
  assert.ok(tip.props.hidden, "hidden when the pointer leaves");
  const click = (id: string, dx: number, dy: number) => { const r = ui.node(id)!.rect; ui.pointerDown(r.x + dx, r.y + dy); ui.pointerUp(r.x + dx, r.y + dy); };
  const lr = ui.node("list")!;
  const lh = ui.font("body").lineHeight + 2;
  click("list", 10, lr.rect.h - Math.floor((lr.rect.h - 3 * lh) / 2) - 2);
  assert.equal(lr.props.selected, 2);
  const tabs = ui.node("tabs")!;
  click("tabs", tabs.rect.w - 3, 4);
  assert.equal(tabs.props.selected, 1);
  const vol = ui.node("vol")!;
  click("vol", vol.rect.w - 1, 3);
  assert.equal(vol.props.value, 1);
  click("fs", 3, 3);
  assert.equal(ui.node("fs")!.props.value, 1);
  assert.deepEqual(changes.map(([id]) => id), ["list", "tabs", "vol", "fs"]);
});

test("retained rendering: a static frame redraws nothing; a change redraws only its rectangle", () => {
  const hud = generateHud({ seed: 2, culture: "organic" });
  const ui = createUi({ theme: hud.theme, width: 640, height: 360, scale: 1 });
  ui.load(hud.screen);
  assert.equal(ui.render().length, 1, "the first frame draws everything");
  assert.deepEqual(ui.render(), []);
  assert.equal(ui.stats.painted, 0);
  const before = hashBitmap(ui.layer);
  ui.set("unit.hp", { value: 10 });
  const rects = ui.render();
  assert.equal(rects.length, 1);
  const hp = ui.node("unit.hp")!.paint;
  assert.ok(rects[0]!.w <= hp.w && rects[0]!.h <= hp.h, "only the bar");
  assert.notEqual(hashBitmap(ui.layer), before);
  // A counter whose text keeps its size doesn't lay anything out again.
  const layouts = ui.stats.layouts;
  ui.set("res.mass", { text: "{icon:mass} {tab}123{/}" }); ui.render();
  ui.set("res.mass", { text: "{icon:mass} {tab}456{/}" }); ui.render();
  assert.equal(ui.stats.layouts, layouts, "tabular figures: same size, no relayout");
  // The same value again is no change at all.
  ui.set("unit.hp", { value: 10 });
  assert.deepEqual(ui.render(), []);
  // A repaint gives the same pixels as a full redraw.
  ui.set("unit.hp", { value: 33 }); ui.render();
  const partial = hashBitmap(ui.layer);
  ui.paintAll();
  assert.equal(hashBitmap(ui.layer), partial);
  assert.deepEqual(mergeRects([{ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }, { x: 100, y: 0, w: 5, h: 5 }], 640, 360), [{ x: 0, y: 0, w: 15, h: 15 }, { x: 100, y: 0, w: 5, h: 5 }]);
});

test("layout documents: JSON authoring view and codec bytes round-trip; overrides pin any node", () => {
  const hud = generateHud({ seed: 8, culture: "brutal", overrides: { "cmd.0.4": { icon: "damage", hotkey: "X" }, minimap: null } });
  const bytes = encodeScreen(hud.screen);
  const json = JSON.stringify(hud.screen);
  assert.ok(bytes.length < json.length / 2.5, `${bytes.length} bytes vs ${json.length} of JSON`);
  console.log(`generated HUD screen: ${bytes.length} bytes as codec, ${json.length} as JSON`);
  const back = decodeScreen(bytes);
  assert.deepEqual(JSON.parse(JSON.stringify(back)), JSON.parse(json));
  assert.deepEqual(toJSON(UI_SCREEN, back), toJSON(UI_SCREEN, hud.screen as never));
  const ui = createUi({ theme: hud.theme, width: 640, height: 360, scale: 1 });
  ui.load(back);
  ui.render();
  assert.equal(ui.node("cmd.0.4")!.props.icon, "damage");
  assert.equal(ui.node("minimap"), undefined, "removed by override");
  // A tree back to its document.
  const n = buildNode({ type: "panel", id: "x", title: "Hi", children: [{ type: "label", text: "a" }] });
  assert.deepEqual(docOf(n), { type: "panel", id: "x", title: "Hi", children: [{ type: "label", text: "a" }] });
  assert.throws(() => buildNode({ type: "nope" as never }), /isn't a widget/);
  assert.ok(new UiNode("label").auto);
});

test("generated screens: one call each, every culture, deterministic, drawn", () => {
  for (const culture of ["industrial", "organic", "crystalline", "arcane", "brutal", "clean"] as const) {
    for (const make of [generateHud, generateMenu, generateLoading]) {
      const a = make({ seed: 21, culture }), b = make({ seed: 21, culture });
      assert.deepEqual(encodeScreen(a.screen), encodeScreen(b.screen));
      const ui = createUi({ theme: a.theme, width: 640, height: 360, scale: 1 });
      ui.load(a.screen);
      ui.render();
      const drawn = ui.layer.px.filter((c) => c !== 0).length;
      assert.ok(drawn > 2000, `${culture} ${a.screen.screen}: ${drawn} pixels drawn`);
      for (const node of ui.root.walk()) if (node.visible && node.type !== "canvas" && node.type !== "root" && node.id !== "#tooltip") {
        const r = node.rect;
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 640 && r.y + r.h <= 360, `${culture} ${a.screen.screen}: ${node.id} on screen (${JSON.stringify(r)})`);
      }
    }
  }
  const loading = generateLoading({ seed: 1, culture: "arcane" });
  const ui = createUi({ theme: loading.theme, width: 640, height: 360, scale: 1 });
  ui.load(loading.screen);
  ui.render();
  ui.set("loading.bar", { value: 0.5 });
  ui.update(0.2);
  assert.ok(ui.render().length >= 1, "the bar and the spinner move");
});
