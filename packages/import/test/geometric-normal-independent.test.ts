import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';
import {encodeGeometricNormals as sourceEncode, replayGeometricNormals as sourceReplay} from '../src/optimization/geometric-normals.ts';
import {decodeAttribute} from '../src/asset-normal-codec-v3.ts';
import {buildGeometricNormals as sourceBuild} from '../src/asset-replay-geometric-normals.ts';
import {buildAsset as buildNative} from '../src/asset-replay-v4.ts';
import {packAsset, unpackAsset} from '../src/asset-binary-v3.ts';
import {optimizeGeometricNormalPayload} from '../src/asset-optimize-geometric-normals.ts';
import {buildFromPackage} from '../src/asset-replay-shared.ts';

const portable = process.env.KEEL_GEOMETRIC_AUDIT_RUNTIME;
const runtime = portable ? await import(pathToFileURL(resolve(portable)).href) : null;
const buildGeometricNormals = runtime?.buildGeometricNormals ?? sourceBuild;
const encodeGeometricNormals = runtime?.encodeGeometricNormals ?? sourceEncode;
const replayGeometricNormals = runtime?.replayGeometricNormals ?? sourceReplay;
const raw = (a:ArrayBufferView) => new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
const wire = (a:ArrayBufferView) => ({codec:'raw',parameters:{version:1},sourceLength:a.byteLength,data:raw(a).slice()});
function octRecipe(bits:number,pairs:Uint32Array):any {
 const data=new Uint8Array(Math.ceil(pairs.length*bits/8));
 for(let i=0;i<pairs.length;i++)for(let k=0;k<bits;k++)data[Math.floor((i*bits+k)/8)]!|=((pairs[i]!>>>k)&1)<<((i*bits+k)%8);
 return {version:3,componentType:5126,type:'VEC3',count:pairs.length/2,normalized:false,storage:{kind:'octahedral-f32',bits,predictor:0,pairs:wire(data)}};
}
const sourceNormals=(bits:number,pairs:Uint32Array)=>decodeAttribute(octRecipe(bits,pairs)) as Float32Array;
function fixture({shared=false,implicit=false,bits=8}:{shared?:boolean;implicit?:boolean;bits?:number}={}) {
 const positions=new Float32Array([0,0,0,1,0,0,0,1,0,1,0,0,1,1,0,0,1,0]);
 const indices=new Uint16Array([0,1,2,3,4,5]);
 const maximum=2**bits-2,pairs=new Uint32Array([maximum/2,maximum,0,0,maximum,maximum,maximum,0,0,maximum,maximum/2,maximum/2]);
 const normals=sourceNormals(bits,pairs),normal=encodeGeometricNormals(normals,positions,indices,{kind:'octahedral',bits,source:normals,pairs});
 assert(normal);
 const arrays=[positions,indices,normals,new Float32Array([-0,1/3,2/3,-0,4/3,5/3]),new Float32Array([0,1]),new Float32Array([0,0,-0,0,.25,0])];
 const types=['VEC3','SCALAR','VEC3','SCALAR','SCALAR','VEC3'],components=[5126,5123,5126,5126,5126,5126];
 const descriptors=arrays.map((a,i)=>({componentType:components[i],type:types[i],count:a.length/(types[i]==='VEC3'?3:1),normalized:false}));
 const primitive:any={attributes:{POSITION:0,NORMAL:2,_NORMAL_COPY:2,_SCALAR:3},targets:[{NORMAL:2}]};
 if(!implicit)primitive.indices=1;
 const base:any={format:'KEEL-NATIVE-ASSET',compilerVersion:'keel-native-asset-compiler-0.2.0',mode:'lossless',json:{asset:{version:'2.0'},accessors:descriptors.map(({normalized,...d})=>d),meshes:[{primitives:[primitive]}],nodes:[{mesh:0}],animations:[{samplers:[{input:4,output:5}],channels:[{sampler:0,target:{node:0,path:'translation'}}]}],scenes:[{nodes:[0]}],scene:0},sourceStorageMetadata:{},descriptors,residualAccessors:arrays.map((a,i)=>i===0||(!implicit&&i===1)?null:wire(a)),surfaces:[{mesh:0,primitive:0,positionAccessor:0,indexAccessor:implicit?null:1,recipe:{version:2,vertexCount:6,mode:4,indexType:implicit?0:5123,indexCount:implicit?0:6,positions:{kind:'residual',buffer:wire(positions)},topology:implicit?{kind:'unindexed'}:{kind:'residual',buffer:wire(indices)}}}],images:[]};
 if(shared){base.json.meshes[0].primitives.push(structuredClone(primitive));base.surfaces.push({...structuredClone(base.surfaces[0]),primitive:1});}
 const native:any={format:'KEEL-NATIVE-V4',compilerVersion:'keel-native-asset-compiler-0.4.0',mode:'lossless',native:{format:'KEEL-NATIVE-V3',compilerVersion:'keel-native-asset-compiler-0.3.0',mode:'lossless',base,attributes:[],positions:[],images:[]},affine:[],indices:[]};
 const wrapper:any={format:'KEEL-GEOMETRIC-NORMALS-V1',base:structuredClone(native),normals:[{mesh:0,primitive:0,accessor:2,positionAccessor:0,indexAccessor:implicit?null:1,recipe:normal.recipe}]};
 wrapper.base.native.base.residualAccessors[2]={kind:'geometric-normal-marker',accessor:2};
 return {wrapper,native,arrays,positions,indices,normals,pairs,recipe:normal.recipe};
}

test('geometric residuals preserve every normal word across all supported precisions and index widths',()=>{
 let state=0x98364;const next=()=>state=(Math.imul(state,1664525)+1013904223)>>>0;
 for(let bits=2;bits<=16;bits++)for(const C of [Uint8Array,Uint16Array,Uint32Array]) {
  const count=96,positions=Float32Array.from({length:count*3},(_,i)=>i%9===0?-0:Math.fround(((next()%1000)-500)/100)),indices=new C(Array.from({length:count},(_,i)=>i)),pairs=Uint32Array.from({length:count*2},()=>next()%(2**bits-1));
  const source=sourceNormals(bits,pairs),before=raw(source).slice(),out=encodeGeometricNormals(source,positions,indices,{kind:'octahedral',bits,source,pairs});
  assert(out,`bits=${bits}, indices=${C.name}`);
  assert.deepEqual(raw(replayGeometricNormals(out.recipe,positions,indices)),before);
  assert.deepEqual(raw(source),before,'source words mutated');
  assert.deepEqual(packAsset(encodeGeometricNormals(source,positions,indices,{kind:'octahedral',bits,source,pairs})!.recipe),packAsset(out.recipe),'encoder determinism');
 }
});

test('degenerate, unused, reversed and huge finite coordinates round trip with nonzero view offsets',()=>{
 const {recipe,normals,positions,indices,pairs}=fixture();
 for(const p of [new Float32Array(positions.length),positions.map(x=>x*3e38),positions.map(x=>-x)]) {
  const backing=new Float32Array(p.length+7);backing.set(p,3);const view=backing.subarray(3,3+p.length);
  const normalBacking=new Float32Array(normals.length+7);normalBacking.set(normals,3);const normalView=normalBacking.subarray(3,3+normals.length);
  for(const ix of [indices,new Uint16Array(),new Uint16Array([2,1,0,5,4,3]),new Uint16Array([0,0,0])]) {
   const encoded=encodeGeometricNormals(normalView,view,ix,{kind:'octahedral',bits:recipe.bits,source:normalView,pairs});assert(encoded);
   assert.deepEqual(raw(replayGeometricNormals(encoded.recipe,view,ix)),raw(normals));
  }
 }
});

test('packed wrapper preserves whole GLB, all typed arrays, shared owners, aliases, morphs and clips',async()=>{
 for(const shared of [false,true])for(const implicit of [false,true]) {
  const {wrapper,native,arrays}=fixture({shared,implicit}),before=structuredClone(wrapper),expected=await buildNative(native);
  const bytes=packAsset(wrapper),actual=await buildGeometricNormals(unpackAsset(bytes));
  assert.deepEqual(actual.glb,expected.glb);assert.deepEqual(actual.scene.json,expected.scene.json);assert.deepEqual(wrapper,before);
  for(let i=0;i<arrays.length;i++) {assert.equal(actual.accessors[i].constructor,arrays[i]!.constructor);assert.deepEqual(raw(actual.accessors[i]),raw(arrays[i]!),'accessor '+i);}
  assert.deepEqual((await buildGeometricNormals(wrapper)).glb,actual.glb,'repeat replay differs');assert.deepEqual(packAsset(wrapper),bytes);
 }
});

test('malformed direct metadata, shapes, index ranges and nonfinite positions reject',()=>{
 const {recipe,positions,indices}=fixture();
 const patches:any[]=[{kind:'bad'},{version:2},{predictor:'unknown'},{bits:1},{bits:17},{bits:2.5},{bits:NaN},{count:0},{count:-1},{count:1.5},{count:1048577},{count:Number.MAX_SAFE_INTEGER},{normalized:0},{residuals:[]},{residuals:new Uint8Array(23)},{residuals:new Uint8Array(25)}];
 for(const patch of patches)assert.throws(()=>replayGeometricNormals({...recipe,...patch},positions,indices));
 for(const p of [new Float64Array(positions),new Float32Array(17),positions.map((v,i)=>i===0?NaN:v),positions.map((v,i)=>i===0?Infinity:v)])assert.throws(()=>replayGeometricNormals(recipe,p as any,indices));
 for(const ix of [new Int16Array(indices),new Float32Array(indices),new Uint16Array(2),new Uint32Array([0,1,6]),new Uint32Array([0,1,0xffffffff])])assert.throws(()=>replayGeometricNormals(recipe,positions,ix as any));
});

test('binding, descriptor, owner, extent and conflicting expansion corruption reject',async()=>{
 const {wrapper}=fixture({shared:true});
 const changes:Array<[string,(w:any)=>void]>=[
  ['duplicate normal',w=>w.normals.push(structuredClone(w.normals[0]))],['negative target',w=>w.normals[0].accessor=-1],['out of range target',w=>w.normals[0].accessor=99],['wrong mesh',w=>w.normals[0].mesh=99],['wrong primitive',w=>w.normals[0].primitive=99],
  ['position binding',w=>w.normals[0].positionAccessor=2],['index binding',w=>w.normals[0].indexAccessor=3],['missing normal binding',w=>delete w.base.native.base.json.meshes[0].primitives[0].attributes.NORMAL],['nontriangle mode',w=>w.base.native.base.json.meshes[0].primitives[0].mode=5],
  ['normal count',w=>w.base.native.base.descriptors[2].count++],['normal type',w=>w.base.native.base.descriptors[2].type='VEC2'],['normal component',w=>w.base.native.base.descriptors[2].componentType=5125],['normal normalized',w=>w.base.native.base.descriptors[2].normalized=true],['position count',w=>w.base.native.base.descriptors[0].count++],
  ['missing marker',w=>w.base.native.base.residualAccessors[2]=null],['wrong marker',w=>w.base.native.base.residualAccessors[2].accessor=3],['missing recipe',w=>w.normals=[]],['residual extent',w=>w.normals[0].recipe.residuals=new Uint8Array(0)],['index extent',w=>w.base.native.base.surfaces[0].recipe.topology.buffer.sourceLength--],
  ['native overlap',w=>w.base.native.attributes.push({accessor:2,recipe:{}})],['affine overlap',w=>w.base.affine.push({kind:'float-affine',accessor:2,count:6,width:3,minimum:[0,0,0],scale:1,codeWidth:2,codes:wire(new Uint16Array(18))})],
  ['position alias',w=>{w.base.native.base.surfaces[1].positionAccessor=2;w.base.native.base.json.meshes[0].primitives[1].attributes.POSITION=2;}],
 ];
 for(const [name,change] of changes){const bad=structuredClone(wrapper);change(bad);await assert.rejects(buildGeometricNormals(bad),/./,name);}
});

test('oversized declarations reject before predictor allocation',async()=>{
 const {wrapper,recipe,positions,indices}=fixture();const Original=globalThis.Float64Array;let allocations=0;
 globalThis.Float64Array=new Proxy(Original,{construct(target,args){allocations++;return Reflect.construct(target,args);}}) as Float64ArrayConstructor;
 try {
  const huge=structuredClone(wrapper);huge.base.native.base.images=[{mimeType:'image/png',data:{codec:'raw',parameters:{version:1},sourceLength:256*1024*1024,data:new Uint8Array()}}];
  await assert.rejects(buildGeometricNormals(huge),/budget/);
  assert.throws(()=>replayGeometricNormals({...recipe,count:1048577},positions,indices));
  assert.throws(()=>replayGeometricNormals(recipe,positions,new Uint8Array(1048576*6+3)));
  assert.equal(allocations,0);
 } finally {globalThis.Float64Array=Original;}
});

test('nonrepresentable source normal words retain the exact fallback',()=>{
 const {normals,positions,indices,pairs}=fixture();
 for(const value of [Math.fround(.1234567),NaN,Infinity,-Infinity]){const different=normals.slice();different[0]=value;assert.equal(encodeGeometricNormals(different,positions,indices,{kind:'octahedral',bits:8,source:normals,pairs}),null);}
});

test('noncanonical high residual bits reject instead of silently wrapping',()=>{
 const {recipe,positions,indices}=fixture({bits:8}),bad=structuredClone(recipe);
 // Adding 2**(bits+1) to this zigzag code changes its signed delta by a
 // complete oct-domain period. It must not disappear through the mask.
 bad.residuals[recipe.count*2]!^=2;
 assert.throws(()=>replayGeometricNormals(bad,positions,indices),/residual|coordinate|canonical/i);
});

test('normalized index descriptors reject at the geometric dependency gate',async()=>{
 const {wrapper}=fixture();wrapper.base.native.base.descriptors[1].normalized=true;
 wrapper.base.native.base.json.accessors[1].normalized=true;
 await assert.rejects(buildGeometricNormals(wrapper),/index|dependency|descriptor/i);
});

test('generic post-pass keeps complete payload fallback, typed bytes and deterministic selection',async()=>{
 const codec={id:'node-'+process.versions.brotli,quality:11,window:22,compress:(data:Uint8Array)=>new Uint8Array(brotliCompressSync(data,{params:{[constants.BROTLI_PARAM_QUALITY]:11,[constants.BROTLI_PARAM_LGWIN]:22}})),decompress:(data:Uint8Array)=>new Uint8Array(brotliDecompressSync(data))};
 for(const eligible of [false,true])for(const topology of [false,true]) {
  const {native,pairs}=fixture();
  if(eligible){native.native.base.residualAccessors[2]=null;native.native.attributes=[{accessor:2,recipe:octRecipe(8,pairs)}];}
  else delete native.native.attributes; // Native replay accepts an omitted empty override table.
  const original=packAsset(topology?{format:'KEEL-TOPOLOGY-ATTRIBUTES-V1',base:native,predictions:[]}:native),before=original.slice(),expected=await buildFromPackage(original);
  const result=await optimizeGeometricNormalPayload(original,codec),repeat=await optimizeGeometricNormalPayload(original,codec),actual=await buildFromPackage(result.candidate.data);
  assert.deepEqual(original,before,'input package mutated');assert.deepEqual(result.candidate.data,repeat.candidate.data);assert.deepEqual(result.compressed,repeat.compressed);
  assert(result.compressed.length<=codec.compress(original).length,'whole-payload no-growth gate');
  assert.deepEqual(actual.glb,expected.glb);for(let i=0;i<expected.accessors.length;i++)assert.deepEqual(raw(actual.accessors[i]),raw(expected.accessors[i]));
  assert.equal(result.normalPrediction.eligibleStreams,eligible?1:0);if(!eligible){assert.equal(result.report.selected,'unchanged');assert.deepEqual(result.candidate.data,original);}
 }
});
