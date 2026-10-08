// Native KEEL ground drawing. These small, seamless surface tiles are baked
// once, then sampled with mipmaps; no drawing or random work runs per frame.
import { createRoll, hash2, SCREENS } from "@keel-engine/core";

export const GROUND_ART_SIZE = 256, GROUND_ART_LAYERS = 4, GROUND_ART_METRES = 8;
// Clipped blades, a dark root, overlapping fans and broken lit tips.
const TUFT = ["...3......3..", ".3.43...34...", "..343.3.43.3.", "...34343433..", ".233434332...", "..2233322....", "....111......"];
const STONE = ["..333..", ".34432.", "3443322", ".33221.", "..111.."];
const LEAF = ["..3..", ".343.", "2332.", ".21.."];

/** RG8: authored shade and grass coverage. Layers: lawn, rough grass, soil, gravel. */
export function groundArtPixels(): Uint8Array {
  const S = GROUND_ART_SIZE, data = new Uint8Array(S * S * GROUND_ART_LAYERS * 2);
  const roll = createRoll("6b65656c2d67726f756e642d6172742d31"), screen = SCREENS.bayer4.at;
  const wrap = (n: number) => Math.round(n) & (S - 1);
  for (let layer = 0; layer < GROUND_ART_LAYERS; layer++) {
    const base = layer * S * S * 2, R = roll.sub(900 + layer), random = () => R.next() / 65536;
    const put = (x: number, y: number, tone: number, grass: boolean): void => {
      x = wrap(x); y = wrap(y);
      const i = base + (y * S + x) * 2;
      data[i] = Math.round(Math.min(24, Math.max(0, Math.floor(tone * 24 + screen(x, y)))) * 255 / 24);
      data[i + 1] = grass ? 255 : 0;
    };
    const line = (x: number, y: number, dx: number, dy: number, tone: number): void => {
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
      for (let i = 0; i <= n; i++) put(x + dx * i / n, y + dy * i / n, tone, false);
    };
    // Periodic low-contrast substrate: drawn features supply the structure,
    // not large sine/noise islands deciding where dirt meets grass.
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const cell = hash2(x >> 3, y >> 3, layer + 17), grain = hash2(x, y, layer + 61);
      put(x, y, (layer < 2 ? .49 : .44) + (cell - .5) * .065 + (grain - .5) * .07, layer < 2);
    }
    const stamp = (mask: readonly string[], x: number, y: number, scale: number, grass: boolean, shade: number): void => {
      const turn = Math.floor(random() * 4), flip = random() < .5 ? -1 : 1;
      for (let v = 0; v < mask.length; v++) for (let u = 0; u < mask[v]!.length; u++) {
        const mark = mask[v]![u]!; if (mark === ".") continue;
        for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) {
          const px = (u * scale + a) * flip, py = v * scale + b;
          put(x + (turn === 0 ? px : turn === 1 ? -py : turn === 2 ? -px : py),
            y + (turn === 0 ? py : turn === 1 ? px : turn === 2 ? -py : -px), .15 + Number(mark) * .12 + shade, grass);
        }
      }
    };
    // Short, angular scars with chipped shoulders, like foot-scuffed turf.
    // Wrapping every stroke keeps complete features at tile boundaries.
    if (layer === 1) for (let patch = 0; patch < 38; patch++) {
      let x = random() * S, y = random() * S;
      const dx = random() < .5 ? -1 : 1, dy = random() < .5 ? -1 : 1, length = 8 + Math.floor(random() * 23);
      for (let j = 0; j < length; j++) {
        const width = 2 + Math.floor(random() * 5), envelope = Math.min(1, j / 4, (length - j) / 4);
        for (let v = -width; v <= width; v++) if (Math.abs(v) <= width * envelope) {
          put(x, y + v, .34 + random() * .13, false);
          if (v === -width) put(x, y + v - 1, .63, true);
        }
        x += dx; y += random() < .45 ? dy : 0;
      }
    }
    // Clods and pebbles have faces and contact shadows, not single bright dots.
    const stones = layer === 3 ? 1150 : layer === 2 ? 310 : layer === 1 ? 45 : 8;
    for (let i = 0; i < stones; i++) stamp(STONE, random() * S, random() * S, layer === 3 && random() < .12 ? 2 : 1, false, (random() - .5) * .16 - (layer === 2 ? .1 : 0));
    if (layer < 3) {
      // A few families of neighbouring fans make clumps; lawn is clipped,
      // rough ground has taller overlapping blades and small bare seams.
      const clusters = layer === 0 ? 310 : layer === 1 ? 210 : 110;
      for (let i = 0; i < clusters; i++) {
        const x = random() * S, y = random() * S, shade = (random() - .5) * .13;
        for (let j = 0; j < (layer === 1 ? 4 : 2); j++) stamp(TUFT, x + random() * 12, y + random() * 12, layer === 1 && j === 0 ? 2 : 1, true, shade);
      }
    }
    if (layer === 1 || layer === 2) for (let i = 0; i < 32; i++) {
      const x = random() * S, y = random() * S;
      if (i % 3 === 0) { line(x, y, 4 + random() * 6, 2 + random() * 5, .25); line(x + 2, y, 4, 2, .57); }
      else stamp(LEAF, x, y, 1, false, -.03);
    }
  }
  return data;
}

/** One bounded allocation per owning ground renderer, independent of city size. */
export function uploadGroundArt(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE8); gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RG8, GROUND_ART_SIZE, GROUND_ART_SIZE, GROUND_ART_LAYERS, 0, gl.RG, gl.UNSIGNED_BYTE, groundArtPixels());
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY); gl.activeTexture(gl.TEXTURE0);
  return texture;
}
