import {createRoll,deriveSeed,normalizeSeed} from '@keel-engine/core/rng';
import {sha256,toHex} from '@keel-engine/codec/hash';
import {validateArenaWorld} from '@keel-engine/pinball-arena';
import type {ArenaWorldDefinition,ArenaField,ArenaPoint,ArenaBounds,ArenaBiome,ArenaBiomeBlend,ArenaRegion,ArenaPlayfield,ArenaRail,ArenaStation,ArenaFlipper,ArenaBumper,ArenaSwitch,ArenaGate,ArenaRamp,ArenaPortal,ArenaHazard,ArenaSurface,ArenaFlow,ArenaRouteNode,ArenaRouteEdge,ArenaChunk,ArenaArtInstance,ArenaRouteChallenge,ArenaGateRequirement} from '@keel-engine/pinball-arena';
import type {ArenaGenerationOptions} from './index.ts';
const VERSION='keel-pinball-place-gen@2';
const BIOMES=['forge','neon','garden','glacier','ruins'] as const;
const FAMILIES=['braided-grid','river-delta','citadel-ring','terraced-spine'] as const;
const MATERIAL={forge:'steel',neon:'glass',garden:'wood',glacier:'ice',ruins:'stone'} as const;
const FLOOR={forge:'copper-slag',neon:'dark-glass',garden:'soil',glacier:'snow',ruins:'sandstone'} as const;
const ASSETS:Readonly<Record<ArenaBiome,readonly string[]>>={forge:['forge-furnace','forge-turbine','forge-stack','rock'],neon:['neon-pylon','crystal'],garden:['oak','pine','birch','bush','grass','reeds','mushroom'],glacier:['glacier-spire','crystal','rock','pine'],ruins:['ruin-arch','ruin-column','ruin-vault','rock','bush']};

const q=(n:number)=>Math.round(n*1024)/1024;
const d=(a:ArenaPoint,b:ArenaPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
const rect=(b:ArenaBounds):readonly ArenaPoint[]=>[{x:b[0],y:b[1]},{x:b[2],y:b[1]},{x:b[2],y:b[3]},{x:b[0],y:b[3]}];
const blend=(a:ArenaBiome,b:ArenaBiome,mix=.25):ArenaBiomeBlend=>Object.fromEntries(BIOMES.map(k=>[k,k===a?1-mix:k===b?mix:0])) as Record<ArenaBiome,number>;
const primary=(b:ArenaBiomeBlend)=>BIOMES.reduce((a,c)=>b[a]>b[c]?a:c);
function freeze<T>(v:T):T{if(v&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}return v;}
function clip(poly:readonly ArenaPoint[],nx:number,ny:number,c:number):ArenaPoint[]{const out:ArenaPoint[]=[];for(let i=0;i<poly.length;i++){const a=poly[i]!,b=poly[(i+1)%poly.length]!,da=a.x*nx+a.y*ny-c,db=b.x*nx+b.y*ny-c;if(da<=0)out.push(a);if((da<=0)!==(db<=0)){const t=da/(da-db);out.push({x:q(a.x+(b.x-a.x)*t),y:q(a.y+(b.y-a.y)*t)});}}return out;}
function parcel(site:ArenaPoint,all:readonly ArenaPoint[],bounds:ArenaBounds):readonly ArenaPoint[]{let p=[...rect(bounds)];for(const other of all){if(other===site)continue;const nx=other.x-site.x,ny=other.y-site.y,c=(other.x*other.x+other.y*other.y-site.x*site.x-site.y*site.y)/2;p=clip(p,nx,ny,c);}return p;}
function sites(seed:string,family:typeof FAMILIES[number],w:number,h:number):ArenaPoint[]{const r=createRoll(seed),points:ArenaPoint[]=[];if(family==='citadel-ring'){for(let i=0;i<10;i++){const a=i*Math.PI/5+(r.at(1)/65535-.5)*.15;points.push({x:q(64+w/2+Math.cos(a)*w*(.31+r.at(20+i)/65535*.025)),y:q(64+h/2+Math.sin(a)*h*(.30+r.at(40+i)/65535*.025))});}}else{const columns=family==='river-delta'?3:4,rows=3;for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){const i=y*columns+x,jx=(r.at(10+i)/65535-.5)*.22,jy=(r.at(40+i)/65535-.5)*.16,stagger=family==='terraced-spine'?(y%2-.5)*.20:family==='river-delta'?(y-1)*.20:0;points.push({x:q(64+w*(x+1+jx+stagger)/(columns+1)),y:q(64+h*(y+1+jy)/(rows+1))});}}return points;}
function crossing(a:ArenaPoint,b:ArenaPoint,c:ArenaPoint,e:ArenaPoint){const orient=(p:ArenaPoint,q:ArenaPoint,r:ArenaPoint)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);return orient(a,b,c)*orient(a,b,e)<0&&orient(c,e,a)*orient(c,e,b)<0;}
function connectedPlan(points:readonly ArenaPoint[],seed:string):{a:number;b:number;loop:boolean}[]{const r=createRoll(seed),edges:{a:number;b:number;loop:boolean}[]=[],joined=new Set([0]);while(joined.size<points.length){let best={a:0,b:0,score:Infinity};for(const a of joined)for(let b=0;b<points.length;b++)if(!joined.has(b)){const score=d(points[a]!,points[b]!)*(1+r.at(a*16+b)/65535*.18);if(score<best.score)best={a,b,score};}edges.push({a:best.a,b:best.b,loop:false});joined.add(best.b);}const candidates:{a:number;b:number;score:number}[]=[];for(let a=0;a<points.length;a++)for(let b=a+1;b<points.length;b++)if(!edges.some(e=>e.a===a&&e.b===b||e.a===b&&e.b===a))candidates.push({a,b,score:d(points[a]!,points[b]!)*(1+r.at(160+a*16+b)/65535*.8)});candidates.sort((a,b)=>a.score-b.score||a.a-b.a||a.b-b.b);for(const c of candidates){if(edges.filter(e=>e.loop).length>=4+r.index(7,4))break;if(edges.some(e=>e.a!==c.a&&e.b!==c.a&&e.a!==c.b&&e.b!==c.b&&crossing(points[c.a]!,points[c.b]!,points[e.a]!,points[e.b]!)))continue;edges.push({...c,loop:true});}return edges;}
function segmentDistance(p:ArenaPoint,a:ArenaPoint,b:ArenaPoint){const dx=b.x-a.x,dy=b.y-a.y,ll=dx*dx+dy*dy,t=ll?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/ll)):0;return Math.hypot(p.x-a.x-dx*t,p.y-a.y-dy*t);}
function mouth(a:ArenaPoint,b:ArenaPoint,bounds:ArenaBounds):ArenaPoint{const dx=b.x-a.x,dy=b.y-a.y,tx=dx>0?(bounds[2]-a.x)/dx:dx<0?(bounds[0]-a.x)/dx:Infinity,ty=dy>0?(bounds[3]-a.y)/dy:dy<0?(bounds[1]-a.y)/dy:Infinity,t=Math.min(tx,ty);return {x:q(a.x+dx*t),y:q(a.y+dy*t)};}

/** A whole-place graph, parcels and shared pinball mechanisms share one seed.
 * Every participant bank opens into a common sector; no private solver rooms. */
/** @deprecated Rejected spatial/place experiment. For protocol diagnostics only;
 * never admit this as the procedural pinball product. */
export function createArenaWorld(seedHex:string,options:ArenaGenerationOptions={}):ArenaWorldDefinition {
 const seed=normalizeSeed(seedHex),count=options.arenas??1,players=options.players??100,teamSize=options.teamSize??5,detail=options.detail??'medium';
 if(![1,2,3].includes(count)||!Number.isInteger(players)||players<1||players>100||![1,5].includes(teamSize)||!['low','medium','high'].includes(detail))throw new Error('Invalid world generation options');
 const arenas:ArenaField[]=[],links:{id:string;a:string;b:string;portalA:string;portalB:string}[]=[];
 for(let ai=0;ai<count;ai++){
  const id=`arena-${ai}`,aseed=deriveSeed(seed,`${VERSION}:arena:${ai}`),roll=createRoll(aseed),family=FAMILIES[roll.index(0,FAMILIES.length)]!,w=(ai===0?24000:18000)+roll.index(1,12)*128,h=(ai===0?16000:13000)+roll.index(2,10)*128,bounds:ArenaBounds=[64,64,64+w,64+h],points=sites(aseed,family,w,h),plan=connectedPlan(points,aseed),regions:ArenaRegion[]=[],playfields:ArenaPlayfield[]=[],rails:ArenaRail[]=[],bumpers:ArenaBumper[]=[],flippers:ArenaFlipper[]=[],stations:ArenaStation[]=[],switches:ArenaSwitch[]=[],gates:ArenaGate[]=[],ramps:ArenaRamp[]=[],portals:ArenaPortal[]=[],hazards:ArenaHazard[]=[],surfaces:ArenaSurface[]=[],flows:ArenaFlow[]=[],nodes:ArenaRouteNode[]=[],edges:ArenaRouteEdge[]=[],challenges:ArenaRouteChallenge[]=[],requirements:ArenaGateRequirement[]=[],chunks:ArenaChunk[]=[],sectorMouths:ArenaPoint[][]=points.map(()=>[]);
  const bankCount=ai===0?players:12,units=ai===0&&teamSize===5?Math.ceil(bankCount/5):bankCount,unitSize=ai===0&&teamSize===5?5:1,assigned=points.map((_,i)=>(Math.floor(units/points.length)+(i<units%points.length?1:0))*unitSize);if(unitSize===5&&bankCount%5){const last=assigned.reduce((last,n,i)=>n>0?i:last,0);assigned[last]!-=5-bankCount%5;}
  const bankSpacing=360;
  const fieldBounds=points.map((p,i):ArenaBounds=>[p.x-Math.max(1600,assigned[i]!*bankSpacing/2+300),p.y-1200,p.x+Math.max(1600,assigned[i]!*bankSpacing/2+300),p.y+1250]);
  const rail=(rid:string,a:ArenaPoint,b:ArenaPoint,material:ArenaRail['material']='steel',layer=0,elevation=0)=>{const n=Math.ceil(d(a,b)/768);for(let k=0;k<n;k++)rails.push({id:`${id}.${rid}.${k}`,ax:q(a.x+(b.x-a.x)*k/n),ay:q(a.y+(b.y-a.y)*k/n),bx:q(a.x+(b.x-a.x)*(k+1)/n),by:q(a.y+(b.y-a.y)*(k+1)/n),radius:3,restitution:.92,layer,elevation,material});};
  const wall=(rid:string,a:ArenaPoint,b:ArenaPoint,holes:readonly ArenaPoint[],material:ArenaRail['material'])=>{const length=d(a,b),dx=(b.x-a.x)/length,dy=(b.y-a.y)/length,spans=holes.filter(p=>segmentDistance(p,a,b)<5).map(p=>Math.max(0,Math.min(length,(p.x-a.x)*dx+(p.y-a.y)*dy))).sort((a,b)=>a-b);let cursor=0;for(const x of [...spans,length+260]){const end=Math.min(length,x-260);if(end>cursor+20)rail(`${rid}.${Math.round(cursor)}`,{x:a.x+dx*cursor,y:a.y+dy*cursor},{x:a.x+dx*end,y:a.y+dy*end},material);cursor=Math.min(length,x+260);}};
  for(let i=0;i<points.length;i++){const p=points[i]!,poly=parcel(p,points,bounds),a=BIOMES[(i+roll.index(5,5))%5]!,b=BIOMES[(i+roll.index(5,5)+1)%5]!,biome=blend(a,b,.15+roll.at(10+i)/65535*.28),rid=`${id}.region.${i}`;regions.push({id:rid,name:({forge:'FOUNDRY BASIN',neon:'NEON SWITCHYARD',garden:'ROOT MACHINE',glacier:'ICE CIRCUIT',ruins:'VAULTWORKS'} as const)[a],seed:deriveSeed(aseed,rid),center:p,bounds:[Math.min(...poly.map(p=>p.x)),Math.min(...poly.map(p=>p.y)),Math.max(...poly.map(p=>p.x)),Math.max(...poly.map(p=>p.y))],polygon:poly,biome,neighbors:plan.filter(e=>e.a===i||e.b===i).map(e=>`${id}.region.${e.a===i?e.b:e.a}`)});nodes.push({id:`${id}.junction.${i}`,x:p.x,y:p.y,layer:0,regionId:rid,kind:'junction'});surfaces.push({id:`${rid}.parcel`,kind:'ground',polygon:poly,layer:0,height:0,material:FLOOR[a],biome});}
  for(const [ei,e]of plan.entries()){
   const a=points[e.a]!,b=points[e.b]!,ma=mouth(a,b,fieldBounds[e.a]!),mb=mouth(b,a,fieldBounds[e.b]!),dx=mb.x-ma.x,dy=mb.y-ma.y,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len,width=e.loop?440:560;
   sectorMouths[e.a]!.push(ma);sectorMouths[e.b]!.push(mb);const material=MATERIAL[primary(regions[e.a]!.biome)];for(const side of [-1,1])rail(`connection.${ei}.${side}`,{x:ma.x+nx*width/2*side,y:ma.y+ny*width/2*side},{x:mb.x+nx*width/2*side,y:mb.y+ny*width/2*side},material);
   edges.push({id:`${id}.connection.${ei}`,a:`${id}.junction.${e.a}`,b:`${id}.junction.${e.b}`,width,bidirectional:true,kind:e.loop?'orbit':'crossing'});surfaces.push({id:`${id}.connection.${ei}.bed`,kind:'ground',polygon:[{x:q(ma.x+nx*width/2),y:q(ma.y+ny*width/2)},{x:q(mb.x+nx*width/2),y:q(mb.y+ny*width/2)},{x:q(mb.x-nx*width/2),y:q(mb.y-ny*width/2)},{x:q(ma.x-nx*width/2),y:q(ma.y-ny*width/2)}],layer:0,height:0,material:'shot-track',biome:regions[e.a]!.biome});
   if(e.loop){const mid={x:(ma.x+mb.x)/2,y:(ma.y+mb.y)/2},gid=`${id}.compound-gate.${ei}`,routeIds=[`${id}.shot.${e.a}.left`,`${id}.shot.${e.a}.right`];gates.push({id:gid,ax:q(mid.x-nx*width*.4),ay:q(mid.y-ny*width*.4),bx:q(mid.x+nx*width*.4),by:q(mid.y+ny*width*.4),radius:5,restitution:.86,layer:0,elevation:0,initiallyOpen:false});requirements.push({id:`${id}.requirement.${ei}`,name:'LEFT SHOT + RIGHT SHOT',routeIds,gateIds:[gid],scope:'team',holdTicks:1800,persistent:true});}
  }
  let owner=0;
  for(let i=0;i<points.length;i++){
   const p=points[i]!,region=regions[i]!,fb=fieldBounds[i]!,material=MATERIAL[primary(region.biome)],baseY=p.y-850,count=assigned[i]!,stationIds:string[]=[];
   // One shared playable bowl, multiple owner banks, open at every world route.
   wall(`sector.${i}.left`,{x:fb[0],y:baseY+300},{x:fb[0],y:fb[3]},sectorMouths[i]!,material);wall(`sector.${i}.right`,{x:fb[2],y:baseY+300},{x:fb[2],y:fb[3]},sectorMouths[i]!,material);wall(`sector.${i}.orbit`,{x:fb[0],y:fb[3]},{x:fb[2],y:fb[3]},sectorMouths[i]!,material);
   surfaces.push({id:`${id}.playfield.${i}.bed`,kind:'playfield',role:'shot',polygon:rect(fb),layer:0,height:0,material:'pinball-inlay',biome:region.biome});
   for(let bank=0;bank<count;bank++){
    const x=q(p.x+(bank-(count-1)/2)*bankSpacing),y=q(baseY),sid=`${id}.station.${owner}`,oid=ai===0?owner:-1,lid=`${sid}.left`,rid=`${sid}.right`,launchX=q(x-50),launchY=q(y+250);
    flippers.push({id:lid,ownerId:oid,side:'left',pivotX:q(x-125),pivotY:y,length:96,radius:8,restAngle:-18,activeAngle:35,layer:0,elevation:0},{id:rid,ownerId:oid,side:'right',pivotX:q(x+125),pivotY:y,length:96,radius:8,restAngle:198,activeAngle:145,layer:0,elevation:0});
    stations.push({id:sid,ownerId:oid,teamId:ai===0?Math.floor(owner/teamSize):-1,x,y,layer:0,elevation:0,launchX,launchY,launchVx:0,launchVy:-6,flipperIds:[lid,rid]});stationIds.push(sid);
    rail(`bank.${owner}.funnel.left`,{x:x-170,y:y+240},{x:x-125,y},material);rail(`bank.${owner}.funnel.right`,{x:x+170,y:y+240},{x:x+125,y},material);
    hazards.push({id:`${sid}.drain`,kind:'drain',x,y:q(y-140),radius:86,layer:0,elevation:0,damage:1,cooldownTicks:180});
    const node=`${sid}.node`;nodes.push({id:node,x,y,layer:0,regionId:region.id,kind:'station'});edges.push({id:`${sid}.feed`,a:node,b:`${id}.junction.${i}`,width:220,bidirectional:true,kind:'crossing'});owner++;
   }
   for(let k=0;k<4;k++){const bx=q(p.x+(k-1.5)*Math.min(700,(fb[2]-fb[0])*.19)),by=q(p.y+350+(k%2)*220);bumpers.push({id:`${id}.target-bank.${i}.${k}`,x:bx,y:by,radius:52+k%2*8,impulse:2.5,layer:0,elevation:0,kind:({forge:'turbine',neon:'coil',garden:'fungus',glacier:'crystal',ruins:'spring'} as const)[primary(region.biome)]});}
   const leftX=p.x-(fb[2]-fb[0])*.31,rightX=p.x+(fb[2]-fb[0])*.31;
   for(const [side,x]of [['left',leftX],['right',rightX]] as const)challenges.push({id:`${id}.shot.${i}.${side}`,name:side==='left'?'LEFT ORBIT SHOT':'RIGHT RETURN SHOT',checkpoints:[{x:q(x),y:q(p.y+200),radius:100,layer:0,elevation:0},{x:q(x),y:q(p.y+850),radius:100,layer:0,elevation:0}]});
   // Side return rail pair, with a real lifted shot ramp and descending exit.
   const rampX=q(leftX),rampA=q(p.y+150),rampB=q(p.y+450),upperEnd=q(p.y+1050),upperZ=110,width=180;
   ramps.push({id:`${id}.sector.${i}.ramp.up`,ax:rampX,ay:rampA,bx:rampX,by:rampB,width,fromLayer:0,toLayer:1,fromElevation:0,toElevation:upperZ,bidirectional:true},{id:`${id}.sector.${i}.ramp.down`,ax:rampX,ay:upperEnd,bx:rampX,by:upperEnd+300,width,fromLayer:1,toLayer:0,fromElevation:upperZ,toElevation:0,bidirectional:true});
   surfaces.push({id:`${id}.sector.${i}.bridge`,kind:'bridge',polygon:rect([rampX-width/2,rampB,rampX+width/2,upperEnd]),layer:1,height:upperZ,material:'steel-grate',biome:region.biome});for(const side of [-1,1])rail(`sector.${i}.bridge.${side}`,{x:rampX+side*width/2,y:rampB},{x:rampX+side*width/2,y:upperEnd},material,1,upperZ);
   // Gravity is local to the shared playfield; travel corridors remain flat.
   const gravityWidth=Math.min(600,fb[2]-fb[0]);for(let gx=fb[0]+gravityWidth/2;gx<fb[2];gx+=gravityWidth)flows.push({id:`${id}.gravity.${i}.${Math.round(gx)}`,ax:q(gx),ay:q(baseY-220),bx:q(gx),by:q(p.y+1400),width:gravityWidth,fx:0,fy:-.04,layer:0,maxSpeed:18});
   playfields.push({id:`${id}.playfield.${i}`,name:region.name,regionId:region.id,bounds:fb,stationIds,shotRouteIds:[`${id}.shot.${i}.left`,`${id}.shot.${i}.right`]});
  }
  // Portal entrances live at a known shared region junction, with explicit exits.
  const portalCount=ai===0?count-1:1;for(let k=0;k<portalCount;k++){const target=ai===0?k+1:0,p=points[(k+2)%points.length]!,pid=`${id}.portal.${target}`,targetId=`arena-${target}.portal.${ai}`;portals.push({id:pid,x:q(p.x),y:q(p.y+900),radius:65,layer:0,elevation:0,angle:0,targetArenaId:`arena-${target}`,targetPortalId:targetId});if(ai===0)links.push({id:`world.link.${target}`,a:id,b:`arena-${target}`,portalA:pid,portalB:targetId});}
  // Scenery occupies reserved exterior sites; all playable bowls and travel
  // approaches stay clear, including the fixed camera's foreground sightlines.
  const tile=1024,tries=detail==='low'?4:detail==='high'?18:10;
  for(let yy=bounds[1];yy<bounds[3];yy+=tile)for(let xx=bounds[0];xx<bounds[2];xx+=tile){const key=`${id}.chunk.${Math.floor((xx-64)/tile)}.${Math.floor((yy-64)/tile)}`,cseed=deriveSeed(aseed,key),r=createRoll(cseed),center={x:xx+tile/2,y:yy+tile/2},near=regions.reduce((a,b)=>d(center,a.center)<d(center,b.center)?a:b),biome=near.biome,assetIds=ASSETS[primary(biome)],instances:ArenaArtInstance[]=[];
   for(let n=0;n<tries;n++){const x=q(xx+80+r.at(20+n*3)/65535*(Math.min(tile,bounds[2]-xx)-160)),y=q(yy+80+r.at(21+n*3)/65535*(Math.min(tile,bounds[3]-yy)-160)),point={x,y};if(fieldBounds.some(f=>x>f[0]-500&&x<f[2]+500&&y>f[1]-1400&&y<f[3]+450)||plan.some(e=>segmentDistance(point,points[e.a]!,points[e.b]!)<900))continue;
    instances.push({id:`${key}.prop.${n}`,assetId:assetIds[r.index(22+n*3,assetIds.length)]!,seed:deriveSeed(cseed,`prop:${n}`),x,y,z:0,yaw:r.at(80+n)/65535*Math.PI*2,scale:.65+r.at(100+n)/65535*.65});}
   chunks.push({id:key,bounds:[xx,yy,Math.min(bounds[2],xx+tile),Math.min(bounds[3],yy+tile)],layer:0,height:0,biome,seed:cseed,instances});
  }
  arenas.push({id,name:ai===0?'THE CONFLUENCE':ai===1?'HIGH VAULT MACHINES':'ROOTWORK DEPTHS',seed:aseed,bounds,gravity:{x:0,y:0},topology:family,regions,playfields,chunks,rails,bumpers,flippers,stations,switches,gates,ramps,portals,hazards,surfaces,flows,routes:{nodes,edges},challenges,requirements});
 }
 const body={schema:'keel-pinball-arena-world@1' as const,generatorVersion:VERSION,id:`confluence-${seed.slice(-12)}`,seed,unitScale:.025,arenas,links},canonical=JSON.stringify(body),world=freeze({...body,canonical,sha256:toHex(sha256(new TextEncoder().encode(canonical)))});validateArenaWorld(world);return world;
}
