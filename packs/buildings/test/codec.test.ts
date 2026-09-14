// World content as data: a village's placement records and every asset's
// pins encode through @keel-engine/codec and decode back to what placed them
// (the same built keys), with sizes printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, encode } from "@keel-engine/codec";
import { placeContent } from "@keel-engine/object";
import type { ContentRecord } from "@keel-engine/object";
import { pack as foliage } from "@keel-engine/foliage";
import { FOLIAGE_PINS } from "@keel-engine/foliage/codec";
import { alongPath, bridgeFor, pack } from "../src/index.ts";
import { BUILDING_PINS, CONTENT_RECORD } from "../src/codec.ts";

test("every asset's pins round-trip through its schema, and build the same thing again", () => {
  let bytes = 0, n = 0;
  for (const [p, schemas] of [[foliage, FOLIAGE_PINS], [pack, BUILDING_PINS]] as const) for (const def of p.objects) {
    for (let s = 0; s < 10; s += 1) {
      const built = def.build({ seed: s });
      const pins = { ...built.values };
      const data = encode(schemas[def.id]!, pins);
      bytes += data.length; n += 1;
      const back = decode(schemas[def.id]!, data) as Record<string, unknown>;
      assert.equal(def.build({ seed: 999, pins: back }).key, built.key, `${def.id} ${s}`);
    }
  }
  console.log(`pins: ${n} encodings, ${(bytes / n).toFixed(1)} B each on average (a document header included)`);
});

test("a village's records round-trip: the same things, in the same places", () => {
  const recs: ContentRecord[] = [
    { pack: "packs/buildings", id: "cottage", seed: 2, pins: { footprint: "L", floors: 2 }, pos: [-10, 0, -1], yaw: 0.5, look: { profile: "village" } },
    bridgeFor([0, 0, 6], [0, 0.6, -6], { kind: "arch", seed: 3 }),
    ...alongPath([[-18, 0, 14], [0, 0, 16], [18, 0, 14]], { id: "fence", gates: [1], seed: 9 }),
    { pack: "packs/foliage", id: "oak", seed: "7", pins: { season: "autumn" }, pos: [4, 0, 9], yaw: 1.2, tier: "foreground", style: "voxel" },
  ];
  const packs = [pack, foliage];
  const data = encode(CONTENT_RECORD, recs[0]! as never);
  assert.ok(data.length > 0);
  for (const r of recs) {
    const back = decode(CONTENT_RECORD, encode(CONTENT_RECORD, r as never)) as unknown as ContentRecord;
    const a = placeContent(packs, r), b = placeContent(packs, back);
    assert.equal(b.built.key, a.built.key, `${r.id}`);
    for (let i = 0; i < 3; i += 1) assert.ok(Math.abs(b.instance.transform.pos[i]! - a.instance.transform.pos[i]!) <= 5e-4);
    assert.ok(Math.abs(b.instance.transform.yaw - a.instance.transform.yaw) < 1e-4);
    assert.equal(b.look.signature, a.look.signature);
  }
  const all = recs.reduce((n, r) => n + encode(CONTENT_RECORD, r as never).length, 0);
  console.log(`${recs.length} records: ${all} B (${(all / recs.length).toFixed(1)} B each, one document per record)`);
});
