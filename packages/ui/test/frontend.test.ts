import assert from "node:assert/strict";
import { test } from "node:test";
import {
  anchorRect, blend, columnLayout, createBitmap, createFlow, createMenu, createRepeater, createStore, createToasts, dither, fadeInto, fitText, generateFont,
  memoryStorage, mergeDefaults, panelInto, promptInto, promptWidth, rgba, segmentsInto, settingsSchema, slantRect, statBarInto, tableInto, wipeInto,
} from "../src/index.ts";

const count = (b: { px: Uint32Array }, c: number): number => b.px.reduce((n, p) => n + (p === c ? 1 : 0), 0);
const filled = (b: { px: Uint32Array }): number => b.px.reduce((n, p) => n + (p >>> 24 ? 1 : 0), 0);

test("flow: push, pop, replace and reset keep a stack, each starting a transition that runs out", () => {
  const f = createFlow<"title" | "main" | "settings">({ initial: "title", duration: 0.2 });
  const seen: string[] = [];
  f.onChange((top, kind) => seen.push(`${kind}:${top?.screen ?? "-"}`));
  f.replace("main");
  f.push("settings", { tab: "audio" });
  assert.equal(f.top?.screen, "settings");
  assert.equal(f.top?.params.tab, "audio");
  assert.deepEqual(f.transition && { from: f.transition.from, to: f.transition.to, kind: f.transition.kind }, { from: "main", to: "settings", kind: "push" });
  f.update(0.1);
  assert.ok(f.transition && Math.abs(f.transition.t - 0.5) < 1e-9);
  f.update(0.2);
  assert.equal(f.transition, null);
  assert.equal(f.pop()?.screen, "settings");
  assert.equal(f.top?.screen, "main");
  f.push("settings");
  assert.ok(f.popTo("main") && f.stack.length === 1);
  f.reset();
  assert.equal(f.top, null);
  assert.deepEqual(seen, ["replace:main", "push:settings", "pop:main", "push:settings", "pop:main", "reset:-"]);
});

test("menu: a list skips what's disabled and wraps; entries adjust by their kind", () => {
  const m = createMenu([
    { id: "race", label: "Race" }, { id: "online", label: "Online", disabled: true },
    { id: "units", label: "Units", kind: "choice", choices: ["KM/H", "MPH"], value: 0 },
    { id: "vol", label: "Volume", kind: "range", min: 0, max: 1, step: 0.25, value: 0.5 },
    { id: "tc", label: "Traction", kind: "toggle", value: 1 },
  ]);
  assert.equal(m.focused?.id, "race");
  m.move(1);
  assert.equal(m.focused?.id, "units");
  assert.equal(m.adjust(1), 1);
  assert.equal(m.adjust(1), 0);
  m.move(1);
  assert.equal(m.adjust(1), 0.75);
  assert.equal(m.adjust(1), 1);
  assert.equal(m.adjust(1), 1);
  m.move(1);
  assert.equal(m.activate()?.value, 0);
  m.move(1);
  assert.equal(m.focused?.id, "race");
  m.move(-1);
  assert.equal(m.focused?.id, "tc");
  m.setItems([{ id: "x", label: "X" }, { id: "tc", label: "Traction", kind: "toggle", value: 0 }]);
  assert.equal(m.focused?.id, "tc");
});

test("menu: a grid moves across its row and down its column, the short last row taken into account", () => {
  const m = createMenu(Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, label: `${i}` })), { columns: 3 });
  m.move(0, 1); m.move(0, 1);
  assert.equal(m.focused?.id, "c2");
  m.move(0, 1);
  assert.equal(m.focused?.id, "c0");
  m.move(1); m.move(1);
  assert.equal(m.focused?.id, "c6");
  m.focus("c5");
  m.move(1);
  assert.equal(m.focused?.id, "c6");
});

test("menu: a held direction fires once, then repeats after the delay", () => {
  const r = createRepeater({ delay: 0.3, rate: 0.1 });
  let fired = 0;
  for (let i = 0; i < 60; i += 1) if (r.step(true, 1 / 60)) fired += 1;
  // (1 s held: the press, then repeats from 0.3 s every 0.1 s -- about eight.)
  assert.ok(fired >= 7 && fired <= 10, `${fired}`);
  assert.equal(r.step(false, 1 / 60), false);
  assert.equal(r.step(true, 1 / 60), true);
});

test("toasts: they hold and fade, a key coalesces, and a full queue sends the lowest priority out", () => {
  const t = createToasts({ max: 2, life: 1, fadeIn: 0.1, fadeOut: 0.2 });
  t.push({ text: "WRONG WAY", key: "wrong", priority: 5 });
  t.push({ text: "WRONG WAY", key: "wrong", priority: 5 });
  assert.equal(t.size, 1);
  t.push({ text: "+1 P3" });
  t.push({ text: "BEST LAP" });
  t.update(0.05);
  const live = t.views().filter((v) => !v.toast.leaving).map((v) => v.toast.text);
  assert.deepEqual(live.sort(), ["BEST LAP", "WRONG WAY"]);
  t.update(1.1);
  assert.ok(t.views().every((v) => v.alpha < 1));
  t.update(0.5);
  assert.equal(t.size, 0);
});

test("store: defaults on a first run, saved and read back, junk repaired, a broken storage never throws", () => {
  const storage = memoryStorage();
  const s = createStore({ cash: 1000, name: "RYO", cars: [] as string[], opts: { units: "kmh", vol: 0.8 } }, { key: "save", storage, sanitize: (v) => ({ ...v, cash: Math.max(0, Math.round(v.cash)) }) });
  assert.equal(s.loaded, false);
  s.set({ cash: 2500.4, cars: ["a"] });
  const again = createStore({ cash: 1000, name: "RYO", cars: [] as string[], opts: { units: "kmh", vol: 0.8 } }, { key: "save", storage });
  assert.equal(again.loaded, true);
  assert.deepEqual(again.get(), { cash: 2500, name: "RYO", cars: ["a"], opts: { units: "kmh", vol: 0.8 } });
  assert.deepEqual(mergeDefaults({ a: 1, b: "x", o: { k: 1 } }, { a: "bad", b: "y", o: { k: 2, extra: 3 } }), { a: 1, b: "y", o: { k: 2, extra: 3 } });
  storage.setItem("save", "{not json");
  assert.equal(createStore({ cash: 7 }, { key: "save", storage }).get().cash, 7);
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
  const b = createStore({ cash: 7 }, { key: "k", storage: broken });
  assert.equal(b.set({ cash: 9 }).cash, 9);
  assert.equal(b.save(), false);
  // (A different version: migrated, or dropped for the defaults.)
  storage.setItem("v", JSON.stringify({ v: 1, data: { cash: 5 } }));
  assert.equal(createStore({ cash: 1 }, { key: "v", storage, version: 2 }).get().cash, 1);
  assert.equal(createStore({ cash: 1 }, { key: "v", storage, version: 2, migrate: (old) => ({ cash: (old as { cash: number }).cash * 2 }) }).get().cash, 10);
});

test("settings schema: defaults, a sanitiser and menu entries per tab from one description", () => {
  const schema = settingsSchema([
    { id: "units", tab: "Gameplay", label: "Units", kind: "choice", choices: ["KM/H", "MPH"], initial: "KM/H" },
    { id: "tc", tab: "Gameplay", label: "Traction control", kind: "toggle", initial: true },
    { id: "music", tab: "Audio", label: "Music", kind: "range", min: 0, max: 1, step: 0.1, initial: 0.7, format: (v) => `${Math.round(v * 100)}%` },
  ]);
  assert.deepEqual(schema.tabs, ["Gameplay", "Audio"]);
  assert.deepEqual(schema.defaults, { units: "KM/H", tc: true, music: 0.7 });
  assert.deepEqual(schema.sanitize({ units: "FURLONGS", tc: "yes", music: 4 }), { units: "KM/H", tc: true, music: 1 });
  const items = schema.items("Gameplay", { units: "MPH", tc: false, music: 0.7 });
  assert.deepEqual(items.map((i) => [i.id, i.value]), [["units", 1], ["tc", 0]]);
  assert.equal(schema.fromMenu("units", 1), "MPH");
  assert.equal(schema.fromMenu("tc", 1), true);
  assert.equal(schema.display("music", schema.defaults), "70%");
});

test("chrome: a panel fills inside its cut corners with a rim, a glow outside, see-through where asked", () => {
  const b = createBitmap(40, 30);
  const edge = rgba(80, 200, 255), hi = rgba(255, 255, 255);
  panelInto(b, 5, 5, 30, 20, { top: rgba(10, 20, 40, 200), bottom: rgba(4, 8, 20, 230), edge, hi, cut: 4, glow: 2, glowColour: rgba(80, 200, 255, 120) });
  assert.ok((b.px[5 * 40 + 5]! >>> 24) <= 120, "the cut corner holds only glow");
  assert.equal(b.px[5 * 40 + 20], hi, "the top edge is lit");
  const mid = b.px[15 * 40 + 20]!;
  assert.ok(mid >>> 24 >= 200 && mid >>> 24 < 255, "the fill is see-through");
  assert.ok(filled(b) > 30 * 20 - 40, "glow and fill");
  // Blending over what's there: two half-opaque layers make a more opaque one.
  const c = createBitmap(1, 1);
  blend(c, 0, 0, rgba(255, 0, 0, 128));
  blend(c, 0, 0, rgba(0, 0, 255, 128));
  assert.ok(c.px[0]! >>> 24 > 180 && (c.px[0]! & 255) > 40 && ((c.px[0]! >>> 16) & 255) > 100);
});

test("chrome: a slanted bar leans, segments and stat bars light by value, fades and wipes cover by amount", () => {
  const on = rgba(255, 180, 60), off = rgba(40, 40, 60), gain = rgba(80, 255, 80), loss = rgba(255, 60, 60);
  const s = createBitmap(30, 10);
  slantRect(s, 0, 0, 10, 10, 6, on);
  assert.equal(s.px[0 * 30 + 6], on);
  assert.equal(s.px[0 * 30 + 0]! >>> 24, 0);
  assert.equal(s.px[9 * 30 + 0], on);
  const seg = createBitmap(50, 4);
  segmentsInto(seg, 0, 0, 50, 4, 0.5, 10, { on, off });
  assert.ok(count(seg, on) > count(seg, off) * 0.8 && count(seg, on) < count(seg, off) * 1.25);
  const bar = createBitmap(60, 3);
  statBarInto(bar, 0, 0, 60, 3, 0.5, 0.75, { on, off, gain, loss, segments: 20 });
  assert.ok(count(bar, gain) > 0 && count(bar, loss) === 0);
  statBarInto(bar, 0, 0, 60, 3, 0.5, 0.25, { on, off, gain, loss, segments: 20 });
  assert.ok(count(bar, loss) > 0);
  const f = createBitmap(16, 16);
  fadeInto(f, 0.5, rgba(0, 0, 0));
  assert.equal(filled(f), 128);
  const w = createBitmap(32, 8);
  wipeInto(w, 0.5, rgba(0, 0, 0), { slant: 0, soft: 0 });
  assert.ok(filled(w) > 100 && filled(w) < 160, `${filled(w)}`);
  assert.equal(dither(0, 0, 0.05), true);
  assert.deepEqual(anchorRect("br", 4, 4, 10, 10, 100, 50), { x: 86, y: 36 });
  assert.deepEqual(anchorRect("c", 0, -5, 10, 10, 100, 50), { x: 45, y: 15 });
});

test("prompts: a key, an Xbox face button in its colour, PlayStation's shapes drawn without a font", () => {
  const font = generateFont(undefined, 7);
  const b = createBitmap(80, 16);
  const w = promptInto(b, { label: "SPACE", shape: "key" }, font, 0, 0);
  assert.equal(w, promptWidth({ label: "SPACE", shape: "key" }, font));
  const a = promptInto(b, { label: "A", shape: "round", colour: "#3fbf3f" }, font, 40, 0);
  assert.ok(a > 5 && count(b, rgba(63, 191, 63)) > 10);
  const ps = createBitmap(16, 16);
  promptInto(ps, { label: "✕", shape: "round", colour: "#7ea8ff" }, font, 0, 0);
  assert.ok(count(ps, rgba(126, 168, 255)) > 6);
});

test("table: columns share what's left by grow, text is cut to fit, the highlight row stands out", () => {
  const cols = [{ key: "pos", label: "P", width: 12, align: "right" as const }, { key: "name", label: "DRIVER" }, { key: "gap", label: "GAP", width: 30, align: "right" as const }];
  const lay = columnLayout(cols, 200, 4);
  assert.deepEqual(lay.map((c) => c.w), [12, 150, 30]);
  assert.equal(lay[2]!.x + lay[2]!.w, 200);
  const font = generateFont(undefined, 7);
  assert.ok(fitText(font, "A VERY LONG DRIVER NAME INDEED", 40).endsWith("…"));
  const b = createBitmap(200, 60), hl = rgba(255, 180, 60, 220);
  const h = tableInto(b, 0, 0, 200, cols, [
    { cells: { pos: "1", name: "KAI", gap: "--" }, chip: rgba(255, 0, 0) },
    { cells: { pos: "2", name: "YOU", gap: "+1.2" }, highlight: true, chip: rgba(0, 255, 0) },
  ], { font, header: rgba(150, 150, 170), text: rgba(230, 230, 240), dimText: rgba(90, 90, 110), rowH: 11, highlightBg: hl, highlightText: rgba(10, 10, 20), rule: rgba(80, 80, 100) });
  assert.ok(h > 22 && h < 40);
  assert.ok(count(b, hl) > 150);
  assert.ok(count(b, rgba(255, 0, 0)) > 10);
});
