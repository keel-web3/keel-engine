import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeChunkedSpriteFrames } from '../src/sprite-frame-codec.ts';
import { createRasterAsset, importRasterEnvelope } from '../src/raster-asset.ts';
import { rehydrateRasterAsset } from '../src/styled-asset-runtime.ts';
import { packAsset, unpackAsset } from '../src/asset-binary-v3.ts';

async function fixture(){
  const frames=Array.from({length:3},(_,f)=>Uint8Array.of(20+f,40,60,255,70,80,90,255));
  const encoded=await encodeChunkedSpriteFrames({width:1,height:2,frames,paletteSize:8,kind:'original',screen:'bayer4'},{chunkFrames:1});
  const bytes=await createRasterAsset({recipe:encoded.recipe,animation:{name:'clip',sourceClip:0,start:0,duration:3,frameCount:3,fps:1,directions:1,order:'direction-major'},name:'test',attribution:null,camera:{azimuth:0,elevation:0},renderer:'keel-import-cpu-orthographic-base-color-v1'});
  return{frames,asset:await importRasterEnvelope(unpackAsset(bytes))};
}
function mutateChunk(asset:any,change:(chunk:any)=>void){
  const clone=structuredClone(asset),recipe=clone.envelope.raster.recipe,bundle=unpackAsset(recipe.data);
  change(bundle.chunks[2]);recipe.data=packAsset(bundle);recipe.sourceLength=recipe.data.length;
  return clone;
}
test('Worker clone rehydration restores bounded frame access and validates pixels on demand',async()=>{
  const{frames,asset}=await fixture(),clone=structuredClone(asset);
  assert.equal(clone.raster.getFrame,undefined);assert.deepEqual(clone.raster.frames,[]);
  const restored=await rehydrateRasterAsset(clone);
  assert.deepEqual(restored.glb,asset.glb);assert.equal(restored.raster.frameCount,3);
  for(const index of[2,0,1,2])assert.deepEqual(restored.raster.getFrame(index),frames[index]);
  assert.throws(()=>restored.raster.getFrame(3),/frame index/);
  assert.equal(structuredClone(restored).raster.getFrame,undefined);
  const corrupted=mutateChunk(asset,chunk=>{chunk.data[0]^=1;});
  await assert.rejects(importRasterEnvelope(corrupted.envelope),/checksum|zlib|length/i);
  const deferred=await rehydrateRasterAsset(corrupted);
  assert.deepEqual(deferred.raster.getFrame(0),frames[0]);
  assert.throws(()=>deferred.raster.getFrame(2),/checksum|zlib|length/i);
  assert.deepEqual(deferred.raster.getFrame(0),frames[0]);
});
test('rehydration rejects later chunk metadata defects before any later-frame access',async()=>{
  const{asset}=await fixture();
  for(const change of[(chunk:any)=>{chunk.width=65536;},(chunk:any)=>{chunk.frameCount=257;},(chunk:any)=>{chunk.sourceLength++;},(chunk:any)=>{chunk.parameters.extra=1;},(chunk:any)=>{chunk.frameCRC32[0]^=1;}]){
    await assert.rejects(rehydrateRasterAsset(mutateChunk(asset,change)),/Sprite frames:/);
  }
  await assert.rejects(rehydrateRasterAsset({envelope:asset.envelope}),/Import a raster asset/);
});
test('browser runtime restores a structured-cloned Worker asset for exact Canvas playback',async()=>{
  const{asset,frames}=await fixture(),{build}=await import('esbuild');
  const output=await build({entryPoints:[new URL('../src/styled-asset-runtime.ts',import.meta.url).pathname],bundle:true,write:false,platform:'browser',format:'esm',target:'es2022'});
  const runtime=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0]!.contents).toString('base64'));
  const restored=await runtime.rehydrateRasterAsset(structuredClone(asset));
  let pixels=new Uint8Array();
  const canvas:any={style:{},getContext:()=>({createImageData:(width:number,height:number)=>({data:new Uint8Array(width*height*4)}),putImageData:(image:any)=>{pixels=new Uint8Array(image.data);}})};
  const player=runtime.createRasterCanvasPlayer({canvas,asset:restored});
  assert.equal(canvas.width,1);assert.equal(canvas.height,2);
  for(const index of[2,0,1]){player.seek(index);assert.deepEqual(pixels,frames[index]);}
  player.dispose();
});
