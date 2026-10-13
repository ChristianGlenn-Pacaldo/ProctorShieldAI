import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { SafeError,requireThat,secret } from './security.mjs';

const jobs=new WeakMap();
export function deadline(ms){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(new SafeError('DEADLINE')),ms);
  const abort=()=>controller.abort(new SafeError('CANCELLED'));
  process.once('SIGTERM',abort);process.once('SIGINT',abort);
  jobs.set(controller.signal,new Set());
  return {signal:controller.signal,cancel:abort,async close(){
    clearTimeout(timer);process.off('SIGTERM',abort);process.off('SIGINT',abort);
    abort();await Promise.allSettled([...jobs.get(controller.signal)]);
  }};
}
export function child(command,argv,{env={},signal,stdin='ignore'}={}) {
  requireThat(['pg_dump','pg_restore','psql',process.execPath].includes(command),'SUBPROCESS_ALLOWLIST');
  requireThat(!signal?.aborted,'CANCELLED');
  const c=spawn(command,argv,{env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,...env},
    stdio:[stdin,'pipe','pipe'],detached:process.platform!=='win32',windowsHide:true,shell:false});
  let killTimer;
  const kill=()=>{
    try{if(process.platform!=='win32')process.kill(-c.pid,'SIGTERM');else c.kill('SIGTERM');}catch{}
    killTimer=setTimeout(()=>{try{if(process.platform!=='win32')process.kill(-c.pid,'SIGKILL');else c.kill('SIGKILL');}catch{}},1000);
  };
  signal?.addEventListener('abort',kill,{once:true});
  let stderrBytes=0;c.stderr.on('data',b=>{stderrBytes+=b.length;}); // Never echo raw diagnostics.
  c.done=new Promise((resolve,reject)=>{
    c.once('error',()=>reject(new SafeError('SUBPROCESS_START')));
    c.once('close',(code)=>{
      clearTimeout(killTimer);signal?.removeEventListener('abort',kill);
      if(signal?.aborted && process.platform!=='win32'){
        try{process.kill(-c.pid,'SIGKILL');}catch{}
      }
      if(signal?.aborted)reject(new SafeError('CANCELLED'));
      else if(code!==0)reject(new SafeError('SUBPROCESS_FAILED'));
      else resolve({code,stderrBytes});
    });
  });
  c.done.catch(()=>{});jobs.get(signal)?.add(c.done);return c;
}
export async function databaseEnv(config,recovery=false){
  const d=recovery?config.op.recovery:config.op.database;
  requireThat(d && d.host==='127.0.0.1' && Number.isInteger(d.port) && d.port>1024 && d.port<65536,'DB_IDENTITY');
  const key=recovery?'recovery-db-password':'source-db-password';
  return {PGHOST:d.host,PGPORT:String(d.port),PGDATABASE:d.name,PGUSER:d.role,
    PGPASSWORD:(await secret(config,key)).toString(),PGSSLMODE:config.op.mode==='synthetic'?'disable':'require',
    PGCONNECT_TIMEOUT:'5',PGOPTIONS:'-c default_transaction_read_only='+ (recovery?'off':'on') +' -c lock_timeout=5000 -c statement_timeout=900000',
    PSQLRC:'/dev/null',TZ:'UTC',PGCLIENTENCODING:'UTF8'};
}
export async function query(config,sql,signal,recovery=false){
  const c=child('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-c',sql],{env:await databaseEnv(config,recovery),signal});
  const chunks=[];let size=0;
  for await(const b of c.stdout){size+=b.length;requireThat(size<=2*1024*1024,'QUERY_OUTPUT_LIMIT');chunks.push(b);}
  await c.done;return Buffer.concat(chunks).toString().trim();
}
export async function identity(config,signal,recovery=false){
  const d=recovery?config.op.recovery:config.op.database;
  const result=JSON.parse(await query(config,"SELECT json_build_object('database',current_database(),'role',current_user,'major',current_setting('server_version_num')::int/10000,'readOnly',current_setting('transaction_read_only'),'port',inet_server_port());",signal,recovery));
  requireThat(result.database===d.name && result.role===d.role && result.major===18 && result.port===5432 &&
    (recovery||result.readOnly==='on'),'DATABASE_IDENTITY_MISMATCH');
  if(recovery){
    requireThat(d.name!==config.op.database.name && /^psai_recovery_[a-z0-9_]+$/.test(d.name),'RECOVERY_NAME');
    const n=await query(config,"SELECT count(*) FROM pg_tables WHERE schemaname='public';",signal,true);
    requireThat(n==='0','RECOVERY_NOT_EMPTY');
  }
}
export async function tableDigests(config,signal,recovery=false){
  const output={};
  for(const table of config.op.database.tables){
    requireThat(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(table),'TABLE_IDENTIFIER');
    const c=child('psql',['-X','-qAt','-v','ON_ERROR_STOP=1','-c',
      "SET TIME ZONE 'UTC'; COPY (SELECT to_jsonb(t)::text FROM public.\""+table+"\" t ORDER BY to_jsonb(t)::text COLLATE \"C\") TO STDOUT;"],
      {env:await databaseEnv(config,recovery),signal});
    const h=createHmac('sha256',config.auditKey);let bytes=0;
    for await(const b of c.stdout){h.update(b);bytes+=b.length;}
    await c.done;const rows=await query(config,'SELECT count(*) FROM public."'+table+'";',signal,recovery);
    requireThat(/^\d+$/.test(rows),'ROW_COUNT');output[table]={hmac:h.digest('hex'),bytes,rows};
  }return output;
}
export async function schemaFingerprint(config,signal,recovery=false){
  const tables=JSON.parse(await query(config,"SELECT coalesce(json_agg(tablename ORDER BY tablename COLLATE \"C\"),'[]'::json) FROM pg_tables WHERE schemaname='public';",signal,recovery));
  requireThat(JSON.stringify(tables)===JSON.stringify([...config.op.database.tables].sort()),'SCHEMA_TABLE_ALLOWLIST');
  const sql="SELECT json_build_object('columns',(SELECT json_agg(x ORDER BY x.table_name,x.ordinal_position) FROM (SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public') x),'constraints',(SELECT json_agg(x ORDER BY x.table_name,x.conname) FROM (SELECT c.relname AS table_name,k.conname,k.contype,pg_get_constraintdef(k.oid) AS definition,k.convalidated FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') x),'indexes',(SELECT json_agg(x ORDER BY x.tablename,x.indexname) FROM (SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public') x),'sequences',(SELECT json_agg(x ORDER BY x.sequencename) FROM (SELECT sequencename,start_value,min_value,max_value,increment_by,cycle,last_value FROM pg_sequences WHERE schemaname='public') x));";
  return JSON.parse(await query(config,sql,signal,recovery));
}
