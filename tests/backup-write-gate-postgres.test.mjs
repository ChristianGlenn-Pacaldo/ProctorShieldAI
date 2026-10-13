// Synthetic PostgreSQL 18 ONLY. Preparation does not authorize executing this file.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import ts from 'typescript';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertIsolatedNetwork,assertNoTestEnvFiles } from './helpers/isolated-test-environment.ts';
import { fixture,sign } from '../tooling/recovery-v1/tests/fixtures.mjs';
import * as security from '../tooling/recovery-v1/lib/security.mjs';
import * as gates from '../tooling/recovery-v1/lib/gate.mjs';
import * as processTools from '../tooling/recovery-v1/lib/process.mjs';

const require=createRequire(import.meta.url),root='/opt/owned-gate';
const codes=['CONCURRENT_ACQUIRE','SAME_OWNER_ACQUIRE','RELEASE_IDENTITY_CAS','WRONG_RELEASE_PROOF','REPLAY_NEW_LEASE','CONCURRENT_RELEASE',
  'ADMITTED_MUTATION_DRAIN','PAUSE_WINS_ADMISSION','ADMISSION_PAUSE_RACE','DEFERRED_MUTATION_DRAIN','TRANSACTION_ROLLBACK',
  'BACKEND_DISCONNECT_ROLLBACK','LOCK_CONTENTION_FAIL_CLOSED','RESTART_PERSISTENCE','STALE_MARKER_RETAINED',
  'ROUTE_TOOLING_CONTRACT','LEGACY_AUTH_REJECTION','EXPORTER_STILL_RUNNING','SUPERVISOR_INTERRUPTED','UNREACHABLE_GATE'];
const outcomes=[],cleaners=[];let identityVerified=false,conn,admin,schema,one,two,gateOne,gateTwo;
const activePrefix='backup_write_gate:active:';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function failureCode(e){
  const allowed=['GATE_BODY','GATE_RELEASE_PROOF','GATE_LEASE_CONFLICT','GATE_GENERATION_CONFLICT','GATE_LEASE_CHANGED',
    'GATE_NOT_DRAINED','DRAIN_TIMEOUT','GATE_REQUEST_FAILED','OWNED_JOB_STILL_RUNNING','JOB_IDENTITY_MISMATCH','SIGNATURE_INVALID',
    'ERR_ASSERTION','P2028','P2010','P1017','57014','55P03','57P01','23514'];
  return allowed.includes(e?.code)?e.code:'UNEXPECTED_SANITIZED_FAILURE';
}
function load(source,imports,env={}){
  const text=source.replace('if(isMain(import.meta.url)) await cli(control);','');
  const compiled=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
  assert.equal((compiled.diagnostics||[]).length,0);
  const context={exports:{},Buffer,Response,Request,Headers,Date,setTimeout,clearTimeout,process:{env},
    console:{error(){},warn(){},info(){}},require(name){assert.ok(Object.hasOwn(imports,name));return imports[name];}};
  vm.runInNewContext(compiled.outputText,context,{timeout:5000});return context.exports;
}
const source=await fs.readFile(path.join(root,'src/lib/backup-write-gate.ts'),'utf8');
const routeSource=await fs.readFile(path.join(root,'src/app/api/internal/backup-write-gate/route.ts'),'utf8');
// Preserve original identity guards. Values come from already public source, not live metadata.
const sourceConstant=name=>{const m=source.match(new RegExp('const '+name+' = "([a-f0-9-]{36})";'));assert.ok(m);return m[1];};
const env={BACKUP_WRITE_GATE_STAGING_TEST:'true',RAILWAY_ENVIRONMENT_NAME:'staging',RAILWAY_PROJECT_ID:sourceConstant('PROJECT_ID'),
  RAILWAY_ENVIRONMENT_ID:sourceConstant('ENVIRONMENT_ID'),RAILWAY_SERVICE_ID:sourceConstant('WEB_SERVICE_ID'),BACKUP_WRITE_GATE_SECRET:crypto.randomBytes(32).toString('hex')};
function app(client){return load(source,{'server-only':{},'node:crypto':{__esModule:true,default:crypto},'./prisma':{__esModule:true,default:client}},env);}
function prisma(name){return new PrismaClient({adapter:new PrismaPg({...conn,max:1,application_name:name,
  options:'-c statement_timeout=2000 -c lock_timeout=1000'}, {schema}),log:[]});}
function acquisition(generation=0,override={}){
  const capability=crypto.randomBytes(32).toString('hex');return {capability,body:{contract:'owned-lease-v1',owner:crypto.randomBytes(32).toString('hex'),
    operationId:'psai-recovery-'+crypto.randomUUID(),expectedGeneration:generation,releaseHash:security.sha(capability),...override}};
}
const releaseBody=(a,s,override={})=>({contract:'owned-lease-v1',owner:s.owner,operationId:s.operationId,leaseId:s.leaseId,expectedGeneration:s.generation,releaseCapability:a.capability,...override});
async function persisted(){return (await admin.query(`SELECT setting_key,setting_value FROM "${schema}".settings ORDER BY setting_key`)).rows;}
async function reset(){assert.ok(identityVerified);await admin.query(`TRUNCATE "${schema}".settings`);}
async function holder(){
  const c=new Client({...conn,application_name:schema+'_holder'});await c.connect();await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(20260930,6)');
  return {close:async()=>{await c.query('ROLLBACK');await c.end();}};
}
async function waitLocks(count){
  for(let i=0;i<80;i++){
    const r=await admin.query("SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND NOT l.granted AND a.datname=current_database() AND a.usename=current_user AND a.application_name IN ($1,$2)",[schema+'_one',schema+'_two']);
    if(r.rows[0].n>=count)return;await wait(10);
  }assert.fail('Expected real PostgreSQL lock wait not observed');
}
async function scenario(code,fn){
  assert.ok(codes.includes(code));await reset();
  try{await fn();outcomes.push({scenario:code,status:'PASS'});}
  catch(e){outcomes.push({scenario:code,status:'FAIL',category:failureCode(e)});throw e;}
}
async function trigger(action){
  const body=action==='disconnect'?"PERFORM pg_terminate_backend(pg_backend_pid());":"RAISE EXCEPTION 'synthetic_guard_failure' USING ERRCODE='23514';";
  await admin.query(`CREATE FUNCTION "${schema}".fail_pause() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.setting_key='backup_write_gate:paused' THEN ${body} END IF; RETURN NEW; END$$`);
  await admin.query(`CREATE TRIGGER fail_pause BEFORE INSERT OR UPDATE ON "${schema}".settings FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_pause()`);
}
async function removeTrigger(){await admin.query(`DROP TRIGGER fail_pause ON "${schema}".settings`);await admin.query(`DROP FUNCTION "${schema}".fail_pause()`);}
async function routeFixture(){
  const route=load(routeSource,{'@/lib/backup-write-gate':gateOne,'next/server':require('next/server')});
  let deletes=0;const server=http.createServer(async(req,res)=>{
    try{
      const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>4096){res.writeHead(413);res.end('{}');return;}chunks.push(b);}
      const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(typeof v==='string')headers.set(k,v);
      if(headers.get('authorization')==='Bearer synthetic-gate-token')headers.set('authorization','Bearer '+env.BACKUP_WRITE_GATE_SECRET);
      const method=req.method||'GET';if(!['GET','POST','DELETE'].includes(method)){res.writeHead(405);res.end('{}');return;}
      if(method==='DELETE')deletes++;
      const response=await route[method](new Request('http://127.0.0.1/api/internal/backup-write-gate',{method,headers,...(method==='GET'?{}:{body:Buffer.concat(chunks)})}));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
    }catch{res.writeHead(503);res.end('{"error":"Synthetic route unavailable"}');}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let closed=false;
  const close=async()=>{if(!closed){closed=true;await new Promise(r=>{server.closeAllConnections();server.close(r);});}};
  cleaners.push(close);
  return {endpoint:'http://127.0.0.1:'+server.address().port,close,deletes:()=>deletes};
}
async function recovery(endpoint){
  const f=await fixture({after(fn){cleaners.push(fn);}},{gate:{endpoint,contract:'owned-lease-v1'}});
  return {f,c:await security.loadOperation(f.paths,'gate')};
}
async function runningSupervisor(f,c){
  // Real owned child process; Docker transport/identity only is simulated here.
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{env:{PATH:process.env.PATH},stdio:'ignore',shell:false});
  child.on('error',()=>{});
  assert.ok(child.pid);cleaners.push(async()=>{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}});
  const cid='a'.repeat(64),job={role:'job',operationHash:c.operationHash,runnerId:c.op.runnerId,containerId:cid,imageId:c.runtime.imageId,imageDigest:c.op.imageDigest,deadline:new Date(Date.now()-1).toISOString()};
  const file=path.join(f.root,'job.json');await fs.writeFile(file,security.canonical(sign(job,f.runtime.privateKey)));
  function execFile(program,args,options,callback){
    assert.equal(program,'docker');assert.equal(options.shell,false);let stdout;
    if(args[0]==='inspect'&&args[2].includes('.Config.Labels'))stdout=c.op.operationId+'|no|sha256:'+job.imageId;
    else if(args[0]==='inspect'&&args[2]==='{{json .State}}')stdout=JSON.stringify({Running:child.exitCode===null&&child.signalCode===null,Status:'running'});
    else if(args[0]==='stop')stdout=''; // Simulated unsuccessful termination: the real exporter remains alive.
    else assert.fail('Unexpected job command');
    queueMicrotask(()=>callback(null,stdout,''));
  }
  execFile[promisify.custom]=async(...args)=>await new Promise((resolve,reject)=>execFile(...args,(e,stdout,stderr)=>e?reject(e):resolve({stdout,stderr})));
  const jobs=load(await fs.readFile(path.join(root,'tooling/recovery-v1/lib/job.mjs'),'utf8'),{'node:child_process':{execFile},'node:util':{promisify},'./security.mjs':security});
  const controls=load(await fs.readFile(path.join(root,'tooling/recovery-v1/gate-control.mjs'),'utf8'),{'node:path':{__esModule:true,default:path},'./lib/security.mjs':security,'./lib/process.mjs':processTools,'./lib/gate.mjs':gates,'./lib/job.mjs':jobs});
  return {run:()=>controls.control({...f.paths,job:file,action:'resume'}),child};
}

let failed=false,cleanupStatus='PASS';
try{
  assert.equal(process.platform,'linux');assert.equal(Number(process.versions.node.split('.')[0]),24);assert.equal(process.env.CI,'true');assert.equal(process.env.PSAI_OWNED_GATE_POSTGRES_APPROVED,'true');
  assert.equal(process.argv[2],'/run/psai-gate-config.json');assertIsolatedNetwork();assertNoTestEnvFiles(root);
  assert.ok(!Object.entries(process.env).some(([k,v])=>v&&(/^(?:PG|DATABASE_URL|DIRECT_URL|RAILWAY_|NEON_|AWS_|S3_|GOOGLE_|SMTP_|RESEND_)/.test(k))));
  const stat=await fs.lstat(process.argv[2]);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=4096);
  const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  assert.deepEqual(Object.keys(config).sort(),['database','host','instanceId','password','port','user'].sort());
  assert.equal(config.host,'127.0.0.1');assert.equal(config.port,55432);assert.equal(config.database,'proctorshield_gate_lease_test');assert.equal(config.user,'psai_gate_test');
  assert.match(config.instanceId,/^[a-f0-9-]{36}$/);assert.match(config.password,/^[a-f0-9]{64}$/);
  conn={host:config.host,port:config.port,database:config.database,user:config.user,password:config.password,ssl:false,connectionTimeoutMillis:3000};
  admin=new Client({...conn,application_name:'psai_gate_identity'});admin.on('error',()=>{});await admin.connect();
  const id=(await admin.query(`SELECT current_database() AS db,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,
    current_setting('server_version_num')::int AS version,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls,r.rolreplication,d.datistemplate,
    shobj_description(d.oid,'pg_database') AS marker FROM pg_database d JOIN pg_roles r ON r.rolname=current_user WHERE d.datname=current_database()`)).rows[0];
  assert.equal(id.db,config.database);assert.equal(id.role,config.user);assert.equal(id.host,config.host);assert.equal(id.port,config.port);assert.equal(Math.floor(id.version/10000),18);
  assert.equal(id.marker,'proctorshield:owned-gate-disposable:'+config.instanceId);
  for(const key of ['rolsuper','rolcreatedb','rolcreaterole','rolbypassrls','rolreplication','datistemplate'])assert.equal(id[key],false);
  identityVerified=true;schema='owned_gate_'+crypto.randomBytes(12).toString('hex');assert.match(schema,/^owned_gate_[a-f0-9]{24}$/);
  await admin.query(`CREATE SCHEMA "${schema}"`);await admin.query(`CREATE TABLE "${schema}".settings(id SERIAL PRIMARY KEY,setting_key TEXT UNIQUE NOT NULL,setting_value TEXT,updated_at TIMESTAMP NOT NULL DEFAULT now())`);
  one=prisma(schema+'_one');two=prisma(schema+'_two');gateOne=app(one);gateTwo=app(two);
  for(const code of ['CONCURRENT_ACQUIRE','SAME_OWNER_ACQUIRE'])await scenario(code,async()=>{
    const a=acquisition(),b=acquisition(0,code==='SAME_OWNER_ACQUIRE'?{owner:a.body.owner,operationId:a.body.operationId}:{}),h=await holder();
    const p=Promise.allSettled([gateOne.acquireBackupWriteLease(a.body),gateTwo.acquireBackupWriteLease(b.body)]);
    try{await waitLocks(2);}finally{await h.close();}
    const r=await p;assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.find(x=>x.status==='rejected').reason.code,'GATE_ALREADY_PAUSED');
    const s=await gateOne.getBackupWriteGateStatus();assert.equal(s.generation,1);assert.equal(s.paused,true);
  });
  await scenario('RELEASE_IDENTITY_CAS',async()=>{
    const a=acquisition(),s=await gateOne.acquireBackupWriteLease(a.body),before=await persisted();
    for(const change of [{owner:'f'.repeat(64)},{operationId:'psai-recovery-'+crypto.randomUUID()},{leaseId:crypto.randomUUID()},{expectedGeneration:0}]){
      await assert.rejects(gateTwo.releaseBackupWriteLease(releaseBody(a,s,change)),{code:'GATE_LEASE_CONFLICT'});assert.deepEqual(await persisted(),before);
    }
  });
  await scenario('WRONG_RELEASE_PROOF',async()=>{
    const a=acquisition(),s=await gateOne.acquireBackupWriteLease(a.body),before=await persisted();
    await assert.rejects(gateTwo.releaseBackupWriteLease(releaseBody(a,s,{releaseCapability:'0'.repeat(64)})),{code:'GATE_RELEASE_PROOF'});assert.deepEqual(await persisted(),before);
  });
  await scenario('REPLAY_NEW_LEASE',async()=>{
    const a=acquisition(),s=await gateOne.acquireBackupWriteLease(a.body),old=releaseBody(a,s);
    const open=await gateTwo.releaseBackupWriteLease(old);assert.equal(open.generation,2);assert.equal(open.paused,false);
    await assert.rejects(gateOne.releaseBackupWriteLease(old),{code:'GATE_LEASE_CONFLICT'});
    await assert.rejects(gateOne.acquireBackupWriteLease(acquisition(0).body),{code:'GATE_GENERATION_CONFLICT'});
    const newer=await gateTwo.acquireBackupWriteLease(acquisition(2,{owner:s.owner,operationId:s.operationId}).body);
    await assert.rejects(gateOne.releaseBackupWriteLease(old),{code:'GATE_LEASE_CONFLICT'});assert.equal((await gateOne.getBackupWriteGateStatus()).leaseId,newer.leaseId);
  });
  await scenario('CONCURRENT_RELEASE',async()=>{
    const a=acquisition(),s=await gateOne.acquireBackupWriteLease(a.body),h=await holder();
    const pending=Promise.allSettled([gateOne.releaseBackupWriteLease(releaseBody(a,s)),gateTwo.releaseBackupWriteLease(releaseBody(a,s))]);
    try{await waitLocks(2);}finally{await h.close();}
    const r=await pending;assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.find(x=>x.status==='rejected').reason.code,'GATE_LEASE_CONFLICT');
    const open=await gateTwo.getBackupWriteGateStatus();assert.equal(open.generation,2);assert.equal(open.paused,false);assert.equal(open.owner,null);assert.equal(open.leaseId,null);
  });
  await scenario('ADMITTED_MUTATION_DRAIN',async()=>{
    const started=deferred(),finish=deferred();let writes=0;
    const pending=gateOne.withBackupWriteGate(async()=>{writes++;await one.setting.create({data:{settingKey:'synthetic_record:admitted',settingValue:'synthetic-only'}});started.resolve();await finish.promise;return Response.json({ok:true});})();
    try{await started.promise;const s=await gateTwo.acquireBackupWriteLease(acquisition().body);assert.equal(s.activeMutations,1);assert.equal(s.safeForBackup,false);
      assert.equal((await gateTwo.withBackupWriteGate(async()=>{writes++;await two.setting.create({data:{settingKey:'synthetic_record:blocked',settingValue:'synthetic-only'}});return Response.json({});})()).status,503);assert.equal(writes,1);
      assert.equal(await two.setting.count({where:{settingKey:'synthetic_record:blocked'}}),0);
    }finally{finish.resolve();await pending;}assert.equal((await gateTwo.getBackupWriteGateStatus()).safeForBackup,true);
  });
  await scenario('PAUSE_WINS_ADMISSION',async()=>{
    await gateOne.acquireBackupWriteLease(acquisition().body);let entered=false;
    const r=await gateTwo.withBackupWriteGate(async()=>{entered=true;return Response.json({});})();assert.equal(r.status,503);assert.equal(entered,false);assert.equal((await gateTwo.getBackupWriteGateStatus()).activeMutations,0);
  });
  await scenario('ADMISSION_PAUSE_RACE',async()=>{
    const finish=deferred(),h=await holder();let entered=false;
    const acquire=gateOne.acquireBackupWriteLease(acquisition().body);
    const pending=gateTwo.withBackupWriteGate(async()=>{entered=true;await finish.promise;return Response.json({ok:true});})();
    try{try{await waitLocks(2);}finally{await h.close();}await acquire;
      const s=await gateOne.getBackupWriteGateStatus();assert.equal(s.paused,true);assert.equal(s.activeMutations,entered?1:0);assert.equal(s.safeForBackup,!entered);
    }finally{finish.resolve();}const r=await pending;assert.equal(r.status,entered?200:503);
  });
  await scenario('DEFERRED_MUTATION_DRAIN',async()=>{
    let later;await gateOne.scheduleTrackedBackupWork(fn=>{later=fn;},async()=>{});
    const s=await gateTwo.acquireBackupWriteLease(acquisition().body);assert.equal(s.activeMutations,1);assert.equal(s.safeForBackup,false);
    await later();assert.equal((await gateTwo.getBackupWriteGateStatus()).safeForBackup,true);
  });
  for(const [code,action] of [['TRANSACTION_ROLLBACK','raise'],['BACKEND_DISCONNECT_ROLLBACK','disconnect']])await scenario(code,async()=>{
    const a=acquisition();await trigger(action);
    try{await assert.rejects(gateOne.acquireBackupWriteLease(a.body));assert.deepEqual(await persisted(),[]);}finally{await removeTrigger();}
    const s=await gateTwo.acquireBackupWriteLease(a.body),before=await persisted();await trigger(action);
    try{await assert.rejects(gateOne.releaseBackupWriteLease(releaseBody(a,s)));assert.deepEqual(await persisted(),before);}finally{await removeTrigger();}
    assert.equal((await gateTwo.getBackupWriteGateStatus()).paused,true);
  });
  await scenario('LOCK_CONTENTION_FAIL_CLOSED',async()=>{
    const h=await holder();const acquire=gateOne.acquireBackupWriteLease(acquisition().body);
    try{await waitLocks(1);await assert.rejects(acquire);assert.deepEqual(await persisted(),[]);
      let wrote=false;assert.equal((await gateTwo.withBackupWriteGate(async()=>{wrote=true;return Response.json({});})()).status,503);assert.equal(wrote,false);
    }finally{await h.close();}assert.equal((await gateTwo.getBackupWriteGateStatus()).generation,0);
  });
  await scenario('RESTART_PERSISTENCE',async()=>{
    const s=await gateOne.acquireBackupWriteLease(acquisition().body);await one.$disconnect();one=prisma(schema+'_one');gateOne=app(one);
    const after=await gateOne.getBackupWriteGateStatus();assert.equal(after.generation,s.generation);assert.equal(after.owner,s.owner);assert.equal(after.leaseId,s.leaseId);assert.equal(after.paused,true);
  });
  await scenario('STALE_MARKER_RETAINED',async()=>{
    const r=await routeFixture(),{c}=await recovery(r.endpoint);await gates.pause(c);
    await two.setting.create({data:{settingKey:activePrefix+'synthetic-interrupted',settingValue:'2000-01-01T00:00:00.000Z'}});
    await assert.rejects(gates.drain(c,undefined,120),{code:'DRAIN_TIMEOUT'});await two.$disconnect();two=prisma(schema+'_two');gateTwo=app(two);
    const s=await gateTwo.getBackupWriteGateStatus();assert.equal(s.activeMutations,1);assert.equal(s.safeForBackup,false);assert.equal(s.paused,true);
  });
  await scenario('ROUTE_TOOLING_CONTRACT',async()=>{
    const r=await routeFixture(),{f,c}=await recovery(r.endpoint),s=await gates.pause(c);assert.equal(s.releaseProof,'sha256-capability-v1');assert.equal(s.generation,1);
    assert.equal((await gates.drain(c)).safeForBackup,true);await fs.rm(path.join(f.paths.secrets,'gate-release-capability'));
    assert.equal((await gates.owned(c)).leaseId,s.leaseId);await assert.rejects(gates.release(c),{code:'ENOENT'});assert.equal(r.deletes(),0);
    await fs.writeFile(path.join(f.paths.secrets,'gate-release-capability'),f.secrets['gate-release-capability'],{mode:0o600});
    await gates.release(c);assert.equal(r.deletes(),1);assert.equal((await gateTwo.getBackupWriteGateStatus()).generation,2);
  });
  await scenario('LEGACY_AUTH_REJECTION',async()=>{
    const r=await routeFixture();for(const method of ['POST','DELETE']){
      const denied=await fetch(r.endpoint+'/api/internal/backup-write-gate',{method,headers:{Authorization:'Bearer invalid'}});assert.equal(denied.status,401);
      const legacy=await fetch(r.endpoint+'/api/internal/backup-write-gate',{method,headers:{Authorization:'Bearer synthetic-gate-token'}});assert.equal(legacy.status,400);
    }assert.deepEqual(await persisted(),[]);await assert.rejects(gateOne.setBackupWritePause(false),{code:'OWNED_LEASE_REQUIRED'});
  });
  await scenario('EXPORTER_STILL_RUNNING',async()=>{
    const r=await routeFixture(),{f,c}=await recovery(r.endpoint);await gates.pause(c);const before=await persisted(),supervisor=await runningSupervisor(f,c);
    await assert.rejects(supervisor.run(),{code:'OWNED_JOB_STILL_RUNNING'});assert.equal(supervisor.child.exitCode,null);assert.equal(supervisor.child.signalCode,null);assert.deepEqual(await persisted(),before);assert.equal(r.deletes(),0);
  });
  await scenario('SUPERVISOR_INTERRUPTED',async()=>{
    const r=await routeFixture(),{f,c}=await recovery(r.endpoint),script=`import{loadOperation}from'./tooling/recovery-v1/lib/security.mjs';import{pause}from'./tooling/recovery-v1/lib/gate.mjs';const c=await loadOperation(JSON.parse(process.argv[1]),'gate');await pause(c);process.send({event:'ACQUIRED'});setInterval(()=>{},1000);`;
    const child=spawn(process.execPath,['--input-type=module','-e',script,JSON.stringify(f.paths)],{cwd:root,env:{PATH:process.env.PATH},stdio:['ignore','ignore','ignore','ipc'],shell:false});
    child.on('error',()=>{});
    const exited=once(child,'exit');cleaners.push(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;});
    const message=await Promise.race([once(child,'message'),wait(5000).then(()=>{throw new Error('Synthetic supervisor deadline');})]);assert.equal(message[0].event,'ACQUIRED');
    const before=await persisted();child.kill('SIGKILL');await exited;await wait(150);assert.deepEqual(await persisted(),before);
    assert.equal((await gateTwo.getBackupWriteGateStatus()).paused,true);await assert.rejects(gateTwo.acquireBackupWriteLease(acquisition().body),{code:'GATE_ALREADY_PAUSED'});assert.equal((await gates.owned(c)).paused,true);
  });
  await scenario('UNREACHABLE_GATE',async()=>{
    const r=await routeFixture(),{c}=await recovery(r.endpoint);await gates.pause(c);const before=await persisted();await r.close();
    await assert.rejects(gates.release(c),{name:'TypeError'});assert.deepEqual(await persisted(),before);assert.equal((await gateTwo.getBackupWriteGateStatus()).paused,true);
  });
  assert.equal(outcomes.length,codes.length);assert.ok(outcomes.every(x=>x.status==='PASS'));
}catch(e){failed=true;if(!outcomes.some(x=>x.status==='FAIL'))outcomes.push({scenario:'PREFLIGHT_OR_SETUP',status:'FAIL',category:failureCode(e)});}
finally{
  for(const clean of cleaners.reverse())try{await clean();}catch{failed=true;cleanupStatus='FAIL';}
  for(const client of [one,two])try{if(client)await client.$disconnect();}catch{failed=true;cleanupStatus='FAIL';}
  if(admin){try{if(identityVerified&&schema)await admin.query(`DROP SCHEMA "${schema}" CASCADE`);}catch{failed=true;cleanupStatus='FAIL';}finally{await admin.end().catch(()=>{failed=true;cleanupStatus='FAIL';});}}
}
process.stdout.write(JSON.stringify({label:'SYNTHETIC ONLY; NOT LIVE BACKUP OR DEPLOYMENT EVIDENCE',schema:1,outcomes,
  pass:outcomes.filter(x=>x.status==='PASS').length,fail:outcomes.filter(x=>x.status==='FAIL').length,expected:codes.length,
  realPostgresMajor:18,realPrismaTransactions:true,realNextResponse:true,supervisorDockerTransport:'SIMULATED; real owned child process',
  identityVerified,cleanupStatus,liveModeEnabled:false,rawDiagnosticsWithheld:true})+'\n');
if(failed)process.exitCode=1;
