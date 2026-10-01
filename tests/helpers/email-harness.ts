import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import type * as EmailModule from "../../src/lib/email.ts";

const nodeRequire = createRequire(import.meta.url);

// Node's test runner has no Next server-only alias. Keep the actual transport
// and MIME composer; replace only that marker and the supplied network boundary.
export function loadEmail(options: {
  environment?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  console?: Pick<Console, "log" | "error">;
} = {}): typeof EmailModule {
  const modules = new Map<string, Record<string, unknown>>();
  function load(relativePath: string): Record<string, unknown> {
    if (modules.has(relativePath)) return modules.get(relativePath)!;
    const exports: Record<string, unknown> = {};
    modules.set(relativePath, exports);
    const filename = path.resolve(relativePath);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(code, {
      exports,
      require: (name: string) => {
        if (name === "server-only") return {};
        if (name.startsWith("./")) return load(path.join(path.dirname(relativePath), name));
        return nodeRequire(name);
      },
      process: options.environment ? { env: options.environment } : process,
      fetch: (...args: Parameters<typeof fetch>) => (options.fetch ?? globalThis.fetch)(...args),
      console: options.console ?? console,
      AbortSignal, URLSearchParams, Buffer,
    }, { filename });
    return exports;
  }
  return load("src/lib/email.ts") as typeof EmailModule;
}
