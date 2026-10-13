import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

// Execute the real branding component; only Next's image transport and CSS
// module names are adapted for the existing VM-based UI fixtures.
const requireNode = createRequire(import.meta.url);
const runtime = requireNode("react/jsx-runtime");
const exports: Record<string, any> = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/brand-image.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, { exports, require(name: string) {
  if (name === "react/jsx-runtime") return runtime;
  if (name === "next/image") return { __esModule: true, default: ({ preload: _preload, ...props }: any) => runtime.jsx("img", props) };
  if (name === "./brand-image.module.css") return { __esModule: true, default: { image: "official-brand-image" } };
  throw new Error(`Unexpected branding dependency: ${name}`);
} });
export const officialBrandModule = exports;
