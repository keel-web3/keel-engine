import{PixelCanvas}from'@keel-engine/pinball-pixel-art';
import{dhypot,createRoll}from'@keel-engine/core';
import type{RoomArtPlan,RoomProjection}from'./index.ts';
// Original hand-authored indexed material cells: deliberately clustered
// shadows, chipped highlights and joints, not independent random noise.
const iron=[
 '0000111111111100','0122333333333210','1233444444433321','1234444433333321',
 '1234433333322321','1234332233322321','1234322233333321','1234333333333321',
 '1233333344333321','1233333444433321','1233333444333321','1233333333322321',
 '1233333333322321','1222333333333221','0112222222222110','0001111111111000'];
const stone=[
 '0000112221110000','0012334444321000','0123444444432100','1234444433332210',
 '1234443333322210','1234333333222221','0123333322222221','0012333222211110',
 '0001222221110000','0111222110000110','1233321100012331','1234432211234432',
 '1234433332344432','0123333322333321','0012222211222210','0001111000111100'];
const glaze=[
 '0001111111111000','0123333333332100','1234444444333210','1234443333333210',
 '1234433333333210','1234333333333210','1233333333333210','1233333333333210',
 '1233333333333210','1233333333333210','1233333333332210','1233333333322210',
 '1233333333222210','0122222222221100','0011111111110000','0000000000000000'];
export const ROOM_MATERIAL_CELLS=Object.freeze({iron:Object.freeze(iron),stone:Object.freeze(stone),glaze:Object.freeze(glaze)});
import{paintHeroAssembly}from'./hero-assembly.ts';
const paintAssemblyUncached=paintHeroAssembly;
const cache=new Map<string,Uint8Array>();let bytes=0,hits=0,misses=0;
export function roomAssemblyCacheStats(){return{entries:cache.size,bytes,hits,misses,maxBytes:8388608,maxEntries:16};}
export function clearRoomAssemblyCache(){cache.clear();bytes=0;hits=0;misses=0;}
export function paintIndexedRoomAssembly(p:PixelCanvas,r:RoomArtPlan,inputProject:RoomProjection){
 const primaryIds=r.springs.filter(v=>v.y>r.bankCenter.y+190).map(v=>v.id);const expectedTopology={kind:primaryIds.length>1?'coupled-pressure-disks':'relay-bank',primarySpringIds:primaryIds,targetIds:r.targets.map(v=>v.id),outboundCaptureIds:r.captures.map(v=>v.id)};if(JSON.stringify(r.workingTopology)!==JSON.stringify(expectedTopology))throw Error('Room source topology mismatch');
 if(p.palette.length<32)throw Error('Room construction needs32paletteentries');if(p.offsetX!==0||p.offsetY!==0)throw Error('Room construction uses projection translation; nonzero canvas offset unsupported');
 const points=[...r.nodes,...r.rearBoundary,{x:r.bounds[0],y:r.bounds[3]},{x:r.bounds[2],y:r.bounds[1]},{x:r.bounds[2],y:r.bounds[3]},{x:r.bankCenter.x,y:r.bankCenter.y},...(r.rearBoundary.length?[{x:r.bounds[2],y:r.rearBoundary.at(-1)!.y}]:[]),...r.targets.flatMap(t=>[{x:t.ax,y:t.ay},{x:t.bx,y:t.by}])],values=new Map<string,readonly[number,number]>();
 for(const v of points){const key=v.x+'/'+v.y;const q=inputProject(v.x,v.y,r.bed.height);if(!Array.isArray(q)||q.length!==2||![0,1].every(i=>Object.hasOwn(q,i)&&Number.isFinite(q[i])&&Math.abs(q[i]!)<1e6))throw Error('Room assembly dense projection');values.set(key,[q[0],q[1]]);}
 const project:RoomProjection=(x,y,z)=>{if(z!==r.bed.height)throw Error('Room assembly plane');const q=values.get(x+'/'+y);if(!q)throw Error('Room assembly undeclared coordinate');return q;};
 if(p.clip!==null){const staged=new PixelCanvas(p.W,p.H,p.palette);staged.pixels.fill(255);staged.clip=p.clip;const result=paintAssemblyUncached(staged,r,project);for(let i=0;i<staged.pixels.length;i++)if(staged.pixels[i]!==255)p.pixels[i]=staged.pixels[i]!;return result;}
 const key=JSON.stringify([r.worldSha256,r.bed.id,r.theme,r.seed,r.graph,r.workingTopology,r.bounds,r.bankCenter.x,r.bankCenter.y,p.W,p.H,[...values]]);let layer=cache.get(key);
 if(!layer){misses++;const target=new PixelCanvas(p.W,p.H,p.palette);target.pixels.fill(255);paintAssemblyUncached(target,r,project);layer=target.pixels;if(layer.byteLength<=8388608){while(cache.size&&(cache.size>=16||bytes+layer.byteLength>8388608)){const first=cache.keys().next().value!;bytes-=cache.get(first)!.byteLength;cache.delete(first);}cache.set(key,layer);bytes+=layer.byteLength;}}
 else{hits++;cache.delete(key);cache.set(key,layer);}
 for(let i=0;i<layer.length;i++)if(layer[i]!==255)p.pixels[i]=layer[i]!;
 return{painted:true,plane:'under-glass',raisedHousingAdmitted:false};
}
