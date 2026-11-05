import { RENDER, TEXT, VIEW } from '../config';
import type { Atlas, Region } from './atlas';
import { KEYFRAMES, PALETTE_SIZE, paletteData, voidColor } from './palette';

// WebGL2 batcher for the smooth poster look.
//
// - Every draw is one instance of a unit quad: where it goes (logical units), which atlas
//   texels give its coverage, and a top and bottom color (palette indices) and alpha. Solid
//   shapes use the same color twice; gradients use two. The whole frame is one draw call.
// - Colors are looked up per vertex from two rows of the palette texture (two times of day)
//   and blended, so the day cycle recolors everything for free.
// - The logical height is fixed (VIEW.h); the width follows the screen within VIEW.minW..maxW.

const VERT = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aDst;   // x, y, w, h in units
layout(location = 2) in vec4 aSrc;   // u, v, w, h in atlas texels (negative w flips)
layout(location = 3) in vec4 aColor; // top index, bottom index, top alpha, bottom alpha
uniform float uScale;   // device px per unit
uniform vec2 uOrigin;   // device px of the view's top-left, shake included
uniform vec2 uTarget;   // canvas size in device px
uniform sampler2D uPalette;
uniform vec3 uDay;      // palette row a, row b, blend
out vec2 vUV;
flat out vec4 vClamp;
out vec4 vColor;
vec3 pal(float i) {
  vec3 a = texelFetch(uPalette, ivec2(int(i), int(uDay.x)), 0).rgb;
  vec3 b = texelFetch(uPalette, ivec2(int(i), int(uDay.y)), 0).rgb;
  return mix(a, b, uDay.z);
}
void main() {
  vec2 p = uOrigin + (aDst.xy + aCorner * aDst.zw) * uScale;
  vec2 clip = p / uTarget * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vUV = aSrc.xy + aCorner * aSrc.zw;
  vec2 lo = min(aSrc.xy, aSrc.xy + aSrc.zw);
  vec2 hi = max(aSrc.xy, aSrc.xy + aSrc.zw);
  vClamp = vec4(lo + 0.5, hi - 0.5);
  float t = aCorner.y;
  vColor = vec4(mix(pal(aColor.x), pal(aColor.y), t), mix(aColor.z, aColor.w, t));
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uAtlas;
uniform vec2 uAtlasSize;
in vec2 vUV;
flat in vec4 vClamp;
in vec4 vColor;
out vec4 outColor;
void main() {
  float cov = texture(uAtlas, clamp(vUV, vClamp.xy, vClamp.zw) / uAtlasSize).r;
  float a = vColor.a * cov;
  if (a < 0.004) discard;
  outColor = vec4(vColor.rgb, a);
}`;

const FLOATS = 12; // per instance: dst 4, src 4, color 4

export class Renderer {
  // Device px per unit, the view's width in units, and where the view sits on the canvas.
  scale = 1;
  viewW: number = VIEW.minW;
  originX = 0;
  originY = 0;
  // Safe-area insets in units: where the notch and home bar cover the view.
  insetL = 0;
  insetR = 0;
  insetB = 0;
  lastCount = 0;
  private readonly canvas: HTMLCanvasElement;
  private readonly atlas: Atlas;
  private gl!: WebGL2RenderingContext;
  private program!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private instanceBuffer!: WebGLBuffer;
  private u!: Record<'scale' | 'origin' | 'target' | 'day' | 'atlas' | 'palette' | 'atlasSize', WebGLUniformLocation | null>;
  private readonly data = new Float32Array(RENDER.maxInstances * FLOATS);
  private count = 0;
  private frameCount = 0;
  private started = false;
  private dayA = 0;
  private dayB = 0;
  private dayMix = 0;
  private shakeX = 0;
  private shakeY = 0;
  private lost = false;

  constructor(canvas: HTMLCanvasElement, atlas: Atlas) {
    this.canvas = canvas;
    this.atlas = atlas;
    // iOS drops the GL context under memory pressure or in the background; everything the GPU
    // holds can be rebuilt from the CPU copies, so just set it all up again.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.initGL();
      this.lost = false;
    });
    this.initGL();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // iOS fills in the safe-area insets after the first layout, which resizes the canvas
    // without a window resize. Watching the canvas itself catches that.
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(canvas);
    // The canvas fills the screen, so a change of insets alone (rotating the notch to the other
    // side) only shows up on the element that carries them.
    const safe = document.getElementById('safe');
    if (safe) observer.observe(safe, { box: 'border-box' });
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    // Fill the height; the width follows, clamped (letterboxed beyond the clamp).
    this.scale = h / VIEW.h;
    this.viewW = w / this.scale;
    if (this.viewW < VIEW.minW) {
      this.scale = w / VIEW.minW;
      this.viewW = VIEW.minW;
    } else if (this.viewW > VIEW.maxW) {
      this.viewW = VIEW.maxW;
    }
    this.originX = Math.floor((w - this.viewW * this.scale) / 2);
    this.originY = Math.floor((h - VIEW.h * this.scale) / 2);
    const safe = document.getElementById('safe');
    if (safe) {
      const css = getComputedStyle(safe);
      const units = (px: string) => ((parseFloat(px) || 0) * dpr) / this.scale;
      this.insetL = units(css.paddingLeft);
      this.insetR = units(css.paddingRight);
      this.insetB = units(css.paddingBottom);
    }
  }

  // Which two palette rows to blend this frame, and how far (0 = all a, 1 = all b).
  setDay(a: number, b: number, mix: number): void {
    this.dayA = a;
    this.dayB = b;
    this.dayMix = mix;
  }

  // Whole-screen offset in units.
  setShake(x: number, y: number): void {
    this.shakeX = x;
    this.shakeY = y;
  }

  begin(): void {
    this.count = 0;
    this.frameCount = 0;
  }

  // A shape at its natural size, or scaled by `k`, in one color.
  shape(r: Region, x: number, y: number, color: number, alpha = 1, k = 1, flip = false): void {
    this.push(x, y, r.w * k, r.h * k, flip ? r.x + r.tw : r.x, r.y, flip ? -r.tw : r.tw, r.th, color, color, alpha, alpha);
  }

  // A shape stretched to w x h.
  stretch(r: Region, x: number, y: number, w: number, h: number, color: number, alpha = 1, flip = false): void {
    this.push(x, y, w, h, flip ? r.x + r.tw : r.x, r.y, flip ? -r.tw : r.tw, r.th, color, color, alpha, alpha);
  }

  // A horizontal slice of a wrapping strip: units sx..sx+w of the strip, drawn at x.
  slice(r: Region, sx: number, w: number, x: number, y: number, color: number, alpha = 1): void {
    const k = r.tw / r.w;
    this.push(x, y, w, r.h, r.x + sx * k, r.y, w * k, r.th, color, color, alpha, alpha);
  }

  rect(x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
    this.gradient(x, y, w, h, color, color, alpha, alpha);
  }

  // A vertical gradient, top color/alpha to bottom color/alpha.
  gradient(x: number, y: number, w: number, h: number, top: number, bottom: number, alphaTop = 1, alphaBottom = 1): void {
    const s = this.atlas.solid;
    this.push(x, y, w, h, s.x + 1, s.y + 1, 2, 2, top, bottom, alphaTop, alphaBottom);
  }

  // Text with its top at y and cap height about `size` units. `align`: 0 left, 0.5 centered,
  // 1 right. Returns the width.
  text(str: string, x: number, y: number, size: number, color: number, alpha = 1, align = 0, tracking: number = TEXT.tracking): number {
    const k = size / (TEXT.bakeSize * TEXT.capHeight);
    const width = this.measure(str, size, tracking);
    let pen = x - width * align;
    const top = y - TEXT.bakeSize * (1 - TEXT.capHeight) * k;
    for (let i = 0; i < str.length; i++) {
      const g = this.atlas.glyphs[str.charCodeAt(i)];
      if (!g) continue;
      if (g.tw) this.push(pen - k, top, g.w * k, g.h * k, g.x, g.y, g.tw, g.th, color, color, alpha, alpha);
      pen += g.advance * k + tracking * size;
    }
    return width;
  }

  measure(str: string, size: number, tracking: number = TEXT.tracking): number {
    const k = size / (TEXT.bakeSize * TEXT.capHeight);
    let w = 0;
    for (let i = 0; i < str.length; i++) {
      const g = this.atlas.glyphs[str.charCodeAt(i)];
      if (g) w += g.advance * k + tracking * size;
    }
    return Math.max(0, w - tracking * size);
  }

  end(): void {
    this.lastCount = this.frameCount;
    if (this.lost) return;
    this.flush(true);
  }

  // Sets up everything on the GPU. Runs at startup and again after a lost context.
  private initGL(): void {
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;

    const program = gl.createProgram()!;
    gl.attachShader(program, this.shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, this.shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
    this.program = program;
    const loc = (n: string) => gl.getUniformLocation(program, n);
    this.u = {
      scale: loc('uScale'), origin: loc('uOrigin'), target: loc('uTarget'), day: loc('uDay'),
      atlas: loc('uAtlas'), palette: loc('uPalette'), atlasSize: loc('uAtlasSize'),
    };

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS * 4;
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(i + 1);
      gl.vertexAttribPointer(i + 1, 4, gl.FLOAT, false, stride, i * 16);
      gl.vertexAttribDivisor(i + 1, 1);
    }

    // R8 rows aren't 4-byte aligned in general.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.activeTexture(gl.TEXTURE0);
    this.texture(gl.R8, gl.RED, this.atlas.size, this.atlas.size, this.atlas.pixels, gl.LINEAR);
    gl.activeTexture(gl.TEXTURE1);
    this.texture(gl.RGBA8, gl.RGBA, PALETTE_SIZE, KEYFRAMES.length, paletteData(), gl.NEAREST);

    gl.useProgram(program);
    gl.uniform1i(this.u.atlas, 0);
    gl.uniform1i(this.u.palette, 1);
    gl.uniform2f(this.u.atlasSize, this.atlas.size, this.atlas.size);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const [r, g, b] = voidColor();
    gl.clearColor(r, g, b, 1);
  }

  private shader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'compile failed');
    return s;
  }

  private texture(internal: number, format: number, w: number, h: number, pixels: Uint8Array, filter: number): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.UNSIGNED_BYTE, pixels);
  }

  private push(x: number, y: number, w: number, h: number, u: number, v: number, sw: number, sh: number, top: number, bottom: number, alphaTop: number, alphaBottom: number): void {
    if (this.count === RENDER.maxInstances) this.flush(false);
    const d = this.data;
    let o = this.count * FLOATS;
    d[o++] = x;
    d[o++] = y;
    d[o++] = w;
    d[o++] = h;
    d[o++] = u;
    d[o++] = v;
    d[o++] = sw;
    d[o++] = sh;
    d[o++] = top;
    d[o++] = bottom;
    d[o++] = alphaTop;
    d[o] = alphaBottom;
    this.count++;
    this.frameCount++;
  }

  // Uploads and draws the batch. `last` is false when a full batch flushes mid-frame.
  private flush(last: boolean): void {
    const gl = this.gl;
    if (!this.started) {
      this.started = true;
      const w = this.canvas.width;
      const h = this.canvas.height;
      gl.viewport(0, 0, w, h);
      gl.disable(gl.SCISSOR_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const ox = this.originX + this.shakeX * this.scale;
      const oy = this.originY + this.shakeY * this.scale;
      // Nothing draws into the letterbox, whatever pokes past the view's edges.
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(this.originX, h - this.originY - Math.round(VIEW.h * this.scale), Math.round(this.viewW * this.scale), Math.round(VIEW.h * this.scale));
      gl.useProgram(this.program);
      gl.bindVertexArray(this.vao);
      gl.uniform1f(this.u.scale, this.scale);
      gl.uniform2f(this.u.origin, ox, oy);
      gl.uniform2f(this.u.target, w, h);
      gl.uniform3f(this.u.day, this.dayA, this.dayB, this.dayMix);
    }
    if (this.count > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      // Orphan the old buffer so the driver never waits on a frame the GPU is still drawing.
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * FLOATS);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    }
    this.count = 0;
    if (last) this.started = false;
  }
}
