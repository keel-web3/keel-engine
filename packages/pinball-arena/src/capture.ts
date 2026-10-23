import type {ArenaWorldDefinition,ArenaPinballPort,ArenaPoint} from './types.ts';

export interface ArenaCapture {
 readonly id:string;readonly kind:'scoop'|'lock'|'tunnel'|'portal';readonly entryPortId:string;
 readonly exitArenaId:string;readonly exitPortId:string;readonly fallbackExitPortId:string;
 readonly approach:{readonly minSpeed:number;readonly maxSpeed:number;readonly minDot:number};
 readonly captureTicks:number;readonly travelTicks:number;readonly maxExitWaitTicks:number;
 readonly exitVelocity:ArenaPoint;
 readonly release:{readonly kind:'timer'}|{readonly kind:'qualification';readonly id:string;readonly maxHoldTicks:number};
 readonly busyGateIds:readonly string[];readonly blockedTerminal:'drain';
}
export interface ArenaTransportFrame {
 readonly mechanismId:string;readonly kind:ArenaCapture['kind'];readonly phase:'captured'|'transit'|'exit-blocked';
 readonly entryTick:number;readonly phaseTick:number;readonly plannedReleaseTick:number|null;
 readonly exitArenaId:string;readonly exitPortId:string;
}
export interface ArenaCaptureFrame {
 readonly id:string;readonly arenaId:string;readonly enabled:boolean;readonly occupiedBodyId:string|null;
 readonly phase:'idle'|'captured'|'transit'|'exit-blocked';readonly activations:number;
}
export interface ArenaMechanismFrame {
 readonly id:string;readonly arenaId:string;readonly kind:'bumper'|'spring'|'plunger'|'switch'|'gate'|'diverter'|'lock';
 readonly activationTick:number;readonly activationSerial:number;readonly intensity:number;readonly durationTicks:number;
}
export interface CaptureBodyProbe {
 readonly id:string;readonly ownerId:number;readonly arenaId:string;readonly x:number;readonly y:number;
 readonly vx:number;readonly vy:number;readonly radius:number;readonly layer:number;readonly elevation:number;
 readonly active:boolean;readonly eliminated:boolean;
}
export interface CaptureBinding {
 readonly item:ArenaCapture;readonly arenaId:string;readonly entry:ArenaPinballPort;
 readonly exit:ArenaPinballPort;readonly fallback:ArenaPinballPort;
}
export interface CaptureAction {
 readonly type:'capture-enter'|'transit-start'|'capture-release'|'exit-blocked'|'terminal-drain';
 readonly bodyId:string;readonly ownerId:number;readonly mechanismId:string;
 readonly entryPortId:string;readonly exitPortId:string;readonly arenaId:string;
 readonly x:number;readonly y:number;readonly layer:number;readonly elevation:number;
 readonly vx:number;readonly vy:number;
}

export interface ArenaMechanismSpec {readonly id:string;readonly arenaId:string;readonly kind:ArenaMechanismFrame['kind'];readonly durationTicks:number}
/** Static dictionaries are descriptor-derived and shared by authority/codecs. */
export function arenaMechanismSpecs(world:ArenaWorldDefinition):readonly ArenaMechanismSpec[]{
 const specs:ArenaMechanismSpec[]=[];
 for(const a of world.arenas){
  for(const b of a.bumpers)specs.push({id:b.id,arenaId:a.id,kind:b.kind==='spring'?'spring':'bumper',durationTicks:36});
  for(const s of a.stations)specs.push({id:s.id,arenaId:a.id,kind:'plunger',durationTicks:24});
  for(const s of a.switches)specs.push({id:s.id,arenaId:a.id,kind:'switch',durationTicks:18});
  for(const g of a.gates)specs.push({id:g.id,arenaId:a.id,kind:'gate',durationTicks:12});
  for(const c of a.captures??[])specs.push({id:c.id,arenaId:a.id,kind:'lock',durationTicks:24});
 }
 if(specs.length>512||new Set(specs.map(s=>s.id)).size!==specs.length)throw new Error('Mechanism record capacity or identity');
 return Object.freeze(specs.sort((a,b)=>compare(a.id,b.id)).map(s=>Object.freeze(s)));
}
export function arenaCaptureBindings(world:ArenaWorldDefinition):readonly CaptureBinding[]{
 return world.arenas.flatMap(a=>(a.captures??[]).map(item=>{
  const entry=a.pinball?.ports.find(p=>p.id===item.entryPortId),target=world.arenas.find(a=>a.id===item.exitArenaId),exit=target?.pinball?.ports.find(p=>p.id===item.exitPortId),fallback=target?.pinball?.ports.find(p=>p.id===item.fallbackExitPortId);
  if(!entry||!exit||!fallback)throw new Error('Capture port reference absent');
  return {item,arenaId:a.id,entry,exit,fallback};
 })).sort((a,b)=>compare(a.item.id,b.item.id));
}
interface StoredTransport {bodyId:string;ownerId:number;state:ArenaTransportFrame}
interface RecordState {binding:CaptureBinding;occupiedBodyId:string|null;activations:number}
const integer=(n:unknown,min:number,max:number):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=min&&n<=max;
const finite=(n:unknown,min:number,max:number):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const keys=(value:unknown,expected:readonly string[])=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...expected].sort().join(',');

/** Swept directed mouth admission, using completed-tick positions. This does
 * not capture proximity alone or silently change a body's trajectory. */
export function captureCrossing(entry:ArenaPinballPort,previous:CaptureBodyProbe,current:CaptureBodyProbe,approach:ArenaCapture['approach']):number|null {
 if(![previous,current].every(b=>[b.x,b.y,b.vx,b.vy,b.radius,b.elevation].every(Number.isFinite)&&b.x>=0&&b.x<=65535&&b.y>=0&&b.y<=65535&&b.radius>=6&&b.radius<=24&&b.elevation>=0&&b.elevation<=400&&integer(b.layer,0,3)&&integer(b.ownerId,0,99)))return null;
 if(!previous.active||!current.active||current.eliminated||previous.ownerId!==current.ownerId||previous.id!==current.id||previous.arenaId!==current.arenaId||current.layer!==entry.layer||previous.layer!==entry.layer||current.radius>entry.maxBallRadius)return null;
 if(Math.abs(current.elevation-entry.elevation)>current.radius+4||Math.abs(previous.elevation-entry.elevation)>current.radius+4)return null;
 const speed=Math.hypot(current.vx,current.vy);
 if(speed<approach.minSpeed||speed>approach.maxSpeed||speed===0||(current.vx*entry.tangent.x+current.vy*entry.tangent.y)/speed<approach.minDot)return null;
 const before=(previous.x-entry.x)*entry.tangent.x+(previous.y-entry.y)*entry.tangent.y,after=(current.x-entry.x)*entry.tangent.x+(current.y-entry.y)*entry.tangent.y;
 if(before>=0||after<0||after<=before)return null;
 const t=-before/(after-before),x=previous.x+(current.x-previous.x)*t,y=previous.y+(current.y-previous.y)*t;
 if(Math.abs((x-entry.x)*-entry.tangent.y+(y-entry.y)*entry.tangent.x)>entry.clearWidth/2-current.radius-1/1024)return null;
 return Math.round(t*65536);
}

/** State controller is separate from native body writes. The authority must
 * apply returned actions in order, including its canonical drain policy. */
export function createCaptureController(bindings:readonly CaptureBinding[]){
 if(bindings.length>256)throw new Error('Capture capacity exceeded');
 const records:RecordState[]=bindings.map(value=>({binding:freeze(JSON.parse(JSON.stringify(value)) as CaptureBinding),occupiedBodyId:null,activations:0})).sort((a,b)=>compare(a.binding.item.id,b.binding.item.id));
 const byId=new Map(records.map(record=>[record.binding.item.id,record])),transports=new Map<string,StoredTransport>();
 if(byId.size!==records.length)throw new Error('Duplicate capture identity');
 for(const {binding:b}of records){const c=b.item;
  if(!c.id||!['scoop','lock','tunnel','portal'].includes(c.kind)||!['timer','qualification'].includes(c.release.kind)||c.entryPortId!==b.entry.id||c.exitPortId!==b.exit.id||c.fallbackExitPortId!==b.fallback.id||b.entry.role!=='capture-entry'||b.exit.role!=='release-exit'||b.fallback.role!=='release-exit'||c.blockedTerminal!=='drain'||!integer(c.captureTicks,12,1200)||!integer(c.travelTicks,0,2400)||!integer(c.maxExitWaitTicks,12,600)||!finite(c.approach.minSpeed,0,18)||!finite(c.approach.maxSpeed,c.approach.minSpeed,18)||!finite(c.approach.minDot,0,1)||!finite(c.exitVelocity.x,-18,18)||!finite(c.exitVelocity.y,-18,18)||Math.hypot(c.exitVelocity.x,c.exitVelocity.y)>18||c.release.kind==='qualification'&&(!c.release.id||!integer(c.release.maxHoldTicks,c.captureTicks,1200)))throw new Error('Invalid capture binding');
  for(const p of [b.entry,b.exit,b.fallback])if(![p.x,p.y,p.elevation,p.clearWidth,p.maxBallRadius,p.tangent.x,p.tangent.y].every(Number.isFinite)||!finite(p.x,0,65535)||!finite(p.y,0,65535)||!finite(p.elevation,0,400)||!integer(p.layer,0,3)||!finite(p.maxBallRadius,6,24)||!finite(p.clearWidth,24,400)||p.clearWidth<2*p.maxBallRadius+2/1024||Math.abs(Math.hypot(p.tangent.x,p.tangent.y)-1)>.001)throw new Error('Invalid capture port');
 }
 const action=(r:RecordState,t:StoredTransport,type:CaptureAction['type'],port=r.binding.entry):CaptureAction=>({type,bodyId:t.bodyId,ownerId:t.ownerId,mechanismId:r.binding.item.id,entryPortId:r.binding.entry.id,exitPortId:t.state.exitPortId,arenaId:type==='capture-release'?r.binding.item.exitArenaId:r.binding.arenaId,x:port.x,y:port.y,layer:port.layer,elevation:port.elevation,vx:type==='capture-release'?r.binding.item.exitVelocity.x:0,vy:type==='capture-release'?r.binding.item.exitVelocity.y:0});
 function cancel(bodyId:string){const t=transports.get(bodyId);if(!t)return;const r=byId.get(t.state.mechanismId)!;r.occupiedBodyId=null;transports.delete(bodyId);}
 return {
  state(bodyId:string):ArenaTransportFrame|null{const state=transports.get(bodyId)?.state;return state?{...state}:null;},
  frames():ArenaCaptureFrame[]{return records.map(r=>({id:r.binding.item.id,arenaId:r.binding.arenaId,enabled:r.occupiedBodyId===null,occupiedBodyId:r.occupiedBodyId,phase:r.occupiedBodyId?transports.get(r.occupiedBodyId)!.state.phase:'idle',activations:r.activations}));},
  occupiedGateIds():ReadonlySet<string>{return new Set(records.filter(r=>r.occupiedBodyId!==null).flatMap(r=>r.binding.item.busyGateIds));},
  cancel,
  enter(previous:ReadonlyMap<string,CaptureBodyProbe>,current:readonly CaptureBodyProbe[],tick:number):CaptureAction[]{
   if(!integer(tick,1,432000)||current.length>128)throw new Error('Capture entry tick/body budget');
   const candidates:{r:RecordState;b:CaptureBodyProbe;fraction:number}[]=[];
   for(const b of current){if(transports.has(b.id))continue;const p=previous.get(b.id);if(!p)continue;for(const r of records){if(r.occupiedBodyId!==null||r.binding.arenaId!==b.arenaId)continue;const fraction=captureCrossing(r.binding.entry,p,b,r.binding.item.approach);if(fraction!==null)candidates.push({r,b,fraction});}}
   candidates.sort((a,b)=>a.fraction-b.fraction||a.b.ownerId-b.b.ownerId||compare(a.b.id,b.b.id)||compare(a.r.binding.item.id,b.r.binding.item.id));
   const out:CaptureAction[]=[];
   for(const {r,b}of candidates){if(r.occupiedBodyId!==null||transports.has(b.id))continue;const c=r.binding.item,state:ArenaTransportFrame={mechanismId:c.id,kind:c.kind,phase:'captured',entryTick:tick,phaseTick:tick,plannedReleaseTick:c.release.kind==='timer'?tick+c.captureTicks+c.travelTicks:null,exitArenaId:c.exitArenaId,exitPortId:c.exitPortId},t={bodyId:b.id,ownerId:b.ownerId,state};r.occupiedBodyId=b.id;r.activations++;transports.set(b.id,t);out.push(action(r,t,'capture-enter'));}
   return out;
  },
  advance(tick:number,qualified:(id:string,ownerId:number)=>boolean,exitClear:(binding:CaptureBinding,port:ArenaPinballPort,bodyId:string)=>boolean):CaptureAction[]{
   if(!integer(tick,1,432000))throw new Error('Capture advance tick budget');const out:CaptureAction[]=[];
   for(const t of [...transports.values()].sort((a,b)=>a.ownerId-b.ownerId||compare(a.bodyId,b.bodyId))){const r=byId.get(t.state.mechanismId)!,c=r.binding.item;
    if(t.state.phase==='captured'){
     const age=tick-t.state.entryTick;if(age<c.captureTicks)continue;
     const timedOut=c.release.kind==='qualification'&&age>=c.release.maxHoldTicks;
     if(c.release.kind==='qualification'&&!timedOut&&!qualified(c.release.id,t.ownerId))continue;
     t.state={...t.state,phase:'transit',phaseTick:tick,plannedReleaseTick:tick+c.travelTicks,exitPortId:timedOut?c.fallbackExitPortId:c.exitPortId};out.push(action(r,t,'transit-start'));
    }
    if(t.state.phase==='transit'&&tick<t.state.plannedReleaseTick!)continue;
    const selected=t.state.exitPortId===c.fallbackExitPortId?r.binding.fallback:r.binding.exit;
    if(exitClear(r.binding,selected,t.bodyId)){out.push(action(r,t,'capture-release',selected));cancel(t.bodyId);continue;}
    if(t.state.phase!=='exit-blocked'){t.state={...t.state,phase:'exit-blocked',phaseTick:tick};out.push(action(r,t,'exit-blocked'));}
    if(tick-t.state.phaseTick>=c.maxExitWaitTicks){
     if(selected.id!==r.binding.fallback.id&&exitClear(r.binding,r.binding.fallback,t.bodyId)){t.state={...t.state,exitPortId:c.fallbackExitPortId};out.push(action(r,t,'capture-release',r.binding.fallback));}
     else out.push(action(r,t,'terminal-drain'));
     cancel(t.bodyId);
    }
   }
   return out;
  },
  snapshot(){return {records:records.map(r=>({id:r.binding.item.id,occupiedBodyId:r.occupiedBodyId,activations:r.activations})),transports:[...transports.values()].sort((a,b)=>a.ownerId-b.ownerId||compare(a.bodyId,b.bodyId)).map(t=>({...t,state:{...t.state}}))};},
  /** Validate to a new closure before replacing any accepted occupancy. */
  prepareRestore(data:unknown,tick:number,bodies:readonly CaptureBodyProbe[],qualified:(id:string,ownerId:number)=>boolean=()=>false):()=>void {
   const d=data as {records?:unknown[];transports?:unknown[]};if(!keys(d,['records','transports'])||!integer(tick,0,432000)||!Array.isArray(d.records)||d.records.length!==records.length||!Array.isArray(d.transports)||d.transports.length>128)throw new Error('Invalid capture snapshot budget');
   const bodyMap=new Map(bodies.map(b=>[b.id,b])),restored=new Map<string,StoredTransport>(),occupancy=new Map<string,{bodyId:string|null;activations:number}>();
   for(const value of d.records){const v=value as {id:string;occupiedBodyId:string|null;activations:number};if(!keys(v,['id','occupiedBodyId','activations'])||!byId.has(v.id)||occupancy.has(v.id)||!integer(v.activations,0,tick*128)||v.occupiedBodyId!==null&&!bodyMap.has(v.occupiedBodyId))throw new Error('Invalid capture snapshot record');occupancy.set(v.id,{bodyId:v.occupiedBodyId,activations:v.activations});}
   for(const value of d.transports){const t=value as StoredTransport,s=t?.state,r=s&&byId.get(s.mechanismId),b=bodyMap.get(t?.bodyId);if(!keys(t,['bodyId','ownerId','state'])||!keys(s,['mechanismId','kind','phase','entryTick','phaseTick','plannedReleaseTick','exitArenaId','exitPortId'])||!r||!b||restored.has(t.bodyId)||b.ownerId!==t.ownerId||b.active||b.eliminated||occupancy.get(s.mechanismId)?.bodyId!==t.bodyId||occupancy.get(s.mechanismId)!.activations===0||s.kind!==r.binding.item.kind||!['captured','transit','exit-blocked'].includes(s.phase)||!integer(s.entryTick,1,tick)||!integer(s.phaseTick,s.entryTick,tick)||s.exitArenaId!==r.binding.item.exitArenaId||![r.binding.item.exitPortId,r.binding.item.fallbackExitPortId].includes(s.exitPortId)||b.arenaId!==r.binding.arenaId||b.layer!==r.binding.entry.layer||Math.abs(b.elevation-r.binding.entry.elevation)>1/1024||Math.hypot(b.x-r.binding.entry.x,b.y-r.binding.entry.y)>2/1024||b.vx!==0||b.vy!==0)throw new Error('Invalid capture snapshot transport');
    const c=r.binding.item,age=tick-s.entryTick;
    if(s.phase==='captured'){if(s.phaseTick!==s.entryTick||s.exitPortId!==c.exitPortId||(c.release.kind==='timer'?(age>=c.captureTicks||s.plannedReleaseTick!==s.entryTick+c.captureTicks+c.travelTicks):(age>=c.release.maxHoldTicks||age>=c.captureTicks&&qualified(c.release.id,t.ownerId)||s.plannedReleaseTick!==null)))throw new Error('Invalid capture hold phase');}
    else {
     if(!integer(s.plannedReleaseTick,s.entryTick+c.captureTicks+c.travelTicks,s.entryTick+(c.release.kind==='timer'?c.captureTicks:c.release.maxHoldTicks)+c.travelTicks))throw new Error('Invalid capture transit schedule');
     const start=s.plannedReleaseTick-c.travelTicks,expectedExit=c.release.kind==='qualification'&&start===s.entryTick+c.release.maxHoldTicks?c.fallbackExitPortId:c.exitPortId;
     if(c.release.kind==='timer'&&start!==s.entryTick+c.captureTicks||c.release.kind==='qualification'&&expectedExit===c.exitPortId&&!qualified(c.release.id,t.ownerId)||s.exitPortId!==expectedExit||s.phase==='transit'&&(s.phaseTick!==start||tick>=s.plannedReleaseTick)||s.phase==='exit-blocked'&&(s.phaseTick!==s.plannedReleaseTick||tick-s.phaseTick>=c.maxExitWaitTicks))throw new Error('Invalid capture transit phase');
    }
    restored.set(t.bodyId,{bodyId:t.bodyId,ownerId:t.ownerId,state:{...s}});
   }
   for(const {bodyId}of occupancy.values())if(bodyId!==null&&!restored.has(bodyId))throw new Error('Invalid capture occupancy bijection');
   return ()=>{transports.clear();for(const [id,t]of restored)transports.set(id,t);for(const r of records){const v=occupancy.get(r.binding.item.id)!;r.occupiedBodyId=v.bodyId;r.activations=v.activations;}};
  },
 };
}
