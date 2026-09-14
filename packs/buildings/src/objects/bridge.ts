// A bridge: a span generator. It runs along z from its first end (endA, at
// +z, on the ground at y = 0) to its second (endB, at -z, `rise` higher or
// lower), `length` apart and `width` wide -- so the terrain's bridge spans
// place it end to end (bridgeFor in ../paths.ts turns two points into its
// pins and placement). Four kinds:
//
//   beam    planks on two stringers, piers under it, posts and handrails
//   arch    a stone arch: a humped paved deck, stepped spandrels down to the
//           water, parapets
//   rope    planks hung on ropes, sagging, tall posts at both ends
//   plank   logs and planks, no rails: a footbridge over a stream
//
// The deck collides as a few wedges following its line (walkable where its
// slope is), the piers and parapets as boxes; the handrails are grind rails.
// It needs no support (rest "hang"): it's placed by its ends, not settled.
import { collidersOfDesign, defineStyledObject, solid } from "@keel-engine/object";
import type { ColliderSpec, DesignSolid } from "@keel-engine/object";
import type { Vec3 } from "@keel-engine/core";
import { num, post, rail, roles, str } from "../kit.ts";

const THICK = 0.22;

export default defineStyledObject({
  id: "bridge",
  title: "Bridge",
  tags: ["bridge", "span", "crossing"],
  tier: "main",
  instancing: "few",
  variants: 4,
  choices: { length: { range: [3, 30] }, width: { range: [1.4, 5] }, rise: { range: [-3, 3] }, kind: ["beam", "arch", "rope", "plank"], supports: [0, 1, 2, 3], depth: { range: [1.5, 5] } },
  look: { roles: roles("plank", "wood", "stone", "rope", "metal", "trim"), profiles: ["village", "stone", "nordic", "desert", "scifi"] },
  sway: null,
  design(J, v) {
    const L = num(v["length"]), W = num(v["width"]), rise = num(v["rise"]), kind = str(v["kind"]), depth = num(v["depth"]);
    const solids: DesignSolid[] = [];
    const colliders: ColliderSpec[] = [];
    const hump = kind === "arch" ? Math.min(L * 0.1, 1.8) : kind === "rope" ? -Math.min(L * 0.05, 1.2) : 0;
    // The deck's walking line: z from +L/2 (endA, y 0) to -L/2 (endB, y rise), plus a hump (or a sag).
    const yAt = (z: number): number => { const t = (L / 2 - z) / L; return rise * t + hump * 4 * t * (1 - t); };
    // Colliders: K wedges along the line (a box where a piece is level).
    const K = hump ? 8 : 1;
    for (let k = 0; k < K; k += 1) {
      const z0 = L / 2 - (L * k) / K, z1 = L / 2 - (L * (k + 1)) / K;
      const y0 = yAt(z0), y1 = yAt(z1);
      const lo = Math.min(y0, y1) - THICK, hi = Math.max(y0, y1);
      const c: Vec3 = [0, (lo + hi) / 2, (z0 + z1) / 2];
      const h: Vec3 = [W / 2, (hi - lo) / 2, (z0 - z1) / 2];
      if (Math.abs(y1 - y0) < 0.02) colliders.push({ c, h, yaw: 0, mat: "plank", part: "deck" });
      // (A wedge rises toward its local -z: up toward -z as is, up toward +z turned round.)
      else colliders.push({ c, h, yaw: y1 > y0 ? 0 : Math.PI, mat: "plank", part: "deck", kind: "wedge", lo: THICK / (hi - lo) });
    }
    // Planks across (the deck's look: stepped along its line).
    const deckRole = kind === "arch" ? "stone" : "plank";
    const n = Math.max(4, Math.min(40, Math.round(L / (kind === "arch" ? 0.75 : 0.42))));
    for (let i = 0; i < n; i += 1) {
      const z = L / 2 - (L * (i + 0.5)) / n;
      const pd = (L / n) * (kind === "arch" ? 0.98 : 0.84);
      solids.push(solid.box(deckRole, [0, yAt(z) - 0.06, z], [W / 2 * (kind === "rope" ? 0.9 : 1), 0.06, pd / 2], 0, { name: "deck", collide: false }));
    }
    const rails: Vec3[][] = [];
    const handY = kind === "rope" ? 1.0 : 0.95;
    if (kind === "beam" || kind === "plank") {
      // Stringers under the planks: capsules following the line, a piece each.
      const sx = W / 2 - 0.15;
      const seg = 6;
      for (const s of kind === "plank" ? [-sx * 0.5, sx * 0.5] : [-sx, sx]) for (let k = 0; k < seg; k += 1) {
        const z0 = L / 2 - (L * k) / seg, z1 = L / 2 - (L * (k + 1)) / seg;
        solids.push(solid.capsule(kind === "plank" ? "wood" : "wood", [s, yAt(z0) - 0.2, z0 - (k === 0 ? 0.1 : 0)], [s, yAt(z1) - 0.2, z1 + (k === seg - 1 ? 0.1 : 0)], kind === "plank" ? 0.16 : 0.1, { name: "stringer", collide: false }));
      }
      // Piers: evenly along, down to the depth.
      const piers = kind === "plank" ? 0 : num(v["supports"]);
      for (let i = 1; i <= piers; i += 1) {
        const z = L / 2 - (L * i) / (piers + 1);
        const y = yAt(z) - 0.3;
        for (const s of [-1, 1]) solids.push(post("wood", s * sx, z, -depth, y, 0.14, { name: "pier", collide: true }));
        solids.push(solid.box("wood", [0, y - 0.05, z], [W / 2, 0.08, 0.1], 0, { name: "cap", collide: false }));
      }
      if (kind === "beam") {
        // Posts every ~2 m on both sides, handrails between their tops (grind rails too).
        const m = Math.max(2, Math.round(L / 2));
        for (const s of [-1, 1]) {
          const line: Vec3[] = [];
          for (let i = 0; i <= m; i += 1) {
            const z = L / 2 - (L * i) / m;
            const y = yAt(z);
            solids.push(post("wood", s * (W / 2 - 0.05), z, y - 0.1, y + handY, 0.05, { name: "post" }));
            line.push([s * (W / 2 - 0.05), y + handY, z]);
          }
          for (let i = 0; i < m; i += 1) solids.push(rail("wood", line[i]!, line[i + 1]!, 0.045, "handrail"));
          rails.push(line);
        }
      }
    } else if (kind === "arch") {
      // Spandrels: stepped stone from the deck down to an arch that springs from the water at the ends.
      const m = 10;
      for (let i = 0; i < m; i += 1) {
        const z = L / 2 - (L * (i + 0.5)) / m;
        const t = (i + 0.5) / m;
        const yTop = yAt(z) - 0.12;
        const yUnder = -depth + (depth + Math.min(yAt(L / 2), yAt(-L / 2)) + hump * 0.55) * Math.sqrt(Math.sin(Math.PI * t));
        const bottom = Math.min(yUnder, yTop - 0.35);
        solids.push(solid.box("stone", [0, (yTop + bottom) / 2, z], [W / 2 + 0.12, (yTop - bottom) / 2, L / m / 2 + 0.01], 0, { name: "spandrel", collide: false }));
        for (const s of [-1, 1]) solids.push(solid.box("trim", [s * (W / 2 + 0.05), yAt(z) + 0.35, z], [0.17, 0.4, L / m / 2 + 0.01], 0, { name: "parapet" }));
      }
    } else {
      // Rope: tall posts at both ends, ropes along the sag at hand height and under the planks.
      for (const [z, y] of [[L / 2, 0], [-L / 2, rise]] as const) for (const s of [-1, 1]) {
        solids.push(post("wood", s * (W / 2), z, y - 0.6, y + 1.5, 0.1, { name: "post", collide: true }));
      }
      for (const s of [-1, 1]) {
        const top: Vec3[] = [], low: Vec3[] = [];
        const m = 10;
        for (let i = 0; i <= m; i += 1) {
          const z = L / 2 - (L * i) / m;
          top.push([s * (W / 2), yAt(z) + handY + (i === 0 || i === m ? 0.35 : 0), z]);
          low.push([s * (W / 2) * 0.9, yAt(z) - 0.08, z]);
        }
        for (let i = 0; i < m; i += 1) {
          solids.push(rail("rope", top[i]!, top[i + 1]!, 0.035, "rope"));
          solids.push(rail("rope", low[i]!, low[i + 1]!, 0.03, "rope"));
          if (i % 2 === 0) solids.push(rail("rope", top[i]!, low[i]!, 0.02, "hanger"));
        }
        rails.push(top);
      }
    }
    // Abutments: stone under each end, half in the bank.
    if (kind !== "rope") for (const [z, y, s] of [[L / 2, 0, 1], [-L / 2, rise, -1]] as const) {
      solids.push(solid.box("stone", [0, y - THICK - depth / 2, z - s * 0.3], [W / 2 + 0.25, depth / 2, 0.6], 0, { name: "abutment", collide: false }));
    }
    void J;
    return {
      // (The deck's wedges, and whatever else collides -- piers, posts, parapets -- from the solids.)
      voxel: { unit: Math.max(0.1, Math.min(0.3, W / 10)) },
      solids, colliders: [...colliders, ...collidersOfDesign({ solids })], rails, front: "+z", rest: "hang",
      sockets: {
        endA: { kind: "anchor", pos: [0, 0, L / 2], yaw: 0, extent: [W / 2, 0], meta: { end: "A" } },
        endB: { kind: "anchor", pos: [0, rise, -L / 2], yaw: Math.PI, extent: [W / 2, 0], meta: { end: "B" } },
        middle: { kind: "anchor", pos: [0, yAt(0), 0], yaw: 0 },
      },
      meta: { span: { length: L, width: W, rise, kind, deckAt: [0, yAt(0), 0] } },
    };
  },
});
