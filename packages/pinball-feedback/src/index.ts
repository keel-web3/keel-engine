export {manifest} from './module.ts';
export {pinballFeedbackMix} from './spatial.ts';
export type {PinballFeedbackMix} from './spatial.ts';
import {dcos,dsin} from '@keel-engine/core';
import {arenaCaptureBindings,arenaMechanismSpecs,validateArenaWorld} from '@keel-engine/pinball-arena';
import type {ArenaWorldDefinition,ArenaFrame,ArenaEvent,ArenaMechanismFrame,ArenaTransportFrame,ArenaBallFrame,ArenaRamp} from '@keel-engine/pinball-arena';
import type {PinballSoundName} from '@keel-engine/audio';

export const PINBALL_FEEDBACK_REVISION='pinball-feedback/2026-10-08.4';
type Position={readonly arenaId:string;readonly x:number;readonly y:number;readonly layer:number;readonly elevation:number};
type Kind='spark'|'ring'|'mist'|'charge';
export interface PinballFeedbackOptions {readonly seed?:string;readonly maxParticles?:number;readonly maxPulses?:number;readonly reducedMotion?:boolean}
export interface PinballMechanismPose extends Position {
 readonly id:string;readonly kind:ArenaMechanismFrame['kind'];readonly recoil:number;readonly pulse:number;
 readonly charge:number;readonly transportPhase:ArenaTransportFrame['phase']|null;readonly transportProgress:number;
}
export interface PinballFeedbackParticle extends Position {readonly id:string;readonly kind:Kind;readonly age:number;readonly alpha:number;readonly size:number;readonly ownerId:number|null}
export interface PinballFeedbackPulse extends Position {readonly id:string;readonly kind:Kind;readonly alpha:number;readonly radius:number;readonly ownerId:number|null}
export interface PinballFeedbackSound extends Position {readonly id:string;readonly name:PinballSoundName;readonly gain:number;readonly priority:number;readonly ownerId:number|null}
export interface PinballBladeImpactPose {readonly id:string;readonly arenaId:string;readonly pulse:number}
export interface PinballFeedbackSample {readonly tick:number;readonly mechanisms:readonly PinballMechanismPose[];readonly particles:readonly PinballFeedbackParticle[];readonly pulses:readonly PinballFeedbackPulse[];readonly bladeImpacts?:readonly PinballBladeImpactPose[]}
interface Burst extends Position {id:string;kind:Kind;tick:number;duration:number;size:number;ownerId:number|null;vx:number;vy:number;vz:number}
interface Pulse extends Position {id:string;kind:Kind;tick:number;duration:number;radius:number;ownerId:number|null}
const integer=(value:number,min:number,max:number)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));
const hash=(value:string)=>{let n=2166136261;for(let i=0;i<value.length;i++)n=Math.imul(n^value.charCodeAt(i),16777619);return n>>>0;};
const random=(seed:number)=>{let n=seed||1;return()=>{n^=n<<13;n^=n>>>17;n^=n<<5;return(n>>>0)/4294967296;};};
function rampCue(r:ArenaRamp,arenaId:string,event:ArenaEvent,body:ArenaBallFrame|undefined,old:ArenaBallFrame|undefined,relocated:boolean):Position|undefined{
 if(event.arenaId!==undefined&&event.arenaId!==arenaId)return undefined;
 const dx=r.bx-r.ax,dy=r.by-r.ay,den=dx*dx+dy*dy;
 const progress=(b:{x:number;y:number})=>den?clamp(((b.x-r.ax)*dx+(b.y-r.ay)*dy)/den):0;
 const near=(b:ArenaBallFrame|undefined):b is ArenaBallFrame=>{
  if(!b||b.arenaId!==arenaId||b.transport||![r.fromLayer,r.toLayer].includes(b.layer)||b.elevation<Math.min(r.fromElevation,r.toElevation)-b.radius-4||b.elevation>Math.max(r.fromElevation,r.toElevation)+b.radius+4)return false;
  const t=progress(b);return Math.hypot(b.x-r.ax-dx*t,b.y-r.ay-dy*t)<=r.width/2+b.radius+18;
 };
 // A later native portal/fall/capture in this tick can relocate the final
 // body, even into this same ramp's plan view on a different floor.
 const nativeBody=!relocated&&near(body)?body:undefined,previous=near(old)?old:undefined;
 let end:boolean|undefined;
 if(event.x!==undefined&&event.y!==undefined&&event.elevation!==undefined&&[event.x,event.y,event.elevation].every(Number.isFinite)){
  const da=(event.x-r.ax)**2+(event.y-r.ay)**2+(event.elevation-r.fromElevation)**2,db=(event.x-r.bx)**2+(event.y-r.by)**2+(event.elevation-r.toElevation)**2;
  if(da!==db)end=db<da;
 }
 if(end===undefined&&event.layer!==undefined&&r.fromLayer!==r.toLayer&&[r.fromLayer,r.toLayer].includes(event.layer))end=event.layer===r.toLayer;
 if(end===undefined){
  const motion=previous??nativeBody,dot=motion?motion.vx*dx+motion.vy*dy:0;
  if(event.type==='ramp-abort'&&motion)end=progress(motion)>=.5;
  else if(dot!==0)end=event.type==='ramp-enter'?dot<0:dot>0;
 }
 if(!nativeBody&&end===undefined)return undefined;
 const anchor=nativeBody??{x:end?r.bx:r.ax,y:end?r.by:r.ay,layer:end?r.toLayer:r.fromLayer,elevation:end?r.toElevation:r.fromElevation};
 const position={arenaId,x:event.x??anchor.x,y:event.y??anchor.y,layer:event.layer??anchor.layer,elevation:event.elevation??anchor.elevation};
 return [position.x,position.y,position.elevation].every(Number.isFinite)&&integer(position.layer,0,3)?position:undefined;
}
const soundForEvent=(event:ArenaEvent,kind?:string):PinballSoundName|undefined=>{
 switch(event.type){
  case 'launch':return 'spring.release';case 'bumper':return kind==='spring'?'slingshot.snap':'bumper.pop';
  case 'rail':case 'flipper':return 'rail.ting';case 'switch':return 'target.hit';case 'gate':return 'gate.close';
  case 'ramp-enter':return 'ramp.enter';case 'ramp-exit':return 'ramp.exit';case 'portal':return 'portal.exit';
  case 'capture-enter':return kind==='scoop'?'scoop.capture':kind==='portal'?'portal.enter':'lock.capture';
  case 'transit-start':return 'capture.travel';case 'exit-blocked':return 'capture.blocked';
  case 'capture-release':return kind==='scoop'?'scoop.eject':kind==='portal'?'portal.exit':'lock.release';
  case 'drain':case 'escape':return 'drain';case 'route-complete':return 'route.complete';
  case 'ability':return event.ability==='dash'?'skill.dash':event.ability==='shield'?'skill.shield':'skill.pulse';
  case 'damage':return 'damage';default:return undefined;
 }
};

/** This service changes presentation only. Mechanism recoil is normalized for
 * the renderer to constrain inside the descriptor's housing. Gates/flippers
 * must keep the actual admitted collision pose; no visual force is invented. */
export function createPinballFeedback(world:ArenaWorldDefinition,options:PinballFeedbackOptions={}){
 validateArenaWorld(world);
 const seed=options.seed??world.seed,particleCap=options.maxParticles??256,pulseCap=options.maxPulses??64;
 if(typeof seed!=='string'||seed.length<1||seed.length>256||!integer(particleCap,0,2048)||!integer(pulseCap,0,512))throw new Error('Pinball feedback budget');
 const specs=arenaMechanismSpecs(world),bindings=arenaCaptureBindings(world),bindingById=new Map(bindings.map(b=>[b.item.id,b])),positions=new Map<string,Position>(),captureKinds=new Map(bindings.map(b=>[b.item.id,b.item.kind]));
 const flipperSpecs=new Map(world.arenas.flatMap(a=>a.flippers.map(f=>[f.id,f] as const))),ramps=new Map(world.arenas.flatMap(a=>a.ramps.map(r=>[r.id,{arenaId:a.id,item:r}] as const)));
 for(const a of world.arenas){
  for(const b of a.bumpers)positions.set(b.id,{arenaId:a.id,x:b.x,y:b.y,layer:b.layer,elevation:b.elevation});
  for(const s of a.stations)positions.set(s.id,{arenaId:a.id,x:s.launchX,y:s.launchY,layer:s.layer,elevation:s.elevation});
  for(const s of a.switches)positions.set(s.id,{arenaId:a.id,x:s.x,y:s.y,layer:s.layer,elevation:s.elevation});
  for(const g of a.gates)positions.set(g.id,{arenaId:a.id,x:(g.ax+g.bx)/2,y:(g.ay+g.by)/2,layer:g.layer,elevation:g.elevation});
 }
 for(const b of bindings)positions.set(b.item.id,{arenaId:b.arenaId,x:b.entry.x,y:b.entry.y,layer:b.entry.layer,elevation:b.entry.elevation});
 const serials=new Map<string,number>(),seen=new Map<string,number>(),bladeMotion=new Map<string,{angle:number;direction:number}>(),gateOpen=new Map<string,boolean>();
 const bladeImpacts=new Map<string,{tick:number;intensity:number;arenaId:string}>();
 let current:ArenaFrame|undefined,lastTick=-1,particles:Burst[]=[],pulses:Pulse[]=[],droppedParticles=0,droppedPulses=0,evictedEvents=0;
 let transports=new Map<string,ArenaTransportFrame>();
 function burst(id:string,tick:number,position:Position,kind:Kind,intensity:number,ownerId:number|null){
  const rng=random(hash(seed+'|'+id)),count=options.reducedMotion?0:Math.ceil(2+intensity*6),duration=kind==='mist'?48:28;
  for(let i=0;i<count;i++){
   if(particles.length>=particleCap){droppedParticles++;break;}
   const angle=rng()*Math.PI*2,speed=(.4+rng()*1.3)*(kind==='mist'?.45:1);
   particles.push({...position,id:id+':'+i,kind,tick,duration,size:1.2+rng()*1.6,ownerId,vx:dcos(angle)*speed,vy:dsin(angle)*speed,vz:.1+rng()*.3});
  }
  if(pulses.length>=pulseCap){droppedPulses++;return;}
  pulses.push({...position,id,kind,tick,duration:options.reducedMotion?12:24,radius:8+intensity*22,ownerId});
 }
 function update(frame:ArenaFrame):readonly PinballFeedbackSound[]{
  if(frame.schema!=='keel-pinball-arena-frame@2'||!integer(frame.tick,0,432000)||frame.tick<lastTick||frame.mechanisms.length!==specs.length||frame.mechanisms.some((m,i)=>m.id!==specs[i]!.id||m.kind!==specs[i]!.kind||m.arenaId!==specs[i]!.arenaId||m.durationTicks!==specs[i]!.durationTicks||!integer(m.activationSerial,0,frame.tick)||!integer(m.activationTick,0,frame.tick)||!integer(m.intensity,0,1024))||frame.events.length>4096||frame.balls.length>128||frame.flippers.length!==flipperSpecs.size||new Set(frame.flippers.map(f=>f.id)).size!==flipperSpecs.size||frame.flippers.some(f=>!flipperSpecs.has(f.id)||!Number.isFinite(f.angle)))throw new Error('Pinball feedback frame admission');
  const first=current===undefined,sounds:PinballFeedbackSound[]=[],sounded=new Set<string>(),ownerForMechanism=new Map(frame.events.filter(e=>e.type==='mechanism-actuate'&&e.mechanismId).map(e=>[e.mechanismId!,e.ownerId??null])),bodies=new Map(frame.balls.map(b=>[b.ownerId,b])),mechanisms=new Map(frame.mechanisms.map(m=>[m.id,m]));
  // Contact origins are keyed to this exact native activation. A missing or
  // malformed contact must not be replaced by a current ball pose or a guessed
  // point on the mechanism. The first valid native contact wins deterministically.
  const contacts=new Map<string,Position|undefined>();
  for(const event of frame.events){
   if(event.type!=='bumper'&&event.type!=='rail')continue;
   const id=event.colliderId??event.mechanismId,m=id?mechanisms.get(id):undefined;
   if(!m||event.tick!==m.activationTick)continue;
   if(!contacts.has(m.id))contacts.set(m.id,undefined);
   const center=positions.get(m.id)!;
   if(contacts.get(m.id)||event.arenaId!==m.arenaId||event.colliderId!==undefined&&event.colliderId!==m.id||event.mechanismId!==undefined&&event.mechanismId!==m.id||event.x===undefined||event.y===undefined||event.elevation===undefined||![event.x,event.y,event.elevation].every(Number.isFinite)||event.layer!==undefined&&event.layer!==center.layer)continue;
   contacts.set(m.id,{arenaId:event.arenaId,x:event.x,y:event.y,layer:center.layer,elevation:event.elevation});
  }
  const relocated=new Set(frame.events.filter(e=>e.tick===frame.tick&&['portal','fall','drain','escape','capture-enter','capture-release'].includes(e.type)).map(e=>e.ownerId));
  particles=particles.filter(p=>frame.tick-p.tick<p.duration);pulses=pulses.filter(p=>frame.tick-p.tick<p.duration);
  for(const [id,tick]of seen)if(frame.tick-tick>120)seen.delete(id);
  const focusPosition=(event:ArenaEvent):Position|undefined=>{
   const binding=bindingById.get(event.mechanismId??''),body=event.ownerId===undefined?undefined:bodies.get(event.ownerId),ramp=ramps.get(event.colliderId??'');
   if(ramp&&['ramp-enter','ramp-exit','ramp-abort'].includes(event.type)){
    const old=current?.tick===event.tick-1?current.balls.find(b=>b.ownerId===event.ownerId):undefined;
    return rampCue(ramp.item,ramp.arenaId,event,frame.tick===event.tick?body:undefined,old,relocated.has(event.ownerId));
   }
   const anchor=positions.get(event.mechanismId??event.colliderId??'')??body;
   const port=binding&&event.type==='capture-release'?(event.exitPortId===binding.item.fallbackExitPortId?binding.fallback:binding.exit):undefined;
   if(port)return{arenaId:binding!.item.exitArenaId,x:port.x,y:port.y,layer:port.layer,elevation:port.elevation};
   if(event.arenaId===undefined&&!anchor)return undefined;
   return{arenaId:event.arenaId??anchor!.arenaId,x:event.x??anchor?.x??0,y:event.y??anchor?.y??0,layer:event.layer??anchor?.layer??0,elevation:event.elevation??anchor?.elevation??0};
  };
  for(const event of frame.events){
   if(seen.has(event.id)||event.tick>frame.tick||frame.tick-event.tick>120)continue;
   if(seen.size>=8192){seen.delete(seen.keys().next().value!);evictedEvents++;}seen.set(event.id,event.tick);
   if(first&&frame.tick>0)continue;
   const position=focusPosition(event),mechanism=mechanisms.get(event.mechanismId??event.colliderId??''),kind=captureKinds.get(event.mechanismId??'')??mechanism?.kind,name=soundForEvent(event,kind);
   if(!position)continue;
   if(name){sounds.push({...position,id:event.id,name,gain:clamp((event.energy??9)/18,.3,1),priority:name==='rail.ting'?0:['capture-enter','capture-release','exit-blocked','route-complete','drain'].includes(event.type)?3:event.type==='transit-start'?2:1,ownerId:event.ownerId??null});if(mechanism)sounded.add(mechanism.id);}
   if(event.type==='flipper'&&event.colliderId&&flipperSpecs.has(event.colliderId)&&event.tick===frame.tick&&event.x!==undefined&&event.y!==undefined&&event.elevation!==undefined&&[event.x,event.y,event.elevation].every(Number.isFinite)){
    const blade=frame.flippers.find(f=>f.id===event.colliderId);
    if(blade&&event.arenaId===blade.arenaId){
     const intensity=clamp((event.energy??9)/18,.25,1);
     bladeImpacts.set(blade.id,{tick:event.tick,intensity,arenaId:blade.arenaId});
     burst(event.id,event.tick,position,'spark',intensity*.45,event.ownerId??null);
    }
   }
   if(['capture-enter','capture-release','transit-start','exit-blocked','ability','drain','route-complete'].includes(event.type))burst(event.id,event.tick,position,event.type.startsWith('capture')?'mist':event.type==='ability'||event.type==='transit-start'?'charge':'ring',event.type==='transit-start'?.35:event.type==='exit-blocked'?.5:1,event.ownerId??null);
   if(event.type==='ramp-enter'||event.type==='ramp-exit')burst(event.id,event.tick,position,event.type==='ramp-enter'?'spark':'ring',.2,event.ownerId??null);
  }
  for(const m of frame.mechanisms){
   const previous=serials.get(m.id)??0;serials.set(m.id,m.activationSerial);
   if(first||m.activationSerial<=previous||frame.tick-m.activationTick>=m.durationTicks)continue;
   const position=positions.get(m.id)!;
   const impact=contacts.get(m.id),burstPosition=impact??(!contacts.has(m.id)&&m.kind!=='spring'&&m.kind!=='bumper'?position:undefined);
   if(burstPosition)burst(m.id+':'+m.activationSerial,m.activationTick,burstPosition,m.kind==='lock'?'mist':'spark',m.intensity/1024,ownerForMechanism.get(m.id)??null);
   if(!sounded.has(m.id)&&m.kind!=='lock')sounds.push({...position,id:m.id+':'+m.activationSerial,name:m.kind==='plunger'?'spring.release':m.kind==='spring'?'slingshot.snap':m.kind==='bumper'?'bumper.pop':m.kind==='gate'?'gate.close':'target.hit',gain:clamp(m.intensity/1024,.3,1),priority:1,ownerId:ownerForMechanism.get(m.id)??null});
  }
  if(frame.tick!==lastTick)for(const f of frame.flippers){
   const previous=bladeMotion.get(f.id),spec=flipperSpecs.get(f.id);if(!spec)throw new Error('Pinball feedback flipper identity');
   const direction=previous?Math.sign((f.angle-previous.angle)*(spec.activeAngle-spec.restAngle)):0;
   if(previous&&direction!==0&&direction!==previous.direction)sounds.push({id:f.id+':'+frame.tick,name:direction>0?'flipper.up':'flipper.down',arenaId:f.arenaId,x:f.pivotX,y:f.pivotY,layer:f.layer,elevation:f.elevation,gain:.55,priority:2,ownerId:f.ownerId<0?null:f.ownerId});
   bladeMotion.set(f.id,{angle:f.angle,direction});
  }
  for(const g of frame.gates){
   if(gateOpen.get(g.id)===false&&g.open){const position=positions.get(g.id);if(position)sounds.push({...position,id:g.id+':open:'+frame.tick,name:'gate.open',gain:.65,priority:2,ownerId:null});}
   gateOpen.set(g.id,g.open);
  }
  if(frame.tick!==lastTick&&frame.tick%12===0)for(const b of frame.balls)if(b.active&&b.rampId!==null)sounds.push({id:b.id+':roll:'+frame.tick,name:'ramp.roll',arenaId:b.arenaId,x:b.x,y:b.y,layer:b.layer,elevation:b.elevation,gain:clamp(Math.hypot(b.vx,b.vy)/18,.1,.5),priority:0,ownerId:b.ownerId});
  transports=new Map(frame.balls.filter(b=>b.transport!==null).map(b=>[b.transport!.mechanismId,b.transport!]));current=frame;lastTick=frame.tick;return Object.freeze(sounds.map(sound=>Object.freeze(sound)));
 }
 function sample(tick=lastTick,alpha=0):PinballFeedbackSample{
  if(!current||tick!==lastTick||!Number.isFinite(alpha)||alpha<0||alpha>=1)throw new Error('Pinball feedback sample timing');
  const now=tick+alpha;
  const mechanisms=current.mechanisms.map(m=>{
   const u=clamp((now-m.activationTick)/m.durationTicks),intensity=m.activationSerial===0?0:m.intensity/1024,transport=transports.get(m.id)??null,binding=bindingById.get(m.id);
   const captureDuration=binding?.item.release.kind==='qualification'?binding.item.release.maxHoldTicks:binding?.item.captureTicks??1;
   const duration=transport?.phase==='captured'?captureDuration:transport?.phase==='transit'?binding?.item.travelTicks??1:binding?.item.maxExitWaitTicks??1;
   return Object.freeze({...positions.get(m.id)!,id:m.id,kind:m.kind,recoil:options.reducedMotion?0:intensity*(1-u)*Math.exp(-6*u)*(.65+.35*Math.cos(6*Math.PI*u)),pulse:intensity*(1-u),charge:transport?.phase==='captured'?clamp((now-transport.entryTick)/captureDuration):0,transportPhase:transport?.phase??null,transportProgress:transport?clamp((now-transport.phaseTick)/Math.max(1,duration)):0});
  });
  const impacts=[...bladeImpacts].filter(([,v])=>now-v.tick<18).map(([id,v])=>Object.freeze({id,arenaId:v.arenaId,pulse:options.reducedMotion?0:v.intensity*(1-(now-v.tick)/18)}));
  return Object.freeze({tick:now,mechanisms:Object.freeze(mechanisms),bladeImpacts:Object.freeze(impacts),particles:Object.freeze(particles.filter(p=>now-p.tick<p.duration).map(p=>{const age=now-p.tick;return Object.freeze({id:p.id,kind:p.kind,arenaId:p.arenaId,x:p.x+p.vx*age,y:p.y+p.vy*age,layer:p.layer,elevation:p.elevation+Math.max(0,p.vz*age-.005*age*age),age,alpha:(1-age/p.duration)**2,size:p.size,ownerId:p.ownerId});})),pulses:Object.freeze(pulses.filter(p=>now-p.tick<p.duration).map(p=>{const age=now-p.tick;return Object.freeze({id:p.id,kind:p.kind,arenaId:p.arenaId,x:p.x,y:p.y,layer:p.layer,elevation:p.elevation,alpha:1-age/p.duration,radius:p.radius*(.4+.6*age/p.duration),ownerId:p.ownerId});}))});
 }
 return {update,sample,reset(){current=undefined;lastTick=-1;serials.clear();seen.clear();bladeMotion.clear();bladeImpacts.clear();gateOpen.clear();transports.clear();particles=[];pulses=[];droppedParticles=0;droppedPulses=0;evictedEvents=0;},get stats(){return Object.freeze({particles:particles.length,pulses:pulses.length,droppedParticles,droppedPulses,evictedEvents,eventHistory:seen.size,mechanisms:specs.length});}};
}
