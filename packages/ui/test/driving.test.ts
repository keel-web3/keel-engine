import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as nextTask } from "node:timers/promises";
import { decode, shortId } from "@keel-engine/codec/runtime";
import {
  DRIVING_KINDS, DRIVING_VARIANTS, UI_SCREEN, UI_SCREEN_V1, UiNode, WIDGETS,
  createAtlas, createUi, decodeScreen, encodeScreen, generateDrivingHud, generateTheme, hashBitmap,
} from "../src/index.ts";
import type { DrivingKind, DrivingVariant, NodeProps } from "../src/index.ts";
import { paintNode } from "../src/paint.ts";
import type { PaintContext } from "../src/paint.ts";

const theme = generateTheme({ seed: "driving-test", culture: "industrial" });
function make(kind: DrivingKind, variant: DrivingVariant = "touring", props: Partial<NodeProps> = {}) {
  const generated = generateDrivingHud({ theme, variant, width: 88, height: 88,
    parts: [{ ...props, id: "part", kind, x: 4, y: 4, w: 80, h: 80 }] });
  const atlas = createAtlas(256), ui = createUi({ theme, width: 88, height: 88, scale: 1, atlas });
  ui.load(generated.screen); ui.render();
  return { generated, ui, atlas, dispose() { ui.dispose(); atlas.dispose?.(); } };
}

test("driving schema: old widget codes and frozen v1 document bytes remain readable and byte-identical", () => {
  assert.equal(WIDGETS.indexOf("image"), 21); assert.equal(WIDGETS.indexOf("driving"), 22);
  const frozen = Buffer.from("b1aff315d4123810cb8000000000058d696781fc08c00000b0000020f70e9012e4e5000000010b0e0001c06c656761637966696c6c676f476f6675656c", "hex");
  assert.equal(shortId(UI_SCREEN_V1), "aff315d4");
  const doc = decodeScreen(frozen);
  assert.deepEqual(decode(UI_SCREEN, frozen), doc, "normal codec registry/evolution path also reads v1");
  assert.deepEqual(Buffer.from(encodeScreen(doc)), frozen);
  assert.equal(doc.root.children?.[0]?.hp, 0.75);
});

test("driving recipes: every kind/variant survives UI_SCREEN and normal retained painting deterministically", () => {
  for (const variant of DRIVING_VARIANTS) for (const kind of DRIVING_KINDS) {
    const a = make(kind, variant, { value: kind === "wheel" ? -0.3 : 0.65, secondaryValue: 5200, secondaryMax: 8000, drivingRedline: 0.8 });
    const bytes = encodeScreen(a.generated.screen), doc = decodeScreen(bytes);
    assert.deepEqual(doc, a.generated.screen);
    assert.equal(doc.root.children?.[0]?.type, "driving");
    assert.equal(doc.root.children?.[0]?.drivingKind, kind);
    assert.equal(doc.root.children?.[0]?.drivingVariant, variant);
    assert.ok(!JSON.stringify(doc).includes('"image"'));
    const b = createUi({ theme: a.generated.theme, width: 88, height: 88, scale: 1, atlas: createAtlas(256) });
    b.load(doc); b.render();
    assert.equal(hashBitmap(a.ui.layer), hashBitmap(b.layer), `${variant}/${kind}`);
    assert.ok(a.ui.layer.px.some((p) => p !== 0));
    assert.equal(a.ui.atlas.stats.sprites, 0, "procedural widget creates no atlas bitmap per value");
    a.dispose(); b.dispose(); b.atlas.dispose?.();
  }
});

test("driving silhouettes: touring/track differ for every kind; brake is distinct from the parking lever", () => {
  for (const kind of DRIVING_KINDS) {
    const a = make(kind), b = make(kind, "track");
    assert.notEqual(hashBitmap(a.ui.layer), hashBitmap(b.ui.layer), kind);
    a.dispose(); b.dispose();
  }
  const brake = make("brake"), parking = make("handbrake");
  assert.notEqual(hashBitmap(brake.ui.layer), hashBitmap(parking.ui.layer));
  brake.dispose(); parking.dispose();
});

test("combined instrument: touring has two round faces; track has concentric scales", () => {
  const center = (variant: DrivingVariant) => {
    const g = generateDrivingHud({ theme, variant, width: 144, height: 80,
      parts: [{ id: "combined", kind: "combined", x: 0, y: 0, w: 144, h: 80, value: 123, max: 240, secondaryValue: 5200, secondaryMax: 8000 }] });
    const ui = createUi({ theme, width: 144, height: 80, scale: 1 }); ui.load(g.screen); ui.render();
    const result = { center: ui.layer.px[40 * 144 + 72], hash: hashBitmap(ui.layer) }; ui.dispose(); return result;
  };
  const a = center("touring"), b = center("track");
  assert.equal(a.center, 0, "space between the two touring faces");
  assert.notEqual(b.center, 0, "track has a central shared face");
  assert.notEqual(a.hash, b.hash);
});

test("live controls and needles repaint only their retained region without bitmap/state cache growth", () => {
  const a = make("combined", "track", { max: 240, secondaryMax: 8000 });
  const layer = a.ui.layer, page = a.atlas.page, layouts = a.ui.stats.layouts, sprites = a.atlas.stats.sprites;
  const before = hashBitmap(layer);
  a.ui.set("part", { value: 123, secondaryValue: 5200 });
  const dirty = a.ui.render();
  assert.notEqual(hashBitmap(layer), before); assert.equal(a.ui.stats.layouts, layouts);
  assert.ok(dirty.length > 0 && dirty.every((r) => r.x >= 3 && r.y >= 3 && r.x + r.w <= 85 && r.y + r.h <= 85));
  assert.deepEqual(a.ui.render(), [], "unchanged frame performs no paint");
  for (let i = 0; i < 300; i++) { a.ui.set("part", { value: i % 240, secondaryValue: i * 23 }); a.ui.render(); }
  assert.equal(a.ui.layer, layer); assert.equal(a.atlas.page, page);
  assert.equal(a.atlas.stats.sprites, sprites); assert.equal(a.ui.stats.layouts, layouts);
  assert.equal(a.atlas.page.px.byteLength, 256 * 256 * 4);
  a.dispose();
});

test("driving state: steering, pedal press, active, disabled and RPM redline change the actual painter", () => {
  for (const kind of ["wheel", "accelerator", "brake", "handbrake", "boost", "shift-up", "shift-down"] as const) {
    const a = make(kind), initial = hashBitmap(a.ui.layer);
    a.ui.set("part", { active: true }); a.ui.render(); assert.notEqual(hashBitmap(a.ui.layer), initial, `${kind} active`);
    a.ui.set("part", { disabled: true }); a.ui.render(); assert.notEqual(hashBitmap(a.ui.layer), initial, `${kind} disabled`);
    a.dispose();
  }
  const wheel = make("wheel"); wheel.ui.set("part", { value: -1 }); wheel.ui.render(); const left = hashBitmap(wheel.ui.layer);
  wheel.ui.set("part", { value: 1 }); wheel.ui.render(); assert.notEqual(hashBitmap(wheel.ui.layer), left); wheel.dispose();
  const tach = make("tachometer", "track", { max: 8000, value: 6200 }); const below = hashBitmap(tach.ui.layer);
  tach.ui.set("part", { value: 7800 }); tach.ui.render(); assert.notEqual(hashBitmap(tach.ui.layer), below); tach.dispose();
  const button = make("shift-up"); const clicks: string[] = []; button.ui.on("click", (id) => clicks.push(id));
  button.ui.pointerDown(40, 40); button.ui.render(); assert.ok(button.ui.node("part")!.press);
  button.ui.pointerUp(40, 40); assert.deepEqual(clicks, ["part"]); button.dispose();
});

test("driving painter: dirty clip, tiny widgets, NaN/infinity, invalid max and extreme rectangles are bounded", () => {
  for (const kind of DRIVING_KINDS) {
    const a = make(kind), n = a.ui.node("part")!, ctx = a.ui as unknown as PaintContext;
    ctx.clip = { x0: 19, y0: 23, x1: 32, y1: 34 };
    for (const value of [NaN, Infinity, -Infinity, -100, 1e300]) {
      a.ui.layer.px.fill(123);
      n.props.value = value; n.props.max = 0; n.props.secondaryValue = value; n.props.secondaryMax = -1;
      paintNode(n, ctx);
      for (let y = 0; y < 88; y++) for (let x = 0; x < 88; x++) if (x < 19 || x >= 32 || y < 23 || y >= 34) assert.equal(a.ui.layer.px[y * 88 + x], 123);
    }
    for (const size of [0, 1, 2, NaN, Infinity, 1e300]) { n.rect = { x: 20, y: 24, w: size, h: size }; paintNode(n, ctx); }
    a.dispose();
  }
  assert.throws(() => generateDrivingHud({ parts: [{ id: "bad", kind: "wheel", x: 0, y: 0, w: Infinity, h: 40 }] }), /rectangle/);
  assert.throws(() => generateDrivingHud({ width: NaN, parts: [] }), /dimensions/);
});

test("Ui disposal: internally created atlas survives registered borrowers and releases after the final Ui", () => {
  const creator = createUi({ theme, width: 32, height: 32, scale: 1 }), atlas = creator.atlas;
  const borrower = createUi({ theme, width: 32, height: 32, scale: 1, atlas });
  creator.dispose(); assert.equal(atlas.page.w, 1024);
  borrower.load({ screen: "borrower", root: { type: "button", text: "OK", w: 32, h: 22 } }); borrower.render();
  assert.ok(atlas.stats.sprites > 0); borrower.dispose(); assert.equal(atlas.page.px.byteLength, 0);
  assert.throws(() => atlas.sprite("late", () => { throw new Error("builder must not run"); }), /disposed/);
  const a = createUi({ theme, width: 8, height: 8 }), b = createUi({ theme, width: 8, height: 8, atlas: a.atlas });
  b.dispose(); assert.equal(a.atlas.page.w, 1024); a.dispose(); assert.equal(a.atlas.page.w, 0);
});

test("Ui disposal: external shared atlas remains caller-owned; stale input/mutators cannot refill UI storage", () => {
  const a = make("wheel"), atlas = a.atlas;
  a.ui.dispose(); a.ui.dispose();
  assert.equal(a.ui.layer.px.byteLength, 0); assert.equal(atlas.page.w, 256);
  a.ui.resize(4096, 4096); a.ui.set("part", { value: 1 }); a.ui.setFont("small", null); a.ui.setFocus(new UiNode("button"));
  a.ui.pointerDown(1, 1); a.ui.pointerMove(1, 1); a.ui.pointerUp(1, 1); a.ui.key("Tab", true); a.ui.pad({ a: true }); a.ui.update(10);
  assert.deepEqual(a.ui.render(), []); assert.equal(a.ui.focus, null); assert.equal(a.ui.node("part"), undefined);
  assert.equal(a.ui.layer.px.byteLength, 0); assert.throws(() => a.ui.toast("late"), /disposed/);
  assert.throws(() => a.ui.load(a.generated.screen), /disposed/); atlas.dispose?.();
});

const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
test("retained disposed Ui does not pin retired layer, owned atlas page, font or callback owner", { skip: !gc }, async () => {
  const makeDisposed = () => {
    const owner = { data: new Uint8Array(64 * 1024) };
    const ui = createUi({ theme, width: 64, height: 64, scale: () => owner.data.length > 0 ? 1 : 1 });
    ui.on("click", () => owner.data.fill(1));
    const refs = [new WeakRef(owner), new WeakRef(ui.layer), new WeakRef(ui.atlas.page)];
    ui.dispose(); return { ui, refs };
  };
  const held = Array.from({ length: 12 }, makeDisposed);
  for (let i = 0; i < 12; i++) { await nextTask(); gc!(); }
  assert.ok(held.every((a) => a.refs.every((r) => r.deref() === undefined)));
  assert.ok(held.every((a) => a.ui.layer.w === 0 && a.ui.atlas.page.w === 0), "disposed APIs remain deliberately retained");
});
