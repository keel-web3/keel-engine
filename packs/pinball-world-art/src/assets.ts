import { defineStyledObject, solid, type Design, type DesignSolid, type StyledObjectDef, type WorldRoles, type SwaySpec } from "@keel-engine/object";
import { oak, pine, birch, palm, bush, grass, reeds, rock, mushroom, crystal } from "@keel-engine/foliage";
import type { Stream, Vec3 } from "@keel-engine/core";
import { PINBALL_FRAMING_ASSETS } from "./framing-assets.ts";

/** Metres in each object's own frame, +Y up. The generator owns every placement. */
export const ART_ROLES = {
  body: { as: "primary", stuff: "paint", finishes: ["matte"], patterns: ["none", "bands"] },
  steel: { as: "metal", stuff: "metal", finishes: ["metal"], patterns: ["none"] },
  trim: { as: "trim", stuff: "metal", finishes: ["metal"], patterns: ["none"] },
  glass: { as: "secondary", stuff: "metal", finishes: ["metal"], patterns: ["none"] },
  core: { as: "glow", stuff: "glow", finishes: ["glow"], patterns: ["none"] },
  stone: { as: "detail", stuff: "bone", finishes: ["matte"], patterns: ["none", "spots"] },
  gold: { as: "accent", stuff: "metal", finishes: ["metal"], patterns: ["none"] },
  bark: { as: "hair", stuff: "wood", finishes: ["matte"], patterns: ["bands"] },
  leaf: { as: "clothAlt", stuff: "cloth", finishes: ["matte"], patterns: ["none"] },
} as const satisfies WorldRoles;

const E = { collide: false } as const;
function ring(role: string, center: Vec3, radius: number, tube: number, segments = 12, group?: string): DesignSolid[] {
  const out: DesignSolid[] = [];
  for (let i = 0; i < segments; i++) {
    const a = i / segments * Math.PI * 2, b = (i + 1) / segments * Math.PI * 2;
    out.push(solid.capsule(role, [center[0] + Math.cos(a) * radius, center[1], center[2] + Math.sin(a) * radius], [center[0] + Math.cos(b) * radius, center[1], center[2] + Math.sin(b) * radius], tube, { ...E, ...(group ? { group } : {}) }));
  }
  return out;
}
function asset(id: string, tags: string[], design: (random: Stream, height: number, variant: number) => readonly DesignSolid[], { height = [3.6, 4.4], motion = false, sway }: { height?: readonly [number, number]; motion?: boolean; sway?: SwaySpec } = {}): StyledObjectDef {
  return defineStyledObject({
    id, tags, tier: "background", instancing: "many", variants: 4,
    choices: { height: { range: height } }, look: { roles: ART_ROLES }, ...(sway ? { sway } : {}),
    design(J, v): Design {
      return { solids: design(J, Number(v.height), Number(v.variant)), colliders: [], front: null, meta: { mechanism: motion ? "rotor" : "static" } };
    },
  });
}

const furnace = asset("forge-furnace", ["industrial", "furnace", "landmark"], (J, h) => {
  const out: DesignSolid[] = [solid.box("steel", [0, h * 0.06, 0], [2.1, h * 0.06, 1.7], 0, E), solid.cylinder("body", [0, h * 0.12, 0], 1.52, h * 0.66, { ...E, sides: 8 }), solid.cone("steel", [0, h * 0.78, 0], 1.55, h * 0.18, 0.63, { ...E, sides: 8 })];
  out.push(...ring("trim", [0, h * 0.23, 0], 1.56, 0.10), ...ring("trim", [0, h * 0.70, 0], 1.55, 0.10));
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2, x = Math.cos(a) * 1.46, z = Math.sin(a) * 1.46;
    out.push(solid.box("core", [x, h * 0.44, z], [0.14, h * 0.14, 0.44], -a, E));
    out.push(solid.capsule("steel", [x * 1.45, 0.2, z * 1.45], [x * 1.45, h * 0.7, z * 1.45], 0.13, E));
  }
  out.push(solid.cylinder("steel", [0.35, h * 0.94, -0.35], 0.36, h * J.between(0.2, 0.35), E));
  return out;
}, { height: [5.8, 6.8] });

const turbine = asset("forge-turbine", ["industrial", "rotor", "mechanism"], (_, h) => {
  const out: DesignSolid[] = [solid.box("body", [0, 0.35, 0], [1.65, 0.35, 1.65], 0, E), solid.cylinder("steel", [0, 0.7, 0], 0.45, h * 0.46, E)];
  out.push(...ring("steel", [0, h * 0.54, 0], 1.7, 0.19));
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2;
    out.push(solid.box("trim", [Math.cos(a) * 0.91, h * 0.54, Math.sin(a) * 0.91], [0.90, 0.12, 0.24], -a + 0.25, { ...E, group: "rotor" }));
  }
  out.push(solid.ball("core", [0, h * 0.59, 0], 0.43, E));
  return out;
}, { motion: true });

const stack = asset("forge-stack", ["industrial", "tower"], (_, h) => {
  const out: DesignSolid[] = [solid.box("body", [0, h * 0.13, 0], [1.2, h * 0.13, 1.2], 0, E), solid.cylinder("steel", [0, h * 0.26, 0], 0.72, h * 0.74, { ...E, sides: 8 })];
  for (let i = 0; i < 6; i++) out.push(...ring(i % 2 ? "trim" : "body", [0, h * (0.3 + i * 0.11), 0], 0.77, 0.07, 8));
  out.push(solid.cylinder("core", [0, h * 0.96, 0], 0.51, 0.12, E));
  return out;
}, { height: [9, 12] });

const pylon = asset("neon-pylon", ["energy", "pylon"], (_, h) => {
  const out: DesignSolid[] = [solid.cone("steel", [0, 0, 0], 1.05, h * 0.70, 0.34, { ...E, sides: 4, steps: 4 }), solid.cylinder("glass", [0, h * 0.38, 0], 0.5, h * 0.25, E), solid.ball("core", [0, h * 0.83, 0], [0.40, 0.66, 0.40], E)];
  out.push(...ring("trim", [0, h * 0.76, 0], 0.82, 0.07), ...ring("core", [0, h * 0.90, 0], 0.69, 0.05));
  return out;
});

const arch = asset("ruin-arch", ["ruins", "architecture", "gateway"], (_, h) => {
  const out: DesignSolid[] = [];
  for (const s of [-1, 1]) {
    out.push(solid.box("stone", [s * 2.0, h * 0.4, 0], [0.46, h * 0.4, 0.7], 0, E), solid.box("gold", [s * 2.0, h * 0.07, 0], [0.64, h * 0.07, 0.84], 0, E), solid.box("trim", [s * 2.0, h * 0.74, 0], [0.65, 0.13, 0.81], 0, E));
  }
  for (let i = 0; i < 7; i++) {
    const a = i / 6 * Math.PI;
    out.push(solid.box("stone", [Math.cos(a) * 2.0, h * 0.73 + Math.sin(a) * 1.7, 0], [0.48, 0.45, 0.7], 0, E));
  }
  out.push(solid.ball("core", [0, h * 0.73 + 1.85, 0.77], 0.19, E));
  return out;
}, { height: [4.4, 5.2] });

const column = asset("ruin-column", ["ruins", "column"], (_, h, variant) => {
  const out: DesignSolid[] = [solid.box("stone", [0, 0.14, 0], [0.8, 0.14, 0.8], 0, E), solid.cylinder("stone", [0, 0.28, 0], 0.45, h * (variant === 0 ? 0.45 : 0.8), { ...E, sides: 8 })];
  if (variant !== 0) out.push(solid.box("gold", [0, h * 0.82 + 0.3, 0], [0.73, 0.13, 0.73], 0, E));
  else out.push(solid.box("stone", [0.85, 0.24, 0.64], [0.50, 0.24, 0.28], 0.5, E));
  return out;
});

const vault = asset("ruin-vault", ["ruins", "vault", "landmark"], (_, h) => {
  const out: DesignSolid[] = [solid.box("stone", [0, 0.5, 0], [3.0, 0.5, 2.8], 0, E), solid.box("body", [0, h * 0.44 + 0.5, 0], [2.5, h * 0.44, 2.0], 0, E), solid.cone("gold", [0, h * 0.88 + 0.5, 0], 3.5, h * 0.35, 0.3, { ...E, sides: 4, steps: 4 })];
  for (const x of [-1.9, -0.95, 0.95, 1.9]) out.push(solid.cylinder("gold", [x, 1, 2.02], 0.15, h * 0.75, { ...E, sides: 8 }));
  out.push(solid.box("steel", [0, h * 0.4, 2.08], [0.75, h * 0.29, 0.06], 0, E), solid.box("core", [0, h * 0.48, 2.18], [0.08, h * 0.11, 0.05], 0, E));
  return out;
}, { height: [6.8, 7.8] });

const trestle = asset("bridge-trestle", ["bridge", "support"], (_, h) => {
  const out: DesignSolid[] = [solid.box("steel", [0, h, 0], [3.1, 0.18, 1.45], 0, E)];
  for (const x of [-2.7, 2.7]) for (const z of [-1.15, 1.15]) out.push(solid.capsule("steel", [x, 0.2, z], [x, h, z], 0.15, E));
  for (const z of [-1.15, 1.15]) out.push(solid.capsule("trim", [-2.7, 0.3, z], [2.7, h - 0.15, z], 0.09, E), solid.capsule("trim", [2.7, 0.3, z], [-2.7, h - 0.15, z], 0.09, E));
  return out;
});

const portal = asset("portal-frame", ["portal", "gateway", "energy"], (_, h) => {
  const out: DesignSolid[] = [solid.box("body", [0, 0.16, 0], [2.1, 0.16, 0.85], 0, E)];
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2, b = (i + 1) / 12 * Math.PI * 2;
    out.push(solid.capsule("steel", [Math.cos(a) * 1.8, h * 0.52 + Math.sin(a) * 1.8, 0], [Math.cos(b) * 1.8, h * 0.52 + Math.sin(b) * 1.8, 0], 0.17, E));
    out.push(solid.ball("core", [Math.cos(a) * 1.8, h * 0.52 + Math.sin(a) * 1.8, 0.18], 0.12, { ...E, group: "portal-lights" }));
  }
  return out;
}, { height: [4.0, 4.4] });

const roots = asset("root-bridge", ["garden", "roots", "bridge"], (_, h) => {
  const out: DesignSolid[] = [];
  for (const side of [-1, 1]) {
    let previous: Vec3 = [-3.0, 0.3, side * 1.2];
    for (let i = 1; i <= 6; i++) {
      const t = i / 6, next: Vec3 = [-3 + t * 6, 0.3 + Math.sin(t * Math.PI) * h * 0.6, side * (1.2 + Math.sin(t * Math.PI) * 0.3)];
      out.push(solid.capsule("bark", previous, next, 0.23, E)); previous = next;
    }
  }
  for (let i = 0; i < 5; i++) {
    const x = -2.4 + i * 1.2;
    out.push(solid.capsule("bark", [x, h * 0.5, -1.3], [x, h * 0.5, 1.3], 0.10, E), solid.ball("leaf", [x, h * 0.55, i % 2 ? -1.4 : 1.4], [0.7, 0.28, 0.48], E));
  }
  return out;
});

const spire = asset("glacier-spire", ["glacier", "crystal", "landmark"], (J, h) => {
  const out: DesignSolid[] = [];
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2, radius = i === 0 ? 0 : 1.25, hh = h * J.between(0.45, 1);
    out.push(solid.cone("glass", [Math.cos(a) * radius, 0, Math.sin(a) * radius], 0.7, hh, 0.15, { ...E, sides: 4, steps: 5 }));
    out.push(solid.cone("core", [Math.cos(a) * radius, hh, Math.sin(a) * radius], 0.15, 0.5, 0, { ...E, sides: 4, steps: 2 }));
  }
  return out;
}, { height: [5.8, 7.0] });

export const WORLD_ART_ASSETS = Object.freeze({
  ...PINBALL_FRAMING_ASSETS,
  oak, pine, birch, palm, bush, grass, reeds, rock, mushroom, crystal,
  "forge-furnace": furnace, "forge-turbine": turbine, "forge-stack": stack,
  "neon-pylon": pylon,
  "ruin-arch": arch, "ruin-column": column, "ruin-vault": vault,
  "bridge-trestle": trestle, "portal-frame": portal, "root-bridge": roots, "glacier-spire": spire,
});
export type WorldArtAssetId = keyof typeof WORLD_ART_ASSETS;
export const WORLD_ART_ASSET_IDS = Object.freeze(Object.keys(WORLD_ART_ASSETS) as WorldArtAssetId[]);

/** Invalid generator records fail visibly instead of silently inventing a prop. */
export function worldArtAsset(id: string): StyledObjectDef {
  const found = WORLD_ART_ASSETS[id as WorldArtAssetId];
  if (!found) throw new RangeError(`Unknown pinball world asset: ${id}`);
  return found;
}
