import type {ArenaEvent} from '@keel-engine/pinball-arena';

/** Retain admitted actions until published. Contacts coalesce per owner and
 * recoil cues per mechanism. Separate rotating cursors share spare packet
 * slots; a bounded reliable backlog fails explicitly instead of losing actions. */
export function createRoomEventJournal(){
 const pending:ArenaEvent[]=[],contacts=new Map<number,ArenaEvent>(),mechanisms=new Map<string,ArenaEvent>(),seen=new Set<string>(),seenOrder:string[]=[];
 let cursor=0,mechanismCursor='',latestTick=0;
 const mechanismCue=(event:ArenaEvent)=>event.type==='mechanism-actuate'&&typeof event.mechanismId==='string';
 const strength=(type:string)=>type==='flipper'?3:type==='bumper'?2:1;
 return {
  append(events:readonly ArenaEvent[]):void {
   const batchIds=new Set<string>(),fresh=events.filter(event=>{if(seen.has(event.id)||batchIds.has(event.id))return false;batchIds.add(event.id);return true;});
   const actions=fresh.filter(event=>!mechanismCue(event)&&(!['rail','bumper','flipper'].includes(event.type)||event.ownerId===undefined));
   if(pending.length+actions.length>4096)throw new Error('Room action event backlog exceeded');
   if(new Set([...mechanisms.keys(),...fresh.filter(mechanismCue).map(event=>event.mechanismId!)]).size>512)throw new Error('Room mechanism cue capacity exceeded');
   for(const event of fresh){
    latestTick=Math.max(latestTick,event.tick);
    seen.add(event.id);seenOrder.push(event.id);
    if(mechanismCue(event)){const prior=mechanisms.get(event.mechanismId!);if(!prior||event.tick>=prior.tick)mechanisms.set(event.mechanismId!,{...event});}
    else if(['rail','bumper','flipper'].includes(event.type)&&event.ownerId!==undefined){
     const prior=contacts.get(event.ownerId);if(!prior||strength(event.type)>=strength(prior.type))contacts.set(event.ownerId,{...event});
    }else pending.push({...event});
   }
   while(seenOrder.length>8192)seen.delete(seenOrder.shift()!);
  },
  take(max=256,currentTick=latestTick):readonly ArenaEvent[] {
   if(!Number.isInteger(max)||max<1||max>256)throw new Error('Invalid room event packet capacity');
   if(!Number.isSafeInteger(currentTick)||currentTick<latestTick)throw new Error('Invalid room event publication tick');
   // Actions are reliable until publication. An over-age action is an explicit
   // host failure, while coalesced contact audio expires after one second.
   if(pending.some(event=>currentTick-event.tick>120))throw new Error('Room action event publication deadline exceeded');
   for(const [owner,event]of contacts)if(currentTick-event.tick>120)contacts.delete(owner);
   for(const [id,event]of mechanisms)if(currentTick-event.tick>120)mechanisms.delete(id);
   const selected=pending.splice(0,max);
   const contactLimit=mechanisms.size?selected.length+Math.ceil((max-selected.length)/2):max;
   for(let offset=0;offset<100&&selected.length<contactLimit;offset++){
    const owner=(cursor+offset)%100,event=contacts.get(owner);if(!event)continue;
    selected.push(event);contacts.delete(owner);cursor=(owner+1)%100;offset=-1;
   }
   const keys=[...mechanisms.keys()].sort(),after=keys.findIndex(key=>key>mechanismCursor),start=after<0?0:after;
   for(let offset=0;offset<keys.length&&selected.length<max;offset++){const id=keys[(start+offset)%keys.length]!,event=mechanisms.get(id)!;selected.push(event);mechanisms.delete(id);mechanismCursor=id;}
   return selected;
  },
  get pending(){return pending.length+contacts.size+mechanisms.size;}
 };
}
