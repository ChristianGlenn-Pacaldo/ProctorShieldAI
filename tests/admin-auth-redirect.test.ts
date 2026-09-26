import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type ElementNode = { type: unknown; props: Record<string, unknown> };

function compile(relativePath: string, jsx = false) {
  const filename = path.resolve(process.cwd(), relativePath);
  return {
    filename,
    code: ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: jsx ? ts.JsxEmit.ReactJSX : undefined,
        esModuleInterop: true,
      },
    }).outputText,
  };
}

function proxyFixture() {
  const { filename, code } = compile("src/proxy.ts");
  const exports: { proxy?: (request: unknown) => { status: number; headers: Headers } } = {};
  const response = (status: number, location?: string) => ({
    status,
    headers: new Headers(location ? { Location: location } : undefined),
    cookies: { delete() {} },
  });
  vm.runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: {
        next: () => response(200),
        redirect: (url: URL) => response(307, url.toString()),
        json: () => response(401),
      } };
      if (name === "@/lib/auth") return { verifyToken: (token: string) => {
        if (token === "valid-admin") return { role: "admin" };
        if (token === "valid-student") return { role: "student" };
        if (token === "valid-teacher") return { role: "teacher" };
        return null;
      } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    Headers,
    process: { env: { NODE_ENV: "test" } },
  }, { filename });

  return (pathname: string, cookie?: { role: string; value: string }) => {
    const url = Object.assign(new URL(`http://localhost${pathname}`), {
      clone() { return new URL(this.toString()); },
    });
    return exports.proxy!({
      nextUrl: url,
      headers: new Headers(),
      cookies: { get: (name: string) => cookie && name === `ps_session_${cookie.role}` ? { value: cookie.value } : undefined },
    });
  };
}

test("anonymous and invalid Admin sessions reach the canonical Admin login page", () => {
  const proxy = proxyFixture();
  for (const pathname of ["/dashboard/admin", "/dashboard/admin/users"]) {
    for (const cookie of [undefined, { role: "admin", value: "expired" }, { role: "admin", value: "invalid" }]) {
      const response = proxy(pathname, cookie);
      assert.equal(response.status, 307);
      assert.equal(new URL(response.headers.get("Location")!).pathname, "/admin/login");
    }
  }
  assert.equal(proxy("/admin/login").status, 200);
  assert.equal(proxy("/dashboard/admin", { role: "admin", value: "valid-admin" }).status, 200);
});

test("Student and Teacher proxy login destinations remain unchanged", () => {
  const proxy = proxyFixture();
  for (const pathname of ["/dashboard/student", "/dashboard/student/results", "/dashboard/teacher", "/dashboard/teacher/quizzes"]) {
    const role = pathname.includes("student") ? "student" : "teacher";
    for (const cookie of [undefined, { role, value: "expired" }]) {
      const response = proxy(pathname, cookie);
      assert.equal(response.status, 307);
      assert.equal(new URL(response.headers.get("Location")!).pathname, "/login");
    }
    assert.equal(proxy(pathname, { role, value: `valid-${role}` }).status, 200);
  }
  assert.equal(proxy("/api/dashboard/admin", { role: "admin", value: "expired" }).status, 401);
});

async function layoutRedirect(relativePath: string, session: { role: string; fullName: string } | null) {
  const { filename, code } = compile(relativePath, true);
  const exports: { default?: (props: { children: null }) => Promise<ElementNode> } = {};
  let redirectedTo: string | null = null;
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  vm.runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name === "@/lib/auth") return { getSession: async () => session };
      if (name === "next/navigation") return { redirect: (destination: string) => {
        redirectedTo = destination;
        throw new Error("redirect");
      } };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      return { __esModule: true, default: () => null };
    },
  }, { filename });
  try {
    const result = await exports.default!({ children: null });
    return { redirectedTo, result };
  } catch (error) {
    assert.match(String(error), /redirect/);
    return { redirectedTo, result: null };
  }
}

test("Admin layout sends missing or revoked sessions to Admin login", async () => {
  const layout = "src/app/dashboard/admin/layout.tsx";
  assert.equal((await layoutRedirect(layout, null)).redirectedTo, "/admin/login");
  assert.equal((await layoutRedirect(layout, { role: "teacher", fullName: "Wrong Role" })).redirectedTo, "/admin/login");
  const valid = await layoutRedirect(layout, { role: "admin", fullName: "QA Admin" });
  assert.equal(valid.redirectedTo, null);
  assert.equal(valid.result?.props.role, "admin");
});

test("Student and Teacher layout guards still use generic login", async () => {
  for (const role of ["student", "teacher"]) {
    const layout = `src/app/dashboard/${role}/layout.tsx`;
    assert.equal((await layoutRedirect(layout, null)).redirectedTo, "/login");
  }
});

function textOf(value: unknown): string {
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object" && "props" in value) return textOf((value as ElementNode).props.children);
  return value === undefined || value === null || typeof value === "boolean" ? "" : String(value);
}

function findButton(value: unknown, label: string): ElementNode | undefined {
  if (Array.isArray(value)) return value.map((child) => findButton(child, label)).find(Boolean);
  if (!value || typeof value !== "object" || !("props" in value)) return undefined;
  const node = value as ElementNode;
  if (node.type === "button" && textOf(node.props.children).trim() === label) return node;
  return findButton(node.props.children, label);
}

function dashboardFixture(role: "admin" | "student" | "teacher") {
  const { filename, code } = compile("src/components/dashboard-shell.tsx", true);
  const exports: { default?: (props: Record<string, unknown>) => ElementNode } = {};
  const requests: Array<{ url: string; role: string }> = [];
  const window = { location: { href: "" } };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  vm.runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name === "react") return { useState: (initial: unknown) => [initial, () => {}], useEffect: () => {}, useRef: () => ({ current: null }) };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (name === "next/navigation") return { usePathname: () => `/dashboard/${role}`, useRouter: () => ({ push() {} }) };
      if (name === "clsx") return { clsx: (...values: unknown[]) => values.filter(Boolean).join(" ") };
      if (name === "lucide-react") return new Proxy({}, { get: () => () => null });
      return { __esModule: true, default: () => null };
    },
    fetch: async (url: string, options: { body: string }) => {
      requests.push({ url, role: JSON.parse(options.body).role });
      return { ok: true };
    },
    window,
    process: { env: {} },
  }, { filename });
  const view = exports.default!({ role, userName: "QA User", userInitials: "QA", children: null });
  return { view, requests, window };
}

test("Admin logout uses Admin login while Student and Teacher logout keep generic login", async () => {
  for (const role of ["admin", "student", "teacher"] as const) {
    const fixture = dashboardFixture(role);
    const button = findButton(fixture.view, "Log Out");
    assert.ok(button);
    await (button.props.onClick as () => Promise<void>)();
    assert.deepEqual(fixture.requests, [{ url: "/api/auth/logout", role }]);
    assert.equal(fixture.window.location.href, role === "admin" ? "/admin/login" : "/login");
  }
});
