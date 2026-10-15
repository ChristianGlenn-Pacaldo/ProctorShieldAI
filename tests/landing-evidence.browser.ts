import assert from "node:assert/strict";
import test, {before, after} from "node:test";
import fs from "node:fs";
import {spawn, execFileSync, type ChildProcess} from "node:child_process";
import {setTimeout as delay} from "node:timers/promises";
import {chromium, type Browser} from "playwright";
import sharp from "sharp";
const origin="http://127.0.0.1:3119",review="release-review/landing-evidence-2026-10-15";
let browser:Browser,server:ChildProcess,log:number;
const evidence:Array<Record<string,unknown>>=[];
before(async()=>{
 try{await fetch(origin+"/login",{signal:AbortSignal.timeout(500)});throw Error("Port already owned");}catch(error){if((error as Error).message==="Port already owned")throw error;}
 execFileSync(process.execPath,["scripts/prepare-standalone.js"],{stdio:"ignore"});
 const env:NodeJS.ProcessEnv={...process.env,NODE_ENV:"production",PORT:"3119",HOSTNAME:"127.0.0.1",POWER_ARENA_ENABLED:"false",FRONTEND_ONLY:"false",DATABASE_URL:"postgresql://local:local@127.0.0.1:1/local",REDIS_URL:"redis://127.0.0.1:1",NEXTAUTH_SECRET:"local-landing-preview-secret-over-32-characters",NEXT_PUBLIC_APP_URL:origin,PUSHER_APP_ID:"local-preview",NEXT_PUBLIC_PUSHER_KEY:"local-preview",NEXT_PUBLIC_PUSHER_CLUSTER:"ap1",PUSHER_SECRET:"local-only",S3_ENDPOINT:"",S3_BUCKET:"",S3_ACCESS_KEY:"",S3_SECRET_KEY:"",GEMINI_API_KEY:"local-only",GMAIL_OAUTH_CLIENT_SECRET:"",GMAIL_OAUTH_REFRESH_TOKEN:"",SMTP_PASSWORD:"",PAYMONGO_SECRET_KEY:"",PAYMONGO_WEBHOOK_SECRET:""};
 log=fs.openSync(`${review}/local-browser-server.log`,"w");server=spawn(process.execPath,[".next/standalone/server.js"],{env,stdio:["ignore",log,log],windowsHide:true});
 let ready=false;
 for(let i=0;i<120;i++){if(server.exitCode!==null)throw Error("Owned local server exited");try{if((await fetch(origin+"/login",{signal:AbortSignal.timeout(1000)})).status===200){ready=true;break;}}catch{}await delay(250);}
 assert.ok(ready,"Local production server ready");browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();if(server&&server.exitCode===null){const closed=new Promise(resolve=>server.once("exit",resolve));server.kill();await closed;}if(log!==undefined)fs.closeSync(log);fs.writeFileSync(`${review}/LANDING_BROWSER_RESULTS.json`,JSON.stringify({checkedAt:new Date().toISOString(),origin,scope:"Actual local Next production build with synthetic/unreachable providers; no real accounts or evidence; external browser requests blocked",results:evidence},null,2));});
const luminance=(rgb:number[])=>rgb.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
for(const theme of ["light","dark"] as const)for(const width of [360,390,768,1280,1440]){
 test(`landing features: ${theme} at ${width}px — layout, preview, keyboard and contrast`,async()=>{
  const page=await browser.newPage({viewport:{width,height:1000},colorScheme:theme,reducedMotion:"reduce"});
  try{
   await page.addInitScript(value=>{localStorage.setItem("theme",value);},theme);
   await page.route("**/*",route=>{const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();if(url.pathname.startsWith("/api/"))return route.fulfill({status:401,json:{error:"Unauthenticated local preview"}});return route.continue();});
   await page.goto(origin);await page.locator('[data-product-feature="evidence-review"]').waitFor();await page.locator("#features").scrollIntoViewIfNeeded();
   assert.equal(await page.locator("html").evaluate(el=>el.classList.contains("dark")),theme==="dark");
   const cards=page.locator("#features article[data-product-feature]");assert.equal(await cards.count(),3);
   assert.deepEqual(await cards.locator("h3").allTextContents(),["Smart Quiz Management","AI-Assisted Proctoring","Evidence Review"]);
   assert.doesNotMatch(await page.locator("body").innerText(),/Power Arena|Enter the Arena|Student Arena access/i);
   assert.equal(await page.locator('a[href^="/arena"],a[href*="/playground"]').count(),0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"No document overflow");
   const boxes=await cards.evaluateAll(nodes=>nodes.map(el=>{const b=el.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height};}));
   if(width>=1280){assert.ok(Math.max(...boxes.map(b=>b.y))-Math.min(...boxes.map(b=>b.y))<2,"Three desktop columns");assert.ok(Math.max(...boxes.map(b=>b.height))-Math.min(...boxes.map(b=>b.height))<2,"Equal card heights");}
   else if(width===768){assert.ok(Math.abs(boxes[0].y-boxes[1].y)<2);assert.ok(boxes[2].y>boxes[0].y);assert.ok(Math.abs(boxes[2].x+boxes[2].width/2-width/2)<2,"Centered final tablet card");}
   else{assert.ok(boxes[1].y>boxes[0].y&&boxes[2].y>boxes[1].y,"One mobile column");}
   const textFits=await cards.locator("h3,p,button").evaluateAll(nodes=>nodes.every(el=>el.scrollWidth<=el.clientWidth+2));assert.ok(textFits,"No clipped card text or controls");
   if(width>=768){const tops=await cards.locator('button[aria-haspopup="dialog"]').evaluateAll(nodes=>nodes.map(el=>el.getBoundingClientRect().y));assert.ok(Math.abs(tops[0]-tops[1])<2,"First-row previews align");}
   const minRatios:number[]=[];
   for(let i=0;i<3;i++){
    const card=cards.nth(i);await card.evaluate(el=>el.scrollIntoView({block:"center",inline:"nearest"}));const textColors=await card.locator("h3,p").evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).color));
    await card.locator(":scope > *").evaluateAll(nodes=>nodes.forEach(el=>(el as HTMLElement).style.visibility="hidden"));
    const background=await card.screenshot({animations:"disabled"});await card.locator(":scope > *").evaluateAll(nodes=>nodes.forEach(el=>(el as HTMLElement).style.removeProperty("visibility")));
    const {data,info}=await sharp(background).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const backgrounds=[[.1,.1],[.5,.1],[.9,.1],[.5,.5],[.1,.9],[.9,.9]].map(([x,y])=>{const at=(Math.floor(info.height*y)*info.width+Math.floor(info.width*x))*3;return luminance([...data.subarray(at,at+3)]);});
    for(const color of textColors){const fg=luminance((color.match(/[\d.]+/g)??[]).slice(0,3).map(Number));minRatios.push(Math.min(...backgrounds.map(bg=>(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05))));}
   }
   if(Math.min(...minRatios)<4.5)await page.locator("#features").screenshot({path:`${review}/debug-features-${theme}-${width}.png`,animations:"disabled"}); assert.ok(Math.min(...minRatios)>=4.5,`Sampled card text contrast ${Math.min(...minRatios).toFixed(2)}:1`);
   const preview=page.getByRole("button",{name:"View preview of Evidence Review interface"});await preview.click();
   const dialog=page.getByRole("dialog",{name:"Teacher Evidence Review"});await dialog.waitFor();
   const visibleImage=dialog.locator("img:visible");await visibleImage.evaluate((img:HTMLImageElement)=>img.decode());
   assert.equal(await visibleImage.getAttribute("alt"),"ProctorShieldAI Teacher Evidence Review showing demo incident details, redacted identity, and an opaque media placeholder.");
   const imageUrl=new URL((await visibleImage.getAttribute("src"))!,origin);assert.equal(imageUrl.searchParams.get("url"),`/images/features/evidence-review-${theme}.webp`);
   const original=dialog.getByRole("link",{name:"Open original image"});assert.equal(await original.getAttribute("href"),`/images/features/evidence-review-${theme}.webp`);assert.equal(await original.getAttribute("rel"),"noopener noreferrer");
   const close=dialog.getByRole("button",{name:"Close interface preview"});await close.focus();await page.keyboard.press("Shift+Tab");assert.ok(await original.evaluate(el=>el===document.activeElement));await page.keyboard.press("Tab");assert.ok(await close.evaluate(el=>el===document.activeElement));
   const closeSize=await close.boundingBox();assert.ok(closeSize&&closeSize.width>=44&&closeSize.height>=44);
   await page.screenshot({path:`${review}/preview-${theme}-${width}.png`});await page.keyboard.press("Escape");assert.equal(await dialog.count(),0);assert.ok(await preview.evaluate(el=>el===document.activeElement),"Focus returns to preview button");
   await page.locator("header").evaluateAll(nodes=>nodes.forEach(el=>(el as HTMLElement).style.visibility="hidden"));await page.getByRole("link",{name:"Skip to content",exact:true}).evaluate(el=>(el as HTMLElement).style.visibility="hidden");await page.locator("#features").screenshot({path:`${review}/features-${theme}-${width}.png`,animations:"disabled"});
   evidence.push({theme,width,pass:true,cards:3,minSampledTextContrast:Math.min(...minRatios),keyboardDialogPassed:true});
  }finally{await page.close();}
 });
}
for(const theme of ["light","dark"] as const)test(`landing features: 200% text at 390px in ${theme}`,async()=>{
 const page=await browser.newPage({viewport:{width:390,height:1000},colorScheme:theme,reducedMotion:"reduce"});try{await page.addInitScript(value=>localStorage.setItem("theme",value),theme);await page.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await page.goto(origin);await page.locator('[data-product-feature="evidence-review"]').waitFor();await page.addStyleTag({content:"html{font-size:200%!important}"});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const overflow=await page.locator("#features h3,#features p,#features button").evaluateAll(nodes=>nodes.filter(el=>el.scrollWidth>el.clientWidth+2).length);assert.equal(overflow,0);evidence.push({theme,width:390,textZoom:"200%",pass:true});}finally{await page.close();}
});
test("local production Arena routes remain denied with no-store",async()=>{
 for(const path of ["/arena/77","/dashboard/teacher/playground","/api/arena/77"]){const r=await fetch(origin+path,{redirect:"manual"});assert.equal(r.status,403);assert.equal((await r.json()).code,"FEATURE_DISABLED");assert.match(r.headers.get("cache-control")!,/no-store/);}
 for(const path of ["/api/arena/battle-action","/api/live/battle-action"]){const r=await fetch(origin+path,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});assert.equal(r.status,403);assert.equal((await r.json()).code,"FEATURE_DISABLED");}
 evidence.push({featureDisableHttpChecks:5,pass:true});
});