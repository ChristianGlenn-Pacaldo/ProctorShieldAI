// Approved-branch GitHub-hosted synthetic runner only. No laptop Docker or live mode.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile),root=process.cwd();
const baseline='31c22c4e865a845342645d757653547408021009',baseTree='e7b5f032b7a42673dda948ecbc64f381c69f5b3d';
const branch='codex/owned-gate-postgres-verification-20261013';
const pgImage='postgres@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c';
const nodeImage='node@sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd';
const expected={
  'src/lib/backup-write-gate.ts':'b6747a6c55d557f6bbaeb7e93c5e84722b148d3f01bb0ceb889f3440b2d5fc6d',
  'src/app/api/internal/backup-write-gate/route.ts':'7c2816a0dd375c79d02af6b36f58929b7688df607d90949e3cf94f903239cdb5',
  'tooling/recovery-v1/lib/gate.mjs':'ea5c2c3be0a3b0738526f45ec44ab6670f1770e74d0b5c340fab5781ce83ac70',
  'tooling/recovery-v1/gate-control.mjs':'109a76cd5f8840b023f07c985f38dee20ea928af77999a602d7c5c0d2f3024af',
  'tests/backup-write-gate.test.ts':'8943a90877268ecb457855d473e5e91bbd979c15448cc60ec4495222e9265944',
  'tooling/recovery-v1/tests/fixtures.mjs':'b2482f08b46c932f3df6ba6ae33e73e2baae5606d1e5e11c72bc6261fbc7d01a',
  'tooling/recovery-v1/tests/unit.test.mjs':'4edf50c29ff9af7675d3eeaef6a8e8d2acd4196245b6c76c6d5825bb77561f0c',
  'tooling/recovery-v1/tests/cloud-runtime.mjs':'c2866d3acfdb62be7d6008f7f859bc75a84a3ea3dbb7e78811bc20a04fdb564f'
};
const additions=['.github/workflows/owned-gate-postgres.yml','tests/infrastructure/Dockerfile.owned-gate-postgres',
  'tests/infrastructure/verify-owned-gate-postgres.mjs','tests/backup-write-gate-postgres.test.mjs'];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const stages=['preflight','image_build','postgres_provision','postgres_scenarios','owned_cleanup'];
const scenarioCodes=['CONCURRENT_ACQUIRE','SAME_OWNER_ACQUIRE','RELEASE_IDENTITY_CAS','WRONG_RELEASE_PROOF','REPLAY_NEW_LEASE','CONCURRENT_RELEASE',
  'ADMITTED_MUTATION_DRAIN','PAUSE_WINS_ADMISSION','ADMISSION_PAUSE_RACE','DEFERRED_MUTATION_DRAIN','TRANSACTION_ROLLBACK',
  'BACKEND_DISCONNECT_ROLLBACK','LOCK_CONTENTION_FAIL_CLOSED','RESTART_PERSISTENCE','STALE_MARKER_RETAINED',
  'ROUTE_TOOLING_CONTRACT','LEGACY_AUTH_REJECTION','EXPORTER_STILL_RUNNING','SUPERVISOR_INTERRUPTED','UNREACHABLE_GATE'];
const failureCodes=['GATE_BODY','GATE_RELEASE_PROOF','GATE_LEASE_CONFLICT','GATE_GENERATION_CONFLICT','GATE_LEASE_CHANGED',
  'GATE_NOT_DRAINED','DRAIN_TIMEOUT','GATE_REQUEST_FAILED','OWNED_JOB_STILL_RUNNING','JOB_IDENTITY_MISMATCH','SIGNATURE_INVALID',
  'ERR_ASSERTION','P2028','P2010','P1017','57014','55P03','57P01','23514','UNEXPECTED_SANITIZED_FAILURE'];
let phase='preflight',interrupted=false,privateRoot,ledger,imageId,testResult,failed=false,ledgerWritten=false;
const activeAbort=new AbortController(),signal=()=>{interrupted=true;activeAbort.abort();};
process.once('SIGTERM',signal);process.once('SIGINT',signal);
const command=async(file,args,timeout=15000,cleanup=false)=>(await exec(file,args,{cwd:root,timeout,maxBuffer:2*1024*1024,shell:false,
  ...(cleanup?{}:{signal:activeAbort.signal})})).stdout.trim();
const docker=(args,timeout=15000,cleanup=false)=>command('docker',args,timeout,cleanup);
const git=args=>command('git',args);
const ledgerPath=path.join(os.tmpdir(),'psai-owned-gate-'+process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT+'.json');
async function preflight(){
  assert.equal(process.platform,'linux');assert.equal(process.env.CI,'true');assert.equal(process.env.PSAI_OWNED_GATE_CLOUD_APPROVED,'true');
  assert.equal(process.env.GITHUB_REPOSITORY,'ChristianGlenn-Pacaldo/ProctorShieldAI');assert.equal(process.env.GITHUB_REF,'refs/heads/'+branch);
  assert.match(process.env.GITHUB_RUN_ID||'',/^\d+$/);assert.match(process.env.GITHUB_RUN_ATTEMPT||'',/^\d+$/);assert.match(process.env.GITHUB_SHA||'',/^[a-f0-9]{40}$/);
  assert.ok(!Object.entries(process.env).some(([k,v])=>v&&(/^(?:PG|DATABASE_URL|DIRECT_URL|RAILWAY_|NEON_|AWS_|S3_|GOOGLE_|SMTP_|RESEND_)/.test(k))));
  assert.equal(await git(['rev-parse','HEAD']),process.env.GITHUB_SHA);assert.equal(await git(['rev-parse','HEAD^']),baseline);assert.equal(await git(['rev-parse','HEAD^{tree}'])===baseTree,false);
  assert.equal(await git(['rev-parse','HEAD^'+'^{tree}']),baseTree);
  const expectedDiff=[...Object.keys(expected).map(n=>'M\t'+n),...additions.map(n=>'A\t'+n)].sort();
  assert.deepEqual((await git(['diff','--name-status',baseline,'HEAD'])).split('\n').sort(),expectedDiff);
  const status=await git(['status','--porcelain']);
  assert.ok(status===''||process.argv[2]==='--cleanup'&&status==='?? owned-gate-evidence/');await git(['diff','--check',baseline,'HEAD']);
  for(const [file,digest] of Object.entries(expected))assert.equal(sha(await fs.readFile(file)),digest);
  const security=await fs.readFile('tooling/recovery-v1/lib/security.mjs','utf8');
  assert.equal(sha(security),'d058ed11f53a5a6d96946aa58137b2fa367dcb25632880f5b106e70ff3605ce1');
  assert.ok(security.includes("if(op.mode==='live') throw new SafeError('LIVE_GATE_INTEGRATION_UNVERIFIED');"));
  assert.ok(security.includes("if(mode==='live') throw new SafeError('LIVE_GATE_INTEGRATION_UNVERIFIED');"));
  assert.ok(!(await fs.readdir(root)).some(n=>/^\.env(?:\.|$)/.test(n)&&n!=='.env.example'));
}
async function saveLedger(){await fs.writeFile(ledgerPath,JSON.stringify(ledger),{mode:0o600,flag:'wx'});ledgerWritten=true;}
async function resourceGuard(){
  const available=Number((await fs.readFile('/proc/meminfo','utf8')).match(/^MemAvailable:\s+(\d+)/m)[1]),disk=await fs.statfs(root);
  assert.ok(available>=2500*1024);assert.ok(Number(disk.bavail)*Number(disk.bsize)>=8*1024**3);
}
async function verifyOwner(name){
  assert.ok(ledger.names.includes(name));
  const data=JSON.parse(await docker(['inspect',name],15000,true));assert.equal(data.length,1);
  assert.equal(data[0].Config.Labels['psai.owned-gate.owner'],ledger.owner);assert.equal(data[0].HostConfig.RestartPolicy.Name,'no');
  return data[0];
}
async function cleanup(){
  if(!ledger)return {status:'NOT_CREATED',ownedContainersRemoved:0,hostTemporaryRemoved:false};
  assert.deepEqual(Object.keys(ledger).sort(),['owner','privateRoot','names','tag'].sort());
  assert.match(ledger.owner,/^psai-owned-gate-[a-f0-9-]{36}$/);assert.deepEqual(ledger.names,[ledger.owner+'-pg',ledger.owner+'-worker']);
  assert.equal(ledger.tag,ledger.owner+':test');
  const result={status:'PASS',ownedContainersRemoved:0,hostTemporaryRemoved:false,imageRemoved:false};
  for(const name of [...ledger.names].reverse()){
    const exists=await docker(['container','ls','-a','--filter','name=^/'+name+'$','--format','{{.Names}}'],15000,true);
    if(!exists)continue;assert.equal(exists,name);await verifyOwner(name);
    await docker(['stop','--time','1',name],15000,true);assert.equal((await verifyOwner(name)).State.Running,false);
    await docker(['rm','-v',name],15000,true);result.ownedContainersRemoved++;
  }
  const found=await docker(['image','ls','--filter','reference='+ledger.tag,'--format','{{.ID}}'],15000,true);
  if(found){
    const image=JSON.parse(await docker(['image','inspect',ledger.tag],15000,true))[0];assert.equal(image.Config.Labels['psai.owned-gate.owner'],ledger.owner);
    await docker(['image','rm',ledger.tag],15000,true);result.imageRemoved=true;
  }
  assert.equal(path.dirname(ledger.privateRoot),os.tmpdir());assert.ok(path.basename(ledger.privateRoot).startsWith(ledger.owner+'-'));
  const s=await fs.lstat(ledger.privateRoot).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(s){assert.ok(s.isDirectory()&&!s.isSymbolicLink());await fs.rm(ledger.privateRoot,{recursive:true,force:false});}result.hostTemporaryRemoved=true;
  await fs.rm(ledgerPath,{force:false});return result;
}
function sanitizeResult(raw){
  assert.ok(Buffer.byteLength(raw)<32768);const d=JSON.parse(raw);
  assert.deepEqual(Object.keys(d).sort(),['label','schema','outcomes','pass','fail','expected','realPostgresMajor','realPrismaTransactions','realNextResponse','supervisorDockerTransport','identityVerified','cleanupStatus','liveModeEnabled','rawDiagnosticsWithheld'].sort());
  assert.equal(d.schema,1);assert.equal(d.label,'SYNTHETIC ONLY; NOT LIVE BACKUP OR DEPLOYMENT EVIDENCE');assert.equal(d.realPostgresMajor,18);assert.equal(d.expected,20);
  assert.equal(d.realPrismaTransactions,true);assert.equal(d.realNextResponse,true);assert.equal(d.supervisorDockerTransport,'SIMULATED; real owned child process');
  assert.equal(d.liveModeEnabled,false);assert.equal(d.rawDiagnosticsWithheld,true);assert.ok(['PASS','FAIL'].includes(d.cleanupStatus));assert.equal(typeof d.identityVerified,'boolean');
  assert.ok(Array.isArray(d.outcomes)&&d.outcomes.length<=20);
  for(const r of d.outcomes){assert.ok([...scenarioCodes,'PREFLIGHT_OR_SETUP'].includes(r.scenario));assert.ok(['PASS','FAIL'].includes(r.status));
    assert.deepEqual(Object.keys(r).sort(),(r.status==='FAIL'?['scenario','status','category']:['scenario','status']).sort());if(r.status==='FAIL')assert.ok(failureCodes.includes(r.category));}
  assert.equal(d.pass,d.outcomes.filter(r=>r.status==='PASS').length);assert.equal(d.fail,d.outcomes.filter(r=>r.status==='FAIL').length);return d;
}
async function provision(pgName,instance,password){
  assert.match(instance,/^[a-f0-9-]{36}$/);assert.match(password,/^[a-f0-9]{64}$/);
  const sql=`CREATE ROLE psai_gate_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}';
CREATE DATABASE proctorshield_gate_lease_test OWNER psai_gate_test;
REVOKE ALL ON DATABASE proctorshield_gate_lease_test FROM PUBLIC;
COMMENT ON DATABASE proctorshield_gate_lease_test IS 'proctorshield:owned-gate-disposable:${instance}';`;
  await new Promise((resolve,reject)=>{
    const child=execFile('docker',['exec','-i','--user','postgres',pgName,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-p','55432','-d','postgres'],
      {timeout:15000,maxBuffer:16384,shell:false,signal:activeAbort.signal},e=>e?reject(new Error('SYNTHETIC_PROVISION_FAILED')):resolve());child.stdin.end(sql);
  });
}
let cleanupResult;
try{
  await preflight();
  if(process.argv[2]==='--preflight'){
    assert.equal(process.argv.length,3);process.stdout.write('{"preflight":"PASS","execution":"NOT_STARTED"}\n');
  }else if(process.argv[2]==='--cleanup'){
    assert.equal(process.argv.length,3);const s=await fs.lstat(ledgerPath).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(s){assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.size<8192&&(s.mode&0o077)===0);ledger=JSON.parse(await fs.readFile(ledgerPath));ledgerWritten=true;cleanupResult=await cleanup();ledger=null;ledgerWritten=false;}
    else cleanupResult={status:'NOT_CREATED'};process.stdout.write(JSON.stringify({ownedCleanup:cleanupResult.status})+'\n');
  }else{
    assert.equal(process.argv.length,2);
    await resourceGuard();
    const owner='psai-owned-gate-'+crypto.randomUUID();privateRoot=await fs.mkdtemp(path.join(os.tmpdir(),owner+'-'));await fs.chmod(privateRoot,0o700);
    ledger={owner,privateRoot,names:[owner+'-pg',owner+'-worker'],tag:owner+':test'};await saveLedger();
    phase='image_build';
    await docker(['build','--platform','linux/amd64','--label','psai.owned-gate.owner='+owner,'--label','org.opencontainers.image.revision='+process.env.GITHUB_SHA,
      '--tag',ledger.tag,'--file','tests/infrastructure/Dockerfile.owned-gate-postgres','.'],12*60*1000);
    imageId=await docker(['image','inspect','--format','{{.Id}}',ledger.tag]);assert.match(imageId,/^sha256:[a-f0-9]{64}$/);
    assert.equal(await docker(['image','inspect','--format','{{.Config.User}}|{{json .Config.Entrypoint}}',imageId]),'1001:1001|["node"]');
    const imageEnv=JSON.parse(await docker(['image','inspect','--format','{{json .Config.Env}}',imageId]));
    phase='postgres_provision';
    await resourceGuard();
    await docker(['create','--name',ledger.names[0],'--label','psai.owned-gate.owner='+owner,'--network=none','--restart=no','--memory=512m','--cpus=1','--pids-limit=128',
      '--tmpfs','/var/lib/postgresql:rw,nosuid,nodev,size=512m','--env','POSTGRES_PASSWORD='+crypto.randomBytes(32).toString('hex'),pgImage,
      'postgres','-p','55432','-c','listen_addresses=127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic']);
    const pg=await verifyOwner(ledger.names[0]);assert.equal(pg.HostConfig.NetworkMode,'none');assert.deepEqual(pg.HostConfig.PortBindings??{},{});assert.equal(pg.HostConfig.PublishAllPorts,false);
    assert.equal(pg.Config.Image,pgImage);assert.equal(pg.Image,await docker(['image','inspect','--format','{{.Id}}',pgImage]));
    await docker(['start',ledger.names[0]]);let ready=false;
    for(let i=0;i<60&&!ready;i++){assert.equal(interrupted,false);try{await docker(['exec',ledger.names[0],'pg_isready','-U','postgres','-p','55432','-d','postgres']);ready=true;}catch{await new Promise(r=>setTimeout(r,500));}}
    assert.equal(ready,true);const instance=crypto.randomUUID(),password=crypto.randomBytes(32).toString('hex');await provision(ledger.names[0],instance,password);
    const config=path.join(privateRoot,'config.json');await fs.writeFile(config,JSON.stringify({host:'127.0.0.1',port:55432,database:'proctorshield_gate_lease_test',user:'psai_gate_test',instanceId:instance,password}),{mode:0o444});
    const scrub=imageEnv.map(x=>x.split('=')[0]).filter(n=>/^(?:PG|POSTGRES)/.test(n)).flatMap(n=>['--env',n+'=']);
    phase='postgres_scenarios';
    await docker(['create','--name',ledger.names[1],'--label','psai.owned-gate.owner='+owner,'--network','container:'+pg.Id,'--restart=no','--read-only','--user','1001:1001',
      '--cap-drop=ALL','--security-opt=no-new-privileges','--memory=1536m','--cpus=2','--pids-limit=128',
      '--tmpfs','/tmp:rw,nosuid,nodev,size=64m,mode=1777','--tmpfs','/work:rw,nosuid,nodev,size=32m,uid=1001,gid=1001,mode=0700',
      '--tmpfs','/var/lib/postgresql:ro,nosuid,nodev,size=1m',
      '--mount','type=bind,source='+config+',target=/run/psai-gate-config.json,readonly',
      '--env','CI=true','--env','PSAI_OWNED_GATE_POSTGRES_APPROVED=true',...scrub,imageId]);
    const worker=await verifyOwner(ledger.names[1]);assert.equal(worker.HostConfig.NetworkMode,'container:'+pg.Id);assert.deepEqual(worker.HostConfig.PortBindings??{},{});assert.equal(worker.HostConfig.PublishAllPorts,false);
    assert.equal(worker.Image,imageId);assert.equal(worker.HostConfig.Privileged,false);
    assert.equal(worker.HostConfig.ReadonlyRootfs,true);assert.equal(worker.Config.User,'1001:1001');assert.ok(worker.HostConfig.CapDrop.includes('ALL'));
    assert.equal(worker.Mounts.filter(m=>m.Type==='bind').length,1);assert.ok(worker.Mounts.every(m=>m.Type==='tmpfs'||m.Type==='bind'&&m.Destination==='/run/psai-gate-config.json'&&m.RW===false));
    assert.deepEqual(Object.keys(worker.HostConfig.Tmpfs).sort(),['/tmp','/work','/var/lib/postgresql'].sort());
    await docker(['start',ledger.names[1]]);const exit=await docker(['wait',ledger.names[1]],300000);const raw=await docker(['logs',ledger.names[1]]);
    testResult=sanitizeResult(raw);assert.equal(exit,'0');assert.equal(testResult.pass,20);assert.equal(testResult.fail,0);assert.equal(testResult.identityVerified,true);assert.equal(testResult.cleanupStatus,'PASS');
    assert.deepEqual(testResult.outcomes.map(x=>x.scenario),scenarioCodes);
  }
}catch{failed=true;}
finally{
  if(ledgerWritten&&ledger){phase=failed?phase:'owned_cleanup';try{cleanupResult=await cleanup();}catch{failed=true;cleanupResult={status:'FAIL'};}}
  else if(privateRoot){try{assert.equal(path.dirname(privateRoot),os.tmpdir());await fs.rm(privateRoot,{recursive:true,force:false});}catch{failed=true;}}
  process.off('SIGTERM',signal);process.off('SIGINT',signal);
}
if(testResult?.pass===20&&cleanupResult?.ownedContainersRemoved!==2)failed=true;
try{if(process.argv.length===2){
  assert.ok(stages.includes(phase));await fs.mkdir('owned-gate-evidence',{recursive:true});
  const evidence={label:'SYNTHETIC ONLY; NOT A LIVE BACKUP OR DEPLOYMENT APPROVAL',status:failed||interrupted?'FAIL':'PASS',
    phase,verificationCommit:process.env.GITHUB_SHA,immutableParent:baseline,imageId:imageId||null,baseImages:{node:nodeImage,postgres:pgImage},
    packageLockSHA256:sha(await fs.readFile('package-lock.json')),tests:testResult||null,cleanup:cleanupResult||{status:'NOT_CREATED'},
    publishedPorts:0,network:'Loopback-only shared PostgreSQL namespace; no external routes',liveGateBlocked:true,rawDiagnosticsWithheld:true};
  await fs.writeFile('owned-gate-evidence/verification.json',JSON.stringify(evidence,null,2)+'\n');
  process.stdout.write(JSON.stringify({status:evidence.status,phase,pass:testResult?.pass??0,fail:testResult?.fail??0,cleanup:evidence.cleanup.status})+'\n');
}else if(failed)process.stdout.write('{"status":"FAIL","category":"ISOLATED_PREFLIGHT_OR_CLEANUP_FAILED"}\n');
}catch{failed=true;process.stdout.write('{"status":"FAIL","category":"SANITIZED_EVIDENCE_WRITE_FAILED"}\n');}
if(failed||interrupted)process.exitCode=1;
