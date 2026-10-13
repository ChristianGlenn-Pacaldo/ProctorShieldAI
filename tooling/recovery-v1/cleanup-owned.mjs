import fs from 'node:fs/promises';
import path from 'node:path';
import { isMain,cli,loadOperation,begin,finish,requireThat,plainFile,log } from './lib/security.mjs';
import { jobIdentity,jobState } from './lib/job.mjs';
export async function cleanup(paths){
  const c=await loadOperation(paths,'cleanup');
  const job=await jobIdentity(paths,c);
  requireThat(!(await jobState(job)).Running,'CLEANUP_JOB_RUNNING');
  const ledger=await begin(c,'cleanup');
  for(const action of ['backup','recover']){
    const dir=path.join(c.workRoot,c.op.operationId+'-'+action);
    let stat;try{stat=await fs.lstat(dir);}catch(e){if(e.code==='ENOENT')continue;throw e;}
    requireThat(stat.isDirectory()&&!stat.isSymbolicLink() && await fs.realpath(dir)===dir,'CLEANUP_PATH');
    const receipt=JSON.parse((await plainFile(path.join(c.workRoot,'ledger',c.op.operationId+'-'+action+'.json'))).toString());
    requireThat(receipt.operationHash===c.operationHash && receipt.operationId===c.op.operationId,'CLEANUP_OWNERSHIP');
    await fs.rm(dir,{recursive:true});
  }
  await finish(ledger,'completed');log('owned_scratch_removed');
  // Deliberately retain durable ledgers, containers, keys, buckets, remote backups and databases.
}
if(isMain(import.meta.url)) await cli(cleanup);
