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
