import assert from "node:assert/strict";
import test from "node:test";
import { loadArenaModule } from "./helpers/arena-fixture.ts";
const questions=[{questionText:"What is 2+2?",choices:[{choiceText:"4",isCorrect:true},{choiceText:"3",isCorrect:false},{choiceText:"5",isCorrect:false},{choiceText:"6",isCorrect:false}]}];
export function aiFixture(output:any={questions}, options:{role?:string|null;subscribed?:boolean}={}) {
 const requests:any[]=[];const route=loadArenaModule("src/app/api/ai/create/route.ts",{
 __process:{env:{GEMINI_API_KEY:"fixture-key"}},"@/lib/backup-write-gate":{withBackupWriteGate:(fn:any)=>fn},"next/server":{NextResponse:{json:(body:any,init:any={})=>({status:init.status??200,body})}},
 "@/lib/auth":{getSession:async()=>options.role===null?null:({userId:"teacher",role:options.role??"teacher"})},"@/lib/security":{consumeRateLimitGroup:async()=>({allowed:true}),getClientIp:()=>"local"},
 "@/lib/maintenance":{expireSubscriptions:async()=>{}},"@/lib/teacher-entitlements":{getTeacherEntitlements:async()=>({isSubscribed:options.subscribed??true})},"@/lib/ai-quiz-provenance":{createAiQuizReceipt:()=>"receipt"},
 "@google/genai":{GoogleGenAI:class{models={generateContent:async(args:any)=>{requests.push(args);return{text:typeof output==="string"?output:JSON.stringify(output)};}};}},
 });return {requests,post:(body:any)=>route.POST({json:async()=>body,headers:{get:()=>null}})};
}
test("PDF upload uses provider document inlineData and selected question count",async()=>{const f=aiFixture();const r=await f.post({imageBase64:Buffer.from("%PDF-1.4 sample").toString("base64"),mimeType:"application/pdf",numQuestions:7});assert.equal(r.status,200);assert.equal(f.requests[0].contents[0].inlineData.mimeType,"application/pdf");assert.ok(f.requests[0].contents.at(-1).includes("Generate 7"));});
test("text file contents enter generation rather than being treated as an empty topic",async()=>{const f=aiFixture();const r=await f.post({sourceText:"Chapter 1: Algebra",numQuestions:3});assert.equal(r.status,200);assert.ok(f.requests[0].contents.at(-1).includes("Chapter 1: Algebra"));});
test("signed-out, Student, Admin and Free Teacher requests cannot invoke the AI provider",async()=>{
 for(const options of [{role:null},{role:"student"},{role:"admin"},{role:"teacher",subscribed:false}]){
  const f=aiFixture(undefined,options);const r=await f.post({sourceText:"Synthetic notes",numQuestions:3});
  assert.equal(r.status,options.role==="teacher"?403:401);assert.equal(f.requests.length,0);assert.equal(r.body.aiGenerationReceipt,undefined);
 }
});
test("malformed AI choices are rejected before attesting or opening question creation",async()=>{const f=aiFixture({questions:[{questionText:"Bad",choices:[{choiceText:"X",isCorrect:true},{choiceText:"Y",isCorrect:true}]}]});assert.equal((await f.post({topic:"Math",numQuestions:1})).status,502);});
test("image and captured JPEG use the same generation path",async()=>{for(const mimeType of ["image/png","image/jpeg"]){const f=aiFixture();const r=await f.post({imageBase64:"QUJD",mimeType,numQuestions:4});assert.equal(r.status,200);assert.equal(f.requests[0].contents[0].inlineData.mimeType,mimeType);}});
test("invalid and oversized uploads are rejected before provider work",async()=>{for(const source of [{imageBase64:"bad!",mimeType:"image/png"},{imageBase64:"AAAA",mimeType:"application/zip"},{imageBase64:"A".repeat(5_500_001),mimeType:"image/png"}]){const f=aiFixture();assert.equal((await f.post(source)).status,413);assert.equal(f.requests.length,0);}});
import { prepareQuizScan, captureQuizScan, quizScanPayload, startQuizScannerCamera } from "../src/lib/quiz-scanner.ts";
function globals(t:any,values:Record<string,any>) {for(const [name,value]of Object.entries(values)){const previous=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{configurable:true,value});t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else delete(globalThis as any)[name];});}}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));

const paperQuestion = {
  questionText: "Why should pen names be used during the Spanish time?",
  choices: [
    { choiceText: "To be more mysterious", isCorrect: false },
    { choiceText: "To have safety from the Spaniards", isCorrect: true },
    { choiceText: "To convince more readers", isCorrect: false },
  ],
};

test("questionnaire import preserves wording, source order and three-choice items without padding", async () => {
  const fixture = aiFixture({ sourceKind: "questionnaire", answerKeyProvided: false, questions: [paperQuestion], sourceWarnings: [] });
  const response = await fixture.post({ sourceText: "1. Why should pen names be used during the Spanish time? A. To be more mysterious B. To have safety from the Spaniards C. To convince more readers", numQuestions: 5 });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(response.body.questions)), [paperQuestion]);
  assert.match(response.body.sourceWarnings.join(" "), /AI inferred the marked answers/);
  assert.match(response.body.sourceWarnings.join(" "), /Imported 1 of 5/);
  const prompt = fixture.requests[0].contents.at(-1);
  assert.match(prompt, /IMPORT the first 5 complete multiple-choice questions in their original order/);
  assert.match(prompt, /Preserve the original question wording, language, and every answer choice in its original order/);
  assert.match(prompt, /three choices must keep three choices/);
  assert.match(prompt, /never pad the result with invented questions/);
});

test("a supplied answer key avoids an inferred-key warning and oversized output respects the selected count", async () => {
  const fixture = aiFixture({ answerKeyProvided: true, sourceKind: "questionnaire", questions: [paperQuestion, { ...paperQuestion, questionText: "Extra question" }], sourceWarnings: ["Review a cropped heading"] });
  const response = await fixture.post({ imageBase64: "QUJD", mimeType: "image/jpeg", numQuestions: 1 });
  assert.equal(response.status, 200);
  assert.equal(response.body.questions.length, 1);
  assert.equal(response.body.questions[0].questionText, paperQuestion.questionText);
  assert.deepEqual(JSON.parse(JSON.stringify(response.body.sourceWarnings)), ["Review a cropped heading"]);
});

test("invalid AI metadata is bounded instead of becoming an object rendered in the editor", async () => {
  const fixture = aiFixture({ questions: [paperQuestion], detectedTitle: { unexpected: true }, detectedSubject: [], detectedDescription: 123, sourceWarnings: [null, { unexpected: true }, "", "A".repeat(600)] });
  const response = await fixture.post({ sourceText: "Sample questionnaire", numQuestions: 1 });
  assert.equal(response.status, 200);
  assert.equal(response.body.detectedTitle, ""); assert.equal(response.body.detectedSubject, ""); assert.equal(response.body.detectedDescription, "");
  assert.equal(response.body.sourceWarnings.length, 2);
  assert.equal(response.body.sourceWarnings[1].length, 300);
});
test("camera prefers rear lens, uses ideal constraints and stops all tracks on close",async(t)=>{
 let constraints:any,stops=0;const video:any={srcObject:null,play:async()=>{}};
 globals(t,{navigator:{mediaDevices:{getUserMedia:async(c:any)=>{constraints=c;return{getTracks:()=>[{stop:()=>stops++}]};}}}});
 const stop=startQuizScannerCamera(video,()=>assert.fail());await flush();assert.deepEqual(constraints.video.facingMode,{ideal:"environment"});assert.equal(constraints.video.width.ideal,1280);assert.ok(video.srcObject);stop();assert.equal(stops,1);assert.equal(video.srcObject,null);
});
test("camera permission resolving after close cannot leak a stream",async(t)=>{
 let release:any,stops=0;const video:any={srcObject:null,play:async()=>assert.fail()};globals(t,{navigator:{mediaDevices:{getUserMedia:()=>new Promise(r=>release=r)}}});
 const stop=startQuizScannerCamera(video,()=>assert.fail());stop();release({getTracks:()=>[{stop:()=>stops++}]});await flush();assert.equal(stops,1);assert.equal(video.srcObject,null);
});
test("camera permission denial reports recoverable upload alternative",async(t)=>{
 globals(t,{navigator:{mediaDevices:{getUserMedia:async()=>{throw new DOMException("Denied","NotAllowedError");}}}});let error="";
 startQuizScannerCamera({srcObject:null}as any,m=>error=m);await flush();assert.match(error,/permission was denied/);
});
test("camera constraint fallback keeps environment preference",async(t)=>{
 const calls:any[]=[];globals(t,{navigator:{mediaDevices:{getUserMedia:async(c:any)=>{calls.push(c);if(calls.length===1)throw new DOMException("Constraints","OverconstrainedError");return{getTracks:()=>[]};}}}});
 const stop=startQuizScannerCamera({srcObject:null,play:async()=>{}}as any,()=>assert.fail());await flush();assert.equal(calls.length,2);assert.deepEqual(calls[1].video.facingMode,{ideal:"environment"});stop();
});
test("camera captures intrinsic frame dimensions and bounds image size",t=>{
 const draws:any[]=[];const canvas:any={getContext:()=>({fillRect(){},drawImage:(...args:any[])=>draws.push(args)}),toDataURL:()=>"data:image/jpeg;base64,QUJD"};globals(t,{document:{createElement:()=>canvas}});
 const video:any={readyState:2,videoWidth:2560,videoHeight:1440};const source=captureQuizScan(video);assert.equal(canvas.width,1800);assert.equal(canvas.height,1013);assert.equal(draws[0][0],video);assert.deepEqual(quizScanPayload(source),{mimeType:"image/jpeg",imageBase64:"QUJD"});
 assert.throws(()=>captureQuizScan({...video,videoWidth:0}),/not ready/);assert.throws(()=>captureQuizScan({...video,readyState:0}),/preview/);
});
test("uploaded image is resized and normalized to the same JPEG pipeline",async(t)=>{
 const canvas:any={getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=>"data:image/jpeg;base64,QUJD"};
 globals(t,{document:{createElement:()=>canvas},FileReader:class{result="data:image/gif;base64,QUJD";onload:any;readAsDataURL(){this.onload();}},Image:class{naturalWidth=4000;naturalHeight=3000;onload:any;set src(_:string){this.onload();}}});
 const source=await prepareQuizScan({name:"large.gif",type:"image/gif",size:9000000}as any);assert.equal(canvas.width,1800);assert.equal(canvas.height,1350);assert.equal(quizScanPayload(source).mimeType,"image/jpeg");
});
test("text file preserves content and file limits reject unsupported or oversized input",async()=>{
 const text=await prepareQuizScan({name:"notes.txt",type:"text/plain",size:10,text:async()=>"  Algebra notes  "}as any);assert.deepEqual(quizScanPayload(text),{sourceText:"Algebra notes"});
 for(const file of [{name:"large.pdf",type:"application/pdf",size:4000001},{name:"empty.txt",type:"text/plain",size:0},{name:"archive.zip",type:"application/zip",size:100},{name:"large.png",type:"image/png",size:10000001}])await assert.rejects(prepareQuizScan(file as any));
});
test("bad PDF bytes and oversize source text never call provider",async()=>{
 for(const source of [{imageBase64:"QUJD",mimeType:"application/pdf"},{sourceText:"X".repeat(60001)}]){const f=aiFixture();assert.ok((await f.post(source)).status>=400);assert.equal(f.requests.length,0);}
});
