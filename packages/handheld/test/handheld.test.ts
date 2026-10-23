import { test } from "node:test";
import assert from "node:assert/strict";
import { boundsOf } from "@keel-engine/studio";
import { KEYS, MM, SEGMENTS, buildParts, fromPlan, hitFace, insides, keyTransform, toPlan, hexRgb } from "../src/index.ts";
import { manifest } from "../src/module.ts";

test("the manifest needs the studio", () => {
  assert.equal(manifest.id, "keel/handheld");
  assert.ok(manifest.needs.some((n) => n.startsWith("keel/studio")));
});

test("the spec matches the Chromatic's measured size", () => {
  assert.ok(Math.abs(MM.w - 76) < 0.5);
  assert.ok(Math.abs(MM.h - 132) < 0.5);
  assert.deepEqual(fromPlan(...toPlan(12, 34)), [12, 34]);
  assert.ok(SEGMENTS.solo.round > SEGMENTS.grid.round);
});

test("both details build every part inside the body's box", () => {
  for (const detail of ["grid", "solo"] as const) {
    for (const metal of [true, false]) {
      const h = buildParts(detail, metal);
      const roles = new Set(h.parts.map((p) => p.role));
      for (const r of ["shellFront", "shellBack", "glass", "dpad", "a", "b", "select", "start", "cart", "cartLabel", "screw"]) assert.ok(roles.has(r as never), `${detail} has ${r}`);
      for (const p of h.parts) {
        assert.ok(p.mesh.indices.length > 0, p.role);
        const b = boundsOf(p.mesh);
        assert.ok(b.min[0] >= -MM.w / 2 - 2.5 && b.max[0] <= MM.w / 2 + 2.5, `${p.role} x`);
        assert.ok(b.min[1] >= -MM.h / 2 - 2.5 && b.max[1] <= MM.h / 2 + 2.5, `${p.role} y`);
      }
    }
  }
  // The cartridge sits flush in its slot: nothing above the body's top edge.
  for (const detail of ["grid", "solo"] as const) for (const p of buildParts(detail, true).parts.filter((q) => q.role === "cart" || q.role === "cartLabel")) assert.ok(boundsOf(p.mesh).max[1] <= MM.h / 2 + 1e-6, `${detail} ${p.role} sticks out`);
  const lo = buildParts("grid", true).parts.reduce((n, p) => n + p.mesh.indices.length, 0);
  const hi = buildParts("solo", true).parts.reduce((n, p) => n + p.mesh.indices.length, 0);
  assert.ok(hi > lo * 2, `solo ${hi} vs grid ${lo} triangles`);
});

test("the insides stay behind the face", () => {
  for (const p of insides(SEGMENTS.solo.round)) {
    const b = boundsOf(p.mesh);
    assert.ok(b.max[2] < -0.5, `${p.role} pokes through the face (${b.max[2]} mm)`);
  }
});

test("a point on the face finds its key or the screen", () => {
  assert.deepEqual(hitFace(...toPlan(MM.a.x, MM.a.y)), { kind: "key", key: "a" });
  assert.deepEqual(hitFace(...toPlan(MM.b.x, MM.b.y)), { kind: "key", key: "b" });
  assert.deepEqual(hitFace(...toPlan(MM.dpad.x - 8, MM.dpad.y)), { kind: "key", key: "left" });
  assert.deepEqual(hitFace(...toPlan(MM.dpad.x, MM.dpad.y + 8)), { kind: "key", key: "down" });
  assert.deepEqual(hitFace(...toPlan(MM.start.x, MM.start.y)), { kind: "key", key: "start" });
  const s = hitFace(...toPlan((MM.screen.x0 + MM.screen.x1) / 2, MM.screen.y0 + 1));
  assert.equal(s.kind, "screen");
  assert.deepEqual(hitFace(...toPlan(-5, 10)), { kind: "none" });
  assert.equal(KEYS.length, 8);
});

test("a pressed key moves into the body", () => {
  const rest = keyTransform("a", {}), down = keyTransform("a", { a: { travel: 1, squash: 0 } });
  assert.ok(down[14]! < rest[14]!, "A sinks");
  const rock = keyTransform("dpad", { left: { travel: 1, squash: 0 } });
  assert.notDeepEqual(Array.from(rock), Array.from(keyTransform("dpad", {})));
  assert.deepEqual(hexRgb("#ff8000").map((v) => Math.round(v * 255)), [255, 128, 0]);
});

test("the cart follows the owner's rule: smoke-clear for a see-through shell (and before the deal), black for metal", async () => {
  const { cartKindOf, CART_LAYOUT: L } = await import("../src/index.ts");
  assert.equal(cartKindOf("clear"), "smoke");
  assert.equal(cartKindOf("metal"), "black");
  assert.equal(cartKindOf(null), "smoke");
  assert.equal(cartKindOf(undefined), "smoke");
  // The label sits below the recessed band, nearly full width; the pill inside the band; the ridges on the left.
  assert.ok(L.label.v0 > L.band && L.label.v1 <= 1 && L.label.u1 - L.label.u0 >= 0.7);
  assert.ok(L.pill.v0 > 0 && L.pill.v1 < L.band && L.pill.u0 >= L.ridges.u1);
  assert.ok(L.ridges.u1 <= L.label.u0);
});


// Rays check visibility through the actual shell meshes, rather than merely
// checking that a socket exists somewhere behind an opaque wall.
function rayHit(mesh: ReturnType<typeof buildParts>["parts"][number]["mesh"], origin:number[], direction:number[]){
 const cross=(a:number[],b:number[])=>[a[1]!*b[2]!-a[2]!*b[1]!,a[2]!*b[0]!-a[0]!*b[2]!,a[0]!*b[1]!-a[1]!*b[0]!],dot=(a:number[],b:number[])=>a.reduce((n,v,i)=>n+v*b[i]!,0),sub=(a:number[],b:number[])=>a.map((v,i)=>v-b[i]!);let nearest=Infinity;
 for(let k=0;k<mesh.indices.length;k+=3){const v=[0,1,2].map(i=>Array.from(mesh.positions.subarray(mesh.indices[k+i]!*3,mesh.indices[k+i]!*3+3))),e1=sub(v[1]!,v[0]!),e2=sub(v[2]!,v[0]!),h=cross(direction,e2),det=dot(e1,h);if(Math.abs(det)<1e-8)continue;const f=1/det,s=sub(origin,v[0]!),u=f*dot(s,h);if(u<0||u>1)continue;const q=cross(s,e1),b=f*dot(direction,q);if(b<0||u+b>1)continue;const t=f*dot(e2,q);if(t>1e-6)nearest=Math.min(nearest,t);}
 return nearest;
}
test("the front PCB hides the batteries, including below the keys",()=>{
 const parts=insides(SEGMENTS.solo.round),board=parts.find(p=>p.role==='board')!,battery=parts.find(p=>p.role==='battery')!,origin=[0,toPlan(38,104.5)[1],10],direction=[0,0,-1];
 assert(rayHit(board.mesh,origin,direction)<rayHit(battery.mesh,origin,direction));
 assert(boundsOf(board.mesh).min[1]<=toPlan(0,128)[1]);
});
test("audio, USB-C and link mouths are open in both shell materials and detail levels",()=>{
 for(const detail of ['grid','solo']as const)for(const metal of[true,false]){
  const parts=buildParts(detail,metal).parts,shells=parts.filter(p=>p.role==='shellFront'||p.role==='shellBack');
  for(const x of[MM.bottom.jack,MM.bottom.usb]){const o=[toPlan(x,0)[0],-MM.h/2-5,-5.4],d=[0,1,0],shell=Math.min(...shells.map(p=>rayHit(p.mesh,o,d))),socket=Math.min(...parts.filter(p=>p.role==='hole'||p.role==='trimMetal').map(p=>rayHit(p.mesh,o,d)));assert(shell>9,`${detail} shell blocks bottom port ${x}`);assert(socket<9,`${detail} bottom port has no visible interior`);}
  const o=[-MM.w/2-5,toPlan(0,MM.link.y)[1],MM.link.z],d=[1,0,0];assert(Math.min(...shells.map(p=>rayHit(p.mesh,o,d)))>9,`${detail} shell blocks link port`);assert(Math.min(...parts.filter(p=>p.role==='hole').map(p=>rayHit(p.mesh,o,d)))<10,`${detail} link socket hidden`);
 }
});


test("the cartridge has a small upper-right divot in the rear view",()=>{
 const parts=buildParts('solo',true).parts,cart=parts.find(p=>p.role==='cart')!,label=parts.find(p=>p.role==='cartLabel')!,c=MM.cart;
 const probe=(x:number,y:number)=>{const[X,Y]=toPlan(x,y);return Math.min(rayHit(cart.mesh,[X,Y,c.z0-5],[0,0,1]),rayHit(label.mesh,[X,Y,c.z0-5],[0,0,1]));};
 assert(!Number.isFinite(probe(c.x0+1.5,c.y0+.9)),"rear-right corner is physically recessed including its printed face");
 assert(Number.isFinite(probe(c.x0+1.5,c.y0+3.5)),"cartridge continues beneath divot");assert(Number.isFinite(probe(c.x1-1.5,c.y0+.9)),"opposite upper corner stays solid");
});
test("batteries remain visible from the back through the open tray",()=>{
 const parts=insides(SEGMENTS.solo.round),battery=parts.find(p=>p.role==='battery')!,tray=parts.find(p=>p.role==='tray')!,board=parts.find(p=>p.role==='board')!;
 for(const y of[87.5,103.2,118.9]){const o=[0,toPlan(38,y)[1],-40],d=[0,0,1],cell=rayHit(battery.mesh,o,d);assert(Number.isFinite(cell));assert(cell<rayHit(tray.mesh,o,d));assert(cell<rayHit(board.mesh,o,d));}
});
test("link port keys toward the back and has a deep metal surround and projecting tongue",()=>{
 for(const metal of[true,false]){const parts=buildParts('solo',metal).parts,shells=parts.filter(p=>p.role==='shellFront'||p.role==='shellBack'),y=toPlan(0,MM.link.y)[1];
  const probe=(dy:number,dz:number)=>Math.min(...shells.map(p=>rayHit(p.mesh,[-MM.w/2-5,y+dy,MM.link.z+dz],[1,0,0])));
  assert(probe(4.6,-2.7)<6,"wide back corner closes around the key");assert(probe(4.6,2.7)>9,"front half remains wide");
  const trim=parts.find(p=>p.role==='trimMetal')!,hole=parts.find(p=>p.role==='connectorCore')!,o=[-MM.w/2-5,y,MM.link.z];assert(rayHit(hole.mesh,o,[1,0,0])<5.1,"tongue projects out to the mouth");
  assert(rayHit(trim.mesh,[-MM.w/2+1,y,MM.link.z],[0,0,1])<4,"3D metal surround has a sidewall");
 }
});

test("power slider defaults to ON and physically moves without changing the device",async()=>{
 const{handheldDraw}=await import('../src/scene.ts'),{identity}=await import('@keel-engine/studio'),parts=buildParts('solo',true).parts;
 const kit:any={metal:parts.map(part=>({part,gpu:{source:part.mesh}})),clear:[],materials:new Map(),tex:{},options:{detail:'solo'}};
 const look:any={id:'test',material:'metal',shell:'#aaaaaa',buttons:'#000000',dpad:'#000000',accent:'#ffffff',accentLight:'#ffffff'},state={model:identity(),keys:{},screen:null,cart:null};
 const on=handheldDraw(kit,look,state),off=handheldDraw(kit,look,{...state,powerOn:false}),explicit=handheldDraw(kit,look,{...state,powerOn:true});
 const i=parts.findIndex(p=>p.role==='power');assert(i>=0);assert.deepEqual(on.items[i]!.model,explicit.items[i]!.model);assert(on.items[i]!.model[12]!>off.items[i]!.model[12]!);
 on.items.forEach((item,j)=>{if(j!==i)assert.deepEqual(item.model,off.items[j]!.model);});
});

test("clear grid backs use installed AAs, rather than the front PCB impostor",async()=>{
 const {handheldDraw}=await import('../src/scene.ts'),{identity}=await import('@keel-engine/studio');
 const parts=buildParts('grid',false).parts;
 for(const role of['battery','batteryBand','batteryContact','tray'])assert(parts.some(p=>p.role===role&&p.inside),role);
 for(const y of[87.5,103.2,118.9]){const o=[0,toPlan(38,y)[1],-40],d=[0,0,1];assert(Number.isFinite(rayHit(parts.find(p=>p.role==='battery')!.mesh,o,d)));}
 const frontImpostor={colour:{},depth:{},rect:[-38,-65.85,38,65.85],z:[-1.2,-28.6],behind:[.09,.09,.1]};
 const kit:any={detail:'grid',metal:[],clear:parts.map(part=>({part,gpu:{source:part.mesh}})),materials:new Map(),tex:{},impostor:frontImpostor,options:{detail:'grid'}};
 const look:any={id:'clear-test',material:'clear',shell:'#aabbcc',buttons:'#000000',dpad:'#000000',accent:'#ffffff',accentLight:'#ffffff'};
 const items=handheldDraw(kit,look,{model:identity(),keys:{},screen:null,cart:null}).items;
 assert.equal((items[parts.findIndex(p=>p.role==='shellFront')]!.material as any).impostor,frontImpostor);
 for(const role of['shellBack','hump'])assert.equal((items[parts.findIndex(p=>p.role===role)]!.material as any).impostor,undefined,role+' cannot reuse a front-facing board image');
});
