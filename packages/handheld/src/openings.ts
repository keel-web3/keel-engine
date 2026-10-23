// Subtract convex aperture outlines from a shell wall. Keep the canonical
// geometry and interpolate its attributes at the cuts; sockets supply the walls.
import {MeshBuilder} from '@keel-engine/studio';
import type {MeshData,Vec2} from '@keel-engine/studio';
export interface Aperture {axis:0|1;sign:1|-1;outline:readonly Vec2[]}
type Vertex=number[];
export function cutOpenings(source:MeshData,holes:readonly Aperture[]):MeshData{
 const result=new MeshBuilder();
 const vertex=(id:number):Vertex=>[...source.positions.subarray(id*3,id*3+3),...source.normals.subarray(id*3,id*3+3),...source.uvs.subarray(id*2,id*2+2),source.ao[id]??1];
 for(let k=0;k<source.indices.length;k+=3){let pieces=[Array.from(source.indices.subarray(k,k+3),vertex)];
  for(const hole of holes){const axis=hole.axis,sign=hole.sign,axes=axis===0?[1,2]:[0,2];
   if(pieces[0]!.reduce((n,v)=>n+v[axis]!,0)*sign<=0)continue;
   const poly=hole.outline,area=poly.reduce((n,a,i)=>{const b=poly[(i+1)%poly.length]!;return n+a[0]*b[1]-b[0]*a[1];},0),direction=area>=0?1:-1;
   const lo=[0,1].map(i=>Math.min(...poly.map(p=>p[i]!))),hi=[0,1].map(i=>Math.max(...poly.map(p=>p[i]!)));
   const next:Vertex[][]=[];
   for(const original of pieces){if(axes.some((a,i)=>Math.max(...original.map(v=>v[a]!))<lo[i]!-1e-6||Math.min(...original.map(v=>v[a]!))>hi[i]!+1e-6)){next.push(original);continue;}let remaining=original;
    for(let edge=0;edge<poly.length&&remaining.length;edge++){const a=poly[edge]!,b=poly[(edge+1)%poly.length]!,inside:Vertex[]=[],outside:Vertex[]=[];
     const distance=(v:Vertex)=>direction*((b[0]-a[0])*(v[axes[1]!]!-a[1])-(b[1]-a[1])*(v[axes[0]!]!-a[0]));
     for(let j=0;j<remaining.length;j++){const p=remaining[j]!,q=remaining[(j+1)%remaining.length]!,dp=distance(p),dq=distance(q);(dp>=0?inside:outside).push(p);
      if((dp>=0)!==(dq>=0)){const t=dp/(dp-dq),v=p.map((x,i)=>x+(q[i]!-x)*t);inside.push(v);outside.push(v);}}
     if(outside.length>=3)next.push(outside);remaining=inside;
    }
   }pieces=next;if(!pieces.length)break;
  }
  for(const p of pieces){const start=result.count;for(const v of p)result.vertex(v[0]!,v[1]!,v[2]!,v[3]!,v[4]!,v[5]!,v[6]!,v[7]!,v[8]!);for(let j=1;j<p.length-1;j++)result.tri(start,start+j,start+j+1);}
 }
 return result.done();
}
