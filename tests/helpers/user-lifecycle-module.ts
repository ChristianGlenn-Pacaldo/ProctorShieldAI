import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Compatibility adapter for existing isolated component harnesses. It loads the
// production hook/work implementation, rather than substituting its behavior.
export function loadUserLifecycleModule(react: unknown) {
  const exports: Record<string, any> = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/user-session-lifecycle.tsx", "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS,target: ts.ScriptTarget.ES2022,jsx: ts.JsxEmit.ReactJSX},
  }).outputText, {
    exports, AbortController, console,
    require(name: string) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return {jsx:(type: unknown,props: unknown)=>({type,props}),jsxs:(type: unknown,props: unknown)=>({type,props})};
      throw Error("Unexpected lifecycle dependency");
    },
  });
  return exports;
}
