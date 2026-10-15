import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import * as feature from "../src/lib/power-arena-feature.ts";
import * as accessCodes from "../src/lib/quiz-access-code.ts";
import * as availability from "../src/lib/quiz-availability.ts";
import { loadArenaModule } from "./helpers/arena-fixture.ts";

function load(file: string, overrides: Record<string, unknown> = {}) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const dependencies: Record<string, unknown> = {};
  for (const node of ast.statements) if (ts.isImportDeclaration(node)) dependencies[(node.moduleSpecifier as ts.StringLiteral).text] = {};
  return loadArenaModule(file, { ...dependencies,
    "next/server": { NextResponse: { json: Response.json }, after() {} },
    "react/jsx-runtime": {},
    "./teacher-theme.css": {}, "./teacher-glass.css": {},
    "next/navigation": { notFound() { throw new Error("NOT_FOUND"); } },
    "@/lib/power-arena-feature": feature, "./power-arena-feature.ts": feature,
    "@/lib/backup-write-gate": { withBackupWriteGate: (handler: unknown) => handler },
    "@/lib/quiz-submission": { normalizeSubmittedAnswers: () => [] },
    ...overrides,
  });
}
const disabled = async (run: () => unknown | Promise<unknown>) => {
  const old = process.env.POWER_ARENA_ENABLED;
  delete process.env.POWER_ARENA_ENABLED;
  try { await run(); } finally { if (old === undefined) delete process.env.POWER_ARENA_ENABLED; else process.env.POWER_ARENA_ENABLED = old; }
};
test("Arena defaults disabled and only exact explicit true enables it", async () => disabled(() => {
  assert.equal(feature.isPowerArenaEnabled(), false);
  for (const value of ["false", "TRUE", "1", " true ", ""]) { process.env.POWER_ARENA_ENABLED=value; assert.equal(feature.isPowerArenaEnabled(),false); }
  process.env.POWER_ARENA_ENABLED="true";assert.equal(feature.isPowerArenaEnabled(),true);
}));
test("Arena paths are blocked without matching academic routes", async () => disabled(() => {
  for (const path of ["/arena/77", "/arena", "/api/arena/battle-action", "/dashboard/teacher/playground", "/dashboard/teacher/playground/arena/77"]) assert.equal(feature.isArenaPath(path),true);
  for (const path of ["/quiz/77", "/api/quizzes/answer", "/dashboard/teacher/quizzes", "/dashboard/student", "/api/arena-other"]) assert.equal(feature.isArenaPath(path),false);
  assert.equal(feature.isDisabledArenaResource({quizMode:"proctored"}),false);
  assert.equal(feature.isDisabledArenaResource({attemptMode:"arena",quiz:{quizMode:"proctored"}}),true);
}));
for(const [file,methods] of [
  ["src/app/api/arena/[id]/route.ts",["GET","POST"]],
  ["src/app/api/arena/battle-action/route.ts",["POST"]],
  ["src/app/api/live/battle-action/route.ts",["POST"]],
] as const) for(const method of methods) test(`${method} ${file}: disabled before auth, storage or realtime`,async()=>disabled(async()=>{
  let touched=0;
  const route=load(file,{"@/lib/auth":{getSession(){touched++;throw Error("Must not authenticate Arena");}}});
  const response=await route[method](new Request("http://localhost/api/arena/77",{method}),{params:Promise.resolve({id:"77"})});
  assert.equal(response.status,403);assert.deepEqual(await response.json(),feature.ARENA_DISABLED_BODY);
  assert.match(response.headers.get("cache-control")!,/no-store/);assert.equal(touched,0);
}));
for(const file of ["src/app/arena/[id]/page.tsx","src/app/dashboard/teacher/playground/page.tsx","src/app/dashboard/teacher/playground/arena/[id]/page.tsx"]) test(`${file}: rejects rendering before database access`,async()=>disabled(async()=>{
  const route=load(file);await assert.rejects(route.default({params:Promise.resolve({id:"77"}),searchParams:Promise.resolve({})}),/NOT_FOUND/);
}));
test("Arena private channel authorization is disabled for every role before provider signing",async()=>disabled(async()=>{
  const route=load("src/app/api/pusher/auth/route.ts");const form=new FormData();form.set("socket_id","1.2");form.set("channel_name","private-arena-77");
  const response=await route.POST(new Request("http://localhost/api/pusher/auth",{method:"POST",body:form}));assert.equal(response.status,403);
}));
const quiz={id:77,teacherId:"teacher",quizMode:"arena",quizStatus:"in_progress",questions:[]};
const attempt={id:"attempt",studentId:"student",quizId:77,quiz,attemptMode:"arena",startTime:new Date(),endTime:null,quizStatus:"in_progress"};
for(const [file,method,body] of [
  ["src/app/api/quizzes/submit/route.ts","POST",{quizId:77}],
  ["src/app/api/quizzes/autosave/route.ts","POST",{quizId:77,answers:{},studentQuizId:"attempt"}],
  ["src/app/api/quizzes/retake/route.ts","POST",{studentQuizId:"attempt"}],
  ["src/app/api/quizzes/retake/approve/route.ts","POST",{studentQuizId:"attempt",action:"accept"}],
  ["src/app/api/quizzes/approve/route.ts","POST",{studentQuizId:"attempt",action:"accept"}],
  ["src/app/api/quizzes/[id]/start/route.ts","POST",{}],
] as const) test(`${file}: shared academic endpoint refuses Arena without writes`,async()=>disabled(async()=>{
 let writes=0;const teacher=file.includes("approve")||file.includes("/start/");
 const db={studentQuiz:{findFirst:async()=>attempt,findUnique:async()=>attempt,update:async()=>{writes++;}},quiz:{findUnique:async()=>quiz}};
 const route=load(file,{"@/lib/auth":{getSession:async()=>({userId:teacher?"teacher":"student",role:teacher?"teacher":"student"})},"@/lib/prisma":{__esModule:true,default:db}});
 const response=await route[method](new Request("http://localhost/api/quizzes/77",{method,body:JSON.stringify(body)}),{params:Promise.resolve({id:"77"})});
 assert.equal(response.status,403);assert.equal((await response.json()).code,"FEATURE_DISABLED");assert.equal(writes,0);
}));
test("Arena recovery and realtime stop without touching retained records or providers",async()=>disabled(async()=>{
  let touches=0;const recovery=load("src/lib/arena-recovery.ts");
  const stats=await recovery.createArenaRecoverySweep({setting:{findMany(){touches++;}}})();assert.equal(stats.scanned,0);assert.equal(recovery.startArenaRecovery(),undefined);
  const rt=load("src/lib/arena-realtime.ts",{"@/lib/pusher":{arenaPusher:{trigger(){touches++;}}}});
  await rt.arenaRealtime({afterCommit(){touches++;}}).trigger("private-arena-77","arena-start",{});
  const transport=load("src/lib/arena-pusher-transport.ts").createArenaPusherDelivery({signer:{createSignedQueryString(){touches++;}},appId:"1",cluster:"ap1"});
  await transport.trigger("private-arena-77","arena-start",{});assert.equal(touches,0);
}));

for(const [file,method,body] of [
  ["src/app/api/quizzes/route.ts","POST",{quizMode:"arena",title:"Fixture Arena"}],
  ["src/app/api/quizzes/[id]/route.ts","GET",null],
  ["src/app/api/quizzes/[id]/route.ts","PUT",{quizMode:"arena"}],
  ["src/app/api/quizzes/[id]/route.ts","DELETE",null],
  ["src/app/api/quizzes/join/route.ts","GET",null],
  ["src/app/api/quizzes/join/route.ts","POST",{accessCode:"PS-123456ABCD"}],
] as const) test(`${method} ${file}: Arena authoring, metadata and code joining are disabled`,async()=>disabled(async()=>{
 const joining=file.includes("/join/");
 const route=load(file,{
  "@/lib/auth":{getSession:async()=>({userId:joining?"student":"teacher",role:joining?"student":"teacher"})},
  "@/lib/prisma":{__esModule:true,default:{quiz:{findUnique:async()=>quiz,findFirst:async()=>quiz},user:{findUnique:async()=>({id:"student"})}}},
  "@/lib/quiz-access-code":accessCodes,
  "@/lib/quiz-availability":availability,
  "@/lib/security":{getClientIp:()=>"127.0.0.1",consumeRateLimitGroup:async()=>({allowed:true})},
 });
 const url="http://localhost/api/quizzes/77?accessCode=PS-123456ABCD";
 const request=new Request(url,{method,...(body?{body:JSON.stringify(body)}:{})});
 Object.defineProperty(request,"nextUrl",{value:new URL(url)});
 const response=await route[method](request,{params:Promise.resolve({id:"77"})});
 assert.equal(response.status,403);assert.equal((await response.json()).code,"FEATURE_DISABLED");
}));
