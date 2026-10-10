import type { ArenaSceneEnvironment, ArenaSceneStructure } from "@keel-engine/pinball-arena";
import type { PinballFrameTheme } from "./framing.ts";

type Part = ArenaSceneStructure["hubs"][number];
type Substrate = NonNullable<ArenaSceneEnvironment["substrate"]>;
const box = (role: string, a: Part["a"], size: Part["size"], motion: Part["motion"] = "static"): Part => ({ role, kind: "box", a, b: a, size, motion });
const tube = (role: string, a: Part["a"], b: Part["b"], radius: number, motion: Part["motion"] = "static"): Part => ({ role, kind: "capsule", a, b, size: [radius, radius, radius], motion });
const rock = (role: string, a: Part["a"], radius: number): Part => ({ role, kind: "ball", a, b: a, size: [radius, radius, radius], motion: "static" });

/** These are recessed chamber cross-sections, not additional playable beds.
 * Each vocabulary owns real masses, channels and material breaks. The consumer
 * fits them to the native bay/route direction and a shared bounded foundation. */
export const PINBALL_SCENE_SUBSTRATES: Readonly<Record<PinballFrameTheme, Substrate>> = {
  cyber: { semantic: "layered-cable-trenches-and-service-plates", layout: "boundary", spacing: 420, rise: 96, parts: [
    box("dark", [0, .14, 0], [.49, .14, .49]), box("body", [-.25, .46, .05], [.22, .24, .44]),
    box("steel", [.29, .33, -.15], [.18, .15, .30]), box("dark", [-.24, .715, .04], [.16, .015, .31]),
    tube("rail", [.03, .29, -.47], [.03, .29, .47], .055), tube("trim", [.14, .39, -.47], [.14, .39, .47], .035),
    box("steel", [-.24, .75, -.18], [.15, .025, .025]), box("body", [.28, .58, .31], [.18, .08, .14]),
  ] },
  vapor: { semantic: "interleaved-tidal-prism-terraces", layout: "boundary", spacing: 500, rise: 112, parts: [
    box("dark", [0, .10, 0], [.49, .10, .49]), box("body", [-.23, .30, .16], [.25, .18, .31]),
    box("steel", [.18, .43, -.14], [.29, .12, .31]), box("trim", [.26, .66, -.26], [.21, .075, .21]),
    tube("body", [-.45, .62, .34], [.45, .62, -.26], .13), tube("stone", [-.46, .26, -.26], [.44, .26, .34], .025),
    box("steel", [-.30, .78, .26], [.15, .06, .18]),
  ] },
  gold: { semantic: "excavated-vault-steps-and-fluted-courts", layout: "boundary", spacing: 520, rise: 128, parts: [
    box("dark", [0, .12, 0], [.49, .12, .49]), box("stone", [0, .34, 0], [.43, .18, .43]),
    box("stone", [-.18, .62, .13], [.24, .12, .28]), box("gold", [-.18, .755, .13], [.26, .015, .30]),
    box("dark", [.29, .54, -.25], [.12, .035, .15]),
    ...[-.27, -.05, .17].map(x => box("gold", [x, .84, .13], [.025, .06, .25])),
  ] },
  nature: { semantic: "continuous-braided-root-and-moss-shelves", layout: "boundary", spacing: 400, rise: 144, parts: [
    rock("stone", [-.23, .27, .20], .27), rock("stone", [.26, .22, -.26], .22),
    tube("bark", [-.47, .35, .18], [.47, .50, .05], .18), tube("bark", [-.32, .24, -.40], [.38, .64, .40], .20),
    tube("bark", [-.35, .50, .12], [.05, .65, -.45], .11),
    tube("leaf", [.03, .73, .07], [.29, .78, .30], .085), tube("leaf", [-.38, .59, .25], [-.19, .64, .38], .08),
  ] },
  crypto: { semantic: "interlocking-recessed-key-trusses", layout: "boundary", spacing: 440, rise: 104, parts: [
    box("dark", [0, .11, 0], [.49, .11, .49]), box("body", [-.26, .36, .16], [.21, .20, .30]),
    box("steel", [.27, .26, -.20], [.20, .12, .27]),
    tube("gold", [-.43, .35, -.34], [.37, .67, .31], .07), tube("rail", [-.42, .62, .34], [.40, .29, -.32], .065),
    box("trim", [-.24, .59, .16], [.13, .025, .19]), box("dark", [.22, .48, -.19], [.12, .02, .11]),
  ] },
  nightshift: { semantic: "recessed-heat-channels-and-service-grates", layout: "boundary", spacing: 400, rise: 96, parts: [
    box("dark", [0, .16, 0], [.49, .16, .49]), box("steel", [-.31, .42, 0], [.17, .24, .47]), box("steel", [.31, .42, 0], [.17, .24, .47]),
    ...[-.33, 0, .33].map(z => box("rail", [0, .72, z], [.47, .055, .035])),
    tube("trim", [-.08, .29, -.46], [-.08, .29, .46], .065), tube("dark", [.08, .31, -.46], [.08, .31, .46], .045),
  ] },
};
