import { dsin, dcos } from "@keel-engine/core";
import { toWorld } from "../frame.ts";
import type { Build } from "../frame.ts";
/** Small deterministic activity anchors share the same generated ground and crowd as the park's walks. */
export function parkActivity(b: Build, x: number, z: number, index: number): boolean {
  const p = toWorld(b, x, .1, z);
  // A playing resident has room to move their limbs/ball, away from trunks, lamps and seats.
  if (b.props.some(v => Math.hypot(v.x-p[0],v.z-p[2]) < v.r+1.7) ||
    b.plants.some(v => (v.kind === "tree" || v.kind === "conifer" || v.kind === "bush" || v.kind === "hedge") &&
      Math.hypot(v.x-p[0],v.z-p[2]) < 1.7+3.5*v.scale)) return false;
  const yaw = b.frame.yaw + b.D.flat("parkActivityTurn",index)*Math.PI;
  b.walks.push({key:`${b.key}:park-activity:${index}`,width:3.4,clearance:2.4,y:p[1],
    activity:b.D.u("parkActivityKind",index)<.5?"fitness":"play",
    path:[[p[0],p[2]],[p[0]+dsin(yaw)*.01,p[2]+dcos(yaw)*.01]]});
  return true;
}
