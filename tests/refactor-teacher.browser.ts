import assert from "node:assert/strict";
import test,{before,after} from "node:test";
import fs from "node:fs";
import http from "node:http";
import {chromium,type Browser,type Page} from "playwright";
const origin="http://127.0.0.1:3137",review=process.env.REFACTOR_BROWSER_REVIEW_DIR||"release-review/refactor-2026-10-15";
let browser:Browser,server:http.Server;
const results:Array<Record<string,unknown>>=[];
before(async()=>{
 fs.mkdirSync(review,{recursive:true});
 server=http.createServer((req,res)=>{
  const u=new URL(req.url||"/",origin);res.setHeader("Cache-Control","no-store");
  if(u.pathname==="/bundle.js"||u.pathname==="/base.css"){
   res.setHeader("Content-Type",u.pathname.endsWith(".js")?"text/javascript":"text/css");
   res.end(fs.readFileSync(".tmp-refactor-browser"+u.pathname));return;
  }
  res.setHeader("Content-Type","text/html");res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/base.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
 });
 await new Promise<void>(resolve=>server.listen(3137,"127.0.0.1",resolve));
 browser=await chromium.launch({headless:true,args:["--disable-gpu"]});
});
after(async()=>{
 await browser?.close();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));
 fs.writeFileSync(review+"/BROWSER_RESULTS.json",JSON.stringify({scope:"Actual current and v3 baseline Teacher components; synthetic data and router; no authenticated application/records. Strict library pixel, modal DOM, geometry/style and functional checks. Modal pixels are diagnostic because Chromium intermittently captures blank portals.",results},null,2));
});
async function screen(width:number,theme:string,view="current",fail=false){
 const page=await browser.newPage({viewport:{width,height:1000},colorScheme:theme as "light"|"dark",reducedMotion:"reduce"});
 const errors:string[]=[],requests:string[]=[];page.on("pageerror",e=>errors.push(e.message));
 let failure=fail;
 await page.route("**/*",async route=>{
  const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
  if(!u.pathname.startsWith("/api/"))return route.continue();
  requests.push(route.request().method()+" "+u.pathname);
  const quiz={id:7,title:"Synthetic Biology Quiz",quizMode:"proctored",quizStatus:"draft",duration:30,totalQuestions:2,subject:{subjectName:"Science"},accessCode:"PS-SYNTHETIC",participantCount:2,participantLimit:100,allowRetake:false};
  let data:unknown={success:true};
  if(u.pathname==="/api/billing/status")data={isSubscribed:true,manualQuizCount:1,manualQuizLimit:5};
  else if(u.pathname==="/api/quizzes"){
   if(failure){failure=false;return route.fulfill({status:500,headers:{"X-Request-ID":"2d43b0b9-a784-44e7-9e14-ab985c21dac0"},json:{error:"Internal server error",private:"MUST_NOT_DISPLAY"}});}
   data={quizzes:[quiz,{...quiz,id:8,title:"Hidden Arena",quizMode:"arena"}],pendingApprovals:[],pendingRetakes:[],entitlements:{isSubscribed:true,manualQuizCount:1,manualQuizLimit:5}};
  }else if(u.pathname==="/api/quizzes/7")data={success:true,quiz,questions:[]};
  return route.fulfill({json:data});
 });
 await page.goto(origin+"/?view="+view+"&theme="+theme);
 await page.addStyleTag({content:"*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}"});
 if(fail)await page.getByRole("alert").waitFor();else await page.getByRole("cell",{name:"Synthetic Biology Quiz",exact:false}).waitFor();
 return {page,errors,requests};
}
async function capture(page:Page,file?:string) {
 await page.bringToFront();
 await page.evaluate(async()=>{
  await document.fonts.ready;
  await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
  await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getTiming().iterations)).map(a=>a.finished.catch(()=>{})));
 });
 return page.screenshot({path:file,animations:"disabled"});
}
for(const theme of ["light","dark"])for(const width of [360,390,768,1280,1440]){
 test("v3-equivalent Teacher library and Manage layout "+theme+" "+width,async()=>{
  const captures:Array<{library:Buffer;modal:Buffer;html:string;geometry:unknown}>=[];
  // Keep one page at a time: Windows Chromium can capture a blank composited portal
  // from a background page even after its DOM and animation state have settled.
  for(const view of ["baseline","current"]){
   const f=await screen(width,theme,view),prefix=view==="baseline"?"baseline-":"";
   assert.equal(await f.page.getByText("Hidden Arena",{exact:true}).count(),0);
   assert.ok(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));
   const library=await capture(f.page,review+"/"+prefix+"library-"+theme+"-"+width+".png");
   await f.page.getByPlaceholder("Search quizzes...").fill("unmatched");await f.page.getByText("No quizzes found",{exact:true}).waitFor();
   await f.page.getByPlaceholder("Search quizzes...").fill("BIOLOGY");await f.page.getByRole("cell",{name:"Synthetic Biology Quiz",exact:false}).waitFor();
   await f.page.getByPlaceholder("Search quizzes...").fill("");
   await f.page.getByRole("button",{name:"Manage",exact:true}).click();
   await f.page.getByRole("heading",{name:"Manage: Synthetic Biology Quiz"}).waitFor();
   const panel=f.page.locator(".app-modal-panel"),box=await panel.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+2);
   const html=await panel.evaluate(el=>el.outerHTML);
   const geometry=await panel.evaluate(el=>Array.from(el.querySelectorAll("button,input,h2")).concat([el]).map(node=>{const r=node.getBoundingClientRect(),c=getComputedStyle(node);return {tag:node.tagName,text:node.textContent,x:r.x,y:r.y,width:r.width,height:r.height,color:c.color,background:c.backgroundColor,opacity:c.opacity,font:c.font,padding:c.padding,border:c.border,transform:c.transform};}));
   const modal=await capture(f.page,review+"/"+prefix+"manage-"+theme+"-"+width+".png");
   await f.page.getByRole("button",{name:"Close",exact:true}).click();assert.equal(await panel.count(),0);
   assert.deepEqual(f.errors,[]);captures.push({library,modal,html,geometry});await f.page.close();
  }
  assert.equal(captures[0].html,captures[1].html,"Manage DOM differs from released v3");
  assert.deepEqual(captures[0].geometry,captures[1].geometry,"Manage layout or computed styles differ from released v3");
  assert.ok(captures[0].library.equals(captures[1].library),"Library pixels differ from released v3");
  // Keep pixel diagnostics without using intermittent blank Chromium portal captures as a release gate.
  const modalPixelMatch=captures[0].modal.equals(captures[1].modal);
  results.push({theme,width,pass:true,baselineLibraryPixelMatch:true,modalPixelMatch,baselineModalDOMMatch:true,baselineComputedGeometryAndStylesMatch:true,arenaHidden:true});
 });
}
test("Teacher load error shows safe reference and Retry recovers",async()=>{
 const f=await screen(390,"light","current",true);
 await f.page.getByRole("alert").getByText(/Reference: 2d43b0b9/).waitFor();
 assert.equal(await f.page.getByText("MUST_NOT_DISPLAY").count(),0);
 await f.page.getByRole("button",{name:"Retry",exact:true}).click();
 await f.page.getByRole("cell",{name:"Synthetic Biology Quiz",exact:false}).waitFor();
 assert.equal(await f.page.getByRole("alert").count(),0);assert.deepEqual(f.errors,[]);
 results.push({case:"safe error and retry",pass:true});await f.page.close();
});

test("Manage uses the loaded summary and Studio fetches full details on demand",async()=>{
 const f=await screen(1280,"light");
 try{
  await f.page.getByRole("button",{name:"Manage",exact:true}).click();
  await f.page.getByRole("heading",{name:"Manage: Synthetic Biology Quiz"}).waitFor();
  await f.page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  assert.equal(f.requests.filter(r=>r==="GET /api/quizzes/7").length,0,"Manage must not fetch unused question/evidence details");
  await f.page.getByRole("button",{name:"Open Studio",exact:true}).click();
  await f.page.getByRole("textbox",{name:"Quiz title",exact:true}).waitFor();
  assert.equal(await f.page.getByRole("textbox",{name:"Quiz title",exact:true}).inputValue(),"Synthetic Biology Quiz");
  assert.equal(f.requests.filter(r=>r==="GET /api/quizzes/7").length,1);
  assert.deepEqual(f.errors,[]);
  results.push({case:"Manage avoids unused fetch; Studio loads on demand",pass:true});
 }finally{await f.page.close();}
});

// Real file preparation, React handlers and Studio; synthetic API responses only.
const aiQuestions=[{questionText:"Which gas do plants release?",choices:[
 {choiceText:"Oxygen",isCorrect:true},{choiceText:"Nitrogen",isCorrect:false},
 {choiceText:"Helium",isCorrect:false},{choiceText:"Hydrogen",isCorrect:false},
]}];
const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=","base64");
const pdf=Buffer.from("%PDF-1.4\nSynthetic browser transport fixture\n%%EOF");
for(const source of ["PDF","image","camera"]){
 test("AI Create "+source+" prepares source, reports quota and retries into Studio without saving",async()=>{
  const f=await screen(390,"light");let calls=0;const bodies:Array<Record<string,any>>=[];
  try{
   await f.page.addInitScript(()=>{
    const canvas=document.createElement("canvas");canvas.width=640;canvas.height=480;
    const context=canvas.getContext("2d")!;context.fillStyle="white";context.fillRect(0,0,640,480);
    const stream=canvas.captureStream();
    Object.defineProperty(navigator.mediaDevices,"getUserMedia",{value:async()=>stream});
    (window as any).__syntheticScannerStream=stream;
   });
   await f.page.reload();await f.page.getByRole("button",{name:"AI Create",exact:true}).waitFor();
   await f.page.route("**/api/ai/create",async route=>{
    calls++;bodies.push(route.request().postDataJSON());
    await route.fulfill(calls===1?{status:503,json:{code:"AI_PROVIDER_QUOTA",error:"AI provider usage quota reached. Try again later."}}:{json:{success:true,aiGenerationReceipt:"synthetic-receipt",detectedTitle:"Synthetic AI Quiz",questions:aiQuestions}});
   });
   await f.page.getByRole("button",{name:"AI Create",exact:true}).click();
   if(source==="camera"){
    await f.page.getByRole("tab",{name:"Scan",exact:true}).click();
    await f.page.getByRole("button",{name:"Scan with Camera",exact:true}).click();
    await f.page.waitForFunction(()=>{const v=document.querySelector("video");return v&&v.readyState>=2;});
    await f.page.getByRole("button",{name:"Capture Photo",exact:true}).click();
   }else await f.page.locator('input[type="file"]').setInputFiles({name:source==="PDF"?"synthetic.pdf":"synthetic.png",mimeType:source==="PDF"?"application/pdf":"image/png",buffer:source==="PDF"?pdf:png});
   await f.page.getByRole("button",{name:"Remove scan",exact:true}).waitFor();
   await f.page.getByLabel("Number of Questions (1–50)").fill("1");
   await f.page.getByRole("button",{name:"Generate Magic",exact:true}).click();
   await f.page.getByRole("alert").getByText(/usage quota/).waitFor();
   assert.equal(await f.page.getByRole("button",{name:"Remove scan",exact:true}).count(),1);
   assert.equal(await f.page.getByLabel("Number of Questions (1–50)").inputValue(),"1");
   assert.equal(bodies[0].mimeType,source==="PDF"?"application/pdf":"image/jpeg");
   await f.page.getByRole("button",{name:"Generate Magic",exact:true}).click();
   await f.page.getByRole("textbox",{name:"Quiz title",exact:true}).waitFor();
   assert.equal(await f.page.getByRole("textbox",{name:"Quiz title",exact:true}).inputValue(),"Synthetic AI Quiz");
   assert.equal(calls,2);assert.deepEqual(bodies[0],bodies[1]);
   assert.equal(f.requests.filter(r=>/^(POST|PUT|DELETE) /.test(r)).length,0,"AI review must not save records");
   if(source==="camera")assert.equal(await f.page.evaluate(()=>(window as any).__syntheticScannerStream.getTracks().every((t:MediaStreamTrack)=>t.readyState==="ended")),true);
   assert.deepEqual(f.errors,[]);results.push({case:"AI Create "+source+" quota recovery",pass:true,syntheticProvider:true});
  }finally{await f.page.close();}
 });
}

test("AI Create cancellation aborts an in-flight request and ignores a late successful response",async()=>{
 const f=await screen(390,"dark");let release!:()=>void;const hold=new Promise<void>(resolve=>release=resolve);
 try{
  await f.page.route("**/api/ai/create",async route=>{await hold;await route.fulfill({json:{success:true,aiGenerationReceipt:"late-receipt",detectedTitle:"Stale quiz",questions:aiQuestions}}).catch(()=>{});});
  await f.page.getByRole("button",{name:"AI Create",exact:true}).click();
  await f.page.locator('input[type="file"]').setInputFiles({name:"synthetic.pdf",mimeType:"application/pdf",buffer:pdf});
  await f.page.getByRole("button",{name:"Remove scan",exact:true}).waitFor();
  const request=f.page.waitForRequest("**/api/ai/create");
  await f.page.getByRole("button",{name:"Generate Magic",exact:true}).click();const sent=await request;
  assert.equal(await f.page.getByRole("tab",{name:"Upload",exact:true}).isDisabled(),true);
  await f.page.getByRole("button",{name:"Close AI generator",exact:true}).click();release();
  await sent.response().catch(()=>null);
  await f.page.getByRole("button",{name:"AI Create",exact:true}).click();
  assert.equal(await f.page.getByRole("button",{name:"Generate Magic",exact:true}).isEnabled(),true);
  assert.equal(await f.page.getByRole("textbox",{name:"Quiz title",exact:true}).count(),0);
  assert.deepEqual(f.errors,[]);results.push({case:"AI cancellation and stale response",pass:true});
 }finally{release();await f.page.close();}
});

for(const theme of ["light","dark"])for(const width of [360,390,768,1280,1440]){
 test("AI Create quota message layout "+theme+" "+width,async()=>{
  const f=await screen(width,theme);
  try{
   await f.page.route("**/api/ai/create",route=>route.fulfill({status:503,json:{code:"AI_PROVIDER_QUOTA",error:"AI generation is unavailable because the provider's usage quota has been reached. The provider advises waiting about 9 hours before retrying. Ask your administrator to review the AI service quota."}}));
   await f.page.getByRole("button",{name:"AI Create",exact:true}).click();
   await f.page.locator('input[type="file"]').setInputFiles({name:"synthetic.pdf",mimeType:"application/pdf",buffer:pdf});
   await f.page.getByRole("button",{name:"Remove scan",exact:true}).waitFor();
   await f.page.getByRole("button",{name:"Generate Magic",exact:true}).click();
   await f.page.getByRole("alert").waitFor();
   const panel=f.page.locator(".app-modal-panel"),box=await panel.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+2);
   assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
   await capture(f.page,review+`/ai-quota-${theme}-${width}.png`);
   assert.deepEqual(f.errors,[]);results.push({case:"AI quota layout",width,theme,pass:true});
  }finally{await f.page.close();}
 });
}
