import {test} from 'node:test'; import assert from 'node:assert/strict';
import {writeNativeGlb} from '../src/asset-native-base-v3.ts';
import {compileGameBoySourceAsset,gameBoyTiles} from '../src/gameboy-compiler.ts';
import {decodeRetroClipFrame,decodeRetroAssetFrame} from '@keel-engine/codec';
test('animated model conversion retains views, real deformation, palette and independently cached phases',async()=>{
 const arrays=[new Float32Array([-1,-1,0,1,-1,0,0,1,0]),new Uint16Array([0,1,2]),new Float32Array([0,1]),new Float32Array([0,0,0,1,0,0])];
 const json={asset:{version:'2.0'},accessors:[{componentType:5126,type:'VEC3',count:3},{componentType:5123,type:'SCALAR',count:3},{componentType:5126,type:'SCALAR',count:2},{componentType:5126,type:'VEC3',count:2}],materials:[{doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[1,0,0,1]}}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0,animations:[{name:'move',samplers:[{input:2,output:3}],channels:[{sampler:0,target:{node:0,path:'translation'}}]}]};
 const data=writeNativeGlb(json,arrays,[]),input={entry:'model.glb',files:[{name:'model.glb',data}],clipIndex:0,fps:4,palette:[0,31,1023,32767] as const,shading:'unlit' as const};
 const a=await compileGameBoySourceAsset(input),b=await compileGameBoySourceAsset(input);
 assert.deepEqual(a.clip,b.clip); assert.equal(a.animation.frameCount,4); assert.equal(a.animation.directions,8);assert.equal(a.packets.length,4);
 assert.notDeepEqual(decodeRetroClipFrame(a.clip,0),decodeRetroClipFrame(a.clip,24));
 for(let p=0;p<4;p++)for(let v=0;v<8;v++)assert.deepEqual(decodeRetroAssetFrame(a.packets[p]!,v).tiles,decodeRetroClipFrame(a.clip,p*8+v));
 assert.throws(()=>gameBoyTiles(new Uint8Array(4096),[0,1,2,32768]));
});
