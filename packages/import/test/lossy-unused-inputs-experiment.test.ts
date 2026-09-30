import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {NativeArray,NormalizedAsset} from '../src/asset-normalize-v3.ts';
import {prepareLossyUnusedInputs,compileLossyUnusedInputsPostpassArm,assertProtectedLossyScene,chooseLossyUnusedInputs} from '../src/optimization/lossy-unused-inputs-experiment.ts';
import {optimizeGeometry} from '../src/optimization/geometry.ts';

function fixture():NormalizedAsset {
 const accessors:any[]=[],descriptors:any[]=[],positions:number[]=[],tangents:number[]=[],normals:number[]=[],uv:number[]=[];
 const add=(array:NativeArray,type:string,componentType=5126)=>{const width=type==='SCALAR'?1:type==='MAT4'?16:Number(type.at(-1)),id=accessors.length,count=array.length/width;accessors.push({sourceIndex:id,type,componentType,count,normalized:false,array});descriptors.push({type,componentType,count});return id;};
 for(let y=0;y<4;y++)for(let x=0;x<4;x++)for(const triangle of [[[x,y],[x+1,y],[x+1,y+1]],[[x,y],[x+1,y+1],[x,y+1]]]){
  const tangentId=tangents.length/12;for(const [px,py] of triangle){positions.push(px!,py!,0);normals.push(0,0,1);tangents.push(tangentId,0,0,1);uv.push(px!/4,py!/4);}
 }
 const count=positions.length/3;
 const primitive:any={attributes:{POSITION:add(Float32Array.from(positions),'VEC3'),NORMAL:add(Float32Array.from(normals),'VEC3'),TANGENT:add(Float32Array.from(tangents),'VEC4'),TEXCOORD_0:add(Float32Array.from(uv),'VEC2'),JOINTS_0:add(new Uint8Array(count*4),'VEC4',5121),WEIGHTS_0:add(Float32Array.from({length:count*4},(_,i)=>i%4===0?1:0),'VEC4')},material:0};
 const inverse=add(new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),'MAT4'),times=add(new Float32Array([0,1]),'SCALAR'),values=add(new Float32Array([0,0,0,1,0,0]),'VEC3');
 const json:any={asset:{version:'2.0',extras:{author:'Fixture'}},accessors:descriptors,meshes:[{primitives:[primitive]}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0}],images:[{mimeType:'image/png'}],nodes:[{mesh:0,skin:0},{}],skins:[{joints:[1],inverseBindMatrices:inverse}],animations:[{samplers:[{input:times,output:values,interpolation:'LINEAR'}],channels:[{sampler:0,target:{node:1,path:'translation'}}]}],scenes:[{nodes:[0,1]}],scene:0};
 return{format:'KEEL-NATIVE-SCENE',version:2,json,sourceJson:structuredClone(json),accessors,images:[{sourceIndex:0,mimeType:'image/png',data:new Uint8Array([1,2,3])}],source:{entry:'fixture.glb',container:'glb',files:[]},validation:{accessorCount:accessors.length,sourceAccessorCount:accessors.length,decodedBytes:accessors.reduce((n,a)=>n+a.array.byteLength,0)+3,dracoPrimitives:0,meshPrimitives:1,imageBytes:3,preservedSourceIndices:true,decodedReference:'source-accessor-values',warnings:[]},runtime:{dependencies:[],dracoRequiredForReplay:false,decoderCostIncluded:false,decoderNote:''}};
}

test('unused tangent discontinuities stop locking the existing simplifier; rig and clip values stay exact',async()=>{
 const source=fixture(),copy=structuredClone(source),prepared=prepareLossyUnusedInputs(source);
 assert.equal(prepared.report.pruning.removedAccessors,1);
 assert.ok(prepared.report.welding.outputVertices<prepared.report.welding.originalVertices);
 assert.equal(prepared.normalized.json.meshes[0].primitives[0].attributes.TANGENT,undefined);
 assert.ok(prepared.normalized.json.meshes[0].primitives[0].attributes.TEXCOORD_0!==undefined);
 assertProtectedLossyScene(source,prepared.normalized);assert.deepEqual(source,copy);
 const options={targetRatio:.5,maxError:.01,samplesPerClip:3,maxSurfaceSamples:32};
 const baseline=await optimizeGeometry(source,options),candidate=await optimizeGeometry(prepared.normalized,options);
 assert.ok(baseline.report.metrics[0]!.lockedSeamVertices>0);
 assert.equal(candidate.report.metrics[0]!.lockedSeamVertices,0);
 assert.ok(candidate.report.outputTriangles<baseline.report.outputTriangles);
 assert.ok(candidate.report.metrics[0]!.sampledErrors.every(e=>e.maxError<=e.allowedError+1e-10));
 assertProtectedLossyScene(source,candidate.normalized);
});

test('normal-mapped tangents and morph/rig discontinuities remain part of complete records',()=>{
 const normalMapped=fixture();normalMapped.json.materials[0].normalTexture={index:0};
 const kept=prepareLossyUnusedInputs(normalMapped);assert.equal(kept.report.pruning.removedAccessors,0);assert.equal(kept.report.welding.outputVertices,96);
 for(const semantic of ['JOINTS_0','WEIGHTS_0','MORPH_POSITION']){
  const source=fixture(),p=source.json.meshes[0].primitives[0],plain=prepareLossyUnusedInputs(source).report.welding.outputVertices;
  if(semantic==='MORPH_POSITION'){
   const id=source.accessors.length,array=new Float32Array(96*3);array[9]=1;
   source.accessors.push({sourceIndex:id,type:'VEC3',componentType:5126,count:96,normalized:false,array});source.json.accessors.push({type:'VEC3',componentType:5126,count:96});p.targets=[{POSITION:id}];
  }else source.accessors[p.attributes[semantic]]!.array[12]=1-source.accessors[p.attributes[semantic]]!.array[12]!;
  assert.equal(prepareLossyUnusedInputs(source).report.welding.outputVertices,plain+1,semantic);
 }
});

test('opaque metadata blocks pruning and welding, preserving original records',()=>{
 const source=fixture();source.json.meshes[0].primitives[0].extras={vertexObserver:true};
 const prepared=prepareLossyUnusedInputs(source);assert.equal(prepared.report.pruning.changedPrimitives,0);assert.equal(prepared.report.welding.changedPrimitives,0);assert.deepEqual(prepared.normalized.json,source.json);
});

test('protected accessor audit detects a remapped animation bit change',()=>{
 const source=fixture(),prepared=prepareLossyUnusedInputs(source),changed=structuredClone(prepared.normalized);
 changed.accessors[changed.json.animations[0].samplers[0].output]!.array[0]=-0;
 assert.throws(()=>assertProtectedLossyScene(source,changed),/Protected scene/);
});

test('selection keeps baseline for failure, missing cost, ties, and insufficient savings',()=>{
 assert.equal(chooseLossyUnusedInputs(100,80,true).selected,'pruned-welded');
 for(const [cost,passed,minimum] of [[80,false,1],[null,true,1],[100,true,1],[101,true,1],[80,true,21]] as const)assert.equal(chooseLossyUnusedInputs(100,cost,passed,minimum).selected,'baseline');
 assert.throws(()=>chooseLossyUnusedInputs(100,NaN,true),/Invalid/);
});

test('postpass keeps original lossy triangles even when removed tangents would unlock more simplification',async()=>{
 const source=fixture();source.images=[];delete source.json.images;delete source.json.textures;source.json.materials=[{pbrMetallicRoughness:{baseColorFactor:[1,1,1,1]}}];source.sourceJson=structuredClone(source.json);
 const input={mode:'bounded-lossy',geometry:{targetRatio:.5,maxError:.01,samplesPerClip:3,maxSurfaceSamples:32},files:[{name:'fixture.glb',data:new Uint8Array()}]};
 const r=await compileLossyUnusedInputsPostpassArm(input,source,new Map());
 assert.equal(r.result.manifest.passes.geometry.outputTriangles,32);
 assert.equal(r.normalized.accessors[r.normalized.json.meshes[0].primitives[0].indices]!.count,96);
 assert.equal(r.result.manifest.settings.geometry.targetRatio,.5);
 assert.equal(r.validation.postpassOnly,true);
 assertProtectedLossyScene(source,r.normalized);
});
