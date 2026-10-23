import type { ArenaSceneEnvironment, ArenaSceneStructure } from "@keel-engine/pinball-arena";
import type { PinballFrameTheme } from "./framing.ts";

type Construction = NonNullable<ArenaSceneEnvironment["construction"]>;
type Part = ArenaSceneStructure["hubs"][number];
/** Native horizontal radius includes every normalized foot and brace, rather
 * than only the raised asset sitting on it. The compiler reserves this same
 * complete envelope before serializing a scenery socket. */
export function pinballConstructionMountRadius(environment: ArenaSceneEnvironment | undefined, assetId: string): number {
  const mount = environment?.construction?.mounts.find(m => m.assetId === assetId); if (!mount) return 0;
  let x = 0, z = 0;
  for (const p of mount.parts) {
    x = Math.max(x, Math.max(Math.abs(p.a[0]), Math.abs(p.b[0])) + p.size[0]);
    z = Math.max(z, Math.max(Math.abs(p.a[2]), Math.abs(p.b[2])) + (p.kind === "box" ? p.size[2] : p.size[0]));
  }
  return Math.hypot(x, z) * mount.width;
}
const box = (role: string, a: Part["a"], size: Part["size"], motion: Part["motion"] = "static"): Part => ({ role, kind: "box", a, b: a, size, motion });
const tube = (role: string, a: Part["a"], b: Part["b"], radius: number, motion: Part["motion"] = "static"): Part => ({ role, kind: "capsule", a, b, size: [radius, radius, radius], motion });
const boundary = (parts: readonly Part[], width: number, rise: number, spacing: number): NonNullable<Construction["boundary"]> => ({ offset: 0, width, rise, drop: 360, spacing, parts });
const mount = (assetId: string, semantic: string, width: number, parts: readonly Part[]): Construction["mounts"][number] => ({ assetId, semantic, width, from: "foundation", parts });

// These sections are authored normalized construction vocabulary. The consumer
// fits their own silhouette to actual native boundaries and foundation heights.
const service = [box("dark", [0, .48, .12], [.5, .46, .30]), box("body", [0, .07, 0], [.5, .07, .46]), box("body", [0, .91, .05], [.5, .045, .39]), ...[-.38, .38].map(x => box("body", [x, .5, -.12], [.07, .42, .35])), tube("trim", [-.47, .93, -.34], [.47, .93, -.34], .025), tube("core", [-.42, .77, -.38], [.42, .77, -.38], .030, "pulse"), ...[-.25, .25].map(x => box("rail", [x, .38, -.22], [.04, .21, .24])), box("trim",[0,.58,-.27],[.19,.025,.08])];
const prism = [box("dark", [0, .26, .12], [.5, .24, .28]), ...[-.38, 0, .38].map(x => tube("trim", [x, .06, .25], [x+.08, .88, -.25], .08)), ...[-.38,.38].map(x=>tube("body",[x,.06,.25],[x-.08,.87,-.22],.11)), tube("core", [-.44, .89, -.25], [.44, .89, -.25], .035, "pulse"), box("body", [0, .05, .05], [.5, .05, .45]),tube("trim",[-.45,.54,-.30],[.45,.54,-.30],.045)];
const vault = [box("stone", [0, .38, .12], [.5, .36, .35]), ...[-.39, .39].flatMap(x => [box("stone", [x, .52, 0], [.10, .44, .47]), box("gold", [x, .88, -.05], [.13, .045, .49])]), box("gold", [0, .95, 0], [.5, .04, .43]), box("dark", [0, .53, -.25], [.24, .20, .16])];
const roots = [tube("bark", [-.47, .06, .2], [.42, .78, -.22], .19), tube("bark", [.46, .08, .25], [-.40, .81, -.20], .17), tube("stone", [-.46, .09, .18], [.45, .20, .18], .28), ...[-.3, .03, .31].map(x => box("leaf", [x, .84, -.04], [.17, .08, .33]))];
const cipher = [box("body", [0, .06, .05], [.5, .06, .45]), tube("trim", [-.45, .14, 0], [0, .91, -.24], .11), tube("trim", [0, .91, -.24], [.45, .14, 0], .11), tube("steel", [-.45, .14, 0], [0, .78, .27], .10), tube("steel", [0, .78, .27], [.45, .14, 0], .10), box("core", [0, .52, -.20], [.10, .13, .07], "pulse")];
const heat = [box("steel", [0, .48, .12], [.5, .46, .32]), ...[-.31, 0, .31].map(x => tube("dark", [x, .08, -.15], [x, .92, -.15], .14)), box("trim", [0, .93, 0], [.5, .06, .44]), box("dark", [0, .08, 0], [.5, .07, .44]), ...[-.25, 0, .25].map(x => box("core", [x, .60, -.23], [.09, .04, .04], "pulse"))];
const cableFeet = [box("steel", [0, .07, 0], [.46, .07, .46]), box("body", [0, .48, 0], [.28, .42, .26]), ...[-.35, .35].map(x => tube("rail", [x, .10, .18], [x * .4, .92, -.12], .055)), box("core", [0, .70, -.28], [.19, .05, .04], "pulse")];
const prismFeet = [box("trim", [0, .06, 0], [.46, .06, .46]), ...[-.28, .28].map(x => tube("body", [x, .12, .25], [-x, .92, -.20], .12)), box("core", [0, .88, 0], [.27, .04, .29], "pulse")];
const stoneFeet = [box("stone", [0, .10, 0], [.47, .10, .47]), box("stone", [0, .48, 0], [.32, .35, .32]), box("gold", [0, .89, 0], [.43, .07, .43])];
const rootFeet = [tube("bark", [-.38, .06, .29], [.10, .89, -.16], .16), tube("bark", [.37, .05, -.28], [-.08, .91, .18], .14), tube("stone", [-.40, .08, 0], [.40, .08, 0], .22)];
const cageFeet = [tube("steel", [-.37, .09, -.22], [.32, .91, .22], .07), tube("trim", [.37, .09, -.22], [-.32, .91, .22], .07), tube("body", [-.37, .09, .22], [.32, .91, -.22], .07), box("dark", [0, .06, 0], [.46, .06, .46])];

export const PINBALL_SCENE_CONSTRUCTIONS: Readonly<Record<PinballFrameTheme, Construction>> = {
  cyber: { semantic: "connected-service-galleries", boundary: boundary(service, 100, 150, 260), mounts: [mount("circuit-rib", "cable-cabinet-foundation", 100, cableFeet), mount("neon-swing-lamp", "service-lamp-foot", 64, cableFeet), mount("neon-pylon", "signal-tower-service-base", 84, cableFeet)] },
  vapor: { semantic: "prismatic-parapet-garden", boundary: boundary(prism, 100, 130, 240), mounts: [mount("prism-fan", "prism-parapet-foot", 94, prismFeet), mount("neon-swing-lamp", "prism-pendant-foot", 60, prismFeet), mount("palm", "sunken-palm-planter", 70, stoneFeet)] },
  gold: { semantic: "vaulted-retaining-courts", boundary: boundary(vault, 120, 180, 300), mounts: [mount("vault-buttress", "excavated-vault-plinth", 110, stoneFeet), mount("ruin-column", "buried-column-foot", 90, stoneFeet)] },
  nature: { semantic: "braided-ravine-retaining-roots", boundary: boundary(roots, 140, 140, 230), mounts: [mount("rooted-bank", "interlocking-bank-roots", 130, rootFeet), mount("root-bridge", "deep-root-web", 120, rootFeet), mount("oak", "ravine-tree-root-foot", 100, rootFeet)] },
  crypto: { semantic: "linked-cipher-cage-trusses", boundary: boundary(cipher, 100, 170, 230), mounts: [mount("cipher-chain", "key-cage-foundation", 90, cageFeet), mount("crystal", "quartz-cage-cradle", 74, cageFeet)] },
  nightshift: { semantic: "continuous-heat-service-wall", boundary: boundary(heat, 120, 150, 280), mounts: [mount("heat-exchanger", "deep-heat-service-foot", 100, cableFeet), mount("forge-turbine", "turbine-bedplate", 100, stoneFeet), mount("forge-furnace", "furnace-foundation", 100, stoneFeet)] },
};
