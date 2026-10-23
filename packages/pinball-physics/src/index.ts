export {manifest} from './module.ts';
import { compilePinballMap } from '@keel-engine/pinball-map';
import type { PinballMap } from '@keel-engine/pinball-map';
import { KERNEL_BYTES, KERNEL_SHA256 } from './kernel-bytes.ts';
export { KERNEL_BYTES, KERNEL_SHA256, KERNEL_COMPILER } from './kernel-bytes.ts';
export const PINBALL_PHYSICS_VERSION = 'keel-pinball-physics@1';
export const PINBALL_HZ = 120;
export const PINBALL_FIXED_SCALE = 1024;
export const PinballInput = Object.freeze({LEFT:1,RIGHT:2,LAUNCH:4,RESTART:8});
export interface BallFrame { id:string;ownerId:number;layer:number;x:number;y:number;vx:number;vy:number;radius:number;active:boolean }
export interface FlipperFrame { id:string;angle:number;pivotX:number;pivotY:number;tipX:number;tipY:number;radius:number }
export interface PinballEvent { id:string; tick:number; type:'rail'|'bumper'|'flipper'|'drain'|'launch'|'ball-save'|'gameover'|'restart'|'contact-budget'; colliderId?:string;ballId?:string;points?:number;x?:number;y?:number }
export interface PhysicsFrame { tick:number;balls:BallFrame[];flippers:FlipperFrame[];events:PinballEvent[] }
export interface BallPlacement { x:number;y:number;vx?:number;vy?:number;active?:boolean;ownerId?:number;layer?:number }
interface Kernel {memory:WebAssembly.Memory;state_ptr:()=>number;state_size:()=>number;init:(g:number,r:number,d:number)=>void;rail:(...n:number[])=>void;bumper:(...n:number[])=>void;flipper:(...n:number[])=>void;ball:(...n:number[])=>void;step:(input:number)=>void;tip_x:(i:number)=>number;tip_y:(i:number)=>number}
let module:WebAssembly.Module|undefined;
const q=(n:number)=>Math.round(n*1024);
export function createPinballPhysics(source:PinballMap) {
  const map=compilePinballMap(source);
  module ??= new WebAssembly.Module(KERNEL_BYTES);
  const kernel=new WebAssembly.Instance(module,{}).exports as unknown as Kernel;
  kernel.init(q(map.gravity),q(map.ballRadius),q(map.drainY));
  for(const s of map.segments) kernel.rail(q(s.ax),q(s.ay),q(s.bx),q(s.by),q(s.restitution!),s.layer!);
  for(const b of map.bumpers) kernel.bumper(q(b.x),q(b.y),q(b.radius),q(b.impulse!),b.layer!);
  for(const f of map.flippers) kernel.flipper(q(f.pivotX),q(f.pivotY),q(f.length),q(f.radius),Math.round(f.restAngle*10),Math.round(f.activeAngle*10),f.side==='left'?1:2,f.ownerId!,f.layer!);
  const state=new Int32Array(kernel.memory.buffer,kernel.state_ptr(),kernel.state_size()/4);
  const colliders=[...map.segments.map(c=>({...c,type:'rail' as const})),...map.bumpers.map(c=>({...c,type:'bumper' as const})),...map.flippers.map(c=>({...c,type:'flipper' as const}))];
  let events:PinballEvent[]=[];
  function setBall(p:BallPlacement) {
    for(const [k,n] of Object.entries({x:p.x,y:p.y,vx:p.vx??0,vy:p.vy??0}))if(!Number.isFinite(n)||Math.abs(n)>4096)throw new Error(`Invalid ball ${k}`);
    const owner=p.ownerId??0,layer=p.layer??0;if(!Number.isInteger(owner)||owner<0||owner>65535||!Number.isInteger(layer)||layer<0||layer>15)throw new Error('Invalid ball owner/layer');
    kernel.ball(q(p.x),q(p.y),q(p.vx??0),q(p.vy??0),p.active===false?0:1,owner,layer);
  }
  setBall({...map.launch,vx:0,vy:0,active:false});
  function readFrame():PhysicsFrame {return {tick:state[0]!,balls:[{id:'ball-1',ownerId:state[6]!,layer:state[7]!,x:state[1]!/1024,y:state[2]!/1024,vx:state[3]!/1024,vy:state[4]!/1024,radius:map.ballRadius,active:state[5]===1}],flippers:map.flippers.map((f,i)=>({id:f.id,angle:state[10+i]!/10,pivotX:f.pivotX,pivotY:f.pivotY,tipX:kernel.tip_x(i)/1024,tipY:kernel.tip_y(i)/1024,radius:f.radius})),events:events.map(e=>({...e}))};}
  function step(input:number):PhysicsFrame {
    if(!Number.isInteger(input)||input<0||input>15)throw new Error('Invalid input bits');
    if(state[0]!>=0x7fffff00)throw new Error('Pinball tick bound reached');
    const wasActive=state[5]===1;kernel.step(input);events=[];const tick=state[0]!;
    for(let j=0;j<state[186]!;j++){const c=colliders[state[187+j]!]!;events.push({id:`${tick}:${c.type}:${c.id}`,tick,type:c.type,colliderId:c.id,ballId:'ball-1',x:state[1]!/1024,y:state[2]!/1024});}
    if(wasActive&&state[5]===0)events.push({id:`${tick}:drain:ball-1`,tick,type:'drain',ballId:'ball-1'});
    if(state[251])events.push({id:`${tick}:contact-budget`,tick,type:'contact-budget',ballId:'ball-1'});
    return readFrame();
  }
  function snapshot():Uint8Array{return new TextEncoder().encode(JSON.stringify({schema:PINBALL_PHYSICS_VERSION,kernel:KERNEL_SHA256,map:map.canonical,state:Array.from(state),events}));}
  function restore(bytes:Uint8Array):void {
    if(bytes.byteLength>200000)throw new Error('Snapshot exceeds bound');
    const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(data.schema!==PINBALL_PHYSICS_VERSION||data.kernel!==KERNEL_SHA256||data.map!==map.canonical||!Array.isArray(data.state)||data.state.length!==state.length||data.state.some((n:unknown)=>typeof n!=='number'||!Number.isInteger(n)||n < -2147483648||n>2147483647))throw new Error('Incompatible pinball snapshot');
    const s=data.state as number[];
    if(s[0]!<0||Math.abs(s[1]!)>4096*1024||Math.abs(s[2]!)>4096*1024||Math.abs(s[3]!)>24*1024||Math.abs(s[4]!)>24*1024||![0,1].includes(s[5]!)||s[6]!<0||s[6]!>65535||s[7]!<0||s[7]!>15||Math.abs(s[8]!)>=64||Math.abs(s[9]!)>=64||s[186]!<0||s[186]!>64||!Array.isArray(data.events)||data.events.length>66)throw new Error('Invalid pinball snapshot state');
    for(let i=0;i<map.flippers.length;i++){const f=map.flippers[i]!;if(s[10+i]!<Math.min(Math.round(f.restAngle*10),Math.round(f.activeAngle*10))||s[10+i]!>Math.max(Math.round(f.restAngle*10),Math.round(f.activeAngle*10)))throw new Error('Invalid flipper snapshot');}
    if(s[3]!*s[3]!+s[4]!*s[4]!>(24*1024+1)**2)throw new Error('Invalid restored radial speed');
    if(s[0]!>0x7fffff00||![0,1].includes(s[251]!))throw new Error('Invalid bounded kernel state');
    for(let i=map.flippers.length;i<8;i++)if(s[10+i]!==0)throw new Error('Invalid unused actuator state');
    for(let i=0;i<168;i++){const last=s[18+i]!;if(i>=colliders.length?last!==-100:(last!==-100&&(last<1||last>s[0]!)))throw new Error('Invalid contact cooldown snapshot');}
    const seen=new Set<number>();
    for(let i=0;i<s[186]!;i++){const id=s[187+i]!;if(id<0||id>=colliders.length||seen.has(id)||s[18+id]!==s[0])throw new Error('Invalid event snapshot');seen.add(id);}
    for(let i=s[186]!;i<64;i++)if(s[187+i]!==0)throw new Error('Invalid unused event state');
    for(const e of data.events)if(typeof e.id!=='string'||typeof e.type!=='string'||e.tick!==s[0])throw new Error('Invalid snapshot event');
    state.set(s);events=data.events.map((e:PinballEvent)=>({...e}));
  }
  return {map,step,readFrame,readEvents:()=>events.map(e=>({...e})),setBall,snapshot,restore};
}
export type PinballPhysics = ReturnType<typeof createPinballPhysics>;
