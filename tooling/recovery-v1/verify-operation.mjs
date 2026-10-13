import path from 'node:path';
import { isMain,cli,loadOperation,log } from './lib/security.mjs';
export async function verify(paths){
  const c=await loadOperation(paths,'verify');
  log('operation_verified',{status:'PASS'});
  return {mode:c.op.mode,operationHash:c.operationHash};
}
if(isMain(import.meta.url)) await cli(verify);
