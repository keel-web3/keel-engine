// Parsers round-trip files written here (nothing downloaded): glTF as GLB and
// as JSON with an inline buffer (meshes, the node hierarchy, materials, a PNG
// texture, a skin with inverse bind matrices, strips, sparse accessors), OBJ +
// MTL (groups, materials, negative indices, quads), STL binary (with facet
// colours) and ASCII, .vox (palette, models placed by the scene graph); PNG
// through a real deflater; and every kind of broken file says what's wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import {
  ImportError, addBox, buildGltf, crc32, decodePng, defaultVoxPalette, encodePng, inflateZlib, isBinaryStl, knightBuild, meshData, parseGltf, parseModel, parseObj, parseStl, parseVox,
  readGlb, robotVox, soupOf, srgbToLinear, woodTexture, writeGlb, writeGltfJson, writeObj, writeStl, writeVox, KNIGHT_JOINTS,
} from "../src/index.ts";

const near = (a: number, b: number, e = 1e-5): boolean => Math.abs(a - b) <= e;

test("glTF: a GLB and its JSON twin read back the same meshes, nodes, materials, texture and skin", () => {
  const build = knightBuild();
  const glb = writeGlb(build);
  const a = parseGltf(glb), b = parseGltf(writeGltfJson(build));
  for (const s of [a, b]) {
    assert.equal(s.meshes.length, 6);
    assert.deepEqual(s.meshes.map((m) => m.name), ["Body", "Helmet", "Shield", "Cape", "Sword", "Belt"]);
    assert.equal(s.meshes[0]!.primitives.length, 4);
    assert.equal(s.nodes.length, KNIGHT_JOINTS.length + 7);
    // The hierarchy: every joint where the build put it (world positions from the TRS chain).
    KNIGHT_JOINTS.forEach(([name, , p], i) => {
      assert.equal(s.nodes[i]!.name, name);
      const w = s.nodes[i]!.world;
      assert.ok(near(w[12]!, p[0]) && near(w[13]!, p[1]) && near(w[14]!, p[2]), `${name} at ${[w[12], w[13], w[14]]}`);
    });
    // Materials: linear factors kept.
    assert.equal(s.materials.length, 8);
    assert.ok(near(s.materials[0]!.colour[0], srgbToLinear(226 / 255), 1e-6));
    // The skin: 19 joints, identity at bind (inverse bind x world).
    assert.equal(s.skins.length, 1);
    assert.equal(s.skins[0]!.joints.length, 19);
    const ib = s.skins[0]!.inverseBind[4]!;
    assert.ok(near(ib[13]!, -1.6), "the head's inverse bind moves it back to the origin");
    const p0 = s.meshes[0]!.primitives[0]!;
    assert.ok(p0.joints && p0.weights && p0.joints.length === (p0.positions.length / 3) * 4);
  }
  // Same triangles either way.
  const sa = soupOf(a), sb = soupOf(b);
  assert.equal(sa.count, sb.count);
  assert.deepEqual([...sa.positions.slice(0, 30)], [...sb.positions.slice(0, 30)]);
  assert.ok(sa.skinned);
  // A GLB is a GLB: 'glTF', version 2, a JSON chunk and a BIN chunk.
  const { json, bin } = readGlb(glb);
  assert.equal((json["asset"] as { version: string }).version, "2.0");
  assert.ok(bin && bin.length > 1000);
});

test("glTF: textures (PNG, decoded), strips and fans, sparse accessors, vertex colours", () => {
  const m = meshData();
  addBox(m, [0, 0.5, 0], [0.5, 0.5, 0.5]);
  const tex = woodTexture();
  const { json, bin } = buildGltf({ nodes: [{ name: "crate", mesh: 0 }], meshes: [{ name: "crate", primitives: [{ mesh: m, material: 0, colours: true }] }], materials: [{ name: "wood", colour: [1, 1, 1, 1], texture: 0 }], images: [tex] });
  const s = parseGltf({ ...json, buffers: [{ byteLength: bin.length, uri: `data:application/octet-stream;base64,${Buffer.from(bin).toString("base64")}` }] });
  assert.equal(s.images.length, 1);
  assert.deepEqual([s.images[0]!.width, s.images[0]!.height], [32, 32]);
  assert.deepEqual([...s.images[0]!.data.subarray(0, 8)], [...tex.data.subarray(0, 8)]);
  assert.equal(s.materials[0]!.texture?.texture, 0);
  assert.ok(s.meshes[0]!.primitives[0]!.colours);
  // A strip and a fan; a sparse accessor that moves one vertex.
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 2, 0]);
  const moved = new Float32Array([5, 5, 5]);
  const idx = new Uint8Array([2, 0, 0, 0]);
  const buf = new Uint8Array(pos.byteLength + moved.byteLength + idx.byteLength);
  buf.set(new Uint8Array(pos.buffer), 0); buf.set(new Uint8Array(moved.buffer), pos.byteLength); buf.set(idx, pos.byteLength + moved.byteLength);
  const doc = {
    asset: { version: "2.0" }, scenes: [{ nodes: [0, 1] }], nodes: [{ mesh: 0 }, { mesh: 1 }],
    buffers: [{ byteLength: buf.length, uri: `data:application/octet-stream;base64,${Buffer.from(buf).toString("base64")}` }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pos.byteLength, byteLength: 12 }, { buffer: 0, byteOffset: pos.byteLength + 12, byteLength: 4 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 5, type: "VEC3" },
      { bufferView: 0, componentType: 5126, count: 5, type: "VEC3", sparse: { count: 1, indices: { bufferView: 2, componentType: 5121 }, values: { bufferView: 1 } } },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 5 }] }, { primitives: [{ attributes: { POSITION: 1 }, mode: 6 }] }],
  };
  const t = parseGltf(doc);
  assert.equal(t.meshes[0]!.primitives[0]!.indices.length, 9, "a strip of 5: three triangles");
  assert.equal(t.meshes[1]!.primitives[0]!.indices.length, 9, "a fan of 5: three triangles");
  assert.deepEqual([...t.meshes[1]!.primitives[0]!.positions.slice(6, 9)], [5, 5, 5], "the sparse value landed on vertex 2");
  assert.deepEqual([...t.meshes[0]!.primitives[0]!.positions.slice(6, 9)], [0, 1, 0], "the other accessor untouched");
});

test("glTF errors say where: truncated, wrong version, a missing buffer, Draco, an index past its vertices", () => {
  const glb = writeGlb(knightBuild());
  const throwsLike = (f: () => unknown, re: RegExp): void => assert.throws(f, (e: unknown) => e instanceof ImportError && re.test((e as Error).message));
  throwsLike(() => parseGltf(glb.subarray(0, 30)), /runs past the end|GLB says/);
  throwsLike(() => parseGltf({ asset: { version: "1.0" } }), /only 2\.x/);
  throwsLike(() => parseGltf({ asset: { version: "2.0" }, buffers: [{ byteLength: 10, uri: "body.bin" }] }), /pass its bytes in resources/);
  throwsLike(() => parseGltf({ asset: { version: "2.0" }, extensionsRequired: ["KHR_draco_mesh_compression"] }), /Draco/);
  // (One vertex at the origin, then indices 0 0 7.)
  const bytes = new Uint8Array(16); bytes.set([0, 0, 7], 12);
  const bad = {
    asset: { version: "2.0" }, nodes: [{ mesh: 0 }],
    buffers: [{ byteLength: 16, uri: `data:application/octet-stream;base64,${Buffer.from(bytes).toString("base64")}` }],
    bufferViews: [{ buffer: 0, byteLength: 12 }, { buffer: 0, byteOffset: 12, byteLength: 4 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: "VEC3" }, { bufferView: 1, componentType: 5121, count: 3, type: "SCALAR" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  };
  throwsLike(() => parseGltf(bad), /index 7 past its 1 vertices/);
  throwsLike(() => parseModel(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), /not glTF, GLB, OBJ, STL or \.vox/);
});

test("OBJ + MTL: groups, materials (sRGB Kd), quads fanned, negative indices, uvs flipped to glTF's", () => {
  const a = meshData(); addBox(a, [0, 0.5, 0], [0.5, 0.5, 0.5]);
  const b = meshData(); addBox(b, [2, 0.5, 0], [0.3, 0.5, 0.3]);
  const { obj, mtl } = writeObj([{ name: "left", mesh: a, material: "red" }, { name: "right", mesh: b, material: "blue" }], [{ name: "red", colour: [srgbToLinear(0.8), 0.02, 0.02, 1] }, { name: "blue", colour: [0.02, 0.02, 0.9, 1] }], "m.mtl");
  const s = parseObj(obj, { mtl: { "m.mtl": mtl } });
  assert.deepEqual(s.nodes.map((n) => n.name), ["left", "right"]);
  assert.equal(s.meshes[0]!.primitives[0]!.indices.length, 36);
  assert.deepEqual(s.materials.map((m) => m.name), ["red", "blue"]);
  assert.ok(near(s.materials[0]!.colour[0], srgbToLinear(0.8), 1e-4));
  // A quad with negative indices, and a missing MTL is a warning, not a failure.
  const q = parseObj("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nmtllib gone.mtl\nf -4 -3 -2 -1\n");
  assert.equal(q.meshes[0]!.primitives[0]!.indices.length, 6);
  assert.ok(q.warnings.some((w) => w.includes("gone.mtl")));
  assert.throws(() => parseObj("v 0 0 0\nf 1 2 3\n"), /line 2: vertex 2 doesn't exist/);
  assert.throws(() => parseObj("v 0 zero 0\n"), /line 1: "v" needs three numbers/);
});

test("STL: binary (a 'solid' header doesn't fool it; facet colours kept) and ASCII round-trip", () => {
  const m = meshData(); addBox(m, [0, 0, 50], [100, 100, 50]);
  const bin = writeStl(m, { name: "solid block", colour: [srgbToLinear(1), srgbToLinear(0.5), 0] }) as Uint8Array;
  assert.ok(isBinaryStl(bin));
  const s = parseStl(bin);
  assert.equal(s.meshes[0]!.primitives[0]!.indices.length, 36);
  const c = s.meshes[0]!.primitives[0]!.colours!;
  assert.ok(near(c[0]!, 1, 1e-6) && c[1]! > 0.15 && c[1]! < 0.25 && c[2] === 0, `orange, got ${[...c.slice(0, 3)]}`);
  const text = writeStl(m, { ascii: true, name: "block" }) as string;
  const t = parseStl(text);
  assert.deepEqual([...t.meshes[0]!.primitives[0]!.positions], [...s.meshes[0]!.primitives[0]!.positions]);
  assert.equal(parseModel(new TextEncoder().encode(text)).format, "stl");
  assert.throws(() => parseStl(new Uint8Array(100)), /neither a binary STL/);
  assert.throws(() => parseStl("solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 nope\n"), /ASCII STL with facets but no "endsolid"|isn't three numbers/);
});

test(".vox: two models placed by the scene graph, the palette, the default palette, bad files", () => {
  const s = parseVox(robotVox());
  const v = s.voxels!;
  assert.deepEqual(v.modelNames, ["body", "antenna"]);
  let body = 0, antenna = 0;
  for (let i = 0; i < v.cells.length; i += 1) { if (v.model[i] === 0) body += 1; else if (v.model[i] === 1) antenna += 1; }
  assert.equal(antenna, 9);
  assert.ok(body > 900);
  // The antenna sits on top: its lowest cell above the body's highest (y is up in the engine frame).
  let bodyTop = -1, antBottom = Infinity;
  for (let i = 0; i < v.cells.length; i += 1) { const y = Math.floor(i / v.size[0]) % v.size[1]; if (v.model[i] === 0) bodyTop = Math.max(bodyTop, y); if (v.model[i] === 1) antBottom = Math.min(antBottom, y); }
  assert.equal(antBottom, bodyTop + 1);
  // Colour index 3 is the glow's cyan (sRGB 120 240 255).
  assert.ok(near(v.palette[3 * 4 + 1]!, srgbToLinear(240 / 255), 1e-6));
  // No RGBA chunk: MagicaVoxel's default palette (white first, grey ramp last).
  const pal = defaultVoxPalette();
  assert.deepEqual([...pal.subarray(4, 8)], [255, 255, 255, 255]);
  assert.deepEqual([...pal.subarray(255 * 4, 256 * 4)], [17, 17, 17, 255]);
  const plain = writeVox([{ size: [2, 2, 2], voxels: [[0, 0, 0, 1], [1, 1, 1, 2]] }], pal);
  assert.equal(parseVox(plain).voxels!.cells.filter((c) => c).length, 2);
  assert.throws(() => parseVox(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), /no "VOX " magic/);
  const cut = robotVox().subarray(0, 60);
  assert.throws(() => parseVox(cut), /runs past the end|no models/);
});

test("PNG: our decoder reads a real deflater's output (every filter), our encoder writes what it reads", () => {
  const w = 17, h = 9;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < rgba.length; i += 1) rgba[i] = (i * 37 + (i >> 5) * 11) & 255;
  // Filtered scanlines (types 0..4 in turn), deflated by zlib.
  const stride = w * 4;
  const raw = new Uint8Array(h * (stride + 1));
  for (let y = 0; y < h; y += 1) {
    const f = y % 5;
    raw[y * (stride + 1)] = f;
    for (let x = 0; x < stride; x += 1) {
      const cur = rgba[y * stride + x]!, a = x >= 4 ? rgba[y * stride + x - 4]! : 0, b = y ? rgba[(y - 1) * stride + x]! : 0, c = y && x >= 4 ? rgba[(y - 1) * stride + x - 4]! : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      raw[y * (stride + 1) + 1 + x] = (cur - pred) & 255;
    }
  }
  const z = deflateSync(raw, { level: 9 });
  assert.deepEqual([...inflateZlib(new Uint8Array(z))], [...raw]);
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const c = new Uint8Array(12 + data.length);
    const dv = new DataView(c.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i += 1) c[4 + i] = type.charCodeAt(i);
    c.set(data, 8);
    dv.setUint32(8 + data.length, crc32(c, 4, 8 + data.length));
    return c;
  };
  const ihdr = new Uint8Array(13); new DataView(ihdr.buffer).setUint32(0, w); new DataView(ihdr.buffer).setUint32(4, h); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(z)), chunk("IEND", new Uint8Array(0))]);
  assert.deepEqual([...decodePng(new Uint8Array(png)).data], [...rgba]);
  assert.deepEqual([...decodePng(encodePng({ width: w, height: h, data: rgba })).data], [...rgba]);
  assert.throws(() => inflateZlib(new Uint8Array([0x78, 0x9c, 0xff, 0xff, 0, 0, 0, 0])), /deflate|zlib/);
});
