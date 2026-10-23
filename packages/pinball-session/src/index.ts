export {manifest} from './module.ts';
export * from './pressure.ts';
export * from './equipment.ts';
export * from './replay.ts';
import {createArenaMatch,validateArenaWorld,admitArenaInput} from '@keel-engine/pinball-arena';
import type {ArenaWorldDefinition,ArenaMatchOptions,ArenaOwnerInput,ArenaFrame,ArenaBallFrame,ArenaCommand} from '@keel-engine/pinball-arena';
import {seedTagHash} from '@keel-engine/core/hash';
import {sha256,toHex} from '@keel-engine/codec/hash';
import {admitScorePressure,deriveScoreCurve,DEFAULT_SCORE_PRESSURE} from './pressure.ts';
import type {ScorePressureRules,ScoreCurve} from './pressure.ts';
import {admitEquipment,STARTER_EQUIPMENT} from './equipment.ts';
import type {EquipmentDefinition,EquipmentSlot} from './equipment.ts';
import {createSessionSight} from './sight.ts';

export const PINBALL_SESSION_REVISION='pinball-session/2026-10-07.2';
export const SessionAction=Object.freeze({MEDKIT:1});
export type PinballSessionMode='battle-royale'|'versus'|'team-versus'|'roguelike-solo'|'roguelike-coop';
export interface SessionOwnerInput extends ArenaOwnerInput {readonly actions?:number}
export interface SessionLoadout {readonly ownerId:number;readonly weapon:string|null;readonly passive:string|null;readonly medkits:number}
export interface PickupAdmission {readonly kind:'switch'|'capture';readonly mechanismId:string}
export interface EquipmentCrate {readonly id:string;readonly admission:PickupAdmission;readonly pool:readonly {readonly itemId:string;readonly weight:number}[];readonly medkits:number}
export interface HealingPoint {readonly id:string;readonly admission:PickupAdmission;readonly amount:number;readonly cooldownTicks:number}
export interface HealingPointState extends HealingPoint {readonly lastClaimTick:number|null;readonly remainingTicks:number;readonly available:boolean}
export interface PinballSessionRules {
 readonly mode:PinballSessionMode;
 readonly scorePressure?:ScorePressureRules|null;
 readonly equipment?:readonly EquipmentDefinition[];
 readonly loadouts?:readonly SessionLoadout[];
 readonly crates?:readonly EquipmentCrate[];
 readonly healingPoints?:readonly HealingPoint[];
}
export interface SessionRuleEvent {
 readonly id:string;readonly tick:number;readonly type:'pressure-warning'|'pressure-recovered'|'pressure-damage'|'crate-open'|'healing-point'|'medkit'|'equipment-hit';
 readonly ownerId:number;readonly otherOwnerId?:number;readonly mechanismId?:string;readonly itemId?:string;readonly amount?:number;readonly commandTick?:number;
}
export interface SessionInventory {readonly ownerId:number;readonly weapon:string|null;readonly passive:string|null;readonly medkits:number;readonly medkitCooldown:number}
export interface ScorePressureLife {readonly ownerId:number;readonly belowSince:number|null;readonly lastDamageTick:number;readonly warning:boolean;readonly graceRemaining:number}
export interface PinballSessionFrame {readonly schema:'keel-pinball-session-frame@1';readonly revision:typeof PINBALL_SESSION_REVISION;readonly mode:PinballSessionMode;readonly arena:ArenaFrame;readonly scoreCurve:ScoreCurve|null;readonly pressure:readonly ScorePressureLife[];readonly inventories:readonly SessionInventory[];readonly crates:readonly {readonly id:string;readonly itemId:string;readonly claimedBy:number|null}[];readonly events:readonly SessionRuleEvent[]}
interface Inventory {ownerId:number;weapon:string|null;passive:string|null;medkits:number;medkitCooldown:number;previousActions:number}
interface Pressure {ownerId:number;belowSince:number|null;lastDamageTick:number}
interface PendingDamage {ownerId:number;amount:number;sourceOwnerId:number|null;cause:'pressure'|'equipment';serial:number}
interface PendingHeal {ownerId:number;amount:number;serial:number}
const integer=(n:unknown,lo:number,hi:number):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=lo&&n<=hi;
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const digest=(value:unknown)=>toHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
const textId=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z][a-zA-Z0-9._/-]{0,79}$/.test(value);
function distanceToSegment(x:number,y:number,ax:number,ay:number,bx:number,by:number){const dx=bx-ax,dy=by-ay,den=dx*dx+dy*dy,t=den===0?0:Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/den));return{x:ax+dx*t,y:ay+dy*t,t,d2:(x-ax-dx*t)**2+(y-ay-dy*t)**2};}

/** Owns the actual match: callers supply owner input, never contact events,
 * pickups, scores, player placement, health changes or arbitrary commands. */
export function createPinballSession(worldSource:ArenaWorldDefinition,rulesSource:PinballSessionRules,options:ArenaMatchOptions={}){
 const world=copy(worldSource);validateArenaWorld(world);
 const mode=rulesSource.mode,pvp=['battle-royale','versus','team-versus'].includes(mode);
 if(!['battle-royale','versus','team-versus','roguelike-solo','roguelike-coop'].includes(mode))throw new Error('Invalid session mode');
 if(mode==='battle-royale'&&options.stormEnabled!==undefined&&options.stormEnabled!==false)throw new Error('Battle royale uses global score pressure, not a geographic storm');
 const effectiveOptions: ArenaMatchOptions={...copy(options),...(mode==='battle-royale'?{stormEnabled:false}:{}),mode:pvp?'battle':'expedition',defeatPolicy:'eliminate'};
 let match=createArenaMatch(world,effectiveOptions);
 const players=match.players,owners=new Set(players.map(p=>p.ownerId)),teams=new Map<number,number>();
 const playerByOwner=new Map(players.map(p=>[p.ownerId,p])),sight=createSessionSight(world);
 for(const p of players)teams.set(p.teamId,(teams.get(p.teamId)??0)+1);
 if(mode==='roguelike-solo'&&players.length!==1||mode==='roguelike-coop'&&(players.length>5||teams.size!==1)||mode==='versus'&&[...teams.values()].some(n=>n!==1)||['team-versus','battle-royale'].includes(mode)&&[...teams.values()].some(n=>n>5))throw new Error('Session team/player admission');
 if(pvp&&teams.size<2)throw new Error('Competitive session needs opposing teams');
 const equipment=admitEquipment(rulesSource.equipment??STARTER_EQUIPMENT),catalogue=new Map(equipment.map(item=>[item.id,item]));
 const pressureRules=mode==='battle-royale'?rulesSource.scorePressure===null?null:admitScorePressure(rulesSource.scorePressure??DEFAULT_SCORE_PRESSURE):null;
 if(mode!=='battle-royale'&&rulesSource.scorePressure!=null)throw new Error('Score pressure belongs to battle royale');
 const loadouts=copy(rulesSource.loadouts??players.map(p=>({ownerId:p.ownerId,weapon:null,passive:null,medkits:0})));
 if(loadouts.length!==players.length||new Set(loadouts.map(l=>l.ownerId)).size!==loadouts.length)throw new Error('Complete distinct starting loadouts required');
 const slot=(id:string|null,kind:EquipmentSlot)=>id===null||catalogue.get(id)?.slot===kind;
 for(const l of loadouts)if(!owners.has(l.ownerId)||!slot(l.weapon,'weapon')||!slot(l.passive,'passive')||!integer(l.medkits,0,3)||Object.keys(l).sort().join(',')!=='medkits,ownerId,passive,weapon')throw new Error('Invalid starting loadout');
 const crates=copy(rulesSource.crates??[]),healingPoints=copy(rulesSource.healingPoints??[]),bindingKeys=new Set<string>(),pickupIds=new Set<string>();
 if(crates.length>256||healingPoints.length>64||mode!=='battle-royale'&&crates.length>0)throw new Error('Physical pickup mode/budget');
 const admitPickup=(id:string,admission:PickupAdmission)=>{
  const key=admission.kind+':'+admission.mechanismId;
  if(!textId(id)||pickupIds.has(id)||!admission||Object.keys(admission).sort().join(',')!=='kind,mechanismId'||!['switch','capture'].includes(admission.kind)||!textId(admission.mechanismId)||bindingKeys.has(key)||!world.arenas.some(a=>admission.kind==='switch'?a.switches.some(s=>s.id===admission.mechanismId):(a.captures??[]).some(c=>c.id===admission.mechanismId)))throw new Error('Invalid or ambiguous physical pickup binding');
  pickupIds.add(id);bindingKeys.add(key);
 };
 for(const c of crates){admitPickup(c.id,c.admission);if(Object.keys(c).sort().join(',')!=='admission,id,medkits,pool'||!integer(c.medkits,0,3)||!Array.isArray(c.pool)||c.pool.length<1||c.pool.length>64||new Set(c.pool.map(i=>i.itemId)).size!==c.pool.length||c.pool.some(i=>!catalogue.has(i.itemId)||!integer(i.weight,1,1000000)||Object.keys(i).sort().join(',')!=='itemId,weight'))throw new Error('Invalid crate pool');}
 for(const h of healingPoints){admitPickup(h.id,h.admission);if(Object.keys(h).sort().join(',')!=='admission,amount,cooldownTicks,id'||!integer(h.amount,1,100)||!integer(h.cooldownTicks,120,432000))throw new Error('Invalid healing point');}
 const rolledCrates=crates.map(c=>{const total=c.pool.reduce((n,i)=>n+i.weight,0);let roll=Math.floor(seedTagHash(world.seed,'pinball-session/2026-10-07.1:crate:'+c.id)/4294967296*total);for(const item of c.pool){if(roll<item.weight)return{id:c.id,itemId:item.itemId,claimedBy:null as number|null};roll-=item.weight;}throw new Error('Empty crate roll');});
 const ruleIdentity=digest({revision:PINBALL_SESSION_REVISION,world:world.sha256,options:effectiveOptions,players,equipment,loadouts,crates,healingPoints,pressureRules,mode});
 let inventory:Inventory[]=loadouts.map(l=>({...l,medkitCooldown:0,previousActions:0})).sort((a,b)=>a.ownerId-b.ownerId);
 let pressure:Pressure[]=players.map(p=>({ownerId:p.ownerId,belowSince:null,lastDamageTick:-1})).sort((a,b)=>a.ownerId-b.ownerId),curve:ScoreCurve|null=pressureRules?deriveScoreCurve(match.readFrame().balls,pressureRules):null;
 let pendingDamage:PendingDamage[]=[],pendingHeal:PendingHeal[]=[],serial=0,droppedEvents=0,eventSerial=0,events:SessionRuleEvent[]=[],claimedBy=rolledCrates.map(()=>null as number|null),hitCooldowns:Record<string,number>={},healingTimes:Record<string,number>={};
 const emit=(tick:number,type:SessionRuleEvent['type'],ownerId:number,extra:Omit<SessionRuleEvent,'id'|'tick'|'type'|'ownerId'>={})=>{const event={id:`${tick}:${eventSerial++}:${type}`,tick,type,ownerId,...extra};if(events.length<512){events.push(event);return;}droppedEvents++;if(type!=='equipment-hit'){const low=events.findIndex(e=>e.type==='equipment-hit');if(low>=0)events.splice(low,1,event);}};
 const queueDamage=(ownerId:number,amount:number,sourceOwnerId:number|null,cause:PendingDamage['cause'])=>{const existing=pendingDamage.find(c=>c.ownerId===ownerId&&c.cause===cause);if(existing){existing.amount=Math.min(100,existing.amount+amount);if(existing.sourceOwnerId===null&&sourceOwnerId!==null)existing.sourceOwnerId=sourceOwnerId;}else pendingDamage.push({ownerId,amount,sourceOwnerId,cause,serial:++serial});};
 const queueHeal=(ownerId:number,amount:number)=>{const existing=pendingHeal.find(c=>c.ownerId===ownerId);if(existing)existing.amount=Math.min(100,existing.amount+amount);else pendingHeal.push({ownerId,amount,serial:++serial});};
 function readFrame():PinballSessionFrame {
  const frame=match.readFrame();
  return{schema:'keel-pinball-session-frame@1',revision:PINBALL_SESSION_REVISION,mode,arena:frame,scoreCurve:curve&&{...curve},pressure:pressure.map(p=>({...p,warning:p.belowSince!==null,graceRemaining:p.belowSince===null||!pressureRules?0:Math.max(0,pressureRules.deficitGraceTicks-(frame.tick-p.belowSince))})),inventories:inventory.map(({previousActions,...i})=>({...i})),crates:rolledCrates.map((c,i)=>({...c,claimedBy:claimedBy[i]!})),events:events.map(e=>({...e}))};
 }
 function readHealingPointStates(ownerId:number):readonly HealingPointState[]{
  if(!owners.has(ownerId))throw new Error('Healing point owner absent');
  const frame=match.readFrame(),alive=!frame.balls.find(b=>b.ownerId===ownerId)!.eliminated;
  return Object.freeze(healingPoints.map(point=>{
   const lastClaimTick=healingTimes[`${point.id}:${ownerId}`]??null,remainingTicks=lastClaimTick===null?0:Math.max(0,point.cooldownTicks-(frame.tick-lastClaimTick));
   return Object.freeze({...point,admission:Object.freeze({...point.admission}),lastClaimTick,remainingTicks,available:alive&&remainingTicks===0});
  }));
 }
 function step(inputs:readonly SessionOwnerInput[]=[]):PinballSessionFrame {
  if(!Array.isArray(inputs)||inputs.length>players.length||new Set(inputs.map(i=>i.ownerId)).size!==inputs.length||inputs.some(i=>!owners.has(i.ownerId)||!integer(i.actions??0,0,1)))throw new Error('Invalid session input');
  const accepted=inputs.map(i=>admitArenaInput({ownerId:i.ownerId,bits:i.bits,...(i.steerX===undefined?{}:{steerX:i.steerX}),...(i.steerY===undefined?{}:{steerY:i.steerY})}));
  const previous=match.readFrame();if(previous.phase==='finished')return readFrame();
  const gearAtStart=new Map(inventory.map(i=>[i.ownerId,{weapon:i.weapon,passive:i.passive}]));
  const selectedDamage=players.map(p=>pendingDamage.find(c=>c.ownerId===p.ownerId&&c.cause==='pressure')??pendingDamage.find(c=>c.ownerId===p.ownerId)).filter((c):c is PendingDamage=>c!==undefined),selectedSerials=new Set(selectedDamage.map(c=>c.serial)),damaged=new Set(selectedDamage.map(c=>c.ownerId)),healed=new Set(pendingHeal.filter(c=>!damaged.has(c.ownerId)).map(c=>c.ownerId));
  const commands:ArenaCommand[]=[...selectedDamage.map((c):ArenaCommand=>c.cause==='pressure'?{id:`session:${ruleIdentity.slice(0,16)}:pressure:${c.serial}`,ownerId:c.ownerId,type:'score-pressure',amount:c.amount}:{id:`session:${ruleIdentity.slice(0,16)}:equipment:${c.serial}`,ownerId:c.ownerId,type:'equipment-damage',amount:c.amount,...(c.sourceOwnerId===null?{}:{sourceOwnerId:c.sourceOwnerId})}),...pendingHeal.filter(c=>healed.has(c.ownerId)).map(c=>({id:`session:${ruleIdentity.slice(0,16)}:heal:${c.serial}`,ownerId:c.ownerId,type:'heal' as const,amount:c.amount}))].sort((a,b)=>a.ownerId-b.ownerId);
  const frame=match.step(accepted,commands); // Input/command failure cannot consume equipment or rule state.
  const ballByOwner=new Map(frame.balls.map(b=>[b.ownerId,b])),previousByOwner=new Map(previous.balls.map(b=>[b.ownerId,b])),inventoryByOwner=new Map(inventory.map(i=>[i.ownerId,i])),actionByOwner=new Map(inputs.map(i=>[i.ownerId,i.actions??0]));
  const transitions=new Set(frame.events.filter(e=>e.tick===frame.tick&&['portal','ramp-enter','ramp-exit','fall','capture-enter','capture-release'].includes(e.type)).map(e=>e.ownerId));
  const clearCurrentSight=sight.forFrame(frame),clearPreviousSight=sight.forFrame(previous);
  pendingDamage=pendingDamage.filter(c=>!selectedSerials.has(c.serial));pendingHeal=pendingHeal.filter(c=>!healed.has(c.ownerId));events=[];eventSerial=0;
  for(const i of inventory){i.medkitCooldown=Math.max(0,i.medkitCooldown-1);const action=actionByOwner.get(i.ownerId)??0,pressed=action&~i.previousActions;i.previousActions=action;const ball=ballByOwner.get(i.ownerId)!;
   if((pressed&SessionAction.MEDKIT)&&i.medkits>0&&i.medkitCooldown===0&&!ball.eliminated&&ball.health<(playerByOwner.get(i.ownerId)!.maxHealth??6)){i.medkits--;i.medkitCooldown=120;queueHeal(i.ownerId,2);emit(frame.tick,'medkit',i.ownerId,{amount:2,commandTick:frame.tick+1});}
  }
  for(const event of frame.events.filter(e=>e.tick===frame.tick&&e.ownerId!==undefined).sort((a,b)=>a.ownerId!-b.ownerId!||(a.id<b.id?-1:a.id>b.id?1:0))){
   const inv=inventoryByOwner.get(event.ownerId!)!;if(!inv)continue;
   const admitted=(a:PickupAdmission)=>a.kind==='switch'?event.type==='switch'&&event.colliderId===a.mechanismId:event.type==='capture-enter'&&event.mechanismId===a.mechanismId;
   for(let j=0;j<crates.length;j++){const c=crates[j]!;if(claimedBy[j]!==null||!admitted(c.admission)||ballByOwner.get(inv.ownerId)!.eliminated)continue;claimedBy[j]=inv.ownerId;const item=catalogue.get(rolledCrates[j]!.itemId)!;inv[item.slot]=item.id;inv.medkits=Math.min(3,inv.medkits+c.medkits);emit(frame.tick,'crate-open',inv.ownerId,{mechanismId:c.admission.mechanismId,itemId:item.id});}
   for(const h of healingPoints){const key=`${h.id}:${inv.ownerId}`;if(admitted(h.admission)&&frame.tick-(healingTimes[key]??-432000)>=h.cooldownTicks&&!ballByOwner.get(inv.ownerId)!.eliminated){healingTimes[key]=frame.tick;queueHeal(inv.ownerId,h.amount);emit(frame.tick,'healing-point',inv.ownerId,{mechanismId:h.admission.mechanismId,amount:h.amount,commandTick:frame.tick+1});}}
   if(!pvp||event.type!=='ball-contact'||event.otherOwnerId===undefined)continue;
   for(const [sourceId,targetId]of [[event.ownerId!,event.otherOwnerId],[event.otherOwnerId,event.ownerId!]] as const){const source=ballByOwner.get(sourceId)!,target=ballByOwner.get(targetId)!,item=catalogue.get(gearAtStart.get(sourceId)!.weapon??''),key=`${sourceId}:${targetId}:impact`;
    if(source.eliminated||target.eliminated||source.teamId===target.teamId||!item||item.impactDamage===0||(event.energy??0)<item.minimumSpeed||frame.tick<(hitCooldowns[key]??0))continue;hitCooldowns[key]=frame.tick+item.cooldownTicks;queueDamage(targetId,item.impactDamage,sourceId,'equipment');emit(frame.tick,'equipment-hit',sourceId,{otherOwnerId:targetId,itemId:item.id,amount:item.impactDamage,commandTick:frame.tick+1});
   }
  }
  if(pvp)for(const source of frame.balls){
   const item=catalogue.get(gearAtStart.get(source.ownerId)!.passive??''),oldSource=previousByOwner.get(source.ownerId)!;
   if(!source.active||source.eliminated||source.transport||!oldSource.active||oldSource.arenaId!==source.arenaId||oldSource.layer!==source.layer||Math.abs(oldSource.elevation-source.elevation)>4||Math.hypot(source.vx,source.vy)<(item?.minimumSpeed??99)||!item||item.passingDamage===0||transitions.has(source.ownerId))continue;
   for(const target of frame.balls){const oldTarget=previousByOwner.get(target.ownerId)!,key=`${source.ownerId}:${target.ownerId}:passing`;
    if(source.ownerId===target.ownerId||source.teamId===target.teamId||!target.active||target.eliminated||target.transport||target.arenaId!==source.arenaId||target.layer!==source.layer||oldTarget.arenaId!==target.arenaId||oldTarget.layer!==target.layer||Math.abs(target.elevation-source.elevation)>source.radius+target.radius||Math.abs(oldTarget.elevation-target.elevation)>4||frame.tick<(hitCooldowns[key]??0)||transitions.has(target.ownerId))continue;
    const near=distanceToSegment(0,0,oldSource.x-oldTarget.x,oldSource.y-oldTarget.y,source.x-target.x,source.y-target.y);
    if(near.d2>(item.passingRadius+target.radius)**2)continue;
    const at=(before:ArenaBallFrame,after:ArenaBallFrame)=>({arenaId:after.arenaId,layer:after.layer,x:before.x+(after.x-before.x)*near.t,y:before.y+(after.y-before.y)*near.t,elevation:before.elevation+(after.elevation-before.elevation)*near.t}),nearSource=at(oldSource,source),nearTarget=at(oldTarget,target);
    if(Math.abs(nearSource.elevation-nearTarget.elevation)>source.radius+target.radius||!clearCurrentSight(nearSource,nearTarget)||!clearPreviousSight(nearSource,nearTarget))continue;
    hitCooldowns[key]=frame.tick+item.cooldownTicks;queueDamage(target.ownerId,item.passingDamage,source.ownerId,'equipment');emit(frame.tick,'equipment-hit',source.ownerId,{otherOwnerId:target.ownerId,itemId:item.id,amount:item.passingDamage,commandTick:frame.tick+1});
   }
  }
  if(pressureRules){curve=deriveScoreCurve(frame.balls,pressureRules);for(const p of pressure){const ball=ballByOwner.get(p.ownerId)!,below=frame.phase==='playing'&&!ball.eliminated&&frame.tick>=pressureRules.startGraceTicks&&curve.living>1&&ball.score<curve.cutoff;
    if(!below){if(p.belowSince!==null)emit(frame.tick,'pressure-recovered',p.ownerId);p.belowSince=null;continue;}
    if(p.belowSince===null){p.belowSince=frame.tick;emit(frame.tick,'pressure-warning',p.ownerId);}
    if(frame.tick-p.belowSince>=pressureRules.deficitGraceTicks&&(p.lastDamageTick<0||frame.tick-p.lastDamageTick>=pressureRules.damageIntervalTicks)){p.lastDamageTick=frame.tick+1;queueDamage(p.ownerId,pressureRules.damage,null,'pressure');emit(frame.tick,'pressure-damage',p.ownerId,{amount:pressureRules.damage,commandTick:frame.tick+1});}
   }}
  for(const [key,until]of Object.entries(hitCooldowns))if(until<=frame.tick)delete hitCooldowns[key];
  events=events.map(e=>{if(e.commandTick===undefined)return e;const owner=e.type==='equipment-hit'?e.otherOwnerId!:e.ownerId,waiting=pendingDamage.filter(c=>c.ownerId===owner);return{...e,commandTick:frame.tick+(e.type==='equipment-hit'&&waiting.some(c=>c.cause==='pressure')?2:['medkit','healing-point'].includes(e.type)?waiting.length+1:1)};});
  return readFrame();
 }
 function snapshot():Uint8Array{return encode({schema:'keel-pinball-session-save@1',identity:ruleIdentity,tick:match.readFrame().tick,inventory,pressure,pendingDamage,pendingHeal,serial,droppedEvents,events,claimedBy,hitCooldowns,healingTimes,arena:new TextDecoder().decode(match.snapshot())});}
 function restore(bytes:Uint8Array):void {
  if(!(bytes instanceof Uint8Array)||bytes.byteLength>2500000)throw new Error('Session snapshot bound');
  const d=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  const reject=(ok:unknown)=>{if(!ok)throw new Error('Invalid session snapshot');};
  reject(d&&Object.keys(d).sort().join(',')==='arena,claimedBy,droppedEvents,events,healingTimes,hitCooldowns,identity,inventory,pendingDamage,pendingHeal,pressure,schema,serial,tick'&&d.schema==='keel-pinball-session-save@1'&&d.identity===ruleIdentity&&integer(d.tick,0,432000)&&integer(d.serial,0,43200000)&&integer(d.droppedEvents,0,Number.MAX_SAFE_INTEGER)&&typeof d.arena==='string');
  const candidate=createArenaMatch(world,effectiveOptions);candidate.restore(encode(JSON.parse(d.arena)));const restored=candidate.readFrame();reject(restored.tick===d.tick);
  reject(Array.isArray(d.inventory)&&d.inventory.length===players.length&&Array.isArray(d.pressure)&&d.pressure.length===players.length);
  for(let j=0;j<inventory.length;j++){const i=d.inventory[j],p=d.pressure[j];reject(i&&Object.keys(i).sort().join(',')==='medkitCooldown,medkits,ownerId,passive,previousActions,weapon'&&i.ownerId===inventory[j]!.ownerId&&slot(i.weapon,'weapon')&&slot(i.passive,'passive')&&integer(i.medkits,0,3)&&integer(i.medkitCooldown,0,120)&&integer(i.previousActions,0,1));reject(p&&Object.keys(p).sort().join(',')==='belowSince,lastDamageTick,ownerId'&&p.ownerId===pressure[j]!.ownerId&&(p.belowSince===null||pressureRules&&integer(p.belowSince,pressureRules.startGraceTicks,d.tick))&&integer(p.lastDamageTick,-1,d.tick+1)&&(pressureRules!==null||p.belowSince===null&&p.lastDamageTick===-1));}
  const serials=new Set<number>();
  reject(Array.isArray(d.pendingDamage)&&d.pendingDamage.length<=players.length*2&&Array.isArray(d.pendingHeal)&&d.pendingHeal.length<=players.length);
  for(const [kind,queue]of [['damage',d.pendingDamage],['heal',d.pendingHeal]] as const){const ownerSet=new Set<string>();for(const c of queue){const key=kind==='damage'?`${c.ownerId}:${c.cause}`:String(c.ownerId);reject(c&&owners.has(c.ownerId)&&!ownerSet.has(key)&&integer(c.amount,1,100)&&integer(c.serial,1,d.serial)&&!serials.has(c.serial));ownerSet.add(key);serials.add(c.serial);reject(kind==='damage'?Object.keys(c).sort().join(',')==='amount,cause,ownerId,serial,sourceOwnerId'&&['pressure','equipment'].includes(c.cause)&&(c.sourceOwnerId===null||owners.has(c.sourceOwnerId))&&(c.cause==='pressure'?pressureRules!==null&&c.sourceOwnerId===null&&c.amount===pressureRules.damage&&d.pressure.find((p:Pressure)=>p.ownerId===c.ownerId)?.lastDamageTick===d.tick+1&&d.pressure.find((p:Pressure)=>p.ownerId===c.ownerId)?.belowSince!==null&&d.tick-d.pressure.find((p:Pressure)=>p.ownerId===c.ownerId)!.belowSince>=pressureRules.deficitGraceTicks&&restored.phase==='playing'&&!restored.balls.find(b=>b.ownerId===c.ownerId)!.eliminated&&deriveScoreCurve(restored.balls,pressureRules).cutoff>restored.balls.find(b=>b.ownerId===c.ownerId)!.score:pvp):Object.keys(c).sort().join(',')==='amount,ownerId,serial');}}
  reject(Array.isArray(d.claimedBy)&&d.claimedBy.length===crates.length&&d.claimedBy.every((id:unknown)=>id===null||typeof id==='number'&&owners.has(id))&&d.hitCooldowns&&typeof d.hitCooldowns==='object'&&!Array.isArray(d.hitCooldowns)&&Object.keys(d.hitCooldowns).length<=19800&&d.healingTimes&&typeof d.healingTimes==='object'&&!Array.isArray(d.healingTimes)&&Object.keys(d.healingTimes).length<=6400);
  for(const [key,until]of Object.entries(d.hitCooldowns)){const m=/^(\d+):(\d+):(impact|passing)$/.exec(key);reject(m&&owners.has(Number(m[1]))&&owners.has(Number(m[2]))&&m[1]!==m[2]&&integer(until,d.tick+1,d.tick+12000));}
  for(const [key,tick]of Object.entries(d.healingTimes))reject(healingPoints.some(h=>players.some(p=>key===`${h.id}:${p.ownerId}`))&&integer(tick,1,d.tick));
  reject(Array.isArray(d.events)&&d.events.length<=512&&new Set(d.events.map((e:SessionRuleEvent)=>e.id)).size===d.events.length);
  for(const e of d.events)reject(e&&typeof e.id==='string'&&e.id.length<=100&&e.tick===d.tick&&owners.has(e.ownerId)&&['pressure-warning','pressure-recovered','pressure-damage','crate-open','healing-point','medkit','equipment-hit'].includes(e.type)&&(e.otherOwnerId===undefined||owners.has(e.otherOwnerId))&&(e.itemId===undefined||catalogue.has(e.itemId))&&(e.mechanismId===undefined||[...crates,...healingPoints].some(p=>p.admission.mechanismId===e.mechanismId))&&(e.amount===undefined||integer(e.amount,1,100))&&(e.commandTick===undefined||integer(e.commandTick,d.tick+1,d.tick+3)));
  match=candidate;inventory=copy(d.inventory);pressure=copy(d.pressure);pendingDamage=copy(d.pendingDamage);pendingHeal=copy(d.pendingHeal);serial=d.serial;droppedEvents=d.droppedEvents;events=copy(d.events);claimedBy=copy(d.claimedBy);hitCooldowns=copy(d.hitCooldowns);healingTimes=copy(d.healingTimes);curve=pressureRules?deriveScoreCurve(restored.balls,pressureRules):null;
 }
 return{step,readFrame,readHealingPointStates,snapshot,restore,get identity(){return ruleIdentity;},getStats:()=>({...match.getStats(),pendingDamage:pendingDamage.length,pendingHeal:pendingHeal.length,droppedRuleEvents:droppedEvents,equipmentCooldowns:Object.keys(hitCooldowns).length,healingRecords:Object.keys(healingTimes).length})};
}
export type PinballSession=ReturnType<typeof createPinballSession>;
