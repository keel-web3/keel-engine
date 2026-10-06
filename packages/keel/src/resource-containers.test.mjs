import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import {packResourceContainers,verifyResourceContainer} from './resource-containers.mjs';
const resources=[{id:'beta',scope:'creator',bytes:Buffer.from('beta 🌊')},{id:'alpha',scope:'shared',bytes:Buffer.from('alpha')},{id:'gamma',scope:'creator',bytes:Buffer.from('gamma\0')}];
const options={resources,groupBy:r=>r.scope,compress:gzipSync,decompress:gunzipSync};
test('stable bounded groups preserve original member order, exact bytes and ownership',async()=>{
 const packs=await packResourceContainers(options),repeat=await packResourceContainers(options);
 assert.deepEqual(packs,repeat);assert.deepEqual(packs.map(p=>p.id),['creator','shared']);
 assert.deepEqual(packs[0].members.map(m=>m.id),['beta','gamma']);
 for(const pack of packs)verifyResourceContainer({source:pack.source,stored:pack.stored,record:pack});
});
test('invalid duplicate, mixed ownership, group overflow and codec mismatch reject',async()=>{
 await assert.rejects(()=>packResourceContainers({...options,resources:[resources[0],resources[0]]}),/identity/);
 await assert.rejects(()=>packResourceContainers({...options,groupBy:()=> 'all'}),/ownership/);
 await assert.rejects(()=>packResourceContainers({...options,maxContainers:1}),/count/);
 await assert.rejects(()=>packResourceContainers({...options,decompress:()=>Buffer.from('BAD')}),/exact source/);
 await assert.rejects(()=>packResourceContainers({...options,compress:bytes=>{bytes[0]^=1;return gzipSync(bytes);}}),/exact source/);
});
test('persisted byte and member range changes cannot acquire a chain binding',async()=>{
 const [pack]=await packResourceContainers(options);
 assert.throws(()=>verifyResourceContainer({source:pack.source,stored:Buffer.from('BAD'),record:pack}),/exact byte manifest/);
 const record=structuredClone(pack);record.members[1].offset++;
 assert.throws(()=>verifyResourceContainer({source:pack.source,stored:pack.stored,record}),/range/);
});
test('persisted replay rejects empty/oversized or unbounded member manifests before decoding',async()=>{
 const [pack]=await packResourceContainers(options);
 for(const record of [null,{...pack,members:null},{...pack,members:[]},{...pack,members:Array(129).fill(pack.members[0])}])assert.throws(()=>verifyResourceContainer({source:pack.source,stored:pack.stored,record}),/exact byte manifest/);
 assert.throws(()=>verifyResourceContainer({source:new Uint8Array(),stored:new Uint8Array(),record:{decodedBytes:0,storedBytes:0,members:[]}}),/exact byte manifest/);
 assert.throws(()=>verifyResourceContainer({source:new Uint8Array(32*1024*1024+1),stored:pack.stored,record:pack}),/exact byte manifest/);
 assert.throws(()=>verifyResourceContainer({source:pack.source,stored:new Uint8Array(4*1024*1024+1),record:pack}),/exact byte manifest/);
});


test('compact dictionaries preserve independent revisions and unchanged member references',async()=>{
 const {packResourceRevision}=await import('./resource-containers.mjs');
 const input=[{id:'game.first',scope:'creator',bytes:Buffer.from('function first(){return 1}')},{id:'game.second',scope:'creator',bytes:Buffer.from('function second(){return 2}')}];
 const options={compress:b=>gzipSync(b),decompress:b=>gunzipSync(b)};
 const initial=await packResourceContainers({...options,resources:input,groupBy:()=> 'dictionary.creator'});
 const unchanged=await packResourceRevision({...options,resources:input,previousContainers:initial});assert.equal(unchanged.containers.length,0);assert.equal(unchanged.reused.length,2);
 const changed=[input[0],{...input[1],bytes:Buffer.from('function second(){return 3}')}];
 const patch=await packResourceRevision({...options,resources:changed,previousContainers:initial});assert.equal(patch.containers.length,1);assert.equal(patch.containers[0].id,'game.second');assert.equal(patch.reused[0].containerId,'dictionary.creator');assert.equal(patch.reused[0].offset,0);assert.deepEqual(Buffer.from(patch.containers[0].source),changed[1].bytes);
 await assert.rejects(packResourceRevision({...options,resources:[{...input[0],scope:'shared'}],previousContainers:initial}),/ownership/);
 const bad=structuredClone(initial);bad[0].members[1].offset++;await assert.rejects(packResourceRevision({...options,resources:input,previousContainers:bad}),/member commitment/);
});
