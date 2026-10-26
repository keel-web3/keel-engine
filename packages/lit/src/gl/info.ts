// Ported from Three.js r180's renderers/webgl/WebGLInfo.js (MIT, see
// packages/lit/NOTICE): what the renderer holds and what the last frame drew.

/** r180's WebGLInfo. */
export interface Info {
  memory: { geometries: number; textures: number };
  render: { frame: number; calls: number; triangles: number; points: number; lines: number };
  /** The live programs (the renderer sets this to its program cache's list). */
  programs: unknown[] | null;
  autoReset: boolean;
  reset(): void;
  update(count: number, mode: number, instanceCount: number): void;
}

export function createInfo(gl: WebGL2RenderingContext): Info {
  const memory = {
    geometries: 0,
    textures: 0,
  };

  const render = {
    frame: 0,
    calls: 0,
    triangles: 0,
    points: 0,
    lines: 0,
  };

  function update(count: number, mode: number, instanceCount: number): void {
    render.calls++;

    switch (mode) {
      case gl.TRIANGLES:
        render.triangles += instanceCount * (count / 3);
        break;

      case gl.LINES:
        render.lines += instanceCount * (count / 2);
        break;

      case gl.LINE_STRIP:
        render.lines += instanceCount * (count - 1);
        break;

      case gl.LINE_LOOP:
        render.lines += instanceCount * count;
        break;

      case gl.POINTS:
        render.points += instanceCount * count;
        break;

      default:
        console.error("keel/lit Info: Unknown draw mode:", mode);
        break;
    }
  }

  function reset(): void {
    render.calls = 0;
    render.triangles = 0;
    render.points = 0;
    render.lines = 0;
  }

  return {
    memory: memory,
    render: render,
    programs: null,
    autoReset: true,
    reset: reset,
    update: update,
  };
}
