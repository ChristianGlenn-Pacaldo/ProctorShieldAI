import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable,Transform } from 'node:stream';
import { encryptToFile,decryptFileTo } from './lib/backup-crypto.mjs';
import { isMain,cli,loadOperation,begin,finish,secureDirectory,requireThat,canonical,log,SafeError,syncFile } from './lib/security.mjs';
import { deadline,child,databaseEnv,identity,query,tableDigests,schemaFingerprint } from './lib/process.mjs';
import { store,inventory,get,upload,putJson } from './lib/store.mjs';
import { owned } from './lib/gate.mjs';
import { validateManifest } from './lib/manifest.mjs';

export async function runBackup(paths){
  const c=await loadOperation(paths,'backup'),timer=deadline(c.op.maxRuntimeMs);
  let ledger,source,destination,root,published=false;
  try{
    ledger=await begin(c,'backup');root=await secureDirectory(c.workRoot,c.op.operationId+'-backup');
    await owned(c,timer.signal);await identity(c,timer.signal);
    const a=(await import('./lib/security.mjs')).secret;
    requireThat(!(await a(c,'source-access')).equals(await a(c,'destination-access')),'STORAGE_CREDENTIAL_SEPARATION');
    source=await store(c,'source');destination=await store(c,'destination');
    const before=await inventory(source,c,timer.signal);
    const active=JSON.parse(await query(c,"SELECT coalesce(json_agg(file_path ORDER BY file_path),'[]'::json) FROM public.evidence_files WHERE deletion_requested_at IS NULL AND deleted_at IS NULL;",timer.signal));
    const keys=new Set(before.map(x=>x.key));
    requireThat(Array.isArray(active) && active.every(x=>keys.has(x)),'ACTIVE_EVIDENCE_MISSING');
    const migrations=JSON.parse(await query(c,"SELECT coalesce(json_agg(migration_name ORDER BY migration_name),'[]'::json) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;",timer.signal));
    requireThat(canonical(migrations)===canonical(c.op.database.migrations),'MIGRATIONS_MISMATCH');
    const tableBefore=await tableDigests(c,timer.signal),schema=await schemaFingerprint(c,timer.signal);
    const dump=child('pg_dump',['-Fc','--no-owner','--no-acl'],{env:await databaseEnv(c),signal:timer.signal});
    const file=path.join(root,'database.bin');
    let n=0;
    const bounded=new Transform({transform(b,e,cb){n+=b.length;cb(n>c.op.totalMaxBytes?new SafeError('DUMP_SIZE_LIMIT'):null,b);}});
    dump.stdout.pipe(bounded);
    const [database,dumpResult]=await Promise.all([encryptToFile(bounded,file,c.encryptionKey),dump.done]);
    // Warning content is private; reject unexpected stderr rather than silently calling it clean.
    requireThat(dumpResult.stderrBytes===0,'DUMP_DIAGNOSTICS_REQUIRE_REVIEW');
    const archive=child('pg_restore',['--list'],{signal:timer.signal,stdin:'pipe'});
    archive.stdout.resume();
    await Promise.all([decryptFileTo(file,c.encryptionKey,archive.stdin),archive.done]);
    const prefix=c.op.destination.prefix,base='sets/'+c.op.setId;
    await upload(destination,prefix+'/'+base+'/database.bin',file,database,timer.signal);
    const evidence=[];let total=database.plainBytes;
    for(let i=0;i<before.length;i++){
      await owned(c,timer.signal);
      const o=before[i],r=await get(source,o.key,timer.signal,o.etag);
      requireThat(r.Body && r.ContentLength===o.size && r.ETag===o.etag,'SOURCE_CHANGED');
      const filename=path.join(root,'evidence-'+i+'.bin');
      const meta=await encryptToFile(r.Body,filename,c.encryptionKey);
      requireThat(meta.plainBytes===o.size,'SOURCE_CHANGED');total+=meta.plainBytes;
      requireThat(total<=c.op.totalMaxBytes,'BACKUP_CAPACITY');
      const objectKey=base+'/evidence/'+i+'.bin';
      await upload(destination,prefix+'/'+objectKey,filename,meta,timer.signal);
      evidence.push({key:o.key,contentType:r.ContentType||'application/octet-stream',objectKey,...meta});
      await fs.rm(filename);
    }
    requireThat(canonical(before)===canonical(await inventory(source,c,timer.signal)),'SOURCE_INVENTORY_CHANGED');
    requireThat(canonical(tableBefore)===canonical(await tableDigests(c,timer.signal)),'DATABASE_CHANGED');
    requireThat(canonical(schema)===canonical(await schemaFingerprint(c,timer.signal)),'SCHEMA_CHANGED');
    await owned(c,timer.signal);
    const manifest={format:1,setId:c.op.setId,environmentId:c.op.environmentId,appCommit:c.op.appCommit,migrations,
      completedAt:new Date().toISOString(),database:{objectKey:base+'/database.bin',...database},evidence,
      attestation:{operationHash:c.operationHash,runnerId:c.op.runnerId,imageDigest:c.op.imageDigest,tableDigests:tableBefore,schema}};
    validateManifest(manifest,c);
    const mf=path.join(root,'manifest.bin');
    const metadata=await encryptToFile(Readable.from([Buffer.from(canonical(manifest))]),mf,c.encryptionKey);
    await upload(destination,prefix+'/'+base+'/manifest.bin',mf,metadata,timer.signal);
    const completion={format:1,setId:c.op.setId,completedAt:manifest.completedAt,evidenceCount:evidence.length,manifestCipherSha256:metadata.cipherSha256};
    await owned(c,timer.signal);
    await putJson(destination,prefix+'/'+base+'/completion.json',completion,timer.signal);published=true;
    // No mutable latest pointer: per-set immutable completion plus independent local receipt.
    await syncFile(path.join(root,'completion.json'),canonical(completion),true);
    await finish(ledger,'completed',{published:true,manifestCipherSha256:metadata.cipherSha256});
    log('backup_completed',{objects:evidence.length,status:'PASS'});
    return {completion,root};
  }catch(e){
    if(ledger)await finish(ledger,'failed',{publicationMayHaveOccurred:true});
    log('backup_failed',{code:e instanceof SafeError?e.code:'BACKUP_FAILED',phase:published?'after_completion':'partial_or_unpublished'});
    throw e;
  }finally{
    await timer.close();await source?.close();await destination?.close();
    // Preserve local ciphertext/ledger until explicit owned cleanup; never delete remote objects.
  }
}
if(isMain(import.meta.url)) await cli(runBackup);
