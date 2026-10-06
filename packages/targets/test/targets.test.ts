import { test } from "node:test";
import assert from "node:assert/strict";
import { AGE_SCHEMA, DEVICE_SCHEMA, resolveTarget } from "../src/index.ts";
import type { Age, Device } from "../src/index.ts";
const age: Age = {
  schema: AGE_SCHEMA, id: "colour-handheld", name: "Colour handheld",
  quality: { detail: 0, meshDetail: "low", views: 16, phases: 8, variants: 4, particles: 16 },
  renderers: ["frames", "program"], surfaces: 1, stereo: false, input: [],
};
const phone: Device = {
  schema: DEVICE_SCHEMA, id: "phone",
  quality: { detail: 2, meshDetail: "high", views: 32, phases: 32, variants: 8, particles: 1024 },
  renderers: ["program"], surfaces: 2, stereo: false, input: ["touch", "pad"],
  budget: { objectBytes: 4096, bundleBytes: 1048576, triangles: 10000 },
};
test("a powerful device preserves an older authored age", () => {
  const r = resolveTarget(age, phone);
  assert.deepEqual(r.quality, age.quality);
  assert.equal(r.renderer, "program");
  assert.deepEqual(r.reduced, []);
});
test("a weaker device caps quality without changing authored source", () => {
  const advanced: Age = { ...age, id: "modern", quality: phone.quality };
  const cartridge: Device = { ...phone, id: "cartridge", quality: age.quality, renderers: ["frames"] };
  const r = resolveTarget(advanced, cartridge);
  assert.deepEqual(r.quality, cartridge.quality);
  assert.deepEqual(r.reduced, ["detail", "meshDetail", "views", "phases", "variants", "particles"]);
  assert.deepEqual(advanced.quality, phone.quality);
});
test("logical views, touch and real stereo are required capabilities", () => {
  const ds: Age = { ...age, id: "dual", surfaces: 2, input: ["touch"] };
  assert.equal(resolveTarget(ds, phone).surfaces, 2);
  assert.throws(() => resolveTarget(ds, { ...phone, surfaces: 1 }), /logical view surfaces/);
  assert.throws(() => resolveTarget(ds, { ...phone, input: ["pad"] }), /requires input touch/);
  assert.throws(() => resolveTarget({ ...ds, stereo: true }, phone), /stereoscopic output/);
});
test("unsupported renderers and invalid limits cannot become build plans", () => {
  assert.throws(() => resolveTarget({ ...age, renderers: ["frames"] }, phone), /no renderer/);
  assert.throws(() => resolveTarget(age, { ...phone, budget: { ...phone.budget, objectBytes: 0 } }), /budget/);
  assert.throws(() => resolveTarget({ ...age, quality: { ...age.quality, particles: NaN } }, phone), /particles/);
});
