import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { getAuthDestination } from "../src/lib/auth-destination.ts";
import { quizPrivacyInfo, QUIZ_PRIVACY_SETTING_KEYS } from "../src/lib/quiz-privacy.ts";
import * as policy from "../src/lib/power-arena-feature.ts";

function load(file: string, deps: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText, { exports, URL, Map, Date, Number, console: {error(){}}, require(name: string) {
    assert.ok(name in deps, "Unexpected dependency " + name); return deps[name];
  } });
  return exports;
}
const retention = load("src/lib/evidence-retention.ts", { "./prisma": {}, "./evidence-storage": {} });
const row = (settingKey: string, settingValue: string) => ({ settingKey, settingValue });
test("Student join intent is normalized and only produces a fixed internal join route", () => {
  for (const code of ["ps-abc123", " PS — ABC123 ", "ＰＳ-ＡＢＣ１２３"]) assert.equal(getAuthDestination("student", code), "/join?code=PS-ABC123");
});
for (const code of ["//evil.test", "https://evil.test", "/quiz/99", "PS-ABC?next=https://evil.test", "%2f%2fevil.test", "PS-ABC#x", "x".repeat(65), "", null, ["PS-ABC"], {code:"PS-ABC"}]) {
 test("Unsafe or malformed join intent cannot select a redirect: " + JSON.stringify(code), () => assert.equal(getAuthDestination("student", code), "/dashboard/student"));
}
for (const role of ["teacher", "admin"]) test(role + " cannot adopt a Student join destination", () => assert.equal(getAuthDestination(role, "PS-ABC123"), "/dashboard/" + role));
test("Unknown roles are denied even with a valid code", () => assert.equal(getAuthDestination("owner", "PS-ABC123"), null));

test("Privacy contacts remain absent unless institutional verification is explicitly configured", () => {
 assert.equal(quizPrivacyInfo([row("institution_name","Demo"),row("institution_privacy_email","privacy@example.test")],90).contact,null);
 const info=quizPrivacyInfo([row("institution_privacy_contacts_verified","true"),row("institution_name","Demo"),row("institution_privacy_email","privacy@example.test"),row("institution_privacy_url","https://example.test/privacy")],30);
 assert.equal(info.retentionDays,30);assert.equal(info.institution,"Demo");assert.equal(info.contact?.email,"privacy@example.test");assert.equal(info.contact?.url,"https://example.test/privacy");
});
for (const url of ["javascript:alert(1)","http://example.test","https://user:password@example.test","data:text/html,hello"]) {
 test("Privacy info omits unsafe configured contact URL " + url, () => assert.equal(quizPrivacyInfo([row("institution_privacy_contacts_verified","true"),row("institution_privacy_url",url)],90).contact,null));
}
test("Privacy contact email rejects injected headers and non-email schemes",()=>{
 for(const email of ["privacy@example.test\nBcc: other@example.test","javascript:bad@example.test","<bad>@example.test"]) assert.equal(quizPrivacyInfo([row("institution_privacy_contacts_verified","true"),row("institution_privacy_email",email)],90).contact,null);
});
function privacyFixture(role: string | null="student", enrolled=true, value="90", mode="proctored") {
 const calls: Array<{kind:string;args:any}>=[];let unavailable=false;
 const api=load("src/app/api/quizzes/[id]/privacy/route.ts",{
  "next/server":{NextResponse:{json:(body:unknown,init:ResponseInit={})=>new Response(JSON.stringify(body),{...init,headers:{"content-type":"application/json",...init.headers}})}},
  "@/lib/auth":{getUserSession:async(requested:string,options:unknown)=>{calls.push({kind:"session",args:{requested,options}});return role===requested?{userId:"student-a",role}:null;}},
  "@/lib/prisma":{__esModule:true,default:{studentQuiz:{findFirst:async(args:unknown)=>{calls.push({kind:"attempt",args});if(unavailable)throw Error("sensitive storage detail");return enrolled?{quiz:{quizMode:mode}}:null;}},setting:{findMany:async(args:unknown)=>{calls.push({kind:"settings",args});return [row("evidence_retention_days",value),row("backup_write_gate:paused","SECRET-NEVER-RETURN"),row("institution_privacy_email","unverified@example.test")];}}}},
  "@/lib/evidence-retention":retention,"@/lib/quiz-privacy":{QUIZ_PRIVACY_SETTING_KEYS,quizPrivacyInfo},"@/lib/power-arena-feature":policy,
 });
 return {calls,fail:()=>{unavailable=true;},get:(id="99")=>api.GET(new Request("http://local/api/quizzes/"+id+"/privacy"),{params:Promise.resolve({id})}) as Promise<Response>};
}
for(const role of [null,"teacher","admin"])test("Privacy endpoint denies "+role+" before reading enrollment or settings",async()=>{
 const f=privacyFixture(role);const r=await f.get();assert.equal(r.status,401);assert.deepEqual(f.calls.map(c=>c.kind),["session"]);assert.match(r.headers.get("cache-control")!,/no-store/);
});
test("Privacy endpoint is enrolled-Student scoped and excludes unrelated settings and unverified contacts",async()=>{
 const f=privacyFixture();const r=await f.get();assert.equal(r.status,200);const data=await r.json();assert.deepEqual(data,{retentionDays:90,institution:null,contact:null});
 assert.equal(f.calls[0].args.options.touchActivity,false);assert.equal(f.calls[1].args.where.studentId,"student-a");assert.equal(f.calls[1].args.where.quizId,99);
 assert.equal(JSON.stringify(f.calls[2].args.select),JSON.stringify({settingKey:true,settingValue:true}));assert.ok(!JSON.stringify(data).includes("SECRET"));assert.match(r.headers.get("cache-control")!,/no-store/);
});
test("Privacy endpoint derives the effective retention from the existing parser",async()=>{
 for(const [value,expected]of [["14",14],["3650",3650],["0",90],["invalid",90]]){const r=await privacyFixture("student",true,String(value)).get();assert.equal((await r.json()).retentionDays,expected);}
});
test("Privacy endpoint denies non-enrollment, malformed IDs and disabled Arena",async()=>{
 assert.equal((await privacyFixture("student",false).get()).status,404);
 for(const id of ["0","-1","abc","2147483648"])assert.equal((await privacyFixture().get(id)).status,404);
 const previous=process.env.POWER_ARENA_ENABLED;delete process.env.POWER_ARENA_ENABLED;try{const r=await privacyFixture("student",true,"90","arena").get();assert.equal(r.status,403);assert.equal((await r.json()).code,"FEATURE_DISABLED");}finally{if(previous===undefined)delete process.env.POWER_ARENA_ENABLED;else process.env.POWER_ARENA_ENABLED=previous;}
});
test("Privacy read errors return a safe retryable response, never internal details",async()=>{
 const f=privacyFixture();f.fail();const r=await f.get();assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/sensitive storage/);
});
function loginPage(role:string|null,joinCode:unknown,extra:Record<string,unknown>={}) {
 const redirects:string[]=[];const page=load("src/app/login/page.tsx",{
 "next/navigation":{redirect:(url:string)=>{redirects.push(url);throw Error("redirect");}},
 "@/lib/auth":{getSession:async(_role:unknown,options:{touchActivity:boolean})=>{assert.equal(options.touchActivity,false);return role?{role}:null;}},
 "@/lib/auth-destination":{getAuthDestination},"./content":{__esModule:true,default:"LoginContent"},
 "react/jsx-runtime":{jsx:(type:unknown,props:unknown)=>({type,props})},
 });
 return {redirects,visit:()=>page.default({searchParams:Promise.resolve({joinCode,...extra})})};
}
test("Already authenticated Student login intent returns directly to its code without another login",async()=>{
 const f=loginPage("student","PS-ABC123");await assert.rejects(f.visit(),/redirect/);assert.deepEqual(f.redirects,["/join?code=PS-ABC123"]);
});
for(const role of ["teacher","admin",null])test("Join-specific login never implicitly adopts "+role+" as Student",async()=>{
 const f=loginPage(role,"PS-ABC123");const view=await f.visit();assert.equal(view.type,"LoginContent");assert.equal(view.props.joinCode,"PS-ABC123");assert.equal(f.redirects.length,0);
});
test("No generic return URL is consumed by the login server page",async()=>{
 const f=loginPage("student",undefined,{next:"https://evil.test",returnTo:"//evil.test"});await assert.rejects(f.visit(),/redirect/);assert.deepEqual(f.redirects,["/dashboard/student"]);
});
test("Every camera initialization entry point is preceded by notice readiness and no consent write is added",()=>{
 const source=fs.readFileSync("src/app/quiz/[id]/page.tsx","utf8");assert.ok(source.indexOf("<StudentPrivacyNotice")<source.indexOf("Device & Camera Check"));
 const preflight=source.slice(source.indexOf("const runDevicePreflight"),source.indexOf("const runDevicePreflight")+3600);assert.ok(preflight.indexOf("if (!privacyNoticeReady)")<preflight.indexOf("getUserMedia"));
 assert.match(source,/if \(!hasStarted \|\| !privacyNoticeReady\) return/);assert.match(source,/disabled=\{isCheckingDevice \|\| !privacyNoticeReady\}/);assert.match(source,/disabled=\{isEnteringQuiz \|\| !privacyNoticeReady\}/);
 const notice=fs.readFileSync("src/components/student-privacy-notice.tsx","utf8");assert.doesNotMatch(notice,/method:\s*["']POST|localStorage|sessionStorage|consent.*create/i);assert.match(notice,/Individual Administrator approval is not currently required/);assert.match(notice,/live camera images and available audio/);
});

