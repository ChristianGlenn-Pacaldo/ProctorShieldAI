import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const exec=promisify(execFile),root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
assert.equal(process.env.CI,'true');
assert.equal(process.env.PSAI_SYNTHETIC_CLOUD_APPROVED,'true');
assert.equal(process.env.GITHUB_REPOSITORY,'ChristianGlenn-Pacaldo/ProctorShieldAI');
assert.equal(process.env.GITHUB_REF,'refs/heads/codex/recovery-tooling-synthetic-20261013');
assert.equal(process.platform,'linux');
const label='psai-synthetic-'+crypto.randomUUID(),containers=new Set();
const network=label+'-internal',out=path.join(root,'evidence');
const pins=JSON.parse(await fs.readFile('image-pins.json','utf8'));
const pg=pins.images.postgres.pinnedReference;
assert.match(pg,/^postgres@sha256:[a-f0-9]{64}$/);
let netCreated=false,imageId,failed=false,interrupted=false;
const command=async (file,args,timeout=30000)=>(await exec(file,args,{cwd:root,timeout,maxBuffer:16*1024*1024,windowsHide:true,shell:false})).stdout.trim();
const docker=(args,timeout)=>command('docker',args,timeout);
const record=async(name,value)=>fs.writeFile(path.join(out,name),JSON.stringify(value,null,2)+'\n');
const cleanupResult={containersRemoved:0,networkRemoved:false,remoteObjectDeletes:0};
async function create(args){
  assert.equal(interrupted,false);
  const cid=await docker(['create','--label','psai.synthetic.owner='+label,...args]);
  assert.match(cid,/^[a-f0-9]{64}$/);containers.add(cid);return cid;
}
async function owned(cid){
  assert.ok(containers.has(cid));
  assert.equal(await docker(['inspect','--format','{{index .Config.Labels "psai.synthetic.owner"}}',cid]),label);
}
async function runBounded(cid,ms){
  await owned(cid);await docker(['start',cid]);
  try{
    const code=await docker(['wait',cid],ms);assert.equal(code,'0');
    return await docker(['logs',cid]);
  }catch{
    await owned(cid);await docker(['stop','--time','1',cid]);throw new Error('SYNTHETIC_CONTAINER_FAILED_OR_TIMED_OUT');
  }
}
function summary(raw){
  // Never publish raw test diagnostics, object contents, command environments or key material.
  const count=k=>{const m=raw.match(new RegExp('^# '+k+' (\\d+)$','m'));assert.ok(m);return Number(m[1]);};
  const value={tests:count('tests'),pass:count('pass'),fail:count('fail'),skipped:count('skipped')};
  assert.equal(value.fail,0);assert.equal(value.skipped,0);return value;
}
const interrupt=()=>{interrupted=true;};
process.once('SIGTERM',interrupt);process.once('SIGINT',interrupt);
await fs.mkdir(out,{recursive:true});
try{
  const mem=Number((await fs.readFile('/proc/meminfo','utf8')).match(/^MemAvailable:\s+(\d+)/m)[1]);
  const disk=await fs.statfs(root);
  assert.ok(mem>=2500*1024 && Number(disk.bavail)*Number(disk.bsize)>=6*1024**3);
  const meta=path.join(out,'build-metadata.private.json');
  await docker(['buildx','build','--load','--platform','linux/amd64','--metadata-file',meta,
    '--label','org.opencontainers.image.revision='+process.env.GITHUB_SHA,
    '--tag',label+':test','.'],15*60*1000);
  imageId=await docker(['image','inspect','--format','{{.Id}}',label+':test']);
  assert.match(imageId,/^sha256:[a-f0-9]{64}$/);
  assert.equal(await docker(['image','inspect','--format','{{.Config.User}}|{{index .Config.Labels "psai.usage"}}',imageId]),
    '1001:1001|NOT FOR LIVE DATA OR STAGING DEPLOYMENT');
  const bm=JSON.parse(await fs.readFile(meta,'utf8'));await fs.rm(meta);
  const manifestDigest=bm['containerimage.digest'];assert.match(manifestDigest,/^sha256:[a-f0-9]{64}$/);
  await record('build-provenance.json',{label:'NOT FOR LIVE DATA OR STAGING DEPLOYMENT',
    verificationCommit:process.env.GITHUB_SHA,applicationBaseline:'2f0df056f0a76c9d897625fd1edc5ac448405758',
    imageId,manifestDigest,baseImages:pins,published:false,exported:false,
    packageLockSha256:crypto.createHash('sha256').update(await fs.readFile('package-lock.json')).digest('hex')});
  const restrictions=['--restart=no','--read-only','--user','1001:1001','--cap-drop=ALL',
    '--security-opt=no-new-privileges','--pids-limit=128','--memory=1g','--cpus=2',
    '--tmpfs','/tmp:rw,nosuid,nodev,size=256m,mode=1777','--tmpfs','/work:rw,nosuid,nodev,size=64m,uid=1001,gid=1001,mode=0700'];
  const unit=await create([...restrictions,'--network=none',imageId,'--test','--test-reporter=tap','--test-concurrency=1','/opt/recovery/tests/unit.test.mjs']);
  await record('unit-results.json',{...summary(await runBounded(unit,120000)),platform:'Linux actual built image'});
  await docker(['network','create','--internal','--label','psai.synthetic.owner='+label,network]);netCreated=true;
  assert.equal(await docker(['network','inspect','--format','{{.Internal}}|{{index .Labels "psai.synthetic.owner"}}',network]),'true|'+label);
  const pgCids=[];
  for(const [alias,password] of [['synthetic-source','synthetic-database-password'],['synthetic-recovery','synthetic-recovery-password']]){
    const cid=await create(['--network',network,'--network-alias',alias,'--restart=no','--memory=512m','--cpus=1',
      '--pids-limit=128','--tmpfs','/var/lib/postgresql:rw,nosuid,nodev,size=512m',
      '--env','POSTGRES_USER=synthetic','--env','POSTGRES_PASSWORD='+password,'--env','POSTGRES_DB=postgres',pg]);
    assert.equal(await docker(['inspect','--format','{{json .HostConfig.PortBindings}}|{{.HostConfig.RestartPolicy.Name}}',cid]),'{}|no');
    await docker(['start',cid]);pgCids.push(cid);
  }
  for(const cid of pgCids){
    let ready=false;
    for(let i=0;i<40&&!ready;i++){
      assert.equal(interrupted,false);
      try{await docker(['exec',cid,'pg_isready','-U','synthetic','-d','postgres']);ready=true;}
      catch{await new Promise(r=>setTimeout(r,500));}
    }assert.equal(ready,true);
  }
  const integration=await create([...restrictions,'--network',network,'--env','PSAI_DISPOSABLE_POSTGRES_APPROVED=true',imageId,
    '--test','--test-reporter=tap','--test-concurrency=1','/opt/recovery/tests/postgres.integration.test.mjs']);
  await record('integration-results.json',{...summary(await runBounded(integration,180000)),postgresMajor:18,
    databases:'Separate fresh synthetic databases on two owned clusters',objectStore:'Loopback HTTP S3 protocol simulator, not R2',
    networkInternal:true,publishedPorts:0,liveProviderVerification:false});
  await command(process.execPath,['tests/cloud-runtime.mjs',imageId,manifestDigest],120000);
  const dependencies=await create([...restrictions,'--network=none',imageId,'-e',
    "const{execFileSync}=require('node:child_process');if(process.getuid()!==1001)process.exit(1);for(const p of ['pg_dump','pg_restore','psql'])if(!execFileSync(p,['--version']).toString().includes(' 18.'))process.exit(1);import('/opt/recovery/node_modules/@aws-sdk/client-s3/dist-cjs/index.js').then(()=>console.log('RUNTIME_DEPENDENCIES_PASS'));" ]);
  assert.equal(await runBounded(dependencies,30000),'RUNTIME_DEPENDENCIES_PASS');
  await record('runtime-restrictions.json',{nonRootUid:1001,readOnlyRoot:true,capabilitiesDropped:true,noNewPrivileges:true,
    restartPolicy:'no',secretMounts:0,hostDockerSocketMounted:false,publishedPorts:0,
    toolingNetwork:'Internal bridge; loopback-only storage/gate fixtures; only synthetic PostgreSQL peers',
    unitAndHeartbeatNetwork:'none',clientsMajor:18,awsSdkPresent:true});
}catch{
  failed=true;await record('failure.json',{status:'FAIL',code:'SYNTHETIC_CLOUD_VERIFICATION_FAILED',rawDiagnosticsWithheld:true});
}finally{
  for(const cid of [...containers].reverse()){
    try{
      await owned(cid);await docker(['stop','--time','1',cid]);
      assert.equal(await docker(['inspect','--format','{{.State.Running}}',cid]),'false');
      await docker(['rm','-v',cid]);cleanupResult.containersRemoved++;
    }catch{failed=true;}
  }
  if(netCreated){
    try{
      assert.equal(await docker(['network','inspect','--format','{{index .Labels "psai.synthetic.owner"}}',network]),label);
      await docker(['network','rm',network]);cleanupResult.networkRemoved=true;
    }catch{failed=true;}
  }
  cleanupResult.expectedContainers=containers.size;cleanupResult.status=failed?'FAIL':'PASS';
  await record('cleanup.json',cleanupResult);
  process.off('SIGTERM',interrupt);process.off('SIGINT',interrupt);
}
if(failed||interrupted)process.exitCode=1;
