import assert from "node:assert/strict";
import test from "node:test";
import { loadEmail } from "./helpers/email-harness.ts";

type Message = { to: string; subject: string; html: string; text?: string };
function fixture() {
  const messages: Message[] = [];
  const email = loadEmail({ environment: { NODE_ENV: "production", EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_synthetic_only", EMAIL_FROM: "noreply@example.test" },
    console: { log() {}, error() {} }, fetch: (async (_url, init) => {
      messages.push(JSON.parse(String(init?.body))); return Response.json({ id: "synthetic-message" });
    }) as typeof fetch,
  });
  return { email, messages };
}
test("ordinary welcome content, subject, recipient and existing HTML formatting remain intact", async () => {
  const s = fixture(); assert.equal(await s.email.sendWelcomeEmail("person@example.test", "Demo Teacher", "teacher"), true);
  const m = s.messages[0]; assert.equal(m.to, "person@example.test"); assert.equal(m.subject, "Welcome to ProctorShield AI, Demo Teacher!");
  assert.match(m.html, /Hello <strong>Demo Teacher<\/strong>/); assert.match(m.html, /<strong>Teacher<\/strong>/);
  assert.match(m.html, /max-width: 600px/); assert.match(m.html, /Welcome to ProctorShield AI 🛡️/);
  assert.equal(m.text, undefined); // Existing contract is HTML-only; do not invent/encode a plaintext body.
});
test("welcome name and role encode text exactly once while plaintext subject stays raw", async () => {
  const s = fixture(); const name = `A&B "Ace" <Student> O'Neil`;
  assert.equal(await s.email.sendWelcomeEmail("person@example.test", name, `<img src=x onerror=alert(1)>`), true);
  const m = s.messages[0]; assert.equal(m.subject, `Welcome to ProctorShield AI, ${name}!`);
  assert.match(m.html, /A&amp;B &quot;Ace&quot; &lt;Student&gt; O&#39;Neil/);
  assert.match(m.html, /&lt;img src=x onerror=alert\(1\)&gt;/); assert.doesNotMatch(m.html, /<img|A&amp;amp;B/);
});
test("injected welcome link is displayed as literal text, never an active destination", async () => {
  const s = fixture(); const payload = `<a href="https://attacker.example.test">Reset access</a>`;
  assert.equal(await s.email.sendWelcomeEmail("person@example.test", payload, "student"), true);
  assert.ok(s.messages[0].html.includes('&lt;a href=&quot;https://attacker.example.test&quot;&gt;Reset access&lt;/a&gt;'));
  assert.doesNotMatch(s.messages[0].html, /<a\b|href="https:\/\/attacker/);
});
test("verdict escapes name, title, analysis, verdict and runtime score text; CSS stays allowlisted", async () => {
  const s = fixture(); const payload = `<img src=x onerror="alert('x')"> & text`;
  assert.equal(await s.email.sendVerdictEmail("person@example.test", payload, payload, 80, payload, payload), true);
  const m = s.messages[0]; assert.equal(m.subject, `Quiz Result & AI Analysis: ${payload}`);
  assert.doesNotMatch(m.html, /<img|onerror="/); assert.match(m.html, /&lt;img src=x onerror=&quot;alert\(&#39;x&#39;\)&quot;&gt; &amp; text/);
  assert.match(m.html, /&lt;IMG SRC=X ONERROR=&quot;ALERT\(&#39;X&#39;\)&quot;&gt; &amp; TEXT/);
  assert.match(m.html, /background-color: #dc2626/); assert.match(m.html, />80%<\/strong>/);
  assert.equal(m.text, undefined);
  await s.email.sendVerdictEmail("person@example.test", "Student", "Quiz", '<svg onload=alert(1)>' as unknown as number, "clean", "No issue");
  assert.match(s.messages[1].html, /&lt;svg onload=alert\(1\)&gt;%/); assert.doesNotMatch(s.messages[1].html, /<svg/);
});
test("all existing verdict color and formatting variants remain unchanged", async () => {
  const s = fixture();
  for (const [verdict, color] of [["clean", "#16a34a"], ["suspicious", "#d97706"], ["cheated", "#dc2626"]]) {
    await s.email.sendVerdictEmail("person@example.test", "Student", "Quiz & Review", 87.5, verdict, 'A&B said "clear".');
    const m = s.messages.at(-1)!; assert.ok(m.html.includes(`background-color: ${color}`)); assert.ok(m.html.includes(verdict.toUpperCase()));
    assert.match(m.html, /87\.5%/); assert.match(m.html, /Quiz &amp; Review/); assert.match(m.html, /A&amp;B said &quot;clear&quot;\./);
    assert.equal(m.subject, "Quiz Result & AI Analysis: Quiz & Review");
  }
});
test("OTP content is escaped without changing valid codes, expiry text or delivery contract", async () => {
  const s = fixture(); assert.equal(await s.email.sendOtpEmail("person@example.test", "123456"), true);
  assert.match(s.messages[0].html, />123456<\/span>/); assert.match(s.messages[0].html, /valid for 10 minutes/);
  assert.equal(s.messages[0].subject, "Your ProctorShield AI Verification Code");
  await s.email.sendOtpEmail("person@example.test", "<b>123456</b>"); assert.match(s.messages[1].html, /&lt;b&gt;123456&lt;\/b&gt;/);
  assert.doesNotMatch(s.messages[1].html, /<b>/);
});
test("raw entity-looking user text retains its literal meaning instead of becoming markup", async () => {
  const s = fixture(); await s.email.sendWelcomeEmail("person@example.test", "A&amp;B &lt;tag&gt;", "student");
  assert.match(s.messages[0].html, /A&amp;amp;B &amp;lt;tag&amp;gt;/);
  assert.equal(s.messages[0].subject, "Welcome to ProctorShield AI, A&amp;B &lt;tag&gt;!");
});
