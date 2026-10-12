import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlobTarget} from '../src/blob-target.ts';
test('bounded media writes preserve overlapping reserved headers and immutable source bytes', async () => {
 const f=createBlobTarget(), source=new Uint8Array([1,2,3,4]);f.write(source,0);source.fill(0);f.write(new Uint8Array([5,6,7,8]),4);f.write(new Uint8Array([9,10,11,12]),2);
 assert.deepEqual(new Uint8Array(await f.finish().arrayBuffer()),new Uint8Array([1,2,9,10,11,12,7,8]));
 assert.equal(f.byteLength,8);f.clear();assert.equal(f.byteLength,0);
});
test('seekable streaming output matches an independent byte-array writer', async () => {
 let seed=42;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 const f=createBlobTarget();let expected=new Uint8Array(0);
 for(let i=0;i<1000;i++){const at=random()%1024,n=1+random()%80,data=Uint8Array.from({length:n},()=>random()&255);const next=new Uint8Array(Math.max(expected.length,at+n));next.set(expected);next.set(data,at);expected=next;f.write(data,at);}
 assert.deepEqual(new Uint8Array(await f.finish().arrayBuffer()),expected);
});
