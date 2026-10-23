import { defineProfile, worldLook, slotOf, type WorldProfile, type WorldRoles, type ProfileRole } from "@keel-engine/object";
import { paintRoles, type LayerPaint } from "@keel-engine/bake";
import type { ArenaBiome, ArenaBiomeBlend } from "@keel-engine/pinball-arena";
import type { PinballSceneTone } from "./scenes.ts";

type Tone = readonly [number, number, number];
const BASE: Readonly<Record<string, Tone>> = {
  body: [226, 0.075, 0.50], steel: [215, 0.025, 0.65], trim: [58, 0.105, 0.72], glass: [211, 0.085, 0.59], core: [185, 0.14, 0.80], stone: [95, 0.030, 0.52], gold: [86, 0.13, 0.75], bark: [45, 0.065, 0.37], leaf: [145, 0.11, 0.52], needle: [162, 0.08, 0.40], moss: [124, 0.09, 0.42], blossom: [333, 0.15, 0.75], fruit: [36, 0.15, 0.61], crystal: [193, 0.12, 0.74], glow: [181, 0.14, 0.80], cap: [309, 0.12, 0.63], stem: [78, 0.035, 0.75], spot: [174, 0.12, 0.84], paperbark: [77, 0.022, 0.86], wood: [52, 0.06, 0.44], dark: [252, 0.025, 0.23], ground: [154, 0.050, 0.47], water: [202, 0.085, 0.58], ice: [204, 0.055, 0.78], rail: [214, 0.030, 0.73], ball: [84, 0.010, 0.96],
};
const PAINT: Readonly<Record<ArenaBiome, Readonly<Record<string, Tone>>>> = {
  forge: { body: [36, 0.055, 0.46], steel: [217, 0.020, 0.54], trim: [67, 0.12, 0.71], core: [43, 0.19, 0.83], stone: [36, 0.022, 0.39], leaf: [87, 0.07, 0.46], glow: [37, 0.18, 0.81], ground: [40, 0.035, 0.42], water: [25, 0.15, 0.64] },
  neon: { body: [267, 0.09, 0.45], steel: [230, 0.06, 0.64], trim: [315, 0.12, 0.76], core: [324, 0.19, 0.84], glass: [212, 0.13, 0.59], stone: [254, 0.045, 0.43], leaf: [185, 0.13, 0.57], glow: [181, 0.17, 0.84], ground: [255, 0.045, 0.36], water: [280, 0.12, 0.54] },
  garden: { body: [154, 0.05, 0.49], steel: [181, 0.035, 0.61], trim: [77, 0.09, 0.70], core: [164, 0.15, 0.81], stone: [90, 0.055, 0.55], leaf: [142, 0.13, 0.55], needle: [159, 0.085, 0.43], glow: [167, 0.14, 0.81], ground: [139, 0.07, 0.48], water: [194, 0.10, 0.61] },
  glacier: { body: [207, 0.065, 0.65], steel: [226, 0.024, 0.72], trim: [240, 0.06, 0.75], core: [189, 0.11, 0.90], glass: [201, 0.070, 0.78], stone: [222, 0.025, 0.68], leaf: [188, 0.07, 0.62], needle: [191, 0.065, 0.52], glow: [183, 0.10, 0.90], ground: [204, 0.03, 0.76], water: [212, 0.10, 0.61] },
  ruins: { body: [68, 0.075, 0.58], steel: [91, 0.045, 0.60], trim: [87, 0.13, 0.75], core: [157, 0.13, 0.82], stone: [71, 0.05, 0.62], gold: [86, 0.14, 0.79], leaf: [118, 0.09, 0.46], ground: [79, 0.045, 0.53], water: [180, 0.085, 0.58] },
};
export const WORLD_BIOMES: readonly ArenaBiome[] = ["forge", "neon", "garden", "glacier", "ruins"];

/** Cosmetic print/material vocabulary remains independent of raster style.
 * The compiler's blend owns the cabinet identity and neighbouring transitions. */
export function pinballThemeFromBiome(blend: ArenaBiomeBlend): "cyber" | "gold" | "vapor" | "nature" | "crypto" | "nightshift" {
  const b = quantizedBiomeBlend(blend);
  return b.garden >= .5 ? "nature" : b.glacier >= .25 ? "vapor" : b.ruins >= .25 && b.neon >= .25 ? "crypto" : b.ruins >= .375 ? "gold" : b.neon >= .5 ? "cyber" : "nightshift";
}
const CABINET_TONES: Readonly<Record<ReturnType<typeof pinballThemeFromBiome>, Readonly<Record<string, Tone>>>> = {
  cyber: { ground: [272, .105, .43], steel: [256, .080, .58], rail: [204, .110, .66], trim: [320, .15, .73], dark: [270, .08, .25], core: [187, .17, .81] },
  vapor: { ground: [288, .080, .50], steel: [275, .065, .62], rail: [184, .105, .72], trim: [337, .14, .77], dark: [285, .060, .28], core: [185, .15, .84] },
  gold: { ground: [68, .065, .43], steel: [59, .060, .53], rail: [78, .085, .65], trim: [88, .15, .78], dark: [46, .035, .25], core: [93, .13, .76] },
  nature: { ground: [140, .075, .43], steel: [164, .065, .54], rail: [64, .070, .62], trim: [85, .105, .70], dark: [150, .060, .24], core: [156, .13, .78] },
  crypto: { ground: [254, .095, .42], steel: [241, .075, .56], rail: [176, .100, .64], trim: [88, .13, .75], dark: [247, .070, .23], core: [179, .17, .81] },
  nightshift: { ground: [34, .045, .41], steel: [30, .045, .53], rail: [215, .035, .62], trim: [69, .12, .71], dark: [30, .030, .23], core: [43, .17, .78] },
};
export const pinballThemeTones = (theme: ReturnType<typeof pinballThemeFromBiome>): Readonly<Record<string, Tone>> => CABINET_TONES[theme];
// Large coated steel/glass fields use restrained ramps. KEEL's chrome ramp
// deliberately reaches near-white, reserved here for narrow trim and bodies.
const FINISH: Readonly<Record<string, ProfileRole["finish"]>> = { steel: "matte", trim: "metal", glass: "matte", gold: "metal", core: "matte", glow: "glow", crystal: "metal", ball: "metal", rail: "matte", water: "matte", ice: "matte" };

/** Exactly eight material shares: 495 possible blends and an order-independent cache key. */
export function quantizedBiomeBlend(blend: ArenaBiomeBlend): ArenaBiomeBlend {
  const raw = WORLD_BIOMES.map(id => Math.max(0, Number.isFinite(blend[id]) ? blend[id] : 0));
  const sum = raw.reduce((a, b) => a + b, 0);
  if (!sum) return { forge: 0, neon: 0, garden: 1, glacier: 0, ruins: 0 };
  const shares = raw.map(n => n / sum * 8), counts = shares.map(Math.floor);
  const order = shares.map((n, i) => ({ i, fraction: n - counts[i]! })).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  for (let i = 0, left = 8 - counts.reduce((a, b) => a + b, 0); i < left; i++) counts[order[i]!.i]!++;
  return Object.fromEntries(WORLD_BIOMES.map((id, i) => [id, counts[i]! / 8])) as unknown as ArenaBiomeBlend;
}
export function biomeLookKey(blend: ArenaBiomeBlend): string {
  const bucket = quantizedBiomeBlend(blend);
  return WORLD_BIOMES.map(id => bucket[id] * 8).join(".");
}

/** One coherent material language; regions blend its role ranges instead of changing renderer. */
export function blendedWorldProfile(blend: ArenaBiomeBlend, tones?: Readonly<Record<string, PinballSceneTone>>): WorldProfile {
  const bucket = quantizedBiomeBlend(blend);
  const cabinetTones = CABINET_TONES[pinballThemeFromBiome(bucket)];
  const raw = WORLD_BIOMES.map(id => bucket[id]);
  const sum = raw.reduce((a, b) => a + b, 0);
  const weights = raw.map((w, i) => sum ? w / sum : i === 2 ? 1 : 0);
  const roles: Record<string, ProfileRole> = {};
  for (const [role, base] of Object.entries({ ...BASE, ...tones })) {
    let sx = 0, sy = 0, chroma = 0, light = 0;
    for (let i = 0; i < WORLD_BIOMES.length; i++) {
      const tone = PAINT[WORLD_BIOMES[i]!]![role] ?? base, weight = weights[i]!;
      sx += Math.cos(tone[0] * Math.PI / 180) * weight; sy += Math.sin(tone[0] * Math.PI / 180) * weight;
      chroma += tone[1] * weight; light += tone[2] * weight;
    }
    const cabinetTone = tones?.[role] ?? cabinetTones[role];
    const hue = cabinetTone?.[0] ?? (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360;
    if (cabinetTone) { chroma = cabinetTone[1]; light = cabinetTone[2]; }
    // Printed terrain stays below the mechanism's contrast; distant roofs and
    // structural metal no longer reach the same white as the moving owned ball.
    const lift = role === "ground" ? -.06 : role === "rail" ? -.10 : role === "steel" || role === "glass" ? -.08 : role === "core" || role === "glow" ? -.06 : -.04;
    const finalLight = Math.max(.18, Math.min(.80, light + lift)), span = role === "ground" || role === "rail" ? .18 : .26;
    roles[role] = { hue: [hue - 3, hue + 3], chroma: [chroma * 0.95, chroma * 1.05], light: [finalLight - 0.02, finalLight + 0.02], span: [span - .015, span + .015], finish: FINISH[role] ?? "matte", pattern: "none" };
  }
  return defineProfile({ id: "pinball-circuit", title: "Pinball Circuit", harmony: "analogous", roles });
}

export function worldArtPaint(roles: WorldRoles, seed: string, blend: ArenaBiomeBlend, tones?: Readonly<Record<string, PinballSceneTone>>): LayerPaint {
  const paint = [...paintRoles(worldLook(roles, seed, { profile: blendedWorldProfile(blend, tones) }))];
  for (const [role, spec] of Object.entries(roles)) {
    const slot = slotOf(roles, role), old = paint[slot];
    if (!old) continue;
    if (role === "glass" || role === "ice" || role === "crystal") paint[slot] = { ...old, sheen: "glass", mirror: 0.25 };
    else if (spec.stuff === "metal") paint[slot] = { ...old, sheen: "side", mirror: role === "ball" ? 0.45 : 0.12 };
  }
  return paint;
}

/** Shared slots for physical surfaces and moving bodies. */
export const FIELD_ROLES = {
  ground: { as: "primary", stuff: "bone" }, stone: { as: "detail", stuff: "bone" },
  steel: { as: "metal", stuff: "metal" }, glass: { as: "secondary", stuff: "metal" },
  water: { as: "clothAlt", stuff: "metal" }, ice: { as: "furAlt", stuff: "metal" },
  core: { as: "glow", stuff: "glow" }, trim: { as: "trim", stuff: "metal" },
  bark: { as: "hair", stuff: "wood" }, ball: { as: "accent", stuff: "metal" },
  dark: { as: "dark", stuff: "metal" },
  rail: { as: "cloth", stuff: "metal" },
} as const satisfies WorldRoles;
