import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("direct Admin Settings navigation redirects to the protected Admin dashboard without rendering settings", () => {
  const exports: { default?: () => unknown } = {};
  const destination: string[] = [];
  const redirect = new Error("NEXT_REDIRECT");
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("src/app/dashboard/admin/settings/page.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require(name: string) {
    assert.equal(name, "next/navigation");
    return { redirect(url: string) { destination.push(url); throw redirect; } };
  } });
  assert.throws(() => exports.default!(), error => error === redirect);
  assert.deepEqual(destination, ["/dashboard/admin"]);
});
