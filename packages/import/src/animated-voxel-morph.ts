/** Compile-time morph sampling; source surfaces never enter the voxel recipe. */
import { identity, mul4 } from './math.ts';
import type { Mat4 } from './math.ts';
import type { ImportScene } from './scene.ts';

export function transformDelta(matrix: Mat4, delta: readonly number[]): number[] {
  return [0, 1, 2].map(row => matrix[row]! * delta[0]! + matrix[row + 4]! * delta[1]! + matrix[row + 8]! * delta[2]!);
}

export function prepareVoxelMorphs(parsed: ImportScene, json: any, accessors: any[]) {
  const meshes = [...parsed.meshes], nodes = parsed.nodes.map(node => ({ ...node }));
  const bindings = new Map<number, { weights: number[]; names?: string[]; corners: Float32Array[] }>();
  for (let ni = 0; ni < nodes.length; ni++) {
    const node = nodes[ni]!; if (node.mesh === undefined) continue;
    const sourceMesh = json.meshes[node.mesh], count = sourceMesh.primitives[0]?.targets?.length ?? 0;
    if (!count) continue;
    if (count > 64) throw Error('Animated voxel morph target budget exceeded');
    const weights: number[] = [...(json.nodes[ni].weights ?? sourceMesh.weights ?? new Array(count).fill(0))];
    const mesh = parsed.meshes[node.mesh]!, triangles = mesh.primitives.reduce((n, p) => n + p.indices.length / 3, 0);
    const corners = Array.from({ length: count }, () => new Float32Array(triangles * 9));
    const skin = node.skin === undefined ? null : parsed.skins[node.skin]!;
    const matrices = skin?.joints.map((joint, i) => mul4(nodes[joint]!.world, skin.inverseBind[i] ?? identity()));
    let corner = 0;
    const primitives = mesh.primitives.map((primitive, pi) => {
      const targets = sourceMesh.primitives[pi].targets;
      if (targets.length !== count) throw Error('Animated voxel mesh morph counts differ');
      const deltas = targets.map((target: any) => target.POSITION === undefined ? null : accessors[target.POSITION]);
      const positions = Float32Array.from(primitive.positions);
      for (let at = 0; at < positions.length; at++) for (let target = 0; target < count; target++) positions[at]! += (deltas[target]?.[at] ?? 0) * weights[target]!;
      for (const vertex of primitive.indices) {
        for (let target = 0; target < count; target++) {
          const delta = [0, 1, 2].map(axis => deltas[target]?.[vertex * 3 + axis] ?? 0);
          let world: number[];
          if (matrices && primitive.joints && primitive.weights) {
            world = [0, 0, 0]; let sum = 0;
            for (let k = 0; k < 4; k++) {
              const weight = primitive.weights[vertex * 4 + k]!; if (!weight) continue;
              const d = transformDelta(matrices[primitive.joints[vertex * 4 + k]!]!, delta);
              for (let axis = 0; axis < 3; axis++) world[axis]! += d[axis]! * weight;
              sum += weight;
            }
            if (!(sum > 0)) throw Error('Animated voxel morph vertex has no skin weights');
            world = world.map(value => value / sum);
          } else world = transformDelta(node.world, delta);
          corners[target]!.set(world, corner * 3);
        }
        corner++;
      }
      return { ...primitive, positions };
    });
    node.mesh = meshes.length; meshes.push({ ...mesh, primitives });
    const names = sourceMesh.extras?.targetNames;
    bindings.set(ni, { weights, ...(Array.isArray(names) && names.length === count && names.every((name: any) => typeof name === 'string') ? { names: [...names] } : {}), corners });
  }
  return { parsed: { ...parsed, meshes, nodes }, bindings };
}
