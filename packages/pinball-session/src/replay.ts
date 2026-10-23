import {admitArenaInput,ARENA_AUTHORITY_REVISION,ARENA_KERNEL_SHA256,ARENA_HZ} from '@keel-engine/pinball-arena';
import type {ArenaWorldDefinition,ArenaMatchOptions} from '@keel-engine/pinball-arena';
import {sha256,toHex} from '@keel-engine/codec/hash';
import {createPinballSession,PINBALL_SESSION_REVISION} from './index.ts';
import type {PinballSession,PinballSessionRules,SessionOwnerInput} from './index.ts';

const MAGIC=0x3153504b,MAX_TICKS=ARENA_HZ*180,MAX_FILE=24*1024*1024,MAX_HEADER=8*1024*1024,MAX_SNAPSHOT=2500000;
const utf8=new TextEncoder(),text=new TextDecoder('utf-8',{fatal:true});
const hash=(bytes:Uint8Array)=>toHex(sha256(bytes));
const integer=(n:unknown,lo:number,hi:number):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=lo&&n<=hi;
const demand=(ok:unknown,label:string):void=>{if(!ok)throw new Error('Invalid pinball session replay: '+label);};
const copy=<T>(value:T):T=>structuredClone(value);

export interface SessionReplayDescriptor {
 readonly world:ArenaWorldDefinition;
 readonly rules:PinballSessionRules;
 readonly options?:ArenaMatchOptions;
}
export interface SessionReplayTape {
 readonly schema:'keel-pinball-session-replay@1';
 readonly kernel:string;readonly authority:string;readonly revision:string;readonly identity:string;
 readonly descriptor:SessionReplayDescriptor;readonly ownerIds:readonly number[];
 readonly startTick:number;readonly ticks:number;readonly recentSegment:boolean;
 readonly initialSnapshot:Uint8Array;readonly inputs:Uint8Array;readonly finalDigest:string;
}

/** Records only admitted owner controls. Loot, health, score pressure and
 * equipment effects are recomputed by the same private session authority.
 * The caller gives this recorder exclusive ownership of session stepping. */
export function createSessionReplayRecorder(session:PinballSession,source:SessionReplayDescriptor,maxTicks=MAX_TICKS){
 demand(integer(maxTicks,1,MAX_TICKS),'journal duration');
 const descriptor=copy(source),probe=createPinballSession(descriptor.world,descriptor.rules,descriptor.options);
 demand(probe.identity===session.identity,'session descriptor identity');
 let baseline=session.snapshot(),startTick=session.readFrame().arena.tick,ticks=0,recentSegment=startTick>0;
 probe.restore(baseline);
 const ownerIds=probe.readFrame().inventories.map(i=>i.ownerId),owners=new Set(ownerIds),stride=ownerIds.length*4;
 const inputs=new Uint8Array(maxTicks*stride);
 const metadata={schema:'keel-pinball-session-replay@1' as const,kernel:ARENA_KERNEL_SHA256,authority:ARENA_AUTHORITY_REVISION,revision:PINBALL_SESSION_REVISION,identity:session.identity,descriptor,ownerIds};
 demand(utf8.encode(JSON.stringify({...metadata,startTick:ARENA_HZ*3600,ticks:MAX_TICKS,recentSegment:true,finalDigest:'0'.repeat(64)})).length<=MAX_HEADER,'world/rule metadata cap');
 function step(proposed:readonly SessionOwnerInput[]=[]){
  demand(Array.isArray(proposed)&&proposed.length<=owners.size,'input roster');
  const accepted=proposed.map(input=>{
   demand(input&&integer(input.actions??0,0,1),'action bits');
   return{...admitArenaInput(input),actions:input.actions??0};
  }),byOwner=new Map(accepted.map(i=>[i.ownerId,i]));
  demand(byOwner.size===accepted.length&&accepted.every(i=>owners.has(i.ownerId)),'owner admission');
  const before=session.readFrame().arena.tick;
  demand(before===startTick+ticks,'exclusive journal ownership');
  const full=ticks===maxTicks,newBaseline=full?session.snapshot():undefined;
  const frame=session.step(accepted);
  if(frame.arena.tick===before)return frame;
  demand(frame.arena.tick===before+1,'tick progression');
  if(full){baseline=newBaseline!;startTick=before;ticks=0;recentSegment=true;}
  const offset=ticks*stride;
  for(const [i,ownerId]of ownerIds.entries()){
   const input=byOwner.get(ownerId),at=offset+i*4;
   inputs[at]=input?.bits??0;inputs[at+1]=Math.round((input?.steerX??0)*127)&255;inputs[at+2]=Math.round((input?.steerY??0)*127)&255;inputs[at+3]=input?.actions??0;
  }
  ticks++;return frame;
 }
 function exportTape():SessionReplayTape {
  demand(session.readFrame().arena.tick===startTick+ticks,'exclusive journal ownership');
  return{...copy(metadata),startTick,ticks,recentSegment,initialSnapshot:baseline.slice(),inputs:inputs.slice(0,ticks*stride),finalDigest:hash(session.snapshot())};
 }
 return{step,exportTape,get ticks(){return ticks;},get recentSegment(){return recentSegment;}};
}

function validateTape(tape:SessionReplayTape){
 demand(tape&&Object.keys(tape).sort().join(',')==='authority,descriptor,finalDigest,identity,initialSnapshot,inputs,kernel,ownerIds,recentSegment,revision,schema,startTick,ticks','tape fields');
 demand(tape.schema==='keel-pinball-session-replay@1'&&tape.kernel===ARENA_KERNEL_SHA256&&tape.authority===ARENA_AUTHORITY_REVISION&&tape.revision===PINBALL_SESSION_REVISION,'authority identity');
 demand(typeof tape.identity==='string'&&/^[0-9a-f]{64}$/.test(tape.identity)&&typeof tape.finalDigest==='string'&&/^[0-9a-f]{64}$/.test(tape.finalDigest),'state identity');
 demand(tape.descriptor&&typeof tape.descriptor==='object'&&!Array.isArray(tape.descriptor)&&['rules,world','options,rules,world'].includes(Object.keys(tape.descriptor).sort().join(',')),'descriptor fields');
 demand(Array.isArray(tape.ownerIds)&&integer(tape.ownerIds.length,1,100)&&tape.ownerIds.every((id,i)=>integer(id,0,99)&&(i===0||id>tape.ownerIds[i-1]!)),'owner roster');
 demand(integer(tape.startTick,0,ARENA_HZ*3600)&&integer(tape.ticks,0,MAX_TICKS)&&tape.startTick+tape.ticks<=ARENA_HZ*3600&&typeof tape.recentSegment==='boolean'&&(tape.startTick===0||tape.recentSegment),'duration');
 demand(tape.initialSnapshot instanceof Uint8Array&&tape.initialSnapshot.length<=MAX_SNAPSHOT&&tape.inputs instanceof Uint8Array&&tape.inputs.length===tape.ticks*tape.ownerIds.length*4,'byte lengths');
 const{initialSnapshot:_snapshot,inputs:_inputs,...metadata}=tape;
 demand(utf8.encode(JSON.stringify(metadata)).length<=MAX_HEADER,'metadata cap');
 for(let at=0;at<tape.inputs.length;at+=4)demand(tape.inputs[at]!<=63&&tape.inputs[at+1]!==128&&tape.inputs[at+2]!==128&&tape.inputs[at+3]!<=1,'admitted controls');
}

/** Playback constructs a separate complete rules authority. It never restores
 * a live session, injects recorded damage or trusts recorded pickup events. */
export function createSessionReplayPlayer(candidate:SessionReplayTape){
 validateTape(candidate);const tape=copy(candidate);
 const session=createPinballSession(tape.descriptor.world,tape.descriptor.rules,tape.descriptor.options);
 demand(session.identity===tape.identity&&JSON.stringify(session.readFrame().inventories.map(i=>i.ownerId))===JSON.stringify(tape.ownerIds),'rules/roster identity');
 session.restore(tape.initialSnapshot);demand(session.readFrame().arena.tick===tape.startTick,'initial tick');
 let index=0,verified=false;
 function verify(){if(index===tape.ticks&&!verified){demand(hash(session.snapshot())===tape.finalDigest,'final session snapshot');verified=true;}}
 function step(){
  if(index===tape.ticks){verify();return session.readFrame();}
  const offset=index*tape.ownerIds.length*4;
  const inputs=tape.ownerIds.map((ownerId,i)=>({ownerId,bits:tape.inputs[offset+i*4]!,steerX:((tape.inputs[offset+i*4+1]!<<24)>>24)/127,steerY:((tape.inputs[offset+i*4+2]!<<24)>>24)/127,actions:tape.inputs[offset+i*4+3]!}));
  const frame=session.step(inputs);demand(frame.arena.tick===tape.startTick+index+1,'tick progression');index++;verify();return frame;
 }
 verify();return{step,readFrame:session.readFrame,snapshot:session.snapshot,get index(){return index;},get ticks(){return tape.ticks;},get complete(){return verified;}};
}

export function encodeSessionReplay(tape:SessionReplayTape):Uint8Array {
 validateTape(tape);const{initialSnapshot,inputs,...metadata}=tape,header=utf8.encode(JSON.stringify(metadata));
 demand(header.length<=MAX_HEADER,'metadata cap');const bodyLength=16+header.length+initialSnapshot.length+inputs.length;
 demand(bodyLength+32<=MAX_FILE,'file cap');const bytes=new Uint8Array(bodyLength+32),view=new DataView(bytes.buffer);
 view.setUint32(0,MAGIC,true);view.setUint32(4,header.length,true);view.setUint32(8,initialSnapshot.length,true);view.setUint32(12,inputs.length,true);
 bytes.set(header,16);bytes.set(initialSnapshot,16+header.length);bytes.set(inputs,16+header.length+initialSnapshot.length);bytes.set(sha256(bytes.subarray(0,bodyLength)),bodyLength);return bytes;
}
export function decodeSessionReplay(bytes:Uint8Array):SessionReplayTape {
 demand(bytes instanceof Uint8Array&&bytes.length>=48&&bytes.length<=MAX_FILE,'file length');const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 demand(view.getUint32(0,true)===MAGIC,'file version');const headerLength=view.getUint32(4,true),snapshotLength=view.getUint32(8,true),inputLength=view.getUint32(12,true),bodyLength=16+headerLength+snapshotLength+inputLength;
 demand(headerLength<=MAX_HEADER&&snapshotLength<=MAX_SNAPSHOT&&bodyLength+32===bytes.length,'section lengths');
 demand(hash(bytes.subarray(0,bodyLength))===toHex(bytes.subarray(bodyLength)),'file checksum');
 const metadata=JSON.parse(text.decode(bytes.subarray(16,16+headerLength)));
 demand(metadata&&typeof metadata==='object'&&!Array.isArray(metadata)&&!Object.hasOwn(metadata,'initialSnapshot')&&!Object.hasOwn(metadata,'inputs'),'metadata shape');
 const tape={...metadata,initialSnapshot:bytes.slice(16+headerLength,16+headerLength+snapshotLength),inputs:bytes.slice(16+headerLength+snapshotLength,bodyLength)} as SessionReplayTape;
 validateTape(tape);return tape;
}
