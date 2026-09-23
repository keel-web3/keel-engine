import assert from "node:assert/strict";
import { test } from "node:test";
import { firstOf, hostOf, houseSource, listSource, pickSlot, rayOf, safeHref } from "../src/index.ts";
import type { AdSlot, RayCamera } from "../src/index.ts";

const slot = (id: string, x: number, z: number, nx: number, nz: number): AdSlot => ({ id, kind: "billboard", size: [8, 4], pos: [x, 10, z], normal: [nx, nz] });

test("safeHref: only well-formed http(s) links, never a script, data or credentials", () => {
  assert.equal(safeHref("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(safeHref("http://example.com"), "http://example.com/");
  for (const bad of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "ipfs://bafy", "https://user:pw@example.com", "not a url", "", null]) assert.equal(safeHref(bad), null, String(bad));
  assert.equal(hostOf("https://shop.example.com/x"), "shop.example.com");
});

test("houseSource: a brand a slot, the same from the same seed; firstOf takes the first answer", async () => {
  const slots = [slot("a", 0, 0, 0, 1), slot("b", 5, 0, 0, 1)];
  const h1 = await houseSource("neon", { href: "https://example.com" }).resolve(slots, 0), h2 = await houseSource("neon").resolve(slots, 0);
  assert.equal(h1.get("a")!.title, h2.get("a")!.title);
  assert.equal(h1.get("a")!.href, "https://example.com/");
  assert.equal(h2.get("a")!.href, null);
  const src = firstOf(listSource({ b: { cid: "bafy", title: "SPONSOR", href: "javascript:bad()" } }), houseSource("neon"));
  const got = await src.resolve(slots, 0);
  assert.equal(got.get("b")!.title, "SPONSOR");
  assert.equal(got.get("b")!.href, null);
  assert.equal(got.get("a")!.title, h2.get("a")!.title);
});

test("pickSlot: the nearest face the pointer's ray meets from the front", () => {
  const cam: RayCamera = { kind: "persp", origin: [0, 10, -30], right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1], k: 1, tanHalfFov: Math.tan(0.5), width: 400, height: 300 };
  const near = slot("near", 0, 0, 0, -1), far = slot("far", 0, 20, 0, -1), back = slot("back", 0, -10, 0, 1);
  const mid = rayOf(cam, 0.5, 0.5);
  assert.equal(pickSlot([far, near, back], mid)!.slot.id, "near");
  assert.equal(pickSlot([back], mid), null);
  assert.equal(pickSlot([near], rayOf(cam, 0.02, 0.5)), null);
  // (An orthographic view: parallel rays.)
  const ortho: RayCamera = { ...cam, kind: "ortho", origin: [0, 10, 0], k: 20, tanHalfFov: 0 };
  assert.equal(pickSlot([near], rayOf(ortho, 0.5, 0.5))!.slot.id, "near");
});
