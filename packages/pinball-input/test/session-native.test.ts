import test from 'node:test';
import assert from 'node:assert/strict';
import {createPinballSession,createSessionReplayRecorder,createSessionReplayPlayer,encodeSessionReplay,decodeSessionReplay,type PinballSessionFrame} from '@keel-engine/pinball-session';
import {createPinballSessionInput} from '../src/index.ts';
import {field,worldFrom,player} from '../../pinball-arena/test/fixtures.ts';

test('medicine device input heals actual native damage and remains exact in a separate rules replay',()=>{
 const world=worldFrom([field({hazards:[{id:'damage-zone',kind:'damage',x:225,y:200,radius:30,layer:0,elevation:0,damage:2,cooldownTicks:120}]})]),options={players:[player()],maxTicks:300},rules={mode:'roguelike-solo' as const,loadouts:[{ownerId:0,weapon:null,passive:null,medkits:2}]};
 const session=createPinballSession(world,rules,options),journal=createSessionReplayRecorder(session,{world,rules,options}),device=createPinballSessionInput({ownerId:0}),frames:PinballSessionFrame[]=[];
 device.key('Space',true);device.key('Space',false);let damaged=false,pressed=false,medicineEvents=0;
 for(let tick=1;tick<=24;tick++){
  if(damaged&&!pressed){device.key('KeyR',true);device.key('KeyR',false);pressed=true;}
  const sampled=device.sample();if(sampled.actions)assert.equal(sampled.bits,0,'A medicine action must not launch');
  const frame=journal.step([sampled]);frames.push(frame);if(frame.arena.balls[0]!.health<6)damaged=true;medicineEvents+=frame.events.filter(e=>e.type==='medkit').length;
 }
 assert(damaged,'Fixture must inflict real native HP damage');assert(pressed);assert.equal(medicineEvents,1);assert.equal(frames.at(-1)!.arena.balls[0]!.health,6);assert.equal(frames.at(-1)!.inventories[0]!.medkits,1);assert.equal(frames.flatMap(f=>f.arena.events).filter(e=>e.type==='launch').length,1);
 const before=session.snapshot(),tape=decodeSessionReplay(encodeSessionReplay(journal.exportTape())),replay=createSessionReplayPlayer(tape);
 for(const frame of frames)assert.deepEqual(replay.step(),frame);assert.deepEqual(replay.snapshot(),before);assert.deepEqual(session.snapshot(),before);
});
