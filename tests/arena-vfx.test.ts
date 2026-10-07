import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const content = fs.readFileSync("src/app/arena/[id]/content.tsx","utf8");
test("Bug 12B: Arena mounts a dedicated non-blocking effect instead of shaking the quiz layout",()=>{
  assert.match(content, /<ArenaEffects/);
  assert.doesNotMatch(content,/animate-\[earthquake-rumble|meteor-fall 1\.5s infinite/);
});
test("Bug 12B: launch success feedback follows server acceptance",()=>{
  const start=content.indexOf("const executeBattlePower =");const end=content.indexOf("// ── Defend Incoming Attack",start);const action=content.slice(start,end);
  assert.ok(action.indexOf('setCelebrationMessage("🛡️ GUARDIAN SHIELD ARMED!')>action.indexOf('applyGameplayState(data)'));
  assert.ok(action.indexOf('setCelebrationMessage("🛡️ GUARDIAN SHIELD ARMED!')>action.indexOf('if (!ok) {'));
});

import vm from "node:vm";
import ts from "typescript";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
const css=fs.readFileSync("src/components/arena/arena-effects.module.css","utf8");
const overlaySource=fs.readFileSync("src/components/arena/arena-effects.tsx","utf8");
function loadEffects() {
  const exports: { ArenaEffects?: React.ComponentType<any> }={};
  vm.runInNewContext(ts.transpileModule(overlaySource,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports,require:(name:string)=>name==="./arena-effects.module.css"?{__esModule:true,default:new Proxy({}, {get:(_,key)=>String(key)})}:name==="react"?React:name==="react/jsx-runtime"?jsxRuntime:undefined});
  return exports.ArenaEffects!;
}
function renderEffect(type: string | null, shieldArmed=false, blockedPower="meteor") {
  return renderToStaticMarkup(React.createElement(loadEffects(),{effect:type?{type,blockedPower}:null,shieldArmed}));
}
test("VFX renders distinct SVG meteor, icy shards, cracks and consumed shield collision",()=>{
  const meteor=renderEffect("meteor"); assert.match(meteor,/meteorFlight/);assert.match(meteor,/flameTrail/);assert.match(meteor,/<path/);assert.doesNotMatch(meteor,/☄️/);
  assert.match(renderEffect("blizzard"),/frost/);assert.match(renderEffect("blizzard"),/iceBurst/);assert.match(renderEffect("earthquake"),/cracks/);
  for(const power of ["meteor","blizzard","earthquake"]){const blocked=renderEffect("deflected",false,power);assert.match(blocked,/BLOCKED · 0 PTS LOST/);assert.match(blocked,/consumed/);assert.match(blocked,new RegExp(power));}
});
test("armed shield decoration persists only for committed shield state and all effect content is noninteractive",()=>{
  assert.equal(renderEffect(null),"");const armed=renderEffect(null,true);assert.match(armed,/armed/);assert.doesNotMatch(armed,/particles|BLOCKED/);
  for(const type of ["meteor","blizzard","earthquake","deflected"]){const html=renderEffect(type);assert.match(html,/aria-hidden="true"/);assert.match(html,/pointer-events-none/);assert.doesNotMatch(html,/<button|<input|<a /);assert.equal((html.match(/class="particle"/g)??[]).length,28);}
  assert.match(css,/\.layer \* \{ pointer-events: none/);
});
test("VFX has bounded duration, reduced motion, and lower mobile particle density without gameplay dependencies",()=>{
  assert.match(css,/3\.8s/);assert.match(content,/setActiveAttackEffect\(null\)[\s\S]*?4000/);
  assert.match(css,/prefers-reduced-motion: reduce/);assert.match(css,/animation: none !important/);
  assert.match(css,/particle:nth-child\(n\+13\).*display: none/);
  assert.doesNotMatch(overlaySource,/fetch\(|setTimeout|setInterval|requestAnimationFrame|setScore|setUsedPowers|setTime|rankings|playSound/);
});
test("pending or rejected power requests never announce success; accepted response triggers feedback once",async()=>{
  const ast=ts.createSourceFile("content.tsx",content,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let declaration="";
  const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==="executeBattlePower")declaration=n.getText(ast);ts.forEachChild(n,visit);};visit(ast);
  for(const ok of [false,true]){
    let resolve!:(value:unknown)=>void;const response=new Promise(r=>resolve=r);const celebrations:unknown[]=[], logs:unknown[]=[], snapshots:unknown[]=[];
    const context={captureGameplayAction:()=>({isSameView:()=>true,isCurrent:()=>true}),usedPowers:{},rivals:[],soundEnabled:false,questions:[{id:1}],currentQuestionIndex:0,quizId:1,currentSessionId:"s",setErrorMessage(){},setTargetPickerPower(){},setIsLaunchingPower(){},setCelebrationMessage:(value:unknown)=>celebrations.push(value),setBattleLogs:(value:unknown)=>logs.push(value),readGameplayResponse:()=>response,applyGameplayState:(value:unknown)=>snapshots.push(value),refreshArenaState(){},scheduleGameplayCallback(){}};
    const execute=vm.runInNewContext(ts.transpile("const "+declaration+"; executeBattlePower;"),context);
    const request=execute("shield");assert.equal(celebrations.length,0);assert.equal(logs.length,0);
    resolve({ok,data:{arenaRevision:1,error:ok?undefined:"rejected"}});await request;
    assert.equal(snapshots.length,1);assert.equal(logs.length,ok?1:0);
    assert.equal(celebrations.some(value=>typeof value==="string"&&value.includes("ARMED")),ok);
  }
});
