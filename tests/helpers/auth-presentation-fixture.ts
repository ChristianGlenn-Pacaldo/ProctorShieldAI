import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "lucide-react";
import { fetchAuth } from "../../src/lib/auth-request.ts";
import { getAuthDestination } from "../../src/lib/auth-destination.ts";

// Source-backed visual states only. No effects, API calls, mail, Google SDK or DB.
export function authPresentationMarkup(relative: string, overrides: Record<string, unknown> = {}, role = "student") {
  const source = fs.readFileSync(relative, "utf8");
  const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name)
      && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === "useState") names.push(node.name.elements[0].getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast); let index = 0;
  const exports: { default?: React.ComponentType } = {};

  // Use the real JSX runtime to preserve keys and static child semantics.
  const branded = ({ width = 36, decorative = false, className = "" }: { width?: number; decorative?: boolean; className?: string }) => React.createElement("img", {
    src: "/images/proctorshieldai-shield-transparent.png", alt: decorative ? "" : "ProctorShieldAI", className,
    style: { width, maxWidth: "100%", height: "auto" },
  });
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, URL, URLSearchParams, AbortController, process: { env: { NEXT_PUBLIC_GOOGLE_CLIENT_ID: "" } },
    fetch: () => { throw Error("Visual fixture cannot make requests"); },
    require: (name: string) => {
      if (name === "react") return { ...React, useEffect: () => {}, useRef: (value: unknown) => ({ current: value }), useState: (initial: unknown) => {
        const key = names[index++]; return [Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : initial, () => {}];
      } };
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "lucide-react") return icons;
      if (name === "next/link") return { __esModule: true, default: "a" };
      if (name === "next/navigation") return { useSearchParams: () => new URLSearchParams({ role }) };
      if (name === "@/components/brand-image") return { __esModule: true, default: branded };
      if (name === "@/lib/auth-request") return { fetchAuth };
      if (name === "@/lib/auth-destination") return { getAuthDestination };
      if (name === "./unified-google-signin") return { __esModule: true, default: () => React.createElement("p", {}, "Google sign-in — visual fixture only") };
      if (name === "@react-oauth/google") return { GoogleOAuthProvider: ({ children }: { children: React.ReactNode }) => children, GoogleLogin: () => React.createElement("button", { type: "button", disabled: true }, "Google sign-in — visual fixture only") };
      throw Error("Unexpected fixture import: " + name);
    },
  });
  return renderToStaticMarkup(React.createElement("div", { className: "ps-auth" }, React.createElement(exports.default!)));
}
