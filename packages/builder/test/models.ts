// Hand-built sample models (as a person would build them in the editor), for
// the tests: a classic block-figure person, a dog with a neck and tail, a
// knight with arms held out, a top hat, a flag, a door.
import { createEditor, createVoxels } from "../src/index.ts";
import type { VoxelModel } from "../src/index.ts";

/** Classic block-figure proportions: legs 4x12x4 side by side (touching), torso 8x12x4, arms 4x12x4, head 8x8x8. 1/16 m voxels: 2 m tall. */
export function blockPerson(): VoxelModel {
  const m = createVoxels({ unit: 1 / 16, name: "block-person" });
  const ed = createEditor(m, { symmetry: { mode: "x" } });
  ed.box([0, 0, -2], [3, 11, 1], "secondary");      // legs (x 0..3 and its mirror -4..-1: touching)
  ed.box([0, 0, -2], [3, 1, 1], "dark");            // shoes
  ed.box([0, 12, -2], [3, 23, 1], "primary");       // torso
  ed.box([4, 12, -2], [7, 23, 1], "primary");       // arms
  ed.box([4, 12, -2], [7, 14, 1], "skin");          // hands
  ed.box([0, 24, -4], [3, 31, 3], "skin");          // head
  ed.box([0, 30, -4], [3, 31, 3], "dark");          // hair
  ed.set([2, 27, 3], "accent");                      // an eye
  return m;
}

/** A dog: a body on four legs, a neck up to a head with a snout, a tail up and back. */
export function dog(): VoxelModel {
  const m = createVoxels({ unit: 0.05, name: "dog" });
  const ed = createEditor(m, { symmetry: { mode: "x" } });
  ed.box([1, 0, 4], [2, 5, 5], "primary");           // front legs
  ed.box([1, 0, -6], [2, 5, -5], "primary");         // hind legs
  ed.box([0, 6, -6], [2, 10, 5], "primary");         // body
  ed.box([0, 6, -5], [1, 6, 4], "secondary");        // belly
  ed.box([0, 10, 5], [1, 13, 7], "primary");         // neck, rising ahead
  ed.box([0, 13, 6], [2, 16, 10], "skin");           // head
  ed.box([0, 13, 11], [1, 14, 12], "skin");          // snout
  ed.set([0, 14, 12], "dark");                        // nose
  ed.box([2, 17, 7], [2, 18, 7], "trim");            // ears
  ed.line([0, 10, -7], [0, 14, -10], "secondary");   // tail
  return m;
}

/** A knight in a T-pose: arms straight out. */
export function knight(): VoxelModel {
  const m = createVoxels({ unit: 0.08, name: "knight" });
  const ed = createEditor(m, { symmetry: { mode: "x" } });
  ed.box([1, 0, -1], [2, 6, 1], "trim");
  ed.box([0, 7, -1], [3, 13, 1], "primary");
  ed.box([4, 12, -1], [10, 13, 0], "primary");       // arm, held out
  ed.box([0, 14, -2], [2, 18, 2], "trim");           // helmet
  ed.box([0, 16, 2], [1, 16, 2], "dark");            // visor slit
  return m;
}

/** A top hat: a brim and a crown, a band. Built sitting on y = 0. */
export function topHat(): VoxelModel {
  const m = createVoxels({ unit: 0.02, name: "top-hat" });
  const ed = createEditor(m, { symmetry: { mode: "xz" } });
  ed.box([0, 0, 0], [5, 0, 5], "dark");
  ed.box([0, 1, 0], [3, 8, 3], "dark");
  ed.box([0, 2, 0], [3, 2, 3], "accent");
  m.groups.set("band", [{ min: [-4, 2, -4], max: [3, 2, 3] }]);
  return m;
}

/** A flag on a pole: 12 x 8 cloth, one voxel thick, a stripe. */
export function flag(): VoxelModel {
  const m = createVoxels({ unit: 0.05, name: "flag" });
  const ed = createEditor(m);
  ed.box([0, 0, 0], [0, 20, 0], "trim");
  ed.box([1, 12, 0], [12, 19, 0], "primary");
  ed.box([1, 15, 0], [12, 16, 0], "secondary");
  m.groups.set("cloth", [{ min: [1, 12, 0], max: [12, 19, 0] }]);
  return m;
}

/** A doorway: a frame, and a door in it (the group "door" -- front detection reads the word). */
export function doorway(): VoxelModel {
  const m = createVoxels({ unit: 0.1, name: "doorway" });
  const ed = createEditor(m);
  ed.box([-6, 0, -2], [5, 12, 0], "primary");
  ed.box([-2, 0, 1], [1, 8, 1], "secondary");
  ed.box([1, 4, 2], [1, 4, 2], "trim");
  m.groups.set("door", [{ min: [-2, 0, 1], max: [1, 8, 2] }]);
  return m;
}
