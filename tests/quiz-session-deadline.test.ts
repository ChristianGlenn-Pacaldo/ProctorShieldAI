import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import * as runtime from "../src/lib/proctored-runtime.ts";
import { arenaFixture } from "./helpers/arena-fixture.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { quizSessionFixture } from "./helpers/quiz-session-fixture.ts";

for (const duration of [30, 47]) {
  test(`students starting at different times share the configured ${duration}-minute deadline`, async () => {
    const f=quizSessionFixture(duration); const a=await f.add("a"); const b=await f.add("b");
    assert.equal((await f.teacherStart()).status, 200);
    assert.equal((await f.start(a.id)).body.remainingSeconds, duration*60);
    f.advance(15);
    assert.equal((await f.start(b.id)).body.remainingSeconds, (duration-15)*60);
    const one=await f.get("a"); const two=await f.get("b");
    assert.equal(one.body.sessionEndsAt, two.body.sessionEndsAt);
    assert.equal(two.body.remainingSeconds, (duration-15)*60);
  });
}

test("violation auto-submit and approved retake return to the original shared deadline", async () => {
  const f=quizSessionFixture(); const a=await f.add("a"); await f.teacherStart(); await f.start(a.id);
  f.advance(12); f.state.violations=Array.from({length:3},(_,i)=>({id:BigInt(i+1),studentQuizId:a.id,violationType:"tab_switch",confidenceScore:100,timestamp:new Date(f.now())}));
  const completed=await f.submit(a.id,"violation_limit"); assert.equal(completed.status,200); assert.equal(completed.body.result.integrityInvalidated,true);
  assert.equal(f.state.quizzes.get(7).quizStatus,"in_progress");
  assert.equal((await f.retake(a.id)).status,200); f.advance(3); assert.equal((await f.approve(a.id)).status,200);
  const retake=[...f.state.attempts.values()].find((row:any)=>row.attemptNumber===2);
  assert.equal((await f.start(retake.id)).body.remainingSeconds,15*60);
  assert.equal(f.state.violations.length,3); assert.equal(f.state.attempts.get(a.id).quizStatus,"completed");
});

test("an expired session cannot gain time through retake approval", async () => {
  const f=quizSessionFixture(); const a=await f.add("a"); await f.teacherStart(); await f.start(a.id);
  assert.equal((await f.submit(a.id,"manual")).status,200); assert.equal((await f.retake(a.id)).status,200);
  f.advance(30);
  assert.equal((await f.approve(a.id)).status,409);
  assert.equal(f.state.attempts.size,1);
});

for (const flow of ["refresh", "reconnect", "reopen"] as const) {
  test(`${flow} reuses the same active attempt and shared deadline`, async () => {
    const f=quizSessionFixture(); const a=await f.add("a"); await f.teacherStart(); await f.start(a.id);
    const first=await f.get("a"); f.advance(17.5);
    const resumed=await f.get("a"); assert.equal(resumed.body.remainingSeconds,750);
    assert.equal(resumed.body.sessionEndsAt,first.body.sessionEndsAt);
    f.advance(0.1); const opened=await f.start(a.id);
    assert.equal(opened.body.remainingSeconds,744);
    assert.equal(opened.body.sessionEndsAt,first.body.sessionEndsAt);
    assert.equal(f.state.attempts.size,1);
  });
}

test("first student arriving after teacher start gets only remaining time", async () => {
  const f=quizSessionFixture(47); const a=await f.add("a"); await f.teacherStart(); f.advance(10);
  assert.equal((await f.start(a.id)).body.remainingSeconds,37*60);
});

test("expiry rejects unstarted attempts, retake requests, answers and autosaves without adding time", async () => {
  const f=quizSessionFixture(); const a=await f.add("a"); const b=await f.add("b"); await f.teacherStart(); await f.start(a.id); f.advance(30);
  const completed=await f.submit(a.id,"timer_expired"); assert.equal(completed.status,200); assert.equal(completed.body.result.deadlineExpired,true);
  assert.equal((await f.retake(a.id)).status,409);
  assert.equal((await f.start(b.id)).status,409); assert.equal(f.state.attempts.get(b.id).startTime,null);
  assert.equal((await f.get("b")).body.remainingSeconds,0);
  const c=await f.add("c"); f.state.attempts.get(c.id).startTime=new Date(f.now()); f.state.attempts.get(c.id).quizStatus="in_progress";
  assert.equal((await f.answer(c.id)).status,409);
  assert.equal((await f.autosave(c.id)).status,409);
  assert.equal(f.state.answers.length,0);
});

test("expiry finalizes an already-active attempt without accepting late answers", async () => {
  const f=quizSessionFixture(1); const a=await f.add("a"); await f.teacherStart(); await f.start(a.id); f.advance(1);
  const resumed=await f.start(a.id); assert.equal(resumed.status,200); assert.equal(resumed.body.remainingSeconds,0);
  assert.equal((await f.submit(a.id,"timer_expired")).status,200);
});

test("completed or teacher-ended session cannot create or start a new retake", async () => {
  const f=quizSessionFixture(); const a=await f.add("a"); await f.teacherStart(); await f.start(a.id);
  await f.submit(a.id,"manual"); await f.retake(a.id); f.state.quizzes.get(7).quizStatus="ended";
  assert.equal((await f.approve(a.id)).status,409); assert.equal(f.state.attempts.size,1);
  const b=await f.add("b"); f.state.attempts.get(b.id).attemptNumber=2;
  assert.equal((await f.start(b.id)).status,409);
  assert.equal((await f.teacherStart()).status,400);
});

test("a genuinely new quiz session has its own full configured duration", async () => {
  const f=quizSessionFixture(47); const a=await f.add("a"); await f.teacherStart(); await f.start(a.id); const old=await f.get("a"); f.advance(50);
  f.state.quizzes.set(8,{...structuredClone(f.state.quizzes.get(7)),id:8,quizStatus:"active"});
  const b=await f.add("a",8); assert.equal((await f.teacherStart(8)).status,200);
  const fresh=await f.start(b.id); assert.equal(fresh.body.remainingSeconds,47*60);
  assert.notEqual(fresh.body.sessionId,old.body.sessionId); assert.notEqual(fresh.body.sessionEndsAt,old.body.sessionEndsAt);
  assert.equal((await f.get("a",7)).body.remainingSeconds,0);
});

test("legacy deployed session inherits earliest retained start, including completed attempts", async () => {
  const f=quizSessionFixture(47); f.state.quizzes.get(7).quizStatus="in_progress";
  const old=await f.add("a"); Object.assign(f.state.attempts.get(old.id),{startTime:new Date(f.now()-15*60_000),endTime:new Date(f.now()-3*60_000),quizStatus:"completed"});
  const returned=await f.add("a"); f.state.attempts.get(returned.id).attemptNumber=2;
  assert.equal((await f.start(returned.id)).body.remainingSeconds,32*60);
  f.advance(1); assert.equal((await f.get("a")).body.remainingSeconds,31*60);
});

test("concurrent first starts cannot create different shared deadlines", async () => {
  const f=quizSessionFixture(47); const a=await f.add("a"); const b=await f.add("b"); await f.teacherStart();
  const starts=await Promise.all([f.start(a.id),f.start(b.id)]);
  assert.ok(starts.every(r=>r.status===200)); assert.equal(starts[0].body.sessionEndsAt,starts[1].body.sessionEndsAt);
  assert.equal(f.state.settings.size,1);
});

for (const invalidClock of ["corrupt", "", null]) test(`invalid durable session clock ${JSON.stringify(invalidClock)} fails closed instead of starting a fresh timer`, async () => {
  const f=quizSessionFixture(); const a=await f.add("a"); await f.teacherStart();
  f.state.settings.get("proctored:session:7").settingValue=invalidClock;
  assert.equal((await f.start(a.id)).status,500); assert.equal(f.state.attempts.get(a.id).startTime,null);
});

function effectContaining(file: string, marker: string) {
  const source = ts.createSourceFile(file, fs.readFileSync(file,"utf8"), ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let callback: ts.Node | undefined;
  const visit=(node: ts.Node)=>{ if(ts.isCallExpression(node) && node.expression.getText(source)==="useEffect" && node.arguments[0]?.getText(source).includes(marker)) callback=node.arguments[0]; ts.forEachChild(node,visit); };
  visit(source); assert.ok(callback);
  return ts.transpileModule(`exports.effect=${callback.getText(source)};`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
}

test("monitored countdown uses server time and monotonic elapsed time despite device clock skew", (t) => {
  const serverTime=Date.parse("2026-10-05T10:15:00Z");
  const clock={remainingSeconds:900,serverTime,sessionEndsAt:new Date(serverTime+900_000).toISOString()};
  t.mock.method(Date,"now",()=>serverTime+9*3600_000);
  let monotonic=1000; const deadlineRef={current:runtime.examCountdownDeadline(clock,1000,1000)}; let seconds=0;
  let tick:()=>void=()=>{};
  const exports:any={};
  vm.runInNewContext(effectContaining("src/app/quiz/[id]/page.tsx","if (deadlineRef.current !== null) setTimeLeft"),{
    exports,hasStarted:true,timerInitializedRef:{current:true},deadlineRef,remainingExamSeconds:runtime.remainingExamSeconds,
    performance:{now:()=>monotonic},setTimeLeft:(value:number)=>{seconds=value;},
    window:{setInterval:(fn:()=>void)=>{tick=fn;return 1;},clearInterval(){}},document:{addEventListener(){},removeEventListener(){}},
  });
  exports.effect(); assert.equal(seconds,900);
  monotonic+=150_000; tick(); assert.equal(seconds,750);
  t.mock.method(Date,"now",()=>serverTime-9*3600_000); monotonic+=150_000; tick(); assert.equal(seconds,600);
  monotonic+=600_000; tick(); assert.equal(seconds,0);
  assert.equal(runtime.examCountdownDeadline({...clock,remainingSeconds:0},1000,1100),1100);
  assert.equal(runtime.remainingExamSeconds(1000,999),1); assert.equal(runtime.remainingExamSeconds(1000,1000),0);
});

test("reconnect reconciliation restores the same server clock and handles expiry", async () => {
  const f=quizSessionFixture(); const a=await f.add("a"); await f.teacherStart(); await f.start(a.id); f.advance(17.5);
  let seconds=0; let reconnect:()=>Promise<void>=async()=>{}; const reasons:string[]=[];
  const exports:any={}; const deadlineRef={current:999999999};
  vm.runInNewContext(effectContaining("src/app/quiz/[id]/page.tsx","const reconcile = async ()"),{
    exports,hasStarted:true,quizId:7,submissionInFlightRef:{current:false},studentQuizIdRef:{current:a.id},navigator:{onLine:true},
    fetch:async()=>({ok:true,json:async()=> (await f.get("a")).body}),performance:{now:()=>1000},deadlineRef,
    examCountdownDeadline:runtime.examCountdownDeadline,remainingExamSeconds:runtime.remainingExamSeconds,
    setTimeLeft:(value:number)=>{seconds=value;},violationCountRef:{current:0},setViolationCount(){},startedAtRef:{current:f.now()},teacherEndedRef:{current:false},
    pendingSubmissionRef:{current:null},allQuestionsAnswered:runtime.allQuestionsAnswered,questionsRef:{current:[{id:1}]},answersStateRef:{current:{}},
    submitQuizRef:{current:async(reason:string)=>{reasons.push(reason);}},setHasStarted(){},router:{replace(){}},
    window:{setInterval(){return 1;},clearInterval(){},addEventListener:(name:string,fn:()=>Promise<void>)=>{if(name==="online")reconnect=fn;},removeEventListener(){}},
    document:{addEventListener(){},removeEventListener(){}},
  });
  exports.effect(); await reconnect(); assert.equal(seconds,750); assert.deepEqual(reasons,[]);
  f.advance(12.5); await reconnect(); assert.equal(seconds,0); assert.deepEqual(reasons,["timer_expired"]);
});

test("returning Arena participant, refresh and reconnect retain matchEndsAt and session identity", async () => {
  const f=arenaFixture("lobby"); f.data.quiz.duration=47; await f.action("create_session"); await f.action("join","a"); await f.action("start");
  const state=f.read(); state.startedAt=new Date(Date.now()-17*60_000).toISOString(); state.matchEndsAt=new Date(Date.now()+30*60_000).toISOString(); f.save(state);
  const membership=Object.keys(state.participants);
  const returned=await f.action("join","a"); assert.equal(returned.status,200);
  assert.equal(returned.body.arena.matchEndsAt,state.matchEndsAt); assert.equal(returned.body.sessionId,state.sessionId);
  assert.deepEqual(Object.keys(returned.body.arena.participants),membership); assert.equal(typeof returned.body.serverTime,"number");
  for(const flow of ["refresh","reconnect"]) {
    const snapshot=await f.load("arena/[id]","a").GET({nextUrl:{searchParams:new URLSearchParams("view=snapshot")}}, {params:Promise.resolve({id:"77"})});
    assert.equal(snapshot.body.arena.matchEndsAt,state.matchEndsAt,flow); assert.equal(snapshot.body.sessionId,state.sessionId);
    assert.ok(Math.abs((Date.parse(snapshot.body.arena.matchEndsAt)-snapshot.body.serverTime)/1000-1800)<2);
  }
});

test("Arena student's timer uses existing server clock offset instead of the skewed device clock", () => {
  const file=ts.createSourceFile("arena.tsx",fs.readFileSync("src/app/arena/[id]/content.tsx","utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let handler:ts.Node|undefined;
  const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(file)==="arenaChannel.bind"&&node.arguments[0]?.getText(file)==='"arena-start"')handler=node.arguments[1];ts.forEachChild(node,visit);};
  visit(file);assert.ok(handler);
  const serverNow=Date.now(); const localNow=serverNow+9*3600_000; const offset={current:0}; let seconds=0;
  const exports:any={};
  vm.runInNewContext(ts.transpileModule(`exports.start=${handler.getText(file)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,Date:{now:()=>localNow,parse:Date.parse},serverTimeOffsetRef:offset,getServerAdjustedNow:()=>localNow+offset.current,
    finalizationAttemptedRef:{current:false},arenaCompletedRef:{current:false},setPhase(){},setCurrentQuestionIndex(){},setCurrentSessionId(){},setMatchEndsAt(){},
    setMatchTimeLeft:(value:number)=>{seconds=value;},updateRankingsFromParticipants(){},
  });
  exports.start({serverTime:serverNow,matchEndsAt:new Date(serverNow+900_000).toISOString()}); assert.equal(seconds,900);
});


test("teacher End closes the shared clock for every active attempt and blocks returning starts", async () => {
  const f=quizSessionFixture(47); const a=await f.add("a"); const b=await f.add("b"); await f.teacherStart(); await f.start(a.id); f.advance(5);
  assert.equal((await f.end()).status,200);
  assert.equal((await f.get("a")).body.remainingSeconds,0);
  assert.equal((await f.start(a.id)).body.remainingSeconds,0);
  assert.equal((await f.start(b.id)).status,409);
  assert.equal((await f.submit(a.id,"teacher_ended")).status,200);
});


test("approved Arena return inherits the active match clock without participant registration", async () => {
  const f=quizSessionFixture(47); const a=await f.add("a"); f.state.quizzes.get(7).quizMode="arena"; f.state.quizzes.get(7).quizStatus="in_progress";
  const arena=f.deps["@/lib/arena"].createArenaState({quizId:7,teacherId:"teacher",status:"active",config:{matchDuration:47*60}});
  f.deps["@/lib/arena"].ensureArenaParticipant(arena,{studentId:"a",studentName:"A"});
  f.state.settings.set("arena:state:7",{settingKey:"arena:state:7",settingValue:JSON.stringify(arena)});
  Object.assign(f.state.attempts.get(a.id),{attemptMode:"arena",quizStatus:"pending_retake",startTime:new Date(arena.startedAt),endTime:new Date(f.now())});
  f.advance(17);
  assert.equal((await f.approve(a.id)).status,200);
  const returned=[...f.state.attempts.values()].find((row:any)=>row.attemptNumber===2);
  assert.equal(returned.startTime.getTime(),Date.parse(arena.startedAt));
  const saved=JSON.parse(f.state.settings.get("arena:state:7").settingValue);
  assert.equal(saved.sessionId,arena.sessionId); assert.equal(saved.matchEndsAt,arena.matchEndsAt);
  assert.deepEqual(Object.keys(saved.participants),["a"]);
});

test("expired Arena cannot gain a new attempt or deadline through approval", async () => {
  const f=quizSessionFixture(1); const a=await f.add("a"); f.state.quizzes.get(7).quizMode="arena"; f.state.quizzes.get(7).quizStatus="in_progress";
  const arena=f.deps["@/lib/arena"].createArenaState({quizId:7,teacherId:"teacher",status:"active",config:{matchDuration:60}});
  f.state.settings.set("arena:state:7",{settingKey:"arena:state:7",settingValue:JSON.stringify(arena)});
  Object.assign(f.state.attempts.get(a.id),{attemptMode:"arena",quizStatus:"pending_retake",startTime:new Date(arena.startedAt),endTime:new Date(f.now())});
  f.advance(1);
  assert.equal((await f.approve(a.id)).status,409); assert.equal(f.state.attempts.size,1);
  assert.equal(JSON.parse(f.state.settings.get("arena:state:7").settingValue).matchEndsAt,arena.matchEndsAt);
});

test("a genuine fresh Arena session receives its own configured clock", async () => {
  const f=arenaFixture("lobby"); f.data.quiz.duration=47; await f.action("create_session"); await f.action("start");
  const old=f.read(); old.startedAt=new Date(Date.now()-17*60_000).toISOString(); old.matchEndsAt=new Date(Date.now()+30*60_000).toISOString(); f.save(old);
  assert.equal((await f.action("create_session")).status,200);
  const started=await f.action("start"); assert.equal(started.status,200);
  assert.notEqual(started.body.sessionId,old.sessionId); assert.equal(started.body.arena.matchDuration,47*60);
  assert.ok(Math.abs(Date.parse(started.body.arena.matchEndsAt)-Date.now()-47*60_000)<1000);
});
