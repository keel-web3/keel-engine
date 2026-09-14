// Schemas for buildings as data (@keel-engine/codec): each asset's pins typed
// from its choices (the modular building's full parameter set among them),
// and the content record every styled object is placed by (from
// packs/foliage's codec). Not part of the pack's KEEL module: the editor,
// level saves and agents import "@keel-engine/buildings/codec".
import type { Type } from "@keel-engine/codec";
import { CONTENT_RECORD, pinsSchemaOf } from "@keel-engine/foliage/codec";
import { pack } from "./pack.ts";

export { CONTENT_RECORD, pinsSchemaOf };

/** Every buildings asset's pins schema, by id ("building" is the generator's whole parameter set). */
export const BUILDING_PINS: Readonly<Record<string, Type<Record<string, unknown>>>> = Object.fromEntries(pack.objects.map((o) => [o.id, pinsSchemaOf(o)]));
