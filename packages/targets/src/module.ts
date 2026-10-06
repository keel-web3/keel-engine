import { defineManifest } from "@keel-engine/runtime";

export const manifest = defineManifest({
  id: "keel/targets", version: "0.1.0", kind: "runtime",
  title: "Targets", description: "Resolve an authored age against a device's actual capabilities and budgets.",
  provides: ["target/policy@1.0.0"],
});
