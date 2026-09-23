// packs/buildings: a modular building generator and its variants (cottage,
// tower, hall, workshop, shop; the sci-fi hab, dome and pylon; the biotic
// hive; the factory), bridges, ramps, stairs and cliff steps, walls, fences
// and gates, path pieces and a dock -- styled objects drawn in any style,
// with the design's colliders, sockets and fronts, and building cultures as
// look profiles. And the default city catalogue keel/architecture builds a
// city's lots from: archetypes, facade styles, materials and district looks.
export { PACK_ID, PACK_VERSION, pack } from "./pack.ts";
export { PROFILES } from "./profiles.ts";
export { ROLES, sagLine, spanBetween } from "./kit.ts";
export { DEFAULT_PARAMS, buildingDesign, wingsOf } from "./generator.ts";
export type { BuildingParams, Door, Footprint, Frame, Roof, Windows } from "./generator.ts";
export { buildingObject } from "./building-object.ts";
export { CITY_CATALOGUE } from "./city/index.ts";
export { CITY_ARCHETYPES, CITY_FACADES } from "./city/archetypes.ts";
export { CITY_MATERIALS } from "./city/materials.ts";
export { CITY_STREETS } from "./city/street.ts";
export type { TreeClimate, TreeDesign } from "./city/trees.ts";
export { PLANT_CROWNS, TREE_CLIMATES, TREE_FLORA, TREE_SLOT, TREE_VARIANTS, cityTreeDesigns, climateSpecies, treeBare, treeFit, treePaint, treeSeasonPaint, treeSpecies } from "./city/trees.ts";
export type { BuildingVariant } from "./building-object.ts";
export { alongPath, bridgeFor, gateSpan, gateWidthFor } from "./paths.ts";
export type { AlongOptions } from "./paths.ts";
export { default as building } from "./objects/building.ts";
export { default as cottage } from "./objects/cottage.ts";
export { default as tower } from "./objects/tower.ts";
export { default as hall } from "./objects/hall.ts";
export { default as workshop } from "./objects/workshop.ts";
export { default as shop } from "./objects/shop.ts";
export { default as hab } from "./objects/hab.ts";
export { default as dome } from "./objects/dome.ts";
export { default as pylon } from "./objects/pylon.ts";
export { default as hive } from "./objects/hive.ts";
export { default as factory } from "./objects/factory.ts";
export { default as bridge } from "./objects/bridge.ts";
export { default as ramp } from "./objects/ramp.ts";
export { default as stairs } from "./objects/stairs.ts";
export { default as cliffSteps } from "./objects/cliff-steps.ts";
export { default as wall } from "./objects/wall.ts";
export { default as fence } from "./objects/fence.ts";
export { default as gate } from "./objects/gate.ts";
export { default as pathStones } from "./objects/path-stones.ts";
export { default as dock } from "./objects/dock.ts";
