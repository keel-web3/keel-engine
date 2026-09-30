import test from 'node:test';
import assert from 'node:assert/strict';
import { zlibSync, unzlibSync } from 'fflate';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { encodeImage, decodeImageRecipe, imageRecipeToBytes, IMAGE_MAX_PIXELS, IMAGE_SHARED_DECODER_COST_BYTES } from '../src/asset-image-codec-v3.ts';
import type { ImageRecipe } from '../src/asset-image-codec-v3.ts';
import { crc32, decodePng, encodePng } from '../src/png.ts';
const SIG = Uint8Array.from([137,80,78,71,13,10,26,10]);
function chunk(type: string, bytes: Uint8Array): Uint8Array { const a = new Uint8Array(bytes.length + 12), d = new DataView(a.buffer); d.setUint32(0,bytes.length); a.set(new TextEncoder().encode(type),4); a.set(bytes,8);d.setUint32(a.length-4,crc32(a,4,a.length-4));return a; }
function join(parts: Uint8Array[]): Uint8Array { const a=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));let p=0;for(const b of parts){a.set(b,p);p+=b.length}return a; }
function png(width:number,height:number,colourType:number,depth:number,scanlines:Uint8Array,extra:Array<[string,Uint8Array]>=[],ihdrPatch:Partial<Record<number,number>>={}):Uint8Array{
 const ihdr=new Uint8Array(13),d=new DataView(ihdr.buffer);d.setUint32(0,width);d.setUint32(4,height);ihdr[8]=depth;ihdr[9]=colourType;for(const[k,v]of Object.entries(ihdrPatch))ihdr[Number(k)]=v!;
 return join([SIG,chunk('IHDR',ihdr),...extra.map(([t,b])=>chunk(t,b)),chunk('IDAT',zlibSync(scanlines,{level:9})),chunk('IEND',new Uint8Array())]);
}
function rgbaImage(w:number,h:number,colour:(x:number,y:number)=>number[]):{width:number;height:number;data:Uint8Array}{const data=new Uint8Array(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set(colour(x,y),(y*w+x)*4);return{width:w,height:h,data};}
function selectedPixels(source:Uint8Array,forceCharge=0){const original=new Uint8Array(source),result=encodeImage({mimeType:'image/png',data:source},{decoderCostBytes:forceCharge}),decoded=decodeImageRecipe(result.recipe),expected=decodePng(original);assert.deepEqual(source,original);const got=decoded.kind==='rgba'?decoded.rgba:decodePng(decoded.data).data;assert.deepEqual(got,expected.data);assert.equal(result.metrics.decodedRGBAExact,true);assert.equal(result.metrics.candidates.find(c=>c.codec===result.recipe.codec&&c.payloadBytes===result.recipe.data.length)!.totalBytes,Math.min(...result.metrics.candidates.map(c=>c.totalBytes)));return result;}
function serial(recipe:ImageRecipe):string{return JSON.stringify({...recipe,data:Buffer.from(recipe.data).toString('hex')});}
test('varied source-derived dimensions, flat colors and alpha retain all RGBA including hidden transparent RGB',()=>{
 for(const[w,h]of [[1,1],[7,19],[63,37],[128,257],[513,65]]){
  const source=encodePng(rgbaImage(w!,h!,(x,y)=>[(x%7)*37,(y%5)*51,(x+y)%2?207:17,[0,1,127,255][(x+y)%4]!]));const out=selectedPixels(source);
  assert.equal(serial(out.recipe),serial(selectedPixels(new Uint8Array(source)).recipe));const regenerated=imageRecipeToBytes(out.recipe);assert.deepEqual(decodePng(regenerated.data).data,decodePng(source).data);
 }
});
test('RGB8 and indexed PNG bit depths 1/2/4/8 with tRNS decode independently generated colors',()=>{
 const w=193,h=129,raw=new Uint8Array(h*(w*3+1)),expected=new Uint8Array(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const c=[x&255,y&255,(x^y)&255];raw.set(c,y*(w*3+1)+1+x*3);expected.set([...c,255],(y*w+x)*4)}
 const rgb=png(w,h,2,8,raw);assert.deepEqual(decodePng(rgb).data,expected);selectedPixels(rgb);
 for(const depth of[1,2,4,8]){
  const n=2**depth,pal=Uint8Array.from({length:n*3},(_,i)=>(i*67+19)&255),alpha=Uint8Array.from({length:n},(_,i)=>(i*71)&255),stride=Math.ceil(w*depth/8),scan=new Uint8Array(h*(stride+1)),exact=new Uint8Array(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let i=(x+y)%n,bit=x*depth;scan[y*(stride+1)+1+Math.floor(bit/8)]!|=i<<(8-depth-bit%8);exact.set([...pal.subarray(i*3,i*3+3),alpha[i]!],(y*w+x)*4)}
  const source=png(w,h,3,depth,scan,[['PLTE',pal],['tRNS',alpha]]);assert.deepEqual(decodePng(source).data,exact);selectedPixels(source);
 }
});
test('supported pHYs is retained byte-for-byte through generated PNG; color material interpretation is explicit',()=>{
 const w=128,h=128,scan=new Uint8Array(h*(w*4+1));for(let y=0;y<h;y++)for(let x=0;x<w;x++)scan.set([27,156,211,200],y*(w*4+1)+1+x*4);
 const phys=Uint8Array.from([0,0,14,196,0,0,14,196,1]),source=png(w,h,6,8,scan,[['pHYs',phys]]),out=selectedPixels(source);
 // Stored-block PNG makes optimization beneficial even after metadata overhead.
 const stored=encodePng(rgbaImage(w,h,()=>[27,156,211,200]));const withPhys=join([stored.subarray(0,33),chunk('pHYs',phys),stored.subarray(33)]),r=selectedPixels(withPhys);
 const d=decodeImageRecipe(r.recipe);assert.equal(d.kind,'rgba');if(d.kind==='rgba'){assert.deepEqual(d.colourMetadata.ancillaryChunks,[{type:'pHYs',data:Array.from(phys)}]);assert.equal(d.colourMetadata.interpretation,'source-image-and-material-unchanged')}
 const again=imageRecipeToBytes(r.recipe).data;assert.deepEqual(again.subarray(33+8,33+17),phys);assert.equal(out.metrics.eligiblePNG,true);
});
test('JPEG, profiles, gamma, unknown ancillary chunks, RGB tRNS, interlace and 16-bit preserve original bytes',()=>{
 const base=new Uint8Array([0,3,4,5,255]);
 for(const[type,bytes]of [['gAMA',new Uint8Array([0,0,177,143])],['sRGB',new Uint8Array([0])],['iCCP',new Uint8Array([65,0,0,120,1])],['cHRM',new Uint8Array(32)],['tEXt',new Uint8Array([97,0,98])],['bKGD',new Uint8Array(6)],['acTL',new Uint8Array(8)] ] as Array<[string,Uint8Array]>){const source=png(1,1,6,8,base,[[type,bytes]]),result=encodeImage({mimeType:'image/png',data:source},{decoderCostBytes:0}),decoded=decodeImageRecipe(result.recipe);assert.equal(decoded.kind,'original');if(decoded.kind==='original')assert.deepEqual(decoded.data,source);assert.equal(result.metrics.eligiblePNG,false);assert.match(result.metrics.fallbackReason!,/metadata\/chunk/)}
 for(const source of[png(1,1,2,8,Uint8Array.from([0,1,2,3]),[['tRNS',new Uint8Array(6)]]),png(1,1,6,8,base,[],{12:1}),png(1,1,6,16,new Uint8Array(9))]){const result=encodeImage({mimeType:'image/png',data:source});assert.equal(result.metrics.eligiblePNG,false);const got=decodeImageRecipe(result.recipe);assert.equal(got.kind,'original');if(got.kind==='original')assert.deepEqual(got.data,source)}
 const jpeg=Uint8Array.from([255,216,255,224,1,2,3,255,217]),r=encodeImage({mimeType:'image/jpeg',data:jpeg}),d=decodeImageRecipe(r.recipe);assert.equal(d.kind,'original');if(d.kind==='original')assert.deepEqual(d.data,jpeg);
});
test('original image competes with complete measured decoder cost; source bytes and outputs are owned',()=>{
 const source=encodePng(rgbaImage(128,128,(x,y)=>x<y*.8+12?[20,170,95,255]:[201,75,217,0])),a=encodeImage({mimeType:'image/png',data:source},{decoderCostBytes:0}),b=encodeImage({mimeType:'image/png',data:source},{decoderCostBytes:1e6});assert.equal(decodeImageRecipe(a.recipe).kind,'rgba');assert.equal(decodeImageRecipe(b.recipe).kind,'original');
 const candidate=a.metrics.candidates.find(c=>c.codec===a.recipe.codec)!;assert.equal(candidate.decoderBytes,0);assert(IMAGE_SHARED_DECODER_COST_BYTES>0);
 const tiny=Uint8Array.from([1,2,3]),r=encodeImage({mimeType:'image/jpeg',data:tiny});tiny[0]=9;const d=decodeImageRecipe(r.recipe);assert.equal(d.kind,'original');if(d.kind==='original'){assert.equal(d.data[0],1);d.data[0]=42;assert.equal(r.recipe.data[0],1)}
});
test('source-derived blend predictor preserves off-line colors and varying alpha exactly',()=>{
 const w=431,h=149,image=rgbaImage(w,h,(x,y)=>x<w/2?[17,213,91,0]:[242,35,169,255]);
 for(let y=0;y<h;y++)for(let x=205;x<225;x++){const t=(x-205)/20;image.data.set([Math.round(17*(1-t)+242*t)+(y%5),Math.round(213*(1-t)+35*t),Math.round(91*(1-t)+169*t),Math.round(255*t)],(y*w+x)*4)}
 const result=selectedPixels(encodePng(image));assert(result.metrics.candidates.some(c=>c.codec==='palette-blend-zlib'));assert.equal(result.metrics.uniqueColours!>2,true);
});
test('malformed recipes fail closed: allocation bounds, CRC, truncation, row commands, metadata and residual positions',()=>{
 const source=encodePng(rgbaImage(128,128,(x,y)=>x<y*.8+12?[20,170,95,255]:[201,75,217,0])),e=selectedPixels(source).recipe;assert.notEqual(e.codec,'original');assert.notEqual(e.codec,'original-zlib');
 for(const patch of[{width:IMAGE_MAX_PIXELS,height:2},{decodedLength:2**31},{rgbaCRC32:(e.rgbaCRC32!+1)>>>0},{version:2},{mimeType:'image/jpeg'},{data:e.data.slice(0,-1)},{colourMetadata:{...e.colourMetadata,gamma:0.45}}])assert.throws(()=>decodeImageRecipe({...e,...patch} as ImageRecipe));
 if(e.codec==='palette-rows-zlib'){const raw=unzlibSync(e.data);raw[0]=0;assert.throws(()=>decodeImageRecipe({...e,data:zlibSync(raw)}))}
 const bomb=zlibSync(new Uint8Array(1024));assert.throws(()=>decodeImageRecipe({...e,decodedLength:1,data:bomb}));
 const plain=Uint8Array.from([2,1,2,3,4,5,6,7,8,2,1,0,1,0]);const tiny:ImageRecipe={...e,codec:'palette-blend-zlib',width:1,height:1,decodedLength:plain.length,data:zlibSync(plain),rgbaCRC32:crc32(Uint8Array.from([1,2,3,4]))};const d=decodeImageRecipe(tiny);assert.equal(d.kind,'rgba');if(d.kind==='rgba')assert.deepEqual(d.rgba,Uint8Array.from([1,2,3,4]));
 const badPosition=Uint8Array.from([...plain.subarray(0,-1),1,1]);assert.throws(()=>decodeImageRecipe({...tiny,data:zlibSync(badPosition),decodedLength:badPosition.length}),/position/);
});
test('browser-target standalone bundle executes deterministically without Node builtins',async()=>{
 const output=await build({stdin:{contents:"export {encodeImage,decodeImageRecipe,imageRecipeToBytes} from './packages/import/src/asset-image-codec-v3.ts';",resolveDir:new URL('../../..',import.meta.url).pathname,sourcefile:'image-browser-entry.ts'},bundle:true,minify:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 const bundle=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0]!.contents).toString('base64'));
 const source=encodePng(rgbaImage(129,83,(x,y)=>[(x%4)*61,(y%3)*73,29,(x+y)%7?255:0])),native=encodeImage({mimeType:'image/png',data:source},{decoderCostBytes:0}),other=bundle.encodeImage({mimeType:'image/png',data:new Uint8Array(source)},{decoderCostBytes:0});assert.equal(serial(native.recipe),serial(other.recipe));assert.deepEqual(decodeImageRecipe(native.recipe),bundle.decodeImageRecipe(other.recipe));assert.equal(createHash('sha256').update(native.recipe.data).digest('hex'),createHash('sha256').update(other.recipe.data).digest('hex'));
});
