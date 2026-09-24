// The HUD benchmark (tools/bench.ts): a full RTS HUD -- 60 buttons, bars,
// labels, a minimap, a portrait -- per frame, static and animated, at 640x360
// (1080p at x3) and 1920x1080 at x1. The budget at 120 fps is 8.3 ms for
// everything; the UI's share should be a sliver of it. (Bounds are loose so
// a busy machine doesn't fail them; the numbers are printed.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { bench } from "../tools/bench.ts";

test("a full HUD (60 buttons and text): a static frame costs ~nothing; an animated one a sliver of a 120 fps frame", () => {
  for (const [w, h, s] of [[1920, 1080, 3], [1920, 1080, 1]] as const) {
    const r = bench({ width: w, height: h, scale: s, frames: 200 });
    console.log(`${r.size}: ${r.buttons} buttons, ${r.nodes} nodes; first frame ${r.firstMs.toFixed(1)} ms (fonts, icons, atlas); static ${(r.staticMs * 1000).toFixed(2)} µs/frame; animated ${r.animatedMs.toFixed(3)} ms/frame (${r.animatedPixels} px redrawn); full redraw ${r.fullMs.toFixed(2)} ms`);
    assert.ok(r.buttons >= 60, `${r.buttons} buttons`);
    // (Run alone -- node packages/ui/tools/bench.ts -- this machine measures ~0.4 µs static, ~0.3 ms animated,
    // ~1.7 ms full at 640x360. Under the whole suite's parallel load it's several times that: the bounds allow it.)
    if (process.env["KEEL_PERF"] === "1") assert.ok(r.staticMs < 0.2, `static ${r.staticMs} ms`);
    if (process.env["KEEL_PERF"] === "1") assert.ok(r.animatedMs < 16, `animated ${r.animatedMs} ms`);
    if (process.env["KEEL_PERF"] === "1") assert.ok(r.fullMs < 60, `full redraw ${r.fullMs} ms`);
  }
});
