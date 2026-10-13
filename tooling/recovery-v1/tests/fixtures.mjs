import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { canonical,sha } from '../lib/security.mjs';
export function sign(payload,key){return {payload,signature:crypto.sign(null,Buffer.from(canonical(payload)),key).toString('base64')};}
export async function fixture(t,overrides={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'psai-recovery-synthetic-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const secretRoot=path.join(root,'secrets'),work=path.join(root,'work');
  await fs.mkdir(secretRoot,{mode:0o700});await fs.mkdir(work,{mode:0o700});
  const approver=crypto.generateKeyPairSync('ed25519'),runtime=crypto.generateKeyPairSync('ed25519');
  const pem=k=>k.export({type:'spki',format:'pem'}).toString();
  const anchors={schema:1,approverPublicKey:pem(approver.publicKey),runtimePublicKey:pem(runtime.publicKey),
    approverFingerprint:sha(approver.publicKey.export({type:'spki',format:'der'})),
    runtimeFingerprint:sha(runtime.publicKey.export({type:'spki',format:'der'}))};
  const op={role:'approval',schema:1,mode:'synthetic',operationId:'psai-recovery-'+crypto.randomUUID(),
    setId:new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID(),
    notBefore:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),
    actions:['backup','recover','verify','gate','watchdog','cleanup'],maxRuntimeMs:10000,
    runnerId:'synthetic-runner-'+crypto.randomUUID(),imageDigest:'1'.repeat(64),appCommit:'2f0df056f0a76c9d897625fd1edc5ac448405758',
    projectId:'synthetic-project',environmentId:'synthetic-environment',sourceServiceId:'synthetic-postgres',
    source:{endpoint:'http://127.0.0.1:19001',bucket:'source-synthetic'},
    destination:{endpoint:'http://127.0.0.1:19002',bucket:'backup-synthetic',prefix:'proctorshieldai'},
    gate:{endpoint:'http://127.0.0.1:19003',contract:'owned-lease-v1'},
    database:{host:'127.0.0.1',port:15432,name:'psai_source_synthetic',role:'synthetic',serverMajor:18,
      tables:['evidence_files','_prisma_migrations','synthetic_records'],migrations:['synthetic_001']},
    evidenceMaxBytes:1024*1024,totalMaxBytes:8*1024*1024,maxObjects:100,...overrides};
  const context={role:'runtime',operationHash:sha(canonical(op)),mode:'synthetic',runnerId:op.runnerId,imageDigest:op.imageDigest,
    imageId:op.imageDigest,restartPolicy:'no',networkIsolationVerified:true,encryptedStorageVerified:true,hardDeadlineVerified:true,
    noLiveCredentials:true,expiresAt:new Date(Date.now()+3600000).toISOString()};
  const paths={operation:path.join(root,'operation.json'),context:path.join(root,'context.json'),
    trust:path.join(root,'trust.json'),secrets:secretRoot,work};
  await fs.writeFile(paths.trust,canonical(anchors));
  const secrets={'encryption-key':crypto.randomBytes(32).toString('base64'),'audit-key':crypto.randomBytes(32),
    'source-access':'synthetic-source-access','source-secret':'SYNTHETIC_ONLY_SOURCE_SECRET',
    'destination-access':'synthetic-backup-access','destination-secret':'SYNTHETIC_ONLY_BACKUP_SECRET',
    'recoverystore-access':'synthetic-recovery-access','recoverystore-secret':'SYNTHETIC_ONLY_RECOVERY_SECRET',
    'source-db-password':'synthetic-database-password','recovery-db-password':'synthetic-recovery-password',
    'gate-token':'synthetic-gate-token'};
  for(const [name,value] of Object.entries(secrets))await fs.writeFile(path.join(secretRoot,name),value,{mode:0o600});
  const save=async()=>{
    context.operationHash=sha(canonical(op));context.runnerId=op.runnerId;context.imageDigest=op.imageDigest;
    await fs.writeFile(paths.operation,canonical(sign(op,approver.privateKey)));
    await fs.writeFile(paths.context,canonical(sign(context,runtime.privateKey)));
  };
  await save();return {root,paths,op,context,save,approver,runtime,anchors,secrets};
}
export async function gateFixture(t,{active=0}={}){
  const state={contract:'owned-lease-v1',paused:false,generation:0,activeMutations:active,safeForBackup:false,owner:null,operationId:null,leaseId:null};
  let failDelete=false;
  const server=http.createServer(async(req,res)=>{
    if(req.headers.authorization!=='Bearer synthetic-gate-token'){res.writeHead(401);res.end('{}');return;}
    const chunks=[];for await(const b of req)chunks.push(b);
    const data=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};
    if(req.method==='POST'){
      if(state.paused||data.expectedGeneration!==state.generation){res.writeHead(409);res.end('{}');return;}
      Object.assign(state,{paused:true,owner:data.owner,operationId:data.operationId,leaseId:crypto.randomUUID(),generation:state.generation+1});
    }else if(req.method==='DELETE'){
      if(failDelete||!state.paused||data.owner!==state.owner||data.operationId!==state.operationId||data.leaseId!==state.leaseId||data.expectedGeneration!==state.generation){
        res.writeHead(409);res.end('{}');return;
      }
      Object.assign(state,{paused:false,owner:null,operationId:null,leaseId:null,generation:state.generation+1});
    }else if(req.method!=='GET'){res.writeHead(405);res.end('{}');return;}
    state.safeForBackup=state.paused&&state.activeMutations===0;
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(state));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  return {state,endpoint:'http://127.0.0.1:'+server.address().port,setFailDelete(v){failDelete=v;}};
}
function xml(s){return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}
export async function objectFixture(t){
  const objects=new Map(),calls=[];let corrupt=false,failRead=null,failPut=null;
  const server=http.createServer(async(req,res)=>{
    const u=new URL(req.url,'http://127.0.0.1'),parts=u.pathname.slice(1).split('/'),bucket=decodeURIComponent(parts.shift()),key=parts.map(decodeURIComponent).join('/');
    calls.push({method:req.method,bucket,key});
    if(req.method==='GET'&&u.searchParams.get('list-type')==='2'){
      const prefix=u.searchParams.get('prefix')||'',items=[...objects].filter(([k])=>k.startsWith(bucket+'/'+prefix));
      res.setHeader('Content-Type','application/xml');
      res.end('<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>'+xml(bucket)+'</Name><IsTruncated>false</IsTruncated>'+
        items.map(([k,v])=>'<Contents><Key>'+xml(k.slice(bucket.length+1))+'</Key><Size>'+v.bytes.length+'</Size><ETag>'+xml(v.etag)+'</ETag></Contents>').join('')+'</ListBucketResult>');return;
    }
    const k=bucket+'/'+key;
    if(req.method==='PUT'){
      if(failPut&&key.endsWith(failPut)){res.writeHead(500);res.end('<Error><Code>InternalError</Code></Error>');return;}
      if(req.headers['if-none-match']==='*'&&objects.has(k)){res.writeHead(412);res.end('<Error><Code>PreconditionFailed</Code></Error>');return;}
      const chunks=[];for await(const b of req)chunks.push(b);
      const bytes=Buffer.concat(chunks),etag='"'+crypto.createHash('md5').update(bytes).digest('hex')+'"';
      objects.set(k,{bytes,etag,contentType:req.headers['content-type']||'application/octet-stream'});
      res.setHeader('ETag',etag);res.end();return;
    }
    if(req.method==='GET'){
      if(failRead&&key.endsWith(failRead)){res.writeHead(500);res.end('<Error><Code>InternalError</Code></Error>');return;}
      const o=objects.get(k);
      if(!o){res.writeHead(404);res.end('<Error><Code>NoSuchKey</Code></Error>');return;}
      if(req.headers['if-match']&&req.headers['if-match']!==o.etag){res.writeHead(412);res.end('<Error><Code>PreconditionFailed</Code></Error>');return;}
      const bytes=corrupt?Buffer.concat([o.bytes,Buffer.from('corrupt')]):o.bytes;
      res.setHeader('Content-Type',o.contentType);res.setHeader('ETag',o.etag);res.setHeader('Content-Length',bytes.length);res.end(bytes);return;
    }
    res.writeHead(403);res.end('<Error><Code>AccessDenied</Code></Error>');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  return {objects,calls,endpoint:'http://127.0.0.1:'+server.address().port,
    seed(bucket,key,bytes,contentType='image/png'){objects.set(bucket+'/'+key,{bytes,contentType,etag:'"'+crypto.createHash('md5').update(bytes).digest('hex')+'"'});},
    corrupt(v){corrupt=v;},failRead(v){failRead=v;},failPut(v){failPut=v;}};
}
