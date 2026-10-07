import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { getAttemptQuestionOrder } from "../src/lib/quiz-question-order.ts";
import { arenaFixture, loadArenaModule } from "./helpers/arena-fixture.ts";
import { quizSessionFixture } from "./helpers/quiz-session-fixture.ts";
import * as availability from "../src/lib/quiz-availability.ts";

const authored = Array.from({ length: 8 }, (_, i) => ({ id: 11 + i * 3, questionText: `Q${i}`, questionType: "multiple_choice", points: i + 1,
  choices: [{ id: 101 + i * 2, choiceText: "Correct", isCorrect: true }, { id: 102 + i * 2, choiceText: "Wrong", isCorrect: false }] }));
const ids = (questions: any[]) => Array.from(questions, (q) => q.id);
const canonical = ids(authored);
const complete = (questions: any[]) => { assert.equal(new Set(ids(questions)).size, authored.length); assert.deepEqual(ids(questions).sort((a,b)=>a-b), canonical); };

function monitored() {
  const f = quizSessionFixture(47); const quiz = f.state.quizzes.get(7);
  Object.assign(quiz, { questions: structuredClone(authored), totalQuestions: authored.length, shuffleQuestions: false, _count: { questions: authored.length } });
  return f;
}

function arenaPage(f: { db: any }, student: string, quizId = 77) {
  const jsx = (type: unknown, props: any) => ({ type, props });
  return loadArenaModule("src/app/arena/[id]/page.tsx", {
    "next/navigation": { redirect: (url: string) => { throw new Error(`redirect ${url}`); }, notFound: () => { throw new Error("notFound"); } },
    "react/jsx-runtime": { jsx, jsxs: jsx }, "./content": { ArenaContent: "ArenaContent" },
    "@/lib/auth": { getSession: async () => ({ userId: student, role: "student", fullName: student }) },
    "@/lib/prisma": { __esModule: true, default: f.db }, "@/lib/quiz-availability": availability,
  }).default({ params: Promise.resolve({ id: String(quizId) }) }).then((render:any)=>({ props: structuredClone(render.props) }));
}
function arenaStudents() {
  const f = arenaFixture(); Object.assign(f.data.quiz, { questions: structuredClone(authored), totalQuestions: authored.length, _count: { questions: authored.length }, subject: { subjectName: "Math" } });
  const state = f.read(); state.totalQuestions = authored.length; f.save(state); return f;
}

test("monitored students receive independent complete orders even on legacy shuffle-disabled quizzes", async () => {
  const f = monitored(); const a = await f.add("a"); const b = await f.add("b"); await f.teacherStart(); await f.start(a.id); await f.start(b.id);
  const first = (await f.get("a")).body.questions; const second = (await f.get("b")).body.questions;
  complete(first); complete(second); assert.notDeepEqual(ids(first), ids(second)); assert.notDeepEqual(ids(first), canonical);
  for (const q of first) assert.deepEqual(Array.from(q.choices, (c:any)=>c.id), authored.find((original)=>original.id===q.id)!.choices.map((c)=>c.id));
});

test("actual Arena server page gives different attempt orders and stable refresh/reconnect sequences", async () => {
  const f = arenaStudents(); const a = (await arenaPage(f, "a")).props; const b = (await arenaPage(f, "b")).props;
  complete(a.questions); complete(b.questions); assert.notDeepEqual(ids(a.questions), ids(b.questions));
  for (const flow of ["refresh", "reconnect", "reopen"]) assert.deepEqual((await arenaPage(f,"a")).props.questions, a.questions, flow);
  assert.equal(a.questions.length, authored.length); assert.deepEqual(f.data.quiz.questions, authored);
});

test("late Arena registration gets its own stable order without changing peers or match deadline", async () => {
  const f = arenaStudents(); const before = (await arenaPage(f,"a")).props.questions; const state = f.read();
  f.data.attempts.set("late", { id: "attempt-late", quizId: 77, studentId: "late", attemptMode: "arena", quizStatus: "enrolled", attemptNumber: 1, startTime: null, endTime: null });
  assert.equal((await f.action("join", "late")).status, 200);
  const late = (await arenaPage(f,"late")).props.questions; complete(late); assert.notDeepEqual(ids(late), ids(before));
  assert.deepEqual((await arenaPage(f,"late")).props.questions, late); assert.deepEqual((await arenaPage(f,"a")).props.questions, before);
  assert.equal(f.read().matchEndsAt, state.matchEndsAt); assert.equal(f.read().sessionId, state.sessionId);
});

function post(f: ReturnType<typeof quizSessionFixture>, route: string, student: string, body: object) {
  return loadArenaModule(`src/app/api/${route}/route.ts`, { ...f.deps, "@/lib/auth": { getSession: async () => ({ userId: student, role: "student", fullName: student }) } }).POST({ json: async () => body, headers: { get: () => null } });
}
function gradingFixture() {
  const f = monitored();
  f.db.question.count = async () => authored.length;
  f.db.choice.findMany = async ({ where }: any) => authored.flatMap(q => q.choices.map(c => ({ id:c.id, questionId:q.id }))).filter(c=>where.id.in.includes(c.id));
  f.db.choice.findFirst = async ({ where }: any) => {
    const q = authored.find(q=>q.id===where.questionId); const c=q?.choices.find(c=>c.id===where.id);
    return c ? { ...c, question: { points:q!.points } } : null;
  };
  f.db.answer.findUnique = async ({ where }: any) => f.state.answers.find((a:any)=>a.studentQuizId===where.studentQuizId_questionId.studentQuizId && a.questionId===where.studentQuizId_questionId.questionId) ?? null;
  f.db.answer.upsert = async ({ where, create, update }: any) => {
    const row=await f.db.answer.findUnique({where}); if(row) { Object.assign(row,update); return row; }
    f.state.answers.push(structuredClone(create)); return create;
  };
  return f;
}

test("seeded Fisher-Yates yields a complete permutation without mutation across many attempt identities", () => {
  const original = structuredClone(authored);
  const permutations = new Set();
  for (let i=0;i<200;i++) {
    const result=getAttemptQuestionOrder(original, `attempt-${i}`); complete(result); permutations.add(ids(result).join(","));
    assert.deepEqual(getAttemptQuestionOrder([...original].reverse(),`attempt-${i}`),result);
  }
  assert.ok(permutations.size>180); assert.deepEqual(original,authored);
  assert.deepEqual(getAttemptQuestionOrder([],"empty"),[]); assert.deepEqual(getAttemptQuestionOrder([authored[0]],"single"),[authored[0]]);
});

test("monitored refresh, reconnect and reopen preserve exact order and saved answer identities", async () => {
  const f=monitored(); const a=await f.add("a"); await f.teacherStart(); await f.start(a.id);
  const first=(await f.get("a")).body; const q=first.questions[0];
  f.state.answers.push({studentQuizId:a.id,questionId:q.id,answerText:String(q.choices[0].id),isCorrect:true});
  f.state.quizzes.get(7).questions.reverse();
  for(const flow of ["refresh","reconnect","reopen"]) {
    const restored=(await f.get("a")).body;
    assert.deepEqual(ids(restored.questions),ids(first.questions),flow);
    assert.equal(restored.savedAnswers[0].questionId,q.id); assert.equal(restored.savedAnswers[0].choiceId,q.choices[0].id);
    assert.equal(restored.sessionEndsAt,first.sessionEndsAt);
  }
});

test("a genuine approved retake gets a new deterministic order but keeps the shared deadline", async () => {
  const f=monitored();const a=await f.add("a");await f.teacherStart();await f.start(a.id);
  const first=(await f.get("a")).body; f.advance(17);
  Object.assign(f.state.attempts.get(a.id),{quizStatus:"pending_retake",endTime:new Date(f.now())});
  assert.equal((await f.approve(a.id)).status,200);
  const latest=(await f.get("a")).body; assert.notEqual(latest.studentQuizId,a.id);
  assert.notDeepEqual(ids(latest.questions),ids(first.questions)); complete(latest.questions);
  assert.equal(latest.sessionEndsAt,first.sessionEndsAt); assert.equal(latest.remainingSeconds,30*60);
  await f.start(latest.studentQuizId);
  assert.deepEqual(ids((await f.get("a")).body.questions),ids(latest.questions));
  assert.deepEqual(ids(getAttemptQuestionOrder(authored,a.id)),ids(first.questions));
});

test("teacher review retains canonical order and original grading keys", async () => {
  const f=monitored();
  const route=loadArenaModule("src/app/api/quizzes/[id]/route.ts",{...f.deps,"@/lib/auth":{getSession:async()=>({userId:"teacher",role:"teacher"})}});
  const result=await route.GET({}, {params:Promise.resolve({id:"7"})}); assert.equal(result.status,200);
  assert.deepEqual(ids(result.body.questions),canonical);
  assert.ok(result.body.questions.every((q:any)=>q.choices[0].isCorrect===true));
});

test("monitored autosave, answer evaluation and final results use canonical IDs after shuffled display", async () => {
  const f=gradingFixture(); const a=await f.add("a"); await f.teacherStart(); await f.start(a.id);
  const displayed=(await f.get("a")).body.questions;
  const answers=Array.from(displayed,(q:any)=>({questionId:q.id,choiceId:authored.find(original=>original.id===q.id)!.choices[0].id}));
  const autosave=await post(f,"quizzes/autosave","a",{quizId:7,studentQuizId:a.id,answers}); assert.equal(autosave.status,200);
  assert.deepEqual(f.state.answers.map((r:any)=>r.questionId).sort((a:number,b:number)=>a-b),canonical);
  const first=answers[0]; const evaluated=await post(f,"quizzes/answer","a",{quizId:7,studentQuizId:a.id,...first});
  assert.equal(evaluated.status,200); assert.equal(evaluated.body.isCorrect,true);
  const locked=f.state.answers.find((r:any)=>r.questionId===first.questionId); assert.equal(locked.pointsEarned,authored.find(q=>q.id===first.questionId)!.points);
  const submitted=await post(f,"quizzes/submit","a",{quizId:7,studentQuizId:a.id,reason:"manual",answers});
  assert.equal(submitted.status,200); assert.equal(submitted.body.result.score,100); assert.equal(f.state.attempts.get(a.id).score,100);
  assert.deepEqual(f.state.answers.map((r:any)=>r.questionId).sort((a:number,b:number)=>a-b),canonical);
  assert.ok(f.state.answers.every((r:any)=>r.isCorrect===true));
  const reviewRoute=loadArenaModule("src/app/api/quizzes/[id]/route.ts",{...f.deps,"@/lib/auth":{getSession:async()=>({userId:"teacher",role:"teacher"})}});
  const reviewed=await reviewRoute.GET({}, {params:Promise.resolve({id:"7"})});
  assert.deepEqual(ids(reviewed.body.questions),canonical); assert.equal(reviewed.body.quiz.hasAttempts,true);
  const findMany=f.db.studentQuiz.findMany;
  f.db.studentQuiz.findMany=async (query:any)=>(await findMany(query)).map((row:any)=>({...row,_count:{violations:0}}));
  const auth={getUserSession:async()=>({userId:"a",role:"student"})};
  const results=await loadArenaModule("src/app/api/dashboard/student/results/route.ts",{...f.deps,"@/lib/auth":auth}).GET();
  assert.equal(results.status,200);assert.equal(results.body.results[0].id,a.id);assert.equal(results.body.results[0].score,100);
  const reports=await loadArenaModule("src/app/api/dashboard/teacher/reports/route.ts",{
    ...f.deps,"@/lib/auth":{getUserSession:async()=>({userId:"teacher",role:"teacher"})},
    "@/lib/maintenance":{expireSubscriptions:async()=>{}},"@/lib/teacher-entitlements":{hasActiveProSubscription:async()=>true},
  }).GET({});assert.equal(reports.status,200);
});

test("wrong evaluation and foreign choice rejection follow the question ID rather than its display index", async () => {
  const f=gradingFixture();const a=await f.add("a");await f.teacherStart();await f.start(a.id);
  const first=(await f.get("a")).body.questions[0];const original=authored.find(q=>q.id===first.id)!;
  const wrong=await post(f,"quizzes/answer","a",{quizId:7,studentQuizId:a.id,questionId:first.id,choiceId:original.choices[1].id});
  assert.equal(wrong.status,200); assert.equal(wrong.body.isCorrect,false); assert.equal(f.state.answers[0].pointsEarned,0);
  const other=authored.find(q=>q.id!==first.id)!;
  const invalid=await post(f,"quizzes/answer","a",{quizId:7,studentQuizId:a.id,questionId:other.id,choiceId:original.choices[0].id});
  assert.equal(invalid.status,400); assert.equal(f.state.answers.length,1);
});

test("Arena shuffled questions keep canonical choices, earned points, rankings and completion", async () => {
  const f=arenaStudents(); const transaction=f.db.$transaction;
  f.db.$transaction=(work:any,options:any)=>transaction(async(tx:any)=>{
    tx.choice.findFirst=async({where}:any)=>{const q=authored.find(q=>q.id===where.questionId);const c=q?.choices.find(c=>c.id===where.id);return c?{...c,question:{points:q!.points}}:null;};
    return work(tx);
  },options);
  const displayed=(await arenaPage(f,"a")).props.questions;
  for(let i=0;i<displayed.length;i++) {
    const q=displayed[i];const original=authored.find(original=>original.id===q.id)!;
    assert.deepEqual(q.choices,original.choices);
    const response=await f.answer("a",q.id,{choiceId:original.choices[0].id}); assert.equal(response.status,200); assert.equal(response.body.isCorrect,true);
    assert.equal(f.read().participants.a.questionsAnswered,i+1);
  }
  const total=authored.reduce((sum,q)=>sum+q.points,0); assert.equal(f.read().participants.a.score,total);
  assert.equal(f.read().participants.a.isFinished,true); assert.equal(f.read().participants.a.rank,1);
  assert.equal((await f.action("end")).status,200); const result=await f.submit("a");
  assert.equal(result.status,200);assert.equal(result.body.result.score,total);
  assert.deepEqual((await arenaPage(f,"a")).props.savedAnswers.map((a:any)=>a.questionId).sort((a:number,b:number)=>a-b),canonical);
});

test("actual approved Arena retake gets a new order while retaining its shared session deadline", async () => {
  const f=monitored();const quiz=f.state.quizzes.get(7);Object.assign(quiz,{quizMode:"arena",quizStatus:"in_progress"});
  const a=await f.add("a");Object.assign(f.state.attempts.get(a.id),{attemptMode:"arena",quizStatus:"in_progress",startTime:new Date(f.now())});
  const state=f.deps["@/lib/arena"].createArenaState({quizId:7,teacherId:"teacher",status:"active",totalQuestions:authored.length,config:{matchDuration:47*60}});
  f.deps["@/lib/arena"].ensureArenaParticipant(state,{studentId:"a",studentName:"A"});
  f.state.settings.set("arena:state:7",{settingKey:"arena:state:7",settingValue:JSON.stringify(state)});
  const original=(await arenaPage(f,"a",7)).props.questions;f.advance(17);
  Object.assign(f.state.attempts.get(a.id),{quizStatus:"pending_retake",endTime:new Date(f.now())});
  assert.equal((await f.approve(a.id)).status,200);
  const returned=(await arenaPage(f,"a",7)).props;complete(returned.questions);assert.notDeepEqual(ids(returned.questions),ids(original));
  assert.notEqual(returned.studentQuizId,a.id);assert.deepEqual((await arenaPage(f,"a",7)).props.questions,returned.questions);
  const saved=JSON.parse(f.state.settings.get("arena:state:7").settingValue);
  assert.equal(saved.sessionId,state.sessionId);assert.equal(saved.matchEndsAt,state.matchEndsAt);
});

test("simultaneous server reads derive one order without initialization writes or competing seeds", async () => {
  const f=monitored();const a=await f.add("a");await f.teacherStart();await f.start(a.id);
  const before=structuredClone(f.state);const replies=await Promise.all(Array.from({length:8},()=>f.get("a")));
  assert.ok(replies.every((r)=>JSON.stringify(ids(r.body.questions))===JSON.stringify(ids(replies[0].body.questions))));assert.deepEqual(structuredClone(f.state),before);
  const arena=arenaStudents();const state=structuredClone(arena.data);const views=await Promise.all(Array.from({length:8},()=>arenaPage(arena,"a")));
  assert.ok(views.every((v)=>JSON.stringify(ids(v.props.questions))===JSON.stringify(ids(views[0].props.questions))));assert.deepEqual(arena.data,state);
});

test("Arena resume starts at the first unanswered canonical ID in its existing shuffled order", async () => {
  const f=arenaStudents();const first=(await arenaPage(f,"a")).props;const question=first.questions[0];
  f.data.answers.set(JSON.stringify({studentQuizId:"attempt-a",questionId:question.id}),{studentQuizId:"attempt-a",questionId:question.id,answerText:String(question.choices[0].id),isCorrect:true});
  const resume=(await arenaPage(f,"a")).props;assert.deepEqual(resume.questions,first.questions);
  const source=ts.createSourceFile("arena.tsx",fs.readFileSync("src/app/arena/[id]/content.tsx","utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let expression:ts.Expression|undefined;const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(source)==="initialUnansweredIndex")expression=node.initializer;ts.forEachChild(node,visit);};visit(source);assert.ok(expression);
  const exports:any={};vm.runInNewContext(ts.transpileModule(`exports.index=${expression.getText(source)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{exports,questions:resume.questions,savedAnswers:resume.savedAnswers});
  assert.equal(exports.index,1);assert.equal(resume.savedAnswers[0].questionId,question.id);
});

test("teacher question-shuffle indicators accurately show mandatory per-attempt ordering", () => {
  const source=ts.createSourceFile("editor.tsx",fs.readFileSync("src/components/teacher/proctorshield-quiz-editor.tsx","utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let count=0;const visit=(node:ts.Node)=>{
    if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(source)==="input"&&node.getText(source).includes("checked={true}")) {
      assert.ok(node.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(source)==="disabled"));count++;
    }
    ts.forEachChild(node,visit);
  };visit(source);assert.equal(count,2);
});
