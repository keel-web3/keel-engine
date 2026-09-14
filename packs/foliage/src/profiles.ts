// Seasons and biomes: look profiles (world-look.ts). Each says, per world
// role, where its colours come from -- so a season recolours every tree,
// bush and tuft at once, at no bake cost (looks are painted, never baked).
// Roles a profile leaves out are drawn by core's harmony.
import { defineProfile } from "@keel-engine/object";
import type { ProfileRole, WorldProfile } from "@keel-engine/object";

type Ranges = Readonly<Record<string, ProfileRole>>;

// (What stays put across the temperate seasons: bark, stone, stems.)
const EARTH: Ranges = {
  bark: { hue: [35, 60], chroma: [0.03, 0.06], light: [0.3, 0.42] },
  paperbark: { hue: [70, 95], chroma: [0.005, 0.02], light: [0.84, 0.92], pattern: "bands" },
  stone: { hue: [60, 110], chroma: [0.005, 0.025], light: [0.5, 0.66] },
  wood: { hue: [55, 75], chroma: [0.06, 0.09], light: [0.62, 0.72] },
  stem: { hue: [70, 90], chroma: [0.01, 0.03], light: [0.82, 0.9] },
  dark: { hue: [30, 60], chroma: [0.01, 0.03], light: [0.14, 0.2] },
  moss: { hue: [132, 150], chroma: [0.07, 0.1], light: [0.4, 0.5] },
  cap: { hue: [15, 40], chroma: [0.12, 0.16], light: [0.45, 0.58] },
  spot: { hue: [80, 100], chroma: [0.01, 0.03], light: [0.9, 0.95] },
  fruit: { hue: [10, 35], chroma: [0.14, 0.18], light: [0.5, 0.6] },
  crystal: { hue: [180, 300], chroma: [0.08, 0.14], light: [0.66, 0.78] },
  glow: { hue: [150, 200], chroma: [0.12, 0.18], light: [0.75, 0.85] },
};

export const PROFILES: readonly WorldProfile[] = [
  defineProfile({ id: "summer", title: "Summer", harmony: "earthy", roles: { ...EARTH,
    leaf: { hue: [142, 160], chroma: [0.1, 0.14], light: [0.44, 0.56] }, needle: { hue: [158, 175], chroma: [0.06, 0.09], light: [0.32, 0.42] },
    blossom: { hue: [330, 60], chroma: [0.12, 0.17], light: [0.72, 0.84] } } }),
  defineProfile({ id: "spring", title: "Spring", harmony: "pastel", roles: { ...EARTH,
    leaf: { hue: [136, 150], chroma: [0.13, 0.17], light: [0.62, 0.72] }, needle: { hue: [145, 162], chroma: [0.08, 0.12], light: [0.4, 0.5] },
    blossom: { hue: [340, 20], chroma: [0.08, 0.12], light: [0.8, 0.9] }, moss: { hue: [125, 138], chroma: [0.1, 0.13], light: [0.5, 0.6] } } }),
  defineProfile({ id: "autumn", title: "Autumn", harmony: "earthy", roles: { ...EARTH,
    leaf: { hue: [30, 85], chroma: [0.12, 0.17], light: [0.52, 0.68] }, needle: { hue: [148, 168], chroma: [0.05, 0.08], light: [0.3, 0.38] },
    blossom: { hue: [20, 50], chroma: [0.1, 0.15], light: [0.6, 0.72] }, moss: { hue: [90, 115], chroma: [0.06, 0.09], light: [0.38, 0.48] } } }),
  defineProfile({ id: "winter", title: "Winter", harmony: "analogous", roles: { ...EARTH,
    leaf: { hue: [210, 245], chroma: [0.0, 0.03], light: [0.86, 0.95] }, needle: { hue: [155, 180], chroma: [0.03, 0.06], light: [0.26, 0.34] },
    bark: { hue: [30, 50], chroma: [0.02, 0.04], light: [0.22, 0.3] }, stone: { hue: [220, 250], chroma: [0.005, 0.02], light: [0.6, 0.74] },
    moss: { hue: [210, 240], chroma: [0.0, 0.02], light: [0.88, 0.95] }, blossom: { hue: [200, 240], chroma: [0.01, 0.03], light: [0.9, 0.96] } } }),
  defineProfile({ id: "dry", title: "Dry savanna", harmony: "earthy", roles: { ...EARTH,
    leaf: { hue: [95, 122], chroma: [0.08, 0.12], light: [0.56, 0.68] }, needle: { hue: [120, 140], chroma: [0.05, 0.08], light: [0.38, 0.48] },
    blossom: { hue: [40, 70], chroma: [0.1, 0.14], light: [0.72, 0.82] }, stone: { hue: [50, 75], chroma: [0.03, 0.05], light: [0.58, 0.7] } } }),
  defineProfile({ id: "desert", title: "Desert", harmony: "earthy", roles: { ...EARTH,
    leaf: { hue: [148, 170], chroma: [0.05, 0.08], light: [0.48, 0.6] }, blossom: { hue: [340, 30], chroma: [0.14, 0.19], light: [0.62, 0.74] },
    stone: { hue: [45, 70], chroma: [0.04, 0.07], light: [0.64, 0.76] }, fruit: { hue: [0, 25], chroma: [0.14, 0.18], light: [0.5, 0.6] } } }),
  defineProfile({ id: "tropical", title: "Tropical", harmony: "complementary", roles: { ...EARTH,
    leaf: { hue: [146, 164], chroma: [0.13, 0.17], light: [0.46, 0.58] }, blossom: { hue: [0, 40], chroma: [0.17, 0.22], light: [0.6, 0.72] },
    fruit: { hue: [60, 90], chroma: [0.1, 0.14], light: [0.5, 0.62] }, bark: { hue: [45, 65], chroma: [0.04, 0.06], light: [0.44, 0.54] } } }),
  defineProfile({ id: "alien", title: "Alien", harmony: "neon", roles: { ...EARTH,
    leaf: { hue: [280, 330], chroma: [0.13, 0.18], light: [0.5, 0.62] }, needle: { hue: [170, 200], chroma: [0.08, 0.12], light: [0.38, 0.48] },
    bark: { hue: [245, 280], chroma: [0.04, 0.07], light: [0.26, 0.34] }, glow: { hue: [150, 190], chroma: [0.16, 0.2], light: [0.8, 0.88] },
    crystal: { hue: [160, 200], chroma: [0.12, 0.16], light: [0.7, 0.8], finish: "glow" }, stone: { hue: [250, 290], chroma: [0.02, 0.04], light: [0.4, 0.5] },
    blossom: { hue: [160, 200], chroma: [0.14, 0.18], light: [0.75, 0.85] }, moss: { hue: [180, 210], chroma: [0.08, 0.12], light: [0.5, 0.6] } } }),
  defineProfile({ id: "fungal", title: "Fungal jungle", harmony: "triad", roles: { ...EARTH,
    cap: { hue: [270, 330], chroma: [0.14, 0.19], light: [0.46, 0.6] }, stem: { hue: [260, 300], chroma: [0.02, 0.05], light: [0.78, 0.88] },
    spot: { hue: [160, 200], chroma: [0.12, 0.16], light: [0.85, 0.92], finish: "glow" }, glow: { hue: [160, 200], chroma: [0.15, 0.19], light: [0.8, 0.88] },
    leaf: { hue: [150, 190], chroma: [0.08, 0.12], light: [0.44, 0.56] }, bark: { hue: [270, 300], chroma: [0.03, 0.05], light: [0.3, 0.38] } } }),
  defineProfile({ id: "ash", title: "Ash world", harmony: "metallic", roles: { ...EARTH,
    leaf: { hue: [20, 45], chroma: [0.01, 0.03], light: [0.3, 0.4] }, bark: { hue: [20, 40], chroma: [0.005, 0.015], light: [0.16, 0.22] },
    stone: { hue: [20, 50], chroma: [0.005, 0.02], light: [0.26, 0.36] }, glow: { hue: [20, 45], chroma: [0.16, 0.2], light: [0.7, 0.8] },
    moss: { hue: [20, 40], chroma: [0.03, 0.05], light: [0.34, 0.42] }, crystal: { hue: [10, 40], chroma: [0.12, 0.16], light: [0.62, 0.72], finish: "glow" } } }),
  defineProfile({ id: "ice", title: "Ice moon", harmony: "analogous", roles: { ...EARTH,
    leaf: { hue: [190, 220], chroma: [0.03, 0.06], light: [0.82, 0.9] }, stone: { hue: [205, 235], chroma: [0.02, 0.04], light: [0.7, 0.82] },
    crystal: { hue: [190, 220], chroma: [0.06, 0.1], light: [0.8, 0.9] }, moss: { hue: [200, 230], chroma: [0.01, 0.03], light: [0.9, 0.96] },
    bark: { hue: [210, 240], chroma: [0.02, 0.03], light: [0.3, 0.38] } } }),
];
