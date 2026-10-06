import { array, bytes, enumOf, int, map, named, nullable, num, optional, ref, struct, tuple, uint, union } from "../schema.ts";
const position = tuple([int(13), int(13), int(13)]);
const size = tuple([uint(13), uint(13), uint(13)]);
const metadata = {
  name: ref("names"), unit: num(), origin: nullable(tuple([num(), num(), num()])),
  roles: array(ref("roles"), { max: 255 }),
  groups: map(ref("groups"), array(struct({ min: position, max: position }), { max: 4096 }), { order: "kept" }),
};
const box = { min: position, size, role: uint(8) };
export const VOXEL_CONSTRUCTION = named("keel/builder/construction", struct({
  metadata: optional(struct(metadata)), checksum: bytes({ length: 32 }),
  source: union("kind", {
    boxes: struct({ parts: array(struct({ ...box, count: uint(9), step: position }), { max: 4096 }) }),
    generator: struct({
      revision: uint(8), generator: enumOf(["critter", "crate", "banner", "tree", "lamp", "windmill"]),
      seed: ref("seeds"), plan: optional(enumOf(["humanoid", "quadruped"])), unit: optional(num()),
      baseline: optional(bytes({ length: 32 })), edits: array(struct({ at: position, role: uint(8) }), { max: 512 }),
    }),
  }),
}), { doc: "Exact primitive repetitions or a pinned generator and sparse edits; raw voxel documents remain a fallback." });
