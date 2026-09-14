// The acts: look profiles (keel/object world-look). Each says, per world
// role, where its colours come from -- so one baked barrel is a crypt's
// cold oak, a cave's rotten staves, a forge's charred black and a ruin's
// grey-green wreck, and the whole room changes together. Looks only.
import { defineProfile } from "@keel-engine/object";
import type { WorldProfile } from "@keel-engine/object";

export const PROFILES: readonly WorldProfile[] = [
  // A CRYPT: cold blue-grey stone, dark oak, tarnished brass, ivory bone, crimson and violet cloth.
  defineProfile({ id: "crypt", title: "Crypt", harmony: "analogous", roles: {
    stone: { hue: [250, 285], chroma: [0.012, 0.03], light: [0.46, 0.6], pattern: "none" },
    wood: { hue: [35, 55], chroma: [0.04, 0.065], light: [0.3, 0.4], pattern: "bands" },
    metal: { hue: [235, 265], chroma: [0.01, 0.025], light: [0.42, 0.54] },
    gold: { hue: [70, 90], chroma: [0.08, 0.11], light: [0.62, 0.72] },
    cloth: { hue: [330, 10], chroma: [0.11, 0.15], light: [0.32, 0.44], pattern: ["trim", "none"] },
    bone: { hue: [70, 90], chroma: [0.025, 0.045], light: [0.66, 0.76] },
    paper: { hue: [72, 88], chroma: [0.04, 0.06], light: [0.78, 0.86] },
    leather: { hue: [22, 45], chroma: [0.06, 0.09], light: [0.3, 0.4] },
    wax: { hue: [82, 95], chroma: [0.02, 0.035], light: [0.88, 0.94] },
    ichor: { hue: [18, 30], chroma: [0.12, 0.16], light: [0.3, 0.38] },
    moss: { hue: [118, 140], chroma: [0.04, 0.07], light: [0.38, 0.46] },
    web: { hue: [240, 265], chroma: [0.005, 0.015], light: [0.6, 0.7] },
    accent: { hue: [270, 300], chroma: [0.1, 0.14], light: [0.46, 0.56] },
    cushion: { hue: [340, 360], chroma: [0.1, 0.13], light: [0.34, 0.42] },
    glow: { hue: [60, 80], chroma: [0.12, 0.15], light: [0.84, 0.9] },
    dark: { hue: [265, 290], chroma: [0.01, 0.02], light: [0.12, 0.16] },
  } }),
  // A CAVE: brown rock, rotten wood, rusted iron, green slime, cyan crystal.
  defineProfile({ id: "cave", title: "Cave", harmony: "earthy", roles: {
    stone: { hue: [45, 70], chroma: [0.015, 0.035], light: [0.42, 0.55], pattern: ["camo", "spots"] },
    wood: { hue: [45, 62], chroma: [0.03, 0.05], light: [0.35, 0.45] },
    metal: { hue: [35, 55], chroma: [0.03, 0.05], light: [0.38, 0.48] },
    gold: { hue: [75, 92], chroma: [0.09, 0.12], light: [0.64, 0.72] },
    cloth: { hue: [95, 135], chroma: [0.04, 0.07], light: [0.34, 0.44] },
    bone: { hue: [75, 90], chroma: [0.025, 0.04], light: [0.76, 0.84] },
    paper: { hue: [70, 85], chroma: [0.04, 0.06], light: [0.7, 0.78] },
    leather: { hue: [40, 55], chroma: [0.05, 0.07], light: [0.34, 0.42] },
    wax: { hue: [80, 92], chroma: [0.03, 0.05], light: [0.82, 0.9] },
    ichor: { hue: [128, 150], chroma: [0.12, 0.15], light: [0.46, 0.56] },
    moss: { hue: [128, 150], chroma: [0.08, 0.11], light: [0.42, 0.52] },
    web: { hue: [60, 90], chroma: [0.005, 0.015], light: [0.6, 0.7] },
    accent: { hue: [190, 215], chroma: [0.11, 0.15], light: [0.62, 0.72] },
    cushion: { hue: [30, 50], chroma: [0.05, 0.08], light: [0.36, 0.44] },
    glow: { hue: [185, 210], chroma: [0.12, 0.16], light: [0.82, 0.9], finish: "glow" },
    dark: { hue: [40, 60], chroma: [0.01, 0.02], light: [0.11, 0.15] },
  } }),
  // A FORGE of hell: black basalt, charred wood, black iron, brass, blood-red cloth, molten glow.
  defineProfile({ id: "forge", title: "Hell forge", harmony: "metallic", roles: {
    stone: { hue: [18, 40], chroma: [0.012, 0.028], light: [0.26, 0.36], pattern: ["none", "spots"] },
    wood: { hue: [28, 42], chroma: [0.025, 0.04], light: [0.2, 0.28] },
    metal: { hue: [245, 270], chroma: [0.008, 0.02], light: [0.3, 0.4] },
    gold: { hue: [65, 82], chroma: [0.1, 0.13], light: [0.62, 0.72] },
    cloth: { hue: [15, 30], chroma: [0.14, 0.18], light: [0.34, 0.44], pattern: ["trim", "bands"] },
    bone: { hue: [55, 75], chroma: [0.025, 0.04], light: [0.66, 0.74] },
    paper: { hue: [50, 70], chroma: [0.04, 0.06], light: [0.6, 0.7] },
    leather: { hue: [20, 35], chroma: [0.05, 0.08], light: [0.24, 0.32] },
    wax: { hue: [60, 80], chroma: [0.03, 0.05], light: [0.76, 0.84] },
    ichor: { hue: [25, 42], chroma: [0.16, 0.2], light: [0.46, 0.56] },
    moss: { hue: [25, 40], chroma: [0.01, 0.02], light: [0.42, 0.5] },
    web: { hue: [30, 45], chroma: [0.005, 0.015], light: [0.62, 0.7] },
    accent: { hue: [20, 40], chroma: [0.16, 0.19], light: [0.54, 0.62] },
    cushion: { hue: [10, 25], chroma: [0.12, 0.15], light: [0.3, 0.38] },
    glow: { hue: [38, 58], chroma: [0.16, 0.19], light: [0.76, 0.84], finish: "glow" },
    dark: { hue: [18, 30], chroma: [0.015, 0.025], light: [0.09, 0.13] },
  } }),
  // An overgrown RUIN: weathered sandstone, grey-green wood, verdigris, faded teal cloth, lush moss.
  defineProfile({ id: "ruin", title: "Overgrown ruin", harmony: "earthy", roles: {
    stone: { hue: [72, 98], chroma: [0.02, 0.04], light: [0.55, 0.68], pattern: ["camo", "none"] },
    wood: { hue: [48, 68], chroma: [0.04, 0.06], light: [0.34, 0.44] },
    metal: { hue: [160, 190], chroma: [0.04, 0.07], light: [0.5, 0.6] },
    gold: { hue: [80, 95], chroma: [0.07, 0.1], light: [0.64, 0.72] },
    cloth: { hue: [200, 232], chroma: [0.04, 0.07], light: [0.34, 0.44], pattern: ["none", "stripes"] },
    bone: { hue: [80, 95], chroma: [0.02, 0.035], light: [0.66, 0.76] },
    paper: { hue: [80, 95], chroma: [0.03, 0.05], light: [0.76, 0.84] },
    leather: { hue: [50, 70], chroma: [0.04, 0.06], light: [0.36, 0.44] },
    wax: { hue: [88, 100], chroma: [0.02, 0.04], light: [0.86, 0.92] },
    ichor: { hue: [10, 25], chroma: [0.08, 0.11], light: [0.34, 0.42] },
    moss: { hue: [122, 145], chroma: [0.1, 0.13], light: [0.46, 0.58], pattern: ["spots", "none"] },
    web: { hue: [110, 130], chroma: [0.005, 0.015], light: [0.62, 0.72] },
    accent: { hue: [20, 60], chroma: [0.06, 0.09], light: [0.36, 0.46] },
    cushion: { hue: [200, 230], chroma: [0.05, 0.08], light: [0.36, 0.44] },
    glow: { hue: [95, 120], chroma: [0.13, 0.16], light: [0.84, 0.9], finish: "glow" },
    dark: { hue: [140, 165], chroma: [0.015, 0.025], light: [0.12, 0.16] },
  } }),
];
