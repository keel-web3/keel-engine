// A source skeleton (glTF skin joints) -> the engine's body contracts, by
// name first and the hierarchy second. Names come in every dialect -- Mixamo
// ("mixamorig:LeftUpLeg"), Unity/VRM humanoid ("LeftUpperLeg"), Blender
// ("thigh.L", "upper_arm.R", "DEF-forearm.L"), Unreal ("thigh_l", "calf_r",
// "clavicle_l"), Biped ("Bip01 L Thigh") -- so a name is cut into words, its
// side read off ("left", "l", ".L", "_l", " L "), and its words matched to a
// bone. Four legs read front/fore vs back/hind/rear. Chains fill gaps: a leg
// whose middle joint has an odd name still has a thigh above and a foot below.
//
//   const map = mapSkeleton(names, parents);
//   map.plan; map.bones["upperArm.L"];   // the source joint (index) for each contract bone

import type { Plan } from "@keel-engine/entity";

export interface SkeletonMap {
  /** The body the names read as, or null (not enough of either). */
  readonly plan: Plan | null;
  /** Contract bone -> source joint index. */
  readonly bones: Readonly<Record<string, number>>;
  /** Source joint index -> contract bone. */
  readonly of: ReadonlyMap<number, string>;
  /** 0..1: the share of the contract's main bones found. */
  readonly confidence: number;
  readonly why: readonly string[];
}

/** A name as lower-case words, with a side if it has one. */
export function readName(raw: string): { words: string[]; side: "L" | "R" | null; end: "F" | "H" | null } {
  // (Prefixes only with a separator after them: "RightArm" starts with "rig" but isn't rigged twice.)
  let s = raw.replace(/^.*[:|]/, "").replace(/^(mixamorig\d*|def|org|mch|bip0?1|armature|skeleton|rig)[-_ .]+/i, "");
  // (camelCase and digits into words.)
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2");
  const words = s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let side: "L" | "R" | null = null;
  const out: string[] = [];
  for (const w of words) {
    if (w === "l" || w === "left" || w === "lft") side = "L";
    else if (w === "r" || w === "right" || w === "rgt") side = "R";
    else if (/^left/.test(w)) { side = "L"; out.push(w.slice(4)); }
    else if (/^right/.test(w)) { side = "R"; out.push(w.slice(5)); }
    else out.push(w);
  }
  let end: "F" | "H" | null = null;
  const legWord = out.some((x) => /leg|paw|foot|thigh|shin|hoof/.test(x));
  const rest = out.filter((w) => {
    // ("fore" is a front leg's -- unless it's a forearm.)
    if (w === "front" || (w === "fore" && legWord) || w === "f") { end = "F"; return false; }
    if (w === "back" && legWord) { end = "H"; return false; }
    if (w === "hind" || w === "rear" || w === "h") { end = "H"; return false; }
    return true;
  });
  // (fl / fr / hl / hr / bl / br as one word: a quadruped's leg.)
  for (const w of rest) {
    const m = /^(f|h|b)(l|r)$/.exec(w);
    if (m) { end = m[1] === "f" ? "F" : "H"; side = m[2] === "l" ? "L" : "R"; }
  }
  return { words: rest.filter((w) => !/^(f|h|b)(l|r)$/.test(w)), side, end };
}

type Kind = "hips" | "spine" | "chest" | "neck" | "head" | "shoulder" | "upperArm" | "forearm" | "hand" | "thigh" | "shin" | "foot" | "toe" | "tail" | "leg" | "finger" | "other";

function kindOf(words: readonly string[]): Kind {
  const has = (...ws: string[]): boolean => ws.some((w) => words.includes(w));
  const j = words.join(" ");
  if (has("thumb", "index", "middle", "ring", "pinky", "little", "finger", "fingers", "digit")) return "finger";
  if (has("toe", "toes", "toebase", "ball")) return "toe";
  if (has("tail")) return "tail";
  if (has("head") && !has("end", "top")) return "head";
  if (has("neck")) return "neck";
  if (has("clavicle", "shoulder", "collar", "scapula")) return "shoulder";
  if (/fore ?arm|lower ?arm|elbow/.test(j)) return "forearm";
  if (/up(per)? ?arm|arm up/.test(j) || (has("arm") && !has("fore", "lower"))) return "upperArm";
  if (has("hand", "wrist", "palm")) return "hand";
  if (/up(per)? ?leg|thigh|leg up/.test(j) || (has("hip") && words.length > 1)) return "thigh";
  if (/low(er)? ?leg|shin|calf|knee|leg low/.test(j)) return "shin";
  if (has("foot", "ankle", "paw", "hoof")) return "foot";
  if (has("leg")) return "leg";
  if (has("hips", "pelvis", "hip", "root")) return "hips";
  if (has("chest", "thorax", "ribcage", "upperchest")) return "chest";
  if (has("spine", "spine1", "torso", "abdomen", "back", "body")) return "spine";
  return "other";
}

/** Map joint names (and their parents: -1 for a root) to a body contract's bones. */
export function mapSkeleton(names: readonly string[], parents: readonly number[]): SkeletonMap {
  const why: string[] = [];
  const info = names.map((n) => ({ ...readName(n), kind: kindOf(readName(n).words) }));
  const depth = (i: number): number => { let d = 0; for (let p = parents[i]!; p >= 0 && d < 64; p = parents[p]!) d += 1; return d; };
  const bones: Record<string, number> = {};
  const set = (bone: string, i: number): void => { if (bones[bone] === undefined) bones[bone] = i; };
  // Legs: four when names say front/hind (or two sided pairs of leg chains sit apart front to back).
  const legish = info.map((x, i) => ({ ...x, i })).filter((x) => ["thigh", "shin", "foot", "leg", "upperArm", "forearm", "hand"].includes(x.kind) && x.side);
  const quadNames = legish.some((x) => x.end === "F") && legish.some((x) => x.end === "H");
  let plan: Plan | null = null;
  if (quadNames) {
    plan = "quadruped";
    why.push("legs named front and hind: four legs");
    for (const end of ["F", "H"] as const) for (const side of ["L", "R"] as const) {
      const chain = legish.filter((x) => x.end === end && x.side === side).sort((a, b) => depth(a.i) - depth(b.i));
      const k = `${end}${side}`;
      if (chain[0]) set(`upper.${k}`, chain[0].i);
      if (chain[1]) set(`lower.${k}`, chain[1].i);
      const paw = chain.find((x) => x.kind === "foot" || x.kind === "hand") ?? chain[2];
      if (paw && paw !== chain[0] && paw !== chain[1]) set(`paw.${k}`, paw.i);
    }
  } else {
    for (const side of ["L", "R"] as const) {
      for (const kind of ["shoulder", "upperArm", "forearm", "hand", "thigh", "shin", "foot"] as const) {
        const c = info.map((x, i) => ({ ...x, i })).filter((x) => x.kind === kind && x.side === side).sort((a, b) => depth(a.i) - depth(b.i));
        if (c[0]) set(`${kind}.${side}`, c[0].i);
      }
      // (A bare "leg" joint between a thigh and a foot is the shin; before any thigh it is the thigh.)
      for (const x of info.map((y, i) => ({ ...y, i })).filter((y) => y.kind === "leg" && y.side === side).sort((a, b) => depth(a.i) - depth(b.i))) {
        if (bones[`thigh.${side}`] === undefined) set(`thigh.${side}`, x.i); else set(`shin.${side}`, x.i);
      }
    }
    const arms = ["upperArm.L", "upperArm.R"].filter((b) => bones[b] !== undefined).length;
    const legs = ["thigh.L", "thigh.R"].filter((b) => bones[b] !== undefined).length;
    if (legs === 2) { plan = "humanoid"; why.push(`two legs${arms ? ` and ${arms} arm${arms > 1 ? "s" : ""}` : ""} by name: a humanoid`); }
  }
  // The spine: hips, spine, chest, neck, head, by name; the spine and chest from a run of spine joints (the lowest is the spine, the highest the chest).
  const of = (kind: Kind): number[] => info.map((x, i) => ({ ...x, i })).filter((x) => x.kind === kind && !x.side).sort((a, b) => depth(a.i) - depth(b.i)).map((x) => x.i);
  const hipsKey = plan === "quadruped" ? "pelvis" : "hips";
  const hips = of("hips");
  if (hips[0] !== undefined) set(hipsKey, hips[0]);
  const spines = of("spine"), chests = of("chest");
  if (spines[0] !== undefined) set("spine", spines[0]);
  if (chests[0] !== undefined) set("chest", chests[0]);
  else if (spines.length > 1) set("chest", spines[spines.length - 1]!);
  const necks = of("neck"), heads = of("head");
  if (necks[0] !== undefined) set("neck", necks[0]);
  if (heads[0] !== undefined) set("head", heads[0]);
  const tails = of("tail");
  tails.forEach((t, i) => { if (i < (plan === "quadruped" ? 3 : 2)) set(`tail${i}`, t); });
  // (No hips by name: the parent both thighs share.)
  if (plan === "humanoid" && bones["hips"] === undefined && bones["thigh.L"] !== undefined) { const p = parents[bones["thigh.L"]!]!; if (p >= 0) { set("hips", p); why.push(`hips: ${names[p]}, the thighs' parent`); } }
  const of2 = new Map<number, string>();
  for (const [b, i] of Object.entries(bones)) of2.set(i, b);
  const main = plan === "quadruped" ? ["pelvis", "chest", "neck", "head", "upper.FL", "upper.FR", "upper.HL", "upper.HR", "lower.FL", "lower.FR", "lower.HL", "lower.HR"] : ["hips", "chest", "neck", "head", "thigh.L", "thigh.R", "shin.L", "shin.R", "upperArm.L", "upperArm.R", "forearm.L", "forearm.R"];
  const confidence = plan ? main.filter((b) => bones[b] !== undefined).length / main.length : 0;
  if (plan) why.push(`${Object.keys(bones).length} contract bones named (${Math.round(confidence * 100)}% of the main ones)`);
  else why.push("the joint names don't read as two or four legs");
  return { plan, bones, of: of2, confidence, why };
}

/** Which body region a contract bone belongs to (the parts a body splits into). */
export function regionOfBone(bone: string, plan: Plan): string {
  if (bone === "head" || bone === "neck") return "head";
  if (bone.startsWith("tail")) return "tail";
  if (plan === "quadruped") {
    const m = /\.(FL|FR|HL|HR)$/.exec(bone);
    return m ? `leg.${m[1]}` : "torso";
  }
  const side = bone.endsWith(".L") ? "L" : bone.endsWith(".R") ? "R" : null;
  if (side && /^(shoulder|upperArm|forearm|hand)/.test(bone)) return `arm.${side}`;
  if (side && /^(thigh|shin|foot)/.test(bone)) return `leg.${side}`;
  return "torso";
}
