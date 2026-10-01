import assert from "node:assert/strict";
import test from "node:test";
import { loadEmail } from "./helpers/email-harness.ts";

const { sendOtpEmail, sendWelcomeEmail, sendVerdictEmail } = loadEmail();

const environmentNames = ["EMAIL_PROVIDER", "RESEND_API_KEY", "EMAIL_FROM"] as const;

async function withResend(
  fetchHandler: typeof fetch,
  run: (requests: Array<{ url: string; init?: RequestInit }>) => Promise<void>,
) {
  const originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  process.env.EMAIL_PROVIDER = "resend";
  process.env.RESEND_API_KEY = "re_test_not_a_real_secret";
  process.env.EMAIL_FROM = "ProctorShield AI <no-reply@staging.example.test>";
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return fetchHandler(url, init);
  }) as typeof fetch;
  console.log = () => {};
  console.error = () => {};
  try {
    await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
    for (const name of environmentNames) {
      const original = originalEnvironment[name];
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  }
}

test("welcome email sends its existing template once through the HTTPS provider", async () => {
  await withResend(async () => Response.json({ id: "email_welcome" }), async (requests) => {
    assert.equal(await sendWelcomeEmail("teacher@example.test", "Demo Teacher", "teacher"), true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://api.resend.com/emails");
    assert.equal(requests[0].init?.method, "POST");
    assert.equal((requests[0].init?.headers as Record<string, string>).Authorization, "Bearer re_test_not_a_real_secret");
    const body = JSON.parse(String(requests[0].init?.body));
    assert.equal(body.to, "teacher@example.test");
    assert.match(body.subject, /Welcome to ProctorShield AI/);
    assert.match(body.html, /Demo Teacher/);
    assert.equal(body.from, process.env.EMAIL_FROM);
  });
});

test("OTP email sends the code once through the same provider", async () => {
  await withResend(async () => Response.json({ id: "email_otp" }), async (requests) => {
    assert.equal(await sendOtpEmail("student@example.test", "123456"), true);
    assert.equal(requests.length, 1);
    const body = JSON.parse(String(requests[0].init?.body));
    assert.equal(body.to, "student@example.test");
    assert.match(body.html, /123456/);
    assert.match(body.subject, /Verification Code/);
  });
});

test("provider rejection is logged and reported as delivery failure without an SMTP fallback", async () => {
  await withResend(async () => new Response(null, { status: 503 }), async (requests) => {
    const errors: unknown[][] = [];
    console.error = (...args: unknown[]) => { errors.push(args); };
    assert.equal(await sendOtpEmail("student@example.test", "123456"), false);
    assert.equal(requests.length, 1);
    assert.match(String(errors[0]?.[1]), /HTTP 503/);
    assert.doesNotMatch(String(errors[0]?.[1]), /123456|re_test_not_a_real_secret/);
  });
});

test("missing provider configuration fails closed without sending", async () => {
  await withResend(async () => Response.json({ id: "unexpected" }), async (requests) => {
    delete process.env.RESEND_API_KEY;
    assert.equal(await sendWelcomeEmail("teacher@example.test", "Demo Teacher", "teacher"), false);
    assert.equal(requests.length, 0);
  });
});

test("verdict email retains its report template and makes one provider request", async () => {
  await withResend(async () => Response.json({ id: "email_verdict" }), async (requests) => {
    assert.equal(await sendVerdictEmail("student@example.test", "Demo Student", "Quiz", 80, "clean", "No issue"), true);
    assert.equal(requests.length, 1);
    const body = JSON.parse(String(requests[0].init?.body));
    assert.match(body.html, /No issue/);
    assert.match(body.subject, /Quiz Result & AI Analysis/);
  });
});
