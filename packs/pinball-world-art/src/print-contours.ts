import type { PinballScenePrint } from "./scenes.ts";
type Point = readonly [number, number];
export interface PinballPrintContour { readonly points: readonly Point[]; readonly role: PinballScenePrint["role"] }
const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
const cross = (a: Point, b: Point, c: Point) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
/** A closed contiguous same-material sequence is a panel. Admission checks
 * the whole contour before any consumer attempts to triangulate its paint. */
export function pinballPrintContours(primitives: readonly PinballScenePrint[]): readonly PinballPrintContour[] {
  const panels: PinballPrintContour[] = [];
  for (let i=0;i<primitives.length;i++) {
    const first=primitives[i]!, points: Point[]=[first.a,first.b]; let end=i;
    while (!same(points[0]!,points[points.length-1]!) && end+1<primitives.length) { const next=primitives[end+1]!; if(next.role!==first.role || !same(next.a,points[points.length-1]!)) break; points.push(next.b);end++; }
    if(!same(points[0]!,points[points.length-1]!)) continue;
    points.pop();
    if(points.length<3 || new Set(points.map(p=>`${p[0]},${p[1]}`)).size!==points.length || Math.abs(points.reduce((a,p,j)=>{const q=points[(j+1)%points.length]!;return a+p[0]*q[1]-q[0]*p[1];},0))<1e-7) throw new RangeError("Pinball printed panel needs a simple nonzero contour");
    for(let a=0;a<points.length;a++) for(let b=a+1;b<points.length;b++) { if(b===a+1 || a===0&&b===points.length-1) continue; const p=points[a]!,q=points[(a+1)%points.length]!,r=points[b]!,s=points[(b+1)%points.length]!;
      if(Math.max(p[0],q[0])<Math.min(r[0],s[0]) || Math.max(r[0],s[0])<Math.min(p[0],q[0]) || Math.max(p[1],q[1])<Math.min(r[1],s[1]) || Math.max(r[1],s[1])<Math.min(p[1],q[1])) continue;
      if(cross(p,q,r)*cross(p,q,s)<=0 && cross(r,s,p)*cross(r,s,q)<=0) throw new RangeError("Pinball printed panel intersects itself");
    }
    panels.push({points,role:first.role});i=end;
  }
  return panels;
}
