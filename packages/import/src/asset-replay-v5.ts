/** Shared runtime for exact decoded images and fixed-material render inputs. */
import {packAsset,unpackAsset} from './asset-binary-v3.ts';
import {buildFromPackage as replayShared,RAW_TRANSPORT_FORMAT} from './asset-replay-shared.ts';
import {buildMixedAsset,MIXED_FORMAT} from './asset-replay-mixed.ts';
import {replayExactPngScanlines} from './optimization/exact-images-experiment.ts';
import {sharedDracoDecoder} from './asset-draco-runtime.ts';
export const COMPILER_VERSION='keel-native-asset-compiler-0.5.0';
export const V5_FORMAT='KEEL-NATIVE-V5';
export function nativeBody(recipe:any):any {
 let r=recipe;if(r?.format===MIXED_FORMAT)r=r.base;if(r?.format===RAW_TRANSPORT_FORMAT)r=r.recipe;
 if(r?.format!=='KEEL-NATIVE-V4')throw Error('v5 requires a native v4 inner recipe');return r;
}
export async function buildAsset(recipe:any,options:{dracoDecoder?:any}={}){
 if(recipe?.format!==V5_FORMAT||recipe.compilerVersion!==COMPILER_VERSION||!['lossless','visual-preservation'].includes(recipe.mode)||!Array.isArray(recipe.images))throw Error('Invalid native v5 recipe');
 const base=structuredClone(recipe.base),body=nativeBody(base),images=body.native?.base?.images,seen=new Set<number>();if(!Array.isArray(images)||recipe.images.length>images.length)throw Error('Invalid v5 image table');
 let total=0;for(const item of recipe.images){const id=item?.image,r=item?.recipe;if(!Number.isSafeInteger(id)||id<0||!images[id]||seen.has(id)||images[id].mimeType!=='image/png'||images[id].data!==null||body.native.images.some((x:any)=>x.image===id)||!(r?.scanlines instanceof Uint8Array)||(total+=r.scanlines.length)>128*1024*1024)throw Error('Invalid or overlapping exact PNG override');seen.add(id);}
 for(const item of recipe.images){const data=replayExactPngScanlines(item.recipe);images[item.image]={mimeType:'image/png',data:{codec:'raw',parameters:{version:1},sourceLength:data.length,data}};body.native.images=body.native.images.filter((x:any)=>x.image!==item.image);}
 if(base.format===MIXED_FORMAT)return buildMixedAsset(base,{dracoDecoder:options.dracoDecoder??sharedDracoDecoder()});
 return replayShared(packAsset(base));
}
export async function buildFromPackage(data:Uint8Array,options:{dracoDecoder?:any}={}){return buildAsset(unpackAsset(data),options)}
export async function decodePackage(data:Uint8Array,options:{dracoDecoder?:any}={}){const b=await buildFromPackage(data,options);return{entry:'asset.glb',files:[{name:'asset.glb',data:b.glb}],nativeScene:b.scene,representation:'native-code'}}
