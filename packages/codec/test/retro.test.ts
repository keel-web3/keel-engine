import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeRetroFrame,decodeRetroFrame,encodeRetroClip,decodeRetroClipFrame} from '../src/retro.ts';
test('retro frames are deterministic, bounded and lossless across adversarial bytes',()=>{
 let state=9;const rand=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return state&255;};
 const cases=[new Uint8Array(256),new Uint8Array(256).fill(255),Uint8Array.from({length:256},(_,i)=>i),Uint8Array.from({length:256},(_,i)=>(i%16)*17)];
 for(let i=0;i<200;i++)cases.push(Uint8Array.from({length:256},()=>rand()));
 for(const f of cases){const p=encodeRetroFrame(f);assert.ok(p.length<=257);assert.deepEqual(encodeRetroFrame(f),p);assert.deepEqual(decodeRetroFrame(p),f);for(let cut=0;cut<p.length;cut++)assert.throws(()=>decodeRetroFrame(p.subarray(0,cut)));assert.throws(()=>decodeRetroFrame(Uint8Array.from([...p,0])));}
 assert.throws(()=>decodeRetroFrame(Uint8Array.from([2,128,0])),'back-reference before output');
 assert.throws(()=>decodeRetroFrame(Uint8Array.from([2,255,255,255,255,192])),'output overrun');
});
test('retro clips preserve random access without chained or cyclic frame dependencies',()=>{
 const frames=Array.from({length:64},(_,n)=>Uint8Array.from({length:256},(_,i)=>i>40&&i<230?(i%16)+(n%4===0?0:i===100+n?1:0):0));
 const c=encodeRetroClip(frames,16);for(const n of [63,0,30,7,18,52])assert.deepEqual(decodeRetroClipFrame(c,n),frames[n]);
 for(let i=0;i<c.bases.length;i++)if(c.bases[i]!==65535)assert.equal(c.bases[c.bases[i]!],65535);
 assert.throws(()=>decodeRetroClipFrame({...c,bases:new Uint16Array(64).fill(0)},1));
});
import {encodeRetroAsset,decodeRetroAssetFrame} from '../src/retro.ts';
test('self-contained cache assets retain palette, attributes and independently addressable views',()=>{
 const frames=Array.from({length:8},(_,v)=>new Uint8Array(256).fill(v));const p=encodeRetroAsset({frames,palette:[1,2,3,4],shadeMasks:new Uint16Array(8).fill(0x1234)});
 for(let v=7;v>=0;v--){const d=decodeRetroAssetFrame(p,v);assert.deepEqual(d.tiles,frames[v]);assert.deepEqual(d.palette,[1,2,3,4]);assert.equal(d.shadeMask,0x1234);}
 for(const bad of [p.subarray(0,p.length-1),Uint8Array.from([...p,0])])assert.throws(()=>decodeRetroAssetFrame(bad,0));
});
