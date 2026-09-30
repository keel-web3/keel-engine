import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMeshWorker, serveMeshWorker } from '../src/mesh-worker.ts';
import { layeredMesh, layeredMeshSteps } from '../src/lod-mesh.ts';
import type { BakeWorld } from '../src/bake.ts';
const runs:BakeWorld[]=[{boxes:Array.from({length:101},(_,i)=>({c:[i,2,3],h:[1,2,1],slot:i%4}))},{capsules:[{a:[0,0,0],b:[1,2,3],r:.3}]}];
test('sliced fallback is byte-identical and yields within a large recipe',()=>{
 const steps=layeredMeshSteps(runs); let yields=0;
 for(;;){const n=steps.next();if(n.done){assert.deepEqual(n.value,layeredMesh(runs));break;} yields++;}
 assert.ok(yields>=6);
});
test('worker queue is bounded, errors reject pending work, and disposal terminates',async()=>{
 class FakeWorker {
  static last:FakeWorker; messages: {id:number}[]=[]; stopped=false;
  onerror:(()=>void)|null=null;onmessageerror:(()=>void)|null=null;
  onmessage:((e:{data:unknown})=>void)|null=null;
  constructor(){FakeWorker.last=this;}
  postMessage(data:{id:number}){this.messages.push(data);}
  terminate(){this.stopped=true;}
 }
 const previous=globalThis.Worker;
 Object.defineProperty(globalThis,'Worker',{value:FakeWorker,configurable:true,writable:true});
 try {
  const worker=createMeshWorker('http://localhost/mesh-worker.js');
  const a=worker.request(runs)!,b=worker.request(runs)!;
  assert.equal(worker.pending,2);assert.equal(worker.request(runs),null);
  const mesh=layeredMesh(runs);
  FakeWorker.last.onmessage!({data:{id:1,mesh}});assert.deepEqual(await a,mesh);
  const rejected=assert.rejects(b,/unavailable/);FakeWorker.last.onerror!();await rejected;
  assert.equal(worker.available,false);assert.equal(worker.pending,0);assert.equal(worker.request(runs),null);
  const again=createMeshWorker('http://localhost/mesh-worker.js');
  const c=again.request(runs)!;const stopped=assert.rejects(c,/unavailable/);again.dispose();await stopped;
  assert.equal(FakeWorker.last.stopped,true);
 } finally {Object.defineProperty(globalThis,'Worker',{value:previous,configurable:true,writable:true});}
});
test('worker service transfers geometry buffers and preserves all mesh attributes',()=>{
 const scope=globalThis as unknown as {onmessage:((e:{data:unknown})=>void)|undefined;postMessage:((data:unknown,transfer?:unknown[])=>void)|undefined};
 const oldMessage=scope.onmessage,oldPost=scope.postMessage;let result:any,transfer:unknown[]|undefined;
 try {
  scope.postMessage=(data,t)=>{result=data;transfer=t;};serveMeshWorker();scope.onmessage!({data:{id:4,runs,options:{}}});
  assert.deepEqual(result.mesh,layeredMesh(runs));assert.equal(result.id,4);
  assert.equal(new Set(transfer).size,5);assert.ok(transfer!.includes(result.mesh.positions.buffer));
 } finally {scope.onmessage=oldMessage;scope.postMessage=oldPost;}
});
