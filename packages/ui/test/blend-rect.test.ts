// blendRect lays a rectangle over what's there exactly as `blend` lays each of its pixels -- its row-at-a-time path
// (a fill for an opaque colour, the last pixel's answer reused while the pixels under it repeat) never changes a pixel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blend, blendRect } from "../src/chrome.ts";
import { createBitmap } from "../src/bitmap.ts";

test("blendRect matches blend, pixel for pixel: over nothing, over runs of one colour, over noise, clipped at the edges", () => {
  let seed = 7;
  const rand = (): number => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
  const alphas = [0, 1, 40, 128, 200, 254, 255];
  for (let n = 0; n < 300; n += 1) {
    const a = createBitmap(37, 23), b = createBitmap(37, 23);
    // (What's under it: cleared, a few flat runs, or noise.)
    const kind = n % 3;
    for (let i = 0; i < a.px.length; i += 1) {
      const v = kind === 0 ? 0 : kind === 1 ? [0, 0x80102030, 0xff405060][Math.floor(i / 50) % 3]! : (Math.floor(rand() * 2 ** 32) >>> 0);
      a.px[i] = v; b.px[i] = v;
    }
    const c = ((alphas[n % alphas.length]! << 24) | Math.floor(rand() * 2 ** 24)) >>> 0;
    const x = rand() * 50 - 10, y = rand() * 34 - 8, w = rand() * 45, h = rand() * 30;
    blendRect(a, x, y, w, h, c);
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y)), x1 = Math.min(b.w, Math.round(x + w)), y1 = Math.min(b.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) blend(b, xx, yy, c);
    assert.deepEqual(a.px, b.px, `case ${n}`);
  }
});
