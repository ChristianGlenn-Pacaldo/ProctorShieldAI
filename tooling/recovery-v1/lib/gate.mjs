import crypto from 'node:crypto';
import { requireThat,secret,SafeError } from './security.mjs';

const owner=config=>crypto.createHmac('sha256',config.auditKey).update(config.operationHash).digest('hex');
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
  requireThat(d.contract==='owned-lease-v1' && typeof d.paused==='boolean' &&
    Number.isInteger(d.generation) && Number.isInteger(d.activeMutations) && d.activeMutations>=0,'GATE_CONTRACT');
  return d;
}
export async function pause(config,signal){
  const before=await gate(config,'GET',null,signal);
  requireThat(!before.paused,'GATE_ALREADY_OWNED');
  const after=await gate(config,'POST',{operationId:config.op.operationId,owner:owner(config),expectedGeneration:before.generation},signal);
  requireThat(after.paused && after.owner===owner(config) && after.operationId===config.op.operationId &&
    typeof after.leaseId==='string','GATE_ACQUIRE');
  return after;
}
export async function owned(config,signal,{drained=true}={}){
  const d=await gate(config,'GET',null,signal);
  requireThat(d.paused && d.owner===owner(config) && d.operationId===config.op.operationId && typeof d.leaseId==='string','GATE_NOT_OWNED');
  if(drained)requireThat(d.activeMutations===0 && d.safeForBackup===true,'GATE_NOT_DRAINED');
  return d;
}
export async function release(config,signal){
  const before=await gate(config,'GET',null,signal);
  if(!before.paused)return {released:false,alreadyOpen:true};
  requireThat(before.owner===owner(config) && before.operationId===config.op.operationId,'GATE_OTHER_OWNER');
  const after=await gate(config,'DELETE',{operationId:config.op.operationId,owner:owner(config),leaseId:before.leaseId,expectedGeneration:before.generation},signal);
  requireThat(!after.paused,'GATE_RELEASE_FAILED');return {released:true};
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
