import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureCrossing,createCaptureController,type CaptureBinding,type CaptureBodyProbe} from '../src/capture.ts';
import type {ArenaPinballPort} from '../src/types.ts';
const port=(id:string,x:number,y:number,role:ArenaPinballPort['role']):ArenaPinballPort=>({id,mechanismId:'scoop',role,x,y,layer:0,elevation:0,tangent:{x:0,y:1},clearWidth:64,direction:'forward',surfaceIds:[],maxBallRadius:12,admittedSpeed:{min:1,max:18}});
const binding:CaptureBinding={arenaId:'field',entry:port('mouth',100,200,'capture-entry'),exit:port('exit',800,500,'release-exit'),fallback:port('fallback',700,500,'release-exit'),item:{id:'scoop',kind:'tunnel',entryPortId:'mouth',exitArenaId:'field',exitPortId:'exit',fallbackExitPortId:'fallback',approach:{minSpeed:1,maxSpeed:18,minDot:.5},captureTicks:12,travelTicks:3,maxExitWaitTicks:12,exitVelocity:{x:0,y:8},release:{kind:'timer'},busyGateIds:['mouth-gate'],blockedTerminal:'drain'}};
const body=(id='core-0',ownerId=0,y=210,active=true):CaptureBodyProbe=>({id,ownerId,arenaId:'field',x:100,y,vx:0,vy:10,radius:12,layer:0,elevation:0,active,eliminated:false});
const captured=(id='core-0',ownerId=0):CaptureBodyProbe=>({...body(id,ownerId,200,false),vx:0,vy:0});
test('directed swept capture rejects proximity, reverse motion, aperture miss and wrong height',()=>{
 const previous=body('core-0',0,190),current=body();assert.equal(captureCrossing(binding.entry,previous,current,binding.item.approach),32768);
 assert.equal(captureCrossing(binding.entry,body('core-0',0,201),current,binding.item.approach),null);
 assert.equal(captureCrossing(binding.entry,previous,{...current,vy:-10},binding.item.approach),null);
 assert.equal(captureCrossing(binding.entry,{...previous,x:130},{...current,x:130},binding.item.approach),null);
 assert.equal(captureCrossing(binding.entry,{...previous,elevation:40},{...current,elevation:40},binding.item.approach),null);
});
test('contested crossing order is deterministic, and all blocked exits terminate in bounded real drain action',()=>{
 const controller=createCaptureController([binding]),before=new Map([['core-0',body('core-0',0,190)],['core-1',body('core-1',1,190)]]);
 assert.equal(controller.enter(before,[body('core-1',1),body()],1)[0]!.bodyId,'core-0');
 assert.deepEqual([...controller.occupiedGateIds()],['mouth-gate']);
 for(let tick=2;tick<13;tick++)assert.deepEqual(controller.advance(tick,()=>false,()=>false),[]);
 assert.equal(controller.advance(13,()=>false,()=>false)[0]!.type,'transit-start');
 assert.equal(controller.advance(16,()=>false,()=>false)[0]!.type,'exit-blocked');
 for(let tick=17;tick<28;tick++)assert.deepEqual(controller.advance(tick,()=>false,()=>false),[]);
 assert.equal(controller.advance(28,()=>false,()=>false)[0]!.type,'terminal-drain');
 assert.equal(controller.state('core-0'),null);assert.equal(controller.frames()[0]!.occupiedBodyId,null);
});
test('exact timed release, conditional fallback and occupancy cancellation use declared ports',()=>{
 const controller=createCaptureController([binding]);controller.enter(new Map([['core-0',body('core-0',0,190)]]),[body()],1);
 controller.advance(13,()=>false,()=>true);const release=controller.advance(16,()=>false,()=>true)[0]!;
 assert.equal(release.type,'capture-release');assert.equal(release.exitPortId,'exit');assert.equal(release.x,800);assert.equal(release.vy,8);
 const lock=createCaptureController([{...binding,item:{...binding.item,release:{kind:'qualification',id:'two-shots',maxHoldTicks:24}}}]);lock.enter(new Map([['core-0',body('core-0',0,190)]]),[body()],1);
 assert.deepEqual(lock.advance(13,()=>false,()=>true),[]);assert.equal(lock.advance(25,()=>false,()=>true)[0]!.exitPortId,'fallback');
 assert.equal(lock.advance(28,()=>false,()=>true)[0]!.exitPortId,'fallback');assert.equal(lock.state('core-0'),null);
 controller.enter(new Map([['core-0',body('core-0',0,190)]]),[body()],30);controller.cancel('core-0');assert.deepEqual([...controller.occupiedGateIds()],[]);
});
test('snapshot occupancy validation rejects forged phases atomically and restores a valid hold',()=>{
 const controller=createCaptureController([binding]);controller.enter(new Map([['core-0',body('core-0',0,190)]]),[body()],1);const data=controller.snapshot(),before=JSON.stringify(data);
 const forged=JSON.parse(before);forged.transports[0].state.phaseTick=200;
 assert.throws(()=>controller.prepareRestore(forged,1,[captured()]),/snapshot/);assert.equal(JSON.stringify(controller.snapshot()),before);
 assert.throws(()=>controller.prepareRestore(data,1,[{...captured(),active:true}]),/snapshot/);
 controller.cancel('core-0');controller.prepareRestore(data,1,[captured()])();assert.equal(controller.state('core-0')!.phase,'captured');
 const publicState=controller.state('core-0')!;(publicState as {phaseTick:number}).phaseTick=99;assert.equal(controller.state('core-0')!.phaseTick,1);
});

test('capture descriptors reject undeclared release kinds and out-of-grid ports',()=>{
 assert.throws(()=>createCaptureController([{...binding,item:{...binding.item,release:{kind:'invented'} as never}}]),/binding/);
 assert.throws(()=>createCaptureController([{...binding,exit:{...binding.exit,elevation:401}}]),/port/);
});
