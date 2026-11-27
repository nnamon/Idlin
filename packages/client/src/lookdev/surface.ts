// What the look-development scenes draw on. A scene hands over filled shapes,
// ribbons and lettering in frame pixels (1920 by 1080); a surface puts them on
// a canvas. There are two, so the same scene can be timed on both: WebGL 2,
// which the scenes are drawn with, and Canvas 2D, which the bench compares it
// against (docs/decisions/0030-renderer-and-scale.md).

import { type Flat, hash, lerp, triangulate } from "./geom.ts";

export const WIDTH = 1920;
export const HEIGHT = 1080;

export type Face = "roman" | "italic" | "sc";
const FAMILY: Record<Face, string> = { roman: "Fell", italic: "Fell Italic", sc: "Fell SC" };
export const fontOf = (face: Face, size: number): string => `${size}px "${FAMILY[face]}"`;

export interface Surface {
  readonly kind: "webgl" | "canvas";
  /** Starts a frame on bare paper. */
  begin(): void;
  /** Where the texture of the next washes is pinned, so it travels with the thing washed. */
  anchor(x: number, y: number): void;
  /** A filled simple polygon. A wash takes the paper's unevenness. */
  poly(xy: Flat, n: number, rgb: number, alpha: number, wash?: boolean): void;
  /** A filled ribbon: `n` stations, each a left point and a right point. */
  strip(xy: Flat, n: number, rgb: number, alpha: number, wash?: boolean): void;
  /**
   * A dry-brush ribbon. `along` is each station's distance down the stroke in
   * pixels, `dry` how far the bristles have run out there (0 wet, 1 gone).
   */
  brush(
    xy: Flat,
    n: number,
    rgb: number,
    alpha: number,
    along: Flat,
    dry: Flat,
    seed: number,
  ): void;
  /** Lettering with its baseline starting at (x, y), turned by `rot`. */
  text(
    face: Face,
    size: number,
    s: string,
    x: number,
    y: number,
    rot: number,
    rgb: number,
    alpha: number,
  ): void;
  /** Bare paper over a rectangle, covering what was drawn there. */
  paper(x0: number, y0: number, x1: number, y1: number): void;
  /** Ends the frame: the paper's grain over everything, and the hour's cast. */
  end(cast: number): void;
  /** Waits for the frame to be drawn, for timing. */
  finish(): void;
  /** How many vertices the last frame took. */
  readonly vertices: number;
}

let measurer: CanvasRenderingContext2D | null = null;
const widths = new Map<string, number>();

/** The width of a line of lettering, in frame pixels. */
export function measure(face: Face, size: number, s: string): number {
  const key = `${face}|${size}|${s}`;
  const known = widths.get(key);
  if (known !== undefined) return known;
  if (!measurer) measurer = document.createElement("canvas").getContext("2d");
  if (!measurer) return s.length * size * 0.5;
  measurer.font = fontOf(face, size);
  const width = measurer.measureText(s).width;
  widths.set(key, width);
  return width;
}

/** Noise that repeats every `px` by `py` cells. */
function tileNoise(x: number, y: number, px: number, py: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number): number =>
    hash(((a % px) + px) % px, ((b % py) + py) % py, seed);
  return lerp(lerp(h(ix, iy), h(ix + 1, iy), ux), lerp(h(ix, iy + 1), h(ix + 1, iy + 1), ux), uy);
}

const NOISE = 256;

/**
 * The texture every uneven thing is cut from. Red: blotches, for washes and
 * the paper. Green: grain about six pixels across. Blue: streaks, for a brush
 * running dry.
 */
export function noisePixels(): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(new ArrayBuffer(NOISE * NOISE * 4));
  for (let y = 0; y < NOISE; y++) {
    for (let x = 0; x < NOISE; x++) {
      const u = x / NOISE;
      const v = y / NOISE;
      const blotch =
        tileNoise(u * 6, v * 6, 6, 6, 11) * 0.65 + tileNoise(u * 13, v * 13, 13, 13, 12) * 0.35;
      const grain =
        tileNoise(u * 16, v * 16, 16, 16, 13) * 0.6 + tileNoise(u * 37, v * 37, 37, 37, 14) * 0.4;
      const streak =
        tileNoise(u * 5, v * 96, 5, 96, 15) * 0.7 + tileNoise(u * 11, v * 41, 11, 41, 16) * 0.3;
      const o = (y * NOISE + x) * 4;
      data[o] = blotch * 255;
      data[o + 1] = grain * 255;
      data[o + 2] = streak * 255;
      data[o + 3] = 255;
    }
  }
  return data;
}

const VERTEX = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in vec4 a_col;
layout(location=3) in vec4 a_mat;
uniform vec2 u_size;
out vec2 v_uv;
out vec4 v_col;
out vec4 v_mat;
void main() {
  v_uv = a_uv;
  v_col = a_col;
  v_mat = a_mat * 255.0;
  gl_Position = vec4(a_pos.x / u_size.x * 2.0 - 1.0, 1.0 - a_pos.y / u_size.y * 2.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec4 v_col;
in vec4 v_mat;
uniform sampler2D u_atlas;
uniform sampler2D u_noise;
uniform sampler2D u_paper;
out vec4 o;
void main() {
  int m = int(v_mat.x + 0.5);
  float a = v_col.a;
  if (m == 1) {
    a *= texture(u_atlas, v_uv).r;
  } else if (m == 2) {
    // A wash dries unevenly: thinner where the paper took less of it.
    float blotch = texture(u_noise, v_uv / 310.0).r;
    float grain = texture(u_noise, v_uv / 96.0).g;
    a *= 0.74 + 0.36 * blotch + 0.16 * (grain - 0.5);
  } else if (m == 3) {
    // A brush running dry breaks into the tracks of its bristles.
    float streak = texture(u_noise, vec2(v_uv.x / 260.0 + v_mat.z / 255.0, v_uv.y * 0.19 + v_mat.z / 97.0)).b;
    float dry = v_mat.y / 255.0;
    a *= smoothstep(dry - 0.07, dry + 0.07, streak * 0.9 + 0.05);
  } else if (m == 4) {
    o = vec4(texture(u_paper, v_uv).rgb, 1.0);
    return;
  } else if (m == 5) {
    // The grain of the paper, multiplied over the finished frame.
    vec2 p = v_uv;
    float blotch = texture(u_noise, p / 520.0).r;
    float grain = texture(u_noise, p / 104.0).g;
    o = vec4(v_col.rgb * (1.0 - 0.035 * blotch - 0.05 * grain), 1.0);
    return;
  }
  o = vec4(v_col.rgb * a, a);
}`;

const STRIDE = 6;
const ATLAS = 2048;

interface Glyphs {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  w: number;
  h: number;
  pad: number;
  base: number;
}

export class GlSurface implements Surface {
  readonly kind = "webgl";
  vertices = 0;
  private readonly gl: WebGL2RenderingContext;
  private f32 = new Float32Array(STRIDE * 65536);
  private u32 = new Uint32Array(this.f32.buffer);
  private idx = new Uint32Array(65536 * 3);
  private nv = 0;
  private ni = 0;
  private ax = 0;
  private ay = 0;
  private readonly scratch = new Uint32Array(4096);
  private readonly vbo: WebGLBuffer;
  private readonly ibo: WebGLBuffer;
  private vboSize = 0;
  private iboSize = 0;
  private readonly atlas: HTMLCanvasElement;
  private readonly atlasCtx: CanvasRenderingContext2D;
  private readonly atlasTex: WebGLTexture;
  private atlasDirty = true;
  private readonly glyphs = new Map<string, Glyphs>();
  private shelfX = 2;
  private shelfY = 2;
  private shelfH = 0;

  constructor(canvas: HTMLCanvasElement, paper: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("no WebGL 2 context");
    this.gl = gl;
    const compile = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("no shader");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(`shader: ${gl.getShaderInfoLog(shader)}`);
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`program: ${gl.getProgramInfoLog(program)}`);
    gl.useProgram(program);
    gl.uniform2f(gl.getUniformLocation(program, "u_size"), WIDTH, HEIGHT);
    gl.uniform1i(gl.getUniformLocation(program, "u_atlas"), 0);
    gl.uniform1i(gl.getUniformLocation(program, "u_noise"), 1);
    gl.uniform1i(gl.getUniformLocation(program, "u_paper"), 2);

    this.vbo = gl.createBuffer();
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE * 4, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, STRIDE * 4, 16);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, STRIDE * 4, 20);

    const texture = (unit: number, repeat: boolean): WebGLTexture => {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return tex;
    };
    this.atlas = document.createElement("canvas");
    this.atlas.width = ATLAS;
    this.atlas.height = ATLAS;
    const ctx = this.atlas.getContext("2d", { willReadFrequently: false });
    if (!ctx) throw new Error("no 2d context for lettering");
    this.atlasCtx = ctx;
    this.resetAtlas();
    this.atlasTex = texture(0, false);
    texture(1, true);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      NOISE,
      NOISE,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      noisePixels(),
    );
    texture(2, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paper);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  private resetAtlas(): void {
    this.atlasCtx.fillStyle = "#000";
    this.atlasCtx.fillRect(0, 0, ATLAS, ATLAS);
    // One white texel block for anything that has no glyph.
    this.glyphs.clear();
    this.shelfX = 2;
    this.shelfY = 2;
    this.shelfH = 0;
    this.atlasDirty = true;
  }

  private glyph(face: Face, size: number, s: string): Glyphs {
    const key = `${face}|${size}|${s}`;
    const known = this.glyphs.get(key);
    if (known) return known;
    const ctx = this.atlasCtx;
    ctx.font = fontOf(face, size);
    const pad = Math.ceil(size * 0.25);
    const w = Math.ceil(ctx.measureText(s).width) + pad * 2;
    const h = Math.ceil(size * 1.5);
    if (this.shelfX + w + 2 > ATLAS) {
      this.shelfX = 2;
      this.shelfY += this.shelfH + 2;
      this.shelfH = 0;
    }
    if (this.shelfY + h + 2 > ATLAS) {
      this.resetAtlas();
      ctx.font = fontOf(face, size);
    }
    const x = this.shelfX;
    const y = this.shelfY;
    const base = Math.ceil(size * 1.08);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(s, x + pad, y + base);
    this.shelfX += w + 2;
    this.shelfH = Math.max(this.shelfH, h);
    this.atlasDirty = true;
    const made = {
      u0: x / ATLAS,
      v0: y / ATLAS,
      u1: (x + w) / ATLAS,
      v1: (y + h) / ATLAS,
      w,
      h,
      pad,
      base,
    };
    this.glyphs.set(key, made);
    return made;
  }

  private room(verts: number, indices: number): void {
    if ((this.nv + verts) * STRIDE > this.f32.length) {
      const next = new Float32Array(Math.max(this.f32.length * 2, (this.nv + verts) * STRIDE));
      next.set(this.f32);
      this.f32 = next;
      this.u32 = new Uint32Array(next.buffer);
    }
    if (this.ni + indices > this.idx.length) {
      const next = new Uint32Array(Math.max(this.idx.length * 2, this.ni + indices));
      next.set(this.idx);
      this.idx = next;
    }
  }

  private static pack(rgb: number, alpha: number): number {
    const a = alpha >= 1 ? 255 : alpha <= 0 ? 0 : (alpha * 255 + 0.5) | 0;
    return ((a << 24) | ((rgb & 255) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 255)) >>> 0;
  }

  begin(): void {
    this.nv = 0;
    this.ni = 0;
    this.paper(0, 0, WIDTH, HEIGHT);
  }

  anchor(x: number, y: number): void {
    this.ax = x;
    this.ay = y;
  }

  poly(xy: Flat, n: number, rgb: number, alpha: number, wash = false): void {
    if (n < 3) return;
    this.room(n, (n - 2) * 3);
    const f = this.f32;
    const u = this.u32;
    const colour = GlSurface.pack(rgb, alpha);
    const mat = wash ? 2 : 0;
    const first = this.nv;
    let o = first * STRIDE;
    for (let i = 0; i < n; i++) {
      const x = xy[i * 2] as number;
      const y = xy[i * 2 + 1] as number;
      f[o] = x;
      f[o + 1] = y;
      f[o + 2] = x - this.ax;
      f[o + 3] = y - this.ay;
      u[o + 4] = colour;
      u[o + 5] = mat;
      o += STRIDE;
    }
    this.nv += n;
    const idx = this.idx;
    if (n <= 4) {
      idx[this.ni++] = first;
      idx[this.ni++] = first + 1;
      idx[this.ni++] = first + 2;
      if (n === 4) {
        idx[this.ni++] = first;
        idx[this.ni++] = first + 2;
        idx[this.ni++] = first + 3;
      }
      return;
    }
    const scratch = n * 3 <= this.scratch.length ? this.scratch : new Uint32Array(n * 3);
    const count = triangulate(xy, n, scratch);
    for (let i = 0; i < count; i++) idx[this.ni++] = first + (scratch[i] as number);
  }

  strip(xy: Flat, n: number, rgb: number, alpha: number, wash = false): void {
    if (n < 2) return;
    this.room(n * 2, (n - 1) * 6);
    const f = this.f32;
    const u = this.u32;
    const colour = GlSurface.pack(rgb, alpha);
    const mat = wash ? 2 : 0;
    const first = this.nv;
    let o = first * STRIDE;
    for (let i = 0; i < n * 2; i++) {
      const x = xy[i * 2] as number;
      const y = xy[i * 2 + 1] as number;
      f[o] = x;
      f[o + 1] = y;
      f[o + 2] = x - this.ax;
      f[o + 3] = y - this.ay;
      u[o + 4] = colour;
      u[o + 5] = mat;
      o += STRIDE;
    }
    this.nv += n * 2;
    this.ribbon(first, n);
  }

  private ribbon(first: number, n: number): void {
    const idx = this.idx;
    for (let i = 0; i + 1 < n; i++) {
      const a = first + i * 2;
      idx[this.ni++] = a;
      idx[this.ni++] = a + 1;
      idx[this.ni++] = a + 2;
      idx[this.ni++] = a + 1;
      idx[this.ni++] = a + 3;
      idx[this.ni++] = a + 2;
    }
  }

  brush(
    xy: Flat,
    n: number,
    rgb: number,
    alpha: number,
    along: Flat,
    dry: Flat,
    seed: number,
  ): void {
    if (n < 2) return;
    this.room(n * 2, (n - 1) * 6);
    const f = this.f32;
    const u = this.u32;
    const colour = GlSurface.pack(rgb, alpha);
    const first = this.nv;
    let o = first * STRIDE;
    const s = (seed & 255) << 16;
    for (let i = 0; i < n * 2; i++) {
      const station = i >> 1;
      const lx = xy[station * 4] as number;
      const ly = xy[station * 4 + 1] as number;
      const rx = xy[station * 4 + 2] as number;
      const ry = xy[station * 4 + 3] as number;
      const half = Math.hypot(rx - lx, ry - ly) / 2;
      f[o] = xy[i * 2] as number;
      f[o + 1] = xy[i * 2 + 1] as number;
      f[o + 2] = along[station] as number;
      f[o + 3] = i & 1 ? half : -half;
      u[o + 4] = colour;
      const d = Math.max(0, Math.min(255, ((dry[station] as number) * 255) | 0));
      u[o + 5] = (3 | (d << 8) | s) >>> 0;
      o += STRIDE;
    }
    this.nv += n * 2;
    this.ribbon(first, n);
  }

  private quad(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    colour: number,
    mat: number,
  ): void {
    this.room(4, 6);
    const f = this.f32;
    const u = this.u32;
    const first = this.nv;
    let o = first * STRIDE;
    const put = (x: number, y: number, s: number, t: number): void => {
      f[o] = x;
      f[o + 1] = y;
      f[o + 2] = s;
      f[o + 3] = t;
      u[o + 4] = colour;
      u[o + 5] = mat;
      o += STRIDE;
    };
    put(x0, y0, u0, v0);
    put(x1, y1, u1, v0);
    put(x2, y2, u1, v1);
    put(x3, y3, u0, v1);
    this.nv += 4;
    const idx = this.idx;
    idx[this.ni++] = first;
    idx[this.ni++] = first + 1;
    idx[this.ni++] = first + 2;
    idx[this.ni++] = first;
    idx[this.ni++] = first + 2;
    idx[this.ni++] = first + 3;
  }

  text(
    face: Face,
    size: number,
    s: string,
    x: number,
    y: number,
    rot: number,
    rgb: number,
    alpha: number,
  ): void {
    if (s === "" || alpha <= 0) return;
    const g = this.glyph(face, size, s);
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const lx = -g.pad;
    const ty = -g.base;
    const rx = g.w - g.pad;
    const by = g.h - g.base;
    this.quad(
      x + lx * cos - ty * sin,
      y + lx * sin + ty * cos,
      x + rx * cos - ty * sin,
      y + rx * sin + ty * cos,
      x + rx * cos - by * sin,
      y + rx * sin + by * cos,
      x + lx * cos - by * sin,
      y + lx * sin + by * cos,
      g.u0,
      g.v0,
      g.u1,
      g.v1,
      GlSurface.pack(rgb, alpha),
      1,
    );
  }

  paper(x0: number, y0: number, x1: number, y1: number): void {
    this.quad(
      x0,
      y0,
      x1,
      y0,
      x1,
      y1,
      x0,
      y1,
      x0 / WIDTH,
      y0 / HEIGHT,
      x1 / WIDTH,
      y1 / HEIGHT,
      0xffffffff,
      4,
    );
  }

  end(cast: number): void {
    const gl = this.gl;
    if (this.atlasDirty) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas);
      this.atlasDirty = false;
    }
    const body = this.ni;
    this.quad(
      0,
      0,
      WIDTH,
      0,
      WIDTH,
      HEIGHT,
      0,
      HEIGHT,
      0,
      0,
      WIDTH,
      HEIGHT,
      GlSurface.pack(cast, 1),
      5,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const verts = this.f32.subarray(0, this.nv * STRIDE);
    if (verts.byteLength > this.vboSize) {
      gl.bufferData(gl.ARRAY_BUFFER, this.f32, gl.DYNAMIC_DRAW);
      this.vboSize = this.f32.byteLength;
    } else gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
    const indices = this.idx.subarray(0, this.ni);
    if (indices.byteLength > this.iboSize) {
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.idx, gl.DYNAMIC_DRAW);
      this.iboSize = this.idx.byteLength;
    } else gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, indices);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawElements(gl.TRIANGLES, body, gl.UNSIGNED_INT, 0);
    gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, body * 4);
    this.vertices = this.nv;
  }

  finish(): void {
    // Reading a pixel back makes the driver finish the frame.
    const gl = this.gl;
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  }
}

/** The same drawing through the browser's own canvas calls, for the bench. */
export class CanvasSurface implements Surface {
  readonly kind = "canvas";
  vertices = 0;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly styles = new Map<number, string>();
  private readonly grain: CanvasPattern | null;
  private readonly sheet: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, sheet: HTMLCanvasElement) {
    this.sheet = sheet;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    const tile = document.createElement("canvas");
    tile.width = NOISE;
    tile.height = NOISE;
    const tileCtx = tile.getContext("2d");
    if (tileCtx) {
      const noise = noisePixels();
      const image = tileCtx.createImageData(NOISE, NOISE);
      for (let i = 0; i < NOISE * NOISE; i++) {
        const v =
          255 *
          (1 -
            0.05 * ((noise[i * 4] as number) / 255) -
            0.07 * ((noise[i * 4 + 1] as number) / 255));
        image.data[i * 4] = v;
        image.data[i * 4 + 1] = v;
        image.data[i * 4 + 2] = v;
        image.data[i * 4 + 3] = 255;
      }
      tileCtx.putImageData(image, 0, 0);
    }
    this.grain = ctx.createPattern(tile, "repeat");
  }

  private style(rgb: number, alpha: number): void {
    const a = alpha >= 1 ? 255 : alpha <= 0 ? 0 : (alpha * 255 + 0.5) | 0;
    const key = rgb * 256 + a;
    let css = this.styles.get(key);
    if (!css) {
      css = `rgba(${(rgb >> 16) & 255},${(rgb >> 8) & 255},${rgb & 255},${a / 255})`;
      this.styles.set(key, css);
    }
    this.ctx.fillStyle = css;
  }

  begin(): void {
    this.vertices = 0;
    this.ctx.drawImage(this.sheet, 0, 0);
  }

  anchor(): void {}

  poly(xy: Flat, n: number, rgb: number, alpha: number): void {
    if (n < 3) return;
    const ctx = this.ctx;
    this.style(rgb, alpha);
    ctx.beginPath();
    ctx.moveTo(xy[0] as number, xy[1] as number);
    for (let i = 1; i < n; i++) ctx.lineTo(xy[i * 2] as number, xy[i * 2 + 1] as number);
    ctx.fill();
    this.vertices += n;
  }

  strip(xy: Flat, n: number, rgb: number, alpha: number): void {
    if (n < 2) return;
    const ctx = this.ctx;
    this.style(rgb, alpha);
    ctx.beginPath();
    ctx.moveTo(xy[0] as number, xy[1] as number);
    for (let i = 1; i < n; i++) ctx.lineTo(xy[i * 4] as number, xy[i * 4 + 1] as number);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(xy[i * 4 + 2] as number, xy[i * 4 + 3] as number);
    ctx.fill();
    this.vertices += n * 2;
  }

  brush(xy: Flat, n: number, rgb: number, alpha: number, _along: Flat, dry: Flat): void {
    // No bristle tracks here: the stroke thins by its mean dryness instead.
    let sum = 0;
    for (let i = 0; i < n; i++) sum += dry[i] as number;
    this.strip(xy, n, rgb, alpha * (1 - 0.6 * (sum / Math.max(1, n))));
  }

  text(
    face: Face,
    size: number,
    s: string,
    x: number,
    y: number,
    rot: number,
    rgb: number,
    alpha: number,
  ): void {
    const ctx = this.ctx;
    this.style(rgb, alpha);
    ctx.font = fontOf(face, size);
    ctx.textBaseline = "alphabetic";
    if (rot === 0) ctx.fillText(s, x, y);
    else {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.fillText(s, 0, 0);
      ctx.restore();
    }
  }

  paper(x0: number, y0: number, x1: number, y1: number): void {
    this.ctx.drawImage(this.sheet, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  }

  end(cast: number): void {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = "multiply";
    if (this.grain) {
      ctx.fillStyle = this.grain;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    if (cast !== 0xffffff) {
      this.style(cast, 1);
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  finish(): void {
    this.ctx.getImageData(0, 0, 1, 1);
  }
}
