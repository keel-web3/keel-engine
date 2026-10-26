// Three.js r180's UniformsLib groups and UniformsUtils (MIT, see NOTICE).
//
// Defaults are data, not maths objects. A uniform is r180's `{ value }` (plus
// `properties` on the light arrays), and a value r180 builds with `new Color`,
// `new Vector2/3` or `new Matrix3/4` is written here as a small descriptor:
//
//   new Color( 0xffffff )   -> { kind: "color", value: 0xffffff }   (an sRGB hex, as r180's Color(hex) reads it)
//   new Vector2( 1, 1 )     -> { kind: "vec2", value: [ 1, 1 ] }
//   new Vector3()           -> { kind: "vec3", value: [ 0, 0, 0 ] }
//   new Matrix3()           -> { kind: "mat3" }                       (identity)
//   new Matrix4()           -> { kind: "mat4" }                       (identity)
//   []                      -> { kind: "list" }                       (a fresh empty array)
//
// Numbers and null (an unset texture) stay as they are. This keeps the shader
// library free of the maths module; the renderer turns descriptors into real
// values with `realizeUniforms(uniforms, maker)`, handing in a maker built on
// src/math. Descriptors are frozen, so sharing one between merged groups is
// the same as r180 cloning it: realizing makes a fresh object every time.
//
// cloneUniforms / mergeUniforms are r180's, line for line, and work on real
// values too (a CustomMaterial's uniforms): anything flagged isColor,
// isMatrix3/4, isVector2/3/4, isTexture or isQuaternion is cloned, arrays are
// sliced, everything else (numbers, null, descriptors, `properties`) is copied
// by reference.

export type UniformDescriptor =
	| { readonly kind: "color"; readonly value: number }
	| { readonly kind: "vec2"; readonly value: readonly [number, number] }
	| { readonly kind: "vec3"; readonly value: readonly [number, number, number] }
	| { readonly kind: "mat3" }
	| { readonly kind: "mat4" }
	| { readonly kind: "list" };

/** A default as the shader library writes it. */
export type UniformDefault = number | null | UniformDescriptor;

/** One uniform: r180's `{ value }`, with `properties` on the light struct arrays. */
export interface Uniform<V = unknown> {
	value: V;
	properties?: Readonly<Record<string, unknown>>;
}

export type Uniforms<V = unknown> = Record<string, Uniform<V>>;

/** A group of defaults, as UniformsLib and the library's factories give them. */
export type UniformDefaults = Uniforms<UniformDefault>;

/** What the renderer hands realizeUniforms: makers for r180's maths values. */
export interface UniformMaker<C, V2, V3, M3, M4> {
	color(hex: number): C;
	vec2(x: number, y: number): V2;
	vec3(x: number, y: number, z: number): V3;
	mat3(): M3;
	mat4(): M4;
}

const color = (hex: number): UniformDescriptor => Object.freeze({ kind: "color", value: hex });
const vec2 = (x: number, y: number): UniformDescriptor => Object.freeze({ kind: "vec2", value: Object.freeze([x, y] as const) });
const vec3 = (x: number, y: number, z: number): UniformDescriptor => Object.freeze({ kind: "vec3", value: Object.freeze([x, y, z] as const) });
const MAT3: UniformDescriptor = Object.freeze({ kind: "mat3" });
const MAT4: UniformDescriptor = Object.freeze({ kind: "mat4" });
const LIST: UniformDescriptor = Object.freeze({ kind: "list" });

export const descriptors = Object.freeze({ color, vec2, vec3, mat3: MAT3, mat4: MAT4, list: LIST });

const u = (value: UniformDefault): Uniform<UniformDefault> => ({ value });
const ul = (properties: Record<string, unknown>): Uniform<UniformDefault> => ({ value: LIST, properties: Object.freeze(properties) });

function group(g: UniformDefaults): Readonly<UniformDefaults> {
	for (const k in g) Object.freeze(g[k]);
	return Object.freeze(g);
}

// Uniforms library for shared webgl shaders (r180's UniformsLib, in its order).
export const UNIFORM_GROUPS = Object.freeze({

	common: group({
		diffuse: u(color(0xffffff)),
		opacity: u(1.0),
		map: u(null),
		mapTransform: u(MAT3),
		alphaMap: u(null),
		alphaMapTransform: u(MAT3),
		alphaTest: u(0),
	}),

	specularmap: group({
		specularMap: u(null),
		specularMapTransform: u(MAT3),
	}),

	envmap: group({
		envMap: u(null),
		envMapRotation: u(MAT3),
		flipEnvMap: u(-1),
		reflectivity: u(1.0), // basic, lambert, phong
		ior: u(1.5), // physical
		refractionRatio: u(0.98), // basic, lambert, phong
	}),

	aomap: group({
		aoMap: u(null),
		aoMapIntensity: u(1),
		aoMapTransform: u(MAT3),
	}),

	lightmap: group({
		lightMap: u(null),
		lightMapIntensity: u(1),
		lightMapTransform: u(MAT3),
	}),

	bumpmap: group({
		bumpMap: u(null),
		bumpMapTransform: u(MAT3),
		bumpScale: u(1),
	}),

	normalmap: group({
		normalMap: u(null),
		normalMapTransform: u(MAT3),
		normalScale: u(vec2(1, 1)),
	}),

	displacementmap: group({
		displacementMap: u(null),
		displacementMapTransform: u(MAT3),
		displacementScale: u(1),
		displacementBias: u(0),
	}),

	emissivemap: group({
		emissiveMap: u(null),
		emissiveMapTransform: u(MAT3),
	}),

	metalnessmap: group({
		metalnessMap: u(null),
		metalnessMapTransform: u(MAT3),
	}),

	roughnessmap: group({
		roughnessMap: u(null),
		roughnessMapTransform: u(MAT3),
	}),

	gradientmap: group({
		gradientMap: u(null),
	}),

	fog: group({
		fogDensity: u(0.00025),
		fogNear: u(1),
		fogFar: u(2000),
		fogColor: u(color(0xffffff)),
	}),

	lights: group({
		ambientLightColor: u(LIST),
		lightProbe: u(LIST),
		directionalLights: ul({ direction: {}, color: {} }),
		directionalLightShadows: ul({ shadowIntensity: 1, shadowBias: {}, shadowNormalBias: {}, shadowRadius: {}, shadowMapSize: {} }),
		directionalShadowMap: u(LIST),
		directionalShadowMatrix: u(LIST),
		spotLights: ul({ color: {}, position: {}, direction: {}, distance: {}, coneCos: {}, penumbraCos: {}, decay: {} }),
		spotLightShadows: ul({ shadowIntensity: 1, shadowBias: {}, shadowNormalBias: {}, shadowRadius: {}, shadowMapSize: {} }),
		spotLightMap: u(LIST),
		spotShadowMap: u(LIST),
		spotLightMatrix: u(LIST),
		pointLights: ul({ color: {}, position: {}, decay: {}, distance: {} }),
		pointLightShadows: ul({ shadowIntensity: 1, shadowBias: {}, shadowNormalBias: {}, shadowRadius: {}, shadowMapSize: {}, shadowCameraNear: {}, shadowCameraFar: {} }),
		pointShadowMap: u(LIST),
		pointShadowMatrix: u(LIST),
		hemisphereLights: ul({ direction: {}, skyColor: {}, groundColor: {} }),
		rectAreaLights: ul({ color: {}, position: {}, width: {}, height: {} }),
		ltc_1: u(null),
		ltc_2: u(null),
	}),

	points: group({
		diffuse: u(color(0xffffff)),
		opacity: u(1.0),
		size: u(1.0),
		scale: u(1.0),
		map: u(null),
		alphaMap: u(null),
		alphaMapTransform: u(MAT3),
		alphaTest: u(0),
		uvTransform: u(MAT3),
	}),

	sprite: group({
		diffuse: u(color(0xffffff)),
		opacity: u(1.0),
		center: u(vec2(0.5, 0.5)),
		rotation: u(0.0),
		map: u(null),
		mapTransform: u(MAT3),
		alphaMap: u(null),
		alphaMapTransform: u(MAT3),
		alphaTest: u(0),
	}),

});

interface Cloneable {
	clone(): unknown;
	isColor?: boolean;
	isMatrix3?: boolean;
	isMatrix4?: boolean;
	isVector2?: boolean;
	isVector3?: boolean;
	isVector4?: boolean;
	isTexture?: boolean;
	isQuaternion?: boolean;
	isRenderTargetTexture?: boolean;
}

function isCloneable(p: unknown): p is Cloneable {
	if (!p || typeof p !== "object") return false;
	const q = p as Cloneable;
	return !!(q.isColor || q.isMatrix3 || q.isMatrix4 || q.isVector2 || q.isVector3 || q.isVector4 || q.isTexture || q.isQuaternion);
}

/** r180's UniformsUtils.clone (cloneUniforms). */
export function cloneUniforms<V>(src: Readonly<Uniforms<V>>): Uniforms<V> {
	const dst: Record<string, Record<string, unknown>> = {};
	for (const u in src) {
		const from = src[u] as unknown as Record<string, unknown>;
		const to: Record<string, unknown> = {};
		dst[u] = to;
		for (const p in from) {
			const property = from[p];
			if (isCloneable(property)) {
				if (property.isRenderTargetTexture) {
					console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms().");
					to[p] = null;
				} else {
					to[p] = property.clone();
				}
			} else if (Array.isArray(property)) {
				to[p] = property.slice();
			} else {
				to[p] = property;
			}
		}
	}
	return dst as unknown as Uniforms<V>;
}

/** r180's UniformsUtils.merge (mergeUniforms): later groups win, each cloned. */
export function mergeUniforms<V>(uniforms: readonly Readonly<Uniforms<V>>[]): Uniforms<V> {
	const merged: Uniforms<V> = {};
	for (const group of uniforms) {
		const tmp = cloneUniforms(group);
		for (const p in tmp) merged[p] = tmp[p] as Uniform<V>;
	}
	return merged;
}

/** r180's cloneUniformsGroups. */
export function cloneUniformsGroups<T extends { clone(): T }>(src: readonly T[]): T[] {
	const dst: T[] = [];
	for (const g of src) dst.push(g.clone());
	return dst;
}

export const uniformsUtils = Object.freeze({ clone: cloneUniforms, merge: mergeUniforms });

/** Turns descriptors into the renderer's values: fresh objects, the rest as is. */
export function realizeUniforms<C, V2, V3, M3, M4>(
	uniforms: Readonly<UniformDefaults>,
	maker: UniformMaker<C, V2, V3, M3, M4>,
): Uniforms<number | null | unknown[] | C | V2 | V3 | M3 | M4> {
	const out: Uniforms<number | null | unknown[] | C | V2 | V3 | M3 | M4> = {};
	for (const name in uniforms) {
		const src = uniforms[name] as Uniform<UniformDefault>;
		const v = src.value;
		let value: number | null | unknown[] | C | V2 | V3 | M3 | M4;
		if (v === null || typeof v === "number") value = v;
		else {
			switch (v.kind) {
				case "color": value = maker.color(v.value); break;
				case "vec2": value = maker.vec2(v.value[0], v.value[1]); break;
				case "vec3": value = maker.vec3(v.value[0], v.value[1], v.value[2]); break;
				case "mat3": value = maker.mat3(); break;
				case "mat4": value = maker.mat4(); break;
				case "list": value = []; break;
			}
		}
		const uniform: Uniform<number | null | unknown[] | C | V2 | V3 | M3 | M4> = { value };
		if (src.properties !== undefined) uniform.properties = src.properties;
		out[name] = uniform;
	}
	return out;
}
