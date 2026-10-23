import {createArenaMatch,admitArenaInput,ARENA_AUTHORITY_REVISION,ARENA_KERNEL_SHA256,ARENA_HZ} from '@keel-engine/pinball-arena';
import type {ArenaWorldDefinition,ArenaPlayer,ArenaMatchOptions,ArenaOwnerInput,ArenaCommand} from '@keel-engine/pinball-arena';
import {sha256,toHex} from '@keel-engine/codec/hash';
export {manifest} from './module.ts';

type Match=ReturnType<typeof createArenaMatch>;
const MAGIC=0x3152504b,MAX_TICKS=ARENA_HZ*180,MAX_FILE=16*1024*1024,MAX_HEADER=8*1024*1024,MAX_SNAPSHOT=1500000;
const utf8=new TextEncoder(),text=new TextDecoder('utf-8',{fatal:true}),digest=(bytes:Uint8Array)=>toHex(sha256(bytes));
const integer=(n:unknown,lo:number,hi:number):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=lo&&n<=hi;
const demand=(ok:unknown,label:string):void=>{if(!ok)throw new Error('Invalid pinball replay: '+label);};
export interface ArenaReplayTape {
 readonly schema:'keel-pinball-replay@1';readonly kernel:string;readonly authority:string;
 readonly world:ArenaWorldDefinition;readonly players:readonly ArenaPlayer[];readonly options:ArenaMatchOptions;
 readonly startTick:number;readonly ticks:number;readonly recentSegment:boolean;
 readonly initialSnapshot:Uint8Array;readonly inputs:Uint8Array;
 readonly commands:readonly {readonly tick:number;readonly commands:readonly ArenaCommand[]}[];
 readonly finalDigest:string;
}

/** The recorder owns the authoritative step so only successfully admitted
 * ticks enter the tape. Sparse commands include higher-level session effects. */
export function createArenaReplayRecorder(match:Match,options:ArenaMatchOptions,maxTicks=MAX_TICKS){
 demand(integer(maxTicks,1,MAX_TICKS),'journal duration');
 const players=match.players,owners=new Set(players.map(p=>p.ownerId)),stride=players.length*3;
 let baseline=match.snapshot(),startTick=match.readFrame().tick,ticks=0,recentSegment=startTick>0;
 const inputs=new Uint8Array(maxTicks*stride);let commands:{tick:number;commands:readonly ArenaCommand[]}[]=[],commandBytes=0;
 const {players:_ignored,...rest}=options,rules=structuredClone(rest);
 // Reject mismatched supplied rules before recording an unusable tape.
 const identityProbe=createArenaMatch(match.world,{...rules,players});identityProbe.restore(baseline);
 const staticBytes=utf8.encode(JSON.stringify({schema:'keel-pinball-replay@1',kernel:ARENA_KERNEL_SHA256,authority:ARENA_AUTHORITY_REVISION,world:match.world,players,options:rules,startTick:ARENA_HZ*3600,ticks:MAX_TICKS,recentSegment:false,commands:[],finalDigest:'0'.repeat(64)})).length;
 demand(staticBytes<=MAX_HEADER-65536,'world metadata cap');const commandLimit=Math.min(1024*1024,MAX_HEADER-staticBytes);
 function step(proposed:readonly ArenaOwnerInput[]=[],proposedCommands:readonly ArenaCommand[]=[]){
  const admitted=proposed.map(admitArenaInput),byOwner=new Map(admitted.map(input=>[input.ownerId,input]));
  demand(admitted.length===byOwner.size&&admitted.every(input=>owners.has(input.ownerId)),'owner admission');
  demand(proposedCommands.every(command=>command.type!=='score-pressure'||!Object.hasOwn(command,'sourceOwnerId')),'score pressure cannot carry PvP source');
  const acceptedCommands=proposedCommands.map((command):ArenaCommand=>command.type==='impulse'?{id:command.id,ownerId:command.ownerId,type:command.type,vx:command.vx,vy:command.vy}:{id:command.id,ownerId:command.ownerId,type:command.type,...(command.amount===undefined?{}:{amount:command.amount}),...((command.type==='damage'||command.type==='equipment-damage')&&command.sourceOwnerId!==undefined?{sourceOwnerId:command.sourceOwnerId}:{})});
  const entryBytes=acceptedCommands.length?utf8.encode(JSON.stringify({tick:MAX_TICKS,commands:acceptedCommands})).length+1:0;
  demand(entryBytes<=commandLimit,'command metadata tick cap');
  const full=ticks===maxTicks||commandBytes+entryBytes>commandLimit,newBaseline=full?match.snapshot():undefined,before=match.readFrame().tick;
  const frame=match.step(admitted,acceptedCommands);
  if(frame.tick===before)return frame;
  if(full){baseline=newBaseline!;startTick=before;ticks=0;recentSegment=true;commands=[];commandBytes=0;}
  const offset=ticks*stride;
  for(const [index,player]of players.entries()){
   const input=byOwner.get(player.ownerId),at=offset+index*3;
   inputs[at]=input?.bits??0;inputs[at+1]=Math.round((input?.steerX??0)*127)&255;inputs[at+2]=Math.round((input?.steerY??0)*127)&255;
  }
  if(acceptedCommands.length){commands.push({tick:ticks,commands:acceptedCommands});commandBytes+=entryBytes;}ticks++;return frame;
 }
 function exportTape():ArenaReplayTape{return {
  schema:'keel-pinball-replay@1',kernel:ARENA_KERNEL_SHA256,authority:ARENA_AUTHORITY_REVISION,world:match.world,players,options:rules,
  startTick,ticks,recentSegment,initialSnapshot:baseline.slice(),inputs:inputs.slice(0,ticks*stride),commands:structuredClone(commands),finalDigest:digest(match.snapshot()),
 };}
 return {step,exportTape,get ticks(){return ticks;},get recentSegment(){return recentSegment;}};
}

function validateTape(tape:ArenaReplayTape){
 demand(tape.schema==='keel-pinball-replay@1'&&tape.kernel===ARENA_KERNEL_SHA256&&tape.authority===ARENA_AUTHORITY_REVISION,'authority identity');
 demand(Array.isArray(tape.players)&&integer(tape.players.length,1,100)&&integer(tape.startTick,0,ARENA_HZ*3600)&&integer(tape.ticks,0,MAX_TICKS)&&typeof tape.recentSegment==='boolean','duration/roster');
 demand(tape.initialSnapshot instanceof Uint8Array&&tape.initialSnapshot.length<=MAX_SNAPSHOT&&tape.inputs instanceof Uint8Array&&tape.inputs.length===tape.ticks*tape.players.length*3,'byte lengths');
 demand(typeof tape.finalDigest==='string'&&/^[0-9a-f]{64}$/.test(tape.finalDigest)&&tape.options&&typeof tape.options==='object'&&!Array.isArray(tape.options)&&tape.options.players===undefined,'rules/digest');
 demand(Array.isArray(tape.commands)&&tape.commands.length<=tape.ticks,'command log');
 let previous=-1;for(const entry of tape.commands){demand(integer(entry.tick,0,tape.ticks-1)&&entry.tick>previous&&Array.isArray(entry.commands)&&integer(entry.commands.length,1,100),'command tick');previous=entry.tick;}
 for(let at=0;at<tape.inputs.length;at+=3)demand(tape.inputs[at]!<=63&&tape.inputs[at+1]!==128&&tape.inputs[at+2]!==128,'admitted input');
}

/** Construct a separate authority. Playback never rewinds the live match. */
export function createArenaReplayPlayer(candidate:ArenaReplayTape){
 validateTape(candidate);
 const tape={...candidate,world:structuredClone(candidate.world),players:structuredClone(candidate.players),options:structuredClone(candidate.options),initialSnapshot:candidate.initialSnapshot.slice(),inputs:candidate.inputs.slice(),commands:structuredClone(candidate.commands)};
 const match=createArenaMatch(tape.world,{...tape.options,players:tape.players});match.restore(tape.initialSnapshot);
 demand(match.readFrame().tick===tape.startTick,'initial tick');
 let index=0,commandIndex=0,verified=false;
 function verify(){if(index===tape.ticks&&!verified){demand(digest(match.snapshot())===tape.finalDigest,'final snapshot');verified=true;}}
 function step(){
  if(index===tape.ticks){verify();return match.readFrame();}
  const offset=index*tape.players.length*3,entry=tape.commands[commandIndex];
  const inputs=tape.players.map((player,i)=>({ownerId:player.ownerId,bits:tape.inputs[offset+i*3]!,steerX:((tape.inputs[offset+i*3+1]!<<24)>>24)/127,steerY:((tape.inputs[offset+i*3+2]!<<24)>>24)/127}));
  const usesCommands=entry?.tick===index,frame=match.step(inputs,usesCommands?entry.commands:[]);
  demand(frame.tick===tape.startTick+index+1,'tick progression');if(usesCommands)commandIndex++;index++;verify();return frame;
 }
 verify();return {step,readFrame:match.readFrame,snapshot:match.snapshot,get index(){return index;},get ticks(){return tape.ticks;},get complete(){return verified;}};
}

/** Binary input/snapshot sections avoid multi-megabyte JSON byte arrays. The
 * embedded world preserves the exact generated geometry across future seeds. */
export function encodeArenaReplay(tape:ArenaReplayTape):Uint8Array{
 validateTape(tape);
 const {initialSnapshot,inputs,...metadata}=tape,header=utf8.encode(JSON.stringify(metadata));
 demand(header.length<=MAX_HEADER,'metadata cap');
 const bodyLength=16+header.length+initialSnapshot.length+inputs.length;demand(bodyLength+32<=MAX_FILE,'file cap');
 const bytes=new Uint8Array(bodyLength+32),view=new DataView(bytes.buffer);
 view.setUint32(0,MAGIC,true);view.setUint32(4,header.length,true);view.setUint32(8,initialSnapshot.length,true);view.setUint32(12,inputs.length,true);
 bytes.set(header,16);bytes.set(initialSnapshot,16+header.length);bytes.set(inputs,16+header.length+initialSnapshot.length);bytes.set(sha256(bytes.subarray(0,bodyLength)),bodyLength);return bytes;
}
export function decodeArenaReplay(bytes:Uint8Array):ArenaReplayTape{
 demand(bytes.length>=48&&bytes.length<=MAX_FILE,'file length');const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 demand(view.getUint32(0,true)===MAGIC,'file version');
 const headerLength=view.getUint32(4,true),snapshotLength=view.getUint32(8,true),inputLength=view.getUint32(12,true),bodyLength=16+headerLength+snapshotLength+inputLength;
 demand(headerLength<=MAX_HEADER&&snapshotLength<=MAX_SNAPSHOT&&bodyLength+32===bytes.length,'section lengths');
 demand(digest(bytes.subarray(0,bodyLength))===toHex(bytes.subarray(bodyLength)),'file checksum');
 const metadata=JSON.parse(text.decode(bytes.subarray(16,16+headerLength))) as Omit<ArenaReplayTape,'initialSnapshot'|'inputs'>;
 const tape={...metadata,initialSnapshot:bytes.slice(16+headerLength,16+headerLength+snapshotLength),inputs:bytes.slice(16+headerLength+snapshotLength,bodyLength)};
 validateTape(tape);return tape;
}
