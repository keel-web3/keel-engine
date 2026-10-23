import type {ArenaPoint,ArenaRail,ArenaRamp,ArenaSurface,ArenaBiomeBlend,ArenaPinballPort,ArenaPinballPath} from '@keel-engine/pinball-arena';
const q=(n:number)=>Math.round(n*1024)/1024;
export interface TrackVertex extends ArenaPoint {readonly elevation:number;readonly layer:number}
export interface TrackOptions {readonly id:string;readonly role:'orbit'|'cross-return'|'shooter'|'inlane'|'travel';readonly vertices:readonly TrackVertex[];readonly clearWidth:number;readonly clearWidths?:readonly number[];readonly biome:ArenaBiomeBlend;readonly receiverCatchId?:string;readonly restitution?:number;readonly returnStartVertex?:number;readonly qualificationId?:string;readonly deck?:'solid'|'wireform'}
const unit=(x:number,y:number)=>{const d=Math.hypot(x,y);if(d<1e-6)throw new Error('Coincident track vertices');return {x:x/d,y:y/d};};
/** Shared-vertex miter offsets keep the two guides and support on the same seam.
 * Curves are sampled before offsetting, rather than offsetting disconnected strips. */
export function compileTrack(options:TrackOptions){
 const {id,role,vertices:input,clearWidth,biome}=options;
 if(input.length<2||input.length>64||clearWidth<32||clearWidth>240)throw new Error('Track recipe bounds');
 const widths=options.clearWidths??input.map(()=>clearWidth);if(widths.length!==input.length||widths.some(w=>!Number.isFinite(w)||w<clearWidth||w>240)||Math.min(...widths)!==clearWidth)throw new Error('Track width profile');
 const vertices:TrackVertex[]=[],sourceIndices:number[]=[],sectionWidths:number[]=[];
 for(let i=0;i<input.length;i++){
  const a=input[i]!;vertices.push(a);sourceIndices.push(i);sectionWidths.push(widths[i]!);const b=input[i+1];
  if(b&&a.elevation!==b.elevation){if(widths[i]!==widths[i+1])throw new Error('A ramp needs a uniform axial support width');const length=Math.hypot(b.x-a.x,b.y-a.y);if(length>1100)throw new Error('Ramp segment too long');vertices.push({x:q((a.x+b.x)/2),y:q((a.y+b.y)/2),elevation:q((a.elevation+b.elevation)/2),layer:b.layer});sourceIndices.push(i+.5);sectionWidths.push(widths[i]!);}
 }
 // A sloped seam uses a transverse section of its native ramp axis. A
 // miter tilted toward the neighboring flat curve warps the ramp deck and
 // gives its two rail ends incompatible heights. Both adjacent pieces share
 // this section, so the landing remains connected without a diagonal kink.
 const rampAxes=new Map<number,{x:number;y:number}>();
 for(let i=0;i<vertices.length-1;i++){const a=vertices[i]!,b=vertices[i+1]!;if(a.elevation===b.elevation)continue;const axis=unit(b.x-a.x,b.y-a.y);for(const index of [i,i+1]){const previous=rampAxes.get(index);if(previous&&Math.hypot(previous.x-axis.x,previous.y-axis.y)>.001)throw new Error('Sloped corner requires a level landing');rampAxes.set(index,axis);}}
 const offset=vertices.map((p,i)=>{
  const half=sectionWidths[i]!/2+3;
  const rampAxis=rampAxes.get(i);if(rampAxis)return {x:-rampAxis.y*half,y:rampAxis.x*half};
  const previous=vertices[Math.max(0,i-1)]!,next=vertices[Math.min(vertices.length-1,i+1)]!;
  const incoming=i?unit(p.x-previous.x,p.y-previous.y):unit(next.x-p.x,next.y-p.y),outgoing=i<vertices.length-1?unit(next.x-p.x,next.y-p.y):incoming;
  const summed={x:incoming.x+outgoing.x,y:incoming.y+outgoing.y};if(Math.hypot(summed.x,summed.y)<.25)throw new Error('Track cusp');const tangent=unit(summed.x,summed.y),normal={x:-tangent.y,y:tangent.x},denominator=normal.x*(-incoming.y)+normal.y*incoming.x;
  const amount=half/denominator;if(!Number.isFinite(amount)||amount>half*1.7)throw new Error('Track corner exceeds qualified miter');return {x:normal.x*amount,y:normal.y*amount};
 });
 const rails:ArenaRail[]=[],ramps:ArenaRamp[]=[],surfaces:ArenaSurface[]=[],colliderIds:string[]=[],surfaceIds:string[]=[];
 for(let i=0;i<vertices.length-1;i++){
  const a=vertices[i]!,b=vertices[i+1]!,oa=offset[i]!,ob=offset[i+1]!,rising=a.elevation!==b.elevation,returning=role==='inlane'||options.returnStartVertex!==undefined&&sourceIndices[i]!>=options.returnStartVertex;
  const layer=rising?(input.some(p=>p.x===a.x&&p.y===a.y)?a.layer:b.layer):a.layer;
  for(const side of [-1,1]){const rid=`${id}.rail.${i}.${side}`;colliderIds.push(rid);rails.push({id:rid,ax:q(a.x+oa.x*side),ay:q(a.y+oa.y*side),bx:q(b.x+ob.x*side),by:q(b.y+ob.y*side),radius:3,restitution:options.restitution??.96,layer,elevation:a.elevation,elevationB:b.elevation,material:'steel',kind:'lane'});}
  const sid=`${id}.bed.${i}`;surfaceIds.push(sid);surfaces.push({id:sid,kind:rising?'ramp':a.layer?'bridge':'ground',role:returning?'return':role==='travel'?'travel':'shot',polygon:[{x:q(a.x+oa.x*(sectionWidths[i]!/2+6)/(sectionWidths[i]!/2+3)),y:q(a.y+oa.y*(sectionWidths[i]!/2+6)/(sectionWidths[i]!/2+3))},{x:q(b.x+ob.x*(sectionWidths[i+1]!/2+6)/(sectionWidths[i+1]!/2+3)),y:q(b.y+ob.y*(sectionWidths[i+1]!/2+6)/(sectionWidths[i+1]!/2+3))},{x:q(b.x-ob.x*(sectionWidths[i+1]!/2+6)/(sectionWidths[i+1]!/2+3)),y:q(b.y-ob.y*(sectionWidths[i+1]!/2+6)/(sectionWidths[i+1]!/2+3))},{x:q(a.x-oa.x*(sectionWidths[i]!/2+6)/(sectionWidths[i]!/2+3)),y:q(a.y-oa.y*(sectionWidths[i]!/2+6)/(sectionWidths[i]!/2+3))}],layer,height:a.elevation,...(rising?{vertexElevations:[a.elevation,b.elevation,b.elevation,a.elevation],rampId:`${id}.slope.${input.findIndex((p,index)=>{const next=input[index+1];return next&&p.elevation!==next.elevation&&((p.x===a.x&&p.y===a.y)||(next.x===b.x&&next.y===b.y));})}`} :{}),material:options.deck==='wireform'&&(rising||a.layer>0)?'wireform-track':returning?'return-track':'shot-track',biome});
 }
 // Native ramps cover the full slope; rail halves use the exact interpolated
 // heights and switch collision layer at the same midpoint as the solver.
 for(let i=0;i<input.length-1;i++){const a=input[i]!,b=input[i+1]!;if(a.elevation!==b.elevation){ramps.push({id:`${id}.slope.${i}`,ax:a.x,ay:a.y,bx:b.x,by:b.y,width:widths[i]!+12,fromLayer:a.layer,toLayer:b.layer,fromElevation:a.elevation,toElevation:b.elevation,bidirectional:false});
  // The capsule guide has a round cap; its bed needs the same supported
  // landing apron while a ball crosses the ramp's directional seam plane.
  for(const [suffix,p]of [['entry',a],['exit',b]] as const){const sid=`${id}.slope.${i}.${suffix}-apron`;surfaceIds.push(sid);surfaces.push({id:sid,kind:p.layer?'bridge':'ground',role:role==='shooter'?'return':'shot',polygon:Array.from({length:8},(_,j)=>({x:q(p.x+Math.cos(j*Math.PI/4)*(widths[i]!+12)/2),y:q(p.y+Math.sin(j*Math.PI/4)*(widths[i]!+12)/2)})),layer:p.layer,height:p.elevation,material:options.deck==='wireform'&&p.layer>0?'wireform-track':role==='shooter'?'return-track':'shot-track',biome});}
 }}
 const first=vertices[0]!,second=vertices[1]!,last=vertices.at(-1)!,before=vertices.at(-2)!,ports:ArenaPinballPort[]=[{id:`${id}-entry`,mechanismId:id,role:role==='shooter'?'shooter-entry':role==='inlane'?'return-entry':'shot-entry',x:first.x,y:first.y,layer:first.layer,elevation:first.elevation,tangent:unit(second.x-first.x,second.y-first.y),clearWidth:widths[0]!,direction:'forward',surfaceIds:[surfaceIds[0]!,...surfaces.filter(s=>s.id.endsWith('entry-apron')&&Math.hypot(s.polygon[0]!.x-first.x,s.polygon[0]!.y-first.y)<clearWidth).map(s=>s.id)],maxBallRadius:12,admittedSpeed:{min:2,max:18},...(options.receiverCatchId?{receiverCatchId:options.receiverCatchId}:{}),...(options.qualificationId?{qualificationId:options.qualificationId}:{})},{id:`${id}-exit`,mechanismId:id,role:options.receiverCatchId?'return-exit':'shot-exit',x:last.x,y:last.y,layer:last.layer,elevation:last.elevation,tangent:unit(last.x-before.x,last.y-before.y),clearWidth:widths.at(-1)!,direction:'forward',surfaceIds:[surfaceIds[vertices.length-2]!,...surfaces.filter(s=>s.id.endsWith('exit-apron')&&Math.hypot(s.polygon[0]!.x-last.x,s.polygon[0]!.y-last.y)<clearWidth).map(s=>s.id)],maxBallRadius:12,admittedSpeed:{min:1,max:18},...(options.receiverCatchId?{receiverCatchId:options.receiverCatchId}:{}),...(options.qualificationId?{qualificationId:options.qualificationId}:{})}];
 const path:ArenaPinballPath={id,role,vertices:input.map(p=>({...p})),clearWidth,...(options.clearWidths?{clearWidths:[...widths]}:{}),colliderIds,surfaceIds,entryPortId:ports[0]!.id,exitPortId:ports[1]!.id,...(options.receiverCatchId?{receiverCatchId:options.receiverCatchId}:{}),...(options.returnStartVertex!==undefined?{returnStartVertex:options.returnStartVertex}:{})};
 return {rails,ramps,surfaces,ports,path};
}
export function cubic(a:ArenaPoint,b:ArenaPoint,c:ArenaPoint,d:ArenaPoint,steps:number):ArenaPoint[]{return Array.from({length:steps+1},(_,i)=>{const t=i/steps,s=1-t;return {x:q(s*s*s*a.x+3*s*s*t*b.x+3*s*t*t*c.x+t*t*t*d.x),y:q(s*s*s*a.y+3*s*s*t*b.y+3*s*t*t*c.y+t*t*t*d.y)};});}
