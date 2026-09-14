// The pack's data schemas: the KEEL build lists every named one exported here
// in the manifest (contents.schemas, bytes embedded), so keel/codec registers
// them on the page and any tool reads the pack's documents.
import { named, struct, uint } from "@keel-engine/codec";

export const BLOB = named("fixtures/hello/blob", struct({ hue: uint(9) }));
