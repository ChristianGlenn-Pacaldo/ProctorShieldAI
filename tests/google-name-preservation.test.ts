import assert from "node:assert/strict";
import test from "node:test";
import { authFixture } from "./helpers/auth-fixture.ts";
import { fixture as dashboardFixture, textOf } from "./helpers/dashboard-lifecycle-fixture.ts";
import { normalizeStudentName } from "../src/lib/student-name.ts";

type Fixture = ReturnType<typeof authFixture>;
const formalName = "DELA CRUZ, JUAN, SANTOS";

async function saveName(f: Fixture, role: "teacher" | "student", fullName: string) {
  f.cookies.set("ps_session_user", f.token(role));
  const response = await f.load("src/app/api/users/me/route.ts").PUT(new Request(
    `${f.environment.NEXT_PUBLIC_APP_URL}/api/users/me?scope=user&role=${role}`,
    { method: "PUT", headers: { Origin: f.environment.NEXT_PUBLIC_APP_URL, "Content-Type": "application/json" },
      body: JSON.stringify({ fullName }) },
  ));
  assert.equal(response.status, 200);
  assert.equal(f.users.get(role)!.fullName, fullName);
  assert.equal((await f.post("auth/logout")).status, 200);
  assert.equal(await f.auth.getSession(undefined, { touchActivity: false }), null);
}

async function googleLogin(f: Fixture, role: "teacher" | "student", userId: string = role) {
  const response = await f.post("auth/google", { credential: "verified-fixture", role });
  assert.equal(response.status, 200);
  const challenge = await response.json();
  assert.equal(challenge.requiresMfa, true);
  assert.equal(challenge.role, role);
  assert.equal(await f.auth.getSession(undefined, { touchActivity: false }), null, "Google identity verification alone cannot create a session");
  assert.equal((await f.post("auth/verify-otp", { userId, otpCode: "123456" })).status, 200);
  assert.equal(f.cookies.has("ps_session_user"), true);
  assert.equal(f.cookies.has("ps_session_admin"), false);
  const session = await f.auth.getUserSession(role);
  assert.equal(session.role, role);
  return session;
}

async function expectNamePrompt(f: Fixture, initialName: string, expected: boolean) {
  const session = await f.auth.getUserSession("student");
  const dashboard = dashboardFixture("student", f, { studentUserId: session.userId, nameEnforcer: true, nameEnforcerInitialName: initialName });
  try {
    dashboard.render();
    await dashboard.ready();
    assert.equal(textOf(dashboard.render()).includes("Update Your Name"), expected);
  } finally {
    dashboard.unmount();
    dashboard.assertDisposed();
  }
}

test("saved Student formal name survives repeated Google + OTP login without reopening the actual name modal", async () => {
  const f = authFixture();
  await saveName(f, "student", normalizeStudentName("  Dela Cruz , Juan , Santos  "));
  f.googleIdentity("student");
  for (let login = 0; login < 2; login++) {
    const session = await googleLogin(f, "student");
    assert.equal(f.users.get("student")!.fullName, formalName);
    assert.equal(session.fullName, formalName);
    await expectNamePrompt(f, session.fullName, false);
    assert.equal((await f.post("auth/verify-otp", { userId: "student", otpCode: "123456" })).status, 401);
    assert.equal((await f.post("auth/logout")).status, 200);
    assert.equal(await f.auth.getSession(undefined, { touchActivity: false }), null);
  }
});

test("Google login preserves the Teacher's saved profile name in persistence and the verified session", async () => {
  const f = authFixture();
  const savedName = "Dr. Saved Teacher";
  await saveName(f, "teacher", savedName);
  f.googleIdentity("teacher");
  const session = await googleLogin(f, "teacher");
  assert.equal(f.users.get("teacher")!.fullName, savedName);
  assert.equal(session.fullName, savedName);
});

test("first Google signup still initializes the name from Google and requires Student formal-name setup", async () => {
  const f = authFixture();
  f.googleIdentity("new-student");
  const session = await googleLogin(f, "student", "new-user");
  assert.equal(f.users.get("new-user")!.fullName, "Google fixture");
  assert.equal(session.fullName, "Google fixture");
  assert.deepEqual(f.mail, ["new-student@example.test"]);
  await expectNamePrompt(f, session.fullName, true);
});

test("a formal-name save committed after Google's initial lookup cannot be overwritten by its delayed profile update", async () => {
  const f = authFixture();
  f.googleIdentity("student");
  // The fixture runs this after findUnique returned its snapshot but before
  // applying the Google update, modeling an independently committed profile save.
  f.beforeUpdate(() => { f.users.get("student")!.fullName = formalName; });
  const session = await googleLogin(f, "student");
  assert.equal(f.users.get("student")!.fullName, formalName);
  assert.equal(session.fullName, formalName);
  await expectNamePrompt(f, session.fullName, false);
});

test("existing informal Student names remain preserved and still require setup", async () => {
  const f = authFixture();
  f.users.get("student")!.fullName = "Original informal name";
  f.googleIdentity("student");
  const session = await googleLogin(f, "student");
  assert.equal(session.fullName, "Original informal name");
  await expectNamePrompt(f, session.fullName, true);
});
