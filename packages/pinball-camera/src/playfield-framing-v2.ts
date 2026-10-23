import type {ArenaWorldDefinition,ArenaField,ArenaFrame,ArenaSurface,ArenaBallFrame} from '@keel-engine/pinball-arena';

export const PLAYFIELD_FRAMING_REVISION='source-playfield-framing/2';
export interface FramingMembership {
 readonly surfaceIds:readonly string[]; readonly railIds:readonly string[];
 readonly flipperIds:readonly string[]; readonly stationIds:readonly string[];
 readonly pathIds:readonly string[]; readonly portIds:readonly string[];
}
export interface FramingRoom extends FramingMembership {
 readonly id:string; readonly arenaId:string; readonly bedId:string; readonly bankIds:readonly string[];
}
export interface FramingTransition extends FramingMembership {
 readonly id:string; readonly arenaId:string; readonly fromRoomId:string; readonly toRoomId:string;
 readonly pathId?:string; readonly captureId?:string;
}
export interface PlayfieldFramingDefinition {readonly rooms:readonly FramingRoom[];readonly transitions?:readonly FramingTransition[]}
export interface SourceViewBounds {readonly x0:number;readonly y0:number;readonly x1:number;readonly y1:number}
export type FramingSelection=
 |{readonly kind:'world';readonly arenaId:string;readonly reason:'manual-overview'}
 |{readonly kind:'room';readonly arenaId:string;readonly roomId:string;readonly reason:'native-bed-support'|'native-station'|'native-launch-seat'}
 |{readonly kind:'transition';readonly arenaId:string;readonly transitionId:string;readonly fromRoomId:string;readonly toRoomId:string;readonly reason:'native-ramp'|'native-connector-support'|'native-capture';readonly phase:'active'|'captured'|'transit'|'exit-blocked';readonly entryPortId:string;readonly exitPortId:string;readonly captureId?:string}
 |{readonly kind:'unscoped';readonly arenaId:string;readonly reason:'no-source-membership'};
type Point={x:number;y:number;z:number;r:number};
type StoredRoom={definition:FramingRoom;points:readonly Point[];bed:ArenaSurface};
type StoredTransition={definition:FramingTransition;points:readonly Point[];captureSourcePoints:readonly Point[];surfaces:readonly ArenaSurface[];rampIds:ReadonlySet<string>;entryPortId:string;exitPortId:string;allowedExits:ReadonlySet<string>};
const keys=['surfaceIds','railIds','flipperIds','stationIds','pathIds','portIds'] as const;
const number=(n:number,label:string,min=-1e9,max=1e9)=>{if(!Number.isFinite(n)||n<min||n>max)throw Error('Framing '+label);return n;};
const dense=<T>(a:readonly T[],max:number,label:string)=>{if(!Array.isArray(a)||a.length>max||Array.from({length:a.length},(_,i)=>Object.hasOwn(a,i)).some(v=>!v))throw Error('Framing dense '+label);return a;};
const ids=(a:readonly string[],label:string)=>{dense(a,32768,label);if(a.some(s=>typeof s!=='string'||!s.length||s.length>120)||new Set(a).size!==a.length)throw Error('Framing IDs '+label);return a;};
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function contains(surface:ArenaSurface,x:number,y:number){
 const p=surface.polygon;let inside=false;
 for(let i=0,j=p.length-1;i<p.length;j=i++){
  const a=p[j]!,b=p[i]!,dx=b.x-a.x,dy=b.y-a.y,ll=dx*dx+dy*dy,t=ll?Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/ll)):0;
  if(Math.hypot(x-a.x-dx*t,y-a.y-dy*t)<=1/1024)return true;
  if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
 }
 return inside;
}
function supports(s:ArenaSurface,b:Pick<ArenaBallFrame,'x'|'y'|'layer'|'elevation'>){
 if(s.layer!==b.layer||!contains(s,b.x,b.y))return false;
 if(!s.vertexElevations)return Math.abs(s.height-b.elevation)<=1/1024;
 const a=s.polygon[0]!;
 for(let i=1;i+1<s.polygon.length;i++){
  const c=s.polygon[i]!,d=s.polygon[i+1]!,den=(c.y-d.y)*(a.x-d.x)+(d.x-c.x)*(a.y-d.y);if(Math.abs(den)<1e-9)continue;
  const u=((c.y-d.y)*(b.x-d.x)+(d.x-c.x)*(b.y-d.y))/den,v=((d.y-a.y)*(b.x-d.x)+(a.x-d.x)*(b.y-d.y))/den,w=1-u-v;
  if(u>=-1e-8&&v>=-1e-8&&w>=-1e-8&&Math.abs(u*s.vertexElevations[0]!+v*s.vertexElevations[i]!+w*s.vertexElevations[i+1]!-b.elevation)<=1/1024)return true;
 }
 return false;
}
function projectBounds(points:readonly Point[],ratio:number):SourceViewBounds {
 number(ratio,'elevation ratio',0,2);if(!points.length)throw Error('Framing empty geometry');
 let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
 for(const p of points){const y=-p.y-p.z*ratio;x0=Math.min(x0,p.x-p.r);x1=Math.max(x1,p.x+p.r);y0=Math.min(y0,y-p.r);y1=Math.max(y1,y+p.r);}
 return{x0,y0,x1,y1};
}

/** Canonical source membership, copied once. No rig, frame walker, lease
 * mutation, render raster or cache keyed by a changing ratio is retained.
 * Scope definitions must partition their declared geometry; unrelated world
 * entities may remain unscoped and still appear in explicit world overview. */
export function createPlayfieldFramingIndex(world:ArenaWorldDefinition,definition:PlayfieldFramingDefinition){
 if(!world||!Array.isArray(world.arenas)||world.arenas.length<1||world.arenas.length>4||!definition)throw Error('Framing world/definition');
 dense(definition.rooms,64,'rooms');dense(definition.transitions??[],128,'transitions');if(!definition.rooms.length)throw Error('Framing no rooms');
 const fields=new Map<string,{id:string;captures:NonNullable<ArenaField['captures']>}>(),sourceIds=new Set<string>(),roomMap=new Map<string,StoredRoom>(),transitionMap=new Map<string,StoredTransition>(),owner=new Map<string,string>(),nativeRamps=new Set<string>(),scopeIds=new Set<string>(),captureOwners=new Set<string>(),rampOwners=new Map<string,string>();
 const worldPoints=new Map<string,readonly Point[]>(),banks=new Map<string,string>();
 const surfaces=new Map<string,ArenaSurface>(),rails=new Map<string,ArenaField['rails'][number]>(),flippers=new Map<string,ArenaField['flippers'][number]>(),stations=new Map<string,ArenaField['stations'][number]>(),paths=new Map<string,NonNullable<ArenaField['pinball']>['paths'][number]>(),ports=new Map<string,NonNullable<ArenaField['pinball']>['ports'][number]>(),entityArena=new Map<string,string>();
 const dictionaries=[surfaces,rails,flippers,stations,paths,ports] as const;
 for(const f of world.arenas as readonly ArenaField[]){
  if(fields.has(f.id))throw Error('Framing duplicate arena');fields.set(f.id,{id:f.id,captures:copy(dense(f.captures??[],128,'captures'))});
  const arrays=[f.surfaces,f.rails,f.flippers,f.stations,f.pinball?.paths??[],f.pinball?.ports??[]] as const;
  for(let k=0;k<arrays.length;k++)for(const item of dense(arrays[k] as readonly {id:string}[],32768,'world records')){
   ids([item.id],'world record');if(sourceIds.has(item.id))throw Error('Framing duplicate source ID');sourceIds.add(item.id);entityArena.set(item.id,f.id);
   (dictionaries[k] as Map<string,unknown>).set(item.id,copy(item));
  }
  for(const ramp of dense(f.ramps??[],2048,'ramps')){ids([ramp.id],'ramp');if(sourceIds.has(ramp.id))throw Error('Framing duplicate ramp ID');sourceIds.add(ramp.id);nativeRamps.add(ramp.id);entityArena.set(ramp.id,f.id);}
 }
 const pointsFor=(m:FramingMembership,arenaId:string)=>{
  const out:Point[]=[];
  const point=(x:number,y:number,z:number,r=0)=>out.push({x:number(x,'x'),y:number(y,'y'),z:number(z,'height',0,400),r:number(r,'radius',0,256)});
  for(let k=0;k<keys.length;k++)for(const id of ids(m[keys[k]!],keys[k]!))if(!dictionaries[k]!.has(id)||entityArena.get(id)!==arenaId)throw Error('Framing missing/foreign member '+id);
  for(const id of m.surfaceIds){const s=surfaces.get(id)!;if(s.rampId&&(!nativeRamps.has(s.rampId)||entityArena.get(s.rampId)!==arenaId))throw Error('Framing missing native ramp');dense(s.polygon,32,'polygon');if(s.polygon.length<3)throw Error('Framing polygon');if(s.vertexElevations&&(dense(s.vertexElevations,32,'heights').length!==s.polygon.length))throw Error('Framing vertex heights');for(const[p,v]of s.polygon.entries())point(v.x,v.y,s.vertexElevations?.[p]??s.height);}
  for(const id of m.railIds){const r=rails.get(id)!;point(r.ax,r.ay,r.elevation,r.radius);point(r.bx,r.by,r.elevationB??r.elevation,r.radius);}
  for(const id of m.flipperIds){const f=flippers.get(id)!;point(f.pivotX,f.pivotY,f.elevation,number(f.length,'blade length',16,96)+f.radius);}
  for(const id of m.stationIds){const s=stations.get(id)!;point(s.x,s.y,s.elevation);point(s.launchX,s.launchY,s.elevation);}
  for(const id of m.pathIds){const p=paths.get(id)!;dense(p.vertices,128,'path vertices');if(p.vertices.length<2||!p.surfaceIds.length||!p.colliderIds.length)throw Error('Framing empty path');number(p.clearWidth,'path width',24,400);if(p.clearWidths&&dense(p.clearWidths,128,'path width profile').length!==p.vertices.length)throw Error('Framing path width profile length');for(const [i,v]of p.vertices.entries())point(v.x,v.y,v.elevation,number(p.clearWidths?p.clearWidths[i]!:p.clearWidth,'path vertex width',24,400)/2);}
  for(const id of m.portIds){const p=ports.get(id)!;point(p.x,p.y,p.elevation,number(p.clearWidth,'port width',24,400)/2);}
  return out;
 };
 const claim=(m:FramingMembership,id:string,arenaId:string)=>{
  ids([id],'scope');if(scopeIds.has(id)||!fields.has(arenaId))throw Error('Framing scope identity');scopeIds.add(id);
  for(const key of keys)for(const sourceId of ids(m[key],key)){if(owner.has(sourceId))throw Error('Framing member has multiple owners '+sourceId);owner.set(sourceId,id);}
  return pointsFor(m,arenaId);
 };
 for(const input of definition.rooms){
  const r=copy(input),points=claim(r,r.id,r.arenaId);ids(r.bankIds,'banks');
  const bed=surfaces.get(r.bedId);if(!bed||!r.surfaceIds.includes(bed.id)||bed.kind!=='playfield'||bed.vertexElevations||!r.bankIds.length)throw Error('Framing room bed/banks');
  if(r.bankIds.length!==r.stationIds.length||r.bankIds.some(id=>!r.stationIds.includes(id)))throw Error('Framing bank membership');
  for(const id of r.bankIds){const s=stations.get(id)!;if(s.layer!==bed.layer||s.elevation!==bed.height||!contains(bed,s.x,s.y)||!s.flipperIds.length||s.flipperIds.some(f=>!r.flipperIds.includes(f)))throw Error('Framing bank support/blades');banks.set(id,r.id);}
  if(r.flipperIds.some(id=>{const f=flippers.get(id)!;return f.layer!==bed.layer||f.elevation!==bed.height||r.bankIds.filter(b=>stations.get(b)!.flipperIds.includes(id)).length!==1;}))throw Error('Framing orphan/shared blade');
  roomMap.set(r.id,{definition:r,points,bed});
 }
 for(const input of definition.transitions??[]){
  const t=copy(input),points=claim(t,t.id,t.arenaId),from=roomMap.get(t.fromRoomId),to=roomMap.get(t.toRoomId);
  if(!from||!to||from===to||from.definition.arenaId!==t.arenaId||(!t.pathId&&!t.captureId)||(t.pathId&&t.captureId)||t.stationIds.length||t.flipperIds.length)throw Error('Framing transition binding');
  let entryPortId:string,exitPortId:string;const allowedExits=new Set<string>();
  if(t.pathId){const p=paths.get(t.pathId);if(!p||!t.pathIds.includes(p.id)||to.definition.arenaId!==t.arenaId)throw Error('Framing transition path');entryPortId=p.entryPortId;exitPortId=p.exitPortId;}
  else{const c=fields.get(t.arenaId)!.captures?.find(c=>c.id===t.captureId);if(!c||c.exitArenaId!==to.definition.arenaId)throw Error('Framing transition capture');if(captureOwners.has(c.id))throw Error('Framing duplicate capture scope');captureOwners.add(c.id);entryPortId=c.entryPortId;exitPortId=c.exitPortId;allowedExits.add(c.fallbackExitPortId);}
  allowedExits.add(exitPortId);if(!ports.has(entryPortId)||[...allowedExits].some(id=>!ports.has(id)))throw Error('Framing transition endpoint');
  const ownSurfaces=t.surfaceIds.map(id=>surfaces.get(id)!),rampIds=new Set(ownSurfaces.flatMap(s=>s.rampId?[s.rampId]:[]));
  for(const id of rampIds){if(rampOwners.has(id))throw Error('Framing ramp has multiple scopes');rampOwners.set(id,t.id);}
  transitionMap.set(t.id,{definition:t,points,captureSourcePoints:[],surfaces:ownSurfaces,rampIds,entryPortId,exitPortId,allowedExits});
 }
 // Verify complete path/port closure after all room and transition ownership
 // is known. A receiving port may reference its destination room's bed/bank.
 for(const [id,scope]of owner){
  const p=paths.get(id);if(p){if([...p.colliderIds,...p.surfaceIds,p.entryPortId,p.exitPortId].some(x=>!owner.has(x)||entityArena.get(x)!==entityArena.get(id)))throw Error('Framing incomplete path '+id);if(p.colliderIds.some(x=>!rails.has(x)||owner.get(x)!==scope)||p.surfaceIds.some(x=>!surfaces.has(x)||owner.get(x)!==scope))throw Error('Framing path geometry kind/ownership');}
  const port=ports.get(id);if(port&&(port.surfaceIds.some(x=>!owner.has(x)||!surfaces.has(x)||entityArena.get(x)!==entityArena.get(id))||port.receiverCatchId&&!banks.has(port.receiverCatchId)))throw Error('Framing incomplete port '+id);
  void scope;
 }
 for(const t of transitionMap.values()){
  if(!owner.has(t.entryPortId)||[...t.allowedExits].some(id=>!owner.has(id)))throw Error('Framing unowned transition endpoint');
  const entry=ports.get(t.entryPortId)!;
  if(entityArena.get(entry.id)!==t.definition.arenaId||!entry.surfaceIds.length||entry.surfaceIds.some(id=>owner.get(id)!==t.definition.fromRoomId&&owner.get(id)!==t.definition.id))throw Error('Framing entry source ownership');
  // This is source-point support, not a claim that a moving full ball fits.
  const entryPoint={x:entry.x,y:entry.y,layer:entry.layer,elevation:entry.elevation};
  if(!entry.surfaceIds.some(id=>supports(surfaces.get(id)!,entryPoint)))throw Error('Framing entry source support');
  // Only actual source-mouth support and its explicitly declared intake
  // paths contribute during HOLD. Primary/fallback exit footprints and the
  // receiving room enter framing only when native phase reaches transit.
  const intakePaths=t.definition.pathIds.map(id=>paths.get(id)!).filter(p=>p.surfaceIds.some(id=>entry.surfaceIds.includes(id)));
  t.captureSourcePoints=pointsFor({surfaceIds:[...new Set([...entry.surfaceIds,...intakePaths.flatMap(p=>p.surfaceIds)])],railIds:[...new Set(intakePaths.flatMap(p=>p.colliderIds))],flipperIds:[],stationIds:[],pathIds:intakePaths.map(p=>p.id),portIds:[entry.id]},t.definition.arenaId);
  const to=roomMap.get(t.definition.toRoomId)!;
  for(const id of t.allowedExits){const p=ports.get(id)!;if(entityArena.get(id)!==to.definition.arenaId||!p.receiverCatchId||!to.definition.bankIds.includes(p.receiverCatchId))throw Error('Framing destination receiver ownership');}
 }
 for(const f of world.arenas as readonly ArenaField[])worldPoints.set(f.id,pointsFor({surfaceIds:f.surfaces.map(s=>s.id),railIds:f.rails.map(s=>s.id),flipperIds:f.flippers.map(s=>s.id),stationIds:f.stations.map(s=>s.id),pathIds:(f.pinball?.paths??[]).map(s=>s.id),portIds:(f.pinball?.ports??[]).map(s=>s.id)},f.id));
 const transitionSelection=(s:StoredTransition,reason:'native-ramp'|'native-connector-support'|'native-capture',phase:'active'|'captured'|'transit'|'exit-blocked',exitPortId=s.exitPortId):FramingSelection=>({kind:'transition',arenaId:s.definition.arenaId,transitionId:s.definition.id,fromRoomId:s.definition.fromRoomId,toRoomId:s.definition.toRoomId,reason,phase,entryPortId:s.entryPortId,exitPortId,...(s.definition.captureId?{captureId:s.definition.captureId}:{})});
 function select(frame:ArenaFrame,ownerId:number,mode:'follow'|'overview'='follow'):FramingSelection {
  if(!Number.isSafeInteger(ownerId)||!Number.isSafeInteger(frame.tick)||frame.tick<0||!['follow','overview'].includes(mode))throw Error('Framing frame request');
  const bodies=dense(frame.balls,100,'native bodies').filter(b=>b.ownerId===ownerId);if(bodies.length!==1)throw Error('Framing native owner body');const b=bodies[0]!;
  if(!fields.has(b.arenaId))throw Error('Framing native arena');for(const n of[b.x,b.y,b.elevation])number(n,'native body');
  if(mode==='overview')return{kind:'world',arenaId:b.arenaId,reason:'manual-overview'};
  if(b.transport){
   const t=b.transport,s=[...transitionMap.values()].find(s=>s.definition.arenaId===b.arenaId&&s.definition.captureId===t.mechanismId);
   if(!s||!['captured','transit','exit-blocked'].includes(t.phase))return{kind:'unscoped',arenaId:b.arenaId,reason:'no-source-membership'};
   const c=fields.get(b.arenaId)!.captures!.find(c=>c.id===s.definition.captureId)!;
   if(t.exitArenaId!==c.exitArenaId||![c.exitPortId,c.fallbackExitPortId].includes(t.exitPortId))throw Error('Framing selected capture exit');
   return transitionSelection(s,'native-capture',t.phase,t.exitPortId);
  }
  const transitions=[...transitionMap.values()].filter(s=>s.definition.arenaId===b.arenaId&&!s.definition.captureId);
  if(b.active&&b.rampId){const hits=transitions.filter(s=>s.rampIds.has(b.rampId!));if(hits.length>1)throw Error('Framing ambiguous ramp');if(hits[0])return transitionSelection(hits[0],'native-ramp','active');}
  const beds=[...roomMap.values()].filter(r=>r.definition.arenaId===b.arenaId&&supports(r.bed,b));
  if(beds.length>1)throw Error('Framing ambiguous native bed');if(beds[0])return{kind:'room',arenaId:b.arenaId,roomId:beds[0].definition.id,reason:'native-bed-support'};
  if(b.active){const hits=transitions.filter(s=>s.surfaces.some(s=>supports(s,b)));if(hits.length>1)throw Error('Framing ambiguous connector');if(hits[0])return transitionSelection(hits[0],'native-connector-support','active');}
  if(!b.active){const seats=[...stations.values()].filter(s=>banks.has(s.id)&&entityArena.get(s.id)===b.arenaId&&s.layer===b.layer&&Math.abs(s.elevation-b.elevation)<=1/1024&&Math.hypot(s.launchX-b.x,s.launchY-b.y)<=1/1024);if(seats.length>1)throw Error('Framing ambiguous native launch seat');if(seats[0])return{kind:'room',arenaId:b.arenaId,roomId:banks.get(seats[0].id)!,reason:'native-launch-seat'};}
  const roomId=b.stationId?banks.get(b.stationId):undefined;
  if(roomId&&roomMap.get(roomId)!.definition.arenaId===b.arenaId)return{kind:'room',arenaId:b.arenaId,roomId,reason:'native-station'};
  return{kind:'unscoped',arenaId:b.arenaId,reason:'no-source-membership'};
 }
 function bounds(selection:FramingSelection,elevationRatio:number):SourceViewBounds|null {
  number(elevationRatio,'ratio',0,2);
  if(selection.kind==='unscoped')return null;
  if(selection.kind==='world'){const p=worldPoints.get(selection.arenaId);if(!p)throw Error('Framing world selection');return projectBounds(p,elevationRatio);}
  if(selection.kind==='room'){const r=roomMap.get(selection.roomId);if(!r||r.definition.arenaId!==selection.arenaId)throw Error('Framing room selection');return projectBounds(r.points,elevationRatio);}
  const t=transitionMap.get(selection.transitionId);if(!t||t.definition.arenaId!==selection.arenaId||t.definition.fromRoomId!==selection.fromRoomId||t.definition.toRoomId!==selection.toRoomId)throw Error('Framing transition selection');
  if(selection.entryPortId!==t.entryPortId||!t.allowedExits.has(selection.exitPortId)||!['active','captured','transit','exit-blocked'].includes(selection.phase))throw Error('Framing transition endpoint selection');
  const from=roomMap.get(t.definition.fromRoomId)!,to=roomMap.get(t.definition.toRoomId)!;
  // Capture HOLD retains the entry room. Transit exposes both source-owned
  // rooms/endpoints; the native camera alone interpolates its actual clock.
  if(selection.phase==='captured')return projectBounds([...from.points,...t.captureSourcePoints],elevationRatio);
  const exit=ports.get(selection.exitPortId);if(!exit)throw Error('Framing missing selected exit');
  return projectBounds([...t.points,...from.points,...to.points,{x:exit.x,y:exit.y,z:exit.elevation,r:exit.clearWidth/2}],elevationRatio);
 }
 return{revision:PLAYFIELD_FRAMING_REVISION,select,bounds,roomIds:Object.freeze([...roomMap.keys()]),transitionIds:Object.freeze([...transitionMap.keys()])};
}

export interface PlayfieldOriginRequest {
 readonly bounds:SourceViewBounds; readonly protectedBounds:SourceViewBounds;
 readonly scale:number; readonly width:number; readonly height:number;
 readonly safeInsets:{readonly left:number;readonly top:number;readonly right:number;readonly bottom:number};
 readonly followLeft:number; readonly followTop:number; readonly padding?:number;
}
/** Projected-plane bounds are BEFORE scale and camera origin. Keep the
 * caller's readable uniform scale. Safety wins when a real body leaves its
 * selected source room; return an honest escape diagnostic, never crop it. */
export function solvePlayfieldOrigins(r:PlayfieldOriginRequest){
 const s=number(r.scale,'scale',.001,4),w=number(r.width,'width',64,32768),h=number(r.height,'height',64,32768),pad=number(r.padding??10,'padding',1,128);
 for(const b of[r.bounds,r.protectedBounds]){for(const n of[b.x0,b.y0,b.x1,b.y1])number(n,'bounds');if(b.x1<b.x0||b.y1<b.y0)throw Error('Framing reversed bounds');}
 for(const n of[r.safeInsets.left,r.safeInsets.right,r.safeInsets.top,r.safeInsets.bottom])number(n,'safe inset',0,32768);
 number(r.followLeft,'follow left');number(r.followTop,'follow top');
 const axis=(lo:number,hi:number,p0:number,p1:number,size:number,start:number,end:number,follow:number)=>{
  const a=start+pad,b=size-end-pad,available=b-a;if(available<=0)throw Error('Framing empty safe axis');
  const safeLo=p1*s-b,safeHi=p0*s-a,maximumSafeScale=p1>p0?available/(p1-p0):4;
  if(safeLo>safeHi)return{status:'infeasible' as const,origin:null,maximumSafeScale,fits:false,escapedRoom:false};
  const fits=(hi-lo)*s<=available;
  const roomLo=fits?hi*s-b:lo*s-a,roomHi=fits?lo*s-a:hi*s-b;
  const desired=fits?(lo+hi)*s/2-(a+b)/2:follow;
  const lower=Math.max(roomLo,safeLo),upper=Math.min(roomHi,safeHi),escapedRoom=lower>upper;
  const origin=escapedRoom?Math.max(safeLo,Math.min(safeHi,desired)):Math.max(lower,Math.min(upper,desired));
  return{status:'ok' as const,origin,maximumSafeScale,fits,escapedRoom};
 };
 const x=axis(r.bounds.x0,r.bounds.x1,r.protectedBounds.x0,r.protectedBounds.x1,w,r.safeInsets.left,r.safeInsets.right,r.followLeft),y=axis(r.bounds.y0,r.bounds.y1,r.protectedBounds.y0,r.protectedBounds.y1,h,r.safeInsets.top,r.safeInsets.bottom,r.followTop);
 return{status:x.status==='ok'&&y.status==='ok'?'ok' as const:'infeasible' as const,left:x.origin,top:y.origin,scale:s,maximumSafeScale:Math.min(x.maximumSafeScale,y.maximumSafeScale),axes:{x,y},revision:PLAYFIELD_FRAMING_REVISION};
}
