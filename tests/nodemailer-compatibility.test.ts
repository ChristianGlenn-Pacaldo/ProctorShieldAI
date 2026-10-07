import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { loadEmail } from "./helpers/email-harness.ts";

test("Nodemailer ESM MIME composer preserves HTML and file/URL access restrictions", async () => {
  const mime = await new MailComposer({
    from: { name: "ProctorShield AI", address: "sender@gmail.com" },
    to: "student@example.test", subject: "Verification", html: "<p>123456</p>",
    disableFileAccess: true, disableUrlAccess: true,
  }).compile().build();
  assert.match(mime.toString(), /To: student@example.test/);
  assert.match(mime.toString(), /Content-Type: text\/html/);
  assert.match(mime.toString(), /123456/);
  await assert.rejects(new MailComposer({
    attachments: [{ path: "package.json" }], disableFileAccess: true,
  }).compile().build(), /File access rejected/);
  await assert.rejects(new MailComposer({
    attachments: [{ href: "https://example.test/file" }], disableUrlAccess: true,
  }).compile().build(), /Url access rejected/i);
});

test("SMTP application templates still deliver once and report rejection without fallback", async () => {
  const messages: string[] = [];
  let rejectDelivery = false;
  const server = net.createServer(socket => {
    socket.setEncoding("utf8");
    socket.write("220 localhost ESMTP\r\n");
    let buffer = "", data = false, message = "";
    socket.on("data", chunk => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (data) {
          if (line === ".") {
            data = false; messages.push(message); message = "";
            socket.write(rejectDelivery ? "550 Delivery rejected\r\n" : "250 Queued\r\n");
          } else message += line + "\r\n";
        } else if (/^EHLO/.test(line)) socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH/.test(line)) socket.write("235 Authenticated\r\n");
        else if (line === "DATA") { data = true; socket.write("354 Send message\r\n"); }
        else if (line === "QUIT") socket.end("221 Bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as net.AddressInfo;
  // The harness loads the real CJS Nodemailer entry; intercept only its network
  // destination so the application's Gmail configuration is exercised offline.
  const { createRequire } = await import("node:module");
  const cjs = createRequire(import.meta.url)("nodemailer") as typeof nodemailer;
  const original = cjs.createTransport;
  const configurations: unknown[] = [];
  cjs.createTransport = ((options: Record<string, unknown>) => {
    configurations.push(options);
    return original({ ...options, service: undefined, host: "127.0.0.1",
      port: address.port, secure: false, ignoreTLS: true });
  }) as typeof cjs.createTransport;
  const email = loadEmail({ environment: { EMAIL_PROVIDER: "smtp", NODE_ENV: "development",
    SMTP_EMAIL: "sender@gmail.com", SMTP_PASSWORD: "fixture-password" },
    console: { log() {}, error() {} },
    fetch: (async () => { throw new Error("Unexpected fallback"); }) as typeof fetch,
  });
  try {
    assert.equal(await email.sendOtpEmail("student@example.test", "123456"), true);
    assert.equal(await email.sendWelcomeEmail("teacher@example.test", "Teacher", "teacher"), true);
    assert.equal(await email.sendVerdictEmail("student@example.test", "Student", "Quiz", 80, "clean", "No issue"), true);
    rejectDelivery = true;
    assert.equal(await email.sendOtpEmail("student@example.test", "654321"), false);
    assert.equal(messages.length, 4);
    assert.match(messages[0], /123456/);
    assert.match(messages[1], /Welcome to ProctorShield AI/);
    assert.match(messages[2], /Quiz Result & AI Analysis/);
    for (const configuration of configurations) assert.deepEqual(JSON.parse(JSON.stringify(configuration)), {
      service: "gmail", auth: { user: "sender@gmail.com", pass: "fixture-password" },
    });
  } finally {
    cjs.createTransport = original;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
