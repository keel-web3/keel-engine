export {manifest} from './module.ts';
export {createPinballGraphicsGovernor} from './governor.ts';
export type {PinballGraphicsGovernorOptions,PinballGraphicsTiming} from './governor.ts';
import {targetProfile,type TargetProfile} from '@keel-engine/core';
import {resolveTarget,AGE_SCHEMA,DEVICE_SCHEMA,type TargetPlan} from '@keel-engine/targets';

export const PINBALL_GRAPHICS_REVISION='pinball-graphics/2026-10-07.2';
export type PinballGraphicsQuality='low'|'balanced'|'high'|'ultra';
export type PinballGraphicsStyle='pixel'|'dither'|'arcade'|'realistic'|'cartoon';
export interface PinballGraphicsDevice {
 readonly webgl2:boolean; readonly maxTextureSize:number; readonly maxRenderbufferSize:number;
 readonly deviceMemoryGb?:number; readonly logicalCores?:number; readonly saveData?:boolean;
}
export interface PinballGraphicsOptions {
 readonly quality?:PinballGraphicsQuality|'auto'; readonly style?:PinballGraphicsStyle;
 readonly viewport:{readonly width:number;readonly height:number;readonly pixelRatio?:number};
 readonly device?:PinballGraphicsDevice; readonly reducedMotion?:boolean;
}
export interface PinballGraphicsPlan {
 readonly revision:typeof PINBALL_GRAPHICS_REVISION;
 readonly requestedQuality:PinballGraphicsQuality|'auto'; readonly quality:PinballGraphicsQuality; readonly style:PinballGraphicsStyle;
 readonly width:number; readonly height:number; readonly reductions:readonly string[];
 readonly mesh:{readonly around:number;readonly rings:number;readonly instanceBudget:number;readonly cacheMeshes:number;readonly cacheBytes:number;readonly triangleBudget:number};
 readonly shadows:{readonly enabled:boolean;readonly size:number;readonly strength:number};
 readonly lighting:{readonly pointLights:number;readonly ambient:number;readonly bloom:number;readonly mirror:number};
 readonly effects:{readonly particles:number;readonly pulses:number;readonly movingFoliage:number};
 readonly pixelTarget:'16-bit'|'32-bit'|'64-bit'; readonly target:TargetProfile;
 readonly art:{readonly textureSize:number;readonly atlasBytes:number;readonly atlasMaxHeight:number;readonly residentCabinets:number;readonly dither:number;readonly screen:0|2|4|8;readonly outline:number};
 readonly targetPlan:TargetPlan;
}
const QUALITIES=['low','balanced','high','ultra'] as const,STYLES=['pixel','dither','arcade','realistic','cartoon'] as const;
const TIERS=[
 {height:360,pixelHeight:240,width:1024,around:6,rings:1,instances:160,cache:512,bytes:12*1024*1024,triangles:60000,shadow:0,lights:2,bloom:0,mirror:0,particles:32,pulses:12,motion:16,texture:64,atlas:1024*1024,resident:4},
 {height:540,pixelHeight:320,width:1600,around:8,rings:2,instances:320,cache:768,bytes:24*1024*1024,triangles:160000,shadow:512,lights:6,bloom:1,mirror:0,particles:96,pulses:24,motion:48,texture:128,atlas:2*1024*1024,resident:8},
 {height:900,pixelHeight:480,width:2048,around:16,rings:3,instances:720,cache:1024,bytes:48*1024*1024,triangles:400000,shadow:1024,lights:12,bloom:3,mirror:96,particles:256,pulses:48,motion:96,texture:256,atlas:8*1024*1024,resident:16},
 {height:1440,pixelHeight:640,width:2560,around:24,rings:5,instances:1400,cache:1536,bytes:96*1024*1024,triangles:900000,shadow:2048,lights:16,bloom:6,mirror:160,particles:512,pulses:64,motion:192,texture:512,atlas:16*1024*1024,resident:16},
] as const;
const finite=(v:unknown,lo:number,hi:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
const integer=(v:unknown,lo:number,hi:number):v is number=>finite(v,lo,hi)&&Number.isSafeInteger(v);
function record(value:unknown,keys:readonly string[],required:readonly string[]):asserts value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error('Invalid graphics options');
 const own=Reflect.ownKeys(value);if(own.some(k=>typeof k!=='string'||!keys.includes(k))||required.some(k=>!Object.hasOwn(value,k))||own.some(k=>!('value' in Object.getOwnPropertyDescriptor(value,k)!)))throw new Error('Invalid graphics fields');
}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;}
const power2=(n:number)=>2**Math.floor(Math.log2(n));

/** A capability envelope, independent of world/physics. Hints can lower an
 * initial request; actual browser/device timing must qualify performance.
 * Unknown devices start balanced in auto. Retro targets here are art presets,
 * not a claim that this live-mesh game compiles for a console. */
export function resolvePinballGraphics(options:PinballGraphicsOptions):PinballGraphicsPlan {
 record(options,['quality','style','viewport','device','reducedMotion'],['viewport']);
 const requested=options.quality??'auto',style=options.style??'pixel';
 if(!['auto',...QUALITIES].includes(requested)||!STYLES.includes(style)||options.reducedMotion!==undefined&&typeof options.reducedMotion!=='boolean')throw new Error('Invalid graphics request');
 record(options.viewport,['width','height','pixelRatio'],['width','height']);
 const {width,height}=options.viewport,dpr=options.viewport.pixelRatio??1;
 if(!finite(width,1,65535)||!finite(height,1,65535)||!finite(dpr,.25,8))throw new Error('Invalid graphics viewport');
 const device=options.device??{webgl2:true,maxTextureSize:2048,maxRenderbufferSize:2048};
 record(device,['webgl2','maxTextureSize','maxRenderbufferSize','deviceMemoryGb','logicalCores','saveData'],['webgl2','maxTextureSize','maxRenderbufferSize']);
 if(typeof device.webgl2!=='boolean'||!integer(device.maxTextureSize,16,65536)||!integer(device.maxRenderbufferSize,16,65536)||device.deviceMemoryGb!==undefined&&!finite(device.deviceMemoryGb,.125,1024)||device.logicalCores!==undefined&&!integer(device.logicalCores,1,1024)||device.saveData!==undefined&&typeof device.saveData!=='boolean')throw new Error('Invalid graphics device');
 if(!device.webgl2)throw new Error('KEEL live mesh requires WebGL2; a software renderer needs a separate implementation');
 let ceiling=3;
 if((device.deviceMemoryGb??Infinity)<=2||(device.logicalCores??Infinity)<=2)ceiling=0;
 else if((device.deviceMemoryGb??Infinity)<=4||(device.logicalCores??Infinity)<=4)ceiling=1;
 else if((device.deviceMemoryGb??Infinity)<8||(device.logicalCores??Infinity)<8)ceiling=2;
 const initial=requested==='auto'?(device.saveData?0:1):QUALITIES.indexOf(requested),index=Math.min(initial,ceiling),tier=TIERS[index]!,quality=QUALITIES[index]!,reductions:string[]=[];
 if(initial>ceiling)reductions.push('device-hint-quality-cap');
 if(requested==='auto'&&device.saveData)reductions.push('data-saving-start');
 const limit=Math.min(device.maxTextureSize,device.maxRenderbufferSize),pixel=style==='pixel'||style==='dither',requestedW=width*(pixel?1:dpr),requestedH=height*(pixel?1:dpr);
 const scale=Math.min(1,tier.width/requestedW,(pixel?tier.pixelHeight:tier.height)/requestedH,limit/requestedW,limit/requestedH);
 const w=Math.max(1,Math.floor(requestedW*scale)),h=Math.max(1,Math.floor(requestedH*scale));
 if(scale<1)reductions.push('bounded-render-resolution');
 const shadow=tier.shadow&&limit>=256?Math.min(tier.shadow,power2(limit)):0;
 if(shadow<tier.shadow)reductions.push('device-shadow-cap');
 const motion=options.reducedMotion===true?0:tier.motion,particles=options.reducedMotion===true?0:tier.particles;
 if(options.reducedMotion)reductions.push('reduced-motion');
 const pixelTarget=index===0?'16-bit':index===1?'32-bit':'64-bit',target=targetProfile(pixelTarget);
 // The canonical LookTable packs decals into1024-wide rows. Bound aggregate
 // residency, not only an individual print; an unsupported atlas stays off.
 const atlasMaxHeight=device.maxTextureSize<1024?0:Math.min(device.maxTextureSize,tier.atlas/(1024*4)),atlasBytes=1024*atlasMaxHeight*4;
 const texture=Math.min(tier.texture,power2(device.maxTextureSize));
 const resident=atlasMaxHeight?Math.min(tier.resident,Math.floor(1024/texture)*Math.floor(atlasMaxHeight/texture)):0;
 const detail=index===0?0:index===1?1:2,meshDetail=index===0?'low':index===1?'medium':'high';
 const targetPlan=resolveTarget({schema:AGE_SCHEMA,id:'pinball-'+style,name:'Pinball '+style,quality:{detail,meshDetail,views:1,phases:1,variants:1,particles:tier.particles},renderers:['program'],surfaces:1,stereo:false,input:[]},{schema:DEVICE_SCHEMA,id:'pinball-bounded-'+quality,quality:{detail,meshDetail,views:1,phases:1,variants:1,particles},renderers:['program'],surfaces:1,stereo:false,input:[],budget:{objectBytes:tier.bytes,bundleBytes:24*1024*1024,triangles:tier.triangles}});
 return freeze({revision:PINBALL_GRAPHICS_REVISION,requestedQuality:requested,quality,style,width:w,height:h,reductions,
  mesh:{around:tier.around,rings:tier.rings,instanceBudget:tier.instances,cacheMeshes:tier.cache,cacheBytes:tier.bytes,triangleBudget:tier.triangles},
  shadows:{enabled:shadow>0,size:shadow,strength:style==='realistic'?.72:.60},
  lighting:{pointLights:tier.lights,ambient:style==='realistic'?.22:.30,bloom:tier.bloom,mirror:style==='realistic'?tier.mirror:0},
  effects:{particles,pulses:options.reducedMotion?0:tier.pulses,movingFoliage:motion},pixelTarget,target,
  art:{textureSize:texture,atlasBytes,atlasMaxHeight,residentCabinets:resident,dither:style==='dither'?.9:style==='pixel'?0:style==='realistic'?.15:.22,screen:style==='dither'?target.screen:style==='arcade'?4:0,outline:style==='cartoon'?2:style==='realistic'?0:1},targetPlan});
}
