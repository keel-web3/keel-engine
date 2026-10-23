import type {ArenaFrame,ArenaWorldDefinition} from '@keel-engine/pinball-arena';
import {createPinballFeedback,type PinballFeedbackSample,type PinballFeedbackSound} from '@keel-engine/pinball-feedback';
export {manifest} from './module.ts';

export const PINBALL_PIXEL_VIEW_REVISION='pinball-pixel-view/2026-10-08.4';
export type PixelColour=readonly [number,number,number]|readonly [number,number,number,number];
export type PixelViewScaling='integer'|'nearest-fit';
/** A provider may reuse its index buffer. The view consumes it synchronously. */
export interface PixelFrameSurface {
 readonly width:number;readonly height:number;readonly indices:Uint8Array;readonly palette:readonly PixelColour[];
 readonly worldSha256:string;readonly tick:number;
}
export interface PixelFrameRequest {
 readonly world:ArenaWorldDefinition;readonly frame:ArenaFrame;readonly feedback:PinballFeedbackSample;
 readonly ownerId:number;readonly fraction:number;
 readonly viewport:{readonly width:number;readonly height:number;readonly dpr:number};
}
export type PixelFrameProvider=(request:PixelFrameRequest)=>PixelFrameSurface;
export interface PixelViewOptions {
 readonly provider:PixelFrameProvider;readonly ownerId:number;readonly width:number;readonly height:number;
 readonly dpr?:number;readonly maxPixels?:number;readonly reducedMotion?:boolean;
 /** Integer replication is the default. Nearest fit uses one uniform scale
  * to fill the available extent while preserving the logical aspect ratio. */
 readonly scaling?:PixelViewScaling;
 /** Optional host diagnostics. Times are presentation data, never frame state. */
 readonly measure?:(phase:'provider'|'convert'|'upload'|'blit'|'render',milliseconds:number)=>void;
}
export interface PixelViewport {
 readonly width:number;readonly height:number;readonly x:number;readonly y:number;
 readonly drawWidth:number;readonly drawHeight:number;readonly scale:number;readonly integerScale:boolean;
 readonly requestedDpr:number;readonly effectiveDpr:number;readonly backingReduced:boolean;
}
const integer=(n:number,min:number,max:number)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const rgbaWordLittleEndian=new Uint8Array(new Uint32Array([0x01020304]).buffer)[0]===4;
function dimensions(w:number,h:number,maxPixels:number){
 if(!integer(w,1,2048)||!integer(h,1,2048)||!integer(maxPixels,1,1048576)||w*h>maxPixels)throw Error('Pixel surface exceeds its raster budget');
}
/** Convert palette indices exactly. No blur, bloom, dither or colour resampling. */
export function pixelSurfaceRgba(surface:PixelFrameSurface,worldSha256:string,tick:number,maxPixels=262144,output?:Uint8ClampedArray):Uint8ClampedArray {
 dimensions(surface.width,surface.height,maxPixels);
 if(!/^[0-9a-f]{64}$/.test(worldSha256)||surface.worldSha256!==worldSha256||!integer(tick,0,Number.MAX_SAFE_INTEGER)||surface.tick!==tick)throw Error('Pixel surface differs from the live authority frame');
 const count=surface.width*surface.height;
 if(!(surface.indices instanceof Uint8Array)||surface.indices.length!==count||!integer(surface.palette.length,1,256))throw Error('Invalid indexed pixel surface');
 for(const colour of surface.palette){if(colour.length!==3&&colour.length!==4)throw Error('Invalid pixel palette');for(let channel=0;channel<colour.length;channel++)if(!integer(colour[channel]!,0,255))throw Error('Invalid pixel palette');}
 // Validate indices before touching a reused output or the visible canvas.
 for(let i=0;i<count;i++)if(surface.indices[i]!>=surface.palette.length)throw Error('Pixel index is absent from its palette');
 const rgba=output??new Uint8ClampedArray(count*4);
 if(rgba.length!==count*4)throw Error('Pixel output extent differs');
 // Native word stores preserve exact bytes on either endian layout. Palette
 // words are rebuilt each call, so mutable caller palettes remain observable.
 // Unaligned or overlapping views retain the byte path's original semantics.
 const aliases=rgba.buffer===surface.indices.buffer&&rgba.byteOffset<surface.indices.byteOffset+surface.indices.byteLength&&surface.indices.byteOffset<rgba.byteOffset+rgba.byteLength;
 let directPalette=true;
 for(let i=0;i<surface.palette.length&&directPalette;i++){
  const slot=Object.getOwnPropertyDescriptor(surface.palette,i);
  if(!slot||!Object.hasOwn(slot,'value')){directPalette=false;break;}
  const colour=slot.value as PixelColour;
  for(let k=0;k<colour.length;k++){const channel=Object.getOwnPropertyDescriptor(colour,k);if(!channel||!Object.hasOwn(channel,'value')){directPalette=false;break;}}
  if(ArrayBuffer.isView(colour)){const view=colour as unknown as ArrayBufferView;if(view.buffer===rgba.buffer&&view.byteOffset<rgba.byteOffset+rgba.byteLength&&rgba.byteOffset<view.byteOffset+view.byteLength)directPalette=false;}
 }
 if(rgba instanceof Uint8ClampedArray&&rgba.byteOffset%4===0&&!aliases&&directPalette){
  const colours=new Uint32Array(surface.palette.length);for(let i=0;i<colours.length;i++){const c=surface.palette[i]!,a=c[3]??255;colours[i]=rgbaWordLittleEndian?(c[0]|c[1]<<8|c[2]<<16|a<<24):(c[0]<<24|c[1]<<16|c[2]<<8|a);}
  const words=new Uint32Array(rgba.buffer,rgba.byteOffset,count);for(let i=0;i<count;i++)words[i]=colours[surface.indices[i]!]!;
 }else for(let i=0;i<count;i++){const colour=surface.palette[surface.indices[i]!]!,at=i*4;rgba[at]=colour[0];rgba[at+1]=colour[1];rgba[at+2]=colour[2];rgba[at+3]=colour[3]??255;}
 return rgba;
}
/** Fit native art to the existing viewport. Integer backing pixel replication
 * is the default; undersized viewports use nearest downsampling. Opt-in nearest
 * fit preserves one uniform scale with proportional fractional draw extents. */
export function fitPixelViewport(viewWidth:number,viewHeight:number,logicalWidth:number,logicalHeight:number,dpr=1,scaling:PixelViewScaling='integer'):PixelViewport {
 if(scaling!=='integer'&&scaling!=='nearest-fit')throw Error('Invalid pixel viewport scaling');
 if(!Number.isFinite(viewWidth)||!Number.isFinite(viewHeight)||viewWidth<=0||viewHeight<=0||viewWidth>32768||viewHeight>32768||!Number.isFinite(dpr)||dpr<=0||dpr>3)throw Error('Invalid pixel viewport');
 dimensions(logicalWidth,logicalHeight,1048576);
 const effectiveDpr=Math.min(dpr,8192/viewWidth,8192/viewHeight,Math.sqrt(16777216/(viewWidth*viewHeight)));
 const width=Math.max(1,Math.floor(viewWidth*effectiveDpr)),height=Math.max(1,Math.floor(viewHeight*effectiveDpr));
 const fit=Math.min(width/logicalWidth,height/logicalHeight),nearestFit=scaling==='nearest-fit',scale=nearestFit?fit:fit>=1?Math.floor(fit):fit;
 const drawWidth=nearestFit?logicalWidth*scale:Math.max(1,Math.min(width,Math.round(logicalWidth*scale))),drawHeight=nearestFit?logicalHeight*scale:Math.max(1,Math.min(height,Math.round(logicalHeight*scale)));
 return{width,height,x:nearestFit?(width-drawWidth)/2:Math.floor((width-drawWidth)/2),y:nearestFit?(height-drawHeight)/2:Math.floor((height-drawHeight)/2),drawWidth,drawHeight,scale,integerScale:nearestFit?Number.isInteger(scale)&&scale>=1:fit>=1,requestedDpr:dpr,effectiveDpr,backingReduced:effectiveDpr<dpr};
}
/** Native frame presentation only. Scene construction belongs to the seeded
 * art provider; simulation, sound playback and existing controls stay external. */
export function createPinballPixelView(canvas:HTMLCanvasElement,options:PixelViewOptions){
 if(!integer(options.ownerId,0,99))throw Error('Invalid pixel view owner');
 const maxPixels=options.maxPixels??262144;if(!integer(maxPixels,1,1048576))throw Error('Invalid raster budget');
 const requestedScaling=options.scaling,scaling:PixelViewScaling=requestedScaling===undefined?'integer':requestedScaling;
 const initialWidth=options.width,initialHeight=options.height,initialDpr=options.dpr??1;
 // Reject malformed options before context/backing or visible canvas work.
 fitPixelViewport(initialWidth,initialHeight,1,1,initialDpr,scaling);
 const context=canvas.getContext('2d',{alpha:false});if(!context)throw Error('Pixel rendering requires Canvas2D');
 const raster=canvas.ownerDocument.createElement('canvas'),rasterContext=raster.getContext('2d');if(!rasterContext)throw Error('Pixel raster backing is unavailable');
 let world:ArenaWorldDefinition|undefined,frame:ArenaFrame|undefined,feedback:ReturnType<typeof createPinballFeedback>|undefined;
 let image:ImageData|undefined,viewport:PixelViewport|undefined,width=initialWidth,height=initialHeight,dpr=initialDpr,disposed=false,frames=0;
 function active(){if(disposed)throw Error('Pixel view was disposed');}
 return{
  setWorld(next:ArenaWorldDefinition){active();if(!/^[0-9a-f]{64}$/.test(next.sha256))throw Error('Invalid pixel view world');world=next;frame=undefined;feedback=createPinballFeedback(next,{reducedMotion:options.reducedMotion??false});},
  update(next:ArenaFrame):readonly PinballFeedbackSound[]{active();if(!world||!feedback)throw Error('Pixel world is not loaded');const sounds=feedback.update(next);frame=next;return sounds;},
  reset(){active();feedback?.reset();frame=undefined;},
  resize(nextWidth:number,nextHeight:number,nextDpr=dpr){active();fitPixelViewport(nextWidth,nextHeight,1,1,nextDpr,scaling);width=nextWidth;height=nextHeight;dpr=nextDpr;},
  render(renderOptions:{readonly fraction?:number}={}){
   active();if(!world||!frame||!feedback)throw Error('No native pixel frame');const fraction=renderOptions.fraction??0;
   if(!Number.isFinite(fraction)||fraction<0||fraction>=1)throw Error('Invalid native frame fraction');
   const started=options.measure?performance.now():0;
   const surface=options.provider({world,frame,feedback:feedback.sample(frame.tick,fraction),ownerId:options.ownerId,fraction,viewport:{width,height,dpr}});
   const provided=options.measure?performance.now():0;
   const nextViewport=fitPixelViewport(width,height,surface.width,surface.height,dpr,scaling);
   const sameImage=image&&image.width===surface.width&&image.height===surface.height;
   const pixels=pixelSurfaceRgba(surface,world.sha256,frame.tick,maxPixels,sameImage?image!.data:undefined);
   const converted=options.measure?performance.now():0;
   if(!sameImage){raster.width=surface.width;raster.height=surface.height;image=rasterContext.createImageData(surface.width,surface.height);image.data.set(pixels);}
   rasterContext.putImageData(image!,0,0);
   const uploaded=options.measure?performance.now():0;
   if(canvas.width!==nextViewport.width)canvas.width=nextViewport.width;if(canvas.height!==nextViewport.height)canvas.height=nextViewport.height;
   context.imageSmoothingEnabled=false;context.fillStyle='#000';context.fillRect(0,0,canvas.width,canvas.height);
   context.drawImage(raster,nextViewport.x,nextViewport.y,nextViewport.drawWidth,nextViewport.drawHeight);
   viewport=nextViewport;frames++;
   if(options.measure){const finished=performance.now();options.measure('provider',provided-started);options.measure('convert',converted-provided);options.measure('upload',uploaded-converted);options.measure('blit',finished-uploaded);options.measure('render',finished-started);}
  },
  getStats(){return{revision:PINBALL_PIXEL_VIEW_REVISION,worldSha256:world?.sha256??null,tick:frame?.tick??null,frames,logicalWidth:image?.width??0,logicalHeight:image?.height??0,rasterBytes:image?.data.byteLength??0,viewport:viewport?{...viewport}:null,disposed};},
  dispose(){if(disposed)return;disposed=true;world=undefined;frame=undefined;feedback=undefined;image=undefined;raster.width=1;raster.height=1;},
 };
}
