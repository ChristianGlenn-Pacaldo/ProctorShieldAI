import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { arenaFixture } from "./helpers/arena-fixture.ts";
import { getAttemptQuestionOrder } from "../src/lib/quiz-question-order.ts";

const originals=[1,2,3,4].map(id=>({id,points:id*10,choices:[{id:id*10,isCorrect:true},{id:id*10+1,isCorrect:false}]}));
function retryFixture() {
  const f=arenaFixture();Object.assign(f.data.quiz,{questions:structuredClone(originals),totalQuestions:4,_count:{questions:4}});
  const state=f.read();state.totalQuestions=4;for(const p of Object.values(state.participants) as any[])p.totalQuestions=4;f.save(state);
  const transaction=f.db.$transaction;
  f.db.$transaction=(work:any,options:any)=>transaction(async(tx:any)=>{
    tx.choice.findFirst=async({where}:any)=>{const q=originals.find(q=>q.id===where.questionId);const c=q?.choices.find(c=>c.id===where.id);return c?{...c,question:{points:q!.points}}:null;};return work(tx);
  },options);
  const order=getAttemptQuestionOrder(originals,"attempt-a").map(q=>q.id);
  const answer=(qid:number,correct=true,retry=false)=>f.answer("a",qid,{choiceId:qid*10+(correct?0:1),...(retry?{answerKind:"retry"}:{})});
  return {f,order,answer};
}

test("initial wrong remains canonical while a later retry is evaluated separately",async()=>{
  const {f,order,answer}=retryFixture();
  const first=await answer(order[0],false);assert.equal(first.status,200);
  assert.equal(first.body.questionWork.wrongCount,1);assert.ok(first.body.questionWork.pendingRetryIds.includes(order[0]));
  assert.equal(first.body.questionWork.nextWork.questionId,order[1]);
  for(const qid of order.slice(1))assert.equal((await answer(qid)).status,200);
  const retry=await answer(order[0],true,true);assert.equal(retry.status,200);assert.equal(retry.body.isCorrect,true);
  assert.equal(retry.body.questionWork.wrongCount,1);assert.equal(retry.body.questionWork.correctCount,3);
  assert.equal(retry.body.questionWork.retryCorrectCount,1);assert.equal(retry.body.questionWork.isFinished,true);
  const record=[...f.data.answers.values()].find((r:any)=>r.studentQuizId==="attempt-a"&&r.questionId===order[0]);assert.equal(record.isCorrect,false);
});

test("Arena completion wording is points and displays authoritative correct/wrong counts",()=>{
  const source=fs.readFileSync("src/app/arena/[id]/content.tsx","utf8");
  assert.ok(source.includes("Your Points"));assert.ok(!source.includes("Your Score"));
  assert.ok(source.includes("questionWork.correctCount"));assert.ok(source.includes("questionWork.wrongCount"));
});
import vm from "node:vm";
import ts from "typescript";
import { buildArenaQuestionWork, arenaRetryKey, readArenaQuestionWork } from "../src/lib/arena-question-work.ts";
import { loadArenaModule } from "./helpers/arena-fixture.ts";
import * as availability from "../src/lib/quiz-availability.ts";
const params = { params: Promise.resolve({ id: "77" }) };
const snapshot = (f:any,student="a",role="student") => f.load("arena/[id]",student,role).GET({nextUrl:{searchParams:new URLSearchParams("view=snapshot")}},params);
async function originalsDone(x:ReturnType<typeof retryFixture>, wrongs=x.order.slice(0,1)) {
  let response:any;
  for(const id of x.order) { response=await x.answer(id,!wrongs.includes(id)); assert.equal(response.status,200); }
  return response;
}
async function page(f:any,student="a") {
  const jsx=(type:unknown,props:any)=>({type,props});
  f.data.quiz.subject={subjectName:"Math"};
  return loadArenaModule("src/app/arena/[id]/page.tsx",{
    "next/navigation":{redirect:(url:string)=>{throw Error(url);},notFound:()=>{throw Error("notFound");}},
    "react/jsx-runtime":{jsx,jsxs:jsx},"./content":{ArenaContent:"ArenaContent"},
    "@/lib/auth":{getSession:async()=>({userId:student,role:"student",fullName:student})},
    "@/lib/prisma":{__esModule:true,default:f.db},"@/lib/quiz-availability":availability,
  }).default(params);
}

test("original order remains stable while a wrong question waits for all other originals",async()=>{
  const x=retryFixture(); const first=await x.answer(x.order[0],false);
  assert.deepEqual(first.body.questionWork.originalOrder,x.order);
  const early=await x.answer(x.order[0],true,true);assert.equal(early.status,409);assert.equal(early.body.code,"RETRY_NOT_READY");
  for(const id of x.order.slice(1,-1)){const r=await x.answer(id);assert.equal(r.body.questionWork.nextWork.kind,"initial");assert.notEqual(r.body.questionWork.nextWork.questionId,x.order[0]);}
  const last=await x.answer(x.order.at(-1)!);assert.deepEqual(last.body.questionWork.nextWork,{questionId:x.order[0],kind:"retry"});
  assert.equal(x.f.read().participants.a.isFinished,false);
});

test("wrong retry finishes with one stored retry and no new retry work",async()=>{
  const x=retryFixture();await originalsDone(x);const result=await x.answer(x.order[0],false,true);
  const w=result.body.questionWork;assert.equal(w.retryWrongCount,1);assert.equal(w.retryCorrectCount,0);assert.equal(w.wrongCount,1);
  assert.equal(w.nextWork,null);assert.equal(w.isFinished,true);assert.deepEqual(w.pendingRetryIds,[]);
  const repeated=await x.answer(x.order[0],true,true);assert.equal(repeated.body.alreadyAnswered,true);assert.equal(repeated.body.isCorrect,false);
  assert.equal(repeated.body.questionWork.retryAnswers.length,1);
});

test("a duplicate original is replayed and cannot overwrite history or consume a retry",async()=>{
  const x=retryFixture();await x.answer(x.order[0],false);const duplicate=await x.answer(x.order[0],true);
  assert.equal(duplicate.body.alreadyAnswered,true);assert.equal(duplicate.body.isCorrect,false);assert.equal(duplicate.body.questionWork.retryAnswers.length,0);
  assert.equal(x.f.read().participants.a.questionsAnswered,1);assert.equal(x.f.read().participants.a.score,0);
});

test("concurrent duplicate retries commit one outcome and no duplicate points",async()=>{
  const x=retryFixture();await originalsDone(x);const before=x.f.read().participants.a.score;
  const replies=await x.f.overlap(()=>x.answer(x.order[0],true,true),()=>x.answer(x.order[0],false,true));
  assert.ok(replies.every(r=>r.status===200));assert.equal(replies.filter(r=>r.body.alreadyAnswered).length,1);
  assert.ok(replies.every(r=>r.body.isCorrect===true));assert.equal(x.f.read().participants.a.score,before);
  assert.equal(replies[1].body.questionWork.retryAnswers.length,1);
});

test("refresh server page restores pending retry without unlocking original answers",async()=>{
  const x=retryFixture();const done=await originalsDone(x);const view=await page(x.f);
  assert.deepEqual(view.props.initialQuestionWork,done.body.questionWork);
  assert.deepEqual(Array.from(view.props.questions,(q:any)=>q.id),x.order);
  assert.equal(view.props.savedAnswers.length,4);assert.equal(view.props.savedAnswers.find((a:any)=>a.questionId===x.order[0]).isCorrect,false);
});

test("read-only reconnect snapshot and process restart preserve pending and completed retries",async()=>{
  const x=retryFixture();await originalsDone(x);const pending=await snapshot(x.f);assert.equal(pending.status,200);
  await x.f.restartRead();assert.deepEqual((await snapshot(x.f)).body.questionWork,pending.body.questionWork);
  const completed=await x.answer(x.order[0],true,true);const reconnected=await snapshot(x.f);
  assert.deepEqual(reconnected.body.questionWork,completed.body.questionWork);
  assert.equal((await page(x.f)).props.initialQuestionWork.isFinished,true);
});

test("retry order is deterministic, uses canonical IDs, and never immediately repeats",async()=>{
  const x=retryFixture();let result=await originalsDone(x,x.order);const seen:number[]=[];let last=x.order.at(-1)!;
  while(result.body.questionWork.nextWork) {
    const work=result.body.questionWork.nextWork;assert.equal(work.kind,"retry");assert.notEqual(work.questionId,last);
    assert.ok(originals.some(q=>q.id===work.questionId));assert.deepEqual((await snapshot(x.f)).body.questionWork.nextWork,work);
    seen.push(work.questionId);last=work.questionId;result=await x.answer(work.questionId,false,true);
    assert.ok(seen.length<=4,"finite retry work");
  }
  assert.equal(seen.length,4);assert.equal(new Set(seen).size,4);assert.equal(result.body.questionWork.retryWrongCount,4);
  assert.equal(result.body.questionWork.originalAnswered,4);assert.equal(x.f.read().participants.a.questionsAnswered,4);
});

test("last-question-only miss completes safely without immediate repetition",async()=>{
  const x=retryFixture();const result=await originalsDone(x,[x.order.at(-1)!]);
  assert.equal(result.body.questionWork.nextWork,null);assert.equal(result.body.questionWork.isFinished,true);
  assert.deepEqual(result.body.questionWork.skippedRetryIds,[x.order.at(-1)!]);
  assert.equal((await x.answer(x.order.at(-1)!,true,true)).status,409);
});

test("one-question and empty work queues cannot hang",()=>{
  const state={attemptId:"solo",sessionId:"session",lastQuestionId:1,retryAnswers:{}};
  const solo=buildArenaQuestionWork([{id:1}],[{questionId:1,answerText:"11",isCorrect:false}],state);
  assert.equal(solo.isFinished,true);assert.deepEqual(solo.skippedRetryIds,[1]);
  assert.equal(buildArenaQuestionWork([],[],state).isFinished,true);
});

test("all initial correct answers complete without any retry work",async()=>{
  const x=retryFixture();const r=await originalsDone(x,[]);assert.equal(r.body.questionWork.correctCount,4);assert.equal(r.body.questionWork.wrongCount,0);
  assert.equal(r.body.questionWork.isFinished,true);assert.deepEqual(r.body.questionWork.pendingRetryIds,[]);
  assert.equal(x.f.read().participants.a.score,100);
});

test("retry points are zero and combat-adjusted points, ranks and teacher counts stay intact",async()=>{
  const x=retryFixture();await originalsDone(x);const state=x.f.read();const earned=100-x.order[0]*10;
  assert.equal(state.participants.a.score,earned);state.participants.a.score-=20;state.participants.b.score=earned+5;x.f.save(state);
  const r=await x.answer(x.order[0],true,true);assert.equal(r.body.score,earned-20);assert.equal(r.body.rank,2);
  const host=await snapshot(x.f,"teacher","teacher");const player=host.body.participants.find((p:any)=>p.studentId==="a");
  assert.equal(player.score,earned-20);assert.equal(player.correctCount,3);assert.equal(player.wrongCount,1);assert.equal(player.retryCorrectCount,1);
  const event=x.f.events.filter(e=>e.event==="arena-answer").at(-1)!;
  assert.equal(event.data.answerKind,"retry");assert.equal(event.data.score,earned-20);assert.equal(event.data.questionsAnswered,4);
});

test("late participant inherits shared deadline and gets separate stable retries",async()=>{
  const x=retryFixture();await x.answer(x.order[0],false);const before=x.f.read();
  x.f.data.attempts.set("late",{id:"attempt-late",studentId:"late",quizId:77,attemptNumber:1,attemptMode:"arena",quizStatus:"enrolled",startTime:null,endTime:null});
  assert.equal((await x.f.action("join","late")).status,200);
  const order=getAttemptQuestionOrder(originals,"attempt-late").map(q=>q.id);
  let r:any;for(const id of order)r=await x.f.answer("late",id,{choiceId:id*10+(id===order[0]?1:0)});
  assert.deepEqual(r.body.questionWork.nextWork,{questionId:order[0],kind:"retry"});
  assert.equal((await x.f.answer("late",order[0],{answerKind:"retry"})).status,200);
  const after=x.f.read();assert.equal(after.matchEndsAt,before.matchEndsAt);assert.equal(after.startedAt,before.startedAt);assert.equal(after.sessionId,before.sessionId);
  assert.deepEqual({...after.participants.a,rank:before.participants.a.rank},before.participants.a);assert.equal((await snapshot(x.f)).body.questionWork.retryAnswers.length,0);
});

test("retry acceptance never extends the authoritative match clock",async()=>{
  const x=retryFixture();const state=x.f.read();const clock={startedAt:state.startedAt,matchEndsAt:state.matchEndsAt,matchDuration:state.matchDuration};
  await originalsDone(x);await x.answer(x.order[0],true,true);
  const after=x.f.read();assert.deepEqual({startedAt:after.startedAt,matchEndsAt:after.matchEndsAt,matchDuration:after.matchDuration},clock);
});

test("expiry closes pending retry work and rejects further retry answers",async()=>{
  const x=retryFixture();await originalsDone(x);const state=x.f.read();state.matchEndsAt=new Date(Date.now()-1000).toISOString();x.f.save(state);
  const closed=await snapshot(x.f);assert.equal(closed.body.questionWork.isFinished,true);assert.equal(closed.body.questionWork.nextWork,null);
  assert.equal((await x.answer(x.order[0],true,true)).status,409);assert.equal((await snapshot(x.f)).body.questionWork.retryAnswers.length,0);
});

test("expiry crossed during progress reads is rejected before retry persistence",async()=>{
  const x=retryFixture();await originalsDone(x);const ends=Date.now()+50000;const state=x.f.read();state.matchEndsAt=new Date(ends).toISOString();x.f.save(state);
  class Clock extends Date {static now(){return Clock.value;}static value=ends-1;}
  const tx=x.f.db.$transaction;x.f.db.$transaction=(work:any,options:any)=>tx(async(db:any)=>{const read=db.answer.findMany;db.answer.findMany=async(args:any)=>{const r=await read(args);Clock.value=ends;return r;};return work(db);},options);
  const response=await x.f.load("quizzes/answer","a","student",{__Date:Clock}).POST({json:async()=>({quizId:77,questionId:x.order[0],choiceId:x.order[0]*10,answerKind:"retry",sessionId:"session-1"})});
  assert.equal(response.status,409);assert.equal(response.body.code,"ARENA_ENDED");
  assert.equal(JSON.parse(x.f.data.settings.get(arenaRetryKey("attempt-a","session-1")).settingValue).retryAnswers[x.order[0]],undefined);
});

test("stale attempt/session and foreign choices cannot modify retry history",async()=>{
  const x=retryFixture();await originalsDone(x);const before=structuredClone(x.f.data);
  for(const extra of [{studentQuizId:"old-attempt"},{sessionId:"old-session"},{choiceId:9999},{answerKind:"unexpected"}]) {
    const r=await x.f.answer("a",x.order[0],{answerKind:"retry",...extra});assert.ok([400,409].includes(r.status));
  }
  assert.deepEqual(x.f.data.answers,before.answers);
  assert.deepEqual(x.f.data.settings.get(arenaRetryKey("attempt-a","session-1")),before.settings.get(arenaRetryKey("attempt-a","session-1")));
});

test("failed retry transaction rolls back retry history, counts and realtime events",async()=>{
  const x=retryFixture();await originalsDone(x);const before=structuredClone(x.f.data);const events=x.f.events.length;
  x.f.fail("state");assert.equal((await x.answer(x.order[0],true,true)).status,500);
  assert.deepEqual(x.f.data,before);assert.equal(x.f.events.length,events);
  assert.equal((await x.answer(x.order[0],true,true)).body.questionWork.retryCorrectCount,1);
});

test("final submission persists combat points and returns separate original/retry statistics",async()=>{
  const x=retryFixture();await originalsDone(x);const retry=await x.answer(x.order[0],true,true);await x.f.action("end");
  const result=await x.f.submit("a");assert.equal(result.status,200);assert.equal(result.body.result.score,retry.body.score);
  assert.equal(result.body.questionWork.correctCount,3);assert.equal(result.body.questionWork.wrongCount,1);assert.equal(result.body.questionWork.retryCorrectCount,1);
  assert.equal(x.f.data.attempts.get("a").score,retry.body.score);
  const repeated=await x.f.submit("a");assert.equal(repeated.body.result.score,result.body.result.score);
  assert.equal([...x.f.data.answers.values()].filter((a:any)=>a.studentQuizId==="attempt-a"&&a.isCorrect===false).length,1);
});

test("malformed retry persistence fails closed instead of granting another retry",async()=>{
  const x=retryFixture();await originalsDone(x);const key=arenaRetryKey("attempt-a","session-1");
  x.f.data.settings.set(key,{settingKey:key,settingValue:JSON.stringify({attemptId:"attempt-a",sessionId:"session-1",lastQuestionId:null,retryAnswers:[]})});
  assert.equal((await snapshot(x.f)).status,500);assert.equal((await x.answer(x.order[0],true,true)).status,500);
});

test("actual client answer handler submits explicit retry work and preserves original lock",async()=>{
  const x=retryFixture();const pending=(await originalsDone(x)).body.questionWork;
  const source=fs.readFileSync("src/app/arena/[id]/content.tsx","utf8");const ast=ts.createSourceFile("content.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let declaration:ts.VariableDeclaration|undefined;
  function walk(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==="handleSelectChoice")declaration=node;node.forEachChild(walk);}walk(ast);
  let posted:any;let callback:(()=>void)|undefined;const lock=new Map([[x.order[0],{choiceId:x.order[0]*10+1,isCorrect:false}]]);
  const context:any={questionWork:pending,questions:getAttemptQuestionOrder(originals,"attempt-a"),currentQuestionIndex:0,lockedAnswers:lock,isSubmittingAnswer:false,
    quizId:77,studentQuizId:"attempt-a",currentSessionId:"session-1",streak:0,highestStreak:0,captureGameplayAction:()=>({isSameView:()=>true,isCurrent:()=>true}),
    readGameplayResponse:async(_url:string,init:any)=>{posted=JSON.parse(init.body);const r=await x.f.answer("a",posted.questionId,posted);return{ok:r.status===200,data:r.body};},
    applyGameplayState:()=>{},refreshArenaState:async()=>{},playFeedbackChime:()=>{},scheduleGameplayCallback:(_action:any,cb:()=>void)=>{callback=cb;},
    setLockedAnswers:()=>assert.fail("retry must not replace initial answer"),setQuestionWork:(w:any)=>{context.questionWork=w;},setQuestionsCompleted:(v:boolean)=>{context.completed=v;},
    setCurrentQuestionIndex:(fn:any)=>{context.currentQuestionIndex=fn(context.currentQuestionIndex);},
  };
  for(const key of ["setSelectedChoice","setIsSubmittingAnswer","setErrorMessage","setAnswerFeedback","setStreak","setHighestStreak","setStudentRank","setTotalParticipants"])context[key]=()=>{};
  context.currentQuestionIndex=context.questions.findIndex((q:any)=>q.id===pending.nextWork.questionId);
  const exports:any={};vm.runInNewContext(ts.transpileModule(`exports.handler = ${declaration!.initializer!.getText(ast)}`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,...context});
  await exports.handler(x.order[0]*10);assert.equal(posted.answerKind,"retry");assert.equal(posted.questionId,x.order[0]);callback!();
  assert.equal(context.questionWork.retryCorrectCount,1);assert.equal(context.completed,true);assert.equal(lock.get(x.order[0])!.isCorrect,false);
});

test("rendered Arena result summary uses server counts including retained original wrong",async()=>{
  const x=retryFixture();await originalsDone(x);const result=await x.answer(x.order[0],true,true);
  const source=fs.readFileSync("src/app/arena/[id]/content.tsx","utf8");const ast=ts.createSourceFile("content.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let element:ts.JsxElement|undefined;function walk(node:ts.Node){if(ts.isJsxElement(node)&&node.openingElement.getText(ast).includes('aria-label="Arena result summary"'))element=node;node.forEachChild(walk);}walk(ast);
  const exports:any={};const jsx=(type:any,props:any)=>({type,...props});
  vm.runInNewContext(ts.transpileModule(`exports.render = (${element!.getText(ast)});`,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText,{exports,score:result.body.score,questionWork:result.body.questionWork,require:()=>({jsx,jsxs:jsx})});
  const text=JSON.stringify(exports.render);assert.ok(text.includes("Your Points: "));assert.ok(text.includes('"Correct: ",3'));assert.ok(text.includes('"Wrong: ",1'));assert.ok(text.includes('"Retries corrected: ",1'));
});

test("remaining retry permutation stays fixed as completed retries are removed",async()=>{
  const x=retryFixture();let result=await originalsDone(x,x.order);const permutation=result.body.questionWork.pendingRetryIds;
  const completed:number[]=[];
  while(result.body.questionWork.nextWork) {
    const id=result.body.questionWork.nextWork.questionId;completed.push(id);result=await x.answer(id,true,true);
    assert.deepEqual(result.body.questionWork.pendingRetryIds,permutation.filter((id:number)=>!completed.includes(id)));
  }
});

test("Arena podium renders the points label and authoritative total",()=>{
  const jsx=(type:any,props:any)=>({type:typeof type==="string"?type:"component",...props});
  const render=loadArenaModule("src/components/arena/arena-podium.tsx",{
    "react":{},"react/jsx-runtime":{jsx,jsxs:jsx},"next/link":{default:"link"},"lucide-react":{},"./arena-identity":{ArenaIdentity:"identity"},
  }).ArenaPodium({quizTitle:"Quiz",podium:[],allParticipants:[],currentStudentId:"a",studentScore:73,studentRank:2,highestStreak:3});
  const text=JSON.stringify(render);assert.ok(text.includes('"children":"Your Points"'));assert.ok(text.includes('"children":73'));
});

test("draft and foreign answer rows never count as original correct or wrong",()=>{
  const w=buildArenaQuestionWork([{id:1},{id:2}], [{questionId:1,answerText:"10",isCorrect:true},{questionId:2,answerText:"20",isCorrect:null},{questionId:999,answerText:"9990",isCorrect:false}],
    {attemptId:"canonical",sessionId:"session",lastQuestionId:1,retryAnswers:{}});
  assert.equal(w.correctCount,1);assert.equal(w.wrongCount,0);assert.equal(w.originalAnswered,1);assert.equal(w.nextWork!.questionId,2);assert.deepEqual(w.pendingRetryIds,[]);
});
