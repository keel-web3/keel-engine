import test from 'node:test';
import assert from 'node:assert/strict';
import { compileAsset } from '../src/asset-compiler-v6.ts';
import { compileAnimatedVoxels } from '../src/animated-voxel.ts';
import { compileAnimatedVoxelStyledAsset } from '../src/styled-asset-compiler.ts';
import { buildAnimatedVoxelAsset } from '../src/animated-voxel-replay.ts';
import { writeNativeGlb } from '../src/asset-native-base-v3.ts';
import { createStyledAsset, importStyledAsset, styledAssetJson } from '../src/styled-asset.ts';
import { encodeBuffer, decodeBuffer } from '../src/asset-buffer-codec.ts';
import { packAsset, unpackAsset } from '../src/asset-binary-v3.ts';
const I = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function fixture(skinned = true, interpolation = 'LINEAR') {
  const arrays = [new Float32Array([0,0,0, 1,0,0, 0,1,0]), new Uint16Array([0,1,2]), new Uint16Array([0,1,0,0,0,1,0,0,0,1,0,0]), new Float32Array([.5,.5,0,0,.5,.5,0,0,.5,.5,0,0]), new Float32Array([...I,...I]), new Float32Array([0,1]), new Float32Array(interpolation==='CUBICSPLINE'?[0,0,0,0,0,0,1,0,0,1,0,0,2,0,0,0,0,0]:[0,0,0,2,0,0])];
  const json:any={asset:{version:'2.0',copyright:'fixture'},accessors:[{componentType:5126,type:'VEC3',count:3,min:[0,0,0],max:[1,1,0]},{componentType:5123,type:'SCALAR',count:3},{componentType:5123,type:'VEC4',count:3},{componentType:5126,type:'VEC4',count:3},{componentType:5126,type:'MAT4',count:2},{componentType:5126,type:'SCALAR',count:2,min:[0],max:[1]},{componentType:5126,type:'VEC3',count:interpolation==='CUBICSPLINE'?6:2}],meshes:[{primitives:[{attributes:{POSITION:0,...(skinned?{JOINTS_0:2,WEIGHTS_0:3}:{})},indices:1}]}],nodes:[{name:'parent',translation:[3,4,5],scale:[2,1,.5],children:[1,2,3]},{name:'mesh',mesh:0,...(skinned?{skin:0}:{})},{name:'bone0'},{name:'bone1'}],skins:skinned?[{joints:[2,3],inverseBindMatrices:4}]:[],animations:[{name:interpolation,channels:[{sampler:0,target:{node:skinned?3:1,path:'translation'}}],samplers:[{input:5,output:6,interpolation}]}],scenes:[{nodes:[0]}],scene:0};
  return {json,arrays,glb:()=>writeNativeGlb(json,arrays,[])};
}
async function native(f=fixture()) { const glb=f.glb();return compileAsset({entry:'model.glb',files:[{name:'model.glb',data:glb}],mode:'lossless'}); }

test('animated cubes retain exact blended rig and all keyframes with transformed parents',async()=>{
  const f=fixture(),n=await native(f),r=await compileAnimatedVoxels({packageBytes:n.packageBytes,voxels:8});
  assert.ok(r.cubes>0);assert.ok(r.restMaxError<1e-5);assert.equal(r.report.maxDiscardedWeight,0);
  assert.deepEqual(r.scene.json.nodes.map((n:any)=>n.translation),f.json.nodes.map((n:any)=>n.translation));
  assert.equal(r.scene.json.animations[0].name,'LINEAR');assert.equal(r.scene.json.skins[0].joints.length,2);
  assert.deepEqual(r.accessors[0],f.arrays[4]);assert.deepEqual(r.accessors[1],f.arrays[5]);assert.deepEqual(r.accessors[2],f.arrays[6]);
  assert.equal(r.scene.json.images,undefined);assert.equal(r.images.length,0);
  const p=r.scene.json.meshes[0].primitives[0],weights=r.accessors[p.attributes.WEIGHTS_0];assert.equal(weights[0],.5);assert.equal(weights[1],.5);
  assert.deepEqual((await buildAnimatedVoxelAsset(r.recipe)).glb,r.glb);
});

test('rigid clips and STEP/CUBICSPLINE samplers retain original node graph and values',async()=>{
  for(const interpolation of ['STEP','CUBICSPLINE']){const f=fixture(false,interpolation),n=await native(f),r=await compileAnimatedVoxels({packageBytes:n.packageBytes,voxels:8});assert.equal(r.scene.json.skins.length,0);assert.equal(r.scene.json.animations[0].samplers[0].interpolation,interpolation);assert.deepEqual(r.accessors[1],f.arrays[6]);assert.equal(r.scene.json.meshes[0].primitives[0].attributes.JOINTS_0,undefined);assert.ok(r.restMaxError<1e-5);}
});

test('full binary/readable v4 assets repeat and replay the same animated geometry',async()=>{
 const f=fixture();f.json.nodes[0].rotation=[0,-0,0,1];const n=await native(f),input={packageBytes:n.packageBytes,voxels:8};const a=await compileAnimatedVoxelStyledAsset(input),b=await compileAnimatedVoxelStyledAsset(input);assert.deepEqual(a.assetBytes,b.assetBytes);assert.equal(a.imported.version,4);assert.deepEqual(a.imported.animation,{mode:'preserved',clips:1,skins:1});assert.equal(a.imported.voxelCount,a.report.cubes);assert.equal(a.report.assetBytes,a.assetBytes.length);assert.deepEqual((await importStyledAsset(new TextEncoder().encode(styledAssetJson(a.assetBytes)))).glb,a.imported.glb);const e=unpackAsset(a.assetBytes);assert.equal(e.native.byteLength,0);assert.equal(e.native.dracoRequired,false);assert.equal(e.animatedVoxel.scene.meshes,undefined);
});

test('animated sources cannot silently use static snapshot export',async()=>{
 const n=await native();await assert.rejects(createStyledAsset({packageBytes:n.packageBytes,style:{kind:'voxel',pixelSize:1,toneLevels:8,screen:'bayer4'},voxel:{}}),/staticPose/);
});

test('morphs, extended influences, masking, and singular rest transforms fail explicitly',async()=>{
 for(const change of [(f:any)=>{f.json.meshes[0].primitives[0].targets=[{POSITION:0}]},(f:any)=>{f.json.meshes[0].primitives[0].attributes.JOINTS_1=2},(f:any)=>{f.json.materials=[{alphaMode:'MASK'}];f.json.meshes[0].primitives[0].material=0},(f:any)=>{f.json.nodes[0].scale=[0,1,1]}]){const f=fixture();change(f);const n=await native(f);await assert.rejects(compileAnimatedVoxels({packageBytes:n.packageBytes,voxels:8}));}
});

test('hostile rig recipes reject invalid bindings, graphs and motion before playback',async()=>{
 const n=await native(),r=await compileAnimatedVoxels({packageBytes:n.packageBytes,voxels:8});
 for(const change of [(e:any)=>e.scene.nodes[0].children.push(0),(e:any)=>e.scene.images=[],(e:any)=>e.parts[0].node=999999,(e:any)=>e.motion[0].count=2**40,(e:any)=>e.scene.skins[0].joints=[99999],(e:any)=>e.scene.animations[0].channels[0].target.path='weights',(e:any)=>e.parts[0].weights.sourceLength=0,(e:any)=>e.scene.nodes[0].matrix=I,(e:any)=>e.scene.scenes[0].nodes=[999],(e:any)=>e.scene.animations[0].samplers[0].input='1',(e:any)=>{const p=e.parts[0],raw=decodeBuffer(p.joints,p.joints.sourceLength),j=new Uint16Array(raw.buffer);j[3]=65535;const r=encodeBuffer(new Uint8Array(j.buffer),{stride:8,componentBytes:2});p.joints={codec:r.codec,parameters:r.parameters,sourceLength:r.sourceLength,data:r.data};}]){const e=unpackAsset(packAsset(r.recipe));change(e);await assert.rejects(buildAnimatedVoxelAsset(e));}
});
