import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import Pusher from "pusher";

const source = ts.transpileModule(fs.readFileSync("src/lib/logout-realtime.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const signer = new Pusher({ appId: "123", key: "fixture-key", secret: "fixture-secret", cluster: "ap1", useTLS: true });
function delivery(fetcher: typeof fetch, appId = "123", cluster = "ap1") {
  const exports: any = {};
  vm.runInNewContext(source, { exports, require: (name: string) => { assert.equal(name, "server-only"); return {}; },
    AbortController, setTimeout, clearTimeout, Error, fetch: fetcher,
  });
  return exports.createLogoutDelivery({ appId, cluster, signer, fetcher });
}

test("logout uses bounded signed HTTPS without redirects and discards provider bodies", async () => {
  let cancelled = false;
  const send = delivery(async (url, options) => {
    assert.match(String(url), /^https:\/\/api-ap1\.pusher\.com\/apps\/123\/events\?/);
    assert.equal(options!.redirect, "error"); assert.equal(options!.method, "POST");
    const body = String(options!.body);
    assert.equal(String(url).split("?")[1], signer.createSignedQueryString({ method: "POST", path: "/apps/123/events", body }));
    assert.deepEqual(JSON.parse(body), { name: "activity", channels: ["private-admin-dashboard"], data: JSON.stringify({ type: "logout", userId: "fixture" }) });
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  });
  await send({ type: "logout", userId: "fixture" }); assert.equal(cancelled, true);
});

test("logout provider errors expose no signed URL/payload/error body", async () => {
  for (const fetcher of [async () => new Response("PRIVATE PROVIDER BODY", { status: 500 }), async () => { throw new Error("PRIVATE PROVIDER TOKEN"); }]) {
    await assert.rejects(delivery(fetcher)({ private: "PRIVATE PAYLOAD" }), /^Error: Logout realtime unavailable$/);
  }
});

test("logout cannot use a malformed provider host/app ID", async () => {
  let calls = 0; const fetcher = async () => { calls++; return new Response(); };
  await assert.rejects(delivery(fetcher, "../foreign")({}));
  await assert.rejects(delivery(fetcher, "123", "ap1.foreign.test")({})); assert.equal(calls, 0);
});

for (const stall of ["headers", "body"]) test(`actual stalled HTTP ${stall} are cancelled without surviving application sockets`, async () => {
  const sockets = new Set<import("node:net").Socket>();
  const server = http.createServer((_request, response) => {
    if (stall === "body") { response.writeHead(500); response.write("unfinished provider body"); }
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as import("node:net").AddressInfo;
  let signal: AbortSignal | null = null;
  const started = Date.now();
  try {
    await assert.rejects(delivery(async (_url, options) => {
      signal = options!.signal!;
      // Only the isolated test rewrites the fixed production HTTPS URL.
      return fetch(`http://127.0.0.1:${address.port}`, { ...options, headers: { ...options!.headers, Connection: "close" } });
    })({ type: "logout" }), /^Error: Logout realtime unavailable$/);
    assert.ok(Date.now() - started < 3_000, "bounded transport completion");
    if (stall === "headers") assert.equal((signal as AbortSignal | null)?.aborted, true);
    for (let i = 0; sockets.size && i < 20; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(sockets.size, 0, "actual stalled request/body is destroyed");
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
