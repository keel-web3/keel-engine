import { VOLUME_KIND,type VolumeInstances } from './volumes.ts';
import { curlNoise,SCREENS } from '@keel-engine/core';
const fract=(n:number)=>n-Math.floor(n);
// CPU lowering of KEEL bake/volumes.ts's palette volume shader.
const hash=(x:number,y:number,z:number)=>{x=fract(x*.1031);y=fract(y*.1031);z=fract(z*.1031);const d=x*(y+33.33)+y*(z+33.33)+z*(x+33.33);return fract((x+y+2*d)*(z+d));};
const noise=(x:number,y:number,z:number)=>{const X=Math.floor(x),Y=Math.floor(y),Z=Math.floor(z),smooth=(n:number)=>n*n*(3-2*n),fx=smooth(fract(x)),fy=smooth(fract(y)),fz=smooth(fract(z));let n=0;for(let k=0;k<2;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++)n+=hash(X+i,Y+j,Z+k)*(i?fx:1-fx)*(j?fy:1-fy)*(k?fz:1-fz);return n;};
export function paintVolumes(frame:Uint8Array,depth:Float64Array,volumes:VolumeInstances,center:number[],zoom:number,yaw:number,pitch:number,shades?:Uint8Array):void {
 const c=Math.cos(yaw),s=Math.sin(yaw),pc=Math.cos(pitch),ps=Math.sin(pitch),right=[c,0,s],up=[s*ps,pc,-c*ps],forward=[-s*pc,ps,c*pc];
 const d=volumes.data;
 for(let n=0;n<volumes.count;n++){
  const o=n*10,x=d[o]!,y=d[o+1]!,z=d[o+2]!,baseRadius=d[o+3]!,fire=d[o+4]===VOLUME_KIND.fire,seed=d[o+5]!,age=d[o+6]!,r=baseRadius*(fire?1:1+age*.7),height=fire?1.9:1;
  const rx=x-center[0]!,ry=y-center[1]!,rz=z-center[2]!,px=16+(rx*c+rz*s)*zoom,py=16-(ry*pc-(-rx*s+rz*c)*ps)*zoom,pz=ry*ps+(-rx*s+rz*c)*pc;
  const extent=r*height*zoom,warp:number[]=[];curlNoise(seed,age*3,seed*.3,age,warp);
  for(let sy=Math.max(1,Math.floor(py-extent));sy<=Math.min(30,Math.ceil(py+extent));sy++)for(let sx=Math.max(1,Math.floor(px-extent));sx<=Math.min(30,Math.ceil(px+extent));sx++){
   const dx=(sx+.5-px)/zoom,dy=-(sy+.5-py)/zoom;
   let dens=0,hot=0,front=-Infinity;
   for(let step=0;step<8;step++){
    const fd=r*height*(1-step/3.5),q=[right[0]!*dx+up[0]!*dy+forward[0]!*fd,right[1]!*dx+up[1]!*dy+forward[1]!*fd,right[2]!*dx+up[2]!*dy+forward[2]!*fd];
    const rad=(q[0]!/r)**2+(q[1]!/(r*height))**2+(q[2]!/r)**2;if(rad>1)continue;
    const freq=fire?3.4:2.1,ax=q[0]!/r*freq+warp[0]!*.6+seed*7.13,ay=q[1]!/r*freq+warp[1]!*.6-age*(fire?4:1.4),az=q[2]!/r*freq+warp[2]!*.6;
    const field=noise(ax,ay,az)*.65+noise(ax*2.3,ay*2.3,az*2.3)*.35;
    const shape=(1-rad)*(fire?Math.max(.2,1-q[1]!/(r*height)*.65):1),v=Math.max(0,field-.24)*3.1*shape;
    if(v>.03)front=Math.max(front,pz+fd);dens+=v;hot+=v*(1-rad);
   }
   const cover=(fire?Math.min(1,dens*.95*(1-age*.4)):Math.min(1,dens*.55*(1-age*.8)))*d[o+9]!,at=sy*32+sx;
   if(cover<SCREENS.bayer4.at(sx,sy)||front<depth[at]!)continue;
   frame[at]=fire?(hot/Math.max(.01,dens)>.42&&age<.65?3:2):1;if(shades)shades[at]=fire?0:cover>.8?3:cover>.45?2:1;depth[at]=front;
  }
 }
}
