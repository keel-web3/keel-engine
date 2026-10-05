# Optional KEEL tooling plugins

The engine and SDK/MCP stay reusable. Optional packages provide their own tools and dependencies through an explicit local registry. `@keel-engine/react` is the reusable React/design adapter in this repo. `keel-web3/keel-trailer` is a separate private repository; no trailer sources, captures, ROMs, private fonts or render artifacts are carried in the public engine/SDK.

```sh
git clone git@github.com:keel-web3/keel-trailer.git ../keel-trailer
# Install trailer dependencies/runtime according to its README.
node tools/plugins.mjs install ../keel-trailer
node tools/plugins.mjs install ./packages/react
node tools/plugins.mjs list
keel-mcp --workspace /path/to/project --self-test
# Removal affects the registry only, never deletes source:
node tools/plugins.mjs remove keel/trailer
```

`install` validates `keel.plugin.json`, verifies its entry remains inside the package, then atomically updates `~/.keel/plugins.json`. Other installed entries are preserved; an exclusive lock prevents lost concurrent writes. An existing lock causes an actionable filesystem error; inspect it before removing a stale one. `--config /path/to/registry.json` or `KEEL_MCP_PLUGIN_CONFIG` selects another registry. Restart the MCP host to refresh tools. Installed local code is trusted and runs with server permissions: this is not a plugin sandbox. No automatic discovery from untrusted project files, URLs or registries, and no automatic code download.

Package manifest:

```json
{"schema":"keel-plugin@1","id":"keel/example","version":"0.1.0","entry":"src/mcp.mjs","capabilities":["mcp"]}
```

The entry exports `keelPlugin = {apiVersion:1,id,version,instructions?,tools}`. Each tool has an object-root JSON schema and `async run({workspace}, input)`. The public SDK loader checks versions, identity, descriptors and tool collisions before exposing them, preserving standard KEEL tools. Plugins validate their own inputs and use workspace helpers for project paths. No external package dependency is added to the MCP core. `keel-plugins-list` returns identities, versions and tools so agents can discover installed capabilities.

Tooling plugins are separate from `KEEL_ENGINE` runtime modules. That registry already resolves canonical module manifests/factories and versioned contracts. A tooling install does not register onchain bytes, publish a module, substitute a shell or establish canonical protection. React is an optional host dependency; game logic/rendering/data remain in their declared KEEL modules.
