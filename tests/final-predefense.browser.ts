import assert from "node:assert/strict";
import test,{before,after}from"node:test";
import fs from"node:fs";import path from"node:path";import http from"node:http";
import {chromium,type Browser,type Page}from"playwright";
const origin="http://127.0.0.1:3121",review=process.env.PREDEFENSE_BROWSER_REVIEW_DIR||"release-review/final-predefense-2026-10-15",temp=".tmp-predefense-browser";
let browser:Browser,server:http.Server;const results:Array<Record<string,unknown>>=[];
before(async()=>{
 server=http.createServer((req,res)=>{
 const url=new URL(req.url||"/",origin);res.setHeader("Cache-Control","no-store");
 if(["/bundle.js","/bundle.css","/base.css"].includes(url.pathname)){res.setHeader("Content-Type",url.pathname.endsWith(".js")?"text/javascript":"text/css");res.end(fs.readFileSync(path.join(temp,url.pathname.slice(1))));return;}
 if(/^\/(?:images|videos|fonts)\//.test(url.pathname)){const file=path.resolve("public","."+url.pathname);if(file.startsWith(path.resolve("public")+path.sep)&&fs.existsSync(file)){res.setHeader("Content-Type",file.endsWith(".webp")?"image/webp":file.endsWith(".png")?"image/png":"application/octet-stream");res.end(fs.readFileSync(file));return;}res.writeHead(404).end();return;}
 res.setHeader("Content-Type","text/html");res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
 });await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(3121,"127.0.0.1",resolve);});
 browser=await chromium.launch({headless:true,args:["--use-fake-device-for-media-stream","--use-fake-ui-for-media-stream"]});
});
after(async()=>{await browser?.close();await new Promise<void>(resolve=>server?.close(()=>resolve()));fs.writeFileSync(review+"/FLOW_BROWSER_RESULTS.json",JSON.stringify({checkedAt:new Date().toISOString(),scope:"Actual application components with local router/auth/data/provider/model fixtures and Chromium fake media devices. No real accounts, records, student media or inference accuracy verification.",results},null,2));});
type Options={role?:string|null;loginRole?:string;privacyFailures?:number;denyCamera?:boolean;denyMicrophone?:boolean;sessionFailure?:boolean;joinFailure?:boolean;remaining?:number};
async function fixture(options:Options={},theme:"light"|"dark"="light",width=1280){
 const page=await browser.newPage({viewport:{width,height:1000},colorScheme:theme,reducedMotion:"reduce"});const calls:Array<{path:string;method:string;body:any}>=[];
 let role=options.role===undefined?"student":options.role,privacyFailures=options.privacyFailures||0,started=false;
 page.setDefaultTimeout(8000);
 const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 await page.addInitScript(({theme,denyCamera,denyMicrophone})=>{
  localStorage.setItem("theme",theme);const state={cameraCalls:[] as Array<{audio:unknown;afterNotice:boolean}>,continued:false,tracks:[] as MediaStreamTrack[]};(window as any).__mediaQA=state;
  document.addEventListener("click",event=>{if((event.target as HTMLElement).closest("button")?.textContent?.trim()==="Continue to Device Check")state.continued=true;},true);
  const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async constraints=>{
   state.cameraCalls.push({audio:constraints?.audio,afterNotice:state.continued});
   if(denyCamera||(denyMicrophone&&constraints?.audio))throw new DOMException("Synthetic permission denied","NotAllowedError");
   const stream=await get(constraints);state.tracks.push(...stream.getTracks());return stream;
  };
 },{theme,denyCamera:!!options.denyCamera,denyMicrophone:!!options.denyMicrophone});
 await page.route("**/*",async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(!u.pathname.startsWith("/api/"))return route.continue();
  let body:any={};try{body=route.request().postDataJSON()||{};}catch{}
  calls.push({path:u.pathname,method:route.request().method(),body});
  const reply=(json:unknown,status=200)=>route.fulfill({status,json});
  if(u.pathname==="/api/auth/session"){if(options.sessionFailure)return reply({authenticated:false},503);return role?reply({authenticated:true,user:{role,userId:role,fullName:"Synthetic Student"}}):reply({authenticated:false,user:null},401);}
  if(u.pathname==="/api/auth/register"){role="student";return reply({success:true,user:{role}});}
  if(u.pathname==="/api/auth/login"){role=options.loginRole||"student";return reply({success:true,user:{role}});}
  if(u.pathname==="/api/auth/google")return body.mode==="begin"?reply({intent:"synthetic-intent",nonce:"synthetic-nonce"}):reply({success:true,requiresMfa:true,role:"student",userId:"student",email:"synthetic@example.test",challenge:"synthetic-challenge"});
  if(u.pathname==="/api/auth/verify-otp"){role="student";return reply({success:true,user:{role}});}
  if(u.pathname==="/api/quizzes")return reply({quizzes:[]});
  if(u.pathname==="/api/quizzes/join"){if(!role||role!=="student")return reply({error:"Student required"},401);if(options.joinFailure)return reply({error:"Invalid access code. Quiz not found."},404);
   const quiz={id:99,title:"Synthetic academic assessment",teacher:"Synthetic Teacher",quizMode:"proctored",isArena:false,quizStatus:"in_progress"};
   return reply({success:true,quiz,destination:"/quiz/99",join:{eligible:true,reviewOnly:false,state:"joinable",message:""},arenaSession:null});}
  if(u.pathname==="/api/quizzes/99/privacy"){if(privacyFailures-->0)return reply({error:"Unavailable"},503);return reply({retentionDays:37,institution:null,contact:null});}
  if(u.pathname==="/api/quizzes/99")return reply({success:true,userId:"student",studentQuizId:"synthetic-attempt",studentQuizStatus:started?"in_progress":"enrolled",attemptMode:"proctored",canEnterQuiz:true,startTime:started?new Date(Date.now()-60000).toISOString():null,endTime:null,attemptNumber:1,remainingSeconds:options.remaining||420,violationCount:0,savedAnswers:[],
   quiz:{id:99,title:"Synthetic academic assessment",duration:10,totalQuestions:2,quizStatus:"in_progress",quizMode:"proctored",teacherId:"teacher",subject:{subjectName:"QA"}},
   questions:[{id:1,questionText:"Which number is even?",questionType:"multiple_choice",points:1,choices:[{id:11,choiceText:"Two"},{id:12,choiceText:"Three"}]},{id:2,questionText:"Which shape has three sides?",questionType:"multiple_choice",points:1,choices:[{id:21,choiceText:"Triangle"},{id:22,choiceText:"Circle"}]}]});
  if(u.pathname==="/api/quizzes/session"){if(body.action==="start"){started=true;return reply({success:true,startTime:new Date(Date.now()-60000).toISOString(),remainingSeconds:options.remaining||420});}if(body.capabilities?.microphonePermission!==true)return reply({error:"Microphone permission is required for audio monitoring. Enable it in your browser settings and run the device check again.",code:"UNSUPPORTED_DEVICE",monitoringLevel:"unsupported"},422);return reply({success:true,monitoringLevel:"strict"});}
  if(u.pathname==="/api/quizzes/answer")return reply({success:true,choiceId:body.choiceId,isCorrect:true});
  if(u.pathname==="/api/quizzes/submit")return reply({success:true,result:{score:100,answeredCount:2,totalQuestions:2,violationCount:0,aiVerdict:"clean",integrityInvalidated:false}});
  if(u.pathname==="/api/live/warning")return reply({warning:null});
  if(u.pathname==="/api/live/webrtc")return reply({success:true,signals:[]});
  return reply({success:true});
 });
 return {page,calls,errors,close:async()=>{await page.close();}};
}
const media=(page:Page)=>page.evaluate(()=>(window as any).__mediaQA.cameraCalls as Array<{audio:boolean;afterNotice:boolean}>);
for(const theme of["light","dark"] as const)for(const width of[360,390,768,1280,1440])test("privacy lobby "+theme+" "+width+"px",async()=>{
 const f=await fixture({},theme,width);try{await f.page.goto(origin+"/quiz/99");await f.page.getByText("Configured evidence retention:").waitFor();assert.match(await f.page.locator("body").innerText(),/37 days/);
 assert.equal((await media(f.page)).length,0);assert.ok(await f.page.locator("#quiz-device-check").isDisabled());
 const notice=f.page.getByRole("region",{name:"Your Privacy Matters"});assert.ok(await notice.isVisible());const a=await notice.boundingBox(),b=await f.page.locator("#quiz-device-check").boundingBox();assert.ok(a&&b&&a.y<b.y);
 await f.page.getByText("Evidence access and privacy information").click();assert.match(await notice.innerText(),/Individual Administrator approval is not currently required/);assert.equal(await notice.locator("a").count(),0);
 assert.ok(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.equal(await notice.locator("p,button,summary").evaluateAll(nodes=>nodes.filter(el=>el.scrollWidth>el.clientWidth+2).length),0);
 await f.page.screenshot({path:review+"/lobby-"+theme+"-"+width+".png",fullPage:true});
 await f.page.getByRole("button",{name:"Continue to Device Check",exact:true}).click();assert.equal((await media(f.page)).length,0);assert.ok(await f.page.locator("#quiz-device-check").isEnabled());assert.equal(f.errors.length,0,f.errors.join("\n"));
 const contrast=await notice.evaluate(el=>{const rgb=(v:string)=>v.match(/[\d.]+/g)!.slice(0,3).map(Number);const lum=(c:number[])=>c.map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((a,x,i)=>a+x*[.2126,.7152,.0722][i],0);const bg=lum(rgb(getComputedStyle(el).backgroundColor));return Math.min(...Array.from(el.querySelectorAll("p,h2,summary,small")).map(n=>{const fg=lum(rgb(getComputedStyle(n).color));return(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05)}));});assert.ok(contrast>=4.5,"Notice contrast "+contrast);
results.push({case:"lobby",theme,width,pass:true,noMediaBeforeContinue:true,serverRetention:37,minTextContrast:contrast});
 }finally{await f.close();}
});
test("guest enters code once, unified password login returns to same quiz",async()=>{
 const f=await fixture({role:null});try{await f.page.goto(origin);await f.page.locator("#quiz-code").fill("PS-ABC123");await f.page.getByRole("button",{name:"Join quiz",exact:true}).click();await f.page.waitForURL("**/login?joinCode=PS-ABC123");
 assert.equal(f.calls.filter(c=>c.path==="/api/quizzes/join").length,0);await f.page.locator("#login-email").fill("student@example.test");await f.page.locator("#login-password").fill("SyntheticPassword123");await f.page.getByRole("button",{name:"Sign In",exact:true}).click();await f.page.waitForURL("**/quiz/99");await f.page.getByRole("heading",{name:"Your Privacy Matters"}).waitFor();
 const joins=f.calls.filter(c=>c.path==="/api/quizzes/join"&&c.method==="POST");assert.equal(joins.length,1);assert.equal(joins[0].body.accessCode,"PS-ABC123");results.push({case:"guest-one-code-password",pass:true});
 }finally{await f.close();}
});
test("existing Student direct invitation joins without another login or code entry",async()=>{
 const f=await fixture();try{await f.page.goto(origin+"/join?code=PS-ABC123");await f.page.waitForURL("**/quiz/99");assert.equal(f.calls.filter(c=>c.path==="/api/auth/login").length,0);assert.equal(f.calls.filter(c=>c.path==="/api/quizzes/join"&&c.method==="POST").length,1);results.push({case:"student-direct-link",pass:true});}finally{await f.close();}
});
for(const role of["teacher","admin"])test(role+" cannot join with a non-Student identity",async()=>{
 const f=await fixture({role,loginRole:role});try{await f.page.goto(origin+"/join?code=PS-ABC123");await f.page.getByRole("heading",{name:"Student account required"}).waitFor();assert.equal(f.calls.filter(c=>c.path.startsWith("/api/quizzes")).length,0);
 await f.page.getByRole("link",{name:"Sign in with a Student account"}).click();await f.page.locator("#login-email").fill(role+"@example.test");await f.page.locator("#login-password").fill("SyntheticPassword123");await f.page.getByRole("button",{name:"Sign In",exact:true}).click();await f.page.getByRole("alert").waitFor();assert.match(await f.page.getByRole("alert").innerText(),/Student account/);assert.equal(f.calls.filter(c=>c.path==="/api/quizzes/join").length,0);results.push({case:role+"-isolation",pass:true});
 }finally{await f.close();}
});


test("session verification outage never looks up quiz data",async()=>{
 const f=await fixture({sessionFailure:true});try{await f.page.goto(origin+"/join?code=PS-ABC123");await f.page.getByRole("heading",{name:"Sign-in check unavailable"}).waitFor();assert.equal(f.calls.filter(c=>c.path.startsWith("/api/quizzes")).length,0);results.push({case:"session-unavailable",pass:true});}finally{await f.close();}
});
test("privacy load failure blocks permissions and allows safe retry",async()=>{
 const f=await fixture({privacyFailures:1});try{await f.page.goto(origin+"/quiz/99");await f.page.getByRole("alert").filter({hasText:"Privacy information could not load"}).waitFor();assert.ok(await f.page.locator("#quiz-device-check").isDisabled());assert.equal((await media(f.page)).length,0);
 await f.page.getByRole("button",{name:"Retry privacy information"}).click();await f.page.getByText("Configured evidence retention:").waitFor();await f.page.getByRole("button",{name:"Continue to Device Check",exact:true}).click();assert.ok(await f.page.locator("#quiz-device-check").isEnabled());results.push({case:"privacy-retry",pass:true});}finally{await f.close();}
});
test("camera denial reports device failure without starting an attempt",async()=>{
 const f=await fixture({denyCamera:true});try{await f.page.goto(origin+"/quiz/99");await f.page.getByRole("button",{name:"Continue to Device Check",exact:true}).click();await f.page.locator("#quiz-device-check").click();await f.page.getByRole("alert").filter({hasText:"Synthetic permission denied"}).waitFor();
 assert.equal((await media(f.page)).length,2);assert.ok((await media(f.page)).every(c=>c.afterNotice));assert.equal(f.calls.filter(c=>c.path==="/api/quizzes/session"&&c.body.action==="start").length,0);results.push({case:"camera-denied",pass:true});}finally{await f.close();}
});
test("microphone denial probes video-only but existing server policy still blocks quiz start",async()=>{
 const f=await fixture({denyMicrophone:true});try{await f.page.goto(origin+"/quiz/99");await f.page.getByRole("button",{name:"Continue to Device Check",exact:true}).click();await f.page.locator("#quiz-device-check").click();await f.page.getByRole("alert").filter({hasText:"Microphone permission is required"}).waitFor();
 const requests=await media(f.page);assert.equal(requests.length,2);assert.equal(requests[0].audio,true);assert.equal(requests[1].audio,false);const check=f.calls.find(c=>c.path==="/api/quizzes/session"&&!c.body.action);assert.equal(check?.body.capabilities.microphonePermission,false);
 assert.ok(await f.page.evaluate(()=>(window as any).__mediaQA.tracks.every((t:MediaStreamTrack)=>t.readyState==="ended")));assert.equal(f.calls.filter(c=>c.path==="/api/quizzes/session"&&c.body.action==="start").length,0);results.push({case:"microphone-denied-start-blocked",pass:true});}finally{await f.close();}
});
test("quiz start retains server countdown, answers and submission with synthetic camera",async()=>{
 const f=await fixture({remaining:83});try{await f.page.goto(origin+"/quiz/99");await f.page.getByRole("button",{name:"Continue to Device Check",exact:true}).click();await f.page.locator("#quiz-device-check").click();await f.page.getByRole("button",{name:"I Understand, Start Quiz",exact:true}).click();await f.page.getByRole("heading",{name:"Which number is even?"}).waitFor();
 assert.match(await f.page.locator("body").innerText(),/1:2\d/);await f.page.getByRole("button",{name:/Two/}).click();await f.page.getByRole("heading",{name:"Which shape has three sides?"}).waitFor();await f.page.getByRole("button",{name:/Triangle/}).click();await f.page.getByRole("heading",{name:"Assessment Completed!"}).waitFor();
 assert.ok((await media(f.page)).every(c=>c.afterNotice));const submissions=f.calls.filter(c=>c.path==="/api/quizzes/submit");assert.equal(submissions.length,1);assert.equal(submissions[0].body.reason,"all_questions_completed");assert.equal(submissions[0].body.answers.length,2);assert.equal(f.errors.length,0,f.errors.join("\n"));results.push({case:"start-answer-submit-countdown",pass:true});}finally{await f.close();}
});
test("unified Google verification retains the same code",async()=>{
 const f=await fixture({role:null});try{await f.page.goto(origin+"/join?code=PS-ABC123");await f.page.waitForURL("**/login?joinCode=PS-ABC123");await f.page.getByRole("button",{name:"Synthetic Google sign-in"}).click();await f.page.locator("#google-otp").fill("123456");await f.page.getByRole("button",{name:"Verify & Sign In"}).click();await f.page.waitForURL("**/quiz/99");assert.equal(f.calls.filter(c=>c.path==="/api/quizzes/join"&&c.method==="POST")[0].body.accessCode,"PS-ABC123");results.push({case:"google-verification-code",pass:true});}finally{await f.close();}
});
test("invalid code retains a retryable prefilled join screen",async()=>{
 const f=await fixture({joinFailure:true});try{await f.page.goto(origin+"/join?code=PS-BAD123");await f.page.getByText("Invalid access code. Quiz not found.").waitFor();assert.equal(await f.page.getByRole("textbox",{name:"Enter Quiz Code"}).inputValue(),"PS-BAD123");assert.equal(f.calls.filter(c=>c.path==="/api/quizzes/join"&&c.method==="POST").length,1);results.push({case:"invalid-code",pass:true});}finally{await f.close();}
});
test("direct /join remains usable without a query code",async()=>{
 const f=await fixture();try{await f.page.goto(origin+"/join");await f.page.getByRole("textbox",{name:"Enter Quiz Code"}).fill("PS-ABC123");await f.page.getByRole("button",{name:"Join Quiz",exact:true}).click();await f.page.waitForURL("**/quiz/99");results.push({case:"direct-join",pass:true});}finally{await f.close();}
});


test("Student registration link preserves the original code",async()=>{
 const f=await fixture({role:null});try{await f.page.goto(origin+"/join?code=PS-ABC123");await f.page.waitForURL("**/login?joinCode=PS-ABC123");await f.page.getByRole("link",{name:"Create Student Account",exact:true}).click();await f.page.locator("#student-register-name").fill("Synthetic Learner");await f.page.locator("#student-register-email").fill("new-student@example.test");await f.page.locator("#student-register-password").fill("SyntheticPassword123");await f.page.locator("#student-register-confirm").fill("SyntheticPassword123");await f.page.locator("form").filter({has:f.page.locator("#student-register-name")}).locator("button[type=submit]").click();await f.page.waitForURL("**/quiz/99");assert.equal(f.calls.filter(c=>c.path==="/api/quizzes/join"&&c.method==="POST")[0].body.accessCode,"PS-ABC123");results.push({case:"registration-code-preserved",pass:true});}finally{await f.close();}
});
test("privacy notice remains usable at 200 percent text",async()=>{const f=await fixture({},"light",390);try{await f.page.goto(origin+"/quiz/99");await f.page.getByText("Configured evidence retention:").waitFor();await f.page.addStyleTag({content:"html{font-size:200%!important}"});assert.ok(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const region=f.page.getByRole("region",{name:"Your Privacy Matters"});assert.equal(await region.locator("p,button,summary").evaluateAll(nodes=>nodes.filter(el=>el.scrollWidth>el.clientWidth+2).length),0);await f.page.getByRole("button",{name:"Continue to Device Check",exact:true}).click();assert.equal((await media(f.page)).length,0);results.push({case:"privacy-text-200",pass:true});}finally{await f.close();}});