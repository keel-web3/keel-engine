import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {zlibSync} from 'fflate';
import {encodeTopologyAttribute} from '../src/optimization/topology-predictor.ts';
import {buildAsset as buildTopologyCoreSource} from '../src/asset-replay-topology-core.ts';
import {buildAsset as buildTopologyFullSource} from '../src/asset-replay-topology.ts';
import {buildAsset as buildVisualCore} from '../src/asset-replay-visual-core.ts';
import {encodeExactIndexSequence} from '../src/optimization/index-codec.ts';
import {packAsset,unpackAsset} from '../src/asset-binary-v3.ts';

const portableRoot=process.env.KEEL_TOPOLOGY_AUDIT_RUNTIME_DIR;
const buildTopologyCore=portableRoot?(await import(pathToFileURL(resolve(portableRoot,'asset-decoder-topology-core.mjs')).href)).buildAsset:buildTopologyCoreSource;
const buildTopologyFull=portableRoot?(await import(pathToFileURL(resolve(portableRoot,'asset-decoder-topology.mjs')).href)).buildAsset:buildTopologyFullSource;
const raw=(a:ArrayBufferView)=>new Uint8Array(a.buffer,a.byteOffset,a.byteLength);
const wire=(a:ArrayBufferView)=>({codec:'raw',parameters:{version:1},sourceLength:a.byteLength,data:raw(a).slice()});
function fixture({shared=false,predictPositions=true}:{shared?:boolean,predictPositions?:boolean}={}) {
 const n=32,count=n*n,positions=new Float32Array(count*3),audit=new Uint32Array(count*3),indices:number[]=[];let state=19;
 const next=()=>state=(Math.imul(state,1664525)+1013904223)>>>0;
 const u=Array.from({length:n*3},()=>next()&0xffff),v=Array.from({length:n*3},()=>next()&0xffff);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  for(let c=0;c<3;c++){const at=(y*n+x)*3+c;audit[at]=(x&&y?audit[at-3]!+audit[at-n*3]!-audit[at-n*3-3]!:u[x*3+c]!+v[y*3+c]!)+(next()%23===0?next()&255:0);positions[at]=audit[at]!;}
  if(x<n-1&&y<n-1){const a=y*n+x,b=a+1,c=a+n,d=c+1;indices.push(a,b,c,b,d,c);}
 }
 positions[0]=-0;positions[1]=0;
 const arrays:any[]=[positions,Uint16Array.from(indices),Float32Array.from(audit),Float32Array.from({length:count*3},(_,i)=>Math.fround((i%31)/100)),Float32Array.from({length:count*3},(_,i)=>i===1?-0:Math.fround((i%17)/200)),Uint8Array.from({length:count*4},(_,i)=>i%4),Float32Array.from({length:count*4},(_,i)=>i%4===0?1:i%4===1?-0:0),Float32Array.from({length:64},(_,i)=>i%16%5===0?1:0),new Float32Array([0,1]),new Float32Array([0,0,0,0,.25,0])];
 const types=['VEC3','SCALAR','VEC3','VEC3','VEC3','VEC4','VEC4','MAT4','SCALAR','VEC3'],components=[5126,5123,5126,5126,5126,5121,5126,5126,5126,5126],widths:any={SCALAR:1,VEC3:3,VEC4:4,MAT4:16};
 const descriptors=arrays.map((a,i)=>({componentType:components[i],type:types[i],count:a.length/widths[types[i]!],normalized:false}));
 const primitive:any={attributes:{POSITION:0,_AUDIT:2,JOINTS_0:5,WEIGHTS_0:6},indices:1,targets:[{POSITION:3},{POSITION:4}]};
 const base:any={format:'KEEL-NATIVE-ASSET',compilerVersion:'keel-native-asset-compiler-0.2.0',mode:'lossless',json:{asset:{version:'2.0'},accessors:descriptors.map(({normalized,...d})=>d),meshes:[{weights:[.25,.5],primitives:[primitive]}],nodes:[{mesh:0,skin:0},{name:'root joint'},{},{},{}],skins:[{joints:[1,2,3,4],inverseBindMatrices:7}],animations:[{samplers:[{input:8,output:9,interpolation:'LINEAR'}],channels:[{sampler:0,target:{node:1,path:'translation'}}]}],scenes:[{nodes:[0,1,2,3,4]}],scene:0},sourceStorageMetadata:{},descriptors,residualAccessors:arrays.map((a,i)=>i<2?null:wire(a)),surfaces:[{mesh:0,primitive:0,positionAccessor:0,indexAccessor:1,recipe:{version:2,vertexCount:count,mode:4,indexType:5123,indexCount:indices.length,positions:{kind:'residual',buffer:wire(positions)},topology:{kind:'residual',buffer:wire(arrays[1])}}}],images:[]};
 if(shared){base.json.meshes[0].primitives.push(structuredClone(primitive));base.surfaces.push({...structuredClone(base.surfaces[0]),primitive:1});}
 const visual:any={format:'KEEL-NATIVE-V4',compilerVersion:'keel-native-asset-compiler-0.4.0',mode:'lossless',native:{format:'KEEL-NATIVE-V3',compilerVersion:'keel-native-asset-compiler-0.3.0',mode:'lossless',base,attributes:[],positions:[],images:[]},affine:[],indices:[]};
 const wrapper:any={format:'KEEL-TOPOLOGY-ATTRIBUTES-V1',base:structuredClone(visual),predictions:[]};
 for(const id of predictPositions?[0,2]:[2]){const {recipe}=encodeTopologyAttribute({...descriptors[id],array:arrays[id],indices:arrays[1]} as any);assert.equal(recipe.kind,'topology','fixture must exercise prediction');wrapper.predictions.push({accessor:id,mesh:0,primitive:0,recipe});if(id===0)for(const s of wrapper.base.native.base.surfaces)s.recipe.positions={kind:'topology-attribute',accessor:id};else wrapper.base.native.base.residualAccessors[id]={kind:'topology-attribute',accessor:id};}
 return{visual,wrapper,arrays};
}

// Standalone direct runtime tests intentionally do not invoke or duplicate source compilation.
test('topology wrapper preserves full GLB, signed zero, morphs, rig and clips through packed replay and shared owners',async()=>{
 for(const shared of[false,true]){const{visual,wrapper,arrays}=fixture({shared}),before=structuredClone(wrapper),expected=await buildVisualCore(visual),actual=await buildTopologyCore(unpackAsset(packAsset(wrapper)));
  assert.deepEqual(actual.glb,expected.glb);assert.deepEqual(wrapper,before,'caller recipe is immutable');assert.deepEqual(actual.scene.json,visual.native.base.json);
  for(let i=0;i<arrays.length;i++)assert.deepEqual(raw(actual.accessors[i]),raw(arrays[i]),'accessor '+i);
  assert(Object.is(actual.accessors[0][0],-0));assert(Object.is(actual.accessors[4][1],-0));assert(Object.is(actual.accessors[6][1],-0));
 }
});

test('explicit meshopt dependency and both replay runtimes restore the same complete GLB',async()=>{
 const{visual,wrapper,arrays}=fixture({shared:true});wrapper.base.indices=[{accessor:1,recipe:(await encodeExactIndexSequence(arrays[1],{compress:true})).recipe}];for(const s of wrapper.base.native.base.surfaces)s.recipe.topology={kind:'v4-index',accessor:1};
 assert.deepEqual((await buildTopologyFull(wrapper)).glb,(await buildVisualCore(visual)).glb);await assert.rejects(buildTopologyCore(wrapper),/runtime|meshopt|empty/);
});

test('implicit triangle topology binds its count without storing indices',async()=>{
 const{visual,wrapper}=fixture({predictPositions:false}),base=visual.native.base,count=96;
 base.descriptors=[{componentType:5126,type:'VEC3',count,normalized:false}];base.residualAccessors=[null];base.json={asset:{version:'2.0'},accessors:[{componentType:5126,type:'VEC3',count}],meshes:[{primitives:[{attributes:{POSITION:0}}]}]};
 base.surfaces=[{mesh:0,primitive:0,positionAccessor:0,indexAccessor:null,recipe:{version:2,vertexCount:count,mode:4,indexType:0,indexCount:0,positions:{kind:'residual',buffer:wire(new Float32Array(count*3))},topology:{kind:'unindexed'}}}];
 wrapper.base=structuredClone(visual);wrapper.base.native.base.surfaces[0].recipe.positions={kind:'topology-attribute',accessor:0};
 let indexHash=2166136261;for(let i=0;i<count;i++)for(let b=0;b<4;b++)indexHash=Math.imul(indexHash^(i>>>(b*8)&255),16777619)>>>0;
 wrapper.predictions=[{accessor:0,mesh:0,primitive:0,recipe:{...base.descriptors[0],kind:'topology',version:1,predictor:'parallelogram-parent-v1',indexCount:count,indexHash,wordBytes:4,domain:{kind:'words'},payload:{codec:'zlib',parameters:{version:1},sourceLength:count*12,data:zlibSync(new Uint8Array(count*12))}}}];
 assert.deepEqual((await buildTopologyCore(wrapper)).glb,(await buildVisualCore(visual)).glb);
 const bad=structuredClone(wrapper);bad.predictions[0].recipe.indexCount-=3;await assert.rejects(buildTopologyCore(bad),/Implicit topology count differs/);
});

test('descriptor, target, owner and missing-index corruption is rejected',async()=>{
 const{wrapper}=fixture({shared:true});
 const mutations:Array<[string,(r:any)=>void]>=[
  ['duplicate target',r=>r.predictions.push(structuredClone(r.predictions[0]))],['negative accessor',r=>r.predictions[0].accessor=-1],['wrong primitive',r=>r.predictions[0].primitive=99],['nontriangle binding',r=>r.base.native.base.json.meshes[0].primitives[0].mode=5],
  ['descriptor type',r=>r.predictions[0].recipe.type='VEC2'],['descriptor count',r=>r.predictions[0].recipe.count++],['descriptor normalized',r=>r.predictions[0].recipe.normalized=true],['descriptor component',r=>r.predictions[0].recipe.componentType=5125],
  ['unbound attribute',r=>delete r.base.native.base.json.meshes[0].primitives[0].attributes._AUDIT],['missing index descriptor',r=>r.base.native.base.descriptors[1]=null],['index count',r=>r.predictions[0].recipe.indexCount-=3],['index type',r=>r.base.native.base.descriptors[1].type='VEC2'],
  ['missing surface',r=>r.base.native.base.surfaces=[]],['surface target',r=>r.base.native.base.surfaces[0].indexAccessor=2],['position marker',r=>r.base.native.base.surfaces[0].recipe.positions.accessor=2],['shared position marker',r=>r.base.native.base.surfaces[1].recipe.positions.accessor=2],['position residual overlap',r=>r.base.native.base.residualAccessors[0]=wire(new Float32Array(32*32*3))],['attribute marker',r=>r.base.native.base.residualAccessors[2].accessor=0],['missing prediction',r=>r.predictions.pop()],
  ['dependency buffer size',r=>r.base.native.base.surfaces[0].recipe.topology.buffer.sourceLength-=2],['unsupported dependency',r=>r.base.native.base.surfaces[0].recipe.topology.kind='triangle-strip'],
 ];
 for(const[name,mutate]of mutations){const bad=structuredClone(wrapper);mutate(bad);await assert.rejects(buildTopologyCore(bad),/./,name);}
});

test('truncated prediction bytes, incompatible domain and changed topology are rejected',async()=>{
 const{wrapper}=fixture();
 const mutations:Array<(r:any)=>void>=[r=>r.predictions[0].recipe.payload.data=new Uint8Array(0),r=>r.predictions[0].recipe.payload.sourceLength++,r=>r.predictions[0].recipe.wordBytes=2,r=>r.predictions[0].recipe.domain={kind:'unknown'},r=>r.predictions[0].recipe.indexHash^=1,r=>r.base.native.base.surfaces[0].recipe.topology.buffer.data[0]^=1];
 for(const mutate of mutations){const bad=structuredClone(wrapper);mutate(bad);await assert.rejects(buildTopologyCore(bad));}
});

test('duplicate, missing and inconsistent meshopt ownership is rejected before output',async()=>{
 const{wrapper,arrays}=fixture();wrapper.base.indices=[{accessor:1,recipe:(await encodeExactIndexSequence(arrays[1],{compress:true})).recipe}];wrapper.base.native.base.surfaces[0].recipe.topology={kind:'v4-index',accessor:1};
 const mutations:Array<(r:any)=>void>=[r=>r.base.indices=[],r=>r.base.indices.push(structuredClone(r.base.indices[0])),r=>r.base.native.base.surfaces[0].recipe.topology.accessor=99,r=>r.base.native.base.residualAccessors[1]=wire(arrays[1]),r=>r.base.indices[0].recipe.count++,r=>r.base.native.base.surfaces=[]];
 for(const mutate of mutations){const bad=structuredClone(wrapper);mutate(bad);await assert.rejects(buildTopologyFull(bad));}
});

async function noPredictionAllocation(wrapper:any,replay:(r:any)=>Promise<any>,pattern:RegExp){
 const Original=globalThis.Int32Array;let allocations=0;
 globalThis.Int32Array=new Proxy(Original,{construct(target,args){allocations++;return Reflect.construct(target,args);}})as Int32ArrayConstructor;
 try{await assert.rejects(replay(wrapper),pattern);}finally{globalThis.Int32Array=Original;}
 assert.equal(allocations,0,'prediction plan allocated before combined replay budget rejection');
}
test('aggregate native buffers are budgeted before prediction allocation',async()=>{
 const{wrapper}=fixture();wrapper.base.native.base.images=[{mimeType:'image/png',data:{codec:'raw',parameters:{version:1},sourceLength:256*1024*1024,data:new Uint8Array()}}];
 await noPredictionAllocation(wrapper,buildTopologyCore,/aggregate decoded budget/);
});

test('affine expansion joins the aggregate budget before prediction allocation',async()=>{
 const{wrapper}=fixture(),base=wrapper.base.native.base,accessor=base.descriptors.length,count=16_000_000;
 base.descriptors.push({componentType:5126,type:'SCALAR',count,normalized:false});base.json.accessors.push({componentType:5126,type:'SCALAR',count});base.residualAccessors.push({kind:'v4-affine',accessor});
 wrapper.base.affine=[{kind:'float-affine',accessor,count,width:1,minimum:[0],scale:1,codeWidth:2,codes:{codec:'raw',parameters:{version:1},sourceLength:count*2,data:new Uint8Array()}}];
 base.images=[{mimeType:'image/png',data:{codec:'raw',parameters:{version:1},sourceLength:144_000_000,data:new Uint8Array()}}];
 await noPredictionAllocation(wrapper,buildTopologyCore,/aggregate decoded budget/);
});

test('independent meshopt expansion joins the aggregate budget before prediction allocation',async()=>{
 const{wrapper}=fixture(),base=wrapper.base.native.base,accessor=base.descriptors.length,count=8_000_001;
 base.descriptors.push({componentType:5125,type:'SCALAR',count,normalized:false});base.json.accessors.push({componentType:5125,type:'SCALAR',count});base.residualAccessors.push(null);
 base.json.meshes[0].primitives.push({attributes:{POSITION:0},indices:accessor});base.surfaces.push({...structuredClone(base.surfaces[0]),primitive:1,indexAccessor:accessor,recipe:{...structuredClone(base.surfaces[0].recipe),indexCount:count,indexType:5125,topology:{kind:'v4-index',accessor}}});
 wrapper.base.indices=[{accessor,recipe:{count,componentType:5125}}];base.images=[{mimeType:'image/png',data:{codec:'raw',parameters:{version:1},sourceLength:112_000_000,data:new Uint8Array()}}];
 await noPredictionAllocation(wrapper,buildTopologyFull,/aggregate decoded budget/);
});

test('topology work budget rejects excess aggregate predictions before decode',async()=>{
 const{wrapper}=fixture(),base=wrapper.base.native.base;
 for(let i=0;i<5;i++){const accessor=base.descriptors.length,d={componentType:5126,type:'VEC4',count:1048576,normalized:false};base.descriptors.push(d);base.residualAccessors.push({kind:'topology-attribute',accessor});base.json.meshes[0].primitives[0].attributes['_BIG'+i]=accessor;wrapper.predictions.push({accessor,mesh:0,primitive:0,recipe:{...wrapper.predictions[0].recipe,...d}});}
 await noPredictionAllocation(wrapper,buildTopologyCore,/Topology replay budget exceeded/);
});


test('index aliases, normalized indices, overlapping expansions and owner markers fail before prediction allocation',async()=>{
 const{wrapper}=fixture({shared:true});
 const mutations:Array<[string,(r:any)=>void,RegExp]>=[
  ['index alias',r=>{r.predictions[1].accessor=1;r.base.native.base.json.meshes[0].primitives[0].attributes._AUDIT=1;},/binding/],
  ['normalized indices',r=>r.base.native.base.descriptors[1].normalized=true,/index descriptor/],
  ['overlapping affine',r=>r.base.affine=[{accessor:0,count:1024,width:3}],/Affine expansion descriptor/],
  ['overlapping native override',r=>r.base.native.attributes=[{accessor:2,recipe:structuredClone(r.predictions[1].recipe)}],/duplicate or overlapping/],
  ['shared marker',r=>r.base.native.base.surfaces[1].recipe.positions.accessor=2,/owner/],
  ['attribute marker',r=>r.base.native.base.residualAccessors[2].accessor=0,/owner/],
 ];
 for(const[name,mutate,pattern]of mutations){const bad=structuredClone(wrapper);mutate(bad);await noPredictionAllocation(bad,buildTopologyCore,pattern);}
});
