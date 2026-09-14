// The HUD benchmark: a full RTS HUD with 60+ buttons and text, measured per frame --
// static (nothing changed), animated (15 cooldown sweeps, 3 bars, the clock and
// a resource ticking every frame), and a full redraw -- at 640x360 (1080p at x3)
// and at 1920x1080 at x1. Runs in Node and in the tool page.
//   node packages/ui/tools/bench.ts

import { UiNode, createUi, generateHud } from "../src/index.ts";
import type { Ui } from "../src/index.ts";

export interface BenchResult {
  readonly size: string;
  readonly buttons: number;
  readonly nodes: number;
  readonly firstMs: number;
  readonly staticMs: number;
  readonly animatedMs: number;
  readonly animatedPixels: number;
  readonly fullMs: number;
}

/** A full HUD: the generated one (command card, queue, a 16-unit group, idle, menu) plus a 20-button control-group and build bar. */
export function fullHud(width: number, height: number, scale: number, culture = "industrial", seed: string | number = 7): Ui {
  const hud = generateHud({ seed, culture, width: Math.ceil(width / scale), height: Math.ceil(height / scale), slots: { selection: { group: 16 }, resources: 4 } });
  const ui = createUi({ theme: hud.theme, width, height, scale });
  ui.load(hud.screen);
  const bar = new UiNode("panel", { anchor: "l", x: 2, y: -40, dir: "grid", cols: 4, gap: 1 }, "groups");
  for (let i = 0; i < 22; i += 1) bar.add(new UiNode("button", { text: String((i % 10) + 1), w: 16, h: 14, font: "small", count: i % 3 ? i : 0, tip: `Group ${i + 1}` }, `grp.${i}`));
  ui.content.add(bar);
  return ui;
}

const time = (f: () => void, n: number): number => { const t0 = performance.now(); for (let i = 0; i < n; i += 1) f(); return (performance.now() - t0) / n; };

export function bench(width: number, height: number, scale: number, frames = 240): BenchResult {
  const ui = fullHud(width, height, scale);
  const t0 = performance.now();
  ui.render();
  const firstMs = performance.now() - t0;
  let buttons = 0;
  for (const n of ui.root.walk()) if (n.type === "button") buttons += 1;
  // Warm the JIT, then measure.
  for (let i = 0; i < 60; i += 1) { ui.update(1 / 120); ui.render(); ui.paintAll(); }
  const staticMs = time(() => { ui.update(1 / 120); ui.render(); }, frames);
  const cmd = [...ui.root.walk()].filter((n) => n.id.startsWith("cmd.") && n.type === "button" && !n.props.disabled);
  let f = 0, pixels = 0;
  const animatedMs = time(() => {
    f += 1;
    const t = f / 120;
    cmd.forEach((b, i) => b.set({ cooldown: ((t * 0.5 + i * 0.07) % 1) }));
    ui.set("unit.hp", { value: 25 + 25 * Math.sin(t), text: `${Math.round(25 + 25 * Math.sin(t))}/50` });
    ui.set("unit.shield", { value: 10 + 10 * Math.cos(t) });
    ui.set("queue.0", { cooldown: (t * 0.2) % 1 });
    ui.set("clock", { text: `{tab}${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t) % 60).padStart(2, "0")}{/}` });
    ui.set("res.mass", { text: `{icon:mass} {tab}${100 + f}{/}` });
    ui.update(1 / 120);
    ui.render();
    pixels += ui.stats.pixels;
  }, frames);
  const fullMs = time(() => ui.paintAll(), Math.max(10, frames / 8));
  return { size: `${width}x${height} @x${scale}`, buttons, nodes: ui.stats.nodes, firstMs, staticMs, animatedMs, animatedPixels: Math.round(pixels / frames), fullMs };
}

const argv1 = (globalThis as { process?: { argv: string[] } }).process?.argv[1];
if (argv1 && import.meta.url === `file://${argv1}`) {
  for (const [w, h, s] of [[1920, 1080, 3], [1920, 1080, 1], [1440, 810, 3]] as const) {
    const r = bench(w, h, s);
    console.log(`${r.size.padEnd(16)} buttons ${r.buttons}  nodes ${r.nodes}  first ${r.firstMs.toFixed(1)} ms  static ${(r.staticMs * 1000).toFixed(1)} µs  animated ${r.animatedMs.toFixed(3)} ms (${r.animatedPixels} px/frame)  full redraw ${r.fullMs.toFixed(2)} ms`);
  }
}
