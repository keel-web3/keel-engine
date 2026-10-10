import {ArenaInput,admitArenaInput,type ArenaOwnerInput,type ArenaFrame,type ArenaWorldDefinition} from '@keel-engine/pinball-arena';

export const PINBALL_CONTROL_BINDING_VERSION='pinball-control-binding/2026-10-07.2';
export interface PinballInputPair {
 readonly arenaId:string;readonly stationId:string;readonly ownerId:number;readonly leaseTicks:number;
 readonly left:'left'|'right'|null;readonly right:'left'|'right'|null;
 readonly leftFlipperId:string;readonly rightFlipperId:string;
}
const FLIPPERS=ArenaInput.LEFT|ArenaInput.RIGHT;
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=256;

/** Read the body's current or declared upcoming native pair. A zero lease
 * records an approach; it never grants ownership. Projection is supplied by
 * the existing renderer so device controls retain its actual screen order. */
export function readPinballInputPair(world:ArenaWorldDefinition,frame:ArenaFrame,ownerId:number,project:(x:number,y:number,elevation:number,arenaId:string)=>readonly [number,number,number]|null):PinballInputPair|null{
 admitArenaInput({ownerId,bits:0});
 const body=frame.balls.find(b=>b.ownerId===ownerId&&!b.eliminated&&b.transport===null),field=world.arenas.find(a=>a.id===body?.arenaId),bank=field?.stations.find(s=>s.id===(body?.stationId??body?.nextStationId));
 if(!field||!bank)return null;
 const blades=field.flippers.filter(f=>bank.flipperIds.includes(f.id)),left=blades.find(f=>f.side==='left'),right=blades.find(f=>f.side==='right');
 if(!left||!right||blades.length!==2)return null;
 const lp=project(left.pivotX,left.pivotY,left.elevation,field.id),rp=project(right.pivotX,right.pivotY,right.elevation,field.id),projected=lp&&rp&&lp.every(Number.isFinite)&&rp.every(Number.isFinite)&&Math.abs(lp[0]-rp[0])>=.01;
 const lease=frame.stations.find(s=>s.id===bank.id&&s.arenaId===field.id);
 return{arenaId:field.id,stationId:bank.id,left:projected?(lp[0]<rp[0]?'left':'right'):null,right:projected?(lp[0]<rp[0]?'right':'left'):null,leftFlipperId:left.id,rightFlipperId:right.id,ownerId,leaseTicks:lease?.ownerId===ownerId?lease.leaseTicks:0};
}

/** A screen-side press keeps its intended native blade until release, even
 * through camera yaw. A known upcoming pair may have leaseTicks=0: the input
 * remains intent and the core alone admits blade ownership/actuation. Changing
 * the intended pair suppresses stale holds until release. */
export function createPinballControlBinding(ownerId:number){
 admitArenaInput({ownerId,bits:0});
 let pairKey:string|null=null,previous=0,blocked=0;
 const held=new Map<number,number>();
 function map(input:ArenaOwnerInput,pair:PinballInputPair|null):ArenaOwnerInput{
  const admitted=admitArenaInput(input);if(admitted.ownerId!==ownerId)throw new Error('Pinball control owner differs');
  let key:string|null=null;
  if(pair){
   const projected=pair.left!==null&&pair.right!==null&&['left','right'].includes(pair.left)&&['left','right'].includes(pair.right)&&pair.left!==pair.right;
   if(!id(pair.arenaId)||!id(pair.stationId)||!id(pair.leftFlipperId)||!id(pair.rightFlipperId)||pair.leftFlipperId===pair.rightFlipperId||pair.ownerId!==ownerId||!Number.isSafeInteger(pair.leaseTicks)||pair.leaseTicks<0||(!projected&&(pair.left!==null||pair.right!==null)))throw new Error('Invalid pinball control lease/pair');
   // Camera yaw changes the screen order, not the identity of the native pair.
   key=JSON.stringify([pair.arenaId,pair.stationId,[pair.leftFlipperId,pair.rightFlipperId].sort()]);
  }
  const screen=admitted.bits&FLIPPERS;
  blocked&=screen;
  if(key!==pairKey){blocked|=screen&previous;held.clear();pairKey=key;}
  if(!pair){blocked|=screen;held.clear();}
  else for(const side of [ArenaInput.LEFT,ArenaInput.RIGHT]){
   if(!(screen&side)){held.delete(side);continue;}
   if(!(blocked&side)&&!(previous&side)){
    // An edge-on camera may hide the left/right ordering temporarily. Existing
    // presses still own their blade; a new ambiguous press must be released.
    if(pair.left===null){blocked|=side;continue;}
    held.set(side,(side===ArenaInput.LEFT?pair.left:pair.right)==='left'?ArenaInput.LEFT:ArenaInput.RIGHT);
   }
  }
  previous=screen;let bits=admitted.bits&~FLIPPERS;
  for(const [side,native]of held)if(screen&side)bits|=native;
  return admitArenaInput({...admitted,bits});
 }
 return {map,cancel(){blocked|=previous;held.clear();pairKey=null;}};
}
