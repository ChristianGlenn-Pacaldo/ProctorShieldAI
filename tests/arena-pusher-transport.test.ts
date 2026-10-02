import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import Pusher from "pusher";
import { createArenaPusherDelivery, ArenaDeliveryError } from "../src/lib/arena-pusher-transport.ts";
import { arenaHttpReceiver, waitForArenaCondition } from "./helpers/arena-http-receiver.ts";

const signer = new Pusher({ appId: "123", key: "local-test-key", secret: "local-test-secret", cluster: "mt1" });

test("successful Arena delivery preserves SDK signing, channel and payload wire semantics", async () => {
  const receiver = await arenaHttpReceiver();
  try {
    const transport = createArenaPusherDelivery({ appId: "123", cluster: "mt1", signer, endpoint: receiver.endpoint });
    const payload = { quizId: 77, score: 100, arenaRevision: 4, sessionId: "session" };
    await transport.trigger(["private-arena-77", "private-teacher-qa"], "arena-end", payload);
    assert.equal(receiver.requests.length, 1);
    const request = receiver.requests[0], path = new URL(request.path, receiver.endpoint);
    assert.equal(path.pathname, "/apps/123/events"); assert.equal(path.searchParams.get("auth_key"), "local-test-key");
    assert.equal(path.searchParams.get("auth_version"), "1.0");
    assert.equal(path.searchParams.get("body_md5"), crypto.createHash("md5").update(request.body).digest("hex"));
    const signature = path.searchParams.get("auth_signature"); path.searchParams.delete("auth_signature");
    const params = [...path.searchParams].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&");
    assert.equal(signature, crypto.createHmac("sha256", "local-test-secret").update(`POST\n${path.pathname}\n${params}`).digest("hex"));
    assert.deepEqual(JSON.parse(request.body), { name: "arena-end", data: JSON.stringify(payload), channels: ["private-arena-77", "private-teacher-qa"] });
    await waitForArenaCondition(() => receiver.sockets.size === 0);
  } finally { await receiver.close(); }
});
for (const behavior of ["stall", "stall-body"] as const) test(`${behavior} is timed out at the actual HTTP transport with no socket left alive`, async () => {
  const receiver = await arenaHttpReceiver(); receiver.setBehavior(() => behavior);
  try {
    const transport = createArenaPusherDelivery({ appId: "123", cluster: "mt1", signer, endpoint: receiver.endpoint, timeoutMs: 100 });
    await assert.rejects(transport.trigger("private-arena-77", "arena-end", { score: 100 }), (error: unknown) => {
      assert.ok(error instanceof ArenaDeliveryError); assert.equal(error.code, "timeout");
      assert.equal(error.message, "Arena realtime delivery timeout"); return true;
    });
    await waitForArenaCondition(() => receiver.sockets.size === 0);
  } finally { await receiver.close(); }
});

test("caller cancellation closes a stalled request and a pre-cancelled send opens no request", async () => {
  const receiver = await arenaHttpReceiver(); receiver.setBehavior(() => "stall");
  try {
    const transport = createArenaPusherDelivery({ appId: "123", cluster: "mt1", signer, endpoint: receiver.endpoint });
    const controller = new AbortController();
    const sending = transport.trigger("private-arena-77", "arena-end", { score: 100 }, { signal: controller.signal });
    const rejected = assert.rejects(sending, (error: unknown) => error instanceof ArenaDeliveryError && error.code === "cancelled");
    await waitForArenaCondition(() => receiver.requests.length === 1); controller.abort(); await rejected;
    await waitForArenaCondition(() => receiver.sockets.size === 0);
    await assert.rejects(transport.trigger("private-arena-77", "arena-end", {}, { signal: controller.signal }), { code: "cancelled" });
    assert.equal(receiver.requests.length, 1);
  } finally { await receiver.close(); }
});

for (const behavior of ["reject", "redirect"] as const) test(`${behavior} is a sanitized failure, never fake successful delivery`, async () => {
  const receiver = await arenaHttpReceiver(); receiver.setBehavior(() => behavior);
  try {
    const transport = createArenaPusherDelivery({ appId: "123", cluster: "mt1", signer, endpoint: receiver.endpoint });
    await assert.rejects(transport.trigger("private-arena-77", "arena-end", {}), (error: unknown) => {
      assert.ok(error instanceof ArenaDeliveryError); assert.equal(error.code, "rejected");
      assert.equal(error.message, "Arena realtime delivery rejected"); assert.equal("cause" in error, false); return true;
    });
    assert.equal(receiver.requests.length, 1); await waitForArenaCondition(() => receiver.sockets.size === 0);
  } finally { await receiver.close(); }
});

test("unrelated Pusher SDK delivery configuration remains unchanged", () => {
  const source = fs.readFileSync("src/lib/pusher.ts", "utf8");
  assert.match(source, /export const pusherServer = new PusherServer/);
  assert.match(source, /export const arenaPusher = createArenaPusherDelivery/);
  assert.equal((signer as unknown as { config: { timeout?: number } }).config.timeout, undefined);
});
