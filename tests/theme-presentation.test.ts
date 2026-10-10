import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { THEME_BOOTSTRAP } from "../src/lib/theme-presentation.ts";

function environment(saved: string | null, system: boolean, blocked = false) {
  const classes = new Set<string>(["dark"]);
  const writes: Array<[string, string]> = [];
  const media = { matches: system };
  const context = {
    exports: {} as { togglePresentationTheme: () => void; syncSystemTheme: () => void },
    document: { documentElement: { classList: {
      contains: (name: string) => classes.has(name),
      toggle: (name: string, value: boolean) => { if (value) classes.add(name); else classes.delete(name); },
    } } },
    localStorage: {
      getItem: (key: string) => { assert.equal(key, "theme"); if (blocked) throw Error("Storage blocked"); return saved; },
      setItem: (key: string, value: string) => { if (blocked) throw Error("Storage blocked"); saved = value; writes.push([key, value]); },
    },
    matchMedia: (query: string) => { assert.equal(query, "(prefers-color-scheme: dark)"); return media; },
    window: {} as { matchMedia?: unknown },
  };
  context.window.matchMedia = context.matchMedia;
  const code = ts.transpileModule(fs.readFileSync("src/lib/theme-presentation.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, context);
  return { context, classes, writes, media, api: context.exports };
}
for (const system of [false, true]) {
  for (const saved of ["light", "dark", null, "invalid"]) {
    test("pre-paint theme: saved=" + saved + " system=" + system, () => {
      const env = environment(saved, system);
      vm.runInNewContext(THEME_BOOTSTRAP, env.context);
      assert.equal(env.classes.has("dark"), saved === "dark" || (saved !== "light" && system));
      assert.deepEqual(env.writes, []);
    });
  }
}
test("blocked storage falls back to system and never prevents immediate theme interaction", () => {
  const env = environment(null, true, true);
  vm.runInNewContext(THEME_BOOTSTRAP, env.context);
  assert.equal(env.classes.has("dark"), true);
  assert.doesNotThrow(() => env.api.togglePresentationTheme());
  assert.equal(env.classes.has("dark"), false);
});
test("toggle uses existing preference key and subsequent initialization restores the selected theme", () => {
  const env = environment("light", true);
  vm.runInNewContext(THEME_BOOTSTRAP, env.context);
  env.api.togglePresentationTheme();
  assert.deepEqual(env.writes, [["theme", "dark"]]);
  env.classes.delete("dark"); vm.runInNewContext(THEME_BOOTSTRAP, env.context);
  assert.equal(env.classes.has("dark"), true);
  env.media.matches = false; env.api.syncSystemTheme();
  assert.equal(env.classes.has("dark"), true);
});
test("unselected theme follows OS changes without persisting a new preference", () => {
  const env = environment(null, false); env.api.syncSystemTheme();
  assert.equal(env.classes.has("dark"), false);
  env.media.matches = true; env.api.syncSystemTheme();
  assert.equal(env.classes.has("dark"), true); assert.deepEqual(env.writes, []);
});
test("bootstrap is in the root head before body, using fixed code with no authentication access", () => {
  const layout = fs.readFileSync("src/app/layout.tsx", "utf8");
  assert.ok(layout.indexOf('id="ps-theme-init"') < layout.indexOf("<body"));
  assert.match(layout, /<html lang="en" suppressHydrationWarning>/);
  assert.doesNotMatch(THEME_BOOTSTRAP, /cookie|fetch|session|location|innerHTML/);
});
test("auth theme control remembers explicit selection if storage fails and releases its OS listener", () => {
  let listener: (() => void) | undefined, cleanup: (() => void) | undefined, toggles = 0, updates = 0;
  const code = ts.transpileModule(fs.readFileSync("src/components/auth-theme-control.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: { default?: () => { props: { onClick: () => void } } } = {};
  vm.runInNewContext(code, { exports,
    window: { matchMedia: () => ({ addEventListener: (_: string, fn: () => void) => { listener = fn; }, removeEventListener: (_: string, fn: () => void) => { assert.equal(fn, listener); listener = undefined; } }) },
    require: (name: string) => {
      if (name === "react") return { useRef: (value: boolean) => ({ current: value }), useEffect: (fn: () => () => void) => { cleanup = fn(); } };
      if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) };
      if (name === "lucide-react") return { Moon: "Moon", Sun: "Sun" };
      if (name === "@/lib/theme-presentation") return { syncSystemTheme: () => { updates++; }, togglePresentationTheme: () => { toggles++; } };
      throw Error(name);
    },
  });
  const button = exports.default!(); listener!(); assert.equal(updates, 1);
  button.props.onClick(); listener!(); assert.equal(toggles, 1); assert.equal(updates, 1);
  cleanup!(); assert.equal(listener, undefined);
});
