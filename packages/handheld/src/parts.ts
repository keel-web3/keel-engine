// The Chromatic's parts as meshes, in device-plan millimetres (x right, y up, z out of the face; the body centred).
// Built from the measured spec at a detail level; the scene scales them by UNIT.

import {
  type MeshData, type RoundedPolygon, type Vec2, MeshBuilder, box, cylinder, lathe, mergeMeshes, outline, quad, roundedRect, rotationAbout, rotationX, rotationY, rotationZ,
  slab, slabRings, loft, stadium, crossOutline, transformMesh, translation, compose, scaling,
} from "@keel-engine/studio";
import { type Detail, MM, SEGMENTS, toPlan } from "./spec.ts";
import {cutOpenings} from "./openings.ts";
import type {Aperture} from "./openings.ts";

export type KeyId = "up" | "down" | "left" | "right" | "a" | "b" | "select" | "start";

/** What a part is made of: the scene gives each role its material for a look. */
export type Role =
  | "shellFront" | "shellBack" | "hump" | "glass" | "dpad" | "a" | "b" | "select" | "start"
  | "cart" | "cartLabel" | "connectorCore" | "power" | "trimDark" | "trimMetal" | "hole" | "screw"
  | "board" | "chip" | "ceramic" | "silver" | "gold" | "brass" | "flex" | "battery" | "batteryBand" | "batteryContact" | "tray" | "lcd";

export interface Part {
  readonly role: Role;
  readonly mesh: MeshData;
  /** Parts inside the shell (drawn only where the shell is clear, at solo detail). */
  readonly inside?: boolean;
  /** A key's pivot (plan mm) and its own axis frame, for travel. */
  readonly key?: "dpad" | "a" | "b" | "select" | "start";
}

/** Photo-space corners (top-left, top-right, bottom-right, bottom-left) to a plan-space rounded polygon (CCW). */
function rectPoly(x0: number, y0: number, x1: number, y1: number, r: readonly [number, number, number, number]): RoundedPolygon {
  const [tl, tr, br, bl] = r;
  const pts: Vec2[] = [toPlan(x0, y1), toPlan(x1, y1), toPlan(x1, y0), toPlan(x0, y0)];
  return { points: pts, radii: [bl, br, tr, tl] };
}

export const BODY: RoundedPolygon = rectPoly(0, 0, MM.w, MM.h, MM.corners);

/** The back shell's outline: the body less the cartridge window, open at the top. */
export function backPoly(): RoundedPolygon {
  const w = MM.cart.window, [c0, c1, c2, c3] = MM.corners;
  const P = (x: number, y: number) => toPlan(x, y);
  return {
    points: [P(0, MM.h), P(MM.w, MM.h), P(MM.w, 0), P(w.x1, 0), P(w.x1, w.y1), P(w.x0, w.y1), P(w.x0, 0), P(0, 0)],
    radii: [c3, c2, c1, 0.9, w.r, w.r, 0.9, c0],
  };
}

/** The battery bulge's outline at a depth: the body below its sloping top edge. */
function humpPoly(top: number, inset: number): RoundedPolygon {
  const [, , br, bl] = MM.corners;
  return rectPoly(inset, top + inset, MM.w - inset, MM.h - inset, [2.2, 2.2, Math.max(0, br - inset), Math.max(0, bl - inset)]);
}

const faceUV = (X: number, Y: number): Vec2 => [(X + MM.w / 2) / MM.w, (MM.h / 2 - Y) / MM.h];

export interface HandheldParts {
  readonly detail: Detail;
  readonly parts: readonly Part[];
  /** The glass's uv rectangle of the screen (u0, v0, u1, v1; v down). */
  readonly screenRect: readonly [number, number, number, number];
}

export function buildParts(detail: Detail, metal: boolean): HandheldParts {
  const seg = SEGMENTS[detail];
  const parts: Part[] = [];
  const add = (role: Role, mesh: MeshData, extra: Partial<Part> = {}) => parts.push({ role, mesh, ...extra });

  // ---- shell: front half (face, walls, a chamfered or rounded front edge), back half (with the cart window), bulge
  const f = MM.front;
  const frontEdge = metal ? { size: f.chamfer, kind: "chamfer" as const } : { size: f.roundClear, steps: seg.bevel };
  add("shellFront", cutOpenings(loft(slabRings(BODY, f.z0, f.z1, { size: 0.45, steps: 2 }, frontEdge, seg.corner), { capEnd: true, capUV: faceUV }), apertures(detail)));
  const bk = MM.back;
  add("shellBack", cutOpenings(loft(slabRings(backPoly(), bk.z0, bk.z1, { size: bk.round, steps: seg.bevel }, { size: 0.45, steps: 2 }, seg.corner), { capStart: true, capUV: faceUV }), apertures(detail)));
  {
    const h = MM.hump, rings = [];
    const steps = seg.bevel + 3;
    const topAt = (z: number) => { const t = Math.min(1, Math.max(0, (z - bk.z0) / (h.z1 - bk.z0))); return h.topAt[0] + (h.topAt[1] - h.topAt[0]) * t; };
    // Straight sloping run, then a round over onto the door.
    const zStraight = h.z1 + h.round;
    rings.push({ pts: outline(humpPoly(topAt(h.z0), 0), seg.corner), z: h.z0 });
    for (let s = 0; s <= steps; s += 1) {
      const a = (s / steps) * (Math.PI / 2);
      const z = zStraight - Math.sin(a) * h.round;
      const inset = h.round * (1 - Math.cos(a));
      rings.push({ pts: outline(humpPoly(topAt(Math.max(z, h.z1)) , inset), seg.corner), z });
    }
    rings.reverse();
    add("hump", loft(rings, { capStart: true, capUV: faceUV }));
  }

  // ---- cover glass: its own slab with a fine chamfer; uv across the glass, v down
  const g = MM.glass;
  const glassPoly = rectPoly(g.x0, g.y0, g.x1, g.y1, [g.r, g.r, g.rBig, g.r]);
  const glassUV = (X: number, Y: number): Vec2 => { const x = X + MM.w / 2, y = MM.h / 2 - Y; return [(x - g.x0) / (g.x1 - g.x0), (y - g.y0) / (g.y1 - g.y0)]; };
  add("glass", slab(glassPoly, g.z0, g.z1, null, { size: g.chamfer, kind: "chamfer" }, { capStart: false, capUV: glassUV, seg: seg.corner }));
  const s = MM.screen;
  const screenRect = [(s.x0 - g.x0) / (g.x1 - g.x0), (s.y0 - g.y0) / (g.y1 - g.y0), (s.x1 - g.x0) / (g.x1 - g.x0), (s.y1 - g.y0) / (g.y1 - g.y0)] as const;

  // ---- keys
  const d = MM.dpad, [dx, dy] = toPlan(d.x, d.y);
  add("dpad", transformMesh(slab(crossOutline(d.span, d.arm, d.ro, d.ri), -1.6, d.top, null, { size: d.bevel, steps: seg.bevel }, { capStart: false, seg: Math.max(4, seg.corner >> 1) }), translation(dx, dy, 0)), { key: "dpad" });
  for (const k of ["a", "b"] as const) {
    const m = MM[k], [kx, ky] = toPlan(m.x, m.y);
    add(k, transformMesh(domeKey(m.r, m.top, seg.round, seg.bevel), translation(kx, ky, 0)), { key: k });
  }
  for (const k of ["select", "start"] as const) {
    const m = MM[k], [kx, ky] = toPlan(m.x, m.y);
    const pill = slab(stadium(m.len, m.w), -0.9, m.top, null, { size: Math.min(m.w / 2 - 0.05, 1.0), steps: seg.bevel }, { capStart: false, seg: Math.max(6, seg.corner) });
    add(k, transformMesh(pill, compose(translation(kx, ky, 0), rotationZ((m.angle * Math.PI) / 180))), { key: k });
  }

  // ---- edges: power switch (top), wheel and side button (right), jack / LED / USB-C / grille (bottom)
  {
    const [px] = toPlan(MM.power.x, 0), top=MM.h/2;
    const onTop=(m:MeshData,x:number,z:number)=>transformMesh(m,compose(translation(x,top,z),rotationX(-Math.PI/2)));
    // A recessed sliding track with a raised, ridged thumb piece, not a button.
    const track=onTop(slab(roundedRect(0,0,MM.power.len,5.8,.6),-1.2,-.25,null,null,{seg:4}),px,MM.power.z);
    const slider=onTop(slab(roundedRect(0,0,9.2,5.1,.4),-.2,1.2,null,{size:.25,steps:2},{seg:4}),px,MM.power.z);
    const grip:MeshData[]=[];for(const x of[-2.8,0,2.8])grip.push(onTop(box([x,0,1.3],[.25,2.15,.25]),px,MM.power.z));
    const ir=onTop(slab(roundedRect(0,0,MM.ir.len,5.6,.7),-.5,.04,null,null,{seg:4}),toPlan(MM.ir.x,0)[0],MM.ir.z);
    add("power",mergeMeshes(slider,...grip));
    add("trimDark",mergeMeshes(track,ir,wheel(seg.round),
      transformMesh(slab(stadium(MM.sideButton.len,MM.sideButton.w),-.6,MM.sideButton.out,null,{size:.6,steps:2},{capStart:false}),compose(translation(MM.w/2,toPlan(0,MM.sideButton.y)[1],MM.sideButton.z),rotationY(Math.PI/2),rotationZ(Math.PI/2)))));
  }
  add("hole",mergeMeshes(bottomHoles(seg.round),linkSocket(false)));
  add("trimMetal",mergeMeshes(bottomMetal(),linkSocket(true)));
  add("gold",linkContacts());
  add("connectorCore",onLink(box([0,0,-.8],[3.5,.6,1.4])));

  // ---- the cartridge (seen through the back window and from the top) and its label
  const c = MM.cart;
  const cartPoly = cartridgeOutline();
  add("cart", slab(cartPoly, c.z0, c.z1, { size: 0.6, steps: 2 }, { size: 0.6, steps: 2 }, { seg: 4 }));
  {
    const [lx, ly] = toPlan((c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2);
    // The face follows the real top-right divot (right when viewed from behind).
    const face=slab(cartridgeOutline(.7),c.z0-.02,c.z0-.01,null,null,{capStart:true,capEnd:false,seg:4});
    const indices:number[]=[];for(let i=0;i<face.indices.length;i+=3)if(face.normals[face.indices[i]!*3+2]!<-.9)indices.push(face.indices[i]!,face.indices[i+1]!,face.indices[i+2]!);
    const uv=face.uvs.slice(),W=c.x1-c.x0-1.4,H=c.y1-c.y0-1.4;
    for(let i=0;i<face.positions.length/3;i++){uv[i*2]=.5+(lx-face.positions[i*3]!)/W;uv[i*2+1]=.5+(ly-face.positions[i*3+1]!)/H;}
    add("cartLabel",{...face,indices:new Uint32Array(indices),uvs:uv});
  }

  // ---- screws: two beside the cart window, four round the battery door (on the bulge)
  {
    const heads: MeshData[] = [];
    MM.screws.forEach(([x, y], i) => {
      const [X, Y] = toPlan(x, y), z = i < 2 ? bk.z0 : MM.hump.z1;
      heads.push(transformMesh(screw(seg.round >> 1), compose(translation(X, Y, z), rotationY(Math.PI))));
    });
    add("screw", mergeMeshes(...heads));
  }

  if (!metal) parts.push(...(detail === "solo" ? insides(seg.round) : batteryAssembly(seg.round)));
  return { detail, parts, screenRect };
}

/** Cartridge's rear-right keyed divot; front plan x is reversed in a rear view. */
export function cartridgeOutline(inset=0):RoundedPolygon{
 const c=MM.cart,x0=c.x0+inset,x1=c.x1-inset,y0=c.y0+inset,y1=c.y1-inset;
 return{points:[toPlan(x0,y1),toPlan(x1,y1),toPlan(x1,y0),toPlan(c.x0+4.8,y0),toPlan(c.x0+4.8,c.y0+1.8+inset),toPlan(x0,c.y0+1.8+inset)],radii:[1.2,1.2,1.2,.2,.25,.35]};
}

/** A domed key: a short cylinder with a rounded shoulder and a shallow dome (lathe; z up out of the face). */
export function domeKey(r: number, top: number, segments: number, bevel: number): MeshData {
  const shoulder = 0.85, dome = 0.55;
  const prof: Vec2[] = [[r, -1.4], [r, top - dome - shoulder]];
  for (let i = 1; i <= bevel + 2; i += 1) {
    const a = (i / (bevel + 2)) * (Math.PI / 2);
    prof.push([r - shoulder + Math.cos(a) * shoulder, top - dome - shoulder + Math.sin(a) * shoulder]);
  }
  const rr = r - shoulder, R = (rr * rr + dome * dome) / (2 * dome);
  const steps = bevel + 4;
  for (let i = 1; i <= steps; i += 1) {
    const x = rr * (1 - i / steps);
    prof.push([Math.max(0, x), top - dome + (Math.sqrt(Math.max(0, R * R - x * x)) - (R - dome))]);
  }
  return lathe(prof, segments, [1]);
}

function wheel(segments: number): MeshData {
  const w = MM.wheel, n = 28, pts: Vec2[] = [], radii: number[] = [];
  for (let i = 0; i < n * 2; i += 1) {
    const a = (i / (n * 2)) * Math.PI * 2, r = i % 2 ? w.r - 0.35 : w.r;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]); radii.push(0.12);
  }
  void segments;
  const gear = slab({ points: pts, radii }, -w.w / 2, w.w / 2, { size: 0.25, kind: "chamfer" }, { size: 0.25, kind: "chamfer" }, { seg: 2 });
  // The wheel's axis is the device's z: it rolls under the thumb along the right edge.
  return transformMesh(gear, translation(MM.w / 2 - w.r + w.out, toPlan(0, w.y)[1], w.z));
}

/** Dark sockets on the bottom edge: the headphone jack, the speaker grille's twelve holes, the USB-C mouth. */
function bottomHoles(segments: number): MeshData {
  const out: MeshData[] = [], b = MM.bottom, Y = -MM.h / 2;
  // Each hole: a short tube going in (its wall facing inward) closed by a dark floor; set just proud of the wall.
  const socket = (r: number, depth: number): MeshData => {
    const tube = lathe([[r, 0.02], [r, -depth], [0, -depth]], Math.max(10, segments >> 1), [1]);
    // (Turned inside out: the lathe faces outward; a socket's wall faces its axis.)
    return { ...tube, normals: tube.normals.map((v) => -v), indices: flipWinding(tube.indices) };
  };
  const onBottom = (m: MeshData, x: number, z: number) => transformMesh(m, compose(translation(toPlan(x, 0)[0], Y, z), rotationX(Math.PI / 2)));
  out.push(onBottom(socket(2.15, 3), b.jack, -5.4));
  for (const z of b.grille.rows) for (let i = 0; i < b.grille.n; i += 1) out.push(onBottom(socket(b.grille.r, 1.6), b.grille.x0 + i * b.grille.pitch, z));
  const usb = slab(stadium(8.8, 3.1), -3, 0.02, null, null, { capStart: true, capEnd: false, seg: 6 });
  out.push(onBottom({ ...usb, normals: usb.normals.map((v) => -v), indices: flipWinding(usb.indices) }, b.usb, -5.4));
  return mergeMeshes(...out);
}

/** The USB-C tongue, the LED's lens: small bright bits. */
function bottomMetal(): MeshData {
  const b = MM.bottom, Y = -MM.h / 2;
  const onBottom=(m:MeshData,x:number,z:number)=>transformMesh(m,compose(translation(toPlan(x,0)[0],Y-.04,z),rotationX(Math.PI/2)));
  const rim=(outer:Vec2[],inner:Vec2[]):MeshData=>{const m=new MeshBuilder();for(let i=0;i<outer.length;i++){const j=(i+1)%outer.length,a=outer[i]!,b=outer[j]!,c=inner[j]!,d=inner[i]!;const n=m.count;for(const p of[a,b,c,d])m.vertex(p[0],p[1],0,0,0,1,0,0);m.tri(n,n+1,n+2);m.tri(n,n+2,n+3);}return m.done();};
  const usbRim=onBottom(rim(outline(stadium(9.5,3.8),6),outline(stadium(8.8,3.1),6)),b.usb,-5.4);
  const jackRim=onBottom(rim(circle(2.65,32),circle(2.15,32)),b.jack,-5.4);
  const tongue=onBottom(box([0,0,-1.1],[3.2,.24,.24]),b.usb,-5.4);
  const led=onBottom(cylinder(.45,-.2,.05,12),b.led,-5.4);
  return mergeMeshes(usbRim,jackRim,tongue,led);
}

function circle(r:number,n=24):Vec2[]{return Array.from({length:n},(_,i)=>[Math.cos(i/n*Math.PI*2)*r,Math.sin(i/n*Math.PI*2)*r]);}
function apertures(detail:Detail):Aperture[]{
 const curve=detail==='solo'?6:3,round=detail==='solo'?24:12;
 const shift=(p:readonly Vec2[],u:number,v:number):Vec2[]=>p.map(([x,y])=>[x+u,y+v]);
 const b=MM.bottom,holes:Aperture[]=[
  {axis:1,sign:-1,outline:shift(circle(2.17,round),toPlan(b.jack,0)[0],-5.4)},
  {axis:1,sign:-1,outline:shift(outline(stadium(8.85,3.15),curve),toPlan(b.usb,0)[0],-5.4)},
  {axis:1,sign:1,outline:shift(outline(roundedRect(0,0,MM.power.len,5.8,.6),4),toPlan(MM.power.x,0)[0],MM.power.z)},
  {axis:1,sign:1,outline:shift(outline(roundedRect(0,0,MM.ir.len,5.6,.7),4),toPlan(MM.ir.x,0)[0],MM.ir.z)},
  {axis:0,sign:-1,outline:shift(outline(roundedRect(0,.9,10.4,5,.4),curve),toPlan(0,MM.link.y)[1],MM.link.z)},
  {axis:0,sign:-1,outline:shift(outline(roundedRect(0,-2.3,6.2,2.2,.3),curve),toPlan(0,MM.link.y)[1],MM.link.z)},
  {axis:0,sign:1,outline:shift(outline(roundedRect(0,0,14.4,3.5,.4),4),toPlan(0,MM.wheel.y)[1],MM.wheel.z)},
 ];
 for(const z of b.grille.rows)for(let i=0;i<b.grille.n;i++)holes.push({axis:1,sign:-1,outline:shift(circle(b.grille.r,detail==='solo'?16:8),toPlan(b.grille.x0+i*b.grille.pitch,0)[0],z)});
 return holes;
}
function linkOutline():Vec2[]{return outline({points:[[-5.2,-3.4],[5.2,-3.4],[5.2,1.6],[3.1,1.6],[3.1,3.4],[-3.1,3.4],[-3.1,1.6],[-5.2,1.6]],radii:[.45,.45,.45,.25,.3,.3,.25,.45]},3).map(([x,y])=>[x,-y]as Vec2).reverse();}
const onLink=(m:MeshData)=>transformMesh(m,compose(translation(-MM.w/2-.05,toPlan(0,MM.link.y)[1],MM.link.z),rotationY(-Math.PI/2),rotationZ(-Math.PI/2)));
function linkSocket(metal:boolean):MeshData{
 const shape=linkOutline(),m=new MeshBuilder(),outer=shape.map(([x,y])=>[x*1.10,y*1.12]as Vec2);
 const wall=(a:Vec2,b:Vec2,za:number,zb:number,inward=false)=>{const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),sign=inward?-1:1,n=m.count;for(const[p,z]of[[a,za],[b,za],[b,zb],[a,zb]]as const)m.vertex(p[0],p[1],z,sign*dy/len,-sign*dx/len,0,0,0);if(inward){m.tri(n,n+2,n+1);m.tri(n,n+3,n+2);}else{m.tri(n,n+1,n+2);m.tri(n,n+2,n+3);}};
 for(let i=0;i<shape.length;i++){const j=(i+1)%shape.length,a=shape[i]!,b=shape[j]!;
  if(metal){const n=m.count;for(const p of[outer[i]!,outer[j]!,b,a])m.vertex(p[0],p[1],.4,0,0,1,0,0);m.tri(n,n+1,n+2);m.tri(n,n+2,n+3);wall(outer[i]!,outer[j]!,-2.5,.4);wall(a,b,-2.5,.4,true);}
  else wall(a,b,-3.8,-2.5,true);
 }
 if(!metal){m.append(slab({points:shape,radii:shape.map(()=>0)},-4,-3.9,null,null,{seg:1}));}
 return onLink(m.done());
}
function linkContacts():MeshData{
 const contacts:MeshData[]=[];for(let i=0;i<6;i++)contacts.push(box([-2.75+i*1.1,.64,-.65],[.28,.07,.8]));return onLink(mergeMeshes(...contacts));
}

function flipWinding(ix: Uint32Array): Uint32Array {
  const o = new Uint32Array(ix);
  for (let k = 0; k < o.length; k += 3) { const s = o[k + 1]!; o[k + 1] = o[k + 2]!; o[k + 2] = s; }
  return o;
}

/** A pan-head Phillips screw, head up (+z): a rounded head with a cross cut into it (the cut's floor is dark). */
function screw(segments: number): MeshData {
  const r = 1.55, h = 0.55;
  const head = lathe([[r, -0.2], [r, h * 0.45], [r * 0.82, h * 0.9], [r * 0.4, h], [0, h]], Math.max(12, segments), [1]);
  const slotA = box([0, 0, h - 0.05], [r * 0.62, 0.17, 0.12]), slotB = box([0, 0, h - 0.05], [0.17, r * 0.62, 0.12]);
  return mergeMeshes(head, slotA, slotB);
}

/** Installed three-cell AA tray. Shared by both tiers: a front-only height
 * field cannot represent the rear of the device, even if it contains a PCB. */
function batteryAssembly(segments: number): Part[] {
  const cells: MeshData[] = [], bands: MeshData[] = [], contacts: MeshData[] = [];
  for (const y of [87.5, 103.2, 118.9]) {
    const [X,Y] = toPlan(38,y), pose = compose(translation(X,Y,-20.4),rotationY(Math.PI/2));
    cells.push(transformMesh(lathe([[0,-25],[6.9,-25],[7.2,-24.6],[7.2,24.4],[6.9,25],[0,25]],segments,[1,2,4]),pose));
    bands.push(transformMesh(lathe([[7.23,17],[7.23,23.9]],segments),pose));
    contacts.push(transformMesh(lathe([[0,-25.06],[5.7,-25.06],[5.7,-25.01]],segments,[1]),pose));
    contacts.push(transformMesh(lathe([[0,25.02],[2.4,25.02],[2.4,25.9],[0,25.9]],segments,[1,2]),pose));
  }
  const tray = slab(rectPoly(6,79,70,128.8,[2,2,8,2]),-27.8,-27.0,null,null,{capStart:false,capEnd:false,seg:4});
  const lip = slab(rectPoly(6,79,70,80.1,[.3,.3,.3,.3]),-27.8,-12.5,null,null,{seg:2});
  return [
    {role:"battery",mesh:mergeMeshes(...cells),inside:true},
    {role:"batteryBand",mesh:mergeMeshes(...bands),inside:true},
    {role:"batteryContact",mesh:mergeMeshes(...contacts),inside:true},
    {role:"tray",mesh:mergeMeshes(tray,lip),inside:true},
  ];
}

/** What a clear shell shows: the board and its parts, the LCD's frame, batteries in their tray, the speaker,
 *  the cart connector, brass inserts and screw posts. Plan mm; z behind the face. */
export function insides(segments: number): Part[] {
  const out: Part[] = [];
  const add = (role: Role, mesh: MeshData) => out.push({ role, mesh, inside: true });
  const P = (x: number, y: number) => toPlan(x, y);
  const boardZ = [-7.4, -5.8] as const;
  const boardPoly = rectPoly(2.3, 2.6, 73.7, 129.0, [2, 2, 8, 2]);
  add("board", slab(boardPoly, boardZ[0], boardZ[1], null, null, { capStart: false, capUV: faceUV, seg: 4 }));
  const top = boardZ[1];
  const chips: MeshData[] = [], ceramic: MeshData[] = [], silver: MeshData[] = [], gold: MeshData[] = [], brass: MeshData[] = [];
  const at = (x: number, y: number, z: number, hx: number, hy: number, hz: number) => { const [X, Y] = P(x, y); return box([X, Y, z + hz], [hx, hy, hz]); };
  // The system chip (a QFP), with its gull-wing legs.
  chips.push(at(36.5, 79.5, top, 4.6, 4.6, 0.55));
  for (let i = 0; i < 12; i += 1) {
    const o = -3.85 + i * 0.7;
    gold.push(at(36.5 + o, 79.5 - 5.0, top, 0.14, 0.45, 0.12), at(36.5 + o, 79.5 + 5.0, top, 0.14, 0.45, 0.12));
    gold.push(at(36.5 - 5.0, 79.5 + o, top, 0.45, 0.14, 0.12), at(36.5 + 5.0, 79.5 + o, top, 0.45, 0.14, 0.12));
  }
  // Smaller chips.
  for (const [x, y, w, h] of [[31, 105, 3.5, 3.5], [12, 111, 2.2, 1.8], [34, 119, 2.0, 1.6], [46, 112, 1.8, 2.4], [48, 123, 1.4, 1.1], [27, 72.5, 2.4, 1.6], [46.5, 72.8, 2.0, 2.0], [60.5, 100, 1.6, 1.2], [11.5, 72.5, 1.5, 1.5], [44, 89, 1.8, 1.3]] as const) {
    chips.push(at(x, y, top, w, h, 0.4));
    for (let i = 0; i < 4; i += 1) { const o = -w + 0.5 + (i * (2 * w - 1)) / 3; gold.push(at(x + o, y - h - 0.25, top, 0.12, 0.3, 0.08), at(x + o, y + h + 0.25, top, 0.12, 0.3, 0.08)); }
  }
  // Passives: 0603s in tan with tinned ends, scattered where a board has them.
  const rng = mulberry(0x5eed);
  const spots: [number, number][] = [[31, 70.5], [33, 70.5], [41, 70.6], [43, 70.6], [29.5, 86], [31.5, 86.5], [42.5, 86.8], [26, 79], [26, 81.2], [47.5, 78], [47.5, 80.6],
    [55, 71.5], [57.5, 71.5], [8.5, 79], [8.5, 81], [70, 77.5], [70, 79.5], [23.5, 96], [25.5, 96], [61.5, 97], [35, 98], [38, 98], [13.5, 99], [56, 82.5], [58.5, 99], [8, 117], [8, 120], [12, 117], [12, 120], [24, 104], [24, 107], [37, 103], [37, 106], [27, 113], [30, 113], [33, 113], [41, 119], [41, 122], [45, 119], [51, 104], [51, 107], [56, 108]];
  for (const [x, y] of spots) {
    const turn = rng() > 0.5;
    const hx = turn ? 0.4 : 0.8, hy = turn ? 0.8 : 0.4;
    ceramic.push(at(x, y, top, hx * 0.62, hy * 0.62, 0.4));
    if (turn) { silver.push(at(x, y - 0.62, top, 0.4, 0.2, 0.41), at(x, y + 0.62, top, 0.4, 0.2, 0.41)); }
    else { silver.push(at(x - 0.62, y, top, 0.2, 0.4, 0.41), at(x + 0.62, y, top, 0.2, 0.4, 0.41)); }
  }
  // An electrolytic can and a crystal.
  { const [X, Y] = P(70.5, 90); silver.push(transformMesh(lathe([[0, 0], [2.4, 0], [2.4, 4.6], [2.2, 4.9], [0, 4.9]], segments, [1, 3]), translation(X, Y, top))); }
  { const [X, Y] = P(22, 73); silver.push(transformMesh(slab(stadium(4.6, 1.8), 0, 1.1, null, { size: 0.3, steps: 2 }, { capStart: false, seg: 6 }), translation(X, Y, top))); }
  // Lower power regulation and audio stage, mounted on the front of the full board.
  for(const [x,y]of[[8.5,124],[26,122],[47,115]]as const){const[X,Y]=P(x,y);silver.push(transformMesh(lathe([[0,0],[1.6,0],[1.6,2.1],[1.4,2.3],[0,2.3]],Math.max(12,segments>>1),[1,3]),translation(X,Y,top)));}
  chips.push(at(63,118,top,8,9.8,1.2)); // Speaker's dark rectangular front enclosure.
  for(let i=0;i<5;i++)silver.push(at(63,113+i*2.2,top+2.4,4.6,.18,.06));
  // The LCD module under the glass: a steel frame, black glass on top.
  add("lcd", slab(rectPoly(7.2, 8.5, 68.8, 63.5, [1, 1, 1, 1]), top, -1.2, null, { size: 0.4, kind: "chamfer" }, { capStart: false, seg: 3 }));
  // (The display's flex runs behind the LCD module, out of sight, so it isn't modelled: a strip beside the module read
  // as a hard orange line down the screen's left edge through every clear shell.)
  // Cart connector behind the board's top edge: a black housing, a row of gold fingers.
  chips.push(at(38, 4.2, -11.2, 29.5, 1.8, 1.9));
  for (let i = 0; i < 32; i += 1) gold.push(at(14 + i * 1.55, 4.2, -7.35, 0.32, 1.9, 0.06));
  out.push(...batteryAssembly(segments));
  // Speaker, behind the grille.
  { const [X, Y] = P(55, 126.3); silver.push(transformMesh(lathe([[0, -3.0], [4.2, -3.0], [4.2, 0], [3.7, 0.3], [0, 0.3]], segments, [1, 2, 3]), compose(translation(X, Y, -5.8), rotationX(Math.PI / 2)))); }
  // USB-C receptacle shell and the jack's body.
  { const [X, Y] = P(MM.bottom.usb, 127.6); silver.push(transformMesh(slab(stadium(8.9, 3.2), -3.6, 3.6, null, null, { seg: 4 }), compose(translation(X, Y, -5.4), rotationX(Math.PI / 2)))); }
  { const [X, Y] = P(MM.bottom.jack, 125.5); chips.push(box([X, Y, -5.4], [3, 6, 2.6])); }
  // Brass inserts at the face's top corners, screw posts down the sides.
  for (const [x, y] of [[3.9, 3.0], [72.1, 3.0], [3.9, 96], [72.1, 96]] as const) {
    const [X, Y] = P(x, y);
    brass.push(transformMesh(lathe([[0, 0], [1.5, 0], [1.5, 4.2], [0.9, 4.2], [0.9, 3.6], [0, 3.6]], Math.max(12, segments >> 1), [1, 2, 3, 4]), translation(X, Y, -6.6)));
  }
  add("chip", mergeMeshes(...chips));
  add("ceramic", mergeMeshes(...ceramic));
  add("silver", mergeMeshes(...silver));
  add("gold", mergeMeshes(...gold));
  add("brass", mergeMeshes(...brass));
  return out;
}

/** A small deterministic stream (placement only). */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

void rotationAbout; void scaling; void MeshBuilder;
