import test from 'node:test';
import assert from 'node:assert/strict';
import {createArenaMatch,ArenaInput,ARENA_AUTHORITY_REVISION} from '@keel-engine/pinball-arena';
import {sha256,toHex} from '@keel-engine/codec/hash';
import {pairedFlipperWorld,player,field,worldFrom} from '../../pinball-arena/test/fixtures.ts';
import {createArenaFrameCodec} from '../../pinball-room/src/frame-codec.ts';
import {captureWorld} from '../../pinball-arena/test/capture-fixtures.ts';
import {createArenaReplayRecorder,createArenaReplayPlayer,encodeArenaReplay,decodeArenaReplay} from '../src/index.ts';
const digest=(bytes:Uint8Array)=>toHex(sha256(bytes));
const rules={mode:'expedition' as const,maxTicks:1000};
function fixture(){const match=createArenaMatch(pairedFlipperWorld(),{...rules,players:[player()]});return {match,record:createArenaReplayRecorder(match,rules)};}
test('portable replay restores exact input, admitted command, contact and final snapshot state',()=>{
 const {match,record}=fixture();
 for(let tick=0;tick<100;tick++)record.step([{ownerId:0,bits:tick===0?ArenaInput.LAUNCH:tick===10?ArenaInput.PULSE:tick%20<10?ArenaInput.LEFT:ArenaInput.RIGHT,steerX:.333,steerY:-.137}],tick===40?[{id:'reward:40',ownerId:0,type:'energy',amount:10}]:[]);
 const tape=record.exportTape(),bytes=encodeArenaReplay(tape),decoded=decodeArenaReplay(bytes),live=digest(match.snapshot()),playback=createArenaReplayPlayer(decoded);
 assert.equal(playback.index,0);assert.equal(playback.complete,false);assert.equal(decoded.commands.length,1);
 while(!playback.complete)playback.step();
 assert.equal(digest(playback.snapshot()),live);assert.equal(digest(match.snapshot()),live);assert.equal(playback.index,100);
 assert.equal(digest(playback.snapshot()),decoded.finalDigest);assert.deepEqual(encodeArenaReplay(decoded),bytes);
});
test('rolling segments preserve their own exact baseline and invalid steps are atomic',()=>{
 const match=createArenaMatch(pairedFlipperWorld(),{...rules,players:[player()]}),record=createArenaReplayRecorder(match,rules,3);
 for(let tick=0;tick<5;tick++)record.step([{ownerId:0,bits:tick===0?ArenaInput.LAUNCH:ArenaInput.LEFT}]);
 const tape=record.exportTape();assert.equal(tape.recentSegment,true);assert.equal(tape.startTick,3);assert.equal(tape.ticks,2);
 const before=digest(match.snapshot());assert.throws(()=>record.step([{ownerId:9,bits:0}]));assert.throws(()=>record.step([],[{id:'invalid',ownerId:0,type:'impulse',vx:100,vy:0}]));assert.equal(record.ticks,2);assert.equal(digest(match.snapshot()),before);
 const playback=createArenaReplayPlayer(tape);while(!playback.complete)playback.step();assert.equal(digest(playback.snapshot()),before);
});
test('foreign authority, mismatched rules, corrupted bytes and dishonest outcomes fail',()=>{
 const {match,record}=fixture();record.step([{ownerId:0,bits:ArenaInput.LAUNCH}]);const tape=record.exportTape(),bytes=encodeArenaReplay(tape);
 for(const length of [0,15,47,bytes.length-1])assert.throws(()=>decodeArenaReplay(bytes.subarray(0,length)));
 const corrupt=bytes.slice();corrupt[100]=corrupt[100]!^1;assert.throws(()=>decodeArenaReplay(corrupt),/checksum/);
 assert.throws(()=>createArenaReplayPlayer({...tape,kernel:'0'.repeat(64)}),/authority/);
 assert.throws(()=>createArenaReplayRecorder(match,{...rules,maxTicks:999}),/identity/);
 assert.throws(()=>createArenaReplayPlayer({...tape,options:{...rules,maxTicks:999}}),/identity/);
 assert.throws(()=>createArenaReplayPlayer({...tape,finalDigest:'0'.repeat(64)}).step(),/final snapshot/);
 const poisoned=tape.inputs.slice();poisoned[1]=128;assert.throws(()=>createArenaReplayPlayer({...tape,inputs:poisoned}),/input/);
});

test('capture hold, transit, blocked exit and terminal recovery replay from full and rolling snapshots',()=>{
 for(const camped of [false,true])for(const segment of [200,12]){
  const players=camped?[0,1,2].map(ownerId=>({...player(ownerId),teamId:ownerId})):[player()],match=createArenaMatch(captureWorld(camped),{...rules,players}),record=createArenaReplayRecorder(match,rules,segment),phases=new Set<string>(),events=new Set<string>();
  for(let i=0;i<100;i++){
   const frame=record.step(players.map(p=>({ownerId:p.ownerId,bits:i===0?ArenaInput.LAUNCH:0})));if(frame.balls[0]!.transport)phases.add(frame.balls[0]!.transport!.phase);for(const e of frame.events)events.add(e.type);
   if(i===30||i===50||i===99){
    const tape=decodeArenaReplay(encodeArenaReplay(record.exportTape())),playback=createArenaReplayPlayer(tape),before=digest(match.snapshot());
    while(!playback.complete)playback.step();assert.equal(digest(playback.snapshot()),before);assert.equal(tape.finalDigest,before);assert.equal(digest(match.snapshot()),before);
   }
  }
  assert(phases.has('captured')&&phases.has('transit'));assert.equal(phases.has('exit-blocked'),camped);assert(events.has(camped?'drain':'capture-release'));
 }
});

test('equipment credit and score-pressure causes survive portable replay and public packets under the new authority',()=>{
 const world=worldFrom([field({stations:[field().stations[0]!,{...field().stations[1]!,ownerId:1,teamId:1}]})]),players=[player(0),player(1)],rules={mode:'expedition' as const,defeatPolicy:'eliminate' as const,maxTicks:1200},match=createArenaMatch(world,{...rules,players}),record=createArenaReplayRecorder(match,rules),codec=createArenaFrameCodec(world,players);
 record.step([],[{id:'first',ownerId:1,type:'damage',amount:1,sourceOwnerId:0}]);
 let frame=record.step([],[{id:'equipment',ownerId:1,type:'equipment-damage',amount:1,sourceOwnerId:0},{id:'curve',ownerId:0,type:'score-pressure',amount:1}]);
 assert(frame.events.some(e=>e.type==='damage'&&e.cause==='equipment'&&e.sourceOwnerId===0));assert(frame.events.some(e=>e.type==='damage'&&e.cause==='score-pressure'&&e.sourceOwnerId===undefined));
 const packet=codec.encode(frame),publicFrame=codec.decode(packet);assert.deepEqual(publicFrame.events,frame.events);assert.deepEqual(publicFrame.balls,frame.balls);assert.deepEqual(codec.encode(publicFrame),packet);
 const tape=decodeArenaReplay(encodeArenaReplay(record.exportTape()));assert.equal(tape.authority,ARENA_AUTHORITY_REVISION);assert.equal(tape.commands[1]!.commands[0]!.type,'equipment-damage');assert.equal((tape.commands[1]!.commands[0] as {sourceOwnerId:number}).sourceOwnerId,0);
 const live=match.snapshot(),playback=createArenaReplayPlayer(tape);while(!playback.complete)playback.step();assert.deepEqual(playback.snapshot(),live);assert.deepEqual(match.snapshot(),live);
 assert.throws(()=>createArenaReplayPlayer({...tape,authority:'shared-arena/2026-10-07.13'}),/authority/);assert.deepEqual(match.snapshot(),live);
});
