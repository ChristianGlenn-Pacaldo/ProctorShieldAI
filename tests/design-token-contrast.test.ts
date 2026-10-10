import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const postcss = require("postcss") as typeof import("postcss");
const css = fs.readFileSync(new URL("../src/styles/proctorshield-tokens.css", import.meta.url), "utf8");
const sheet = postcss.parse(css);
const rules: Record<string, Record<string, string>> = {};
sheet.walkRules(rule => {
  const values: Record<string, string> = {};
  rule.walkDecls(decl => { values[decl.prop] = decl.value; });
  rules[rule.selector] = values;
});
const luminance = (hex: string) => {
  assert.match(hex, /^#[a-f\d]{6}$/i, "Contrast pairs must use opaque sRGB tokens");
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (a: string, b: string) => {
  const [min, max] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (max + 0.05) / (min + 0.05);
};

for (const mode of ["light", "dark"] as const) {
  const tokens = { ...rules[":root"], ...(mode === "dark" ? rules["html.dark"] : {}) };
  const ratio = (fg: string, bg: string, minimum: number) => {
    const value = contrast(tokens["--ps-" + fg], tokens["--ps-" + bg]);
    assert.ok(value >= minimum, mode + ": " + fg + " on " + bg + " = " + value.toFixed(2));
  };
  test(mode + " body, secondary and muted text remain readable on all opaque surfaces", () => {
    for (const fg of ["text", "text-secondary", "text-muted"])
      for (const bg of ["canvas", "surface", "surface-inset", "surface-elevated"]) ratio(fg, bg, 4.5);
  });
  test(mode + " primary actions, accents and semantic status text meet normal text contrast", () => {
    for (const bg of ["primary", "primary-hover"]) ratio("on-primary", bg, 4.5);
    for (const status of ["success", "warning", "error", "info"]) ratio(status, status + "-soft", 4.5);
    ratio("gold", "gold-soft", 4.5);
    ratio("accent", "accent-soft", 4.5);
    ratio("on-media", "media", 4.5);
  });
  test(mode + " focus rings and control boundaries contrast against adjacent surfaces", () => {
    for (const bg of ["canvas", "surface", "surface-inset", "surface-elevated"])
      for (const fg of ["focus", "border-control"]) ratio(fg, bg, 3);
  });
}

test("foundation CSS introduces variables without restyling existing pages or managing themes", () => {
  assert.deepEqual(Object.keys(rules), [":root", "html.dark"]);
  sheet.walkDecls(decl => assert.ok(decl.prop.startsWith("--ps-"), decl.prop));
  assert.ok(!sheet.nodes.some(node => node.type === "atrule"), "No effects, imports or animations in tokens");
});
