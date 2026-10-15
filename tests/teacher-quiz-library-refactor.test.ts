import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import crypto from "node:crypto";
import { refactorTestSource } from "./helpers/refactor-source.ts";
import { filterTeacherQuizzes } from "../src/features/quizzes/domain/teacher-quiz-library.ts";
import { responseRequestId } from "../src/shared/http/request-id.ts";
import * as arenaPolicy from "../src/lib/power-arena-feature.ts";

function fixture(role: string | null, fail = false) {
 const queries: Array<{model:string;query:any}>=[],logs:string[]=[];
 const prisma={
  quiz:{findMany:async(query:any)=>{
   queries.push({model:"quiz",query});
   if(fail)throw Error("private-evidence-url token=must-never-be-logged student-answer");
   return [{id:7,title:"Academic Quiz",quizMode:"proctored"},{id:8,title:"Hidden Arena",quizMode:"arena"}];
  }},
  studentQuiz:{findMany:async(query:any)=>{
   queries.push({model:"studentQuiz",query});
   if(query.distinct)return [{quizId:7,studentId:"synthetic-a"},{quizId:7,studentId:"synthetic-b"}];
   return [{id:"attempt-a",student:{fullName:"Synthetic Student"},quiz:{title:"Academic Quiz"},quizId:7}];
  }},
 };
 const entitlements={isSubscribed:false,studentLimitPerQuiz:100,manualQuizLimit:5,manualQuizCount:1};
 const dependencies:Record<string,unknown>={
  "server-only":{},"node:crypto":crypto,
  "next/server":{NextResponse:{json:(body:unknown,options:ResponseInit={})=>new Response(JSON.stringify(body),options)}},
  "@/lib/prisma":{__esModule:true,default:prisma},
  "@/lib/auth":{getSession:async()=>role?{userId:"verified-account",role}:null,getScopedSession:async()=>null},
  "@/lib/teacher-entitlements":{getTeacherEntitlements:async(id:string)=>{assert.equal(id,"verified-account");return entitlements;}},
  "@/lib/power-arena-feature":{...arenaPolicy,isPowerArenaEnabled:()=>false,isDisabledArenaResource:(value:{quizMode?:string})=>value.quizMode==="arena"},
  "@/lib/quiz-availability":{UNAVAILABLE_QUIZ_STATUSES:["deleted","archived","unavailable"]},
  "@/lib/backup-write-gate":{withBackupWriteGate:(handler:unknown)=>handler},
 };
 const exports:any={};
 vm.runInNewContext(ts.transpileModule(refactorTestSource("src/app/api/quizzes/route.ts"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{
  exports,URL,Map,console:{error:(value:string)=>logs.push(value)},require:(name:string)=>dependencies[name],
 });
 return {queries,logs,get:()=>exports.GET(new Request("http://localhost/api/quizzes")),scoped:()=>exports.GET(new Request("http://localhost/api/quizzes?scope=user&role=student"))};
}

test("Teacher list keeps ownership, unavailable-state and disabled-Arena query guards",async()=>{
 const f=fixture("teacher");const response=await f.get(),body=await response.json();
 assert.equal(response.status,200);
 assert.equal(response.headers.get("cache-control"),"private, no-store, max-age=0");
 assert.ok(responseRequestId(response));
 const quizQuery=f.queries.find(q=>q.model==="quiz")!.query;
 assert.equal(quizQuery.where.teacherId,"verified-account");
 assert.equal(quizQuery.where.quizMode.not,"arena");
 assert.ok(quizQuery.where.quizStatus.notIn.includes("deleted"));
 assert.equal(body.quizzes.length,1);
 assert.equal(body.quizzes[0].id,7);
 assert.equal(body.quizzes[0].participantCount,2);
 assert.equal(body.quizzes[0].participantLimit,100);
 const pending=f.queries.filter(q=>q.query.where?.quizStatus?.startsWith?.("pending_"));
 assert.equal(pending.length,2);
 for(const q of pending){
  assert.equal(q.query.where.quiz.teacherId,"verified-account");
  assert.equal(q.query.where.quiz.quizMode.not,"arena","pending requests cannot reveal disabled Arena matches");
 }
 assert.deepEqual(body.pendingApprovals,[{studentQuizId:"attempt-a",studentName:"Synthetic Student",quizTitle:"Academic Quiz",quizId:7}]);
 assert.equal(f.logs.length,0);
});
for(const role of [null,"unknown"]){test("Unverified or unsupported role never reaches Teacher queries: "+role,async()=>{
 const f=fixture(role);const response=await f.get();assert.equal(response.status,role?403:401);assert.equal(f.queries.length,0);
});}
test("Scoped Student request cannot use a replacement Teacher session",async()=>{
 const f=fixture("teacher");assert.equal((await f.scoped()).status,401);assert.equal(f.queries.length,0);
});
test("Database failure has a stable code and correlatable, minimized log without private error content",async()=>{
 const f=fixture("teacher",true);const r=await f.get(),body=await r.json();
 assert.equal(r.status,500);assert.equal(body.code,"QUIZ_LIST_FAILED");
 assert.equal(body.requestId,r.headers.get("X-Request-ID"));assert.ok(responseRequestId(r));
 assert.equal(body.error,"Internal server error");assert.equal(f.logs.length,1);
 const log=JSON.parse(f.logs[0]);
 assert.deepEqual(Object.keys(log).sort(),["code","level","operation","requestId"]);
 assert.equal(log.operation,"quizzes.list");assert.equal(log.requestId,body.requestId);
 assert.doesNotMatch(JSON.stringify({body,logs:f.logs}),/private-evidence|must-never|student-answer|verified-account/);
 const other=await fixture("teacher",true).get();assert.notEqual(other.headers.get("X-Request-ID"),body.requestId);
});
test("Browser filtering preserves order and inputs while hiding disabled Arena entries",()=>{
 const rows=[{id:1,title:"Biology",quizMode:"proctored",quizStatus:"draft",duration:30,totalQuestions:2},{id:2,title:"Biology Arena",quizMode:"arena",quizStatus:"active",duration:30,totalQuestions:2}];
 assert.deepEqual(filterTeacherQuizzes(rows,"BIO",false).map(q=>q.id),[1]);
 assert.deepEqual(filterTeacherQuizzes(rows,"bio",true).map(q=>q.id),[1,2]);
 assert.equal(filterTeacherQuizzes(rows,"unknown",false).length,0);assert.equal(rows.length,2);
});
for(const value of ["<script>private</script>","secret-token","x".repeat(500),"1234"]){
 test("Arbitrary tracing header is not displayed: "+value.slice(0,12),()=>assert.equal(responseRequestId(new Response(null,{headers:{"X-Request-ID":value}})),null));
}
