/** Four-tone sprite raster of a compiled specimen for retro targets (CGB/DMG 2bpp, any square cell).
 * One turntable camera per clip: the lowest body pixel rests on a shared shelf line, and the zoom is solved from the pixels
 * the clip actually draws (meshes, flame and vapour volumes), so effects never shrink the body by more than a
 * set share. Light is real: smooth normals under one key light, a shadow map for self-shadowing and a cast
 * shadow on the ground plane that changes with every view and pose. Each layer wears its own screen (bodies
 * stipple, particles Bayer, shadows hatch); particles and matter volumes are depth-tested in the same camera. */
import {SCREENS,type ScreenId} from '@keel-engine/core';
import {compileObject,type CompiledObject} from './specimen.ts';
import {paintVolumes} from './specimen-volumes.ts';
import {SPECIMEN_MOTION_FRAMES as FRAMES,type SpecimenProgram as Program,type SpecimenMaterial as Material} from './specimen-types.ts';

export interface SpriteCamera {pitch:number;margin:number;effects:number}
/** Shared shelf camera: 0.34 rad pitch, one empty edge pixel, effects may shrink the body by 20%. */
export const SPRITE_CAMERA:SpriteCamera={pitch:.34,margin:1,effects:.2};
export interface SpriteFraming {zoom:number;row:number;/** pixels the body floats above the ground line (displayLift) */lift:number;center:[number,number,number];shadow:{cx:number;cy:number;rx:number;ry:number};body:{side:number;up:number;down:number}}
/** One view: tones 0 (empty) 1 (ink) 2 (mid) 3 (light); shades marks quiet gray matter (smoke, shadow) 1..3. */
export interface SpriteView {pixels:Uint8Array;shades:Uint8Array}

/** Finish response of a material. Results are ramp positions in 1.25..3 (1 ink, 2 mid, 3 light). */
export function materialLight(m:Material,u:number,v:number,normalLight:number,phase:number):number {
 let l=normalLight;const t=phase/FRAMES;
 if(m.finish==='metal')l=1.25+(l-1.4)*1.3+Math.max(0,1-Math.abs(u-.3)*12)*.5;
 if(m.finish==='glass')l=1.6+normalLight*.25+Math.max(0,1-Math.abs(((u+v*.2+.06*Math.sin(t*Math.PI*2))%1)-.38)*16)*.9;
 if(m.finish==='water')l+=Math.sin((u*2+v*3-t)*Math.PI*2)*.30;
 if(m.finish==='glow')l=normalLight+.22*Math.sin((v*2-t)*Math.PI*2);
 if(m.pattern==='grain')l-=Math.sin(v*36+Math.sin(u*12)*2)>.65?.35:0;
 if(m.pattern==='vein')l-=Math.abs((u*5+v*3)%1-.5)<.08?.5:0;
 if(m.pattern==='crack')l-=Math.abs((u*3+Math.sin(v*12)*.2)%1-.5)<.06?.65:0;
 return Math.max(1.25,Math.min(3,l));
}
const FALLBACK:Material={finish:'matte',screen:'bayer4',pattern:'none'};
/** How a sprite is lit and screened. One key light in camera space (toward the light: upper left, in front),
 * a soft wrap and an ambient floor; a shadow map gives real self-shadowing and a cast shadow on the ground
 * plane. Each layer wears its own screen: bodies a blue-noise stipple, particles a Bayer fade, cast shadows a
 * diagonal hatch, so matter, sparks and shade read as different things even in four colours. */
export interface SpriteLook {light:[number,number,number];ambient:number;wrap:number;shadows:boolean;cast:boolean;screens:{body:ScreenId;particles:ScreenId;shadow:ScreenId};
 /** Screen per finish when a material asks for 'auto': stipple leads, ordered and line screens where the material wants them. */
 finishes:Record<string,ScreenId>;
 /** Stipple grain added to the light of grainy finishes before banding (0 = none): the stippled-illustration texture. */
 grain:number;grainFinishes:readonly string[];
 /** Internal contours: ink where one surface passes in front of another, a darker band where faces meet at a crease.
  * surface: a depth jump inks only where two parts meet (one part is one convex solid, so its own surface never breaks;
  * without it a face seen at a grazing angle, like a flat top under the sprite camera, inks over). */
 edges:{depth:number;crease:number;surface?:boolean}}
export const SPRITE_LOOK:SpriteLook={light:[-.5,.7,.5],ambient:.3,wrap:.22,shadows:true,cast:true,screens:{body:'stipple',particles:'bayer4',shadow:'diagonal'},
 finishes:{matte:'stipple',wood:'stipple',leaf:'stipple',vapor:'stipple',water:'lines',glass:'diagonal',metal:'bayer4',glow:'bayer4'},
 grain:.34,grainFinishes:['matte','wood','leaf'],edges:{depth:2.4,crease:.5}};
type ShadowMap={at:(x:number,y:number,z:number)=>number;radius:number};
const norm3=(v:readonly number[])=>{const l=Math.hypot(v[0]!,v[1]!,v[2]!)||1;return [v[0]!/l,v[1]!/l,v[2]!/l] as [number,number,number];};
/** Orthographic depth map seen from the light: for any camera-space point, how far toward the light the nearest
 * occluder sits (minus the point's own distance gives the gap; positive means shadowed). */
function shadowMap(program:Program,mesh:CompiledObject['meshes'][number],P:Float64Array,L:[number,number,number],scale:number):ShadowMap {
 const up:[number,number,number]=Math.abs(L[1])>.95?[1,0,0]:[0,1,0],U=norm3([up[1]*L[2]-up[2]*L[1],up[2]*L[0]-up[0]*L[2],up[0]*L[1]-up[1]*L[0]]),V=[L[1]*U[2]-L[2]*U[1],L[2]*U[0]-L[0]*U[2],L[0]*U[1]-L[1]*U[0]];
 const n=P.length/3,A=new Float64Array(n),B=new Float64Array(n),D=new Float64Array(n);let a0=Infinity,a1=-Infinity,b0=Infinity,b1=-Infinity,radius=0;
 for(let i=0;i<n;i++){const x=P[i*3]!,y=P[i*3+1]!,z=P[i*3+2]!;A[i]=x*U[0]+y*U[1]+z*U[2];B[i]=x*V[0]!+y*V[1]!+z*V[2]!;D[i]=x*L[0]+y*L[1]+z*L[2];a0=Math.min(a0,A[i]!);a1=Math.max(a1,A[i]!);b0=Math.min(b0,B[i]!);b1=Math.max(b1,B[i]!);radius=Math.max(radius,Math.hypot(x,y,z));}
 const w=Math.min(256,Math.ceil((a1-a0)*scale)+3),h=Math.min(256,Math.ceil((b1-b0)*scale)+3),map=new Float64Array(w*h).fill(-Infinity),sx=(w-3)/Math.max(1e-6,a1-a0),sy=(h-3)/Math.max(1e-6,b1-b0);
 for(let t=0;t<mesh.indices.length;t+=3){
  const i0=mesh.indices[t]!,i1=mesh.indices[t+1]!,i2=mesh.indices[t+2]!,m=program.materials?.[Math.floor(mesh.attrs[i0*4]!/3)]??FALLBACK;if(m.finish==='vapor'||m.finish==='glow')continue;
  const ax=1+(A[i0]!-a0)*sx,ay=1+(B[i0]!-b0)*sy,bx=1+(A[i1]!-a0)*sx,by=1+(B[i1]!-b0)*sy,cx=1+(A[i2]!-a0)*sx,cy=1+(B[i2]!-b0)*sy,area=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(area)<1e-9)continue;
  for(let y=Math.max(0,Math.floor(Math.min(ay,by,cy)));y<=Math.min(h-1,Math.ceil(Math.max(ay,by,cy)));y++)for(let x=Math.max(0,Math.floor(Math.min(ax,bx,cx)));x<=Math.min(w-1,Math.ceil(Math.max(ax,bx,cx)));x++){
   const u=((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))/area,v=((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))/area,k=1-u-v;if(u<-.02||v<-.02||k<-.02)continue;
   const d=u*D[i0]!+v*D[i1]!+k*D[i2]!,at=y*w+x;if(d>map[at]!)map[at]=d;}}
 return {radius,at:(x,y,z)=>{const a=x*U[0]+y*U[1]+z*U[2],b=x*V[0]!+y*V[1]!+z*V[2]!,mx=Math.floor(1+(a-a0)*sx),my=Math.floor(1+(b-b0)*sy);if(mx<0||my<0||mx>=w||my>=h)return -Infinity;return map[my*w+mx]!-(x*L[0]+y*L[1]+z*L[2]);}};
}
/** Pixel classes used to frame a clip: 1 solid/liquid mesh, 2 flame volume, 3 smoke or vapour volume, 4 particle.
 * With `classes` the raster only measures coverage (no lighting or shadow map). */
function raster(program:Program,compiled:CompiledObject,frameIndex:number,yaw:number,zoom:number,center:readonly number[],size:number,pitch:number,classes?:Uint8Array,look:SpriteLook=SPRITE_LOOK,ground?:number):{frame:Uint8Array;depth:Float64Array;shades:Uint8Array} {
 const mesh=compiled.meshes[frameIndex]!,c=Math.cos(yaw),s=Math.sin(yaw),pc=Math.cos(pitch),ps=Math.sin(pitch),mid=size/2,last=size-2;
 const project=(x:number,y:number,z:number):[number,number,number]=>{const rx=x*c+z*s,rz=-x*s+z*c;return [mid+rx*zoom,mid-(y*pc-rz*ps)*zoom,y*ps+rz*pc];};
 const frame=new Uint8Array(size*size),depth=new Float64Array(size*size).fill(-Infinity),shades=new Uint8Array(size*size),nrm=new Float32Array(size*size*3),part=new Int16Array(size*size).fill(-1),slotOf=new Int16Array(size*size).fill(-1);
 // Camera-space positions and normals (x right, y up, z toward the viewer), once per vertex.
 const nv=mesh.positions.length/3,P=new Float64Array(nv*3),N=new Float64Array(nv*3);
 for(let i=0;i<nv;i++){const x=mesh.positions[i*3]!-center[0]!,y=mesh.positions[i*3+1]!-center[1]!,z=mesh.positions[i*3+2]!-center[2]!,rx=x*c+z*s,rz=-x*s+z*c;P[i*3]=rx;P[i*3+1]=y*pc-rz*ps;P[i*3+2]=y*ps+rz*pc;
  const nx=mesh.normals[i*3]!,ny=mesh.normals[i*3+1]!,nz=mesh.normals[i*3+2]!,qx=nx*c+nz*s,qz=-nx*s+nz*c;N[i*3]=qx;N[i*3+1]=ny*pc-qz*ps;N[i*3+2]=ny*ps+qz*pc;}
 const L=norm3(look.light),H=norm3([L[0],L[1],L[2]+1]),lit=!classes,sm=lit&&look.shadows?shadowMap(program,mesh,P,L,zoom*1.6):undefined,bias=2.2/zoom;
 for(let t=0;t<mesh.indices.length;t+=3){
  const ids=[mesh.indices[t]!,mesh.indices[t+1]!,mesh.indices[t+2]!];
  const [a,b,d]=ids.map(i=>project(mesh.positions[i*3]!-center[0]!,mesh.positions[i*3+1]!-center[1]!,mesh.positions[i*3+2]!-center[2]!)) as [[number,number,number],[number,number,number],[number,number,number]];
  const area=(b[1]-d[1])*(a[0]-d[0])+(d[0]-b[0])*(a[1]-d[1]);if(Math.abs(area)<1e-7)continue;
  const i=ids[0]!,slot=mesh.attrs[i*4]!,tone=slot%3,material=program.materials?.[Math.floor(slot/3)]??FALLBACK;
  const screen=SCREENS[(material.screen==='auto'?look.finishes[material.finish]??look.screens.body:material.screen) as ScreenId],grain=lit&&look.grainFinishes.includes(material.finish)?look.grain:0,glowing=material.finish==='glow',shiny=material.finish==='metal'?1:material.finish==='glass'?.8:material.finish==='water'?.7:0;
  const loX=Math.max(0,Math.floor(Math.min(a[0],b[0],d[0]))),hiX=Math.min(size-1,Math.ceil(Math.max(a[0],b[0],d[0]))),loY=Math.max(0,Math.floor(Math.min(a[1],b[1],d[1]))),hiY=Math.min(size-1,Math.ceil(Math.max(a[1],b[1],d[1])));
  for(let y=loY;y<=hiY;y++)for(let x=loX;x<=hiX;x++){
   const u=((b[1]-d[1])*(x+.5-d[0])+(d[0]-b[0])*(y+.5-d[1]))/area,w=((d[1]-a[1])*(x+.5-d[0])+(a[0]-d[0])*(y+.5-d[1]))/area,k=1-u-w;
   if(u<0||w<0||k<0)continue;const z=u*a[2]+w*b[2]+k*d[2],at=y*size+x;
   if(z<=depth[at]!)continue;depth[at]=z;if(classes)classes[at]=1;nrm[at*3]=0;nrm[at*3+1]=0;nrm[at*3+2]=glowing?-9:0;part[at]=mesh.parts?mesh.parts[ids[0]!]!:-1;slotOf[at]=slot;
   // Without light (framing), dark and bright tones are flat; lit, they shade like everything else one band lower or higher.
   if(!lit&&tone===1){frame[at]=1;continue;}if(!lit&&tone===2){frame[at]=3;continue;}
   const uv=(offset:number)=>u*mesh.attrs[ids[0]!*4+offset]!+w*mesh.attrs[ids[1]!*4+offset]!+k*mesh.attrs[ids[2]!*4+offset]!;
   let normalLight=2;
   if(lit){
    // Smooth shading: the normal is interpolated across the triangle, then lit by the key light.
    const n=norm3([0,1,2].map(j=>u*N[ids[0]!*3+j]!+w*N[ids[1]!*3+j]!+k*N[ids[2]!*3+j]!));if(!glowing){nrm[at*3]=n[0];nrm[at*3+1]=n[1];nrm[at*3+2]=n[2];}
    let diffuse=Math.max(0,(n[0]*L[0]+n[1]*L[1]+n[2]*L[2]+look.wrap)/(1+look.wrap)),spec=shiny?Math.pow(Math.max(0,n[0]*H[0]+n[1]*H[1]+n[2]*H[2]),22)*shiny:0;
    if(sm&&material.finish!=='glow'){const px=u*P[ids[0]!*3]!+w*P[ids[1]!*3]!+k*P[ids[2]!*3]!,py=u*P[ids[0]!*3+1]!+w*P[ids[1]!*3+1]!+k*P[ids[2]!*3+1]!,pz=u*P[ids[0]!*3+2]!+w*P[ids[1]!*3+2]!+k*P[ids[2]!*3+2]!;if(sm.at(px,py,pz)>bias){diffuse*=.12;spec=0;}}
    // Emissive matter lights itself, brightest where it faces the viewer: a glowing sphere reads round.
    if(glowing){nrm[at*3]=n[0];nrm[at*3+1]=n[1];nrm[at*3+2]=n[2]-20;}
    normalLight=glowing?1.5+1.55*Math.pow(Math.max(0,n[2]),.75):1.12+(look.ambient+(1-look.ambient)*diffuse)*1.9+spec*.9;
   }
   const light=Math.max(1.0,Math.min(3.2,materialLight(material,uv(1),uv(2),normalLight,frameIndex)+(grain?(SCREENS.stipple.at(x,y)-.5)*grain:0)+(tone===1?-.85:tone===2?.85:0))),band=Math.floor(light),fraction=light-band;
   frame[at]=Math.min(3,band+(fraction<.18?0:fraction>.84?1:fraction>.18+screen.at(x,y)*.66?1:0));
  }
 }
 // Internal contours (lit renders only): where a nearer surface overlaps a farther one the farther pixel becomes ink;
 // where neighbouring normals turn sharply (a box edge) the darker-facing pixel drops one band. Glow is exempt.
 // Internal contours (lit renders only), the cel drawing of one object made of several parts:
 //  - where two different parts meet, the part behind gets an ink border (unless the two truly continue one smooth
 //    surface of one material), so a disc and its flares, a roof and its walls, read as separate shapes;
 //  - where one surface passes in front of a farther one, the farther pixel becomes ink;
 //  - where neighbouring normals turn sharply inside one part (a box edge), the darker-facing pixel drops one band.
 // Glow is never creased (it has no faces) but is bordered against other parts.
 if(lit){const dj=look.edges.depth/zoom,ink=new Uint8Array(size*size),dim=new Uint8Array(size*size);
  const normal=(i:number,k:number)=>{const v=nrm[i*3+k]!;return k===2&&v<-10?v+20:v;},glow=(i:number)=>nrm[i*3+2]!<-10;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const a=y*size+x;if(!frame[a]||part[a]!<0)continue;
   for(const b of [x+1<size?a+1:-1,y+1<size?a+size:-1]){if(b<0||!frame[b]||part[b]!<0)continue;
    const dz=depth[a]!-depth[b]!,dot=normal(a,0)*normal(b,0)+normal(a,1)*normal(b,1)+normal(a,2)*normal(b,2),back=dz<0?a:dz>0?b:part[a]!>part[b]!?a:b;
    if(Math.abs(dz)>dj&&(!look.edges.surface||part[a]!==part[b])){ink[back]=1;continue;}
    if(part[a]!==part[b]){if(slotOf[a]!==slotOf[b]||dot<.93||Math.abs(dz)>dj*.25)ink[back]=1;continue;}
    if(!glow(a)&&!glow(b)&&dot<look.edges.crease){const la=normal(a,0)*L[0]+normal(a,1)*L[1]+normal(a,2)*L[2],lb=normal(b,0)*L[0]+normal(b,1)*L[1]+normal(b,2)*L[2];dim[la<lb?a:b]=1;}}}
  for(let i=0;i<frame.length;i++){if(ink[i])frame[i]=1;else if(dim[i]&&frame[i]!>1)frame[i]=frame[i]!-1;}}
 const fill=frame.slice();for(let y=1;y<size-1;y++)for(let x=1;x<size-1;x++){const at=y*size+x;if(!fill[at]&&(fill[at-1]||fill[at+1]||fill[at-size]||fill[at+size]))frame[at]=1;}
 // Particles: fading ones dissolve through the particle screen instead of popping out.
 const pscreen=SCREENS[look.screens.particles];
 for(const p of compiled.particles[frameIndex]!){if(p.light<.06||p.size<.002)continue;const [px,py,pz]=project(p.p[0]-center[0]!,p.p[1]-center[1]!,p.p[2]-center[2]!),r=Math.max(.65,p.size*zoom),hy=p.ramp==='rain'?Math.max(1.3,r*2):r,fade=Math.min(1,p.light/.4);for(let y=Math.floor(py-hy);y<=Math.ceil(py+hy);y++)for(let x=Math.floor(px-r);x<=Math.ceil(px+r);x++){const dx=x-px,dy=y-py;if(x<1||x>last||y<1||y>last)continue;if(p.ramp==='rain'){if(Math.abs(dx-dy*.16)>.65||Math.abs(dy)>hy)continue;}else if(p.ramp==='ember'){if(Math.abs(dx)*.8+Math.abs(dy)*1.3>r)continue;}else if(dx*dx+dy*dy>r*r)continue;const at=y*size+x;if(pz<depth[at]!)continue;if(p.ramp==='bubble'&&dx*dx+dy*dy<(r-.7)**2)continue;if(!classes&&fade<1&&pscreen.at(x,y)>fade)continue;frame[at]=p.light>.70?3:2;shades[at]=0;depth[at]=pz;if(classes)classes[at]=4;}}
 const before=classes?frame.slice():undefined;
 paintVolumes(frame,depth,compiled.volumes[frameIndex]!,center as number[],zoom,yaw,pitch,shades,size);
 if(classes&&before)for(let at=0;at<frame.length;at++)if(frame[at]!==before[at]||(shades[at]&&!classes[at]))classes[at]=shades[at]?3:2;
 // Cast shadow: every empty pixel is a point on the ground plane; if the shadow map says something stands
 // between it and the light, it is in shade -- denser where the occluder is close (contact), hatched.
 if(sm&&ground!==undefined){const hatch=SCREENS[look.screens.shadow],g=ground-center[1]!,R=Math.max(.05,sm.radius);
  for(let y=1;y<=last;y++)for(let x=1;x<=last;x++){const at=y*size+x;if(frame[at])continue;const X=(x+.5-mid)/zoom,Y=(mid-(y+.5))/zoom,rz=(g*pc-Y)/ps;if(Math.abs(rz)>R*1.6)continue;const Z=g*ps+rz*pc,gap=sm.at(X,Y,Z);if(gap<=bias)continue;
   const strength=Math.min(.95,.42+.5*Math.exp(-gap/(R*.3)));if(hatch.at(x,y)<strength){frame[at]=1;shades[at]=1;}}}
 return {frame,depth,shades};
}
/** The base footprint (lowest quarter of the body over the whole clip) sets one stable shadow ellipse. */
function contactShadow(compiled:CompiledObject,pivot:[number,number],ground:number,zoom:number,camera:SpriteCamera&{row:number},size:number){
 let top=-Infinity,reach=0,base=0;for(const m of compiled.meshes)for(let i=1;i<m.positions.length;i+=3)top=Math.max(top,m.positions[i]!);
 const cut=ground+(top-ground)*.25;
 for(const m of compiled.meshes)for(let i=0;i<m.positions.length;i+=3){const r=Math.hypot(m.positions[i]!-pivot[0],m.positions[i+2]!-pivot[1]);reach=Math.max(reach,r);if(m.positions[i+1]!<=cut)base=Math.max(base,r);}
 const rx=Math.max(3,Math.min(size/2-2,(base||reach*.6)*zoom*1.05));return {cx:size/2,cy:camera.row+.6,rx,ry:Math.max(1.6,rx*Math.sin(camera.pitch)*1.1)};
}
const framings=new WeakMap<CompiledObject,Map<string,SpriteFraming>>();
/** Solve the clip's camera from its drawn pixels: render every view and phase once on a large canvas around the
 * ground pivot, measure body and effect extents, then fit the body to the cell (effects may cost `effects`). */
export function spriteFraming(program:Program,compiled:CompiledObject,size=32,camera:SpriteCamera=SPRITE_CAMERA,views=16):SpriteFraming {
 const key=`${size}:${camera.pitch}:${camera.margin}:${camera.effects}:${views}:${program.displayScale??.93}:${program.displayLift??0}`;let map=framings.get(compiled);if(!map){map=new Map();framings.set(compiled,map);}const hit=map.get(key);if(hit)return hit;
 let ground=Infinity,x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
 for(const m of compiled.meshes)for(let i=0;i<m.positions.length;i+=3){const x=m.positions[i]!,y=m.positions[i+1]!,z=m.positions[i+2]!;if(y<ground)ground=y;if(x<x0)x0=x;if(x>x1)x1=x;if(z<z0)z0=z;if(z>z1)z1=z;}
 if(!Number.isFinite(ground)){ground=0;x0=x1=z0=z1=0;}
 const pivot:[number,number]=[(x0+x1)/2,(z0+z1)/2],vapor=program.dynamics?.some(d=>d.kind==='vapor')??false,M=192,z=40/Math.max(.05,compiled.radius),origin=[pivot[0],ground,pivot[1]];
 const body={side:1,up:1,down:1},all={side:1,up:1,down:1},classes=new Uint8Array(M*M);
 for(let frame=0;frame<FRAMES;frame++)for(let view=0;view<views;view++){
  classes.fill(0);const r=raster(program,compiled,frame,view*Math.PI*2/views,z,origin,M,camera.pitch,classes);
  for(let y=0;y<M;y++)for(let x=0;x<M;x++){const at=y*M+x,k=classes[at]!;if(!k||!r.frame[at])continue;const side=Math.max(M/2-x,x+1-M/2),up=M/2-y,down=y+1-M/2;
   for(const e of k===1||k===2||(k===3&&vapor)?[body,all]:[all]){if(side>e.side)e.side=side;if(up>e.up)e.up=up;if(down>e.down)e.down=down;}}
 }
 // Fit the body's whole vertical extent and stand its lowest pixel on the shared shelf line (row size-margin-2),
 // so a shelf of specimens rests on one line; travelling effects keep the same anchor.
 const lift=Math.round((program.displayLift??0)*size),side=size/2-camera.margin-1,tall=size-2*camera.margin-2-lift,base=size-camera.margin-1;
 const kBody=Math.min(side/body.side,tall/(body.up+body.down)),kAll=Math.min(side/all.side,tall/(body.down+all.up));
 const k=Math.min(kBody,Math.max(kAll,kBody*(1-camera.effects)))*(program.displayScale??.93),zoom=z*k,row=base-lift-body.down*k,pc=Math.cos(camera.pitch);
 const framing:SpriteFraming={zoom,row,lift,center:[pivot[0],ground+(row-size/2)/(pc*zoom),pivot[1]],shadow:contactShadow(compiled,pivot,ground,zoom,{...camera,row:row+lift},size),body};
 if(map.size>=8)map.delete(map.keys().next().value!);map.set(key,framing);return framing;
}
/** One sprite view of one motion phase, in the clip's shared camera. */
export function specimenSprite(program:Program,seed:string,phase:number,view:number,views:number,size=32,camera:SpriteCamera=SPRITE_CAMERA,look:SpriteLook=SPRITE_LOOK):SpriteView {
 const compiled=compileObject(program,seed),framing=spriteFraming(program,compiled,size,camera),frameIndex=((phase%FRAMES)+FRAMES)%FRAMES,yaw=view*Math.PI*2/views;
 const pc=Math.cos(camera.pitch),ground=framing.center[1]-(framing.row+framing.lift-size/2)/(pc*framing.zoom);   /* a floating body's shadow stays on the ground line */
 const {frame,shades}=raster(program,compiled,frameIndex,yaw,framing.zoom,framing.center,size,camera.pitch,undefined,look,look.shadows&&look.cast?ground:undefined),sh=framing.shadow;
 // Without the shadow map, the old fixed contact ellipse grounds the turn.
 if(!look.shadows)for(let y=Math.max(1,Math.floor(sh.cy-sh.ry));y<=Math.min(size-2,Math.ceil(sh.cy+sh.ry));y++)for(let x=Math.max(1,Math.floor(sh.cx-sh.rx));x<=Math.min(size-2,Math.ceil(sh.cx+sh.rx));x++){const q=((x+.5-sh.cx)/sh.rx)**2+((y+.5-sh.cy)/sh.ry)**2,at=y*size+x;if(q<1&&!frame[at]&&SCREENS.bayer4.at(x,y)<.5*(1-q)**.8){frame[at]=1;shades[at]=1;}}
 return {pixels:frame,shades};
}
/** Measured facts about a specimen's compiled sprites, for validators: how much of its turn keeps a readable
 * silhouette, how much of the cell the body fills, whether it actually moves, and whether its loop closes. */
export interface SpecimenAudit {turnRatio:number;thinnestView:number;fill:{width:number;height:number};uniquePhases:number;movingPixels:number;loopCloses:boolean;outlineShare:number;bodyPixels:number}
export function auditSpecimen(program:Program,seed:string,size=32,camera:SpriteCamera=SPRITE_CAMERA,views=16):SpecimenAudit {
 const areas:number[]=[],phases=new Set<string>(),frames:Uint8Array[]=[];let x0=size,x1=-1,y0=size,y1=-1,moving=0,outline=0,body=0;
 for(let view=0;view<views;view++){const {pixels:p,shades:s}=specimenSprite(program,seed,0,view,views,size,camera);let a=0;for(let i=0;i<p.length;i++)if(p[i]&&!s[i])a++;areas.push(a);}
 for(let phase=0;phase<FRAMES;phase++){const {pixels,shades}=specimenSprite(program,seed,phase,1,views,size,camera);frames.push(pixels);phases.add(Buffer.from(pixels).toString('base64'));
  for(let i=0;i<pixels.length;i++){if(pixels[i]&&!shades[i]){const x=i%size,y=(i/size)|0;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;if(phase===0){body++;if(pixels[i]===1)outline++;}}if(pixels[i]!==frames[0]![i])moving++;}}
 // A loop closes when the join (last -> first) changes no more pixels than the largest ordinary step.
 const diff=(a:Uint8Array,b:Uint8Array)=>{let n=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])n++;return n;};
 let step=0;for(let i=0;i+1<FRAMES;i++)step=Math.max(step,diff(frames[i]!,frames[i+1]!));
 const max=Math.max(...areas),min=Math.min(...areas);
 return {turnRatio:max?min/max:0,thinnestView:areas.indexOf(min),fill:{width:x1>=x0?(x1-x0+1)/size:0,height:y1>=y0?(y1-y0+1)/size:0},uniquePhases:phases.size,movingPixels:moving/FRAMES,loopCloses:diff(frames[FRAMES-1]!,frames[0]!)<=step*1.25+8,outlineShare:body?outline/body:0,bodyPixels:body};
}
