import assert from "node:assert/strict";
import test from "node:test";
import { arenaFixture, loadArenaModule } from "./helpers/arena-fixture.ts";
import * as availability from "../src/lib/quiz-availability.ts";
const params={params:Promise.resolve({id:"77"})};
test("Arena launch library excludes soft-deleted and inactive quizzes",async()=>{
 const rows=["active","draft","in_progress","deleted","archived","unavailable","inactive","ended"].map((quizStatus,id)=>({id,quizStatus,title:quizStatus,subject:null,_count:{questions:1,studentQuizzes:0},createdAt:new Date(),duration:47}));
 let where:any;const prisma={quiz:{findMany:async(args:any)=>{where=args.where;return rows.filter(q=>args.where.quizStatus.notIn?!args.where.quizStatus.notIn.includes(q.quizStatus):q.quizStatus!==args.where.quizStatus.not);}}};
 const jsx=(type:any,props:any)=>({type,props});const page=await loadArenaModule("src/app/dashboard/teacher/playground/page.tsx",{
 "@/lib/auth":{getSession:async()=>({userId:"teacher",role:"teacher"})},"@/lib/teacher-entitlements":{getTeacherEntitlements:async()=>({isSubscribed:true})},"@/lib/prisma":{default:prisma,__esModule:true},
 "./content":{default:"PlaygroundContent",__esModule:true},"next/navigation":{redirect:()=>assert.fail()},"react/jsx-runtime":{jsx,jsxs:jsx},"@/lib/quiz-availability":availability}).default();
 assert.deepEqual(page.props.quizzes.map((q:any)=>q.quizStatus),["active","draft","in_progress"]);assert.equal(where.teacherId,"teacher");assert.equal(where.quizMode,"arena");
});
for(const status of ["deleted","inactive","archived","unavailable"])test(`${status} source quiz cannot launch a new Arena`,async()=>{
 const f=arenaFixture("lobby");f.data.quiz.quizStatus=status;
 const r=await f.load("arena/[id]","teacher","teacher",{"@/lib/quiz-availability":availability}).POST({json:async()=>({action:"create_session"})},params);assert.equal(r.status,410);assert.equal(f.read().status,"lobby");
});
test("soft delete preserves historical attempts and Arena data, using existing active-deletion policy",async()=>{
 const f=arenaFixture();const attempt=f.data.attempts.get("a");Object.assign(attempt,{quizStatus:"completed",endTime:new Date(),score:123});const before=f.read();
 assert.equal((await f.deleteQuiz()).status,200);assert.equal(f.data.quiz.quizStatus,"deleted");assert.equal(f.data.attempts.get("a").score,123);assert.equal(f.data.attempts.get("a").quizStatus,"completed");
 assert.equal(f.read().sessionId,before.sessionId);assert.deepEqual(f.read().participants,before.participants);assert.equal(f.data.attempts.get("b").quizStatus,"rejected","existing deletion cancels unfinished enrollment");
 f.db.studentQuiz.findMany=async()=>[{...f.data.attempts.get("a"),quiz:f.data.quiz}];
 const result=await f.load("dashboard/student/results","a","student",{"@/lib/auth":{getUserSession:async()=>({userId:"a",role:"student"})},"@/lib/retake-eligibility":{withRetakeEligibility:(rows:any)=>rows}}).GET();
 assert.equal(result.status,200);assert.equal(result.body.results[0].score,123);
});
