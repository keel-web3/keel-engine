// Test models, written programmatically in every format the importer reads
// (nothing downloaded): a knight (glTF, skinned: body + helmet + shield +
// cape + sword + belt as separate meshes), a dog with a collar (GLB, no
// skin), a treasure chest with a lid (GLB, a PNG wood texture), a crate (OBJ
// + MTL), a statue on a plinth (binary STL, millimetres, +z up), a little
// robot with an antenna (.vox, two models). Each sample says what a correct
// import finds (its truth), so tests and the page measure against it.

import type { V3 } from "./math.ts";
import { srgbToLinear } from "./scene.ts";
import { addBall, addBox, addCapsule, addCylinder, addSheet, addTorus, meshData, mergeMesh, writeGlb, writeObj, writeStl, writeVox } from "./write.ts";
import type { GltfBuild, GltfBuildNode, MeshData, VertexExtras } from "./write.ts";

/** sRGB 0..255 -> a linear RGBA factor. */
const rgb = (r: number, g: number, b: number): [number, number, number, number] => [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255), 1];

export interface Sample {
  readonly name: string;
  readonly format: "glb" | "gltf" | "obj" | "stl" | "vox";
  /** The file (and its side files: an MTL, textures). */
  readonly bytes?: Uint8Array;
  readonly text?: string;
  readonly mtl?: Readonly<Record<string, string>>;
  /** Import options a user would pick for it (units, height). */
  readonly options: Readonly<Record<string, unknown>>;
  /** What a correct import finds. */
  readonly truth: {
    readonly kind: "creature" | "object";
    readonly plan?: "humanoid" | "quadruped";
    /** Attribute part -> its socket. */
    readonly attributes?: Readonly<Record<string, string>>;
    /** Parts an object splits into (by name). */
    readonly parts?: readonly string[];
  };
}

// A dome shell: the outer cap (radius ro) and the inner (ri) down to `cut` below the centre, joined at the rim -- a
// closed solid, hollow inside (a helmet), so the head keeps its own cells.
function addDome(m: MeshData, c: V3, ro: V3, ri: V3, cut: number, x: VertexExtras, seg = 20, rings = 8): void {
  const th1 = Math.acos(Math.max(-1, Math.min(1, cut)));
  const cap = (r: V3, inward: boolean): number[] => {
    const base = m.positions.length / 3;
    for (let i = 0; i <= rings; i += 1) {
      const th = (th1 * i) / rings;
      for (let j = 0; j <= seg; j += 1) {
        const ph = (2 * Math.PI * j) / seg;
        m.positions.push(c[0] + r[0] * Math.sin(th) * Math.cos(ph), c[1] + r[1] * Math.cos(th), c[2] + r[2] * Math.sin(th) * Math.sin(ph));
        m.uvs.push(j / seg, i / rings);
        const col = x.colour ?? [1, 1, 1, 1];
        m.colours.push(col[0]!, col[1]!, col[2]!, col[3] ?? 1);
        for (let k = 0; k < 4; k += 1) { m.joints.push(x.joints?.[k] ?? 0); m.weights.push(x.weights?.[k] ?? (k ? 0 : 1)); }
      }
    }
    for (let i = 0; i < rings; i += 1) for (let j = 0; j < seg; j += 1) {
      const a = base + i * (seg + 1) + j, b = a + seg + 1;
      if (inward) m.indices.push(a, b, a + 1, a + 1, b, b + 1); else m.indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
    return Array.from({ length: seg + 1 }, (_, j) => base + rings * (seg + 1) + j);
  };
  const outer = cap(ro, false), inner = cap(ri, true);
  for (let j = 0; j < seg; j += 1) m.indices.push(outer[j]!, inner[j]!, outer[j + 1]!, outer[j + 1]!, inner[j]!, inner[j + 1]!);
}

// ---------------------------------------------------------------- the knight (glTF, skinned)

/** The knight's joints (glTF frame: +y up, +z front, its LEFT at +x). */
export const KNIGHT_JOINTS: ReadonlyArray<readonly [string, string | null, V3]> = [
  ["Hips", null, [0, 0.95, 0]], ["Spine", "Hips", [0, 1.1, 0]], ["Chest", "Spine", [0, 1.3, 0]], ["Neck", "Chest", [0, 1.5, 0]], ["Head", "Neck", [0, 1.6, 0]],
  ["LeftShoulder", "Chest", [0.09, 1.44, 0]], ["LeftUpperArm", "LeftShoulder", [0.25, 1.44, 0]], ["LeftLowerArm", "LeftUpperArm", [0.33, 1.17, 0.02]], ["LeftHand", "LeftLowerArm", [0.38, 0.93, 0.05]],
  ["RightShoulder", "Chest", [-0.09, 1.44, 0]], ["RightUpperArm", "RightShoulder", [-0.25, 1.44, 0]], ["RightLowerArm", "RightUpperArm", [-0.33, 1.17, 0.02]], ["RightHand", "RightLowerArm", [-0.38, 0.93, 0.05]],
  ["LeftUpperLeg", "Hips", [0.11, 0.9, 0]], ["LeftLowerLeg", "LeftUpperLeg", [0.12, 0.5, 0.02]], ["LeftFoot", "LeftLowerLeg", [0.12, 0.1, 0]],
  ["RightUpperLeg", "Hips", [-0.11, 0.9, 0]], ["RightLowerLeg", "RightUpperLeg", [-0.12, 0.5, 0.02]], ["RightFoot", "RightLowerLeg", [-0.12, 0.1, 0]],
];

export function knightBuild({ names = true, skin: skinned = true }: { names?: boolean; skin?: boolean } = {}): GltfBuild {
  const J = (n: string): number => KNIGHT_JOINTS.findIndex((j) => j[0] === n);
  const P = (n: string): V3 => KNIGHT_JOINTS[J(n)]![2];
  const w = (n: string): VertexExtras => ({ joints: [J(n)], weights: [1] });
  const mats = [
    { name: "Skin", colour: rgb(226, 178, 142) }, { name: "Tunic", colour: rgb(52, 84, 160) }, { name: "Trousers", colour: rgb(92, 70, 52) }, { name: "Boots", colour: rgb(40, 32, 30) },
    { name: "Steel", colour: rgb(176, 184, 196), metallic: 1 }, { name: "Crimson", colour: rgb(168, 36, 40) }, { name: "Gold", colour: rgb(222, 178, 64), metallic: 1 }, { name: "Leather", colour: rgb(118, 72, 40) },
  ];
  const M = (n: string): number => mats.findIndex((m) => m.name === n);
  // Body: one mesh, four materials (a primitive each), every piece skinned to its bone.
  const skin = meshData(), tunic = meshData(), trousers = meshData(), boots = meshData();
  addBox(trousers, [0, 0.95, 0], [0.16, 0.08, 0.1], w("Hips"));
  addBox(tunic, [0, 1.12, 0], [0.15, 0.1, 0.1], w("Spine"));
  addBox(tunic, [0, 1.34, 0], [0.19, 0.13, 0.11], w("Chest"));
  addCylinder(skin, [0, 1.44, 0], [0, 1.6, 0], 0.05, 0.05, w("Neck"));
  addBall(skin, [0, 1.7, 0.01], [0.12, 0.13, 0.12], w("Head"), 16);
  for (const s of ["Left", "Right"] as const) {
    addCapsule(tunic, P(`${s}Shoulder`), P(`${s}UpperArm`), 0.055, w(`${s}Shoulder`));
    addCapsule(tunic, P(`${s}UpperArm`), P(`${s}LowerArm`), 0.052, w(`${s}UpperArm`));
    addCapsule(skin, P(`${s}LowerArm`), P(`${s}Hand`), 0.046, w(`${s}LowerArm`));
    addBall(skin, [P(`${s}Hand`)[0], P(`${s}Hand`)[1] - 0.04, P(`${s}Hand`)[2]], [0.05, 0.06, 0.05], w(`${s}Hand`), 12);
    addCapsule(trousers, P(`${s}UpperLeg`), P(`${s}LowerLeg`), 0.075, w(`${s}UpperLeg`));
    addCapsule(trousers, P(`${s}LowerLeg`), P(`${s}Foot`), 0.062, w(`${s}LowerLeg`));
    addBox(boots, [P(`${s}Foot`)[0], 0.05, 0.05], [0.055, 0.05, 0.12], w(`${s}Foot`));
  }
  // Helmet: a steel dome over the crown and the back of the head, the face open (skinned to the head).
  const helmet = meshData();
  addDome(helmet, [0, 1.72, -0.005], [0.145, 0.15, 0.145], [0.123, 0.133, 0.123], -0.05, w("Head"));
  addBox(helmet, [0, 1.84, 0], [0.012, 0.035, 0.1], w("Head"));
  // Shield: a crimson disc with a gold boss on the outside of the left forearm.
  const shield = meshData(), boss = meshData();
  const la = P("LeftLowerArm"), lh = P("LeftHand");
  const sc: V3 = [(la[0] + lh[0]) / 2 + 0.075, (la[1] + lh[1]) / 2, (la[2] + lh[2]) / 2 + 0.03];
  addCylinder(shield, [sc[0] - 0.015, sc[1], sc[2]], [sc[0] + 0.015, sc[1], sc[2]], 0.2, 0.2, w("LeftLowerArm"), 20);
  addBall(boss, [sc[0] + 0.02, sc[1], sc[2]], [0.03, 0.05, 0.05], w("LeftLowerArm"), 10);
  // Cape: a crimson sheet from the shoulders to the knees, hanging behind.
  const cape = meshData();
  addSheet(cape, [-0.21, 1.46, -0.125], [0.21, 1.46, -0.125], [-0.24, 0.55, -0.2], 0.025, w("Chest"));
  // Sword: held in the right hand, pointing ahead -- a steel blade, a gold guard, a leather grip.
  const blade = meshData(), guard = meshData(), grip = meshData();
  const rh = P("RightHand");
  const g0: V3 = [rh[0], rh[1] - 0.04, rh[2]];
  addBox(grip, [g0[0], g0[1], g0[2] + 0.02], [0.018, 0.018, 0.08], w("RightHand"));
  addBox(guard, [g0[0], g0[1], g0[2] + 0.11], [0.09, 0.02, 0.018], w("RightHand"));
  addBox(blade, [g0[0], g0[1], g0[2] + 0.52], [0.028, 0.009, 0.4], w("RightHand"));
  // Belt: a leather band round the hips, a gold buckle in front.
  const belt = meshData(), buckle = meshData();
  addTorus(belt, [0, 1.0, 0], 0.175, 0.03, w("Hips"), 24, 8, 0.8, 0.64);
  addBox(buckle, [0, 1.0, 0.125], [0.035, 0.03, 0.015], w("Hips"));
  const nm = (n: string): string => (names ? n : `mesh${n.length}`);
  const meshes = [
    { name: nm("Body"), primitives: [{ mesh: skin, material: M("Skin"), skinned }, { mesh: tunic, material: M("Tunic"), skinned }, { mesh: trousers, material: M("Trousers"), skinned }, { mesh: boots, material: M("Boots"), skinned }] },
    { name: nm("Helmet"), primitives: [{ mesh: helmet, material: M("Steel"), skinned }] },
    { name: nm("Shield"), primitives: [{ mesh: shield, material: M("Crimson"), skinned }, { mesh: boss, material: M("Gold"), skinned }] },
    { name: nm("Cape"), primitives: [{ mesh: cape, material: M("Crimson"), skinned }] },
    { name: nm("Sword"), primitives: [{ mesh: blade, material: M("Steel"), skinned }, { mesh: guard, material: M("Gold"), skinned }, { mesh: grip, material: M("Leather"), skinned }] },
    { name: nm("Belt"), primitives: [{ mesh: belt, material: M("Leather"), skinned }, { mesh: buckle, material: M("Gold"), skinned }] },
  ];
  // Nodes: the joints (locals from the world positions), then an unskinned root holding the six mesh nodes.
  const nodes: GltfBuildNode[] = KNIGHT_JOINTS.map(([name, parent, p]) => {
    const pp = parent ? P(parent) : [0, 0, 0] as V3;
    return { name, ...(parent ? { parent: J(parent) } : {}), t: [p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]] };
  });
  const root = nodes.length;
  nodes.push({ name: "Knight" });
  meshes.forEach((me, i) => nodes.push({ name: names ? me.name : `node${i}`, parent: root, mesh: i, ...(skinned ? { skin: 0 } : {}) }));
  return { nodes, meshes, materials: mats, ...(skinned ? { skins: [{ name: "Armature", joints: KNIGHT_JOINTS.map((_j, i) => i) }] } : {}) };
}

export function knightSample({ names = true }: { names?: boolean } = {}): Sample {
  return {
    name: names ? "knight" : "knight-unnamed", format: "glb", bytes: writeGlb(knightBuild({ names })), options: { voxels: 64 },
    truth: { kind: "creature", plan: "humanoid", attributes: { helmet: "head", shield: "hand.L", cape: "back", sword: "hand.R", belt: "waist" } },
  };
}

// ---------------------------------------------------------------- the dog (GLB, no skin)

export function dogBuild(): GltfBuild {
  const fur = meshData(), belly = meshData(), dark = meshData(), collar = meshData(), tag = meshData();
  const mats = [{ name: "Fur", colour: rgb(176, 112, 58) }, { name: "Cream", colour: rgb(236, 214, 176) }, { name: "Nose", colour: rgb(34, 26, 24) }, { name: "Collar", colour: rgb(40, 110, 200) }, { name: "Tag", colour: rgb(230, 190, 70), metallic: 1 }];
  // Body along +z (the front), legs down, neck up and ahead, head, ears, tail up behind.
  addCapsule(fur, [0, 0.42, -0.22], [0, 0.44, 0.2], 0.13);
  addBox(belly, [0, 0.33, 0], [0.08, 0.035, 0.18]);
  for (const [x, z] of [[0.08, 0.2], [-0.08, 0.2], [0.08, -0.22], [-0.08, -0.22]] as const) {
    addCylinder(fur, [x, 0.4, z], [x, 0.06, z], 0.045, 0.04);
    addBox(belly, [x, 0.03, z + 0.02], [0.045, 0.03, 0.06]);
  }
  addCapsule(fur, [0, 0.5, 0.24], [0, 0.64, 0.34], 0.07);
  addBall(fur, [0, 0.7, 0.38], [0.1, 0.095, 0.11], {}, 16);
  addBox(belly, [0, 0.66, 0.5], [0.05, 0.04, 0.06]);
  addBox(dark, [0, 0.685, 0.565], [0.022, 0.018, 0.012]);
  for (const x of [0.05, -0.05]) addBox(fur, [x, 0.8, 0.36], [0.03, 0.05, 0.02]);
  addCapsule(fur, [0, 0.48, -0.34], [0, 0.66, -0.46], 0.035);
  // Collar: a blue ring round the neck, a gold tag hanging in front.
  addTorus(collar, [0, 0, 0], 0.08, 0.02, {}, 20, 8, 1.3, 1);
  const tilt = 0.85, cz = 0.285, cy = 0.56;
  for (let i = 0; i < collar.positions.length; i += 3) {
    const y = collar.positions[i + 1]!, z = collar.positions[i + 2]!;
    collar.positions[i + 1] = cy + y * Math.cos(tilt) - z * Math.sin(tilt);
    collar.positions[i + 2] = cz + y * Math.sin(tilt) + z * Math.cos(tilt);
  }
  // (The tag hangs from the ring's front, touching it: one piece with the collar.)
  addBall(tag, [0, 0.475, 0.345], [0.024, 0.028, 0.014], {}, 10);
  return {
    nodes: [{ name: "Dog", mesh: 0 }, { name: "Collar", mesh: 1 }],
    meshes: [
      { name: "Dog", primitives: [{ mesh: fur, material: 0 }, { mesh: belly, material: 1 }, { mesh: dark, material: 2 }] },
      { name: "Collar", primitives: [{ mesh: collar, material: 3 }, { mesh: tag, material: 4 }] },
    ],
    materials: mats,
  };
}

export const dogSample = (): Sample => ({ name: "dog", format: "glb", bytes: writeGlb(dogBuild()), options: { voxels: 48 }, truth: { kind: "creature", plan: "quadruped", attributes: { collar: "neck" } } });

// ---------------------------------------------------------------- the treasure chest (GLB, textured)

/** A wood texture: planks in two browns, dark seams, a little grain (RGBA). */
export function woodTexture(w = 32, h = 32): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const plank = Math.floor(y / 8);
    const seam = y % 8 === 0;
    const grain = ((x * 7 + y * 13 + plank * 29) % 11) / 11;
    const base = plank % 2 ? [150, 96, 52] : [132, 84, 44];
    const k = seam ? 0.45 : 0.9 + grain * 0.2;
    data.set([Math.min(255, base[0]! * k), Math.min(255, base[1]! * k), Math.min(255, base[2]! * k), 255], (y * w + x) * 4);
  }
  return { width: w, height: h, data };
}

export function chestBuild(): GltfBuild {
  const base = meshData(), bands = meshData(), lid = meshData(), lidBands = meshData(), lock = meshData();
  addBox(base, [0, 0.2, 0], [0.4, 0.2, 0.25]);
  for (const x of [-0.3, 0.3]) addBox(bands, [x, 0.2, 0], [0.025, 0.205, 0.255]);
  // The lid: a half cylinder along x on top, bands over it.
  const seg = 12;
  const half = meshData();
  for (let i = 0; i < seg; i += 1) {
    const a0 = (Math.PI * i) / seg, a1 = (Math.PI * (i + 1)) / seg;
    const pz = (a: number): number => 0.25 * Math.cos(a), py = (a: number): number => 0.4 + 0.17 * Math.sin(a);
    addBox(half, [0, (py(a0) + py(a1)) / 2 - 0.02, (pz(a0) + pz(a1)) / 2 * 0.96], [0.4, 0.035, Math.abs(pz(a0) - pz(a1)) / 2 + 0.02]);
  }
  mergeMesh(lid, half);
  addBox(lid, [0, 0.42, 0], [0.4, 0.02, 0.25]);
  for (const x of [-0.3, 0.3]) addCylinder(lidBands, [x - 0.025, 0.4, 0], [x + 0.025, 0.4, 0], 0.19, 0.19, {}, 16);
  addBox(lock, [0, 0.36, 0.265], [0.05, 0.06, 0.02]);
  return {
    nodes: [{ name: "Base", mesh: 0 }, { name: "Lid", mesh: 1 }, { name: "Lock", mesh: 2 }],
    meshes: [
      { name: "Base", primitives: [{ mesh: base, material: 0 }, { mesh: bands, material: 1 }] },
      { name: "Lid", primitives: [{ mesh: lid, material: 0 }, { mesh: lidBands, material: 1 }] },
      { name: "Lock", primitives: [{ mesh: lock, material: 2 }] },
    ],
    materials: [{ name: "Wood", colour: [1, 1, 1, 1], texture: 0 }, { name: "Iron", colour: rgb(70, 72, 80), metallic: 1 }, { name: "Gold", colour: rgb(236, 190, 60), metallic: 1 }],
    images: [woodTexture()],
  };
}

export const chestSample = (): Sample => ({ name: "chest", format: "glb", bytes: writeGlb(chestBuild()), options: { voxels: 40 }, truth: { kind: "object", parts: ["base", "lid", "lock"] } });

// ---------------------------------------------------------------- the crate (OBJ + MTL)

export function crateSample(): Sample {
  const frame = meshData(), panels = meshData();
  const s = 0.5, b = 0.05;
  for (const x of [-1, 1]) for (const z of [-1, 1]) addBox(frame, [x * (s - b), s, z * (s - b)], [b, s, b]);
  for (const y of [b, 2 * s - b]) for (const x of [-1, 1]) addBox(frame, [x * (s - b), y, 0], [b, b, s - 2 * b]);
  for (const y of [b, 2 * s - b]) for (const z of [-1, 1]) addBox(frame, [0, y, z * (s - b)], [s - 2 * b, b, b]);
  const inset = s - b * 0.6;
  addBox(panels, [0, s, inset], [s - 2 * b, s - 2 * b, 0.02]); addBox(panels, [0, s, -inset], [s - 2 * b, s - 2 * b, 0.02]);
  addBox(panels, [inset, s, 0], [0.02, s - 2 * b, s - 2 * b]); addBox(panels, [-inset, s, 0], [0.02, s - 2 * b, s - 2 * b]);
  addBox(panels, [0, 2 * s - 0.03, 0], [s - 2 * b, 0.02, s - 2 * b]);
  const { obj, mtl } = writeObj([{ name: "frame", mesh: frame, material: "darkwood" }, { name: "panels", mesh: panels, material: "pine" }], [{ name: "darkwood", colour: rgb(84, 56, 34) }, { name: "pine", colour: rgb(206, 164, 104) }], "crate.mtl");
  return { name: "crate", format: "obj", text: obj, mtl: { "crate.mtl": mtl }, options: { voxels: 32 }, truth: { kind: "object", parts: ["frame", "panels"] } };
}

// ---------------------------------------------------------------- the statue (binary STL, mm, +z up)

export function statueMesh(): MeshData {
  // (Authored +z up in millimetres, the figure facing -y: CAD's convention.)
  const m = meshData();
  const Z = (x: number, y: number, z: number): V3 => [x, y, z];
  addBox(m, Z(0, 0, 90), [260, 260, 90]);
  addBox(m, Z(0, 0, 200), [200, 200, 20]);
  for (const s of [-1, 1]) {
    addCapsule(m, Z(s * 60, 0, 250), Z(s * 62, -10, 560), 42);
    addCapsule(m, Z(s * 62, -10, 560), Z(s * 60, 0, 820), 50);
    addCapsule(m, Z(s * 150, 0, 1150), Z(s * 175, -20, 930), 34);
    addCapsule(m, Z(s * 175, -20, 930), Z(s * 180, -60, 760), 30);
  }
  addBox(m, Z(0, 0, 940), [120, 70, 150]);
  addCapsule(m, Z(-125, 0, 1120), Z(125, 0, 1120), 45);
  addCylinder(m, Z(0, 0, 1150), Z(0, 0, 1230), 40, 40);
  addBall(m, Z(0, -5, 1320), [85, 90, 100], {}, 18);
  return m;
}
export const statueSample = (): Sample => ({ name: "statue", format: "stl", bytes: writeStl(statueMesh(), { name: "statue" }) as Uint8Array, options: { voxels: 56, height: 1.4 }, truth: { kind: "object", parts: ["plinth", "figure"] } });

// ---------------------------------------------------------------- the robot (.vox, two models)

export function robotVox(): Uint8Array {
  // Palette: 1 steel, 2 dark, 3 glow, 4 red.
  const pal = new Uint8Array(256 * 4);
  pal.set([150, 160, 176, 255], 4); pal.set([44, 46, 58, 255], 8); pal.set([120, 240, 255, 255], 12); pal.set([210, 60, 50, 255], 16);
  const body: Array<[number, number, number, number]> = [];
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: number): void => {
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) for (let z = z0; z <= z1; z += 1) body.push([x, y, z, c]);
  };
  // (MagicaVoxel frame: +z up, the front -y. Model 12 x 8 x 22.)
  box(1, 3, 2, 5, 0, 7, 1); box(8, 10, 2, 5, 0, 7, 1);
  box(1, 3, 1, 5, 0, 1, 2); box(8, 10, 1, 5, 0, 1, 2);
  box(0, 11, 1, 6, 8, 15, 1);
  box(4, 7, 0, 0, 10, 12, 4);
  box(2, 9, 1, 6, 16, 21, 1);
  box(3, 4, 0, 0, 18, 19, 3); box(7, 8, 0, 0, 18, 19, 3);
  // Arms: hanging beside the body, a gap between.
  for (const x of [-2, 13]) box(x, x, 2, 5, 6, 15, 2);
  // (Shoulders: the arms hang from the torso's top corners.)
  box(-1, -1, 2, 5, 15, 15, 1); box(12, 12, 2, 5, 15, 15, 1);
  const shift = body.map(([x, y, z, c]) => [x + 2, y, z, c] as [number, number, number, number]);
  const antenna: Array<[number, number, number, number]> = [];
  for (let z = 0; z < 4; z += 1) antenna.push([1, 1, z, 2]);
  antenna.push([1, 1, 4, 3]); antenna.push([0, 1, 4, 3]); antenna.push([2, 1, 4, 3]); antenna.push([1, 0, 4, 3]); antenna.push([1, 2, 4, 3]);
  return writeVox([{ name: "body", size: [16, 8, 22], voxels: shift }, { name: "antenna", size: [3, 3, 5], voxels: antenna, t: [0, 0, 13] }], pal);
}
export const robotSample = (): Sample => ({ name: "robot", format: "vox", bytes: robotVox(), options: {}, truth: { kind: "creature", plan: "humanoid", attributes: { antenna: "head" } } });

/** Every sample. */
export const SAMPLES = (): Sample[] => [knightSample(), dogSample(), chestSample(), crateSample(), statueSample(), robotSample()];
