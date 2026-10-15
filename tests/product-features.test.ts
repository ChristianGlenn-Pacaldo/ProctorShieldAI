import { defenseDependency } from "./helpers/defense-feature-fixture.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import * as jsx from "react/jsx-runtime";
import * as icons from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";

const source = fs.readFileSync("src/components/product-features.tsx", "utf8");
const exports: { default?: React.ComponentType } = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText, { exports, require(name: string) {
      const featureDependency = defenseDependency(name); if (featureDependency !== undefined) return featureDependency;
  if (name === "react") return React;
  if (name === "react/jsx-runtime") return jsx;
  if (name === "lucide-react") return icons;
  if (name === "next/image") return { __esModule: true, default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement("img", props) };
  if (name === "./product-features.module.css") return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
  throw Error("Unexpected Features dependency: " + name);
} });
const html = renderToStaticMarkup(React.createElement(exports.default!));
const css = postcss.parse(fs.readFileSync("src/components/product-features.module.css", "utf8"));

test("actual feature markup renders the three real-product categories once and in order", () => {
  assert.equal((html.match(/<article\b/g) ?? []).length, 3);
  assert.deepEqual([...html.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map(m => m[1]), ["Smart Quiz Management", "AI-Assisted Proctoring", "Evidence Review"]);
  assert.equal((html.match(/Sample data/g) ?? []).length, 3);
  assert.doesNotMatch(html, /cartoon|investment|portfolio|guaranteed.*cheating/i);
});

test("local product previews have useful alternatives, stable dimensions and lazy loading", () => {
  const images = [...html.matchAll(/<img\b([^>]+)>/g)]; assert.equal(images.length, 6);
  for (const [, attrs] of images) {
    const src = attrs.match(/src="([^"]+)"/)![1].split("?")[0]; assert.match(src, /^\/images\/features\/[a-z-]+\.webp$/);
    assert.ok(fs.existsSync("public" + src)); assert.match(attrs, /alt="ProctorShieldAI [^"]+"/);
    assert.match(attrs, /width="1280"/); assert.match(attrs, /height="800"/); assert.match(attrs, /loading="lazy"/);
    const bytes = fs.readFileSync("public" + src); assert.equal(bytes.subarray(0, 4).toString(), "RIFF"); assert.equal(bytes.subarray(8, 12).toString(), "WEBP");
  }
});

test("preview buttons have names and dialog semantics without login or submission side effects", () => {
  const buttons = [...html.matchAll(/<button\b([^>]+)>/g)]; assert.equal(buttons.length, 3);
  for (const [, attrs] of buttons) { assert.match(attrs, /type="button"/); assert.match(attrs, /aria-label="View preview of [^"]+ interface"/); assert.match(attrs, /aria-haspopup="dialog"/); assert.match(attrs, /aria-controls="product-interface-preview"/); }
  assert.match(html, /<dialog[^>]*id="product-interface-preview"/); assert.doesNotMatch(html, /<dialog[^>]*\sopen(?:=|\s|>)/);
  assert.doesNotMatch(html, /<form\b/); assert.doesNotMatch(source, /fetch\(|useRouter|\/api\//);
});

test("proctoring preview remains conditional and explicitly avoids real webcam images", () => {
  assert.match(html, /enabled proctored attempts/); assert.match(html, /Teachers review live status/);
  assert.match(html, /camera-pending placeholders, with no real webcam images/);
  assert.match(html, /available short clips/);
  assert.match(html, /Requires an active Pro plan/);
  assert.match(html, /Media redacted/);
  assert.doesNotMatch(html, /Power Arena|power-arena|signed URL|guaranteed.*cheating/i);
});

test("both themes have matching product image sources and the viewer supports safe original-image links", () => {
  for (const id of ["quiz-management", "ai-proctoring", "evidence-review"]) for (const theme of ["light", "dark"]) assert.ok(fs.existsSync(`public/images/features/${id}-${theme}.webp`));
  assert.match(css.toString(), /:global\(html\.dark\) \.lightImage[^}]*display: none/);
  assert.match(css.toString(), /:global\(html\.dark\) \.darkImage[^}]*display: block/);
  assert.match(source, /rel="noopener noreferrer"/); assert.match(source, /showModal\(\)/);
});

test("card interaction is scoped, restrained and suppressed for reduced motion", () => {
  let reduced = false;
  css.walkAtRules("media", rule => { if (rule.params === "(prefers-reduced-motion: reduce)") rule.walkDecls("transform", decl => { if (decl.value === "none") reduced = true; }); });
  assert.ok(reduced); assert.match(css.toString(), /translateY\(-4px\)/); assert.match(css.toString(), /scale\(1\.025\)/);
  assert.match(css.toString(), /min-height: 44px/); assert.match(css.toString(), /focus-visible/);
  assert.match(css.toString(), /grid-template-columns: minmax\(0, 1fr\)/);
  assert.doesNotMatch(css.toString(), /white-space:\s*nowrap|text-overflow:\s*ellipsis/);
});


test("preview control accurately describes a screenshot dialog rather than app navigation", () => {
  assert.equal((html.match(/>View preview /g) ?? []).length, 3);
  assert.doesNotMatch(html, /View interface/);
  assert.equal((html.match(/aria-haspopup="dialog"/g) ?? []).length, 3);
});
