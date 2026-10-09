import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ADVERTISING_BOX,carDesigns,generateCar} from '../src/index.ts';

test('advertising vehicles carry one enclosed, road-height box with three fitted screens',()=>{
 const box=ADVERTISING_BOX;
 assert.ok(box.top<=3&&box.top>=2.9,'an LED box truck is not a billboard tower');
 for(let i=0;i<8;i++){
  const car=generateCar(`led-reference:${i}`,{style:'Advertising Truck'}), sv=car.parts.service!,body=carDesigns(car).body.pose('still',0);
  assert.equal(car.body.length,6);assert.equal(car.body.width,2);assert.equal(car.mounts.length,4);
  assert.equal(sv.axles.length,2);assert.equal(car.body.wheelbase,3.36);
  assert.ok(car.body.screenRun>=.5&&car.body.nose>.5);assert.ok(car.body.roof<2.3);
  assert.equal(sv.kind,'advertising');assert.equal(car.parts.semi,undefined);
  assert.equal(sv.m.sideTop,box.top);assert.equal(sv.m.floor,box.floor);
  assert.ok(Math.abs(sv.m.z0!-box.rear)<1e-12&&Math.abs(sv.m.z1!-box.front)<1e-12);
  assert.ok(box.front<car.body.cabRear,'the enclosed body starts behind the cab');
  assert.ok(body.boxes!.some(s=>s.h[1]>1&&s.h[2]>2&&Math.abs(s.c[0])<1e-12),'the generator supplies a complete enclosed body');
  assert.ok(body.boxes!.filter(s=>Math.abs(Math.abs(s.c[0])-(box.side.x-.015))<1e-12&&Math.abs(s.h[2]-box.side.w/2)<1e-12).length>=2,'both side screens belong to the generator');
  assert.ok(body.boxes!.some(s=>Math.abs(s.c[2]-(box.back.z+.015))<1e-12&&Math.abs(s.h[0]-box.back.w/2)<1e-12),'rear screen belongs to the generator');
  for(const screen of [box.side,box.back]){
   assert.ok(screen.y-screen.h/2>=box.floor&&screen.y+screen.h/2+box.bezel<box.top);
  }
  assert.ok(box.side.z-box.side.w/2-box.bezel>=box.rear);
  assert.ok(box.side.z+box.side.w/2+box.bezel<=box.front);
  assert.ok(box.back.w/2+box.bezel<=box.halfWidth);
 }
});


test('legacy-tandem is explicit and preserves its historical axle/body measurements',()=>{
 for(let i=0;i<8;i++){
  const seed=`led-reference:${i}`,city=generateCar(seed,{style:'Advertising Truck'}),legacy=generateCar(seed,{style:'Advertising Truck',advertisingBody:'legacy-tandem'});
  assert.deepEqual(generateCar(seed,{style:'Advertising Truck',advertisingBody:'city'}),city);
  assert.equal(city.body.length,6);assert.equal(legacy.body.length,12);assert.equal(legacy.body.width,2.5);
  assert.equal(city.mounts.length,4);assert.equal(legacy.mounts.length,6);assert.equal(legacy.parts.service!.m.sideTop,5.76);
  assert.deepEqual(legacy.parts.service!.axles,[4.65,-3.34,-4.7]);
  assert.equal(legacy.body.frontAxle,4.65);assert.equal(legacy.body.rearAxle,-4.0200000000000005);
  assert.equal(city.parts.service!.m.compact,1);assert.equal(legacy.parts.service!.m.compact,undefined);
 }
});
