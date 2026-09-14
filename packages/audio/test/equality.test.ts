// The equality tests against NOCTURNES and the proof of concept (equality.body.ts),
// run only where both references are on this machine; skipped, not failed, elsewhere.

import { test } from "node:test";
import { NOCTURNES, POC, hasNocturnes, hasPoc } from "./helpers.ts";

if (hasNocturnes && hasPoc) await import("./equality.body.ts");
else test("equality with NOCTURNES and the proof of concept", { skip: `references not on this machine (${hasNocturnes ? POC : NOCTURNES})` }, () => {});
