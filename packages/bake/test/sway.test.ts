import { test } from "node:test";
import assert from "node:assert/strict";
import { SWAY_INSTANCE_FLOATS, SwayInstances, packSway, swayShiftPacked, unpackSway } from "../src/index.ts";
import { SWAY_VS, swayFragment } from "../src/sway.ts";

// object/sway.ts's reference, restated (bake doesn't depend on keel/object): the shift a row takes.
const signal = (t: number, hz: number, phase: number): number => Math.sin(2 * Math.PI * (hz * t + phase)) + 0.35 * Math.sin(2 * Math.PI * (2.3 * hz * t + 1.7 * phase));
const weight = (y: number, top: number, s: { bend: number; from: number }): number => (y <= s.from || top <= s.from ? 0 : Math.min(1, (y - s.from) / (top - s.from)) ** s.bend);
const swayShift = (rowUp: number, heightPx: number, k: number, s: { amp: number; hz: number; bend: number; from: number }, t: number, phase: number): number =>
  Math.round(s.amp * (heightPx / k) * k * signal(t, s.hz, phase) * weight(rowUp / k, heightPx / k, s)) || 0;

test("packed sway: round-trips on its grid, and the shader's reference shifts rows as object/sway.ts does", () => {
  const specs = [{ amp: 0.03, hz: 0.4, bend: 1.6, from: 1.2 }, { amp: 0.12, hz: 1.1, bend: 1, from: 0.02 }, { amp: 0.06, hz: 0.6, bend: 2, from: 0.3 }];
  for (const s of specs) for (const [heightPx, k] of [[48, 8], [96, 16], [12, 8]] as const) {
    const p = packSway(s, heightPx, k);
    assert.ok(Number.isInteger(p) && p < 2 ** 24);
    const u = unpackSway(p);
    assert.ok(Math.abs(u.ampPx - s.amp * heightPx) <= 0.125 + 1e-9);
    assert.ok(Math.abs(u.hz - s.hz) <= 1 / 64 + 1e-9);
    let off = 0, n = 0;
    for (let t = 0; t < 1.5; t += 0.17) for (let row = 0; row <= heightPx; row += 1) {
      const a = swayShiftPacked(row, heightPx, p, t, 0.3), b = swayShift(row, heightPx, k, s, t, 0.3);
      if (Math.abs(a - b) > 1) assert.fail(`row ${row}: ${a} vs ${b}`);
      if (a !== b) off += 1;
      n += 1;
    }
    // (Only the packing's rounding moves a row -- amplitude to a quarter pixel, the bend's start to a 31st -- and
    // then by one pixel: a few rows in a hundred.)
    assert.ok(off / n < 0.16, `${off}/${n} rows off by one`);
  }
  // Shifts are whole pixels, nothing below the bend's start moves, and the top moves most.
  const p = packSway({ amp: 0.1, hz: 0.5, bend: 1.5, from: 0.5 }, 40, 8);
  for (let row = 0; row < 8; row += 1) assert.equal(swayShiftPacked(row, 40, p, 0.4, 0.1), 0);
  assert.ok(Math.abs(swayShiftPacked(40, 40, p, 0.4, 0.1)) >= Math.abs(swayShiftPacked(20, 40, p, 0.4, 0.1)));
});

test("sway instances carry the layer fields and two more; the shaders derive from the layer shader", () => {
  const I = new SwayInstances(4);
  assert.ok(I.push(1, 2, 3, 4, 5, 6, 7, 8, 9, 0, -1, 0, 1, 1234, -2));
  assert.equal(SWAY_INSTANCE_FLOATS, 16);
  assert.deepEqual([...I.data.slice(0, 16)], [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, -1, 0, 1, 0, 1234, -2]);
  const fs = swayFragment("in vec3 vUv;\nvoid main() {\n  vec4 c = texelFetch(uPages, ivec3(ivec2(vUv.xy), int(vUv.z + 0.5)), 0);\n}");
  assert.ok(fs.includes("vSway.x * wgt") && fs.includes("flat in vec4 vRect;"));
  assert.throws(() => swayFragment("void main() {}"), /changed under/);
  assert.ok(SWAY_VS.includes("uBend[8]") && SWAY_VS.includes("gust"));
});
