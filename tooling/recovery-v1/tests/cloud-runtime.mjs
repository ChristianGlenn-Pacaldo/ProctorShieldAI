import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fixture,gateFixture,sign } from './fixtures.mjs';
import { loadOperation,canonical,sha,begin,secureDirectory } from '../lib/security.mjs';
import { pause,release } from '../lib/gate.mjs';
import { control } from '../gate-control.mjs';
import { cleanup } from '../cleanup-owned.mjs';

// Local verification executes the unchanged control/job logic with only Docker transport mocked.
// It is never selected by CI and does not invoke Docker or verify real process termination.
async function localMockTests(){
  assert.notEqual(process.env.CI,'true','Local mock mode is forbidden in cloud CI');
  assert.equal(process.argv.length,3);
  const {default:test}=await import('node:test');
  const {default:vm}=await import('node:vm');
  const {default:ts}=await import('typescript');
  const security=await import('../lib/security.mjs'),processTools=await import('../lib/process.mjs'),gateTools=await import('../lib/gate.mjs');
  async function setup(t,{stillRunning=false,stopFailure=false,badIdentity=false}={}){
    const g=await gateFixture(t),f=await fixture(t,{gate:{endpoint:g.endpoint,contract:'owned-lease-v1'}}),c=await loadOperation(f.paths,'gate');
    await pause(c);let running=true;const commands=[];
    const cid='a'.repeat(64),job={role:'job',operationHash:c.operationHash,runnerId:f.op.runnerId,containerId:cid,
      imageId:c.runtime.imageId,imageDigest:c.op.imageDigest,deadline:new Date(Date.now()-1).toISOString()};
    const jobPath=path.join(f.root,'job.json');await fs.writeFile(jobPath,canonical(sign(job,f.runtime.privateKey)));
    function mockExec(program,args,options,callback){
      assert.equal(program,'docker');assert.equal(options.shell,false);commands.push(args[0]);
      let stdout='';let error=null;
      if(args[0]==='inspect'&&args[2].includes('.Config.Labels'))stdout=badIdentity?'unowned|no|sha256:'+job.imageId:f.op.operationId+'|no|sha256:'+job.imageId;
      else if(args[0]==='inspect'&&args[2]==='{{json .State}}')stdout=JSON.stringify({Running:running,Status:running?'running':'exited'});
      else if(args[0]==='stop'){
        assert.equal(args.at(-1),cid);assert.equal(g.state.paused,true,'No release before termination proof');
        if(stopFailure)error=new Error('SYNTHETIC_CONTROL_FAILURE');else if(!stillRunning)running=false;
      }else assert.fail('Unexpected mocked Docker command');
      queueMicrotask(()=>callback(error,stdout,''));
    }
    mockExec[promisify.custom]=async(...args)=>await new Promise((resolve,reject)=>mockExec(...args,(e,stdout,stderr)=>e?reject(e):resolve({stdout,stderr})));
    async function compile(file,imports){
      let source=await fs.readFile(new URL(file,import.meta.url),'utf8');
      source=source.replace('if(isMain(import.meta.url)) await cli(control);','');
      const output=ts.transpileModule(source,{compilerOptions:{allowJs:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
      const vmModule={exports:{}};
      vm.runInNewContext(output,{module:vmModule,exports:vmModule.exports,require(name){assert.ok(name in imports,'Unapproved mock import');return imports[name];},Buffer,process,console,setTimeout,clearTimeout,Date,JSON},{filename:path.basename(file)});
      return vmModule.exports;
    }
    const jobs=await compile('../lib/job.mjs',{'node:child_process':{execFile:mockExec},'node:util':{promisify},'./security.mjs':security});
    const controls=await compile('../gate-control.mjs',{'node:path':{default:path},'./lib/security.mjs':security,'./lib/process.mjs':processTools,'./lib/gate.mjs':gateTools,'./lib/job.mjs':jobs});
    return {g,f,c,job,jobPath,commands,run:action=>controls.control({...f.paths,job:jobPath,action}),running:()=>running};
  }
  test('mock supervisor resume verifies signed job and termination before release',async t=>{
    const x=await setup(t);await x.run('resume');assert.equal(x.running(),false);assert.equal(x.g.state.paused,false);
    assert.deepEqual(x.commands,['inspect','inspect','stop','inspect']);
  });
  test('mock supervisor refuses release while exporter remains running',async t=>{
    const x=await setup(t,{stillRunning:true});await assert.rejects(x.run('resume'),{code:'OWNED_JOB_STILL_RUNNING'});assert.equal(x.g.state.paused,true);
  });
  test('mock supervisor stop failure leaves freeze owned',async t=>{
    const x=await setup(t,{stopFailure:true});await assert.rejects(x.run('resume'),{code:'OWNED_JOB_CONTROL_FAILED'});assert.equal(x.g.state.paused,true);
  });
  test('mock supervisor rejects mismatched actual job identity',async t=>{
    const x=await setup(t,{badIdentity:true});await assert.rejects(x.run('resume'),{code:'JOB_IDENTITY_MISMATCH'});assert.equal(x.g.state.paused,true);assert.ok(!x.commands.includes('stop'));
  });
  test('mock supervisor rejects tampered signed job before process control',async t=>{
    const x=await setup(t);x.job.containerId='b'.repeat(64);await fs.writeFile(x.jobPath,canonical({payload:x.job,signature:'invalid'}));
    await assert.rejects(x.run('resume'),{code:'SIGNATURE_INVALID'});assert.equal(x.g.state.paused,true);assert.deepEqual(x.commands,[]);
  });
  test('mock supervisor requires explicit stopped-job receipt for manual resume',async t=>{
    const x=await setup(t);await fs.rm(x.jobPath);await assert.rejects(x.run('resume'),{code:'ENOENT'});assert.equal(x.g.state.paused,true);assert.deepEqual(x.commands,[]);
  });
  test('mock watchdog deadline stops exact exporter before release',async t=>{
    const x=await setup(t);await x.run('watchdog');assert.equal(x.running(),false);assert.equal(x.g.state.paused,false);assert.ok(x.commands.includes('stop'));
  });
  test('mock watchdog never releases a changed owner',async t=>{
    const x=await setup(t);x.g.state.owner='b'.repeat(64);await assert.rejects(x.run('watchdog'),{code:'GATE_LEASE_CHANGED'});assert.equal(x.running(),false);assert.equal(x.g.state.paused,true);
  });
  test('mock supervisor cannot resume through unreachable gate',async t=>{
    const x=await setup(t);const fetchOriginal=globalThis.fetch;
    globalThis.fetch=async()=>{throw new TypeError('SYNTHETIC_NETWORK_UNREACHABLE');};
    try{await assert.rejects(x.run('resume'),{name:'TypeError',message:'SYNTHETIC_NETWORK_UNREACHABLE'});}finally{globalThis.fetch=fetchOriginal;}
    assert.equal(x.running(),false);assert.equal(x.g.state.paused,true);
  });
}
if(process.argv[2]==='--local-mock'){
  await localMockTests();
}else{
const exec=promisify(execFile);
if(process.env.CI!=='true'||process.env.PSAI_SYNTHETIC_CLOUD_APPROVED!=='true')throw new Error('Approved synthetic CI only');
const image=process.argv[2],manifest=process.argv[3];assert.match(image,/^sha256:[a-f0-9]{64}$/);assert.match(manifest,/^sha256:[a-f0-9]{64}$/);
const docker=async args=>(await exec('docker',args,{timeout:15000,maxBuffer:1024*1024})).stdout.trim();
const cleaners=[];const t={after(fn){cleaners.push(fn);}};
const outcomes=[];let removed=0;
try{
  for(const kind of ['runner_kill','deadline','other_pause_owner','owned_cleanup']){
    const g=await gateFixture(t),f=await fixture(t,{gate:{endpoint:g.endpoint,contract:'owned-lease-v1'},maxRuntimeMs:10000,imageDigest:manifest.slice(7)});
    f.context.imageId=image.slice(7);await f.save();
    const c=await loadOperation(f.paths,'gate');await pause(c);
    const name='psai-watch-'+crypto.randomUUID();
    const cid=await docker(['run','-d','--name',name,'--label','psai.operation='+f.op.operationId,
      '--restart=no','--network=none','--read-only','--user','1001:1001','--cap-drop=ALL','--security-opt=no-new-privileges',
      '--pids-limit=32','--memory=128m','--entrypoint','node',image,'-e','setInterval(()=>{},1000)']);
    cleaners.push(async()=>{
      assert.equal(await docker(['inspect','--format','{{index .Config.Labels "psai.operation"}}|{{.Image}}',cid]),f.op.operationId+'|'+image);
      await docker(['stop','--time','1',cid]);
      assert.equal(await docker(['inspect','--format','{{.State.Running}}',cid]),'false');
      await docker(['rm',cid]);
      removed++;
    });
    const label=await docker(['inspect','--format','{{.HostConfig.RestartPolicy.Name}}|{{.Config.User}}|{{.HostConfig.ReadonlyRootfs}}|{{.HostConfig.NetworkMode}}',cid]);
    assert.equal(label,'no|1001:1001|true|none');
    const j={role:'job',operationHash:c.operationHash,runnerId:f.op.runnerId,containerId:cid,imageId:image.slice(7),imageDigest:manifest.slice(7),deadline:new Date(Date.now()+500).toISOString()};
    const job=path.join(f.root,'job.json');await fs.writeFile(job,canonical(sign(j,f.runtime.privateKey)));
    if(kind==='runner_kill'){
      const watching=control({...f.paths,action:'watchdog',job});
      await new Promise(r=>setTimeout(r,100));await docker(['kill','--signal=KILL',cid]);await watching;
      assert.equal(g.state.paused,false);
    }else if(kind==='deadline'){
      await control({...f.paths,action:'watchdog',job});assert.equal(g.state.paused,false);
    }else if(kind==='other_pause_owner'){
      g.state.owner='another-owner';g.state.operationId='another-operation';
      await assert.rejects(control({...f.paths,action:'watchdog',job}),/GATE_LEASE_CHANGED/);assert.equal(g.state.paused,true);
    }else{
      await docker(['stop','--time','1',cid]);
      await begin(c,'backup');const owned=await secureDirectory(c.workRoot,c.op.operationId+'-backup');await fs.writeFile(path.join(owned,'cipher.bin'),'synthetic');
      const unrelated=path.join(c.workRoot,'unrelated');await fs.mkdir(unrelated);await fs.writeFile(path.join(unrelated,'keep'),'keep');
      await cleanup({...f.paths,job});
      await assert.rejects(fs.stat(owned),{code:'ENOENT'});assert.equal(await fs.readFile(path.join(unrelated,'keep'),'utf8'),'keep');
      assert.ok((await fs.readdir(path.join(c.workRoot,'ledger'))).some(x=>x.endsWith('-backup.json')));
      await release(c);assert.equal(g.state.paused,false);
    }
    assert.equal(await docker(['inspect','--format','{{.RestartCount}}|{{.State.Running}}',cid]),'0|false');
    outcomes.push({scenario:kind,status:'PASS'});
  }
}finally{
  let failure;
  for(const fn of cleaners.reverse()){try{await fn();}catch(e){failure??=e;}}
  if(failure)throw new Error('OWNED_CLOUD_RUNTIME_CLEANUP_FAILED');
}
assert.equal(removed,4);
await fs.mkdir('evidence',{recursive:true});
await fs.writeFile('evidence/cloud-runtime-sanitized.json',JSON.stringify({label:'NOT FOR LIVE DATA OR STAGING DEPLOYMENT',
  outcomes,ownedContainersRemoved:removed,cleanup:'PASS',remoteObjectDeletes:0},null,2));

}
