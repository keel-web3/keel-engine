// Looks: deterministic from a seed, each role on its own stream (a pin moves
// nothing else), quantised to a stable signature, ramps that climb from dark
// to light in their finish, and a pool that keeps a population apart.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FINISHES, LOOK_ROLES, PATTERNS, PROFILES, createLookPool, lookDistance, lookOf, rampColours, rampKey, roleLab } from "../src/index.ts";
import type { LookRoles } from "../src/index.ts";

const roles: LookRoles = { cloth: { stuff: "cloth" }, clothAlt: { stuff: "cloth" }, fur: { stuff: "skin" }, hair: { stuff: "hair" }, accent: { stuff: "paint" }, dark: {} };
const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

test("a look is its seed's: the same seed, the same look; neighbouring seeds apart; every field in range and quantised", () => {
  const a = lookOf("0x01", roles);
  assert.deepEqual(lookOf("0x01", roles), a);
  assert.notEqual(lookOf("0x02", roles).signature, a.signature);
  assert.deepEqual(a.order, Object.keys(roles));
  assert.ok((PROFILES as readonly string[]).includes(a.profile));
  for (let i = 0; i < 300; i += 1) {
    const l = lookOf(`s${i}`, roles);
    for (const r of l.order) {
      const x = l.roles[r]!;
      assert.ok(x.hue % 5 === 0 && x.hue >= 0 && x.hue < 360, `hue ${x.hue}`);
      assert.ok(Math.abs(x.chroma * 100 - Math.round(x.chroma * 100)) < 1e-9 && x.chroma >= 0 && x.chroma <= 0.32);
      assert.ok(x.light >= 0.08 && x.light <= 0.96 && x.span >= 0.2 && x.span <= 0.8);
      assert.ok((FINISHES as readonly string[]).includes(x.finish) && (PATTERNS as readonly string[]).includes(x.pattern.kind));
      if (x.pattern.kind === "none") assert.equal(x.pattern.ink, null);
      if (x.pattern.ink) assert.ok(l.order.includes(x.pattern.ink) && x.pattern.shift === 0);
    }
    // Stuffs keep to themselves: skin is a skin tone (warm, soft), dark is dark.
    const skin = l.roles.fur!;
    if (skin.chroma <= 0.09 && skin.hue >= 30 && skin.hue <= 80) assert.ok(skin.light >= 0.28);
    assert.ok(l.roles.dark!.light <= 0.3);
    assert.equal(l.roles.fur!.pattern.kind, "none", "skin wears no pattern");
  }
  assert.throws(() => lookOf("x", { cape: {} }), /look role/);
});

test("pins: one role's field, a role's pattern, the profile -- and nothing else moves", () => {
  const base = lookOf("pin", roles, { profile: "analogous" });
  const hue = lookOf("pin", roles, { profile: "analogous", pins: { "cloth.hue": 200 } });
  assert.equal(hue.roles.cloth!.hue, 200);
  for (const r of ["clothAlt", "fur", "hair", "accent", "dark"] as const) assert.deepEqual(hue.roles[r], base.roles[r], `${r} stayed put`);
  assert.deepEqual({ ...hue.roles.cloth, hue: 0 }, { ...base.roles.cloth, hue: 0 }, "and the rest of cloth too");
  const striped = lookOf("pin", roles, { profile: "analogous", pins: { "clothAlt.pattern": "stripes", "accent.finish": "metal" } });
  assert.equal(striped.roles.clothAlt!.pattern.kind, "stripes");
  assert.equal(striped.roles.accent!.finish, "metal");
  assert.deepEqual(striped.roles.cloth, base.roles.cloth);
  assert.equal(lookOf("pin", roles, { pins: { profile: "neon" } }).profile, "neon");
  assert.equal(lookOf("pin", roles, { team: 120 }).profile, "team");
  assert.equal(lookOf("pin", roles, { team: 120 }).roles.cloth!.hue, 120, "a team's colour leads");
  assert.throws(() => lookOf("pin", roles, { pins: { "cloth.pattern": "paisley" } }), /pattern/);
  assert.throws(() => lookOf("pin", roles, { pins: { profile: "grunge" } }), /profile/);
});

test("ramps: dark to light, in gamut, the finish showing (a metal glints near white, a glow never goes dark)", () => {
  for (let i = 0; i < 200; i += 1) {
    const l = lookOf(`r${i}`, { primary: { stuff: "cloth" }, metal: { stuff: "metal" }, glow: { stuff: "glow" } });
    for (const r of l.order) {
      const ramp = rampColours(l.roles[r]!, 6);
      assert.equal(ramp.length, 6);
      for (let k = 1; k < 6; k += 1) assert.ok(lum(ramp[k]!) >= lum(ramp[k - 1]!) - 1, `${r}: climbs`);
      for (const c of ramp) for (const v of c) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255);
    }
    assert.ok(lum(rampColours(l.roles.metal!, 6)[5]!) > 190, "a metal's top glints");
    assert.ok(Math.max(...rampColours(l.roles.glow!, 6)[0]!) > 110, "a glow's foot is lit");
  }
  const x = lookOf("k", roles).roles.cloth!;
  assert.equal(rampKey(x, 5), rampKey({ ...x }, 5));
  assert.notEqual(rampKey(x, 5), rampKey({ ...x, hue: (x.hue + 5) % 360 }, 5));
});

test("distance: zero to itself, symmetric on shared roles, a different pattern counts, OKLab in gamut", () => {
  const a = lookOf("d1", roles), b = lookOf("d2", roles);
  assert.equal(lookDistance(a, a), 0);
  assert.ok(Math.abs(lookDistance(a, b) - lookDistance(b, a)) < 1e-12);
  const plain = lookOf("d1", roles, { pins: { "cloth.pattern": "none" } });
  const checked = lookOf("d1", roles, { pins: { "cloth.pattern": "checks" } });
  assert.ok(lookDistance(plain, checked) >= 0.06 - 1e-12);
  const [L, A, B] = roleLab(a.roles.cloth!);
  assert.ok(L >= 0 && L <= 1 && Math.hypot(A, B) <= 0.33);
});

test("the pool: every look it hands out is at least the threshold from every other in its group; groups are apart", () => {
  const pool = createLookPool({ threshold: 0.08 });
  const got = Array.from({ length: 400 }, (_, i) => pool.draw(`p${i}`, roles, {}, "people"));
  for (let i = 0; i < got.length; i += 1) for (let j = i + 1; j < got.length; j += 1) assert.ok(lookDistance(got[i]!, got[j]!) >= 0.08, `${i} and ${j}`);
  assert.equal(new Set(got.map((l) => l.signature)).size, got.length);
  assert.equal(pool.failures, 0);
  assert.ok(pool.rerolls > 0 && pool.rerolls < 200, `${pool.rerolls} re-rolls`);
  // Another group doesn't see these: the same seed's own look is taken at once.
  assert.deepEqual(pool.draw("p0", roles, {}, "hats"), lookOf("p0", roles));
  assert.equal(pool.size, 401);
  // Deterministic: the same draws, the same looks.
  const again = createLookPool({ threshold: 0.08 });
  assert.deepEqual(Array.from({ length: 400 }, (_, i) => again.draw(`p${i}`, roles, {}, "people").signature), got.map((l) => l.signature));
  assert.equal(LOOK_ROLES.length, 16);
});
