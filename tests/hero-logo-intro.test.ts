import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function fixture({ reduced = false, saveData = false, reject = false, pending = false } = {}) {
  const rejections: ((error: Error) => void)[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const listenable = (prefix: string) => ({
    addEventListener(event: string, fn: () => void) {
      const key = prefix + event;
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key)!.add(fn);
    },
    removeEventListener(event: string, fn: () => void) { listeners.get(prefix + event)?.delete(fn); },
  });
  const fire = (key: string) => listeners.get(key)?.forEach(fn => fn());
  const motion = { ...listenable("motion:"), matches: reduced };
  const data = { ...listenable("data:"), matches: false };
  const connection = { ...listenable("connection:"), saveData };
  const document = { ...listenable("document:"), hidden: false };
  let src: string | undefined, plays = 0, loads = 0, disconnected = false;
  const video = {
    ...listenable("video:"), paused: true, muted: true,
    get src() { return src; }, set src(value: string | undefined) { src = value; },
    hasAttribute: () => src !== undefined,
    removeAttribute: () => { src = undefined; },
    load() { loads++; },
    play() {
      plays++;
      if (reject) return Promise.reject(new Error("Autoplay blocked"));
      this.paused = false;
      if (pending) return new Promise<void>((_resolve, reject) => { rejections.push(reject); });
      fire("video:playing");
      return Promise.resolve();
    },
    pause() { if (!this.paused) { this.paused = true; fire("video:pause"); } },
  };
  const values: unknown[] = [];
  let state = 0, ref = 0, effect: (() => (() => void) | void) | undefined;
  let intersection: ((entries: { isIntersecting: boolean; intersectionRatio: number }[]) => void) | undefined;
  const exports: { default?: (props: object) => { props: { children: { type: string; props: Record<string, unknown> }[] } } } = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/hero-logo-intro.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, document, navigator: { connection }, window: { matchMedia: (query: string) => query.includes("motion") ? motion : data },
    IntersectionObserver: class {
      constructor(callback: typeof intersection) { intersection = callback; }
      observe() {} disconnect() { disconnected = true; }
    },
    require(name: string) {
      if (name === "react") return {
        useRef: () => ({ current: ref++ === 0 ? {} : ref === 2 ? video : null }),
        useState(value: unknown) { const index = state++; values[index] = value; return [value, (next: unknown) => { values[index] = next; }]; },
        useEffect(callback: typeof effect) { effect = callback; },
      };
      if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) };
      if (name.endsWith(".css")) return { default: {} };
      if (name === "@/components/brand-image") return { default: "OfficialLogo" };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  const tree = exports.default!({});
  const cleanup = effect!();
  return {
    video, tree, values, rejections, plays: () => plays, loads: () => loads, disconnected: () => disconnected,
    visible(value: boolean) { intersection!([{ isIntersecting: value, intersectionRatio: value ? 1 : 0 }]); },
    hidden(value: boolean) { document.hidden = value; fire("document:visibilitychange"); },
    reduced(value: boolean) { motion.matches = value; fire("motion:change"); },
    saveData(value: boolean) { connection.saveData = value; fire("connection:change"); },
    reducedData(value: boolean) { data.matches = value; fire("data:change"); },
    error() { fire("video:error"); },
    unmute() { video.muted = false; fire("video:volumechange"); },
    toggle() { (tree.props.children.find(child => child.type === "button")!.props.onClick as () => void)(); },
    unmount() { cleanup?.(); }, listeners,
  };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test("SSR has no media source and reserves muted inline looping video with a static logo", () => {
  const f = fixture();
  const video = f.tree.props.children.find(child => child.type === "video")!.props;
  assert.equal(video.src, undefined);
  assert.equal(video.preload, "none");
  assert.equal(video.loop, true);
  assert.equal(video.muted, true);
  assert.equal(video.playsInline, true);
  assert.equal(f.video.src, undefined);
  assert.equal(f.values[1], false);
  f.unmount();
});

test("loads only in view; hidden and offscreen playback pauses and resumes", async () => {
  const f = fixture();
  assert.equal(f.plays(), 0);
  f.visible(true); await settle();
  assert.equal(f.video.src, "/videos/original-google-flow-intro.mp4");
  assert.equal(f.values[0], "playing");
  f.hidden(true); assert.equal(f.video.paused, true);
  f.hidden(false); await settle(); assert.equal(f.video.paused, false);
  f.visible(false); assert.equal(f.video.paused, true);
  f.visible(true); await settle(); assert.equal(f.video.paused, false);
  f.unmount();
});

test("manual pause survives hidden and offscreen transitions until explicit Play", async () => {
  const f = fixture(); f.visible(true); await settle();
  f.toggle(); assert.equal(f.video.paused, true);
  const plays = f.plays();
  f.hidden(true); f.visible(false); f.hidden(false); f.visible(true); await settle();
  assert.equal(f.plays(), plays);
  assert.equal(f.values[0], "paused");
  f.toggle(); await settle(); assert.equal(f.video.paused, false);
  f.unmount();
});

for (const preference of ["motion", "saveData", "reducedData"] as const) {
  test(`${preference} prevents initial loading and unloads active media`, async () => {
    const f = fixture({ reduced: preference === "motion", saveData: preference === "saveData" });
    if (preference === "reducedData") f.reducedData(true);
    f.visible(true); await settle();
    assert.equal(f.video.src, undefined); assert.equal(f.plays(), 0);
    assert.equal(f.values[1], false);
    const change = preference === "motion" ? f.reduced : preference === "saveData" ? f.saveData : f.reducedData;
    change(false); await settle(); assert.equal(f.video.paused, false);
    change(true); assert.equal(f.video.src, undefined);
    assert.equal(f.video.paused, true); assert.equal(f.values[1], false);
    f.unmount();
  });
}

test("autoplay rejection shows the logo and does not retry automatically", async () => {
  const f = fixture({ reject: true }); f.visible(true); await settle();
  assert.equal(f.values[0], "fallback"); assert.equal(f.values[1], false);
  f.visible(false); f.visible(true); await settle(); assert.equal(f.plays(), 1);
  f.toggle(); await settle(); assert.equal(f.plays(), 2);
  f.unmount();
});

test("media errors restore the logo; audio is forced muted; unmount releases listeners and source", async () => {
  const f = fixture(); f.visible(true); await settle();
  f.unmute(); assert.equal(f.video.muted, true);
  f.error(); assert.equal(f.values[0], "unavailable"); assert.equal(f.values[1], false);
  f.unmount(); assert.equal(f.video.src, undefined); assert.equal(f.disconnected(), true);
  assert.equal([...f.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
});


test("media error wins over a later rejected play promise", async () => {
  const f = fixture({ pending: true }); f.visible(true);
  f.error(); f.rejections[0](new Error("Unsupported media")); await settle();
  assert.equal(f.values[0], "unavailable"); assert.equal(f.values[1], false);
  f.unmount();
});

test("an interrupted pending play cannot block a fresh visible playback attempt", async () => {
  const f = fixture({ pending: true }); f.visible(true);
  f.hidden(true); f.hidden(false);
  assert.equal(f.plays(), 2);
  f.rejections[0](new Error("Interrupted by pause")); await settle();
  assert.notEqual(f.values[0], "fallback");
  f.unmount();
});
