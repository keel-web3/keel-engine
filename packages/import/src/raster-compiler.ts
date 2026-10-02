import { buildFromPackage } from './asset-replay-v6.ts';
import { normalizeAsset } from './asset-normalize-v3.ts';
import type { NormalizedAsset, NormalizeAssetInput } from './asset-normalize-v3.ts';
import { renderSpriteFramesBounded, preflightSpriteRaster, checkRasterAbort, RasterResourceLimitError } from './sprite-raster.ts';
export { RasterResourceLimitError } from './sprite-raster.ts';
import type { SpriteRasterOptions } from './sprite-raster.ts';
import { encodeSpriteFrames, encodeSpriteFrameCandidates, encodeChunkedSpriteFrames, SpriteFrameResourceLimitError } from './sprite-frame-codec.ts';
import { createRasterAsset, importRasterEnvelope } from './raster-asset.ts';
import { packAsset, unpackAsset } from './asset-binary-v3.ts';
import type { ScreenId } from '@keel-engine/core';
export interface SpriteCostCodec {
 id:string;
 compress:(bytes:Uint8Array)=>Uint8Array|Promise<Uint8Array>;
 /** If available, every candidate is round-trip checked before selection. */
 decompress?:(bytes:Uint8Array)=>Uint8Array|Promise<Uint8Array>;
}
export type RasterCompileSettings=SpriteRasterOptions&{paletteSize:8|16|32|64;kind:'pixel'|'dither'|'original';screen:ScreenId;name?:string;costCodec?:SpriteCostCodec};
async function compileNormalized(normalized:NormalizedAsset,input:RasterCompileSettings,start:number,preparation:string){
 const costCodec=input.costCodec;if(costCodec&&(typeof costCodec.id!=='string'||!costCodec.id.length||costCodec.id.length>240||typeof costCodec.compress!=='function'||costCodec.decompress!==undefined&&typeof costCodec.decompress!=='function'))throw Error('Invalid sprite cost codec');
 const prepared=performance.now(),raster=await renderSpriteFramesBounded(normalized,input);input.onProgress?.({stage:'raster-palette-codec',done:0,total:1});const frames={width:raster.width,height:raster.height,frames:raster.frames,paletteSize:input.paletteSize,kind:input.kind,screen:input.screen};
 const codecStarted=performance.now(),chunked=frames.frames.length>256||frames.width*frames.height*frames.frames.length>1048576;
 const candidateEncoding=costCodec&&!chunked?encodeSpriteFrameCandidates(frames):null;
 let encoded;try{encoded=chunked?await encodeChunkedSpriteFrames(frames,{...input,maxWorkingBytes:(input.maxWorkingBytes??256*1024*1024)-raster.report.sourceSpoolBytes}):candidateEncoding??encodeSpriteFrames(frames);}catch(error){if(error instanceof SpriteFrameResourceLimitError){const preflight=preflightSpriteRaster(normalized,input),actual=error.actual+raster.report.sourceSpoolBytes,maximum=input.maxWorkingBytes??256*1024*1024;throw new RasterResourceLimitError({...preflight,allowed:false,limits:[{code:'encoded-working-memory',actual,maximum,message:error.message}],adjustments:[{control:'maxWorkingBytes',value:Math.ceil(actual*1.5),reason:'Allow the estimated encoded working set if host memory is available; selected quality is unchanged'}]});}throw error;}
 const paletteEncoding=performance.now()-codecStarted;
 checkRasterAbort(input.signal);
 const transportStarted=performance.now();
 const create=(recipe:typeof encoded.recipe)=>createRasterAsset({recipe,animation:raster.animation,name:input.name??'Raster sprite',attribution:normalized.json.asset,camera:{azimuth:input.azimuth??.65,elevation:input.elevation??.25},renderer:raster.report.renderer});
 let assetBytes=await create(encoded.recipe),selected=encoded.recipe,minimum=Infinity;
 const transportCandidates:Array<{encoding:string;assetBytes:number;transportBytes:number}>=[];
 if(costCodec)for(const recipe of candidateEncoding?.candidateRecipes??[encoded.recipe]){
  checkRasterAbort(input.signal);
  input.onProgress?.({stage:'raster-transport-cost',done:transportCandidates.length,total:candidateEncoding?.candidateRecipes.length??1});
  const bytes=await create(recipe),compressed=await costCodec.compress(new Uint8Array(bytes));
  if(!(compressed instanceof Uint8Array)||!compressed.length)throw Error('Sprite cost codec returned invalid bytes');
  if(costCodec.decompress){const restored=await costCodec.decompress(new Uint8Array(compressed));if(!(restored instanceof Uint8Array)||restored.length!==bytes.length||restored.some((v,i)=>v!==bytes[i]))throw Error('Sprite transport round-trip differs');}
  transportCandidates.push({encoding:recipe.encoding,assetBytes:bytes.length,transportBytes:compressed.length});
  if(compressed.length<minimum){minimum=compressed.length;assetBytes=bytes;selected=recipe;}
 }
 const transportSelection=performance.now()-transportStarted,imported=await importRasterEnvelope(unpackAsset(assetBytes));
 for(let f=0;f<encoded.frames.length;f++){checkRasterAbort(input.signal);const replay=imported.raster.getFrame(f);if(encoded.frames[f]!.some((v,i)=>v!==replay[i]))throw Error('Raster codec replay changed pixels');if(f%32===0)await new Promise<void>(resolve=>setTimeout(resolve,0));}
 const hash=async(b:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(b)))).map(v=>v.toString(16).padStart(2,'0')).join('');
 const codec={...encoded.report,selected:selected.encoding,payloadBytes:selected.data.length,serializedBytes:packAsset(selected).length,metadataBytes:packAsset(selected).length-selected.data.length,...(costCodec?{selectionBasis:chunked?'Bounded chunks preserve one global palette; complete chunked asset transport measured and verified.':input.kind==='original'?'Exact rendered RGBA; complete asset transport measured and verified.':'Smallest measured complete .keelasset transport; indexed, delta, tiles, then RGBA break ties. Every candidate contains the same quantized frames.',transport:{codec:costCodec.id,bytes:minimum,roundTripVerified:!!costCodec.decompress,candidates:transportCandidates}}:{})};
 return{assetBytes,imported,report:{mode:'raster-sprite-lossy',preparation,representation:'baked-2d-sprite',fidelity:{freeCamera:false,selectedClip:input.clipIndex,otherClipsRetained:false,bakedDirections:input.directions,sourceModelRetained:false},settings:{resolution:raster.width===raster.height?raster.width:null,width:raster.width,height:raster.height,paletteSize:input.paletteSize,fps:input.fps,directions:input.directions,kind:input.kind,shading:input.shading??'diffuse'},assetBytes:assetBytes.length,assetSha256:await hash(assetBytes),reconstructedGlbSha256:await hash(imported.glb),raster:raster.report,codec,animation:raster.animation,sourceModelRemoved:true,sourceTexturesRemoved:true,decodedPixelsExactToRecipe:true},timings:{preparation:prepared-start,raster:raster.report.ms,paletteEncoding,transportSelection,total:performance.now()-start}};
}
/** Use an already prepared native package without re-importing original files. */
export async function compileRasterStyledAsset(input:RasterCompileSettings&{packageBytes:Uint8Array;dracoDecoder?:any}){
 const start=performance.now();checkRasterAbort(input.signal);input.onProgress?.({stage:'raster-source-replay',done:0,total:1});const source=await buildFromPackage(input.packageBytes,{dracoDecoder:input.dracoDecoder});const normalized=await normalizeAsset({entry:'source.glb',files:[{name:'source.glb',data:source.glb}]});return compileNormalized(normalized,input,start,'prepared-native-package');
}
/** Preferred new-upload path: decode source once, without an unnecessary 3D codec pass. */
export async function compileRasterSourceAsset(input:RasterCompileSettings&NormalizeAssetInput){
 const start=performance.now();checkRasterAbort(input.signal);input.onProgress?.({stage:'raster-source-normalize',done:0,total:1});const normalized=await normalizeAsset(input);return compileNormalized(normalized,input,start,'direct-source');
}

/** Compact Pixel sprite is a deliberately selected 2D representation. Defaults
 * use flat source colors and one stable palette/grid across the entire clip.
 * Pixel-styled 3D continues to use compileStyledAsset with native geometry. */
export const PIXEL_SPRITE_PRESETS=Object.freeze({
 small:Object.freeze({resolution:32 as const,paletteSize:8 as const,fps:8,directions:1 as const,shading:'unlit' as const}),
 balanced:Object.freeze({resolution:64 as const,paletteSize:16 as const,fps:8,directions:1 as const,shading:'unlit' as const}),
 detailed:Object.freeze({resolution:128 as const,paletteSize:32 as const,fps:12,directions:1 as const,shading:'unlit' as const}),
});
export interface PixelSpriteSettings {
 representation:'sprite';
 clipIndex:number|null;
 preset?:keyof typeof PIXEL_SPRITE_PRESETS;
 quality?:Partial<Pick<RasterCompileSettings,'resolution'|'width'|'height'|'maxWorkingBytes'|'paletteSize'|'fps'|'directions'|'azimuth'|'elevation'|'shading'>>;
 name?:string;costCodec?:SpriteCostCodec;signal?:AbortSignal;onProgress?:NonNullable<RasterCompileSettings['onProgress']>;
}
function pixelSpriteSettings(input:PixelSpriteSettings){
 if(input.representation!=='sprite')throw Error('Choose the fixed-view sprite representation explicitly; pixel-styled 3D uses compileStyledAsset');
 const preset=input.preset??'balanced';if(!Object.hasOwn(PIXEL_SPRITE_PRESETS,preset))throw Error('Unknown Pixel sprite quality preset');
 if(input.quality&&Object.keys(input.quality).some(key=>!['resolution','width','height','maxWorkingBytes','paletteSize','fps','directions','azimuth','elevation','shading'].includes(key)))throw Error('Unknown Pixel sprite quality control');
 return{...PIXEL_SPRITE_PRESETS[preset],...input.quality,clipIndex:input.clipIndex,kind:'pixel' as const,screen:'bayer4' as const,...(input.name===undefined?{}:{name:input.name}),...(input.costCodec===undefined?{}:{costCodec:input.costCodec}),...(input.onProgress===undefined?{}:{onProgress:input.onProgress}),...(input.signal===undefined?{}:{signal:input.signal})};
}
export async function compilePixelSpriteSourceAsset(input:PixelSpriteSettings&NormalizeAssetInput){
 return compileRasterSourceAsset({...input,...pixelSpriteSettings(input)});
}
export async function compilePixelSpriteStyledAsset(input:PixelSpriteSettings&{packageBytes:Uint8Array;dracoDecoder?:any}){
 return compileRasterStyledAsset({...input,...pixelSpriteSettings(input)});
}

export async function preflightRasterSourceAsset(input:RasterCompileSettings&NormalizeAssetInput){checkRasterAbort(input.signal);return preflightSpriteRaster(await normalizeAsset(input),input);}
export async function preflightRasterStyledAsset(input:RasterCompileSettings&{packageBytes:Uint8Array;dracoDecoder?:any}){checkRasterAbort(input.signal);const source=await buildFromPackage(input.packageBytes,{dracoDecoder:input.dracoDecoder});return preflightRasterSourceAsset({...input,entry:'source.glb',files:[{name:'source.glb',data:source.glb}]});}
