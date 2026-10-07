import assert from "node:assert/strict";
import test from "node:test";
import { arenaFixture } from "./helpers/arena-fixture.ts";
function due(f:any,ids:string[]) {const s=f.read();for(const id of ids)s.pendingAttacks[id].expiresAt=Date.now()-10;f.save(s);}
for(const power of ["blizzard","earthquake","meteor"])test(`armed shield blocks ${power} before point deduction and broadcasts only 0-point blocked outcome`,async()=>{
 const f=arenaFixture();const s=f.read();s.participants.c.score=200;f.save(s);
 assert.equal((await f.attack("c","shield")).status,200);const attack=await f.attack("a",power);due(f,[attack.body.attackId]);
 await f.arena.mutateArena(77,(m:any)=>f.finalization.recoverArenaAttacks(m),f.db);
 const state=f.read();assert.equal(state.participants.c.score,200);assert.equal(state.participants.c.hasShield,false);assert.equal(state.pendingAttacks[attack.body.attackId].status,"deflected");
 assert.equal(f.events.filter((e:any)=>e.event==="arena-attack-hit").length,0);
 const blocked=f.events.find((e:any)=>e.event==="arena-attack-blocked")!;assert.equal(blocked.data.scorePenalty,0);assert.equal(blocked.data.targetCurrentScore,200);
 assert.equal(blocked.data.participants.find((p:any)=>p.studentId==="c").hasShield,false);
});
test("two concurrent valid attacks consume one shield and apply one deduction",async()=>{
 const f=arenaFixture();const s=f.read();s.participants.c.score=200;f.save(s);await f.attack("c","shield");
 const a=await f.attack("a","blizzard"),b=await f.attack("b","earthquake");due(f,[a.body.attackId,b.body.attackId]);
 await f.overlap(()=>f.finalization.resolveArenaAttackDurably(77,a.body.attackId,{},f.db),()=>f.finalization.resolveArenaAttackDurably(77,b.body.attackId,{},f.db));
 const states=Object.values(f.read().pendingAttacks) as any[];assert.equal(states.filter(a=>a.status==="deflected").length,1);assert.equal(states.filter(a=>a.status==="hit").length,1);
 assert.ok([140,160].includes(f.read().participants.c.score));assert.equal(f.events.filter((e:any)=>e.event==="arena-attack-blocked").length,1);
});
test("invalid attacks and no-effect attacks preserve armed shield",async()=>{
 const f=arenaFixture();await f.attack("c","shield");assert.equal((await f.attack("a","blizzard",{targetStudentId:"absent"})).status,400);
 const a=await f.attack("a","blizzard");due(f,[a.body.attackId]);await f.arena.mutateArena(77,(m:any)=>f.finalization.recoverArenaAttacks(m),f.db);
 assert.equal(f.read().participants.c.hasShield,true);assert.equal(f.read().participants.c.score,0);
});
test("unshielded attacks retain existing deduction and score floor",async()=>{
 const f=arenaFixture();const s=f.read();s.participants.c.score=100;f.save(s);const a=await f.attack("a","earthquake");due(f,[a.body.attackId]);
 await f.arena.mutateArena(77,(m:any)=>f.finalization.recoverArenaAttacks(m),f.db);assert.equal(f.read().participants.c.score,40);assert.equal(f.read().pendingAttacks[a.body.attackId].status,"hit");
});
