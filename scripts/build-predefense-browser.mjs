import fs from "node:fs";import path from "node:path";import {build} from "esbuild";import postcss from "postcss";import tailwind from "@tailwindcss/postcss";
// Build only synthetic local UI fixtures; no application runtime or provider config is changed.
for (const dir of ["release-review/final-predefense-2026-10-15", "release-review/landing-evidence-2026-10-15"]) fs.mkdirSync(dir, {recursive:true});
const root=process.cwd(),temp=path.join(root,".tmp-predefense-browser");fs.mkdirSync(temp,{recursive:true});
fs.writeFileSync(path.join(temp,"entry.tsx"),[
'import React from "react";import{createRoot}from"react-dom/client";',
'import StudentLogin from "../src/app/login/student/page";import Quiz from "../src/app/quiz/[id]/page";import Join from "../src/app/join/page";import Login from "../src/app/login/content";import Landing from "../src/app/page";',
'const p=location.pathname;document.documentElement.classList.toggle("dark",localStorage.getItem("theme")==="dark");',
'createRoot(document.getElementById("root")!).render(p.startsWith("/quiz/")?<div className="ps-assessment-theme ps-assessment-route ps-exam-theme"><Quiz/></div>:p==="/join"?<div className="ps-auth"><Join/></div>:p==="/login/student"?<div className="ps-auth ps-auth-glass"><StudentLogin/></div>:p==="/login"?<div className="ps-auth ps-auth-glass"><Login joinCode={new URLSearchParams(location.search).get("joinCode")||undefined}/></div>:<Landing/>);'
].join("\n"));
const fixtures={
"next/navigation":'const router={push:url=>location.assign(url),replace:url=>location.replace(url)};export const useRouter=()=>router;export const useParams=()=>({id:"99"});export const useSearchParams=()=>new URLSearchParams(location.search);',
"next/link":'import React from "react";export default function Link({prefetch,...props}){return React.createElement("a",props)}',
"next/image":'import React from "react";export default function Image({priority,preload,fill,sizes,quality,...props}){return React.createElement("img",props)}',
"pusher-js":'export default class Pusher{connection={bind(){},unbind(){}};subscribe(){return{bind(){},unbind(){},unbind_all(){}}}unsubscribe(){}disconnect(){}}',
"@react-oauth/google":'import React,{useEffect}from"react";export function GoogleOAuthProvider({children,onScriptLoadSuccess}){useEffect(()=>{onScriptLoadSuccess?.()},[]);return children}export function GoogleLogin({onSuccess}){return React.createElement("button",{type:"button",onClick:()=>onSuccess({credential:"synthetic-google-credential"})},"Synthetic Google sign-in")}',
"@tensorflow-models/coco-ssd":'export async function load(){return{detect:async()=>[]}}',
"@vladmandic/face-api/dist/face-api.esm-nobundle.js":'export const tf={enableProdMode(){},ready:async()=>{}};const net={loadFromUri:async()=>{}};export const nets={tinyFaceDetector:net,faceLandmark68Net:net,faceLandmark68TinyNet:net,ssdMobilenetv1:net};export class TinyFaceDetectorOptions{}export class SsdMobilenetv1Options{}export function detectAllFaces(){const p=Promise.resolve([]);p.withFaceLandmarks=()=>p;return p;}',
};
await build({entryPoints:[path.join(temp,"entry.tsx")],outfile:path.join(temp,"bundle.js"),bundle:true,platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"',"process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID":'"synthetic-google-client"'},plugins:[{name:"owned-ui-fixtures",setup(b){b.onResolve({filter:/^(next\/(?:navigation|link|image)|pusher-js|@react-oauth\/google|@tensorflow-models\/coco-ssd|@vladmandic\/face-api\/dist\/face-api.esm-nobundle.js)$/},args=>({path:args.path,namespace:"fixture"}));b.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:fixtures[args.path],loader:"js",resolveDir:root}));}}]});
const css=(await postcss([tailwind({base:root})]).process(fs.readFileSync("src/app/globals.css","utf8").replace(/^@import url\(.*?\);\s*/m,""),{from:"src/app/globals.css"})).css+"\n"+["src/styles/assessment-theme.css","src/app/login/auth.css","src/app/login/auth-glass.css"].map(p=>fs.readFileSync(p,"utf8")).join("\n");
fs.writeFileSync(path.join(temp,"base.css"),css);
console.log("Source-backed UI harness built; router/provider/model boundaries are synthetic. No AI accuracy or authenticated staging claim.");

