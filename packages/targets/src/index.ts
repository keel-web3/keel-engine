// An age is creative intent. A device is a capability envelope. Neither is a console compiler.
export const AGE_SCHEMA = "keel-age@1";
export const DEVICE_SCHEMA = "keel-device@1";
export const TARGET_PLAN_SCHEMA = "keel-target-plan@1";
export type Detail = 0 | 1 | 2;
export type Renderer = "frames" | "program";
export interface Quality {
  readonly detail: Detail;
  readonly meshDetail: "low" | "medium" | "high";
  readonly views: number;
  readonly phases: number;
  readonly variants: number;
  readonly particles: number;
}
export interface Age {
  readonly schema: typeof AGE_SCHEMA;
  readonly id: string;
  readonly name: string;
  readonly quality: Quality;
  readonly renderers: readonly Renderer[];
  /** Logical view surfaces; two DS views can occupy one physical display. */
  readonly surfaces: number;
  /** True requires a stereoscopic output; ordinary perspective is insufficient. */
  readonly stereo: boolean;
  readonly input: readonly string[];
}
export interface Device {
  readonly schema: typeof DEVICE_SCHEMA;
  readonly id: string;
  readonly quality: Quality;
  readonly renderers: readonly Renderer[];
  readonly surfaces: number;
  readonly stereo: boolean;
  readonly input: readonly string[];
  readonly budget: { readonly objectBytes: number; readonly bundleBytes: number; readonly triangles?: number };
}
export interface TargetPlan {
  readonly schema: typeof TARGET_PLAN_SCHEMA;
  readonly age: string;
  readonly device: string;
  readonly renderer: Renderer;
  readonly quality: Quality;
  readonly surfaces: number;
  readonly stereo: boolean;
  readonly budget: Device["budget"];
  readonly reduced: readonly (keyof Quality)[];
}
const MESH = ["low", "medium", "high"] as const;
function quality(q: Quality): void {
  if (!q || ![0, 1, 2].includes(q.detail) || !MESH.includes(q.meshDetail)) throw new Error("invalid quality detail");
  for (const key of ["views", "phases", "variants", "particles"] as const) {
    if (!Number.isSafeInteger(q[key]) || q[key] < (key === "particles" ? 0 : 1)) throw new Error(`invalid quality ${key}`);
  }
}
function envelope(v: Age | Device, schema: string): void {
  if (!v || v.schema !== schema || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.id)) throw new Error(`invalid ${schema} identity`);
  quality(v.quality);
  if (!Number.isSafeInteger(v.surfaces) || v.surfaces < 1 || typeof v.stereo !== "boolean") throw new Error("invalid display capabilities");
  if (!Array.isArray(v.renderers) || !v.renderers.length || v.renderers.some((r) => !["frames", "program"].includes(r))) throw new Error("invalid renderers");
  if (!Array.isArray(v.input) || v.input.some((i) => typeof i !== "string" || !i)) throw new Error("invalid input capabilities");
}
/** Explicit required features fail; optional quality is capped by both age and hardware. */
export function resolveTarget(age: Age, device: Device): TargetPlan {
  envelope(age, AGE_SCHEMA); envelope(device, DEVICE_SCHEMA);
  for (const key of ["objectBytes", "bundleBytes"] as const) {
    if (!Number.isSafeInteger(device.budget?.[key]) || device.budget[key] < 1) throw new Error(`invalid budget ${key}`);
  }
  if (device.budget.triangles !== undefined && (!Number.isSafeInteger(device.budget.triangles) || device.budget.triangles < 0)) throw new Error("invalid triangle budget");
  if (age.surfaces > device.surfaces) throw new Error(`${device.id}: ${age.id} requires ${age.surfaces} logical view surfaces`);
  if (age.stereo && !device.stereo) throw new Error(`${device.id}: ${age.id} requires stereoscopic output`);
  const missing = age.input.filter((i) => !device.input.includes(i));
  if (missing.length) throw new Error(`${device.id}: ${age.id} requires input ${missing.join(", ")}`);
  const renderer = age.renderers.find((r) => device.renderers.includes(r));
  if (!renderer) throw new Error(`${device.id}: no renderer for ${age.id}`);
  const a = age.quality, d = device.quality;
  const q: Quality = {
    detail: Math.min(a.detail, d.detail) as Detail,
    meshDetail: MESH[Math.min(MESH.indexOf(a.meshDetail), MESH.indexOf(d.meshDetail))]!,
    views: Math.min(a.views, d.views), phases: Math.min(a.phases, d.phases),
    variants: Math.min(a.variants, d.variants), particles: Math.min(a.particles, d.particles),
  };
  return {
    schema: TARGET_PLAN_SCHEMA, age: age.id, device: device.id, renderer, quality: q,
    surfaces: age.surfaces, stereo: age.stereo, budget: { ...device.budget },
    reduced: (Object.keys(q) as (keyof Quality)[]).filter((k) => q[k] !== a[k]),
  };
}
