import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fixture, deferred, find, textOf, teacherDashboard, studentQuizzes, notification, type Reply } from "./helpers/dashboard-lifecycle-fixture.ts";
import { authFixture } from "./helpers/auth-fixture.ts";

test("actual Teacher password login replaced by Admin login invalidates User consumers without adopting Admin identity",async()=>{
  const auth=authFixture();
  assert.equal((await auth.post("auth/login",{email:"teacher@example.test",password:"FixturePassword123",role:"teacher"})).status,200);
  const setup=fixture("teacher",auth); setup.render(); await setup.ready();
  const joined=setup.event("private-teacher-teacher","student-joined");
  assert.equal((await auth.post("auth/login",{email:"admin@example.test",password:"FixturePassword123",role:"admin"})).status,200);
  assert.equal(auth.cookies.has("ps_session_user"),false);
  joined({studentName:"Before confirmed loss"}); await setup.ready(); lost(setup);
  const count=setup.requests.length;
  joined({studentName:"Stale Student after confirmed loss"}); await setup.advance(35_000);
  assert.equal(setup.requests.length,count); assert.deepEqual(setup.channelNames(),[]);
  setup.unmount(); setup.assertDisposed();
});

test("Teacher JSON parsing in flight cannot commit after shell authorization loss",async()=>{
  const setup=fixture("teacher"); setup.render(); await setup.ready();
  const json=deferred<unknown>(); setup.queue("/api/dashboard/teacher",{body:json.promise});
  setup.event("private-teacher-teacher-id","student-joined")({studentName:"Before parsing"}); await setup.ready();
  setup.queue("/api/notifications",{status:401}); setup.shellCallback("notification")(); await setup.ready(); lost(setup);
  json.resolve(teacherDashboard); await setup.ready(); lost(setup); setup.unmount(); setup.assertDisposed();
});

function lost(setup: ReturnType<typeof fixture>) {
  assert.match(textOf(setup.render()), /session has expired or changed|no longer have access/);
  assert.doesNotMatch(textOf(setup.render()), /Private Teacher result|Private Student quiz|RADAR ACTIVE|Retry|QA User/);
  assert.equal(setup.notificationCount(), 0);
  assert.equal(setup.bell().props.disabled, true);
  assert.deepEqual(setup.resources(), { timers: 0, connected: 0, subscriptions: 0 });
}

for (const status of [401, 403] as const) {
  test(`Teacher dashboard ${status} synchronously shuts down shell and queued combat callbacks`, async () => {
    const setup = fixture("teacher"); setup.render(); await setup.ready(); setup.render();
    assert.match(textOf(setup.render()), /Private Teacher result/);
    const joined = setup.event("private-teacher-teacher-id", "student-joined");
    const violation = setup.event("private-teacher-teacher-id", "new-violation");
    const submitted = setup.event("private-teacher-teacher-id", "student-submitted");
    setup.queue("/api/dashboard/teacher", {status,body:{error:"Forbidden"}});
    joined({studentName:"Initial probe"}); await setup.ready(); lost(setup);
    const count = setup.requests.length;
    joined({studentName:"Stale realtime Student"}); violation({studentName:"Initial probe",violationType:"no_face"}); submitted({studentName:"Initial probe"});
    await setup.advance(35_000);
    assert.equal(setup.requests.length, count);
    lost(setup); setup.unmount(); setup.assertDisposed();
  });
}

for (const role of ["teacher", "student"] as const) {
  test(`${role} shell-detected loss aborts content work before queued callbacks or delayed JSON can restore data`, async () => {
    const setup = fixture(role); setup.render(); await setup.ready(); setup.render();
    const callback = role === "teacher" ? setup.event("private-teacher-teacher-id", "student-joined") : setup.event("private-student-student-id", "retake-decision");
    const old = deferred<Reply>();
    if (role === "teacher") { setup.queue("/api/dashboard/teacher",old.promise); callback({studentName:"Before loss"}); }
    else { setup.queue("/api/quizzes",old.promise); await setup.advance(5_000); }
    await setup.ready();
    const request = setup.requests.at(-1)!;
    const shell = setup.shellCallback("notification"); setup.queue("/api/notifications",{status:401}); shell();
    await setup.ready(); lost(setup); assert.equal(request.signal?.aborted,true);
    const count=setup.requests.length;
    callback(role === "teacher" ? {studentName:"Queued after Admin replacement"} : {action:"accept",quizId:44});
    old.resolve({body:role === "teacher" ? teacherDashboard : studentQuizzes}); await setup.ready(); await setup.advance(35_000);
    assert.equal(setup.requests.length,count); assert.deepEqual(setup.pushes,[]);
    lost(setup); setup.unmount(); setup.assertDisposed();
  });

  test(`${role} initial 401 renders no protected data and stops every lifecycle`, async () => {
    const setup=fixture(role); setup.queue("/api/notifications",{status:401}); setup.render(); await setup.ready(); lost(setup);
    const count=setup.requests.length; await setup.advance(35_000); assert.equal(setup.requests.length,count);
    setup.unmount(); setup.assertDisposed();
  });

  test(`${role} fresh authorized mount starts a new lifecycle and rejects the previous generation`, async () => {
    const setup=fixture(role); setup.render(); await setup.ready(); setup.render();
    const oldEvent=role === "teacher" ? setup.event("private-teacher-teacher-id","student-joined") : setup.event("private-student-student-id","retake-decision");
    const old=deferred<Reply>(); const shell=setup.shellCallback("notification");
    setup.queue("/api/notifications",old.promise); shell(); await setup.ready();
    setup.queue("/api/notifications",{status:401}); await setup.advance(15_000); lost(setup);
    setup.queue("/api/notifications",{body:notification("Fresh User notification")}); setup.remount(); await setup.ready(); setup.render();
    const count=setup.requests.length;
    oldEvent(role === "teacher" ? {studentName:"Old generation Student"} : {action:"accept",quizId:44});
    old.resolve({body:notification("Old User notification")}); await setup.ready();
    assert.equal(setup.requests.length,count); assert.equal(setup.notificationTitles(),"Fresh User notification"); assert.deepEqual(setup.pushes,[]);
    assert.equal(setup.bell().props.disabled,false); setup.unmount(); setup.assertDisposed();
  });
}

for (const failure of [{status:500},{status:503},new Error("network failure"),{status:403,body:{error:"Forbidden origin"}},{status:403,body:{code:"SUBSCRIPTION_REQUIRED",error:"Pro required"}}]) {
  test(`Teacher transient/policy failure ${failure instanceof Error ? "network" : JSON.stringify(failure)} retains Retry and active subscriptions`, async () => {
    const setup=fixture("teacher"); setup.render(); await setup.ready();
    setup.queue("/api/dashboard/teacher",failure); setup.event("private-teacher-teacher-id","student-joined")({studentName:"Legitimate Student"}); await setup.ready();
    assert.match(textOf(setup.render()),/Retry/); assert.equal(setup.bell().props.disabled,false);
    assert.equal(setup.resources().connected,2);
    await setup.retry(); await setup.ready(); assert.match(textOf(setup.render()),/Private Teacher result/);
    setup.unmount(); setup.assertDisposed();
  });
}

test("Student content-detected 401 stops the independent retake listener and shell",async()=>{
  const setup=fixture("student"); setup.queue("/api/student/progression",{status:401}); setup.render(); await setup.ready(); lost(setup);
  const count=setup.requests.length; await setup.advance(35_000); assert.equal(setup.requests.length,count);
  setup.unmount(); setup.assertDisposed();
});

test("Student normal retake realtime behavior is preserved while authorized",async()=>{
  const setup=fixture("student"); setup.render(); await setup.ready();
  setup.event("private-student-student-id","retake-decision")({action:"accept",quizId:44,quizMode:"proctored"});
  assert.deepEqual(setup.pushes,["/quiz/44"]); setup.unmount(); setup.assertDisposed();
});

test("Student name-enforcement request is aborted and cannot refresh the new session after loss",async()=>{
  const setup=fixture("student",undefined,{nameEnforcer:true}); setup.render(); await setup.ready();
  find(setup.render(),n=>n.props.placeholder==="e.g. DELA CRUZ, JUAN, SANTOS")!.props.onChange({target:{value:"TEST, STUDENT"}});
  const old=deferred<Reply>(); setup.queue("/api/users/me",old.promise,"PUT");
  const saving=find(setup.render(),n=>n.type==="form"&&textOf(n).includes("Save Formal Name"))!.props.onSubmit({preventDefault(){}});
  await setup.ready(); const request=setup.requests.at(-1)!;
  setup.queue("/api/notifications",{status:401}); setup.shellCallback("notification")(); await setup.ready(); lost(setup);
  assert.equal(request.signal?.aborted,true); old.resolve({body:{success:true}}); await saving; await setup.ready();
  assert.deepEqual(setup.pushes,[]); setup.unmount(); setup.assertDisposed();
});

for (const failure of [{status:500},{status:503},new Error("network failure")]) test(`Student ${failure instanceof Error?"network":failure.status} failure retains an authorized lifecycle`,async()=>{
  const setup=fixture("student");setup.queue("/api/student/progression",failure);setup.render();await setup.ready();
  assert.match(textOf(setup.render()),/Retry/);assert.equal(setup.bell().props.disabled,false);
  assert.equal(setup.resources().connected,2); setup.unmount();setup.assertDisposed();
});

for (const role of ["teacher","student"] as const) test(`${role} private-channel 401 propagates to shell and all User consumers`,async()=>{
  const setup=fixture(role); setup.render(); await setup.ready();
  setup.event(`private-${role}-${role}-id`,"pusher:subscription_error")({status:401});
  lost(setup); const count=setup.requests.length; await setup.advance(35_000); assert.equal(setup.requests.length,count);
  setup.unmount(); setup.assertDisposed();
});

test("exact old Teacher callback reproduces stale UI writes, while current code rejects it",async()=>{
  const oldSource=execFileSync("git",["show","5dc4eba2ca8c6d48cd2dd94c678073adbf694c4e:src/app/dashboard/teacher/content.tsx"],{encoding:"utf8"});
  const old=fixture("teacher",undefined,{teacherSource:oldSource}); old.render(); await old.ready();
  const joined=old.event("private-teacher-teacher-id","student-joined");
  old.queue("/api/notifications",{status:401}); old.shellCallback("notification")(); await old.ready(); old.render();
  const count=old.requests.length; joined({studentName:"Reproduced stale Student"}); await old.ready();
  assert.ok(old.requests.length>count,"old callback starts a privileged refresh after loss");
  old.unmount(); assert.throws(()=>old.assertDisposed(),/disposed callbacks do not write React state/);
});
