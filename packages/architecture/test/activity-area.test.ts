import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{drawsFor}from'../../city/src/index.ts';import{createBuild}from'../src/frame.ts';import{park}from'../src/street/parks.ts';import{parkActivity}from'../src/street/park-activity.ts';
import{activityAccess,activityObstacles}from'../src/street/activity-access.ts';
function build(seed:string,yaw=0){return createBuild({activityAreasEnabled:true,D:drawsFor(seed,'park'),frame:{x:0,z:0,yaw,hw:30,hd:30},key:'park:one',site:{x:0,z:0,hw:30,hd:30},bay:3,storey:3,groundH:3,storeys:1,height:0,wall:'concreteLight',derelict:false,neon:'neonA'});}
test('retained overlapping park pair is rejected before a second activity is placed',()=>{
 const f=JSON.parse(readFileSync(new URL('./fixtures/overlapping-park-activities.json',import.meta.url),'utf8')),a=f.areas[0],z=f.areas[1],b=build('retained-park-pair');
 b.walks.push({key:'path',width:2.4,clearance:2.4,path:[[-10,-5],[10,-5]]});
 const dx=z.center[0]-a.center[0],dz=z.center[1]-a.center[1];assert.ok(Math.hypot(dx,dz)<a.bodyRadius+z.bodyRadius,'original footprints penetrate');
 assert.equal(parkActivity(b,0,0,0),true);assert.equal(parkActivity(b,dx,dz,1),false);assert.equal(b.activityAreas.length,1);assert.equal(b.walks.length,1,'heading must not become a traversal');
});
test('activity admission requires a reachable walking source and refuses blocked lawns',()=>{
 const b=build('access');assert.equal(activityAccess(b,[0,0]),null);b.walks.push({key:'path',width:2.4,clearance:2.4,path:[[-10,-5],[10,-5]]});assert.ok(activityAccess(b,[0,0]));
 b.barriers.push({x:0,z:-2.5,hw:30,hd:1,yaw:0,yMin:0,yMax:3});assert.equal(activityAccess(b,[0,0]),null);
});
test('multi-seed rotated parks retain deterministic cleared activity areas and real access',()=>{
 let admitted=0;
 for(let seed=0;seed<48;seed++){const a=build('activity-seed:'+seed,seed*.17),b=build('activity-seed:'+seed,seed*.17);park(a,{op:'park',art:{fountain:1}});park(b,{op:'park',art:{fountain:1}});assert.deepEqual(a.activityAreas,b.activityAreas);assert.ok(a.activityAreas.length<=2);admitted+=a.activityAreas.length;
  for(const area of a.activityAreas){assert.equal(area.version,1);assert.equal(area.bodyRadius,.35);assert.ok(area.access.path.length>=2);assert.ok(a.walks.some(w=>w.key===area.access.walk));assert.ok(!a.walks.some(w=>w.activity));
   for(const other of a.activityAreas)if(other!==area)assert.ok(Math.hypot(area.center[0]-other.center[0],area.center[1]-other.center[1])>area.radius+other.radius);
   const without={...b,activityAreas:b.activityAreas.filter(x=>x.key!==area.key)};assert.ok(activityAccess(without,area.center),'access remains reachable after every later placement');
  }
 }assert.ok(admitted>=48,'correctness cannot silently erase park activities across the sample');
});
