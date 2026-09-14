// @keel-engine/physics: the kinematic character body (run, jump, wall-run,
// grind, skim) and the solids it collides with (turned boxes, wedges), rails
// and water. Names as in the proof of concept's src/physics/character.js.

export { BODY_EVENTS, BODY_MODES, TUNING, createCharacter } from "./character.ts";
export type { BodyEvent, BodyEventOf, BodyEventPayloads, BodyEventType, BodyInput, BodyMode, Character, CharacterSpec, Tuning } from "./character.ts";

export { boxDistance, isWedge, nearestOnRail, slopeOf, solidDistance, wedgeDistance, wedgeSection } from "./solids.ts";
export type { Box, Hit, Rail, RailPoint, Solid, Wedge } from "./solids.ts";
