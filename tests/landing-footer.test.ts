import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import postcss from "postcss";
import { officialBrandModule } from "./helpers/brand-image-fixture.ts";

type Element = { type: unknown; props: Record<string, unknown> };
const source = fs.readFileSync("src/app/page.tsx", "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const footers: ts.JsxElement[] = [];
function visit(node: ts.Node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "footer") footers.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(footers.length, 1);
const exports: { default?: () => Element } = {};
// Render the actual footer subtree. No landing behavior is replaced or executed.
const code = ts.transpileModule(`export default function Footer() { return (${footers[0].getText(ast)}); }`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const jsx = (type: unknown, props: Element["props"]) => typeof type === "function" ? type(props) : { type, props };
vm.runInNewContext(code, { exports,
  styles: new Proxy({}, { get: (_target, key) => String(key) }), Link: "a",
  BrandImage: officialBrandModule.default, ArrowUpRight: "svg",
  require(name: string) {
    assert.equal(name, "react/jsx-runtime"); return { jsx, jsxs: jsx };
  },
});
const tree = exports.default!();
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Element;
  if (typeof node.type === "function") return nodes(node.type(node.props));
  return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object" && "props" in value) return text((value as Element).props.children);
  return value == null || typeof value === "boolean" ? "" : String(value);
}
const all = nodes(tree);
const links = all.filter(node => node.type === "a");
const css = postcss.parse(fs.readFileSync("src/app/landing.module.css", "utf8"));
function declarations(selector: string): Record<string, string> {
  const result: Record<string, string> = {};
  css.walkRules(rule => {
    if (rule.selector !== selector || rule.parent?.type === "atrule") return;
    rule.walkDecls(decl => { result[decl.prop] = decl.value; });
  });
  return result;
}
function rgb(hex: string) { return hex.slice(1, 7).match(/../g)!.map(part => parseInt(part, 16) / 255); }
function luminance(color: number[]) { return color.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0); }
function contrast(foreground: number[], background: number[]) { const a = luminance(foreground), b = luminance(background); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }

test("footer renders official branding, approved tagline and copyright", () => {
  assert.equal(tree.props["aria-label"], "ProctorShieldAI footer");
  const logo = all.find(node => node.type === "img"); assert.ok(logo);
  assert.equal(logo.props.src, "/images/proctorshieldai-shield-transparent.png");
  assert.equal(logo.props.alt, ""); assert.ok(fs.existsSync(`public${logo.props.src}`));
  assert.equal(links[0].props["aria-label"], "ProctorShieldAI home");
  assert.match(text(tree), /Smarter Quizzes\. Stronger Integrity\./);
  assert.match(text(tree), /© 2026 ProctorShieldAI\. All rights reserved\./);
});

test("footer navigates to existing public pages and section targets without invented contacts or policies", () => {
  assert.equal(links.length, 11);
  for (const link of links) {
    const href = String(link.props.href); assert.ok(text(link.props.children).trim());
    if (href.startsWith("#")) assert.ok(source.includes(`id="${href.slice(1)}"`), `Missing anchor ${href}`);
    else { assert.match(href, /^\//); assert.ok(fs.existsSync(`src/app${href === "/" ? "" : href}/page.tsx`), `Missing route ${href}`); }
    assert.doesNotMatch(href, /admin\/login|privacy|terms|mailto:|tel:|https?:/);
  }
  assert.doesNotMatch(text(tree), /Admin login|Admin access/);
  assert.equal(links.find(node => text(node.props.children) === "Student login")?.props.href, "/login/student");
  assert.equal(links.find(node => text(node.props.children) === "Teacher login")?.props.href, "/login/teacher");
});

test("footer navigation landmarks have distinct names from real headings", () => {
  const navs = all.filter(node => node.type === "nav"); assert.equal(navs.length, 3);
  const names = navs.map(nav => String(nav.props["aria-labelledby"])); assert.equal(new Set(names).size, 3);
  for (const id of names) {
    const heading = all.find(node => node.props.id === id); assert.equal(heading?.type, "h2"); assert.ok(text(heading));
  }
  for (const node of all) { assert.equal(node.props.tabIndex, undefined); if (node.type === "svg") assert.equal(node.props["aria-hidden"], "true"); }
});

test("footer text and link states retain AA contrast over both footer surfaces", () => {
  const base = rgb(declarations(".footer").background);
  const overlay = declarations(".footerContext").background;
  const alpha = parseInt(overlay.slice(7), 16) / 255;
  const context = rgb(overlay).map((v, i) => v * alpha + base[i] * (1 - alpha));
  for (const selector of [".footerBrand", ".footerTagline", ".footerDescription", ".footer .footerColumn h2", ".footerColumn a, .footerContext a, .footerBottom a", ".footer a:hover", ".footerContext strong", ".footerBottom p"]) {
    for (const bg of [base, context]) assert.ok(contrast(rgb(declarations(selector).color), bg) >= 4.5, `${selector} contrast`);
  }
  assert.ok(contrast(rgb(declarations(".footer a:focus-visible").outline.split(" ").at(-1)!), base) >= 3);
});

test("footer allows text wrapping, protects logo/icons and gives links visible keyboard focus and 44px height", () => {
  assert.equal(declarations(".footerBrand > span")["overflow-wrap"], "anywhere");
  assert.equal(declarations(".footerBrand > img")["flex-shrink"], "0");
  assert.equal(declarations(".footer a > svg")["flex-shrink"], "0");
  assert.equal(declarations(".footerBrand")["min-height"], "44px");
  assert.equal(declarations(".footerColumn a, .footerContext a, .footerBottom a")["min-height"], "44px");
  assert.equal(declarations(".footer a:focus-visible").outline, "3px solid #91eacb");
  css.walkRules(rule => { if (!rule.selector.includes(".footer")) return; rule.walkDecls(decl => { assert.notEqual(decl.prop, "white-space"); assert.notEqual(decl.prop, "animation"); }); });
});

test("footer has mobile stacking and existing reduced-motion handling remains available", () => {
  let mobile = false, reduced = false;
  css.walkAtRules("media", rule => {
    if (rule.params === "(max-width: 420px)") rule.walkRules(".footerGrid", grid => grid.walkDecls("grid-template-columns", decl => { mobile = decl.value === "minmax(0, 1fr)"; }));
    if (rule.params === "(prefers-reduced-motion: reduce)") rule.walkDecls("transition", decl => { reduced = decl.value === "none" && decl.important; });
  });
  assert.ok(mobile); assert.ok(reduced);
});
