import {dcos,dsin} from '@keel-engine/core';
import type {Build} from '../frame.ts';
type Point=readonly [number,number];type Box={x0:number;x1:number;z0:number;z1:number};
export const ACTIVITY_RADIUS=1.7,ACTIVITY_BODY_RADIUS=.35;
const GAP=.05;
function blocked(a:Point,b:Point,o:Box){let lo=0,hi=1;for(const [p,d,min,max]of [[a[0],b[0]-a[0],o.x0,o.x1],[a[1],b[1]-a[1],o.z0,o.z1]]){if(d===0){if(p!<min!||p!>max!)return false;}else{const u=(min!-p!)/d!,v=(max!-p!)/d!;lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));if(lo>hi)return false;}}return true;}
/** The same expanded obstacle set proves the activity disc and its access.
 * Boxes conservatively contain round props and plants; no neighbour cap. */
export function activityObstacles(b:Build):Box[]{
 const out:Box[]=[],circle=(x:number,z:number,r:number)=>out.push({x0:x-r,x1:x+r,z0:z-r,z1:z+r});
 for(const p of b.props)circle(p.x,p.z,p.r);
 for(const p of b.plants)if(['tree','conifer','bush','hedge'].includes(p.kind))circle(p.x,p.z,3.5*p.scale);
 for(const a of b.activityAreas)circle(a.center[0],a.center[1],a.radius);
 for(const o of [...b.barriers,...b.water.map(w=>w.obb)]){const c=Math.abs(dcos(o.yaw)),s=Math.abs(dsin(o.yaw)),x=c*o.hw+s*o.hd,z=s*o.hw+c*o.hd;out.push({x0:o.x-x,x1:o.x+x,z0:o.z-z,z1:o.z+z});}
 return out;
}
export function activityAccess(b:Build,center:Point):{walk:string;path:readonly Point[]}|null{
 const c=dcos(b.frame.yaw),s=dsin(b.frame.yaw),inside=(p:Point,r:number)=>{const x=(p[0]-b.frame.x)*c-(p[1]-b.frame.z)*s,z=(p[0]-b.frame.x)*s+(p[1]-b.frame.z)*c;return Math.abs(x-b.site.x)+r<=b.site.hw&&Math.abs(z-b.site.z)+r<=b.site.hd;};
 if(!inside(center,ACTIVITY_RADIUS))return null;
 // A later anchor cannot sever an earlier anchor's already checked access.
 for(const area of b.activityAreas)for(let i=1;i<area.access.path.length;i++){const a=area.access.path[i-1]!,z=area.access.path[i]!,dx=z[0]-a[0],dz=z[1]-a[1],l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((center[0]-a[0])*dx+(center[1]-a[1])*dz)/l)):0;if(Math.hypot(center[0]-a[0]-dx*t,center[1]-a[1]-dz*t)<=ACTIVITY_RADIUS+area.bodyRadius+GAP)return null;}
 const raw=activityObstacles(b);
 if(raw.some(o=>blocked(center,center,{x0:o.x0-ACTIVITY_RADIUS-GAP,x1:o.x1+ACTIVITY_RADIUS+GAP,z0:o.z0-ACTIVITY_RADIUS-GAP,z1:o.z1+ACTIVITY_RADIUS+GAP})))return null;
 const pad=ACTIVITY_BODY_RADIUS+GAP,obstacles=raw.map(o=>({x0:o.x0-pad,x1:o.x1+pad,z0:o.z0-pad,z1:o.z1+pad})),clear=(a:Point,z:Point)=>inside(a,pad)&&inside(z,pad)&&obstacles.every(o=>!blocked(a,z,o));
 const starts:{point:Point;walk:string}[]=[];
 for(const w of b.walks)if(!w.activity&&w.width>=2*pad)for(let i=1;i<w.path.length;i++){const a=w.path[i-1]!,z=w.path[i]!,dx=z[0]-a[0],dz=z[1]-a[1],length=dx*dx+dz*dz,t=length?Math.max(0,Math.min(1,((center[0]-a[0])*dx+(center[1]-a[1])*dz)/length)):0;starts.push({point:[a[0]+dx*t,a[1]+dz*t],walk:w.key});}
 starts.sort((a,z)=>Math.hypot(a.point[0]-center[0],a.point[1]-center[1])-Math.hypot(z.point[0]-center[0],z.point[1]-center[1])||(a.walk<z.walk?-1:a.walk>z.walk?1:0));
 for(const a of starts)if(clear(a.point,center))return{walk:a.walk,path:[a.point,center]};
 // Visibility graph with deterministic Dijkstra ties. A clear connected lawn
 // can route around furniture instead of being classified inaccessible merely
 // because its shortest straight approach is obstructed.
 const corners:Point[]=[];for(const o of obstacles)for(const p of [[o.x0-GAP,o.z0-GAP],[o.x0-GAP,o.z1+GAP],[o.x1+GAP,o.z0-GAP],[o.x1+GAP,o.z1+GAP]] as Point[])if(clear(p,p))corners.push(p);
 const points=[center,...starts.map(a=>a.point),...corners],distance=points.map(()=>Infinity),parent=points.map(()=>-1),done=new Set<number>();distance[0]=0;
 for(let count=0;count<points.length;count++){let u=-1;for(let i=0;i<points.length;i++)if(!done.has(i)&&(u<0||distance[i]!<distance[u]!))u=i;if(u<0||!Number.isFinite(distance[u]))break;done.add(u);
  if(u>0&&u<=starts.length){const path:Point[]=[];for(let i=u;i>=0;i=parent[i]!)path.push(points[i]!);return{walk:starts[u-1]!.walk,path};}
  for(let v=1;v<points.length;v++)if(!done.has(v)&&clear(points[u]!,points[v]!)){const d=distance[u]!+Math.hypot(points[u]![0]-points[v]![0],points[u]![1]-points[v]![1]);if(d<distance[v]!){distance[v]=d;parent[v]=u;}}
 }return null;
}
