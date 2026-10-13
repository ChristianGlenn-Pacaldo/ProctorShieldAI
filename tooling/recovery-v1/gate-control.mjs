import path from 'node:path';
import { isMain,cli,loadOperation,begin,finish,requireThat,log } from './lib/security.mjs';
import { deadline } from './lib/process.mjs';
import { gate,pause,drain,release } from './lib/gate.mjs';
import { jobIdentity,jobState,stopJob } from './lib/job.mjs';

export async function control(paths){
  const action=paths.action;
  requireThat(['status','pause','drain','resume','watchdog'].includes(action),'GATE_ACTION');
  const c=await loadOperation(paths,action==='watchdog'?'watchdog':'gate');
  const t=deadline(c.op.maxRuntimeMs);let ledger;
  try{
    if(action==='status'){const d=await gate(c,'GET',null,t.signal);log('gate_status',{status:d.paused?'PAUSED':'OPEN'});return d;}
    if(action==='pause'){ledger=await begin(c,'pause');const d=await pause(c,t.signal);await finish(ledger,'completed');log('gate_paused');return d;}
    if(action==='drain'){const d=await drain(c,t.signal);log('gate_drained');return d;}
    if(action==='resume'){
      // Supervisor-only capability; no blind resume while an exporter is active.
      const job=await jobIdentity(paths,c);await stopJob(job);
      const d=await release(c,t.signal);log('gate_released',{status:d.released?'RELEASED':'ALREADY_OPEN'});return d;
    }
    ledger=await begin(c,'watchdog');
    const job=await jobIdentity(paths,c);
    while(true){
      const state=await jobState(job);
      if(state.Status==='exited'||state.Status==='dead'||Date.now()>=Date.parse(job.deadline))break;
      requireThat(!t.signal.aborted,'WATCHDOG_DEADLINE');
      await new Promise(r=>setTimeout(r,100));
    }
    // Never release until exact owned job is proven stopped.
    await stopJob(job);await release(c,t.signal);
    await finish(ledger,'completed');log('watchdog_released');
  }catch(e){if(ledger)await finish(ledger,'failed');throw e;}
  finally{await t.close();}
}
if(isMain(import.meta.url)) await cli(control);
