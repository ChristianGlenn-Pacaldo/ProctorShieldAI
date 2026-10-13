import { S3Client,GetObjectCommand,PutObjectCommand,ListObjectsV2Command,HeadObjectCommand } from '@aws-sdk/client-s3';
import { Readable,Transform } from 'node:stream';
import { createReadStream,createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { requireThat,secret,SafeError,safeKey,canonical,sha } from './security.mjs';

export async function store(config,kind){
  const d=config.op[kind];
  requireThat(d && ['source','destination','recoveryStore'].includes(kind),'STORE_KIND');
  const accessKeyId=(await secret(config,kind.toLowerCase()+'-access')).toString(),secretAccessKey=(await secret(config,kind.toLowerCase()+'-secret')).toString();
  const client=new S3Client({endpoint:d.endpoint,region:'us-east-1',forcePathStyle:true,maxAttempts:1,
    requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED',
    logger:{debug(){},info(){},warn(){},error(){}},
    credentials:{accessKeyId,secretAccessKey}});
  return {d,client,async close(){client.destroy();}};
}
function key(s,k){requireThat(typeof k==='string' && k.length<=1400 && !k.includes('\0') && !k.split('/').includes('..'),'OBJECT_KEY');return {Bucket:s.d.bucket,Key:k};}
export async function inventory(s,config,signal){
  const list=[];let token,total=0;const seen=new Set(),tokens=new Set();
  do {
    const r=await s.client.send(new ListObjectsV2Command({Bucket:s.d.bucket,Prefix:'evidence/',ContinuationToken:token}),{abortSignal:signal});
    for(const o of r.Contents||[]){
      safeKey(o.Key);requireThat(!seen.has(o.Key),'DUPLICATE_SOURCE_KEY');seen.add(o.Key);
      requireThat(Number.isSafeInteger(o.Size) && o.Size>=0 && o.Size<=config.op.evidenceMaxBytes,'SOURCE_OBJECT_SIZE');
      total+=o.Size;requireThat(total<=config.op.totalMaxBytes && list.length<config.op.maxObjects,'SOURCE_CAPACITY');
      requireThat(typeof o.ETag==='string','SOURCE_ETAG_REQUIRED');
      list.push({key:o.Key,size:o.Size,etag:o.ETag});
    }
    token=r.IsTruncated?r.NextContinuationToken:undefined;
    requireThat(!r.IsTruncated||token && !tokens.has(token),'SOURCE_PAGINATION');
    tokens.add(token);
  }while(token);
  return list.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
}
export async function get(s,k,signal,etag){
  return s.client.send(new GetObjectCommand({...key(s,k),...(etag?{IfMatch:etag}:{})}),{abortSignal:signal});
}
export async function hashBody(body,signal,maxBytes){
  const h=crypto.createHash('sha256');let bytes=0;
  for await(const b of body){if(signal?.aborted)throw new SafeError('CANCELLED');bytes+=b.length;requireThat(bytes<=maxBytes,'READ_SIZE_LIMIT');h.update(b);}
  return {sha256:h.digest('hex'),bytes};
}
export async function upload(s,k,file,metadata,signal,{contentType='application/octet-stream',overwrite=false}={}){
  requireThat(!overwrite,'REMOTE_OVERWRITE_FORBIDDEN');
  const st=await fs.stat(file);requireThat(st.size===metadata.cipherBytes,'UPLOAD_LENGTH');
  await s.client.send(new PutObjectCommand({...key(s,k),Body:createReadStream(file),ContentLength:st.size,ContentType:contentType,IfNoneMatch:'*'}),{abortSignal:signal});
  const r=await get(s,k,signal);requireThat(r.Body,'READBACK_MISSING');
  const h=await hashBody(r.Body,signal,st.size);
  requireThat(h.bytes===st.size && h.sha256===metadata.cipherSha256,'READBACK_CHECKSUM');
}
export async function putJson(s,k,value,signal){
  const bytes=Buffer.from(canonical(value));
  await s.client.send(new PutObjectCommand({...key(s,k),Body:bytes,ContentLength:bytes.length,ContentType:'application/json',IfNoneMatch:'*'}),{abortSignal:signal});
  const actual=await json(s,k,signal);
  requireThat(canonical(actual)===canonical(value),'MARKER_READBACK');
}
export async function json(s,k,signal){
  const r=await get(s,k,signal);requireThat(r.Body,'JSON_MISSING');
  const chunks=[];let n=0;
  for await(const b of r.Body){n+=b.length;requireThat(n<=1024*1024,'JSON_LIMIT');chunks.push(b);}
  return JSON.parse(Buffer.concat(chunks).toString());
}
export async function download(s,k,file,expected,signal,maxBytes){
  const r=await get(s,k,signal);requireThat(r.Body,'DOWNLOAD_MISSING');
  let size=0;const h=crypto.createHash('sha256');
  const meter=new Transform({transform(b,e,cb){size+=b.length;if(size>maxBytes){cb(new SafeError('DOWNLOAD_LIMIT'));return;}h.update(b);cb(null,b);}});
  await pipeline(r.Body,meter,createWriteStream(file,{flags:'wx',mode:0o600}),{signal});
  requireThat(h.digest('hex')===expected,'CIPHER_CHECKSUM');
  return size;
}
export async function reconstruct(s,k,file,plainSha,plainBytes,contentType,signal){
  safeKey(k);const stat=await fs.stat(file);requireThat(stat.size===plainBytes,'MEDIA_LENGTH');
  await s.client.send(new PutObjectCommand({...key(s,k),Body:createReadStream(file),ContentLength:stat.size,ContentType:contentType,IfNoneMatch:'*'}),{abortSignal:signal});
  const r=await get(s,k,signal);const h=await hashBody(r.Body,signal,plainBytes);
  requireThat(h.bytes===plainBytes && h.sha256===plainSha && r.ContentType===contentType,'RECOVERED_MEDIA_CHECKSUM');
}
