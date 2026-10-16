import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";

const manifest = JSON.parse(fs.readFileSync("tests/fixtures/visual-release-protected.json", "utf8")) as { mainSHA: string; hashes: Record<string,string>; defenseBaseline: string; defenseOverrides: Record<string,string>; refactorOverrides: Record<string,string>; mvpOverrides: Record<string,string>; preDefenseRelease: string; preDefenseOverrides: Record<string,string>; localStabilizationBaseline: string; localStabilizationOverrides: Record<string,string>; demoReadinessBaseline: string; demoReadinessOverrides: Record<string,string>; laptopStabilityBaseline: string; laptopStabilityOverrides: Record<string,string> };
test("defense release preserves baseline files except recorded defense, refactor, MVP and approved pre-defense fixes", () => {
  assert.equal(manifest.mainSHA, "3e016784e15e20c2b55dbf3dc09c5a16ca0d3dc4");
  assert.ok(Object.keys(manifest.hashes).length > 150);
  assert.equal(manifest.preDefenseRelease, "d184ef833861d01ea0413c9d7737afac841db081");
  assert.ok(Object.keys(manifest.preDefenseOverrides).length > 0);
  for (const file of Object.keys(manifest.preDefenseOverrides)) assert.ok(file in manifest.hashes, file);
  // Explicitly pin the worker's traced assets, existing mobile model choice,
  // public model-asset proxy path, and recorded moderate Right correction.
  // All other protected hashes stay intact.
  assert.equal(manifest.localStabilizationBaseline, "c07b72570384474ada1583afdba738e21ab5f498");
  assert.deepEqual(Object.keys(manifest.localStabilizationOverrides).sort(), ["next.config.ts", "src/lib/desktop-head-tracking.ts", "src/lib/device-capabilities.ts", "src/proxy.ts"]);
  assert.equal(manifest.demoReadinessBaseline, "ceedeae3b6084e0bf9e60634c4c10a6a1f25d989");
  assert.deepEqual(Object.keys(manifest.demoReadinessOverrides).sort(), ["prisma/seed.ts", "scripts/bootstrap.ts", "scripts/create-proctorshield-std-sdd.ps1", "scripts/update-project-docs.ps1", "src/app/api/ai/create/route.ts", "src/app/api/quizzes/route.ts", "src/lib/subscription-rules.ts", "src/lib/teacher-entitlements.ts"]);
  // The approved laptop fix changes only WASM tracing/CSP, camera cadence and
  // workload selection, TensorFlow startup order and reliable clip uploads.
  // Preserve every other hash.
  assert.equal(manifest.laptopStabilityBaseline, "2937620d3686a0568a6da3f41997fbad269d5841");
  assert.deepEqual(Object.keys(manifest.laptopStabilityOverrides).sort(), ["next.config.ts", "src/app/api/live/violation/[id]/evidence/route.ts", "src/app/quiz/[id]/page.tsx", "src/lib/desktop-head-tracking.ts", "src/lib/device-capabilities.ts", "src/lib/tensorflow-browser.ts", "src/proxy.ts"]);
  for (const [file,expected] of Object.entries(manifest.hashes)) {
    const normalized = Buffer.from(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
    assert.equal(createHash("sha256").update(normalized).digest("hex"),manifest.laptopStabilityOverrides[file] ?? manifest.demoReadinessOverrides[file] ?? manifest.localStabilizationOverrides[file] ?? manifest.preDefenseOverrides[file] ?? manifest.mvpOverrides[file] ?? manifest.refactorOverrides[file] ?? manifest.defenseOverrides[file] ?? expected,file);
  }
  assert.equal(fs.existsSync("src/lib/password-hash.ts"),false,"future versioned-password implementation is excluded");
});
test("defense release preserves notification calculation and repairs Admin unified login destinations", () => {
  assert.match(fs.readFileSync("src/components/dashboard-shell.tsx","utf8"), /setUnreadCount\(visible\.filter\(\(notification\) => !notification\.isRead\)\.length\)/);
  assert.match(fs.readFileSync("src/app/dashboard/admin/layout.tsx","utf8"), /redirect\("\/login"\)/);
  assert.match(fs.readFileSync("src/app/dashboard/admin/content.tsx","utf8"), /href="\/login"/);
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
