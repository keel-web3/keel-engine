import fs from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectionOf } from "@keel-engine/bake";
import type { ArenaField, ArenaFlipper, ArenaHazard, ArenaStation, ArenaPoint } from "@keel-engine/pinball-arena";
import { arenaCatchYaw, fitArenaLocalAim } from "../src/camera.ts";
import { field } from "../../pinball-arena/test/fixtures.ts";

const source = JSON.parse(fs.readFileSync(new URL("./fixtures/camera-native-fork-14.json", import.meta.url), "utf8")) as { unitScale: number; banks: { bank: ArenaStation; blades: ArenaFlipper[]; drain: ArenaHazard; mouths: (ArenaPoint & { elevation: number })[] }[] };
test("all three exact native fork banks put actual mouths above their pair and the true drain below", () => {
  assert.equal(source.banks.length, 3);
  for (const row of source.banks) for (const [width, height] of [[1200, 720], [360, 800]] as const) for (let turn = 0; turn < 4; turn++) {
    const angle = turn * Math.PI / 2, co = Math.cos(angle), si = Math.sin(angle), rotate = (x: number, y: number) => ({ x: co * x - si * y, y: si * x + co * y });
    const bank = { ...row.bank, ...rotate(row.bank.x, row.bank.y) }, blades = row.blades.map(f => { const p = rotate(f.pivotX, f.pivotY); return { ...f, pivotX: p.x, pivotY: p.y }; }), drain = { ...row.drain, ...rotate(row.drain.x, row.drain.y) };
    const physical: ArenaField = field({ flippers: blades, stations: [bank], hazards: [drain, { ...drain, id: "wrong-tier-drain", layer: (bank.layer + 1) % 4 as 0 | 1 | 2 | 3, ...rotate(row.blades[0]!.pivotX + 1, row.bank.y) }] });
    const before = JSON.stringify(physical), yaw = arenaCatchYaw(physical, bank), scale = source.unitScale;
    const view = projectionOf({ kind: "ortho", center: [bank.x * scale, bank.elevation * scale, bank.y * scale], yaw, pitch: .93, k: 12 }, width, height, 400);
    const project = (p: ArenaPoint, elevation: number) => view.project([p.x * scale, elevation * scale, p.y * scale]);
    const pair = blades.map(f => project({ x: f.pivotX, y: f.pivotY }, f.elevation));
    assert.ok(Math.abs(pair[0]![1] - pair[1]![1]) < .0001, `${bank.id} horizontal pair`);
    const pairY = (pair[0]![1] + pair[1]![1]) * .5;
    assert.ok(project(drain, drain.elevation)[1] > pairY, `${bank.id} actual drain below`);
    for (const mouth of row.mouths) assert.ok(project(rotate(mouth.x, mouth.y), mouth.elevation)[1] < pairY, `${bank.id} actual qualified mouth above`);
    assert.ok(pair[0]![0] < pair[1]![0], `${bank.id} actual .14 left/right order`);
    assert.equal(JSON.stringify(physical), before, "camera cannot alter native geometry");
  }
});

test("local bank context keeps native body scale while retaining only shot mouths that actually fit",()=>{
  for(const row of source.banks)for(const [width,height]of[[800,480],[240,534]]as const){const physical=field({flippers:row.blades,stations:[row.bank],hazards:[row.drain]}),yaw=arenaCatchYaw(physical,row.bank),scale=source.unitScale,minimum=4/(12*scale);
    const essential=[row.bank,...row.blades.map(f=>({x:f.pivotX,y:f.pivotY,elevation:f.elevation})),{x:row.drain.x-row.drain.radius,y:row.drain.y-row.drain.radius,elevation:row.drain.elevation},{x:row.drain.x+row.drain.radius,y:row.drain.y+row.drain.radius,elevation:row.drain.elevation}],contexts=row.mouths.map((p,i)=>({id:`mouth/${i}`,points:[p],priority:Math.hypot(p.x-row.bank.x,p.y-row.bank.y)}));
    const fit=fitArenaLocalAim(essential,contexts,scale,width,height,.93,yaw,row.bank.elevation,minimum),view=projectionOf({kind:"ortho",center:[fit.x*scale,row.bank.elevation*scale,fit.y*scale],yaw,pitch:.93,k:fit.k},width,height,400);
    assert.ok(fit.k>=minimum);assert.equal(fit.included.length+fit.excluded.length,contexts.length);assert.ok(fit.included.length>0,"a real local choice remains visible");
    for(const point of fit.points){const p=view.project([point.x*scale,point.elevation*scale,point.y*scale]);assert.ok(p[0]>=width*.07&&p[0]<=width*.93);assert.ok(p[1]>=height*.04&&p[1]<=height*.88);}
    const midpoint=row.blades.reduce((a,f)=>({x:a.x+f.pivotX/2,y:a.y+f.pivotY/2}),{x:0,y:0}),left=view.project([(midpoint.x-12*Math.cos(yaw))*scale,row.bank.elevation*scale, (midpoint.y+12*Math.sin(yaw))*scale]),right=view.project([(midpoint.x+12*Math.cos(yaw))*scale,row.bank.elevation*scale,(midpoint.y-12*Math.sin(yaw))*scale]);assert.ok(right[0]-left[0]>=8-.00001,"native24diameter body spans8 logical pixels without changing its radius");
    if(row.mouths.length===3 && width===240)assert.ok(fit.excluded.length>0,"a tall bank does not fit the entire distant fan at the cost of its moving ball");
  }
});
