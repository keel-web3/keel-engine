// Building cultures: look profiles (world-look.ts). A village's plaster and
// red tile, a stone town's grey and slate, adobe, a nordic turf-and-timber,
// a sci-fi colony's white panels and cyan light, a machine flavour's rust
// and hazard orange, a biotic hive's flesh and glow. Looks only: one baked
// house wears every culture.
import { defineProfile } from "@keel-engine/object";
import type { WorldProfile } from "@keel-engine/object";

export const PROFILES: readonly WorldProfile[] = [
  defineProfile({ id: "village", title: "Village", harmony: "earthy", roles: {
    wall: { hue: [70, 95], chroma: [0.015, 0.04], light: [0.84, 0.92] }, roof: { hue: [25, 45], chroma: [0.1, 0.14], light: [0.44, 0.54], pattern: ["checks", "bands"] },
    wood: { hue: [40, 60], chroma: [0.04, 0.07], light: [0.28, 0.36] }, trim: { hue: [60, 90], chroma: [0.01, 0.03], light: [0.7, 0.8] },
    stone: { hue: [60, 100], chroma: [0.01, 0.02], light: [0.56, 0.66] }, glass: { hue: [220, 250], chroma: [0.02, 0.05], light: [0.25, 0.32] },
    door: { hue: [20, 150], chroma: [0.06, 0.1], light: [0.36, 0.46] }, plank: { hue: [55, 70], chroma: [0.06, 0.08], light: [0.52, 0.62] },
    cloth: { hue: [0, 360], chroma: [0.1, 0.14], light: [0.55, 0.66], pattern: "stripes" }, sign: { hue: [50, 80], chroma: [0.05, 0.08], light: [0.6, 0.7] },
    rope: { hue: [60, 75], chroma: [0.05, 0.07], light: [0.6, 0.68] }, metal: { hue: [230, 260], chroma: [0.01, 0.02], light: [0.45, 0.55] },
  } }),
  defineProfile({ id: "stone", title: "Stone town", harmony: "analogous", roles: {
    wall: { hue: [60, 110], chroma: [0.005, 0.02], light: [0.58, 0.68], pattern: ["checks", "none"] }, roof: { hue: [230, 260], chroma: [0.02, 0.04], light: [0.32, 0.4], pattern: "bands" },
    wood: { hue: [35, 55], chroma: [0.03, 0.05], light: [0.26, 0.32] }, trim: { hue: [70, 100], chroma: [0.01, 0.02], light: [0.72, 0.8] },
    stone: { hue: [60, 100], chroma: [0.005, 0.02], light: [0.46, 0.54] }, glass: { hue: [200, 230], chroma: [0.02, 0.05], light: [0.22, 0.3] },
    door: { hue: [30, 50], chroma: [0.05, 0.08], light: [0.32, 0.4] }, plank: { hue: [50, 65], chroma: [0.04, 0.06], light: [0.46, 0.54] },
    metal: { hue: [230, 260], chroma: [0.01, 0.02], light: [0.4, 0.5] },
  } }),
  defineProfile({ id: "desert", title: "Adobe", harmony: "earthy", roles: {
    wall: { hue: [55, 75], chroma: [0.05, 0.08], light: [0.7, 0.8] }, roof: { hue: [45, 65], chroma: [0.06, 0.09], light: [0.6, 0.7], pattern: "none" },
    wood: { hue: [45, 60], chroma: [0.05, 0.07], light: [0.36, 0.44] }, trim: { hue: [180, 220], chroma: [0.06, 0.1], light: [0.5, 0.6] },
    stone: { hue: [55, 70], chroma: [0.04, 0.06], light: [0.62, 0.7] }, glass: { hue: [30, 50], chroma: [0.02, 0.04], light: [0.18, 0.24] },
    door: { hue: [180, 230], chroma: [0.07, 0.11], light: [0.44, 0.54] }, cloth: { hue: [0, 40], chroma: [0.12, 0.16], light: [0.52, 0.62], pattern: "stripes" },
  } }),
  defineProfile({ id: "nordic", title: "Nordic", harmony: "earthy", roles: {
    wall: { hue: [30, 50], chroma: [0.05, 0.08], light: [0.3, 0.38], pattern: "bands" }, roof: { hue: [125, 145], chroma: [0.06, 0.09], light: [0.36, 0.44], pattern: "none" },
    wood: { hue: [40, 55], chroma: [0.04, 0.06], light: [0.22, 0.28] }, trim: { hue: [20, 35], chroma: [0.1, 0.14], light: [0.42, 0.5] },
    stone: { hue: [220, 250], chroma: [0.01, 0.02], light: [0.5, 0.58] }, door: { hue: [20, 35], chroma: [0.11, 0.14], light: [0.38, 0.46] },
  } }),
  defineProfile({ id: "scifi", title: "Sci-fi colony", harmony: "complementary", roles: {
    wall: { hue: [220, 250], chroma: [0.005, 0.02], light: [0.82, 0.9] }, roof: { hue: [220, 250], chroma: [0.01, 0.03], light: [0.68, 0.76], pattern: "none" },
    metal: { hue: [230, 250], chroma: [0.01, 0.03], light: [0.46, 0.56] }, glow: { hue: [185, 215], chroma: [0.12, 0.16], light: [0.8, 0.88] },
    glass: { hue: [190, 220], chroma: [0.08, 0.12], light: [0.6, 0.7], finish: "glow" }, trim: { hue: [30, 60], chroma: [0.13, 0.17], light: [0.62, 0.7] },
    door: { hue: [220, 250], chroma: [0.02, 0.04], light: [0.4, 0.48] }, stone: { hue: [230, 250], chroma: [0.01, 0.02], light: [0.36, 0.44] },
    plank: { hue: [230, 250], chroma: [0.01, 0.02], light: [0.5, 0.58] }, wood: { hue: [230, 250], chroma: [0.01, 0.02], light: [0.36, 0.42] },
  } }),
  defineProfile({ id: "machine", title: "Machine", harmony: "metallic", roles: {
    wall: { hue: [40, 70], chroma: [0.01, 0.03], light: [0.46, 0.56] }, roof: { hue: [30, 50], chroma: [0.02, 0.04], light: [0.34, 0.42], pattern: "stripes" },
    metal: { hue: [40, 60], chroma: [0.03, 0.06], light: [0.4, 0.5] }, trim: { hue: [55, 75], chroma: [0.14, 0.17], light: [0.72, 0.8] },
    glow: { hue: [25, 50], chroma: [0.16, 0.2], light: [0.72, 0.8] }, glass: { hue: [30, 50], chroma: [0.08, 0.12], light: [0.55, 0.65], finish: "glow" },
    door: { hue: [55, 75], chroma: [0.13, 0.16], light: [0.62, 0.72], pattern: "stripes" }, stone: { hue: [40, 60], chroma: [0.01, 0.02], light: [0.3, 0.38] },
  } }),
  defineProfile({ id: "biotic", title: "Biotic", harmony: "triad", roles: {
    organic: { hue: [330, 360], chroma: [0.08, 0.12], light: [0.46, 0.56], pattern: ["spots", "gradient"] }, roof: { hue: [290, 330], chroma: [0.08, 0.12], light: [0.36, 0.46], pattern: "spots" },
    glow: { hue: [110, 150], chroma: [0.16, 0.2], light: [0.78, 0.86] }, dark: { hue: [300, 330], chroma: [0.03, 0.05], light: [0.12, 0.18] },
    stone: { hue: [60, 90], chroma: [0.02, 0.04], light: [0.78, 0.86] }, wall: { hue: [320, 350], chroma: [0.06, 0.09], light: [0.52, 0.62] },
    metal: { hue: [290, 320], chroma: [0.04, 0.06], light: [0.34, 0.42] }, glass: { hue: [110, 150], chroma: [0.1, 0.14], light: [0.6, 0.7], finish: "glow" },
    trim: { hue: [300, 330], chroma: [0.05, 0.08], light: [0.3, 0.38] },
  } }),
];
