import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

function packageClosure(dockerfile: string) {
  const copied = new Set<string>();
  for (const line of dockerfile.split(/\r?\n/)) {
    const match = /^COPY (\S+) (\S+)$/.exec(line);
    if (match && !match[1].includes("*")) copied.add(match[1]);
  }
  const visited = new Set<string>();
  const inspect = (file: string) => {
    assert.ok(copied.has(file), `Missing runtime COPY: ${file}`);
    if (visited.has(file)) return;
    visited.add(file);
    const ast = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith(".")) continue;
      let target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      if (!path.posix.extname(target)) target += ".ts";
      inspect(target);
    }
  };
  inspect("scripts/bootstrap.ts");
  return visited;
}

test("migration image includes the complete local bootstrap import closure without executing it", () => {
  const source = fs.readFileSync("Dockerfile.migrate", "utf8");
  assert.deepEqual([...packageClosure(source)].sort(), ["scripts/bootstrap.ts", "src/lib/password-hash.ts", "src/lib/prisma.ts"]);
  assert.match(source, /^COPY scripts\/railway-staging-migrate\.mjs /m);
  assert.match(source, /^COPY prisma\.config\.ts /m);
  assert.match(source, /^COPY prisma /m);
  assert.match(source, /^CMD \["sleep", "infinity"\]$/m);
  assert.doesNotMatch(source, /^RUN .*\b(?:migrate deploy|bootstrap|db seed)\b/m);
  assert.match(fs.readFileSync(".dockerignore", "utf8"), /^\.env\*/m);
});

test("the original missing-helper image fails import-closure verification", () => {
  const original = fs.readFileSync("Dockerfile.migrate", "utf8").replace(/^COPY src\/lib\/password-hash\.ts .*\r?\n/m, "");
  assert.throws(() => packageClosure(original), /Missing runtime COPY: src\/lib\/password-hash.ts/);
});
