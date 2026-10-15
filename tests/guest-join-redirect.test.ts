import assert from "node:assert/strict";
import test from "node:test";
import { getAuthDestination, getJoinLoginDestination } from "../src/lib/auth-destination.ts";

for (const code of ["PS-ABC123", "ps-abc123", " PS — ABC123 ", "ＰＳ-ＡＢＣ１２３"]) {
  test("login intent and Student destination share normalization: " + code, () => {
    const login = new URL(getJoinLoginDestination(code), "https://app.example.test");
    assert.equal(login.pathname, "/login");
    assert.equal(login.search, "?joinCode=PS-ABC123");
    assert.equal(getAuthDestination("student", login.searchParams.get("joinCode")), "/join?code=PS-ABC123");
  });
}
for (const code of ["", "ab", "x".repeat(65), "//evil.test", "https://evil.test", "%2f%2fevil.test",
  "PS-ABC?next=https://evil.test", "PS-ABC#x", "PS-ABC&role=student", null, undefined, ["PS-ABC"], { code: "PS-ABC" }]) {
  test("malformed login intent falls back to fixed login: " + JSON.stringify(code), () => {
    assert.equal(getJoinLoginDestination(code), "/login");
    assert.equal(getAuthDestination("student", code), "/dashboard/student");
  });
}
test("both intent directions accept the existing inclusive 3–64 character bounds", () => {
  for (const code of ["ABC", "A".repeat(64)]) {
    assert.equal(getJoinLoginDestination(code), "/login?joinCode=" + code);
    assert.equal(getAuthDestination("student", code), "/join?code=" + code);
  }
});
for (const role of ["teacher", "admin"]) test(role + " cannot adopt a Student join destination", () => {
  assert.equal(getAuthDestination(role, "PS-ABC123"), "/dashboard/" + role);
});
test("unrecognized accounts cannot select an authenticated destination", () => {
  assert.equal(getAuthDestination("owner", "PS-ABC123"), null);
});
