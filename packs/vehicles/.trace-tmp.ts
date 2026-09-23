import { generateCar, physicsOf } from "./src/index.ts";
import { createVehicle, rotate, steerCommand, stepVehicle } from "../../packages/vehicle/src/index.ts";
let car; for (let n = 0; ; n++) { car = generateCar(`y${n}`); if (car.archetype === "gt") break; }
const { spec } = physicsOf(car); console.log(spec.drivetrain, spec.power, spec.mass, spec.grip, spec.rearGrip);
const v = createVehicle(spec, 0, 0, 0); v.v = [0, 0, 30]; for (const w of v.wheels) w.spin = 30 / spec.wheelRadius; let s = 0;
for (let i = 0; i < 90; i++) { s += Math.max(-5 / 60, Math.min(5 / 60, 1 - s));
  const f = rotate(v.q, [0, 0, 1]); const fw = v.v[0] * f[0] + v.v[2] * f[2];
  stepVehicle(v, { throttle: 1, brake: 0, steer: steerCommand(spec, fw, s, true), handbrake: 0, traction: 1 }, 1 / 60);
  if (i % 6 === 0) console.log(i, "v", fw.toFixed(1), "gear", v.pt.gear, "steer", v.steer.toFixed(3), "yawr", v.w[1].toFixed(2), "side F/R", [0,2].map(k=>v.wheels[k].sideSlip.toFixed(2)).join("/"), "spin R", v.wheels[2].spinSlip.toFixed(2), v.wheels[3].spinSlip.toFixed(2), "tc", v.tcCut.toFixed(2), "load", v.wheels.map(w => (w.load / 1000).toFixed(1)).join(","));
}
