import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createArenaState,
  ensureArenaParticipant,
} from "../src/lib/arena.ts";
import { getStudentInitials } from "../src/lib/student-identity.ts";

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

const joinPageSource = read("src/app/join/page.tsx");
const joinRouteSource = read("src/app/api/quizzes/join/route.ts");
const arenaRouteSource = read("src/app/api/arena/[id]/route.ts");
const studentArenaSource = read("src/app/arena/[id]/content.tsx");
const teacherArenaSource = read("src/app/dashboard/teacher/playground/arena/[id]/content.tsx");
const podiumSource = read("src/components/arena/arena-podium.tsx");
const dashboardSource = read("src/app/dashboard/student/content.tsx");
const settingsSource = read("src/app/dashboard/student/settings/content.tsx");
const progressionRouteSource = read("src/app/api/student/progression/route.ts");

test("student initials follow the persisted-name two-part rule", () => {
  assert.equal(getStudentInitials("Christian Glenn Pacaldo"), "CG");
  assert.equal(getStudentInitials("Juan Dela Cruz"), "JD");
  assert.equal(getStudentInitials("Maria"), "M");
  assert.equal(getStudentInitials("  FRESH,   QA, STUDENT  "), "FQ");
  assert.equal(getStudentInitials("", "ST"), "ST");
});

test("Arena participant identity is deterministic across refresh and reconnect", () => {
  const state = createArenaState({ quizId: 42, teacherId: "teacher-1" });
  const firstJoin = ensureArenaParticipant(state, {
    studentId: "student-1",
    studentName: "Christian Glenn Pacaldo",
  });
  assert.equal(firstJoin.initials, "CG");

  (firstJoin as typeof firstJoin & { avatar?: string }).avatar = "🚀";
  const reconnect = ensureArenaParticipant(state, {
    studentId: "student-1",
    studentName: "Christian Glenn Pacaldo",
  });
  assert.equal(reconnect.initials, "CG");
  assert.equal("avatar" in reconnect, false);
});

test("regression: the conflicting local mascot and equipped-profile sources are retired", () => {
  assert.equal(joinPageSource.includes("proctor_chosen_mascot"), false);
  assert.equal(joinPageSource.includes("selectedMascot"), false);
  assert.equal(joinPageSource.includes("avatar:"), false);
  assert.equal(joinRouteSource.includes("equippedAvatar"), false);
  assert.equal(arenaRouteSource.includes("equippedAvatar"), false);
  assert.equal(arenaRouteSource.includes("AVATAR_CATALOG"), false);
});

test("student dashboard and settings expose no customization controls", () => {
  for (const source of [joinPageSource, dashboardSource, settingsSource]) {
    assert.equal(/avatar shop|customize avatar|avatar customization|mascot/i.test(source), false);
  }
  assert.equal(fs.existsSync(path.resolve(process.cwd(), "src/app/join/avatar-shop/page.tsx")), false);
  assert.equal(fs.existsSync(path.resolve(process.cwd(), "src/app/api/student/avatar-shop/route.ts")), false);
});

test("all Arena identity views use the shared initials component", () => {
  assert.match(studentArenaSource, /ArenaIdentity/);
  assert.match(teacherArenaSource, /ArenaIdentity/);
  assert.match(podiumSource, /ArenaIdentity/);
  assert.equal((studentArenaSource.match(/<ArenaIdentity/g) || []).length >= 5, true);
  assert.equal((teacherArenaSource.match(/<ArenaIdentity/g) || []).length >= 5, true);
  assert.equal((podiumSource.match(/<ArenaIdentity/g) || []).length >= 4, true);
  for (const source of [studentArenaSource, teacherArenaSource, podiumSource]) {
    assert.equal(source.includes(".avatar"), false);
  }
});

test("progression API remains EXP and Level only", () => {
  assert.match(progressionRouteSource, /getStudentProgression/);
  assert.equal(progressionRouteSource.includes("equippedAvatar"), false);
  assert.equal(progressionRouteSource.includes("coins"), false);
});
