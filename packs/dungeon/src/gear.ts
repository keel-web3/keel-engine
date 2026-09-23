// A hero's gear: a sword, a staff or a mace (axe, dagger, sickle) for the
// right hand; a shield, a bow or a focus (tome, orb, skull, holy symbol) for
// the left -- wearables (runtime attributes, keel/entity's fitting
// convention: capsules and boxes in the socket's frame), so a population
// pins them on a character and they swing with its hands. Built to the hand
// sockets of packs/humans' two-legged characters (the grip runs along the
// socket's x; +z is ahead).
import type { AttributeBox, AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { definePack, defineAttribute } from "@keel-engine/runtime";
import type { Pins, Stream } from "@keel-engine/runtime";
import { datan2, dcos, dsin } from "@keel-engine/core";

// (Two-legged bodies; no pack named, so any character with hands may carry them.)
const HANDED = { body: "body/humanoid@^1" } as const;

function choose<T extends string | number | boolean>(S: Stream, pins: Pins, name: string, options: readonly T[]): T {
  const drawn = S.pick(options);
  const pin = pins[name];
  if (pin === undefined) return drawn;
  if (!options.includes(pin as T)) throw new RangeError(`${name} = ${JSON.stringify(pin)} is not one of ${JSON.stringify(options)}.`);
  return pin as T;
}

/** A sword: a long, broad or short blade, a crossguard or a curled one, a pommel. Held ready: point ahead and low. */
export const sword = defineAttribute<AttributeShape>({
  id: "sword",
  slot: "hand.R",
  title: "Sword",
  tags: ["weapon", "sword", "hero"],
  targets: [HANDED],
  choices: { blade: ["long", "broad", "short"], guard: ["cross", "curled"] },
  // (Roles as a baked-in wear reads them: the blade "secondary" (steel), guard and pommel "trim", the grip "detail".)
  look: { roles: { secondary: { stuff: "metal", finishes: ["metal"] }, trim: { stuff: "metal", finishes: ["metal"] }, detail: { stuff: "leather" } } },
  build(S, fit, pins) {
    const blade = choose(S, pins, "blade", ["long", "broad", "short"] as const);
    const guard = choose(S, pins, "guard", ["cross", "curled"] as const);
    const g = Math.max(0.03, fit.size[0] / 2);
    const L = blade === "long" ? 0.78 : blade === "broad" ? 0.7 : 0.55;
    const w = blade === "broad" ? 0.042 : 0.034;
    // (The grip across the fist; the blade runs on ahead of the hand and a little down and out: held ready.)
    const d = [0.12, -0.62, 0.78] as const;
    const at = (s: number): [number, number, number] => [d[0] * s, d[1] * s, d[2] * s];
    const capsules: AttributeCapsule[] = [
      { a: at(-g * 2.4), b: at(g * 1.1), r: g * 0.5, role: "detail", part: "sword.grip" },
      { a: at(-g * 2.8), b: at(-g * 2.8), r: g * 0.75, role: "trim", part: "sword.pommel" },
      // The blade: wide from the guard, narrowing to the point.
      { a: at(g * 1.6), b: at(g * 1.6 + L * 0.72), r: w, role: "secondary", part: "sword.blade" },
      { a: at(g * 1.6 + L * 0.72), b: at(g * 1.6 + L), r: w * 0.55, role: "secondary", part: "sword.point" },
    ];
    const boxes: AttributeBox[] = [];
    const gc = at(g * 1.3), yaw = datan2(d[0], d[2]);
    if (guard === "cross") boxes.push({ c: gc, h: [0.15, 0.022, 0.028], yaw, role: "trim", part: "sword.guard" });
    else {
      capsules.push({ a: [gc[0] - 0.12, gc[1] + 0.05, gc[2]], b: gc, r: 0.022, role: "trim", part: "sword.guard" });
      capsules.push({ a: gc, b: [gc[0] + 0.12, gc[1] + 0.05, gc[2]], r: 0.022, role: "trim", part: "sword.guard" });
    }
    return { capsules, boxes };
  },
});

/** A shield: round, kite or heater, a boss or none, a rim. Worn on the left forearm, face out. */
export const shield = defineAttribute<AttributeShape>({
  id: "shield",
  slot: "hand.L",
  title: "Shield",
  tags: ["armour", "shield", "hero"],
  targets: [HANDED],
  choices: { form: ["round", "kite", "heater"], boss: [true, false] },
  look: { roles: { primary: { stuff: "paint", patterns: ["none", "bands", "trim"] }, trim: { stuff: "metal", finishes: ["metal"] }, secondary: { stuff: "metal", finishes: ["metal"] } } },
  build(S, _fit, pins) {
    const form = choose(S, pins, "form", ["round", "kite", "heater"] as const);
    const boss = choose(S, pins, "boss", [true, false]);
    // (Carried on the forearm, its face turned out and ahead: the plate's thin axis along `n`, a hand's breadth off.)
    const yaw = -0.8;
    const n = [dcos(yaw) * -1, 0, dsin(-yaw)] as const;
    const off = 0.08;
    const at = (y: number): [number, number, number] => [n[0] * off, y, n[2] * off];
    const boxes: AttributeBox[] = [];
    const capsules: AttributeCapsule[] = [];
    const R = form === "round" ? 0.3 : 0.26;
    if (form === "round") {
      for (let i = 0; i < 5; i += 1) {
        const y = -R + ((i + 0.5) / 5) * 2 * R, half = Math.sqrt(Math.max(0, R * R - y * y));
        boxes.push({ c: at(y + 0.08), h: [0.025, R / 5 + 0.004, half], yaw, role: "primary", part: "shield" });
      }
    } else {
      const rows = form === "kite" ? [1, 1, 0.9, 0.72, 0.5, 0.26] : [1, 1, 0.94, 0.8, 0.56, 0.28];
      const H = form === "kite" ? 0.78 : 0.62;
      rows.forEach((wd, i) => boxes.push({ c: at(0.3 - (i + 0.5) * (H / rows.length)), h: [0.025, H / rows.length / 2 + 0.004, R * wd], yaw, role: i === 0 ? "trim" : "primary", part: "shield" }));
    }
    if (boss) { const b = at(0.08); capsules.push({ a: [b[0] + n[0] * 0.035, b[1], b[2] + n[2] * 0.035], b: [b[0] + n[0] * 0.035, b[1], b[2] + n[2] * 0.035], r: 0.06, role: "secondary", part: "shield.boss" }); }
    return { capsules, boxes };
  },
});

/** A bow: short or long, recurved or plain, strung -- held upright in the left hand, its string toward the body. */
export const bow = defineAttribute<AttributeShape>({
  id: "bow",
  slot: "hand.L",
  title: "Bow",
  tags: ["weapon", "bow", "ranged", "hero"],
  targets: [HANDED],
  choices: { length: ["short", "long"], curve: ["plain", "recurve"] },
  look: { roles: { detail: { stuff: "wood" }, trim: { stuff: "leather" }, secondary: { stuff: "paint" } } },
  build(S, fit, pins) {
    const length = choose(S, pins, "length", ["short", "long"] as const);
    const curve = choose(S, pins, "curve", ["plain", "recurve"] as const);
    const g = Math.max(0.03, fit.size[0] / 2);
    const H = (length === "long" ? 0.72 : 0.5);
    // (The limbs bow away ahead of the grip (+z); a recurve flicks back at the tips; the string runs tip to tip behind.)
    const bend = H * 0.28;
    const capsules: AttributeCapsule[] = [{ a: [0, -g * 1.4, 0], b: [0, g * 1.4, 0], r: g * 0.75, role: "trim", part: "bow.grip" }];
    for (const s of [-1, 1]) {
      const mid: [number, number, number] = [0, s * H * 0.5, bend];
      const tip: [number, number, number] = [0, s * H, curve === "recurve" ? bend * 0.35 : bend * 0.15];
      capsules.push({ a: [0, s * g, g * 0.3], b: mid, r: g * 0.42, role: "detail", part: "bow.limb" });
      capsules.push({ a: mid, b: tip, r: g * 0.32, role: "detail", part: "bow.limb" });
      if (curve === "recurve") capsules.push({ a: tip, b: [0, tip[1] + s * H * 0.08, tip[2] + bend * 0.25], r: g * 0.25, role: "detail", part: "bow.tip" });
    }
    const tipZ = curve === "recurve" ? bend * 0.35 : bend * 0.15;
    capsules.push({ a: [0, -H, tipZ], b: [0, H, tipZ], r: g * 0.08, role: "secondary", part: "bow.string" });
    return { capsules };
  },
});

/** A staff: a long pole, its head a glowing orb in claws, a crystal, a crook, or a gnarled knot of wood. Held upright. */
export const staff = defineAttribute<AttributeShape>({
  id: "staff",
  slot: "hand.R",
  title: "Staff",
  tags: ["weapon", "staff", "magic", "hero"],
  targets: [HANDED],
  choices: { head: ["orb", "crystal", "crook", "gnarled"], length: ["long", "tall"], hold: ["upright", "diagonal"] },
  look: { roles: { detail: { stuff: "wood" }, trim: { stuff: "metal", finishes: ["metal"] }, glow: { stuff: "glow" } } },
  build(S, fit, pins) {
    const head = choose(S, pins, "head", ["orb", "crystal", "crook", "gnarled"] as const);
    const length = choose(S, pins, "length", ["long", "tall"] as const);
    // (Held upright, or slanted across the body the way a cartoon wizard carries it.)
    const hold = choose(S, pins, "hold", ["upright", "diagonal"] as const);
    const g = Math.max(0.03, fit.size[0] / 2);
    const top = length === "tall" ? 1.05 : 0.85, foot = -0.5;
    // (A little ahead of the hand and leaning out: the pole along +y through the grip.)
    const lean = hold === "diagonal" ? ([0.4, 1, 0.2] as const) : ([0.06, 1, 0.12] as const);
    const at = (s: number): [number, number, number] => [lean[0] * s, lean[1] * s, lean[2] * s];
    const capsules: AttributeCapsule[] = [{ a: at(foot), b: at(top), r: g * 0.45, role: "detail", part: "staff.pole" }];
    const h = at(top);
    if (head === "orb") {
      capsules.push({ a: [h[0], h[1] + 0.09, h[2]], b: [h[0], h[1] + 0.09, h[2]], r: g * 2, role: "glow", part: "staff.orb" });
      for (const s of [-1, 1]) capsules.push({ a: h, b: [h[0] + s * g * 1.6, h[1] + 0.14, h[2]], r: g * 0.25, role: "trim", part: "staff.claw" });
    } else if (head === "crystal") {
      capsules.push({ a: [h[0], h[1] + 0.02, h[2]], b: [h[0], h[1] + 0.22, h[2]], r: g * 1.2, role: "glow", part: "staff.crystal" });
      capsules.push({ a: [h[0], h[1] - 0.02, h[2]], b: [h[0], h[1] + 0.02, h[2]], r: g * 0.8, role: "trim", part: "staff.setting" });
    } else if (head === "crook") {
      capsules.push({ a: h, b: [h[0], h[1] + 0.14, h[2] + 0.1], r: g * 0.45, role: "detail", part: "staff.crook" });
      capsules.push({ a: [h[0], h[1] + 0.14, h[2] + 0.1], b: [h[0], h[1] + 0.04, h[2] + 0.2], r: g * 0.42, role: "detail", part: "staff.crook" });
    } else {
      capsules.push({ a: [h[0], h[1] + 0.06, h[2]], b: [h[0], h[1] + 0.06, h[2]], r: g * 1.1, role: "detail", part: "staff.knot" });
      capsules.push({ a: [h[0], h[1] + 0.06, h[2]], b: [h[0] - g * 1.4, h[1] + 0.2, h[2] - g * 0.6], r: g * 0.3, role: "detail", part: "staff.twig" });
      capsules.push({ a: [h[0], h[1] + 0.06, h[2]], b: [h[0] + g * 1.2, h[1] + 0.18, h[2] + g * 0.8], r: g * 0.28, role: "glow", part: "staff.leaf" });
    }
    return { capsules };
  },
});

/** A one-handed weapon: a flanged mace, a bearded axe, a dagger or a sickle. Held ready, like the sword. */
export const club = defineAttribute<AttributeShape>({
  id: "club",
  slot: "hand.R",
  title: "Mace, axe, dagger or sickle",
  tags: ["weapon", "melee", "hero"],
  targets: [HANDED],
  choices: { form: ["mace", "axe", "dagger", "sickle"] },
  look: { roles: { secondary: { stuff: "metal", finishes: ["metal"] }, trim: { stuff: "metal", finishes: ["metal"] }, detail: { stuff: "leather" } } },
  build(S, fit, pins) {
    const form = choose(S, pins, "form", ["mace", "axe", "dagger", "sickle"] as const);
    const g = Math.max(0.03, fit.size[0] / 2);
    const d = [0.12, -0.62, 0.78] as const;
    const at = (s: number): [number, number, number] => [d[0] * s, d[1] * s, d[2] * s];
    const L = form === "dagger" ? 0.3 : 0.5;
    const capsules: AttributeCapsule[] = [{ a: at(-g * 2), b: at(L * 0.72), r: g * 0.5, role: "detail", part: "club.haft" }];
    const e = at(L * 0.72);
    if (form === "mace") {
      capsules.push({ a: e, b: at(L), r: g * 1.3, role: "secondary", part: "club.head" });
      for (const s of [-1, 1]) capsules.push({ a: e, b: [e[0] + s * g * 1.9, e[1], e[2]], r: g * 0.35, role: "trim", part: "club.flange" });
    } else if (form === "axe") {
      capsules.push({ a: e, b: [e[0] + g * 3, e[1] + g * 0.8, e[2] - g * 0.5], r: g * 0.9, role: "secondary", part: "club.blade" });
      capsules.push({ a: [e[0] + g * 3, e[1] + g * 0.8, e[2] - g * 0.5], b: [e[0] + g * 3.2, e[1] - g * 1.6, e[2] - g * 0.2], r: g * 0.5, role: "secondary", part: "club.beard" });
    } else if (form === "dagger") {
      capsules.push({ a: at(g * 1.2), b: at(g * 1.2), r: g * 0.7, role: "trim", part: "club.guard" });
      capsules.push({ a: at(g * 1.6), b: at(L), r: g * 0.35, role: "secondary", part: "club.blade" });
    } else {
      capsules.push({ a: e, b: [e[0], e[1] + g * 2.5, e[2] + g * 1.6], r: g * 0.35, role: "secondary", part: "club.blade" });
      capsules.push({ a: [e[0], e[1] + g * 2.5, e[2] + g * 1.6], b: [e[0], e[1] + g * 1.6, e[2] + g * 3.2], r: g * 0.3, role: "secondary", part: "club.blade" });
    }
    return { capsules };
  },
});

/** Something held in the off hand for its magic: a tome, a floating orb, a skull, or a holy symbol. */
export const focus = defineAttribute<AttributeShape>({
  id: "focus",
  slot: "hand.L",
  title: "Focus (tome, orb, skull, symbol)",
  tags: ["magic", "focus", "hero"],
  targets: [HANDED],
  choices: { form: ["tome", "orb", "skull", "symbol"] },
  look: { roles: { primary: { stuff: "leather" }, trim: { stuff: "metal", finishes: ["metal"] }, secondary: { stuff: "bone" }, glow: { stuff: "glow" } } },
  build(S, fit, pins) {
    const form = choose(S, pins, "form", ["tome", "orb", "skull", "symbol"] as const);
    const g = Math.max(0.03, fit.size[0] / 2);
    const capsules: AttributeCapsule[] = [];
    const boxes: AttributeBox[] = [];
    if (form === "tome") {
      boxes.push({ c: [0, g * 0.2, g * 1.2], h: [g * 1.5, g * 0.5, g * 2], yaw: 0, role: "primary", part: "focus.tome" });
      boxes.push({ c: [0, g * 0.75, g * 1.2], h: [g * 1.35, g * 0.12, g * 1.85], yaw: 0, role: "secondary", part: "focus.pages" });
      capsules.push({ a: [0, g * 0.85, g * 1.2], b: [0, g * 0.85, g * 1.2], r: g * 0.45, role: "glow", part: "focus.rune" });
    } else if (form === "orb") {
      capsules.push({ a: [0, g * 3.2, g * 0.6], b: [0, g * 3.2, g * 0.6], r: g * 1.6, role: "glow", part: "focus.orb" });
    } else if (form === "skull") {
      capsules.push({ a: [0, g * 1.6, g * 0.4], b: [0, g * 1.6, g * 0.4], r: g * 1.3, role: "secondary", part: "focus.skull" });
      for (const s of [-1, 1]) capsules.push({ a: [s * g * 0.5, g * 1.8, g * 1.5], b: [s * g * 0.5, g * 1.8, g * 1.5], r: g * 0.32, role: "glow", part: "focus.eye" });
    } else {
      capsules.push({ a: [0, g * 0.5, g * 0.4], b: [0, g * 3.4, g * 0.4], r: g * 0.35, role: "trim", part: "focus.symbol" });
      capsules.push({ a: [-g * 1.1, g * 2.5, g * 0.4], b: [g * 1.1, g * 2.5, g * 0.4], r: g * 0.35, role: "trim", part: "focus.symbol" });
      capsules.push({ a: [0, g * 2.5, g * 0.6], b: [0, g * 2.5, g * 0.6], r: g * 0.45, role: "glow", part: "focus.gem" });
    }
    return { capsules, boxes };
  },
});

/** The gear as a runtime pack (attributes only). */
export const gear = definePack({ entities: [], attributes: [sword, shield, bow, staff, club, focus] });
