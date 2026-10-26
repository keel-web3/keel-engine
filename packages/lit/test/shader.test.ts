// The shader library against r180 itself (test/fixtures/shader.json, recorded
// from r180's ShaderChunk, ShaderLib and UniformsLib by a generator outside
// this repo): chunk and program texts by sha256, uniforms by name, kind and
// default after r180's merge.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { CHUNKS, PREFIX_CHUNKS } from "../src/shader/chunks.ts";
import { LIBRARY, type ProgramName } from "../src/shader/library.ts";
import {
	cloneUniforms,
	cloneUniformsGroups,
	mergeUniforms,
	realizeUniforms,
	UNIFORM_GROUPS,
	type UniformDefaults,
} from "../src/shader/uniforms.ts";

interface FixtureUniform {
	name: string;
	kind: string;
	value?: unknown;
	hex?: number;
	rgb?: number[];
	properties?: unknown;
}

interface Fixture {
	chunks: Record<string, string>;
	prefixChunks: Record<string, string>;
	programs: Record<ProgramName, { r180: string; vertexShader: string; fragmentShader: string; uniforms: FixtureUniform[] }>;
	uniformGroups: Record<string, FixtureUniform[]>;
}

const fixture = JSON.parse(readFileSync(new URL("./fixtures/shader.json", import.meta.url), "utf8")) as Fixture;

const sha = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

// r180's SRGBToLinear, as new Color( hex ) applies it.
const srgbToLinear = (c: number): number => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));

const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// A maker that builds the fixture's own description of each r180 value.
const maker = {
	color: (hex: number) => ({
		kind: "color",
		hex,
		rgb: [srgbToLinear((hex >> 16 & 255) / 255), srgbToLinear((hex >> 8 & 255) / 255), srgbToLinear((hex & 255) / 255)],
	}),
	vec2: (x: number, y: number) => ({ kind: "vec2", value: [x, y] }),
	vec3: (x: number, y: number, z: number) => ({ kind: "vec3", value: [x, y, z] }),
	mat3: () => ({ kind: "mat3", value: IDENTITY3.slice() }),
	mat4: () => ({ kind: "mat4", value: IDENTITY4.slice() }),
};

function describe(uniforms: Readonly<UniformDefaults>): FixtureUniform[] {
	const real = realizeUniforms(uniforms, maker);
	return Object.entries(real).map(([name, u]) => {
		const v = u.value;
		let d: Omit<FixtureUniform, "name">;
		if (v === null) d = { kind: "null" };
		else if (typeof v === "number") d = { kind: "number", value: v };
		else if (Array.isArray(v)) d = { kind: "list", value: v };
		else d = v as Omit<FixtureUniform, "name">;
		const out: FixtureUniform = { name, ...d };
		if (u.properties !== undefined) out.properties = u.properties;
		return out;
	});
}

const includePattern = /^[ \t]*#include +<([\w\d./]+)>/gm;

test("every chunk is r180's text", () => {
	assert.deepEqual(Object.keys(CHUNKS).sort(), Object.keys(fixture.chunks).sort());
	for (const [name, hash] of Object.entries(fixture.chunks)) assert.equal(sha(CHUNKS[name] ?? ""), hash, name);
	assert.deepEqual(Object.keys(PREFIX_CHUNKS).sort(), Object.keys(fixture.prefixChunks).sort());
	for (const [name, hash] of Object.entries(fixture.prefixChunks)) assert.equal(sha(PREFIX_CHUNKS[name] ?? ""), hash, name);
});

test("the chunks are exactly what the programs include, transitively", () => {
	const reached = new Set<string>();
	const walk = (text: string): void => {
		for (const m of text.matchAll(includePattern)) {
			const name = m[1] as string;
			if (reached.has(name)) continue;
			const chunk = CHUNKS[name];
			assert.ok(chunk !== undefined, `missing chunk ${name}`);
			reached.add(name);
			walk(chunk);
		}
	};
	for (const p of Object.values(LIBRARY)) {
		walk(p.vertexShader);
		walk(p.fragmentShader);
	}
	assert.deepEqual([...reached].sort(), Object.keys(CHUNKS).sort());
});

test("every program's texts are r180's", () => {
	assert.deepEqual(Object.keys(LIBRARY).sort(), Object.keys(fixture.programs).sort());
	for (const [name, want] of Object.entries(fixture.programs)) {
		const p = LIBRARY[name as ProgramName];
		assert.equal(sha(p.vertexShader), want.vertexShader, `${name} (${want.r180}) vertex`);
		assert.equal(sha(p.fragmentShader), want.fragmentShader, `${name} (${want.r180}) fragment`);
	}
});

test("every program's uniforms are r180's merged set, in order", () => {
	for (const [name, want] of Object.entries(fixture.programs)) {
		assert.deepEqual(describe(LIBRARY[name as ProgramName].uniforms()), want.uniforms, name);
	}
});

test("UniformsLib groups are r180's", () => {
	assert.deepEqual(Object.keys(UNIFORM_GROUPS), Object.keys(fixture.uniformGroups));
	for (const [name, want] of Object.entries(fixture.uniformGroups)) {
		assert.deepEqual(describe(UNIFORM_GROUPS[name as keyof typeof UNIFORM_GROUPS]), want, name);
	}
});

test("uniforms() is fresh each call, and so is every realized value", () => {
	const a = LIBRARY.lit.uniforms();
	const b = LIBRARY.lit.uniforms();
	assert.notEqual(a, b);
	assert.notEqual(a["diffuse"], b["diffuse"]);
	a["roughness"]!.value = 0.5;
	assert.equal(b["roughness"]!.value, 1.0);
	assert.equal(LIBRARY.lit.uniforms()["roughness"]!.value, 1.0);
	const ra = realizeUniforms(a, maker);
	const rb = realizeUniforms(a, maker);
	assert.notEqual(ra["diffuse"]!.value, rb["diffuse"]!.value);
	assert.notEqual(ra["directionalLights"]!.value, rb["directionalLights"]!.value);
	// r180 shares the light arrays' `properties` object; so does the port.
	assert.equal(ra["directionalLights"]!.properties, UNIFORM_GROUPS.lights.directionalLights!.properties);
});

test("cloneUniforms and mergeUniforms follow r180", () => {
	let clones = 0;
	const vec = { isVector3: true, clone() { clones++; return { isVector3: true, clone: this.clone }; } };
	const target = { isTexture: true, isRenderTargetTexture: true, clone() { throw new Error("cloned a render target texture"); } };
	const plain = { kind: "anything" };
	const list = [1, 2, 3];
	const warn = console.warn;
	const warnings: unknown[] = [];
	console.warn = (...args: unknown[]) => { warnings.push(args); };
	try {
		const out = cloneUniforms<unknown>({ v: { value: vec }, t: { value: target }, p: { value: plain }, l: { value: list }, n: { value: 3 } });
		assert.equal(clones, 1);
		assert.notEqual(out["v"]!.value, vec);
		assert.equal(out["t"]!.value, null);
		assert.equal(warnings.length, 1);
		assert.equal(out["p"]!.value, plain);
		assert.notEqual(out["l"]!.value, list);
		assert.deepEqual(out["l"]!.value, list);
		assert.equal(out["n"]!.value, 3);
	} finally {
		console.warn = warn;
	}
	const merged = mergeUniforms<number>([{ a: { value: 1 }, b: { value: 2 } }, { b: { value: 3 }, c: { value: 4 } }]);
	assert.deepEqual(Object.keys(merged), ["a", "b", "c"]);
	assert.equal(merged["b"]!.value, 3);
	let groupClones = 0;
	class Group { clone(): Group { groupClones++; return new Group(); } }
	const groups = [new Group(), new Group()];
	const copied = cloneUniformsGroups(groups);
	assert.equal(groupClones, 2);
	assert.notEqual(copied[0], groups[0]);
});
