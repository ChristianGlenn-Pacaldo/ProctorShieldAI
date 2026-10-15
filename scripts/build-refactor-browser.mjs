import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const root=process.cwd(),temp=path.join(root,".tmp-refactor-browser");
fs.mkdirSync(temp,{recursive:true});
const baseline=execFileSync("git",["show","d61e2ec46d9bc97bd5a458e3f5f952e1bc34aec3:src/app/dashboard/teacher/quizzes/content.tsx"],{encoding:"utf8"});
fs.writeFileSync(path.join(temp,"baseline.tsx"),baseline);
fs.writeFileSync(path.join(temp,"entry.tsx"),[
 'import React from "react";import{createRoot}from"react-dom/client";',
 'import Current from "../src/app/dashboard/teacher/quizzes/content";import Baseline from "./baseline";',
 'document.documentElement.classList.toggle("dark",new URLSearchParams(location.search).get("theme")==="dark");',
 'const Screen=new URLSearchParams(location.search).get("view")==="baseline"?Baseline:Current;',
 'createRoot(document.getElementById("root")!).render(<div data-portal="teacher" className="ps-teacher-glass-shell"><div className="teacher-content ps-teacher-page"><Screen isSubscribed={true} teacherName="Synthetic Teacher"/></div></div>);',
].join("\n"));
const fixtures={
 "next/navigation":'const router={push:url=>{window.__lastNavigation=url}};export const useRouter=()=>router;',
 "next/link":'import React from "react";export default function Link({prefetch,...props}){return React.createElement("a",props)}',
};
await build({entryPoints:[path.join(temp,"entry.tsx")],outfile:path.join(temp,"bundle.js"),bundle:true,platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"local-router",setup(b){b.onResolve({filter:/^next\/(navigation|link)$/},a=>({path:a.path,namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:fixtures[a.path],loader:"js",resolveDir:root}));}}]});
const css=(await postcss([tailwind({base:root})]).process(fs.readFileSync("src/app/globals.css","utf8").replace(/^@import url\(.*?\);\s*/m,""),{from:"src/app/globals.css"})).css;
fs.writeFileSync(path.join(temp,"base.css"),css+"\n"+["src/app/dashboard/teacher/teacher-theme.css","src/app/dashboard/teacher/teacher-glass.css"].map(p=>fs.readFileSync(p,"utf8")).join("\n"));
console.log("Built current and exact v3 baseline components with synthetic local router/data boundaries.");
