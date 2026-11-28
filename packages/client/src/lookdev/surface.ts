// What the look-development scenes draw on. A scene hands over filled shapes,
// ribbons and lettering in frame pixels (1920 by 1080); a surface puts them on
// a canvas. There are two, so the same scene can be timed on both: WebGL 2,
// which the scenes are drawn with, and Canvas 2D, which the bench compares it
// against (docs/decisions/0038-renderer-scale-and-the-siege.md) and which the
// page falls back to where there is no WebGL 2.

import { type Flat, HATCH_DX, HATCH_DY, hash, hatchLines, len, lerp, triangulate } from "./geom.ts";

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
  /**
   * Hatching over a simple polygon: strokes `spacing` px apart and `weight` px wide, counted from
   * the anchor so a shape that moves takes its hatching with it, falling from upper right to lower
   * left, or at right angles to that with `cross`.
   */
  hatch(
    xy: Flat,
    n: number,
    rgb: number,
    alpha: number,
    spacing: number,
    weight: number,
    cross: boolean,
  ): void;
  /**
   * What `paint` draws, kept as a picture under `name` and put down here. The picture is painted
   * again only when `key` differs from the last one it was painted for, so `key` has to change
   * whenever anything `paint` draws would. Layers do not nest.
   */
  layer(name: string, key: string, paint: () => void): void;
  /**
   * What `draw` lays, drawn here in its place among everything else, and kept under `name` so
   * that next time `key` is the same it is laid again as it was without `draw` running. `key` has
   * to hold everything `draw` depends on.
   */
  keep(name: string, key: readonly number[], draw: () => void): void;
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
/** Widths by face and size, then by the string: a lookup with no key to build. */
const widths = new Map<string, Map<number, Map<string, number>>>();

/** The width of a line of lettering, in frame pixels. */
export function measure(face: Face, size: number, s: string): number {
  let bySize = widths.get(face);
  if (!bySize) {
    bySize = new Map();
    widths.set(face, bySize);
  }
  let byString = bySize.get(size);
  if (!byString) {
    byString = new Map();
    bySize.set(size, byString);
  }
  const known = byString.get(s);
  if (known !== undefined) return known;
  // Outside a browser (the tests) there is nothing to measure with, so a fair guess for the face.
  if (!measurer && typeof document !== "undefined")
    measurer = document.createElement("canvas").getContext("2d");
  if (!measurer) return s.length * size * 0.46;
  measurer.font = fontOf(face, size);
  const width = measurer.measureText(s).width;
  // A stream letters numbers without end: start again rather than keep every one.
  if (byString.size > 20_000) byString.clear();
  byString.set(s, width);
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

// highp: the wash, grain and hatch lookups take frame pixels up to 1920, which mediump (fp16 on many
// phones) cannot hold to the pixel.
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_col;
in vec4 v_mat;
uniform sampler2D u_atlas;
uniform sampler2D u_noise;
uniform sampler2D u_paper;
uniform sampler2D u_layer;
out vec4 o;
void main() {
  int m = int(v_mat.x + 0.5);
  float a = v_col.a;
  if (m == 6) {
    // A layer, already drawn and with its alpha multiplied in.
    o = texture(u_layer, v_uv);
    return;
  } else if (m == 7) {
    // Hatching: strokes the spacing apart across the shape, counted from its anchor, as hatchLines
    // lays them. v_mat: spacing in px, half the stroke's width in 64ths of a px, crossed or not.
    vec2 dir = v_mat.w > 0.5 ? vec2(${HATCH_DY}, ${-HATCH_DX}) : vec2(${HATCH_DX}, ${HATCH_DY});
    float spacing = v_mat.y;
    float level = dot(v_uv, vec2(-dir.y, dir.x)) - 0.013;
    float k = floor(level / spacing + 0.5);
    float off = abs(level - k * spacing);
    // A hand's stroke is not even along its length: it thins a little here and there.
    float hand = texture(u_noise, vec2(dot(v_uv, dir) / 150.0, k * 0.071)).b;
    a *= clamp(v_mat.z / 64.0 * (0.8 + 0.4 * hand) + 0.5 - off, 0.0, 1.0);
  } else if (m == 1) {
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

/**
 * The rows of the glyph atlas written since it was last sent to the GPU, so only that band goes
 * up. A fresh atlas marks all of it.
 */
export class Band {
  y0 = Number.POSITIVE_INFINITY;
  y1 = Number.NEGATIVE_INFINITY;

  mark(y: number, h: number): void {
    this.y0 = Math.min(this.y0, Math.floor(y));
    this.y1 = Math.max(this.y1, Math.ceil(y + h));
  }

  /** The rows to send, from and to, and clears the band; null if nothing was written. */
  take(size: number): [number, number] | null {
    if (this.y1 <= this.y0) return null;
    const out: [number, number] = [Math.max(0, this.y0), Math.min(size, this.y1)];
    this.y0 = Number.POSITIVE_INFINITY;
    this.y1 = Number.NEGATIVE_INFINITY;
    return out[1] > out[0] ? out : null;
  }
}

/**
 * The strokes of a hatch, for a surface that lays them one by one: each piece of `hatchLines`
 * thicker in its first third and trimmed a little at both ends, as a hand does not start or stop
 * each stroke on the outline.
 */
export function hatchStrokes(
  xy: Flat,
  n: number,
  spacing: number,
  ax: number,
  ay: number,
  cross: boolean,
  weight: number,
  lay: (rib: number[]) => void,
): void {
  const cuts: number[] = [];
  const pieces = hatchLines(xy, n, spacing, ax, ay, cross, cuts);
  const rib: number[] = new Array(12);
  for (let k = 0; k < pieces; k++) {
    let x0 = cuts[k * 4] as number;
    let y0 = cuts[k * 4 + 1] as number;
    let x1 = cuts[k * 4 + 2] as number;
    let y1 = cuts[k * 4 + 3] as number;
    const length = len(x1 - x0, y1 - y0);
    const ux = (x1 - x0) / length;
    const uy = (y1 - y0) / length;
    const key = hash(Math.round(x0 - ax), Math.round(y0 - ay), k);
    const trim0 = Math.min(length * 0.3, 0.5 + key * 2.5);
    const trim1 = Math.min(length * 0.3, 0.5 + ((key * 7.3) % 1) * 3.5);
    x0 += ux * trim0;
    y0 += uy * trim0;
    x1 -= ux * trim1;
    y1 -= uy * trim1;
    const nx = (-uy * weight) / 2;
    const ny = (ux * weight) / 2;
    const mx = x0 + (x1 - x0) * 0.3;
    const my = y0 + (y1 - y0) * 0.3;
    rib[0] = x0 + nx * 0.6;
    rib[1] = y0 + ny * 0.6;
    rib[2] = x0 - nx * 0.6;
    rib[3] = y0 - ny * 0.6;
    rib[4] = mx + nx;
    rib[5] = my + ny;
    rib[6] = mx - nx;
    rib[7] = my - ny;
    rib[8] = x1 + nx * 0.3;
    rib[9] = y1 + ny * 0.3;
    rib[10] = x1 - nx * 0.3;
    rib[11] = y1 - ny * 0.3;
    lay(rib);
  }
}

/**
 * A ring cut into triangles: `n` corners, kept less the first from `at` in the surface's shapes,
 * and its triangles from `from` in its cuts, `count` indices into the ring.
 */
interface Ring {
  n: number;
  at: number;
  from: number;
  count: number;
}

/** Geometry kept by `keep`: what it was laid for, and its vertices and triangles from 0. */
interface Kept {
  key: number[];
  atlas: number;
  used: number;
  u32: Uint32Array;
  idx: Uint32Array;
}

const sameKey = (a: readonly number[], b: readonly number[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** One of a WebGL surface's layers: the picture, the multisampled target it is drawn on, and its key. */
interface GlLayer {
  key: string | null;
  texture: WebGLTexture;
  /** Resolves the multisampled drawing into `texture`. */
  resolved: WebGLFramebuffer;
  drawn: WebGLFramebuffer;
  /** The run of indices to draw into it at the end of this frame, if it is to be painted again. */
  paint: [number, number] | null;
}

/**
 * Where lettering goes in the glyph atlas: shelves filled left to right and top to bottom. The
 * atlas is started afresh only between frames, in `begin`, once it is three quarters full. A
 * fresh start inside a frame would wipe glyphs that quads already laid that frame point at, so
 * when a frame alone fills what is left, `place` gives no room and that string waits a frame.
 */
export class Shelves {
  x = 2;
  y = 2;
  h = 0;
  readonly size: number;
  constructor(size: number) {
    this.size = size;
  }

  /** Starts a frame. Returns true if the atlas is to be started afresh. */
  begin(): boolean {
    if (this.y <= this.size * 0.75) return false;
    this.reset();
    return true;
  }

  reset(): void {
    this.x = 2;
    this.y = 2;
    this.h = 0;
  }

  /** The top left of a free w by h place, or null if there is none left this frame. */
  place(w: number, h: number): [number, number] | null {
    if (w + 4 > this.size) return null;
    let x = this.x;
    let y = this.y;
    let shelf = this.h;
    if (x + w + 2 > this.size) {
      x = 2;
      y += shelf + 2;
      shelf = 0;
    }
    if (y + h + 2 > this.size) return null;
    this.x = x + w + 2;
    this.y = y;
    this.h = Math.max(shelf, h);
    return [x, y];
  }
}

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
  private readonly vbo: WebGLBuffer;
  private readonly ibo: WebGLBuffer;
  private vboSize = 0;
  private iboSize = 0;
  private readonly atlas: HTMLCanvasElement;
  private readonly atlasCtx: CanvasRenderingContext2D;
  private readonly atlasTex: WebGLTexture;
  private readonly band = new Band();
  private readonly glyphs = new Map<string, Glyphs>();
  private readonly shelves = new Shelves(ATLAS);
  private readonly layers = new Map<string, GlLayer>();
  private readonly samples: number;
  /** What the frame draws, in order: runs of indices (from, to), each with the layer it puts down or null. */
  private readonly runs: [number, number, GlLayer | null][] = [];
  private runFrom = 0;
  private painting = false;
  /** Geometry kept by `keep`, by name. */
  private readonly kept = new Map<string, Kept>();
  private frame = 0;
  /** Counts a fresh atlas, and lettering left out for want of room: either spoils what was kept. */
  private atlasGen = 0;
  private skipped = 0;

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
    gl.uniform1i(gl.getUniformLocation(program, "u_layer"), 3);
    this.samples = Math.min(4, Number(gl.getParameter(gl.MAX_SAMPLES)) || 0);

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
    // Read back a band at a time to go up to the GPU, so kept in memory rather than on the GPU.
    const ctx = this.atlas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context for lettering");
    this.atlasCtx = ctx;
    this.resetAtlas();
    this.atlasTex = texture(0, false);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, ATLAS, ATLAS);
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
    this.glyphs.clear();
    this.shelves.reset();
    this.band.mark(0, ATLAS);
    this.atlasGen++;
  }

  /** A layer's picture and the two framebuffers it is drawn through, made the first time it is asked for. */
  private makeLayer(): GlLayer {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, WIDTH, HEIGHT);
    // A picture bound for sampling while it is drawn to is an error, so none is left bound.
    gl.bindTexture(gl.TEXTURE_2D, null);
    const resolved = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, resolved);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    // Drawn multisampled, as the frame itself is, so a layer's edges are as smooth as the rest.
    let drawn = resolved;
    if (this.samples > 0) {
      drawn = gl.createFramebuffer();
      const store = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, store);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA8, WIDTH, HEIGHT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, drawn);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, store);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { key: null, texture, resolved, drawn, paint: null };
  }

  /** Ends the run of plain drawing laid since the last one ended. */
  private cut(): void {
    if (this.ni > this.runFrom) this.runs.push([this.runFrom, this.ni, null]);
    this.runFrom = this.ni;
  }

  private glyph(face: Face, size: number, s: string): Glyphs | null {
    const key = `${face}|${size}|${s}`;
    const known = this.glyphs.get(key);
    if (known) return known;
    const ctx = this.atlasCtx;
    ctx.font = fontOf(face, size);
    const pad = Math.ceil(size * 0.25);
    const w = Math.ceil(ctx.measureText(s).width) + pad * 2;
    const h = Math.ceil(size * 1.5);
    const at = this.shelves.place(w, h);
    if (!at) return null;
    const [x, y] = at;
    const base = Math.ceil(size * 1.08);
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(s, x + pad, y + base);
    this.band.mark(y, h);
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
    this.runs.length = 0;
    this.runFrom = 0;
    // A fresh atlas between frames, never inside one.
    if (this.shelves.begin()) this.resetAtlas();
    // What has not been asked for in ten seconds is let go.
    if (++this.frame % 600 === 0)
      for (const [name, k] of this.kept) if (this.frame - k.used > 600) this.kept.delete(name);
    this.paper(0, 0, WIDTH, HEIGHT);
  }

  keep(name: string, key: readonly number[], draw: () => void): void {
    const k = this.kept.get(name);
    if (k && k.atlas === this.atlasGen && sameKey(k.key, key)) {
      k.used = this.frame;
      const verts = k.u32.length / STRIDE;
      this.room(verts, k.idx.length);
      this.u32.set(k.u32, this.nv * STRIDE);
      const base = this.nv;
      const idx = this.idx;
      for (let i = 0; i < k.idx.length; i++) idx[this.ni++] = base + (k.idx[i] as number);
      this.nv += verts;
      return;
    }
    const v0 = this.nv;
    const i0 = this.ni;
    const { skipped, atlasGen } = this;
    draw();
    if (this.skipped !== skipped || this.atlasGen !== atlasGen) {
      this.kept.delete(name);
      return;
    }
    const idx = this.idx.slice(i0, this.ni);
    for (let i = 0; i < idx.length; i++) idx[i] = (idx[i] as number) - v0;
    this.kept.set(name, {
      key: Array.from(key),
      atlas: atlasGen,
      used: this.frame,
      u32: this.u32.slice(v0 * STRIDE, this.nv * STRIDE),
      idx,
    });
  }

  anchor(x: number, y: number): void {
    this.ax = x;
    this.ay = y;
  }

  /**
   * Rings already cut into triangles, by a hash of their shape. Their corners (less the first)
   * and their triangles are kept end to end in two arenas, which start again when full.
   */
  private readonly rings = new Map<number, Ring | Ring[]>();
  private shapes = new Float64Array(1 << 18);
  private shapesUsed = 0;
  private cuts = new Uint32Array(1 << 18);
  private cutsUsed = 0;
  private last: Ring | null = null;

  /** Whether the ring kept as `r` is the shape of these `n` points. */
  private same(r: Ring, xy: Flat, n: number, x0: number, y0: number): boolean {
    if (r.n !== n) return false;
    const rel = this.shapes;
    for (let i = 1, o = r.at; i < n; i++, o += 2) {
      const dx = (xy[i * 2] as number) - x0 - (rel[o] as number);
      const dy = (xy[i * 2 + 1] as number) - y0 - (rel[o + 1] as number);
      if (dx > 1e-6 || dx < -1e-6 || dy > 1e-6 || dy < -1e-6) return false;
    }
    return true;
  }

  /**
   * Triangles for a ring of `n` points, as a run of `this.cuts`, reusing those of a ring of the
   * same shape cut before: a body's paper, wash and hatch are one outline three times, and a
   * crowd draws the same few shapes in many places.
   */
  private cutRing(xy: Flat, n: number): Ring {
    const x0 = xy[0] as number;
    const y0 = xy[1] as number;
    const last = this.last;
    if (last && this.same(last, xy, n, x0, y0)) return last;
    let h = Math.imul(n, 0x9e3779b1);
    for (let i = 2; i < n * 2; i += 2) {
      h = Math.imul(h ^ ((((xy[i] as number) - x0) * 64) | 0), 0x01000193);
      h = Math.imul(h ^ ((((xy[i + 1] as number) - y0) * 64) | 0), 0x01000193);
    }
    const kept = this.rings.get(h);
    if (kept) {
      if (Array.isArray(kept)) {
        for (const r of kept)
          if (this.same(r, xy, n, x0, y0)) {
            this.last = r;
            return r;
          }
      } else if (this.same(kept, xy, n, x0, y0)) {
        this.last = kept;
        return kept;
      }
    }
    // A long stream draws shapes without end: start the arenas again rather than let them grow.
    if (this.shapesUsed + n * 2 > this.shapes.length || this.cutsUsed + n * 3 > this.cuts.length) {
      this.rings.clear();
      this.last = null;
      this.shapesUsed = 0;
      this.cutsUsed = 0;
      if (n * 3 > this.cuts.length) this.cuts = new Uint32Array(n * 3);
      if (n * 2 > this.shapes.length) this.shapes = new Float64Array(n * 2);
    }
    const ring: Ring = { n, at: this.shapesUsed, from: this.cutsUsed, count: 0 };
    ring.count = triangulate(xy, n, this.cuts, this.cutsUsed);
    this.cutsUsed += ring.count;
    const rel = this.shapes;
    for (let i = 1, o = ring.at; i < n; i++, o += 2) {
      rel[o] = (xy[i * 2] as number) - x0;
      rel[o + 1] = (xy[i * 2 + 1] as number) - y0;
    }
    this.shapesUsed += n * 2;
    // The arenas may have started again above, and the map with them: look again.
    const now = this.rings.get(h);
    if (!now) this.rings.set(h, ring);
    else if (Array.isArray(now)) now.push(ring);
    else this.rings.set(h, [now, ring]);
    this.last = ring;
    return ring;
  }

  hatch(
    xy: Flat,
    n: number,
    rgb: number,
    alpha: number,
    spacing: number,
    weight: number,
    cross: boolean,
  ): void {
    // The stroke's middle third is its full width; across a whole stroke it averages 0.7 of it.
    const half = Math.min(255, Math.round(weight * 0.7 * 32));
    this.fill(
      xy,
      n,
      rgb,
      alpha,
      (7 | (spacing << 8) | (half << 16) | ((cross ? 1 : 0) << 24)) >>> 0,
    );
  }

  poly(xy: Flat, n: number, rgb: number, alpha: number, wash = false): void {
    this.fill(xy, n, rgb, alpha, wash ? 2 : 0);
  }

  private fill(xy: Flat, n: number, rgb: number, alpha: number, mat: number): void {
    if (n < 3) return;
    this.room(n, (n - 2) * 3);
    const f = this.f32;
    const u = this.u32;
    const colour = GlSurface.pack(rgb, alpha);
    const first = this.nv;
    const { ax, ay } = this;
    let o = first * STRIDE;
    for (let i = 0; i < n; i++) {
      const x = xy[i * 2] as number;
      const y = xy[i * 2 + 1] as number;
      f[o] = x;
      f[o + 1] = y;
      f[o + 2] = x - ax;
      f[o + 3] = y - ay;
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
    const ring = this.cutRing(xy, n);
    const cuts = this.cuts;
    for (let i = ring.from, end = ring.from + ring.count; i < end; i++)
      idx[this.ni++] = first + (cuts[i] as number);
  }

  layer(name: string, key: string, paint: () => void): void {
    if (this.painting) throw new Error("layers do not nest");
    let layer = this.layers.get(name);
    if (!layer) {
      layer = this.makeLayer();
      this.layers.set(name, layer);
    }
    this.cut();
    if (layer.key !== key) {
      // Laid with the frame, drawn into the layer at its end, and not drawn on the frame itself.
      const from = this.ni;
      this.painting = true;
      try {
        paint();
      } finally {
        this.painting = false;
      }
      layer.paint = [from, this.ni];
      layer.key = key;
      this.runFrom = this.ni;
    }
    const from = this.ni;
    // Rows go up from the bottom in a texture drawn to, so its top is v = 1.
    this.quad(0, 0, WIDTH, 0, WIDTH, HEIGHT, 0, HEIGHT, 0, 1, 1, 0, 0xffffffff, 6);
    this.runs.push([from, this.ni, layer]);
    this.runFrom = this.ni;
  }

  strip(xy: Flat, n: number, rgb: number, alpha: number, wash = false): void {
    if (n < 2) return;
    this.room(n * 2, (n - 1) * 6);
    const f = this.f32;
    const u = this.u32;
    const colour = GlSurface.pack(rgb, alpha);
    const mat = wash ? 2 : 0;
    const first = this.nv;
    const { ax, ay } = this;
    let o = first * STRIDE;
    for (let i = 0; i < n * 2; i++) {
      const x = xy[i * 2] as number;
      const y = xy[i * 2 + 1] as number;
      f[o] = x;
      f[o + 1] = y;
      f[o + 2] = x - ax;
      f[o + 3] = y - ay;
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
    if (!g) {
      this.skipped++;
      return;
    }
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
    const band = this.band.take(ATLAS);
    if (band) {
      const [y0, y1] = band;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
      const rows = this.atlasCtx.getImageData(0, y0, ATLAS, y1 - y0);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, gl.RGBA, gl.UNSIGNED_BYTE, rows);
    }
    this.cut();
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
    // Layers painted again this frame first, each from clear, then resolved into its picture.
    for (const layer of this.layers.values()) {
      if (!layer.paint) continue;
      const [from, to] = layer.paint;
      layer.paint = null;
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.drawn);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawElements(gl.TRIANGLES, to - from, gl.UNSIGNED_INT, from * 4);
      if (layer.drawn !== layer.resolved) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, layer.drawn);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, layer.resolved);
        gl.blitFramebuffer(
          0,
          0,
          WIDTH,
          HEIGHT,
          0,
          0,
          WIDTH,
          HEIGHT,
          gl.COLOR_BUFFER_BIT,
          gl.NEAREST,
        );
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE3);
    for (const [from, to, layer] of this.runs) {
      if (layer) gl.bindTexture(gl.TEXTURE_2D, layer.texture);
      gl.drawElements(gl.TRIANGLES, to - from, gl.UNSIGNED_INT, from * 4);
    }
    // Nothing samples a layer's picture while it is drawn to: unbind it before the next frame.
    gl.bindTexture(gl.TEXTURE_2D, null);
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

/**
 * The same drawing through the browser's own canvas calls: for the bench, and for a browser with
 * no WebGL 2. Washes come out flat and a dry brush thins evenly.
 */
export class CanvasSurface implements Surface {
  readonly kind = "canvas";
  vertices = 0;
  private ctx: CanvasRenderingContext2D;
  private readonly frame: CanvasRenderingContext2D;
  private readonly styles = new Map<number, string>();
  private readonly grain: CanvasPattern | null;
  private readonly sheet: HTMLCanvasElement;
  private readonly layers = new Map<string, { key: string | null; canvas: HTMLCanvasElement }>();
  private ax = 0;
  private ay = 0;

  constructor(canvas: HTMLCanvasElement, sheet: HTMLCanvasElement) {
    this.sheet = sheet;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    this.frame = ctx;
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

  anchor(x: number, y: number): void {
    this.ax = x;
    this.ay = y;
  }

  hatch(
    xy: Flat,
    n: number,
    rgb: number,
    alpha: number,
    spacing: number,
    weight: number,
    cross: boolean,
  ): void {
    hatchStrokes(xy, n, spacing, this.ax, this.ay, cross, weight, (rib) =>
      this.strip(rib, 3, rgb, alpha),
    );
  }

  /** Canvas calls are made as they come, so there is nothing to keep: it draws every time. */
  keep(_name: string, _key: readonly number[], draw: () => void): void {
    draw();
  }

  layer(name: string, key: string, paint: () => void): void {
    if (this.ctx !== this.frame) throw new Error("layers do not nest");
    let layer = this.layers.get(name);
    if (!layer) {
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      layer = { key: null, canvas };
      this.layers.set(name, layer);
    }
    if (layer.key !== key) {
      const ctx = layer.canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context for a layer");
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      this.ctx = ctx;
      try {
        paint();
      } finally {
        this.ctx = this.frame;
      }
      layer.key = key;
    }
    this.ctx.drawImage(layer.canvas, 0, 0);
  }

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
