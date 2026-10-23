# Pinball visibility inspection

Use `createMeshVisibilityInspector(gl)` only in an explicit generator admission or review pass. Connect `inspect(buffer, [{mesh: ARENA_BODY_MESH_ID, owner: ownerId}])` to the arena view's optional `onMeshFrame`. The actual canonical integer G-buffer supplies depth-tested physical-body pixel counts and inclusive top-left picture bounds. Beacons, trails, pulses and overlays cannot satisfy a body target.

Readback synchronizes the GPU. Normal game rendering must omit this callback. Inspection preserves the read framebuffer, read buffer, pixel pack buffer and pack layout, bounds memory, and rejects shared-seam target identities. Dispose the inspector with its renderer.

For separate paddles that share a mesh and owner, pass each actual canonical `drawIndex` as a separate target. Each result then reports exactly that draw, including zero surviving pixels when its sibling is visible. The indexed mesh and owner must match the current draw list. Aggregate and indexed targets for the same mesh/owner cannot be mixed in one inspection; omitting the index retains the existing aggregate behavior.

These measurements are evidence for admission, not a complete art judge. Compare the projected body position, trajectory, capture state and frame identity before treating zero pixels as occlusion. A tiny surviving fragment or low contrast can still be unreadable. Human pixel review remains necessary.
