import test from 'node:test';
import assert from 'node:assert/strict';
import type {MeshGBuffer} from '@keel-engine/bake';
import {createMeshVisibilityInspector} from '../src/index.ts';

function fixture(words:readonly number[],failure=false){
 const fields={READ_FRAMEBUFFER_BINDING:1,READ_BUFFER:2,PIXEL_PACK_BUFFER_BINDING:3,PACK_ALIGNMENT:4,PACK_ROW_LENGTH:5,PACK_SKIP_PIXELS:6,PACK_SKIP_ROWS:7,READ_FRAMEBUFFER:8,COLOR_ATTACHMENT0:9,TEXTURE_2D:10,FRAMEBUFFER_COMPLETE:11,PIXEL_PACK_BUFFER:12,RGBA_INTEGER:13,UNSIGNED_INT:14};
 const initial=new Map<number,unknown>([[1,{previous:'framebuffer'}],[2,19],[3,{previous:'packbuffer'}],[4,8],[5,12],[6,3],[7,4]]),state=new Map(initial);let readbacks=0,deletes=0;
 const gl={...fields,createFramebuffer:()=>({inspector:true}),getParameter:(p:number)=>state.get(p),bindFramebuffer:(_t:number,v:unknown)=>state.set(1,v),framebufferTexture2D(){},readBuffer:(v:number)=>state.set(2,v),checkFramebufferStatus:()=>11,bindBuffer:(_t:number,v:unknown)=>state.set(3,v),pixelStorei:(p:number,v:number)=>state.set(p,v),readPixels:(_x:number,_y:number,_w:number,_h:number,_f:number,_t:number,pixels:Uint32Array)=>{readbacks++;if(failure)throw Error('readback failed');pixels.set(words);},deleteFramebuffer(){deletes++;}} as unknown as WebGL2RenderingContext;
 const draws=[{mesh:'flipper:80:12',owner:7,look:0},{mesh:'flipper:80:12',owner:7,look:0},{mesh:'body',owner:7,look:0}];
 const buffer={ga:{},gb:{},gc:{},gd:{},width:2,height:2,target:null,draws} as unknown as MeshGBuffer;
 return {buffer,inspector:createMeshVisibilityInspector(gl),readbacks:()=>readbacks,deletes:()=>deletes,restored:()=>assert.deepEqual(state,initial)};
}
// One visible sibling, one occluded sibling, one different mesh, one background.
const words=[1,0,0,0,1,2<<16,0,0,1,0,0,0,0,1<<16,0,0];
test('same-geometry paddles receive separate canonical pixel evidence',()=>{
 const f=fixture(words),result=f.inspector.inspect(f.buffer,[{mesh:'flipper:80:12',owner:7,drawIndex:0},{mesh:'flipper:80:12',owner:7,drawIndex:1},{mesh:'body',owner:7}]);
 assert.deepEqual(result.targets.map(t=>[t.drawIndex,t.submittedDraws,t.pixels,t.bounds]),[[0,1,2,[0,0,0,1]],[1,1,0,null],[undefined,1,1,[1,1,1,1]]]);
 assert.ok(Object.isFrozen(result.targets[0]));f.restored();f.inspector.dispose();
});
test('legacy mesh-owner aggregation still combines matching draws',()=>{
 const f=fixture([1,0,0,0,1,1<<16,0,0,1,1<<16,0,0,0,0,0,0]),result=f.inspector.inspect(f.buffer,[{mesh:'flipper:80:12',owner:7}]);
 assert.equal(result.targets[0]!.pixels,3);assert.equal(result.targets[0]!.submittedDraws,2);assert.ok(!Object.hasOwn(result.targets[0]!,'drawIndex'));f.restored();f.inspector.dispose();
});
test('stale indices, mismatched identity and overlapping target modes reject before readback',()=>{
 const f=fixture(words);
 for(const target of [{mesh:'flipper:80:12',owner:7,drawIndex:-1},{mesh:'flipper:80:12',owner:7,drawIndex:3},{mesh:'flipper:80:12',owner:7,drawIndex:0.5},{mesh:'flipper:80:12',owner:8,drawIndex:0},{mesh:'body',owner:7,drawIndex:0}])assert.throws(()=>f.inspector.inspect(f.buffer,[target]));
 assert.throws(()=>f.inspector.inspect(f.buffer,[{mesh:'flipper:80:12',owner:7},{mesh:'flipper:80:12',owner:7,drawIndex:0}]),/mix aggregate/);
 assert.throws(()=>f.inspector.inspect(f.buffer,[{mesh:'flipper:80:12',owner:7,drawIndex:0},{mesh:'flipper:80:12',owner:7,drawIndex:0}]),/Duplicate/);
 assert.equal(f.readbacks(),0);f.restored();f.inspector.dispose();
});
test('indexed shared seams and oversized draw identities remain inadmissible',()=>{
 const f=fixture(words),draws=f.buffer.draws!;
 const seam={...f.buffer,draws:[{...draws[0]!,seam:'shared'},draws[1]!,draws[2]!]} as unknown as MeshGBuffer;
 assert.throws(()=>f.inspector.inspect(seam,[{mesh:'flipper:80:12',owner:7,drawIndex:0}]),/seam/);
 assert.throws(()=>f.inspector.inspect({...f.buffer,draws:Array.from({length:65537},()=>draws[0]!)} as MeshGBuffer,[]),/identity budget/);
 assert.equal(f.readbacks(),0);f.inspector.dispose();
});
test('failed GPU readback restores caller GL state and disposal stays idempotent',()=>{
 const f=fixture(words,true);assert.throws(()=>f.inspector.inspect(f.buffer,[{mesh:'body',owner:7}]),/readback failed/);f.restored();f.inspector.dispose();f.inspector.dispose();assert.equal(f.deletes(),1);assert.throws(()=>f.inspector.inspect(f.buffer,[]),/disposed/);
});
