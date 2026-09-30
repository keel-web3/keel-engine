import { createPixelRenderer } from "../src/index.ts";
import { targetProfile } from "@keel-engine/core";
import type { TargetId } from "@keel-engine/core";
// Tooling loads this checkout's exporter; the runtime's public API remains @keel-engine/capture.
import { exportGameBoyBackground, flipRows, gameBoyFiles } from "../../capture/src/index.ts";
import type { GameBoyTarget } from "../../capture/src/index.ts";
import { MATERIALS, VIEW, boxes, capsules, colours, particles, ramps, wedges } from "./parity.ts";

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = element<HTMLCanvasElement>("engine"), hardware = element<HTMLCanvasElement>("hardware");
const target = element<HTMLSelectElement>("target"), exportTarget = element<HTMLSelectElement>("export-target");
const file = element<HTMLSelectElement>("file"), download = element<HTMLButtonElement>("download"), status = element("status");
let files: ReadonlyMap<string, Uint8Array> = new Map();

function start(): void {
  const px = createPixelRenderer(canvas, { width: 320, height: 240 });
  px.setPalette(colours, ramps);
  px.setMaterials(MATERIALS);
  px.setWorld({ boxes, wedges, capsules });
  px.setStyle({ screen: 4, dither: 0.9, outline: 1 });
  function draw(): void {
    files = new Map(); file.replaceChildren(); file.disabled = true; download.disabled = true;
    try {
      px.setProfile(target.value as TargetId);
      px.render({ ...VIEW, time: 0.75, particles });
      const off = px.offPalette();
      if (off) throw new Error(`${off} pixels outside the selected palette`);
      const used = new Set(px.palette.map(String)).size;
      element("engine-caption").textContent = `${px.profile.label} · ${px.width} × ${px.height} · ${used} palette colors`;
      const asset = exportGameBoyBackground({ width: px.width, height: px.height, rgba: flipRows(px.read(), px.width, px.height) }, { target: exportTarget.value as GameBoyTarget });
      hardware.width = asset.width; hardware.height = asset.height; hardware.hidden = false;
      hardware.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(asset.preview), asset.width, asset.height), 0, 0);
      element("hardware-caption").textContent = `${targetProfile(asset.target).label} · ${asset.width} × ${asset.height} · ${asset.tileCount} unique tiles · ${asset.paletteCount} palettes`;
      files = gameBoyFiles(asset, `keel_${asset.target.replaceAll("-", "_")}`);
      for (const name of files.keys()) { const option = document.createElement("option"); option.value = name; option.textContent = name; file.append(option); }
      file.disabled = false; download.disabled = false;
      status.textContent = `Ready to export · ${asset.changedPixels.toLocaleString()} pixels changed by native conversion`;
    } catch (error) {
      hardware.hidden = true;
      element("hardware-caption").textContent = "Native export unavailable for this frame";
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  }
  target.addEventListener("change", () => {
    const profile = targetProfile(target.value as TargetId);
    if (profile.hardware) exportTarget.value = profile.id;
    draw();
  });
  exportTarget.addEventListener("change", draw);
  download.addEventListener("click", () => {
    const data = files.get(file.value);
    if (!data) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(data)]));
    const link = document.createElement("a"); link.href = url; link.download = file.value; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = `Downloaded ${file.value}`;
  });
  draw();
}
try { start(); } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
