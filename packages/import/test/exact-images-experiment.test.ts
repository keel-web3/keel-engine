import test from 'node:test';
import assert from 'node:assert/strict';
import { zlibSync } from 'fflate';
import { build } from 'esbuild';
import { decode as decodePNG } from 'fast-png';
import { crc32, decodePng, encodePng } from '../src/png.ts';
import { encodeExactPngScanlines, replayExactPngScanlines } from '../src/optimization/exact-images-experiment.ts';
import type { ExactPngRecipe } from '../src/optimization/exact-images-experiment.ts';
const SIG = new Uint8Array([137,80,78,71,13,10,26,10]);
function join(parts: Uint8Array[]): Uint8Array { const out = new Uint8Array(parts.reduce((n,p)=>n+p.length,0)); let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out; }
function chunk(type:string,data:Uint8Array):Uint8Array{const out=new Uint8Array(data.length+12),v=new DataView(out.buffer);v.setUint32(0,data.length);out.set(new TextEncoder().encode(type),4);out.set(data,8);v.setUint32(out.length-4,crc32(out,4,out.length-4));return out;}
function png(width:number,height:number,color:number,depth:number,raw:Uint8Array,metadata:Array<[string,Uint8Array]>=[]):Uint8Array{const h=new Uint8Array(13),v=new DataView(h.buffer);v.setUint32(0,width);v.setUint32(4,height);h[8]=depth;h[9]=color;return join([SIG,chunk('IHDR',h),...metadata.map(([t,b])=>chunk(t,b)),chunk('IDAT',zlibSync(raw,{level:9})),chunk('IEND',new Uint8Array())]);}
function chunks(bytes:Uint8Array):Uint8Array[]{const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=[];for(let p=8;p<bytes.length;){const n=v.getUint32(p),t=String.fromCharCode(...bytes.subarray(p+4,p+8));if(t!=='IDAT')out.push(bytes.slice(p,p+n+12));p+=n+12;}return out;}
function roundtrip(source:Uint8Array):ExactPngRecipe{const input=source.slice(),encoded=encodeExactPngScanlines({mimeType:'image/png',data:source});assert(encoded.recipe,encoded.reason);assert.equal(encoded.fileBytesExact,false);assert.equal(encoded.decodedSamplesExact,true);const output=replayExactPngScanlines(encoded.recipe);assert.deepEqual(source,input);assert.deepEqual(chunks(output),chunks(source));if(source[24]===8)assert.deepEqual(decodePNG(output,{checkCrc:true}),decodePNG(source,{checkCrc:true}));assert.deepEqual(decodePng(output),decodePng(source));return encoded.recipe;}

test('RGBA and RGB retain every sample including transparent RGB, arbitrary dimensions and metadata',()=>{
 for(const [w,h]of[[1,1],[13,19],[257,65]]){const data=Uint8Array.from({length:w!*h!*4},(_,i)=>(i*31+i%13)&255);roundtrip(encodePng({width:w!,height:h!,data}));}
 const phys=new Uint8Array([0,0,14,196,0,0,14,196,1]),gamma=new Uint8Array([0,0,177,143]),chroma=new Uint8Array(32);
 roundtrip(png(3,1,2,8,new Uint8Array([0,1,2,3,4,5,6,7,8,9]),[['gAMA',gamma],['cHRM',chroma],['sRGB',new Uint8Array([0])],['pHYs',phys],['tRNS',new Uint8Array([0,1,0,2,0,3])]]));
});

test('packed palette bit depths 1,2,4,8 preserve PLTE and tRNS bytes exactly',()=>{
 for(const depth of[1,2,4,8]){const w=29,h=11,n=2**depth,stride=Math.ceil(w*depth/8),raw=new Uint8Array(h*(stride+1));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)raw[y*(stride+1)+1+Math.floor(x*depth/8)]!|=((x+y)%n)<<(8-depth-(x*depth)%8);
  roundtrip(png(w,h,3,depth,raw,[['PLTE',Uint8Array.from({length:n*3},(_,i)=>(i*73)&255)],['tRNS',Uint8Array.from({length:n},(_,i)=>(i*17)&255)]]));
 }
});

test('grayscale and grayscale alpha samples retain their storage/color interpretation',()=>{
 roundtrip(png(3,1,0,8,new Uint8Array([0,0,128,255]),[['tRNS',new Uint8Array([0,128])]]));
 roundtrip(png(3,1,4,8,new Uint8Array([0,0,0,128,127,255,255])));
});

test('conservative fallback retains unsupported formats, ancillary metadata and malformed inputs',()=>{
 const valid=png(1,1,6,8,new Uint8Array([0,20,40,60,0]));
 const sources=[valid.slice(0,-1),png(1,1,6,8,new Uint8Array([5,20,40,60,0])),png(1,1,6,8,new Uint8Array([0,20,40,60,0]),[['tEXt',new Uint8Array([97,0,98])]]),png(1,1,6,16,new Uint8Array(9)),png(1,1,6,8,new Uint8Array(1024))];
 const crc=valid.slice();crc[29]!^=1;sources.push(crc);
 for(const source of sources){const result=encodeExactPngScanlines({mimeType:'image/png',data:source});assert.equal(result.recipe,null);assert.equal(result.fileBytesExact,true);}
 assert.equal(encodeExactPngScanlines({mimeType:'image/jpeg',data:new Uint8Array([255,216,255,217])}).recipe,null);
});

test('recipe replay rejects altered pixels, dimensions, chunk layout, unknown codecs and source bounds',()=>{
 const recipe=roundtrip(png(1,1,6,8,new Uint8Array([0,20,40,60,0]))),bad=recipe.scanlines.slice();bad[1]!^=1;
 for(const patch of[{width:2},{height:0},{scanlines:bad},{sourceBytes:2**31},{kind:'unknown'},{suffix:new Uint8Array()},{prefix:join([recipe.prefix,chunk('IDAT',zlibSync(recipe.scanlines,{level:0}))])}])assert.throws(()=>replayExactPngScanlines({...recipe,...patch} as ExactPngRecipe));
});

test('browser-target bundle replays identically without Node builtins',async()=>{
 const result=await build({stdin:{contents:"export {encodeExactPngScanlines,replayExactPngScanlines} from './packages/import/src/optimization/exact-images-experiment.ts'",resolveDir:new URL('../../..',import.meta.url).pathname},write:false,bundle:true,minify:true,platform:'browser',format:'esm',target:'es2022'});
 const browser=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0]!.contents).toString('base64')),source=png(2,1,6,8,new Uint8Array([0,20,40,60,0,80,100,120,255]));
 const expected=encodeExactPngScanlines({mimeType:'image/png',data:source}),actual=browser.encodeExactPngScanlines({mimeType:'image/png',data:source});assert.deepEqual(actual,expected);assert.deepEqual(browser.replayExactPngScanlines(actual.recipe),replayExactPngScanlines(expected.recipe!));
});
