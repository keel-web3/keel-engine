import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PINBALL_SOUNDS,pinballSoundRecipe,pinballSoundSample} from '../src/pinball.ts';
const digest=(pcm:Float32Array)=>createHash('sha256').update(new Uint8Array(pcm.buffer,pcm.byteOffset,pcm.byteLength)).digest('hex');
test('seeded mechanical bank has distinct bounded non-silent finite sounds and exact regeneration',()=>{
 const identities=new Set<string>();
 for(const name of PINBALL_SOUNDS){
  const recipe=pinballSoundRecipe(name,'pinball-cabinet-2026'),pcm=pinballSoundSample(recipe,8000),hash=digest(pcm);identities.add(hash);
  assert.equal(digest(pinballSoundSample(recipe,8000)),hash,name+' exact regeneration');
  assert.notEqual(digest(pinballSoundSample(pinballSoundRecipe(name,'another-cabinet'),8000)),hash,name+' seed variation');
  assert.notEqual(digest(pinballSoundSample(pinballSoundRecipe(name,'pinball-cabinet-2026',1),8000)),hash,name+' event variant');
  assert.ok(pcm.length>=800&&pcm.length<=8000*1.21);assert.ok(pcm.every(value=>Number.isFinite(value)&&Math.abs(value)<=.421));
  assert.ok(Math.sqrt(pcm.reduce((sum,value)=>sum+value*value,0)/pcm.length)>.008,name+' audible energy');assert.ok(Math.abs(pcm[pcm.length-1]!)<1e-6,name+' silent tail');
 }
 assert.equal(identities.size,PINBALL_SOUNDS.length);
});
test('audio styles and device rates preserve bounded PCM while invalid recipes fail closed',()=>{
 const recipe=pinballSoundRecipe('spring.release','cabinet');
 for(const rate of [8000,44100,96000])assert.ok(pinballSoundSample(recipe,rate).every(value=>Number.isFinite(value)&&Math.abs(value)<=.421));
 assert.notEqual(digest(pinballSoundSample(recipe,8000)),digest(pinballSoundSample(pinballSoundRecipe('spring.release','cabinet',0,'chip'),8000)));
 assert.throws(()=>pinballSoundSample({...recipe,version:2} as any));assert.throws(()=>pinballSoundSample(recipe,7999));assert.throws(()=>pinballSoundRecipe('unknown' as any,'cabinet'));assert.throws(()=>pinballSoundRecipe('drain','cabinet',4));assert.throws(()=>pinballSoundRecipe('drain','x'.repeat(257)));
});
