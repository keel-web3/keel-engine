// Capture: the pure helpers, and the whole of createCapture (png, video,
// film, gif, save) on browser stand-ins -- and, where the proof of concept is
// here, its src/capture/capture.js driven the same way: the same calls to the
// browser, the same blobs, GIF bytes identical.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeGif } from "@keel-engine/core";
import * as tCap from "../src/capture.ts";
import type { Capture, CaptureOptions } from "../src/capture.ts";
import { install } from "./browser-stand-in.ts";
import type { FakeCanvas, Log } from "./browser-stand-in.ts";
import { counter, hasPoc, poc, rand, skip } from "./reference.ts";

const jCap = hasPoc ? await poc<typeof tCap>("src/capture/capture.js") : null;
const { same, summary } = counter();

test("flipRows: bottom row first (GL) to top row first", () => {
  const W = 3;
  const H = 4;
  const src = new Uint8Array(W * H * 4).map((_, i) => i);
  const out = tCap.flipRows(src, W, H);
  for (let y = 0; y < H; y += 1) assert.deepEqual([...out.subarray(y * W * 4, (y + 1) * W * 4)], [...src.subarray((H - 1 - y) * W * 4, (H - y) * W * 4)]);
  assert.ok(out instanceof Uint8ClampedArray);
});

test("videoScale: blown up nearest-neighbour, up to 8x, to about 1080 px", () => {
  assert.deepEqual([32, 64, 128, 256, 540, 1080, 2000].map((s) => tCap.videoScale(s, s)), [8, 8, 8, 4, 2, 1, 1]);
  assert.equal(tCap.videoScale(320, 180), 3, "the long side rules");
  assert.equal(tCap.videoScale(128, 128, 1), 1, "scale: 1 records the canvas as it is");
});

test("pickMime: the asked-for type if the browser records it, else VP9, VP8, WebM", () => {
  const only = (...ok: string[]) => (t: string) => ok.includes(t);
  assert.equal(tCap.pickMime("video/mp4", only("video/mp4", "video/webm")), "video/mp4");
  assert.equal(tCap.pickMime("video/mp4", only("video/webm;codecs=vp8", "video/webm")), "video/webm;codecs=vp8");
  assert.equal(tCap.pickMime(null, only()), undefined);
});

test("gifIndexer: the colours a clip uses, the palette first; past 255 it refuses", () => {
  const t = tCap.gifIndexer([[9, 9, 9], [1, 2, 3], [9, 9, 9]]);
  assert.deepEqual(t.colours, [[9, 9, 9], [1, 2, 3]], "a repeated palette entry counts once");
  assert.deepEqual([...t.index([1, 2, 3, 255, 7, 7, 7, 255, 9, 9, 9, 0], 3)], [1, 2, 0], "alpha is ignored");
  assert.deepEqual(t.colours, [[9, 9, 9], [1, 2, 3], [7, 7, 7]]);
  const big = tCap.gifIndexer();
  const rgba = new Uint8Array(256 * 4).map((_, i) => (i % 4 === 0 ? i >> 2 : 0));
  assert.throws(() => big.index(rgba, 256), /More colours than a GIF holds/);
  assert.equal(big.colours.length, 255);
});

// ---------------------------------------------------------------- createCapture on stand-ins

type Make = typeof tCap.createCapture;
/** A little game: step counts time, draw paints a frame of `colours` colours from a seed (into the canvas and the renderer's buffer). */
function game({ seed, W, H, colours, canvas, log }: { seed: number; W: number; H: number; colours: number; canvas: FakeCanvas; log: Log }) {
  let t = 0;
  let frame = new Uint8Array(W * H * 4);
  const r = rand(seed);
  const tones = Array.from({ length: colours }, () => [Math.floor(r() * 256), Math.floor(r() * 256), Math.floor(r() * 256)] as const);
  const draw = (): void => {
    log.push(["draw", +t.toFixed(9)]);
    const g = rand(seed + Math.round(t * 1000));
    frame = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i += 1) { const c = tones[Math.floor(g() * colours)]!; frame.set([c[0], c[1], c[2], 255], i * 4); }
    // (The canvas shows it top row first; the renderer reads bottom row first.)
    for (let y = 0; y < H; y += 1) canvas.rgba.set(frame.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  };
  return { step: (dt: number) => { t += dt; log.push(["step", dt]); }, draw, renderer: { read: () => { log.push(["read"]); return frame.slice(); } } };
}

async function blob(b: Blob | null): Promise<[string, number[]] | null> { return b ? [b.type, [...new Uint8Array(await b.arrayBuffer())]] : null; }
async function outcome<T>(f: () => Promise<T>): Promise<{ ok: T } | { err: string }> {
  try { return { ok: await f() }; } catch (e) { return { err: e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e) }; }
}
/** (Video's copy runs off animation frames -- real time -- so its log keeps the calls, not how many frames there were.) */
// (video() copies frames on animation frames while real time passes: how many copies land depends on the machine's
// load, so a repeated frame copy -- the smoothing switch and the draw, a pair -- counts once.)
const COPY = new Set(["imageSmoothingEnabled", "drawImage"]);
const settle = (log: Log): Log => {
  const seen = new Set<string>();
  return log.filter((e) => e[0] !== "requestAnimationFrame").filter((e, i, a) => {
    const k = JSON.stringify(e);
    if (COPY.has(String(e[0]))) { if (seen.has(k)) return false; seen.add(k); return true; }
    return i === 0 || k !== JSON.stringify(a[i - 1]);
  });
};

/** One capture session, on fresh stand-ins: every call and blob it made. */
async function session(make: Make, seed: number, what: (cap: Capture) => Promise<Blob | null | string>, { W = 16, H = 12, colours = 6, renderer = true, fixed = true } = {}) {
  const log: Log = [];
  const env = install(log);
  try {
    const canvas = env.canvas("game", W, H);
    const g = game({ seed, W, H, colours, canvas, log });
    const opts: CaptureOptions = fixed ? { step: g.step, draw: g.draw, ...(renderer ? { renderer: g.renderer } : {}) } : {};
    const cap = make(canvas as unknown as HTMLCanvasElement, opts);
    const out = await outcome(async () => { const b = await what(cap); return typeof b === "string" ? b : blob(b); });
    return { out, log: settle(log) };
  } finally { env.restore(); }
}

test("png, gif, film, video and save on stand-ins", async () => {
  const png = await session(tCap.createCapture, 1, (c) => c.png());
  assert.deepEqual(png.out, { ok: ["image/png", [...new TextEncoder().encode("game 16x12")]] });
  assert.deepEqual(png.log.map((e) => e[0]), ["draw", "toBlob"]);

  // A GIF: the colours the clip uses, frames stepped at a fixed rate, the same bytes as encoding the frames directly.
  const gif = await session(tCap.createCapture, 2, (c) => c.gif({ seconds: 0.2, fps: 25 }));
  assert.ok("ok" in gif.out && gif.out.ok);
  const [type, bytes] = gif.out.ok as [string, number[]];
  assert.equal(type, "image/gif");
  assert.equal(gif.log.filter((e) => e[0] === "step").length, 5);
  assert.ok(gif.log.every((e) => e[0] !== "step" || e[1] === 1 / 25));
  // (Rebuild it by hand: the renderer's frames, flipped, indexed, encoded.)
  const log: Log = [];
  const canvas = { rgba: new Uint8ClampedArray(16 * 12 * 4) } as FakeCanvas;
  const g = game({ seed: 2, W: 16, H: 12, colours: 6, canvas, log });
  const table = tCap.gifIndexer();
  const frames = Array.from({ length: 5 }, () => { g.step(1 / 25); g.draw(); return { pixels: table.index(tCap.flipRows(g.renderer.read(), 16, 12), 16 * 12), delay: 4 }; });
  assert.deepEqual(bytes, [...encodeGif({ width: 16, height: 12, palette: table.colours, frames, loop: 0 })]);

  const tooMany = await session(tCap.createCapture, 3, (c) => c.gif({ seconds: 0.04, fps: 25 }), { colours: 300, W: 32, H: 32 });
  assert.match("err" in tooMany.out ? tooMany.out.err : "", /RangeError: More colours than a GIF holds/);
  const noGame = await session(tCap.createCapture, 4, (c) => c.gif(), { fixed: false });
  assert.match("err" in noGame.out ? noGame.out.err : "", /gif steps the game itself/);

  const film = await session(tCap.createCapture, 5, (c) => c.film({ seconds: 0.1, fps: 40 }));
  assert.deepEqual(film.out, { ok: ["video/webm;codecs=vp8", [...new TextEncoder().encode("clip")]] });
  assert.equal(film.log.filter((e) => e[0] === "requestFrame").length, 4);
  assert.ok(film.log.some((e) => e[0] === "drawImage" && e[5] === 16 * 8 && e[6] === 12 * 8), "blown up 8x, nearest-neighbour");
  assert.ok(film.log.some((e) => e[0] === "imageSmoothingEnabled" && e[2] === false));

  const video = await session(tCap.createCapture, 6, (c) => c.video({ seconds: 0.04, scale: 1, type: "video/webm" }));
  assert.deepEqual(video.out, { ok: ["video/webm", [...new TextEncoder().encode("clip")]] });
  assert.ok(video.log.some((e) => e[0] === "captureStream" && e[1] === "game" && e[2] === 60), "scale 1: the canvas itself, at 60 fps");

  const saved = await session(tCap.createCapture, 7, (c) => c.save(new Blob(["x"]), "out/a/clip.webm"));
  assert.deepEqual(saved.out, { ok: "out/a/clip.webm" });
  const offline = await session(tCap.createCapture, 7, (c) => c.save(new Blob(["x"]), "offline/clip.webm"));
  assert.deepEqual(offline.out, { ok: "clip.webm" });
  assert.ok(offline.log.some((e) => e[0] === "click" && e[2] === "clip.webm"), "a download instead");
  const noPut = await session(tCap.createCapture, 7, (c) => c.save(new Blob(["x"]), "out/b.png", { put: false }));
  assert.ok(!noPut.log.some((e) => e[0] === "fetch"));
});

test("the proof of concept's capture, driven the same way: the same browser calls and the same blobs", { skip }, async () => {
  const jMake = jCap!.createCapture;
  const cases: [string, (c: Capture) => Promise<Blob | null | string>, Parameters<typeof session>[3]][] = [
    ["png", (c) => c.png(), {}],
    ["gif", (c) => c.gif({ seconds: 0.2, fps: 25 }), {}],
    ["gif (2D copy)", (c) => c.gif({ seconds: 0.12, fps: 25 }), { renderer: false }],
    ["gif (palette, loop once)", (c) => c.gif({ seconds: 0.2, fps: 10, palette: [[0, 0, 0], [255, 255, 255], [0, 0, 0]], loop: 1 }), {}],
    ["gif (too many colours)", (c) => c.gif({ seconds: 0.04, fps: 25 }), { colours: 300, W: 32, H: 32 }],
    ["gif (no game)", (c) => c.gif(), { fixed: false }],
    ["film", (c) => c.film({ seconds: 0.1, fps: 40 }), {}],
    ["film (scale 2, mp4 asked)", (c) => c.film({ seconds: 0.05, fps: 40, scale: 2, type: "video/mp4" }), {}],
    ["film (big)", (c) => c.film({ seconds: 0.05, fps: 40 }), { W: 300, H: 200 }],
    ["film (no game)", (c) => c.film(), { fixed: false }],
    ["video", (c) => c.video({ seconds: 0.05 }), {}],
    ["video (scale 1)", (c) => c.video({ seconds: 0.03, scale: 1, fps: 24 }), {}],
    ["save", (c) => c.save(new Blob(["abc"]), "out/x/y.gif"), {}],
    ["save (offline)", (c) => c.save(new Blob(["abc"]), "offline/y.gif"), {}],
    ["save (refused)", (c) => c.save(new Blob(["abc"]), "elsewhere/y.gif"), {}],
    ["save (no put)", (c) => c.save(new Blob(["abc"]), "out/y.gif", { put: false }), {}],
  ];
  for (const [name, what, opts] of cases) {
    for (const seed of name.startsWith("gif") ? [1, 2, 3, 4, 5, 6, 7, 8] : [1]) {
      const a = await session(tCap.createCapture, seed, what, opts);
      const b = await session(jMake, seed, what, opts);
      same(`capture ${name.split(" ")[0]!} (results)`, a.out, b.out, name);
      same(`capture ${name.split(" ")[0]!} (browser calls)`, a.log, b.log, name);
    }
  }
  // GIFs at more sizes and colour counts: the bytes.
  const r = rand(77);
  for (let i = 0; i < 40; i += 1) {
    const opts = { W: 1 + Math.floor(r() * 40), H: 1 + Math.floor(r() * 40), colours: 1 + Math.floor(r() * 40) };
    const fps = 5 + Math.floor(r() * 30);
    const a = await session(tCap.createCapture, i, (c) => c.gif({ seconds: 0.25, fps }), opts);
    const b = await session(jMake, i, (c) => c.gif({ seconds: 0.25, fps }), opts);
    same("capture gif bytes (random clips)", a.out, b.out);
  }
  console.log(summary("capture vs the proof of concept (all identical)"));
});
