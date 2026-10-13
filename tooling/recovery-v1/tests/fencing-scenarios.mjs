// Synthetic-only verification. This file is not a live supervisor or deployment tool.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { fixture,gateFixture,sign } from './fixtures.mjs';
import { control } from '../gate-control.mjs';
import { loadOperation,canonical,SafeError } from '../lib/security.mjs';
import { pause } from '../lib/gate.mjs';
const exec=promisify(execFile),self=fileURLToPath(import.meta.url);
export const scenarioNames=['RUNNING_RELEASE_REJECTED','EXACT_EXPORTER_STOP_RELEASE','WRONG_CONTAINER_IDENTITY',
  'INSPECT_FAILURE_CLOSED','STOP_FAILURE_CLOSED','SUPERVISOR_INTERRUPTION_RECOVERY','EXPORTER_CRASH_INDEPENDENT_WATCHDOG',
  'STALE_LEASE_FENCED','WRONG_GENERATION_FENCED','MISSING_CONTAINER_FAIL_CLOSED','WATCHDOG_INTERRUPTION_RECOVERY'];
const knownCodes=['OWNED_JOB_CONTROL_FAILED','OWNED_JOB_STILL_RUNNING','JOB_IDENTITY_MISMATCH','JOB_RECEIPT',
  'GATE_LEASE_CHANGED','GATE_REQUEST_FAILED','GATE_RELEASE_PROOF','SIGNATURE_INVALID','WATCHDOG_DEADLINE','CANCELLED','EEXIST'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const quoted=value=>"'"+value.replaceAll("'","'\\''")+"'";
async function privateJSON(file){const s=await fs.lstat(file);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.size<=16384&&(s.mode&0o077)===0);return JSON.parse(await fs.readFile(file,'utf8'));}
async function dockerShim(configPath,args){
  assert.equal(process.platform,'linux');const c=await privateJSON(configPath);
  assert.deepEqual(Object.keys(c).sort(),['docker','allowedIds','fault','trace'].sort());assert.ok(path.isAbsolute(c.docker));
  assert.ok(['none','inspect_fail','stop_fail','stop_noop'].includes(c.fault));assert.ok(c.allowedIds.every(x=>/^[a-f0-9]{64}$/.test(x)));
  const cid=args.at(-1);assert.ok(c.allowedIds.includes(cid));
  const inspect=args.length===4&&args[0]==='inspect'&&args[1]==='--format'&&[
    '{{index .Config.Labels "psai.operation"}}|{{.HostConfig.RestartPolicy.Name}}|{{.Image}}','{{json .State}}'].includes(args[2]);
  const stop=args.length===4&&args[0]==='stop'&&args[1]==='--time'&&args[2]==='1';assert.ok(inspect||stop);
  const event=inspect?(args[2].includes('Labels')?'IDENTITY_INSPECT':'STATE_INSPECT'):'STOP';
  await fs.appendFile(c.trace,event+'\n',{mode:0o600});
  if(inspect&&c.fault==='inspect_fail'||stop&&c.fault==='stop_fail'){process.exitCode=86;return;}
  if(stop&&c.fault==='stop_noop')return;
  // Real Docker transport, never fabricated successful inspect or stop results.
  const result=await exec(c.docker,args,{timeout:4500,maxBuffer:16384,shell:false,env:{PATH:process.env.PATH}});
  process.stdout.write(result.stdout);
}
async function controller(file){
  const p=await privateJSON(file);assert.deepEqual(Object.keys(p).sort(),['paths','action'].sort());
  assert.ok(['resume','watchdog','hold'].includes(p.action));
  const hardStop=setTimeout(()=>process.exit(1),35000);
  try{
    if(p.action==='hold'){
      await control({...p.paths,action:'status'});process.send?.({event:'HOLD_READY'});await new Promise(()=>setInterval(()=>{},1000));
    }else{await control({...p.paths,action:p.action});process.send?.({event:'RESULT',status:'PASS'});}
  }catch(e){process.send?.({event:'RESULT',status:'REJECTED',code:knownCodes.includes(e?.code)?e.code:'UNEXPECTED_CONTROLLER_FAILURE'});process.exitCode=1;}
  finally{clearTimeout(hardStop);}
}

export async function runFencing(h){
  assert.equal(process.platform,'linux');assert.equal(process.env.PSAI_FENCING_CLOUD_APPROVED,'true');
  const outcomes=[];let selected='SETUP',failure=null;
  async function scenario(name,fn){
    assert.equal(h.isInterrupted(),false);
    selected=name;assert.ok(scenarioNames.includes(name));
    const cleaners=[],children=[];let g,proxy,exporterId;const observations=[];
    const t={after(fn){cleaners.push(fn);}};
    try{
      g=await gateFixture(t);
      proxy=http.createServer(async(req,res)=>{
        try{
          const body=[];let bytes=0;for await(const b of req){bytes+=b.length;if(bytes>4096)throw new Error('SIZE');body.push(b);}
          if(req.method==='DELETE'){
            // Observation only. Never block/alter gate release to conceal a controller defect.
            const d=await h.inspect(exporterId);
            observations.push({event:'DELETE_OBSERVED',running:d.State.Running,restart:d.HostConfig.RestartPolicy.Name,
              exactId:d.Id===exporterId,operation:d.Config.Labels['psai.operation']});
          }
          const response=await fetch(g.endpoint+'/api/internal/backup-write-gate',{method:req.method,headers:{
            Authorization:req.headers.authorization||'','Content-Type':'application/json'},...(req.method==='GET'?{}:{body:Buffer.concat(body)}),signal:AbortSignal.timeout(2500)});
          res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());
        }catch{res.writeHead(503);res.end('{}');}
      });
      await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
      cleaners.push(()=>new Promise(r=>{proxy.closeAllConnections();proxy.close(r);}));
      const f=await fixture(t,{gate:{endpoint:'http://127.0.0.1:'+proxy.address().port,contract:'owned-lease-v1'},maxRuntimeMs:30000,imageDigest:h.imageId.slice(7)});
      f.context.imageId=h.imageId.slice(7);await f.save();const c=await loadOperation(f.paths,'gate');await pause(c);
      exporterId=await h.createExporter(f.op.operationId,false);const original=await h.inspect(exporterId);
      assert.equal(original.State.Running,true);assert.equal(original.RestartCount,0);
      assert.deepEqual(original.Mounts.filter(m=>m.Type==='bind'),[]);assert.equal(original.HostConfig.NetworkMode,'none');
      const shimDir=path.join(f.root,'bin');await fs.mkdir(shimDir,{mode:0o700});
      const trace=path.join(f.root,'trace');await fs.writeFile(trace,'',{mode:0o600});
      const shimConfig=path.join(f.root,'docker-control.json');let fault='none',allowedIds=[exporterId];
      async function setFault(value){fault=value;await fs.writeFile(shimConfig,JSON.stringify({docker:h.dockerPath,allowedIds,fault,trace}),{mode:0o600});}
      await setFault('none');
      const wrapper='#!/bin/sh\nexec '+quoted(process.execPath)+' '+quoted(self)+' --docker-shim '+quoted(shimConfig)+' "$@"\n';
      await fs.writeFile(path.join(shimDir,'docker'),wrapper,{mode:0o700});
      const deadline=new Date(Date.now()+10000).toISOString();
      const job={role:'job',operationHash:c.operationHash,runnerId:c.op.runnerId,containerId:exporterId,imageId:h.imageId.slice(7),imageDigest:c.op.imageDigest,deadline};
      const jobFile=path.join(f.root,'job.json');await fs.writeFile(jobFile,canonical(sign(job,f.runtime.privateKey)),{mode:0o600});
      let nextChild=0;
      async function start(action){
        const config=path.join(f.root,'controller-'+(nextChild++)+'.json');await fs.writeFile(config,JSON.stringify({paths:{...f.paths,job:jobFile},action}),{mode:0o600});
        const child=spawn(process.execPath,[self,'--controller',config],{cwd:h.root,shell:false,detached:true,
          env:{PATH:shimDir+path.delimiter+path.dirname(process.execPath)+path.delimiter+'/usr/bin:/bin'},stdio:['ignore','ignore','ignore','ipc']});
        const entry={child,messages:[]};children.push(entry);child.on('message',m=>entry.messages.push(m));child.on('error',()=>{});
        entry.done=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
        await h.trackController(child.pid,self,config);
        return entry;
      }
      async function until(check){for(let i=0;i<140;i++){assert.equal(h.isInterrupted(),false);if(await check())return;await sleep(25);}assert.fail('Expected supervised condition not observed');}
      async function armed(){await until(async()=>((await fs.readFile(trace,'utf8')).match(/STATE_INSPECT/g)||[]).length>0);}
      async function result(entry){
        const exit=await Promise.race([entry.done,sleep(12000).then(()=>{throw new Error('Controller timeout');})]);
        const messages=entry.messages.filter(m=>m?.event==='RESULT');assert.equal(messages.length,1);return {...messages[0],exit};
      }
      async function reject(code){const r=await result(await start('resume'));assert.equal(r.status,'REJECTED');assert.equal(r.code,code);assert.equal(r.exit.code,1);assert.equal(g.state.paused,true);assert.equal(observations.length,0);}
      async function opened(entry){
        const r=await result(entry);assert.equal(r.status,'PASS');assert.equal(r.exit.code,0);assert.equal(g.state.paused,false);
        assert.equal(observations.length,1);const d=observations[0];assert.equal(d.running,false);assert.equal(d.exactId,true);assert.equal(d.restart,'no');assert.equal(d.operation,f.op.operationId);
        const stopped=await h.inspect(exporterId);assert.equal(stopped.State.Running,false);assert.equal(stopped.RestartCount,0);
        assert.equal(stopped.State.Pid,0);assert.ok(['exited','dead'].includes(stopped.State.Status));
      }
      const api={g,f,c,job,jobFile,exporterId,trace,start,result,reject,opened,armed,until,setFault,observations,
        allow:async cid=>{allowedIds=[...allowedIds,cid];await setFault(fault);},writeJob:async()=>fs.writeFile(jobFile,canonical(sign(job,f.runtime.privateKey)),{mode:0o600})};
      await fn(api);
      assert.equal(children.every(x=>x.child.pid!==original.State.Pid),true);
      outcomes.push({scenario:name,status:'PASS',realDocker:true,independentControllerProcess:true});
    }finally{
      for(const entry of children){if(entry.child.exitCode===null&&entry.child.signalCode===null)process.kill(-entry.child.pid,'SIGKILL');await entry.done;}
      for(const clean of cleaners.reverse())await clean();
      // Containers remain in the driver's exclusive ownership ledger; cleanup never releases a gate.
    }
  }
  try{
    await scenario('RUNNING_RELEASE_REJECTED',async x=>{
      await x.setFault('stop_noop');await x.reject('OWNED_JOB_STILL_RUNNING');assert.equal((await h.inspect(x.exporterId)).State.Running,true);
      assert.ok((await fs.readFile(x.trace,'utf8')).includes('STOP'));assert.equal(x.g.state.paused,true);
    });
    await scenario('EXACT_EXPORTER_STOP_RELEASE',async x=>{
      await x.opened(await x.start('resume'));
      const events=(await fs.readFile(x.trace,'utf8')).trim().split('\n');assert.deepEqual(events,['IDENTITY_INSPECT','STATE_INSPECT','STOP','STATE_INSPECT']);
    });
    await scenario('WRONG_CONTAINER_IDENTITY',async x=>{
      const decoy=await h.createExporter('psai-recovery-'+crypto.randomUUID(),true);await x.allow(decoy);x.job.containerId=decoy;await x.writeJob();
      await x.reject('JOB_IDENTITY_MISMATCH');assert.equal((await h.inspect(x.exporterId)).State.Running,true);assert.equal((await h.inspect(decoy)).State.Running,true);
      assert.ok(!(await fs.readFile(x.trace,'utf8')).includes('STOP'));
    });
    await scenario('INSPECT_FAILURE_CLOSED',async x=>{await x.setFault('inspect_fail');await x.reject('OWNED_JOB_CONTROL_FAILED');assert.equal((await h.inspect(x.exporterId)).State.Running,true);});
    await scenario('STOP_FAILURE_CLOSED',async x=>{await x.setFault('stop_fail');await x.reject('OWNED_JOB_CONTROL_FAILED');assert.equal((await h.inspect(x.exporterId)).State.Running,true);});
    await scenario('SUPERVISOR_INTERRUPTION_RECOVERY',async x=>{
      const primary=await x.start('hold');await x.until(()=>primary.messages.some(m=>m.event==='HOLD_READY'));
      const watchdog=await x.start('watchdog');await x.armed();assert.notEqual(primary.child.pid,watchdog.child.pid);
      primary.child.kill('SIGKILL');await primary.done;assert.equal(x.g.state.paused,true);assert.equal((await h.inspect(x.exporterId)).State.Running,true);
      await x.opened(watchdog);
    });
    await scenario('EXPORTER_CRASH_INDEPENDENT_WATCHDOG',async x=>{
      const watchdog=await x.start('watchdog');await x.armed();await h.killExporter(x.exporterId);await x.opened(watchdog);
      assert.ok(!(await fs.readFile(x.trace,'utf8')).includes('STOP'),'Already crashed exporter needs verified inspections, not fabricated stop');
    });
    for(const name of ['STALE_LEASE_FENCED','WRONG_GENERATION_FENCED'])await scenario(name,async x=>{
      if(name==='STALE_LEASE_FENCED')x.g.state.leaseId=crypto.randomUUID();else x.g.state.generation+=2;
      const before={...x.g.state};await x.reject('GATE_LEASE_CHANGED');assert.equal((await h.inspect(x.exporterId)).State.Running,false);assert.deepEqual(x.g.state,before);
    });
    await scenario('MISSING_CONTAINER_FAIL_CLOSED',async x=>{await h.removeExporter(x.exporterId);await x.reject('OWNED_JOB_CONTROL_FAILED');});
    await scenario('WATCHDOG_INTERRUPTION_RECOVERY',async x=>{
      const watchdog=await x.start('watchdog');await x.armed();watchdog.child.kill('SIGKILL');await watchdog.done;
      assert.equal(x.g.state.paused,true);assert.equal((await h.inspect(x.exporterId)).State.Running,true);
      const recovery=await x.start('resume');assert.notEqual(recovery.child.pid,watchdog.child.pid);await x.opened(recovery);
      // The interrupted watchdog ledger is never deleted/replayed; recovery is an explicit signed resume.
      const ledger=path.join(x.f.paths.work,'ledger',x.f.op.operationId+'-watchdog.json');assert.ok((await fs.stat(ledger)).isFile());
    });
    assert.deepEqual(outcomes.map(x=>x.scenario),scenarioNames);
  }catch(e){failure={scenario:scenarioNames.includes(selected)?selected:'SETUP',category:e?.code==='ERR_ASSERTION'?'ASSERTION_FAILED':knownCodes.includes(e?.code)?e.code:'FENCING_SCENARIO_FAILED'};}
  return {label:'SYNTHETIC DOCKER FENCING ONLY; NOT HOST-LOSS OR LIVE BACKUP PROOF',status:failure?'FAIL':'PASS',
    expected:scenarioNames.length,pass:outcomes.length,outcomes,failure,gate:'Existing owned-lease fixture; PostgreSQL not rerun',
    dockerTransport:'REAL; explicit inspection/stop fault injection cases only',physicalHostFencing:'UNVERIFIED',liveGateEnabled:false};
}

if(process.argv[1]&&path.resolve(process.argv[1])===self){
  try{
    if(process.argv[2]==='--docker-shim')await dockerShim(process.argv[3],process.argv.slice(4));
    else if(process.argv[2]==='--controller'){assert.equal(process.argv.length,4);await controller(process.argv[3]);}
    else throw new SafeError('EXPLICIT_TEST_MODE_REQUIRED');
  }catch{process.exitCode=1;}
}
