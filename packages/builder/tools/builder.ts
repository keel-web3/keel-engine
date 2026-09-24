// The builder's test page: generated and hand-built voxel models converted to
// engine parts and drawn with the pixel renderer at 128 and 256 px; a rigged
// voxel creature walking (the engine's animator on its voxel skin); a flag
// waving, a windmill turning, a lamp flickering. Build with
// `node packages/builder/tools/build.mjs`, open
// http://localhost:4300/packages/builder/tools/builder.html -- it saves its
// sheets to out/builder-*.png.
import { animator } from "@keel-engine/entity";
import { createPixelRenderer } from "@keel-engine/render";
import type { PixelRenderer } from "@keel-engine/render";
import {
  attributeFromVoxels, autoRig, builderLook, createEditor, createSession, createVoxels, generate, greedyBoxes, livePreview, objectRig, opsOf, poseVoxels, renderSolids,
  runOps, buildSession, streamOps, voxelStats,
} from "../src/index.ts";
import type { AgentOp, Look, ObjectSolids, Oklch, Session, VoxelModel } from "../src/index.ts";

type V3 = [number, number, number];

// A look with a sky and a ground for the page (the baker keys its own background instead).
function pageLook(colours: Readonly<Record<string, Oklch>>): { look: Look; ground: number } {
  return pageLookFrom(builderLook(colours));
}
function pageLookFrom(look: Look): { look: Look; ground: number } {
  const colourList = [...look.palette.colours];
  const ramps = { ...look.palette.ramps };
  const add = (name: string, list: Array<[number, number, number]>): void => { ramps[name] = [colourList.length, list.length]; colourList.push(...list); };
  add("sky", [[22, 24, 34], [30, 33, 46], [40, 44, 60], [52, 57, 76]]);
  add("ground", [[34, 38, 44], [48, 54, 60], [64, 72, 78], [82, 92, 96], [104, 114, 116]]);
  const materials = [...look.materials];
  materials[4] = { ramp: "ground" };
  materials[5] = { ramp: "sky" };
  materials.push({ ramp: "ground", light: 1, pattern: 1 });
  return { look: { ...look, palette: { colours: colourList, ramps }, materials }, ground: materials.length - 1 };
}

interface Shot { solids: ObjectSolids; look: Look; ground: number; size: number; height: number; yaw?: number; label: string }

function draw(px: PixelRenderer, s: Shot): ImageData {
  px.setTarget(s.size, s.size);
  px.setPalette(s.look.palette.colours, s.look.palette.ramps);
  px.setMaterials(s.look.materials);
  px.setStyle({ screen: s.size <= 128 ? 4 : 8, dither: 0.9, outline: 1 });
  px.setFx([]);
  const boxes = [...s.solids.boxes, { c: [0, -0.5, 0] as V3, h: [40, 0.5, 40] as V3, yaw: 0, mat: s.ground }];
  px.setWorld({ boxes, capsules: s.solids.capsules });
  const h = Math.max(0.2, s.height);
  const yaw = s.yaw ?? 0.6;
  const target: V3 = [0, h * 0.45, 0];
  const dist = h * 2.4 + 0.3;
  const eye: V3 = [Math.sin(yaw) * dist, h * 0.45 + dist * 0.45, Math.cos(yaw) * dist];
  px.render({ eye, target, fov: 0.8, sun: [0.5, 0.85, 0.4], waterY: -50, fogNear: 60, fogFar: 200 });
  const rgba = px.read();
  const img = new ImageData(s.size, s.size);
  for (let y = 0; y < s.size; y += 1) img.data.set(rgba.subarray((s.size - 1 - y) * s.size * 4, (s.size - y) * s.size * 4), y * s.size * 4);
  return img;
}

// (What the camera frames: the taller of its height and its reach across.)
function heightOf(s: ObjectSolids): number {
  const up = Math.max(0, ...s.boxes.map((b) => b.c[1] + b.h[1]), ...s.capsules.map((c) => Math.max(c.a[1], c.b[1]) + c.r));
  const across = Math.max(0, ...s.boxes.map((b) => Math.hypot(b.c[0], b.c[2]) + Math.max(b.h[0], b.h[2])), ...s.capsules.map((c) => Math.max(Math.hypot(c.a[0], c.a[2]), Math.hypot(c.b[0], c.b[2])) + c.r));
  return Math.max(up, across * 1.1);
}

/** A sheet of cells, each a label and a picture, scaled up 2x (128) or 1x (256). */
function sheet(cells: Array<{ img: ImageData; label: string }>, cols: number, scale: number): HTMLCanvasElement {
  const cell = cells[0]!.img.width * scale;
  const pad = 6, labelH = 16;
  const c = document.createElement("canvas");
  c.width = cols * (cell + pad) + pad;
  c.height = Math.ceil(cells.length / cols) * (cell + pad + labelH) + pad;
  const g = c.getContext("2d")!;
  g.fillStyle = "#101116"; g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingEnabled = false;
  cells.forEach((k, i) => {
    const x = pad + (i % cols) * (cell + pad), y = pad + Math.floor(i / cols) * (cell + pad + labelH);
    const tmp = document.createElement("canvas");
    tmp.width = k.img.width; tmp.height = k.img.height;
    tmp.getContext("2d")!.putImageData(k.img, 0, 0);
    g.drawImage(tmp, x, y, cell, cell);
    g.fillStyle = "#cfd3e6"; g.font = "11px ui-monospace, monospace";
    g.fillText(k.label, x + 2, y + cell + 12);
  });
  return c;
}

/** A hand-built hut, as ops (what an agent would emit): walls, a roof, a door, a lamp. */
function hutByOps(): { model: VoxelModel; colours: Record<string, Oklch> } {
  const r = runOps([
    { op: "new", name: "hut", unit: 0.12 },
    { op: "symmetry", mode: "x" },
    { op: "box", from: [0, 0, -4], to: [5, 6, 4], role: "primary", hollow: true },
    { op: "box", from: [0, 7, -5], to: [6, 7, 5], role: "secondary" },
    { op: "box", from: [0, 8, -4], to: [4, 8, 4], role: "secondary" },
    { op: "box", from: [0, 9, -3], to: [2, 9, 3], role: "secondary" },
    { op: "symmetry", mode: "none" },
    { op: "box", from: [-1, 0, 4], to: [0, 3, 4], role: "dark" },
    { op: "group", name: "door", from: [-1, 0, 4], to: [0, 3, 4] },
    { op: "box", from: [3, 3, 5], to: [3, 4, 5], role: "glow" },
    { op: "look", role: "primary", colour: [0.7, 0.06, 70] },
    { op: "look", role: "secondary", colour: [0.48, 0.12, 30] },
    { op: "target", as: "object", id: "hut" },
  ]);
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("\n"));
  return { model: r.session.editor.model, colours: r.session.colours };
}

export async function builderPage(out: HTMLElement): Promise<Record<string, unknown>> {
  const canvas = document.createElement("canvas");
  const px = createPixelRenderer(canvas, { width: 128, height: 128 });
  const saves: Array<Promise<unknown>> = [];
  const save = (name: string, c: HTMLCanvasElement): void => {
    out.append(Object.assign(document.createElement("h3"), { textContent: name }), c);
    saves.push(new Promise((ok) => c.toBlob((b) => ok(fetch(`/out/${name}.png`, { method: "PUT", body: b })))));
  };
  const report: Record<string, unknown> = {};

  // 1. Built and generated things as objects (static parts), 128 px and 256 px.
  const things: Array<{ model: VoxelModel; colours: Readonly<Record<string, Oklch>>; label: string }> = [];
  for (const k of ["crate", "banner", "tree", "lamp", "windmill"] as const) { const g = generate(k, "2"); things.push({ model: g.model, colours: g.colours, label: k }); }
  const hut = hutByOps();
  things.push({ model: hut.model, colours: hut.colours, label: "hut (ops)" });
  for (const plan of ["quadruped", "humanoid"] as const) for (const seed of ["3", "8"]) { const g = generate("critter", seed, { plan }); things.push({ model: g.model, colours: g.colours, label: `critter ${seed} ${plan === "quadruped" ? "4" : "2"} legs` }); }
  const objectCells: Array<{ img: ImageData; label: string }> = [];
  const bigCells: Array<{ img: ImageData; label: string }> = [];
  const counts: Record<string, unknown> = {};
  for (const t of things) {
    const { look, ground } = pageLook(t.colours);
    const solids = renderSolids(t.model, look);
    const st = voxelStats(t.model);
    counts[t.label] = { voxels: t.model.count, boxes: solids.boxes.length, bytes: st.bytes };
    const label = `${t.label} ${t.model.count}v ${solids.boxes.length}b`;
    objectCells.push({ img: draw(px, { solids, look, ground, size: 128, height: heightOf(solids), label }), label });
    if (["windmill", "hut (ops)", "critter 3 4 legs", "critter 8 2 legs"].includes(t.label)) bigCells.push({ img: draw(px, { solids, look, ground, size: 256, height: heightOf(solids), label }), label: `${t.label} (256)` });
  }
  report["objects"] = counts;
  save("builder-objects-128", sheet(objectCells, 5, 2));
  save("builder-objects-256", sheet(bigCells, 4, 1));

  // 2. A rigged voxel creature walking, on the engine's animator; and a block person walking.
  const walkCells: Array<{ img: ImageData; label: string }> = [];
  const blockPerson = (() => {
    const m = createVoxels({ unit: 1 / 16, name: "block-person" });
    const ed = createEditor(m, { symmetry: { mode: "x" } });
    ed.box([0, 0, -2], [3, 11, 1], "secondary"); ed.box([0, 0, -2], [3, 1, 1], "dark");
    ed.box([0, 12, -2], [3, 23, 1], "primary"); ed.box([4, 12, -2], [7, 23, 1], "primary"); ed.box([4, 12, -2], [7, 14, 1], "skin");
    ed.box([0, 24, -4], [3, 31, 3], "skin"); ed.box([0, 30, -4], [3, 31, 3], "dark"); ed.set([2, 27, 3], "dark");
    return m;
  })();
  const dog = (() => {
    const m = createVoxels({ unit: 0.05, name: "dog" });
    const ed = createEditor(m, { symmetry: { mode: "x" } });
    ed.box([1, 0, 4], [2, 5, 5], "primary"); ed.box([1, 0, -6], [2, 5, -5], "primary"); ed.box([0, 6, -6], [2, 10, 5], "primary");
    ed.box([0, 6, -5], [1, 6, 4], "secondary"); ed.box([0, 10, 5], [1, 13, 7], "primary"); ed.box([0, 13, 6], [2, 16, 10], "skin");
    ed.box([0, 13, 11], [1, 14, 12], "skin"); ed.set([0, 14, 12], "dark"); ed.set([2, 15, 10], "dark"); ed.box([2, 17, 7], [2, 18, 7], "trim"); ed.line([0, 10, -7], [0, 14, -10], "secondary");
    return m;
  })();
  const creatures: Array<{ model: VoxelModel; colours: Readonly<Record<string, Oklch>>; label: string; speed: number; limbs: "capsule" | "rigid" | "auto" }> = [
    { ...(() => { const g = generate("critter", "3", { plan: "quadruped" }); return { model: g.model, colours: g.colours }; })(), label: "critter walk", speed: 1.2, limbs: "auto" },
    { model: dog, colours: { primary: [0.62, 0.1, 60], secondary: [0.85, 0.03, 80], skin: [0.7, 0.09, 55], trim: [0.4, 0.06, 40] }, label: "dog trot (capsule limbs)", speed: 2.2, limbs: "capsule" },
    { ...(() => { const g = generate("critter", "8", { plan: "humanoid" }); return { model: g.model, colours: g.colours }; })(), label: "biped walk", speed: 1, limbs: "auto" },
    { model: blockPerson, colours: { primary: [0.55, 0.12, 200], secondary: [0.4, 0.1, 265], skin: [0.72, 0.08, 55] }, label: "block person walk (rigid)", speed: 1.4, limbs: "rigid" },
  ];
  const rigReport: Record<string, unknown> = {};
  for (const c of creatures) {
    const rig = autoRig(c.model, { limbs: c.limbs });
    rigReport[c.label] = { plan: rig.plan, why: rig.analysis.why, missing: rig.missing, boxes: rig.skin.boxes.length, capsules: rig.skin.capsules.length };
    const { look, ground } = pageLook(c.colours);
    const anim = animator(rig.spec);
    const frames: ObjectSolids[] = [];
    // (Stand, then walk along +z; the camera follows the body: poses at the origin.)
    for (let f = 0; f < 150; f += 1) {
      const z = f < 30 ? 0 : (f - 30) / 60 * c.speed;
      anim.step(1 / 60, { pos: [0, 0, z], vel: [0, 0, f < 30 ? 0 : c.speed], facing: 0, mode: "ground" });
      if (f >= 90 && f % 8 === 2 && frames.length < 4) frames.push(poseVoxels(rig, anim.skeleton({ pos: [0, 0, 0], yaw: 0 }), look));
    }
    const h = Math.max(...frames.map(heightOf));
    frames.forEach((s, i) => walkCells.push({ img: draw(px, { solids: s, look, ground, size: 256, height: h, yaw: 1.2, label: "" }), label: `${c.label} ${i}` }));
  }
  report["rigs"] = rigReport;
  save("builder-walk-256", sheet(walkCells, 4, 1));

  // 3. Things that move by themselves: a flag waving, a windmill turning, a lamp flickering.
  const moveCells: Array<{ img: ImageData; label: string }> = [];
  for (const [kind, frames] of [["banner", [0, 2, 4, 6]], ["windmill", [0, 1, 2, 3]], ["lamp", [0, 3, 5, 7]]] as const) {
    const g = generate(kind, "5");
    const { look, ground } = pageLook(g.colours);
    const rig = objectRig(g.model, g.animation!);
    const all = frames.map((f) => rig.pose("idle", f, look));
    const h = Math.max(...all.map(heightOf));
    all.forEach((s, i) => moveCells.push({ img: draw(px, { solids: s, look, ground, size: 128, height: h, yaw: kind === "banner" ? 0.9 : 0.4, label: "" }), label: `${kind} f${frames[i]}` }));
  }
  save("builder-motion-128", sheet(moveCells, 4, 2));

  // 5. Watching it draw: op lists replayed a few ops a frame through the live preview -- a voxel critter box by box,
  // then a character: its species, pins, proportions, parts and a hat, each op a change event.
  const liveCanvas = document.createElement("canvas");
  liveCanvas.width = 256; liveCanvas.height = 256;
  liveCanvas.style.width = "512px";
  const liveLabel = document.createElement("div");
  out.prepend(Object.assign(document.createElement("h3"), { textContent: "live: an op list drawing" }), liveCanvas, liveLabel);
  const lg = liveCanvas.getContext("2d")!;
  const replay = async (name: string, session: Session, ops: readonly AgentOp[], { perFrame, frames, yaw }: { perFrame: number; frames: number; yaw: number }): Promise<void> => {
    const live = livePreview(session);
    const strip: Array<{ img: ImageData; label: string }> = [];
    const snapAt = new Set(Array.from({ length: frames }, (_, i) => Math.round(((i + 1) / frames) * ops.length) - 1));
    let height = 0.3;
    let i = 0;
    const meshed: number[] = [];
    for (const r of streamOps(ops, session)) {
      if (!r.ok) throw new Error(r.error.message);
      live.apply(r.event);
      meshed.push(live.stats.lastMeshed);
      const draw1 = (i % perFrame === perFrame - 1) || snapAt.has(i) || i === ops.length - 1;
      if (draw1) {
        const { solids, look } = live.solids();
        const { look: withGround, ground } = pageLookFrom(look);
        height = Math.max(height, heightOf(solids));
        const img = draw(px, { solids, look: withGround, ground, size: 256, height, yaw, label: "" });
        lg.putImageData(img, 0, 0);
        liveLabel.textContent = `${name}: op ${i + 1}/${ops.length} ${r.event.op} -- ${r.event.did}`;
        if (snapAt.has(i)) strip.push({ img, label: `${i + 1}/${ops.length} ${r.event.op}` });
        // (A frame's pause, so a person watching sees it draw; setTimeout, not rAF: a hidden pane stops rAF.)
        await new Promise((ok) => setTimeout(ok, 16));
      }
      i += 1;
    }
    report[`live ${name}`] = { ops: ops.length, events: meshed.length, chunksMeshedPerOp: +(meshed.reduce((a, b) => a + b, 0) / meshed.length).toFixed(2) };
    save(`builder-live-${name}`, sheet(strip, 4, 1));
  };
  const critter = generate("critter", "3", { plan: "quadruped" });
  await replay("voxels", createSession(), [...opsOf(critter.model), ...Object.entries(critter.colours).map(([role, colour]): AgentOp => ({ op: "look", role, colour: [...colour] }))], { perFrame: 2, frames: 8, yaw: 0.7 });
  const hat = attributeFromVoxels((() => { const m = createVoxels({ unit: 0.02 }); const e = createEditor(m, { symmetry: { mode: "xz" } }); e.box([0, 0, 0], [5, 0, 5], "dark"); e.box([0, 1, 0], [3, 8, 3], "dark"); e.box([0, 2, 0], [3, 2, 3], "accent"); return m; })(), { id: "top-hat", slot: "head", fill: 0.8 });
  await replay("character", createSession(undefined, { attributes: [hat] }), [
    { op: "character", kind: "anthro", species: "fox", seed: "7" },
    { op: "pin", choice: "top", value: "hoodie" },
    { op: "pin", choice: "pack", value: "none" },
    { op: "pin", choice: "tail", value: 1.2 },
    { op: "proportion", name: "headR", scale: 1.15 },
    { op: "proportion", name: "upperArm", scale: 1.2 },
    { op: "part", id: "horn.L", shape: "capsule", on: "head", a: [-0.22, -0.1, 0.05], b: [-0.4, 0.7, -0.1], r: 0.09, role: "dark" },
    { op: "part", id: "horn.R", shape: "capsule", on: "head", a: [0.22, -0.1, 0.05], b: [0.4, 0.7, -0.1], r: 0.09, role: "dark" },
    { op: "part", id: "fin", shape: "wedge", on: "back", c: [0, 0.15, -0.45], h: [0.08, 0.45, 0.5], lo: 0.05, role: "accent" },
    { op: "part", id: "badge", shape: "box", on: "chest", c: [0.25, 0.1, 0.15], h: [0.12, 0.12, 0.08], role: "trim" },
    { op: "wear", attribute: "top-hat" },
    { op: "proportion", name: "headR", scale: 1.3 },
  ], { perFrame: 1, frames: 8, yaw: 1.25 });

  // 4. The op list end to end: an agent's ops -> an entity -> its pack file.
  const built = buildSession(runOps([{ op: "generate", kind: "critter", seed: "3", plan: "quadruped" }, { op: "rig", as: "quadruped" }, { op: "target", as: "entity", id: "blocky-beast" }]).session);
  report["code"] = built.code.split("\n").slice(0, 14).join("\n");
  report["boxCounts"] = Object.fromEntries(things.map((t) => [t.label, { voxels: t.model.count, greedy: greedyBoxes(t.model).length }]));
  await Promise.all(saves);
  return report;
}

(globalThis as { builderPage?: typeof builderPage }).builderPage = builderPage;
