import { hashSkin, skinRandom } from "./effects.ts";
import type { ThemePalette } from "./themes.ts";
import type { PinballViewMap, PinballViewTheme, PinballVisualDensity } from "./types.ts";

type Context = CanvasRenderingContext2D;
type Point = readonly [number, number];
const TAU = Math.PI * 2;

function polygon(ctx: Context, points: readonly Point[], fill: string | CanvasGradient, edge?: string, width = 1): void {
  ctx.beginPath();
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    if (i === 0) ctx.moveTo(point[0], point[1]); else ctx.lineTo(point[0], point[1]);
  }
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = width; ctx.stroke(); }
}
function line(ctx: Context, ax: number, ay: number, bx: number, by: number, color: string, width = 1): void {
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}
function ellipse(ctx: Context, x: number, y: number, rx: number, ry: number, color: string | CanvasGradient, edge?: string, width = 1): void {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fillStyle = color; ctx.fill();
  if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = width; ctx.stroke(); }
}
function ring(ctx: Context, x: number, y: number, r: number, color: string, width = 1): void {
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}
function rosette(ctx: Context, x: number, y: number, radius: number, petals: number, color: string, width = 1): void {
  ctx.beginPath();
  const steps = petals * 8;
  for (let i = 0; i <= steps; i++) {
    const angle = i / steps * TAU, r = radius * (0.76 + Math.cos(angle * petals) * 0.24);
    if (i === 0) ctx.moveTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
    else ctx.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
  }
  ctx.closePath(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}
function printedLabel(ctx: Context, label: string, x: number, y: number, color: string, size = 9): void {
  ctx.font = `700 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = color; ctx.fillText(label, x, y);
}
function leaf(ctx: Context, x: number, y: number, size: number, angle: number, fill: string, vein: string, detail: boolean): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.bezierCurveTo(size * 0.25, -size * 0.55, size * 0.74, -size * 0.50, size, 0);
  ctx.bezierCurveTo(size * 0.62, size * 0.46, size * 0.15, size * 0.30, 0, 0);
  ctx.fillStyle = fill; ctx.fill();
  line(ctx, 0, 0, size * 0.92, 0, vein, 0.8);
  if (detail) for (const t of [0.25, 0.42, 0.59, 0.76]) {
    line(ctx, size * t, 0, size * (t + 0.14), -size * 0.20, vein, 0.45);
    line(ctx, size * t, 0, size * (t + 0.10), size * 0.17, vein, 0.45);
  }
  ctx.restore();
}

/** Flat screen-print artwork. These forms are never read as collision geometry. */
function foundry(ctx: Context, detail: number): void {
  // A broad copper furnace and heat exchanger give the industrial theme a
  // recognizable silhouette; muted fills keep its blueprint below the rails.
  const steel = ctx.createLinearGradient(50, 140, 530, 610);
  steel.addColorStop(0, "#253B47"); steel.addColorStop(0.45, "#132B35"); steel.addColorStop(1, "#0C1C28");
  polygon(ctx, [[64, 150], [180, 116], [414, 118], [524, 158], [496, 730], [100, 730]], steel);
  ctx.globalAlpha = 0.60;
  for (const x of [78, 480]) {
    polygon(ctx, [[x, 180], [x + 42, 164], [x + 49, 694], [x + 4, 711]], "#334A50", "#5B7B7C", 0.9);
    ctx.fillStyle = "#142A35"; ctx.fillRect(x + 10, 198, 18, 457);
    for (let i = 0; i < detail * 4; i++) {
      const y = 213 + i * 425 / (detail * 4);
      line(ctx, x + 11, y, x + 27, y + 2, i % 3 === 0 ? "#BE8D55" : "#60898A", 2.5);
    }
    polygon(ctx, [[x - 3, 724], [x + 53, 724], [x + 53, 753], [x - 3, 753]], "#2B3E43");
    for (let i = 0; i < 5; i++) line(ctx, x + i * 11, 730, x + i * 11 + 9, 742, "#B99755", 3);
  }
  ctx.globalAlpha = 0.76;
  ellipse(ctx, 301, 293, 155, 151, "#1C323A", "#657A76", 1.1);
  ellipse(ctx, 301, 293, 138, 134, "#19313A", "#BC8051", 2);
  ellipse(ctx, 301, 293, 122, 117, "#18303A", "#4D797B", 1);
  for (let i = 0; i < detail * 6; i++) {
    const a = i / (detail * 6) * TAU;
    polygon(ctx, [[301 + Math.cos(a) * 128, 293 + Math.sin(a) * 128], [301 + Math.cos(a + 0.09) * 148, 293 + Math.sin(a + 0.09) * 148], [301 + Math.cos(a + 0.16) * 145, 293 + Math.sin(a + 0.16) * 145], [301 + Math.cos(a + 0.12) * 124, 293 + Math.sin(a + 0.12) * 124]], "#3E5B5D");
  }
  ctx.globalAlpha = 0.54;
  polygon(ctx, [[145, 437], [220, 472], [229, 500], [152, 471]], "#796048", "#B88650");
  polygon(ctx, [[453, 437], [378, 472], [369, 500], [446, 471]], "#796048", "#B88650");
  for (const side of [-1, 1]) {
    const x = 300 + side * 168;
    ctx.beginPath(); ctx.moveTo(x, 404); ctx.lineTo(x, 651); ctx.quadraticCurveTo(x, 688, x - side * 40, 688); ctx.lineTo(x - side * 40, 774);
    ctx.strokeStyle = "#3B575D"; ctx.lineWidth = 17; ctx.stroke();
    ctx.strokeStyle = "#64847F"; ctx.lineWidth = 1.1; ctx.stroke();
    for (let i = 0; i < detail * 2; i++) line(ctx, x - 11, 484 + i * 23, x + 11, 484 + i * 23, "#8C7552", 2);
  }
  // Flat lower print frames the guardian without occupying its central space.
  ctx.globalAlpha = 0.48;
  polygon(ctx, [[152, 776], [448, 776], [468, 806], [132, 806]], "#35505A", "#658B88");
  for (let i = 0; i < 6; i++) {
    const x = 163 + i * 48;
    ctx.fillStyle = i % 2 ? "#296355" : "#5C5141"; ctx.fillRect(x, 786, 29, 8);
  }
  ctx.globalAlpha = 0.52; printedLabel(ctx, "BURN FORGE / INDUCTION", 300, 164, "#BDA77B", 10);
  printedLabel(ctx, "HEAT • PRESSURE • MOTION", 300, 763, "#819E9C", 8);
  ctx.globalAlpha = 0.40;
  for (const x of [150, 430]) {
    ctx.fillStyle = "#1E3039"; ctx.fillRect(x, 110, 22, 56);
    for (let row = 0; row < 5; row++) line(ctx, x + 3, 116 + row * 9, x + 19, 116 + row * 9, "#63807E", 2);
  }
}

function cityTower(ctx: Context, x: number, y: number, width: number, height: number, variant: number, detail: number): void {
  const side = width * 0.30;
  polygon(ctx, [[x, y], [x, y - height], [x + width, y - height - side], [x + width, y - side]], variant % 2 ? "#30233D" : "#183344", "#53516E", 0.7);
  polygon(ctx, [[x + width, y - side], [x + width, y - height - side], [x + width + side, y - height - 4], [x + width + side, y - 4]], "#141F31", "#43415D", 0.7);
  polygon(ctx, [[x, y - height], [x + width, y - height - side], [x + width + side, y - height - 4], [x + side, y - height + side - 4]], "#423354", "#826487", 0.7);
  for (let row = 0; row < detail * 3; row++) {
    const yy = y - 11 - row * (height - 20) / (detail * 3);
    for (let col = 0; col < 3; col++) {
      if ((row + col + variant) % 4 === 0) continue;
      ctx.fillStyle = (row + variant) % 3 ? "#367C85" : "#B05D9A";
      ctx.fillRect(x + 5 + col * (width - 10) / 3, yy - col * side / 3, Math.max(2, width / 7), 2.6);
    }
  }
  line(ctx, x + width, y - height - side, x + width, y - side, "#48A9AD", 1.2);
  if (variant % 3 === 0) {
    line(ctx, x + width * 0.55, y - height - side * 0.5, x + width * 0.55, y - height - 37, "#A269B8", 1);
    ellipse(ctx, x + width * 0.55, y - height - 37, 3, 3, "#DE82C3");
  }
}
function cyberCity(ctx: Context, detail: number): void {
  const glow = ctx.createRadialGradient(300, 220, 0, 300, 250, 340);
  glow.addColorStop(0, "#2B3153"); glow.addColorStop(0.50, "#251936"); glow.addColorStop(1, "#0D1726");
  ctx.fillStyle = glow; ctx.fillRect(5, 84, 590, 650);
  ctx.globalAlpha = 0.76;
  for (let i = 0; i < detail * 5; i++) {
    const left = i % 2 === 0, row = Math.floor(i / 2), x = left ? 31 + row % 3 * 27 : 478 + row % 3 * 20;
    cityTower(ctx, x, 225 + row * 80, 27 + row % 3 * 13, 100 + row % 4 * 34, i, detail);
  }
  // The bridge and circular data-core are printed city scenery, with a quiet
  // central void where the true coils and moving ball retain priority.
  ctx.globalAlpha = 0.48;
  for (const side of [-1, 1]) {
    const x = 300 + side * 145;
    polygon(ctx, [[x, 157], [x + side * 51, 178], [x + side * 42, 382], [x + side * 11, 363]], "#273448", "#3A8891", 0.8);
    for (let i = 0; i < detail * 3; i++) line(ctx, x + side * 4, 190 + i * 21, x + side * 43, 203 + i * 21, i % 2 ? "#8A4F92" : "#3A8A91", 1);
  }
  ctx.globalAlpha = 0.42;
  polygon(ctx, [[197, 199], [245, 153], [355, 153], [403, 199], [403, 344], [355, 393], [245, 393], [197, 344]], "#132536", "#49968F", 1.2);
  polygon(ctx, [[209, 204], [250, 166], [350, 166], [391, 204], [391, 338], [350, 379], [250, 379], [209, 338]], "#152438", "#85517F", 1);
  ctx.globalAlpha = 0.34;
  for (let i = 0; i < detail * 4; i++) {
    const y = 422 + i * 23, side = i % 2 ? -1 : 1;
    ctx.beginPath(); ctx.moveTo(300 + side * 185, y); ctx.lineTo(300 + side * 134, y); ctx.lineTo(300 + side * 118, y + 16); ctx.lineTo(300 + side * 90, y + 16);
    ctx.strokeStyle = i % 2 ? "#B469AB" : "#55B9AB"; ctx.lineWidth = 1.3; ctx.stroke();
    ellipse(ctx, 300 + side * 90, y + 16, 2.6, 2.6, "#5FB4BD");
  }
  ctx.globalAlpha = 0.49;
  for (let i = 0; i < 5; i++) {
    const y = 759 + i * 19;
    polygon(ctx, [[126, y], [169, y - 6], [430, y - 6], [472, y], [437, y + 3], [159, y + 3]], i % 2 ? "#35405C" : "#432945");
  }
  ctx.globalAlpha = 0.62; printedLabel(ctx, "NEON ROLLUP / NIGHT DISTRICT", 300, 127, "#C47DAC", 10);
  printedLabel(ctx, "LINK 001   ∷   LINK 002   ∷   LINK 003", 300, 744, "#64ABA8", 8);
}

function templeColumn(ctx: Context, x: number, y: number, height: number, width: number, detail: number): void {
  polygon(ctx, [[x, y], [x + width, y], [x + width - 4, y - height], [x + 4, y - height]], "#4B416D", "#BA95BC", 0.9);
  ctx.fillStyle = "#796894"; ctx.fillRect(x + 4, y - height + 6, width * 0.22, height - 8);
  for (let i = 0; i < detail; i++) line(ctx, x + 9 + i * (width - 18) / detail, y - height + 5, x + 9 + i * (width - 18) / detail, y - 4, "#B49DB7", 0.6);
  ctx.fillStyle = "#85719B"; ctx.fillRect(x - 4, y - height - 7, width + 8, 8); ctx.fillRect(x - 5, y - 1, width + 10, 8);
}
function vaporTemple(ctx: Context, detail: number): void {
  const sky = ctx.createLinearGradient(0, 94, 0, 553);
  sky.addColorStop(0, "#292F50"); sky.addColorStop(0.34, "#5A355E"); sky.addColorStop(0.62, "#70495D"); sky.addColorStop(1, "#302D4C");
  ctx.fillStyle = sky; ctx.fillRect(6, 84, 588, 470);
  ctx.save();
  ctx.beginPath(); ctx.arc(300, 278, 145, 0, TAU); ctx.clip();
  const sun = ctx.createLinearGradient(0, 133, 0, 423);
  sun.addColorStop(0, "#C79A76"); sun.addColorStop(0.45, "#CB7E9B"); sun.addColorStop(1, "#6B4281");
  ctx.fillStyle = sun; ctx.fillRect(140, 126, 320, 310);
  ctx.fillStyle = "#593556";
  for (let i = 0; i < 9; i++) ctx.fillRect(145, 270 + i * 17, 310, 2 + i * 1.0);
  ctx.restore();
  ctx.globalAlpha = 0.68;
  polygon(ctx, [[9, 474], [96, 326], [150, 394], [218, 309], [298, 477]], "#363053");
  polygon(ctx, [[292, 477], [380, 355], [445, 415], [500, 344], [593, 474]], "#343457");
  line(ctx, 96, 327, 150, 394, "#746687", 1.2); line(ctx, 380, 355, 445, 415, "#777791", 1.2);
  // Perspective tilework has broad alternating fills so it survives the pixel
  // and dither filters. Thin grid strokes are secondary to the colored planes.
  const horizon = 469, bottom = 948;
  for (let row = 0; row < detail * 3; row++) {
    const a = row / (detail * 3), b = (row + 1) / (detail * 3);
    const y1 = horizon + (bottom - horizon) * a * a, y2 = horizon + (bottom - horizon) * b * b;
    for (let col = -4; col < 4; col++) {
      const spread1 = 12 + (y1 - horizon) * 0.47, spread2 = 12 + (y2 - horizon) * 0.47;
      polygon(ctx, [[300 + col * spread1, y1], [300 + (col + 1) * spread1, y1], [300 + (col + 1) * spread2, y2], [300 + col * spread2, y2]], (row + col) % 2 ? "#242E48" : "#37304F", "#694D7D", 0.6);
    }
  }
  ctx.globalAlpha = 0.74;
  for (const x of [72, 454]) {
    templeColumn(ctx, x, 725, 282, 48, detail);
    templeColumn(ctx, x + 14, 437, 101, 24, detail);
    polygon(ctx, [[x - 8, 326], [x + 57, 326], [x + 26, 302]], "#846C96", "#BB91B8", 0.8);
  }
  ctx.globalAlpha = 0.62;
  ellipse(ctx, 300, 773, 96, 18, "#383349", "#77748E", 0.8);
  polygon(ctx, [[264, 777], [275, 719], [325, 719], [336, 777]], "#493B60", "#86719A", 0.8);
  polygon(ctx, [[272, 717], [300, 685], [328, 717]], "#7B5989", "#B08FAA", 0.8);
  ctx.globalAlpha = 0.75; printedLabel(ctx, "LIQUIDITY LAGOON / AFTER HOURS", 300, 118, "#DCAABC", 10);
  ctx.globalAlpha = 0.32;
  for (let i = 0; i < detail * 4; i++) ellipse(ctx, 116 + i * 29 % 386, 151 + i * 37 % 257, 1.0, 1.0, "#D8C1D0");
}

function goldVault(ctx: Context, detail: number): void {
  const lacquer = ctx.createLinearGradient(90, 100, 510, 800);
  lacquer.addColorStop(0, "#453628"); lacquer.addColorStop(0.38, "#28281F"); lacquer.addColorStop(0.72, "#1F2421"); lacquer.addColorStop(1, "#433124");
  ctx.fillStyle = lacquer; ctx.fillRect(8, 84, 584, 890);
  ctx.globalAlpha = 0.64;
  // Art-deco treasury gates have a readable large silhouette at any density.
  for (const side of [-1, 1]) {
    const x = side < 0 ? 49 : 551;
    polygon(ctx, [[x, 160], [x + side * 23, 187], [x + side * 23, 712], [x, 748], [x - side * 56, 702], [x - side * 56, 207]], "#564332", "#B08A4A", 1.2);
    polygon(ctx, [[x - side * 10, 208], [x - side * 42, 230], [x - side * 42, 657], [x - side * 10, 687]], "#2C3028", "#9C8146", 0.9);
    for (let i = 0; i < detail * 4; i++) {
      const y = 238 + i * 400 / (detail * 4);
      polygon(ctx, [[x - side * 27, y - 10], [x - side * 12, y], [x - side * 27, y + 10], [x - side * 43, y]], "#514E31", "#988F57", 0.7);
    }
  }
  ctx.globalAlpha = 0.69;
  polygon(ctx, [[144, 167], [197, 121], [404, 121], [457, 167], [457, 420], [403, 477], [198, 477], [144, 420]], "#3E3926", "#A58A48", 1.1);
  const medallion = ctx.createRadialGradient(261, 230, 20, 300, 292, 160);
  medallion.addColorStop(0, "#7A6A38"); medallion.addColorStop(0.52, "#514A2B"); medallion.addColorStop(1, "#2C352A");
  ellipse(ctx, 300, 292, 150, 150, medallion, "#BD9955", 1.3);
  ring(ctx, 300, 292, 139, "#9F874B", 3); ring(ctx, 300, 292, 126, "#6F7241", 1);
  for (let i = 0; i < detail * 8; i++) {
    const angle = i / (detail * 8) * TAU;
    const r = i % 2 ? 133 : 129;
    line(ctx, 300 + Math.cos(angle) * r, 292 + Math.sin(angle) * r, 300 + Math.cos(angle) * 144, 292 + Math.sin(angle) * 144, "#CEAB63", 1.1);
  }
  ctx.globalAlpha = 0.43;
  polygon(ctx, [[300, 180], [368, 277], [300, 392], [232, 277]], "#A08B46", "#D4B76B", 1.1);
  polygon(ctx, [[300, 180], [300, 286], [232, 277]], "#BB9A55");
  polygon(ctx, [[300, 286], [368, 277], [300, 392]], "#4B6138");
  line(ctx, 232, 277, 300, 304, "#DED083", 1); line(ctx, 368, 277, 300, 304, "#DED083", 1);
  ctx.globalAlpha = 0.57;
  for (const side of [-1, 1]) {
    const x = 300 + side * 144;
    for (let i = 0; i < detail * 3; i++) {
      const y = 486 + i * 26;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + side * 52, y - 29, x + side * 43, y + 25, x, y + 16);
      ctx.strokeStyle = "#AE9856"; ctx.lineWidth = 1.5; ctx.stroke();
      ellipse(ctx, x + side * 30, y + 1, 4, 4, "#5D623B", "#B59D60", 0.7);
    }
    rosette(ctx, x + side * 16, 734, 36, 8, "#9B8850", 1.2);
    rosette(ctx, x + side * 16, 734, 26, 8, "#636A41", 1);
  }
  ctx.globalAlpha = 0.58;
  polygon(ctx, [[168, 791], [204, 764], [397, 764], [433, 791], [400, 815], [202, 815]], "#615333", "#B49B59", 1.1);
  for (let i = 0; i < 6; i++) polygon(ctx, [[215 + i * 29, 777], [225 + i * 29, 790], [215 + i * 29, 803], [205 + i * 29, 790]], "#2B4132", "#A59657", 0.7);
  ctx.globalAlpha = 0.69; printedLabel(ctx, "GENESIS VAULT / GOLDEN AGE", 300, 105, "#CEB474", 10);
  printedLabel(ctx, "FORTUNE FAVOURS THE BOLD", 300, 747, "#A29C67", 8);
  ctx.globalAlpha = 0.36;
  for (let i = 0; i < detail * 2; i++) {
    const inset = i * 4;
    ctx.beginPath(); ctx.moveTo(141 + inset, 145); ctx.lineTo(200, 93 + inset); ctx.lineTo(400, 93 + inset); ctx.lineTo(459 - inset, 145);
    ctx.strokeStyle = "#D0A76A"; ctx.lineWidth = 0.7; ctx.stroke();
  }
}

function botanicalRiver(ctx: Context, detail: number): void {
  const canopy = ctx.createLinearGradient(80, 106, 500, 816);
  canopy.addColorStop(0, "#2D5946"); canopy.addColorStop(0.4, "#193E35"); canopy.addColorStop(1, "#163833");
  ctx.fillStyle = canopy; ctx.fillRect(8, 84, 584, 890);
  ctx.globalAlpha = 0.63;
  // A winding river is a broad, flat illustration; it deliberately has no hard
  // edge or bevel that could be mistaken for a physical ramp or wall.
  ctx.beginPath(); ctx.moveTo(299, 114); ctx.bezierCurveTo(436, 232, 389, 316, 258, 389); ctx.bezierCurveTo(171, 458, 350, 476, 380, 548); ctx.bezierCurveTo(433, 656, 171, 731, 261, 840); ctx.lineTo(339, 939); ctx.lineTo(267, 939); ctx.bezierCurveTo(203, 834, 145, 741, 249, 686); ctx.bezierCurveTo(388, 618, 264, 531, 215, 490); ctx.bezierCurveTo(137, 416, 351, 354, 337, 268); ctx.bezierCurveTo(344, 204, 269, 166, 259, 114); ctx.closePath();
  const water = ctx.createLinearGradient(190, 135, 375, 879);
  water.addColorStop(0, "#406E63"); water.addColorStop(0.5, "#27585A"); water.addColorStop(1, "#558478");
  ctx.fillStyle = water; ctx.fill();
  ctx.globalAlpha = 0.39;
  for (let i = 0; i < detail * 3; i++) {
    const y = 189 + i * 64, x = 300 + Math.sin(i * 1.12) * 60;
    ctx.beginPath(); ctx.ellipse(x, y, 20 + i % 3 * 8, 4, -0.2, 0.1, Math.PI * 1.2); ctx.strokeStyle = "#91B6A0"; ctx.lineWidth = 1; ctx.stroke();
  }
  // Botanical plates and broad fern leaves build dense banks without covering
  // the guardian's quiet center or adding animated work.
  const random = skinRandom(hashSkin("pinball-botanical-relief"));
  ctx.globalAlpha = 0.79;
  for (const side of [-1, 1]) {
    const x = side < 0 ? 67 : 531;
    for (let branch = 0; branch < detail * 2 + 2; branch++) {
      const y = 152 + branch * 620 / (detail * 2 + 2), reach = 80 + random() * 54;
      const angle = side < 0 ? -0.6 : Math.PI + 0.6;
      line(ctx, x, y, x + Math.cos(angle) * reach, y + Math.sin(angle) * reach, "#537947", 2);
      for (let i = 0; i < 4; i++) {
        const t = (i + 1) / 5;
        leaf(ctx, x + Math.cos(angle) * reach * t, y + Math.sin(angle) * reach * t, 27 + i * 3, angle - 0.9, i % 2 ? "#4C7950" : "#346C4B", "#7DAD6C", detail > 1);
        leaf(ctx, x + Math.cos(angle) * reach * t, y + Math.sin(angle) * reach * t, 32 + i * 3, angle + 0.8, i % 2 ? "#326049" : "#6C8050", "#A6B174", detail > 1);
      }
    }
  }
  // Stone temple relief lives above the main ball corridor, softened like an
  // antique illustration under clear lacquer.
  ctx.globalAlpha = 0.51;
  ellipse(ctx, 299, 285, 149, 146, "#3B5D44", "#85A46E", 1.0);
  rosette(ctx, 299, 285, 139, 12, "#789663", 1.2);
  ring(ctx, 299, 285, 116, "#607F58", 3);
  ctx.beginPath(); ctx.moveTo(299, 391); ctx.bezierCurveTo(281, 343, 320, 300, 291, 208); ctx.lineTo(305, 208); ctx.bezierCurveTo(330, 308, 306, 344, 315, 391); ctx.closePath(); ctx.fillStyle = "#91A272"; ctx.fill();
  for (let i = 0; i < detail * 3; i++) {
    const a = -Math.PI + i / (detail * 3 - 1) * Math.PI, x = 300 + Math.cos(a) * 67, y = 288 + Math.sin(a) * 53;
    leaf(ctx, 299, 292, 71, a, i % 2 ? "#638250" : "#879660", "#ADC186", true);
    ellipse(ctx, x, y, 3, 3, "#AEB578");
  }
  ctx.globalAlpha = 0.64;
  for (const side of [-1, 1]) {
    const x = 300 + side * 157;
    ellipse(ctx, x, 757, 25, 39, "#64724F", "#A2AD76", 0.9);
    leaf(ctx, x, 790, 58, -Math.PI / 2, "#4A7753", "#A7B278", true);
    for (let i = 0; i < 4; i++) ellipse(ctx, x + Math.cos(i * Math.PI / 2) * 12, 745 + Math.sin(i * Math.PI / 2) * 12, 9, 9, "#A19767");
    ellipse(ctx, x, 745, 5, 5, "#C4B77E");
  }
  ctx.globalAlpha = 0.75; printedLabel(ctx, "GAS GARDENS / LIVING TEMPLE", 300, 110, "#B5C198", 10);
  ctx.globalAlpha = 0.47; printedLabel(ctx, "ROOT • RIVER • RETURN", 300, 801, "#C0C5A0", 8);
}

/** Runs only when the renderer rebuilds its bounded background cache. */
export function drawPrintedThemeArt(ctx: Context, map: PinballViewMap, theme: PinballViewTheme, palette: ThemePalette, density: PinballVisualDensity): void {
  const detail = density === "low" ? 1 : density === "high" ? 3 : 2;
  ctx.save(); ctx.beginPath(); ctx.rect(8, Math.min(84, map.height * 0.084), map.width - 16, map.height - Math.min(96, map.height * 0.096)); ctx.clip();
  ctx.scale(map.width / 600, map.height / 1000);
  ctx.globalAlpha = 0.82;
  if (theme === "nightshift") foundry(ctx, detail);
  else if (theme === "cyberpunk") cyberCity(ctx, detail);
  else if (theme === "vaporwave") vaporTemple(ctx, detail);
  else if (theme === "gold") goldVault(ctx, detail);
  else botanicalRiver(ctx, detail);
  ctx.restore();

  // Lacquer darkens the busy print immediately around actual physics surfaces.
  // This follows canonical coordinates and cannot introduce a visual collider.
  ctx.save();
  for (const bumper of map.bumpers) {
    const radius = Math.max(24, bumper.radius * 2.5);
    const calm = ctx.createRadialGradient(bumper.x, bumper.y, bumper.radius * 0.7, bumper.x, bumper.y, radius);
    calm.addColorStop(0, palette.floor); calm.addColorStop(0.42, palette.floor); calm.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 0.66; ctx.fillStyle = calm; ctx.fillRect(bumper.x - radius, bumper.y - radius, radius * 2, radius * 2);
  }
  const quiet = ctx.createRadialGradient(map.width * 0.50, map.height * 0.58, map.width * 0.10, map.width * 0.50, map.height * 0.58, map.width * 0.25);
  quiet.addColorStop(0, palette.floor); quiet.addColorStop(0.4, palette.floor); quiet.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = 0.77; ctx.fillStyle = quiet; ctx.fillRect(map.width * 0.25, map.height * 0.40, map.width * 0.50, map.height * 0.36);
  // The drain and flipper region benefits from a strong quiet gradient too.
  const apron = ctx.createLinearGradient(0, map.height * 0.78, 0, map.height);
  apron.addColorStop(0, "rgba(0,0,0,0)"); apron.addColorStop(0.62, palette.floor); apron.addColorStop(1, palette.ambient);
  ctx.globalAlpha = 0.62; ctx.fillStyle = apron; ctx.fillRect(8, map.height * 0.78, map.width - 16, map.height * 0.22);
  ctx.restore();
}
