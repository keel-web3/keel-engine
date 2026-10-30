// @keel-engine/biome: any biome on Earth as data. A spec says how the land
// lies, what covers the ground, what grows where, and the light and wind it
// stands in; createBiome makes it a stage of keel/tiles ground and keel/flora
// plants on one shared spring field.

export { BIOMES, BIOME_IDS, biomeForClimate, defineBiome } from "./biomes.ts";
export type { BiomeLight, BiomeSpec, GroundLayer, GroundRule, PlantRule, Ramp, TreeRule } from "./biomes.ts";

export { fbm, noise2, reliefHeight } from "./relief.ts";
export type { Relief, ReliefKind } from "./relief.ts";

export { PLANTER_SOILS, createBiome, createBiomePlot } from "./compose.ts";
export type { Biome, BiomeOptions, BiomePlot, BiomePlotOptions, PlotSoil, TreePlace } from "./compose.ts";
