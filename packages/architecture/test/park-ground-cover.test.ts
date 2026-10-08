import assert from "node:assert/strict";
import { test } from "node:test";
import { drawsFor } from "../../city/src/index.ts";
import { createBuild } from "../src/frame.ts";
import { groundCover } from "../src/street/ground-cover.ts";
import { park } from "../src/street/parks.ts";
function build(seed: string) {
 return createBuild({D:drawsFor(seed,"park"),frame:{x:0,z:0,yaw:0,hw:30,hd:30},key:"park:one",site:{x:0,z:0,hw:30,hd:30},bay:3,storey:3,groundH:3,storeys:1,height:0,wall:"concreteLight",derelict:false,neon:"neonA"});
}
test("park turf has bounded seeded depth and fine blades without another texture",()=>{
 const a=build("park-vertical"),b=build("park-vertical");
 const safe=(x:number,z:number,r:number)=>Math.abs(x)>2+r&&Math.abs(z)>2+r;
 groundCover(a,a.site,safe);groundCover(b,b.site,safe);
 assert.deepEqual(a.solids,b.solids);assert.deepEqual(a.plants,b.plants);
 assert.ok(a.solids.some(s=>s.capsule&&s.capsule.b[1]!-s.capsule.a[1]!>.1));
 assert.ok(a.solids.some(s=>s.box?.kind==="wedge"));
 assert.ok(new Set(a.solids.filter(s=>s.capsule).map(s=>s.capsule!.b[1])).size>5);
 assert.ok(a.solids.length<=24*6,"geometry capped per lot independent of its size");
 for(const p of a.plants)assert.ok(Math.abs(p.x)>2&&Math.abs(p.z)>2,"centre paths clear");
 const other=build("park-other");groundCover(other,other.site,safe);assert.notDeepEqual(a.solids,other.solids);
 const blocked=build("blocked");groundCover(blocked,blocked.site,()=>false);assert.equal(blocked.solids.length,0);assert.equal(blocked.plants.length,0);
});
test("park walkers use visible gravel routes around centre art",()=>{
 const b=build("park-visible");park(b,{op:"park",art:{fountain:1}});
 const paths=b.walks.filter(w=>!w.activity);
 assert.equal(paths.length,2);
 assert.ok(paths.every(w=>w.path.length===6&&w.width>=2));
 assert.ok(b.solids.filter(s=>s.lod===2&&s.box).length>=8,"paths survive far LOD");
 for(const walk of paths)for(let i=1;i<walk.path.length;i++){
  const a=walk.path[i-1]!,c=walk.path[i]!;
  for(let j=0;j<=8;j++){
   const x=a[0]+(c[0]-a[0])*j/8,z=a[1]+(c[1]-a[1])*j/8;
   assert.ok(Math.hypot(x,z)>3,"walkers never cross the fountain");
  }
 }
});

test("park activity anchors are seeded clear lawn residents, separate from paved paths",()=>{
 const a=build("park-activities"),b=build("park-activities");
 park(a,{op:"park",art:{fountain:1}});park(b,{op:"park",art:{fountain:1}});
 const activities=a.walks.filter(w=>w.activity);
 assert.ok(activities.length>0&&activities.length<=2);
 assert.deepEqual(a.walks,b.walks);
 for(const w of activities){
  assert.ok(w.activity==="play"||w.activity==="fitness");
  assert.equal(w.path.length,2);assert.ok(Number.isFinite(w.y));
  const [x,z]=w.path[0]!;
  assert.ok(Math.abs(x)>3&&Math.abs(z)>3&&Math.hypot(x,z)>6);
  assert.ok(a.props.every(p=>Math.hypot(p.x-x,p.z-z)>p.r+1.7));
 }
});
