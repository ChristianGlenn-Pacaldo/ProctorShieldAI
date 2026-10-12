import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import * as passwords from "../src/lib/password-hash.ts";
import { authFixture } from "./helpers/auth-fixture.ts";

type Row = { id: string; email: string; password: string; sessionVersion: number; status: string; role: { roleName: string } };
type Data = { password: string; sessionVersion?: { increment: number }; roleId?: number; status?: string; email?: string };
type Write = { mode: "create" | "update"; data: Data; committed: boolean };
const paths = ["scripts/bootstrap.ts", "scripts/reset_admin_password.ts", "prisma/seed.ts"];
const replacement = "OperatorPassword1234";

// Execute only source-extracted password-setting statements in a VM. No script
// entrypoint, dotenv, real Prisma, CLI process or later bootstrap/seed work runs.
function harness(relative: string, options: { existing?: boolean; fail?: "conflict" | "write"; wrongRole?: boolean; missingAdmin?: boolean; env?: Record<string, string>; users?: Map<string, Row> } = {}) {
  const source = fs.readFileSync(relative, "utf8"), ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const main = ast.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "main")!;
  const statements: string[] = [];
  for (const statement of main.body!.statements) {
    const text = statement.getText(ast);
    if (text.includes("prisma.subject.") || text.includes("prisma.subscriptionPlan.")) break;
    statements.push(text);
  }
  const imports = ast.statements.filter(ts.isImportDeclaration).map(s => s.getText(ast)).join("\n");
  const code = ts.transpileModule(`${imports}\nasync function main(){${statements.join("\n")}}\nexports.run = main;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const environment = { ADMIN_EMAIL: "admin@example.test", ADMIN_PASSWORD: replacement, SEED_DEMO_DATA: "true", DEMO_STUDENT_PASSWORD: replacement, DEMO_TEACHER_PASSWORD: replacement, ...options.env };
  const users = options.users ?? new Map<string, Row>(), writes: Write[] = [];
  const legacy = bcrypt.hashSync("FixturePassword123", 4);
  const find = (email: string) => [...users.values()].find(row => row.email === email);
  function existing(email: string, roleName = "admin") {
    let row = find(email);
    if (!row && options.existing !== false) { row = { id: email, email, password: legacy, sessionVersion: 7, status: "active", role: { roleName: options.wrongRole ? "student" : roleName } }; users.set(row.id, row); }
    return row;
  }
  if (relative.endsWith("reset_admin_password.ts") && !options.missingAdmin) existing(environment.ADMIN_EMAIL);
  const commit = (row: Row | undefined, data: Data, mode: "create" | "update", email: string) => {
    const write: Write = { mode, data, committed: false }; writes.push(write);
    if (options.fail) throw Object.assign(new Error("Synthetic atomic write rejected"), { code: options.fail === "conflict" ? "P2025" : "TEST_WRITE_FAILURE" });
    if (!row) { row = { id: email, email, password: data.password, sessionVersion: 0, status: data.status ?? "active", role: { roleName: ["student", "teacher", "admin"][(data.roleId ?? 3) - 1] } }; users.set(row.id, row); }
    else { const next = { ...row, password: data.password, email: data.email ?? row.email, status: data.status ?? row.status, sessionVersion: row.sessionVersion + (data.sessionVersion?.increment ?? 0) }; Object.assign(row, next); }
    write.committed = true; return structuredClone(row);
  };
  const prisma = {
    role: { upsert: async ({ create }: { create: { roleName: string } }) => ({ id: ["student", "teacher", "admin"].indexOf(create.roleName) + 1, ...create }) },
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => { const row = existing(where.email); return row ? structuredClone(row) : null; },
      findFirst: async ({ where }: { where: { role: { roleName: string } } }) => options.missingAdmin ? null : structuredClone([...users.values()].find(row => row.role.roleName === where.role.roleName) ?? null),
      upsert: async ({ where, update, create }: { where: { email: string }; update: Data; create: Data }) => {
        const row = existing(where.email, ["student", "teacher", "admin"][(create.roleId ?? 3) - 1]);
        return commit(row, row ? update : create, row ? "update" : "create", where.email);
      },
      update: async ({ where, data }: { where: { id: string }; data: Data }) => { const row = users.get(where.id); assert.ok(row); return commit(row, data, "update", row.email); },
    },
  };
  const exports: { run?: () => Promise<void> } = {};
  vm.runInNewContext(code, { exports, process: { env: environment }, console: { log() {} }, Error,
    require: (name: string) => {
      if (name === "dotenv/config") return {};
      if (name === "../src/lib/prisma") return { __esModule: true, default: prisma };
      if (name === "../src/lib/password-hash.ts") return passwords;
      if (name === "node:crypto") return { randomBytes };
      throw new Error("Forbidden operator-test import: " + name);
    },
  });
  return { run: exports.run!, users, writes, legacy };
}

for (const relative of paths) test(`${relative}: strict password and sessionVersion replacement share one atomic update`, async () => {
  const f = harness(relative); await f.run(); assert.equal(f.writes.length, relative.includes("seed") ? 7 : 1);
  for (const write of f.writes) { assert.equal(write.mode, "update"); assert.equal(write.data.sessionVersion?.increment, 1); assert.equal(write.committed, true); assert.match(write.data.password, /^psai:pw:v1:\$2b\$12\$/); }
  for (const row of f.users.values()) { assert.equal(row.sessionVersion, 8); assert.equal(await passwords.verifyPassword(replacement, row.password), true); }
});

for (const relative of [paths[0], paths[2]]) test(`${relative}: newly created accounts retain version zero`, async () => {
  const f = harness(relative, { existing: false }); await f.run();
  for (const write of f.writes) { assert.equal(write.mode, "create"); assert.equal(write.data.sessionVersion, undefined); }
  for (const row of f.users.values()) assert.equal(row.sessionVersion, 0);
});

for (const relative of paths) for (const fail of ["conflict", "write"] as const) test(`${relative}: ${fail} failure cannot commit either password or counter`, async () => {
  const f = harness(relative, { fail }); await assert.rejects(f.run(), /Synthetic atomic write rejected/);
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].committed, false); assert.equal(f.writes[0].data.sessionVersion?.increment, 1);
  for (const row of f.users.values()) { assert.equal(row.password, f.legacy); assert.equal(row.sessionVersion, 7); }
});

for (const relative of paths) for (const password of ["A1" + "a".repeat(71), "Operator\0Password1234"]) test(`${relative}: invalid future password makes no password write`, async () => {
  const f = harness(relative, { env: { ADMIN_PASSWORD: password } }); await assert.rejects(f.run()); assert.equal(f.writes.length, 0);
});

test("bootstrap preserves non-admin identity conflict guard", async () => {
  const f = harness(paths[0], { wrongRole: true }); await assert.rejects(f.run(), /non-admin/); assert.equal(f.writes.length, 0);
  for (const row of f.users.values()) { assert.equal(row.role.roleName, "student"); assert.equal(row.sessionVersion, 7); }
});
test("Admin reset preserves missing-account guard", async () => { const f = harness(paths[1], { missingAdmin: true }); await assert.rejects(f.run(), /Admin user not found/); assert.equal(f.writes.length, 0); });
test("seed preserves disposable-demo guard", async () => { const f = harness(paths[2], { env: { SEED_DEMO_DATA: "false" } }); await assert.rejects(f.run(), /Demo seeding is disabled/); assert.equal(f.writes.length, 0); });

for (const relative of paths) test(`${relative}: real session reader rejects an old signed synthetic Admin session after the operator update`, async () => {
  const auth = authFixture(); auth.cookies.set("ps_session_admin", auth.token("admin"));
  assert.ok(await auth.auth.getAdminSession({ touchActivity: false }));
  const f = harness(relative, { users: auth.users }); await f.run();
  assert.equal(auth.users.get("admin")!.sessionVersion, 1); assert.equal(await auth.auth.getAdminSession({ touchActivity: false }), null);
  assert.equal((await auth.post("auth/login", { email: "admin@example.test", password: replacement, role: "admin" })).status, 200);
  assert.equal(auth.cookies.has("ps_session_user"), false);
});
