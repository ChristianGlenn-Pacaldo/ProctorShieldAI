import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { clsx } from "clsx";

function backgroundFixture({ reduced = false, available = true, compiles = true } = {}) {
  const shaders = new Set<object>(), programs = new Set<object>(), buffers = new Set<object>();
  const frames = new Map<number, (time: number) => void>();
  const visibilityListeners = new Set<() => void>(), motionListeners = new Set<() => void>();
  let nextFrame = 0, draws = 0, disconnected = false;
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TRIANGLE_STRIP: 8,
    createShader: () => { const value = {}; shaders.add(value); return value; },
    createProgram: () => { const value = {}; programs.add(value); return value; },
    createBuffer: () => { const value = {}; buffers.add(value); return value; },
    deleteShader: (value: object) => shaders.delete(value),
    deleteProgram: (value: object) => programs.delete(value),
    deleteBuffer: (value: object) => buffers.delete(value),
    getShaderParameter: () => compiles, getProgramParameter: () => true,
    getAttribLocation: () => 0, getUniformLocation: () => ({}), isContextLost: () => false,
    shaderSource() {}, compileShader() {}, attachShader() {}, linkProgram() {}, useProgram() {},
    bindBuffer() {}, bufferData() {}, enableVertexAttribArray() {}, vertexAttribPointer() {},
    uniform2f() {}, uniform1f() {}, uniform3f() {}, uniform3fv() {}, viewport() {},
    drawArrays() { draws++; },
  };
  const canvas = { width: 0, height: 0, getContext: () => available ? gl : null };
  const container = { clientWidth: 390, clientHeight: 844 };
  const motion = {
    matches: reduced,
    addEventListener: (_event: string, handler: () => void) => motionListeners.add(handler),
    removeEventListener: (_event: string, handler: () => void) => motionListeners.delete(handler),
  };
  const document = {
    hidden: false,
    addEventListener: (_event: string, handler: () => void) => visibilityListeners.add(handler),
    removeEventListener: (_event: string, handler: () => void) => visibilityListeners.delete(handler),
  };
  let refIndex = 0, effect: (() => void | (() => void)) | undefined;
  const exports: { default?: (props: Record<string, unknown>) => unknown } = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/velaris.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, document, window: { devicePixelRatio: 3, matchMedia: () => motion },
    performance: { now: () => 1000 },
    requestAnimationFrame: (callback: (time: number) => void) => { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    ResizeObserver: class { observe() {} disconnect() { disconnected = true; } },
    require(name: string) {
      if (name === "react") return { useRef: () => ({ current: refIndex++ === 0 ? canvas : container }), useEffect: (callback: typeof effect) => { effect = callback; } };
      if (name === "clsx") return { clsx };
      if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) };
      throw new Error(`Unexpected background dependency: ${name}`);
    },
  });
  exports.default!({ bg: "#012620", speed: 0.45, height: "100%" });
  assert.ok(effect);
  const cleanup = effect();
  return {
    frames, canvas, shaders, programs, buffers, visibilityListeners, motionListeners,
    draws: () => draws, disconnected: () => disconnected,
    step(time: number) { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(time)); },
    hidden(value: boolean) { document.hidden = value; visibilityListeners.forEach(handler => handler()); },
    reduced(value: boolean) { motion.matches = value; motionListeners.forEach(handler => handler()); },
    unmount() { if (cleanup) cleanup(); },
  };
}

test("Velaris pauses in hidden tabs, resumes, and releases GPU resources and listeners on navigation", () => {
  const background = backgroundFixture();
  assert.equal(background.frames.size, 1);
  background.step(1000);
  assert.ok(background.draws() > 0);
  background.hidden(true);
  const pausedDraws = background.draws();
  background.step(2000);
  assert.equal(background.frames.size, 0);
  assert.equal(background.draws(), pausedDraws);
  background.hidden(false);
  assert.equal(background.frames.size, 1);
  background.unmount();
  assert.equal(background.frames.size, 0);
  assert.equal(background.shaders.size + background.programs.size + background.buffers.size, 0);
  assert.equal(background.visibilityListeners.size + background.motionListeners.size, 0);
  assert.equal(background.disconnected(), true);
});

test("Velaris honors reduced motion initially and when preferences change", () => {
  const background = backgroundFixture({ reduced: true });
  assert.ok(background.draws() > 0);
  assert.equal(background.frames.size, 0);
  background.reduced(false);
  assert.equal(background.frames.size, 1);
  background.reduced(true);
  assert.equal(background.frames.size, 0);
  background.unmount();
});

test("Velaris safely leaves the CSS fallback when WebGL or shader compilation is unavailable", () => {
  for (const options of [{ available: false }, { compiles: false }]) {
    const background = backgroundFixture(options);
    assert.equal(background.frames.size, 0);
    assert.equal(background.draws(), 0);
    assert.equal(background.shaders.size + background.programs.size + background.buffers.size, 0);
    background.unmount();
  }
});
