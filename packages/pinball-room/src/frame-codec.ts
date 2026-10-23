import type {ArenaWorldDefinition,ArenaFrame,ArenaEvent,ArenaPlayer,ArenaBallFrame} from '@keel-engine/pinball-arena';
import {validateArenaWorld,ARENA_KERNEL_SHA256,ARENA_AUTHORITY_REVISION,arenaCaptureBindings,arenaMechanismSpecs} from '@keel-engine/pinball-arena';
import {sha256,toHex} from '@keel-engine/codec/hash';
const MAGIC=0x4642504b,Q=1024,CAP=131072;
const utf8=new TextEncoder(),text=new TextDecoder('utf-8',{fatal:true});
const integer=(n:number,lo:number,hi:number)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
function checksum(bytes:Uint8Array){let n=0x811c9dc5;for(const b of bytes)n=Math.imul(n^b,0x01000193)>>>0;return n;}
function demand(ok:unknown,message:string):asserts ok {if(!ok)throw new Error('Invalid public arena frame: '+message);}
class Writer {
 readonly bytes=new Uint8Array(CAP);readonly view=new DataView(this.bytes.buffer);offset=0;
 add(length:number){demand(this.offset+length<=CAP,'packet cap');const at=this.offset;this.offset+=length;return at;}
 u8(n:number){demand(integer(n,0,255),'u8');this.view.setUint8(this.add(1),n);}
 u16(n:number){demand(integer(n,0,65535),'u16');this.view.setUint16(this.add(2),n,true);}
 i16(n:number){demand(integer(n,-32768,32767),'i16');this.view.setInt16(this.add(2),n,true);}
 u32(n:number){demand(integer(n,0,0xffffffff),'u32');this.view.setUint32(this.add(4),n,true);}
 f64(n:number){demand(integer(n,0,Number.MAX_SAFE_INTEGER),'score');this.view.setFloat64(this.add(8),n,true);}
 raw(b:Uint8Array){this.bytes.set(b,this.add(b.length));}
 string(s:string){const b=utf8.encode(s);demand(b.length>0&&b.length<=80,'body id');this.u8(b.length);this.raw(b);}
 finish(){this.u32(checksum(this.bytes.subarray(0,this.offset)));return this.bytes.slice(0,this.offset);}
}
class Reader {
 readonly view:DataView;readonly bytes:Uint8Array;offset=0;
 constructor(bytes:Uint8Array){demand(bytes.length>=50&&bytes.length<=CAP,'packet length');this.bytes=bytes;this.view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);demand(this.view.getUint32(bytes.length-4,true)===checksum(bytes.subarray(0,-4)),'checksum');}
 take(n:number){demand(this.offset+n<=this.bytes.length-4,'truncated');const at=this.offset;this.offset+=n;return at;}
 u8(){return this.view.getUint8(this.take(1));}u16(){return this.view.getUint16(this.take(2),true);}i16(){return this.view.getInt16(this.take(2),true);}u32(){return this.view.getUint32(this.take(4),true);}f64(){const n=this.view.getFloat64(this.take(8),true);demand(integer(n,0,Number.MAX_SAFE_INTEGER),'score');return n;}
 raw(n:number){const at=this.take(n);return this.bytes.subarray(at,at+n);}string(){const n=this.u8();demand(n>0&&n<=80,'body id');return text.decode(this.raw(n));}
}
const eventTypes=new Set(['rail','bumper','flipper','ball-contact','launch','switch','gate','ramp-enter','ramp-exit','ramp-abort','portal','ability','damage','eliminated','match-end','contact-budget','lease','command','hazard','drain','fall','escape','route-checkpoint','route-complete','unlock','station-catch','capture-enter','transit-start','capture-release','exit-blocked','mechanism-actuate']);
const eventKeys=new Set(['id','tick','type','bodyId','mechanismId','entryPortId','exitPortId','ownerId','otherOwnerId','arenaId','colliderId','x','y','energy','radius','layer','elevation','sourceOwnerId','amount','assists','cause','ability']);
const transportPhases=['captured','transit','exit-blocked'] as const,capturePhases=['idle',...transportPhases] as const;
/** Only public state is sent. Hidden authority snapshots and replay admission stay on the host. */
export function createArenaFrameCodec(world:ArenaWorldDefinition,acceptedPlayers:readonly ArenaPlayer[]){
 validateArenaWorld(world);
 const players=acceptedPlayers.map(p=>({...p}));demand(players.length>0&&players.length<=100&&players.every(p=>integer(p.ownerId,0,99)&&integer(p.teamId,0,99)&&integer(p.maxHealth??6,1,100))&&new Set(players.map(p=>p.ownerId)).size===players.length,'accepted roster');
 // Capture only the static protocol dictionary, without cloning world art.
 const arenas=world.arenas.map(a=>structuredClone({id:a.id,regions:a.regions,flippers:a.flippers,gates:a.gates,switches:a.switches,portals:a.portals,stations:a.stations,ramps:a.ramps,ports:a.pinball?.ports??[],challenges:a.challenges??[],requirements:a.requirements??[]})),regions=arenas.flatMap(a=>a.regions),flippers=arenas.flatMap(a=>a.flippers.map(f=>({...f,arenaId:a.id}))),gates=arenas.flatMap(a=>a.gates.map(g=>({...g,arenaId:a.id}))),switches=arenas.flatMap(a=>a.switches.map(s=>({...s,arenaId:a.id}))),portals=arenas.flatMap(a=>a.portals.map(p=>({...p,arenaId:a.id}))),stations=arenas.flatMap(a=>a.stations.map(s=>({...s,arenaId:a.id}))),ramps=arenas.flatMap(a=>a.ramps),ports=arenas.flatMap(a=>a.ports.map(p=>({...p,arenaId:a.id})));
 const captures=structuredClone(arenaCaptureBindings(world)),captureRefs=captures.map(c=>({id:c.item.id})),mechanisms=structuredClone(arenaMechanismSpecs(world));
 const worldDigest=world.sha256,byId=new Map(players.map(p=>[p.ownerId,p])),owners=new Set(byId.keys()),teams=new Set(players.map(p=>p.teamId));
 const identity=utf8.encode(toHex(sha256(utf8.encode(JSON.stringify({world:worldDigest,kernel:ARENA_KERNEL_SHA256,authority:ARENA_AUTHORITY_REVISION,players})))));
 const challenges=arenas.flatMap(a=>a.challenges??[]),requirements=arenas.flatMap(a=>a.requirements??[]);
 const idIndex=(items:readonly {id:string}[],id:string|null)=>{if(id===null)return 0;const n=items.findIndex(i=>i.id===id);demand(n>=0,'unknown reference');return n+1;};
 const idAt=(items:readonly {id:string}[],index:number)=>{demand(index<=items.length,'reference index');return index===0?null:items[index-1]!.id;};
 function encode(frame:ArenaFrame):Uint8Array{
  demand(frame.schema==='keel-pinball-arena-frame@2'&&frame.balls.length===players.length&&frame.flippers.length===flippers.length&&frame.gates.length===gates.length&&frame.switches.length===switches.length&&frame.portals.length===portals.length&&frame.stations.length===stations.length&&frame.captures.length===captures.length&&frame.mechanisms.length===mechanisms.length,'world counts');
  const w=new Writer();w.u32(MAGIC);w.u8(2);w.raw(identity);w.u32(frame.tick);w.u8(['ready','playing','finished'].indexOf(frame.phase));w.u8(frame.mode==='battle'?0:1);w.i16(frame.winnerTeamId??-1);w.u8([null,'last-team','mutual-elimination','timeout'].indexOf(frame.finishReason));
  w.u8(Number(frame.storm.active));w.u8(arenas.findIndex(a=>a.id===frame.storm.arenaId));w.u32(Math.round(frame.storm.x*Q));w.u32(Math.round(frame.storm.y*Q));w.u32(Math.round(frame.storm.radius*Q));w.u16(frame.balls.length);
  for(const b of frame.balls){
   w.string(b.id);w.u8(b.ownerId);w.u8(b.teamId);w.u8(arenas.findIndex(a=>a.id===b.arenaId));w.u16(idIndex(regions,b.regionId));w.u32(Math.round(b.x*Q));w.u32(Math.round(b.y*Q));w.i16(Math.round(b.vx*Q));w.i16(Math.round(b.vy*Q));w.u16(Math.round(b.radius*Q));w.u8(b.layer);w.u32(Math.round(b.elevation*Q));w.u8(Number(b.active)|(Number(b.eliminated)<<1));w.u8(b.health);w.u8(b.energy);w.u16(b.shieldTicks);for(const c of b.cooldowns)w.u16(c);w.f64(b.score);w.u16(b.portalCooldown);w.u16(idIndex(ramps,b.rampId));w.u16(idIndex(stations,b.stationId));w.u16(idIndex(stations,b.nextStationId));
   const transport=b.transport;w.u16(transport===null?0:idIndex(captureRefs,transport.mechanismId));
   if(transport){const binding=captures.find(c=>c.item.id===transport.mechanismId)!;demand(transport.kind===binding.item.kind&&transport.exitArenaId===binding.item.exitArenaId,'transport binding');w.u8(transportPhases.indexOf(transport.phase));w.u32(transport.entryTick);w.u32(transport.phaseTick);w.u32(transport.plannedReleaseTick??0xffffffff);w.u16(idIndex(ports,transport.exitPortId));}
  }
  for(const [i,f]of frame.flippers.entries()){demand(f.id===flippers[i]!.id,'flipper order');w.u8(f.ownerId<0?255:f.ownerId);w.i16(Math.round(f.angle*10));w.u32(Math.round(f.tipX*Q));w.u32(Math.round(f.tipY*Q));}
  for(const [i,g]of frame.gates.entries()){demand(g.id===gates[i]!.id,'gate order');w.u32(g.openTicks);}
  for(const [i,s]of frame.switches.entries()){demand(s.id===switches[i]!.id,'switch order');w.u8(s.lastOwnerId??255);w.u32(s.remainingTicks);}
  for(const [i,p]of frame.portals.entries()){demand(p.id===portals[i]!.id,'portal order');w.u8(Number(p.enabled));w.u32(p.transfers);}
  for(const [i,s]of frame.stations.entries()){demand(s.id===stations[i]!.id,'station order');w.u8(s.ownerId??255);w.u16(s.leaseTicks);}
  for(const [i,c]of frame.captures.entries()){demand(c.id===captures[i]!.item.id&&c.arenaId===captures[i]!.arenaId,'capture order');w.u8(Number(c.enabled));const owner=c.occupiedBodyId===null?255:players.find(p=>`core-${p.ownerId}`===c.occupiedBodyId)?.ownerId;demand(owner!==undefined,'capture occupant');w.u8(owner);w.u8(capturePhases.indexOf(c.phase));w.u32(c.activations);}
  for(const [i,m]of frame.mechanisms.entries()){const spec=mechanisms[i]!;demand(m.id===spec.id&&m.arenaId===spec.arenaId&&m.kind===spec.kind&&m.durationTicks===spec.durationTicks,'mechanism order');w.u32(m.activationTick);w.u32(m.activationSerial);w.u16(m.intensity);}
  w.u16(frame.routeProgress.length);for(const p of frame.routeProgress){w.u8(p.ownerId);w.u16(idIndex(challenges,p.routeId));w.u8(p.nextCheckpoint);}
  demand(frame.qualifications.length===requirements.length,'qualifications');for(const [i,p]of frame.qualifications.entries()){demand(p.id===requirements[i]!.id,'qualification order');w.u8(p.qualifiedBy.length);for(const n of p.qualifiedBy)w.u8(n);}
  demand(frame.events.length<=256,'event count');const eventBytes=utf8.encode(JSON.stringify(frame.events));demand(eventBytes.length<=65535,'event cap');w.u16(eventBytes.length);w.raw(eventBytes);return w.finish();
 }
 function decode(bytes:Uint8Array):ArenaFrame{
  const r=new Reader(bytes);demand(r.u32()===MAGIC&&r.u8()===2,'version');demand(text.decode(r.raw(identity.length))===text.decode(identity),'round identity');
  const tick=r.u32(),phaseIndex=r.u8(),modeIndex=r.u8(),winner=r.i16(),finishIndex=r.u8();demand(tick<=120*3600&&phaseIndex<=2&&modeIndex<=1&&finishIndex<=3&&(winner===-1||teams.has(winner)),'lifecycle');const phase=(['ready','playing','finished'] as const)[phaseIndex]!,mode=modeIndex===0?'battle':'expedition',finishReason=([null,'last-team','mutual-elimination','timeout'] as const)[finishIndex]!;
  demand(phase==='finished'?finishReason!==null:finishReason===null&&winner===-1,'finish reason');
  const active=r.u8(),stormArena=r.u8(),x=r.u32()/Q,y=r.u32()/Q,radius=r.u32()/Q;demand(active<=1&&stormArena<arenas.length&&x<=65535&&y<=65535&&radius<=100000,'storm');
  const count=r.u16();demand(count===players.length,'body count');const balls:ArenaBallFrame[]=[],ids=new Set<string>();
  for(let i=0;i<count;i++){
   const id=r.string(),ownerId=r.u8(),teamId=r.u8(),ai=r.u8(),ri=r.u16(),bx=r.u32()/Q,by=r.u32()/Q,vx=r.i16()/Q,vy=r.i16()/Q,bodyRadius=r.u16()/Q,layer=r.u8(),elevation=r.u32()/Q,flags=r.u8(),health=r.u8(),energy=r.u8(),shieldTicks=r.u16(),cooldowns:[number,number,number]=[r.u16(),r.u16(),r.u16()],score=r.f64(),portalCooldown=r.u16(),rampId=idAt(ramps,r.u16()),stationId=idAt(stations,r.u16()),nextStationId=idAt(stations,r.u16());
   demand(id===`core-${ownerId}`&&!ids.has(id)&&owners.has(ownerId)&&byId.get(ownerId)!.teamId===teamId&&ai<arenas.length&&ri>0&&ri<=regions.length&&arenas[ai]!.regions.some(n=>n.id===regions[ri-1]!.id)&&bx<=65535&&by<=65535&&Math.hypot(vx,vy)<=18.01&&bodyRadius>=6&&bodyRadius<=24&&layer<=3&&elevation<=400&&flags<=3&&health<=(byId.get(ownerId)!.maxHealth??6)&&energy<=100&&shieldTicks<=12000&&cooldowns.every(c=>c<=10000)&&portalCooldown<=120&&score<=tick*20000,'body');
   demand(flags&2?health===0&&!(flags&1):health>0,'body lifecycle');ids.add(id);
   const captureIndex=r.u16();demand(captureIndex<=captures.length,'transport index');let transport:ArenaBallFrame['transport']=null;
   if(captureIndex){const binding=captures[captureIndex-1]!,phaseIndex=r.u8(),entryTick=r.u32(),phaseTick=r.u32(),release=r.u32(),portIndex=r.u16();demand(phaseIndex<transportPhases.length&&entryTick>0&&entryTick<=phaseTick&&phaseTick<=tick&&!(flags&3)&&vx===0&&vy===0&&rampId===null&&stationId===null,'transport lifecycle');
    const portId=idAt(ports,portIndex);demand(portId!==null&&(portId===binding.item.exitPortId||portId===binding.item.fallbackExitPortId)&&ports[portIndex-1]!.arenaId===binding.item.exitArenaId,'transport exit');
    const transportPhase=transportPhases[phaseIndex]!,c=binding.item,age=tick-entryTick;
    demand(arenas[ai]!.id===binding.arenaId&&layer===binding.entry.layer&&Math.abs(elevation-binding.entry.elevation)<=1/Q&&Math.hypot(bx-binding.entry.x,by-binding.entry.y)<=2/Q,'transport mouth');
    if(transportPhase==='captured')demand(phaseTick===entryTick&&portId===c.exitPortId&&(c.release.kind==='timer'?age<c.captureTicks&&release===entryTick+c.captureTicks+c.travelTicks:age<c.release.maxHoldTicks&&release===0xffffffff),'transport hold');
    else {
     demand(release!==0xffffffff&&release>=entryTick+c.captureTicks+c.travelTicks&&release<=entryTick+(c.release.kind==='timer'?c.captureTicks:c.release.maxHoldTicks)+c.travelTicks,'transport schedule');
     const start=release-c.travelTicks,expectedExit=c.release.kind==='qualification'&&start===entryTick+c.release.maxHoldTicks?c.fallbackExitPortId:c.exitPortId;
     demand((c.release.kind!=='timer'||start===entryTick+c.captureTicks)&&portId===expectedExit&&(transportPhase==='transit'?phaseTick===start&&tick<release:phaseTick===release&&tick-phaseTick<c.maxExitWaitTicks),'transport transit');
    }
    transport={mechanismId:binding.item.id,kind:binding.item.kind,phase:transportPhase,entryTick,phaseTick,plannedReleaseTick:release===0xffffffff?null:release,exitArenaId:binding.item.exitArenaId,exitPortId:portId};
   }
   balls.push({id,ownerId,teamId,arenaId:arenas[ai]!.id,regionId:regions[ri-1]!.id,x:bx,y:by,vx,vy,radius:bodyRadius,layer,elevation,active:!!(flags&1),eliminated:!!(flags&2),health,energy,shieldTicks,cooldowns,score,portalCooldown,rampId,stationId,nextStationId,transport});
  }
  const liveFlippers=flippers.map(f=>{const owner=r.u8(),angle=r.i16()/10,tipX=r.u32()/Q,tipY=r.u32()/Q;demand((owner===255||owners.has(owner))&&angle>=Math.min(f.restAngle,f.activeAngle)-.1&&angle<=Math.max(f.restAngle,f.activeAngle)+.1&&tipX<=65535&&tipY<=65535,'flipper');return {id:f.id,arenaId:f.arenaId,ownerId:owner===255?-1:owner,layer:f.layer,elevation:f.elevation,angle,pivotX:f.pivotX,pivotY:f.pivotY,tipX,tipY,radius:f.radius};});
  const liveGates=gates.map(g=>{const openTicks=r.u32();demand(openTicks<=100000,'gate');return {id:g.id,arenaId:g.arenaId,open:openTicks>0,openTicks};});
  const liveSwitches=switches.map(s=>{const owner=r.u8(),remainingTicks=r.u32();demand((owner===255||owners.has(owner))&&remainingTicks<=100000,'switch');return {id:s.id,arenaId:s.arenaId,active:remainingTicks>0,lastOwnerId:owner===255?null:owner,remainingTicks};});
  const livePortals=portals.map(p=>{const on=r.u8(),transfers=r.u32();demand(on<=1&&transfers<=tick*256,'portal');return {id:p.id,arenaId:p.arenaId,enabled:!!on,transfers};});
  const leases=new Set<number>();const liveStations=stations.map(s=>{const owner=r.u8(),leaseTicks=r.u16();demand(leaseTicks<=180&&(owner===255?leaseTicks===0:owners.has(owner)&&leaseTicks>0&&!leases.has(owner)),'station');if(owner!==255)leases.add(owner);return {id:s.id,arenaId:s.arenaId,ownerId:owner===255?null:owner,leaseTicks};});
  const occupied=new Set<string>(),liveCaptures=captures.map(binding=>{const enabled=r.u8(),owner=r.u8(),phaseIndex=r.u8(),activations=r.u32();demand(enabled<=1&&phaseIndex<capturePhases.length&&activations<=tick,'capture state');const occupiedBodyId=owner===255?null:`core-${owner}`,capturePhase=capturePhases[phaseIndex]!;
   demand(occupiedBodyId===null?capturePhase==='idle'&&enabled===1:owners.has(owner)&&enabled===0&&activations>0&&capturePhase!=='idle'&&!occupied.has(occupiedBodyId),'capture occupant');
   if(occupiedBodyId!==null){const body=balls.find(b=>b.id===occupiedBodyId)!;demand(body.transport?.mechanismId===binding.item.id&&body.transport.phase===capturePhase,'capture occupancy bijection');occupied.add(occupiedBodyId);}
   return {id:binding.item.id,arenaId:binding.arenaId,enabled:!!enabled,occupiedBodyId,phase:capturePhase,activations};});
  demand(balls.every(b=>b.transport===null||occupied.has(b.id))&&balls.every(b=>b.transport===null||!leases.has(b.ownerId))&&(phase==='playing'||occupied.size===0),'transport occupancy');
  const liveMechanisms=mechanisms.map(spec=>{const activationTick=r.u32(),activationSerial=r.u32(),intensity=r.u16();demand(activationTick<=tick&&activationSerial<=tick&&intensity<=1024&&(activationSerial===0?activationTick===0&&intensity===0:activationTick>0&&intensity>0),'mechanism activation');return {...spec,activationTick,activationSerial,intensity};});
  const progressCount=r.u16(),progressKeys=new Set<string>();demand(progressCount<=players.length*challenges.length,'route count');const routeProgress:ArenaFrame['routeProgress'][number][]=[];
  for(let i=0;i<progressCount;i++){const ownerId=r.u8(),routeIndex=r.u16(),nextCheckpoint=r.u8();demand(owners.has(ownerId)&&routeIndex>0&&routeIndex<=challenges.length,'route owner');const route=challenges[routeIndex-1]!,key=`${ownerId}:${route.id}`;demand(!progressKeys.has(key)&&nextCheckpoint>0&&nextCheckpoint<=Math.min(tick,route.checkpoints.length),'route progress');progressKeys.add(key);routeProgress.push({ownerId,routeId:route.id,nextCheckpoint,completed:nextCheckpoint===route.checkpoints.length});}
  const qualifications=requirements.map(requirement=>{const n=r.u8(),qualifiedBy:number[]=[];demand(n<=players.length,'qualification count');for(let i=0;i<n;i++){const id=r.u8();demand((requirement.scope==='owner'?owners:teams).has(id)&&!qualifiedBy.includes(id),'qualification group');qualifiedBy.push(id);}for(const group of qualifiedBy){const participants=requirement.scope==='owner'?[group]:players.filter(p=>p.teamId===group).map(p=>p.ownerId);demand((requirement.routeGroups??requirement.routeIds.map(id=>[id])).every(alternatives=>alternatives.some(id=>routeProgress.some(p=>participants.includes(p.ownerId)&&p.routeId===id&&p.completed))),'unearned qualification');}return {id:requirement.id,qualifiedBy};});
  for(const [i,requirement]of requirements.entries())for(const group of requirement.scope==='owner'?owners:teams){const participants=requirement.scope==='owner'?[group]:players.filter(p=>p.teamId===group).map(p=>p.ownerId),earned=(requirement.routeGroups??requirement.routeIds.map(id=>[id])).every(alternatives=>alternatives.some(id=>routeProgress.some(p=>participants.includes(p.ownerId)&&p.routeId===id&&p.completed)));demand(earned===qualifications[i]!.qualifiedBy.includes(group),'qualification completeness');}
  for(const body of balls){const t=body.transport;if(!t)continue;const c=captures.find(b=>b.item.id===t.mechanismId)!.item,release=c.release;if(release.kind!=='qualification')continue;
   const requirement=requirements.find(r=>r.id===release.id)!;const qualification=qualifications.find(r=>r.id===requirement.id)!;const earned=qualification.qualifiedBy.includes(requirement.scope==='owner'?body.ownerId:body.teamId);
   demand(t.phase==='captured'?tick-t.entryTick<c.captureTicks||!earned:t.plannedReleaseTick!-c.travelTicks===t.entryTick+release.maxHoldTicks||earned,'transport qualification');
  }
  const events=JSON.parse(text.decode(r.raw(r.u16()))) as ArenaEvent[];demand(Array.isArray(events)&&events.length<=256,'events');const eventIds=new Set<string>();
  for(const e of events){
   demand(e&&typeof e==='object'&&!Array.isArray(e)&&Object.keys(e).every(key=>eventKeys.has(key))&&typeof e.id==='string'&&e.id.length>0&&e.id.length<=120&&!eventIds.has(e.id)&&integer(e.tick,Math.max(0,tick-120),tick)&&eventTypes.has(e.type)&&[e.ownerId,e.otherOwnerId,e.sourceOwnerId].every(n=>n===undefined||owners.has(n))&&(e.x===undefined||Number.isFinite(e.x)&&e.x>=0&&e.x<=65535)&&(e.y===undefined||Number.isFinite(e.y)&&e.y>=0&&e.y<=65535)&&(e.arenaId===undefined||arenas.some(a=>a.id===e.arenaId)),'event');
   demand((e.bodyId===undefined||e.ownerId!==undefined&&e.bodyId===`core-${e.ownerId}`)&&(e.mechanismId===undefined||mechanisms.some(m=>m.id===e.mechanismId))&&(e.layer===undefined||integer(e.layer,0,3))&&(e.elevation===undefined||Number.isFinite(e.elevation)&&e.elevation>=0&&e.elevation<=400)&&[e.energy,e.radius,e.amount].every(n=>n===undefined||Number.isFinite(n)&&n>=0&&n<=65535)&&(e.assists===undefined||Array.isArray(e.assists)&&e.assists.length<=players.length&&new Set(e.assists).size===e.assists.length&&e.assists.every(n=>owners.has(n)))&&(e.ability===undefined||['dash','pulse','shield'].includes(e.ability))&&(e.cause===undefined||['impact','pulse','hazard','storm','command','equipment','score-pressure','launch-deadline'].includes(e.cause)),'event fields');
   const binding=e.mechanismId===undefined?undefined:captures.find(c=>c.item.id===e.mechanismId),captureEvent=['capture-enter','transit-start','capture-release','exit-blocked'].includes(e.type);
   if(captureEvent||e.entryPortId!==undefined||e.exitPortId!==undefined)demand(binding&&e.bodyId!==undefined&&e.entryPortId===binding.entry.id&&(e.exitPortId===binding.item.exitPortId||e.exitPortId===binding.item.fallbackExitPortId)&&e.arenaId===(e.type==='capture-release'?binding.item.exitArenaId:binding.arenaId),'capture event binding');
   if(e.type==='mechanism-actuate')demand(e.mechanismId!==undefined&&mechanisms.some(m=>m.id===e.mechanismId&&m.arenaId===e.arenaId),'mechanism event binding');
   eventIds.add(e.id);
  }
  demand(r.offset===bytes.length-4,'trailing bytes');
  const teamFrames=[...teams].sort((a,b)=>a-b).map(id=>({id,alive:players.filter(p=>p.teamId===id&&balls.some(b=>b.ownerId===p.ownerId&&!b.eliminated)).length,score:players.filter(p=>p.teamId===id).reduce((n,p)=>n+(balls.find(b=>b.ownerId===p.ownerId)?.score??0),0)}));
  return {schema:'keel-pinball-arena-frame@2',tick,phase,mode,balls,flippers:liveFlippers,gates:liveGates,switches:liveSwitches,portals:livePortals,stations:liveStations,captures:liveCaptures,mechanisms:liveMechanisms,routeProgress,qualifications,teams:teamFrames,events,storm:{active:!!active,arenaId:arenas[stormArena]!.id,x,y,radius},winnerTeamId:winner===-1?null:winner,finishReason};
 }
 return {encode,decode};
}

const DELTA_MAGIC=0x3244504b;
/** Byte ranges preserve the exact encoded public frame; no physics coordinates are rounded further. */
export function createArenaFrameStreamEncoder(codec:ReturnType<typeof createArenaFrameCodec>){
 let previous:Uint8Array|undefined;
 return {reset(){previous=undefined;},encode(frame:ArenaFrame){
  const full=codec.encode(frame);let packet=full;
  if(previous&&frame.tick%120!==0){
   const ranges:{start:number;end:number}[]=[];let start=-1,end=-1;
   for(let i=0;i<full.length;i++)if(previous[i]!==full[i]){if(start<0){start=i;end=i+1;}else if(i-end<=6)end=i+1;else{ranges.push({start,end});start=i;end=i+1;}}
   if(start>=0)ranges.push({start,end});
   const length=18+ranges.reduce((n,r)=>n+6+r.end-r.start,0);
   if(length<full.length&&ranges.length<=2048&&ranges.every(r=>r.end-r.start<=65535)){
    const bytes=new Uint8Array(length),view=new DataView(bytes.buffer);let at=0;
    view.setUint32(at,DELTA_MAGIC,true);at+=4;view.setUint32(at,checksum(previous),true);at+=4;view.setUint32(at,full.length,true);at+=4;view.setUint16(at,ranges.length,true);at+=2;
    for(const range of ranges){view.setUint32(at,range.start,true);at+=4;view.setUint16(at,range.end-range.start,true);at+=2;bytes.set(full.subarray(range.start,range.end),at);at+=range.end-range.start;}
    view.setUint32(at,checksum(bytes.subarray(0,at)),true);packet=bytes;
   }
  }
  previous=full;return {packet,full};
 }};
}
export function createArenaFrameStreamDecoder(codec:ReturnType<typeof createArenaFrameCodec>){
 let previous:Uint8Array|undefined;
 return {reset(){previous=undefined;},decode(packet:Uint8Array):ArenaFrame{
  demand(packet.length>=4&&packet.length<=CAP,'stream packet');const view=new DataView(packet.buffer,packet.byteOffset,packet.byteLength);
  if(view.getUint32(0,true)===MAGIC){const frame=codec.decode(packet);previous=packet.slice();return frame;}
  demand(packet.length>=18&&view.getUint32(0,true)===DELTA_MAGIC&&previous,'delta baseline');demand(view.getUint32(packet.length-4,true)===checksum(packet.subarray(0,-4))&&view.getUint32(4,true)===checksum(previous),'delta identity');
  const length=view.getUint32(8,true),count=view.getUint16(12,true);demand(length>=50&&length<=CAP&&count<=2048,'delta cap');const full=new Uint8Array(length);full.set(previous.subarray(0,length));let at=14,end=0;
  for(let i=0;i<count;i++){demand(at+6<=packet.length-4,'delta header');const start=view.getUint32(at,true),size=view.getUint16(at+4,true);at+=6;demand(size>0&&start>=end&&start+size<=length&&at+size<=packet.length-4,'delta range');full.set(packet.subarray(at,at+size),start);at+=size;end=start+size;}
  demand(at===packet.length-4,'delta trailing bytes');const frame=codec.decode(full);previous=full;return frame;
 }};
}
