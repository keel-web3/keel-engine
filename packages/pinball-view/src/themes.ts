import { hashSkin, skinRandom } from "./effects.ts";
import { drawPrintedThemeArt } from "./printed-art.ts";
import type { PinballBiomeOrnament, PinballViewBiome, PinballViewMap, PinballViewSnapshot, PinballViewTheme, PinballVisualDensity } from "./types.ts";

export interface ThemePalette {
  readonly floor: string; readonly chassis: string; readonly steel: string; readonly rail: string;
  readonly emerald: string; readonly brass: string; readonly warning: string; readonly ambient: string;
}

export const PINBALL_THEME_PALETTES: Readonly<Record<PinballViewTheme, ThemePalette>> = Object.freeze({
  nightshift: { floor: "#10212B", chassis: "#213746", steel: "#718E97", rail: "#C1D7D6", emerald: "#63E4BC", brass: "#EDB974", warning: "#FF9162", ambient: "#040A12" },
  cyberpunk: { floor: "#111A2B", chassis: "#322140", steel: "#727DA4", rail: "#D2D9FF", emerald: "#74FFEC", brass: "#FF91D8", warning: "#FFA378", ambient: "#080718" },
  vaporwave: { floor: "#26263E", chassis: "#503954", steel: "#AD8EB1", rail: "#EFE0FA", emerald: "#9AF3E8", brass: "#FFC0DC", warning: "#FFCEAA", ambient: "#130F28" },
  gold: { floor: "#252920", chassis: "#58452B", steel: "#AC9565", rail: "#FFE9B5", emerald: "#D6D396", brass: "#FFD892", warning: "#E39463", ambient: "#11140F" },
  nature: { floor: "#17382E", chassis: "#345843", steel: "#87A996", rail: "#D5E8C0", emerald: "#A8F6BE", brass: "#EBDB9E", warning: "#FFAA83", ambient: "#071B16" },
});

/** Standalone deterministic fallback. A separately loaded biome pack can replace this data. */
export function createDefaultPinballBiome(theme: PinballViewTheme, seed: string | number, width: number, height: number, density: PinballVisualDensity = "medium"): PinballViewBiome {
  const random = skinRandom(hashSkin(`${theme}:${seed}`));
  const count = density === "low" ? 12 : density === "high" ? 48 : 28;
  const ornaments: PinballBiomeOrnament[] = [];
  for (let i = 0; i < count; i++) {
    const left = i % 2 === 0;
    const edgeX = left ? -15 - random() * 45 : width + 15 + random() * 45;
    const y = height * (0.08 + random() * 0.86);
    const phase = random() * Math.PI * 2;
    const common = { id: `${theme}-ornament-${i}`, y, phase, variant: i % 4 };
    if (theme === "nature") {
      const inside = i % 3 === 0;
      ornaments.push({ ...common, kind: "leaf", x: inside ? left ? 52 + random() * 45 : width - 92 + random() * 35 : edgeX, size: 9 + random() * 14, rotation: (left ? -35 + random() * 80 : 130 + random() * 80) * Math.PI / 180 });
      if (i % 4 === 0) ornaments.push({ ...common, id: `${common.id}-frond`, kind: "frond", x: edgeX, size: 40 + random() * 40, rotation: (left ? -25 : 155) * Math.PI / 180 });
    } else if (theme === "cyberpunk") {
      ornaments.push({ ...common, kind: i % 3 === 0 ? "circuit" : "tower", x: edgeX, size: 30 + random() * 55, rotation: 0 });
    } else if (theme === "vaporwave") {
      ornaments.push({ ...common, kind: i % 4 === 0 ? "gem" : "obelisk", x: edgeX, size: 25 + random() * 45, rotation: (random() * 12 - 6) * Math.PI / 180 });
    } else if (theme === "gold") {
      ornaments.push({ ...common, kind: i % 3 === 0 ? "gem" : "obelisk", x: edgeX, size: 25 + random() * 55, rotation: 0 });
    } else {
      ornaments.push({ ...common, kind: i % 4 === 0 ? "grid" : "circuit", x: edgeX, size: 32 + random() * 38, rotation: left ? 0 : Math.PI });
    }
  }
  if (theme === "vaporwave") ornaments.push({ id: "vaporwave-sunset", kind: "sun", x: width / 2, y: -52, size: width * 0.26, phase: 0 });
  return { schema: "keel-pinball-biome@1", theme, seed, ornaments };
}

type Context = CanvasRenderingContext2D;
function stroke(ctx: Context, color: string, width = 1): void { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); }

export function drawThemeAtmosphere(ctx: Context, map: PinballViewMap, bounds: { x: number; y: number; width: number; height: number }, theme: PinballViewTheme, seed: number, density: PinballVisualDensity, palette: ThemePalette = PINBALL_THEME_PALETTES[theme]): void {
  const random = skinRandom(seed ^ hashSkin(theme));
  ctx.save();
  const light = ctx.createRadialGradient(map.width / 2, map.height * 0.38, map.width * 0.08, map.width / 2, map.height * 0.38, Math.max(bounds.width, bounds.height) * 0.62);
  light.addColorStop(0, palette.chassis); light.addColorStop(1, palette.ambient); ctx.fillStyle = light; ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  const count = density === "low" ? 10 : density === "high" ? 42 : 24;
  if (theme === "cyberpunk") {
    for (let i = 0; i < count; i++) {
      const left = i % 2 === 0;
      const x = left ? bounds.x + random() * Math.max(10, -bounds.x - 15) : map.width + 15 + random() * Math.max(10, bounds.width + bounds.x - map.width - 15);
      const y = bounds.y + random() * bounds.height;
      drawBiomeOrnament(ctx, { id: `ambient-tower-${i}`, kind: "tower", x, y, size: 35 + random() * 80, variant: i % 4 }, theme, palette);
    }
  } else if (theme === "vaporwave") {
    ctx.globalAlpha = 0.12;
    const horizon = map.height * 0.50;
    for (let i = -10; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(map.width / 2 + i * 10, horizon); ctx.lineTo(map.width / 2 + i * 150, bounds.y + bounds.height); stroke(ctx, palette.brass, 0.8); }
    for (let i = 0; i < count; i++) { ctx.globalAlpha = 0.18 + random() * 0.12; ctx.fillStyle = palette.rail; const size = random() > 0.85 ? 1.6 : 0.7; ctx.fillRect(bounds.x + random() * bounds.width, bounds.y + random() * bounds.height * 0.5, size, size); }
  } else if (theme === "gold") {
    ctx.globalAlpha = 0.22;
    for (const side of [-1, 1]) {
      const x = side < 0 ? bounds.x + Math.max(18, -bounds.x * 0.5) : map.width + Math.max(18, (bounds.x + bounds.width - map.width) * 0.5);
      ctx.beginPath(); ctx.ellipse(x, map.height * 0.40, Math.max(20, -bounds.x * 0.36), map.height * 0.42, 0, 0, Math.PI * 2); stroke(ctx, palette.brass, 0.9);
      ctx.beginPath(); ctx.ellipse(x, map.height * 0.40, Math.max(16, -bounds.x * 0.30), map.height * 0.36, 0, 0, Math.PI * 2); stroke(ctx, palette.brass, 0.5);
    }
  } else if (theme === "nature") {
    for (let i = 0; i < Math.min(16, count); i++) {
      const left = i % 2 === 0;
      const x = left ? bounds.x + random() * Math.max(10, -bounds.x) : map.width + random() * Math.max(10, bounds.width + bounds.x - map.width);
      drawBiomeOrnament(ctx, { id: `ambient-frond-${i}`, kind: "frond", x, y: map.height * (0.12 + random() * 0.80), size: 55 + random() * 95, rotation: left ? -0.45 : Math.PI - 0.45 }, theme, palette);
    }
  } else {
    // The foundry extends behind the cabinet as a printed steel scaffold. This
    // remains in the cached atmosphere and never produces dynamic machinery.
    ctx.globalAlpha = 0.28;
    for (const side of [-1, 1]) {
      const x = side < 0 ? bounds.x + Math.max(16, -bounds.x * 0.44) : map.width + Math.max(16, (bounds.x + bounds.width - map.width) * 0.44);
      ctx.fillStyle = "#19313B"; ctx.fillRect(x - 12, map.height * 0.10, 24, map.height * 0.78);
      for (let i = 0; i < Math.min(12, count); i++) {
        const y = map.height * (0.13 + i * 0.06);
        ctx.beginPath(); ctx.moveTo(x - 13, y); ctx.lineTo(x + 13, y + map.height * 0.055); ctx.moveTo(x + 13, y); ctx.lineTo(x - 13, y + map.height * 0.055); stroke(ctx, palette.steel, 1.4);
      }
    }
  }
  ctx.restore();
}

function leafShape(ctx: Context, size: number, tint: string): void {
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.bezierCurveTo(size * 0.08, -size * 0.45, size * 0.74, -size * 0.62, size, 0);
  ctx.bezierCurveTo(size * 0.66, size * 0.55, size * 0.17, size * 0.45, 0, 0);
  ctx.fillStyle = tint; ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(size * 0.86, 0); stroke(ctx, "#78B79B", 0.6);
  for (const t of [0.3, 0.5, 0.7]) {
    ctx.beginPath(); ctx.moveTo(size * t, 0); ctx.lineTo(size * (t + 0.08), -size * 0.21); stroke(ctx, "#407B61", 0.45);
  }
}

/** Each cabinet has its own illustrated screen-print grammar, cached below physics. */
export function drawThemeFloor(ctx: Context, map: PinballViewMap, theme: PinballViewTheme, palette: ThemePalette = PINBALL_THEME_PALETTES[theme], density: PinballVisualDensity = "medium"): void {
  drawPrintedThemeArt(ctx, map, theme, palette, density);
}

export function drawBiomeOrnament(ctx: Context, ornament: PinballBiomeOrnament, theme: PinballViewTheme, palette: ThemePalette = PINBALL_THEME_PALETTES[theme]): void {
  const s = Math.max(1, ornament.size);
  ctx.save(); ctx.translate(ornament.x, ornament.y); ctx.rotate(ornament.rotation ?? 0);
  if (ornament.kind === "tower") {
    ctx.globalAlpha = 0.65;
    const gradient = ctx.createLinearGradient(-s / 3, -s * 1.7, s / 3, 0);
    gradient.addColorStop(0, "#223657"); gradient.addColorStop(1, "#070A17");
    ctx.beginPath(); ctx.moveTo(-s * 0.35, 0); ctx.lineTo(-s * 0.35, -s * 1.55); ctx.lineTo(s * 0.16, -s * 1.78); ctx.lineTo(s * 0.35, -s * 1.62); ctx.lineTo(s * 0.35, 0); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill(); stroke(ctx, "#334D71", 0.8);
    ctx.globalAlpha = 0.58;
    for (let row = 0; row < 8; row++) for (let col = 0; col < 3; col++) { if ((row + col + (ornament.variant ?? 0)) % 3 === 0) continue; ctx.fillStyle = (row + col) % 2 ? palette.emerald : palette.brass; ctx.fillRect(-s * 0.23 + col * s * 0.18, -s * 1.5 + row * s * 0.17, s * 0.07, s * 0.05); }
    ctx.beginPath(); ctx.moveTo(s * 0.12, -s * 1.68); ctx.lineTo(s * 0.12, 0); stroke(ctx, palette.emerald, 0.7);
  } else if (ornament.kind === "circuit") {
    if (theme === "nightshift") {
      ctx.globalAlpha = 0.54;
      ctx.fillStyle = "#26424A"; ctx.fillRect(-s * 0.22, -s * 0.62, s * 0.62, s * 0.74);
      ctx.fillStyle = "#112934"; ctx.fillRect(-s * 0.13, -s * 0.52, s * 0.44, s * 0.30);
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-s * 0.10, -s * (0.46 - i * 0.055)); ctx.lineTo(s * 0.27, -s * (0.46 - i * 0.055)); stroke(ctx, "#638D8B", 1.2); }
      ctx.fillStyle = palette.brass; ctx.fillRect(-s * 0.09, -s * 0.10, s * 0.08, s * 0.08);
      ctx.fillStyle = palette.emerald; ctx.fillRect(s * 0.11, -s * 0.10, s * 0.08, s * 0.08);
    }
    ctx.globalAlpha = theme === "nightshift" ? 0.35 : 0.24;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, i * 4); ctx.lineTo(s * 0.6, i * 4); ctx.lineTo(s * 0.9, i * 4 - s * 0.3); ctx.lineTo(s * 1.3, i * 4 - s * 0.3); stroke(ctx, i % 2 ? palette.brass : palette.emerald, 0.7); }
  } else if (ornament.kind === "obelisk") {
    ctx.globalAlpha = theme === "gold" ? 0.50 : 0.48;
    const gradient = ctx.createLinearGradient(-s * 0.3, 0, s * 0.3, 0); gradient.addColorStop(0, theme === "gold" ? "#766041" : "#57406B"); gradient.addColorStop(0.5, theme === "gold" ? "#B49B68" : "#937A9D"); gradient.addColorStop(1, "#292833");
    ctx.beginPath(); ctx.moveTo(-s * 0.30, 0); ctx.lineTo(-s * 0.22, -s * 1.4); ctx.lineTo(0, -s * 1.7); ctx.lineTo(s * 0.22, -s * 1.4); ctx.lineTo(s * 0.30, 0); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -s * 1.6); ctx.lineTo(0, 0); stroke(ctx, palette.brass, 0.8);
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-s * 0.2, -s * (0.2 + i * 0.25)); ctx.lineTo(s * 0.2, -s * (0.2 + i * 0.25)); stroke(ctx, palette.rail, 0.7); }
  } else if (ornament.kind === "gem") {
    ctx.globalAlpha = 0.42;
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.45, -s * 0.35); ctx.lineTo(s * 0.22, s * 0.25); ctx.lineTo(-s * 0.22, s * 0.25); ctx.lineTo(-s * 0.45, -s * 0.35); ctx.closePath(); ctx.fillStyle = palette.chassis; ctx.fill(); stroke(ctx, palette.brass, 0.8);
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.15, -s * 0.3); ctx.lineTo(0, s * 0.25); ctx.lineTo(-s * 0.15, -s * 0.3); ctx.closePath(); stroke(ctx, palette.emerald, 0.7);
  } else if (ornament.kind === "sun") {
    ctx.globalAlpha = 0.46;
    const sunset = ctx.createLinearGradient(0, -s, 0, s); sunset.addColorStop(0, "#FBBF9C"); sunset.addColorStop(0.55, "#D888C1"); sunset.addColorStop(1, "#513C7C");
    ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.fillStyle = sunset; ctx.fill();
    // Stripe inside the disc rather than erasing the already cached cabinet.
    ctx.clip(); ctx.fillStyle = palette.ambient;
    for (let i = 0; i < 7; i++) ctx.fillRect(-s, s * 0.15 + i * s * 0.10, s * 2, 1.5 + i * 0.8);
  } else if (ornament.kind === "frond") {
    ctx.globalAlpha = 0.72;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(s * 0.7, -s * 0.4, s, -s * 0.8); stroke(ctx, "#3E785A", 1.4);
    for (let i = 1; i <= 6; i++) { const t = i / 7; ctx.save(); ctx.translate(s * t, -s * t * t * 0.8); ctx.rotate(-0.7); leafShape(ctx, s * 0.30 * (1 - t * 0.4), i % 2 ? "#245E47" : "#397756"); ctx.rotate(1.8); leafShape(ctx, s * 0.30 * (1 - t * 0.4), "#2D6A50"); ctx.restore(); }
  } else if (ornament.kind === "grid") {
    ctx.globalAlpha = 0.25;
    for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * s * 0.04, -s); ctx.lineTo(i * s * 0.25, s); stroke(ctx, palette.brass, 0.6); }
  }
  ctx.restore();
}

interface LeafState { readonly ornament: PinballBiomeOrnament; angle: number; angularVelocity: number; x: number; y: number; vx: number; vy: number }
/** Decorative spring response samples frame positions/velocity; it cannot write simulation state. */
export class ReactiveFoliage {
  readonly leaves: LeafState[];
  constructor(biome: PinballViewBiome, density: PinballVisualDensity, maximum?: number) {
    const budget = density === "low" ? 16 : density === "high" ? 64 : 36;
    const cap = Math.min(96, budget, Math.max(0, Number.isFinite(maximum) ? Math.floor(maximum!) : budget));
    this.leaves = biome.ornaments.filter(item => item.kind === "leaf").slice(0, cap).map(ornament => ({ ornament, angle: 0, angularVelocity: 0, x: 0, y: 0, vx: 0, vy: 0 }));
  }
  advance(snapshot: PinballViewSnapshot, timeMs: number, deltaMs: number, reducedMotion: boolean): void {
    if (reducedMotion) return;
    const dt = Math.max(0, Math.min(50, deltaMs)) / 1000;
    for (const leaf of this.leaves) {
      const item = leaf.ornament;
      let bend = Math.sin(timeMs / 1500 + (item.phase ?? 0)) * 0.05, targetX = 0, targetY = 0;
      for (const ball of snapshot.balls) {
        if (!ball.active) continue;
        const dx = item.x + item.size * 0.35 - ball.x, dy = item.y - ball.y;
        const distance = Math.hypot(dx, dy), reach = item.size * 1.7 + (ball.radius ?? 9);
        if (distance >= reach) continue;
        const response = (1 - distance / reach) * 0.65;
        const inv = 1 / Math.max(1, distance);
        targetX += dx * inv * response * item.size * 0.32;
        targetY += dy * inv * response * item.size * 0.32;
        bend += response * ((ball.vx ?? 0) * 0.06 + Math.sign(dx) * 0.35);
      }
      bend = Math.max(-0.7, Math.min(0.7, bend));
      leaf.angularVelocity += ((bend - leaf.angle) * 32 - leaf.angularVelocity * 9) * dt;
      leaf.angle += leaf.angularVelocity * dt;
      leaf.vx += ((targetX - leaf.x) * 30 - leaf.vx * 9) * dt; leaf.x += leaf.vx * dt;
      leaf.vy += ((targetY - leaf.y) * 30 - leaf.vy * 9) * dt; leaf.y += leaf.vy * dt;
    }
  }
  draw(ctx: Context): void {
    for (const leaf of this.leaves) {
      const item = leaf.ornament;
      ctx.save(); ctx.translate(item.x + leaf.x, item.y + leaf.y); ctx.rotate((item.rotation ?? 0) + leaf.angle); ctx.globalAlpha = 0.78;
      leafShape(ctx, item.size, (item.variant ?? 0) % 2 ? "#3F9263" : "#256D50"); ctx.restore();
    }
  }
  reset(): void { for (const leaf of this.leaves) { leaf.angle = 0; leaf.angularVelocity = 0; leaf.x = 0; leaf.y = 0; leaf.vx = 0; leaf.vy = 0; } }
}
