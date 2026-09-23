// The default city catalogue for keel/architecture: its archetypes, facade
// styles, materials, the looks each district kind comes in, and which
// archetypes each district kind draws (weights to tune with screenshots:
// docs, redline CITY_BUILDINGS.md 2.4).

import type { Catalogue } from "@keel-engine/architecture";
import { CITY_ARCHETYPES, CITY_FACADES } from "./archetypes.ts";
import { CITY_MATERIALS } from "./materials.ts";

const look = (share: number, warm: number, dirt: number) => ({ share, warm, dirt });

export const CITY_CATALOGUE: Catalogue = {
  version: "city@2",
  archetypes: CITY_ARCHETYPES,
  facades: CITY_FACADES,
  materials: CITY_MATERIALS,
  looks: {
    core: [look(1.1, 0.3, 0), look(1, 0.5, 0.05), look(0.9, 0.2, 0)],
    midtown: [look(1, 0.6, 0.05), look(0.9, 0.8, 0.1), look(1.1, 0.5, 0.05)],
    oldtown: [look(0.9, 0.9, 0.2), look(0.8, 1, 0.3), look(1, 0.8, 0.15)],
    industrial: [look(0.35, 0.6, 0.4), look(0.25, 0.4, 0.5), look(0.4, 0.7, 0.35)],
    docks: [look(0.3, 0.3, 0.45), look(0.25, 0.2, 0.5), look(0.35, 0.4, 0.4)],
    strip: [look(0.7, 0.7, 0.15), look(0.6, 0.8, 0.2), look(0.8, 0.6, 0.1)],
    suburb: [look(0.8, 1, 0.05), look(0.7, 0.9, 0.1), look(0.9, 1, 0)],
  },
  // (Tuned to read like the real thing: the strip is gas, burgers, dealers, big boxes and motels; the suburbs houses
  // with the odd corner store; industry has its garages and tuners; the old town its bars. Borders blend: zoning.ts.)
  weights: {
    core: { plaza: 4, walkup: 2, loft: 2, deco_tower: 12, intl_box: 12, brutalist: 5, glass_tower: 30, hotel: 8, church: 1.5, parking_garage: 6, parking_lot: 3, cinema: 1.5, bar: 0.5, library: 0.3 },
    midtown: {
      plaza: 3, park: 3, walkup: 10, loft: 8, deco_tower: 14, intl_box: 12, brutalist: 6, glass_tower: 10, hotel: 10, church: 3, gas_station: 1, diner: 1, parking_garage: 6, rowhouse: 4,
      parking_lot: 4, apartments: 6, cinema: 2, bar: 2, corner_store: 1.5, laundromat: 1.5, fast_food: 1.5, car_dealership: 1.5, auto_shop: 1, library: 0.8, hospital: 0.3, police_station: 0.3,
    },
    oldtown: {
      plaza: 3, park: 2, walkup: 36, loft: 10, deco_tower: 3, intl_box: 2, brutalist: 1, hotel: 3, church: 6, warehouse: 2, gas_station: 1, diner: 3, parking_garage: 2, rowhouse: 22,
      bar: 7, nightclub: 2, corner_store: 3, laundromat: 3, cinema: 2, auto_shop: 3, tuning_shop: 2, apartments: 4, library: 0.8, fast_food: 1, parking_lot: 1.5,
    },
    industrial: {
      park: 1, walkup: 2, loft: 14, intl_box: 4, brutalist: 4, warehouse: 32, strip_mall: 2, gas_station: 4, diner: 2, motel: 2, parking_garage: 1, factory: 10, tank_farm: 3,
      auto_shop: 10, tuning_shop: 4, car_dealership: 5, car_wash: 1, parts_store: 2, big_box: 2, truck_depot: 4, nightclub: 2, trailer_park: 2, freight_yard: 3, corner_store: 1, bar: 1,
    },
    docks: { loft: 6, intl_box: 2, warehouse: 40, gas_station: 2, diner: 2, freight_yard: 18, tank_farm: 5, factory: 4, truck_depot: 4, auto_shop: 3, bar: 1, nightclub: 1 },
    strip: {
      intl_box: 1, hotel: 2, church: 1, warehouse: 2, strip_mall: 24, gas_station: 12, diner: 6, motel: 10, parking_garage: 1, suburban: 3, car_dealership: 12, big_box: 7, fast_food: 14,
      auto_shop: 6, tuning_shop: 3, car_wash: 6, parts_store: 4, trailer_park: 2, cinema: 1, corner_store: 2, laundromat: 2, chapel: 1, bar: 1,
    },
    suburb: {
      park: 6, church: 3, chapel: 3, strip_mall: 5, gas_station: 3, diner: 2, motel: 1, rowhouse: 10, suburban: 70, fast_food: 3, car_dealership: 2.5, big_box: 1, car_wash: 1.5, auto_shop: 2, tuning_shop: 1, parts_store: 1,
      corner_store: 1.2, laundromat: 1, apartments: 3, library: 0.3, cemetery: 0.4, trailer_park: 0.8,
    },
  },
  landmark: "landmark",
  murals: { oldtown: 0.5, industrial: 0.45, docks: 0.4, midtown: 0.25, strip: 0.2, core: 0.1, suburb: 0.05 },
  // What a city has one of (or a district one of), placed before the draws, in this order.
  uniques: [
    { archetype: "stadium", per: "city", districts: ["suburb", "strip", "industrial", "midtown", "docks"], largest: true },
    { archetype: "city_hall", per: "city", districts: ["core", "midtown", "oldtown"] },
    { archetype: "hospital", per: "city", districts: ["midtown", "core", "suburb", "oldtown"] },
    { archetype: "college", per: "city", districts: ["midtown", "oldtown", "suburb"] },
    { archetype: "train_station", per: "city", districts: ["midtown", "core", "oldtown", "industrial"], roads: ["arterial", "highway"] },
    { archetype: "mall", per: "city", districts: ["strip", "suburb", "industrial"], roads: ["arterial", "highway"] },
    { archetype: "bus_depot", per: "city", districts: ["industrial", "strip", "midtown", "docks"] },
    { archetype: "police_station", per: "city", districts: ["core", "midtown", "oldtown"] },
    { archetype: "cemetery", per: "city", districts: ["suburb", "oldtown", "midtown", "strip"] },
    { archetype: "gasometer", per: "city", districts: ["industrial", "docks"] },
    { archetype: "substation", per: "district", districts: ["industrial"], minLots: 4 },
    { archetype: "substation", per: "city", districts: ["docks", "strip", "suburb"] },
    { archetype: "fire_station", per: "city", districts: ["core", "midtown", "oldtown"] },
    { archetype: "fire_station", per: "district", districts: ["suburb", "industrial", "strip", "midtown", "oldtown"], minLots: 30 },
    { archetype: "school", per: "district", districts: ["suburb"], minLots: 12 },
    { archetype: "school", per: "district", districts: ["midtown", "oldtown"], minLots: 14 },
    { archetype: "water_tower", per: "city", districts: ["suburb", "strip", "industrial"] },
    { archetype: "water_tower", per: "district", districts: ["suburb"], minLots: 40 },
  ],
  // The corner on an arterial out of downtown: the gas station on the junction.
  corners: { archetype: "gas_station", chance: { strip: 0.35, suburb: 0.3, industrial: 0.15, docks: 0.12, midtown: 0.15, oldtown: 0.08 } },
  commons: { archetype: "commons", park: { suburb: 0.18, midtown: 0.15, oldtown: 0.1, strip: 0.06, industrial: 0.04, docks: 0.03, core: 0.06 }, lake: 0.35 },
  blend: { reach: 80, max: 0.55 },
};
