import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { fixture,gateFixture,objectFixture } from './fixtures.mjs';
import { loadOperation,canonical } from '../lib/security.mjs';
import { child,deadline } from '../lib/process.mjs';
import { pause,release } from '../lib/gate.mjs';
import { runBackup } from '../backup-once.mjs';
import { runRecover } from '../recover-once.mjs';

if(process.env.PSAI_DISPOSABLE_POSTGRES_APPROVED!=='true')throw new Error('Disposable cloud PostgreSQL approval flag required; no connection attempted');
if(process.platform!=='linux')throw new Error('Cloud Linux execution required');
const targets=['synthetic-source','synthetic-recovery'];
async function relay(t,host){
  assert.ok(targets.includes(host));
  const sockets=new Set();
  const server=net.createServer(a=>{
    const b=net.connect(5432,host);sockets.add(a);sockets.add(b);
    a.pipe(b);b.pipe(a);
    for(const s of [a,b]){s.on('error',()=>{a.destroy();b.destroy();});s.on('close',()=>sockets.delete(s));}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{for(const s of sockets)s.destroy();server.close(r);}));
  return server.address().port;
}
async function sql(port,password,database,sqlText){
  const c=child('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-c',sqlText],{env:{PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'synthetic',PGPASSWORD:password,PGDATABASE:database,PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'5'}});
  c.stdout.resume();await c.done;
}
async function setup(t){
  const cleaners=[],scope={after(fn){cleaners.push(fn);}};let c,g;
  t.after(async()=>{
    let failure;
    try{if(c&&g.state.paused&&g.state.operationId===c.op.operationId)await release(c);}catch(e){failure=e;}
    for(const fn of cleaners.reverse()){try{await fn();}catch(e){failure??=e;}}
    if(failure)throw failure;
  });
  g=await gateFixture(scope);const source=await objectFixture(scope),dest=await objectFixture(scope),restored=await objectFixture(scope);
  const sourcePort=await relay(scope,'synthetic-source'),recoveryPort=await relay(scope,'synthetic-recovery');
  const id=crypto.randomUUID().replaceAll('-','');
  const sourceName='psai_source_'+id,recoveryName='psai_recovery_'+id;
  await sql(sourcePort,'synthetic-database-password','postgres','CREATE DATABASE "'+sourceName+'";');
  await sql(recoveryPort,'synthetic-recovery-password','postgres','CREATE DATABASE "'+recoveryName+'";');
  await sql(sourcePort,'synthetic-database-password',sourceName,
    "CREATE TABLE evidence_files(file_path text PRIMARY KEY,deletion_requested_at timestamptz,deleted_at timestamptz);"+
    "CREATE TABLE _prisma_migrations(migration_name text PRIMARY KEY,finished_at timestamptz,rolled_back_at timestamptz);"+
    "CREATE TABLE synthetic_records(id bigserial PRIMARY KEY,label text NOT NULL,file_path text REFERENCES evidence_files(file_path));"+
    "CREATE INDEX synthetic_label_idx ON synthetic_records(label);"+
    "INSERT INTO evidence_files VALUES ('evidence/synthetic.png',NULL,NULL);"+
    "INSERT INTO _prisma_migrations VALUES ('synthetic_001','2026-01-01T00:00:00Z',NULL);"+
    "INSERT INTO synthetic_records(label,file_path) VALUES ('Synthetic unicode: Cebu ✓','evidence/synthetic.png'),('Synthetic second row',NULL);");
  const f=await fixture(scope,{
    source:{endpoint:source.endpoint,bucket:'source-synthetic'},destination:{endpoint:dest.endpoint,bucket:'backup-synthetic',prefix:'proctorshieldai'},
    gate:{endpoint:g.endpoint,contract:'owned-lease-v1'},maxRuntimeMs:30000,
    database:{host:'127.0.0.1',port:sourcePort,name:sourceName,role:'synthetic',serverMajor:18,tables:['_prisma_migrations','evidence_files','synthetic_records'],migrations:['synthetic_001']},
    recovery:{host:'127.0.0.1',port:recoveryPort,name:recoveryName,role:'synthetic'},
    recoveryStore:{endpoint:restored.endpoint,bucket:'recovery-synthetic'}});
  source.seed('source-synthetic','evidence/synthetic.png',Buffer.from('SYNTHETIC_IMAGE_BYTES'),'image/png');
  source.seed('source-synthetic','evidence/unreferenced.webm',Buffer.from('SYNTHETIC_MEDIA_BYTES'),'video/webm');
  c=await loadOperation(f.paths,'gate');await pause(c);
  return {f,g,source,dest,restored,sourcePort,recoveryPort,sourceName,recoveryName,c};
}
test('actual PostgreSQL 18 custom dump, encrypted evidence, separate empty-db restore, schema/rows/HMAC/media integrity',async t=>{
  const x=await setup(t),result=await runBackup(x.f.paths);
  assert.equal(result.completion.evidenceCount,2);assert.equal(x.g.state.paused,true);
  assert.ok(![...x.dest.objects.keys()].some(k=>k.endsWith('/latest.json')));
  assert.equal(x.dest.calls.filter(x=>x.method==='DELETE').length,0);
  await release(x.c);
  const recovery=await fixture(t,{...x.f.op,operationId:'psai-recovery-'+crypto.randomUUID(),restoreManifestHash:result.completion.manifestCipherSha256});
  // Independent recovery approval has a new operation identity, same selected immutable set.
  for(const name of ['encryption-key','audit-key'])await fs.copyFile(path.join(x.f.paths.secrets,name),path.join(recovery.paths.secrets,name));
  const receipt=path.join(recovery.root,'receipt.json');await fs.writeFile(receipt,canonical(result.completion));
  const recovered=await runRecover({...recovery.paths,receipt});
  assert.equal(recovered.manifest.evidence.length,2);
  assert.equal(x.restored.objects.size,2);
  for(const [k,v] of x.source.objects){
    const mapped=x.restored.objects.get(k.replace('source-synthetic/','recovery-synthetic/'));
    assert.deepEqual(mapped.bytes,v.bytes);assert.equal(mapped.contentType,v.contentType);
  }
  await assert.rejects(runBackup(x.f.paths),{code:'EEXIST'});
  await assert.rejects(runRecover({...recovery.paths,receipt}),{code:'EEXIST'});
});
test('actual backup refuses unpaused gate before database work',async t=>{
  const x=await setup(t);await release(x.c);
  await assert.rejects(runBackup(x.f.paths),/GATE_NOT_OWNED/);
  assert.equal(x.dest.objects.size,0);
});
test('actual backup rejects missing required evidence without marker',async t=>{
  const x=await setup(t);x.source.objects.clear();
  await assert.rejects(runBackup(x.f.paths),/ACTIVE_EVIDENCE_MISSING/);
  assert.equal(x.dest.objects.size,0);
});
test('actual backup preserves partial encrypted set on storage failure, never publishes completion',async t=>{
  const x=await setup(t);x.dest.failPut('manifest.bin');
  await assert.rejects(runBackup(x.f.paths));
  assert.ok(x.dest.objects.size>0);
  assert.ok(![...x.dest.objects.keys()].some(k=>k.endsWith('completion.json')));
  assert.equal(x.dest.calls.filter(x=>x.method==='DELETE').length,0);
});
test('actual publication failure reports possible marker presence and retains all objects',async t=>{
  const x=await setup(t);x.dest.failRead('completion.json');
  await assert.rejects(runBackup(x.f.paths));
  assert.ok([...x.dest.objects.keys()].some(k=>k.endsWith('/completion.json')));
  const events=await fs.readFile(path.join(x.f.paths.work,'ledger',x.f.op.operationId+'-backup.json.events'),'utf8');
  assert.match(events,/publicationMayHaveOccurred/);
  assert.equal(x.dest.calls.filter(x=>x.method==='DELETE').length,0);
});
test('actual recovery rejects nonempty isolated target before archive download/restore',async t=>{
  const x=await setup(t),result=await runBackup(x.f.paths);
  await sql(x.recoveryPort,'synthetic-recovery-password',x.recoveryName,'CREATE TABLE do_not_overwrite(id int);');
  const r=await fixture(t,{...x.f.op,operationId:'psai-recovery-'+crypto.randomUUID(),restoreManifestHash:result.completion.manifestCipherSha256});
  const receipt=path.join(r.root,'receipt.json');await fs.writeFile(receipt,canonical(result.completion));
  const calls=x.dest.calls.length;
  await assert.rejects(runRecover({...r.paths,receipt}),/RECOVERY_NOT_EMPTY/);
  assert.equal(x.dest.calls.length,calls);
});
