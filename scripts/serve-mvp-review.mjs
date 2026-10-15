// Local-only review fixture. This is never an application deployment entry point.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import {randomUUID} from "node:crypto";
import {authFixture} from "../tests/helpers/auth-fixture.ts";
import {gradeSubmission,normalizeSubmittedAnswers} from "../src/lib/quiz-submission.ts";
if(process.env.MVP_REVIEW_ONLY!=="true"||process.env.DATABASE_URL||process.env.E2E_DATABASE_URL)throw Error("Review requires explicit synthetic-only mode and no database configuration");
const origin="http://127.0.0.1:3147",sessions=new Map(),entitlements={isSubscribed:true,manualQuizCount:1,manualQuizLimit:100,studentLimitPerQuiz:100};
const quizzes=[{id:99,title:"Local MVP — Biology",description:"Synthetic review quiz. No academic record is created.",duration:10,passingScore:50,shuffleQuestions:false,allowRetake:false,quizMode:"proctored",quizStatus:"active",accessCode:"PS-LOCAL1",teacherId:"teacher",subject:{subjectName:"Biology"},teacher:{fullName:"Synthetic Teacher"},totalQuestions:2,createdAt:new Date().toISOString(),questions:[{id:1,questionText:"Which number is even?",questionType:"multiple_choice",points:1,choices:[{id:11,choiceText:"2",isCorrect:true},{id:12,choiceText:"3",isCorrect:false}]},{id:2,questionText:"Which organ pumps blood?",questionType:"multiple_choice",points:1,choices:[{id:21,choiceText:"Heart",isCorrect:true},{id:22,choiceText:"Lungs",isCorrect:false}]}]}];
const attempts=new Map();
const reply=(res,data,status=200)=>{res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store","X-Local-Review":"synthetic-only"});res.end(JSON.stringify(data));};
function fixture(req,res){const sid=(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("ps_mvp_review="))?.slice(14);if(sid&&sessions.has(sid))return sessions.get(sid);const id=randomUUID(),auth=authFixture();auth.environment.NEXT_PUBLIC_APP_URL=origin;sessions.set(id,auth);res.setHeader("Set-Cookie","ps_mvp_review="+id+"; Path=/; HttpOnly; SameSite=Strict");return auth;}
async function body(req){let s="";for await(const chunk of req){s+=chunk;if(s.length>1000000)throw Error("Body too large");}return s?JSON.parse(s):{};}
const enrollment=(q,a)=>({...a,id:a.id,attemptNumber:1,attemptMode:"proctored",canRequestRetake:false,isCompleted:a.quizStatus==="completed",quiz:{...q,questions:undefined},_count:{violations:0},createdAt:a.createdAt,violations:[]});
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url||"/",origin),p=url.pathname;
 res.setHeader("X-Content-Type-Options","nosniff");res.setHeader("X-Frame-Options","DENY");
 if(p.startsWith("/api/arena")||p.startsWith("/arena/")||p.includes("/playground"))return reply(res,{error:"Power Arena is temporarily disabled",code:"FEATURE_DISABLED"},403);
 const auth=fixture(req,res);
 if(p.startsWith("/api/")){
  if(req.method!=="GET"&&req.headers.origin!==origin)return reply(res,{error:"Forbidden origin"},403);
  if(p.startsWith("/api/auth/")){
   if(p==="/api/auth/session"){
    const r=await auth.load("src/app/api/auth/session/route.ts").GET(new Request(origin+p+url.search));return reply(res,await r.json(),r.status);
   }
   if(["login","register","logout","verify-otp"].includes(p.split("/").pop())){const r=await auth.post(p.slice(5),await body(req));return reply(res,await r.json(),r.status);}
   return reply(res,{error:"Provider workflow is unavailable in this synthetic review"},501);
  }
  const user=await auth.auth.getSession();if(!user)return reply(res,{error:"Unauthorized"},401);
  if(url.searchParams.get("role")&&url.searchParams.get("role")!==user.role)return reply(res,{error:"Authentication changed; sign in again"},401);
  if(p.startsWith("/api/dashboard/admin")&&user.role!=="admin"||p.startsWith("/api/dashboard/teacher")&&user.role!=="teacher"||p.startsWith("/api/dashboard/student")&&user.role!=="student")return reply(res,{error:"Forbidden"},403);
  if(p==="/api/notifications")return reply(res,{success:true,notifications:[]});
  if(p==="/api/billing/status")return reply(res,{...entitlements,planName:"Synthetic review"});
  if(p==="/api/users/me")return reply(res,{success:true,user:{id:user.userId,email:user.email,fullName:user.fullName,role:user.role,profileImage:null}});
  if(p==="/api/dashboard/teacher")return reply(res,{stats:{totalQuizzes:quizzes.length,studentsMonitored:attempts.size,totalViolations:0,flaggedStudents:0},recentVerdicts:[],violationsBreakdown:[]});
  if(p==="/api/dashboard/admin")return reply(res,{stats:{totalUsers:3,totalQuizzes:quizzes.length,totalViolations:0,aiVerdictsToday:0},platformBars:[],activityBars:[],activities:[],users:[...auth.users.values()].map(u=>({id:u.id,name:"Synthetic "+u.id,email:u.email,role:u.id,roleClass:"",plan:"Synthetic",status:"active",statusClass:"",isOnline:false,subscription:"Synthetic review",subClass:"",joined:"Local fixture"}))});
  if(p==="/api/dashboard/student/results")return reply(res,{success:true,results:[...attempts.values()].filter(a=>a.studentId===user.userId&&a.quizStatus==="completed").map(a=>enrollment(quizzes.find(q=>q.id===a.quizId),a))});
  if(p.endsWith("/reports"))return reply(res,{success:true,reports:[],stats:{},quizzes:[]});
  if(p==="/api/dashboard/teacher/evidence"||p.startsWith("/api/evidence")||p.includes("/evidence"))return reply(res,{error:"No media is collected or served by this synthetic review",code:"REVIEW_MEDIA_DISABLED"},403);
  if(p==="/api/live/snapshot")return reply(res,{success:true,snapshots:[],pendingApprovals:[],pendingRetakes:[],students:[]});
  if(p==="/api/quizzes/join"){
   if(user.role!=="student")return reply(res,{error:"Student account required"},403);
   const b=req.method==="GET"?{}:await body(req),code=String(b.accessCode||url.searchParams.get("accessCode")||"").toUpperCase();const q=quizzes.find(q=>q.accessCode===code&&q.quizStatus!=="deleted");if(!q)return reply(res,{error:"Invalid access code. Quiz not found."},404);
   const key=user.userId+":"+q.id;
   if(req.method==="POST"&&!attempts.has(key))attempts.set(key,{id:"review-"+randomUUID(),quizId:q.id,studentId:user.userId,quizStatus:"enrolled",startTime:null,endTime:null,score:null,answers:[],createdAt:new Date().toISOString()});
   return reply(res,{success:true,quiz:{...q,isArena:false,teacher:"Synthetic Teacher",questions:undefined},destination:"/quiz/"+q.id,join:{eligible:true,reviewOnly:false,state:"joinable",message:"Synthetic review quiz"},arenaSession:null});
  }
  if(p==="/api/quizzes"){
   if(req.method==="POST"){
    if(user.role!=="teacher")return reply(res,{error:"Forbidden"},403);const b=await body(req);if(b.quizMode==="arena")return reply(res,{code:"FEATURE_DISABLED"},403);
    const id=Math.max(...quizzes.map(q=>q.id))+1;const q={...quizzes[0],...b,id,teacherId:user.userId,quizStatus:"draft",accessCode:"PS-LOCAL"+id,subject:{subjectName:b.subjectName||"General"},questions:(b.questions||[]).map((x,i)=>({...x,id:id*100+i,choices:(x.choices||[]).map((c,j)=>({...c,id:id*1000+i*10+j}))}))};quizzes.push(q);return reply(res,{success:true,quiz:q});
   }
   const rows=user.role==="student"?[...attempts.values()].filter(a=>a.studentId===user.userId).map(a=>enrollment(quizzes.find(q=>q.id===a.quizId),a)):quizzes.filter(q=>q.quizStatus!=="deleted").map(q=>({...q,questions:undefined,participantCount:[...attempts.values()].filter(a=>a.quizId===q.id).length,participantLimit:100}));return reply(res,{success:true,quizzes:rows,pendingRetakes:[],pendingApprovals:[],entitlements});
  }
  const detail=p.match(/^\/api\/quizzes\/(\d+)(?:\/(privacy|start))?$/);
  if(detail){const q=quizzes.find(q=>q.id===Number(detail[1]));if(!q||q.quizStatus==="deleted")return reply(res,{error:"Not found"},404);let a=attempts.get(user.userId+":"+q.id);if(user.role==="student"&&!a)return reply(res,{error:"Not enrolled"},403);
   if(detail[2]==="privacy")return reply(res,{retentionDays:90,institution:null,contact:null});
   if(detail[2]==="start"){if(user.role!=="teacher")return reply(res,{error:"Forbidden"},403);q.quizStatus="in_progress";return reply(res,{success:true,quiz:q});}
   if(req.method==="PUT"||req.method==="DELETE"){if(user.role!=="teacher")return reply(res,{error:"Forbidden"},403);if(req.method==="DELETE")q.quizStatus="deleted";else Object.assign(q,await body(req));return reply(res,{success:true,quiz:q});}
   return reply(res,{success:true,userId:user.userId,quiz:{...q,questions:undefined},questions:q.questions.map(x=>({...x,choices:x.choices.map(({isCorrect,...c})=>user.role==="teacher"?{...c,isCorrect}:c)})),studentQuizId:a?.id,studentQuizStatus:a?.quizStatus,attemptMode:"proctored",canEnterQuiz:true,startTime:a?.startTime,endTime:a?.endTime,remainingSeconds:q.duration*60,violationCount:0,savedAnswers:a?.answers||[],score:a?.score});
  }
  if(p==="/api/quizzes/session"||p==="/api/quizzes/answer"||p==="/api/quizzes/autosave"||p==="/api/quizzes/submit"){
   if(user.role!=="student")return reply(res,{error:"Forbidden"},403);const b=await body(req),q=quizzes.find(q=>q.id===Number(b.quizId)),a=attempts.get(user.userId+":"+q?.id);if(!q||!a)return reply(res,{error:"Not enrolled"},403);
   if(b.action==="start"){if(q.quizStatus!=="in_progress")return reply(res,{error:"Teacher has not started the quiz"},409);a.quizStatus="in_progress";a.startTime=new Date().toISOString();}
   if(p.endsWith("/answer")){a.answers=normalizeSubmittedAnswers([...a.answers,{questionId:b.questionId,choiceId:b.choiceId}]);}
   if(p.endsWith("/submit")){const answers=normalizeSubmittedAnswers(b.answers||a.answers),graded=gradeSubmission(q.questions,answers);a.score=graded.score;a.quizStatus="completed";a.endTime=new Date().toISOString();return reply(res,{success:true,score:a.score,total:q.totalQuestions,answeredCount:answers.length,totalQuestions:q.totalQuestions,violations:0,integrityInvalidated:false,aiVerdict:"clean",result:{score:a.score,totalQuestions:q.totalQuestions,violations:0,aiVerdict:"clean"}});}
   return reply(res,{success:true,startTime:a.startTime,remainingSeconds:q.duration*60,sessionId:"review-session-"+q.id,monitoringLevel:"reduced",quizStatus:q.quizStatus});
  }
  if(p.startsWith("/api/live/")||p==="/api/pusher/auth")return reply(res,{error:"Media and realtime providers are disabled in this synthetic review"},403);
  return reply(res,{error:"This endpoint has no local review fixture",code:"REVIEW_UNAVAILABLE"},501);
 }
 if(p.startsWith("/dashboard/")||p.startsWith("/quiz/")){const user=await auth.auth.getSession();if(!user){res.writeHead(302,{Location:"/login"});return res.end();}const role=p.startsWith("/quiz/")?"student":p.split("/")[2];if(user.role!==role)return reply(res,{error:"Role access denied in local preview"},403);}
 if(["/bundle.js","/bundle.css","/base.css"].includes(p)){const file=path.join(".tmp-mvp-review",p.slice(1));if(!fs.existsSync(file))return reply(res,{error:"Asset missing"},404);res.setHeader("Content-Type",p.endsWith(".js")?"text/javascript":"text/css");res.end(fs.readFileSync(file));return;}
 if(/^\/(images|videos|fonts|models)\//.test(p)){const file=path.resolve("public","."+p);if(file.startsWith(path.resolve("public")+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader("Content-Type",p.endsWith(".png")?"image/png":p.endsWith(".webp")?"image/webp":p.endsWith(".svg")?"image/svg+xml":p.endsWith(".mp4")?"video/mp4":"application/octet-stream");res.end(fs.readFileSync(file));return;}return reply(res,{error:"Asset not found"},404);}
 res.setHeader("Content-Type","text/html");res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'");
 res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ProctorShieldAI — Local synthetic review</title><link rel="stylesheet" href="/base.css"><link rel="stylesheet" href="/bundle.css"></head><body><aside style="position:relative;z-index:9999;background:#d1fae5;color:#063b2c;padding:10px 16px;font:14px system-ui;border-bottom:2px solid #047857"><strong>LOCAL SYNTHETIC REVIEW</strong> — no database or real records. Camera/audio and providers are simulated. Use only the test accounts: <strong>teacher@example.test</strong>, <strong>student@example.test</strong>, <strong>admin@example.test</strong>. Password for all: <strong>FixturePassword123</strong>. Quiz code: <strong>PS-LOCAL1</strong>. Data resets when this server stops.</aside><div id="root"></div><script src="/bundle.js"></script></body></html>');
 }catch{reply(res,{error:"Local review fixture could not handle the request",code:"REVIEW_FIXTURE_ERROR"},500);}
});
server.listen(3147,"127.0.0.1",()=>console.log("Synthetic local review ready: "+origin+"/login — no database or providers connected"));
