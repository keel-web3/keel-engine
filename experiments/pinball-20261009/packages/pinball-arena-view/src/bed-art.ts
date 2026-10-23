import { bodySpace, meshBounds, type LookMesh } from "@keel-engine/bake";
import { slotOf } from "@keel-engine/object";
import { FIELD_ROLES, pinballThemeFromBiome, pinballPrintContours, type PinballSceneGenome } from "@keel-engine/pinball-world-art";
import type { ArenaPoint, ArenaSurface, ArenaField } from "@keel-engine/pinball-arena";
import { triangulateArenaPolygon } from "./geometry.ts";
import { arenaCatchYaw } from "./camera.ts";
import { createRoll, deriveSeed } from "@keel-engine/core";

const inside = (p: ArenaPoint, polygon: readonly ArenaPoint[]): boolean => {
  let value = false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) value = !value;
  }
  return value;
};
const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

/** Coplanar support/fan pieces share the receiving bank's whole-field canvas.
 * Overlapping native polygons therefore continue one composition rather than
 * repeating a decorative tile at each support edge. */
export function arenaBedPrintCanvas(surface: ArenaSurface, field?: ArenaField, seed?: string) {
  const center = surface.polygon.reduce((a,p)=>({x:a.x+p.x/surface.polygon.length,y:a.y+p.y/surface.polygon.length}),{x:0,y:0});
  const bank = field?.stations.filter(s=>s.layer===surface.layer && Math.abs(s.elevation-surface.height)<2).sort((a,b)=>Math.hypot(a.x-center.x,a.y-center.y)-Math.hypot(b.x-center.x,b.y-center.y))[0];
  const source = bank && field?.surfaces.find(s=>s.id===`${bank.id}.fan`) || surface;
  const yaw = field && bank ? arenaCatchYaw(field,bank) : 0, co=Math.cos(yaw),si=Math.sin(yaw),origin=bank??center;
  const local=source.polygon.map(p=>({x:co*(p.x-origin.x)-si*(p.y-origin.y),y:si*(p.x-origin.x)+co*(p.y-origin.y)}));
  const x0=Math.min(...local.map(p=>p.x)),x1=Math.max(...local.map(p=>p.x)),y0=Math.min(...local.map(p=>p.y)),y1=Math.max(...local.map(p=>p.y));
  const roll=seed?createRoll(deriveSeed(seed,`bed-composition:${source.id}`)):undefined,xInset=roll?roll.index(0,256)/255*.025:0,yInset=roll?roll.index(1,256)/255*.018:0;
  return (point:readonly [number,number]):ArenaPoint=>{const x=x0+(xInset+(point[0]+320)/640*(1-xInset*2))*(x1-x0),y=y0+(yInset+(point[1]+320)/640*(1-yInset*2))*(y1-y0);return{x:origin.x+co*x+si*y,y:origin.y-si*x+co*y};};
}

/** Fills authored substrate panels only inside the actual concave native bed.
 * Every triangle remains on its declared source plane. This is paint, not an
 * obstacle, raised platform, target, or replacement physical surface. */
export function arenaBedPanelMesh(surface: ArenaSurface, scale: number, scene: PinballSceneGenome, field?: ArenaField): LookMesh {
  if(scene.print.layout!=="field") return {positions:new Float32Array(),normals:new Float32Array(),attrs:new Float32Array(),indices:new Uint32Array(),bodies:new Float32Array()};
  const ps:number[]=[],ns:number[]=[],attrs:number[]=[],indices:number[]=[],p=surface.polygon,heights=surface.vertexElevations??p.map(()=>surface.height),canvas=arenaBedPrintCanvas(surface,field,scene.seed),bed=triangulateArenaPolygon(p);
  const clip=(subject: ArenaPoint[],a:ArenaPoint,b:ArenaPoint,direction:number):ArenaPoint[]=>{
    const out:ArenaPoint[]=[];for(let i=0;i<subject.length;i++){const x=subject[i]!,y=subject[(i+1)%subject.length]!,dx=cross(b.x-a.x,b.y-a.y,x.x-a.x,x.y-a.y)*direction,dy=cross(b.x-a.x,b.y-a.y,y.x-a.x,y.y-a.y)*direction;
      if(dx>=-1e-7)out.push(x);if((dx>=0)!==(dy>=0)){const t=dx/(dx-dy);out.push({x:x.x+(y.x-x.x)*t,y:x.y+(y.y-x.y)*t});}}
    return out;
  };
  for(const contour of pinballPrintContours(scene.print.primitives)) {const points=contour.points.map(canvas),triangles=triangulateArenaPolygon(points);
    for(let i=0;i<bed.length;i+=3) {const ia=bed[i]!,ib=bed[i+1]!,ic=bed[i+2]!,a=p[ia]!,b=p[ib]!,c=p[ic]!,den=cross(b.x-a.x,b.y-a.y,c.x-a.x,c.y-a.y),dir=Math.sign(den);
      const zx=((heights[ib]!-heights[ia]!)*(c.y-a.y)-(heights[ic]!-heights[ia]!)*(b.y-a.y))/den,zy=((b.x-a.x)*(heights[ic]!-heights[ia]!)-(c.x-a.x)*(heights[ib]!-heights[ia]!))/den,n=Math.hypot(zx,1,zy);
      for(let j=0;j<triangles.length;j+=3) {let piece=[points[triangles[j]!]!,points[triangles[j+1]!]!,points[triangles[j+2]!]!];for(const [x,y] of [[a,b],[b,c],[c,a]] as const)piece=clip(piece,x,y,dir);if(piece.length<3)continue;
        for(let k=1;k<piece.length-1;k++){const tri=[piece[0]!,piece[k]!,piece[k+1]!];if(Math.abs(cross(tri[1]!.x-tri[0]!.x,tri[1]!.y-tri[0]!.y,tri[2]!.x-tri[0]!.x,tri[2]!.y-tri[0]!.y))<1e-7)continue;if(indices.length>=4096*3)throw new RangeError("Pinball printed panel mesh budget");if(cross(tri[1]!.x-tri[0]!.x,tri[1]!.y-tri[0]!.y,tri[2]!.x-tri[0]!.x,tri[2]!.y-tri[0]!.y)>0)tri.reverse();const start=ps.length/3;
          for(const q of tri){ps.push(q.x*scale,(heights[ia]!+(q.x-a.x)*zx+(q.y-a.y)*zy)*scale+.014,q.y*scale);ns.push(-zx/n,1/n,-zy/n);attrs.push(slotOf(FIELD_ROLES,contour.role),0,0,0);}indices.push(start,start+1,start+2);
        }
      }
    }
  }
  const positions=Float32Array.from(ps);return {positions,normals:Float32Array.from(ns),attrs:Float32Array.from(attrs),indices:Uint32Array.from(indices),bodies:bodySpace(positions,meshBounds(positions))};
}

/** Engraving belongs to the real bed polygon and its plane. The clipped line
 * vocabulary follows a cabinet's material theme; it adds no obstacle, hole,
 * scaffold, unsupported platform or decorative private playfield. */
export function arenaBedArtMesh(surface: ArenaSurface, scale: number, scene?: PinballSceneGenome, field?: ArenaField): LookMesh {
  const ps: number[] = [], ns: number[] = [], attrs: number[] = [], indices: number[] = [];
  const polygon = surface.polygon, theme = pinballThemeFromBiome(surface.biome), heights = surface.vertexElevations ?? polygon.map(() => surface.height);
  const a = polygon[0]!, b = polygon[1]!, c = polygon[2]!, den = cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y);
  if (Math.abs(den) < .0001) throw new RangeError("Printed bed needs an admitted plane");
  const zx = ((heights[1]! - heights[0]!) * (c.y - a.y) - (heights[2]! - heights[0]!) * (b.y - a.y)) / den;
  const zy = ((b.x - a.x) * (heights[2]! - heights[0]!) - (c.x - a.x) * (heights[1]! - heights[0]!)) / den;
  const normal = Math.hypot(zx, 1, zy), lowX = Math.min(...polygon.map(p => p.x)), highX = Math.max(...polygon.map(p => p.x)), lowY = Math.min(...polygon.map(p => p.y)), highY = Math.max(...polygon.map(p => p.y));
  let patches = 0;
  const line = (from: ArenaPoint, to: ArenaPoint, width = 4, role = "trim"): void => {
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
    if (length < width * 3 || patches >= 384) return;
    const cuts = [0, 1];
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i]!, q = polygon[(i + 1) % polygon.length]!, ex = q.x - p.x, ey = q.y - p.y, d = cross(dx, dy, ex, ey);
      if (Math.abs(d) < 1e-8) continue;
      const t = cross(p.x - from.x, p.y - from.y, ex, ey) / d, u = cross(p.x - from.x, p.y - from.y, dx, dy) / d;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
    }
    cuts.sort((x, y) => x - y);
    for (let i = 0; i < cuts.length - 1 && patches < 384; i++) {
      const start = cuts[i]! + width * 2 / length, end = cuts[i + 1]! - width * 2 / length;
      if (end <= start || !inside({ x: from.x + dx * (start + end) * .5, y: from.y + dy * (start + end) * .5 }, polygon)) continue;
      const nx = -dy / length * width * .5, ny = dx / length * width * .5;
      const points = [{ x: from.x + dx * start + nx, y: from.y + dy * start + ny }, { x: from.x + dx * end + nx, y: from.y + dy * end + ny }, { x: from.x + dx * end - nx, y: from.y + dy * end - ny }, { x: from.x + dx * start - nx, y: from.y + dy * start - ny }];
      if (!points.every(p => inside(p, polygon))) continue;
      const base = ps.length / 3;
      for (const p of points) { ps.push(p.x * scale, (heights[0]! + (p.x - a.x) * zx + (p.y - a.y) * zy) * scale + .028, p.y * scale); ns.push(-zx / normal, 1 / normal, -zy / normal); attrs.push(slotOf(FIELD_ROLES, role), p.x % 1, p.y % 1, 0); }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3); patches++;
    }
  };
  // Continuous recessed trim follows the emitted outline, so unequal lobes
  // and terrace ledges remain visible without adding exterior collision art.
  const area = polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length]!; return sum + p.x * q.y - q.x * p.y; }, 0), winding = area > 0 ? 1 : -1;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!, q = polygon[(i + 1) % polygon.length]!, len = Math.hypot(q.x - p.x, q.y - p.y), nx = -(q.y - p.y) / len * winding, ny = (q.x - p.x) / len * winding;
    for (const [inset, width, role] of [[20, 8, "trim"], [35, 3, "core"]] as const) line({ x: p.x + nx * inset, y: p.y + ny * inset }, { x: q.x + nx * inset, y: q.y + ny * inset }, width, role);
  }
  if(scene?.print.layout==="field") {const canvas=arenaBedPrintCanvas(surface,field,scene.seed);for(const mark of scene.print.primitives)line(canvas(mark.a),canvas(mark.b),mark.width,mark.role);}
  const spacing = scene?.print.layout === "field" ? Infinity : scene?.print.spacing ?? (theme === "nature" ? 260 : theme === "vapor" ? 280 : 240);
  let cells = 0;
  for (let y = lowY + spacing * .5; y < highY && cells < 64; y += spacing) for (let x = lowX + spacing * .5; x < highX && cells < 64; x += spacing) {
    cells++;
    const p = (dx: number, dy: number): ArenaPoint => ({ x: x + dx, y: y + dy });
    if (scene) { for (const mark of scene.print.primitives) line(p(...mark.a), p(...mark.b), mark.width, mark.role); continue; }
    if (theme === "cyber") {
      for (const offset of [-52, 0, 52]) { line(p(-100, offset), p(-28, offset), 4, "core"); line(p(-28, offset), p(18, offset + 46), 4, "core"); line(p(18, offset + 46), p(100, offset + 46), 4, "core"); }
      line(p(-78, -86), p(-78, 76), 8, "dark");
    } else if (theme === "vapor") {
      for (let i = -2; i <= 2; i++) line(p(-110, i * 24), p(110, i * 24), i === 0 ? 6 : 3, i % 2 ? "core" : "trim");
      for (let i = 0; i < 3; i++) { const r = 36 + i * 24; line(p(-r, -r), p(r, r), 4, "core"); line(p(-r, r), p(r, -r), 4, "trim"); }
    } else if (theme === "nature") {
      line(p(-80, -100), p(55, 100), 8, "bark");
      for (let i = 0; i < 4; i++) { const yy = -65 + i * 43, xx = -57 + i * 28; line(p(xx, yy), p(xx - 65, yy + 20), 4, "trim"); line(p(xx, yy), p(xx + 56, yy - 44), 4, "core"); }
    } else if (theme === "gold" || theme === "crypto") {
      for (const r of [32, 58, 84]) {
        const points = theme === "gold" ? [p(-r, -r), p(r, -r), p(r, r), p(-r, r)] : [p(-r, 0), p(0, -r), p(r, 0), p(0, r)];
        for (let i = 0; i < 4; i++) line(points[i]!, points[(i + 1) % 4]!, 4, r === 58 ? "core" : "trim");
      }
      if (theme === "crypto") { line(p(0, -110), p(0, -86), 6, "core"); line(p(0, 86), p(0, 110), 6, "core"); }
    } else for (let i = -3; i <= 3; i++) line(p(-92, i * 24), p(92, i * 24), 7, i % 2 ? "dark" : "steel");
  }
  const positions = Float32Array.from(ps);
  return { positions, normals: Float32Array.from(ns), attrs: Float32Array.from(attrs), indices: Uint32Array.from(indices), bodies: bodySpace(positions, meshBounds(positions)) };
}
