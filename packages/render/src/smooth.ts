// Smooth edges: the frame drawn at k x k samples an art pixel, then each art pixel the mean of its samples.
//
// A target rendered straight at its own size flips whole pixels as an edge slides less than one: a slow turn walks
// the stairs along every silhouette, the "crawl". Smooth edges keep the pixel art -- every pass still works in art
// pixels: the screen's threshold is one per art pixel (so a surface's inside is the same palette entries as ever),
// the outline, rim and glow reach whole art pixels -- but they are drawn k times finer, and the resolve averages
// each art pixel's k x k: inside a surface that's its one palette colour, across an edge the two sides mixed by how
// much of the pixel each covers, as font smoothing does a glyph's edge. An edge moving a fraction of a pixel moves
// its blend a fraction, never a stair.
//
// The passes are PIXEL_FS (and DIRECT_PIXEL_FS) with their pixel reaches scaled by uSS: the same source otherwise,
// so the crisp path -- the proof of concept's, call for call -- is untouched.

/** PIXEL_FS (or DIRECT_PIXEL_FS) reaching in art pixels over a buffer of uSS x uSS samples to each. */
export function smoothPixelFs(fs: string): string {
  const edits: [string, string][] = [
    ["uniform int uCycle;         // on\n", "uniform int uCycle;         // on\nuniform int uSS;            // samples to an art pixel, each way (smooth edges)\n"],
    ["float s = screenAt(ivec2(gl_FragCoord.xy));", "float s = screenAt(ivec2(gl_FragCoord.xy) / uSS);"],
    ["ivec2(round(vec2(cos(a), sin(a)) * rr))", "ivec2(round(vec2(cos(a), sin(a)) * rr * float(uSS)))"],
    ["ivec2(round(uRimDir * uRim.y))", "ivec2(round(uRimDir * uRim.y * float(uSS)))"],
    ["ivec2 q = clamp(px + o, ivec2(0), size - 1);", "ivec2 q = clamp(px + o * uSS, ivec2(0), size - 1);"],
    ["float(int(gl_FragCoord.y) % int(uScan.y))", "float((int(gl_FragCoord.y) / uSS) % int(uScan.y))"],
  ];
  let out = fs;
  for (const [from, to] of edits) {
    if (!out.includes(from)) throw new Error(`smoothPixelFs: the pixel pass changed under its edit (${from.trim().slice(0, 40)})`);
    out = out.replace(from, to);
  }
  return out;
}

/** DEPTH_OUT_FS over the fine buffers: each art pixel's depth its middle sample's. */
export function smoothDepthOutFs(fs: string): string {
  const a = "uniform vec2 uMap; // scale, bias\n", b = "texelFetch(uDepth, ivec2(gl_FragCoord.xy), 0)";
  if (!fs.includes(a) || !fs.includes(b)) throw new Error("smoothDepthOutFs: the depth pass changed under its edit");
  return fs.replace(a, a + "uniform int uSS;\n").replace(b, "texelFetch(uDepth, ivec2(gl_FragCoord.xy) * uSS + uSS / 2, 0)");
}

/** The resolve: each art pixel the mean of its uSS x uSS samples, in (near enough) linear light so an edge's
 *  half-and-half isn't darker than either side. */
export const RESOLVE_FS = `#version 300 es
precision highp float;
uniform sampler2D uColour;
uniform int uSS;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * uSS;
  vec3 acc = vec3(0.0);
  for (int y = 0; y < 4; y++) {
    if (y >= uSS) break;
    for (int x = 0; x < 4; x++) {
      if (x >= uSS) break;
      vec3 c = texelFetch(uColour, p + ivec2(x, y), 0).rgb;
      acc += c * c;
    }
  }
  outColor = vec4(sqrt(acc / float(uSS * uSS)), 1.0);
}`;

/** Samples to an art pixel, each way: as asked (1..4), or, on "auto", 3 -- 2 past about a million samples a frame,
 *  1 (crisp) past that again, so a big target's march isn't nine times the work. */
export function supersampleFor(width: number, height: number, asked: number | "auto" = "auto", budget = 1_100_000): number {
  if (asked !== "auto") return Math.max(1, Math.min(4, Math.round(asked)));
  for (const k of [3, 2]) if (width * height * k * k <= budget) return k;
  return 1;
}
