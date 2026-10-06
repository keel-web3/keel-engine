/** Terrain-aware roadside protection. Heights and distances are metres, curve is radians/metre. */
export type GuardMaterial = "timber" | "steel" | "concrete";
export interface GuardSpec { readonly material: GuardMaterial; readonly height: number; readonly strength: number; readonly mass: number; readonly breaks: boolean }
export function roadProtection(drop: number, curve: number, major = false): GuardSpec | null {
  if (!Number.isFinite(drop + curve) || drop < 1.2 || (drop < 3 && Math.abs(curve) < .018)) return null;
  return major || drop > 12 ? { material: "concrete", height: 1.05, strength: 1400000, mass: 2600, breaks: false }
    : drop > 4 || Math.abs(curve) > .055 ? { material: "steel", height: .85, strength: 320000, mass: 180, breaks: true }
    : { material: "timber", height: .75, strength: 75000, mass: 85, breaks: true };
}
export interface RoadGuard extends GuardSpec { readonly x: number; readonly z: number; readonly y: number; readonly yaw: number; readonly hw: number; readonly hd: number }
/** Split long samples so one collider follows each short span, and inspect BOTH shoulders. */
export function roadGuards(x: ArrayLike<number>, z: ArrayLike<number>, y: ArrayLike<number>, half: number | ArrayLike<number>, ground: (x: number, z: number) => number, major = false, clear: (x: number, z: number, y: number) => boolean = () => true): RoadGuard[] {
  const out: RoadGuard[] = [];
  for (let i = 0; i + 1 < x.length; i++) {
    const dx = x[i+1]! - x[i]!, dz = z[i+1]! - z[i]!, len = Math.hypot(dx, dz);
    if (len < .01) continue;
    const a = Math.max(0, i-1), b = Math.min(x.length-1, i+2);
    const before = Math.atan2(dx, dz), after = Math.atan2(x[b]! - x[a]!, z[b]! - z[a]!);
    const curve = Math.atan2(Math.sin(before-after), Math.cos(before-after)) * 2 / len;
    const hw = typeof half === "number" ? half : Math.max(half[i]!, half[i+1]!);
    const count = Math.ceil(len / 4), span = len/count, nx = dz/len, nz = -dx/len;
    for (let k = 0; k < count; k++) for (const side of [-1,1]) {
      const t = (k+.5)/count, cx = x[i]! + dx*t, cz = z[i]! + dz*t, cy = y[i]! + (y[i+1]!-y[i]!)*t;
      const drop = Math.max(...[5,10,18].map(off => cy - ground(cx + nx*side*(hw+off), cz+nz*side*(hw+off))));
      const spec = roadProtection(drop, curve, major); if (!spec) continue;
      const gx = cx+nx*side*(hw+.65), gz = cz+nz*side*(hw+.65);
      if (![ -.5, 0, .5 ].every(q => clear(gx+dx/len*span*q, gz+dz/len*span*q, cy))) continue;
      out.push({ ...spec, x: gx, z: gz, y: cy, yaw: before, hw: spec.material === "concrete" ? .25 : .13, hd: span/2+.05 });
    }
  }
  return out;
}
