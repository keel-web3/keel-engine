import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaInput} from '@keel-engine/pinball-arena';
import {createPinballInput} from '../src/index.ts';
test('holds, overlapping aliases and between-step taps retain canonical owner control',()=>{
 const input=createPinballInput({ownerId:7});input.key('ArrowLeft',true);input.key('KeyA',true);input.key('ArrowLeft',false);
 assert.deepEqual(input.sample(),{ownerId:7,bits:ArenaInput.LEFT,steerX:0,steerY:0});assert.equal(input.sample().bits,ArenaInput.LEFT);
 input.key('KeyA',false);input.key('Space',true);input.key('Space',false);assert.equal(input.sample().bits,ArenaInput.LAUNCH);assert.equal(input.sample().bits,0);
 input.setButtons('touch-right',ArenaInput.RIGHT);input.key('KeyQ',true);assert.equal(input.sample().bits,ArenaInput.RIGHT|ArenaInput.DASH);assert.equal(input.sample().bits,ArenaInput.RIGHT|ArenaInput.DASH);
 input.key('KeyQ',false);assert.equal(input.sample().bits,ArenaInput.RIGHT);input.neutral();assert.equal(input.sample().bits,0);
});
test('shortcut exclusion, gamepad mapping and disconnect never leave held buttons',()=>{
 const input=createPinballInput({ownerId:0});input.key('KeyA',true);assert.equal(input.key({code:'KeyA',metaKey:true},true),false);assert.equal(input.sample().bits,0);
 const buttons=Array.from({length:8},()=>0);buttons[4]=1;buttons[1]=1;input.setPad({buttons,axes:[.6,-.8],connected:true});const sample=input.sample();assert.equal(sample.bits,ArenaInput.LEFT|ArenaInput.PULSE);assert.ok(Math.abs(sample.steerX!-.6)<.01&&Math.abs(sample.steerY!-.8)<.01);assert.equal(input.sample().bits,sample.bits);
 input.setPad(null);assert.equal(input.sample().bits,0);assert.equal(input.sample().steerX,0);input.setPad({axes:[NaN,0]});assert.throws(()=>input.sample(),/axes/);
 assert.throws(()=>createPinballInput({ownerId:100}));assert.throws(()=>createPinballInput({ownerId:0,deadzone:1}));assert.throws(()=>input.setButtons('invalid',64));
});
