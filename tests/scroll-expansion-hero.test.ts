import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function fixture({ compact = false, reduced = false, restored = 0 } = {}) {
  const listeners = new Map<string, { fn: () => void; options?: { passive?: boolean } }>();
  const preferences = new Map<string, () => void>();
  const frames = new Map<number, () => void>();
  const properties = new Map<string, string>();
  let sequence = 0, disconnected = false;
  const header = { getBoundingClientRect: () => ({ height: 89 }) };
  const window = {
    scrollY: restored, innerHeight: 1000,
    addEventListener: (name: string, fn: () => void, options?: { passive?: boolean }) => listeners.set(name, { fn, options }),
    removeEventListener: (name: string) => listeners.delete(name),
    scrollTo: () => { throw Error("Scroll interception is prohibited"); },
    matchMedia: (query: string) => query.includes("reduced") ? motion : mobile,
  };
  const media = (name: string, matches: boolean) => ({ matches,
    addEventListener: (_: string, fn: () => void) => preferences.set(name, fn),
    removeEventListener: () => preferences.delete(name),
  });
  const motion = media("motion", reduced), mobile = media("mobile", compact);
  const target = { getBoundingClientRect: () => ({ top: 900 - window.scrollY, left: 120, width: 1192, height: 670.5 }) };
  const hero = { querySelector: () => target };
  const section = { dataset: {} as Record<string, string>, style: { setProperty: (name: string, value: string) => properties.set(name, value) },
    closest: () => hero,
    getBoundingClientRect: () => ({ top: 300 - window.scrollY, left: 800, width: compact ? 274 : 470, height: compact ? 217.8 : 373.7 }),
  };
  const observed: unknown[] = [];
  const progress = { value: 0, set(value: number) { this.value = value; } };
  let effect: (() => (() => void) | void) | undefined;
  const exports: { default?: (props: { children: unknown }) => unknown } = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/scroll-expansion-hero.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, window, document: { querySelector: () => header },
    requestAnimationFrame: (fn: () => void) => { frames.set(++sequence, fn); return sequence; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    ResizeObserver: class { observe(element: unknown) { observed.push(element); } disconnect() { disconnected = true; } },
    require(name: string) {
      if (name === "react") return { useRef: () => ({ current: section }), useEffect: (fn: typeof effect) => { effect = fn; } };
      if (name === "motion/react") return { motion: { div: "motion.div" }, useMotionValue: () => progress };
      if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) };
      if (name.endsWith(".css")) return { default: {} };
      throw Error(`Unexpected import: ${name}`);
    },
  });
  const slot = { type: "ExistingHeroLogoIntro" };
  const tree = exports.default!({ children: slot });
  const cleanup = effect!();
  const flush = () => { for (const [id, fn] of frames) { frames.delete(id); fn(); } };
  const scroll = (position: number) => { window.scrollY = position; listeners.get("scroll")!.fn(); flush(); };
  return { window, motion, mobile, section, properties, progress, frames, preferences, listeners, observed, slot, tree, scroll, flush,
    cleanup: () => cleanup?.(), disconnected: () => disconnected };
}

test("desktop starts in its original slot, moves below copy before widening, and expands to the reserved destination", () => {
  const f = fixture();
  assert.equal(f.progress.value, 0);
  assert.equal(f.properties.get("--media-width"), "470px");
  f.scroll(787 * 0.4);
  assert.equal(f.properties.get("--media-y"), "600px");
  assert.equal(f.properties.get("--media-width"), "470px");
  f.scroll(787 * 0.7);
  assert.ok(parseFloat(f.properties.get("--media-width")!) > 800);
  f.scroll(787);
  assert.equal(f.progress.value, 1);
  assert.equal(f.properties.get("--media-width"), "1192px");
  assert.equal(f.properties.get("--media-height"), "670.5px");
  assert.equal(f.properties.get("--media-x"), "-680px");
  f.scroll(2000); assert.equal(f.progress.value, 1);
  f.scroll(0); assert.equal(f.progress.value, 0);
  f.cleanup();
});

test("natural scroll is passive, does not install wheel/touch locks, and coalesces events", () => {
  const f = fixture();
  assert.deepEqual([...f.listeners.keys()].sort(), ["pageshow", "resize", "scroll"]);
  assert.equal(f.listeners.get("scroll")!.options!.passive, true);
  for (let i = 0; i < 10; i++) f.listeners.get("scroll")!.fn();
  assert.equal(f.frames.size, 1);
  f.cleanup(); assert.equal(f.frames.size, 0);
});

test("restored and page-show positions initialize expansion without forcing the page to the top", () => {
  const f = fixture({ restored: 787 });
  assert.equal(f.progress.value, 1);
  f.window.scrollY = 0; f.listeners.get("pageshow")!.fn(); f.flush();
  assert.equal(f.progress.value, 0); f.cleanup();
});

test("reduced motion disables expansion initially and when preference changes", () => {
  const f = fixture({ reduced: true, restored: 787 });
  assert.equal(f.progress.value, 0);
  f.motion.matches = false; f.preferences.get("motion")!(); f.flush(); assert.equal(f.progress.value, 1);
  f.motion.matches = true; f.preferences.get("motion")!(); f.flush(); assert.equal(f.progress.value, 0);
  f.cleanup();
});

test("mobile expands within its reserved footprint, without horizontal travel or desktop space", () => {
  const f = fixture({ compact: true });
  f.scroll(0);
  assert.ok(parseFloat(f.properties.get("--media-width")!) <= 274);
  f.scroll(300);
  assert.equal(f.progress.value, 1);
  assert.equal(f.properties.get("--media-width"), "274px");
  assert.equal(f.properties.get("--media-height"), "217.8px");
  assert.equal(f.properties.get("--media-y"), "0px");
  f.cleanup();
});

test("cleanup releases listeners, pending animation frame and responsive geometry observers", () => {
  const f = fixture();
  assert.equal(f.observed.length, 3);
  f.listeners.get("resize")!.fn(); f.cleanup();
  assert.equal(f.listeners.size, 0); assert.equal(f.preferences.size, 0);
  assert.equal(f.frames.size, 0); assert.equal(f.disconnected(), true);
});

test("one existing media slot is retained and homepage CTAs remain outside the animated layer", () => {
  const f = fixture();
  const tree = f.tree as { props: { children: { props: { children: unknown } } } };
  assert.equal(tree.props.children.props.children, f.slot);
  const source = fs.readFileSync("src/app/page.tsx", "utf8");
  assert.equal((source.match(/<HeroLogoIntro\b/g) || []).length, 1);
  assert.match(source, /<ScrollExpandMedia[^>]*><HeroLogoIntro\s*\/><\/ScrollExpandMedia>/);
  assert.match(source, /<Link href="\/login\/teacher" className=\{styles.primaryButton\}>Create a quiz free/);
  assert.match(source, /<form onSubmit=\{handleQuickJoin\}/);
  assert.match(source, /<Velaris bg="#012620" speed=\{2\}/);
  f.cleanup();
});

test("control remains below the contained video content on desktop and mobile", () => {
  for (const compact of [false, true]) {
    const f = fixture({ compact });
    f.scroll(787);
    const width = parseFloat(f.properties.get("--media-width")!);
    const height = parseFloat(f.properties.get("--media-height")!);
    const contentBottom = (height + Math.min(height, width * 9 / 16)) / 2;
    assert.equal(parseFloat(f.properties.get("--control-top")!), contentBottom + 8);
    f.cleanup();
  }
});
