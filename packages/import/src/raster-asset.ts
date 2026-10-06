/** Replay-only, declarative sampled sprites. No source mesh, textures or rig. */
import { SCREENS } from '@keel-engine/core';
import { decodeSpriteFrames, rehydrateSpriteFrames } from './sprite-frame-codec.ts';
import type { SpriteFrameRecipe } from './sprite-frame-codec.ts';
import { packAsset } from './asset-binary-v3.ts';
import { writeNativeGlb } from './asset-native-base-v3.ts';
import { encodePng } from './png.ts';
export const RASTER_DEPENDENCIES = Object.freeze({runtime:'keel-styled-asset-5.0.0',rasterCodec:'keel-sprite-frames-v1','@keel-engine/import':'0.1.0',fflate:'0.8.2',renderer:'three@0.180.0'});
export const RASTER_CHUNK_DEPENDENCIES=Object.freeze({...RASTER_DEPENDENCIES,runtime:'keel-styled-asset-7.0.0',rasterCodec:'keel-sprite-frames-v2'});
function dependenciesFor(recipe:SpriteFrameRecipe){return recipe.version===2||recipe.kind==='original'||recipe.width>512||recipe.height>512?RASTER_CHUNK_DEPENDENCIES:RASTER_DEPENDENCIES;}
export interface RasterAnimation {name:string;sourceClip:number|null;start:number;duration:number;frameCount:number;fps:number;directions:number;order:'direction-major'}
function object(x:any,keys:string[],label:string){if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!keys.includes(k)))throw Error('Invalid raster '+label);}
export async function createRasterAsset(input:{recipe:SpriteFrameRecipe;animation:RasterAnimation;name:string;attribution:any;camera:{azimuth:number;elevation:number};renderer:string}){
  const envelope={format:'KEEL-STYLED-ASSET',version:5,name:input.name,dependencies:dependenciesFor(input.recipe),native:{encoding:'raster-frames',byteLength:0,dracoRequired:false},style:{kind:input.recipe.kind,pixelSize:1,toneLevels:input.recipe.palette.length/3,screen:input.recipe.screen},animation:{mode:'baked-frames'},raster:{recipe:input.recipe,animation:input.animation,camera:input.camera,renderer:input.renderer},attribution:input.attribution};
  await importRasterEnvelope(envelope);return packAsset(envelope);
}
export async function importRasterEnvelope(e:any){return importRasterEnvelopeWithFrames(e,decodeSpriteFrames);}
/** Restore the non-cloneable frame reader after a validated Worker import.
 * Metadata is revalidated immediately. Each chunk is fully decoded and checked
 * before its first displayed frame; normal file import remains eager. */
export async function rehydrateRasterAsset(asset:any){
  if(asset?.format!=='KEEL-IMPORTED-STYLED-ASSET'||asset.version!==5||!asset.raster)throw Error('Import a raster asset before rehydrating Worker data');
  return importRasterEnvelopeWithFrames(asset.envelope,rehydrateSpriteFrames);
}
async function importRasterEnvelopeWithFrames(e:any,decodeFrames:typeof decodeSpriteFrames){
  object(e,['format','version','name','dependencies','native','style','animation','raster','attribution'],'envelope');if(e.format!=='KEEL-STYLED-ASSET'||e.version!==5||typeof e.name!=='string'||e.name.length>240)throw Error('Unsupported raster asset');
  const dependencies=dependenciesFor(e.raster?.recipe??{});
  object(e.dependencies,Object.keys(dependencies),'dependencies');for(const[k,v]of Object.entries(dependencies))if(e.dependencies[k]!==v)throw Error('Unsupported raster dependency');
  object(e.native,['encoding','byteLength','dracoRequired'],'native');if(e.native.encoding!=='raster-frames'||e.native.byteLength!==0||e.native.dracoRequired!==false)throw Error('Raster asset must not retain source model');
  object(e.animation,['mode'],'animation');if(e.animation.mode!=='baked-frames')throw Error('Raster animation mode differs');
  object(e.raster,['recipe','animation','camera','renderer'],'data');const r=e.raster,a=r.animation;
  object(a,['name','sourceClip','start','duration','frameCount','fps','directions','order'],'clip');if(typeof a.name!=='string'||a.name.length>240||a.order!=='direction-major'||!Number.isInteger(a.frameCount)||a.frameCount<1||a.frameCount>0xffffffff-1||![1,4,8].includes(a.directions)||!Number.isFinite(a.duration)||a.duration<0||!Number.isFinite(a.start)||a.start<0||!Number.isFinite(a.fps)||a.fps<=0||a.sourceClip!==null&&(!Number.isSafeInteger(a.sourceClip)||a.sourceClip<0))throw Error('Invalid raster clip metadata');
  if(a.duration===0&&a.frameCount!==1||a.duration>0&&Math.abs(a.fps-a.frameCount/a.duration)>Math.max(1,a.fps)*1e-10||a.sourceClip===null&&(a.duration!==0||a.frameCount!==1||a.start!==0))throw Error('Contradictory raster clip timing');
  object(r.camera,['azimuth','elevation'],'camera');if(!Number.isFinite(r.camera.azimuth)||!Number.isFinite(r.camera.elevation)||Math.abs(r.camera.elevation)>1.45||r.renderer!=='keel-import-cpu-orthographic-base-color-v1')throw Error('Unsupported raster camera/renderer');
  const recipe=r.recipe,frames=decodeFrames(recipe);if(frames.length!==a.frameCount*a.directions)throw Error('Raster clip/frame count differs');
  object(e.style,['kind','pixelSize','toneLevels','screen'],'style');if(e.style.kind!==recipe.kind||e.style.screen!==recipe.screen||!Object.hasOwn(SCREENS,e.style.screen)||e.style.pixelSize!==1||e.style.toneLevels!==recipe.palette.length/3)throw Error('Raster style metadata differs');
  const width=recipe.width,height=recipe.height,png=encodePng({width,height,data:frames[0]!}),aspect=width/height;
  const accessors=[new Float32Array([-aspect,-1,0,aspect,-1,0,aspect,1,0,-aspect,1,0]),new Float32Array([0,1,1,1,1,0,0,0]),new Uint16Array([0,1,2,0,2,3])];
  const json:any={asset:{version:'2.0',generator:'KEEL raster sprite v1',...(e.attribution&&typeof e.attribution==='object'?{extras:{sourceAttribution:e.attribution}}:{})},accessors:[{componentType:5126,type:'VEC3',count:4,min:[-aspect,-1,0],max:[aspect,1,0]},{componentType:5126,type:'VEC2',count:4},{componentType:5123,type:'SCALAR',count:6}],images:[{name:'First sprite frame'}],textures:[{source:0,sampler:0}],samplers:[{magFilter:9728,minFilter:9728,wrapS:33071,wrapT:33071}],materials:[{name:'Raster frame',doubleSided:true,alphaMode:'BLEND',pbrMetallicRoughness:{baseColorTexture:{index:0},metallicFactor:0,roughnessFactor:1},extensions:{KHR_materials_unlit:{}}}],extensionsUsed:['KHR_materials_unlit'],meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},indices:2,material:0,mode:4}]}],nodes:[{name:e.name,mesh:0}],scenes:[{nodes:[0]}],scene:0};
  const images=[{mimeType:'image/png',data:png}],glb=writeNativeGlb(json,accessors,images);
  const raster={width,height,frames:recipe.version===2?[]:frames,frameCount:frames.length,chunked:recipe.version===2,getFrame:(index:number)=>{if(!Number.isSafeInteger(index)||index<0||index>=frames.length)throw Error('Invalid raster frame index');return frames[index]!;},animation:a as RasterAnimation,camera:r.camera,renderer:r.renderer};
  Object.defineProperty(raster,'getFrame',{enumerable:false});
  return{format:'KEEL-IMPORTED-STYLED-ASSET' as const,version:5 as const,name:e.name as string,style:e.style,conversion:{mode:'raster-sprite-lossy',sourceGeometryRemoved:true,sourceTexturesRemoved:true,sourceAnimationRemoved:true,animationBaked:true},sourceBounds:null,nativeScene:{format:'KEEL-NATIVE-SCENE',version:2,json,accessors,images,primitives:[]},glb,sourceGlb:glb,reconstructedGlb:glb,animation:{mode:'baked-frames' as const,clips:a.sourceClip===null?0:1,skins:0},voxel:null,voxelMesh:null,raster,envelope:e};
}
