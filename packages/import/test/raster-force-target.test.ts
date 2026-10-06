import test from 'node:test';
import assert from 'node:assert/strict';
import { writeNativeGlb } from '../src/asset-native-base-v3.ts';
import { compileRasterSourceAsset, compilePixelSpriteSourceAsset, preflightRasterSourceAsset, RasterResourceLimitError } from '../src/raster-compiler.ts';
import { importStyledAsset, styledAssetJson } from '../src/styled-asset.ts';
import { createRasterCanvasPlayer } from '../src/raster-player.ts';
import { decodeSpriteFrames, encodeChunkedSpriteFrames } from '../src/sprite-frame-codec.ts';
import { packAsset, unpackAsset } from '../src/asset-binary-v3.ts';
function source(duration=1){
 const arrays=[new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,1,0]),new Uint16Array([0,1,2,0,2,3]),new Float32Array([0,duration]),new Float32Array([0,0,0,.1,0,0])];
 const json={asset:{version:'2.0'},accessors:[{componentType:5126,type:'VEC3',count:4,min:[-1,-1,0],max:[1,1,0]},{componentType:5123,type:'SCALAR',count:6},{componentType:5126,type:'SCALAR',count:2},{componentType:5126,type:'VEC3',count:2}],materials:[{doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[.3,.6,.8,1]}}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1,material:0}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0,animations:[{name:'move',samplers:[{input:2,output:3}],channels:[{sampler:0,target:{node:0,path:'translation'}}]}]};
 return{entry:'mesh.glb',files:[{name:'mesh.glb',data:writeNativeGlb(json,arrays,[])}]};
}
const defaults={paletteSize:8 as const,fps:8,directions:1 as const,clipIndex:null,screen:'bayer4' as const,shading:'unlit' as const,azimuth:0,elevation:0};
test('Pixel, Dither and Original compile exact 1x1, 2x2 and extreme rectangles with deterministic replay',async()=>{
 for(const kind of ['pixel','dither','original'] as const)for(const [width,height] of [[1,1],[2,2],[1,129],[129,1],[7,3],[1024,1]]){
  const input={...source(),...defaults,kind,width:width!,height:height!,resolution:64};
  const result=await compileRasterSourceAsset(input),repeated=await compileRasterSourceAsset(input),readable=await importStyledAsset(new TextEncoder().encode(styledAssetJson(result.assetBytes)));
  assert.deepEqual(result.assetBytes,repeated.assetBytes);assert.ok('raster'in readable);
  assert.equal(result.imported.raster.width,width);assert.equal(result.imported.raster.height,height);assert.equal(result.imported.raster.getFrame(0).length,width!*height!*4);
  assert.deepEqual(readable.raster.getFrame(0),result.imported.raster.getFrame(0));
  assert.deepEqual(result.report.settings.width,width);assert.deepEqual(result.report.settings.height,height);
  if(width===1&&height===1)assert.equal(result.imported.raster.getFrame(0)[3],255,'tiny output is sampled rather than inverted by a fixed border');
  if(kind==='original')assert.equal(result.report.codec.quantizationError.rgbMaxError,0);
 }
 const pixel=await compilePixelSpriteSourceAsset({...source(),representation:'sprite',clipIndex:null,preset:'small',quality:{width:1,height:2}});assert.equal(pixel.imported.raster.width,1);assert.equal(pixel.imported.raster.height,2);
});
test('a long clip with eight views uses bounded chunks and Canvas can seek every direction',async()=>{
 const input={...source(33),...defaults,kind:'original' as const,width:2,height:3,clipIndex:0,directions:8 as const};
 const preflight=await preflightRasterSourceAsset(input);assert(preflight.allowed);assert.equal(preflight.totalFrames,2112);
 const result=await compileRasterSourceAsset(input);assert(result.imported.raster.chunked);assert.equal(result.imported.raster.frames.length,0);assert.equal(result.imported.raster.frameCount,2112);assert.equal(result.imported.envelope.raster.recipe.version,2);
 const imported=await importStyledAsset(result.assetBytes);assert.ok('raster'in imported);const direct=decodeSpriteFrames(unpackAsset(result.assetBytes).raster.recipe);
 let current=new Uint8Array();const canvas:any={style:{},getContext:()=>({createImageData:(w:number,h:number)=>({data:new Uint8Array(w*h*4)}),putImageData:(image:any)=>{current=new Uint8Array(image.data);}})};
 const player=createRasterCanvasPlayer({canvas,asset:imported});assert.equal(canvas.width,2);assert.equal(canvas.height,3);
 for(const direction of [0,7,1,6]){player.render({time:32.8,direction});assert.deepEqual(current,direct[player.frame]);assert.deepEqual(imported.raster.getFrame(player.frame),direct[player.frame]);}
 player.seek(33);assert.equal(player.time,33);player.dispose();assert.throws(()=>player.render());
 const readable=await importStyledAsset(new TextEncoder().encode(styledAssetJson(result.assetBytes)));assert.ok('raster'in readable);assert.deepEqual(readable.raster.getFrame(2111),direct[2111]);
});
test('chunked codecs exceed the old total pixel cap without changing dimensions or RGB quality',async()=>{
 const frame=new Uint8Array(256*256*4);for(let i=0;i<frame.length;i+=4)frame.set([19,87,221,255],i);
 const encoded=await encodeChunkedSpriteFrames({width:256,height:256,frames:Array(257).fill(frame),paletteSize:8,kind:'pixel',screen:'bayer4'},{maxWorkingBytes:32*1024*1024});
 assert.equal(encoded.recipe.frameCount,257);assert.equal(encoded.recipe.version,2);assert.equal(encoded.report.quantizationError.rgbMaxError,0);
 const replay=decodeSpriteFrames(unpackAsset(packAsset(encoded.recipe)));assert.equal(replay.length,257);assert.deepEqual(replay[0],frame);assert.deepEqual(replay[256],frame);
 const broken=structuredClone(encoded.recipe);broken.frameCRC32[256]=0;assert.throws(()=>decodeSpriteFrames(broken),/checksum/);
});
test('preflight and cancellation are actionable without silently reducing the requested target',async()=>{
 const input={...source(),...defaults,kind:'pixel' as const,width:16384,height:16384};
 const plan=await preflightRasterSourceAsset(input);assert.equal(plan.allowed,false);assert.equal(plan.width,16384);assert(plan.limits.some(limit=>limit.code==='working-memory'));assert(plan.adjustments.some(adjustment=>adjustment.control==='maxWorkingBytes'));
 await assert.rejects(compileRasterSourceAsset(input),(error:any)=>error instanceof RasterResourceLimitError&&error.preflight.width===16384&&error.code==='RASTER_RESOURCE_LIMIT');
 for(const dimensions of [{width:1},{width:1,height:0},{width:1.5,height:2}])await assert.rejects(preflightRasterSourceAsset({...source(),...defaults,kind:'pixel',...dimensions}));
 const controller=new AbortController();let progress=0;
 await assert.rejects(compileRasterSourceAsset({...source(10),...defaults,kind:'pixel',width:2,height:2,clipIndex:0,signal:controller.signal,onProgress:event=>{if(event.stage==='raster-frames'&&++progress===2)controller.abort();}}),(error:any)=>error.name==='AbortError');
});

test('chunk palette and dither coordinates are global and browser replay matches Node',async()=>{
 const width=7,height=3,frames=Array.from({length:9},(_,f)=>Uint8Array.from({length:width*height*4},(_,i)=>i%4===3?255:(i*13+f*41)%256));
 const input={width,height,frames,paletteSize:8 as const,kind:'dither' as const,screen:'bayer4' as const};
 const {encodeSpriteFrames}=await import('../src/sprite-frame-codec.ts'),small=encodeSpriteFrames(input),chunks=await encodeChunkedSpriteFrames(input,{chunkFrames:2});
 assert.deepEqual(chunks.recipe.palette,small.recipe.palette);for(let i=0;i<frames.length;i++)assert.deepEqual(chunks.frames[i],small.frames[i]);
 const {build}=await import('esbuild');const output=await build({stdin:{contents:"export { importStyledAsset } from './packages/import/src/styled-asset.ts';",resolveDir:new URL('../../..',import.meta.url).pathname},bundle:true,write:false,platform:'browser',format:'esm',target:'es2022'});
 const browser=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0]!.contents).toString('base64'));
 const result=await compileRasterSourceAsset({...source(40),...defaults,width:1,height:2,kind:'dither',clipIndex:0});
 const imported=await browser.importStyledAsset(result.assetBytes);assert(imported.raster.chunked);assert.deepEqual(imported.raster.getFrame(319),result.imported.raster.getFrame(319));
 const clone=structuredClone(imported);assert.equal(clone.raster.chunked,true);assert.equal(clone.raster.getFrame,undefined);assert.equal(clone.raster.frames.length,0);
});
