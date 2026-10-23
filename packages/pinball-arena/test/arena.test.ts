import test from 'node:test';
import assert from 'node:assert/strict';
import {createArenaMatch,ArenaInput,admitArenaInput} from '../src/index.ts';
import {field,player,worldFrom,shotRouteWorld,pairedFlipperWorld} from './fixtures.ts';
test('two accepted owner bodies share physical contacts and attributed damage',()=>{
 const w=worldFrom([field({stations:[{...field().stations[0]!,launchX:200,launchY:200},{...field().stations[0]!,id:'home-1',ownerId:1,teamId:1,x:800,launchX:800,launchY:200,launchVx:-11}]})]);
 const m=createArenaMatch(w,{players:[player(0),player(1)],mode:'expedition'});let f=m.step([{ownerId:0,bits:4},{ownerId:1,bits:4}]);let contact=false;for(let i=0;i<40;i++){f=m.step();contact||=f.events.some(e=>e.type==='ball-contact'&&e.ownerId===0&&e.otherOwnerId===1);}
 assert(contact);assert(f.balls[0]!.vx<0);assert(f.balls[1]!.vx>0);assert(f.balls.every(b=>b.health===5));
});
test('legal launch completes distinct raised/return routes, opens a shared compound gate and arrives at the next bank',()=>{
 const m=createArenaMatch(shotRouteWorld(),{players:[player()],mode:'expedition'});let f=m.step([{ownerId:0,bits:ArenaInput.LAUNCH}]);const events=[...f.events];for(let i=0;i<180&&f.balls[0]!.active;i++){f=m.step([{ownerId:0,bits:i%24<12?1:2}]);events.push(...f.events);assert.equal(m.getStats().contactBudget,0);}
 assert(events.some(e=>e.type==='ramp-enter'));assert(events.some(e=>e.type==='ramp-exit'));assert(!events.some(e=>e.colliderId==='ground-under-ramp'));
 assert.equal(events.filter(e=>e.type==='route-complete').length,2);assert(events.some(e=>e.type==='unlock'));assert(f.gates[0]!.open);assert(events.some(e=>e.type==='station-catch'&&e.colliderId==='next'));assert.equal(f.balls[0]!.stationId,'next');assert.equal(f.balls[0]!.active,false);
});
test('signed steering admission is idempotent and replay matches live input',()=>{
 const w=worldFrom([field()]),a=createArenaMatch(w,{players:[player()],mode:'expedition'}),b=createArenaMatch(w,{players:[player()],mode:'expedition'});
 for(let i=0;i<120;i++){const input={ownerId:0,bits:i===0?4:0,steerX:Math.sin(i*.37),steerY:Math.cos(i*.23)};const admitted=admitArenaInput(input);assert.deepEqual(admitArenaInput(admitted),admitted);a.step([input]);b.step([admitted]);}
 assert.deepEqual(a.snapshot(),b.snapshot());
});
test('invalid command batches and malformed restores reject atomically',()=>{
 const m=createArenaMatch(worldFrom([field()]),{players:[player()],mode:'expedition'});const original=m.snapshot();assert.throws(()=>m.step([],[{id:'one',ownerId:0,type:'shield',amount:5},{id:'bad',ownerId:0,type:'impulse',vx:99,vy:0}]));assert.deepEqual(m.snapshot(),original);
 for(const mutate of [(s:any)=>s.metas[0].damageTick=1e20,(s:any)=>s.metas[0].stationHome='absent',(s:any)=>s.metas[0].score=1e20,(s:any)=>{s.phase='finished';s.winnerTeamId=99;},(s:any)=>s.stations[0]=[99,180]]){const data=JSON.parse(new TextDecoder().decode(original));mutate(data);assert.throws(()=>m.restore(new TextEncoder().encode(JSON.stringify(data))));assert.deepEqual(m.snapshot(),original);}
 m.step([{ownerId:0,bits:4}]);const saved=m.snapshot(),other=createArenaMatch(m.world,{players:m.players,mode:'expedition'});other.restore(saved);for(let i=0;i<40;i++){m.step([{ownerId:0,bits:i%2}]);other.step([{ownerId:0,bits:i%2}]);}assert.deepEqual(m.snapshot(),other.snapshot());
});
test('unlaunched owners forfeit and timeout is a stable tie',()=>{
 const w=worldFrom([field()]),m=createArenaMatch(w,{players:[player()],launchDeadlineTicks:3,maxTicks:120,stormDelayTicks:120});for(let i=0;i<3;i++)m.step();assert.equal(m.readFrame().finishReason,'mutual-elimination');assert.equal(m.readFrame().winnerTeamId,null);
 const timeout=createArenaMatch(w,{players:[player()],mode:'expedition',maxTicks:120,stormDelayTicks:120});for(let i=0;i<120;i++)timeout.step();assert.equal(timeout.readFrame().finishReason,'timeout');const saved=timeout.snapshot();timeout.restore(saved);assert.equal(timeout.step().tick,120);
});

test('different legal flip timings choose different physical shot targets from the same served ball',()=>{
 const run=(timing:number)=>{const m=createArenaMatch(pairedFlipperWorld(),{players:[player()],mode:'expedition'});m.step([{ownerId:0,bits:4}]);const hits:string[]=[],flips:string[]=[];for(let t=1;t<600;t++){const f=m.step([{ownerId:0,bits:t>=timing&&t<timing+14?1:0}]);for(const e of f.events){if(e.type==='bumper')hits.push(e.colliderId!);if(e.type==='flipper')flips.push(e.colliderId!);}assert.equal(m.getStats().contactBudget,0);}return {hits,flips};};
 const early=run(19),late=run(35);assert.equal(early.hits[0],'target-left');assert.equal(late.hits[0],'target-right');assert(early.flips.includes('left')&&late.flips.includes('left'));
});
