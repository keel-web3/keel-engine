import { apply, poseSkeleton, type Bone, type Rig, type Skeleton, type Pose } from "@keel-engine/entity";
import { bodySpace, meshBounds, lookMesh, mergeMeshes, paintRoles, type LookMesh, type ExplicitSkin, type BakeWorld, type LayerPaint } from "@keel-engine/bake";
import { defineProfile, worldLook, slotOf, type WorldRoles } from "@keel-engine/object";
import { robotIdentityKey, validateRobotGenome, ROBOT_FAMILIES, type RobotGenome, type RobotForm, type RobotFamilyBlueprint } from "./genome.ts";

export const ROBOT_ROLES = {
  primary: { as: "primary", stuff: "paint" }, secondary: { as: "secondary", stuff: "paint" },
  trim: { as: "trim", stuff: "metal" }, metal: { as: "metal", stuff: "metal" }, dark: { as: "dark", stuff: "paint" }, glow: { as: "glow", stuff: "glow" },
} as const satisfies WorldRoles;
type V3 = [number, number, number];
type Skin = { capsules: ExplicitSkin["capsules"][number][]; boxes: ExplicitSkin["boxes"][number][] };
interface RobotRigBody { readonly genome: RobotGenome; readonly centerHeight: number }
export interface RobotDesign {
  readonly genome: RobotGenome; readonly identity: string; readonly rig: Rig<RobotRigBody>;
  /** Explicit KEEL entity skin; custom robot contract, with no standard gait claim. */
  skin(skeleton: Skeleton): ExplicitSkin;
  mesh(form: RobotForm): LookMesh;
}
const add = (a: readonly number[], b: readonly number[]): V3 => [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
const slot = (role: keyof typeof ROBOT_ROLES): number => slotOf(ROBOT_ROLES, role);

/** A custom folding bone tree uses KEEL's actual forward-kinematics engine.
 * The plan tag selects its FK coordinate convention; this entity provides
 * body/rollable-robot, never humanoid/quadruped gait compatibility. */
export function robotRig(genome: RobotGenome): Rig<RobotRigBody> {
  const g = genome, centerHeight = g.family.morphology === "radial" ? .55 : g.limbs.reach * .90 + g.hull.size[1] * .55 + .065;
  const bones: Bone[] = [{ name: "body", parent: null, off: [0, centerHeight, 0] }, { name: "head", parent: "body", off: [0, g.hull.size[1] + .18, g.hull.size[2] * .40] }];
  for (let i = 0; i < g.limbs.count; i++) {
    const angle = g.family.morphology === "biped" ? (i ? Math.PI / 2 : -Math.PI / 2) : Math.PI * 2 * i / g.limbs.count + Math.PI / 4;
    const radial = g.family.morphology === "radial", x = Math.sin(angle), z = Math.cos(angle);
    bones.push({ name: `limb.${i}`, parent: "body", off: [x * g.hull.size[0] * .8, radial ? 0 : -g.hull.size[1] * .55, z * g.hull.size[2] * .8] });
    bones.push({ name: `joint.${i}`, parent: `limb.${i}`, off: [x * g.limbs.reach * .40, radial ? -.06 : -g.limbs.reach * .40, z * g.limbs.reach * .40] });
    bones.push({ name: `foot.${i}`, parent: `joint.${i}`, off: [x * g.limbs.reach * .20, radial ? -.05 : -g.limbs.reach * .50, z * g.limbs.reach * .20] });
  }
  for (let i = 0; i < g.shell.panels; i++) { const a = i * Math.PI * 2 / g.shell.panels + g.shell.phase;
    bones.push({ name: `panel.${i}`, parent: "body", off: [Math.sin(a) * g.hull.size[0] * .95, .10, Math.cos(a) * g.hull.size[2] * .95] });
  }
  const index = Object.fromEntries(bones.map((b, i) => [b.name, i])), children = Object.fromEntries(bones.map(b => [b.name, bones.filter(child => child.parent === b.name).map(child => child.name)]));
  return { plan: "humanoid", bones, index, children, chains: {}, body: { genome, centerHeight }, top: "body" };
}

export function robotSkin(genome: RobotGenome, skeleton: Skeleton): ExplicitSkin {
  const g = genome, out: Skin = { capsules: [], boxes: [] };
  const point = (bone: string, p: V3 = [0, 0, 0]): V3 => { const b = skeleton.bones[bone]; if (!b) throw new RangeError(`Robot bone absent: ${bone}`); return add(b.p, apply(b.m, p)); };
  const cap = (part: string, role: keyof typeof ROBOT_ROLES, bone: string, a: V3, b: V3, r: number) => out.capsules.push({ part, role, a: point(bone, a), b: point(bone, b), r });
  const box = (part: string, role: keyof typeof ROBOT_ROLES, bone: string, c: V3, h: V3, yaw = 0) => { const m = skeleton.bones[bone]!.m; out.boxes.push({ part, role, c: point(bone, c), h, yaw: Math.atan2(m[2]!, m[8]!) + yaw }); };
  const [w, h, d] = g.hull.size;
  switch (g.hull.base) {
    case "stepped-service-hull":
      box("body.service-foot", "secondary", "body", [0, -h * .48, 0], [w, h * .43, d]);
      box("body.service-step", "primary", "body", [0, h * .05, -d * .08], [w * (1 - g.hull.bevel), h * .28, d * .91]);
      box("body.service-cap", "primary", "body", [0, h * .54, -d * .10], [w * .67, h * .28, d * .73]); break;
    case "round-shoulder-hull":
      box("body.service-core", "secondary", "body", [0, -.08, 0], [w * .75, h * .65, d]);
      for (const side of [-1, 1]) cap(`body.shoulder${side}`, "primary", "body", [side * w * .65, h * .2, -d * .55], [side * w * .65, h * .2, d * .55], Math.min(w * .43, h * .58)); break;
    case "lenticular-core":
      cap("body.lens-core", "primary", "body", [-w * .45, 0, 0], [w * .45, 0, 0], Math.min(h, d));
      box("body.lens-keel", "secondary", "body", [0, -h * .45, -d * .20], [w * .63, h * .26, d * .85]); break;
    case "vented-lens-core":
      cap("body.vent-core", "primary", "body", [0, -h * .55, 0], [0, h * .45, 0], Math.min(w, d) * .85);
      for (const side of [-1, 1]) for (let i = 0; i < 3; i++) box(`body.vent${side}.${i}`, "metal", "body", [side * w * .88, (i - 1) * h * .45, 0], [w * .12, h * .12, d * .83]); break;
    case "low-load-hull":
      box("body.load-floor", "secondary", "body", [0, -h * .42, 0], [w, h * .38, d]);
      box("body.load-ridge", "primary", "body", [0, h * .27, -d * .25], [w * .85, h * .32, d * .71]); break;
    case "armored-saddle-hull":
      box("body.saddle-core", "secondary", "body", [0, -h * .14, 0], [w * .68, h * .67, d]);
      for (const side of [-1, 1]) box(`body.saddle-armor${side}`, "primary", "body", [side * w * .81, .01, 0], [w * .17, h * .9, d * .84]);
      cap("body.saddle-bridge", "metal", "body", [-w * .70, h * .77, -d * .28], [w * .70, h * .77, -d * .28], .055); break;
    case "long-rib-core":
      cap("body.rib-core", "secondary", "body", [0, -h * .78, 0], [0, h * .64, 0], Math.min(w, d) * .58);
      for (const side of [-1, 1]) cap(`body.rib-shell${side}`, "primary", "body", [side * w * .68, -h * .62, -d * .15], [side * w * .58, h * .64, -d * .35], w * .29); break;
    case "split-crown-core":
      box("body.crown-foot", "secondary", "body", [0, -h * .58, 0], [w, h * .29, d * .72]);
      for (const side of [-1, 1]) box(`body.crown-prong${side}`, "primary", "body", [side * w * .55, h * .1, -d * .15], [w * .29, h * .76, d * .77]); break;
    default: throw new RangeError("Robot hull has no geometry");
  }
  if (g.livery.base === "three-rib-inlay") for (let i = -1; i <= 1; i++) cap(`body.livery-rib${i}`, "trim", "body", [i * w * .5, h * .66, -d * .66], [i * w * .5, h * .66, d * .7], .025);
  else if (g.livery.base === "split-chevron") for (const side of [-1, 1]) cap(`body.livery-chevron${side}`, "trim", "body", [side * w * .73, h * .52, d * .90], [g.livery.offset * w, -h * .02, d * 1.01], .025);
  else box("body.livery", "trim", "body", [g.livery.offset * w, h * .73, 0], [g.livery.width * w * (g.livery.base === "dorsal-saddle" ? 2 : 1), .025, d * .88]);
  for (const side of [-1, 1]) cap(`body.rivet${side}`, "metal", "body", [side * w * .85, h * .6, d * .87], [side * w * .85, h * .6, d * .87], g.hull.rivetRadius);
  if (g.family.morphology === "radial") {
    cap("head.radial-hood", "primary", "head", [0, .03, -.055], [0, .03, .015], g.face.width * 1.05);
    box("head.radial-recess", "dark", "head", [g.face.offset, .03, .28], [g.face.width * .76, g.face.width * .76, .025]);
  } else if (g.family.morphology === "quadruped") {
    box("head.load-brow", "primary", "head", [0, .02, -.04], [g.face.width * 1.40, .125, .25]);
    box("head.load-jaw", "secondary", "head", [0, -.105, .11], [g.face.width * 1.18, .075, .145]);
    box("head.recess", "dark", "head", [g.face.offset, .025, .225], [g.face.width * 1.05, .065, .027]);
  } else if (g.family.morphology === "tripod") {
    box("head.sensor-spine", "secondary", "head", [0, -.04, -.08], [g.face.width * .60, .255, .17]);
    for (const side of [-1, 1]) box(`head.sensor-cheek${side}`, "primary", "head", [side * g.face.width * .72, .055, .075], [g.face.width * .23, .20, .11]);
    box("head.recess", "dark", "head", [g.face.offset, .04, .19], [g.face.width * .88, .13, .025]);
  } else {
    box("head.service-crown", "primary", "head", [0, .10, -.025], [g.face.width * 1.13, .125, .205]);
    box("head.service-jaw", "secondary", "head", [0, -.09, -.035], [g.face.width * .90, .085, .18]);
    box("head.recess", "dark", "head", [g.face.offset, .04, .195], [g.face.width, .10, .030]);
  }
  if (g.face.base === "concentric-lens") {
    cap("head.lens-rim", "metal", "head", [g.face.offset, .04, .23], [g.face.offset, .04, .25], g.face.lensRadius);
    cap("head.lens", "glow", "head", [g.face.offset, .04, .31], [g.face.offset, .04, .315], g.face.lensRadius * .66);
  } else if (g.face.base === "paired-eyes") for (const side of [-1, 1]) cap(`head.eye${side}`, "glow", "head", [side * g.face.width * .48 + g.face.offset, .04, .26], [side * g.face.width * .48 + g.face.offset, .04, .28], g.face.height * .8);
  else if (g.face.base === "split-crest") for (const side of [-1, 1]) { box(`head.crest${side}`, "trim", "head", [side * .12, .31, .08], [.055, .19, .07]); cap(`head.crest-eye${side}`, "glow", "head", [side * .12, .05, .26], [side * .12, .13, .27], .032); }
  else box("head.visor", "glow", "head", [g.face.offset, g.face.base === "brow-slit" ? -.01 : .06, .258], [g.face.width * .82, g.face.height, .012]);
  for (let i = 0; i < g.limbs.count; i++) {
    cap(`limb.upper${i}`, "metal", `limb.${i}`, [0, 0, 0], [0, 0, 0], g.limbs.jointRadius);
    out.capsules.push({ part: `limb.link${i}`, role: "secondary", a: point(`limb.${i}`), b: point(`joint.${i}`), r: g.limbs.jointRadius * .60 }, { part: `limb.lower${i}`, role: "metal", a: point(`joint.${i}`), b: point(`foot.${i}`), r: g.limbs.jointRadius * .42 });
    box(`foot.pad${i}`, "primary", `foot.${i}`, [0, 0, .04], [g.limbs.footWidth, .065, g.limbs.footWidth * 1.2]);
  }
  for (let i = 0; i < g.shell.panels; i++) {
    const a = i * Math.PI * 2 / g.shell.panels + g.shell.phase, role = i % 2 ? "primary" : "secondary", bone = `panel.${i}`;
    cap(`shell.hinge${i}`, "metal", bone, [0, -.02, 0], [0, .02, 0], .052);
    if (g.shell.grammar === "ribs") {
      const c: V3 = [Math.sin(a) * .23, .23, Math.cos(a) * .23];
      box(`shell.rib-plate${i}`, role, bone, c, [.065, .30, .22], a);
      cap(`shell.inlay${i}`, "trim", bone, [Math.sin(a) * .10, .02, Math.cos(a) * .10], [Math.sin(a) * .35, .49, Math.cos(a) * .35], .022);
    } else if (g.shell.grammar === "clamshell") {
      box(`shell.clam-plate${i}`, role, bone, [Math.sin(a) * .10, .22, Math.cos(a) * .10], [w * .67, .085, d * .70], a);
      cap(`shell.inlay${i}`, "trim", bone, [-w * .56, .315, 0], [w * .56, .315, 0], .024);
    } else {
      const reach = g.shell.grammar === "iris" ? .26 : .22;
      box(`shell.${g.shell.grammar}-plate${i}`, role, bone, [Math.sin(a) * reach * .5, .095, Math.cos(a) * reach * .5], [g.shell.grammar === "iris" ? .095 : .13, .045, reach * .72], a);
      cap(`shell.inlay${i}`, "trim", bone, [0, .148, 0], [Math.sin(a) * reach, .148, Math.cos(a) * reach], .018);
    }
  }
  const gearY = -h * .2;
  if (g.gear.base === "retracted-tool-dock") cap("gear.tool-dock", "metal", "body", [w * .8, gearY, -d], [w * .8, gearY, -d + g.gear.width], .05);
  else if (g.gear.base === "folded-sensor-cradle") for (const side of [-1, 1]) cap(`gear.sensor${side}`, "trim", "head", [side * .16, .18, -.15], [side * .21, .48, -.12], .03);
  else if (g.gear.base === "retracted-load-cleat") {
    cap("gear.load-bridge", "metal", "body", [-g.gear.width, gearY, -d - .04], [g.gear.width, gearY, -d - .04], .06);
    for (const side of [-1, 1]) box(`gear.load-cleat${side}`, "trim", "body", [side * g.gear.width, gearY, -d - .09], [.065, .16, .085]);
  } else if (g.gear.base === "sealed-courier-pocket") box("gear.sealed-pocket", "secondary", "body", [0, gearY, -d - .035], [g.gear.width, .11, .075]);
  else throw new RangeError("Robot gear has no geometry");
  return out;
}
const worldFromSkin = (skin: ExplicitSkin): BakeWorld => ({ boxes: skin.boxes.map(b => ({ ...b, mat: slot(b.role as keyof typeof ROBOT_ROLES) })), capsules: skin.capsules.map(c => ({ ...c, mat: slot(c.role as keyof typeof ROBOT_ROLES) })) });

/** A unit sphere envelope is the ordinary canonical ball's radius, not a
 * cosmetic collider. Every face, hinge, gear mark and seam stays inside it. */
export function robotRolledMesh(genome: RobotGenome): LookMesh {
  const g = genome, ps: number[] = [], ns: number[] = [], attrs: number[] = [], indices: number[] = [];
  const columns = Math.max(24, g.shell.panels * 6), rows = 12;
  // Every family is a closed, star-shaped shell inside the same true radius.
  // Large named panel masses change the visible contour; the gear never hangs
  // outside the transport clearance. Poles retain the native contact envelope.
  const shellRadius = (a: number, b: number): number => {
    const waist = Math.cos(b) ** 2, phase = a + g.shell.phase;
    if (g.shell.grammar === "petals") return g.shell.facet * (1 - waist * (.18 - .18 * Math.abs(Math.cos(phase * 2)) ** 3));
    if (g.shell.grammar === "iris") return g.shell.facet * (1 - waist * (.16 - .16 * (.5 + .5 * Math.cos(phase * g.shell.panels + b * 1.5)) ** 5));
    if (g.shell.grammar === "clamshell") return g.shell.facet * (1 - waist * (.14 - .14 * Math.abs(Math.cos(phase * 2)) ** .55));
    return g.shell.facet * (1 - waist * (.21 - .21 * (.5 + .5 * Math.cos(phase * g.shell.panels)) ** 8));
  };
  const vertex = (a: number, b: number, offset = 0): V3 => { const radius=shellRadius(a,b)+offset;return[Math.sin(a)*Math.cos(b)*radius,Math.sin(b)*radius,Math.cos(a)*Math.cos(b)*radius]; };
  const normal = (a:number,b:number):V3=>{const e=.0001,p=vertex(a,b),aa=vertex(a+e,b),ab=vertex(a-e,b),ba=vertex(a,b+e),bb=vertex(a,b-e),u=aa.map((n,i)=>n-ab[i]!),v=ba.map((n,i)=>n-bb[i]!),cross=[u[1]!*v[2]!-u[2]!*v[1]!,u[2]!*v[0]!-u[0]!*v[2]!,u[0]!*v[1]!-u[1]!*v[0]!],length=Math.hypot(...cross);return(length>1e-8?cross.map(n=>n/length):p.map(n=>n/(Math.hypot(...p)||1))) as V3;};
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const a0 = column / columns * Math.PI * 2 - Math.PI, a1 = (column + 1) / columns * Math.PI * 2 - Math.PI, b0 = row / rows * Math.PI - Math.PI / 2, b1 = (row + 1) / rows * Math.PI - Math.PI / 2, a = (a0 + a1) * .5, b = (b0 + b1) * .5;
    const turn=a+g.shell.phase, panel=((turn+Math.PI)*g.shell.panels/(Math.PI*2)+ (g.shell.grammar==="iris"?b*.14:0))%1;
    const seam=g.shell.grammar==="clamshell"?Math.abs(Math.sin(turn))<g.shell.seam*2:Math.min(panel,1-panel)<g.shell.seam;
    const rib=(.5+.5*Math.cos(turn*g.shell.panels))**8;
    let role:keyof typeof ROBOT_ROLES=g.shell.grammar==="ribs"?(rib>.42?"primary":"dark"):g.shell.grammar==="clamshell"?(Math.sin(turn)>0?"primary":"secondary"):g.shell.grammar==="iris"?(Math.floor((turn+Math.PI)*g.shell.panels/(Math.PI*2))%2?"primary":"secondary"):"primary";
    if(seam)role="dark";
    // Liveries follow the family's actual panel grammar. No universal bright
    // latitude belt erases the different shell masses at native playing size.
    const stripe=g.livery.base==="dorsal-saddle"?Math.abs(turn-g.livery.offset)<g.livery.width&&b>.25:g.livery.base==="split-chevron"?Math.abs(b-Math.abs(turn)*.20-g.livery.offset)<g.livery.width*.40&&Math.abs(turn)<.85:g.livery.base==="three-rib-inlay"?rib>.65&&Math.abs(b)<.6:Math.abs(turn-g.livery.offset-.50)<g.livery.width*.50&&Math.abs(b)<.7;
    if(stripe&&!seam)role="trim";
    if(g.shell.grammar==="clamshell"&&b>.72&&Math.abs(Math.sin(turn))<.18)role="metal";
    const angles=[[a0,b0],[a1,b0],[a1,b1],[a0,b1]] as const,points=angles.map(([a,b])=>vertex(a,b,seam?-.025:0)),base=ps.length/3;
    for (let i=0;i<points.length;i++) { const p=points[i]!,angle=angles[i]!;ps.push(...p);ns.push(...normal(angle[0],angle[1]));attrs.push(slot(role),(a+Math.PI)/(Math.PI*2),(b+Math.PI/2)/Math.PI,0); }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // Marks are clipped onto the actual coarse shell triangles. Analytic curved
  // decals can cut through these concave facets even with fine tessellation.
  type A2 = readonly [number, number];
  const clip = (polygon: readonly A2[], triangle: readonly A2[]): A2[] => {
    let result = [...polygon];
    for (let edge = 0; edge < 3; edge++) {
      const a = triangle[edge]!, b = triangle[(edge + 1) % 3]!;
      const side = (p: A2): number => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const input = result; result = [];
      for (let i = 0; i < input.length; i++) {
        const p = input[i]!, q = input[(i + 1) % input.length]!, dp = side(p), dq = side(q);
        if (dp >= -1e-10) result.push(p);
        if ((dp >= -1e-10) !== (dq >= -1e-10)) { const t = dp / (dp - dq); result.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
      }
      if (result.length < 3) return [];
    }
    return result;
  };
  const patch = (points: readonly A2[], role: keyof typeof ROBOT_ROLES): void => {
    const stepA = Math.PI * 2 / columns, stepB = Math.PI / rows;
    const firstColumn = Math.floor((Math.min(...points.map(p => p[0])) + Math.PI) / stepA), lastColumn = Math.ceil((Math.max(...points.map(p => p[0])) + Math.PI) / stepA);
    const firstRow = Math.max(0, Math.floor((Math.min(...points.map(p => p[1])) + Math.PI / 2) / stepB)), lastRow = Math.min(rows, Math.ceil((Math.max(...points.map(p => p[1])) + Math.PI / 2) / stepB));
    const depth = role === "glow" ? .009 : role === "trim" ? .0065 : role === "metal" ? .005 : role === "dark" ? .0015 : .003;
    for (let row = firstRow; row < lastRow; row++) for (let column = firstColumn; column < lastColumn; column++) {
      const a0 = column * stepA - Math.PI, a1 = a0 + stepA, b0 = row * stepB - Math.PI / 2, b1 = b0 + stepB;
      const angles: A2[] = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]], cell = (row * columns + ((column % columns) + columns) % columns) * 4;
      for (const corners of [[0, 1, 2], [0, 2, 3]] as const) {
        const polygon = clip(points, corners.map(i => angles[i]!));
        if (polygon.length < 3) continue;
        const positions = corners.map(i => ps.slice((cell + i) * 3, (cell + i + 1) * 3));
        const u = positions[1]!.map((n, axis) => n - positions[0]![axis]!), v = positions[2]!.map((n, axis) => n - positions[0]![axis]!);
        const cross: V3 = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!], length = Math.hypot(...cross);
        if (length < 1e-10) continue;
        const n = cross.map(value => value / length), base = ps.length / 3;
        for (const [a, b] of polygon) {
          const x = (a - a0) / stepA, y = (b - b0) / stepB, weights = corners[1] === 1 ? [1 - x, x - y, y] : [1 - y, x, y - x];
          const p = [0, 1, 2].map(axis => positions.reduce((total, point, index) => total + point[axis]! * weights[index]!, 0) + n[axis]! * depth);
          ps.push(...p); ns.push(...n); attrs.push(slot(role), (a + Math.PI) / (Math.PI * 2), (b + Math.PI / 2) / Math.PI, 0);
        }
        for (let i = 1; i < polygon.length - 1; i++) {
          const a = polygon[0]!, b = polygon[i]!, c = polygon[i + 1]!;
          if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 1e-12) indices.push(base, base + i, base + i + 1);
        }
      }
    }
  };
  const strip = (a: number, b: number, w: number, h: number, role: keyof typeof ROBOT_ROLES): void => patch([[a-w,b-h],[a+w,b-h],[a+w,b+h],[a-w,b+h]], role);
  const disk = (a: number, b: number, r: number, role: keyof typeof ROBOT_ROLES): void => patch(Array.from({length:12},(_,i)=>[a+Math.cos(i*Math.PI/6)*r,b+Math.sin(i*Math.PI/6)*r] as const),role);
  const faceX = g.face.offset;
  if (g.face.base === "concentric-lens") {
    disk(faceX,0,g.face.lensRadius*1.1,"metal");disk(faceX,0,g.face.lensRadius*.70,"glow");
  } else if (g.face.base === "paired-eyes") for (const side of [-1,1]) strip(faceX+side*g.face.width*.52,0,.052,.050,"glow");
  else if (g.face.base === "split-crest") for (const side of [-1,1]) strip(faceX+side*.092,.02,.029,.11,"glow");
  else strip(faceX,g.face.base==="brow-slit"?-.035:.025,g.face.width*.80,g.face.height*.65,"glow");
  // Family hinges are parts of the folded silhouette, rather than a shared
  // equatorial trim. Their positions correspond to the unfolded panel bones.
  if(g.shell.grammar==="petals")for(const side of [-1,1]){disk(side*.54,.27,g.hull.rivetRadius,"metal");strip(side*.62,-.30,.055,.17,"secondary");}
  else if(g.shell.grammar==="iris")for(let i=0;i<g.shell.panels;i++){const a=i*Math.PI*2/g.shell.panels+g.shell.phase;strip(a,.46,.027,.10,"metal");}
  else if(g.shell.grammar==="clamshell")for(const side of [-1,1]){strip(side*.90,-.28,.10,.21,"metal");strip(side*.90,.01,.11,.055,"dark");}
  else for(let i=0;i<g.shell.panels;i++){const a=i*Math.PI*2/g.shell.panels-g.shell.phase;strip(a,.43,.027,.23,"metal");}
  // Actual named retracted gear is a curved hatch/cleat/sensor/tool recess on
  // the shell. Pinning gear changes this site alone and never its radius.
  const ga=.83,gb=-.27,gw=g.gear.width;
  if(g.gear.base==="sealed-courier-pocket"){
    patch([[ga-gw,gb-.17],[ga+gw*.8,gb-.17],[ga+gw,gb-.11],[ga+gw,gb+.13],[ga-gw,gb+.13]],"secondary");strip(ga,gb+.09,gw*.72,.025,"metal");
  }else if(g.gear.base==="retracted-tool-dock"){
    strip(ga,gb,gw*.55,.23,"dark");strip(ga,gb,gw*.24,.17,"metal");for(const b of[-.12,0,.12])strip(ga,gb+b,gw*.51,.023,"secondary");
  }else if(g.gear.base==="folded-sensor-cradle"){
    for(const side of[-1,1])strip(-ga+side*gw*.55,.26,.035,.22,"metal");strip(-ga,.46,gw*.70,.035,"secondary");disk(-ga,.19,gw*.28,"trim");
  }else if(g.gear.base==="retracted-load-cleat"){
    strip(ga,gb,gw*.9,.18,"dark");for(const side of[-1,1])strip(ga+side*gw*.70,gb,.055,.15,"metal");strip(ga,gb+.12,gw*.8,.035,"metal");
  }else throw new RangeError("Robot rolled gear has no geometry");
  const hullIndex = ["stepped-service-hull","round-shoulder-hull","lenticular-core","vented-lens-core","low-load-hull","armored-saddle-hull","long-rib-core","split-crown-core"].indexOf(g.hull.base);
  for (let i=0;i<2+(hullIndex%3);i++) strip(-.65+i*.09,-.42-(hullIndex%2)*.10,.024,.10+g.hull.bevel*.3,"secondary");
  const positions = Float32Array.from(ps), shell = { positions, normals: Float32Array.from(ns), attrs: Float32Array.from(attrs), indices: Uint32Array.from(indices), bodies: bodySpace(positions, meshBounds(positions)) };
  // Adjacent panel cells have distinct inset radii. A closed, recessed core
  // fills their seam gaps. It needs no expensive decorative tessellation: all
  // visible identity, silhouette and true surface normals belong to the shell.
  const core = lookMesh({ boxes: [], capsules: [{ a: [0, 0, 0], b: [0, 0, 0], r: .74, mat: slot("dark") }] }, { around: 12, rings: 4, bounds: meshBounds(positions) });
  // The indexed capsule writer's sphere ordering is inward. This unit-shell
  // primitive explicitly provides outward winding alongside outward normals.
  const coreIndices = core.indices.slice();
  for (let i = 0; i < coreIndices.length; i += 3) [coreIndices[i + 1], coreIndices[i + 2]] = [coreIndices[i + 2]!, coreIndices[i + 1]!];
  return mergeMeshes([{ ...core, indices: coreIndices }, shell]);
}
export function robotPaint(genome: RobotGenome): LayerPaint {
  const roles = Object.fromEntries(Object.entries(genome.material.tones).map(([role, t]) => [role, { hue: [t[0], t[0]], chroma: [t[1], t[1]], light: [t[2], t[2]], span: [.20, .20], finish: role === "metal" || role === "trim" ? "metal" : role === "glow" ? "glow" : "matte", pattern: "none" }])) as Parameters<typeof defineProfile>[0]["roles"];
  return paintRoles(worldLook(ROBOT_ROLES, genome.seed, { profile: defineProfile({ id: "rollable-robot", title: "Rollable Robot", harmony: "analogous", roles }) }));
}
export function createRobotDesign(value: RobotGenome, families: readonly RobotFamilyBlueprint[] = ROBOT_FAMILIES): RobotDesign {
  const genome = validateRobotGenome(value, families), rig = robotRig(genome), identity = robotIdentityKey(genome), skin = (skeleton: Skeleton) => robotSkin(genome, skeleton);
  return Object.freeze({ genome, rig, identity, skin, mesh(form: RobotForm): LookMesh {
    if (!["rolled", "portrait", "unfolded"].includes(form)) throw new RangeError("Robot view form");
    if (form === "rolled") return robotRolledMesh(genome);
    const pose: Pose = form === "portrait" ? { rot: { head: [0, -.14, 0] }, root: { yaw: .12 } } : {};
    return lookMesh(worldFromSkin(skin(poseSkeleton(rig, pose))), { around: 10, rings: 2 });
  } });
}

/** Pure authored fold preview only. It cannot authorize unfolding a live ball.
 * Every amount poses the same resolved bone tree; no render-time RNG or tick
 * accumulator is used. Endpoints are rolled and full explicit robot geometry. */
export function robotPrototypeFoldMesh(genome: RobotGenome, amount: number): LookMesh {
  if (!Number.isFinite(amount) || amount < 0 || amount > 1) throw new RangeError("Robot prototype fold amount");
  if (amount === 0) return robotRolledMesh(genome);
  const rig = robotRig(genome), skeleton = poseSkeleton(rig), full = robotSkin(genome, skeleton);
  const move = (p: readonly number[]): V3 => { const len = Math.hypot(...p) || 1, q = Math.min(.82, len); return p.map(n => n / len * q * (1 - amount) + n * amount) as V3; };
  return lookMesh({ capsules: full.capsules.map(c => ({ a: move(c.a), b: move(c.b), r: c.r * (.4 + amount * .6), mat: slot(c.role as keyof typeof ROBOT_ROLES) })), boxes: full.boxes.map(b => ({ c: move(b.c), h: b.h.map(n => n * (.25 + amount * .75)), yaw: b.yaw, mat: slot(b.role as keyof typeof ROBOT_ROLES) })) }, { around: 10, rings: 2 });
}
