import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {decodeAttribute} from '../src/asset-normal-codec-v3.ts';
import {encodeGeometricNormals,replayGeometricNormals} from '../src/optimization/geometric-normals.ts';
import type {OctHint} from '../src/optimization/draco-transforms.ts';
const bytes=(a:ArrayBufferView)=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
function fixture(bits=10,count=90) {
 const maximum=2**bits-2,pairs=Uint32Array.from({length:count*2},(_,i)=>(i*47)%maximum),packed=new Uint8Array(Math.ceil(pairs.length*bits/8));
 let at=0;for(const value of pairs)for(let k=0;k<bits;k++,at++)if(value&2**k)packed[at>>>3]!|=1<<(at&7);
 const source=decodeAttribute({version:3,componentType:5126,type:'VEC3',count,normalized:false,storage:{kind:'octahedral-f32',bits,predictor:0,pairs:{codec:'raw',parameters:{version:1},sourceLength:packed.length,data:packed}}}) as Float32Array;
 const positions=Float32Array.from({length:count*3},(_,i)=>Math.sin(i)*17),indices=Uint16Array.from({length:count},(_,i)=>i),hint:OctHint={kind:'octahedral',bits,pairs,source};
 return{source,positions,indices,hint};
}
test('geometric prediction preserves all source normal words for supported octahedral widths',()=>{
 for(const bits of[2,4,8,10,12,16]){const f=fixture(bits),before=bytes(f.source).slice(),a=encodeGeometricNormals(f.source,f.positions,f.indices,f.hint)!;assert(a);assert.deepEqual(bytes(replayGeometricNormals(a.recipe,f.positions,f.indices)),before);assert.deepEqual(bytes(f.source),before);assert.deepEqual(a,encodeGeometricNormals(f.source,f.positions,f.indices,f.hint));}
});
test('degenerate and tiny geometry predicts safely without altering exact residuals',()=>{
 const f=fixture();for(const scale of[0,1e-20,1e20]){const p=Float32Array.from(f.positions,v=>v*scale),a=encodeGeometricNormals(f.source,p,f.indices,f.hint)!;assert(a);assert.deepEqual(bytes(replayGeometricNormals(a.recipe,p,f.indices)),bytes(f.source));}
 const a=encodeGeometricNormals(f.source,f.positions,new Uint8Array(),f.hint)!;assert.deepEqual(bytes(replayGeometricNormals(a.recipe,f.positions,new Uint8Array())),bytes(f.source));
});
test('unrepresentable source normal words retain the caller residual fallback',()=>{
 const f=fixture(),copy=f.source.slice();new Uint32Array(copy.buffer)[0]=0x7fc00042;assert.equal(encodeGeometricNormals(copy,f.positions,f.indices,f.hint),null);
 assert.equal(encodeGeometricNormals(new Float32Array(),new Float32Array(),new Uint8Array(),f.hint),null);
});
test('malformed topology and recipe extents reject before reconstruction',()=>{
 const f=fixture(),r=encodeGeometricNormals(f.source,f.positions,f.indices,f.hint)!.recipe;
 for(const bad of[{...r,bits:1},{...r,bits:17},{...r,count:1048577},{...r,count:1.5},{...r,residuals:r.residuals.subarray(1)},{...r,predictor:'other'},{...r,normalized:0}])assert.throws(()=>replayGeometricNormals(bad as any,f.positions,f.indices));
 assert.throws(()=>replayGeometricNormals(r,f.positions,new Uint16Array([0,1,900])));assert.throws(()=>replayGeometricNormals(r,f.positions,new Uint16Array([0,1])));
 const p=f.positions.slice();p[0]=Infinity;assert.throws(()=>replayGeometricNormals(r,p,f.indices));
});
test('portable browser-targeted module produces identical recipes and decoded bytes',async()=>{
 const result=await build({entryPoints:[new URL('../src/optimization/geometric-normals.ts',import.meta.url).pathname],bundle:true,platform:'browser',format:'esm',minify:true,write:false}),portable=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0]!.contents).toString('base64')),f=fixture(),node=encodeGeometricNormals(f.source,f.positions,f.indices,f.hint),other=portable.encodeGeometricNormals(f.source,f.positions,f.indices,f.hint);assert(node);assert(other);assert.deepEqual(other,node);assert.deepEqual(bytes(portable.replayGeometricNormals(other.recipe,f.positions,f.indices)),bytes(f.source));
});
