import test from 'node:test';
import assert from 'node:assert/strict';
import {createArenaMatch,ArenaInput} from '@keel-engine/pinball-arena';
import {captureWorld} from '../../pinball-arena/test/capture-fixtures.ts';
import {pairedFlipperWorld,shotRouteWorld,player,worldFrom} from '../../pinball-arena/test/fixtures.ts';
import {createPinballFeedback,pinballFeedbackMix,type PinballFeedbackSound} from '../src/index.ts';

test('actual mechanical actions produce deterministic bounded feedback and duplicate frames remain silent',()=>{
 const world=captureWorld(),players=[player()],match=createArenaMatch(world,{players,mode:'expedition',maxTicks:1000}),one=createPinballFeedback(world,{maxParticles:8,maxPulses:4}),two=createPinballFeedback(world,{maxParticles:8,maxPulses:4}),names=new Set<string>(),phases=new Set<string>();
 one.update(match.readFrame());two.update(match.readFrame());
 for(let tick=1;tick<=90;tick++){
  const frame=match.step([{ownerId:0,bits:tick===1?ArenaInput.LAUNCH:0}]),snapshot=match.snapshot(),sounds=one.update(frame);assert.deepEqual(two.update(frame),sounds);sounds.forEach(s=>names.add(s.name));
  assert.deepEqual(one.sample(frame.tick,.5),two.sample(frame.tick,.5));assert.deepEqual(one.update(frame),[]);
  const sample=one.sample(frame.tick,.5),mechanism=sample.mechanisms.find(m=>m.id==='transport')!;if(mechanism.transportPhase)phases.add(mechanism.transportPhase);
  assert(sample.particles.length<=8&&sample.pulses.length<=4);assert(sample.mechanisms.every(m=>[m.recoil,m.pulse,m.charge,m.transportProgress].every(n=>Number.isFinite(n)&&n>=0&&n<=1)));assert(sample.particles.every(p=>[p.x,p.y,p.elevation,p.size,p.alpha].every(Number.isFinite)&&p.alpha>=0&&p.alpha<=1));assert.deepEqual(match.snapshot(),snapshot);
 }
 assert(names.has('spring.release')&&names.has('lock.capture')&&names.has('lock.release'));assert(phases.has('captured')&&phases.has('transit'));assert(one.stats.droppedParticles>0);
 one.reset();assert.throws(()=>one.sample());one.update(match.readFrame());assert(one.sample().mechanisms.length>0);
});
test('real flipper motion cues follow authority blades and reduced motion retains lights without particles or recoil',()=>{
 const world=pairedFlipperWorld(),match=createArenaMatch(world,{players:[player()],mode:'expedition',maxTicks:1000}),feedback=createPinballFeedback(world,{reducedMotion:true}),names=new Set<string>();feedback.update(match.readFrame());
 for(let tick=1;tick<=60;tick++){
  const frame=match.step([{ownerId:0,bits:tick===1?ArenaInput.LAUNCH:tick<20?ArenaInput.LEFT:0}]);feedback.update(frame).forEach(s=>names.add(s.name));const sample=feedback.sample();assert.equal(sample.particles.length,0);assert(sample.mechanisms.every(m=>m.recoil===0));
 }
 assert(names.has('flipper.up')&&names.has('flipper.down'));assert.throws(()=>feedback.update({...match.readFrame(),tick:0}));assert.throws(()=>feedback.sample(match.readFrame().tick,1));assert.throws(()=>createPinballFeedback(world,{maxParticles:2049}));
});

test('duplicate delivery preserves the moving-blade direction for the following tick',()=>{
 const world=pairedFlipperWorld(),match=createArenaMatch(world,{players:[player()],mode:'expedition',maxTicks:1000}),ordinary=createPinballFeedback(world),duplicated=createPinballFeedback(world);ordinary.update(match.readFrame());duplicated.update(match.readFrame());
 for(let tick=1;tick<=60;tick++){
  const frame=match.step([{ownerId:0,bits:tick===1?ArenaInput.LAUNCH:tick<20?ArenaInput.LEFT:0}]);assert.deepEqual(duplicated.update(frame),ordinary.update(frame));assert.deepEqual(duplicated.update(frame),[]);assert.deepEqual(duplicated.sample(),ordinary.sample());
 }
});

test('actual ramp entry and raised exit cue the native ball position and height, with bounded repeat-safe particles',()=>{
 const world=shotRouteWorld(),match=createArenaMatch(world,{players:[player()],mode:'expedition',maxTicks:1000}),feedback=createPinballFeedback(world,{maxParticles:16,maxPulses:4});feedback.update(match.readFrame());let enter=false,exit=false;
 for(let tick=1;tick<=90;tick++){
  const frame=match.step([{ownerId:0,bits:tick===1?ArenaInput.LAUNCH:0}]),before=match.snapshot(),sounds=feedback.update(frame);
  for(const event of frame.events.filter(e=>e.type==='ramp-enter'||e.type==='ramp-exit')){
   const body=frame.balls[0]!,sound=sounds.find(s=>s.id===event.id)!;assert(sound);assert.equal(sound.x,body.x);assert.equal(sound.y,body.y);assert.equal(sound.layer,body.layer);assert.equal(sound.elevation,body.elevation);
   const sample=feedback.sample(),pulse=sample.pulses.find(p=>p.id===event.id)!;assert(pulse);assert.equal(pulse.elevation,body.elevation);assert.equal(pulse.x,body.x);assert(sample.particles.some(p=>p.id.startsWith(event.id+':')));assert(pulse.radius<8);
   enter||=event.type==='ramp-enter';exit||=event.type==='ramp-exit';if(event.type==='ramp-exit')assert.equal(sound.elevation,100);
   assert.deepEqual(feedback.update(frame),[]);assert.deepEqual(match.snapshot(),before);
  }
 }
 assert(enter&&exit);
});

test('a native same-tick portal cannot move the ramp exit cue to its destination, even over the same ramp',()=>{
 const base=shotRouteWorld().arenas[0]!,world=worldFrom([{...base,portals:[{id:'raised-mouth',x:666,y:200,radius:24,layer:1,elevation:100,angle:0,targetArenaId:base.id,targetPortalId:'over-ramp'},{id:'over-ramp',x:500,y:230,radius:24,layer:1,elevation:100,angle:180,targetArenaId:base.id,targetPortalId:'raised-mouth'}]}]),match=createArenaMatch(world,{players:[player()],mode:'expedition',maxTicks:1000}),feedback=createPinballFeedback(world);feedback.update(match.readFrame());let proven=false;
 for(let tick=1;tick<=90;tick++){
  const frame=match.step([{ownerId:0,bits:tick===1?ArenaInput.LAUNCH:0}]),before=match.snapshot(),sounds=feedback.update(frame),exit=frame.events.find(e=>e.type==='ramp-exit'),portal=frame.events.find(e=>e.type==='portal');
  if(exit&&portal){const sound=sounds.find(s=>s.id===exit.id)!;assert(sound);assert.equal(frame.balls[0]!.x,500);assert.equal(frame.balls[0]!.y,230);assert.equal(sound.x,650);assert.equal(sound.y,200);assert.equal(sound.elevation,100);assert.equal(sound.layer,1);assert.equal(feedback.sample().pulses.find(p=>p.id===exit.id)!.x,650);assert.deepEqual(match.snapshot(),before);proven=true;break;}
 }
 assert(proven,'actual native ramp exit and portal must occur in one tick');
});

test('a native ramp exit immediately captured into transport keeps its cue at the raised endpoint',()=>{
 const base=shotRouteWorld().arenas[0]!,capture=captureWorld().arenas[0]!,ports=capture.pinball!.ports.map(p=>({...p,x:p.id==='mouth'?654:p.x,layer:1,elevation:100,surfaceIds:['raised-floor']})),world=worldFrom([{...base,gates:[...base.gates,{...capture.gates[0]!,ax:654,bx:654,layer:1,elevation:100}],pinball:{paths:[],ports},captures:capture.captures!,surfaces:[{...capture.surfaces[0]!,id:'raised-floor',layer:1,height:100}]}]),match=createArenaMatch(world,{players:[player()],mode:'expedition',maxTicks:1000}),feedback=createPinballFeedback(world);feedback.update(match.readFrame());let proven=false;
 for(let tick=1;tick<=90;tick++){
  const frame=match.step([{ownerId:0,bits:tick===1?ArenaInput.LAUNCH:0}]),sounds=feedback.update(frame),exit=frame.events.find(e=>e.type==='ramp-exit'),capture=frame.events.find(e=>e.type==='capture-enter');
  if(exit&&capture){const sound=sounds.find(s=>s.id===exit.id)!;assert(sound);assert(frame.balls[0]!.transport);assert.equal(sound.x,650);assert.equal(sound.elevation,100);assert.equal(sound.layer,1);proven=true;break;}
 }
 assert(proven,'actual native ramp exit and capture must occur in one tick');
});

test('deferred ramp delivery needs explicit geometry rather than a same-plan body on an unrelated floor',()=>{
 const world=shotRouteWorld(),match=createArenaMatch(world,{players:[player()],mode:'expedition',maxTicks:1000});for(let tick=1;tick<=90;tick++)match.step([{ownerId:0,bits:tick===1?ArenaInput.LAUNCH:0}]);
 const frame=match.readFrame(),body={...frame.balls[0]!,x:500,y:200,layer:3,elevation:400,rampId:null},event={id:'deferred-exit',tick:90,type:'ramp-exit' as const,ownerId:0,arenaId:'field',colliderId:'shot-ramp'};
 for(const explicit of [false,true]){
  const feedback=createPinballFeedback(world);feedback.update({...frame,tick:0,mechanisms:frame.mechanisms.map(m=>({...m,activationTick:0,activationSerial:0})),events:[]});
  const sounds=feedback.update({...frame,balls:[body],events:[explicit?{...event,x:650,y:200,elevation:100}:event]});
  if(explicit){assert.equal(sounds[0]!.x,650);assert.equal(sounds[0]!.layer,1);assert.equal(sounds[0]!.elevation,100);}else{assert.deepEqual(sounds,[]);assert.equal(feedback.sample().pulses.length,0);}
 }
});

test('native transport travel, blocked exit and fallback/terminal outcomes cue their actual event once',()=>{
 for(const outcome of ['clear','fallback','terminal'] as const){
  const base=captureWorld(outcome!=='clear').arenas[0]!,world=worldFrom([{...base,stations:outcome==='fallback'?base.stations.filter(s=>s.ownerId!==2):base.stations}]);
  const players=outcome==='clear'?[player()]:outcome==='fallback'?[player(),player(1)]:[player(),player(1),player(2)];
  const match=createArenaMatch(world,{players,mode:'expedition',maxTicks:1000}),feedback=createPinballFeedback(world,{maxParticles:16,maxPulses:8}),copy=createPinballFeedback(world,{maxParticles:16,maxPulses:8});
  feedback.update(match.readFrame());copy.update(match.readFrame());const observed=new Set<string>();
  for(let tick=1;tick<=100;tick++){
   const frame=match.step(players.map(p=>({ownerId:p.ownerId,bits:tick===1?ArenaInput.LAUNCH:0}))),before=match.snapshot(),sounds=feedback.update(frame);assert.deepEqual(copy.update(frame),sounds);
   for(const event of frame.events.filter(e=>['transit-start','exit-blocked','capture-release','drain'].includes(e.type)&&e.mechanismId==='transport')){
    observed.add(event.type);const sound=sounds.find(s=>s.id===event.id)!;assert(sound,outcome+' '+event.type+' cue');
    assert.equal(sound.name,event.type==='transit-start'?'capture.travel':event.type==='exit-blocked'?'capture.blocked':event.type==='capture-release'?'lock.release':'drain');
    assert.equal(sound.ownerId,event.ownerId);assert.equal(sound.arenaId,event.arenaId);assert.equal(sound.x,event.x);assert.equal(sound.y,event.y);assert.equal(sound.layer,event.layer);assert.equal(sound.elevation,event.elevation);
    assert(feedback.sample().pulses.some(p=>p.id===event.id));
    if(event.type==='capture-release')assert.equal(event.exitPortId,outcome==='fallback'?'fallback':'exit');
   }
   assert.deepEqual(feedback.update(frame),[]);assert.deepEqual(feedback.sample(),copy.sample());assert.deepEqual(match.snapshot(),before);
  }
  assert(observed.has('transit-start'));assert.equal(observed.has('exit-blocked'),outcome!=='clear');assert.equal(observed.has('capture-release'),outcome!=='terminal');assert.equal(observed.has('drain'),outcome==='terminal');
  feedback.reset();assert.deepEqual(feedback.update(match.readFrame()),[],'seek must not replay historic transport sounds');
 }
});

test('owned feedback survives arena transfer while ambient mixing follows native 3D distance',()=>{
 const match=createArenaMatch(captureWorld(),{players:[player()],mode:'expedition'}),focus=match.readFrame().balls[0]!;
 const cue:PinballFeedbackSound={id:'mix-vector',name:'capture.travel',gain:.5,priority:2,ownerId:0,arenaId:'prior-arena',x:400,y:200,layer:0,elevation:0};
 const owned=pinballFeedbackMix(cue,focus,0)!;assert.deepEqual(owned,{gain:.375,pan:0,priority:6,owned:true});assert.equal(pinballFeedbackMix({...cue,ownerId:1},focus,0),null);
 const near={...cue,arenaId:focus.arenaId,ownerId:1,x:focus.x,y:focus.y},nearMix=pinballFeedbackMix(near,focus,0)!,raisedMix=pinballFeedbackMix({...near,layer:1,elevation:400},focus,0)!;
 assert(raisedMix.gain<nearMix.gain);assert.equal(nearMix.priority,2);assert.equal(nearMix.owned,false);assert.equal(pinballFeedbackMix({...near,x:focus.x+1400},focus,0),null);
 assert.equal(pinballFeedbackMix({...near,x:focus.x+1000},focus,0)!.pan,.8);assert.equal(pinballFeedbackMix({...near,x:focus.x-1000},focus,0)!.pan,-.8);
 assert.equal(pinballFeedbackMix({...near,ownerId:0,priority:7,gain:0},focus,0),null);assert.equal(pinballFeedbackMix({...near,ownerId:0,priority:7},focus,0)!.priority,8);
});
