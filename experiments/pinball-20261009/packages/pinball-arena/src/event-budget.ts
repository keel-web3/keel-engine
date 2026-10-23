import type {ArenaWorldDefinition} from './types.ts';
export const ARENA_EVENT_CONTENT_LIMITS=Object.freeze({hazards:256,routes:256,requirements:128,routeRequirementMembership:2,records:4096});
const CELL=256;
/** A cell counts a route once even if several of its checkpoints overlap.
 * Bounding boxes deliberately overestimate real circle/layer/height contact;
 * this is a safe admission bound, not a trajectory occupancy prediction. */
function overlapBound(points:readonly {id:string;x:number;y:number;radius:number;layer:number}[]):number{
 const cells=new Map<string,Set<string>>();let maximum=0;
 for(const p of points){if(typeof p.id!=='string'||!p.id.length||![p.x,p.y,p.radius].every(Number.isFinite)||p.x<0||p.x>65535||p.y<0||p.y>65535||p.radius<0||p.radius>224||!Number.isInteger(p.layer)||p.layer<0||p.layer>3)throw new Error('Invalid event overlap geometry');}
 for(const p of points)for(let y=Math.floor((p.y-p.radius)/CELL);y<=Math.floor((p.y+p.radius)/CELL);y++)for(let x=Math.floor((p.x-p.radius)/CELL);x<=Math.floor((p.x+p.radius)/CELL);x++){
  const key=`${p.layer}:${x}:${y}`,cell=cells.get(key)??new Set<string>();cell.add(p.id);cells.set(key,cell);maximum=Math.max(maximum,cell.size);
 }
 return maximum;
}
export function arenaEventBudget(world:ArenaWorldDefinition,players:number){
 if(!Number.isSafeInteger(players)||players<1||players>100)throw new Error('Event budget accepted player count');
 const hazards=world.arenas.flatMap(a=>a.hazards??[]),routes=world.arenas.flatMap(a=>a.challenges??[]),requirements=world.arenas.flatMap(a=>a.requirements??[]);
 if(hazards.length>ARENA_EVENT_CONTENT_LIMITS.hazards||routes.length>ARENA_EVENT_CONTENT_LIMITS.routes||requirements.length>ARENA_EVENT_CONTENT_LIMITS.requirements)throw new Error('Arena logical event content capacity exceeded');
 const membership=new Map<string,number>();for(const requirement of requirements){const groups=requirement.routeGroups??requirement.routeIds.map(id=>[id]);if(!Array.isArray(groups)||groups.length<2||groups.length>8||groups.some(group=>!Array.isArray(group)||group.length<1||group.length>32||group.some(id=>!routes.some(r=>r.id===id)))||new Set(groups.flat()).size!==groups.flat().length||groups.flat().length!==requirement.routeIds.length||requirement.routeIds.some(id=>!groups.flat().includes(id)))throw new Error('Invalid compound event groups');for(const id of new Set(groups.flat()))membership.set(id,(membership.get(id)??0)+1);}
 const maximumMembership=Math.max(0,...membership.values());if(maximumMembership>ARENA_EVENT_CONTENT_LIMITS.routeRequirementMembership)throw new Error('Route compound event membership exceeded');
 const hazardOverlap=overlapBound(hazards.map(h=>({...h,radius:h.radius+24}))),routeOverlap=overlapBound(routes.flatMap(r=>r.checkpoints.map(p=>({...p,id:r.id}))));
 const switches=world.arenas.reduce((n,a)=>n+a.switches.length,0),gates=world.arenas.reduce((n,a)=>n+a.gates.length,0),mechanisms=world.arenas.reduce((n,a)=>n+a.bumpers.length+a.stations.length+a.switches.length+a.gates.length+(a.captures?.length??0),0);
 // Native contacts<=512; command records<=100. Per participant: launch1,
 // abilities3, damage1/elimination1, ramps2, fall/portal/catch/escape/lease1
 // each, transport<=2. New compound unlocks require a new completed route;
 // restore verifies that earned qualifications cannot be silently omitted.
 const upperBound=512+100+2+mechanisms+switches+gates+players*(15+hazardOverlap+routeOverlap*(1+maximumMembership));
 return Object.freeze({upperBound,limit:ARENA_EVENT_CONTENT_LIMITS.records,hazardOverlap,routeOverlap,maximumMembership,players,mechanisms,switches,gates});
}
export function assertArenaEventBudget(world:ArenaWorldDefinition,players:number){const budget=arenaEventBudget(world,players);if(budget.upperBound>budget.limit)throw new Error(`Arena event budget exceeds ${budget.limit}: ${budget.upperBound}`);return budget;}
