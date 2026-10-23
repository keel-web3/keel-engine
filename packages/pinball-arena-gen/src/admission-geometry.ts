import type {ArenaField,ArenaPoint,ArenaPinballPort,ArenaSurface,ArenaRail,ArenaGate} from '@keel-engine/pinball-arena';

/** Static rejection evidence only. An empty issue list is NOT shot qualification. */
export interface GeometryIssue {readonly code:string;readonly subject:string;readonly detail:string}
export interface GeometryOptions {readonly ballRadius:number;readonly tolerance?:number}
const LIMIT=256, INPUT_LIMIT=4096;
const compare=(a:GeometryIssue,b:GeometryIssue)=>a.subject<b.subject?-1:a.subject>b.subject?1:a.code<b.code?-1:a.code>b.code?1:a.detail<b.detail?-1:a.detail>b.detail?1:0;
function recorder(){const items:GeometryIssue[]=[];let truncated=false;return {add(code:string,subject:string,detail:string){if(items.length<LIMIT-1)items.push({code,subject,detail});else truncated=true;},finish(){if(truncated)items.push({code:'ISSUE_LIMIT',subject:'field',detail:'Issue budget exhausted; candidate remains rejected.'});return items.sort(compare);}};}
const distance=(a:ArenaPoint,b:ArenaPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
const mix=(a:ArenaPoint,b:ArenaPoint,t:number)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const dot=(a:ArenaPoint,b:ArenaPoint)=>a.x*b.x+a.y*b.y;
const cross=(a:ArenaPoint,b:ArenaPoint)=>a.x*b.y-a.y*b.x;
const sub=(a:ArenaPoint,b:ArenaPoint)=>({x:a.x-b.x,y:a.y-b.y});
function segmentDistance(p:ArenaPoint,a:ArenaPoint,b:ArenaPoint){const d=sub(b,a),ll=dot(d,d),t=ll?Math.max(0,Math.min(1,dot(sub(p,a),d)/ll)):0;return distance(p,mix(a,b,t));}
function settings(options:GeometryOptions){const tolerance=options.tolerance??2/1024;if(!Number.isFinite(options.ballRadius)||options.ballRadius<6||options.ballRadius>24||!Number.isFinite(tolerance)||tolerance<0||tolerance>1)throw new Error('Invalid geometry inspection radius/tolerance');return {radius:options.ballRadius,tolerance};}
function contains(p:ArenaPoint,polygon:readonly ArenaPoint[],tol:number){let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[j]!,b=polygon[i]!;if(segmentDistance(p,a,b)<=tol)return true;if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;}
/** Generated track beds are convex quads/octagons. Concave/ambiguous variable-height
 * surfaces must be triangulated by their compiler before this helper can admit them. */
function heightAt(surface:ArenaSurface,p:ArenaPoint,tol:number):number|undefined{
 if(!contains(p,surface.polygon,tol))return undefined;
 if(!surface.vertexElevations)return surface.height;
 if(surface.vertexElevations.length!==surface.polygon.length)return undefined;
 const a=surface.polygon[0]!;
 for(let i=1;i<surface.polygon.length-1;i++){
  const b=surface.polygon[i]!,c=surface.polygon[i+1]!,ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),den=cross(ab,ac);if(Math.abs(den)<1e-9)continue;
  const u=cross(ap,ac)/den,v=cross(ab,ap)/den;
  if(u>=-1e-8&&v>=-1e-8&&u+v<=1+1e-8)return surface.vertexElevations[0]!*(1-u-v)+surface.vertexElevations[i]!*u+surface.vertexElevations[i+1]!*v;
 }
 return undefined;
}
function supportAt(surfaces:readonly ArenaSurface[],p:ArenaPoint,layer:number,elevation:number,tol:number){return surfaces.some(s=>{if(s.layer!==layer)return false;const z=heightAt(s,p,tol);return z!==undefined&&Math.abs(z-elevation)<=tol;});}

/** Checks supplied explicit seam; does not infer missing connections from proximity. */
export function inspectPinballPortSeam(exit:ArenaPinballPort,entry:ArenaPinballPort,options:GeometryOptions):GeometryIssue[]{
 const {radius,tolerance:t}=settings(options),r=recorder(),id=`${exit.id}->${entry.id}`;
 if(distance(exit,entry)>t)r.add('SEAM_POSITION',id,'Port centers do not coincide.');
 if(exit.layer!==entry.layer||Math.abs(exit.elevation-entry.elevation)>t)r.add('SEAM_HEIGHT',id,'Port layers/elevations disagree.');
 if(Math.abs(exit.clearWidth-entry.clearWidth)>t||Math.min(exit.clearWidth,entry.clearWidth)<2*radius+2*t)r.add('SEAM_APERTURE',id,'Port widths disagree or lack ball clearance.');
 if(distance(exit.tangent,entry.tangent)>.01)r.add('SEAM_TANGENT',id,'Forward travel tangents disagree.');
 if(Math.min(exit.maxBallRadius,entry.maxBallRadius)<radius)r.add('SEAM_RADIUS',id,'Ball exceeds declared port radius.');
 if(Math.max(exit.admittedSpeed.min,entry.admittedSpeed.min)>Math.min(exit.admittedSpeed.max,entry.admittedSpeed.max))r.add('SEAM_SPEED',id,'Speed envelopes do not overlap.');
 return r.finish();
}

export function inspectPinballGeometry(field:ArenaField,options:GeometryOptions):GeometryIssue[]{
 const {radius,tolerance:t}=settings(options),r=recorder(),paths=field.pinball?.paths??[],ports=field.pinball?.ports??[];
 if(!paths.length)r.add('MISSING_PATHS',field.id,'No compiled pinball path metadata.');
 if([paths,ports,field.surfaces,field.rails,field.stations].some(a=>a.length>INPUT_LIMIT)||paths.some(p=>p.vertices.length>64||p.colliderIds.length>256||p.surfaceIds.length>256)||field.surfaces.some(s=>s.polygon.length>32)||ports.some(p=>p.surfaceIds.length>256)){r.add('INPUT_LIMIT',field.id,'Inspection input exceeds bounded descriptor budget.');return r.finish();}
 // A physical Y junction can join rails referenced by different path records.
 // Index actual field endpoints; preserve the exact geometric/layer test below.
 const endpointCell=Math.max(t,1/1024),endpointKey=(p:ArenaPoint,z:number)=>`${Math.floor(p.x/endpointCell)}:${Math.floor(p.y/endpointCell)}:${Math.floor(z/endpointCell)}`,fieldEndpoints=new Map<string,{p:ArenaPoint;z:number;rail:ArenaRail}[]>();
 for(const rail of field.rails)for(const endpoint of[{p:{x:rail.ax,y:rail.ay},z:rail.elevation,rail},{p:{x:rail.bx,y:rail.by},z:rail.elevationB??rail.elevation,rail}]){const key=endpointKey(endpoint.p,endpoint.z),bucket=fieldEndpoints.get(key);if(bucket)bucket.push(endpoint);else fieldEndpoints.set(key,[endpoint]);}
 function* nearbyEndpoints(p:ArenaPoint,z:number){const x=Math.floor(p.x/endpointCell),y=Math.floor(p.y/endpointCell),height=Math.floor(z/endpointCell);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++)yield*(fieldEndpoints.get(`${x+dx}:${y+dy}:${height+dz}`)??[]);}
 const surfaces=new Map(field.surfaces.map(s=>[s.id,s])),rails=new Map(field.rails.map(s=>[s.id,s])),portMap=new Map(ports.map(p=>[p.id,p])),stationMap=new Map(field.stations.map(s=>[s.id,s]));
 // A warped ramp quad triangulates to different height fields depending on the
 // renderer's diagonal. Reject it instead of treating our fan as canonical.
 for(const surface of field.surfaces){const z=surface.vertexElevations;if(!z)continue;if(z.length!==surface.polygon.length||!z.every(Number.isFinite)){r.add('SURFACE_HEIGHTS',surface.id,'Vertex elevations must match all polygon vertices.');continue;}
  const a=surface.polygon[0];if(!a)continue;
  for(let i=1;i<surface.polygon.length-1;i++){const ab=sub(surface.polygon[i]!,a),ac=sub(surface.polygon[i+1]!,a),den=cross(ab,ac);if(Math.abs(den)<1e-9)continue;
   if(surface.polygon.some((p,j)=>{const ap=sub(p,a),u=cross(ap,ac)/den,v=cross(ab,ap)/den;return Math.abs(z[0]!*(1-u-v)+z[i]!*u+z[i+1]!*v-z[j]!)>t;}))r.add('SURFACE_NONPLANAR',surface.id,'Ramp vertices disagree with one height plane; triangulation changes support height.');break;
  }
 }
 if(portMap.size!==ports.length)r.add('DUPLICATE_PORT',field.id,'Port IDs are not unique.');
 if(new Set(paths.map(p=>p.id)).size!==paths.length)r.add('DUPLICATE_PATH',field.id,'Path IDs are not unique.');
 for(const port of ports){
  if(![port.x,port.y,port.elevation,port.clearWidth,port.maxBallRadius,port.tangent.x,port.tangent.y,port.admittedSpeed.min,port.admittedSpeed.max].every(Number.isFinite)){r.add('PORT_NONFINITE',port.id,'Port has non-finite physical values.');continue;}
  if(Math.abs(Math.hypot(port.tangent.x,port.tangent.y)-1)>.01)r.add('PORT_TANGENT',port.id,'Tangent is not normalized.');
  if(port.clearWidth<2*radius+2*t||port.maxBallRadius<radius)r.add('PORT_APERTURE',port.id,'Ball exceeds port aperture/radius.');
  if(port.admittedSpeed.min<0||port.admittedSpeed.min>port.admittedSpeed.max)r.add('PORT_SPEED',port.id,'Invalid admitted speed interval.');
  const beds=port.surfaceIds.flatMap(id=>{const s=surfaces.get(id);if(!s)r.add('PORT_SURFACE_MISSING',port.id,id);return s?[s]:[];});
  // Center plus aperture edges: detects wrong apron references and narrow beds.
  for(const offset of [-port.clearWidth/2,0,port.clearWidth/2]){const p={x:port.x-port.tangent.y*offset,y:port.y+port.tangent.x*offset};if(!supportAt(beds,p,port.layer,port.elevation,t)){r.add('PORT_SUPPORT',port.id,`Referenced surface does not support aperture offset ${offset}.`);break;}}
  if(port.receiverCatchId&&!stationMap.has(port.receiverCatchId))r.add('PORT_CATCH_MISSING',port.id,port.receiverCatchId);
 }
 for(const path of paths){
  if(path.vertices.length<2){r.add('PATH_VERTICES',path.id,'Path needs at least two vertices.');continue;}
  if(path.clearWidths&&(path.clearWidths.length!==path.vertices.length||path.clearWidths.some(w=>!Number.isFinite(w)||w<path.clearWidth||w>240)||Math.min(...path.clearWidths)!==path.clearWidth))r.add('PATH_WIDTH_PROFILE',path.id,'Width profile must match every vertex and declared minimum aperture.');
  if(path.clearWidth<2*radius+2*t)r.add('PATH_APERTURE',path.id,'Path is narrower than admitted ball diameter plus margin.');
  for(const id of path.surfaceIds)if(!surfaces.has(id))r.add('PATH_SURFACE_MISSING',path.id,id);
  const pathRails=path.colliderIds.flatMap(id=>{const rail=rails.get(id);if(!rail)r.add('PATH_RAIL_MISSING',path.id,id);return rail?[rail]:[];});
  const beds=path.surfaceIds.flatMap(id=>surfaces.has(id)?[surfaces.get(id)!]:[]);
  for(const [id,index,nextIndex]of [[path.entryPortId,0,1],[path.exitPortId,path.vertices.length-1,path.vertices.length-2]] as const){
   const port=portMap.get(id);if(!port){r.add('PATH_PORT_MISSING',path.id,id);continue;}
   const v=path.vertices[index]!,n=path.vertices[nextIndex]!,d=index===0?sub(n,v):sub(v,n),len=Math.hypot(d.x,d.y);
   if(port.mechanismId!==path.id||distance(v,port)>t||v.layer!==port.layer||Math.abs(v.elevation-port.elevation)>t||Math.abs(port.clearWidth-(path.clearWidths?.[index]??path.clearWidth))>t)r.add('PATH_PORT_PARITY',path.id,id);
   if(!len||distance(port.tangent,{x:d.x/len,y:d.y/len})>.01)r.add('PATH_PORT_DIRECTION',path.id,id);
   // Require references to cover the physical final/first segment, not an unrelated apron at its endpoint.
   const probe=mix(v,n,Math.min(.25,Math.max(4*t,1)/Math.max(len,1))),probeZ=v.elevation+(n.elevation-v.elevation)*Math.min(.25,Math.max(4*t,1)/Math.max(len,1));
   const references=port.surfaceIds.flatMap(sid=>surfaces.has(sid)?[surfaces.get(sid)!]:[]);
   if(!supportAt(references,probe,v.layer,probeZ,t))r.add('PORT_SEGMENT_SUPPORT',path.id,id);
  }
  // Exact rail-end pairing on every interior seam. Layer changes are permitted
  // only on a ramp at its physical midpoint, where the frozen solver changes layer.
  const endpoints=pathRails.flatMap(rail=>[{p:{x:rail.ax,y:rail.ay},z:rail.elevation,rail},{p:{x:rail.bx,y:rail.by},z:rail.elevationB??rail.elevation,rail}]);
  for(const e of endpoints){
   if([path.vertices[0]!,path.vertices.at(-1)!].some((v,index)=>distance(e.p,v)<=(path.clearWidths?.[index===0?0:path.vertices.length-1]??path.clearWidth)*.9+e.rail.radius))continue;
   const joined=[...nearbyEndpoints(e.p,e.z)].some(other=>other.rail.id!==e.rail.id&&distance(e.p,other.p)<=t&&Math.abs(e.z-other.z)<=t&&(e.rail.layer===other.rail.layer||field.ramps.some(s=>{const mid={x:(s.ax+s.bx)/2,y:(s.ay+s.by)/2};return distance(e.p,mid)<=s.width/2+8&&Math.abs(e.z-(s.fromElevation+s.toElevation)/2)<=t&&[s.fromLayer,s.toLayer].includes(e.rail.layer)&&[s.fromLayer,s.toLayer].includes(other.rail.layer);})));if(!joined)r.add('RAIL_SEAM',path.id,e.rail.id);
  }
  // Bounded centerline support samples detect gaps; they are not a swept-volume proof.
  for(let i=0;i<path.vertices.length-1;i++){const a=path.vertices[i]!,b=path.vertices[i+1]!;for(const f of [.125,.375,.625,.875]){const p=mix(a,b,f),layer=a.layer===b.layer?a.layer:f<.5?a.layer:b.layer,z=a.elevation+(b.elevation-a.elevation)*f;if(!supportAt(beds,p,layer,z,t)){r.add('PATH_SUPPORT_SAMPLE',path.id,`Segment ${i}, fraction ${f} lacks support at its declared height/layer.`);break;}}}
 }
 return r.finish();
}

/** Caller supplies the two actual straight throat guides. This is a local seal
 * check only: alternate entrances require explicit graph-cut and physical checks. */
export function inspectPinballGateThroat(gate:ArenaGate,guides:readonly [ArenaRail,ArenaRail],options:GeometryOptions):GeometryIssue[]{
 const {tolerance:t}=settings(options),r=recorder(),a={x:gate.ax,y:gate.ay},b={x:gate.bx,y:gate.by},len=distance(a,b);
 if(!len){r.add('GATE_DEGENERATE',gate.id,'Gate has no throat span.');return r.finish();}
 const axis={x:(b.x-a.x)/len,y:(b.y-a.y)/len};
 for(const guide of guides){
  if(guide.layer!==gate.layer||Math.abs(guide.elevation-gate.elevation)>t||Math.abs((guide.elevationB??guide.elevation)-gate.elevation)>t)r.add('GATE_GUIDE_HEIGHT',gate.id,guide.id);
  const start={x:guide.ax,y:guide.ay},end={x:guide.bx,y:guide.by},gl=distance(start,end);
  if(!gl||Math.abs(dot(axis,sub(end,start))/gl)>.05)r.add('GATE_THROAT_ORIENTATION',gate.id,guide.id);
 }
 const gap=(p:ArenaPoint,g:ArenaRail)=>segmentDistance(p,{x:g.ax,y:g.ay},{x:g.bx,y:g.by})-g.radius-gate.radius;
 const direct=Math.max(gap(a,guides[0]),gap(b,guides[1])),reverse=Math.max(gap(a,guides[1]),gap(b,guides[0]));
 // Require actual capsule overlap, stricter than a ball-radius-only seal.
 if(Math.min(direct,reverse)>t)r.add('GATE_SEAL_GAP',gate.id,'Gate capsules do not join both guides.');
 if(guides[0].id===guides[1].id)r.add('GATE_GUIDES_DUPLICATED',gate.id,'Two distinct throat guides are required.');
 return r.finish();
}

export interface GateCutGraph {readonly nodes:readonly string[];readonly edges:readonly {readonly id:string;readonly from:string;readonly to:string;readonly bidirectional:boolean;readonly gateIds:readonly string[]}[]}
/** Declared graph evidence ONLY. All physical entrances must already be represented.
 * Each removed edge must be backed by a separately checked physical throat seal. */
export function inspectPinballGateCut(graph:GateCutGraph,starts:readonly string[],locked:readonly string[],closedGateIds:readonly string[]):GeometryIssue[]{
 const r=recorder();if(graph.nodes.length>INPUT_LIMIT||graph.edges.length>INPUT_LIMIT||starts.length>INPUT_LIMIT||locked.length>INPUT_LIMIT||closedGateIds.length>INPUT_LIMIT||graph.edges.some(e=>e.gateIds.length>32)){r.add('GRAPH_LIMIT','graph','Graph inspection budget exceeded.');return r.finish();}
 const nodes=new Set(graph.nodes),closed=new Set(closedGateIds),adj=new Map<string,string[]>();
 for(const n of [...starts,...locked])if(!nodes.has(n))r.add('GRAPH_NODE_MISSING','graph',n);
 if(nodes.size!==graph.nodes.length||new Set(graph.edges.map(e=>e.id)).size!==graph.edges.length)r.add('GRAPH_DUPLICATE','graph','Graph IDs are not unique.');
 for(const edge of graph.edges){if(!nodes.has(edge.from)||!nodes.has(edge.to)){r.add('GRAPH_ENDPOINT_MISSING',edge.id,'Edge names absent node.');continue;}if(edge.gateIds.some(g=>closed.has(g)))continue;adj.set(edge.from,[...(adj.get(edge.from)??[]),edge.to]);if(edge.bidirectional)adj.set(edge.to,[...(adj.get(edge.to)??[]),edge.from]);}
 const seen=new Set(starts),queue=[...starts];for(let i=0;i<queue.length;i++)for(const next of adj.get(queue[i]!)??[])if(!seen.has(next)){seen.add(next);queue.push(next);}
 for(const node of locked)if(seen.has(node))r.add('GRAPH_LOCK_BYPASS',node,'Locked node remains reachable in declared graph with gates closed.');
 return r.finish();
}
