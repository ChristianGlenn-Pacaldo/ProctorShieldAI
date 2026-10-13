// One reviewed synthetic run; no database, object storage, Railway or live backup calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runFencing,scenarioNames } from './fencing-scenarios.mjs';
const exec=promisify(execFile),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const parent='5b5a1c0a3caae308d472ada7ebfdaebfe45df1e2',tree='1a0a65e642cfb0783a8dbdcc122258fe27075f44';
const branch='codex/independent-fencing-verification-20261013',repo='ChristianGlenn-Pacaldo/ProctorShieldAI';
const additions=['.github/workflows/independent-fencing.yml','tooling/recovery-v1/tests/fencing-cloud-driver.mjs','tooling/recovery-v1/tests/fencing-scenarios.mjs'];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
let stage='PREFLIGHT',failed=false,interrupted=false,ledger=null,ledgerSaved=false,imageId=null,result=null,cleanupResult=null;
const abort=new AbortController(),interrupt=()=>{interrupted=true;abort.abort();};process.once('SIGTERM',interrupt);process.once('SIGINT',interrupt);
const command=async(file,args,timeout=15000,cleanup=false)=>(await exec(file,args,{cwd:root,timeout,maxBuffer:2*1024*1024,shell:false,
  ...(cleanup?{}:{signal:abort.signal})})).stdout.trim();
const docker=(args,timeout=15000,cleanup=false)=>command('docker',args,timeout,cleanup);
const tempBase=os.tmpdir(),initialTMPDIR=process.env.TMPDIR;
const ledgerPath=path.join(tempBase,'psai-fencing-'+process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT+'.json');
async function preflight(){
  assert.equal(process.platform,'linux');assert.equal(Number(process.versions.node.split('.')[0]),24);assert.equal(process.env.CI,'true');
  assert.equal(process.env.PSAI_FENCING_CLOUD_APPROVED,'true');assert.equal(process.env.GITHUB_REPOSITORY,repo);assert.equal(process.env.GITHUB_REF,'refs/heads/'+branch);
  assert.match(process.env.GITHUB_SHA||'',/^[a-f0-9]{40}$/);assert.match(process.env.GITHUB_RUN_ID||'',/^\d+$/);assert.match(process.env.GITHUB_RUN_ATTEMPT||'',/^\d+$/);
  assert.ok(!Object.entries(process.env).some(([k,v])=>v&&/^(?:PG|DATABASE_URL|DIRECT_URL|RAILWAY_|NEON_|AWS_|S3_|GOOGLE_|SMTP_|RESEND_)/.test(k)));
  assert.equal(await command('git',['rev-parse','HEAD']),process.env.GITHUB_SHA);assert.equal(await command('git',['rev-parse','HEAD^']),parent);
  assert.equal(await command('git',['rev-parse','HEAD^^{tree}']),tree);
  assert.deepEqual((await command('git',['diff','--name-status',parent,'HEAD'])).split('\n').sort(),additions.map(n=>'A\t'+n).sort());
  const status=await command('git',['status','--porcelain']);assert.ok(status===''||process.argv[2]==='--cleanup'&&status==='?? fencing-evidence/');
  await command('git',['diff','--check',parent,'HEAD']);
  // No existing application/tooling byte may differ from the verified parent.
  assert.equal((await command('git',['diff','--name-only','--diff-filter=MDR',parent,'HEAD'])),'');
  const security=await fs.readFile(path.join(root,'tooling/recovery-v1/lib/security.mjs'),'utf8');
  assert.equal(sha(security),'d058ed11f53a5a6d96946aa58137b2fa367dcb25632880f5b106e70ff3605ce1');
  assert.ok(security.includes("if(op.mode==='live') throw new SafeError('LIVE_GATE_INTEGRATION_UNVERIFIED');"));
  assert.ok(security.includes("if(mode==='live') throw new SafeError('LIVE_GATE_INTEGRATION_UNVERIFIED');"));
  assert.ok(!(await fs.readdir(root)).some(n=>/^\.env(?:\.|$)/.test(n)&&n!=='.env.example'));
}
async function resourceGuard(){
  const mem=Number((await fs.readFile('/proc/meminfo','utf8')).match(/^MemAvailable:\s+(\d+)/m)[1]),disk=await fs.statfs(root);
  assert.ok(mem>=2500*1024&&Number(disk.bavail)*Number(disk.bsize)>=6*1024**3);
}
async function saveLedger(){
  const data=JSON.stringify(ledger);if(!ledgerSaved){await fs.writeFile(ledgerPath,data,{mode:0o600,flag:'wx'});ledgerSaved=true;}
  else{
    const s=await fs.lstat(ledgerPath);assert.ok(s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o077)===0);
    const next=path.join(ledger.scratch,'ledger-'+crypto.randomUUID()+'.json');await fs.writeFile(next,data,{mode:0o600,flag:'wx'});await fs.rename(next,ledgerPath);
  }
}
async function owned(name){
  assert.ok(ledger.containers.some(x=>x.name===name));const d=JSON.parse(await docker(['inspect',name],15000,true))[0];
  assert.equal(d.Config.Labels['psai.fencing.owner'],ledger.owner);assert.equal(d.HostConfig.RestartPolicy.Name,'no');return d;
}
async function remove(name){
  const d=await owned(name);await docker(['stop','--time','1',d.Id],15000,true);assert.equal((await owned(name)).State.Running,false);
  await docker(['rm','-v',d.Id],15000,true);ledger.removed++;await saveLedger();
}
async function cleanup(){
  if(!ledger)return {status:'NOT_CREATED',ownedContainersRemoved:0};
  assert.match(ledger.owner,/^psai-fencing-[a-f0-9-]{36}$/);assert.equal(ledger.tag,ledger.owner+':test');
  assert.ok(Array.isArray(ledger.containers)&&ledger.containers.length<=20);
  assert.ok(Array.isArray(ledger.controllers)&&ledger.controllers.length<=30);
  const startTime=raw=>raw.slice(raw.lastIndexOf(')')+2).trim().split(/\s+/)[19];
  let controllersStopped=0;
  for(const c of ledger.controllers){
    assert.ok(Number.isInteger(c.pid)&&c.pid>1&&/^\d+$/.test(c.start));
    assert.equal(c.script,path.join(root,'tooling/recovery-v1/tests/fencing-scenarios.mjs'));
    assert.ok(c.config.startsWith(ledger.scratch+path.sep));
    let stat;try{stat=await fs.readFile('/proc/'+c.pid+'/stat','utf8');}catch(e){if(e.code==='ENOENT')continue;throw e;}
    // A recycled PID is never targeted.
    assert.equal(startTime(stat),c.start);
    const args=(await fs.readFile('/proc/'+c.pid+'/cmdline','utf8')).split('\0').filter(Boolean);
    assert.deepEqual(args,[process.execPath,c.script,'--controller',c.config]);
    process.kill(-c.pid,'SIGKILL');controllersStopped++;
    let stopped=false;for(let i=0;i<60;i++){
      try{const current=await fs.readFile('/proc/'+c.pid+'/stat','utf8');if(startTime(current)!==c.start||current.slice(current.lastIndexOf(')')+2).startsWith('Z ')){stopped=true;break;}}
      catch(e){if(e.code==='ENOENT'){stopped=true;break;}throw e;}await new Promise(r=>setTimeout(r,25));
    }assert.equal(stopped,true);
  }
  for(const item of [...ledger.containers].reverse()){
    assert.match(item.name,new RegExp('^'+ledger.owner+'-[0-9]{1,2}$'));
    const names=await docker(['container','ls','-a','--filter','name=^/'+item.name+'$','--format','{{.Names}}'],15000,true);
    if(names){assert.equal(names,item.name);await remove(item.name);}
  }
  const images=await docker(['image','ls','--filter','reference='+ledger.tag,'--format','{{.ID}}'],15000,true);let imageRemoved=false;
  if(images){const d=JSON.parse(await docker(['image','inspect',ledger.tag],15000,true))[0];assert.equal(d.Config.Labels['psai.fencing.owner'],ledger.owner);await docker(['image','rm',ledger.tag],15000,true);imageRemoved=true;}
  assert.equal(path.dirname(ledger.scratch),tempBase);assert.ok(path.basename(ledger.scratch).startsWith(ledger.owner+'-'));
  const s=await fs.lstat(ledger.scratch).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(s){assert.ok(s.isDirectory()&&!s.isSymbolicLink());await fs.rm(ledger.scratch,{recursive:true,force:false});}
  const done={status:'PASS',ownedContainersRemoved:ledger.removed,expectedContainers:ledger.containers.length,ownedControllersStopped:controllersStopped,imageRemoved,scratchRemoved:true,networkCreated:false,storageDeletes:0};
  assert.equal(done.ownedContainersRemoved,done.expectedContainers);await fs.rm(ledgerPath,{force:false});return done;
}
function safeResult(value){
  assert.deepEqual(Object.keys(value).sort(),['label','status','expected','pass','outcomes','failure','gate','dockerTransport','physicalHostFencing','liveGateEnabled'].sort());
  assert.equal(value.label,'SYNTHETIC DOCKER FENCING ONLY; NOT HOST-LOSS OR LIVE BACKUP PROOF');assert.equal(value.expected,11);assert.ok(['PASS','FAIL'].includes(value.status));
  assert.equal(value.gate,'Existing owned-lease fixture; PostgreSQL not rerun');assert.equal(value.dockerTransport,'REAL; explicit inspection/stop fault injection cases only');
  assert.equal(value.physicalHostFencing,'UNVERIFIED');assert.equal(value.liveGateEnabled,false);assert.equal(value.pass,value.outcomes.length);
  assert.ok(value.outcomes.length<=11);
  for(let i=0;i<value.outcomes.length;i++){
    const o=value.outcomes[i];assert.deepEqual(Object.keys(o).sort(),['scenario','status','realDocker','independentControllerProcess'].sort());
    assert.equal(o.scenario,scenarioNames[i]);assert.equal(o.status,'PASS');assert.equal(o.realDocker,true);assert.equal(o.independentControllerProcess,true);
  }
  if(value.failure){assert.deepEqual(Object.keys(value.failure).sort(),['category','scenario']);assert.ok([...scenarioNames,'SETUP'].includes(value.failure.scenario));
    assert.ok(['ASSERTION_FAILED','FENCING_SCENARIO_FAILED','OWNED_JOB_CONTROL_FAILED','OWNED_JOB_STILL_RUNNING','JOB_IDENTITY_MISMATCH','JOB_RECEIPT','GATE_LEASE_CHANGED','GATE_REQUEST_FAILED','GATE_RELEASE_PROOF','SIGNATURE_INVALID','WATCHDOG_DEADLINE','CANCELLED','EEXIST'].includes(value.failure.category));}
  if(value.status==='PASS'){assert.equal(value.pass,11);assert.equal(value.failure,null);}return value;
}
try{
  await preflight();
  if(process.argv[2]==='--preflight'){assert.equal(process.argv.length,3);process.stdout.write('{"preflight":"PASS","execution":"NOT_STARTED"}\n');}
  else if(process.argv[2]==='--cleanup'){
    assert.equal(process.argv.length,3);const s=await fs.lstat(ledgerPath).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(s){assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.size<=16384&&(s.mode&0o077)===0);ledger=JSON.parse(await fs.readFile(ledgerPath));ledgerSaved=true;cleanupResult=await cleanup();ledger=null;ledgerSaved=false;}
    else cleanupResult={status:'NOT_CREATED'};process.stdout.write(JSON.stringify({cleanup:cleanupResult.status})+'\n');
  }else{
    assert.equal(process.argv.length,2);await resourceGuard();
    const owner='psai-fencing-'+crypto.randomUUID(),scratch=await fs.mkdtemp(path.join(tempBase,owner+'-'));await fs.chmod(scratch,0o700);
    ledger={owner,scratch,tag:owner+':test',containers:[],controllers:[],removed:0};await saveLedger();stage='IMAGE_BUILD';
    await docker(['build','--platform','linux/amd64','--label','psai.fencing.owner='+owner,'--label','org.opencontainers.image.revision='+process.env.GITHUB_SHA,
      '--tag',ledger.tag,path.join(root,'tooling/recovery-v1')],12*60*1000);
    imageId=await docker(['image','inspect','--format','{{.Id}}',ledger.tag]);assert.match(imageId,/^sha256:[a-f0-9]{64}$/);
    assert.equal(await docker(['image','inspect','--format','{{.Config.User}}',imageId]),'1001:1001');await resourceGuard();stage='FENCING_SCENARIOS';
    let dockerPath;
    for(const directory of (process.env.PATH||'').split(path.delimiter)){const candidate=path.join(directory,'docker');try{await fs.access(candidate,1);dockerPath=await fs.realpath(candidate);break;}catch{}}
    assert.ok(dockerPath&&path.isAbsolute(dockerPath));
    const idToName=new Map();
    const inspect=async id=>{assert.ok(idToName.has(id));const d=await owned(idToName.get(id));assert.equal(d.Id,id);assert.equal(d.Image,imageId);return d;};
    const createExporter=async(operationId,decoy)=>{
      assert.match(operationId,/^psai-recovery-[a-f0-9-]{36}$/);assert.equal(typeof decoy,'boolean');assert.equal(interrupted,false);
      const name=owner+'-'+ledger.containers.length;assert.ok(ledger.containers.length<20);ledger.containers.push({name});await saveLedger();
      // TERM-resistant descendant ensures Docker container fencing covers more than a parent PID.
      const script="const{spawn}=require('node:child_process');spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"],{stdio:'ignore'});process.on('SIGTERM',()=>{});setInterval(()=>{},1000)";
      const cid=await docker(['create','--name',name,'--label','psai.fencing.owner='+owner,'--label','psai.operation='+operationId,
        '--restart=no','--stop-signal=SIGTERM','--network=none','--read-only','--user','1001:1001','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=32','--memory=96m','--cpus=0.5',
        '--tmpfs','/tmp:rw,nosuid,nodev,size=8m,mode=1777','--tmpfs','/var/lib/postgresql:ro,nosuid,nodev,size=1m','--entrypoint','node',imageId,'-e',script]);
      assert.match(cid,/^[a-f0-9]{64}$/);idToName.set(cid,name);const d=await inspect(cid);
      assert.equal(d.HostConfig.NetworkMode,'none');assert.deepEqual(d.HostConfig.PortBindings??{},{});assert.equal(d.HostConfig.Privileged,false);assert.equal(d.HostConfig.ReadonlyRootfs,true);
      assert.equal(d.Config.User,'1001:1001');assert.ok(d.HostConfig.CapDrop.includes('ALL'));assert.ok(d.Mounts.every(m=>m.Type==='tmpfs'));
      await docker(['start',cid]);return cid;
    };
    process.env.TMPDIR=scratch;
    const trackController=async(pid,script,config)=>{
      assert.ok(Number.isInteger(pid)&&pid>1);assert.ok(config.startsWith(scratch+path.sep));
      const stat=await fs.readFile('/proc/'+pid+'/stat','utf8'),start=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)[19];
      assert.match(start,/^\d+$/);ledger.controllers.push({pid,script,config,start});await saveLedger();
    };
    result=safeResult(await runFencing({root,imageId,dockerPath,inspect,createExporter,trackController,isInterrupted:()=>interrupted,
      killExporter:async id=>{await inspect(id);await docker(['kill','--signal=KILL',id]);},
      removeExporter:async id=>{await inspect(id);await remove(idToName.get(id));}}));
    assert.equal(result.status,'PASS');
  }
}catch{failed=true;}
finally{
  if(ledgerSaved&&ledger){try{cleanupResult=await cleanup();}catch{failed=true;cleanupResult={status:'FAIL'};}}
  if(initialTMPDIR===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=initialTMPDIR;
  process.off('SIGTERM',interrupt);process.off('SIGINT',interrupt);
}
try{
  if(process.argv.length===2){
    assert.ok(['PREFLIGHT','IMAGE_BUILD','FENCING_SCENARIOS'].includes(stage));await fs.mkdir(path.join(root,'fencing-evidence'),{recursive:true});
    const record={label:'SYNTHETIC ONLY; NO LIVE BACKUP OR HOST-LOSS APPROVAL',status:failed||interrupted?'FAIL':'PASS',stage,
      commit:process.env.GITHUB_SHA,parent,imageId,result,cleanup:cleanupResult||{status:'NOT_CREATED'},liveGateEnabled:false,
      physicalHostFencing:'UNVERIFIED',rawDiagnosticsWithheld:true};
    await fs.writeFile(path.join(root,'fencing-evidence/verification.json'),JSON.stringify(record,null,2)+'\n');
    process.stdout.write(JSON.stringify({status:record.status,stage,pass:result?.pass??0,cleanup:record.cleanup.status})+'\n');
  }else if(failed)process.stdout.write('{"status":"FAIL","category":"ISOLATED_PREFLIGHT_OR_CLEANUP_FAILED"}\n');
}catch{failed=true;process.stdout.write('{"status":"FAIL","category":"SANITIZED_EVIDENCE_WRITE_FAILED"}\n');}
if(failed||interrupted)process.exitCode=1;
