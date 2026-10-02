import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePixelModelSourceAsset, preparePixelModel } from '../src/pixel-model-compiler.ts';
import { writeNativeGlb } from '../src/asset-native-base-v3.ts';
import { normalizeAsset } from '../src/asset-normalize-v3.ts';
import { evaluateGeometryPoses } from '../src/optimization/geometry-pose.ts';
import { importStyledAsset, styledAssetJson } from '../src/styled-asset.ts';

function fixture() {
 const positions = new Float32Array([0,0,0, 1,0,0, 0,1,0, .01,0,0, 1,0,0, 0,1,0, 0,0,0, 1,0,0, 0,1,0]);
 const normals = Float32Array.from({length:27},(_,i)=>i%3===2?(i<9?1:-1):0);
 const joints = new Uint8Array(36); joints[7*4]=1;
 const weights = Float32Array.from({length:36},(_,i)=>Number(i%4===0));
 const morph = Float32Array.from({length:27},(_,i)=>i%3===2?(i===20?.2:.1):0);
 const uv = new Float32Array([0,0,1,0,0,1, 0,0,1,0,0,1, 0,0,1,0,.25,1]);
 const arrays = [positions,new Uint16Array([0,1,2,3,4,5,6,7,8]),normals,joints,weights,morph,uv,
  new Float32Array([0,1]),new Float32Array([0,0,0,1,0,0]),new Float32Array([0,0,1,1])];
 const json:any={asset:{version:'2.0'},accessors:arrays.map((a,i)=>({componentType:a instanceof Uint8Array?5121:a instanceof Uint16Array?5123:5126,count:i===1?9:i===7?2:i===8?2:i===9?4:9,type:i===1||i===7||i===9?'SCALAR':i===3||i===4?'VEC4':i===6?'VEC2':'VEC3',...(i===0?{min:[0,0,0],max:[1,1,0]}:{})})),
  meshes:[{weights:[.1,.2],extras:{targetNames:['Lift','Shading']},primitives:[{attributes:{POSITION:0,NORMAL:2,JOINTS_0:3,WEIGHTS_0:4,TEXCOORD_0:6},indices:1,targets:[{POSITION:5},{NORMAL:2}]}]}],
  nodes:[{mesh:0,skin:0},{name:'bone0'},{name:'bone1'}],skins:[{joints:[1,2]}],
  animations:[{name:'Mixed',channels:[{sampler:0,target:{node:1,path:'translation'}},{sampler:1,target:{node:0,path:'weights'}}],samplers:[{input:7,output:8},{input:7,output:9}]}],scenes:[{nodes:[0,1,2]}],scene:0};
 const data=writeNativeGlb(json,arrays,[]);
 return{json,arrays,input:{entry:'fixture.glb',files:[{name:'fixture.glb',data}]}};
}
const settings={gridCells:16,maxError:.05,samplesPerClip:5};
function animationData(asset:any){return(asset.json.animations??[]).map((a:any)=>({name:a.name,channels:a.channels,samplers:a.samplers.map((s:any)=>({interpolation:s.interpolation,input:asset.accessors[s.input].array,output:asset.accessors[s.output].array}))}));}

test('explicit 3D grid welds normal-only seams but protects UV, skin and morph records',async()=>{
 const f=fixture(),source=await normalizeAsset(f.input),before=structuredClone(source),result=preparePixelModel(source,settings),p=result.normalized.json.meshes[0].primitives[0];
 assert.deepEqual(source,before);assert.equal(p.attributes.NORMAL,undefined);assert.equal(result.report.primitives[0].outputVertices,6);
 assert.deepEqual(animationData(result.normalized),animationData(source));
 assert.deepEqual(result.normalized.json.meshes[0].weights,[.1,.2]);assert.deepEqual(result.normalized.json.meshes[0].extras.targetNames,['Lift','Shading']);
 assert.equal(p.targets.length,2);assert(result.normalized.accessors[p.targets[1].POSITION]!.array.every(v=>v===0));
 const original=evaluateGeometryPoses(source,0,source.json.meshes[0].primitives[0],{samplesPerClip:7});
 const rebuilt=evaluateGeometryPoses(result.normalized,0,p,{samplesPerClip:7});
 for(let i=0;i<original.length;i++)for(const[v,index]of result.report.primitives[0].retainedSourceVertices.entries())for(let k=0;k<3;k++)assert(Math.abs(rebuilt[i]!.positions[v*3+k]!-original[i]!.positions[index*3+k]!)<1e-6);
 assert(result.report.primitives[0].sampledErrors.some((e:any)=>e.maxError>0));
 assert.throws(()=>preparePixelModel(source,{...settings,maxError:0}),/error budget/);
});

test('3D download retains the mixed clip through deterministic binary/readable reimport',async()=>{
 const f=fixture(),input={...f.input,representation:'model-3d' as const,preset:'small' as const},a=await compilePixelModelSourceAsset(input),b=await compilePixelModelSourceAsset(input);
 assert.deepEqual(a.assetBytes,b.assetBytes);const readable=await importStyledAsset(new TextEncoder().encode(styledAssetJson(a.assetBytes)));assert.deepEqual(readable.glb,a.imported.glb);
 const output=await normalizeAsset({entry:'out.glb',files:[{name:'out.glb',data:readable.glb}]}),source=await normalizeAsset(f.input);
 assert.deepEqual(animationData(output),animationData(source));assert.equal(a.report.fidelity.freeCamera,true);assert.equal(a.report.fidelity.allClipsRetained,true);
 assert.equal(output.json.meshes[0].primitives[0].attributes.NORMAL,undefined);assert.equal(output.json.meshes[0].primitives[0].targets.length,2);
 await assert.rejects(compilePixelModelSourceAsset({...input,representation:'sprite'}as any),/explicitly/);
 await assert.rejects(compilePixelModelSourceAsset({...input,quality:{gridCells:NaN}}),/gridCells/);
 await assert.rejects(compilePixelModelSourceAsset({...input,quality:{targetRatio:.1}}as any),/quality control/);
});

test('a POSITION accessor shared with animation is cloned, never snapped in place',async()=>{
 const f=fixture();f.json.animations[0].samplers[0]={input:10,output:0};f.arrays.push(Float32Array.from({length:9},(_,i)=>i/8));f.json.accessors.push({componentType:5126,count:9,type:'SCALAR'});
 const data=writeNativeGlb(f.json,f.arrays,[]),source=await normalizeAsset({entry:'alias.glb',files:[{name:'alias.glb',data}]}),result=preparePixelModel(source,settings);
 assert.deepEqual(animationData(result.normalized),animationData(source));
});

test('rest-coincident corners with distinct animated morph records cannot be removed',async()=>{
 const f=fixture();f.arrays[0]!.set([0,0,0],3*3);f.arrays[0]!.set([0,0,0],4*3);f.arrays[0]!.set([0,0,0],5*3);
 f.arrays[5]!.set([0,.1,0],4*3);f.arrays[5]!.set([.1,0,0],5*3);
 const data=writeNativeGlb(f.json,f.arrays,[]),source=await normalizeAsset({entry:'degenerate.glb',files:[{name:'degenerate.glb',data}]}),result=preparePixelModel(source,settings);
 assert.equal(result.report.removedTriangles,0);assert.equal(result.report.primitives[0].outputTriangles,3);
 const p=result.normalized.json.meshes[0].primitives[0],poses=evaluateGeometryPoses(result.normalized,0,p,{samplesPerClip:3});
 assert(poses.some(pose=>pose.positions.some((v,i)=>i%3===1&&v>0)));
});
