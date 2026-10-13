import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable,Writable } from 'node:stream';
import { fixture,gateFixture,objectFixture,sign } from './fixtures.mjs';
import { loadOperation,canonical,sha,begin,finish,validateEndpoint,secret,SafeError,log,syncFile } from '../lib/security.mjs';
import { deadline,child } from '../lib/process.mjs';
import { encryptToFile,decryptFileToPath } from '../lib/backup-crypto.mjs';
import { pause,drain,owned,release } from '../lib/gate.mjs';
import { validateManifest } from '../lib/manifest.mjs';

test('signed independent approval/runtime are required and accepted',async t=>{
  const f=await fixture(t),c=await loadOperation(f.paths,'verify');assert.equal(c.op.mode,'synthetic');
});
test('tampered approval fails before networking or ledger creation',async t=>{
  const f=await fixture(t),x=JSON.parse(await fs.readFile(f.paths.operation));x.payload.actions.push('not-approved');
  await fs.writeFile(f.paths.operation,JSON.stringify(x));await assert.rejects(loadOperation(f.paths,'verify'),/SIGNATURE_INVALID/);
  assert.deepEqual(await fs.readdir(f.paths.work),[]);
});
test('tampered runtime fails',async t=>{
  const f=await fixture(t),x=JSON.parse(await fs.readFile(f.paths.context));x.payload.imageDigest='f'.repeat(64);
  await fs.writeFile(f.paths.context,JSON.stringify(x));await assert.rejects(loadOperation(f.paths,'verify'),/SIGNATURE_INVALID/);
});
test('unknown signer fails',async t=>{
  const f=await fixture(t),k=crypto.generateKeyPairSync('ed25519');
  await fs.writeFile(f.paths.operation,canonical(sign(f.op,k.privateKey)));await assert.rejects(loadOperation(f.paths,'verify'),/SIGNATURE_INVALID/);
});
for(const [name,change,error] of [
  ['expired',f=>{f.op.expiresAt=new Date(Date.now()-100).toISOString();},'APPROVAL_TIME'],
  ['not yet valid',f=>{f.op.notBefore=new Date(Date.now()+10000).toISOString();},'APPROVAL_TIME'],
  ['wrong image',f=>{f.context.imageDigest='a'.repeat(64);},'RUNTIME_ATTESTATION'],
  ['automatic restart',f=>{f.context.restartPolicy='always';},'RUNTIME_ATTESTATION'],
  ['unproven network',f=>{f.context.networkIsolationVerified=false;},'RUNTIME_ATTESTATION'],
  ['missing deadline',f=>{f.context.hardDeadlineVerified=false;},'RUNTIME_ATTESTATION'],
  ['wrong runner',f=>{f.context.runnerId='other-runner';},'RUNTIME_ATTESTATION'],
  ['unapproved action',f=>{f.op.actions=['backup'];},'ACTION_NOT_APPROVED'],
  ['synthetic remote target',f=>{f.op.source.endpoint='https://example.com';},'SYNTHETIC_LOOPBACK_ONLY'],
  ['credential URL',f=>{f.op.source.endpoint='http://u:p@127.0.0.1:9001';},'ENDPOINT_ORIGIN'],
  ['unsafe database',f=>{f.op.database.host='postgres.railway.internal';},'DATABASE_TUNNEL_ONLY'],
  ['same storage',f=>{f.op.destination.endpoint=f.op.source.endpoint;},'DESTINATION_SEPARATION'],
  ['unsafe table',f=>{f.op.database.tables=['users; drop table users'];},'NAME'],
  ['unsafe prefix',f=>{f.op.destination.prefix='../';},'DESTINATION_PREFIX'],
  ['live gate not assumed compatible',f=>{
    f.op.mode='live';f.op.allowLiveData=true;
  },'LIVE_GATE_INTEGRATION_UNVERIFIED']
]){
  test('reject '+name,async t=>{
    const f=await fixture(t);change(f);
    // Sign exact updated approval/context without normalizing away the intended mismatch.
    f.context.operationHash=sha(canonical(f.op));
    await fs.writeFile(f.paths.operation,canonical(sign(f.op,f.approver.privateKey)));
    await fs.writeFile(f.paths.context,canonical(sign(f.context,f.runtime.privateKey)));
    await assert.rejects(loadOperation(f.paths,'verify'),new RegExp(error));
  });
}
test('missing explicit path never falls back to environment configuration',async()=>{
  await assert.rejects(loadOperation({},'verify'),/EXPLICIT_PATHS_REQUIRED/);
});
test('invalid encryption key rejected',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.paths.secrets,'encryption-key'),'invalid');
  await assert.rejects(loadOperation(f.paths,'verify'),/ENCRYPTION_KEY/);
});
test('durable exclusive ledger rejects replay after complete or failure',async t=>{
  const f=await fixture(t),c=await loadOperation(f.paths,'verify'),l=await begin(c,'backup');
  await finish(l,'failed');await assert.rejects(begin(c,'backup'),{code:'EEXIST'});
  assert.match(await fs.readFile(l.events,'utf8'),/failed/);
});
test('concurrent invocation admits exactly one ledger writer',async t=>{
  const f=await fixture(t),c=await loadOperation(f.paths,'verify');
  const r=await Promise.allSettled(Array.from({length:12},()=>begin(c,'backup')));
  assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
});
test('encryption uses established AES-GCM format with checksum round trip',async t=>{
  const f=await fixture(t),key=crypto.randomBytes(32),bytes=Buffer.from('synthetic-only-evidence');
  const enc=path.join(f.root,'enc'),out=path.join(f.root,'out');
  const m=await encryptToFile(Readable.from([bytes]),enc,key);
  assert.equal(m.cipherBytes,bytes.length+28);
  await decryptFileToPath(enc,out,key,m.plainSha256,m.plainBytes);
  assert.deepEqual(await fs.readFile(out),bytes);
});
test('wrong key, tag tamper and plaintext checksum mismatch fail',async t=>{
  const f=await fixture(t),key=crypto.randomBytes(32),file=path.join(f.root,'enc');
  const m=await encryptToFile(Readable.from([Buffer.from('synthetic')]),file,key);
  await assert.rejects(decryptFileToPath(file,path.join(f.root,'badkey'),crypto.randomBytes(32),m.plainSha256,m.plainBytes));
  await assert.rejects(decryptFileToPath(file,path.join(f.root,'badhash'),key,'0'.repeat(64),m.plainBytes));
  const b=await fs.readFile(file);b[b.length-1]^=1;await fs.writeFile(file,b);
  await assert.rejects(decryptFileToPath(file,path.join(f.root,'badtag'),key,m.plainSha256,m.plainBytes));
});
test('truncated encrypted file fails',async t=>{
  const f=await fixture(t),file=path.join(f.root,'enc');await fs.writeFile(file,Buffer.alloc(27));
  await assert.rejects(decryptFileToPath(file,path.join(f.root,'out'),crypto.randomBytes(32),'0'.repeat(64),0));
});
test('nonce varies for identical plaintext',async t=>{
  const f=await fixture(t),key=crypto.randomBytes(32);
  const a=await encryptToFile(Readable.from(['same']),path.join(f.root,'a'),key);
  const b=await encryptToFile(Readable.from(['same']),path.join(f.root,'b'),key);
  assert.notEqual(a.cipherSha256,b.cipherSha256);
});
test('pause drains active work and releases only owner',async t=>{
  const g=await gateFixture(t,{active:1}),f=await fixture(t,{gate:{endpoint:g.endpoint,contract:'owned-lease-v1'}}),c=await loadOperation(f.paths,'gate');
  await pause(c);await assert.rejects(owned(c),/GATE_NOT_DRAINED/);
  setTimeout(()=>{g.state.activeMutations=0;},20);
  await drain(c,undefined,300);assert.equal((await owned(c)).paused,true);
  assert.equal((await release(c)).released,true);assert.equal(g.state.paused,false);
});
test('another operation cannot acquire or release owned pause',async t=>{
  const g=await gateFixture(t),a=await fixture(t,{gate:{endpoint:g.endpoint,contract:'owned-lease-v1'}}),
    b=await fixture(t,{gate:{endpoint:g.endpoint,contract:'owned-lease-v1'}});
  const ca=await loadOperation(a.paths,'gate'),cb=await loadOperation(b.paths,'gate');
  await pause(ca);await assert.rejects(pause(cb),/GATE_ALREADY_OWNED/);
  await assert.rejects(release(cb),/GATE_OTHER_OWNER/);assert.equal(g.state.paused,true);await release(ca);
});
test('drain timeout preserves pause for supervisor and does not force-delete markers',async t=>{
  const g=await gateFixture(t,{active:2}),f=await fixture(t,{gate:{endpoint:g.endpoint,contract:'owned-lease-v1'}}),c=await loadOperation(f.paths,'gate');
  await pause(c);await assert.rejects(drain(c,undefined,50),/DRAIN_TIMEOUT/);assert.equal(g.state.paused,true);await release(c);
});
test('gate release failure fails closed and keeps ownership',async t=>{
  const g=await gateFixture(t),f=await fixture(t,{gate:{endpoint:g.endpoint,contract:'owned-lease-v1'}}),c=await loadOperation(f.paths,'gate');
  await pause(c);g.setFailDelete(true);await assert.rejects(release(c),/GATE_REQUEST_FAILED/);assert.equal(g.state.paused,true);
});
test('deadline cancels and waits for its owned subprocess',async()=>{
  const d=deadline(150),c=child(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:d.signal});
  c.stdout.resume();await assert.rejects(c.done,/CANCELLED/);await d.close();
  assert.equal(c.exitCode!==null||c.signalCode!==null,true);
});
test('subprocess program cannot come from arbitrary operation config',()=>{
  assert.throws(()=>child('curl',['https://example.com']),/SUBPROCESS_ALLOWLIST/);
});
test('safe error/log contract rejects credential payloads',()=>{
  assert.throws(()=>log('event',{code:'postgres://synthetic:secret@host'}),/LOG_FIELD/);
});
test('symlink secret rejected',{skip:process.platform==='win32'?'Windows symlink privilege unavailable; Linux cloud check required':false},async t=>{
  const f=await fixture(t),c=await loadOperation(f.paths,'verify');
  await fs.symlink(path.join(f.paths.secrets,'gate-token'),path.join(f.paths.secrets,'linked-token'));
  await assert.rejects(secret(c,'linked-token'),/FILE_TYPE_SIZE/);
});
test('manifest validates mapping before any further object fetch',async t=>{
  const f=await fixture(t),c=await loadOperation(f.paths,'verify');
  const meta={plainSha256:'a'.repeat(64),cipherSha256:'b'.repeat(64),plainBytes:10,cipherBytes:38};
  const m={format:1,setId:f.op.setId,environmentId:f.op.environmentId,appCommit:f.op.appCommit,completedAt:new Date().toISOString(),
    migrations:['synthetic_001'],database:{objectKey:'sets/'+f.op.setId+'/database.bin',...meta},
    evidence:[{key:'evidence/synthetic.png',objectKey:'sets/'+f.op.setId+'/evidence/0.bin',contentType:'image/png',...meta}],
    attestation:{schema:{columns:[],constraints:[],indexes:[],sequences:null},tableDigests:Object.fromEntries(f.op.database.tables.map(x=>[x,{hmac:'c'.repeat(64),bytes:1,rows:'1'}]))}};
  assert.equal(validateManifest(m,c),m);
  m.database.objectKey='sets/other/database.bin';assert.throws(()=>validateManifest(m,c),/DATABASE_MAPPING/);
});
test('S3 synthetic driver: conditional upload and readback integrity, no delete',async t=>{
  const {store,upload,inventory}=await import('../lib/store.mjs');
  const s=await objectFixture(t),f=await fixture(t,{destination:{endpoint:s.endpoint,bucket:'backup-synthetic',prefix:'proctorshieldai'}});
  const c=await loadOperation(f.paths,'verify'),client=await store(c,'destination');t.after(()=>client.close());
  const file=path.join(f.root,'cipher');await fs.writeFile(file,Buffer.from('ciphertext'));
  const m={cipherBytes:10,cipherSha256:sha('ciphertext')};
  await upload(client,'proctorshieldai/sets/test/database.bin',file,m);
  await assert.rejects(upload(client,'proctorshieldai/sets/test/database.bin',file,m));
  assert.equal(s.calls.filter(x=>x.method==='DELETE').length,0);
});
test('partial publication readback failure retains marker and is not reported absent',async t=>{
  const {store,putJson}=await import('../lib/store.mjs');
  const s=await objectFixture(t),f=await fixture(t,{destination:{endpoint:s.endpoint,bucket:'backup-synthetic',prefix:'proctorshieldai'}});
  const c=await loadOperation(f.paths,'verify'),client=await store(c,'destination');t.after(()=>client.close());
  s.failRead('completion.json');
  await assert.rejects(putJson(client,'proctorshieldai/sets/test/completion.json',{format:1}));
  assert.equal(s.objects.has('backup-synthetic/proctorshieldai/sets/test/completion.json'),true);
  assert.equal(s.calls.filter(x=>x.method==='GET').length,1); // maxAttempts=1, no retries.
  assert.equal(s.calls.filter(x=>x.method==='DELETE').length,0);
});
test('object corruption is detected and remote object is retained',async t=>{
  const {store,upload}=await import('../lib/store.mjs');
  const s=await objectFixture(t),f=await fixture(t,{destination:{endpoint:s.endpoint,bucket:'backup-synthetic',prefix:'proctorshieldai'}});
  const c=await loadOperation(f.paths,'verify'),client=await store(c,'destination');t.after(()=>client.close());
  const file=path.join(f.root,'cipher');await fs.writeFile(file,'ciphertext');s.corrupt(true);
  await assert.rejects(upload(client,'proctorshieldai/sets/test/database.bin',file,{cipherBytes:10,cipherSha256:sha('ciphertext')}));
  assert.equal(s.objects.size,1);
});

test('missing secret cannot use an environment fallback',async t=>{
  const f=await fixture(t);await fs.rm(path.join(f.paths.secrets,'encryption-key'));
  await assert.rejects(loadOperation(f.paths,'verify'),{code:'ENOENT'});
});
test('runtime approval must outlast the complete bounded operation',async t=>{
  const f=await fixture(t);f.context.expiresAt=new Date(Date.now()+2000).toISOString();
  await fs.writeFile(f.paths.context,canonical(sign(f.context,f.runtime.privateKey)));
  await assert.rejects(loadOperation(f.paths,'verify'),/APPROVAL_RUNTIME_WINDOW/);
});
test('approval and runtime authorities cannot be the same key',async t=>{
  const f=await fixture(t),a=f.anchors;a.runtimePublicKey=a.approverPublicKey;a.runtimeFingerprint=a.approverFingerprint;
  await fs.writeFile(f.paths.trust,canonical(a));await assert.rejects(loadOperation(f.paths,'verify'),/INDEPENDENT_TRUST_KEYS/);
});
test('runtime realm mismatch rejected even with valid signatures',async t=>{
  const f=await fixture(t);f.context.mode='live';
  await fs.writeFile(f.paths.context,canonical(sign(f.context,f.runtime.privateKey)));
  await assert.rejects(loadOperation(f.paths,'verify'),/RUNTIME_REALM/);
});
test('ledger cannot be redirected through a symlink',{skip:process.platform==='win32'?'Linux cloud permission check required':false},async t=>{
  const f=await fixture(t),c=await loadOperation(f.paths,'verify'),elsewhere=path.join(f.root,'elsewhere');
  await fs.mkdir(elsewhere);await fs.symlink(elsewhere,path.join(f.paths.work,'ledger'));
  await assert.rejects(begin(c,'backup'),/LEDGER_SYMLINK/);assert.deepEqual(await fs.readdir(elsewhere),[]);
});
test('closing an operation cancels its still-running owned child',async()=>{
  const d=deadline(5000),c=child(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:d.signal});
  c.stdout.resume();await d.close();await assert.rejects(c.done,/CANCELLED/);
  assert.ok(c.exitCode!==null||c.signalCode!==null);
});
test('subprocess does not inherit connection or provider environment',async()=>{
  const c=child(process.execPath,['-e',"process.stdout.write(String(['DATABASE_URL','PGSERVICE','PGHOST','AWS_ACCESS_KEY_ID'].every(k=>process.env[k]===undefined)))"]);
  let value='';for await(const b of c.stdout)value+=b;await c.done;assert.equal(value,'true');
});
test('cancelled operation cannot spawn additional children',async()=>{
  const d=deadline(5000);d.cancel();assert.throws(()=>child(process.execPath,['-e',''],{signal:d.signal}),/CANCELLED/);await d.close();
});
test('recovery rejects a source storage target before any connection',async t=>{
  const {runRecover}=await import('../recover-once.mjs');
  const f=await fixture(t,{recovery:{host:'127.0.0.1',port:15433,name:'psai_recovery_synthetic',role:'synthetic'},
    recoveryStore:{endpoint:'http://127.0.0.1:19001',bucket:'recovery-synthetic'}});
  await assert.rejects(runRecover(f.paths),/RECOVERY_STORE_ISOLATION/);assert.deepEqual(await fs.readdir(f.paths.work),[]);
});
test('recovery rejects malformed target role before any connection',async t=>{
  const {runRecover}=await import('../recover-once.mjs');
  const f=await fixture(t,{recovery:{host:'127.0.0.1',port:15433,name:'psai_recovery_synthetic',role:'bad role'}});
  await assert.rejects(runRecover(f.paths),/RECOVERY_TARGET/);
});
test('Linux cancellation kills the owned subprocess group including a TERM-resistant descendant',
  {skip:process.platform!=='linux'?'Linux process-group verification required':false},async()=>{
    const d=deadline(5000),script="const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"],{stdio:'ignore'});process.stdout.write(String(c.pid)+'\\n');process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)";
    const c=child(process.execPath,['-e',script],{signal:d.signal});let pid;
    try{
      for await(const b of c.stdout){pid=Number(b.toString().trim());break;}
      assert.ok(Number.isInteger(pid)&&pid>1);await new Promise(r=>setTimeout(r,100));await d.close();
      await assert.rejects(c.done,/CANCELLED/);await new Promise(r=>setTimeout(r,100));
      let state;try{state=(await fs.readFile('/proc/'+pid+'/stat','utf8')).split(' ')[2];}catch(e){if(e.code!=='ENOENT')throw e;}
      assert.ok(state===undefined||state==='Z');
    }finally{await d.close();}
  });
