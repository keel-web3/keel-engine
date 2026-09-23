// The J2 bars (console clarity, crisp pixel type, distinct per race, never
// cluttered), measured: glyphs that don't read as each other, a group that
// fills the selection panel, a console silhouette per culture, command icons
// drawn in a family per culture, and a modal that dims the HUD without
// scrambling its text. The numbers are logged; tools/j2.ts draws the sheets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ICON_NAMES, buildNode, contrast, createUi, frameColours, generateFont, generateHud, generateTheme, iconBitmap, iconMask, luminance, padOf, rampOf, trimGlyph } from "../src/index.ts";
import { barLabel, keycapWidth } from "../src/paint.ts";
import type { NodeDoc, Rgba } from "../src/index.ts";
import {
  COMMAND_ICONS, CULTURES, GLYPH_PAIRS, GLYPH_SIZES, SEEDS, SUMMARY_ONE, SUMMARY_TWO, classicPlain, classicWithGroup, consoleMask, emptyShare, glyphDistance, iconOverlap, iou,
  maskDiff,
} from "./j2-metrics.ts";

/** The screens the classic console is judged at (each one's layer at its default whole UI scale). */
const SCREENS = [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]] as const;

test("glyphs: t/l, G/B, G/C, G/6, t/f, t/+, 8/B, 0/O, 0/D, 5/S, 1/l, 1/I, 3/E (and I/l, 8/0, 6/9, 3/B, 3/S, 3/8) differ by 4+ pixels, aligned or shifted, in every culture's family at 5-8 and 12 px", () => {
  const worst = new Map<string, { aligned: number; best: number; at: string }>();
  for (const culture of CULTURES) for (const seed of SEEDS) {
    const params = generateTheme({ seed, culture }).type.font;
    for (const size of GLYPH_SIZES) {
      const font = generateFont(params, size);
      for (const [a, b] of GLYPH_PAIRS) {
        const d = glyphDistance(font, a, b);
        const w = worst.get(a + b) ?? { aligned: Infinity, best: Infinity, at: "" };
        worst.set(a + b, { aligned: Math.min(w.aligned, d.aligned), best: Math.min(w.best, d.best), at: d.best < w.best ? `${culture}/${seed}@${size}` : w.at });
        assert.ok(d.aligned >= 4 && d.best >= 4, `${culture}/${seed} @${size}px: ${a} vs ${b} differ by ${d.aligned} aligned, ${d.best} at the closest shift`);
      }
    }
  }
  console.log(`glyph pairs, fewest differing pixels (aligned / closest shift): ${[...worst].map(([k, v]) => `${k[0]}/${k[1]} ${v.aligned}/${v.best}`).join(", ")}`);
  // The shapes the critic asked for, in a square family at 8 px: t's crossbar crosses its stem both sides at the
  // x-height, its top stops under l's, its foot turns right; G is open top-right, its bar comes in from the right and
  // never joins its left side.
  const f = generateFont({ ...generateTheme({ seed: 2, culture: "industrial" }).type.font, round: 0, slant: 0, stroke: 0.1, serif: "none", ascend: 0 }, 8);
  const rows = (ch: string) => { const g = f.glyphs.get(ch.codePointAt(0)!)!; return Array.from({ length: g.h }, (_, y) => ({ y: g.oy + y, bits: Array.from({ length: g.w }, (_, x) => g.bits[y * g.w + x]!), ox: g.ox })); };
  const t = rows("t"), l = rows("l"), G = rows("G");
  assert.ok(t[0]!.y > l[0]!.y, `t's top (${t[0]!.y}) under l's (${l[0]!.y})`);
  const bar = t.find((r) => r.bits.every(Boolean))!;
  assert.ok(bar && bar.bits.length >= 3, "a crossbar right across t");
  const stem = t[t.length - 2]!.bits.indexOf(1);
  assert.ok(stem > 0 && stem < bar.bits.length - 1, "the crossbar reaches both sides of the stem");
  assert.ok(t[t.length - 1]!.bits.lastIndexOf(1) > stem, "t's foot turns right");
  assert.ok(!G[0]!.bits[G[0]!.bits.length - 1], "G open at the top right");
  const mid = G.find((r) => r.bits[r.bits.length - 1] && r.bits.filter(Boolean).length >= 3 && r.bits.some((v, i) => v && i > 1 && i < r.bits.length - 1))!;
  assert.ok(mid && !mid.bits[1], `G's bar comes in from the right without joining its left side: ${mid?.bits.join("")}`);
});

test("the classic console's group fills its selection panel: the biggest empty rectangle is under 18% of it, at 720p..4K, every culture", () => {
  let worst = 0, at = "";
  for (const [W, H] of SCREENS) for (const culture of CULTURES) for (const seed of [1, 7]) for (const summary of [SUMMARY_ONE, SUMMARY_TWO]) {
    const ui = classicWithGroup({ culture, seed, screenW: W, screenH: H, summary });
    const e = emptyShare(ui);
    if (e.share > worst) { worst = e.share; at = `${culture}/${seed} ${W}x${H} (${ui.width}x${ui.height}): ${e.rect.w}x${e.rect.h} of ${e.panel.w}x${e.panel.h}`; }
    assert.ok(e.share <= 0.18, `${culture}/${seed} ${W}x${H}: an empty ${e.rect.w}x${e.rect.h} is ${(e.share * 100).toFixed(1)}% of the panel`);
    // 12 units across the panel: two rows of six, cells a wireframe can read in.
    const sel = e.panel, first = ui.node("group.0")!.rect, last = ui.node("group.11")!.rect;
    assert.ok(first.x === sel.x && last.y + last.h === sel.y + sel.h && first.w >= 30 && first.h >= 30, `cells ${JSON.stringify(first)} fill ${JSON.stringify(sel)}`);
    assert.ok(ui.node("group.cells")!.rect.w >= sel.w * 0.68, "the cells span most of the panel's width");
  }
  console.log(`selection panel with a 12-unit group: largest empty rectangle ${(worst * 100).toFixed(1)}% of the panel (${at})`);
  // Nothing to say: hiding the summary gives its column to the cells.
  const ui = classicWithGroup({ culture: "clean", seed: 3, screenW: 1920, screenH: 1080, summary: "" });
  const w0 = ui.node("group.0")!.rect.w;
  ui.set("group.summary", { hidden: true });
  ui.render();
  assert.ok(ui.node("group.0")!.rect.w > w0, "the cells widen into the summary's column");
});

test("the console's silhouette differs by culture (12%+ of its alpha pairwise), its hit areas identical", () => {
  for (const [W, H] of [...SCREENS, [1440, 810]] as const) {
    const uis = CULTURES.map((culture) => classicPlain({ culture, seed: 3, screenW: W, screenH: H }));
    let top = Infinity;
    for (const ui of uis) for (const n of ui.root.walk()) if (n.id.startsWith("trim.")) top = Math.min(top, n.rect.y);
    const masks = uis.map((ui) => consoleMask(ui, top).mask);
    let worst = 1, pair = "";
    for (let i = 0; i < masks.length; i += 1) for (let j = i + 1; j < masks.length; j += 1) {
      const d = maskDiff(masks[i]!, masks[j]!);
      if (d < worst) { worst = d; pair = `${CULTURES[i]}/${CULTURES[j]}`; }
      assert.ok(d >= 0.12, `${W}x${H}: ${CULTURES[i]} and ${CULTURES[j]} consoles' outlines differ in ${(d * 100).toFixed(1)}% of pixels`);
    }
    if (W === 1920) console.log(`console silhouette: the closest two cultures (${pair}) differ in ${(worst * 100).toFixed(1)}% of the band's pixels (${masks[0]!.length} cells)`);
    // The same rectangles for every culture: the trims, the console and everything a click can land on in it.
    const rects = (i: number) => JSON.stringify([...uis[i]!.root.walk()].filter((n) => /^(trim\.\d|bottom|minimap|portrait|selection|cmd(\.\d\.\d)?|queue\.\d|group(\.\d+|\.cells|\.summary)?)$/.test(n.id)).map((n) => [n.id, n.rect.x, n.rect.y, n.rect.w, n.rect.h]));
    for (let i = 1; i < uis.length; i += 1) assert.equal(rects(i), rects(0), `${CULTURES[i]}: the same rectangles as ${CULTURES[0]}`);
  }
});

test("command icons are drawn in a family per culture: mean IoU of their shapes culture to culture 0.6 or less, each set still distinct", () => {
  const shape = iconOverlap([16, 24], "shape"), painted = iconOverlap([16, 24], "painted");
  console.log(`command icons, mean IoU between two cultures: shapes worst ${shape.worst.toFixed(3)} (${shape.pair}), painted worst ${painted.worst.toFixed(3)} (${painted.pair})`);
  for (const [pair, v] of Object.entries(shape.table)) assert.ok(v <= 0.6, `${pair}: mean IoU ${v}`);
  for (const [pair, v] of Object.entries(painted.table)) assert.ok(v <= 0.6, `${pair} (painted, outline included): mean IoU ${v}`);
  // Within a family every command reads as itself: every pair of names differs by pixels, and the drawn icon has ink
  // inside its outline, at the command card's sizes.
  for (const culture of CULTURES) {
    const theme = generateTheme({ seed: 3, culture });
    for (const size of [16, 24]) {
      const masks = COMMAND_ICONS.map((n) => iconMask(n, size - 2, 7, 0, 1, culture));
      for (let i = 0; i < masks.length; i += 1) for (let j = i + 1; j < masks.length; j += 1) {
        let d = 0;
        for (let k = 0; k < masks[i]!.length; k += 1) if (masks[i]![k] !== masks[j]![k]) d += 1;
        assert.ok(d >= (size === 16 ? 5 : 12), `${culture} @${size}: ${COMMAND_ICONS[i]} and ${COMMAND_ICONS[j]} differ by ${d} px`);
      }
      for (const name of ICON_NAMES) {
        const shape = iconMask(name, size - 2, theme.recipe.seed, undefined, theme.icon.stroke, culture).filter(Boolean).length;
        const plain = iconMask(name, size - 2, theme.recipe.seed, undefined, theme.icon.stroke, "plain").filter(Boolean).length;
        const drawn = iconBitmap(name, size, theme).px.filter((c) => c !== 0).length;
        assert.ok(shape >= Math.min(size, plain * 0.8) && drawn > shape, `${culture} ${name}@${size}: ${shape} pixels of shape (plain: ${plain}), ${drawn} drawn`);
      }
    }
  }
  // "plain" is the grammar's own drawing, the same whatever the culture.
  assert.deepEqual(iconMask("attack", 14, 7, 0, 1, "plain"), iconMask("attack", 14, 7, 0, 1));
  assert.ok(iou(iconMask("attack", 22, 7, 0, 1, "industrial"), iconMask("attack", 22, 7, 0, 1, "clean")) < 0.5);
});

/** The layer's pixels in a rectangle. */
const grab = (px: Uint32Array, W: number, r: { x: number; y: number; w: number; h: number }): number[] => { const out: number[] = []; for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) out.push(px[y * W + x]!); return out; };

test("a modal darkens the HUD under it solidly: a label keeps its exact glyph mask; where the game shows, one flat dark colour", () => {
  for (const culture of CULTURES) {
    const hud = generateHud({ seed: 4, culture, layout: { preset: "classic" } });
    const ui = createUi({ theme: hud.theme, width: 640, height: 360, scale: 1 });
    ui.load(hud.screen);
    ui.set("unit.name", { text: "{bright}Tier 2 Warden x12{/}" });
    ui.render();
    const r = ui.node("unit.name")!.rect;
    const ink = ui.tone("bright");
    const before = grab(ui.layer.px, ui.width, r);
    const text = before.map((c) => c === ink);
    assert.ok(text.filter(Boolean).length > 20, "the label has text");
    const clear = { x: 250, y: 70, w: 40, h: 20 };
    assert.ok(grab(ui.layer.px, ui.width, clear).every((c) => c === 0), "(a patch of open world)");
    // The game's menu: a modal node over the HUD (as MYRIAD builds it), and the UI's own modal().
    for (const open of ["doc", "call"] as const) {
      const m = open === "doc"
        ? buildNode({ type: "modal", id: "menu.modal", w: "fill", h: "fill", children: [{ type: "panel", id: "menu.panel", anchor: "c", title: "Game menu", children: [{ type: "button", text: "Resume", action: "menu.resume" }] }] } as NodeDoc)
        : ui.modal({ title: "Game menu", text: "Paused", buttons: [{ text: "Resume", action: "resume" }] });
      if (open === "doc") ui.overlay.add(m);
      ui.render();
      const after = grab(ui.layer.px, ui.width, r);
      const onText = new Set<Rgba>(), offText = new Set<Rgba>();
      after.forEach((c, i) => (text[i] ? onText : offText).add(c));
      assert.equal(onText.size, 1, `${culture}: the text is one solid colour under the modal (${onText.size})`);
      for (const c of onText) assert.ok(!offText.has(c), `${culture}: its glyph mask is exactly the text's -- no background pixel shares its colour`);
      // Solid: each colour under the modal maps to one darker colour, never a checker.
      const map = new Map<Rgba, Set<Rgba>>();
      before.forEach((c, i) => { let s = map.get(c); if (!s) map.set(c, (s = new Set())); s.add(after[i]!); });
      for (const [c, s] of map) {
        assert.equal(s.size, 1, `${culture}: colour ${c.toString(16)} became ${s.size} colours`);
        if (c) assert.ok(luminance([...s][0]!) <= luminance(c), "darker");
      }
      // The open world: one flat, opaque, very dark colour -- no pattern -- darker than anything left of the HUD.
      const world = new Set(grab(ui.layer.px, ui.width, clear));
      assert.equal(world.size, 1, `${culture}: one colour over the world (${world.size})`);
      const back = [...world][0]!;
      assert.ok(back !== 0 && luminance(back) < 0.02, `${culture}: a dark backdrop (${luminance(back).toFixed(4)})`);
      assert.ok(after.every((c) => luminance(c) >= luminance(back)), "nothing of the HUD darker than the backdrop");
      ui.close(m);
      ui.render();
      assert.deepEqual(grab(ui.layer.px, ui.width, r), before, "closed: the label as it was");
    }
    // Asked for, the old see-through backdrop: every other pixel, evenly (the HUD still darkened solidly).
    const d = ui.modal({ title: "Paused", scrim: "dither" });
    ui.render();
    const world = grab(ui.layer.px, ui.width, clear);
    assert.equal(world.filter((c) => c !== 0).length, world.length / 2, `${culture}: dither on request`);
    ui.close(d);
  }
});

test("the classic console's top-left buttons: icons 7 px or more, drawn whole, the same rectangles in every culture", () => {
  const menuButtons = [
    { id: "menu", text: "Menu", icon: "menu", hotkey: "F10", action: "menu" }, { id: "pause", text: "Pause", icon: "pause", action: "pause" }, { id: "sound", text: "Sound", icon: "ping", action: "sound" },
  ];
  for (const [W, H] of [[640, 360], [683, 384], [480, 270], [800, 450]] as const) {
    let first: string | null = null;
    for (const culture of CULTURES) for (const seed of [1, 5]) {
      const pins = { body: 8 };
      const hud = generateHud({ seed, culture, width: W, height: H, pins, layout: { preset: "classic" }, slots: { menuButtons } });
      const ui = createUi({ theme: hud.theme, width: W, height: H, scale: 1 });
      ui.load(hud.screen);
      ui.render();
      const rects = JSON.stringify(["menus", "menu", "menu.pause", "menu.sound"].map((id) => { const q = ui.node(id)!.rect; return [q.x, q.y, q.w, q.h]; }));
      first ??= rects;
      assert.equal(rects, first, `${culture}/${seed} ${W}x${H}: the same top-left buttons`);
      for (const id of ["menu", "menu.pause", "menu.sound"]) {
        const n = ui.node(id)!, p = padOf(n, ui);
        const room = Math.min(n.rect.w - p.l - p.r, n.rect.h - p.t - p.b);
        assert.ok((n.props.iconSize ?? 0) >= 7 && room >= n.props.iconSize!, `${culture} ${id}: a ${n.props.iconSize} px icon in ${room} px of room`);
        // The label isn't cut: no ellipsis in it.
        const t = ui.text(n, n.props.text!, "small", n.rect.w, { caps: ui.theme.type.caps, maxLines: 1 });
        assert.ok(t.w + n.props.iconSize! + keycapWidth(n, ui) + 2 * p.l <= n.rect.w, `${culture} ${id}: "${n.props.text}" fits (${t.w} px)`);
      }
    }
  }
});

test("small selections fill the panel too: 1, 2, 3, 4, 6 and 12 units leave 15% or less of it empty; icons fill their cells", () => {
  const report: string[] = [];
  for (const [W, H] of SCREENS) for (const count of [1, 2, 3, 4, 6, 12]) {
    let worst = 0, first: string | null = null;
    for (const culture of CULTURES) for (const summary of [SUMMARY_ONE, SUMMARY_TWO]) {
      const ui = classicWithGroup({ culture, seed: 1, screenW: W, screenH: H, summary });
      for (let k = 0; k < 12; k += 1) ui.set(`group.${k}`, k < count ? { hp: 1 - k / 12 } : { hidden: true });
      ui.render();
      const e = emptyShare(ui);
      worst = Math.max(worst, e.share);
      assert.ok(e.share <= 0.15, `${culture} ${W}x${H}, ${count} units: ${(e.share * 100).toFixed(1)}% empty`);
      // The icon a game should bake for this count: 55%+ of the cell's height, 11+ layer px.
      for (let k = 0; k < count; k += 1) {
        const cell = ui.node(`group.${k}`)!.rect, size = ui.iconSizeOf(`group.${k}`);
        assert.ok(size >= 11 && size >= 0.55 * cell.h, `${culture} ${count} units: a ${size} px icon in a ${cell.w}x${cell.h} cell`);
      }
      const rects = JSON.stringify(Array.from({ length: count }, (_, k) => ui.node(`group.${k}`)!.rect));
      first ??= rects;
      assert.equal(rects, first, `${culture}: the same cells for ${count} units`);
    }
    if (W === 1920) { const ui = classicWithGroup({ culture: "clean", seed: 1, screenW: W, screenH: H, summary: SUMMARY_ONE }); for (let k = 0; k < 12; k += 1) ui.set(`group.${k}`, k < count ? { hp: 1 } : { hidden: true }); const r = ui.node("group.0")!.rect; report.push(`${count}: ${(worst * 100).toFixed(1)}% (cells ${r.w}x${r.h}, icon ${ui.iconSizeOf("group.0")} px)`); }
  }
  console.log(`selection panel, largest empty share by count at 1920x1080: ${report.join(", ")}`);
});

test("a group cell's health strip: 2+ px under its icon, good over 66%, warn over 33%, bad under", () => {
  const ui = classicWithGroup({ culture: "industrial", seed: 2, screenW: 1920, screenH: 1080, summary: SUMMARY_ONE });
  const theme = ui.theme;
  for (const [hp, tone] of [[0.9, "good"], [0.5, "warn"], [0.2, "bad"]] as const) {
    ui.set("group.0", { hp });
    ui.render();
    const r = ui.node("group.0")!.rect, colour = rampOf(theme, tone)[2]!;
    let rows = 0;
    for (let y = r.y; y < r.y + r.h; y += 1) { let run = 0; for (let x = r.x; x < r.x + r.w; x += 1) if (ui.layer.px[y * ui.width + x] === colour) run += 1; if (run >= Math.round((r.w - 8) * hp) - 2) rows += 1; }
    assert.ok(rows >= 1, `${tone} at ${hp}: ${rows} rows of the strip in its colour`);
    const size = ui.iconSizeOf("group.0");
    assert.ok(size >= 0.55 * r.h, "the strip leaves the icon its room");
  }
  ui.set("group.0", { hp: 0.9 });
  const withStrip = ui.iconSizeOf("group.0");
  ui.set("group.0", { hp: null });
  assert.ok(ui.iconSizeOf("group.0") > withStrip, "no strip, a bigger icon");
});

test("3 opens to the left (never a mirrored E); organic text isn't over-tracked (advance 1.3x the letters or less)", () => {
  for (const culture of CULTURES) for (const seed of SEEDS) for (const size of GLYPH_SIZES) {
    const f = generateFont(generateTheme({ seed, culture }).type.font, size);
    const g = trimGlyph(f.glyphs.get(51)!);
    let run = 0, most = 0;
    for (let y = 0; y < g.h; y += 1) { run = g.bits[y * g.w] ? run + 1 : 0; most = Math.max(most, run); }
    assert.ok(most <= 2, `${culture}/${seed} @${size}: 3's left side is a stroke ${most} px long`);
  }
  const TEXT = "Phikthash Soldier health Worker Hauler Tier next type range sight";
  let worst = 0;
  for (let seed = 1; seed <= 40; seed += 1) {
    const theme = generateTheme({ seed, culture: "organic" });
    for (const role of ["small", "body", "title"] as const) {
      const f = generateFont(theme.type.font, theme.type[role]);
      let adv = 0, ink = 0;
      for (const ch of TEXT) if (ch !== " ") { const g = f.glyphs.get(ch.codePointAt(0)!)!; adv += g.adv; ink += trimGlyph(g).w; }
      worst = Math.max(worst, adv / ink);
    }
  }
  console.log(`organic text: advance over letter width, worst ${worst.toFixed(3)}`);
  assert.ok(worst <= 1.3, `organic advance ${worst.toFixed(3)}x its letters`);
});

test("contrast: every command icon's shape 3:1 off its cell in every family; numbers on bars 4.5:1 off their outline", () => {
  let worstIcon = 21;
  for (const culture of CULTURES) for (const seed of [1, 2, 3, 4, 5, 6]) {
    const theme = generateTheme({ seed, culture });
    for (const kind of ["button", "inset"] as const) {
      const face = frameColours(theme, kind, "normal").fill;
      for (const name of COMMAND_ICONS) for (const size of [16, 24]) {
        for (const c of iconBitmap(name, size, theme, { on: face }).px) if (c && c !== theme.palette.outline) worstIcon = Math.min(worstIcon, contrast(c, face));
      }
    }
  }
  let worstBar = 21;
  for (const culture of CULTURES) for (let i = 0; i < 1000; i += 1) { const l = barLabel(generateTheme({ seed: i * 7919, culture })); worstBar = Math.min(worstBar, contrast(l.text, l.outline)); }
  console.log(`contrast: worst command-icon pixel ${worstIcon.toFixed(2)}:1 off its cell, worst bar number ${worstBar.toFixed(2)}:1 off its outline`);
  assert.ok(worstIcon >= 3, `icon ${worstIcon}`);
  assert.ok(worstBar >= 4.5, `bar label ${worstBar}`);
});
