import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { encodeShapeReuse, replayShapeReuse } from '../src/optimization/shape-reuse.ts';
import type { ShapeReuseInput } from '../src/optimization/shape-reuse.ts';
const raw=(a:ArrayBufferView)=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
function input(accessor:number,rows:number[][],minimum=[-2.5,4.25,11],scale=0.125):ShapeReuseInput {
 const codes=Uint16Array.from(rows.flat()),positions=Float32Array.from(codes,(q,i)=>Math.fround(Math.fround(q*scale)+minimum[i%3]!));const indices:number[]=[];for(let i=2;i<rows.length;i++)indices.push(0,i-1,i);
 return{accessor,positions,codes,indices:Uint16Array.from(indices),minimum,scale};
}
function assertRoundtrip(inputs:ShapeReuseInput[],axisScale=false){const first=encodeShapeReuse(inputs,{axisScale}),again=encodeShapeReuse(inputs,{axisScale});assert.deepEqual(first,again);const decoded=replayShapeReuse(first.recipe);for(const source of inputs)assert.deepEqual(raw(decoded.get(source.accessor)!),raw(source.codes));return first;}
test('source-derived cross-accessor templates handle all 48 signed axis orientations and retain vertex order',()=>{
 const rows=[[3,7,11],[4,9,15],[8,11,12],[6,10,19],[3,7,11]],permutations=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]],inputs:ShapeReuseInput[]=[];
 for(const p of permutations)for(let sign=0;sign<8;sign++){const transformed=rows.map(r=>p.map((axis,k)=>100+k*20+(sign&(1<<k)?-1:1)*r[axis]!));if(inputs.length%2)transformed.reverse();inputs.push(input(inputs.length,transformed));}
 const result=assertRoundtrip(inputs);assert.equal(result.report.templates,1);assert.equal(result.report.reusedComponents,48);assert.equal(result.report.generatedVertices,240);
});
test('per-axis integer scale reuses complete shapes without changing original Float32 words',()=>{
 const rows=[[0,0,0],[1,0,0],[1,1,0],[0,1,0]],a=input(4,rows.map(r=>r.map((q,k)=>q*[3,7,1][k]!+12)),[-33.2,2.79,-0.01],Math.fround(0.00712)),b=input(19,rows.map(r=>r.map((q,k)=>q*[13,23,1][k]!+103)),[17.8,4.999,0.001],Math.fround(0.017));
 assert.equal(assertRoundtrip([a,b],false).report.generatedVertices,0);const result=assertRoundtrip([a,b],true);assert.equal(result.report.templates,1);assert.equal(result.report.generatedVertices,8);
});
test('unmatched components, unused vertices, Uint32 codes and nonzero byte offsets use exact residuals',()=>{
 const a=input(3,[[8,4,2],[17,8,2],[8,19,5],[9,12,8]]),storage=new Uint32Array(a.codes.length+6);storage.set(a.codes,3);a.codes=storage.subarray(3,storage.length-3);a.codes[2]=80000;a.positions=Float32Array.from(a.codes,(q,i)=>Math.fround(Math.fround(q*a.scale)+a.minimum[i%3]!));a.indices=new Uint16Array([2,1,0]);const out=assertRoundtrip([a]);assert.equal(out.report.generatedVertices,0);assert.equal(out.recipe.streams[0]!.codeWidth,4);assertRoundtrip([]);
});
test('invalid source affine claims reject before encoding, including negative zero and NaN words',()=>{
 const a=input(0,[[0,0,0],[1,0,0],[0,1,0]],[0,0,0],1);a.positions[0]=-0;assert.throws(()=>encodeShapeReuse([a]),/source Float32 word/);a.positions[0]=NaN;assert.throws(()=>encodeShapeReuse([a]),/source Float32 word/);a.positions[0]=0;a.indices=new Uint16Array([0,1,9]);assert.throws(()=>encodeShapeReuse([a]),/index/);a.indices=null;assert.throws(()=>encodeShapeReuse([a,a]),/duplicate accessor/);
});
test('portable replay validates allocation bounds, references, stream extents and exact residual consumption',()=>{
 const source=input(0,[[0,0,0],[4,0,0],[0,7,0]]),r=encodeShapeReuse([source]).recipe;
 assert.throws(()=>replayShapeReuse({...r,version:2} as any),/header/);assert.throws(()=>replayShapeReuse({...r,streams:[{...r.streams[0]!,count:4_000_001}]}),/count/);assert.throws(()=>replayShapeReuse({...r,streams:[r.streams[0]!,r.streams[0]!]}),/duplicate accessor/);
 const map=new Uint32Array([1,0,0]),wire={codec:'raw',parameters:{version:1},sourceLength:12,data:raw(map)};assert.throws(()=>replayShapeReuse({...r,streams:[{...r.streams[0]!,map:wire}]}),/point reference/);
 const residual=new Uint16Array(12);assert.throws(()=>replayShapeReuse({...r,streams:[{...r.streams[0]!,residual:{codec:'raw',parameters:{version:1},sourceLength:24,data:raw(residual)}}]}),/budget/);
});
test('browser-targeted standalone replay bundle works without Draco or encoder state',async()=>{
 const a=input(3,[[0,0,0],[4,0,0],[0,7,0]]),b=input(6,[[15,22,3],[19,22,3],[15,29,3]]),encoded=encodeShapeReuse([a,b]);
 const result=await build({stdin:{contents:"export {replayShapeReuse} from './packages/import/src/optimization/shape-reuse.ts';",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,write:false});const bundled=result.outputFiles[0]!.contents,text=new TextDecoder().decode(bundled);assert(!text.includes('draco3dgltf'));assert(!text.includes('encodeShapeReuse'));const portable=await import('data:text/javascript;base64,'+Buffer.from(bundled).toString('base64'));const output=portable.replayShapeReuse(encoded.recipe);assert.deepEqual(raw(output.get(3)),raw(a.codes));assert.deepEqual(raw(output.get(6)),raw(b.codes));
});
test('asset adapter validates every marker before changing the frozen base and preserves unrelated records',async()=>{
 const {restoreShapeReuse}=await import('../src/optimization/shape-reuse-runtime.ts');const a=input(2,[[0,0,0],[4,0,0],[0,7,0]]),recipe=encodeShapeReuse([a]).recipe;
 const affine={kind:'float-affine',accessor:2,count:3,width:3,minimum:a.minimum,scale:a.scale,codeWidth:2,codes:{shapeReuse:2}},base={format:'KEEL-NATIVE-V4',affine:[affine],native:{base:{descriptors:[null,null,{componentType:5126,type:'VEC3',count:3}]}}},wrapper={format:'KEEL-TOPOLOGY-ATTRIBUTES-V1',base,predictions:[{accessor:99,opaque:'keep'}],shapeReuse:recipe};
 const corrupted=structuredClone(wrapper);corrupted.base.affine[0]!.count=4;assert.throws(()=>restoreShapeReuse(corrupted),/marker mismatch/);assert.deepEqual(corrupted.base.affine[0]!.codes,{shapeReuse:2});const restored=restoreShapeReuse(wrapper);assert.deepEqual(restored.predictions,[{accessor:99,opaque:'keep'}]);assert(!Object.hasOwn(restored,'shapeReuse'));assert.deepEqual(restored.base.affine[0].codes.data,raw(a.codes));assert.equal(restoreShapeReuse(restored),restored);
});
