import{dhypot}from'@keel-engine/core';
import{PixelCanvas}from'@keel-engine/pinball-pixel-art';
import type{ArenaField}from'@keel-engine/pinball-arena';
import{roomArtPalette,type RoomProjection,type RoomArtTheme}from'./index.ts';

const canvasPrototype=PixelCanvas.prototype;
const canvasMethods=['dot','geometry','ink','write'].map(name=>[name,Object.getOwnPropertyDescriptor(canvasPrototype,name)?.value]as const);
function constantProjection(p:PixelCanvas,points:readonly(readonly[number,number])[]){
 if(Object.getPrototypeOf(p)!==canvasPrototype)return false;
 for(const name of['offsetX','offsetY','W','H','palette','pixels','_clip']){const own=Object.getOwnPropertyDescriptor(p,name);if(!own||!Object.hasOwn(own,'value'))return false;}
 // A typed-array proxy can run arbitrary code on every indexed write. It
 // must keep the original nearest-segment loop as well as the original dot.
 const pixels=Object.getOwnPropertyDescriptor(p,'pixels')!.value;if(!ArrayBuffer.isView(pixels)||Object.getPrototypeOf(pixels)!==Uint8Array.prototype||Object.getOwnPropertyDescriptor(pixels,'length'))return false;
 for(const [name,original]of canvasMethods){const own=Object.getOwnPropertyDescriptor(p,name),prototype=Object.getOwnPropertyDescriptor(canvasPrototype,name);if(own&&(!Object.hasOwn(own,'value')||own.value!==original)||!prototype||!Object.hasOwn(prototype,'value')||prototype.value!==original)return false;}
 const clip=Object.getOwnPropertyDescriptor(p,'_clip')!.value;if(clip!==null&&(!Array.isArray(clip)||![0,1,2,3].every(k=>{const own=Object.getOwnPropertyDescriptor(clip,k);return own&&Object.hasOwn(own,'value');})))return false;
 return points.every(point=>[0,1].every(k=>{const own=Object.getOwnPropertyDescriptor(point,k);return own&&Object.hasOwn(own,'value');}));
}
function directRaster(p:PixelCanvas){
 // Integer cells at zero offset already equal write()'s rounded coordinates.
 // Admission follows all original projection/material/raster-budget guards.
 if(p.offsetX!==0||p.offsetY!==0)return null;
 const W=p.W,H=p.H,pixels=p.pixels,palette=p.palette,clip=Object.getOwnPropertyDescriptor(p,'_clip')!.value;
 if(!Number.isInteger(W)||!Number.isInteger(H)||W<1||H<1||W>2048||H>2048||W*H>1048576||!ArrayBuffer.isView(pixels)||Object.getPrototypeOf(pixels)!==Uint8Array.prototype||!Array.isArray(palette)||Object.getPrototypeOf(palette)!==Array.prototype)return null;
 const length=Object.getOwnPropertyDescriptor(palette,'length');if(!length||!Object.hasOwn(length,'value')||!Number.isInteger(length.value)||length.value<32||length.value>256)return null;
 let left=0,right=W-1,top=0,bottom=H-1;
 if(clip!==null){const length=Object.getOwnPropertyDescriptor(clip,'length');if(!length||length.value!==4)return null;const cells=[0,1,2,3].map(k=>Object.getOwnPropertyDescriptor(clip,k)!.value);if(!cells.every(Number.isFinite))return null;left=Math.max(left,Math.ceil(cells[0]));right=Math.min(right,Math.floor(cells[2]));top=Math.max(top,Math.ceil(cells[1]));bottom=Math.min(bottom,Math.floor(cells[3]));}
 return{pixels,W,left,right,top,bottom};
}

/** Canonical projection translation is carried by project(), as before. */
export function paintNativePathDeck(p:PixelCanvas,field:ArenaField,pathId:string,project:RoomProjection,theme:RoomArtTheme){
 if(p.offsetX!==0||p.offsetY!==0)throw Error('Native path uses projection translation; nonzero canvas offset unsupported');
 return paintPathDeck(p,field,pathId,project,theme);
}
/** Preserve the older R11 caller's supported PixelCanvas offset behavior. */
export function paintNativePathDeckWithCanvasOffset(p:PixelCanvas,field:ArenaField,pathId:string,project:RoomProjection,theme:RoomArtTheme){return paintPathDeck(p,field,pathId,project,theme);}

/** Source-supported deck material, clipped to every actual surface polygon.
 * Panel joints/slots are visual only; native support remains continuously solid. */
function paintPathDeck(p:PixelCanvas,field:ArenaField,pathId:string,project:RoomProjection,theme:RoomArtTheme){
 roomArtPalette(theme);const path=field.pinball?.paths.find(v=>v.id===pathId);if(!path||path.vertices.length<2||path.vertices.length>128||path.surfaceIds.length>256||p.palette.length<32)throw Error('Native path material');
 const surfaces=path.surfaceIds.map(id=>{const s=field.surfaces.find(v=>v.id===id);if(!s)throw Error('Missing native support surface');return s;}),polys=surfaces.map(s=>s.polygon.map((q,i)=>project(q.x,q.y,s.vertexElevations?.[i]??s.height))),vertices=path.vertices.map(v=>project(v.x,v.y,v.elevation));
 const projected=[...polys.flat(),...vertices];if(projected.some(v=>!Array.isArray(v)||v.length!==2||![0,1].every(k=>Object.hasOwn(v,k)&&Number.isFinite(v[k])&&Math.abs(v[k]!)<1e6)))throw Error('Native path projection');
 const rasterWork=polys.reduce((sum,poly)=>sum+Math.max(0,Math.min(p.W,Math.ceil(Math.max(...poly.map(v=>v[0]))))-Math.max(0,Math.floor(Math.min(...poly.map(v=>v[0]))))+1)*Math.max(0,Math.min(p.H,Math.ceil(Math.max(...poly.map(v=>v[1]))))-Math.max(0,Math.floor(Math.min(...poly.map(v=>v[1]))))+1),0);if(rasterWork>1048576)throw Error('Path art raster budget');
 const inside=(poly:readonly(readonly[number,number])[],x:number,y:number)=>{let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i]!,b=poly[j]!;if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
 // Only ordinary projected coordinates and the original pixel writer can be
 // treated as constants. Accessors/custom writers retain the original loop.
 const segments: {a:readonly[number,number];dx:number;dy:number;d:number;d2:number;start:number}[]|null=constantProjection(p,projected)?[]:null;
 if(segments){let total=0;for(let k=1;k<vertices.length;k++){const a=vertices[k-1]!,b=vertices[k]!,dx=b[0]-a[0],dy=b[1]-a[1],d=dhypot(dx,dy);if(!d)continue;segments.push({a,dx,dy,d,d2:d*d,start:total});total+=d;}}
 const raster=segments?directRaster(p):null;
 for(const poly of polys){const minX=Math.max(raster?raster.left:0,Math.floor(Math.min(...poly.map(v=>v[0])))),maxX=Math.min(raster?raster.right:p.W-1,Math.ceil(Math.max(...poly.map(v=>v[0])))),minY=Math.max(raster?raster.top:0,Math.floor(Math.min(...poly.map(v=>v[1])))),maxY=Math.min(raster?raster.bottom:p.H-1,Math.ceil(Math.max(...poly.map(v=>v[1]))));for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){if(!inside(poly,x,y))continue;let best=Infinity,along=0,side=0,total=0;if(segments){for(const {a,dx,dy,d,d2,start}of segments){const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/d2)),dist=(x-a[0]-dx*t)**2+(y-a[1]-dy*t)**2;if(dist<best){best=dist;along=start+t*d;side=((x-a[0])*dy-(y-a[1])*dx)/d;}}}else{for(let k=1;k<vertices.length;k++){const a=vertices[k-1]!,b=vertices[k]!,dx=b[0]-a[0],dy=b[1]-a[1],d=dhypot(dx,dy);if(!d)continue;const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(d*d))),dist=(x-a[0]-dx*t)**2+(y-a[1]-dy*t)**2;if(dist<best){best=dist;along=total+t*d;side=((x-a[0])*dy-(y-a[1])*dx)/d;}total+=d;}}const phase=Math.floor(along)%18;let ink=theme==='ion-relay'?8:theme==='grove'?13:13;if(theme==='ion-relay'){ink=Math.abs(side)<3?3:side<0?4:2;if(phase===0||phase===1)ink=1;if(phase===2&&Math.abs(side)>3)ink=5;}else if(theme==='grove'){ink=Math.abs(side)<3?14:side<0?15:13;if(phase===1&&Math.abs(side)>2)ink=16;if(Math.floor(along+side*2)%29===0)ink=13;}else{ink=Math.abs(side)<3?14:side<0?16:13;if(phase===0)ink=13;if(phase===1&&side<0)ink=17;}if(raster)raster.pixels[y*raster.W+x]=ink;else p.dot(x,y,ink);}}
 return{pathId,sourceSurfaces:surfaces.map(v=>v.id),solidNativeSupport:true};
}
