import test from 'node:test';
import assert from 'node:assert/strict';
import {createArenaWorld} from '@keel-engine/pinball-arena-gen';
import {createArenaMatch,createArenaRoster,createArenaBotController,ArenaInput} from '@keel-engine/pinball-arena';
import {createArenaFrameCodec,createArenaFrameStreamEncoder,createArenaFrameStreamDecoder,parseRoomMessage,PINBALL_ROOM_VERSION} from '../src/index.ts';
import {shotRouteWorld,worldFrom,player} from '../../pinball-arena/test/fixtures.ts';
import {captureWorld} from '../../pinball-arena/test/capture-fixtures.ts';

test('compact public frames preserve accepted bodies, ownership, mechanisms and compound progress',()=>{
 const world=createArenaWorld('0x2026',{players:5,teamSize:5,arenas:1,detail:'low'}),players=createArenaRoster({players:5,teamSize:5}),match=createArenaMatch(world,{players,mode:'expedition'}),codec=createArenaFrameCodec(world,players),bots=players.map(p=>createArenaBotController(world,p.ownerId));let original=match.readFrame();
 for(let tick=0;tick<300;tick++){
  original=match.step(bots.map(bot=>({...bot.input(original),bits:tick===0?ArenaInput.LAUNCH:bot.input(original).bits})));
  const packet=codec.encode(original),decoded=codec.decode(packet);
  assert.deepEqual(decoded.balls,original.balls);assert.deepEqual(decoded.flippers,original.flippers);assert.deepEqual(decoded.gates,original.gates);assert.deepEqual(decoded.stations,original.stations);assert.deepEqual(decoded.routeProgress,original.routeProgress);assert.deepEqual(decoded.qualifications,original.qualifications);assert.deepEqual(decoded.events,original.events);assert.deepEqual(decoded.teams,original.teams);assert.equal(decoded.finishReason,original.finishReason);assert.equal(decoded.tick,original.tick);assert(Math.abs(decoded.storm.radius-original.storm.radius)<=1/1024);assert(packet.length<20000);
 }
});
test('foreign identity, corruption and truncated public packets fail closed',()=>{
 const world=createArenaWorld('0x1111',{players:2,arenas:1,detail:'low'}),players=createArenaRoster({players:2,teamSize:1}),match=createArenaMatch(world,{players}),codec=createArenaFrameCodec(world,players),packet=codec.encode(match.readFrame());
 for(const length of [0,4,50,packet.length-1])assert.throws(()=>codec.decode(packet.subarray(0,length)));
 const corrupt=packet.slice();corrupt[100]=corrupt[100]!^1;assert.throws(()=>codec.decode(corrupt));
 const other=createArenaFrameCodec(createArenaWorld('0x2222',{players:2,arenas:1,detail:'low'}),players);assert.throws(()=>other.decode(packet));
 const renamed=createArenaFrameCodec(world,players.map(p=>({...p,name:p.name+' changed'})));assert.throws(()=>renamed.decode(packet));
 assert.throws(()=>codec.encode({...match.readFrame(),balls:match.readFrame().balls.slice(1)}));
 const deadWithHealth={...match.readFrame(),balls:match.readFrame().balls.map((b,i)=>i===0?{...b,eliminated:true}:b)};assert.throws(()=>codec.decode(codec.encode(deadWithHealth)));
});
test('room input admits bounded buttons and rejects owner, position and privilege claims',()=>{
 assert.deepEqual(parseRoomMessage(JSON.stringify({type:'input',seq:1,held:3,edges:12,x:-127,y:127})),{type:'input',seq:1,held:3,edges:12,x:-127,y:127});
 assert.equal(parseRoomMessage(JSON.stringify({type:'hello',protocol:PINBALL_ROOM_VERSION,name:'Player'})).type,'hello');
 for(const message of [{type:'input',seq:1,held:0,edges:0,x:0,y:0,ownerId:99},{type:'input',seq:1,held:0,edges:0,x:0,y:0,position:[1,2]},{type:'input',seq:1,held:0,edges:64,x:0,y:0},{type:'input',seq:1,held:4,edges:0,x:0,y:0},{type:'input',seq:1,held:0,edges:0,x:128,y:0},{type:'command',ownerId:0,health:100},{type:'hello',protocol:PINBALL_ROOM_VERSION,name:'Player',resume:'fake'}])assert.throws(()=>parseRoomMessage(JSON.stringify(message)));
});
test('delta stream preserves exact frames and rejects a lost or corrupted baseline atomically',()=>{
 const world=createArenaWorld('0x2026',{players:5,arenas:1,detail:'low'}),players=createArenaRoster({players:5,teamSize:1}),match=createArenaMatch(world,{players,mode:'expedition'}),codec=createArenaFrameCodec(world,players),encoder=createArenaFrameStreamEncoder(codec),decoder=createArenaFrameStreamDecoder(codec);let fullBytes=0,deltaBytes=0;
 for(let tick=0;tick<150;tick++){const frame=match.step(players.map(p=>({ownerId:p.ownerId,bits:tick===0?4:tick%20<10?1:2}))),encoded=encoder.encode(frame);assert.deepEqual(decoder.decode(encoded.packet),codec.decode(encoded.full));fullBytes+=encoded.full.length;deltaBytes+=encoded.packet.length;
  if(tick===10){const corrupt=encoded.packet.slice();corrupt[15]=corrupt[15]!^1;assert.throws(()=>decoder.decode(corrupt));}
 }
 assert(deltaBytes<fullBytes*.8);const packet=encoder.encode(match.step()).packet;assert.throws(()=>createArenaFrameStreamDecoder(codec).decode(packet));
});

test('a legally earned alternative-route qualification decodes from the host own packet',()=>{
 const base=shotRouteWorld().arenas[0]!;
 const world=worldFrom([{...base,challenges:[...base.challenges!,{id:'alternate-left',name:'ALTERNATE LEFT',checkpoints:[{x:1600,y:1300,radius:40,layer:0,elevation:0},{x:1600,y:1400,radius:40,layer:0,elevation:0}]},{id:'alternate-right',name:'ALTERNATE RIGHT',checkpoints:[{x:1500,y:1300,radius:40,layer:0,elevation:0},{x:1500,y:1400,radius:40,layer:0,elevation:0}]}],requirements:[{...base.requirements![0]!,routeIds:['alternate-left','raised-shot','alternate-right','return-shot'],routeGroups:[['alternate-left','raised-shot'],['alternate-right','return-shot']]}]}]);
 const players=[player()],match=createArenaMatch(world,{players,mode:'expedition'}),codec=createArenaFrameCodec(world,players);let frame=match.step([{ownerId:0,bits:ArenaInput.LAUNCH}]);
 for(let tick=0;tick<180&&frame.balls[0]!.active;tick++)frame=match.step([{ownerId:0,bits:tick%24<12?ArenaInput.LEFT:ArenaInput.RIGHT}]);
 assert.deepEqual(frame.routeProgress.filter(p=>p.completed).map(p=>p.routeId),['raised-shot','return-shot']);assert.deepEqual(frame.qualifications[0]!.qualifiedBy,[0]);
 assert.deepEqual(codec.decode(codec.encode(frame)).qualifications,frame.qualifications);
 assert.throws(()=>codec.decode(codec.encode({...frame,qualifications:frame.qualifications.map(q=>({...q,qualifiedBy:[]}))})),/qualification/);
});

test('actual capture, transit, blocked exit and drain frames round trip with their mechanism state',()=>{
 for(const camped of [false,true]){
  const world=captureWorld(camped),players=camped?[0,1,2].map(ownerId=>({...player(ownerId),teamId:ownerId})):[player()],match=createArenaMatch(world,{players,mode:'expedition',maxTicks:1000}),codec=createArenaFrameCodec(world,players),encoder=createArenaFrameStreamEncoder(codec),decoder=createArenaFrameStreamDecoder(codec),phases=new Set<string>(),actions=new Set<string>();
  let captured:ReturnType<typeof match.readFrame>|undefined,transit:ReturnType<typeof match.readFrame>|undefined,blocked:ReturnType<typeof match.readFrame>|undefined;
  for(let i=0;i<100;i++){
   const frame=match.step(players.map(p=>({ownerId:p.ownerId,bits:i===0?ArenaInput.LAUNCH:0})));
   const direct=codec.decode(codec.encode(frame)),encoded=encoder.encode(frame);assert.deepEqual(decoder.decode(encoded.packet),direct);
   assert.deepEqual(direct.balls,frame.balls);assert.deepEqual(direct.captures,frame.captures);assert.deepEqual(direct.mechanisms,frame.mechanisms);assert.deepEqual(direct.events,frame.events);
   const transport=frame.balls[0]!.transport;if(transport){phases.add(transport.phase);if(transport.phase==='captured')captured=structuredClone(frame);if(transport.phase==='transit')transit=structuredClone(frame);if(transport.phase==='exit-blocked')blocked=structuredClone(frame);}
   for(const e of frame.events)actions.add(e.type);
  }
  assert(phases.has('captured')&&phases.has('transit'));assert(actions.has('capture-enter')&&actions.has('transit-start'));
  assert(actions.has(camped?'drain':'capture-release'));assert.equal(phases.has('exit-blocked'),camped);assert(captured);
  const badFrames=[
   {...captured,balls:captured.balls.map((b,i)=>i===0?{...b,x:b.x+1}:b)},
   {...captured,balls:captured.balls.map((b,i)=>i===0?{...b,transport:{...b.transport!,phaseTick:b.transport!.phaseTick+1}}:b)},
   {...captured,captures:captured.captures.map(c=>({...c,enabled:true}))},
   {...captured,captures:captured.captures.map(c=>({...c,occupiedBodyId:null,phase:'idle' as const}))},
   {...captured,events:[{id:'fake',tick:captured.tick,type:'capture-enter' as const,bodyId:'core-0',ownerId:0,mechanismId:'transport',entryPortId:'exit',exitPortId:'exit',arenaId:'field'}]},
   {...captured,events:[{id:'fake',tick:captured.tick,type:'mechanism-actuate' as const,mechanismId:'absent',arenaId:'field'}]},
  ];
  assert(transit);badFrames.push({...transit,balls:transit.balls.map((b,i)=>i===0?{...b,transport:{...b.transport!,exitPortId:'fallback'}}:b)},{...transit,balls:transit.balls.map((b,i)=>i===0?{...b,transport:{...b.transport!,phaseTick:b.transport!.phaseTick+1,plannedReleaseTick:b.transport!.plannedReleaseTick!+1}}:b)});
  if(blocked)badFrames.push({...blocked,balls:blocked.balls.map((b,i)=>i===0?{...b,transport:{...b.transport!,phaseTick:blocked.tick}}:b)});
  for(const bad of badFrames)assert.throws(()=>codec.decode(codec.encode(bad)));
 }
});

test('conditional capture release requires actually earned route qualifications, with deterministic timeout fallback',()=>{
 const base=captureWorld().arenas[0]!,conditional=worldFrom([{...base,challenges:['path','other-path'].map((id,i)=>({id,name:id,checkpoints:[{x:1600,y:1200+i*100,radius:24,layer:0,elevation:0},{x:1700,y:1200+i*100,radius:24,layer:0,elevation:0}]})),requirements:[{id:'unlock',name:'PATH UNLOCK',routeIds:['path','other-path'],gateIds:['busy'],scope:'owner',holdTicks:120,persistent:true}],captures:[{...base.captures![0]!,release:{kind:'qualification',id:'unlock',maxHoldTicks:120}}]}]),players=[player()],match=createArenaMatch(conditional,{players,mode:'expedition',maxTicks:1000}),codec=createArenaFrameCodec(conditional,players);let holding:ReturnType<typeof match.readFrame>|undefined,released=false;
 for(let tick=1;tick<=200;tick++){
  const frame=match.step([{ownerId:0,bits:tick===1?ArenaInput.LAUNCH:0}]);assert.deepEqual(codec.decode(codec.encode(frame)).balls,frame.balls);if(tick===40)holding=structuredClone(frame);for(const e of frame.events)if(e.type==='capture-release'){released=true;assert.equal(e.exitPortId,'fallback');}
 }
 assert(released&&holding&&holding.balls[0]!.transport?.phase==='captured');const t=holding.balls[0]!.transport!,start=t.entryTick+12;
 const forged={...holding,balls:holding.balls.map(b=>({...b,transport:{...t,phase:'transit' as const,phaseTick:start,plannedReleaseTick:start+24}})),captures:holding.captures.map(c=>({...c,phase:'transit' as const}))};
 assert.throws(()=>codec.decode(codec.encode(forged)),/qualification/);
 const team=worldFrom([{...base,stations:[...base.stations,{...base.stations[0]!,id:'teammate',ownerId:1,teamId:0,x:600,y:800,launchX:624,launchY:800}],challenges:[{id:'path-a',name:'A',checkpoints:[{x:660,y:800,radius:24,layer:0,elevation:0},{x:720,y:800,radius:24,layer:0,elevation:0}]},{id:'path-b',name:'B',checkpoints:[{x:740,y:800,radius:24,layer:0,elevation:0},{x:800,y:800,radius:24,layer:0,elevation:0}]}],requirements:[{id:'paths',name:'TWO PATHS',routeIds:['path-a','path-b'],gateIds:['busy'],scope:'team',holdTicks:300,persistent:true}],captures:[{...base.captures![0]!,release:{kind:'qualification',id:'paths',maxHoldTicks:120}}]}]),teamPlayers=[player(0,0),player(1,0)],teamMatch=createArenaMatch(team,{players:teamPlayers,mode:'expedition',maxTicks:600}),teamCodec=createArenaFrameCodec(team,teamPlayers);let teamReleased=false;
 for(let tick=1;tick<=110;tick++){
  const frame=teamMatch.step([{ownerId:0,bits:tick===1?4:0},{ownerId:1,bits:tick===50?4:0}]);assert.deepEqual(teamCodec.decode(teamCodec.encode(frame)).balls,frame.balls);if(frame.events.some(e=>e.type==='capture-release'))teamReleased=true;
 }
 assert(teamReleased);
});
