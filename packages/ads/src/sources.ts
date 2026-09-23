// Sources of creatives, composed: the first source with an answer for a slot
// wins (a chain registry, then a curated list, then house ads). House ads are
// deterministic fictional brands from a seed, so a world is never blank and
// looks the same offline on every machine.

import { hash2 } from "@keel-engine/core";
import { safeHref } from "./href.ts";
import type { AdCreative, AdSlot, AdSource } from "./types.ts";

const fnv = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h | 0;
};

const FIRST = ["NEON", "MIDNIGHT", "CHROME", "VELVET", "APEX", "NOVA", "RADIO", "TURBO", "LUCKY", "SILVER", "ELECTRIC", "GOLDEN", "ROYAL", "ATOMIC"];
const TRADE = ["NOODLES", "MOTORS", "HOTEL", "RECORDS", "COLA", "TIRES", "BANK", "PIZZA", "ARCADE", "RADIO", "GARAGE", "DINER", "INSURANCE", "SPORTS"];
const LINES = ["OPEN ALL NIGHT", "SINCE 1958", "DRIVE FAST", "THE CITY'S FINEST", "TRY US", "NOW OPEN", "ASK FOR IT BY NAME"];

/** House ads: a brand per slot from the seed (and a link, if the game gives one). */
export function houseSource(seed: string, { href = null }: { readonly href?: string | ((slot: AdSlot) => string | null) | null } = {}): AdSource {
  const base = fnv(`keel-ads|${seed}`);
  const u = (slot: AdSlot, k: number): number => hash2(fnv(slot.id), k, base);
  return {
    async resolve(slots) {
      const out = new Map<string, AdCreative | null>();
      for (const s of slots) {
        const pick = <T>(list: readonly T[], k: number): T => list[Math.floor(u(s, k) * list.length)]!;
        const link = typeof href === "function" ? href(s) : href;
        out.set(s.id, { cid: null, title: `${pick(FIRST, 0)} ${pick(TRADE, 1)}`, line: pick(LINES, 2), href: safeHref(link), hue: Math.floor(u(s, 3) * 360) });
      }
      return out;
    },
  };
}

/** A curated list: creatives by slot id (a sponsor deal, a signed manifest already fetched). Links are checked. */
export function listSource(list: Readonly<Record<string, AdCreative>>): AdSource {
  return {
    async resolve(slots) {
      const out = new Map<string, AdCreative | null>();
      for (const s of slots) { const c = list[s.id]; out.set(s.id, c ? { ...c, href: safeHref(c.href) } : null); }
      return out;
    },
  };
}

/** Sources in order: each slot takes the first source's answer that isn't null. */
export function firstOf(...sources: readonly AdSource[]): AdSource {
  return {
    async resolve(slots, at) {
      const out = new Map<string, AdCreative | null>();
      let left = slots;
      for (const src of sources) {
        if (!left.length) break;
        const got = await src.resolve(left, at);
        for (const s of left) { const c = got.get(s.id); if (c) out.set(s.id, c); }
        left = left.filter((s) => !out.has(s.id));
      }
      for (const s of left) out.set(s.id, null);
      return out;
    },
  };
}
