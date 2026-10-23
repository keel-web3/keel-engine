export {planArcadePinballWorld,inspectArcadeScript,missingArcadeCapabilities,ARCADE_SCRIPT_REVISION,type ArcadeScript,type ArcadeAssemblyPlan,type ArcadeConnectionPlan,type ArcadeJunctionPlan,type ArcadeShotPlan,type ArcadePortPlan,type ArcadeMechanismVisualPlan,type ArcadeTopology,type ArcadeAssemblyFamily,type ArcadeShotFamily,type ArcadeTheme,type ArcadeCapability} from './arcade-script.ts';
export {compileArcadeCatch,ARCADE_CATCH_REVISION,type ArcadeCatchOptions,type ArcadeCatchSpec} from './catch.ts';
export {inspectArcadeBankClearance,compileForkBasin,compileTerraceSwitchback,compileLoopGallery,measureArcadeCatch,measureArcadeDownstreamCatch,arcadeFragmentProbeWorld,ARCADE_COMPILER_REVISION,type ArcadeAssemblyFragment,type ArcadeAssemblyCompileOptions,type ArcadeBankServe,type ArcadeAssemblyBindings,type ArcadeRayBinding,type ArcadeCompiledPortBinding} from './arcade-compiler.ts';
export {qualifyArcadeAssembly,qualifyArcadeTerraceCascade,qualifyArcadeRecovery,replayArcadeRoute,type ArcadeQualifiedAssembly,type ArcadeQualifiedCascade,type ArcadeRecoveryReceipt,type ArcadeRouteReceipt,type ArcadeInputSpan} from './arcade-admission.ts';
export {compilePinballMachine,type PinballMachineRecipe,type PinballShotBinding} from './machine.ts';
export {generateQualifiedPinballMachine,createPinballCandidateWorld,replayPinballReceipt,PinballGenerationError,PINBALL_COMPILER_REVISION,type QualifiedPinballMachine,type PinballShotReceipt,type PinballInputSpan,type PinballControlReceipt,type PinballTimingWindow,type PinballQualificationOptions} from './qualified.ts';
/** @deprecated Rejected spatial diagnostic, retained only for existing probes. */
export {createArenaWorld,createArenaWorld as createRejectedSpatialDiagnosticWorld} from './generator.ts';
export {manifest} from './module.ts';
import {createRoll,deriveSeed,normalizeSeed} from '@keel-engine/core/rng';
import {sha256,toHex} from '@keel-engine/codec/hash';
import {validateArenaWorld} from '@keel-engine/pinball-arena';
import type {ArenaWorldDefinition,ArenaField,ArenaBiome,ArenaBiomeBlend,ArenaRegion,ArenaRail,ArenaBumper,ArenaFlipper,ArenaStation,ArenaSwitch,ArenaGate,ArenaRamp,ArenaPortal,ArenaSurface,ArenaChunk,ArenaFlow,ArenaRouteNode,ArenaRouteEdge,ArenaArtInstance,ArenaPoint,ArenaHazard} from '@keel-engine/pinball-arena';
export const ARENA_GENERATOR_VERSION='keel-pinball-arena-gen@1';
const BIOMES=['forge','neon','garden','glacier','ruins'] as const;
const ASSETS:Readonly<Record<ArenaBiome,readonly string[]>>={forge:['forge-furnace','forge-turbine','forge-stack','rock'],neon:['neon-pylon','crystal'],garden:['oak','pine','birch','bush','grass','reeds','mushroom'],glacier:['glacier-spire','crystal','rock','pine'],ruins:['ruin-arch','ruin-column','ruin-vault','rock','bush']};
const MATERIAL={forge:'steel',neon:'glass',garden:'wood',glacier:'ice',ruins:'stone'} as const;
const q=(n:number)=>Math.round(n*1024)/1024;
const rect=(x0:number,y0:number,x1:number,y1:number):readonly ArenaPoint[]=>[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
const digest=(v:unknown)=>toHex(sha256(new TextEncoder().encode(JSON.stringify(v))));
const blend=(primary:ArenaBiome,secondary:ArenaBiome,mix=.2):ArenaBiomeBlend=>Object.freeze(Object.fromEntries(BIOMES.map(b=>[b,b===primary?1-mix:b===secondary?mix:0])) as Record<ArenaBiome,number>);
function freeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export interface ArenaGenerationOptions {readonly arenas?:1|2|3;readonly players?:number;readonly teamSize?:1|5;readonly detail?:'low'|'medium'|'high'}
/** Entire spatial layout and mechanisms are seeded; art detail never changes it. */
export function createDiagnosticArenaWorld(seedHex:string,options:ArenaGenerationOptions={}):ArenaWorldDefinition{
 const seed=normalizeSeed(seedHex),count=options.arenas??1,players=options.players??100,teamSize=options.teamSize??5,detail=options.detail??'medium';
 if(![1,2,3].includes(count)||!Number.isInteger(players)||players<1||players>100||![1,5].includes(teamSize)||!['low','medium','high'].includes(detail))throw new Error('Invalid arena generation options');
 const arenas:ArenaField[]=[],links:{id:string;a:string;b:string;portalA:string;portalB:string}[]=[];
 for(let ai=0;ai<count;ai++){
  const arenaId=`arena-${ai}`,arenaSeed=deriveSeed(seed,`${ARENA_GENERATOR_VERSION}:field:${ai}`),roll=createRoll(arenaSeed),width=(ai===0?6200:4000)+roll.index(0,7)*64,height=(ai===0?3968:3008)+roll.index(1,7)*64,x0=64,y0=64,x1=x0+width,y1=y0+height,cx=(x0+x1)/2,cy=(y0+y1)/2;
  const regions:ArenaRegion[]=[],rails:ArenaRail[]=[],bumpers:ArenaBumper[]=[],flippers:ArenaFlipper[]=[],stations:ArenaStation[]=[],switches:ArenaSwitch[]=[],gates:ArenaGate[]=[],ramps:ArenaRamp[]=[],portals:ArenaPortal[]=[],hazards:ArenaHazard[]=[],surfaces:ArenaSurface[]=[],chunks:ArenaChunk[]=[],flows:ArenaFlow[]=[],nodes:ArenaRouteNode[]=[],edges:ArenaRouteEdge[]=[];
  const offset=roll.index(16,5),centers:readonly ArenaPoint[]=Array.from({length:6},(_,i)=>{const angle=-Math.PI/2+i*Math.PI/3+(roll.at(2)/65535-.5)*.2,rx=.30+roll.at(3+i)/65535*.04,ry=.29+roll.at(9+i)/65535*.05;return {x:q(cx+Math.cos(angle)*width*rx),y:q(cy+Math.sin(angle)*height*ry)};});
  for(let i=0;i<6;i++){const center=centers[i]!,primary=BIOMES[(i+offset)%5]!,secondary=BIOMES[(i+offset+1)%5]!,id=`${arenaId}.region.${i}`,rseed=deriveSeed(arenaSeed,`region:${i}`);regions.push({id,name:({forge:'THE FOUNDRY',neon:'NEON HEIGHTS',garden:'ROOT GARDENS',glacier:'GLACIER RUN',ruins:'VAULT RUINS'} as const)[primary],center,bounds:[Math.max(x0,center.x-width*.23),Math.max(y0,center.y-height*.26),Math.min(x1,center.x+width*.23),Math.min(y1,center.y+height*.26)],biome:blend(primary,secondary,.15+roll.at(20+i)/65535*.2),seed:rseed,neighbors:[`${arenaId}.region.${(i+5)%6}`,`${arenaId}.region.${(i+1)%6}`]});nodes.push({id:`${arenaId}.node.${i}`,x:center.x,y:center.y,layer:0,regionId:id,kind:'junction'});}
  nodes.push({id:`${arenaId}.hub`,x:cx,y:cy,layer:0,regionId:regions[0]!.id,kind:'junction'});
  const rail=(id:string,ax:number,ay:number,bx:number,by:number,layer=0,elevation=0,material:ArenaRail['material']='steel')=>{
   const n=Math.ceil(Math.hypot(bx-ax,by-ay)/768);for(let i=0;i<n;i++)rails.push({id:`${arenaId}.${id}.${i}`,ax:q(ax+(bx-ax)*i/n),ay:q(ay+(by-ay)*i/n),bx:q(ax+(bx-ax)*(i+1)/n),by:q(ay+(by-ay)*(i+1)/n),radius:3,restitution:.88,layer,elevation,material});
  };
  rail('wall-n',x0,y0,x1,y0);rail('wall-e',x1,y0,x1,y1);rail('wall-s',x1,y1,x0,y1);rail('wall-w',x0,y1,x0,y0);
  const corridor=(id:string,a:ArenaPoint,b:ArenaPoint,width:number,layer=0,elevation=0,material:ArenaRail['material']='steel',sides=true)=>{
   const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len,trim=140;
   if(sides)for(const side of [-1,1])rail(`${id}.rail.${side}`,a.x+dx/len*trim+nx*width/2*side,a.y+dy/len*trim+ny*width/2*side,b.x-dx/len*trim+nx*width/2*side,b.y-dy/len*trim+ny*width/2*side,layer,elevation,material);
   flows.push({id:`${arenaId}.${id}.flow`,ax:a.x,ay:a.y,bx:b.x,by:b.y,width,fx:q(dx/len*.018),fy:q(dy/len*.018),layer,maxSpeed:10});
  };
  for(let i=0;i<6;i++){const a=centers[i]!,b=centers[(i+1)%6]!,material=MATERIAL[BIOMES[(i+offset)%5]!];corridor(`orbit.${i}`,a,b,360,0,0,material);edges.push({id:`${arenaId}.edge.orbit.${i}`,a:`${arenaId}.node.${i}`,b:`${arenaId}.node.${(i+1)%6}`,width:360,bidirectional:true,kind:'orbit'});
   // Cross-field branches remain open at both ends, feeding the common hub.
   if(i%2===0||roll.index(110+i,2)===0){corridor(`cross.${i}`,a,{x:cx,y:cy},300,0,0,material,false);edges.push({id:`${arenaId}.edge.cross.${i}`,a:`${arenaId}.node.${i}`,b:`${arenaId}.hub`,width:300,bidirectional:true,kind:'crossing'});}
   const primary=BIOMES[(i+offset)%5]!,kind=({forge:'turbine',neon:'coil',garden:'fungus',glacier:'crystal',ruins:'spring'} as const)[primary];
   for(let k=0;k<3;k++){const angle=k*Math.PI*2/3+roll.at(40+i)/65535,rx=a.x+Math.cos(angle)*135,ry=a.y+Math.sin(angle)*135;bumpers.push({id:`${arenaId}.bumper.${i}.${k}`,x:q(rx),y:q(ry),radius:24+k*3,impulse:2.4+k*.3,layer:0,elevation:0,kind});}
   const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len,gx=a.x+dx*.53,gy=a.y+dy*.53,gateId=`${arenaId}.gate.${i}`;
   gates.push({id:gateId,ax:q(gx-nx*105),ay:q(gy-ny*105),bx:q(gx+nx*105),by:q(gy+ny*105),radius:4,restitution:.85,layer:0,elevation:0,initiallyOpen:i%2===0});
   switches.push({id:`${arenaId}.switch.${i}`,x:q(a.x+dx*.30+nx*70),y:q(a.y+dy*.30+ny*70),radius:28,layer:0,elevation:0,gateIds:[gateId],holdTicks:900});
  }
  surfaces.push({id:`${arenaId}.ground`,kind:'ground',polygon:rect(x0,y0,x1,y1),layer:0,height:0,material:'basalt',biome:blend(BIOMES[offset]!,BIOMES[(offset+1)%5]!,.4)});
  // Organic regional terrain belongs to the world descriptor. These flat
  // islands do not masquerade as walls; their bounded hazard pools do interact.
  for(let i=0;i<regions.length;i++){
   const region=regions[i]!,sr=createRoll(region.seed),primary=BIOMES.reduce((a,b)=>region.biome[a]>region.biome[b]?a:b),polygon=Array.from({length:12},(_,j)=>{const angle=j*Math.PI/6,rad=.8+sr.at(100+j)/65535*.2;return {x:q(region.center.x+Math.cos(angle)*width*.105*rad),y:q(region.center.y+Math.sin(angle)*height*.12*rad)};});
   surfaces.push({id:`${arenaId}.terrain.${i}`,kind:'ground',polygon,layer:0,height:0,material:({forge:'copper-slag',neon:'dark-glass',garden:'soil',glacier:'snow',ruins:'sandstone'} as const)[primary],biome:region.biome});
  }
  for(const edge of edges){const a=nodes.find(n=>n.id===edge.a)!,b=nodes.find(n=>n.id===edge.b)!,dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),nx=-dy/length,ny=dx/length,half=edge.width/2;
   surfaces.push({id:`${edge.id}.surface`,kind:'ground',polygon:[{x:q(a.x+nx*half),y:q(a.y+ny*half)},{x:q(b.x+nx*half),y:q(b.y+ny*half)},{x:q(b.x-nx*half),y:q(b.y-ny*half)},{x:q(a.x-nx*half),y:q(a.y-ny*half)}],layer:0,height:0,material:'shot-track',biome:regions.find(r=>r.id===a.regionId)!.biome});
  }
  // One real raised crossing joins opposite regions above the lower field.
  const bridgeY=cy+height*(.09+roll.at(72)/65535*.06),bridgeA=cx-width*.27,bridgeB=cx+width*.27,rampLength=300,rampWidth=180,elevation=100;
  ramps.push({id:`${arenaId}.ramp.west`,ax:bridgeA-rampLength,ay:bridgeY,bx:bridgeA,by:bridgeY,width:rampWidth,fromLayer:0,toLayer:1,fromElevation:0,toElevation:elevation,bidirectional:true},{id:`${arenaId}.ramp.east`,ax:bridgeB,ay:bridgeY,bx:bridgeB+rampLength,by:bridgeY,width:rampWidth,fromLayer:1,toLayer:0,fromElevation:elevation,toElevation:0,bidirectional:true});
  surfaces.push({id:`${arenaId}.bridge`,kind:'bridge',polygon:rect(bridgeA,bridgeY-rampWidth/2,bridgeB,bridgeY+rampWidth/2),layer:1,height:elevation,material:'steel-grate',biome:blend('forge','garden',.45)},{id:`${arenaId}.ramp.surface.west`,kind:'ramp',polygon:rect(bridgeA-rampLength,bridgeY-rampWidth/2,bridgeA,bridgeY+rampWidth/2),layer:0,height:0,material:'steel-grate',biome:blend('forge','garden',.45)},{id:`${arenaId}.ramp.surface.east`,kind:'ramp',polygon:rect(bridgeB,bridgeY-rampWidth/2,bridgeB+rampLength,bridgeY+rampWidth/2),layer:1,height:elevation,material:'steel-grate',biome:blend('forge','garden',.45)});
  rail('bridge-rail-n',bridgeA,bridgeY-rampWidth/2,bridgeB,bridgeY-rampWidth/2,1,elevation);rail('bridge-rail-s',bridgeA,bridgeY+rampWidth/2,bridgeB,bridgeY+rampWidth/2,1,elevation);
  flows.push({id:`${arenaId}.bridge.flow`,ax:bridgeA-rampLength,ay:bridgeY,bx:bridgeB+rampLength,by:bridgeY,width:rampWidth,fx:.018,fy:0,layer:0,maxSpeed:10},{id:`${arenaId}.bridge.upper.flow`,ax:bridgeA,ay:bridgeY,bx:bridgeB,by:bridgeY,width:rampWidth,fx:.018,fy:0,layer:1,maxSpeed:10});
  nodes.push({id:`${arenaId}.ramp.node.west`,x:bridgeA-rampLength,y:bridgeY,layer:0,regionId:regions[4]!.id,kind:'ramp'},{id:`${arenaId}.ramp.node.east`,x:bridgeB+rampLength,y:bridgeY,layer:0,regionId:regions[2]!.id,kind:'ramp'});edges.push({id:`${arenaId}.edge.bridge`,a:`${arenaId}.ramp.node.west`,b:`${arenaId}.ramp.node.east`,width:rampWidth,bidirectional:true,kind:'bridge'},{id:`${arenaId}.edge.bridge-feed.west`,a:`${arenaId}.node.4`,b:`${arenaId}.ramp.node.west`,width:250,bidirectional:true,kind:'crossing'},{id:`${arenaId}.edge.bridge-feed.east`,a:`${arenaId}.node.2`,b:`${arenaId}.ramp.node.east`,width:250,bidirectional:true,kind:'crossing'});
  const stationCount=ai===0?players:12;
  for(let i=0;i<stationCount;i++){
   // Every bank is a field-side open mechanism. There are no private table walls.
   const angle=-Math.PI/2+i*Math.PI*2/stationCount+(roll.at(73)/65535-.5)*.02,rx=width*.435,ry=height*.415,x=q(cx+Math.cos(angle)*rx),y=q(cy+Math.sin(angle)*ry),toward=Math.atan2(cy-y,cx-x),yaw=toward*180/Math.PI;
   const tx=Math.cos(toward),ty=Math.sin(toward),nx=-ty,ny=tx,ownerId=ai===0?i:-1,leftId=`${arenaId}.flipper.${i}.left`,rightId=`${arenaId}.flipper.${i}.right`;
   flippers.push({id:leftId,ownerId,side:'left',pivotX:q(x+nx*72-tx*28),pivotY:q(y+ny*72-ty*28),length:52,radius:6,restAngle:yaw-70,activeAngle:yaw-25,layer:0,elevation:0},{id:rightId,ownerId,side:'right',pivotX:q(x-nx*72-tx*28),pivotY:q(y-ny*72-ty*28),length:52,radius:6,restAngle:yaw+70,activeAngle:yaw+25,layer:0,elevation:0});
   stations.push({id:`${arenaId}.station.${i}`,ownerId,teamId:ai===0?Math.floor(i/teamSize):-1,x,y,layer:0,elevation:0,launchX:q(x+tx*24),launchY:q(y+ty*24),launchVx:q(tx*11),launchVy:q(ty*11),flipperIds:[leftId,rightId]});
   const region=regions.reduce((a,b)=>Math.hypot(a.center.x-x,a.center.y-y)<Math.hypot(b.center.x-x,b.center.y-y)?a:b),stationNode=`${arenaId}.station.node.${i}`;nodes.push({id:stationNode,x,y,layer:0,regionId:region.id,kind:'station'});const ni=regions.indexOf(region);edges.push({id:`${arenaId}.edge.station.${i}`,a:stationNode,b:`${arenaId}.node.${ni}`,width:130,bidirectional:true,kind:'crossing'});
  }
  const portalSides=ai===0?count-1:1;
  for(let k=0;k<portalSides;k++){const targetAi=ai===0?k+1:0,x=ai===0?cx+(k===0?-1:1)*width*.36:cx,y=ai===0?cy:cy-height*.36,id=`${arenaId}.portal.${targetAi}`,targetId=`arena-${targetAi}.portal.${ai}`;portals.push({id,x:q(x),y:q(y),radius:54,layer:0,elevation:0,angle:ai===0?90:-90,targetArenaId:`arena-${targetAi}`,targetPortalId:targetId});nodes.push({id:`${id}.node`,x:q(x),y:q(y),layer:0,regionId:regions[k%6]!.id,kind:'portal'});edges.push({id:`${id}.edge`,a:`${arenaId}.hub`,b:`${id}.node`,width:300,bidirectional:true,kind:'portal'});if(ai===0)links.push({id:`world.link.${targetAi}`,a:arenaId,b:`arena-${targetAi}`,portalA:id,portalB:targetId});}
  for(let i=0;i<4;i++){const angle=(i+.5)*Math.PI/2+(roll.at(90)/65535-.5)*.2,x=q(cx+Math.cos(angle)*width*.38),y=q(cy+Math.sin(angle)*height*.36);
   if(stations.some(s=>Math.hypot(s.x-x,s.y-y)<200)||bumpers.some(b=>Math.hypot(b.x-x,b.y-y)<160)||ramps.some(r=>Math.hypot(r.ax-x,r.ay-y)<200)||portals.some(p=>Math.hypot(p.x-x,p.y-y)<200))continue;
   const radius=58+roll.index(91+i,24),polygon=Array.from({length:12},(_,j)=>{const a=j*Math.PI/6;return {x:q(x+Math.cos(a)*(radius+22)),y:q(y+Math.sin(a)*(radius+22))};});
   surfaces.push({id:`${arenaId}.water.${i}`,kind:'water',polygon,layer:0,height:0,material:'deep-water',biome:blend('garden','glacier',.4)});hazards.push({id:`${arenaId}.hazard.${i}`,kind:'damage',x,y,radius,layer:0,elevation:0,damage:1,cooldownTicks:180});
  }
  const tile=512,instanceCount=detail==='low'?4:detail==='high'?12:8;
  for(let yy=y0;yy<y1;yy+=tile)for(let xx=x0;xx<x1;xx+=tile){const key=`${arenaId}.chunk.${Math.floor((xx-x0)/tile)}.${Math.floor((yy-y0)/tile)}`,cseed=deriveSeed(arenaSeed,key),r=createRoll(cseed),center={x:xx+tile/2,y:yy+tile/2},region=regions.reduce((a,b)=>Math.hypot(a.center.x-center.x,a.center.y-center.y)<Math.hypot(b.center.x-center.x,b.center.y-center.y)?a:b),primary=BIOMES.reduce((a,b)=>region.biome[a]>region.biome[b]?a:b),instances:ArenaArtInstance[]=[];
   for(let j=0;j<instanceCount;j++){const x=q(xx+40+r.at(20+j*3)/65535*(Math.min(tile,x1-xx)-80)),y=q(yy+40+r.at(21+j*3)/65535*(Math.min(tile,y1-yy)-80));
    // Props avoid all physical routes, station arrivals and mechanism mouths.
    if(stations.some(s=>Math.hypot(s.x-x,s.y-y)<150)||bumpers.some(b=>Math.hypot(b.x-x,b.y-y)<b.radius+90)||switches.some(s=>Math.hypot(s.x-x,s.y-y)<100)||portals.some(p=>Math.hypot(p.x-x,p.y-y)<120))continue;
    if(edges.some(e=>{const a=nodes.find(n=>n.id===e.a)!,b=nodes.find(n=>n.id===e.b)!;const dx=b.x-a.x,dy=b.y-a.y,ll=dx*dx+dy*dy,t=ll?Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/ll)):0;return Math.hypot(x-a.x-dx*t,y-a.y-dy*t)<e.width/2+70;}))continue;
    instances.push({id:`${key}.instance.${j}`,assetId:ASSETS[primary][r.index(22+j*3,ASSETS[primary].length)]!,seed:deriveSeed(cseed,`instance:${j}`),x,y,z:0,yaw:r.at(60+j)/65535*Math.PI*2,scale:.7+r.at(80+j)/65535*.65});
   }
   chunks.push({id:key,bounds:[xx,yy,Math.min(x1,xx+tile),Math.min(y1,yy+tile)],layer:0,height:0,biome:region.biome,seed:cseed,instances});
  }
  arenas.push({id:arenaId,gravity:{x:0,y:0},name:ai===0?'THE CONFLUENCE':ai===1?'THE HIGH VAULT':'THE ROOT DEPTHS',bounds:[x0,y0,x1,y1],seed:arenaSeed,regions,chunks,rails,bumpers,flippers,stations,switches,gates,ramps,portals,surfaces,hazards,flows,routes:{nodes,edges}});
 }
 const body={schema:'keel-pinball-arena-world@1' as const,generatorVersion:ARENA_GENERATOR_VERSION,id:`confluence-${seed.slice(-12)}`,seed,unitScale:.025,arenas,links},canonical=JSON.stringify(body),world=freeze({...body,canonical,sha256:digest(body)});validateArenaWorld(world);return world;
}
export function qualifyArenaTopology(world:ArenaWorldDefinition){
 validateArenaWorld(world);const checks=world.arenas.map(a=>{const seen=new Set<string>(),queue=[a.routes.nodes[0]!.id];while(queue.length){const id=queue.pop()!;if(seen.has(id))continue;seen.add(id);for(const e of a.routes.edges){if(e.a===id&&!seen.has(e.b))queue.push(e.b);if(e.b===id&&e.bidirectional&&!seen.has(e.a))queue.push(e.a);}}return {arenaId:a.id,nodes:a.routes.nodes.length,edges:a.routes.edges.length,connected:seen.size===a.routes.nodes.length,regions:a.regions.length,stations:a.stations.length,rails:a.rails.length,bumpers:a.bumpers.length,flippers:a.flippers.length,switches:a.switches.length,gates:a.gates.length,ramps:a.ramps.length,portals:a.portals.length,chunks:a.chunks.length,artInstances:a.chunks.reduce((n,c)=>n+c.instances.length,0)};});return {worldId:world.id,sha256:world.sha256,arenas:checks,connected:checks.every(c=>c.connected)};
}
