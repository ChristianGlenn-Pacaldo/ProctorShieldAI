import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { requireThat,signedFile,plainFile,SafeError } from './security.mjs';
const exec=promisify(execFile);
async function docker(argv){
  try {const r=await exec('docker',argv,{timeout:5000,maxBuffer:16384,windowsHide:true,shell:false});return r.stdout.trim();}
  catch{throw new SafeError('OWNED_JOB_CONTROL_FAILED');}
}
export async function jobIdentity(paths,c){
  const trust=JSON.parse((await plainFile(paths.trust)).toString());
  const j=await signedFile(paths.job,trust.runtimePublicKey,'job');
  requireThat(j.operationHash===c.operationHash && j.runnerId===c.op.runnerId && j.imageDigest===c.op.imageDigest &&
    j.imageId===c.runtime.imageId && /^[a-f0-9]{64}$/.test(j.containerId) &&
    /^[a-f0-9]{64}$/.test(j.imageId) && Number.isFinite(Date.parse(j.deadline)) &&
    Date.parse(j.deadline)<=Date.parse(c.op.expiresAt) &&
    Date.parse(j.deadline)<=Date.now()+c.op.maxRuntimeMs-2000,'JOB_RECEIPT');
  const label=await docker(['inspect','--format','{{index .Config.Labels "psai.operation"}}|{{.HostConfig.RestartPolicy.Name}}|{{.Image}}',j.containerId]);
  requireThat(label===c.op.operationId+'|no|sha256:'+j.imageId,'JOB_IDENTITY_MISMATCH');
  return j;
}
export async function jobState(j){
  const x=JSON.parse(await docker(['inspect','--format','{{json .State}}',j.containerId]));
  requireThat(typeof x.Running==='boolean' && typeof x.Status==='string','JOB_STATE');
  return x;
}
export async function stopJob(j){
  const state=await jobState(j);
  if(state.Running)await docker(['stop','--time','1',j.containerId]);
  requireThat(!(await jobState(j)).Running,'OWNED_JOB_STILL_RUNNING');
}
