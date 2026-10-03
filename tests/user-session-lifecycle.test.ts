import assert from "node:assert/strict";
import test from "node:test";
import { loadUserLifecycleModule } from "./helpers/user-lifecycle-module.ts";
const lifecycle=loadUserLifecycleModule({createContext:(value: unknown)=>({value})});

test("User loss is synchronous and sticky; a fresh channel alone permits a new generation",()=>{
  const channel=lifecycle.createUserSessionLifecycle(),work=lifecycle.createUserSessionWork(channel);
  const observed: number[]=[]; channel.subscribe((status: number)=>{work.stop();observed.push(status);});
  work.start();const token=work.capture(),request=work.beginRequest(); channel.reportLoss(401); channel.reportLoss(403);
  assert.deepEqual(observed,[401]); assert.equal(channel.getLoss(),401); assert.equal(work.isCurrent(token),false);
  assert.equal(request.controller.signal.aborted,true); assert.equal(work.beginRequest(),null);
  work.start(); assert.equal(work.beginRequest(),null);
  const fresh=lifecycle.createUserSessionWork(lifecycle.createUserSessionLifecycle()); fresh.start();
  assert.ok(fresh.beginRequest()); fresh.stop();
});

for (const [status,body,expected] of [
  [401,{error:"Unauthorized"},401], [403,{error:"Forbidden"},403],
  [403,{error:"Forbidden origin"},null], [403,{error:"Forbidden",code:"FORBIDDEN_ORIGIN"},null],
  [403,{error:"Pro required",code:"SUBSCRIPTION_REQUIRED"},null], [403,{error:"Not quiz owner"},null],
  [500,{error:"Unauthorized"},null],[503,{},null],
] as const) test(`User loss classification ${status} ${JSON.stringify(body)}`,async()=>{
  const res=new Response(JSON.stringify(body),{status});
  assert.equal(await lifecycle.getUserSessionLoss(res),expected);
  assert.deepEqual(await res.json(),body,"classification does not consume the caller's response body");
});

test("unmount invalidates old work before remount, aborts requests and disposes resources exactly once",()=>{
  const work=lifecycle.createUserSessionWork(lifecycle.createUserSessionLifecycle());work.start();
  const token=work.capture(),request=work.beginRequest(); let disposals=0;
  const dispose=work.addCleanup(()=>disposals++); work.stop(); work.start();
  assert.equal(work.isCurrent(token),false); assert.equal(request.controller.signal.aborted,true);
  dispose(); assert.equal(disposals,1); work.stop();
});
