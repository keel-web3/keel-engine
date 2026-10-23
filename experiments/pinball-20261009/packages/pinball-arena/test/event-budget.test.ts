import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createArenaMatch,arenaEventBudget} from '../src/index.ts';
import {field,worldFrom,player,shotRouteWorld} from './fixtures.ts';
const hazards=(n:number)=>Array.from({length:n},(_,i)=>({id:`hazard.${i}`,kind:'damage' as const,x:174,y:200,radius:12,layer:0,elevation:0,damage:0,cooldownTicks:1}));
test('logical content and accepted roster bounds reject oversized hazard ticks before authority creation',()=>{
 assert.throws(()=>createArenaMatch(worldFrom([field({hazards:hazards(4097)})]),{players:[player()],mode:'expedition'}),/event content capacity/);
 const stations=Array.from({length:100},(_,ownerId)=>({id:`station.${ownerId}`,ownerId,teamId:ownerId,x:174,y:200,launchX:174,launchY:200,launchVx:0,launchVy:0,layer:0,elevation:0,flipperIds:[]})),world=worldFrom([field({hazards:hazards(40),stations})]);
 assert.throws(()=>createArenaMatch(world,{players:Array.from({length:100},(_,i)=>player(i)),mode:'expedition'}),/event budget exceeds/);
 const solo=createArenaMatch(world,{players:[player()],mode:'expedition'});assert(arenaEventBudget(world,1).upperBound<4096);solo.step([{ownerId:0,bits:4}]);const snapshot=solo.snapshot();solo.restore(snapshot);assert.deepEqual(solo.snapshot(),snapshot);
});
test('safe finite overlapping actions are preserved and their own snapshots restore exactly',()=>{
 const world=worldFrom([field({hazards:hazards(200)})]),match=createArenaMatch(world,{players:[player()],mode:'expedition'}),frame=match.step([{ownerId:0,bits:4}]);
 assert.equal(frame.events.filter(e=>e.type==='hazard').length,200);assert(frame.events.length<=arenaEventBudget(world,1).upperBound);const restored=createArenaMatch(world,{players:[player()],mode:'expedition'});restored.restore(match.snapshot());assert.deepEqual(restored.readFrame(),frame);
});
test('restored route completion cannot omit an already earned compound qualification and emit it again',()=>{
 const world=shotRouteWorld(),match=createArenaMatch(world,{players:[player()],mode:'expedition',maxTicks:1200});for(let tick=1;tick<=120;tick++)match.step([{ownerId:0,bits:tick===1?4:0}]);const before=match.snapshot(),d=JSON.parse(new TextDecoder().decode(before));assert.equal(d.qualifications[0].length,1);d.qualifications[0]=[];
 assert.throws(()=>match.restore(new TextEncoder().encode(JSON.stringify(d))),/omitted earned compound/);assert.deepEqual(match.snapshot(),before);
});

test('vacuous and overlapping compound groups cannot bypass physical routes or the event proof',()=>{
 const base=shotRouteWorld().arenas[0]!,requirement=base.requirements![0]!;
 for(const routeGroups of [[],[['raised-shot']], [['raised-shot'],['raised-shot','return-shot']]]){const world=worldFrom([{...base,requirements:[{...requirement,routeGroups}]}]);assert.throws(()=>createArenaMatch(world,{players:[player()],mode:'expedition'}),/compound gate requirement/);}
});
