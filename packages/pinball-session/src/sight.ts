import type {ArenaWorldDefinition,ArenaFrame,ArenaBallFrame} from '@keel-engine/pinball-arena';

type Probe=Pick<ArenaBallFrame,'x'|'y'|'arenaId'|'layer'|'elevation'>;
interface Obstacle {
 readonly ax:number;readonly ay:number;readonly bx:number;readonly by:number;
 readonly radius:number;readonly z:number;readonly z1:number;readonly layer:number;
 readonly gateId:string|null;readonly minX:number;readonly minY:number;readonly maxX:number;readonly maxY:number;
}
const CELL=256,MAX_CELLS=64;
function pointDistance(x:number,y:number,ax:number,ay:number,bx:number,by:number):number {
 const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy,t=den===0?0:Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/den));
 return(x-ax-dx*t)**2+(y-ay-dy*t)**2;
}
function distance(a:Probe,b:Probe,c:Obstacle):number {
 const cross=(px:number,py:number,qx:number,qy:number,rx:number,ry:number)=>(qx-px)*(ry-py)-(qy-py)*(rx-px);
 if(cross(a.x,a.y,b.x,b.y,c.ax,c.ay)*cross(a.x,a.y,b.x,b.y,c.bx,c.by)<=0&&cross(c.ax,c.ay,c.bx,c.by,a.x,a.y)*cross(c.ax,c.ay,c.bx,c.by,b.x,b.y)<=0&&Math.max(Math.min(a.x,b.x),Math.min(c.ax,c.bx))<=Math.min(Math.max(a.x,b.x),Math.max(c.ax,c.bx))&&Math.max(Math.min(a.y,b.y),Math.min(c.ay,c.by))<=Math.min(Math.max(a.y,b.y),Math.max(c.ay,c.by)))return 0;
 return Math.min(pointDistance(a.x,a.y,c.ax,c.ay,c.bx,c.by),pointDistance(b.x,b.y,c.ax,c.ay,c.bx,c.by),pointDistance(c.ax,c.ay,a.x,a.y,b.x,b.y),pointDistance(c.bx,c.by,a.x,a.y,b.x,b.y));
}
function obstacle(ax:number,ay:number,bx:number,by:number,radius:number,z:number,z1:number,layer:number,gateId:string|null):Obstacle {
 return{ax,ay,bx,by,radius,z,z1,layer,gateId,minX:Math.min(ax,bx)-radius,minY:Math.min(ay,by)-radius,maxX:Math.max(ax,bx)+radius,maxY:Math.max(ay,by)+radius};
}
/** Static geometry is indexed once. Long segments use a bounded fallback;
 * no diagonal can expand into millions of cells or disappear from queries. */
export function createSessionSight(world:ArenaWorldDefinition){
 const indexes=new Map(world.arenas.map(field=>{
  const items=[...field.rails.map(r=>obstacle(r.ax,r.ay,r.bx,r.by,r.radius,r.elevation,r.elevationB??r.elevation,r.layer,null)),...field.gates.map(g=>obstacle(g.ax,g.ay,g.bx,g.by,g.radius,g.elevation,g.elevation,g.layer,g.id)),...field.bumpers.map(b=>obstacle(b.x,b.y,b.x,b.y,b.radius,b.elevation,b.elevation,b.layer,null))];
  const bins=new Map<string,number[]>(),long=new Map<number,number[]>();let references=0;
  for(const [i,o]of items.entries()){
   const x0=Math.floor(o.minX/CELL),x1=Math.floor(o.maxX/CELL),y0=Math.floor(o.minY/CELL),y1=Math.floor(o.maxY/CELL);
   if((x1-x0+1)*(y1-y0+1)>MAX_CELLS){const list=long.get(o.layer)??[];list.push(i);long.set(o.layer,list);continue;}
   for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const key=`${o.layer}:${x}:${y}`,list=bins.get(key)??[];list.push(i);bins.set(key,list);references++;}
  }
  return[field.id,{items,bins,long,references}] as const;
 }));
 function forFrame(frame:ArenaFrame){
  const open=new Map(frame.gates.map(g=>[g.id,g.open])),blades=new Map<string,Obstacle[]>();
  for(const f of frame.flippers){const list=blades.get(f.arenaId)??[];list.push(obstacle(f.pivotX,f.pivotY,f.tipX,f.tipY,f.radius,f.elevation,f.elevation,f.layer,null));blades.set(f.arenaId,list);}
  return(a:Probe,b:Probe):boolean=>{
   const index=indexes.get(a.arenaId)!;const minX=Math.min(a.x,b.x),maxX=Math.max(a.x,b.x),minY=Math.min(a.y,b.y),maxY=Math.max(a.y,b.y),low=Math.min(a.elevation,b.elevation),high=Math.max(a.elevation,b.elevation);
   const blocks=(o:Obstacle)=>o.layer===a.layer&&(o.gateId===null||!open.get(o.gateId))&&Math.max(o.z,o.z1)>=low-4&&Math.min(o.z,o.z1)<=high+4&&o.maxX>=minX&&o.minX<=maxX&&o.maxY>=minY&&o.minY<=maxY&&distance(a,b,o)<=o.radius*o.radius;
   const x0=Math.floor(minX/CELL),x1=Math.floor(maxX/CELL),y0=Math.floor(minY/CELL),y1=Math.floor(maxY/CELL);
   // Public callers may query longer spans than a passing weapon; preserve
   // the reference result with bounded work rather than huge cell enumeration.
   if((x1-x0+1)*(y1-y0+1)>MAX_CELLS){for(const o of index.items)if(blocks(o))return false;}
   else{
    const seen=new Set<number>(index.long.get(a.layer)??[]);
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)for(const i of index.bins.get(`${a.layer}:${x}:${y}`)??[])seen.add(i);
    for(const i of seen)if(blocks(index.items[i]!))return false;
   }
   for(const blade of blades.get(a.arenaId)??[])if(blocks(blade))return false;
   return true;
  };
 }
 return{forFrame,getStats:()=>({obstacles:[...indexes.values()].reduce((n,i)=>n+i.items.length,0),references:[...indexes.values()].reduce((n,i)=>n+i.references,0),bins:[...indexes.values()].reduce((n,i)=>n+i.bins.size,0),long:[...indexes.values()].reduce((n,i)=>n+[...i.long.values()].reduce((s,a)=>s+a.length,0),0)})};
}
