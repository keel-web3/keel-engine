import { defineEntity, definePack, type EntityDef, type Pins } from "@keel-engine/runtime";
import { seedFromStream } from "@keel-engine/entity";
import { ROBOT_FAMILIES, ROBOT_PALETTES, ROBOT_LIVERIES, defineRobotFamily, createRobotGenome, type RobotFamilyBlueprint, type RobotPins } from "./genome.ts";
import { ROBOT_ROLES, createRobotDesign, type RobotDesign } from "./robot.ts";

export const ROBOT_BODY_CONTRACT = Object.freeze({ ref: "body/rollable-robot@1.0.0", requiredBones: Object.freeze(["body", "head", "limb.0", "joint.0", "foot.0", "panel.0"]), sockets: Object.freeze(["face", "back", "tool"]), forms: Object.freeze(["rolled", "portrait", "unfolded"]) });
export const robotEntity = (definition: RobotFamilyBlueprint): EntityDef<RobotDesign> => {
 const family = defineRobotFamily(definition);
 return defineEntity({
  id: family.id, body: ROBOT_BODY_CONTRACT.ref, title: family.title, tags: ["original-robot", "rollable", family.morphology],
  choices: { hull: family.hulls.map(([n]) => n), face: family.faces.map(([n]) => n), palette: Object.keys(ROBOT_PALETTES), livery: ROBOT_LIVERIES, gear: family.gear.map(([n]) => n) },
  shape: ["hull", "face", "gear", "livery"], look: { roles: Object.fromEntries(Object.entries(ROBOT_ROLES).map(([name, role]) => [name, { stuff: role.stuff }])), choices: ["palette"] },
  build(S, pins: Pins) { const { seed, family: selected, ...rest } = pins as Record<string, unknown>; if (selected !== undefined && selected !== family.id) throw new RangeError("Robot entity family pin"); return createRobotDesign(createRobotGenome(typeof seed === "string" ? seed : seedFromStream(S), { ...rest as RobotPins, family: family.id }, [family]), [family]); },
  sockets(robot) { const head = robot.rig.bones.find(b => b.name === "head")!, h = robot.rig.body.centerHeight;
    return { face: { pos: [head.off[0], h + head.off[1], head.off[2] + .26], yaw: 0, size: [.4, .2, .1] }, back: { pos: [0, h, -robot.genome.hull.size[2]], yaw: 0, size: [.4, .4, .2] }, tool: { pos: [robot.genome.hull.size[0], h, 0], yaw: 0, size: [.2, .3, .2] } }; },
}); };
export const pack = definePack({ entities: ROBOT_FAMILIES.map(robotEntity), attributes: [] });
