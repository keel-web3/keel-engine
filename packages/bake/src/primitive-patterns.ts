import type {SpecimenPart,SpecimenPattern,SpecimenV3} from './specimen-types.ts';
/** Expand a shared part into an exact reflection, row or horizontal ring.
 * The original is included. Joint/material references survive; reflected moving
 * joints must be authored explicitly rather than reflecting an animated bitmap. */
export function expandPrimitivePattern(p:SpecimenPattern):SpecimenPart[]{
 const r=p.repeat,count=r.kind==='mirror'?2:r.count;
 if(!Number.isInteger(count)||count<1||count>12)throw new Error('primitive pattern count 1..12');
 if(r.kind==='mirror'&&r.axis!==0&&r.axis!==2)throw new Error('mirror axis must be x or z');
 const out:SpecimenPart[]=[];
 for(let i=0;i<count;i++){
  const angle=r.kind==='ring'?i*Math.PI*2/count:0,c=Math.cos(angle),s=Math.sin(angle);
  const point=(v:SpecimenV3):SpecimenV3=>{
   if(r.kind==='mirror'){const q=[...v] as SpecimenV3;if(i)q[r.axis]*=-1;return q;}
   if(r.kind==='line')return v.map((x,k)=>x+i*r.step[k]!) as SpecimenV3;
   const x=v[0]-r.center[0],z=v[2]-r.center[2];return [r.center[0]+x*c+z*s,v[1],r.center[2]-x*s+z*c];
  };
  const a=p.part;out.push(a.kind==='capsule'?{...a,a:point(a.a),b:point(a.b)}:{...a,c:point(a.c),h:[...a.h],yaw:r.kind==='mirror'&&i?(r.axis===0?-a.yaw:Math.PI-a.yaw):a.yaw+angle});
 }
 return out;
}
export function specimenParts(p:{parts:SpecimenPart[];patterns?:SpecimenPattern[]}):SpecimenPart[]{
 const parts=[...p.parts,...(p.patterns??[]).flatMap(expandPrimitivePattern)];if(parts.length<1||parts.length>64)throw new Error('expanded specimen part budget 1..64');return parts;
}
