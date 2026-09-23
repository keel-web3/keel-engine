// Shared test scaffolding for character physics behavior checks.

import type { Vec3Like } from "@keel-engine/core";
import { TUNING, createCharacter } from "../src/character.ts";
import type { BodyEvent, BodyInput, Character } from "../src/character.ts";
import type { Box } from "../src/solids.ts";

export const DT = 1 / 120;
export const K = TUNING;
export const dot = (a: Vec3Like, b: Vec3Like): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const FLOOR: Box = { c: [0, -1, 0], h: [60, 1, 60] }; // (top at y = 0)
export const slab = (x0: number, x1: number, z0: number, z1: number, y = 0, mat = 1): Box => ({ c: [(x0 + x1) / 2, y - 1.5, (z0 + z1) / 2], h: [(x1 - x0) / 2, 1.5, (z1 - z0) / 2], mat });
export const idle: BodyInput = { move: [0, 0], jump: false, hold: false };
export const run = (body: Character, n: number, input: BodyInput | ((b: Character, i: number) => BodyInput)): BodyEvent["type"][] => {
  const ev: BodyEvent["type"][] = [];
  for (let i = 0; i < n; i += 1) { body.step(DT, typeof input === "function" ? input(body, i) : input); ev.push(...body.events.map((e) => e.type)); }
  return ev;
};
export const settle = (body: Character): BodyEvent["type"][] => run(body, 60, idle);
export const has = (b: Character, type: BodyEvent["type"]): boolean => b.events.some((e) => e.type === type);
export const YAWS16 = Array.from({ length: 16 }, (_, k) => (k * 2 * Math.PI) / 16 + 0.05);
