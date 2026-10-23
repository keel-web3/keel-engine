import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createArenaMatch,arenaMechanismSpecs,ARENA_AUTHORITY_REVISION} from '../src/index.ts';
import {player,worldFrom} from './fixtures.ts';
import {captureWorld} from './capture-fixtures.ts';
test('legal launch enters a real mouth, waits exact ticks, releases and restores all phases',()=>{
 const world=captureWorld(),options={players:[player()],mode:'expedition' as const,maxTicks:1200},match=createArenaMatch(world,options),events=[],snapshots=[];
 for(let tick=1;tick<=80;tick++){const frame=match.step([{ownerId:0,bits:tick===1?4:0}]);events.push(...frame.events);if([22,35,50,58].includes(tick))snapshots.push(match.snapshot());
  assert.equal(frame.schema,'keel-pinball-arena-frame@2');assert.equal(frame.mechanisms.length,arenaMechanismSpecs(world).length);
  if(frame.balls[0]!.transport){assert.equal(frame.balls[0]!.active,false);assert.equal(frame.balls[0]!.x,400);assert.equal(frame.captures[0]!.occupiedBodyId,'core-0');assert.equal(frame.gates[0]!.open,false);}
 }
 const enter=events.find(e=>e.type==='capture-enter')!,transit=events.find(e=>e.type==='transit-start')!,release=events.find(e=>e.type==='capture-release')!;
 assert.equal(transit.tick-enter.tick,12);assert.equal(release.tick-transit.tick,24);assert.equal(release.entryPortId,'mouth');assert.equal(release.exitPortId,'exit');assert.equal(release.bodyId,'core-0');assert.equal(release.x,1100);
 for(const bytes of snapshots){const restored=createArenaMatch(world,options);restored.restore(bytes);assert.deepEqual(restored.snapshot(),bytes);const twin=createArenaMatch(world,options);twin.restore(bytes);for(let i=0;i<30;i++)assert.deepEqual(restored.step([]),twin.step([]));}
 assert(events.some(e=>e.type==='mechanism-actuate'&&e.mechanismId==='home'));assert.equal(ARENA_AUTHORITY_REVISION,'shared-arena/2026-10-08.18');
});
test('legal stationary campers block both exits until an actual bounded drain/recovery',()=>{
 const world=captureWorld(true),match=createArenaMatch(world,{players:[player(0),player(1),player(2)],mode:'expedition',maxTicks:1200}),events=[];
 for(let tick=1;tick<=90;tick++)events.push(...match.step([0,1,2].map(ownerId=>({ownerId,bits:tick===1?4:0}))).events);
 const blocked=events.find(e=>e.type==='exit-blocked')!,drain=events.find(e=>e.type==='drain'&&e.mechanismId==='transport')!;
 assert.equal(drain.tick-blocked.tick,12);assert(!events.some(e=>e.type==='capture-release'));
 const frame=match.readFrame();assert.equal(frame.balls[0]!.transport,null);assert.equal(frame.balls[0]!.active,false);assert.equal(frame.balls[0]!.health,5);assert.equal(frame.captures[0]!.occupiedBodyId,null);
 const twin=createArenaMatch(world,{players:[player(0),player(1),player(2)],mode:'expedition',maxTicks:1200});twin.restore(match.snapshot());assert.deepEqual(twin.readFrame(),frame);
});
test('captured snapshots reject occupancy corruption atomically and recover commands cancel locks',()=>{
 const world=captureWorld(),match=createArenaMatch(world,{players:[player()],mode:'expedition',maxTicks:1200});for(let tick=1;tick<=25;tick++)match.step([{ownerId:0,bits:tick===1?4:0}]);
 const before=match.snapshot(),forged=JSON.parse(new TextDecoder().decode(before));forged.captures.transports[0].state.exitPortId='absent';
 assert.throws(()=>match.restore(new TextEncoder().encode(JSON.stringify(forged))),/capture/);assert.deepEqual(match.snapshot(),before);
 const frame=match.step([],[{id:'recover-once',type:'recover',ownerId:0}]);assert.equal(frame.balls[0]!.transport,null);assert.equal(frame.captures[0]!.occupiedBodyId,null);
});

test('simultaneous real captures reserve a common release disk before body writes',()=>{
 const base=captureWorld().arenas[0]!,mouth={...base.pinball!.ports[0]!,id:'mouth2',y:600},second={...base.captures![0]!,id:'transport2',entryPortId:'mouth2',busyGateIds:['busy2']};
 const world=worldFrom([{...base,stations:[...base.stations,{...base.stations[0]!,id:'home2',ownerId:1,teamId:1,y:600,launchY:600}],pinball:{paths:[],ports:[...base.pinball!.ports,mouth]},gates:[...base.gates,{...base.gates[0]!,id:'busy2',ay:560,by:640}],captures:[...base.captures!,second]}]);
 const match=createArenaMatch(world,{players:[player(0),player(1)],mode:'expedition',maxTicks:1200}),releases=[];
 for(let tick=1;tick<=90;tick++){const frame=match.step([0,1].map(ownerId=>({ownerId,bits:tick===1?4:0})));releases.push(...frame.events.filter(e=>e.type==='capture-release'));const active=frame.balls.filter(b=>b.active);if(active.length===2)assert(Math.hypot(active[0]!.x-active[1]!.x,active[0]!.y-active[1]!.y)>=26);}
 assert.equal(releases.length,2);assert.equal(releases[0]!.ownerId,0);assert(releases[1]!.tick>releases[0]!.tick);
});
test('defeat and match timeout cancel real captured occupancy without a hidden terminal body',()=>{
 const base=captureWorld().arenas[0]!,world=worldFrom([{...base,captures:[{...base.captures![0]!,captureTicks:200}]}]),options={players:[player()],mode:'expedition' as const,defeatPolicy:'eliminate' as const,maxTicks:120};
 const defeated=createArenaMatch(world,options);for(let tick=1;tick<=25;tick++)defeated.step([{ownerId:0,bits:tick===1?4:0}]);
 const frame=defeated.step([],[{id:'defeat',ownerId:0,type:'damage',amount:6}]);assert.equal(frame.balls[0]!.eliminated,true);assert.equal(frame.balls[0]!.transport,null);assert.equal(frame.captures[0]!.occupiedBodyId,null);
 const timed=createArenaMatch(world,options);for(let tick=1;tick<=120;tick++)timed.step([{ownerId:0,bits:tick===1?4:0}]);const end=timed.readFrame();assert.equal(end.phase,'finished');assert.equal(end.balls[0]!.transport,null);assert.equal(end.captures[0]!.occupiedBodyId,null);assert.equal(end.balls[0]!.x,174);
 const restored=createArenaMatch(world,options);restored.restore(timed.snapshot());assert.deepEqual(restored.readFrame(),end);
});
test('battle storm uses declared destination during transit, so a safe mouth grants no immunity',()=>{
 const base=captureWorld().arenas[0]!,ports=base.pinball!.ports.map(p=>p.id==='mouth'?{...p,x:932,y:832}:{...p,x:p.id==='exit'?1700:1600,y:1400}),world=worldFrom([{...base,stations:[{...base.stations[0]!,x:682,y:832,launchX:706,launchY:832},{...base.stations[0]!,id:'other',ownerId:1,teamId:1,x:1000,y:850,launchX:1000,launchY:850,launchVx:0}],gates:[{...base.gates[0]!,ax:932,bx:932,ay:792,by:872}],pinball:{paths:[],ports},captures:[{...base.captures![0]!,travelTicks:240}]}]);
 const match=createArenaMatch(world,{players:[player(0),player(1)],mode:'battle',maxTicks:600,stormDelayTicks:0,stormDurationTicks:120});let frame=match.readFrame();for(let tick=1;tick<=120;tick++)frame=match.step([0,1].map(ownerId=>({ownerId,bits:tick===1?4:0})));
 assert.equal(frame.balls[0]!.transport!.phase,'transit');assert.equal(frame.balls[0]!.health,5);assert(frame.events.some(e=>e.type==='damage'&&e.ownerId===0&&e.cause==='storm'));assert.equal(frame.balls[1]!.health,6);
});

test('a real teammate traversal releases a conditional lock only after authority qualification',()=>{
 const base=captureWorld().arenas[0]!,world=worldFrom([{...base,stations:[...base.stations,{...base.stations[0]!,id:'teammate',ownerId:1,teamId:0,x:600,y:800,launchX:624,launchY:800}],challenges:[{id:'path-a',name:'A',checkpoints:[{x:660,y:800,radius:24,layer:0,elevation:0},{x:720,y:800,radius:24,layer:0,elevation:0}]},{id:'path-b',name:'B',checkpoints:[{x:740,y:800,radius:24,layer:0,elevation:0},{x:800,y:800,radius:24,layer:0,elevation:0}]}],requirements:[{id:'paths',name:'TWO PATHS',routeIds:['path-a','path-b'],gateIds:['busy'],scope:'team',holdTicks:300,persistent:true}],captures:[{...base.captures![0]!,release:{kind:'qualification',id:'paths',maxHoldTicks:120}}]}]);
 const match=createArenaMatch(world,{players:[player(0,0),player(1,0)],mode:'expedition',maxTicks:600}),events=[];
 for(let tick=1;tick<=110;tick++)events.push(...match.step([{ownerId:0,bits:tick===1?4:0},{ownerId:1,bits:tick===50?4:0}]).events);
 const enter=events.find(e=>e.type==='capture-enter')!,unlock=events.find(e=>e.type==='unlock')!,transit=events.find(e=>e.type==='transit-start')!,release=events.find(e=>e.type==='capture-release')!;
 assert(transit.tick>enter.tick+12);assert.equal(transit.tick,unlock.tick);assert.equal(release.tick,transit.tick+24);assert.equal(release.exitPortId,'exit');assert.equal(match.readFrame().qualifications[0]!.qualifiedBy[0],0);
});

test('restore cannot redirect a timer, delay transit, or renew an occupied exit wait',()=>{
 for(const camped of [false,true]){const world=captureWorld(camped),options={players:camped?[player(0),player(1),player(2)]:[player()],mode:'expedition' as const,maxTicks:1200},match=createArenaMatch(world,options);const toTick=camped?62:40;for(let tick=1;tick<=toTick;tick++)match.step(options.players.map(p=>({ownerId:p.ownerId,bits:tick===1?4:0})));
  const before=match.snapshot();const corruptions=camped?[((d:any)=>{d.captures.transports[0].state.phaseTick=toTick;})]:[((d:any)=>{d.captures.transports[0].state.exitPortId='fallback';}),((d:any)=>{d.captures.transports[0].state.phaseTick++;d.captures.transports[0].state.plannedReleaseTick++;})];
  for(const corrupt of corruptions){const d=JSON.parse(new TextDecoder().decode(before));corrupt(d);assert.throws(()=>match.restore(new TextEncoder().encode(JSON.stringify(d))),/capture transit/);assert.deepEqual(match.snapshot(),before);}
 }
});

test('restore cannot turn an unqualified held lock into earned primary transit',()=>{
 const base=captureWorld().arenas[0]!,world=worldFrom([{...base,challenges:[{id:'a',name:'A',checkpoints:[{x:800,y:1200,radius:24,layer:0,elevation:0},{x:850,y:1200,radius:24,layer:0,elevation:0}]},{id:'b',name:'B',checkpoints:[{x:900,y:1200,radius:24,layer:0,elevation:0},{x:950,y:1200,radius:24,layer:0,elevation:0}]}],requirements:[{id:'q',name:'Q',routeIds:['a','b'],scope:'owner',gateIds:['busy'],holdTicks:120,persistent:true}],captures:[{...base.captures![0]!,release:{kind:'qualification',id:'q',maxHoldTicks:120}}]}]);
 const match=createArenaMatch(world,{players:[player()],mode:'expedition',maxTicks:600});for(let tick=1;tick<=40;tick++)match.step([{ownerId:0,bits:tick===1?4:0}]);const before=match.snapshot(),d=JSON.parse(new TextDecoder().decode(before)),s=d.captures.transports[0].state;s.phase='transit';s.phaseTick=s.entryTick+12;s.plannedReleaseTick=s.phaseTick+24;
 assert.throws(()=>match.restore(new TextEncoder().encode(JSON.stringify(d))),/capture transit/);assert.deepEqual(match.snapshot(),before);
});
