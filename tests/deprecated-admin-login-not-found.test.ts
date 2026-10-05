import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { getAuthDestination } from "../src/lib/auth-destination.ts";
import { authFixture } from "./helpers/auth-fixture.ts";

const requireNode = createRequire(import.meta.url);
const { NextRequest, NextResponse } = requireNode("next/server");
const navigation = requireNode("next/navigation");
const directory = "src/app/admin/login";

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, {
    exports, Headers, URL, process: { env: { NODE_ENV: "production" } },
    require(name: string) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected route dependency: ${name}`);
      return dependencies[name];
    },
  }, { filename: path });
  return exports as T;
}

const page = load<{ default: () => never; metadata: { title: string; description: string } }>(
  `${directory}/page.tsx`, { "next/navigation": navigation },
);
const fallback = load<{ default: () => ReactElement }>(`${directory}/not-found.tsx`, {
  "react/jsx-runtime": requireNode("react/jsx-runtime"),
  "next/link": { __esModule: true, default: "a" },
  "next/image": { __esModule: true, default: "img" },
  "lucide-react": requireNode("lucide-react"),
  "./not-found.module.css": { __esModule: true, default: new Proxy({}, { get: (_target, name) => name }) },
});
const markup = renderToStaticMarkup(fallback.default());

function realNotFound() {
  // Use the installed framework's actual notFound(), including its HTTP digest.
  assert.throws(page.default, (error: unknown) => {
    assert.equal((error as { digest: string }).digest, "NEXT_HTTP_ERROR_FALLBACK;404");
    return true;
  });
}

test("deprecated route invokes the real Next.js HTTP 404 fallback", realNotFound);

test("scoped fallback renders the approved branding, heading, badge and support text", () => {
  assert.match(markup, /ProctorShield/);
  assert.match(markup, /404 .*PAGE NOT FOUND/);
  assert.match(markup, /<h1[^>]*>This page could not be found\.<\/h1>/);
  assert.match(markup, /The page you&#x27;re looking for may have been moved, removed, or is no longer available\./);
  assert.match(markup, /Academic Integrity Platform/);
  assert.equal((markup.match(/<h1\b/g) ?? []).length, 1);
});

test("old access heading, email field and submit button are absent", () => {
  assert.doesNotMatch(markup, /Admin Access|Admin Email|Access Admin Panel|<form\b|<input\b|<button\b/i);
});

test("visible content, accessible attributes and route metadata disclose no privileged route", () => {
  assert.doesNotMatch(markup + JSON.stringify(page.metadata), /admin|administrator|\/admin\/login/i);
  assert.equal(page.metadata.title, "Page Not Found | ProctorShieldAI");
});

test("recovery links lead to home and the unchanged unified sign-in route", () => {
  assert.match(markup, /<a href="\/"[^>]*>.*?Back to Home<\/a>/);
  assert.match(markup, /<a href="\/login"[^>]*>Go to Sign In.*?<\/a>/);
  assert.match(markup, /<nav[^>]*aria-label="Page recovery"/);
});

test("approved local robot is decorative and excluded from the accessibility tree", () => {
  assert.ok(fs.existsSync("public/images/proctorshield-404-robot.jpg"));
  assert.match(markup, /<div class="visual" aria-hidden="true">/);
  assert.match(markup, /<img[^>]*src="\/images\/proctorshield-404-robot.jpg"[^>]*alt=""/);
});

// Compose the actual public-route Proxy and page. External persistence is the
// existing owned fixture; session validation, JWT and browser state are real.
for (const role of [null, "admin", "teacher", "student"] as const) {
  for (const method of ["GET", "HEAD"]) {
    test(`${role ?? "anonymous"} ${method} reaches 404 without redirects or session writes`, async () => {
      const fixture = authFixture();
      if (role) {
        fixture.cookies.set(role === "admin" ? "ps_session_admin" : "ps_session_user", fixture.token(role));
        assert.equal((await fixture.auth.getSession(undefined, { touchActivity: false })).role, role);
      }
      const snapshot = () => ({ users: structuredClone(fixture.users), cookies: [...fixture.allCookies()],
        cookieOptions: [...fixture.cookieOptions], browserCookieOptions: [...fixture.browserCookieOptions],
        generations: [...fixture.generations.values], expiry: [...fixture.generations.expires],
        logs: [...fixture.logs], events: [...fixture.events], rateCalls: [...fixture.rateCalls] });
      const before = snapshot();
      const reads: string[] = [];
      const proxy = load<{ proxy: (request: unknown) => Response | Promise<Response> }>("src/proxy.ts", {
        "next/server": { NextResponse },
        "@/lib/auth-destination": { getAuthDestination },
        "@/lib/auth": { ...fixture.auth,
          getSession: () => { reads.push("getSession"); throw new Error("Deprecated route must not read a session"); },
          verifyToken: () => { reads.push("verifyToken"); throw new Error("Deprecated route must not select a role"); },
        },
      });
      const cookie = [...fixture.allCookies()].map(([name, value]) => `${name}=${value}`).join("; ");
      const response = await proxy.proxy(new NextRequest("https://app.example.test/admin/login", {
        method, headers: { Cookie: cookie },
      }));
      assert.equal(response.headers.get("x-middleware-next"), "1", "Proxy continues to the route's real 404");
      assert.equal(response.headers.get("Location"), null);
      assert.equal(response.headers.get("Set-Cookie"), null);
      assert.equal(response.headers.get("Cache-Control"), "no-store, max-age=0");
      assert.deepEqual(reads, []);
      realNotFound();
      assert.deepEqual(snapshot(), before);
    });
  }
}
