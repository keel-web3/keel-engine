// The J2 evidence sheets: node packages/ui/tools/j2.ts [outDir]  (default out/ui/j2/)
//
//   glyphs-<culture>.png   t l G B C 6 f + 8 0 O D 5 S 1 I and words using them, each culture's family at 6, 8 and 12 px (x4)
//   glyphs.png             every culture on one sheet
//   console-<culture>.png  the classic console at 1920x1080's layer (640x360) with a 12-unit group, over a stand-in
//                          world (x2): industrial, organic and crystalline (the rest too)
//   consoles.png           the six consoles' silhouettes stacked (x2)
//   icons.png              the command icons in every culture's family at 16 and 24 px (x3)
//   modal.png              a HUD with text, the game menu over it (the new scrim), and a close-up of a label under the
//                          old checker scrim and the new one (x2 / x6)
//   menu-buttons.png       the top-left Menu / Pause / Sound buttons in every culture (x4)
//   group-counts.png       the selection panel with 1, 2, 3, 4, 6 and 12 units, health strips on (x2)
// It prints every J2 bar's number too.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { blit, blitMask, buildNode, createBitmap, createUi, encodePng, fillRect, frameColours, generateFont, generateHud, generateTheme, glyphOf, iconBitmap, rgba } from "../src/index.ts";
import type { Bitmap, NodeDoc, PixelFont, Rgba, Ui } from "../src/index.ts";
import { COMMAND_ICONS, CULTURES, SUMMARY_TWO, classicPlain, classicWithGroup, consoleMask, emptyShare, iconOverlap, maskDiff, worstGlyphs } from "../test/j2-metrics.ts";

const out = resolve(process.argv[2] ?? new URL("../../../out/ui/j2/", import.meta.url).pathname);
mkdirSync(out, { recursive: true });
const save = (name: string, b: Bitmap, scale: number) => { writeFileSync(resolve(out, name), encodePng(b, scale)); console.log(`  ${resolve(out, name)} (${b.w * scale}x${b.h * scale})`); };

const BG = rgba(22, 24, 30), INK = rgba(232, 234, 240), DIM = rgba(130, 136, 150);
const label = generateFont(generateTheme({ seed: 1, culture: "clean" }).type.font, 7);
type TextOptions = { readonly bitmap: Bitmap; readonly font: PixelFont; readonly value: string; readonly x: number; readonly y: number; readonly color: Rgba };

function text({ bitmap: b, font, value: s, x, y, color: c }: TextOptions): number {
  let pen = x;
  for (const ch of s) {
    const g = glyphOf(font, ch.codePointAt(0)!)!;
    blitMask(b, { w: g.w, h: g.h, px: Uint32Array.from(g.bits) }, 0, 0, g.w, g.h, pen + g.ox, y + g.oy, c);
    pen += g.adv;
  }
  return pen;
}
/** A stand-in world under the HUD: a dithered ground, so what's see-through and what's silhouette shows. */
function world(w: number, h: number): Bitmap {
  const b = createBitmap(w, h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const n = Math.sin(x * 0.07) * Math.cos(y * 0.09) + Math.sin((x + y) * 0.031);
    b.px[y * w + x] = n > 0.6 ? rgba(92, 112, 70) : n > -0.2 ? rgba(74, 96, 58) : ((x ^ y) & 3) === 0 ? rgba(66, 84, 56) : rgba(58, 76, 50);
  }
  return b;
}
const over = (dst: Bitmap, ui: Ui, dx = 0, dy = 0, src = { x: 0, y: 0, w: ui.width, h: ui.height }) => {
  for (let y = 0; y < src.h; y += 1) for (let x = 0; x < src.w; x += 1) { const c = ui.layer.px[(src.y + y) * ui.width + src.x + x]!; if (c) dst.px[(dy + y) * dst.w + dx + x] = c; }
};

// --- Glyphs.
console.log("glyphs (fewest differing pixels, aligned / closest shift):", worstGlyphs((p, s) => generateFont(p, s)).map((r) => `${r.pair} ${r.aligned}/${r.best}`).join(", "));
const SAMPLE = ["t l G B C 6 f + 8 0 O D 5 S 1 I", "tilt Gate BG6 +12 805 Sight 8 5S 0OD 1lI"];
const glyphSheet = (cultures: readonly string[]): Bitmap => {
  const fonts = cultures.map((c) => { const p = generateTheme({ seed: 2, culture: c }).type.font; return [6, 8, 12].map((size) => generateFont(p, size)); });
  const blockH = (fs: PixelFont[]) => 12 + fs.reduce((h, f) => h + f.lineHeight + 4, 0);
  const b = createBitmap(560, 6 + fonts.reduce((h, fs) => h + blockH(fs) + 6, 0));
  fillRect(b, 0, 0, b.w, b.h, BG);
  let y = 6;
  cultures.forEach((culture, i) => {
    text({ bitmap: b, font: label, value: culture.toUpperCase(), x: 4, y: y + 7, color: DIM });
    y += 12;
    for (const f of fonts[i]!) {
      text({ bitmap: b, font: label, value: `${f.size}px`, x: 4, y: y + f.ascent, color: DIM });
      const x = text({ bitmap: b, font: f, value: SAMPLE[0]!, x: 36, y: y + f.ascent, color: INK });
      text({ bitmap: b, font: f, value: SAMPLE[1]!, x: Math.max(x + 16, 250), y: y + f.ascent, color: INK });
      y += f.lineHeight + 4;
    }
    y += 6;
  });
  return b;
};
for (const c of CULTURES) save(`glyphs-${c}.png`, glyphSheet([c]), 4);
save("glyphs.png", glyphSheet(CULTURES), 3);

// --- The console with a 12-unit group, per culture, at 1920x1080 (a 640x360 layer).
for (const c of CULTURES) {
  const ui = classicWithGroup({ culture: c, seed: 1, screenW: 1920, screenH: 1080, summary: SUMMARY_TWO });
  ui.set("unit.name", { text: "{bright}Warden{/}" });
  ui.render();
  const e = emptyShare(ui);
  console.log(`console ${c}: largest empty rectangle in the selection panel ${(e.share * 100).toFixed(1)}% (${e.rect.w}x${e.rect.h} of ${e.panel.w}x${e.panel.h})`);
  const b = world(ui.width, ui.height);
  over(b, ui);
  save(`console-${c}.png`, b, 2);
}

// --- The six silhouettes, stacked: the console's top band and the trims above it, over the world.
{
  const uis = CULTURES.map((culture) => classicPlain({ culture, seed: 3, screenW: 1920, screenH: 1080 }));
  let top = Infinity;
  for (const ui of uis) for (const n of ui.root.walk()) if (n.id.startsWith("trim.")) top = Math.min(top, n.rect.y);
  const masks = uis.map((ui) => consoleMask(ui, top).mask);
  let worst = 1, pair = "";
  for (let i = 0; i < 6; i += 1) for (let j = i + 1; j < 6; j += 1) { const d = maskDiff(masks[i]!, masks[j]!); if (d < worst) { worst = d; pair = `${CULTURES[i]}/${CULTURES[j]}`; } }
  console.log(`silhouettes: the closest two cultures (${pair}) differ in ${(worst * 100).toFixed(1)}% of the console band's alpha`);
  const bottom = uis[0]!.node("bottom")!.rect, y0 = top - 4, h = bottom.y + Math.round(bottom.h * 0.45) - y0;
  const b = createBitmap(uis[0]!.width, (h + 12) * 6);
  fillRect(b, 0, 0, b.w, b.h, BG);
  uis.forEach((ui, i) => {
    const w = world(ui.width, h);
    blit(b, w, 0, 0, w.w, w.h, 0, i * (h + 12) + 10);
    over(b, ui, 0, i * (h + 12) + 10, { x: 0, y: y0, w: ui.width, h });
    text({ bitmap: b, font: label, value: CULTURES[i]!.toUpperCase(), x: 4, y: i * (h + 12) + 8, color: INK });
  });
  save("consoles.png", b, 2);
}

// --- Command icons per culture, at 16 and 24 px.
{
  const shape = iconOverlap([16, 24], "shape"), painted = iconOverlap([16, 24], "painted");
  console.log(`icons: mean IoU culture to culture, shapes worst ${shape.worst.toFixed(3)} (${shape.pair}), painted worst ${painted.worst.toFixed(3)} (${painted.pair})`);
  const cell = 28, b = createBitmap(80 + COMMAND_ICONS.length * cell * 2, 16 + CULTURES.length * (cell + 4));
  fillRect(b, 0, 0, b.w, b.h, BG);
  CULTURES.forEach((c, r) => {
    const theme = generateTheme({ seed: 3, culture: c });
    const y = 12 + r * (cell + 4);
    text({ bitmap: b, font: label, value: c.toUpperCase(), x: 4, y: y + 14, color: DIM });
    COMMAND_ICONS.forEach((name, i) => {
      // (Each on its button's face, its colours kept 3:1 off it, as the console draws it.)
      const face = frameColours(theme, "button", "normal").fill;
      fillRect(b, 80 + i * cell * 2 - 2, y - 2, cell * 2 - 2, cell + 4, face);
      for (const [k, size] of [[0, 16], [1, 24]] as const) { const ic = iconBitmap(name, size, theme, { seed: 7, variant: 0, on: face }); blit(b, ic, 0, 0, ic.w, ic.h, 80 + i * cell * 2 + k * (cell - 8), y + (cell - size) / 2); }
    });
  });
  COMMAND_ICONS.forEach((name, i) => text({ bitmap: b, font: label, value: name.slice(0, 7), x: 80 + i * cell * 2, y: 9, color: DIM }));
  save("icons.png", b, 3);
}

// --- The game menu over a HUD with text: the new scrim, and a close-up of a label under the old and the new.
{
  const hud = generateHud({ seed: 4, culture: "industrial", layout: { preset: "classic" } });
  const ui = createUi({ theme: hud.theme, width: 640, height: 360, scale: 1 });
  ui.load(hud.screen);
  ui.set("unit.name", { text: "{bright}Tier 2 Warden x12{/}" });
  ui.set("unit.info", { text: "Holds the line; fires on what comes in range." });
  ui.set("alert.2", { text: "Base under attack", hidden: false });
  ui.render();
  const r = ui.node("unit.name")!.rect;
  const plain = ui.layer.px.slice();
  // The old scrim: a checker of the deepest surface over everything.
  const old = plain.slice();
  for (let y = 0; y < ui.height; y += 1) for (let x = (y & 1); x < ui.width; x += 2) old[y * ui.width + x] = hud.theme.palette.surface[0]!;
  ui.overlay.add(buildNode({ type: "modal", id: "menu.modal", w: "fill", h: "fill", children: [{ type: "panel", id: "menu.panel", anchor: "c", title: "Game menu", gap: 3, minW: 170, align: "stretch", children: [
    { type: "label", text: "{dim}Machine • paused{/}", font: "small" }, { type: "button", text: "Resume", action: "menu.resume", primary: true, hotkey: "R" }, { type: "button", text: "Options", action: "menu.options", hotkey: "O" }, { type: "button", text: "Quit", action: "menu.quit", hotkey: "Q" },
  ] }] } as NodeDoc));
  ui.render();
  const b = world(ui.width, ui.height);
  over(b, ui);
  save("modal.png", b, 2);
  // Close-ups (x6): the label with no modal, under the old checker, under the new scrim.
  const crop = { x: r.x - 2, y: r.y - 2, w: Math.min(120, r.w + 4), h: r.h + 4 };
  const z = createBitmap(crop.w, crop.h * 3 + 8);
  fillRect(z, 0, 0, z.w, z.h, BG);
  [plain, old, ui.layer.px].forEach((px, k) => { for (let y = 0; y < crop.h; y += 1) for (let x = 0; x < crop.w; x += 1) z.px[(k * (crop.h + 4) + y) * z.w + x] = px[(crop.y + y) * ui.width + crop.x + x]! || BG; });
  save("modal-label.png", z, 6);
  const ink = ui.tone("bright");
  const lost = (px: Uint32Array) => { let text = 0, kept = 0; for (let y = r.y; y < r.y + r.h; y += 1) for (let x = r.x; x < r.x + r.w; x += 1) if (plain[y * ui.width + x] === ink) { text += 1; if (px[y * ui.width + x] !== hud.theme.palette.surface[0]) kept += 1; } return `${kept} of ${text}`; };
  console.log(`modal: text pixels still apart from the dither colour -- old checker ${lost(old)}, new scrim ${lost(ui.layer.px)}`);
}

// --- The top-left buttons (MYRIAD's three), every culture, at 640x360 (x4).
{
  const menuButtons = [{ id: "menu", text: "Menu", icon: "menu", hotkey: "F10", action: "menu" }, { id: "pause", text: "Pause", icon: "pause", action: "pause" }, { id: "sound", text: "Sound", icon: "ping", action: "sound" }];
  const b = createBitmap(240, 24 * CULTURES.length);
  fillRect(b, 0, 0, b.w, b.h, rgba(60, 80, 55));
  CULTURES.forEach((c, i) => {
    const hud = generateHud({ seed: 2, culture: c, pins: { body: 8 }, layout: { preset: "classic" }, slots: { menuButtons } });
    const ui = createUi({ theme: hud.theme, width: 640, height: 360, scale: 1 });
    ui.load(hud.screen);
    ui.render();
    for (let y = 0; y < 24; y += 1) for (let x = 0; x < 240; x += 1) { const v = ui.layer.px[y * 640 + x]!; if (v) b.px[(i * 24 + y) * 240 + x] = v; }
  });
  save("menu-buttons.png", b, 4);
}

// --- The selection panel with 1, 2, 3, 4, 6 and 12 units, each with its health strip (industrial and organic).
{
  const rows: Array<{ ui: Ui; r: { x: number; y: number; w: number; h: number } }> = [];
  for (const culture of ["industrial", "organic"]) for (const count of [1, 2, 3, 4, 6, 12]) {
    const ui = classicWithGroup({ culture, seed: 1, screenW: 1920, screenH: 1080, summary: count > 1 ? SUMMARY_TWO : "{bright}Warden{/}\n{dim}Soldier • health 40%{/}" });
    for (let k = 0; k < 12; k += 1) ui.set(`group.${k}`, k < count ? { hp: [1, 0.8, 0.55, 0.3, 0.9, 0.15][k % 6]!, icon: k % 3 ? "worker" : "attack", tone: "ink" } : { hidden: true });
    ui.render();
    const e = emptyShare(ui);
    console.log(`group ${culture} x${count}: ${(e.share * 100).toFixed(1)}% empty, cells ${ui.node("group.0")!.rect.w}x${ui.node("group.0")!.rect.h}, icon ${ui.iconSizeOf("group.0")} px`);
    rows.push({ ui, r: { x: e.panel.x - 4, y: e.panel.y - 4, w: e.panel.w + 8, h: e.panel.h + 8 } });
  }
  const w = rows[0]!.r.w, h = rows[0]!.r.h;
  const b = createBitmap(w * 2 + 6, (h + 4) * 6);
  fillRect(b, 0, 0, b.w, b.h, BG);
  rows.forEach(({ ui, r }, i) => over(b, ui, Math.floor(i / 6) * (w + 6), (i % 6) * (h + 4), r));
  save("group-counts.png", b, 2);
}
