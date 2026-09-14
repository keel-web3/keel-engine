// packs/animals: dogs, cats, foxes, bears, rabbits, mice and deer on four legs
// (body/quadruped@1.0.0), and a collar and saddlebags that only they wear.
export { pack } from "./pack.ts";
export { default as bear } from "./entities/bear.ts";
export { default as cat } from "./entities/cat.ts";
export { default as deer } from "./entities/deer.ts";
export { default as dog } from "./entities/dog.ts";
export { default as fox } from "./entities/fox.ts";
export { default as mouse } from "./entities/mouse.ts";
export { default as rabbit } from "./entities/rabbit.ts";
export { default as collar } from "./attributes/collar.ts";
export { default as saddlebag } from "./attributes/saddlebag.ts";
export { animal } from "./species.ts";
export type { AnimalOptions } from "./species.ts";
