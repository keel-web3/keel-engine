// Ported from Three.js r180's renderers/webgl/WebGLExtensions.js (MIT, see
// packages/lit/NOTICE): the context's extensions, asked for once each.

// (r180's utils.warnOnce)
const _warned = new Set<string>();
function warnOnce(message: string): void {
  if (_warned.has(message)) return;
  _warned.add(message);
  console.warn(message);
}

/** An extension object: its constants and methods, as the context hands it over. */
export type GLExtension = any;

/** r180's WebGLExtensions. */
export interface Extensions {
  has(name: string): boolean;
  init(): void;
  get(name: string): GLExtension;
}

export function createExtensions(gl: WebGL2RenderingContext): Extensions {
  const extensions: Record<string, GLExtension> = {};

  function getExtension(name: string): GLExtension {
    if (extensions[name] !== undefined) {
      return extensions[name];
    }

    let extension: GLExtension;

    switch (name) {
      case "WEBGL_depth_texture":
        extension = gl.getExtension("WEBGL_depth_texture") || gl.getExtension("MOZ_WEBGL_depth_texture") || gl.getExtension("WEBKIT_WEBGL_depth_texture");
        break;

      case "EXT_texture_filter_anisotropic":
        extension = gl.getExtension("EXT_texture_filter_anisotropic") || gl.getExtension("MOZ_EXT_texture_filter_anisotropic") || gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
        break;

      case "WEBGL_compressed_texture_s3tc":
        extension = gl.getExtension("WEBGL_compressed_texture_s3tc") || gl.getExtension("MOZ_WEBGL_compressed_texture_s3tc") || gl.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");
        break;

      case "WEBGL_compressed_texture_pvrtc":
        extension = gl.getExtension("WEBGL_compressed_texture_pvrtc") || gl.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");
        break;

      default:
        extension = gl.getExtension(name);
    }

    extensions[name] = extension;

    return extension;
  }

  return {
    has: function (name: string): boolean {
      return getExtension(name) !== null;
    },

    init: function (): void {
      getExtension("EXT_color_buffer_float");
      getExtension("WEBGL_clip_cull_distance");
      getExtension("OES_texture_float_linear");
      getExtension("EXT_color_buffer_half_float");
      getExtension("WEBGL_multisampled_render_to_texture");
      getExtension("WEBGL_render_shared_exponent");
    },

    get: function (name: string): GLExtension {
      const extension = getExtension(name);

      if (extension === null) {
        warnOnce("keel/lit renderer: " + name + " extension not supported.");
      }

      return extension;
    },
  };
}
