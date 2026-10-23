import { toWorld } from "../frame.ts";
import {dsin,dcos} from '@keel-engine/core';
import { dhypot } from '@keel-engine/core/dmath';
import type { Build } from "../frame.ts";
import {ACTIVITY_RADIUS,ACTIVITY_BODY_RADIUS,activityAccess} from './activity-access.ts';
/** Small deterministic activity anchors share the same generated ground and crowd as the park's walks. */
export function parkActivity(b: Build, x: number, z: number, index: number): boolean {
  const p = toWorld(b, x, .1, z);
  if(!b.activityAreasEnabled){
    // Archive reader for accepted legacy worlds. The area recipe below is
    // selected explicitly on its new generation/checkpoint stream.
    if(b.props.some(v=>dhypot(v.x-p[0],v.z-p[2])<v.r+1.7)||b.plants.some(v=>['tree','conifer','bush','hedge'].includes(v.kind)&&dhypot(v.x-p[0],v.z-p[2])<1.7+3.5*v.scale))return false;
    const yaw=b.frame.yaw+b.D.flat('parkActivityTurn',index)*Math.PI;
    b.walks.push({key:`${b.key}:park-activity:${index}`,width:3.4,clearance:2.4,y:p[1],activity:b.D.u('parkActivityKind',index)<.5?'fitness':'play',path:[[p[0],p[2]],[p[0]+dsin(yaw)*.01,p[2]+dcos(yaw)*.01]]});return true;
  }
  const access=activityAccess(b,[p[0],p[2]]);if(!access)return false;
  const yaw = b.frame.yaw + b.D.flat("parkActivityTurn",index)*Math.PI;
  b.activityAreas.push({version:1,key:`${b.key}:park-activity:${index}`,radius:ACTIVITY_RADIUS,bodyRadius:ACTIVITY_BODY_RADIUS,y:p[1],heading:yaw,
    kind:b.D.u("parkActivityKind",index)<.5?"fitness":"play",center:[p[0],p[2]],access});
  return true;
}
