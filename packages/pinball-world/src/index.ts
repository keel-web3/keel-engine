export {manifest} from './module.ts';
/** Classic rules are an optional pure consumer of the shared pinball kernel. */
import { createPinballPhysics, PinballInput, PINBALL_PHYSICS_VERSION } from '@keel-engine/pinball-physics';
import type { PhysicsFrame, PinballEvent } from '@keel-engine/pinball-physics';
import { compilePinballMap } from '@keel-engine/pinball-map';
import type { PinballMap } from '@keel-engine/pinball-map';
export interface LaunchSocketRules { halfWidth:number; above:number; below:number; maxSpeed:number }
export interface ClassicRules { balls?:number; ballSaveTicks?:number; launchSocket?:Partial<LaunchSocketRules> }
export interface ClassicFrame extends PhysicsFrame { score:number; ballNumber:number; ballsRemaining:number; phase:'ready'|'playing'|'gameover'; ballSaveRemaining:number; canLaunch:boolean }
export function createClassicWorld(source:PinballMap,options:ClassicRules={}) {
  const map=compilePinballMap(source);
  const socket={halfWidth:14,above:16,below:40,maxSpeed:1,...options.launchSocket};
  for(const [key,value] of Object.entries(socket))if(!Number.isFinite(value)||value<0||value>(key==='maxSpeed'?2:64))throw new Error('Invalid launch socket rules');
  const rules=Object.freeze({balls:options.balls??3,ballSaveTicks:options.ballSaveTicks??600,launchSocket:Object.freeze(socket)});
  if(!Number.isInteger(rules.balls)||rules.balls<1||rules.balls>9||!Number.isInteger(rules.ballSaveTicks)||rules.ballSaveTicks<0||rules.ballSaveTicks>3600)throw new Error('Invalid classic rules');
  let physics=createPinballPhysics(map),score=0,ballNumber=1,ballsRemaining=rules.balls,phase:ClassicFrame['phase']='ready',previousInput=0,saveUntil=0,events:PinballEvent[]=[];
  const points=new Map(map.bumpers.map(b=>[b.id,b.points??100]));
  const event=(type:PinballEvent['type'],tick:number):PinballEvent=>({id:`${tick}:${type}:ball-1`,tick,type,ballId:'ball-1'});
  function canLaunch():boolean {
    if(phase==='ready')return true;if(phase!=='playing')return false;
    const b=physics.readFrame().balls[0]!;const socket=rules.launchSocket;
    return b.active&&b.layer===0&&Math.abs(b.x-map.launch.x)<=socket.halfWidth&&b.y>=map.launch.y-socket.above&&b.y<=map.launch.y+socket.below&&b.vx*b.vx+b.vy*b.vy<=socket.maxSpeed*socket.maxSpeed;
  }
  function readFrame():ClassicFrame {const frame=physics.readFrame();return {...frame,score,ballNumber,ballsRemaining,phase,ballSaveRemaining:phase==='playing'?Math.max(0,saveUntil-frame.tick):0,canLaunch:canLaunch(),events:events.map(e=>({...e}))};}
  function step(input:number):ClassicFrame {
    if(!Number.isInteger(input)||input<0||input>15)throw new Error('Invalid input bits');
    const edge=input&~previousInput;previousInput=input;
    if(edge&PinballInput.RESTART){physics=createPinballPhysics(map);score=0;ballNumber=1;ballsRemaining=rules.balls;phase='ready';saveUntil=0;events=[event('restart',0)];return readFrame();}
    const pending:PinballEvent[]=[];
    if((edge&PinballInput.LAUNCH)&&canLaunch()){const prior=physics.readFrame();const b=prior.balls[0]!;physics.setBall({...map.launch,active:true,ownerId:b.ownerId,layer:b.layer});if(phase==='ready')saveUntil=prior.tick+rules.ballSaveTicks;phase='playing';pending.push(event('launch',prior.tick+1));}
    const frame=physics.step(input);events=[...pending,...frame.events];
    for(const e of events)if(e.type==='bumper'){const amount=points.get(e.colliderId!)??0;score=Math.min(2147483647,score+amount);e.points=amount;}
    if(phase==='playing'&&events.some(e=>e.type==='drain')){
      if(frame.tick<saveUntil){physics.setBall({...map.launch,active:true});events.push(event('ball-save',frame.tick));}
      else {ballsRemaining--;saveUntil=0;if(ballsRemaining===0){phase='gameover';events.push(event('gameover',frame.tick));}else {ballNumber++;phase='ready';physics.setBall({...map.launch,vx:0,vy:0,active:false});}}
    }
    return readFrame();
  }
  /** Sanctioned deterministic velocity-only impulse; kernel speed bound still applies. */
  function applyBallImpulse(dx:number,dy:number):boolean {
    if(!Number.isFinite(dx)||!Number.isFinite(dy)||Math.abs(dx)>32||Math.abs(dy)>32)throw new Error('Invalid bounded ball impulse');
    const b=physics.readFrame().balls[0]!;if(phase!=='playing'||!b.active)return false;
    physics.setBall({x:b.x,y:b.y,vx:b.vx+Math.round(dx*1024)/1024,vy:b.vy+Math.round(dy*1024)/1024,ownerId:b.ownerId,layer:b.layer,active:true});return true;
  }
  function snapshot():Uint8Array{return new TextEncoder().encode(JSON.stringify({schema:'keel-pinball-classic@1',physicsVersion:PINBALL_PHYSICS_VERSION,rules,score,ballNumber,ballsRemaining,phase,previousInput,saveUntil,events,physics:new TextDecoder().decode(physics.snapshot())}));}
  function restore(bytes:Uint8Array):void {
    if(bytes.byteLength>250000)throw new Error('World snapshot exceeds bound');
    const d=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(d.schema!=='keel-pinball-classic@1'||d.physicsVersion!==PINBALL_PHYSICS_VERSION||JSON.stringify(d.rules)!==JSON.stringify(rules)||!Number.isInteger(d.score)||d.score<0||d.score>2147483647||!Number.isInteger(d.ballNumber)||d.ballNumber<1||d.ballNumber>rules.balls||!Number.isInteger(d.ballsRemaining)||d.ballsRemaining<0||d.ballsRemaining>rules.balls||!['ready','playing','gameover'].includes(d.phase)||!Number.isInteger(d.previousInput)||d.previousInput<0||d.previousInput>15||!Number.isSafeInteger(d.saveUntil)||d.saveUntil<0||!Array.isArray(d.events)||d.events.length>70||typeof d.physics!=='string')throw new Error('Invalid classic snapshot');
    if((d.phase==='gameover')!==(d.ballsRemaining===0)||d.ballNumber+d.ballsRemaining!==(d.phase==='gameover'?rules.balls:rules.balls+1))throw new Error('Inconsistent classic ball lifecycle');
    const candidate=createPinballPhysics(map);candidate.restore(new TextEncoder().encode(d.physics));const f=candidate.readFrame();
    if(d.saveUntil>f.tick+rules.ballSaveTicks||(d.phase!=='playing'&&d.saveUntil!==0))throw new Error('Invalid ball-save snapshot deadline');
    if((d.phase==='playing')!==f.balls[0]!.active||d.events.some((e:PinballEvent)=>typeof e.id!=='string'||typeof e.type!=='string'||e.tick!==f.tick))throw new Error('Inconsistent classic snapshot frame');
    physics=candidate;score=d.score;ballNumber=d.ballNumber;ballsRemaining=d.ballsRemaining;phase=d.phase;previousInput=d.previousInput;saveUntil=d.saveUntil;events=d.events;
  }
  return {map,rules,step,readFrame,readEvents:()=>events.map(e=>({...e})),applyBallImpulse,snapshot,restore};
}
export type ClassicWorld=ReturnType<typeof createClassicWorld>;
export { PinballInput };
