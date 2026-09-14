// Seeded streams a world can SAVE. Core's `stream(roll, slot)` keeps its
// cursor in a closure; these keep it in the open (`cursor`), so a snapshot
// can write it down and a restore can put it back. The numbers are exactly
// core's: namedStream(seed, "x").f() walks the same words as
// stream(createRoll(deriveSeed(seed, "x")), 0).f() (test/world.test.ts checks).
// Ported from the proof of concept's src/world/streams.js.
//
// One stream per name, each off its own derived seed, so two systems never
// share a stream and adding draws to one never moves another.

import { createRoll, deriveSeed } from "@keel-engine/core";
import type { Seed, Stream, Weighted } from "@keel-engine/core";

const BASE = 0x10000; // (core's sub(0): its words start here)

/** A core Stream whose cursor is in the open. */
export interface NamedStream extends Stream {
  readonly name: string;
  cursor: number;
}

/** A stream for `name` under a world seed. */
export function namedStream(seed: string, name: string, cursor = 0): NamedStream {
  const roll = createRoll(deriveSeed(String(seed), name));
  const S: NamedStream = {
    name,
    cursor,
    f: () => roll.at(BASE + S.cursor++) / 65536,
    between: (a, b) => a + (b - a) * S.f(),
    int: (a, b) => a + Math.floor(S.f() * (b - a + 1)),
    pick: <T>(list: readonly T[]): T => list[Math.floor(S.f() * list.length)] as T,
    chance: (p) => S.f() < p,
    weighted<T>(entries: Weighted<T>): T {
      let total = 0;
      for (const [, w] of entries) total += w;
      let ticket = S.f() * total;
      for (const [value, w] of entries) {
        if (ticket < w) return value;
        ticket -= w;
      }
      return entries[entries.length - 1]![0];
    },
  };
  return S;
}

/**
 * A world seed as bytes32 hex (what the object catalogue and core's rng want):
 * hex seeds pass through, anything else ("1", "garden") is derived from its text.
 */
export function worldSeed(seed: unknown): Seed {
  const t = String(seed);
  return /^0x[0-9a-f]{64}$/i.test(t) ? t.toLowerCase() : deriveSeed("keel-world", t);
}
