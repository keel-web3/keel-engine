export {manifest} from './module.ts';
import {normalizeSeed,deriveSeed} from '@keel-engine/core/rng';
import {sha256,toHex} from '@keel-engine/codec/hash';
import {validateArenaWorld} from '@keel-engine/pinball-arena';
import type {ArenaWorldDefinition,ArenaField,ArenaBiome,ArenaBiomeBlend,ArenaPoint,ArenaRail,ArenaSurface,ArenaChunk} from '@keel-engine/pinball-arena';

export const CLASSIC_CABINET_REVISION='keel-pinball-cabinet@1';
const q=(n:number)=>Math.round(n*1024)/1024;
const rectangle=(x0:number,y0:number,x1:number,y1:number):readonly ArenaPoint[]=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}

/** An original authored board. The seed selects art identity; physical layout is
 * fixed so that shot qualification describes the board actually being played. */
export function createClassicCabinet(seedHex:string,theme:ArenaBiome='neon'):ArenaWorldDefinition {
 const seed=normalizeSeed(seedHex),biome:ArenaBiomeBlend={forge:theme==='forge'?1:0,neon:theme==='neon'?1:0,garden:theme==='garden'?1:0,glacier:theme==='glacier'?1:0,ruins:theme==='ruins'?1:0};
 if(!Object.values(biome).some(Boolean))throw new Error('Unknown cabinet theme');
 const id='classic',rails:ArenaRail[]=[],surfaces:ArenaSurface[]=[],chunks:ArenaChunk[]=[];
 function rail(name:string,a:ArenaPoint,b:ArenaPoint,layer=0,elevation=0,radius=6,restitution=.92){
  const segments=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/768);
  for(let i=0;i<segments;i++)rails.push({id:`${id}.${name}.${i}`,ax:q(a.x+(b.x-a.x)*i/segments),ay:q(a.y+(b.y-a.y)*i/segments),bx:q(a.x+(b.x-a.x)*(i+1)/segments),by:q(a.y+(b.y-a.y)*(i+1)/segments),radius,restitution,layer,elevation,material:'steel'});
 }
 function path(name:string,points:readonly ArenaPoint[],width:number,layer=0,elevation=0,role:ArenaSurface['role']='return'){
  for(let i=0;i<points.length-1;i++){
   const a=points[i]!,b=points[i+1]!,length=Math.hypot(b.x-a.x,b.y-a.y),nx=-(b.y-a.y)/length*width/2,ny=(b.x-a.x)/length*width/2;
   surfaces.push({id:`${id}.${name}.bed.${i}`,kind:layer?'bridge':'playfield',role,polygon:[{x:q(a.x+nx),y:q(a.y+ny)},{x:q(b.x+nx),y:q(b.y+ny)},{x:q(b.x-nx),y:q(b.y-ny)},{x:q(a.x-nx),y:q(a.y-ny)}],layer,height:elevation,material:'shot-track',biome});
  }
 }
 const outer=[{x:80,y:700},{x:80,y:1600},{x:110,y:1710},{x:220,y:1800},{x:1000,y:1800},{x:1120,y:1700}];
 for(let i=0;i<outer.length-1;i++)rail('orbit.outer.'+i,outer[i]!,outer[i+1]!);
 rail('right.wall',{x:1120,y:700},{x:1120,y:1610});
 const inner=[{x:210,y:800},{x:210,y:1590},{x:300,y:1690},{x:990,y:1690}];
 for(let i=0;i<inner.length-1;i++)rail('orbit.inner.'+i,inner[i]!,inner[i+1]!,0,0,5);
 // The plunger shoots into a real angled deflector and the upper orbit.
 rail('shooter.outer',{x:1260,y:120},{x:1260,y:1710});
 rail('shooter.inner',{x:1170,y:120},{x:1170,y:1640});
 rail('shooter.deflector',{x:1150,y:1820},{x:1260,y:1710},0,0,6,1);
 rail('shooter.top',{x:1000,y:1820},{x:1150,y:1820});
 path('shooter',[{x:1210,y:180},{x:1210,y:1740},{x:980,y:1740}],78,0,0,'shot');
 path('outer-orbit',[{x:1030,y:1740},{x:250,y:1740},{x:145,y:1630},{x:145,y:770}],80);
 // Funnel contact sends a returning ball to usable flippers. Central drain is
 // physically beyond the flipper gap, not a decorative damage pool.
 rail('funnel.left',{x:80,y:700},{x:475,y:300},0,0,6,.85);
 rail('funnel.right',{x:1120,y:700},{x:725,y:300},0,0,6,.85);
 rail('return.left',{x:210,y:800},{x:470,y:510},0,0,4,.86);
 rail('return.right',{x:1020,y:800},{x:735,y:510},0,0,4,.86);
 path('left-inlane',[{x:145,y:770},{x:405,y:450},{x:505,y:350}],72);
 path('right-inlane',[{x:1070,y:770},{x:785,y:450},{x:695,y:350}],72);
 // A shot rises off the board, crosses above ground colliders and physically
 // descends at a known exit. No ball hiding or layer jump is cosmetic.
 const upper=[{x:970,y:1170},{x:970,y:1380},{x:820,y:1530},{x:390,y:1530},{x:250,y:1380}];
 path('raised-return',upper,90,1,100);
 for(let i=0;i<upper.length-1;i++){
  const a=upper[i]!,b=upper[i+1]!,length=Math.hypot(b.x-a.x,b.y-a.y),nx=-(b.y-a.y)/length*45,ny=(b.x-a.x)/length*45;
  for(const sign of [-1,1])rail(`raised-return.${i}.${sign}`,{x:a.x+nx*sign,y:a.y+ny*sign},{x:b.x+nx*sign,y:b.y+ny*sign},1,100,4);
 }
 path('ramp-mouth',[{x:970,y:900},{x:970,y:1170}],90,0,0,'shot');
 path('ramp-exit',[{x:250,y:1380},{x:250,y:1120}],90,1,100);
 const bounds=[64,64,1280,1850] as const;
 surfaces.unshift({id:'classic.bed',kind:'playfield',role:'shot',polygon:rectangle(80,120,1260,1820),layer:0,height:0,material:'pinball-inlay',biome});
 for(let y=bounds[1];y<bounds[3];y+=512)for(let x=bounds[0];x<bounds[2];x+=512){const key=`classic.chunk.${x}.${y}`;chunks.push({id:key,bounds:[x,y,Math.min(x+512,bounds[2]),Math.min(y+512,bounds[3])],layer:0,height:0,biome,seed:deriveSeed(seed,key),instances:[]});}
 const field:ArenaField={id,name:'CHROMA CIRCUIT',seed,gravity:{x:0,y:-.04},bounds,regions:[{id:'classic.board',name:'CHROMA CIRCUIT',bounds,center:{x:650,y:950},neighbors:[],biome,seed}],chunks,rails,surfaces,
  flippers:[{id:'classic.left',ownerId:0,side:'left',pivotX:475,pivotY:300,length:96,radius:8,restAngle:-18,activeAngle:35,layer:0,elevation:0},{id:'classic.right',ownerId:0,side:'right',pivotX:725,pivotY:300,length:96,radius:8,restAngle:198,activeAngle:145,layer:0,elevation:0}],
  stations:[{id:'classic.home',ownerId:0,teamId:0,x:600,y:340,layer:0,elevation:0,launchX:1210,launchY:180,launchVx:0,launchVy:18,flipperIds:['classic.left','classic.right']}],
  bumpers:[{id:'classic.coil.left',x:320,y:1200,radius:58,impulse:2,layer:0,elevation:0,kind:'coil'},{id:'classic.coil.right',x:910,y:1220,radius:58,impulse:2,layer:0,elevation:0,kind:'coil'},{id:'classic.coil.center',x:620,y:1400,radius:64,impulse:2,layer:0,elevation:0,kind:'spring'}],
  switches:[400,465,530].map((x,i)=>({id:`classic.target.${i}`,x,y:1480,radius:24,layer:0,elevation:0,gateIds:['classic.bank-gate'],holdTicks:900})),
  gates:[{id:'classic.bank-gate',ax:1010,ay:1620,bx:1110,by:1620,radius:5,restitution:.85,layer:0,elevation:0,initiallyOpen:false}],
  ramps:[{id:'classic.ramp.up',ax:970,ay:900,bx:970,by:1170,width:90,fromLayer:0,toLayer:1,fromElevation:0,toElevation:100,bidirectional:true},{id:'classic.ramp.down',ax:250,ay:1380,bx:250,by:1120,width:90,fromLayer:1,toLayer:0,fromElevation:100,toElevation:0,bidirectional:false}],
  portals:[],flows:[],hazards:[{id:'classic.drain',kind:'drain',x:600,y:160,radius:90,layer:0,elevation:0,damage:0,cooldownTicks:120}],
  challenges:[{id:'classic.orbit',name:'OUTER ORBIT',checkpoints:[{x:1020,y:1740,radius:55,layer:0,elevation:0},{x:145,y:1420,radius:55,layer:0,elevation:0}]},{id:'classic.raised-shot',name:'RAISED RETURN',checkpoints:[{x:970,y:840,radius:45,layer:0,elevation:0},{x:970,y:1260,radius:55,layer:1,elevation:100}]}],
  requirements:[],playfields:[{id:'classic.playfield',name:'CHROMA CIRCUIT',regionId:'classic.board',bounds,stationIds:['classic.home'],shotRouteIds:['classic.orbit','classic.raised-shot']}],routes:{nodes:[{id:'classic.catch',x:600,y:340,layer:0,regionId:'classic.board',kind:'station'},{id:'classic.upper',x:650,y:1480,layer:0,regionId:'classic.board',kind:'junction'}],edges:[{id:'classic.field',a:'classic.catch',b:'classic.upper',width:850,bidirectional:true,kind:'crossing'}]}
 };
 const body={schema:'keel-pinball-arena-world@1' as const,generatorVersion:CLASSIC_CABINET_REVISION,id:`chroma-circuit-${seed.slice(-8)}`,seed,unitScale:.025,arenas:[field],links:[]},canonical=JSON.stringify(body),world=freeze({...body,canonical,sha256:toHex(sha256(new TextEncoder().encode(canonical)))});
 validateArenaWorld(world);return world;
}
