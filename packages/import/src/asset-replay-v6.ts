/** v6 composes the frozen exact-image replay component with the existing native
 * formats. Source fidelity belongs to the outer mode, not the internal lossless
 * byte-transport adapter used to reconstruct an already approved lossy scene. */
import {unpackAsset,packAsset} from './asset-binary-v3.ts';
import {buildAsset as replayV5,COMPILER_VERSION as V5_VERSION,V5_FORMAT} from './asset-replay-v5.ts';
import {buildFromPackage as replayShared} from './asset-replay-shared.ts';
export const COMPILER_VERSION='keel-native-asset-compiler-0.6.0';
export const V6_FORMAT='KEEL-NATIVE-V6';
export async function buildAsset(recipe:any,options:{dracoDecoder?:any}={}){
 if(recipe?.format===V6_FORMAT){
  if(recipe.compilerVersion!==COMPILER_VERSION||recipe.mode!=='bounded-lossy')throw Error('Invalid v6 lossy recipe');
  return replayV5({format:V5_FORMAT,compilerVersion:V5_VERSION,mode:'lossless',base:recipe.base,images:recipe.images},options);
 }
 if(recipe?.format===V5_FORMAT)return replayV5(recipe,options);
 return replayShared(packAsset(recipe));
}
export async function buildFromPackage(data:Uint8Array,options:{dracoDecoder?:any}={}){return buildAsset(unpackAsset(data),options)}
export async function decodePackage(data:Uint8Array,options:{dracoDecoder?:any}={}){const b=await buildFromPackage(data,options);return{entry:'asset.glb',files:[{name:'asset.glb',data:b.glb}],nativeScene:b.scene,representation:'native-code'}}
