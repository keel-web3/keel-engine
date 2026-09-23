import { generateCar, physicsOf } from "./src/index.ts";
import { createVehicle, rotate, steerCommand, stepVehicle } from "../../packages/vehicle/src/index.ts";
const seen = new Set<string>();
for (let n = 0; seen.size < 8 && n < 400; n++) {
  const car = generateCar(`y${n}`); if (seen.has(car.archetype)) continue; seen.add(car.archetype);
  const { spec } = physicsOf(car); const out: string[] = [];
  for (const [label, digital, thr] of [["key full-gas", true, 1], ["key lift", true, 0], ["raw key", false, 1]] as const) {
    const v = createVehicle(spec, 0, 0, 0); v.v = [0, 0, 30]; for (const w of v.wheels) w.spin = 30 / spec.wheelRadius;
    let slide = 0, s = 0;
    for (let i = 0; i < 180; i++) {
      const want = i < 90 ? 1 : -1; s += Math.max(-5 / 60, Math.min(5 / 60, want - s));
      const fw = v.v[0] * rotate(v.q, [0, 0, 1])[0] + v.v[2] * rotate(v.q, [0, 0, 1])[2];
      stepVehicle(v, { throttle: thr, brake: 0, steer: steerCommand(spec, fw, s, digital), handbrake: 0, traction: 1 }, 1 / 60);
      const f = rotate(v.q, [0, 0, 1]); const vel = Math.hypot(v.v[0], v.v[2]);
      if (vel > 3) slide = Math.max(slide, Math.acos(Math.max(-1, Math.min(1, (v.v[0] * f[0] + v.v[2] * f[2]) / vel))));
    }
    out.push(`${label} ${(slide * 57.3).toFixed(0)}°`);
  }
  console.log(car.archetype.padEnd(7), out.join(" | "));
}
