import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import fs from "node:fs";
import type { BrowserContext } from "@playwright/test";
import { authFixture } from "./helpers/auth-fixture.ts";
import { loginSyntheticAccount, type TestRole } from "../e2e/helpers/login.ts";
import { hashPassword } from "../src/lib/password-hash.ts";

const origin="https://localhost:3443", password="SyntheticFixturePassword123";
async function fixture(role: TestRole="student") {
  const f=authFixture(); f.environment.NEXT_PUBLIC_APP_URL=origin; f.environment.NODE_ENV="production";
  const id=crypto.randomUUID(), old=f.users.get(role)!;
  f.users.delete(role);
  const account={...old,id,email:`psai-e2e-${id}@example.invalid`,password:await hashPassword(password),sessionVersion:7};
  f.users.set(id,account);
  const calls:string[]=[];
  const wrap=(response:Response)=>({status:()=>response.status,json:()=>response.json()});
  const context={
    request:{
      post:async (url:string,options:{data:unknown;headers:{Origin:string}})=>{
        calls.push(url); assert.equal(url,origin+"/api/auth/login"); assert.equal(options.headers.Origin,origin);
        const result=await f.deferredPost("auth/login",options.data,options.headers.Origin); result.apply(); return wrap(result.response);
      },
      get:async (url:string)=>{
        calls.push(url); return wrap(await f.load("src/app/api/auth/session/route.ts").GET(new Request(url)));
      },
    },
    cookies:async()=>[...f.allCookies()].map(([name,value])=>{
      const options=(name==="ps_browser_auth"?f.browserCookieOptions:f.cookieOptions).get(name)!;
      return {name,value,httpOnly:options.httpOnly,secure:options.secure,path:options.path,sameSite:"Lax"};
    }),
  };
  return {f,calls,context,account:{id,email:account.email,fullName:account.fullName,password,sessionVersion:7}};
}
for(const role of ["student","teacher","admin"] as const) test(`${role}: real login/session code creates browser-bound cookies using mocked persistence/Redis`,async()=>{
  const {f,calls,context,account}=await fixture(role);
  await loginSyntheticAccount(context as unknown as BrowserContext,account,role,origin);
  assert.equal(calls.filter(url=>url.endsWith("/login")).length,2);
  const session=f.auth.verifyToken(f.cookies.get(role==="admin"?"ps_session_admin":"ps_session_user"));
  assert.equal(session.sessionVersion,7); assert.equal(session.browserId,f.browserCookies.get("ps_browser_auth"));
  assert.equal(await f.auth.getScopedSession(new Request(origin+"/api/auth/session?scope="+(role==="admin"?"user":"admin"))),null);
});
test("missing browser cookie cannot be concealed by a fixture token",async()=>{
  const {context,account}=await fixture(); context.cookies=async()=>[];
  await assert.rejects(loginSyntheticAccount(context as unknown as BrowserContext,account,"student",origin),/browser-bound/);
});
test("stale Redis generation is rejected by the actual session reader after login",async()=>{
  const {f,context,account}=await fixture(); const get=context.request.get;
  context.request.get=async url=>{
    const key="proctorshield:browser-auth:"+f.browserCookies.get("ps_browser_auth")!;
    const deadline=f.generations.values.get(key)!.split("|")[1];
    f.generations.values.set(key,crypto.randomUUID()+"|"+deadline);
    return get(url);
  };
  await assert.rejects(loginSyntheticAccount(context as unknown as BrowserContext,account,"student",origin),/Server rejected/);
});
test("stored sessionVersion revocation is not mocked away by E2E login",async()=>{
  const {f,context,account}=await fixture(); const get=context.request.get;
  context.request.get=async url=>{f.users.get(account.id)!.sessionVersion++;return get(url);};
  await assert.rejects(loginSyntheticAccount(context as unknown as BrowserContext,account,"student",origin),/Server rejected/);
});
test("wrong credentials do not mint fixture sessions or retry ordinary failures",async()=>{
  const {f,context,account,calls}=await fixture(); account.password="WrongSynthetic123";
  await assert.rejects(loginSyntheticAccount(context as unknown as BrowserContext,account,"student",origin),/Synthetic login failed/);
  assert.equal(calls.length,2); assert.equal(f.cookies.size,0);
});
test("remote origins and non-owned identities fail before any request",async()=>{
  const {context,account,calls}=await fixture();
  await assert.rejects(loginSyntheticAccount(context as unknown as BrowserContext,account,"student","https://staging.invalid:3443"));
  await assert.rejects(loginSyntheticAccount(context as unknown as BrowserContext,{...account,email:"someone@example.invalid"},"student",origin));
  assert.equal(calls.length,0);
});
test("both authenticated workflows use the common actual-login helper and never mint JWTs",()=>{
  for(const name of ["e2e/helpers/auth.ts","e2e/quiz-deletion-arena-sequence.spec.ts"]) {
    const source=fs.readFileSync(name,"utf8"); assert.doesNotMatch(source,/jwt\.sign|addCookies\(|unused-e2e-password|findExistingUser/);
    assert.match(source,/loginSyntheticAccount\(/);
  }
  const source=fs.readFileSync("e2e/helpers/auth.ts","utf8");
  assert.match(source,/await hashPassword\(password\)/); assert.match(source,/INSERT INTO users/);
  assert.doesNotMatch(source,/UPDATE users|DELETE FROM|ORDER BY u.created_at/);
});
