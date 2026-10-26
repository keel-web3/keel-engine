// Ported from Three.js r180's objects/Group.js (MIT, see packages/lit/NOTICE).

import { Node } from "../core/Node.ts";

/** A node that only holds others. */
export class Group extends Node {
  readonly isGroup = true;

  constructor() {
    super();

    this.type = "Group";
  }
}
