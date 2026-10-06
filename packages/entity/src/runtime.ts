// Live entity runtime: explicit generators/rendering, without optional authoring registries.
// The broad package entry retains the complete API.
export { apply, poseSkeleton } from "./rig.ts";
export { entityOf } from "./species.ts";
export { skinOf } from "./skin.ts";
export { HUMANOID_CLIPS, posed } from "./clips.ts";
export { IDLE_PERIOD, idleActFor, posedIdle } from "./idles.ts";
export type * from "./index.ts";
