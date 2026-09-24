// The UI lab (packages/ui/tools/ui.html): the themes gallery (a seed strip
// across the cultures), the font lab (generated families; BMFont, TrueType
// and browser-rasterised imports), live HUDs at 480x270 x k (2D overlay) and
// 1920x1080 (drawn into the game's own WebGL2 context), a menu, a loading
// screen, and the benchmark. ?capture saves PNGs into out/ui/ through
// scripts/serve.mjs.
//   node packages/ui/tools/build.mjs && node scripts/serve.mjs  ->  http://localhost:4300/packages/ui/tools/ui.html

import {
  CULTURES, DEFAULT_FONT, blit, bmFont, createBitmap, createCanvasPresenter, createGlPresenter, createUi, decodePng, fillRect, generateFont, generateHud, generateLoading,
  generateMenu, generateTheme, glyphOf, kernKey, loadBrowserFont, loadFont, parseBmFont, rgba,
} from "../src/index.ts";
import type { Bitmap, Generated, NodeDoc, PixelFont, Rgba, Ui } from "../src/index.ts";
import { buildTtf } from "../test/ttf-builder.ts";
import { bench } from "./bench.ts";

type Log = (s: string) => void;
const q = new URLSearchParams(location.search);
const VIEWS = ["themes", "fonts", "hud", "hud1080", "menu", "loading", "bench"] as const;
const capture = q.has("capture");

function canvasOf(b: Bitmap, scale: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = b.w; c.height = b.h;
  c.style.width = `${b.w * scale}px`; c.style.height = `${b.h * scale}px`;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(b.px.slice().buffer), b.w, b.h), 0, 0);
  return c;
}
/** A bitmap scaled up nearest-neighbour into a canvas (what a capture saves). */
function scaled(b: Bitmap, k: number): HTMLCanvasElement {
  const small = canvasOf(b, 1);
  const c = document.createElement("canvas");
  c.width = b.w * k; c.height = b.h * k;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.drawImage(small, 0, 0, c.width, c.height);
  return c;
}
async function save(c: HTMLCanvasElement, name: string, log: Log): Promise<void> {
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  if (!blob) return;
  const res = await fetch(`/out/ui/${name}.png`, { method: "PUT", body: blob });
  log(`saved out/ui/${name}.png (${c.width}x${c.height}) ${res.status}`);
}
type TextOptions = { readonly bitmap: Bitmap; readonly font: PixelFont; readonly value: string; readonly x: number; readonly y: number; readonly color: Rgba };

function text({ bitmap: b, font: f, value: s, x, y, color: c }: TextOptions): number {
  let pen = x, prev = -1;
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    const g = glyphOf(f, code);
    if (!g) continue;
    if (prev >= 0) pen += f.kern.get(kernKey(prev, code)) ?? 0;
    for (let yy = 0; yy < g.h; yy += 1) for (let xx = 0; xx < g.w; xx += 1) {
      const px = pen + g.ox + xx, py = y + g.oy + yy;
      if (g.bits[yy * g.w + xx] && px >= 0 && py >= 0 && px < b.w && py < b.h) b.px[py * b.w + px] = c;
    }
    pen += g.adv; prev = code;
  }
  return pen;
}

// A stand-in for the game underneath: tiles and wandering units, drawn at the UI's resolution.
function ground(b: Bitmap, t: number): void {
  for (let y = 0; y < b.h; y += 1) for (let x = 0; x < b.w; x += 1) {
    const tx = (x + Math.floor(t * 6)) >> 4, ty = y >> 4;
    const h = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
    const base = h % 7 === 0 ? [74, 92, 60] : h % 11 === 0 ? [96, 86, 64] : [62, 80, 54];
    const d = ((x + y) & 1) && (h & 16) ? 6 : 0;
    b.px[y * b.w + x] = rgba(base[0]! - d, base[1]! - d, base[2]! - d);
  }
  for (let i = 0; i < 24; i += 1) {
    const ux = Math.floor((i * 97 + t * (10 + (i % 5) * 4)) % b.w), uy = Math.floor(60 + ((i * 53) % Math.max(1, b.h - 140)));
    fillRect(b, ux, uy, 4, 4, i % 3 ? rgba(210, 70, 60) : rgba(70, 120, 220));
    fillRect(b, ux, uy + 4, 4, 1, rgba(30, 36, 28));
  }
}

function cell(culture: string, seed: number): NodeDoc {
  return { type: "panel", title: `${culture} ${seed}`, w: "fill", h: "fill", children: [
    { type: "row", gap: 2, children: [
      { type: "button", icon: "attack", hotkey: "A", w: 20, h: 20, iconSize: 16 },
      { type: "button", icon: "build", hotkey: "B", w: 20, h: 20, iconSize: 16, cooldown: 0.4 },
      { type: "button", icon: "upgrade", w: 20, h: 20, iconSize: 16, active: true },
      { type: "button", text: "OK", primary: true, h: 20 },
    ] },
    { type: "bar", tone: "health", value: 30, max: 50, segments: 5, w: "fill", text: "30/50" },
    { type: "label", text: "{icon:mass} {tab}350{/} {good}+12{/} {warn}!{/}" },
  ] };
}

async function themes(main: HTMLElement, log: Log): Promise<void> {
  const seeds = Number(q.get("seeds") ?? 8), W = 156, H = 96, S = 12;
  const sheet = createBitmap(seeds * (W + 4) + 4, CULTURES.length * (H + S + 6) + 4);
  fillRect(sheet, 0, 0, sheet.w, sheet.h, rgba(12, 13, 18));
  CULTURES.forEach((culture, row) => {
    for (let i = 0; i < seeds; i += 1) {
      const seed = 1 + i * 17;
      const theme = generateTheme({ seed, culture });
      const ui = createUi({ theme, width: W, height: H, scale: 1 });
      ui.load({ screen: "cell", root: cell(culture, seed) });
      ui.render();
      const x = 4 + i * (W + 4), y = 4 + row * (H + S + 6);
      blit(sheet, ui.layer, 0, 0, W, H, x, y);
      // The palette: surface, ink, accent, good, warn, bad, then the first team ramps.
      const p = theme.palette;
      const ramps = [p.surface, p.ink, p.accent, p.good, p.warn, p.bad, ...p.team.slice(0, 4)];
      let sx = x;
      for (const r of ramps) { r.forEach((c, k) => fillRect(sheet, sx + k * 3, y + H + 2, 3, 8, c)); sx += r.length * 3 + 2; }
    }
  });
  const k = 2;
  main.append(Object.assign(document.createElement("h2"), { textContent: `Themes: ${CULTURES.length} cultures x ${seeds} seeds (each cell one theme; its palette below)` }), canvasOf(sheet, k));
  if (capture) await save(scaled(sheet, k), "themes", log);
}

async function fonts(main: HTMLElement, log: Log): Promise<void> {
  const sheet = createBitmap(760, 520);
  fillRect(sheet, 0, 0, sheet.w, sheet.h, rgba(14, 15, 21));
  const ink = rgba(226, 228, 240), dim = rgba(130, 136, 164);
  const label = generateFont(DEFAULT_FONT, 5);
  let y = 10;
  const sample = "The quick brown fox jumps 0123456789 AVATAR !?";
  text({ bitmap: sheet, font: label, value: "GENERATED FAMILIES (THEME FONTS), 5 7 9 12 16 PX", x: 6, y, color: dim }); y += 8;
  for (const culture of CULTURES) {
    const t = generateTheme({ seed: 3, culture });
    text({ bitmap: sheet, font: label, value: culture.toUpperCase(), x: 6, y: y + 6, color: dim });
    let x = 70;
    for (const size of [5, 7, 9, 12]) { const f = generateFont(t.type.font, size); x = text({ bitmap: sheet, font: f, value: "Hamburgefonstiv 0123", x, y: y + size, color: ink }) + 10; }
    const big = generateFont(t.type.font, 16);
    y += 18;
    text({ bitmap: sheet, font: big, value: "Myriad 1234", x: 70, y: y + 16, color: ink });
    text({ bitmap: sheet, font: generateFont(t.type.font, 9), value: "abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ", x: 260, y: y + 12, color: dim });
    y += 24;
  }
  y += 6;
  text({ bitmap: sheet, font: label, value: "IMPORTED", x: 6, y, color: dim }); y += 8;
  const fnt = await (await fetch("../test/fixtures/keel5.fnt")).text();
  const png = decodePng(new Uint8Array(await (await fetch("../test/fixtures/keel5.png")).arrayBuffer()));
  const bm = bmFont(parseBmFont(fnt), [png]);
  text({ bitmap: sheet, font: label, value: "BMFONT", x: 6, y: y + 5, color: dim }); text({ bitmap: sheet, font: bm, value: sample, x: 70, y: y + 5, color: ink }); y += 12;
  const ttf = buildTtf();
  text({ bitmap: sheet, font: label, value: "TTF (BUILT)", x: 6, y: y + 9, color: dim });
  let x = 70;
  for (const size of [7, 9, 12, 16]) { x = text({ bitmap: sheet, font: loadFont(ttf, size), value: "HOl=AV-", x, y: y + size, color: ink }) + 12; }
  y += 22;
  for (const family of ["Georgia", "Helvetica", "Arial", "Times New Roman", "Menlo"]) {
    try {
      text({ bitmap: sheet, font: label, value: `${family.toUpperCase()} (BROWSER)`.slice(0, 18), x: 6, y: y + 9, color: dim });
      let xx = 110;
      for (const size of [7, 9, 12]) { const f = await loadBrowserFont(`local('${family}')`, size); xx = text({ bitmap: sheet, font: f, value: size === 12 ? "Hamburgefonstiv 0123" : "Hamburgefonstiv 0123 AVATAR", x: xx, y: y + size, color: ink }) + 12; }
      y += 18;
    } catch (e) { log(`${family}: ${String(e)}`); }
  }
  main.append(Object.assign(document.createElement("h2"), { textContent: "Font lab: generated families by culture; BMFont, TrueType (parsed here) and browser (FontFace + canvas) imports, thresholded crisp" }), canvasOf(sheet, 2));
  if (capture) await save(scaled(sheet, 2), "fonts", log);
}

/** Drive a HUD like a game would: cooldowns cycling, a bar pulsing, the clock and resources ticking. */
function animate(ui: Ui, t: number): void {
  let i = 0;
  for (const n of ui.root.walk()) if (n.id.startsWith("cmd.") && n.type === "button" && !n.props.disabled && i++ % 3 === 0) n.set({ cooldown: (t * 0.25 + i * 0.13) % 1 });
  const hp = Math.round(28 + 20 * Math.sin(t * 0.8));
  ui.set("unit.hp", { value: hp, text: `${hp}/50` });
  ui.set("unit.shield", { value: 10 + 10 * Math.cos(t) });
  ui.set("queue.0", { cooldown: (t * 0.15) % 1 });
  ui.set("clock", { text: `{tab}${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t) % 60).padStart(2, "0")}{/}` });
  ui.set("res.mass", { text: `{icon:mass} {tab}${350 + Math.floor(t * 7)}{/}` });
  ui.set("res.energy", { text: `{icon:energy} {tab}${120 + Math.floor(t * 3) % 200}{/}` });
  ui.set("res.supply", { text: "{icon:supply} {tab}23/50{/}" });
  ui.set("idle", { count: 2 });
  ui.set("unit.name", { text: "{bright}Hauler{/} {dim}lv 3{/}" });
  ui.set("alert.0", { text: "Base under attack" });
  ui.set("alert.1", { text: "{good}Research complete{/}" });
}

function wire(ui: Ui, el: HTMLElement, toScreen: (e: PointerEvent) => [number, number], log: Log): void {
  el.addEventListener("pointermove", (e) => { const [x, y] = toScreen(e); ui.pointerMove(x, y); });
  el.addEventListener("pointerdown", (e) => { const [x, y] = toScreen(e); ui.pointerDown(x, y); });
  el.addEventListener("pointerup", (e) => { const [x, y] = toScreen(e); ui.pointerUp(x, y); });
  el.addEventListener("wheel", (e) => { ui.wheel(e.deltaY); });
  addEventListener("keydown", (e) => { if (ui.key(e.code, true, { shift: e.shiftKey })) e.preventDefault(); });
  addEventListener("keyup", (e) => { ui.key(e.code, false); });
  ui.on("click", (id) => { log(`click ${id}`); if (id !== "menu") ui.toast(`{accent}${id}{/} ordered`, { seconds: 2 }); else ui.modal({ title: "Paused", text: "The match waits for you.", buttons: [{ text: "Resume", action: "resume", primary: true }, { text: "Quit", action: "quit" }] }); });
  ui.on("modal", (a) => log(`modal ${a}`));
  ui.on("minimap", (_id, v) => log(`minimap ${JSON.stringify(v)}`));
}

function picker(main: HTMLElement, culture: string, seed: string): void {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `culture <select id="cu">${CULTURES.map((c) => `<option ${c === culture ? "selected" : ""}>${c}</option>`).join("")}</select> seed <input id="se" size="8" value="${seed}"> <button id="go">show</button> <button id="rr">reroll</button> <span style="color:#667">pointer, hotkeys (Q W E R T / A S D F G / Z X C V B), Tab, arrows, Enter, F10</span>`;
  main.append(row);
  const go = (s: string) => { const u = new URL(location.href); u.searchParams.set("culture", (row.querySelector("#cu") as HTMLSelectElement).value); u.searchParams.set("seed", s); location.href = u.href; };
  row.querySelector("#go")!.addEventListener("click", () => go((row.querySelector("#se") as HTMLInputElement).value));
  row.querySelector("#rr")!.addEventListener("click", () => go(String(Math.floor(Math.random() * 1e6))));
}

async function hud(main: HTMLElement, log: Log): Promise<void> {
  const k = Number(q.get("k") ?? 3), W = 480, H = 270;
  const culture = q.get("culture") ?? "industrial", seed = q.get("seed") ?? "7";
  picker(main, culture, seed);
  const make = (c: string): { g: Generated; ui: Ui } => {
    const g = generateHud({ seed, culture: c, width: W, height: H });
    const ui = createUi({ theme: g.theme, width: W * k, height: H * k, scale: k });
    ui.load(g.screen);
    return { g, ui };
  };
  if (capture) {
    for (const c of CULTURES) {
      const { ui } = make(c);
      animate(ui, 12.3); ui.update(0.5); ui.render();
      const composed = createBitmap(W, H);
      ground(composed, 3);
      blit(composed, ui.layer, 0, 0, W, H, 0, 0);
      await save(scaled(composed, k), `hud-480x270-x${k}-${c}`, log);
    }
  }
  const { g, ui } = make(culture);
  main.append(Object.assign(document.createElement("h2"), { textContent: `HUD ${W}x${H} x${k} -- ${culture}, seed ${seed}: ${g.theme.frame.corner} corners, ${g.theme.frame.fill} fill (${g.theme.frame.screen}), ${g.theme.motion.kind} motion; 2D overlay canvas above the game` }));
  const stack = document.createElement("div");
  stack.className = "stack";
  const game = createBitmap(W, H);
  const gameCanvas = canvasOf(game, k);
  const uiCanvas = document.createElement("canvas");
  stack.append(gameCanvas, uiCanvas);
  main.append(stack);
  const pres = createCanvasPresenter(uiCanvas as unknown as Parameters<typeof createCanvasPresenter>[0], ui, 1);
  wire(ui, uiCanvas, (e) => [e.offsetX, e.offsetY], log);
  const g2 = gameCanvas.getContext("2d")!;
  const img = new ImageData(new Uint8ClampedArray(game.px.buffer as ArrayBuffer), W, H);
  let last = performance.now(), t = 0, frames = 0, uiMs = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; t += dt;
    ground(game, t); g2.putImageData(img, 0, 0);
    const t0 = performance.now();
    animate(ui, t); ui.update(dt); pres.present(ui.render());
    uiMs += performance.now() - t0;
    if (++frames % 240 === 0) { log(`ui ${(uiMs / 240).toFixed(3)} ms/frame (animate + update + render + present)`); uiMs = 0; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

const BG_VS = `#version 300 es
in vec2 p; out vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const BG_FS = `#version 300 es
precision highp float; in vec2 v; uniform float t; uniform vec2 res; out vec4 o;
float h(vec2 q){ return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){ vec2 px = floor(v * res / 3.0); vec2 tile = floor((px + vec2(floor(t * 6.0), 0.0)) / 16.0); float r = h(tile);
  vec3 c = r < 0.14 ? vec3(0.29, 0.36, 0.24) : r < 0.2 ? vec3(0.38, 0.34, 0.25) : vec3(0.24, 0.31, 0.21);
  if (mod(px.x + px.y, 2.0) > 0.5 && r > 0.6) c -= 0.02; o = vec4(c, 1.0); }`;

async function hud1080(main: HTMLElement, log: Log): Promise<void> {
  const culture = q.get("culture") ?? "crystalline", seed = q.get("seed") ?? "7";
  picker(main, culture, seed);
  const W = 1920, H = 1080, dpr = devicePixelRatio || 1;
  const g = generateHud({ seed, culture });
  const ui = createUi({ theme: g.theme, width: W, height: H });
  ui.load(g.screen);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  canvas.style.width = `${W / dpr}px`; canvas.style.height = `${H / dpr}px`;
  main.append(Object.assign(document.createElement("h2"), { textContent: `HUD 1920x1080 (UI scale x${ui.scale}: a ${ui.width}x${ui.height} layer) drawn into the game's own WebGL2 context -- one texture, one draw` }), canvas);
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: capture, antialias: false })!;
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, BG_VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, BG_FS));
  gl.bindAttribLocation(prog, 0, "p");
  gl.linkProgram(prog);
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const pres = createGlPresenter(gl, ui);
  wire(ui, canvas, (e) => [e.offsetX * dpr, e.offsetY * dpr], log);
  let t = 0, last = performance.now(), frames = 0, cpu = 0;
  const frame = (dt: number) => {
    t += dt;
    gl.viewport(0, 0, W, H);
    gl.useProgram(prog); gl.bindVertexArray(vao);
    gl.uniform1f(gl.getUniformLocation(prog, "t"), t); gl.uniform2f(gl.getUniformLocation(prog, "res"), W, H);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const t0 = performance.now();
    animate(ui, t); ui.update(dt); pres.present(ui.render()); pres.draw();
    cpu += performance.now() - t0;
  };
  if (capture) { for (let i = 0; i < 30; i += 1) frame(1 / 60); animate(ui, 12.3); ui.update(0.5); pres.present(ui.render()); pres.draw(); await save(canvas, `hud-1920x1080-${culture}`, log); }
  const loop = (now: number) => {
    frame(Math.min(0.05, (now - last) / 1000)); last = now;
    if (++frames % 240 === 0) { log(`ui ${(cpu / 240).toFixed(3)} ms/frame CPU (animate + update + render + texSubImage + draw), uploaded ${(pres.uploaded / 1e6).toFixed(1)} MB total`); cpu = 0; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

async function screen(main: HTMLElement, log: Log, kind: "menu" | "loading"): Promise<void> {
  const k = 2, W = 640, H = 360;
  const culture = q.get("culture") ?? (kind === "menu" ? "arcane" : "organic"), seed = q.get("seed") ?? "7";
  picker(main, culture, seed);
  const shots: Array<[string, Generated]> = capture ? CULTURES.map((c) => [c, kind === "menu" ? generateMenu({ seed, culture: c, title: "MYRIAD", subtitle: "a galactic tournament" }) : generateLoading({ seed, culture: c })]) : [];
  for (const [c, g] of shots) {
    const ui = createUi({ theme: g.theme, width: W, height: H, scale: 1 });
    ui.load(g.screen);
    ui.set("loading.bar", { value: 0.62 }); ui.update(0.3); ui.render();
    await save(scaled(ui.layer, k), `${kind}-${c}`, log);
  }
  const g = kind === "menu" ? generateMenu({ seed, culture, title: "MYRIAD", subtitle: "a galactic tournament" }) : generateLoading({ seed, culture });
  const ui = createUi({ theme: g.theme, width: W * k, height: H * k, scale: k });
  ui.load(g.screen);
  const c = document.createElement("canvas");
  main.append(c);
  const pres = createCanvasPresenter(c as unknown as Parameters<typeof createCanvasPresenter>[0], ui, 1);
  wire(ui, c, (e) => [e.offsetX, e.offsetY], log);
  let t = 0, last = performance.now();
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    ui.set("loading.bar", { value: (t * 0.12) % 1 });
    ui.update(dt); pres.present(ui.render());
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

export async function run(main: HTMLElement, nav: HTMLElement, log: Log): Promise<void> {
  const view = (q.get("view") ?? "hud") as (typeof VIEWS)[number];
  nav.innerHTML = `<b>KEEL UI lab</b> ${VIEWS.map((v) => `<a href="?view=${v}" class="${v === view ? "on" : ""}">${v}</a>`).join(" ")} <span style="color:#667">(?capture saves PNGs to out/ui/)</span>`;
  switch (view) {
    case "themes": return themes(main, log);
    case "fonts": return fonts(main, log);
    case "hud": return hud(main, log);
    case "hud1080": return hud1080(main, log);
    case "menu": return screen(main, log, "menu");
    case "loading": return screen(main, log, "loading");
    case "bench": {
      for (const [w, h, s] of [[1920, 1080, 3], [1920, 1080, 1], [1440, 810, 3]] as const) {
        const r = bench({ width: w, height: h, scale: s });
        log(`${r.size}: ${r.buttons} buttons, ${r.nodes} nodes; first frame ${r.firstMs.toFixed(1)} ms; static ${(r.staticMs * 1000).toFixed(2)} µs; animated ${r.animatedMs.toFixed(3)} ms (${r.animatedPixels} px); full redraw ${r.fullMs.toFixed(2)} ms`);
      }
      (globalThis as { benchDone?: boolean }).benchDone = true;
      return;
    }
  }
}
