import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the production control. Icons are presentation-only fixture SVGs.
export function createPasswordVisibilityModule(runtime?: any, icons?: any) {
const exports: Record<string, any> = {};
const jsx = (type: any, props: any): any => typeof type === "function" ? type(props) : ({ type, props });
vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/components/password-visibility-button.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports, require(name: string) {
  if (name === "react/jsx-runtime") return runtime ?? { jsx, jsxs: jsx };
  if (name === "lucide-react") return icons ?? { Eye: (props: any) => jsx("svg", props), EyeOff: (props: any) => jsx("svg", props) };
  throw new Error(`Unexpected password control dependency: ${name}`);
} });
return exports;
}
export const passwordVisibilityModule = createPasswordVisibilityModule();
