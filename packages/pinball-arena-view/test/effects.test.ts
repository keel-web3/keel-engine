import { test } from "node:test";
import assert from "node:assert/strict";
import { ArenaInput, createArenaMatch, createArenaRoster } from "@keel-engine/pinball-arena";
import { prioritizeArenaPulseCues,arenaActivityWeight,type ArenaPulseCue } from "../src/effects.ts";
import { field, worldFrom } from "../../pinball-arena/test/fixtures.ts";

test("an actual simultaneous100-owner pulse burst retains the owned cue and nearby combat under its finite budget", () => {
  const roster = createArenaRoster({ players: 100 });
  // Renderer event priority is tested with100 legally separated launch disks,
  // independent of the procedural arena's launch-clearance qualification.
  const biome = { forge: 0, neon: 1, garden: 0, glacier: 0, ruins: 0 };
  const world = worldFrom([field({ bounds: [64, 64, 3000, 3000], stations: roster.map(p => {
    const x = 200 + p.ownerId % 10 * 250, y = 200 + Math.floor(p.ownerId / 10) * 250;
    return { id: `safe-launch-${p.ownerId}`, ownerId: p.ownerId, teamId: p.teamId, x, y, layer: 0, elevation: 0, launchX: x, launchY: y, launchVx: 0, launchVy: 0, flipperIds: [] };
  }), surfaces: [{ id: "supported-shared-floor", kind: "ground", polygon: [{ x: 64, y: 64 }, { x: 3000, y: 64 }, { x: 3000, y: 3000 }, { x: 64, y: 3000 }], layer: 0, height: 0, material: "steel", biome }] })]);
  const frame = createArenaMatch(world, { players: roster }).step(roster.map(p => ({ ownerId: p.ownerId, bits: ArenaInput.LAUNCH | ArenaInput.PULSE })));
  const accepted = frame.events.filter(e => e.type === "ability" && e.ability === "pulse");
  assert.equal(accepted.length, 100);
  const cues: ArenaPulseCue[] = accepted.map(e => ({ id: e.id, ownerId: e.ownerId!, arenaId: e.arenaId!, x: e.x!, y: e.y!, radius: e.radius!, elevation: e.elevation!, born: 0 }));
  const chosen = prioritizeArenaPulseCues(cues, 0, frame.balls[0], 32);
  assert.equal(chosen.length, 32);
  assert.equal(chosen[0]!.ownerId, 0);
  assert.equal(chosen[0]!.radius, 160);
  assert.deepEqual(prioritizeArenaPulseCues([...cues].reverse(), 0, frame.balls[0], 32), chosen);
  const distances = chosen.slice(1).map(c => Math.hypot(c.x - frame.balls[0]!.x, c.y - frame.balls[0]!.y));
  assert.ok(distances.every((d, i) => i === 0 || d >= distances[i - 1]!));
});

test("real foreground ownership and native depth subordinate distant effect weight without hiding entities",()=>{
  const body={arenaId:"field",x:100,y:200,elevation:115},foreign={arenaId:"field",ownerId:1,x:120,y:210,elevation:115};
  assert.equal(arenaActivityWeight(0,body,{...foreign,ownerId:0,x:9000}),1);assert.equal(arenaActivityWeight(0,body,foreign),1);assert.ok(arenaActivityWeight(0,body,{...foreign,x:700})<1);assert.ok(arenaActivityWeight(0,body,{...foreign,elevation:900})<arenaActivityWeight(0,body,foreign));assert.ok(arenaActivityWeight(0,body,{...foreign,x:5000})>0,"distant native activity is subdued, never zeroed");
});
