import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPinballCabinetPrint,createPinballCabinetPrintAsync,planPinballCabinetPrint} from '../src/cabinet-print.ts';
import type {RoleLook} from '@keel-engine/core';
const ground:RoleLook={hue:270,chroma:.06,light:.38,span:.16,finish:'matte',pattern:{kind:'none',freq:1,angle:0,width:1,shift:0,ink:null}};
const themes=['cyber','vapor','gold','nature','crypto','nightshift'] as const;
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
test('cabinet identity and themed structure repeat exactly without changing source paint',()=>{
  const hashes=new Set<string>();
  for(const theme of themes){
    const a=createPinballCabinetPrint({seed:'cabinet-alpha',theme,size:128,ground}),b=createPinballCabinetPrint({seed:'cabinet-alpha',theme,size:128,ground});
    assert.deepEqual(a,b);hashes.add(digest(a.decal.texels));
    assert.notDeepEqual(planPinballCabinetPrint('cabinet-alpha',theme),planPinballCabinetPrint('cabinet-beta',theme));
    assert.notEqual(digest(a.decal.texels),digest(createPinballCabinetPrint({seed:'cabinet-beta',theme,size:128,ground}).decal.texels));
  }
  assert.equal(hashes.size,6);assert.equal(ground.light,.38);assert.equal(ground.pattern.kind,'none');
});
test('detail levels preserve the same composition with bounded lit palette texels',()=>{
  for(const size of [16,32,64,128,256,512] as const){
    const print=createPinballCabinetPrint({seed:'same-tier-genome',theme:'cyber',size,ground});
    assert.equal(print.decal.texels.length,size*size*4);assert.deepEqual(print.rect,[0,0,1,1]);assert.equal(print.inks.length,4);
    for(let i=0;i<print.decal.texels.length;i+=4){assert.ok(print.decal.texels[i]!>=1&&print.decal.texels[i]!<=4);assert.ok(print.decal.texels[i+1]!>=96&&print.decal.texels[i+1]!<=160);assert.equal(print.decal.texels[i+2],230);assert.equal(print.decal.texels[i+3],255);}
    for(const ink of print.inks){assert.ok(Number.isFinite(ink.hue));assert.ok(ink.light>=.12&&ink.light<=.56);assert.equal(ink.finish,'matte');}
  }
});
test('the blade approach remains quiet rather than receiving high-contrast print targets',()=>{
  for(const theme of themes){
    const {decal}=createPinballCabinetPrint({seed:'free-fan',theme,size:256,ground});
    for(let y=204;y<250;y++)for(let x=70;x<186;x++)assert.equal(decal.texels[(y*256+x)*4],1);
  }
});
test('unsupported sizes and nonfinite identities/looks fail before producing a decal',()=>{
  for(const size of [0,1,33,1024,NaN,Infinity])assert.throws(()=>createPinballCabinetPrint({seed:'valid',theme:'nature',size:size as never,ground}));
  for(const seed of ['', 'x'.repeat(1025)])assert.throws(()=>planPinballCabinetPrint(seed,'cyber'));
  assert.throws(()=>planPinballCabinetPrint('seed','city' as never));
  assert.throws(()=>createPinballCabinetPrint({seed:'valid',theme:'nature',size:64,ground:{...ground,light:NaN}}));
});
test('cooperative rebuild owns inputs, preserves exact bytes and can be cancelled between chunks',async()=>{
 const expected=createPinballCabinetPrint({seed:'cooperative',theme:'nature',size:64,ground}),mutable={seed:'cooperative',theme:'nature' as const,size:64 as const,ground:{...ground,pattern:{...ground.pattern}}};let yields=0;
 const result=await createPinballCabinetPrintAsync(mutable,{yieldControl:async()=>{yields++;mutable.seed='changed';mutable.ground.light=.99;mutable.ground.pattern.kind='spots';}});
 assert.ok(yields>=32);assert.deepEqual(result,expected);
 const controller=new AbortController();let cancelledYields=0;
 await assert.rejects(createPinballCabinetPrintAsync({seed:'cancel',theme:'cyber',size:64,ground},{signal:controller.signal,yieldControl:async()=>{cancelledYields++;controller.abort();}}),{name:'AbortError'});
 assert.equal(cancelledYields,1);
});
test('host scheduling granularity leaves the same material bytes and rejects invalid chunks',async()=>{
 const options={seed:'same-job-different-schedules',theme:'vapor' as const,size:32 as const,ground},expected=createPinballCabinetPrint(options);
 for(const rows of [1,4,16]){
  let yields=0;const result=await createPinballCabinetPrintAsync(options,{maxRowsPerChunk:rows,yieldControl:async()=>{yields++;}});
  assert.deepEqual(result,expected);assert.equal(yields,(512+32)/rows);
 }
 for(const rows of [0,17,1.5,NaN,Infinity])await assert.rejects(createPinballCabinetPrintAsync(options,{maxRowsPerChunk:rows}),RangeError);
});
