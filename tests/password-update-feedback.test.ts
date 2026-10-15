import assert from "node:assert/strict";
import test from "node:test";
import { updateAccountPassword } from "../src/lib/password-update.ts";

const values={currentPassword:"FixtureOld123",newPassword:"FixtureNew123",confirmPassword:"FixtureNew123"};
for(const role of ["teacher","student"] as const) {
  test(`${role} password update confirms success and uses scoped existing profile endpoint`,async()=>{
    const result=await updateAccountPassword(role,values,async(input,init)=>{assert.equal(input,`/api/auth/profile?scope=user&role=${role}`);assert.deepEqual(JSON.parse(String(init?.body)),{currentPassword:values.currentPassword,newPassword:values.newPassword});return Response.json({success:true});});
    assert.equal(result.type,"success");assert.match(result.text,/successfully/);assert.ok(!result.text.includes(values.newPassword));
  });
  test(`${role} password update covers incorrect current password, server, network and session failures`,async()=>{
    for(const [status,body,text] of [[400,{message:"Current password is incorrect."},/incorrect/],[500,{message:values.newPassword},/Could not update/],[401,{error:"Authentication changed"},/sign in again/]] as const) {
      const result=await updateAccountPassword(role,values,async()=>Response.json(body,{status}));assert.equal(result.type,"error");assert.match(result.text,text);assert.ok(!result.text.includes(values.newPassword));
    }
    const result=await updateAccountPassword(role,values,async()=>{throw Error(values.newPassword);});assert.match(result.text,/Network error/);
  });
  test(`${role} password validation blocks invalid, missing, mismatched and overlong values before request`,async()=>{
    for(const input of [{...values,currentPassword:""},{...values,newPassword:"short",confirmPassword:"short"},{...values,confirmPassword:"mismatch"},{...values,newPassword:"a1".repeat(65),confirmPassword:"a1".repeat(65)}]) {
      const result=await updateAccountPassword(role,input,async()=>{assert.fail("Invalid values must not reach server");});assert.equal(result.type,"error");
    }
  });
}
