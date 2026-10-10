// Separate program: writing analytic depth must not disable early depth testing for ordinary mesh draws.
import { MESH_VS, MESH_GFS } from './mesh.ts';

export const CAPSULE_VS = MESH_VS
  .replace('void main() {', `layout(location=5) in vec4 aCapsuleA;
layout(location=6) in vec4 aCapsuleB;
flat out vec4 vCapsuleA;
flat out vec3 vCapsuleB;
void main() {
  vCapsuleA = vec4((uModel * vec4(aCapsuleA.xyz, 1.0)).xyz, aCapsuleA.w * length(uModel[0].xyz));
  vCapsuleB = (uModel * vec4(aCapsuleB.xyz, 1.0)).xyz;`);

// Unit-direction ray/capsule intersection. Fixed analytic work: cylinder plus two hemispheres, no march loop.
export const CAPSULE_INTERSECTION_GLSL = `
float capsuleSphere(vec3 oc, vec3 rd, float r) {
  float b = dot(oc, rd), h = b * b - dot(oc, oc) + r * r;
  if (h < 0.0) return 1e30;
  float t = -b - sqrt(h);
  return t >= 0.0 ? t : 1e30;
}
float capsuleHit(vec3 ro, vec3 rd, vec3 a, vec3 b, float r) {
  vec3 ba = b - a, oa = ro - a;
  float baba = dot(ba, ba), best = min(capsuleSphere(oa, rd, r), capsuleSphere(ro - b, rd, r));
  if (baba < 1e-12) return best;
  float bard = dot(ba, rd), baoa = dot(ba, oa);
  float aa = baba - bard * bard, bb = baba * dot(rd, oa) - baoa * bard;
  float cc = baba * dot(oa, oa) - baoa * baoa - r * r * baba, h = bb * bb - aa * cc;
  if (h >= 0.0 && aa > 1e-12 * baba) {
    float t = (-bb - sqrt(h)) / aa, y = baoa + t * bard;
    if (t >= 0.0 && y >= 0.0 && y <= baba) best = min(best, t);
  }
  return best;
}`;

const extra = `
uniform mat4 uModel, uProj;
uniform vec3 uCenter, uUp, uBodyLo, uBodySpan;
uniform float uDepthRange, uClipRange, uTie;
uniform int uPersp, uGround;
flat in vec4 vCapsuleA;
flat in vec3 vCapsuleB;
${CAPSULE_INTERSECTION_GLSL}
`;

const split = MESH_GFS.indexOf('void main() {');
const body = MESH_GFS.slice(split).replace(/\bvW\b/g, 'hitW').replace(/\bvN\b/g, 'hitN')
  .replace(/\bvBody\b/g, 'hitBody').replace(/\bvAttr\b/g, 'hitAttr')
  .replace(/\bvScene\b/g, 'hitScene').replace(/\bvView\b/g, 'hitView');
export const CAPSULE_GFS = MESH_GFS.slice(0, split) + extra + body.replace('void main() {', `void main() {
  vec3 hitW = vW, hitN = vN, hitBody = vBody, hitAttr = vAttr;
  float hitScene = vScene, hitView = vView;
  float depth = gl_FragCoord.z;
  if (vCapsuleA.w > 0.0) {
    // KEEL projects positive forward depth; the proxy entry faces have clockwise screen winding.
    if (gl_FrontFacing) discard;
    vec3 rd = uPersp == 1 ? normalize(vW - uCenter) : normalize(uForward);
    // Start just before the proxy entry, in capsule-relative space. Avoid cancellation from distant camera coordinates.
    vec3 ro = vW - rd * max(1e-5, vCapsuleA.w * 1e-4);
    float t = capsuleHit(ro - vCapsuleA.xyz, rd, vec3(0.0), vCapsuleB - vCapsuleA.xyz, vCapsuleA.w);
    if (t > 1e29) discard;
    hitW = ro + t * rd;
    vec3 ba = vCapsuleB - vCapsuleA.xyz;
    float len = length(ba), along = len > 1e-6 ? dot(hitW - vCapsuleA.xyz, ba / len) : 0.0;
    hitN = normalize(hitW - vCapsuleA.xyz - (len > 1e-6 ? ba / len * clamp(along, 0.0, len) : vec3(0.0)));
    // Selection permits only similarity transforms, so transpose is the exact inverse up to scale squared.
    float scale2 = dot(uModel[0].xyz, uModel[0].xyz);
    vec3 local = transpose(mat3(uModel)) * (hitW - uModel[3].xyz) / scale2;
    vec3 localA = transpose(mat3(uModel)) * (vCapsuleA.xyz - uModel[3].xyz) / scale2;
    vec3 localB = transpose(mat3(uModel)) * (vCapsuleB - uModel[3].xyz) / scale2;
    vec3 axis = len > 1e-6 ? normalize(localB - localA) : vec3(0.0, 1.0, 0.0);
    vec3 e1 = normalize(cross(axis, abs(axis.y) < 0.9 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0)));
    vec3 e2 = cross(axis, e1), q = local - localA;
    hitAttr.y = (atan(dot(q, e2), dot(q, e1)) + 3.141592653589793) / 6.283185307179586;
    hitAttr.z = clamp((along + vCapsuleA.w) / (len + 2.0 * vCapsuleA.w), 0.0, 1.0);
    hitBody = clamp((local - uBodyLo) / uBodySpan, 0.0, 1.0);
    hitView = dot(hitW - uCenter, uForward);
    float cp = max(uUp.y, 1e-4);
    float gd = uGround == 1 ? cp * (hitW.x * uForward.x / cp + hitW.z * uForward.z / cp) - dot(uCenter, uForward) : hitView;
    hitScene = clamp(0.5 + (gd - uTie) / uDepthRange, 0.0, 1.0);
    vec4 clip = uProj * vec4(hitW, 1.0);
    depth = uPersp == 1 ? clip.z / clip.w * 0.5 + 0.5 : clamp(0.5 + hitView / uClipRange, 0.0, 1.0);
    if (uPersp == 1 && (clip.w <= 0.0 || depth < 0.0 || depth > 1.0)) discard;
  }
  gl_FragDepth = depth;`);
