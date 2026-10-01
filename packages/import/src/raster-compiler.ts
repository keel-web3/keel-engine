import { buildFromPackage } from './asset-replay-v6.ts';
import { normalizeAsset } from './asset-normalize-v3.ts';
import type { NormalizedAsset, NormalizeAssetInput } from './asset-normalize-v3.ts';
import { renderSpriteFrames } from './sprite-raster.ts';
import type { SpriteRasterOptions } from './sprite-raster.ts';
import { encodeSpriteFrames } from './sprite-frame-codec.ts';
import { createRasterAsset, importRasterEnvelope } from './raster-asset.ts';
import { unpackAsset } from './asset-binary-v3.ts';
import type { ScreenId } from '@keel-engine/core';
export type RasterCompileSettings=SpriteRasterOptions&{paletteSize:8|16|32|64;kind:'pixel'|'dither';screen:ScreenId;name?:string};
async function compileNormalized(normalized:NormalizedAsset,input:RasterCompileSettings,start:number,preparation:string){
 const prepared=performance.now(),raster=renderSpriteFrames(normalized,input);input.onProgress?.({stage:'raster-palette-codec',done:0,total:1});const encoded=encodeSpriteFrames({width:raster.width,height:raster.height,frames:raster.frames,paletteSize:input.paletteSize,kind:input.kind,screen:input.screen});
 const assetBytes=await createRasterAsset({recipe:encoded.recipe,animation:raster.animation,name:input.name??'Raster sprite',attribution:normalized.json.asset,camera:{azimuth:input.azimuth??.65,elevation:input.elevation??.25},renderer:raster.report.renderer});const imported=await importRasterEnvelope(unpackAsset(assetBytes));
 for(let f=0;f<encoded.frames.length;f++)if(encoded.frames[f]!.some((v,i)=>v!==imported.raster.frames[f]![i]))throw Error('Raster codec replay changed pixels');
 const hash=async(b:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(b)))).map(v=>v.toString(16).padStart(2,'0')).join('');
 return{assetBytes,imported,report:{mode:'raster-sprite-lossy',preparation,assetBytes:assetBytes.length,assetSha256:await hash(assetBytes),reconstructedGlbSha256:await hash(imported.glb),raster:raster.report,codec:encoded.report,animation:raster.animation,sourceModelRemoved:true,sourceTexturesRemoved:true,decodedPixelsExactToRecipe:true},timings:{preparation:prepared-start,raster:raster.report.ms,total:performance.now()-start}};
}
/** Use an already prepared native package without re-importing original files. */
export async function compileRasterStyledAsset(input:RasterCompileSettings&{packageBytes:Uint8Array;dracoDecoder?:any}){
 const start=performance.now();input.onProgress?.({stage:'raster-source-replay',done:0,total:1});const source=await buildFromPackage(input.packageBytes,{dracoDecoder:input.dracoDecoder});const normalized=await normalizeAsset({entry:'source.glb',files:[{name:'source.glb',data:source.glb}]});return compileNormalized(normalized,input,start,'prepared-native-package');
}
/** Preferred new-upload path: decode source once, without an unnecessary 3D codec pass. */
export async function compileRasterSourceAsset(input:RasterCompileSettings&NormalizeAssetInput){
 const start=performance.now();input.onProgress?.({stage:'raster-source-normalize',done:0,total:1});const normalized=await normalizeAsset(input);return compileNormalized(normalized,input,start,'direct-source');
}
