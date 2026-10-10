// Adjacent runs only: preserve submission order, per-instance IDs and depth ties.
import type { MeshDraw } from './sprite-shaders.ts';
export const MESH_INSTANCE_LIMIT = 256;
export function compatibleMeshInstances(a: MeshDraw, b: MeshDraw): boolean {
  return !a.parts && !b.parts && !a.range && !b.range && !a.regionLandBatch && !b.regionLandBatch
    && a.glow === b.glow && (a.owner ?? 0) === (b.owner ?? 0)
    && (a.light ?? 1) === (b.light ?? 1) && (a.flash ?? 0) === (b.flash ?? 0)
    && (a.fade ?? 1) === (b.fade ?? 1) && !!a.fadeInvert === !!b.fadeInvert
    && (a.chunk ?? 1) === (b.chunk ?? 1) && !!a.marked === !!b.marked
    && (a.snow ?? 1) === (b.snow ?? 1)
    && (a.wipe?.[0] ?? -1) === (b.wipe?.[0] ?? -1) && (a.wipe?.[1] ?? 0) === (b.wipe?.[1] ?? 0);
}
// Six RGBA texels per instance: matrix columns, look/logical ID/snap, dither anchor.
// Matrices live in the same texture in BOTH stages, so analytic hit UVs use the right inverse transform.
const table = `
uniform highp sampler2D uBatch;
mat4 instanceModel(int row) { return mat4(texelFetch(uBatch, ivec2(0,row),0),texelFetch(uBatch,ivec2(1,row),0),texelFetch(uBatch,ivec2(2,row),0),texelFetch(uBatch,ivec2(3,row),0)); }
`;
export function instancedMeshVertex(source: string): string {
  return source.replace('void main() {', `${table}
flat out int vInstanceRow;
#define uModel instanceModel(gl_InstanceID)
#define uSnap texelFetch(uBatch,ivec2(4,gl_InstanceID),0).zw
void main() { vInstanceRow = gl_InstanceID;`);
}
export function instancedMeshFragment(source: string): string {
  return source.replace('void main() {', `${table}
flat in int vInstanceRow;
#define uModel instanceModel(vInstanceRow)
#define uLook int(texelFetch(uBatch,ivec2(4,vInstanceRow),0).x)
#define uDraw int(texelFetch(uBatch,ivec2(4,vInstanceRow),0).y)
#define uAnchor ivec2(texelFetch(uBatch,ivec2(5,vInstanceRow),0).xy)
void main() {`);
}
