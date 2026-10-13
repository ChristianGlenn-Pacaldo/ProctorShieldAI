import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireThat,secret,SafeError,canonical,plainFile,syncFile } from './security.mjs';

const owner=config=>crypto.createHmac('sha256',config.auditKey).update(config.operationHash).digest('hex');

// Supervisor publishes one immutable receipt; mount this metadata read-only to the exporter.
const receiptPath=c=>path.join(c.workRoot,'ledger',c.op.operationId+'-gate-lease.json');
const mac=(c,payload)=>crypto.createHmac('sha256',c.auditKey).update(canonical(payload)).digest('hex');
async function receipt(c){
  const e=JSON.parse((await plainFile(receiptPath(c),4096)).toString());
  requireThat(e.payload?.schema===1 && e.payload.operationHash===c.operationHash && typeof e.mac==='string'
    && /^[a-f0-9]{64}$/.test(e.mac) && crypto.timingSafeEqual(Buffer.from(e.mac,'hex'),Buffer.from(mac(c,e.payload),'hex')),'GATE_RECEIPT');
  const p=e.payload;
  requireThat(p.owner===owner(c) && p.operationId===c.op.operationId && Number.isSafeInteger(p.generation)
    && p.generation>0 && typeof p.leaseId==='string' && /^[a-f0-9]{64}$/.test(p.releaseHash),'GATE_RECEIPT');return p;
}
async function capability(c){
  const value=(await secret(c,'gate-release-capability')).toString();
  requireThat(/^[a-f0-9]{64}$/.test(value),'GATE_CAPABILITY');return value;
}
const capabilityHash=value=>crypto.createHash('sha256').update(value).digest('hex');

export async function gate(config,method,body,signal){
  const token=(await secret(config,'gate-token')).toString();
  const timeout=AbortSignal.timeout(3000);
  const combined=signal?AbortSignal.any([signal,timeout]):timeout;
  const r=await fetch(config.op.gate.endpoint+'/api/internal/backup-write-gate',{
    method,redirect:'error',signal:combined,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{})});
  requireThat(r.ok,'GATE_REQUEST_FAILED');
  const raw=await r.text();requireThat(Buffer.byteLength(raw)<=16384,'GATE_SIZE');
  const d=JSON.parse(raw);
  requireThat(d.contract==='owned-lease-v1' && d.releaseProof==='sha256-capability-v1' && d.legacyPaused===false && typeof d.paused==='boolean' &&
    Number.isSafeInteger(d.generation) && d.generation>=0 && typeof d.safeForBackup==='boolean' && Number.isSafeInteger(d.activeMutations) && d.activeMutations>=0,'GATE_CONTRACT');
  return d;
}
export async function pause(config,signal){
  const releaseHash=capabilityHash(await capability(config));
  const dir=path.dirname(receiptPath(config));await fs.mkdir(dir,{recursive:true,mode:0o700});
  requireThat(!(await fs.lstat(dir)).isSymbolicLink(),'GATE_RECEIPT');
  try{await fs.lstat(receiptPath(config));throw new SafeError('GATE_RECEIPT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
  const before=await gate(config,'GET',null,signal);
  requireThat(!before.paused,'GATE_ALREADY_OWNED');
  const intent={schema:1,operationHash:config.operationHash,owner:owner(config),operationId:config.op.operationId,expectedGeneration:before.generation,releaseHash};
  await syncFile(path.join(dir,config.op.operationId+'-gate-intent.json'),canonical({payload:intent,mac:mac(config,intent)}),true);
  const after=await gate(config,'POST',{contract:'owned-lease-v1',operationId:config.op.operationId,owner:owner(config),expectedGeneration:before.generation,releaseHash},signal);
  requireThat(after.paused && after.owner===owner(config) && after.operationId===config.op.operationId &&
    typeof after.leaseId==='string' && after.generation===before.generation+1,'GATE_ACQUIRE');
  const payload={schema:1,operationHash:config.operationHash,owner:after.owner,operationId:after.operationId,leaseId:after.leaseId,generation:after.generation,releaseHash};
  await syncFile(receiptPath(config),canonical({payload,mac:mac(config,payload)}),true);
  return after;
}
export async function owned(config,signal,{drained=true}={}){
  const pinned=await receipt(config);
  const d=await gate(config,'GET',null,signal);
  requireThat(d.generation===pinned.generation && d.leaseId===pinned.leaseId,'GATE_LEASE_CHANGED');
  requireThat(d.paused && d.owner===owner(config) && d.operationId===config.op.operationId && typeof d.leaseId==='string','GATE_NOT_OWNED');
  if(drained)requireThat(d.activeMutations===0 && d.safeForBackup===true,'GATE_NOT_DRAINED');
  return d;
}
export async function release(config,signal){
  const pinned=await receipt(config),releaseCapability=await capability(config);
  requireThat(capabilityHash(releaseCapability)===pinned.releaseHash,'GATE_RELEASE_PROOF');
  const before=await gate(config,'GET',null,signal);
  if(!before.paused){requireThat(before.generation===pinned.generation+1,'GATE_LEASE_CHANGED');return {released:false,alreadyOpen:true};}
  requireThat(before.owner===pinned.owner && before.operationId===pinned.operationId && before.leaseId===pinned.leaseId
    && before.generation===pinned.generation,'GATE_LEASE_CHANGED');
  const after=await gate(config,'DELETE',{contract:'owned-lease-v1',operationId:pinned.operationId,owner:pinned.owner,
    leaseId:pinned.leaseId,expectedGeneration:pinned.generation,releaseCapability},signal);
  requireThat(!after.paused && after.generation===pinned.generation+1,'GATE_RELEASE_FAILED');return {released:true};
}
export async function drain(config,signal,limitMs=120000){
  const end=Date.now()+Math.min(limitMs,config.op.maxRuntimeMs);
  while(Date.now()<end){
    const d=await owned(config,signal,{drained:false});
    if(d.activeMutations===0 && d.safeForBackup===true)return d;
    await new Promise((resolve,reject)=>{
      const t=setTimeout(resolve,30);
      if(signal?.aborted){clearTimeout(t);reject(new SafeError('CANCELLED'));}
    });
  }throw new SafeError('DRAIN_TIMEOUT');
}
