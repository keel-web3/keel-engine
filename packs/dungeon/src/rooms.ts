// Room templates for keel/worldgen's stitched dungeons (its RoomTemplate,
// structurally: this pack needs nothing of worldgen's). A recipe uses them by
// passing them to the pipeline -- runPipeline(recipe, { templates: ROOMS }),
// or a world pack's `rooms` -- and naming them in the dungeon stage's
// `templates` param ("dungeon-*" picks them all; the engine's own stand in for
// any role they can't play).
//
// Rows: '#' wall, '.' floor, 'D' a door anchor on the edge, 'P' a pillar,
// '~' water, 'o' a pit, 'T' a torch, 'C' a chest, 'r' rubble; 'S' 'K' 'B' 'E'
// the start, key, boss and exit; and worldgen's furniture letters
// (TEMPLATE_PROPS): b bookshelf, s sarcophagus, a altar, t table, w weapon
// rack, c cage, u urn, x crate, y barrel, h throne, i statue, z brazier,
// l candles, q bones, k skull pile, n banner, m chains, g tombstone, f anvil,
// v crystals.

export interface DungeonRoomTemplate {
  readonly id: string;
  readonly roles: ReadonlyArray<"start" | "room" | "key" | "boss" | "exit" | "treasure" | "cave">;
  readonly rows: readonly string[];
  readonly weight?: number;
}

export const ROOMS: readonly DungeonRoomTemplate[] = [
  { id: "dungeon-entry-hall", roles: ["start"], rows: ["#####D#####", "#n.z...z.n#", "#.........#", "D....S....D", "#.........#", "#y.......x#", "#####D#####"] },
  { id: "dungeon-stairwell", roles: ["exit"], rows: ["###D###", "#k...k#", "D..E..D", "#z...z#", "###D###"] },
  { id: "dungeon-library", roles: ["room"], weight: 2, rows: ["####D######", "#bbb...bbb#", "#.........#", "D..t...t..D", "#.........#", "#bbb.l.bbb#", "######D####"] },
  { id: "dungeon-crypt-hall", roles: ["room"], weight: 2, rows: ["#####D#####", "#u.......u#", "#.s..l..s.#", "D.........D", "#.s..l..s.#", "#u.......u#", "#####D#####"] },
  { id: "dungeon-armoury", roles: ["room"], weight: 1, rows: ["###D#####", "#www.www#", "#.......#", "D..x.y..D", "#.......#", "#i.....i#", "#####D###"] },
  { id: "dungeon-prison", roles: ["room"], weight: 1, rows: ["####D####", "#c.m.m.c#", "#.......#", "D..q.k..D", "#.......#", "#c.....c#", "####D####"] },
  { id: "dungeon-storeroom", roles: ["room", "treasure"], weight: 1, rows: ["###D#####", "#xy...yx#", "#x.....u#", "D...C...D", "#u.....x#", "#yx...xy#", "#####D###"] },
  { id: "dungeon-chapel", roles: ["key", "treasure"], weight: 1, rows: ["###D###", "#l...l#", "#..a..#", "D..K..D", "#i...i#", "###D###"] },
  { id: "dungeon-cistern", roles: ["room"], weight: 1, rows: ["#####D#####", "#.........#", "#.~~~.~~~.#", "D.~~~.~~~.D", "#.........#", "#####D#####"] },
  { id: "dungeon-colonnade", roles: ["room"], weight: 1, rows: ["#######D#######", "#i...........i#", "#..P..P..P..P.#", "D.............D", "#..P..P..P..P.#", "#i...........i#", "#######D#######"] },
  { id: "dungeon-throne-hall", roles: ["boss"], weight: 1, rows: ["#######D#######", "#z...i...i...z#", "#..P.......P..#", "#......h......#", "D......B......D", "#..P.......P..#", "#.............#", "#z...........z#", "#######D#######"] },
];
