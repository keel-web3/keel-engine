// Schemas for world content as data (@keel-engine/codec): what a level stores
// when it places a styled object -- a ContentRecord -- and each asset's pins,
// typed from its own choices (a list choice an enum, a range a fixed-point
// number on a millimetre-ish grid). Not part of the pack's KEEL module (its
// index doesn't import this): the editor, a level's save and agents import
// "@keel-engine/foliage/codec". packs/buildings reuses the helpers.
import { alt, bool, enumOf, fixed, map, named, num, optional, ref, struct, withDefault } from "@keel-engine/codec";
import type { Infer, Type } from "@keel-engine/codec";
import { seedAny, vec3, yaw } from "@keel-engine/codec";
import type { StyledObjectDef } from "@keel-engine/object";
import { pack } from "./pack.ts";

/** A pin's value when nothing narrower is known: a name, a flag or a number. */
const PinValue = alt([ref("values"), bool(), num()]);

/** An asset's pins as a struct of its choices, each optional: lists as enums, ranges on a grid of a thousandth of the range. */
export function pinsSchemaOf(def: Pick<StyledObjectDef, "id" | "pack" | "choices">): Type<Record<string, unknown>> {
  const fields: Record<string, Type<unknown>> = {};
  for (const [name, c] of Object.entries(def.choices)) {
    if (!Array.isArray(c) && typeof c === "object" && "range" in c) {
      const [lo, hi] = (c as { range: readonly [number, number] }).range;
      // (A thousandth of the range, exact values kept: a pin a designer typed survives the round trip.)
      fields[name] = optional(fixed(lo, hi, (hi - lo) / 1000, { off: "exact" }));
    } else fields[name] = optional(enumOf([...new Set(c as readonly (string | number | boolean)[])])); // (a list may repeat a value to weight it)
  }
  return named(`${def.pack ?? "styled"}/${def.id}/pins`, struct(fields as never), { doc: `${def.id}'s pins: its choices, each optional.` }) as unknown as Type<Record<string, unknown>>;
}

/** What a level stores to place a styled object: the pack and id, seed, pins, look, style, tier and where. */
export const CONTENT_RECORD = named("keel/object/content", struct({
  pack: ref("packs"),
  id: ref("ids"),
  seed: withDefault(seedAny, 0),
  pins: withDefault(map(ref("pins"), PinValue), {}),
  look: optional(struct({ seed: optional(seedAny), profile: optional(ref("profiles")), pins: withDefault(map(ref("pins"), PinValue), {}) })),
  style: optional(ref("styles")),
  tier: optional(enumOf(["main", "foreground", "background"])),
  pos: withDefault(vec3, [0, 0, 0]),
  yaw: withDefault(yaw, 0),
  scale: withDefault(fixed(0, 64, 1 / 1024), 1),
}), { doc: "A styled object placed in a level: pack, id, seed, pins, look, style, tier, position, yaw, scale." });
export type ContentRecordData = Infer<typeof CONTENT_RECORD>;

/** Every foliage asset's pins schema, by id. */
export const FOLIAGE_PINS: Readonly<Record<string, Type<Record<string, unknown>>>> = Object.fromEntries(pack.objects.map((o) => [o.id, pinsSchemaOf(o)]));
