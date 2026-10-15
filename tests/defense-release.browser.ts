import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser } from "playwright";
import { teacherThemeFixture } from "./helpers/teacher-theme-fixture.ts";
import { studentThemeFixture } from "./helpers/student-theme-fixture.ts";
import { sidebarFixture } from "./helpers/sidebar-theme-fixture.ts";

let browser: Browser, css: string;
const evidence=path.resolve(process.env.DEFENSE_BROWSER_EVIDENCE_DIR || "docs/DEFENSE_RELEASE_2026-10-15/evidence/browser");
before(async()=>{
 delete process.env.POWER_ARENA_ENABLED;
 css=(await postcss([tailwind({base:process.cwd()})]).process(fs.readFileSync("src/app/globals.css","utf8").replace(/^@import url\(.*?\);\s*/m,""),{from:"src/app/globals.css"})).css;
 css += fs.readFileSync("src/app/dashboard/teacher/teacher-theme.css","utf8")+fs.readFileSync("src/app/dashboard/teacher/teacher-glass.css","utf8")+fs.readFileSync("src/app/dashboard/student/student.css","utf8")+fs.readFileSync("src/app/dashboard/student/student-glass.css","utf8");
 fs.mkdirSync(evidence,{recursive:true});browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();});
for(const width of [360,390,768,1280,1440])for(const theme of ["light","dark"] as const)for(const scene of ["teacher-dashboard","teacher-quizzes","teacher-editor","teacher-settings","teacher-manage","teacher-upgrade","teacher-billing","student-dashboard","student-quizzes","student-results","student-settings"] as const) {
 test(`${scene}: Arena hidden and controls fit at ${width}px in ${theme} mode`,async()=>{
  const role=scene.startsWith("teacher")?"teacher":"student";
  const shell=sidebarFixture(role,{storage:new Map([["theme",theme]])});await shell.mount();
  const content=role==="teacher"?teacherThemeFixture(scene==="teacher-dashboard"?"dashboard":scene==="teacher-billing"?"billing":"quizzes",scene==="teacher-editor"?"defense-editor":scene==="teacher-settings"?"defense-settings":scene==="teacher-manage"?"defense-manage":scene==="teacher-upgrade"?"defense-upgrade":"defense"):studentThemeFixture(scene==="student-dashboard"?"dashboard":scene==="student-quizzes"?"quizzes":scene==="student-settings"?"settings":"results","defense");
  const page=await browser.newPage({viewport:{width,height:960},reducedMotion:"reduce"});
  try {
   await page.route("**/*",r=>r.abort());
   const body=typeof content==="string"?content:content.content;
   const portals=typeof content==="string"?"":content.portals;
   await page.setContent(`<!doctype html><html class="${theme==="dark"?"dark":""}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${shell.html().replace("<p >Dashboard content retained</p>",body)}${portals}</body></html>`);
   assert.equal(await page.locator('a[href*="/arena/"],a[href*="/playground"]').count(),0);
   assert.equal(await page.getByText("Power Arena",{exact:true}).count(),0);
   assert.equal(await page.getByText("Battle Power Arena Mode",{exact:true}).count(),0);
   assert.doesNotMatch(await page.locator("body").innerText(),/\barena\b|battle powers|match listings/i);
   assert.equal(await page.locator('a[href="#"],a[href=""]').count(),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   const clipped=await page.evaluate(()=>Array.from(document.querySelectorAll<HTMLElement>(".teacher-content button,.teacher-content input,.teacher-content select,.ps-student-page button,.ps-student-page input,.ps-student-page select")).filter(node=>!node.closest(".overflow-x-auto,.overflow-auto")&&node.getBoundingClientRect().width>0).filter(node=>{const box=node.getBoundingClientRect();return box.left< -1||box.right>innerWidth+1;}).map(node=>node.textContent||node.id));
   assert.deepEqual(clipped,[]);
   const contrast=await page.locator(role==="teacher"?".teacher-content":".ps-student-page").first().evaluate(node=>{
    const canvas=document.createElement("canvas");canvas.width=canvas.height=1;const context=canvas.getContext("2d")!;
    const luminance=(color:string)=>{context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);const c=Array.from(context.getImageData(0,0,1,1).data).slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c.reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);};
    const style=getComputedStyle(node),fg=luminance(style.getPropertyValue("--ink")),bg=luminance(style.getPropertyValue("--surface"));return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
   });
   assert.ok(contrast>=4.5,`primary text contrast ${contrast}`);
   if(scene==="teacher-dashboard" || scene==="teacher-quizzes") {
    const cards=page.getByText("Live Monitored Exam",{exact:true}).first().locator("xpath=ancestor::button[1]/..");
    const sizes=await cards.locator(":scope > button").evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().width));
    assert.equal(sizes.length,2,"two remaining creation cards, no empty Arena slot");
    assert.ok(Math.abs(sizes[0]-sizes[1])<2);
   }
   if(scene==="teacher-quizzes") {
    assert.equal(await page.locator(".ps-teacher-quiz-table").count(),1);
    for(const text of ["Live Monitored Exam","IN_PROGRESS","Monitor Exam","Edit","Manage"]) assert.ok(await page.getByText(text,{exact:true}).count());
    assert.equal(await page.locator(".ps-teacher-quiz-table th").first().evaluate(n=>getComputedStyle(n).whiteSpace),"nowrap");
   }
   await page.screenshot({path:path.join(evidence,`${scene}-${theme}-${width}.png`),fullPage:true});
   if(scene==="teacher-settings" && width===1280 && theme==="light") {
    await page.getByText("Quiz Settings",{exact:true}).locator("..").locator("..").screenshot({path:path.join(evidence,"quiz-settings-manual.png")});
   }
  }finally{await page.close();}
 });
}
