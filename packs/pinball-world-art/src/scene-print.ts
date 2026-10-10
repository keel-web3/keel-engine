import type { PinballFrameTheme } from "./framing.ts";
import type { PinballSceneBlueprint, PinballScenePrint } from "./scenes.ts";

type Point = readonly [number, number];
const line = (a: Point, b: Point, role: PinballScenePrint["role"], width = 3): PinballScenePrint => ({ a, b, role, width });
/** Closed contiguous contours declare a quiet substrate panel. Open lines are
 * engraving. The consumer clips both to the native bed; no contour is a target
 * or a new collider. Coordinates span one whole catch canvas, never a tile. */
const panel = (points: readonly Point[], role: PinballScenePrint["role"]): PinballScenePrint[] => points.map((a, i) => line(a, points[(i + 1) % points.length]!, role));
const mirrored = (marks: readonly PinballScenePrint[]): PinballScenePrint[] => [...marks, ...marks.map(p => ({ ...p, a: [-p.a[0], p.a[1]] as Point, b: [-p.b[0], p.b[1]] as Point }))];
const field = (semantic: string, primitives: readonly PinballScenePrint[]): PinballSceneBlueprint["print"] => ({ layout: "field", semantic, spacing: 480, primitives });

// The local fan needs its own large substrate illustration. At the native
// body-readable tall scale, side shoulders are often outside the camera. These
// matte shapes occupy the visible center instead of shrinking the camera to
// show a remote decorative panel. They carry no targets, hit rings or arrows.
const LOCAL_FAN: Readonly<Record<PinballFrameTheme, readonly PinballScenePrint[]>> = {
  cyber: [
    ...panel([[-104,-50],[-66,-50],[-66,40],[-27,79],[-27,188],[-70,228],[-104,228]],"dark"),
    ...panel([[5,37],[44,4],[104,4],[104,197],[72,229],[5,166]],"steel"),
    ...panel([[-53,95],[-9,66],[26,95],[26,146],[-9,178],[-53,146]],"core"),
    line([-91,-20],[-91,130],"trim",8),line([-91,130],[-69,153],"trim",8),line([-69,153],[-69,204],"trim",8),
    line([20,52],[85,52],"dark",12),line([40,78],[85,78],"dark",12),line([50,104],[85,104],"dark",12),
    line([-43,219],[5,253],"trim",8),line([5,253],[78,253],"trim",8),
  ],
  vapor: [
    ...panel([[-108,-16],[-66,6],[-24,78],[26,115],[100,98],[100,144],[23,162],[-42,112],[-83,40],[-108,22]],"trim"),
    ...panel([[-108,85],[-72,102],[-26,176],[28,214],[104,193],[104,235],[23,257],[-48,207],[-90,133],[-108,123]],"steel"),
    ...panel([[-42,30],[6,11],[65,42],[102,22],[102,55],[62,76],[3,42],[-25,60]],"core"),
    line([-83,178],[-38,248],"dark",8),line([-38,248],[10,280],"dark",8),line([10,280],[96,261],"dark",8),
  ],
  gold: [
    ...panel([[-99,-42],[-59,-42],[-59,187],[-31,232],[-99,232]],"dark"),
    ...panel([[59,-42],[99,-42],[99,232],[31,232],[59,187]],"dark"),
    ...panel([[-43,53],[0,20],[43,53],[43,158],[0,201],[-43,158]],"steel"),
    ...panel([[-20,75],[0,57],[20,75],[20,143],[0,166],[-20,143]],"trim"),
    line([-80,-6],[-80,175],"trim",10),line([80,-6],[80,175],"trim",10),line([-59,258],[59,258],"bark",12),
  ],
  nature: [
    ...panel([[-97,-61],[-68,-34],[-40,17],[-24,98],[9,151],[39,186],[9,217],[-28,175],[-54,108],[-62,44],[-95,-6]],"bark"),
    ...panel([[-49,45],[-102,32],[-108,64],[-69,102],[-44,91]],"trim"),
    ...panel([[-21,101],[26,43],[68,40],[55,76],[12,128]],"dark"),
    ...panel([[13,170],[72,129],[103,150],[88,193],[40,211]],"trim"),
    ...panel([[-29,169],[-89,181],[-102,221],[-52,239],[-12,217]],"dark"),
    line([-82,-27],[-52,35],"dark",8),line([-52,35],[-38,104],"dark",8),line([-38,104],[1,170],"dark",8),
    line([32,204],[49,260],"bark",10),line([49,260],[95,287],"bark",10),
  ],
  crypto: [
    ...panel([[-104,-31],[-24,-31],[3,-4],[-30,29],[-30,72],[-104,72]],"dark"),
    ...panel([[-80,92],[8,92],[39,124],[6,158],[6,224],[-80,224]],"steel"),
    ...panel([[26,9],[104,9],[104,103],[69,134],[26,93]],"core"),
    ...panel([[34,169],[104,169],[104,256],[8,256],[8,225],[34,201]],"dark"),
    line([-85,-10],[-43,-10],"trim",10),line([-63,115],[-17,115],"trim",10),line([-63,141],[-17,141],"trim",10),line([49,31],[81,31],"steel",10),line([49,57],[81,57],"steel",10),line([53,200],[85,200],"trim",10),
  ],
  nightshift: [
    ...panel([[-104,-46],[-39,-46],[-19,-19],[-19,229],[-104,229]],"dark"),
    ...panel([[12,9],[99,9],[99,186],[70,220],[12,220]],"steel"),
    ...panel([[-17,229],[60,229],[90,265],[-17,265]],"bark"),
    ...[0,35,70,105,140].map(y=>line([-86,y],[-43,y+18],"steel",14)),
    ...[40,78,116,154].map(y=>line([34,y],[81,y],"dark",14)),
    line([-82,260],[81,260],"trim",12),line([-82,280],[22,280],"bark",12),
  ],
};

/** Starter content is authored data. External biomes can bind an unrelated
 * whole-field composition through the same normalized line/panel grammar. */
export const PINBALL_SCENE_PRINTS: Readonly<Record<PinballFrameTheme, PinballSceneBlueprint["print"]>> = {
  cyber: field("etched-service-bays-and-open-voltage-fan", [
    ...LOCAL_FAN.cyber,
    ...mirrored([...panel([[-320,-250],[-245,-250],[-140,85],[-140,245],[-320,310]], "dark"), ...panel([[-315,-210],[-284,-210],[-184,96],[-184,225],[-220,245],[-315,245]], "steel"), line([-286,-150],[-205,110],"trim",5), line([-205,110],[-205,185],"trim",5), line([-295,284],[-172,245],"core",4)]),
    line([-110,292],[-52,263],"trim",5), line([52,263],[110,292],"trim",5), line([-52,263],[52,263],"dark",12),
  ]),
  vapor: field("pastel-tidal-terraces-around-open-fan", [
    ...LOCAL_FAN.vapor,
    ...mirrored([...panel([[-320,-260],[-268,-260],[-160,0],[-136,128],[-320,270]],"steel"), ...panel([[-320,20],[-248,20],[-190,146],[-320,255]],"trim"), line([-290,-185],[-230,-72],"core",5), line([-230,-72],[-202,65],"core",5), line([-310,290],[-178,208],"trim",6)]),
    ...[-24,0,24].map(y => line([-96,280+y],[96,280+y],"steel",4)),
  ]),
  gold: field("fluted-vault-shoulders-and-recessed-court", [
    ...LOCAL_FAN.gold,
    ...mirrored([...panel([[-320,-260],[-272,-260],[-152,105],[-152,285],[-320,285]],"dark"), ...panel([[-305,-225],[-288,-225],[-180,112],[-180,255],[-215,255]],"steel"), ...[-300,-274,-248].map(x=>line([x,70],[x,240],"trim",6)), line([-315,300],[-145,300],"trim",8)]),
    line([-110,295],[-90,253],"dark",10), line([-90,253],[90,253],"dark",10), line([90,253],[110,295],"dark",10),
  ]),
  nature: field("root-veins-and-ravine-edge-mats", [
    ...LOCAL_FAN.nature,
    ...mirrored([...panel([[-320,-265],[-265,-265],[-225,-122],[-168,10],[-150,205],[-275,310],[-320,310]],"bark"), line([-290,-210],[-249,-95],"dark",9), line([-249,-95],[-204,35],"dark",9), line([-204,35],[-200,177],"dark",9), line([-249,-95],[-310,-62],"trim",4), line([-204,35],[-300,87],"trim",4), line([-200,177],[-303,232],"trim",4)]),
    line([-118,304],[-40,282],"bark",7), line([40,282],[118,304],"bark",7),
  ]),
  crypto: field("interlocked-cipher-shoulder-plates", [
    ...LOCAL_FAN.crypto,
    ...mirrored([...panel([[-320,-250],[-272,-250],[-150,30],[-150,182],[-250,302],[-320,302]],"dark"), ...panel([[-304,-182],[-276,-200],[-203,0],[-178,138],[-246,242],[-290,212]],"steel"), line([-291,-114],[-236,36],"trim",5), line([-236,36],[-231,135],"trim",5), line([-231,135],[-268,190],"trim",5)]),
    line([-110,306],[-55,262],"steel",7),line([-55,262],[55,262],"steel",7),line([55,262],[110,306],"steel",7),
  ]),
  nightshift: field("vented-service-shoulders-and-quiet-stroke-bed", [
    ...LOCAL_FAN.nightshift,
    ...mirrored([...panel([[-320,-255],[-275,-255],[-155,95],[-155,285],[-320,285]],"dark"), ...[-300,-270,-240].map(x=>line([x,-10],[x+35,180],"steel",12)), line([-309,240],[-176,240],"trim",6), line([-309,267],[-176,267],"steel",12)]),
    line([-95,297],[95,297],"dark",16), line([-90,278],[90,278],"steel",6),
  ]),
};
