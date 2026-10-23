import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createArenaMatch,ARENA_AUTHORITY_REVISION} from '../src/index.ts';
import {field,player,worldFrom} from './fixtures.ts';

const home={...field().stations[0]!,x:150,y:200,launchX:600,launchY:200,launchVx:8,launchVy:0};
const drain={id:'remote-drain',kind:'drain' as const,x:850,y:200,radius:24,layer:0,elevation:0,damage:0,cooldownTicks:1};
test('a real remote-plunger launch drains and relaunches without a bank lease',()=>{
 const world=worldFrom([field({stations:[home],hazards:[drain]})]),options={players:[player()],mode:'expedition' as const,maxTicks:600},match=createArenaMatch(world,options);
 let drainTick=0;for(let tick=1;tick<=100;tick++){const frame=match.step([{ownerId:0,bits:tick===1?4:0}]);if(frame.events.some(e=>e.type==='drain')){drainTick=tick;break;}}
 assert(drainTick>1);const ready=match.readFrame().balls[0]!;assert.equal(ready.active,false);assert.equal(ready.stationId,null);assert.equal(ready.x,home.launchX);assert.equal(ready.y,home.launchY);
 const saved=match.snapshot(),restored=createArenaMatch(world,options);restored.restore(saved);
 const launched=match.step([{ownerId:0,bits:4}]);assert(launched.events.some(e=>e.type==='launch'&&e.colliderId==='home'));assert.equal(launched.balls[0]!.stationId,null);assert(launched.balls[0]!.x>home.launchX);
 assert.deepEqual(restored.step([{ownerId:0,bits:4}]),launched);assert.deepEqual(restored.snapshot(),match.snapshot());assert(ARENA_AUTHORITY_REVISION.endsWith('.14'));
});
test('a legal active camper blocks repeated ready launches without displacement',()=>{
 const camper={...home,id:'camper',ownerId:1,teamId:1,x:600,y:200,launchVx:0},world=worldFrom([field({stations:[home,camper]})]),match=createArenaMatch(world,{players:[player(0),player(1)],mode:'expedition',maxTicks:600});
 match.step([{ownerId:1,bits:4}]);for(let tick=2;tick<=60;tick++){const frame=match.step([{ownerId:0,bits:tick%2===0?4:0}]);assert(!frame.events.some(e=>e.type==='launch'&&e.ownerId===0));assert.equal(frame.balls[0]!.active,false);assert.equal(frame.balls[0]!.x,600);assert.equal(frame.balls[1]!.x,600);assert.equal(frame.balls[1]!.active,true);assert.equal(match.getStats().contactBudget,0);}
 const twin=createArenaMatch(world,{players:[player(0),player(1)],mode:'expedition',maxTicks:600});twin.restore(match.snapshot());assert.deepEqual(twin.snapshot(),match.snapshot());
});
test('the home plunger never takes an occupied catch bank from another owner',()=>{
 const camper={...home,id:'camper',ownerId:1,teamId:1,x:1500,y:900,launchX:150,launchY:200,launchVx:0},world=worldFrom([field({stations:[home,camper],hazards:[drain]})]),match=createArenaMatch(world,{players:[player(0),player(1)],mode:'expedition',maxTicks:600});
 for(let tick=1;tick<=45;tick++)match.step([0,1].map(ownerId=>({ownerId,bits:tick===1?4:0})));
 assert.equal(match.readFrame().stations.find(s=>s.id==='home')!.ownerId,1);
 const frame=match.step([{ownerId:0,bits:4}]);assert(frame.events.some(e=>e.type==='launch'&&e.ownerId===0));assert.equal(frame.stations.find(s=>s.id==='home')!.ownerId,1);assert.equal(frame.balls[0]!.stationId,null);
});
test('raised ready bodies have their admitted native elevation before any launch',()=>{
 const raised={...home,layer:1,elevation:120},world=worldFrom([field({stations:[raised],surfaces:[{id:'raised-support',kind:'bridge',polygon:[{x:64,y:64},{x:1200,y:64},{x:1200,y:600},{x:64,y:600}],layer:1,height:120,material:'steel',biome:field().regions[0]!.biome}]})]),match=createArenaMatch(world,{players:[player()],mode:'expedition',maxTicks:600});
 assert.equal(match.readFrame().balls[0]!.elevation,120);const saved=match.snapshot(),twin=createArenaMatch(world,{players:[player()],mode:'expedition',maxTicks:600});twin.restore(saved);assert.deepEqual(twin.snapshot(),saved);const frame=match.step([{ownerId:0,bits:4}]);assert.equal(frame.balls[0]!.elevation,120);assert(frame.events.some(e=>e.type==='launch'));assert(!frame.events.some(e=>e.type==='fall'));
});
