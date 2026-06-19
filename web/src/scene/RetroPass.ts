import * as THREE from "three";

/**
 * Retro grade post-process (#90, experiment): chunky nearest-neighbour
 * PIXELATION + optional limited-palette POSTERIZE with a 2×2 ordered (Bayer)
 * dither — a Diablo-1-ish look layered on the existing 3D scene without touching
 * the renderer or art.
 *
 * Deterministic: the dither is a fixed screen/chunk-space Bayer pattern, no RNG,
 * so the Track-2 capture (§6) stays byte-stable. Meant to run LAST in the post
 * chain (after tonemap/sRGB) so it grades the final displayed image. GLSL1-style
 * (gl_FragColor / texture2D, no dynamic array indexing) to match the other
 * `three/addons` shader passes and compile on the WebGL1 fallback.
 *
 * Uniforms:
 * - `pixelSize`  chunk edge in framebuffer pixels (1 = no pixelation)
 * - `levels`     posterize steps per channel (0/1 = off; e.g. 6 = retro bands)
 * - `dither`     1 = ordered-dither before quantising (breaks flat banding)
 * - `resolution` framebuffer size in pixels (set by the renderer on resize)
 */
export const RetroShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2(1, 1) },
    pixelSize: { value: 1 },
    levels: { value: 0 },
    dither: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float pixelSize;
    uniform float levels;
    uniform float dither;
    varying vec2 vUv;

    // 2x2 Bayer ordered-dither threshold for chunk (px,py), as (-0.5 .. 0.5).
    // Arithmetic (no array indexing) so it compiles under GLSL ES 1.00 too.
    float bayer2(vec2 p) {
      vec2 q = mod(floor(p), 2.0);
      float v = mod(2.0 * q.x + 3.0 * q.y, 4.0); // → 0,2,3,1 in Bayer order
      return (v + 0.5) / 4.0 - 0.5;
    }

    void main() {
      // Pixelate: snap UV to a grid of pixelSize framebuffer pixels and sample
      // the cell centre — a nearest-neighbour downscale-and-upscale.
      vec2 cell = max(pixelSize, 1.0) / resolution;
      vec2 chunk = floor(vUv / cell);
      vec2 uv = (chunk + 0.5) * cell;
      vec3 col = texture2D(tDiffuse, uv).rgb;

      // Posterize to a limited palette (per channel), optionally dithered first.
      if (levels > 1.5) {
        float steps = levels - 1.0;
        if (dither > 0.5) col += bayer2(chunk) / steps;
        col = floor(col * steps + 0.5) / steps;
      }
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};
