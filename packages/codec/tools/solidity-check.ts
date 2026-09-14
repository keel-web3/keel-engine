// Prove the generated Solidity decoder reads what the codec writes: generate a
// library for a fixed-layout schema, encode values, and run forge test on a
// scratch project whose test asserts every field (offline; foundry's cached solc).
//
//   node packages/codec/tools/solidity-check.ts [dir]      (default: a temp dir)

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { array, bool, encode, encodeRaw, enumOf, fixed, gridOf, int, named, solidityDecoder, struct, tuple, uint } from "../src/index.ts";
import type { Infer } from "../src/index.ts";

export const UNIT = named("keel/example/unit", struct({
  x: uint(10), y: uint(10), hp: int(9), alive: bool(), kind: enumOf(["grass", "rock", "water"]),
  height: fixed(-10, 10, 0.01), gear: array(uint(4), { length: 3 }),
  pos: tuple([fixed(0, 64, 0.001), fixed(0, 64, 0.001)]), stats: struct({ str: uint(5), dex: uint(5) }), team: enumOf(["red", "blue"], { capacity: 4 }),
}));
type Unit = Infer<typeof UNIT>;
const VALUES: Unit[] = [
  { x: 1023, y: 7, hp: -200, alive: true, kind: "water", height: -9.99, gear: [15, 0, 7], pos: [63.999, 0.001], stats: { str: 31, dex: 1 }, team: "blue" },
  { x: 0, y: 0, hp: 255, alive: false, kind: "grass", height: 3.14, gear: [1, 2, 3], pos: [12.5, 40], stats: { str: 0, dex: 30 }, team: "red" },
];

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
const units = (v: number, n: { min: number; max: number; step: number }): number => Math.round(v / n.step);
void gridOf;
const kinds = ["grass", "rock", "water"];
const checks = (u: Unit, fn: string, arg: string) => `
    ExampleUnit.Value memory v = ExampleUnit.${fn}(hex"${arg}");
    require(v.x == ${u.x} && v.y == ${u.y} && v.hp == ${u.hp} && v.alive == ${u.alive}, "scalars");
    require(v.kind == ExampleUnit.Kind.${u.kind} && uint8(v.kind) == ${kinds.indexOf(u.kind)}, "enum");
    require(v.height == ${units(u.height, { min: -10, max: 10, step: 0.01 })}, "fixed");
    require(v.gear[0] == ${u.gear[0]} && v.gear[1] == ${u.gear[1]} && v.gear[2] == ${u.gear[2]}, "array");
    require(v.pos[0] == ${units(u.pos[0], { min: 0, max: 64, step: 0.001 })} && v.pos[1] == ${units(u.pos[1], { min: 0, max: 64, step: 0.001 })}, "tuple");
    require(v.stats.str == ${u.stats.str} && v.stats.dex == ${u.stats.dex}, "struct");
    require(v.team == ${u.team === "red" ? 0 : 1}, "capacity enum");`;

const dir = process.argv[2] ?? mkdtempSync(join(tmpdir(), "keel-codec-sol-"));
mkdirSync(join(dir, "src"), { recursive: true });
mkdirSync(join(dir, "test"), { recursive: true });
writeFileSync(join(dir, "foundry.toml"), `[profile.default]\nsrc = "src"\ntest = "test"\nout = "out"\nsolc_version = "0.8.30"\noffline = true\n`);
writeFileSync(join(dir, "src", "ExampleUnit.sol"), solidityDecoder(UNIT, { name: "ExampleUnit" }));
writeFileSync(join(dir, "test", "ExampleUnit.t.sol"), `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import { ExampleUnit } from "../src/ExampleUnit.sol";
contract ExampleUnitTest {
${VALUES.map((u, i) => `  function test_body${i}() public pure {${checks(u, "decode", hex(encodeRaw(UNIT, u)))}\n  }\n  function test_document${i}() public pure {${checks(u, "decodeDocument", hex(encode(UNIT, u)))}\n  }`).join("\n")}
  function test_refuses_another_schema() public {
    (bool ok, ) = address(this).call(abi.encodeWithSelector(this.decodeOther.selector));
    require(!ok, "decoded a document of another schema");
  }
  function decodeOther() external pure { ExampleUnit.decodeDocument(hex"b100000000${hex(encodeRaw(UNIT, VALUES[0]!))}"); }
}
`);
const out = execFileSync("forge", ["test", "--offline", "-vv"], { cwd: dir, encoding: "utf8" });
console.log(out.split("\n").filter((l) => /PASS|FAIL|Suite result|Ran/.test(l)).join("\n"));
console.log(`(project: ${dir}; gas per decode in the lines above)`);
