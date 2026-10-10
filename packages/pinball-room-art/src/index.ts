export{prepareNativeTrackShell,paintNativeTrackShell}from'./track-shell.ts';
export{paintNativeTrackGrating}from'./track-grating.ts';
export type{NativeTrackShellMaterial,NativeTrackShellPlan}from'./track-shell.ts';
export{prepareNativeTubeVolume,paintNativeTubeVolume}from'./tube-volume.ts';
export type{NativeTubeVolumePlan}from'./tube-volume.ts';
export{createTubeMaterialSampler}from'./tube-material.ts';
export type{TubeMaterialFace,TubeMaterialSampler}from'./tube-material.ts';
export{manifest}from'./module.ts';
export{paintWorkingBlade,paintRoomWorkingBlades}from'./blade-art.ts';
import{createRoll,deriveSeed,dhypot,dsin}from'@keel-engine/core';
import type{ArenaWorldDefinition,ArenaField,ArenaFrame}from'@keel-engine/pinball-arena';
import type{PinballFeedbackSample}from'@keel-engine/pinball-feedback';
import{PixelCanvas}from'@keel-engine/pinball-pixel-art';
export type RoomArtTheme='ion-relay'|'grove'|'vaporwave';
export type RoomProjection=(x:number,y:number,z:number)=>readonly[number,number];
const colours={
 'ion-relay':['060b1c','0c1630','162c4a','25435b','42687c','91b8c7','d1f3ee','fff2d0','102c3c','135566','14838c','36c9b4','a4f0cf','291526','592c35','9e483c','e77a40','ffc66b','ffe7ad','fff7d9','063744','076177','08a4b9','3ce5e4','b4fff2','2e1546','59285f','a44382','ef79a3','ffd0d5','050b1a','ffffff'],
 'grove':['07151a','0a2528','193c36','315a46','658667','a6c59c','e1eac0','fff1c6','123d32','1e5941','3e9254','78c35c','c8eb8b','30201e','573828','96623b','c78c42','ebbc6c','ffe3a6','fff4d4','103a45','176576','26a6a4','68d4ba','c4ffe1','342144','63415a','a86679','db9e99','ffd1b8','06141a','ffffff'],
 'vaporwave':['120b2c','23143f','352650','4c396d','716296','afa8cb','e6e7f4','fff5e0','202151','344076','416baa','79ade0','c0e9ff','381047','611962','993081','d458aa','f798ce','ffd5ec','fff6f5','073c60','076d93','18abcc','6be4f0','d5ffff','391445','722665','bb4b96','f58bc5','ffd4ee','100e2b','ffffff']
}as const;
export function roomArtPalette(theme:RoomArtTheme){if(!Object.hasOwn(colours,theme))throw Error('Room art theme');return colours[theme].map(c=>Object.freeze([parseInt(c.slice(0,2),16),parseInt(c.slice(2,4),16),parseInt(c.slice(4,6),16)]as const));}
export function planRoomArt(world:ArenaWorldDefinition,field:ArenaField,bedId:string,stationId:string,theme:RoomArtTheme,bankGuideIds:readonly string[]=[]){
 roomArtPalette(theme);if(!world.arenas.includes(field))throw Error('Room art field membership');const bed=field.surfaces.find(v=>v.id===bedId),station=field.stations.find(v=>v.id===stationId);if(!bed||!station||bed.kind!=='playfield'||bed.layer!==station.layer||bed.height!==(station.elevation??0)||bed.polygon.length!==4)throw Error('Room art native bed/bank');
 const points=bed.polygon;for(let i=0;i<4;i++){const a=points[i]!,b=points[(i+1)%4]!;if(!Number.isFinite(a.x)||!Number.isFinite(a.y)||Math.abs(a.x)>1e7||Math.abs(a.y)>1e7||(a.x===b.x)===(a.y===b.y))throw Error('Room rectangle edges');}
 const x0=Math.min(...points.map(v=>v.x)),x1=Math.max(...points.map(v=>v.x)),y0=Math.min(...points.map(v=>v.y)),y1=Math.max(...points.map(v=>v.y));if(new Set(points.map(v=>v.x+'/'+v.y)).size!==4||x1-x0<64||y1-y0<64||x1-x0>4096||y1-y0>4096||station.x<x0||station.x>x1||station.y<y0||station.y>y1)throw Error('Room rectangle bounds');
 const pair=station.flipperIds.map(id=>field.flippers.find(v=>v.id===id));if(pair.length!==2||pair.some(v=>!v))throw Error('Room native pair');const bankCenter={x:pair.reduce((sum,v)=>sum+v!.pivotX,0)/2,y:pair.reduce((sum,v)=>sum+v!.pivotY,0)/2};
 const inside=(x:number,y:number)=>x>=x0&&x<=x1&&y>=y0&&y<=y1,at=(layer:number,z:number|undefined)=>layer===bed.layer&&(z??0)===bed.height;
 const targets=field.rails.filter(v=>v.kind==='target'&&at(v.layer,v.elevation)&&inside(v.ax,v.ay)&&inside(v.bx,v.by));
 const springs=field.bumpers.filter(v=>at(v.layer,v.elevation)&&inside(v.x,v.y));
 if(targets.length>32||springs.length>32||bankGuideIds.length>64||new Set(bankGuideIds).size!==bankGuideIds.length)throw Error('Room art mechanism budget');
 const captures=(field.captures??[]).filter(v=>{const p=field.pinball?.ports.find(p=>p.id===v.entryPortId);return p&&at(p.layer,p.elevation)&&inside(p.x,p.y);});
 const seed=deriveSeed(world.seed,bedId+'/'+theme),roll=createRoll(seed),nodes=[...targets.map(v=>({id:v.id,kind:'target' as const,x:(v.ax+v.bx)/2,y:(v.ay+v.by)/2})),...springs.map(v=>({id:v.id,kind:'spring' as const,x:v.x,y:v.y}))];
 const bankEdges=[...targets,...bankGuideIds.map(id=>{const q=field.rails.find(v=>v.id===id);if(!q||q.kind!=='guide'||!at(q.layer,q.elevation)||!inside(q.ax,q.ay)||!inside(q.bx,q.by))throw Error('Native bank guide membership');return q;})];
 const rearBoundary:{x:number;y:number}[]=[];if(bankGuideIds.length){let current=bankEdges.flatMap(v=>[{x:v.ax,y:v.ay},{x:v.bx,y:v.by}]).find(v=>v.x===x0);if(!current)throw Error('Native bank left boundary');rearBoundary.push(current);const used=new Set<string>();for(let n=0;n<bankEdges.length;n++){const edge=bankEdges.find(v=>!used.has(v.id)&&((v.ax===current!.x&&v.ay===current!.y)||(v.bx===current!.x&&v.by===current!.y)));if(!edge)throw Error('Native bank disconnected');used.add(edge.id);current=edge.ax===current.x&&edge.ay===current.y?{x:edge.bx,y:edge.by}:{x:edge.ax,y:edge.ay};rearBoundary.push(current);}}
 // Topology is source-derived. Artwork edges never imply a new physical path.
 const graph=nodes.filter(v=>v.y>bankCenter.y+190).sort((a,b)=>a.x-b.x||a.y-b.y).map((v,i,all)=>({sourceId:v.id,parentId:i?all[i-1]!.id:null,construction:theme==='ion-relay'?'laminated-induction-cell':theme==='grove'?'root-karst-pocket':'glazed-resonator',variant:roll.index(i,3)}));
 const primarySpringIds=springs.filter(v=>v.y>bankCenter.y+190).map(v=>v.id);const workingTopology={kind:primarySpringIds.length>1?'coupled-pressure-disks' as const:'relay-bank' as const,primarySpringIds,targetIds:targets.map(v=>v.id),outboundCaptureIds:captures.map(v=>v.id)};
 return{worldSha256:world.sha256,arenaId:field.id,bed,station,bankCenter,theme,seed,workingTopology,bounds:[x0,y0,x1,y1]as const,targets,springs,captures,nodes,graph,rearBoundary,bankGuideIds:[...bankGuideIds],achievementRoutes:(field.challenges??[]).filter(v=>targets.some(t=>t.id===v.finalColliderId)||springs.some(t=>t.id===v.finalColliderId)).map(v=>({id:v.id,colliderId:v.finalColliderId})),raisedHousingAdmitted:false as const};
}
export type RoomArtPlan=ReturnType<typeof planRoomArt>;
export{paintIndexedRoomAssembly as paintRoomConstruction,roomAssemblyCacheStats,clearRoomAssemblyCache,ROOM_MATERIAL_CELLS}from'./bank-assembly.ts';
/** Indexed working spring cap stays wholly inside the source collision disk. */
export function paintWorkingSpring(p:PixelCanvas,theme:RoomArtTheme,cx:number,cy:number,radius:number,recoil=0,pulse=0){
 roomArtPalette(theme);if(![cx,cy,radius,recoil,pulse,p.offsetX,p.offsetY].every(Number.isFinite)||Math.abs(cx)+radius>1e6||Math.abs(cy)+radius>1e6||Math.abs(p.offsetX)>1e6||Math.abs(p.offsetY)>1e6||radius<=0||radius>256||recoil<0||recoil>1||pulse<0||pulse>1||p.palette.length<32)throw Error('Working spring arguments');
 // Scan INTEGER source cells, even for fractional translations. The visible
 // preimage follows canonical dot's Math.round, including the -.5 boundary.
 const minX=Math.max(Math.ceil(-p.offsetX-.5),Math.floor(cx-radius)),maxX=Math.min(Math.ceil(p.W-p.offsetX-.5)-1,Math.ceil(cx+radius)),minY=Math.max(Math.ceil(-p.offsetY-.5),Math.floor(cy-radius)),maxY=Math.min(Math.ceil(p.H-p.offsetY-.5)-1,Math.ceil(cy+radius));
 for(let yy=minY;yy<=maxY;yy++)for(let xx=minX;xx<=maxX;xx++){const dx=(xx-cx)/radius,dy=(yy-cy)/radius,d=dx*dx+dy*dy;if(d>1)continue;let ink=1;
 if(theme==='ion-relay'){if(d<.86)ink=dy<-.40?6:dy<.20?4:3;if(Math.abs(dx)>.25&&Math.abs(dx)<.68&&Math.abs(dy)<.65){const row=Math.floor((dy+1)*10+recoil*2);ink=row%3===0?1:row%3===1?16:18;}if(Math.abs(dx)<.23&&Math.abs(dy)<.73)ink=dx<-.05?6:dx<.10?5:3;if(Math.abs(dy+.20-recoil*.20)<.17&&Math.abs(dx)<.58)ink=pulse>.2?24:6;if(d>.65&&d<.80&&Math.abs(dx+dy)<.12)ink=7;}
 else if(theme==='grove'){if(d<.87)ink=dx+dy<-.3?5:dx+dy<.50?4:3;if(Math.abs(dx*.8+dy*.6)<.11||Math.abs(dx*.5-dy*.8+.18)<.09)ink=2;if(d<.22){ink=pulse>.2?24:10;if(dy<-.14+recoil*.15)ink=12;}}
 else{if(d<.86)ink=dx+dy<-.5?18:dx+dy<.25?16:14;if(d<.44)ink=20;if(d<.29)ink=dx-dy<0?21:22;if(Math.abs(dx+dy-recoil*.2)<.18&&d<.42)ink=pulse>.2?24:18;if(dx<-.1&&dy<-.1&&d<.34)ink=23;}
 p.dot(xx,yy,ink);}
 return{bounds:[cx-radius,cy-radius,cx+radius,cy+radius]as const,workingDiskExact:true};
}
function workingTargetGeometry(p:PixelCanvas,a:readonly[number,number],b:readonly[number,number],radius:number,pulse:number,complete:boolean){
 const point=(q:readonly[number,number])=>{if(!Array.isArray(q)||q.length!==2||![0,1].every(i=>Object.hasOwn(q,i)&&Number.isFinite(q[i])&&Math.abs(q[i]!)<=1e6))throw Error('Working target dense endpoint');return[q[0],q[1]]as const;};
 const A=point(a),B=point(b),span=Math.max(Math.abs(B[0]-A[0]),Math.abs(B[1]-A[1]));
 if(![radius,pulse,p.offsetX,p.offsetY].every(Number.isFinite)||Math.abs(p.offsetX)>1e6||Math.abs(p.offsetY)>1e6||radius<=0||radius>32||pulse<0||pulse>1||typeof complete!=='boolean'||span>8192||(Math.ceil(span)+1)*Math.max(1,Math.ceil(radius*2)**2)>1048576||p.palette.length<32)throw Error('Working target arguments');
 return{a:A,b:B};
}
export function paintWorkingTarget(p:PixelCanvas,theme:RoomArtTheme,a:readonly[number,number],b:readonly[number,number],radius:number,pulse=0,complete=false){
 roomArtPalette(theme);const checked=workingTargetGeometry(p,a,b,radius,pulse,complete);a=checked.a;b=checked.b;const d=dhypot(b[0]-a[0],b[1]-a[1]);if(!d)return;const ink=pulse>.1?24:complete?18:theme==='grove'?12:theme==='vaporwave'?17:18;
 p.line(...a,...b,1,radius*2);p.line(...a,...b,ink,Math.max(1,radius*1.25));
 // Exact two-sided face with separated contact glints, never eight fake goals.
 for(const t of[.15,.55,.86])p.dot(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,pulse>.1?31:19);
}
export function paintRoomWorkingParts(p:PixelCanvas,plan:RoomArtPlan,inputProject:RoomProjection,scale:number,frame:ArenaFrame,feedback:PinballFeedbackSample,reducedMotion=false,ownerId=0){
 if(!Number.isFinite(scale)||scale<=0||scale>4||typeof reducedMotion!=='boolean'||!Number.isSafeInteger(ownerId)||ownerId<0||p.palette.length<32)throw Error('Room working scale');roomArtPalette(plan.theme);
 const project:RoomProjection=(x,y,z)=>{const q=inputProject(x,y,z);if(!Array.isArray(q)||q.length!==2||![0,1].every(i=>Object.hasOwn(q,i)&&Number.isFinite(q[i])&&Math.abs(q[i]!)<=1e6))throw Error('Working part dense projection');return[q[0],q[1]];};
 const state=(id:string)=>{const m=feedback.mechanisms.find(v=>v.id===id),recoil=m?.recoil??0,pulse=m?.pulse??0;if(!Number.isFinite(recoil)||!Number.isFinite(pulse))throw Error('Working feedback state');return[reducedMotion?0:Math.max(0,Math.min(1,recoil)),reducedMotion?0:Math.max(0,Math.min(1,pulse))]as const;};
 // All callback results, source radii and feedback values are admitted before
 // the first pixel write. A late invalid second mechanism cannot half-paint.
 if(![p.offsetX,p.offsetY].every(Number.isFinite)||Math.abs(p.offsetX)>1e6||Math.abs(p.offsetY)>1e6)throw Error('Working pixel offsets');
 const springs=plan.springs.map(s=>{const q=project(s.x,s.y,s.elevation??0),r=s.radius*scale,[recoil,pulse]=state(s.id);if(!Number.isFinite(r)||r<=0||r>256||Math.abs(q[0])+r>1e6||Math.abs(q[1])+r>1e6)throw Error('Working spring radius');return{q,r,recoil,pulse};});
 const targets=plan.targets.map(t=>{const a=project(t.ax,t.ay,t.elevation??0),b=project(t.bx,t.by,t.elevationB??t.elevation??0),radius=t.radius*scale,[,pulse]=state(t.id),complete=plan.achievementRoutes.some(v=>v.colliderId===t.id&&frame.routeProgress.some(q=>q.ownerId===ownerId&&q.routeId===v.id&&q.completed)),checked=workingTargetGeometry(p,a,b,radius,pulse,complete);return{...checked,radius,pulse,complete};});
 for(const s of springs)paintWorkingSpring(p,plan.theme,s.q[0],s.q[1],s.r,s.recoil,s.pulse);
 for(const t of targets)paintWorkingTarget(p,plan.theme,t.a,t.b,t.radius,t.pulse,t.complete);
}
export{paintNativePathDeck}from'./path-deck.ts';
