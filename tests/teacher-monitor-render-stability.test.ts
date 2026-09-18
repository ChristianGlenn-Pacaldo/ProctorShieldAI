import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const teacherMonitorPath = path.resolve(process.cwd(), "src/app/dashboard/teacher/monitor/content.tsx");
const teacherMonitorSrc = fs.readFileSync(teacherMonitorPath, "utf-8");

const teacherPagePath = path.resolve(process.cwd(), "src/app/dashboard/teacher/monitor/page.tsx");
const teacherPageSrc = fs.readFileSync(teacherPagePath, "utf-8");

const arenaContentPath = path.resolve(process.cwd(), "src/app/arena/[id]/content.tsx");
const arenaContentSrc = fs.readFileSync(arenaContentPath, "utf-8");

const quizPagePath = path.resolve(process.cwd(), "src/app/quiz/[id]/page.tsx");
const quizPageSrc = fs.readFileSync(quizPagePath, "utf-8");

// ─────────────────────────────────────────────────────────────
// TEACHER MONITOR RENDER STABILITY & PIPELINE INTEGRITY TESTS
// ─────────────────────────────────────────────────────────────

test("1. Teacher Monitor page passes initialIsSubscribed to prevent blocking client loader", () => {
  assert.match(teacherPageSrc, /hasActiveProSubscription/);
  assert.match(teacherPageSrc, /initialIsSubscribed=\{isSubscribed\}/);
  assert.match(teacherMonitorSrc, /initialIsSubscribed = false/);
  assert.match(teacherMonitorSrc, /const \[isCheckingSub, setIsCheckingSub\] = useState\(false\)/);
});

test("2. 0 active students renders immediate waiting state without infinite spinner", () => {
  assert.match(teacherMonitorSrc, /Waiting for active students to join\.\.\./);
  assert.match(teacherMonitorSrc, /Student webcam snapshots will appear automatically while a quiz is active/);
});

test("3. StudentVideoFeed is memoized with custom equality to prevent re-render churn", () => {
  assert.match(teacherMonitorSrc, /const StudentVideoFeed = React\.memo\(/);
  assert.match(teacherMonitorSrc, /prev\.feed\.snapshot === next\.feed\.snapshot/);
  assert.match(teacherMonitorSrc, /prev\.feed\.id === next\.feed\.id/);
});

test("4. Snapshot polling creates single interval with clean unmount", () => {
  assert.match(teacherMonitorSrc, /const interval = setInterval\(pollSnapshots, 2000\)/);
  assert.match(teacherMonitorSrc, /return \(\) => \{\s*isMounted = false;\s*clearInterval\(interval\);/);
});

test("5. Snapshot polling handles in-flight concurrency lock", () => {
  assert.match(teacherMonitorSrc, /if \(isPolling\) return;/);
  assert.match(teacherMonitorSrc, /isPolling = true;/);
  assert.match(teacherMonitorSrc, /isPolling = false;/);
});

test("6. Pusher subscribes once per teacher channel with unmount cleanup", () => {
  assert.match(teacherMonitorSrc, /pusher\.subscribe\(`private-teacher-\$\{teacherId\}`\)/);
  assert.match(teacherMonitorSrc, /pusher\.unsubscribe\(`private-teacher-\$\{teacherId\}`\)/);
  assert.match(teacherMonitorSrc, /pusher\.disconnect\(\)/);
});

test("7. Pusher effect dependencies are stable [isSubscribed, teacherId] to prevent resubscribe on feed update", () => {
  assert.match(teacherMonitorSrc, /\}, \[isSubscribed, teacherId\]\);/);
});

test("8. Snapshot polling updates only changed feed entries and returns prev reference if unchanged", () => {
  assert.match(teacherMonitorSrc, /let hasChanges = false;/);
  assert.match(teacherMonitorSrc, /return hasChanges \? updated : prev;/);
});

test("9. Connection status interval returns current reference when no status change occurs", () => {
  assert.match(teacherMonitorSrc, /let changed = false;/);
  assert.match(teacherMonitorSrc, /return changed \? next : current;/);
});

test("10. Violation event triggers targeted student alert without triggering full refetch storm", () => {
  assert.match(teacherMonitorSrc, /teacherChannel\.bind\("new-violation"/);
  assert.match(teacherMonitorSrc, /setTotalViolations\(\(prev\) => prev \+ 1\)/);
  assert.match(teacherMonitorSrc, /violationFeed: Feed/);
});

test("11. Student inspector modal uses reactive derived state from feeds", () => {
  assert.match(teacherMonitorSrc, /const \[selectedStudentId, setSelectedStudentId\] = useState/);
  assert.match(teacherMonitorSrc, /const selectedStudentModal = useMemo\(/);
});

test("12. Snapshot polling network exceptions fail gracefully without crashing or spinning", () => {
  assert.match(teacherMonitorSrc, /try \{[\s\S]*fetch\("\/api\/live\/snapshot"\)[\s\S]*\} catch \{/);
});

test("13. Mobile violation pipeline remains intact in quiz runner", () => {
  assert.match(quizPageSrc, /awayIncidentActiveRef/);
  assert.match(quizPageSrc, /beginAway/);
  assert.match(quizPageSrc, /reportViolationRef/);
});

test("14. Power Arena remains completely isolated with no webcam or monitoring code", () => {
  assert.equal(arenaContentSrc.includes("StudentVideoFeed"), false);
  assert.equal(arenaContentSrc.includes("pollSnapshots"), false);
  assert.equal(arenaContentSrc.includes("private-teacher-"), false);
});
