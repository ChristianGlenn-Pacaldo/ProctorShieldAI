import assert from "node:assert/strict";
import test from "node:test";
import { loadArenaModule } from "./helpers/arena-fixture.ts";
const questions=[{questionText:"What is 2+2?",choices:[{choiceText:"4",isCorrect:true},{choiceText:"3",isCorrect:false},{choiceText:"5",isCorrect:false},{choiceText:"6",isCorrect:false}]}];
export function aiFixture(output:any={questions}) {
 const requests:any[]=[];const route=loadArenaModule("src/app/api/ai/create/route.ts",{
 __process:{env:{GEMINI_API_KEY:"fixture-key"}},"@/lib/backup-write-gate":{withBackupWriteGate:(fn:any)=>fn},"next/server":{NextResponse:{json:(body:any,init:any={})=>({status:init.status??200,body})}},
 "@/lib/auth":{getSession:async()=>({userId:"teacher",role:"teacher"})},"@/lib/security":{consumeRateLimitGroup:async()=>({allowed:true}),getClientIp:()=>"local"},
 "@/lib/maintenance":{expireSubscriptions:async()=>{}},"@/lib/teacher-entitlements":{getTeacherEntitlements:async()=>({isSubscribed:true})},"@/lib/ai-quiz-provenance":{createAiQuizReceipt:()=>"receipt"},
 "@google/genai":{GoogleGenAI:class{models={generateContent:async(args:any)=>{requests.push(args);return{text:typeof output==="string"?output:JSON.stringify(output)};}};}},
 });return {requests,post:(body:any)=>route.POST({json:async()=>body,headers:{get:()=>null}})};
}
test("PDF upload uses provider document inlineData and selected question count",async()=>{const f=aiFixture();const r=await f.post({imageBase64:Buffer.from("%PDF-1.4 sample").toString("base64"),mimeType:"application/pdf",numQuestions:7});assert.equal(r.status,200);assert.equal(f.requests[0].contents[0].inlineData.mimeType,"application/pdf");assert.ok(f.requests[0].contents.at(-1).includes("Generate 7"));});
test("text file contents enter generation rather than being treated as an empty topic",async()=>{const f=aiFixture();const r=await f.post({sourceText:"Chapter 1: Algebra",numQuestions:3});assert.equal(r.status,200);assert.ok(f.requests[0].contents.at(-1).includes("Chapter 1: Algebra"));});
test("malformed AI choices are rejected before attesting or opening question creation",async()=>{const f=aiFixture({questions:[{questionText:"Bad",choices:[{choiceText:"X",isCorrect:true},{choiceText:"Y",isCorrect:true}]}]});assert.equal((await f.post({topic:"Math",numQuestions:1})).status,502);});
test("image and captured JPEG use the same generation path",async()=>{for(const mimeType of ["image/png","image/jpeg"]){const f=aiFixture();const r=await f.post({imageBase64:"QUJD",mimeType,numQuestions:4});assert.equal(r.status,200);assert.equal(f.requests[0].contents[0].inlineData.mimeType,mimeType);}});
test("invalid and oversized uploads are rejected before provider work",async()=>{for(const source of [{imageBase64:"bad!",mimeType:"image/png"},{imageBase64:"AAAA",mimeType:"application/zip"},{imageBase64:"A".repeat(5_500_001),mimeType:"image/png"}]){const f=aiFixture();assert.equal((await f.post(source)).status,413);assert.equal(f.requests.length,0);}});
import { prepareQuizScan, captureQuizScan, quizScanPayload, startQuizScannerCamera } from "../src/lib/quiz-scanner.ts";
function globals(t:any,values:Record<string,any>) {for(const [name,value]of Object.entries(values)){const previous=Object.getOwnPropertyDescriptor(globalThis,name);Object.defineProperty(globalThis,name,{configurable:true,value});t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else delete(globalThis as any)[name];});}}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
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
