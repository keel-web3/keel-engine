// A test fixture: the army's cast (every character from packs/humans and
// packs/animals but the mouse, dressed from packs/cloth and packs/animals'
// wearables) as a population generator -- what examples/army draws, kept here
// so the engine's own tests (bake's, the codec's) have a real 10,000-unit
// population without reaching into an example. Plus a voxel hero from the
// builder, and an OBJECT to wear, for explicit parts.

import { deriveSeed } from "@keel-engine/core";
import { pack as animals } from "@keel-engine/animals";
import { manifest as animalsManifest } from "@keel-engine/animals/module";
import { bootsLeft, bootsRight, pack as cloth } from "@keel-engine/cloth";
import { pack as humans } from "@keel-engine/humans";
import { manifest as clothManifest } from "@keel-engine/cloth/module";
import { manifest as humansManifest } from "@keel-engine/humans/module";
import { generate, voxelBody } from "@keel-engine/builder";
import type { VoxelBody } from "@keel-engine/builder";
import { OBJECT, encode } from "@keel-engine/codec";
import type { ObjectRecord } from "@keel-engine/codec";
import { generatorOptions, populate } from "../src/index.ts";
import type { CastAttribute, CastEntity, Population, PopulationGenerator, PopulationOptions, UnitExplicit, UnitPins } from "../src/index.ts";

/** The army's cast (as examples/army's armyCast). */
export function armyCast(): { entities: CastEntity[]; attributes: CastAttribute[] } {
  const entities: CastEntity[] = [
    ...humans.entities.map((def): CastEntity => ({
      def, pack: "packs/humans", pins: { pack: "none", accessory: "none" }, weight: def.id === "human" ? 3 : 1, shapes: def.id === "human" ? 3 : 1,
      ...(def.id === "human" ? { wear: [{ defs: [bootsLeft, bootsRight], chance: 0.5 }] } : {}),
    })),
    ...animals.entities.filter((d) => d.id !== "mouse").map((def): CastEntity => ({ def, pack: "packs/animals", shapes: 1 })),
  ];
  const attributes: CastAttribute[] = [
    ...cloth.attributes.filter((a) => a.layer !== "body").map((def): CastAttribute => ({ def, weight: def.id === "flag" ? 0.6 : def.id === "cape" ? 0.8 : 1 })),
    ...animals.attributes.map((def): CastAttribute => ({ def })),
  ];
  return { entities, attributes };
}

/** The army as a generator: this fixture at its version, and the three packs it draws from at theirs. */
export const ARMY: PopulationGenerator = {
  modules: ["fixtures/army@0.1.0", `${humansManifest.id}@${humansManifest.version}`, `${animalsManifest.id}@${animalsManifest.version}`, `${clothManifest.id}@${clothManifest.version}`],
  cast: () => ({ ...armyCast(), shapes: 1, wear: [1, 3], variants: 6 }),
};

/** The army's population options (its seed derived as the example's). */
export const armyOptions = (seed: string, count: number, more: { pins?: ReadonlyMap<number, UnitPins>; explicit?: ReadonlyMap<number, UnitExplicit> } = {}): PopulationOptions =>
  generatorOptions(ARMY, deriveSeed(seed, "army/population"), count, more);
export const armyPopulation = (seed: string, count: number): Population => populate(armyOptions(seed, count));

/** A voxel hero: the builder's two-legged critter at a person's height, rigged. */
export const voxelHero = (seed = "1"): VoxelBody => voxelBody(generate("critter", seed, { plan: "humanoid", unit: 0.075 }).model);

/** A small OBJECT to wear in a socket: a crown of three boxes (roles the look knows, one it doesn't). */
export function crownDoc(): Uint8Array {
  const box = (c: [number, number, number], h: [number, number, number], role: string) => ({ role, collide: true, render: true, shape: { type: "box" as const, c, h, yaw: 0, round: 0 } });
  const rec: ObjectRecord = {
    key: "crown", parts: [box([0, 0.04, 0], [0.09, 0.04, 0.09], "metal"), box([0, 0.1, 0.07], [0.02, 0.03, 0.01], "glow"), box([0, 0.1, -0.07], [0.02, 0.03, 0.01], "gem")],
    front: 0, tags: [], sockets: {}, rest: "base", rails: [], meta: {},
  };
  return encode(OBJECT, rec);
}
