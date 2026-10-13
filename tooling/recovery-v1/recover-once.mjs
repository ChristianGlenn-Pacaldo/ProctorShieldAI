import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { Writable } from 'node:stream';
import { decryptFileTo,decryptFileToPath } from './lib/backup-crypto.mjs';
import { isMain,cli,loadOperation,begin,finish,secureDirectory,requireThat,canonical,plainFile,log,SafeError } from './lib/security.mjs';
import { deadline,child,databaseEnv,identity,tableDigests,query,schemaFingerprint } from './lib/process.mjs';
import { store,json,download,reconstruct } from './lib/store.mjs';
import { validateManifest } from './lib/manifest.mjs';

export async function runRecover(paths){
  const c=await loadOperation(paths,'recover'),timer=deadline(c.op.maxRuntimeMs);
  let ledger,destination,recoveryStore;
  try{
    requireThat(c.op.recovery && c.op.recovery.host==='127.0.0.1' && Number.isInteger(c.op.recovery.port) &&
      c.op.recovery.port>1024 && c.op.recovery.port<65536 && /^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(c.op.recovery.role) && c.op.recovery.port!==c.op.database.port &&
      c.op.recovery.name!==c.op.database.name && /^psai_recovery_[a-z0-9_]+$/.test(c.op.recovery.name),'RECOVERY_TARGET');
    requireThat(c.op.recoveryStore && c.op.recoveryStore.endpoint!==c.op.destination.endpoint && c.op.recoveryStore.endpoint!==c.op.source.endpoint &&
      /^[a-z0-9][a-z0-9-]{2,62}$/.test(c.op.recoveryStore.bucket) &&
      c.op.recoveryStore.bucket!==c.op.source.bucket && c.op.recoveryStore.bucket!==c.op.destination.bucket,'RECOVERY_STORE_ISOLATION');
    const {validateEndpoint,secret}=await import('./lib/security.mjs');
    validateEndpoint(c.op.recoveryStore.endpoint,c.op.mode,'recoveryStore');
    requireThat(!(await secret(c,'recoverystore-access')).equals(await secret(c,'destination-access')) &&
      !(await secret(c,'recoverystore-access')).equals(await secret(c,'source-access')),'RECOVERY_CREDENTIALS');
    ledger=await begin(c,'recover');
    const root=await secureDirectory(c.workRoot,c.op.operationId+'-recover');
    await identity(c,timer.signal,true);
    recoveryStore=await store(c,'recoveryStore');
    const listed=await recoveryStore.client.send(new (await import('@aws-sdk/client-s3')).ListObjectsV2Command({Bucket:recoveryStore.d.bucket,MaxKeys:1}),{abortSignal:timer.signal});
    requireThat(!(listed.Contents?.length) && !listed.IsTruncated,'RECOVERY_BUCKET_NOT_EMPTY');
    destination=await store(c,'destination');
    const prefix=c.op.destination.prefix,base='sets/'+c.op.setId;
    const receipt=JSON.parse((await plainFile(paths.receipt)).toString());
    requireThat(receipt.setId===c.op.setId && /^[a-f0-9]{64}$/.test(receipt.manifestCipherSha256),'INDEPENDENT_RECEIPT');
    // Pin receipt in the signed approval, not merely a mutable storage completion marker.
    requireThat(c.op.restoreManifestHash===receipt.manifestCipherSha256,'RECEIPT_NOT_APPROVED');
    const completion=await json(destination,prefix+'/'+base+'/completion.json',timer.signal);
    requireThat(canonical(completion)===canonical(receipt),'COMPLETION_MISMATCH');
    const mf=path.join(root,'manifest.bin');
    await download(destination,prefix+'/'+base+'/manifest.bin',mf,receipt.manifestCipherSha256,timer.signal,8*1024*1024);
    const chunks=[];let size=0;
    await decryptFileTo(mf,c.encryptionKey,new Writable({write(b,e,cb){size+=b.length;if(size>8*1024*1024){cb(new SafeError('MANIFEST_SIZE'));return;}chunks.push(b);cb();}}));
    const manifest=validateManifest(JSON.parse(Buffer.concat(chunks).toString()),c);
    // All paths/metadata checked before any database or media object is fetched.
    const cipher=path.join(root,'database.bin'),dump=path.join(root,'database.dump');
    await download(destination,prefix+'/'+manifest.database.objectKey,cipher,manifest.database.cipherSha256,timer.signal,manifest.database.cipherBytes);
    await decryptFileToPath(cipher,dump,c.encryptionKey,manifest.database.plainSha256,manifest.database.plainBytes);
    const list=child('pg_restore',['--list',dump],{signal:timer.signal});list.stdout.resume();await list.done;
    // A trusted synthetic source is required here; live archives remain blocked at policy validation.
    const restore=child('pg_restore',['--exit-on-error','--single-transaction','--no-owner','--no-acl',dump],
      {env:await databaseEnv(c,true),signal:timer.signal});restore.stdout.resume();await restore.done;
    requireThat(canonical(await tableDigests(c,timer.signal,true))===canonical(manifest.attestation.tableDigests),'RESTORED_DATA_MISMATCH');
    requireThat(canonical(await schemaFingerprint(c,timer.signal,true))===canonical(manifest.attestation.schema),'RESTORED_SCHEMA_MISMATCH');
    const existing=JSON.parse(await query(c,"SELECT coalesce(json_agg(file_path ORDER BY file_path),'[]'::json) FROM public.evidence_files WHERE deletion_requested_at IS NULL AND deleted_at IS NULL;",timer.signal,true));
    const keys=new Set(manifest.evidence.map(x=>x.key));requireThat(existing.every(x=>keys.has(x)),'RECOVERED_EVIDENCE_REFERENCE');
    for(let i=0;i<manifest.evidence.length;i++){
      const item=manifest.evidence[i],enc=path.join(root,'evidence-'+i+'.bin'),plain=path.join(root,'evidence-'+i+'.media');
      await download(destination,prefix+'/'+item.objectKey,enc,item.cipherSha256,timer.signal,item.cipherBytes);
      await decryptFileToPath(enc,plain,c.encryptionKey,item.plainSha256,item.plainBytes);
      await reconstruct(recoveryStore,item.key,plain,item.plainSha256,item.plainBytes,item.contentType,timer.signal);
      await fs.rm(enc);
    }
    await finish(ledger,'completed',{evidenceCount:manifest.evidence.length});
    log('recovery_completed',{objects:manifest.evidence.length,status:'PASS'});
    return {root,manifest};
  }catch(e){if(ledger)await finish(ledger,'failed',{targetMayBePartiallyRestored:true});throw e;}
  finally{await timer.close();await destination?.close();await recoveryStore?.close();}
}
if(isMain(import.meta.url)) await cli(runRecover);
