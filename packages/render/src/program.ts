import { linkProgram } from "./link-program.ts";
export interface Program<N extends string> {
  p: WebGLProgram;
  /** Uniform locations by name (an inactive one is absent: GL ignores a null location). */
  loc: Record<N, WebGLUniformLocation | null>;
}

export function program<N extends string>(gl: WebGL2RenderingContext, vs: string, fs: string): Program<N> {
  const p = linkProgram(gl, vs, fs, "Pixel renderer");
  try {
    const loc: Record<string, WebGLUniformLocation | null> = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i += 1) {
      const u = gl.getActiveUniform(p, i);
      if (u) loc[u.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, u.name);
    }
    return { p, loc: loc as Record<N, WebGLUniformLocation | null> };
  } catch (error) {
    gl.deleteProgram(p);
    throw error;
  }
}

