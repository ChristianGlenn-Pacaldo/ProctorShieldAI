import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";

const manifest = JSON.parse(fs.readFileSync("tests/fixtures/visual-release-protected.json", "utf8")) as { mainSHA: string; hashes: Record<string,string> };
test("visual-only release preserves every baseline backend, password, session, database and operator file", () => {
  assert.equal(manifest.mainSHA, "3e016784e15e20c2b55dbf3dc09c5a16ca0d3dc4");
  assert.ok(Object.keys(manifest.hashes).length > 150);
  for (const [file,expected] of Object.entries(manifest.hashes)) {
    const normalized = Buffer.from(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
    assert.equal(createHash("sha256").update(normalized).digest("hex"),expected,file);
  }
  assert.equal(fs.existsSync("src/lib/password-hash.ts"),false,"future versioned-password implementation is excluded");
});
test("visual-only release preserves main's notification calculation and Admin destinations", () => {
  assert.match(fs.readFileSync("src/components/dashboard-shell.tsx","utf8"), /setUnreadCount\(visible\.filter\(\(notification\) => !notification\.isRead\)\.length\)/);
  assert.match(fs.readFileSync("src/app/dashboard/admin/layout.tsx","utf8"), /redirect\("\/admin\/login"\)/);
  assert.match(fs.readFileSync("src/app/dashboard/admin/content.tsx","utf8"), /href="\/admin\/login"/);
});
test("visual-only password guidance describes the unchanged main setting policy", () => {
  for (const file of ["src/app/login/student/page.tsx","src/app/login/teacher/page.tsx","src/app/login/forgot-password/page.tsx","src/app/dashboard/student/settings/content.tsx","src/app/dashboard/teacher/settings/content.tsx"]) {
    const source=fs.readFileSync(file,"utf8");
    assert.match(source,/Maximum 128 characters/);
    assert.doesNotMatch(source,/Maximum 72 UTF-8 bytes/);
  }
});
test("the original cinematic asset and both official logos are byte-identical to the approved redesign", () => {
  const assets = {
  "public/videos/original-google-flow-intro.mp4": "4262e37aa65b869e543f26833a6569f9d4e391690138b6909846b2f7a5205a82",
  "public/images/proctorshieldai-logo-transparent.png": "4fd4f338f01cfa1ddf0c0aa96613af4abebde3f1d4168650ef067af10d3800f3",
  "public/images/proctorshieldai-shield-transparent.png": "96265c440c83e31d72401bea4045eb47f421011265974fdcf359769375af457a"
};
  for (const [file,expected] of Object.entries(assets)) assert.equal(createHash("sha256").update(fs.readFileSync(file)).digest("hex"),expected,file);
});
