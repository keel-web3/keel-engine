import { hashSkin, PinballEffects, skinRandom } from "./effects.ts";
import { createDefaultPinballBiome, drawBiomeOrnament, drawThemeAtmosphere, drawThemeFloor, PINBALL_THEME_PALETTES, ReactiveFoliage } from "./themes.ts";
import type { ThemePalette } from "./themes.ts";
import { ditherRgba, renderPixelRatio } from "./styles.ts";
import type { HitPosition } from "./effects.ts";
import type {
  PinballView, PinballViewBall, PinballViewBumper, PinballViewEvent, PinballViewFlipper,
  PinballViewFlipperFrame, PinballViewFrame, PinballViewIndicator, PinballViewMap,
  PinballViewOptions, PinballViewSegment, PinballViewSnapshot, PinballViewStyle,
} from "./types.ts";

export const NIGHTSHIFT_PALETTE = Object.freeze({
  floor: "#0A1420", chassis: "#17263A", steel: "#667D90", rail: "#B2CAD8",
  chrome: "#EAF5F7", emerald: "#47D8AD", brass: "#EAB66C", warning: "#F47B52",
});

type Context = CanvasRenderingContext2D;
interface Surface { readonly canvas: HTMLCanvasElement; readonly ctx: Context }
interface LayerSurface extends Surface { readonly layer: number }
interface TrailPoint { x: number; y: number }
interface Trail { readonly points: TrailPoint[]; layer: number; tick: number }
interface Fit { scale: number; x: number; y: number }
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const MAX_TRAIL_BALLS = 16;
const MAX_TRAIL_POINTS = 6;

function finite(value: number, fallback: number): number { return Number.isFinite(value) ? value : fallback; }
function color(kind: HitPosition["kind"], palette: ThemePalette): string { return palette[kind]; }
function layerOf(value: { readonly layer?: number }): number { return finite(value.layer ?? 0, 0); }

function roundRect(ctx: Context, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function line(ctx: Context, ax: number, ay: number, bx: number, by: number, width: number, stroke: string): void {
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
  ctx.lineWidth = width; ctx.strokeStyle = stroke; ctx.lineCap = "round"; ctx.stroke();
}

function circle(ctx: Context, x: number, y: number, radius: number, fill: string | CanvasGradient): void {
  ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, radius), 0, TAU); ctx.fillStyle = fill; ctx.fill();
}

function outlineCircle(ctx: Context, x: number, y: number, radius: number, width: number, stroke: string): void {
  ctx.beginPath(); ctx.arc(x, y, Math.max(0.1, radius), 0, TAU); ctx.lineWidth = width; ctx.strokeStyle = stroke; ctx.stroke();
}

function font(ctx: Context, size: number, weight = 600, mono = false): void {
  ctx.font = `${weight} ${size}px ${mono ? '"SFMono-Regular", Consolas, "Liberation Mono", monospace' : '"Arial", "Helvetica", sans-serif'}`;
}

function ellipsis(ctx: Context, text: string, maximumWidth: number): string {
  if (ctx.measureText(text).width <= maximumWidth) return text;
  const ending = "…";
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const middle = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, middle).trimEnd() + ending).width <= maximumWidth) lo = middle;
    else hi = middle - 1;
  }
  return text.slice(0, lo).trimEnd() + ending;
}

function drawRail(ctx: Context, rail: PinballViewSegment, raised: boolean, palette: ThemePalette, style: PinballViewStyle): void {
  // Every rail face is centred on the supplied physics segment, never on a recipe path.
  const depth = raised ? 4 : 2.8;
  const bank = /target-bank/.test(rail.id), orbit = /orbit-/.test(rail.id);
  line(ctx, rail.ax, rail.ay + depth, rail.bx, rail.by + depth, orbit ? 7 : 6, "#02080E");
  line(ctx, rail.ax, rail.ay + 1.2, rail.bx, rail.by + 1.2, orbit ? 5.2 : 4.5, "#304050");
  if (style === "cartoon") line(ctx, rail.ax, rail.ay, rail.bx, rail.by, 6, "#030C16");
  if (style === "arcade") { ctx.shadowColor = palette.emerald; ctx.shadowBlur = 3; }
  line(ctx, rail.ax, rail.ay, rail.bx, rail.by, orbit ? 4.3 : 3.8, raised || bank ? palette.brass : palette.steel);
  line(ctx, rail.ax, rail.ay - 0.7, rail.bx, rail.by - 0.7, style === "cartoon" ? 1.8 : 1.3, raised || bank ? palette.brass : palette.rail);
  ctx.shadowBlur = 0;
  const dx = rail.bx - rail.ax, dy = rail.by - rail.ay;
  if (Math.hypot(dx, dy) > 35) {
    const nx = -dy / Math.hypot(dx, dy), ny = dx / Math.hypot(dx, dy);
    for (const t of [0.12, 0.88]) {
      const x = rail.ax + dx * t, y = rail.ay + dy * t;
      line(ctx, x - nx * 1.4, y - ny * 1.4, x + nx * 1.4, y + ny * 1.4, 0.7, "#364350");
    }
  }
}

function drawTarget(ctx: Context, bumper: PinballViewBumper, palette: ThemePalette, style: PinballViewStyle): void {
  const { x, y, radius: r } = bumper, kicker = /^kicker-/.test(bumper.id);
  const tint = kicker ? palette.emerald : palette.brass;
  circle(ctx, x + 1, y + 2.5, r, "#020B13");
  const body = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  body.addColorStop(0, palette.rail); body.addColorStop(0.18, tint); body.addColorStop(0.65, palette.steel); body.addColorStop(1, "#172733");
  circle(ctx, x, y, r, style === "cartoon" ? tint : body);
  outlineCircle(ctx, x, y, r - 0.5, 1, style === "cartoon" ? "#030B12" : palette.rail);
  circle(ctx, x, y, r * 0.68, palette.floor);
  if (style === "arcade") { ctx.shadowColor = tint; ctx.shadowBlur = 4; }
  outlineCircle(ctx, x, y, r * 0.71, 1.3, tint); ctx.shadowBlur = 0;
  if (kicker) {
    // Upward engraved arrows describe the kick face; their capsule stays circular.
    for (const offset of [-2.1, 2.1]) {
      ctx.beginPath(); ctx.moveTo(x - r * 0.28, y + offset + r * 0.10);
      ctx.lineTo(x, y + offset - r * 0.18); ctx.lineTo(x + r * 0.28, y + offset + r * 0.10);
      ctx.strokeStyle = tint; ctx.lineWidth = 1.3; ctx.stroke();
    }
  } else {
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; font(ctx, r * 0.83, 800, true);
    ctx.fillStyle = tint; ctx.fillText(bumper.id.match(/(\d+)$/)?.[1] ?? "◆", x, y + 0.8);
  }
  line(ctx, x - r * 0.45, y - r * 0.65, x + r * 0.1, y - r * 0.77, 0.9, palette.rail);
}

function drawBumper(ctx: Context, bumper: PinballViewBumper, seed: number, palette: ThemePalette, style: PinballViewStyle): void {
  if (/^(target-bank-|kicker-)/.test(bumper.id)) { drawTarget(ctx, bumper, palette, style); return; }
  const { x, y, radius: r } = bumper;
  // Contact face radius is exactly canonical. The dark skirt only describes depth.
  circle(ctx, x + 1.2, y + 3.2, r, "#01070D");
  const body = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  body.addColorStop(0, "#80969D"); body.addColorStop(0.25, "#1D3743"); body.addColorStop(1, "#0B1924");
  circle(ctx, x, y, r, style === "cartoon" ? palette.steel : body);
  outlineCircle(ctx, x, y, Math.max(1, r - 1), 1.3, "#81A2A8");
  const cap = ctx.createRadialGradient(x - r * 0.22, y - r * 0.35, 0, x, y, r * 0.76);
  cap.addColorStop(0, "#1E6D63"); cap.addColorStop(0.62, "#154B46"); cap.addColorStop(1, "#091D26");
  circle(ctx, x, y, r * 0.79, style === "cartoon" ? palette.chassis : cap);
  outlineCircle(ctx, x, y, r * 0.85, 0.8, palette.brass);
  if (style === "arcade") { ctx.shadowColor = palette.emerald; ctx.shadowBlur = 7; }
  outlineCircle(ctx, x, y, r * 0.72, style === "cartoon" ? 2.5 : 1.7, palette.emerald);
  ctx.shadowBlur = 0;
  if (style === "cartoon") outlineCircle(ctx, x, y, r, 1.8, "#030D15");
  outlineCircle(ctx, x, y, r * 0.55, 0.75, "#2E9D83");
  const phase = (hashSkin(bumper.id) ^ seed) % 100 / 100 * TAU;
  ctx.strokeStyle = "#67D5B1"; ctx.lineWidth = 0.9;
  for (let i = 0; i < 8; i++) {
    const angle = phase + i * TAU / 8;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    line(ctx, x + cosine * r * 0.83, y + sine * r * 0.83, x + cosine * r * 0.94, y + sine * r * 0.94, 0.8, "#8AA7A7");
  }
  circle(ctx, x, y, r * 0.37, "#122832");
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; font(ctx, r * 0.46, 800);
  ctx.fillStyle = "#A5C4B9"; ctx.fillText(/coil-[abc]$/i.test(bumper.id) ? bumper.id.slice(-1).toUpperCase() : "◆", x, y + 0.8);
  line(ctx, x - r * 0.37, y - r * 0.54, x + r * 0.1, y - r * 0.63, 1, "#A3ECD2");
}

function drawPlayfieldPrint(ctx: Context, map: PinballViewMap, palette: ThemePalette, theme: PinballViewOptions["theme"]): void {
  // Flat, low-contrast screen printing is derived from the authored coils and
  // rails. It is cached below all collision faces, flippers, foliage and balls.
  const coils = map.bumpers.filter(b => /^coil-/.test(b.id));
  ctx.save(); ctx.beginPath(); ctx.rect(4, 76, map.width - 8, map.height - 80); ctx.clip();
  if (coils.length > 0) {
    const cx = coils.reduce((sum, b) => sum + b.x, 0) / coils.length;
    const cy = coils.reduce((sum, b) => sum + b.y, 0) / coils.length;
    const extent = Math.min(map.width * 0.28, Math.max(...coils.map(b => Math.hypot(b.x - cx, b.y - cy) + b.radius + 22)));
    ctx.globalAlpha = 0.14; ctx.fillStyle = palette.steel;
    const sides = theme === "nature" ? 9 : theme === "gold" ? 8 : 6;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = -Math.PI / 2 + i * TAU / sides, x = cx + Math.cos(a) * extent, y = cy + Math.sin(a) * extent * 1.14;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.strokeStyle = palette.brass; ctx.lineWidth = 1; ctx.stroke();
    // Interrupted traces look printed, unlike the continuous raised rail faces.
    ctx.globalAlpha = 0.20; ctx.setLineDash([3, 5]);
    for (const b of coils) line(ctx, cx, cy, b.x, b.y, 0.9, palette.emerald);
    ctx.setLineDash([]);
    for (const b of coils) {
      outlineCircle(ctx, b.x, b.y, b.radius + 10, 0.65, palette.steel);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4;
        circle(ctx, b.x + Math.cos(a) * (b.radius + 16), b.y + Math.sin(a) * (b.radius + 16), 1.7, palette.brass);
      }
    }
    const badgeY = Math.min(map.height * 0.57, cy + extent * 1.35);
    ctx.globalAlpha = 0.12;
    outlineCircle(ctx, cx, badgeY, 40, 1.1, palette.brass);
    outlineCircle(ctx, cx, badgeY, 34, 0.6, palette.emerald);
    for (let i = 0; i < 12; i++) {
      const a = i * TAU / 12;
      line(ctx, cx + Math.cos(a) * 35, badgeY + Math.sin(a) * 35, cx + Math.cos(a) * 39, badgeY + Math.sin(a) * 39, 1, palette.brass);
    }
    ctx.globalAlpha = 0.24; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    font(ctx, 9, 800, true); ctx.fillStyle = palette.brass; ctx.fillText("INDUCTION", cx, badgeY - 5);
    font(ctx, 8, 600, true); ctx.fillText(String(coils.length).padStart(2, "0") + " / TRANSFER", cx, badgeY + 7);
  }
  // Actual return/orbit rails receive flat routing marks on their inner face.
  ctx.globalAlpha = 0.22;
  for (const rail of map.segments) {
    if (!/orbit-|return-inner/.test(rail.id)) continue;
    const dx = rail.bx - rail.ax, dy = rail.by - rail.ay, length = Math.hypot(dx, dy);
    if (length < 25) continue;
    const nx = -dy / length, ny = dx / length;
    const side = (rail.ax + rail.bx) / 2 < map.width / 2 ? -1 : 1;
    for (const t of [0.30, 0.62]) {
      const x = rail.ax + dx * t + nx * 12 * side, y = rail.ay + dy * t + ny * 12 * side;
      line(ctx, x - dx / length * 3 - nx * 3, y - dy / length * 3 - ny * 3, x, y, 1.3, palette.emerald);
      line(ctx, x - dx / length * 3 + nx * 3, y - dy / length * 3 + ny * 3, x, y, 1.3, palette.emerald);
    }
  }
  ctx.restore();
}

/** Printed guardian emblem, behind every real contact face and ball. */
function drawGuardian(ctx: Context, map: PinballViewMap, snapshot: PinballViewSnapshot, palette: ThemePalette, scale: number): void {
  if (snapshot.encounter !== "guardian") return;
  const cx = map.width * 0.50, cy = map.height * 0.58;
  const maximum = Math.max(1, Math.min(100, finite(snapshot.maxBossHealth ?? 1, 1)));
  const health = Math.max(0, Math.min(maximum, finite(snapshot.bossHealth ?? 0, 0)));
  const phase = snapshot.bossPhase ?? 0;
  const tint = snapshot.hazardWarning ? palette.warning : phase === 2 ? palette.brass : palette.emerald;
  ctx.save(); ctx.globalAlpha = health > 0 ? 0.36 : 0.14;
  outlineCircle(ctx, cx, cy, 62, 1.5, tint);
  outlineCircle(ctx, cx, cy, 56, 0.8, palette.steel);
  // Angular face is flat playfield ink: it never stands in for collision geometry.
  ctx.fillStyle = palette.chassis; ctx.strokeStyle = tint; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - 28, cy - 32); ctx.lineTo(cx + 28, cy - 32);
  ctx.lineTo(cx + 36, cy + 6); ctx.lineTo(cx + 18, cy + 31); ctx.lineTo(cx, cy + 42);
  ctx.lineTo(cx - 18, cy + 31); ctx.lineTo(cx - 36, cy + 6); ctx.closePath(); ctx.fill(); ctx.stroke();
  for (const side of [-1, 1]) {
    line(ctx, cx + side * 12, cy - 11, cx + side * 26, cy - 18, 3, tint);
    line(ctx, cx + side * 9, cy + 17, cx + side * 22, cy + 12, 2, palette.brass);
    line(ctx, cx + side * 23, cy - 32, cx + side * 39, cy - 51, 2, tint);
  }
  line(ctx, cx, cy - 13, cx - 5, cy + 4, 1.5, tint);
  line(ctx, cx - 5, cy + 4, cx + 5, cy + 4, 1.5, tint);
  ctx.globalAlpha = 0.85; font(ctx, Math.max(10, 9 / Math.max(0.1, scale)), 800, true); ctx.textAlign = "center"; ctx.fillStyle = tint;
  ctx.fillText(health > 0 ? (scale < 0.35 ? "PHASE " + phase : "GUARDIAN / PHASE " + phase) : (scale < 0.35 ? "DEFEATED" : "GUARDIAN DEFEATED"), cx, cy + 77);
  const barWidth = 120; ctx.fillStyle = palette.chassis; ctx.fillRect(cx - barWidth / 2, cy + 84, barWidth, 4);
  ctx.fillStyle = tint; ctx.fillRect(cx - barWidth / 2, cy + 84, barWidth * health / maximum, 4);
  if (snapshot.hazardWarning && health > 0) {
    // Warning tracks the canonical countdown; no presentation clock decides when a strike occurs.
    ctx.globalAlpha = 0.16 + (Math.floor(snapshot.hazardCountdown ?? 0) % 16 < 8 ? 0.08 : 0);
    for (const x of [map.width * 0.31, map.width * 0.69]) for (const y of [map.height * 0.68, map.height * 0.73, map.height * 0.78]) {
      line(ctx, x - 9, y - 6, x, y + 3, 3, palette.warning); line(ctx, x, y + 3, x + 9, y - 6, 3, palette.warning);
    }
  }
  ctx.restore();
}

function drawFlipper(ctx: Context, spec: PinballViewFlipper, current: PinballViewFlipperFrame | undefined, palette: ThemePalette, style: PinballViewStyle): void {
  const pivotX = current?.pivotX ?? spec.pivotX, pivotY = current?.pivotY ?? spec.pivotY;
  const angle = (current?.angle ?? spec.restAngle) * DEG;
  const tipX = current?.tipX ?? pivotX + Math.cos(angle) * spec.length;
  const tipY = current?.tipY ?? pivotY + Math.sin(angle) * spec.length;
  const r = current?.radius ?? spec.radius;
  if (style === "cartoon") {
    line(ctx, pivotX, pivotY, tipX, tipY, r * 2 + 2, "#020B12");
    line(ctx, pivotX, pivotY, tipX, tipY, r * 2, palette.brass);
    line(ctx, pivotX, pivotY - r * 0.35, tipX, tipY - r * 0.35, Math.max(1, r * 0.3), "#FCF1D2");
    circle(ctx, pivotX, pivotY, r * 0.58, palette.steel); circle(ctx, pivotX, pivotY, r * 0.25, palette.rail); return;
  }
  line(ctx, pivotX + 1, pivotY + 3, tipX + 1, tipY + 3, r * 2 + 1, "#01070C");
  const face = ctx.createLinearGradient(pivotX, pivotY - r, pivotX, pivotY + r);
  face.addColorStop(0, "#D8E6DC"); face.addColorStop(0.18, "#EEE1B9"); face.addColorStop(0.54, "#BD9764"); face.addColorStop(1, "#684D35");
  ctx.beginPath(); ctx.moveTo(pivotX, pivotY); ctx.lineTo(tipX, tipY);
  ctx.lineCap = "round"; ctx.lineWidth = r * 2; ctx.strokeStyle = face; ctx.stroke();
  line(ctx, pivotX, pivotY, tipX, tipY, Math.max(1.1, r * 0.46), "#31414B");
  const nx = -Math.sin(angle), ny = Math.cos(angle);
  line(ctx, pivotX - nx * r * 0.52, pivotY - ny * r * 0.52, tipX - nx * r * 0.52, tipY - ny * r * 0.52, Math.max(0.7, r * 0.18), "#F2D09B");
  circle(ctx, pivotX, pivotY, r * 0.62, "#59727A");
  circle(ctx, pivotX, pivotY, r * 0.36, "#D2E2DF");
  line(ctx, pivotX - r * 0.17, pivotY, pivotX + r * 0.17, pivotY, 0.75, "#425A62");
}

function drawBall(ctx: Context, ball: PinballViewBall, defaultRadius: number, scale: number, finish: PinballViewOptions["finish"], palette: ThemePalette, style: PinballViewStyle): void {
  const r = Math.max(0.6, ball.radius ?? defaultRadius);
  circle(ctx, ball.x + r * 0.18, ball.y + r * 0.60, r * 1.05, "rgba(0,0,0,.72)");
  const metal = ctx.createRadialGradient(ball.x - r * 0.34, ball.y - r * 0.40, 0.1, ball.x, ball.y, r);
  const stops = finish === "gold"
    ? ["#FFFFFF", "#FFF4CF", "#EED09A", "#906438", "#D8A75F", "#58412D", "#25232A"]
    : finish === "jade"
      ? ["#FFFFFF", "#D7FFEA", "#9AD7C0", "#326D63", "#6EB8A1", "#163E3C", "#0C242A"]
      : ["#FFFFFF", NIGHTSHIFT_PALETTE.chrome, "#B5CDD3", "#45646F", "#87AFB9", "#1E3E4C", "#0E202E"];
  for (const [index, stop] of [0, 0.12, 0.38, 0.58, 0.70, 0.91, 1].entries()) metal.addColorStop(stop, stops[index] ?? NIGHTSHIFT_PALETTE.chrome);
  circle(ctx, ball.x, ball.y, r, style === "cartoon" ? finish === "gold" ? "#F6D18D" : finish === "jade" ? "#A5EAD0" : "#DAF4ED" : metal);
  outlineCircle(ctx, ball.x, ball.y, r, Math.max(0.55, 0.75 / scale), "#E3F5F2");
  if (style === "cartoon") outlineCircle(ctx, ball.x, ball.y, r, 1.1, "#15393A");
  circle(ctx, ball.x - r * 0.28, ball.y - r * 0.36, Math.max(0.6, r * 0.18), "#FFFFFF");
  if (ball.ownerId !== undefined) {
    const tint = hashSkin(ball.ownerId) % 2 === 0 ? palette.emerald : palette.brass;
    ctx.globalAlpha = 0.72;
    ctx.beginPath(); ctx.arc(ball.x, ball.y, r * 0.76, 0.1, Math.PI * 0.74); ctx.lineWidth = Math.max(0.5, r * 0.13); ctx.strokeStyle = tint; ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawIndicator(ctx: Context, indicator: PinballViewIndicator, scale: number, palette: ThemePalette): void {
  const tint = palette[indicator.kind ?? "brass"];
  const active = indicator.active ?? false;
  ctx.save();
  ctx.globalAlpha = active ? 0.90 : 0.40;
  // Flat inset lozenge, visibly distinct from rails/bumper collision faces.
  ctx.beginPath(); ctx.moveTo(indicator.x, indicator.y - 3.6); ctx.lineTo(indicator.x + 3.6, indicator.y); ctx.lineTo(indicator.x, indicator.y + 3.6); ctx.lineTo(indicator.x - 3.6, indicator.y); ctx.closePath();
  ctx.fillStyle = active ? tint : "#273541"; ctx.fill(); ctx.strokeStyle = tint; ctx.lineWidth = 0.55; ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "top"; font(ctx, Math.max(6.8, 9 / scale), 700);
  ctx.fillStyle = tint; ctx.fillText(indicator.label.toUpperCase(), indicator.x, indicator.y + 6);
  if (indicator.value !== undefined) {
    font(ctx, Math.max(7.3, 10 / scale), 600, true);
    ctx.fillStyle = "#9BAEB8"; ctx.fillText(String(indicator.value), indicator.x, indicator.y + 16);
  }
  ctx.restore();
}

function drawBackground(ctx: Context, map: PinballViewMap, seed: number, palette: ThemePalette): void {
  const w = map.width, h = map.height;
  ctx.save();
  const chassis = ctx.createLinearGradient(0, 0, w, h);
  chassis.addColorStop(0, palette.steel); chassis.addColorStop(0.36, palette.chassis); chassis.addColorStop(1, palette.ambient);
  roundRect(ctx, -4, -4, w + 8, h + 8, 15); ctx.fillStyle = chassis; ctx.fill();
  ctx.strokeStyle = "#3B4D5F"; ctx.lineWidth = 1; ctx.stroke();
  const floor = ctx.createLinearGradient(0, 0, w, h);
  floor.addColorStop(0, palette.chassis); floor.addColorStop(0.36, palette.floor); floor.addColorStop(0.75, palette.floor); floor.addColorStop(1, palette.ambient);
  roundRect(ctx, 2, 2, w - 4, h - 4, 12); ctx.fillStyle = floor; ctx.fill();
  ctx.clip();
  // Deterministic subdued floor hatchwork. It never changes gameplay geometry.
  ctx.globalAlpha = 0.11;
  for (let y = 0; y < h; y += 24) line(ctx, 0, y, w, y - w * 0.25, 0.45, "#708CA3");
  ctx.globalAlpha = 0.17;
  const random = skinRandom(seed);
  for (let i = 0; i < 7; i++) {
    const x = w * (0.18 + random() * 0.65), y = h * (0.21 + random() * 0.50);
    const r = w * (0.10 + random() * 0.13);
    ctx.beginPath(); ctx.arc(x, y, r, 0.15, Math.PI * 1.35);
    ctx.strokeStyle = "#2B7167"; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r + 4, 0.45, Math.PI * 1.05);
    ctx.strokeStyle = "#57737E"; ctx.lineWidth = 0.5; ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const wash = ctx.createRadialGradient(w * 0.50, h * 0.36, w * 0.05, w * 0.50, h * 0.36, w * 0.7);
  wash.addColorStop(0, "rgba(40,116,100,.09)"); wash.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = wash; ctx.fillRect(0, 0, w, h);
  // The drain label is etched into the actual drain area, with no decorative rail.
  if (map.drainY !== undefined) {
    ctx.globalAlpha = 0.30; ctx.textAlign = "center"; ctx.textBaseline = "middle"; font(ctx, 7.5, 600);
    ctx.fillStyle = "#8B7982"; ctx.fillText("RETURN TO FOUNDRY", w / 2, Math.min(h - 11, map.drainY + 13)); ctx.globalAlpha = 1;
  }
  ctx.restore();
  // Corner cabinet screws belong to the chassis, outside the playable surface.
  for (const [x, y] of [[6, 6], [w - 6, 6], [6, h - 6], [w - 6, h - 6]]) {
    if (x === undefined || y === undefined) continue;
    circle(ctx, x, y, 2.1, "#485B6B");
    line(ctx, x - 1, y + 0.6, x + 1, y - 0.6, 0.6, "#102332");
  }
}

function scoreBox(map: PinballViewMap): { x: number; y: number; width: number; height: number } {
  return map.presentation?.scoreDisplay ?? { x: 16, y: 8, width: map.width - 32, height: Math.min(57, map.height * 0.10) };
}

function drawScore(ctx: Context, map: PinballViewMap, snapshot: PinballViewSnapshot, options: PinballViewOptions, scale: number): void {
  const box = scoreBox(map), { x, y, width: w, height: h } = box;
  if (w <= 0 || h <= 0) return;
  ctx.save();
  const metal = ctx.createLinearGradient(x, y, x, y + h);
  metal.addColorStop(0, "#1C3041"); metal.addColorStop(0.18, "#101F2E"); metal.addColorStop(1, "#07121D");
  roundRect(ctx, x, y, w, h, 3); ctx.fillStyle = metal; ctx.fill();
  ctx.strokeStyle = "#3A5160"; ctx.lineWidth = 0.75; ctx.stroke();
  line(ctx, x + 8, y, x + w - 8, y, 0.9, "#759894");
  const pad = 9;
  const compact = h * scale < 52;
  const title = options.title ?? map.presentation?.title ?? "EMBERLINE";
  const subtitle = options.subtitle ?? map.presentation?.subtitle ?? "NIGHTSHIFT";
  const ball = snapshot.ballNumber ?? 1, remaining = snapshot.ballsRemaining ?? 3;
  const phase = snapshot.phase ?? "ready";
  const score = Math.max(0, Math.floor(snapshot.score ?? 0)).toLocaleString("en-US");
  const objective = snapshot.objective ?? (phase === "gameover" ? "Restart to begin a new shift" : "HIT THE THREE COILS");
  if (compact) {
    // Use two rows only when their minimum CSS sizes fit the existing cabinet.
    // A short landscape viewport keeps score/credits in one centred row.
    const cssHeight = h * scale;
    const showObjective = cssHeight >= 26;
    const small = cssHeight < 30;
    const rowY = showObjective ? y + (small ? 8 : 11) / scale : y + h / 2;
    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    font(ctx, (small ? 12.5 : 16) / scale, 700, true); ctx.fillStyle = NIGHTSHIFT_PALETTE.chrome;
    ctx.fillText(ellipsis(ctx, score, w * 0.52), x + pad, rowY);
    ctx.textAlign = "right"; font(ctx, 8.5 / scale, 600, true); ctx.fillStyle = "#A5C2B8";
    const credit = snapshot.statusLabel ?? (phase === "gameover" ? "SHIFT COMPLETE" : `BALL ${ball}/3${snapshot.multiplier && snapshot.multiplier > 1 ? `  ×${snapshot.multiplier}` : ""}`);
    ctx.fillText(ellipsis(ctx, credit, w * 0.42), x + w - pad, rowY);
    if (showObjective) {
      ctx.textAlign = "center"; font(ctx, 9 / scale, 600); ctx.fillStyle = "#B8CDC7";
      ctx.fillText(ellipsis(ctx, objective, w - pad * 2), x + w / 2, y + h - 5.5 / scale);
    }
    ctx.restore(); return;
  }
  ctx.textAlign = "left"; ctx.textBaseline = "top";
  font(ctx, compact ? 12.5 / scale : Math.max(18, 14 / scale), 800);
  ctx.fillStyle = NIGHTSHIFT_PALETTE.brass;
  ctx.fillText(title.toUpperCase(), x + pad, y + (compact ? 2 / scale : 7), w * 0.48);
  if (!compact) {
    font(ctx, Math.max(6.5, 8 / scale), 700);
    ctx.fillStyle = "#739098"; ctx.fillText(subtitle.toUpperCase(), x + pad, y + 27, w * 0.40);
  }
  ctx.textAlign = "right"; font(ctx, compact ? 16 / scale : Math.max(24, 18 / scale), 600, true);
  ctx.fillStyle = NIGHTSHIFT_PALETTE.chrome;
  ctx.fillText(score, x + w - pad, y + 6, w * 0.44);
  font(ctx, Math.max(6.5, 8 / scale), 600, true); ctx.fillStyle = "#85ADA4";
  const suffix = phase === "gameover" ? "SHIFT COMPLETE" : phase === "ready" ? "READY" : snapshot.multiplier && snapshot.multiplier > 1 ? `×${snapshot.multiplier}` : "IN PLAY";
  if (compact) ctx.textAlign = "center";
  ctx.fillText(ellipsis(ctx, snapshot.statusLabel ?? `BALL ${String(ball).padStart(2, "0")}  ·  ${remaining} LEFT  ·  ${suffix}`, w * 0.57), x + w - pad, y + 29);
  if (!compact) line(ctx, x + pad, y + h - 17, x + w - pad, y + h - 17, 0.5, "#2E4654");
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; font(ctx, Math.max(7.1, 9 / scale), 600);
  ctx.fillStyle = "#AFBDBE"; ctx.fillText(ellipsis(ctx, objective, w - pad * 2), x + w / 2, y + h - 8);
  ctx.restore();
}

/**
 * Optional view only: no animation loop, physics, controls, listeners, or game rules.
 * Supply fresh simulation frames; all ball trails consist solely of supplied positions.
 */
export function createPinballView(canvas: HTMLCanvasElement, options: PinballViewOptions = {}): PinballView {
  const context = canvas.getContext("2d", { alpha: false });
  if (context === null) throw new Error("Pinball view needs a Canvas2D context.");
  const displayCtx: Context = context;
  const style = options.style ?? "realistic";
  const theme = options.theme ?? options.biome?.theme ?? "nightshift";
  const biomePalette = options.biome?.palette;
  const palette: ThemePalette = biomePalette === undefined ? PINBALL_THEME_PALETTES[theme] : {
    floor: biomePalette.floor, chassis: biomePalette.raised, steel: biomePalette.steel, rail: biomePalette.rail,
    emerald: biomePalette.accent, brass: biomePalette.brass, warning: biomePalette.warning, ambient: PINBALL_THEME_PALETTES[theme].ambient,
  };
  const density = options.visualDensity ?? "medium";
  const rasterCanvas = style === "pixel" || style === "dither" ? canvas.ownerDocument.createElement("canvas") : canvas;
  const rasterContext = rasterCanvas === canvas ? context : rasterCanvas.getContext("2d", { alpha: false, willReadFrequently: style === "dither" });
  if (rasterContext === null) throw new Error("Pinball view could not allocate its style buffer.");
  const ctx: Context = rasterContext;
  const seed = hashSkin(options.skinSeed ?? "NIGHTSHIFT");
  const reducedMotion = options.reducedMotion ?? false;
  const effects = new PinballEffects(options.maxParticles ?? (density === "low" ? 24 : density === "high" ? 128 : 64), reducedMotion);
  const trails = new Map<string, Trail>();
  const flipperFrames = new Map<string, PinballViewFlipperFrame>();
  const hitLocations = new Map<string, HitPosition>();
  let width = 1, height = 1, ratio = 1, displayRatio = 1, fit: Fit = { x: 0, y: 0, scale: 1 };
  let foliage: ReactiveFoliage | undefined;
  let background: Surface | undefined;
  let surfaces: LayerSurface[] = [];
  let cachedMap: PinballViewMap | undefined;
  let cachedRevision: string | number | undefined;
  let previousTime: number | undefined;
  let previousTick: number | undefined;
  let previousPaintTime: number | undefined;
  let disposed = false;

  function assertLive(): void { if (disposed) throw new Error("Pinball view has been disposed."); }
  function transform(target: Context): void {
    target.setTransform(ratio * fit.scale, 0, 0, ratio * fit.scale, ratio * fit.x, ratio * fit.y);
  }
  function surface(): Surface {
    const backing = canvas.ownerDocument.createElement("canvas");
    backing.width = rasterCanvas.width; backing.height = rasterCanvas.height;
    const drawing = backing.getContext("2d");
    if (drawing === null) throw new Error("Pinball view could not allocate its table cache.");
    transform(drawing); return { canvas: backing, ctx: drawing };
  }
  function releaseCaches(): void {
    if (background !== undefined) { background.canvas.width = 1; background.canvas.height = 1; }
    for (const item of surfaces) { item.canvas.width = 1; item.canvas.height = 1; }
    background = undefined; surfaces = []; cachedMap = undefined; cachedRevision = undefined;
  }
  function resetEffects(): void {
    effects.clear(); trails.clear(); foliage?.reset(); previousTime = undefined; previousTick = undefined; previousPaintTime = undefined;
  }
  function resize(newWidth: number, newHeight: number, pixelRatio = globalThis.devicePixelRatio ?? 1): void {
    assertLive();
    const nextWidth = Math.max(1, finite(newWidth, 1)), nextHeight = Math.max(1, finite(newHeight, 1));
    const maxRatio = Math.max(1, Math.min(3, finite(options.maxPixelRatio ?? 2, 2)));
    const nextDisplayRatio = Math.min(maxRatio, Math.max(1, finite(pixelRatio, 1)), 2048 / Math.max(nextWidth, nextHeight));
    const nextRatio = renderPixelRatio(style, nextWidth, nextHeight, nextDisplayRatio);
    if (width === nextWidth && height === nextHeight && ratio === nextRatio && displayRatio === nextDisplayRatio && canvas.width > 1) return;
    width = nextWidth; height = nextHeight; ratio = nextRatio; displayRatio = nextDisplayRatio;
    canvas.width = Math.max(1, Math.round(width * displayRatio)); canvas.height = Math.max(1, Math.round(height * displayRatio));
    if (rasterCanvas !== canvas) { rasterCanvas.width = Math.max(1, Math.floor(width * ratio)); rasterCanvas.height = Math.max(1, Math.floor(height * ratio)); }
    // The embedding game owns CSS layout. resize only changes the drawing buffer.
    releaseCaches(); previousPaintTime = undefined;
  }
  function cache(map: PinballViewMap): void {
    if (!(map.width > 0 && map.height > 0)) throw new Error("Pinball table dimensions must be positive.");
    const replacingTable = cachedMap !== undefined && cachedMap !== map;
    releaseCaches();
    if (replacingTable) resetEffects();
    const margin = Math.min(10, Math.min(width, height) * 0.02);
    fit.scale = Math.max(0.001, Math.min((width - margin * 2) / map.width, (height - margin * 2) / map.height));
    fit.x = (width - map.width * fit.scale) / 2; fit.y = (height - map.height * fit.scale) / 2;
    background = surface();
    drawThemeAtmosphere(background.ctx, map, { x: -fit.x / fit.scale, y: -fit.y / fit.scale, width: width / fit.scale, height: height / fit.scale }, theme, seed, density, palette);
    drawBackground(background.ctx, map, seed, palette); drawThemeFloor(background.ctx, map, theme, palette, density);
    drawPlayfieldPrint(background.ctx, map, palette, theme);
    const biome = options.biome ?? createDefaultPinballBiome(theme, options.skinSeed ?? "NIGHTSHIFT", map.width, map.height, density);
    const ornamentCap = density === "low" ? 20 : density === "high" ? 96 : 48;
    for (const ornament of biome.ornaments.slice(0, ornamentCap)) if (ornament.kind !== "leaf") drawBiomeOrnament(background.ctx, ornament, theme, palette);
    foliage = new ReactiveFoliage(biome, density, options.maxLeaves);
    const layers = new Set<number>([0]);
    for (const segment of map.segments) layers.add(layerOf(segment));
    for (const bumper of map.bumpers) layers.add(layerOf(bumper));
    for (const flipper of map.flippers) layers.add(layerOf(flipper));
    if (layers.size > 8) throw new Error("Pinball view supports at most eight authored table layers.");
    surfaces = [...layers].sort((a, b) => a - b).map((layer) => {
      const item = surface();
      for (const segment of map.segments) if (layerOf(segment) === layer) drawRail(item.ctx, segment, layer !== 0, palette, style);
      for (const bumper of map.bumpers) if (layerOf(bumper) === layer) drawBumper(item.ctx, bumper, seed, palette, style);
      return { ...item, layer };
    });
    hitLocations.clear();
    for (const bumper of map.bumpers) hitLocations.set(bumper.id, { x: bumper.x, y: bumper.y, layer: layerOf(bumper), kind: /^target-bank-/.test(bumper.id) ? "brass" : "emerald" });
    for (const segment of map.segments) hitLocations.set(segment.id, { x: (segment.ax + segment.bx) / 2, y: (segment.ay + segment.by) / 2, layer: layerOf(segment), kind: /target|lock|jackpot/i.test(segment.id) ? "brass" : "emerald" });
    for (const flipper of map.flippers) hitLocations.set(flipper.id, { x: flipper.pivotX, y: flipper.pivotY, layer: layerOf(flipper), kind: "brass" });
    cachedMap = map; cachedRevision = map.viewRevision;
  }
  function locate(event: PinballViewEvent): HitPosition | undefined {
    const fromCollider = event.colliderId === undefined ? undefined : hitLocations.get(event.colliderId);
    if (event.x !== undefined && event.y !== undefined && Number.isFinite(event.x) && Number.isFinite(event.y)) {
      return { x: event.x, y: event.y, layer: event.layer ?? fromCollider?.layer ?? 0, kind: fromCollider?.kind ?? "brass" };
    }
    return fromCollider;
  }
  function updateTrails(snapshot: PinballViewSnapshot): void {
    if (reducedMotion) return;
    const alive = new Set<string>();
    for (const ball of snapshot.balls) {
      if (!ball.active) continue;
      alive.add(ball.id);
      let trail = trails.get(ball.id);
      if (trail === undefined) {
        if (trails.size >= MAX_TRAIL_BALLS) continue;
        trail = { points: [], layer: layerOf(ball), tick: -1 }; trails.set(ball.id, trail);
      }
      const point = trail.points[trail.points.length - 1];
      // A layer transfer or respawn never leaves a synthetic line across the table.
      if (trail.layer !== layerOf(ball) || point !== undefined && Math.hypot(point.x - ball.x, point.y - ball.y) > (cachedMap?.width ?? 360) * 0.23) trail.points.length = 0;
      trail.layer = layerOf(ball);
      if (trail.tick !== snapshot.tick) {
        if (trail.points.length >= MAX_TRAIL_POINTS) trail.points.shift();
        trail.points.push({ x: ball.x, y: ball.y }); trail.tick = snapshot.tick;
      }
    }
    for (const id of trails.keys()) if (!alive.has(id)) trails.delete(id);
  }
  function drawTrails(layer: number, map: PinballViewMap): void {
    for (const trail of trails.values()) {
      if (trail.layer !== layer) continue;
      for (let i = 1; i < trail.points.length; i++) {
        const a = trail.points[i - 1], b = trail.points[i];
        if (a === undefined || b === undefined) continue;
        ctx.globalAlpha = 0.10 * i / trail.points.length;
        line(ctx, a.x, a.y, b.x, b.y, Math.max(0.7, map.ballRadius * 0.55 * i / trail.points.length), "#9DD6CD");
      }
    }
    ctx.globalAlpha = 1;
  }
  function drawEffects(layer: number): void {
    for (const pulse of effects.pulses) {
      if (pulse.layer !== layer) continue;
      const alpha = pulse.life / pulse.totalLife;
      ctx.globalAlpha = alpha * 0.55;
      const radius = reducedMotion ? 3.5 : 3.5 + (1 - alpha) * 7;
      outlineCircle(ctx, pulse.x, pulse.y, radius, 0.8, color(pulse.kind, palette));
    }
    for (const particle of effects.particles) {
      if (particle.layer !== layer) continue;
      ctx.globalAlpha = particle.life / particle.totalLife * 0.78;
      circle(ctx, particle.x, particle.y, particle.size, color(particle.kind, palette));
    }
    ctx.globalAlpha = 1;
  }
  function render(map: PinballViewMap, snapshot: PinballViewSnapshot, frame: PinballViewFrame): void {
    assertLive();
    if (cachedMap !== map || cachedRevision !== map.viewRevision || background === undefined) cache(map);
    if (previousTick !== undefined && snapshot.tick < previousTick) resetEffects();
    const delta = frame.deltaMs ?? (previousTime === undefined ? 0 : frame.timeMs - previousTime);
    effects.advance(finite(delta, 0), locate, seed);
    previousTime = frame.timeMs; previousTick = snapshot.tick;
    updateTrails(snapshot);
    foliage?.advance(snapshot, frame.timeMs, finite(delta, 0), reducedMotion);
    // CPU quantization is a 30Hz presentation pass; simulation ownership remains outside this module.
    if (style === "dither" && previousPaintTime !== undefined && frame.timeMs >= previousPaintTime && frame.timeMs - previousPaintTime < 1000 / 30) return;
    previousPaintTime = frame.timeMs;
    flipperFrames.clear(); for (const flipper of snapshot.flippers) flipperFrames.set(flipper.id, flipper);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    ctx.fillStyle = palette.ambient; ctx.fillRect(0, 0, rasterCanvas.width, rasterCanvas.height);
    if (background !== undefined) ctx.drawImage(background.canvas, 0, 0);
    transform(ctx); foliage?.draw(ctx); drawGuardian(ctx, map, snapshot, palette, fit.scale);
    const layers = new Set(surfaces.map((item) => item.layer));
    for (const ball of snapshot.balls) if (ball.active || snapshot.phase === "ready") layers.add(layerOf(ball));
    for (const particle of effects.particles) layers.add(particle.layer);
    for (const pulse of effects.pulses) layers.add(pulse.layer);
    for (const layer of [...layers].sort((a, b) => a - b)) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const image = surfaces.find((item) => item.layer === layer);
      if (image !== undefined) ctx.drawImage(image.canvas, 0, 0);
      transform(ctx);
      for (const indicator of map.presentation?.indicators ?? []) if (layerOf(indicator) === layer) drawIndicator(ctx, snapshot.activeIndicatorIds?.includes(indicator.id) ? { ...indicator, active: true } : indicator, fit.scale, palette);
      for (const indicator of snapshot.indicators ?? []) if (layerOf(indicator) === layer) drawIndicator(ctx, snapshot.activeIndicatorIds?.includes(indicator.id) ? { ...indicator, active: true } : indicator, fit.scale, palette);
      for (const bumper of map.bumpers) {
        if (layerOf(bumper) !== layer || !snapshot.activeIndicatorIds?.includes(bumper.id)) continue;
        const tint = /^target-bank-/.test(bumper.id) ? palette.brass : palette.emerald;
        ctx.save(); ctx.globalAlpha = 0.85;
        outlineCircle(ctx, bumper.x, bumper.y, bumper.radius * 0.72, 2, tint);
        ctx.restore();
      }
      // Coil feedback illuminates the supplied contact face, with no geometry substitution.
      for (const pulse of effects.pulses) {
        if (pulse.layer !== layer || pulse.colliderId === undefined) continue;
        const bumper = map.bumpers.find((item) => item.id === pulse.colliderId);
        if (bumper !== undefined) {
          ctx.globalAlpha = Math.min(0.55, pulse.life / pulse.totalLife * 0.55);
          outlineCircle(ctx, bumper.x, bumper.y, bumper.radius * 0.72, 2.0, "#C6FFE5"); ctx.globalAlpha = 1;
        }
      }
      for (const flipper of map.flippers) if (layerOf(flipper) === layer) drawFlipper(ctx, flipper, flipperFrames.get(flipper.id), palette, style);
      drawTrails(layer, map);
      for (const ball of snapshot.balls) if ((ball.active || snapshot.phase === "ready") && layerOf(ball) === layer) {
        if (style === "arcade") { ctx.shadowColor = palette.emerald; ctx.shadowBlur = 4 * ratio; }
        drawBall(ctx, ball, map.ballRadius, fit.scale, options.finish, palette, style); ctx.shadowBlur = 0;
      }
      drawEffects(layer);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (rasterCanvas !== canvas) {
      if (style === "dither") {
        const pixels = ctx.getImageData(0, 0, rasterCanvas.width, rasterCanvas.height);
        ditherRgba(pixels.data, pixels.width, pixels.height); ctx.putImageData(pixels, 0, 0);
      }
      displayCtx.setTransform(1, 0, 0, 1, 0, 0); displayCtx.imageSmoothingEnabled = false;
      displayCtx.drawImage(rasterCanvas, 0, 0, canvas.width, canvas.height);
    }
    // Text always uses the native backing resolution, inside the same physical backbox.
    displayCtx.setTransform(displayRatio * fit.scale, 0, 0, displayRatio * fit.scale, displayRatio * fit.x, displayRatio * fit.y);
    drawScore(displayCtx, map, snapshot, options, fit.scale);
    displayCtx.setTransform(1, 0, 0, 1, 0, 0);
  }

  resize(canvas.clientWidth || canvas.width || 1, canvas.clientHeight || canvas.height || 1);
  return {
    resize, render,
    ingest(events) { assertLive(); effects.ingest(events); },
    resetEffects,
    getStats() {
      return {
        particles: effects.particles.length, pulses: effects.pulses.length, queuedEvents: effects.queuedEvents,
        rememberedEvents: effects.rememberedEvents, trailBalls: trails.size, cachedLayers: surfaces.length,
        backingPixels: canvas.width * canvas.height,
        renderPixels: rasterCanvas.width * rasterCanvas.height, leaves: foliage?.leaves.length ?? 0, style, theme,
      };
    },
    dispose() { if (disposed) return; resetEffects(); releaseCaches(); hitLocations.clear(); flipperFrames.clear(); foliage = undefined; if (rasterCanvas !== canvas) { rasterCanvas.width = 1; rasterCanvas.height = 1; } disposed = true; },
  };
}
