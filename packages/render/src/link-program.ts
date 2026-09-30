/** Link a pair of shaders without synchronizing on either compile before link. */
export function linkProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string, name = "Program"): WebGLProgram {
  const shaders: WebGLShader[] = [];
  const attached: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  let linked = false;
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error(`${name}: shader allocation failed`);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
    }
    program = gl.createProgram();
    if (!program) throw new Error(`${name}: program allocation failed`);
    for (const shader of shaders) {
      gl.attachShader(program, shader);
      attached.push(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const errors: string[] = [];
      for (const shader of shaders) {
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) errors.push(gl.getShaderInfoLog(shader) || "shader compile failed");
      }
      throw new Error(`${name}: ${errors.join("; ") || gl.getProgramInfoLog(program) || "program link failed"}`);
    }
    linked = true;
    return program;
  } finally {
    if (program) for (const shader of attached) gl.detachShader(program, shader);
    for (const shader of shaders) gl.deleteShader(shader);
    if (program && !linked) gl.deleteProgram(program);
  }
}
