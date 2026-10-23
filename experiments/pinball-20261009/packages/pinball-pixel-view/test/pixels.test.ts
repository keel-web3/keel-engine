import test from 'node:test';
import assert from 'node:assert/strict';
import {pixelSurfaceRgba,fitPixelViewport,type PixelFrameSurface,type PixelColour} from '../src/index.ts';
const world='7e13c86fe941736db19524dccedaca43d5d347e448188af08fe84f7343bb1b5e';
test('native palette clusters keep exact colour and alpha; bad bindings never alter a reused raster',()=>{
 const surface:PixelFrameSurface={width:2,height:2,indices:new Uint8Array([0,1,2,1]),palette:[[5,4,18],[81,228,220],[252,202,167,128]],worldSha256:world,tick:248};
 const rgba=pixelSurfaceRgba(surface,world,248);assert.deepEqual([...rgba],[5,4,18,255,81,228,220,255,252,202,167,128,81,228,220,255]);
 const before=rgba.slice();
 const sparse=[255,,0] as unknown as PixelColour;
 for(const invalid of [{...surface,tick:247},{...surface,worldSha256:'a'.repeat(64)},{...surface,indices:new Uint8Array([0,1,2,9])},{...surface,palette:[[1,2,999]] as const},{...surface,palette:[sparse]},{...surface,width:1024,height:1024}]){
  assert.throws(()=>pixelSurfaceRgba(invalid,world,248,262144,rgba));assert.deepEqual(rgba,before);
 }
 surface.indices[0]=1;assert.equal(pixelSurfaceRgba(surface,world,248,262144,rgba),rgba);assert.deepEqual([...rgba.slice(0,4)],[81,228,220,255]);
});
test('portrait, landscape and retina viewports preserve native pixel replication and disclose constrained downsampling',()=>{
 for(const [w,h,dpr] of [[1200,720,1],[360,800,2],[800,360,2],[1920,1080,1]] as const){
  const v=fitPixelViewport(w,h,384,448,dpr);assert(v.integerScale);assert(Number.isInteger(v.scale));assert.equal(v.drawWidth,384*v.scale);assert.equal(v.drawHeight,448*v.scale);assert(v.x>=0&&v.y>=0&&v.x+v.drawWidth<=v.width&&v.y+v.drawHeight<=v.height);
 }
 const low=fitPixelViewport(320,240,384,448);assert.equal(low.integerScale,false);assert(low.drawWidth<=320&&low.drawHeight<=240);assert.equal(low.drawHeight,240);
 const huge=fitPixelViewport(8000,8000,384,448,3);assert(huge.backingReduced);assert(huge.width*huge.height<=16777216);assert(huge.effectiveDpr<3);
 const tiny=fitPixelViewport(1,1,1024,1);assert.equal(tiny.drawWidth,1);assert.equal(tiny.drawHeight,1);
 const zoomedOut=fitPixelViewport(1200,720,384,448,.8);assert.equal(zoomedOut.width,960);assert.equal(zoomedOut.height,576);assert.equal(zoomedOut.effectiveDpr,.8);
 assert.throws(()=>fitPixelViewport(NaN,720,384,448));assert.throws(()=>fitPixelViewport(1200,720,0,448));
});


test('tall bounded surfaces preserve every palette byte while axis and total budgets remain enforced',()=>{
 const indices=new Uint8Array(320*1312);for(let i=0;i<indices.length;i++)indices[i]=i%2;const surface:PixelFrameSurface={width:320,height:1312,indices,palette:[[4,8,16],[255,128,64,192]],worldSha256:world,tick:588};
 const rgba=pixelSurfaceRgba(surface,world,588,491520);assert.equal(rgba.byteLength,320*1312*4);for(let i=0;i<indices.length;i++){const at=i*4,c=surface.palette[indices[i]!]!;assert.equal(rgba[at],c[0]);assert.equal(rgba[at+1],c[1]);assert.equal(rgba[at+2],c[2]);assert.equal(rgba[at+3],c[3]??255);}
 const before=rgba.slice();for(const bad of [{...surface,width:2049,height:1},{...surface,width:1024,height:1025},{...surface,width:512,height:1024}]){assert.throws(()=>pixelSurfaceRgba(bad,world,588,491520,rgba));assert.deepEqual(rgba,before);}
 const fit=fitPixelViewport(390,1600,320,1312,1,'nearest-fit');assert.equal(fit.drawWidth,390);assert.equal(fit.drawHeight,1599);assert.equal(fit.y,.5);assert.equal(fit.drawWidth/320,fit.drawHeight/1312);
});
