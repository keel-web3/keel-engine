import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaInput} from '@keel-engine/pinball-arena';
import {createPinballControlBinding,type PinballInputPair} from '../src/side-binding.ts';
const pair=(stationId='lower',reverse=false):PinballInputPair=>({arenaId:'arena',stationId,ownerId:3,leaseTicks:120,left:reverse?'right':'left',right:reverse?'left':'right',leftFlipperId:stationId+(reverse?'.right':'.left'),rightFlipperId:stationId+(reverse?'.left':'.right')});
const input=(bits:number)=>({ownerId:3,bits,steerX:.4,steerY:-.6});
test('held screen side keeps its physical blade through yaw, with independent overlapping presses',()=>{
 const control=createPinballControlBinding(3);
 assert.equal(control.map(input(1),pair()).bits,1);
 assert.equal(control.map(input(1),{...pair(),left:null,right:null}).bits,1);
 assert.equal(control.map(input(1),pair('lower',true)).bits,1);
 // The newly pressed screen-right side now also maps to native-left.
 assert.equal(control.map(input(3),pair('lower',true)).bits,1);
 assert.equal(control.map(input(2),pair('lower',true)).bits,1);
 assert.equal(control.map(input(0),pair('lower',true)).bits,0);
 assert.equal(control.map(input(1),pair('lower',true)).bits,2);
 assert.equal(control.map(input(0),pair()).bits,0);
 assert.equal(control.map(input(3),pair()).bits,3);
});
test('a new press during ambiguous projection cannot silently activate when camera ordering returns',()=>{
 const control=createPinballControlBinding(3);
 const edge={...pair(),left:null,right:null};
 assert.equal(control.map(input(1),edge).bits,0);
 assert.equal(control.map(input(1),pair('lower',true)).bits,0);
 control.map(input(0),pair('lower',true));
 assert.equal(control.map(input(1),pair('lower',true)).bits,2);
});
test('an early hold binds a known upcoming native pair without claiming its lease',()=>{
 const control=createPinballControlBinding(3),incoming={...pair(),leaseTicks:0};
 assert.equal(control.map(input(1),incoming).bits,1);
 assert.equal(control.map(input(1),{...pair('lower',true),leaseTicks:0}).bits,1);
 assert.equal(control.map(input(1),pair('lower',true)).bits,1);
});
test('real bank/lease changes and cancellation require release while launch and equipment remain available',()=>{
 const control=createPinballControlBinding(3);
 assert.equal(control.map(input(3),pair()).bits,3);
 assert.equal(control.map(input(3|ArenaInput.DASH),pair('upper')).bits,ArenaInput.DASH);
 assert.equal(control.map(input(2),pair('upper')).bits,0);
 assert.equal(control.map(input(3),pair('upper')).bits,1);
 assert.equal(control.map(input(3|ArenaInput.LAUNCH),null).bits,ArenaInput.LAUNCH);
 assert.equal(control.map(input(3),pair('upper')).bits,0);
 control.map(input(0),pair('upper'));assert.equal(control.map(input(2),pair('upper')).bits,2);
 control.cancel();assert.equal(control.map(input(2),pair('upper')).bits,0);
 control.map(input(0),pair('upper'));assert.equal(control.map(input(2),pair('upper')).bits,2);
 const a=control.map(input(ArenaInput.SHIELD),null);assert.equal(a.bits,ArenaInput.SHIELD);assert.ok(Math.abs(a.steerX!-.4)<.01&&Math.abs(a.steerY!+.6)<.01);
});
test('invalid or foreign leases do not change a held binding',()=>{
 const control=createPinballControlBinding(3);control.map(input(1),pair());
 for(const bad of [{...pair(),ownerId:4},{...pair(),leaseTicks:-1},{...pair(),right:'left' as const},{...pair(),rightFlipperId:pair().leftFlipperId}])assert.throws(()=>control.map(input(2),bad),/lease\/pair/);
 assert.throws(()=>control.map({...input(1),ownerId:4},pair()),/owner/);
 assert.equal(control.map(input(1),pair('lower',true)).bits,1);
});
