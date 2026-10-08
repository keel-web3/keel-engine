import assert from "node:assert/strict";
import { test } from "node:test";
import { busPassengerDoor, busPassengerSeats, carDesigns, generateCar } from "../src/index.ts";

test("real bus door and passenger seats fit the generated cabin without an opaque saloon filler", () => {
  for(let i=0;i<24;i++){
    const car=generateCar(`bus-seats:${i}`,{style:"City Bus"}), seats=busPassengerSeats(car), door=busPassengerDoor(car)!;
    assert.equal(seats.length,8);assert.ok(door.x>car.body.width/2+.4);
    assert.ok(door.z>car.parts.service!.m.fd0!&&door.z<car.parts.service!.m.fd1!);
    const boxes=carDesigns(car).body.pose("still",0).boxes!;
    for(const seat of seats){
      assert.ok(Math.abs(seat.x)+.24<car.body.width/2 && Math.abs(seat.z)+.26<car.body.length/2);
      assert.ok(boxes.some(b=>Math.abs(b.c[0]!-seat.x)<1e-8&&Math.abs(b.c[1]!+b.h[1]!-seat.y)<1e-8));
      assert.ok(!boxes.some(b=>Math.abs(b.c[0]!-seat.x)<b.h[0]!&&Math.abs(b.c[2]!-seat.z)<b.h[2]!&&Math.abs(b.c[1]!-(seat.y+.7))<b.h[1]!));
    }
  }
  const sedan=generateCar("no-bus");assert.deepEqual(busPassengerSeats(sedan),[]);assert.equal(busPassengerDoor(sedan),null);
});
