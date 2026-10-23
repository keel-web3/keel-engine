import {createRoll,deriveSeed} from '@keel-engine/core';
import {lookMesh,type BakeWorld,type LookMesh} from '@keel-engine/bake';
import {slotOf} from '@keel-engine/object';
import {ARENA_CONTENT_LIMITS,type ArenaField,type ArenaSurface} from '@keel-engine/pinball-arena';
import {pinballEnvironmentClear,pinballThemeFromBiome,pinballCatchFronts,pinballCatchFrontClear,type PinballSceneGenome} from '@keel-engine/pinball-world-art';
import {ARENA_STRUCTURE_ROLES,arenaFoundationHeight} from './structural-art.ts';

export const ARENA_BACKDROP_REVISION='arena-backdrop/2026-10-07.1';
export interface ArenaBackdropArchitecture {
 readonly revision:typeof ARENA_BACKDROP_REVISION;
 readonly theme:string;
 readonly mesh:LookMesh;
 readonly sections:number;
 readonly rejectedSections:number;
 readonly primitives:number;
 readonly lightSockets:readonly {readonly pos:readonly [number,number,number];readonly role:'core'|'trim'}[];
}

/** One designed perimeter gallery for a real chamber, merged into one upload.
 * Solids reserve their complete native footprint outside every bed and track.
 * The shapes are scenic architecture: they provide no support or collision and
 * never invent another playable table. All details retain a shared seed/basis.
 * The chamber must be the exact surface descriptor in this field; an ID alone
 * does not authorize a detached or modified plane. Consumers must apply native
 * body/pair cutaways and optional scenery budgets. */
export function arenaChamberBackdrop(field:ArenaField,chamber:ArenaSurface,scale:number,scene:PinballSceneGenome,detail:0|1|2=1):ArenaBackdropArchitecture {
 if(!Number.isFinite(scale)||scale<.001||scale>1||![0,1,2].includes(detail)||!field.surfaces.includes(chamber)||chamber.kind!=='playfield')throw new RangeError('Backdrop requires the actual bounded chamber descriptor');
 const bounded=(n:number,max:number)=>Number.isFinite(n)&&n>=0&&n<=max;
 // Foundation height depends on every native surface, not only this chamber.
 // Check the source envelope before generating any Float32 mesh coordinates.
 for(const surface of field.surfaces){
  if(surface.polygon.length<3||surface.polygon.length>32||!Number.isInteger(surface.layer)||surface.layer<0||surface.layer>=ARENA_CONTENT_LIMITS.layers||!bounded(surface.height,ARENA_CONTENT_LIMITS.elevation)||surface.vertexElevations&&(surface.vertexElevations.length!==surface.polygon.length||surface.vertexElevations.some(n=>!bounded(n,ARENA_CONTENT_LIMITS.elevation)))||surface.polygon.some(q=>!bounded(q.x,ARENA_CONTENT_LIMITS.coordinate)||!bounded(q.y,ARENA_CONTENT_LIMITS.coordinate)))throw new RangeError('Backdrop surface exceeds the native coordinate envelope');
 }
 const theme=pinballThemeFromBiome(scene.biome),boxes:NonNullable<BakeWorld['boxes']>[number][]=[],capsules:NonNullable<BakeWorld['capsules']>[number][]=[],lightSockets:{pos:readonly [number,number,number];role:'core'|'trim'}[]=[];
 const p=chamber.polygon,heights=chamber.vertexElevations??p.map(()=>chamber.height),bottom=arenaFoundationHeight(field,scene),fronts=pinballCatchFronts(field),area=p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length]!;return sum+a.x*b.y-b.x*a.y;},0),winding=Math.sign(area);
 if(!winding||!Number.isFinite(bottom)||Math.abs(bottom)>ARENA_CONTENT_LIMITS.coordinate)throw new RangeError('Backdrop foundation must be finite and bounded');
 let sections=0,rejectedSections=0;
 const mat=(role:keyof typeof ARENA_STRUCTURE_ROLES)=>slotOf(ARENA_STRUCTURE_ROLES,role);
 for(let edge=0;edge<p.length&&sections<16;edge++){
  const a=p[edge]!,b=p[(edge+1)%p.length]!,dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(len<120)continue;
  const tx=dx/len,ty=dy/len,nx=winding*ty,ny=-winding*tx,count=Math.min(4,Math.max(1,Math.ceil(len/520))),span=len/count;
  for(let index=0;index<count&&sections<16;index++){
   const roll=createRoll(deriveSeed(scene.seed,`${ARENA_BACKDROP_REVISION}/${chamber.id}/${edge}/${index}`)),t=(index+.5)/count,edgeHeight=heights[edge]!+(heights[(edge+1)%p.length]!-heights[edge]!)*t;
   const width=span*.90,depth=theme==='nature'?110:theme==='gold'?98:84,top=edgeHeight+80+roll.index(0,81),height=top-bottom;
   const reservedWidth=width+depth*.7,footprint=Math.hypot(reservedWidth*.5,depth);
   // Cover the entire section with overlapping reservation discs. This is
   // conservative for all its boxes/curves, including detail-2 ornaments.
   const samples=Math.max(2,Math.ceil(reservedWidth/60)),radius=depth+reservedWidth/samples*.5,outward=radius+32,center=[a.x+dx*t+nx*outward,a.y+dy*t+ny*outward] as const;
   let clear=true;
   for(let s=0;s<=samples;s++){const along=-reservedWidth*.5+reservedWidth*s/samples;if(!pinballEnvironmentClear(field,{x:center[0]+tx*along,y:center[1]+ty*along},radius,24)){clear=false;break;}}
   // A full bank opening is architectural. Local moving-body apertures cannot
   // justify a wall across the pair's downfield view or drain/discharge fan.
   if(!clear||height<80||footprint>1000||!pinballCatchFrontClear(fronts,{x:center[0],y:center[1]},footprint,chamber.layer,edgeHeight,top)){rejectedSections++;continue;}sections++;
   const point=(x:number,y:number,z:number):readonly [number,number,number]=>[(center[0]+tx*x*width+nx*z*depth)*scale,(bottom+y*height)*scale,(center[1]+ty*x*width+ny*z*depth)*scale];
   const box=(role:keyof typeof ARENA_STRUCTURE_ROLES,x:number,y:number,z:number,hx:number,hy:number,hz:number)=>boxes.push({c:point(x,y,z),h:[hx*width*scale,hy*height*scale,hz*depth*scale],yaw:-Math.atan2(dy,dx),mat:mat(role)});
   const tube=(role:keyof typeof ARENA_STRUCTURE_ROLES,a:readonly [number,number,number],b:readonly [number,number,number],r:number)=>capsules.push({a:point(...a),b:point(...b),r:r*depth*scale,mat:mat(role)});
   const socket=(x:number,y:number,z:number,role:'core'|'trim')=>lightSockets.push({pos:point(x,y,z),role});
   const crown=.82+roll.index(1,21)/100,lean=(roll.index(2,21)-10)/100;
   if(theme==='nature'){
    // Braided retaining roots rise from the same ravine as the real cabinet.
    // Long continuous branches and asymmetric shelves replace floating plants.
    tube('stone',[-.35,.16,.28],[.31,.22,.30],.32);
    tube('bark',[-.47,.08,.08],[.25,.62,-.12],.18);
    tube('bark',[.47,.07,.20],[-.25,crown,-.10],.16);
    tube('bark',[-.25,crown,-.10],[.32,.98,.05],.10);
    tube('bark',[.25,.62,-.12],[.44,.78,-.13],.09);
    if(detail>=1){
     tube('leaf',[-.43,.42,-.17],[-.12,.48,-.25],.075);
     tube('leaf',[.11,.69,-.18],[.40,.73,-.22],.07);
     tube('stone',[.20,.20,.05],[.41,.33,.13],.15);
    }
    if(detail>=2)for(let i=0;i<5;i++){
     const x=-.36+i*.16,y=.38+Math.sin(i*1.4+lean)*.08;
     tube('bark',[x,y,-.16],[x+.04,y+.19,-.31],.018);
     tube('leaf',[x+.04,y+.19,-.31],[x+.13,y+.22,-.32],.028);
    }
   }else if(theme==='vapor'){
    // Broad pastel shell ribs, recessed bands and a few prismatic pendants.
    box('body',0,.18,.20,.48,.16,.36);
    for(const x of [-.36,0,.36]){
     tube('body',[x,.12,.17],[x+lean*.4,.56,-.18],.15);
     tube('trim',[x+lean*.4,.56,-.18],[x+.08,crown,.06],.10);
    }
    tube('steel',[-.44,crown,.06],[.44,crown,.06],.07);
    if(detail>=1)for(let i=0;i<4;i++)tube(i%2?'trim':'steel',[-.40,.24+i*.09,-.20],[.40,.24+i*.09,-.20],.018);
    if(detail>=2){tube('core',[-.43,crown+.03,-.10],[.43,crown+.03,-.10],.02);socket(0,crown+.04,-.12,'trim');}
   }else if(theme==='gold'){
    // A vaulted, stepped plinth with flutes and a true recessed central bay.
    box('stone',0,.11,.15,.49,.10,.46);
    for(const x of [-.38,.38]){box('stone',x,.50,.12,.10,.36,.34);box('gold',x,crown,.10,.13,.025,.40);}
    box('stone',0,crown,.12,.49,.045,.36);
    box('dark',0,.50,.23,.24,.24,.10);
    if(detail>=1)for(const x of [-.42,-.35,.35,.42])box('gold',x,.49,-.25,.013,.32,.035);
    if(detail>=2){box('gold',0,.76,-.23,.24,.012,.018);box('gold',0,.28,-.23,.24,.012,.018);socket(0,.75,-.29,'trim');}
   }else if(theme==='crypto'){
    // Interlocked key trusses and inset etched cassettes, no city buildings.
    box('dark',0,.18,.17,.48,.16,.39);
    tube('steel',[-.45,.12,.14],[-.15,crown,-.10],.08);
    tube('steel',[.45,.12,.14],[.15,crown,-.10],.08);
    for(const side of [-1,1]){
     tube('gold',[side*.15,crown,-.12],[side*.39,.62,-.20],.05);
     tube('rail',[side*.39,.62,-.20],[side*.15,.36,-.13],.05);
    }
    if(detail>=1)for(const x of [-.22,0,.22])box('body',x,.47,-.12,.075,.13,.06);
    if(detail>=2){tube('core',[-.42,.26,-.25],[.42,.26,-.25],.025);socket(0,.27,-.27,'core');}
   }else{
    // Cyber service galleries and industrial heatworks have different primary
    // silhouettes, not merely the same cubes wearing a different palette.
    box('dark',0,.43,.23,.49,.40,.34);
    for(const x of [-.43,.43])box(theme==='cyber'?'body':'steel',x,.48,.07,.055,.45,.39);
    box(theme==='cyber'?'body':'steel',0,.09,.04,.49,.06,.47);
    box(theme==='cyber'?'body':'steel',0,crown,.04,.49,.04,.40);
    if(theme==='cyber'){
     tube('rail',[-.32,.21,-.17],[-.32,.69,-.17],.075);
     tube('rail',[.32,.21,-.17],[.32,.69,-.17],.075);
     box('body',0,.52,-.17,.20,.17,.12);
     if(detail>=1)for(let i=0;i<4;i++)box('steel',0,.42+i*.05,-.30,.16,.008,.018);
     if(detail>=2){tube('core',[-.38,crown-.10,-.29],[.38,crown-.10,-.29],.022);box('trim',-.22,.29,-.31,.10,.018,.018);socket(.12,crown-.10,-.31,'core');}
    }else{
     for(const x of [-.27,0,.27])tube('steel',[x,.16,-.14],[x,crown-.10,-.14],.09);
     if(detail>=1)for(let i=0;i<5;i++)box('rail',0,.30+i*.075,-.26,.40,.015,.032);
     if(detail>=2){box('trim',0,.22,-.29,.39,.022,.021);socket(-.25,.23,-.31,'trim');}
    }
   }
  }
 }
 const mesh=lookMesh({boxes,capsules},{around:detail===0?6:detail===1?8:12,rings:detail===2?2:1});
 if(mesh.indices.length/3>30000)throw new RangeError('Backdrop architecture triangle cap');
 return {revision:ARENA_BACKDROP_REVISION,theme,mesh,sections,rejectedSections,primitives:boxes.length+capsules.length,lightSockets};
}
