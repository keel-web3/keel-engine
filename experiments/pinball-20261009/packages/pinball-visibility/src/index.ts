export {manifest} from './module.ts';
import type {MeshGBuffer} from '@keel-engine/bake';

export const PINBALL_VISIBILITY_REVISION='pinball-visibility/2026-10-07.2';
export interface MeshVisibilityTarget {
 readonly mesh:string;readonly owner:number;
 /** Exact canonical draw-list entry. Omit to aggregate every matching mesh/owner draw. */
 readonly drawIndex?:number;
}
export interface MeshVisibilityEvidence extends MeshVisibilityTarget {
 readonly submittedDraws:number;
 readonly pixels:number;
 /** Inclusive logical-picture bounds, x right and y down; null when no pixels survive depth testing. */
 readonly bounds:readonly [number,number,number,number]|null;
}
export interface MeshVisibilityFrame {
 readonly revision:typeof PINBALL_VISIBILITY_REVISION;
 readonly width:number;readonly height:number;
 readonly targets:readonly MeshVisibilityEvidence[];
}
export interface MeshVisibilityInspectorOptions {readonly maxPixels?:number;readonly maxTargets?:number}

/** Explicit admission tooling: readPixels synchronizes the GPU. Never attach this
 * to normal production rendering by default. Counts the physical mesh, rather
 * than its beacon, particles or an overlay. Zero pixels alone cannot distinguish
 * occlusion from being offscreen, and nonzero pixels do not prove readable art. */
export function createMeshVisibilityInspector(gl:WebGL2RenderingContext,options:MeshVisibilityInspectorOptions={}) {
 const maxPixels=options.maxPixels??2_097_152,maxTargets=options.maxTargets??128;
 if(!Number.isSafeInteger(maxPixels)||maxPixels<1||maxPixels>16_777_216||!Number.isInteger(maxTargets)||maxTargets<1||maxTargets>128)throw new Error('Visibility inspection budget');
 const framebuffer=gl.createFramebuffer();if(!framebuffer)throw new Error('Visibility framebuffer unavailable');
 let disposed=false,pixels=new Uint32Array(0);
 function inspect(buffer:MeshGBuffer,targets:readonly MeshVisibilityTarget[]):MeshVisibilityFrame {
  if(disposed)throw new Error('Visibility inspector disposed');
  const {width,height,draws}=buffer;
  if(!Number.isSafeInteger(width)||width<1||!Number.isSafeInteger(height)||height<1||width*height>maxPixels)throw new Error('Visibility picture budget');
  if(!draws)throw new Error('Visibility inspection requires canonical draw identities');
  if(draws.length>65536)throw new Error('Visibility draw list exceeds G-buffer identity budget');
  if(targets.length>maxTargets)throw new Error('Visibility target budget');
  const entries=targets.map(target=>{
   if(typeof target.mesh!=='string'||target.mesh.length<1||target.mesh.length>256||!Number.isInteger(target.owner)||target.owner<0||target.owner>65535)throw new Error('Visibility target identity');
   if(target.drawIndex!==undefined){
    if(!Number.isInteger(target.drawIndex)||target.drawIndex<0||target.drawIndex>65535||target.drawIndex>=draws.length)throw new Error('Visibility target draw index');
    const draw=draws[target.drawIndex]!;
    if(draw.mesh!==target.mesh||draw.owner!==target.owner)throw new Error('Visibility target draw identity differs');
   }
   return {mesh:target.mesh,owner:target.owner,drawIndex:target.drawIndex,submittedDraws:0,pixels:0,minX:width,minY:height,maxX:-1,maxY:-1};
  });
  const identity=new Map<string,number>(),modes=new Map<string,boolean>();
  entries.forEach((entry,index)=>{
   const group=JSON.stringify([entry.mesh,entry.owner]),indexed=entry.drawIndex!==undefined;
   if(modes.has(group)&&modes.get(group)!==indexed)throw new Error('Visibility targets mix aggregate and exact draws');
   modes.set(group,indexed);
   const key=JSON.stringify([entry.mesh,entry.owner,entry.drawIndex??null]);
   if(identity.has(key))throw new Error('Duplicate visibility target');identity.set(key,index);
  });
  const indices=new Int16Array(draws.length);indices.fill(-1);
  draws.forEach((draw,index)=>{const exact=identity.get(JSON.stringify([draw.mesh,draw.owner,index])),target=exact??identity.get(JSON.stringify([draw.mesh,draw.owner,null]));if(target===undefined)return;
   // Shared seams encode the first draw's index. Physical body draws have none;
   // reject ambiguous identities instead of attributing another surface's pixels.
   if(draw.seam)throw new Error('Visibility target must not share a seam');
   if(index>65535)throw new Error('Visibility draw index exceeds G-buffer identity');
   indices[index]=target;entries[target]!.submittedDraws++;
  });
  const needed=width*height*4;if(pixels.length<needed)pixels=new Uint32Array(needed);
  const previousFramebuffer=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer|null;
  const previousBuffer=gl.getParameter(gl.READ_BUFFER) as number;
  const previousPack=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer|null;
  const packParameters=[gl.PACK_ALIGNMENT,gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS] as const;
  const previousParameters=packParameters.map(parameter=>gl.getParameter(parameter) as number);
  try {
   gl.bindFramebuffer(gl.READ_FRAMEBUFFER,framebuffer);
   gl.framebufferTexture2D(gl.READ_FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,buffer.gb,0);
   gl.readBuffer(gl.COLOR_ATTACHMENT0);
   if(gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Visibility G-buffer is not readable');
   gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
   packParameters.forEach((parameter,index)=>gl.pixelStorei(parameter,index===0?1:0));
   gl.readPixels(0,0,width,height,gl.RGBA_INTEGER,gl.UNSIGNED_INT,pixels);
  } finally {
   gl.bindBuffer(gl.PIXEL_PACK_BUFFER,previousPack);
   packParameters.forEach((parameter,index)=>gl.pixelStorei(parameter,previousParameters[index]!));
   gl.bindFramebuffer(gl.READ_FRAMEBUFFER,previousFramebuffer);gl.readBuffer(previousBuffer);
  }
  for(let offset=0;offset<needed;offset+=4){
   if(pixels[offset]===0)continue; // R stores look+1; zero is background, including its zero draw index.
   const drawIndex=pixels[offset+1]!>>>16;if(drawIndex>=indices.length)throw new Error('Visibility G-buffer draw identity mismatch');
   const index=indices[drawIndex]!;if(index<0)continue;const entry=entries[index]!,pixel=offset/4,x=pixel%width,y=height-1-Math.floor(pixel/width);
   entry.pixels++;entry.minX=Math.min(entry.minX,x);entry.minY=Math.min(entry.minY,y);entry.maxX=Math.max(entry.maxX,x);entry.maxY=Math.max(entry.maxY,y);
  }
  return Object.freeze({revision:PINBALL_VISIBILITY_REVISION,width,height,targets:Object.freeze(entries.map(entry=>Object.freeze({mesh:entry.mesh,owner:entry.owner,...(entry.drawIndex===undefined?{}:{drawIndex:entry.drawIndex}),submittedDraws:entry.submittedDraws,pixels:entry.pixels,bounds:entry.pixels?Object.freeze([entry.minX,entry.minY,entry.maxX,entry.maxY] as const):null})))});
 }
 return {inspect,dispose(){if(disposed)return;disposed=true;pixels=new Uint32Array(0);gl.deleteFramebuffer(framebuffer);}};
}
