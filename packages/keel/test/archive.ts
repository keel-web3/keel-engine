// A GitHub-shaped source archive of this checkout, built the way GitHub serves
// one (a gzip'd tar with everything under <repo>-<commit>/): only the files git
// would commit -- no node_modules, no dist/, no out/. Tests hand it to
// `keel module verify`'s own code path (verifyKeelModuleFromOrigin) through a
// fetch stub, which is exactly what a stranger's verification does, minus the
// network.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

function header(name: string, size: number, type: string): Uint8Array {
  const h = new Uint8Array(512);
  const put = (text: string, at: number, len: number) => h.set(new TextEncoder().encode(text).subarray(0, len), at);
  put(name, 0, 100);
  put("0000644\0", 100, 8);
  put("0000000\0", 108, 8);
  put("0000000\0", 116, 8);
  put(`${size.toString(8).padStart(11, "0")}\0`, 124, 12);
  put("00000000000\0", 136, 12);
  put("        ", 148, 8);
  put(type, 156, 1);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  let sum = 0;
  for (const b of h) sum += b;
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return h;
}

const pad = (n: number) => (512 - (n % 512)) % 512;

/** A tar.gz of `files` (path -> bytes) under `<root>/`. */
export function tarGz(root: string, files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [path, bytes] of files) {
    const name = `${root}/${path}`;
    if (name.length > 100) {
      const long = new TextEncoder().encode(`${name}\0`);
      parts.push(header("././@LongLink", long.byteLength, "L"), long, new Uint8Array(pad(long.byteLength)));
    }
    parts.push(header(name.slice(0, 100), bytes.byteLength, "0"), bytes, new Uint8Array(pad(bytes.byteLength)));
  }
  parts.push(new Uint8Array(1024));
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.byteLength; }
  return new Uint8Array(gzipSync(out));
}

/** Every file git would commit in this checkout (tracked, or untracked and not ignored). */
export function committedFiles(root: string): Map<string, Uint8Array> {
  const list = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString("utf8").split("\0").filter(Boolean).sort();
  return new Map(list.map((p) => [p, new Uint8Array(readFileSync(join(root, p)))]));
}

/** A fetch that serves one archive for any codeload URL, and records what was asked for. */
export function archiveFetch(archive: Uint8Array, asked: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    asked.push(String(input));
    return new Response(archive as Uint8Array<ArrayBuffer>, { status: 200, headers: { "content-type": "application/x-gzip" } });
  }) as typeof fetch;
}
