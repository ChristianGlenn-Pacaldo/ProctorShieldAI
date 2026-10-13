import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { clsx } from "clsx";

// Execute the installed registry component and the real compositions. Only the
// Motion/browser primitive and CSS module names are adapted for Node fixtures.
// Fetching, authorization, state, retries and dashboard callbacks are untouched.
export function dashboardLoadingFixture(reducedMotion = false) {
  const modules = new Map<string, Record<string, any>>();
  const jsx = (type: any, props: Record<string, unknown>): any =>
    typeof type === "function" ? type(props) : { type, props };

  function load(relative: string): Record<string, any> {
    if (modules.has(relative)) return modules.get(relative)!;
    const filename = path.resolve(relative);
    const exports: Record<string, any> = {};
    modules.set(relative, exports);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, { exports, require(name: string) {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "motion/react") return { motion: { div: "motion-div" }, useReducedMotion: () => reducedMotion };
      if (name === "clsx") return { clsx };
      if (name === "@/lib/utils") return load("src/lib/utils.ts");
      if (name === "@/components/ui/loaders-skeleton") return load("src/components/ui/loaders-skeleton.tsx");
      if (name === "./dashboard-loading.module.css") return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
      throw new Error(`Unexpected loading presentation dependency: ${name}`);
    } }, { filename });
    return exports;
  }

  return {
    compositions: load("src/components/dashboard-loading.tsx"),
    registry: load("src/components/ui/loaders-skeleton.tsx"),
  };
}

export const dashboardLoadingModule = dashboardLoadingFixture().compositions;
