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
      await assert.rejects(control({...f.paths,action:'watchdog',job}),/GATE_OTHER_OWNER/);assert.equal(g.state.paused,true);
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
