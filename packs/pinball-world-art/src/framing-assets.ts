import { defineStyledObject, solid, type DesignSolid, type StyledObjectDef, type WorldRoles, type SwaySpec } from "@keel-engine/object";
import type { Stream, Vec3 } from "@keel-engine/core";

const roles = {
  body: { as: "primary", stuff: "paint" }, steel: { as: "metal", stuff: "metal" },
  trim: { as: "trim", stuff: "metal" }, core: { as: "glow", stuff: "glow" },
  gold: { as: "accent", stuff: "metal" }, stone: { as: "detail", stuff: "bone" },
  bark: { as: "hair", stuff: "wood" }, leaf: { as: "clothAlt", stuff: "cloth" },
} as const satisfies WorldRoles;
const E = { collide: false } as const;
function framing(id: string, tags: string[], design: (J: Stream, h: number) => readonly DesignSolid[], sway?: SwaySpec): StyledObjectDef {
  return defineStyledObject({ id, tags: ["pinball-frame", ...tags], tier: "background", instancing: "many", variants: 4,
    choices: { height: { range: [2.6, 3.4] } }, look: { roles }, ...(sway ? { sway } : {}),
    design(J, v) { return { solids: design(J, Number(v.height)), front: null, colliders: [] }; },
  });
}
function hoop(role: string, center: Vec3, radius: number, tube: number): DesignSolid[] {
  return Array.from({ length: 12 }, (_, i) => { const a = i / 12 * Math.PI * 2, b = (i + 1) / 12 * Math.PI * 2;
    return solid.capsule(role, [center[0] + Math.cos(a) * radius, center[1], center[2] + Math.sin(a) * radius], [center[0] + Math.cos(b) * radius, center[1], center[2] + Math.sin(b) * radius], tube, E);
  });
}

const circuit = framing("circuit-rib", ["cyber", "cable", "mechanical"], (J, h) => {
  const out: DesignSolid[] = [solid.box("steel", [0, .16, 0], [2.7, .16, .75], 0, E)];
  const n = J.int(3, 5);
  for (let i = 0; i < n; i++) { const x = (i - (n - 1) / 2) * .85, rise = h * (.55 + i / n * .35);
    out.push(solid.box("body", [x, rise * .5 + .3, .2], [.27, rise * .5, .52], .08 * (i - n / 2), E), solid.box("core", [x - .29, rise * .5 + .3, -.12], [.025, rise * .31, .21], 0, E));
    out.push(solid.capsule("trim", [x, .4, -.48], [x + .38, rise + .15, -.48], .075, E));
  }
  for (const z of [-.8, .8]) out.push(solid.capsule("steel", [-2.8, .33, z], [2.8, .33, z], .11, E));
  return out;
});

const vault = framing("vault-buttress", ["gold", "cryptographic", "faceted"], (_, h) => {
  const out: DesignSolid[] = [solid.box("stone", [0, .3, 0], [2.5, .3, 1.5], 0, E)];
  for (const x of [-1.5, 1.5]) {
    out.push(solid.cone("gold", [x, .6, 0], .9, h * .65, .55, { ...E, sides: 8, steps: 3 }));
    out.push(...hoop("trim", [x, h * .7, 0], .76, .07));
  }
  out.push(solid.box("body", [0, h * .43, 0], [.83, h * .28, .58], 0, E));
  // Original nested-square cipher relief: a cabinet ornament, never a target.
  for (let i = 0; i < 3; i++) { const r = .63 - i * .14;
    for (const s of [-1, 1]) out.push(solid.box("gold", [s * r, h * .43, -.62 - i * .012], [.034, r, .025], 0, E), solid.box("gold", [0, h * .43 + s * r, -.62 - i * .012], [r, .034, .025], 0, E));
  }
  return out;
});

const vapor = framing("prism-fan", ["vapor", "prismatic", "shell"], (J, h) => {
  const out: DesignSolid[] = [solid.box("stone", [0, .22, 0], [2.8, .22, 1.15], 0, E)];
  for (let i = 0; i < 7; i++) { const t = (i - 3) / 3, rise = h * (1 - Math.abs(t) * .28);
    out.push(solid.box(i % 2 ? "body" : "trim", [t * 2.2, rise * .5 + .4, Math.abs(t) * .35], [.22, rise * .5, .26], t * .13, E));
    out.push(solid.capsule("core", [t * 2.2, .5, -.33], [t * 2.2, rise + .22, -.33], .035, E));
  }
  for (let i = 0; i < 3; i++) out.push(solid.capsule("trim", [-2.5, .55 + i * .15, -.6 - i * .13], [2.5, .55 + i * .15, -.6 - i * .13], .045, E));
  out.push(solid.ball("stone", [J.between(-.5, .5), .5, 1.05], [1.2, .3, .45], E));
  return out;
});

const grove = framing("rooted-bank", ["nature", "landform", "canopy"], (J, h) => {
  const out: DesignSolid[] = [solid.ball("stone", [0, .22, 0], [2.7, .42, 1.3], E)];
  for (let i = 0; i < 3; i++) { const x = (i - 1) * 1.35, hh = h * J.between(.75, 1.15);
    out.push(solid.capsule("bark", [x, .3, 0], [x + .18, hh * .73, .1], .14, E));
    for (const s of [-1, 1]) out.push(solid.capsule("bark", [x, hh * .46, 0], [x + s * .75, hh * .87, s * .2], .085, E));
    for (let j = 0; j < 4; j++) { const a = j * Math.PI / 2; out.push(solid.ball("leaf", [x + Math.cos(a) * .67, hh + J.between(-.25, .2), Math.sin(a) * .6], [.95, .57, .8], { ...E, group: "canopy" })); }
    out.push(solid.capsule("bark", [x, .5, 0], [x + J.between(-.8, .8), .13, -1.3], .12, E));
  }
  return out;
}, { amp: .035, hz: .35, bend: 1.8, from: .7, groups: ["canopy"] });

const exchanger = framing("heat-exchanger", ["nightshift", "pipes", "mechanical"], (_, h) => {
  const out: DesignSolid[] = [solid.box("steel", [0, .2, 0], [2.8, .2, 1.0], 0, E), solid.box("body", [0, h * .32, .12], [2.1, h * .25, .62], 0, E)];
  for (let i = 0; i < 6; i++) { const x = (i - 2.5) * .66;
    out.push(solid.capsule("trim", [x, .42, -.8], [x, h * .74, -.8], .09, E));
    out.push(solid.capsule("steel", [x, h * .74, -.8], [x, h * .74, .72], .11, E));
    out.push(solid.box("core", [x, .56, -.91], [.15, .06, .035], 0, E));
  }
  out.push(...hoop("steel", [-2.2, h * .57, 0], .67, .10), ...hoop("trim", [2.2, h * .57, 0], .67, .10));
  return out;
});

const cipher = framing("cipher-chain", ["crypto", "lattice", "chain"], (J, h) => {
  const out: DesignSolid[] = [solid.box("steel", [0, .16, 0], [2.85, .16, 1.25], 0, E)];
  // Unequal linked diamond cages make a chain silhouette distinct from the
  // vault's heavy buttresses and the cyber cabinet's parallel circuit ribs.
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 1.65, r = .64 + i * .09, cy = h * (.38 + i * .12), z = i % 2 ? .28 : -.15;
    const vertices: Vec3[] = [[x - r, cy, z], [x, cy + r, z], [x + r, cy, z], [x, cy - r, z]];
    for (let edge = 0; edge < 4; edge++) out.push(solid.capsule("gold", vertices[edge]!, vertices[(edge + 1) % 4]!, .11, E));
    out.push(solid.capsule("steel", [x, .3, z], [x, cy - r, z], .09, E), solid.ball("core", [x, cy, z], [.18, .26, .18], E));
    if (i < 2) out.push(solid.capsule("trim", [x + r * .5, cy, z], [x + 1.65 - (r + .09) * .5, cy + h * .12, .28 - z], .075, E));
  }
  for (let i = 0; i < 5; i++) out.push(solid.box("body", [(i - 2) * .95, .41, .85], [.31, J.between(.15, .30), .22], .2 * (i % 2 ? 1 : -1), E));
  return out;
});

const lamp = framing("neon-swing-lamp", ["arcade", "neon", "pendant", "lamp"], (J, h) => {
  const reach = J.between(.55, 1.15), drop = J.between(.35, .70), out: DesignSolid[] = [
    solid.box("steel", [0, .13, 0], [.60, .13, .50], 0, E),
    solid.capsule("steel", [0, .25, 0], [0, h, 0], .105, E),
    solid.capsule("trim", [0, h, 0], [reach, h, .12], .075, E),
    solid.capsule("trim", [reach, h, .12], [reach, h - drop, .12], .035, { ...E, group: "pendant" }),
    solid.box("body", [reach, h - drop, .12], [.40, .16, .29], J.between(-.18, .18), { ...E, group: "pendant" }),
    solid.box("core", [reach, h - drop - .16, .12], [.32, .025, .23], 0, { ...E, group: "pendant" }),
  ];
  for (let i = 0; i < 3; i++) out.push(solid.capsule("core", [-.13, .55 + i * .23, -.12], [-.13, .68 + i * .23, -.12], .025, E));
  return out;
}, { amp: .045, hz: .55, bend: 1.2, from: .35, groups: ["pendant"] });

export const PINBALL_FRAMING_ASSETS = Object.freeze({ "circuit-rib": circuit, "vault-buttress": vault, "prism-fan": vapor, "rooted-bank": grove, "cipher-chain": cipher, "heat-exchanger": exchanger, "neon-swing-lamp": lamp });
