import { test } from "node:test";
import assert from "node:assert/strict";
import { dcos, dsin } from "@keel-engine/core";
import { meshMatrix } from "../src/mesh.ts";

// meshMatrix builds its rotation in scratch (no arrays per call): it must still be the very same bits as building it
// from fresh arrays, the way it always was -- the reference below.
function reference({ x = 0, y = 0, z = 0, yaw = 0, pitch = 0, roll = 0, scale = 1 } = {}): Float32Array {
  const cy = dcos(yaw), sy = dsin(yaw), cp = dcos(pitch), sp = dsin(pitch), cr = dcos(roll), sr = dsin(roll);
  const ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
  const rx = [1, 0, 0, 0, cp, sp, 0, -sp, cp];
  const rz = [cr, sr, 0, -sr, cr, 0, 0, 0, 1];
  const mul3 = (a: number[], b: number[]) => {
    const o = new Array<number>(9).fill(0);
    for (let c = 0; c < 3; c += 1) for (let r = 0; r < 3; r += 1) for (let k = 0; k < 3; k += 1) o[c * 3 + r]! += a[k * 3 + r]! * b[c * 3 + k]!;
    return o;
  };
  const R = mul3(mul3(ry, rx), rz);
  return Float32Array.from([R[0]! * scale, R[1]! * scale, R[2]! * scale, 0, R[3]! * scale, R[4]! * scale, R[5]! * scale, 0, R[6]! * scale, R[7]! * scale, R[8]! * scale, 0, x, y, z, 1]);
}

test("meshMatrix: bit for bit what building it from fresh arrays gives", () => {
  let seed = 99;
  const rnd = (a: number, b: number): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return a + (seed / 4294967296) * (b - a); };
  const cases: NonNullable<Parameters<typeof meshMatrix>[0]>[] = [{}, { yaw: Math.PI }, { pitch: -Math.PI / 2 }, { roll: 0, yaw: -0 }, { scale: 0 }, { scale: -2, yaw: 1e-9 }];
  for (let i = 0; i < 3000; i += 1) cases.push({ x: rnd(-5e3, 5e3), y: rnd(-50, 50), z: rnd(-5e3, 5e3), yaw: rnd(-20, 20), pitch: rnd(-4, 4), roll: rnd(-4, 4), scale: rnd(0.1, 3) });
  // (And the usual shapes of a call: angles left out, zero, minus zero -- the ones it takes without trig.)
  for (let i = 0; i < 600; i += 1) {
    const pick = (): number => [0, -0, rnd(-4, 4)][i % 3]!;
    cases.push({ yaw: pick(), pitch: [0, -0, rnd(-1, 1)][(i >> 2) % 3]!, roll: [0, -0, rnd(-1, 1)][(i >> 4) % 3]!, x: rnd(-9, 9) });
    cases.push({ yaw: rnd(-7, 7) });
  }
  for (const c of cases) assert.deepEqual(new Uint8Array(meshMatrix(c).buffer), new Uint8Array(reference(c).buffer), JSON.stringify(c));
});
