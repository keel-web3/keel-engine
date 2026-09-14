// A hero's gear for the crawl: a sword for the right hand and a shield for
// the left -- wearables (runtime attributes, keel/entity's fitting
// convention: capsules and boxes in the socket's frame), so a population
// pins them on a character and they swing with its hands. Built to the hand
// sockets of packs/humans' two-legged characters (the grip runs along the
// socket's x; +z is ahead).
import type { AttributeBox, AttributeCapsule, AttributeShape } from "@keel-engine/entity";
import { definePack, defineAttribute } from "@keel-engine/runtime";
import type { Pins, Stream } from "@keel-engine/runtime";

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
    const gc = at(g * 1.3), yaw = Math.atan2(d[0], d[2]);
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
    const n = [Math.cos(yaw) * -1, 0, Math.sin(-yaw)] as const;
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

/** The gear as a runtime pack (attributes only). */
export const gear = definePack({ entities: [], attributes: [sword, shield] });
