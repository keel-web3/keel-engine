# KEEL React plugin

React hosts the actual KEEL engine. `@keel-engine/react` connects its registry, pixel renderer, theme recipes, state and inspection to React without replacing source generators or changing existing project UI. This is an optional host adapter; non-React games do not depend on React.

```sh
# Engine workspace (Node >=22.18)
pnpm install --frozen-lockfile
node tools/plugins.mjs install ./packages/react
# MCP must include the optional-plugin loader; restart its host after installation.
keel-mcp --self-test
```

MCP tools: `keel-react-catalog` returns the design language and API map; `keel-react-plan` returns an editable source/engine/capture plan; `keel-react-theme` returns the actual seeded `keel/ui` theme, palette and CSS variables; `keel-react-scaffold` writes an additive example and JSON plan, refusing overwrites. Schemas are exported as `TOOL_SCHEMAS` from `src/mcp.mjs`. It does not download assets, install packages, sign or publish. Plans identify canonical module IDs; they do not attest a registered onchain React runtime.

In a React client component:

```tsx
import {KeelProvider, useKeelModule, KeelCanvas, KeelTheme} from '@keel-engine/react';
import '@keel-engine/react/styles.css';
// Create/register the canonical engine modules once outside React rendering.
// <KeelProvider engine={engine}> ... </KeelProvider>
// useKeelModule('your/game') returns its exact started API, or undefined while starting.
// <KeelCanvas setup={setup} draw={(renderer,{frame,seconds})=>renderer.render(...)} />
```

`KeelProvider` starts one supplied registry once, including React Strict Mode; it never copies a module API or assumes page globals. `useKeelStore` subscribes via React's external-store API with the original server snapshot: pass immutable snapshots, reuse identities until state changes, and serialize the same initial state for hydration. Scene ticks update the engine directly rather than rerendering React every frame. Provider errors are available through `useKeelEngine` and `onError`.

`KeelCanvas` creates a fresh owned canvas and the canonical `createPixelRenderer`. Its `setup(renderer,canvas)` can return a cleanup function. `draw(renderer,{frame,seconds,delta})` uses an explicit fixed frame clock. `onReady({canvas,renderer,clock})` supports `clock.pause()` / `clock.seek(frame)` for captures. Unmount cancels pending animation, runs caller cleanup and releases that owned GL context. Contexts from existing REDLINE/CRUCIBLE scenes remain owned by those scenes; use their own destroy/update API when adapting them rather than mounting a second renderer. Integer display scale is explicit; `integerFit` reports overflow when the viewport is smaller than a source pixel picture, without fractional resampling.

`KeelTheme` scopes CSS variables to its subtree, using the actual `themeOf` recipe. `KeelButton` and `KeelPanel` are semantic accessible DOM primitives using those roles. The shared language is seeded semantic palettes, whole-pixel spacing/type/borders, project-owned type, deterministic frame convention, and controls tied to their authored world surfaces. DOM primitives expose core theme roles; they do not reproduce every generated frame, font or UI decoration. For exact native UI, keep `keel/ui`'s retained layer and its canvas/GL presenter in the scene. These primitives impose no global CSS or app layout.

Register exact source state through `useKeelInspection(probe,id,'mesh'|'graph'|'grid'|'state',read)`. The optional private trailer plugin supplies a probe; the React adapter accepts it structurally and has no trailer dependency. Readers must synchronously export actual buffers/state. Hidden GPU objects are not reconstructed.

Reference patterns were read from REDLINE's React engine host and CRUCIBLE's React package room. Those applications are not migrated or deployed by installing this plugin. The small `examples/KeelDemo.tsx` is a new browser fixture, using canonical theme and renderer APIs; it does not copy their fonts, meshes or branding.

The adapter lives in the engine checkout and uses the engine workspace package names. A host can use a shared pnpm workspace including the engine or vendor the required engine source packages as CRUCIBLE does. An npm or onchain distribution of React itself is not implemented. Peer support is React 18.3 and 19; validation records the exact tested version.
