import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const isMain=url=>Boolean(process.argv[1]) && path.resolve(process.argv[1])===fileURLToPath(url);

export class SafeError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function requireThat(value, code = 'REJECTED') { if (!value) throw new SafeError(code); }
export const sha = data => crypto.createHash('sha256').update(data).digest('hex');
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
export function log(event, fields = {}) {
  const allowed = ['action','status','code','objects','elapsedMs','phase','exitCode'];
  requireThat(/^[a-z_]{1,60}$/.test(event), 'LOG_EVENT');
  const safe = { event };
  for (const k of allowed) if (Object.hasOwn(fields, k)) {
    const v=fields[k];
    requireThat(typeof v === 'number' || (typeof v === 'string' && /^[A-Za-z0-9_ -]{1,80}$/.test(v)), 'LOG_FIELD');
    safe[k]=v;
  }
  process.stdout.write(JSON.stringify(safe) + '\n');
}
export async function plainFile(filename, max = 1024*1024) {
  const stat=await fs.lstat(filename);
  requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size <= max, 'FILE_TYPE_SIZE');
  const real=await fs.realpath(filename);
  requireThat(path.resolve(filename)===real || process.platform==='win32' && path.resolve(filename).toLowerCase()===real.toLowerCase(), 'FILE_SYMLINK');
  return fs.readFile(real);
}
export function validateEndpoint(value, mode, kind) {
  if(mode==='live') throw new SafeError('LIVE_GATE_INTEGRATION_UNVERIFIED');
  requireThat(mode==='synthetic','POLICY_SCHEMA');
  const u=new URL(value);
  requireThat(!u.username && !u.password && u.pathname==='/' && !u.search && !u.hash, 'ENDPOINT_ORIGIN');
  requireThat(u.protocol==='http:' && ['127.0.0.1','[::1]'].includes(u.hostname), 'SYNTHETIC_LOOPBACK_ONLY');
  return u.origin;
}
export function validateName(s, code='NAME') { requireThat(typeof s==='string' && /^[A-Za-z][A-Za-z0-9_-]{0,62}$/.test(s),code); }
export function safeKey(k) {
  requireThat(typeof k==='string' && k.startsWith('evidence/') && k.length<=1024 && !k.includes('\\') && !k.includes('\0') &&
    !k.split('/').some(x=>x==='..'||x==='.'||x===''), 'EVIDENCE_KEY');
}
export async function signedFile(filename, pem, role) {
  const envelope=JSON.parse((await plainFile(filename)).toString());
  requireThat(envelope && envelope.payload && typeof envelope.signature==='string', 'SIGNATURE_ENVELOPE');
  const key=crypto.createPublicKey(pem);
  requireThat(key.asymmetricKeyType==='ed25519','SIGNATURE_ALGORITHM');
  const signature=Buffer.from(envelope.signature,'base64');
  requireThat(signature.length===64 && crypto.verify(null,Buffer.from(canonical(envelope.payload)),key,signature),'SIGNATURE_INVALID');
  requireThat(envelope.payload.role===role,'SIGNER_ROLE');
  return envelope.payload;
}
function validatePolicy(op) {
  requireThat(op.schema===1 && ['synthetic','live'].includes(op.mode),'POLICY_SCHEMA');
  if(op.mode==='live') throw new SafeError('LIVE_GATE_INTEGRATION_UNVERIFIED');
  requireThat(/^psai-recovery-[A-Za-z0-9-]{8,64}$/.test(op.operationId),'OPERATION_ID');
  requireThat(/^[0-9TZ-]{20,32}-[0-9a-f-]{36}$/.test(op.setId),'SET_ID');
  requireThat(Array.isArray(op.actions) && op.actions.length && op.actions.every(x=>['backup','recover','gate','watchdog','verify','cleanup'].includes(x)), 'ACTIONS');
  const now=Date.now();
  requireThat(Number.isFinite(Date.parse(op.notBefore)) && now>=Date.parse(op.notBefore) &&
    Number.isFinite(Date.parse(op.expiresAt)) && now<Date.parse(op.expiresAt) &&
    Date.parse(op.expiresAt)-Date.parse(op.notBefore)<=86400000,'APPROVAL_TIME');
  requireThat(Number.isInteger(op.maxRuntimeMs) && op.maxRuntimeMs>=100 && op.maxRuntimeMs<=4*3600000,'RUNTIME_LIMIT');
  requireThat(/^[a-f0-9]{64}$/.test(op.imageDigest) && /^[a-f0-9]{40}$/.test(op.appCommit),'SOURCE_IMAGE_DIGEST');
  requireThat(op.source.bucket!==op.destination.bucket && op.source.endpoint!==op.destination.endpoint,'DESTINATION_SEPARATION');
  for (const kind of ['source','destination']) {
    validateEndpoint(op[kind].endpoint,op.mode,kind);
    requireThat(/^[a-z0-9][a-z0-9-]{2,62}$/.test(op[kind].bucket),'BUCKET');
  }
  requireThat(op.destination.prefix==='proctorshieldai','DESTINATION_PREFIX');
  validateEndpoint(op.gate.endpoint,op.mode,'gate');
  requireThat(op.gate.contract==='owned-lease-v1','GATE_OWNERSHIP_REQUIRED');
  requireThat(op.database.host==='127.0.0.1' && Number.isInteger(op.database.port) && op.database.port>1024 && op.database.port<65536,'DATABASE_TUNNEL_ONLY');
  validateName(op.database.name);validateName(op.database.role);
  requireThat(Array.isArray(op.database.tables) && op.database.tables.length>0 && op.database.tables.length<=100 &&
    new Set(op.database.tables).size===op.database.tables.length,'TABLE_ALLOWLIST');
  op.database.tables.forEach(x=>requireThat(typeof x==='string' && /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(x),'NAME'));
  requireThat(op.database.serverMajor===18 && Array.isArray(op.database.migrations),'POSTGRES_18');
  requireThat(op.evidenceMaxBytes>0 && Number.isSafeInteger(op.evidenceMaxBytes) && op.evidenceMaxBytes<5*1024**3-28,'OBJECT_LIMIT');
  requireThat(op.totalMaxBytes>=op.evidenceMaxBytes && Number.isSafeInteger(op.totalMaxBytes) && Number.isInteger(op.maxObjects) && op.maxObjects<=100000 && op.maxObjects>0,'CAPACITY_LIMIT');
  requireThat(typeof op.runnerId==='string' && op.runnerId.length>=8,'RUNNER_ID');

}
export async function loadOperation({operation,context,trust,secrets,work},action) {
  requireThat(operation && context && trust && secrets && work,'EXPLICIT_PATHS_REQUIRED');
  const anchors=JSON.parse((await plainFile(trust)).toString());
  requireThat(anchors.schema===1 && anchors.approverPublicKey && anchors.runtimePublicKey &&
    anchors.approverPublicKey!==anchors.runtimePublicKey,'INDEPENDENT_TRUST_KEYS');
  for(const prefix of ['approver','runtime']){
    const publicKey=crypto.createPublicKey(anchors[prefix+'PublicKey']).export({type:'spki',format:'der'});
    requireThat(sha(publicKey)===anchors[prefix+'Fingerprint'],'TRUST_FINGERPRINT');
  }
  const op=await signedFile(operation,anchors.approverPublicKey,'approval');
  validatePolicy(op);
  requireThat(op.actions.includes(action),'ACTION_NOT_APPROVED');
  const runtime=await signedFile(context,anchors.runtimePublicKey,'runtime');
  requireThat(runtime.operationHash===sha(canonical(op)) && runtime.runnerId===op.runnerId &&
    runtime.imageDigest===op.imageDigest && /^[a-f0-9]{64}$/.test(runtime.imageId) && runtime.restartPolicy==='no' &&
    runtime.networkIsolationVerified===true && runtime.encryptedStorageVerified===true &&
    runtime.hardDeadlineVerified===true && Date.now()<Date.parse(runtime.expiresAt),'RUNTIME_ATTESTATION');
  requireThat(runtime.mode===op.mode && (op.mode!=='synthetic'||runtime.noLiveCredentials===true),'RUNTIME_REALM');
  requireThat(Math.min(Date.parse(op.expiresAt),Date.parse(runtime.expiresAt))-Date.now()>=op.maxRuntimeMs,'APPROVAL_RUNTIME_WINDOW');
  const workRoot=await fs.realpath(work),secretRoot=await fs.realpath(secrets);
  requireThat(workRoot!==secretRoot && !secretRoot.startsWith(workRoot+path.sep),'ROOT_SEPARATION');
  requireThat((await fs.lstat(work)).isDirectory() && !(await fs.lstat(work)).isSymbolicLink() &&
    (await fs.lstat(secrets)).isDirectory() && !(await fs.lstat(secrets)).isSymbolicLink(),'ROOT_SYMLINK');
  if(process.platform!=='win32') requireThat(((await fs.stat(secretRoot)).mode&0o077)===0,'SECRET_DIRECTORY_PERMISSIONS');
  const config={op,runtime,workRoot,secretRoot,operationHash:sha(canonical(op))};
  const key=await secret(config,'encryption-key');
  requireThat(/^[A-Za-z0-9+/]{43}=$/.test(key.toString()) && Buffer.from(key.toString(),'base64').length===32,'ENCRYPTION_KEY');
  config.encryptionKey=Buffer.from(key.toString(),'base64');
  config.auditKey=await secret(config,'audit-key');requireThat(config.auditKey.length>=32,'AUDIT_KEY');
  return config;
}
export async function secret(config,name) {
  requireThat(/^[a-z][a-z0-9-]{1,40}$/.test(name),'SECRET_NAME');
  const filename=path.join(config.secretRoot,name),stat=await fs.lstat(filename);
  if(process.platform!=='win32')requireThat((stat.mode&0o077)===0,'SECRET_PERMISSIONS');
  const bytes=await plainFile(filename,8192);
  requireThat(bytes.length>0,'SECRET_EMPTY');return bytes;
}
export async function secureDirectory(root,relative) {
  requireThat(/^[a-zA-Z0-9_-]+$/.test(relative),'WORK_PATH');
  const target=path.join(root,relative);
  await fs.mkdir(target,{mode:0o700});
  requireThat((await fs.realpath(target))===target || process.platform==='win32','WORK_SYMLINK');
  return target;
}
export async function syncFile(filename,data,exclusive=false){
  const h=await fs.open(filename,exclusive?'wx':'w',0o600);
  try{await h.writeFile(data);await h.sync();}finally{await h.close();}
}
export async function begin(config,action) {
  const ledger=path.join(config.workRoot,'ledger');
  await fs.mkdir(ledger,{mode:0o700,recursive:true});
  requireThat((await fs.lstat(ledger)).isDirectory() && !(await fs.lstat(ledger)).isSymbolicLink(),'LEDGER_SYMLINK');
  const name=path.join(ledger,config.op.operationId+'-'+action+'.json');
  const receipt={schema:1,operationId:config.op.operationId,action,operationHash:config.operationHash,status:'started',startedAt:new Date().toISOString()};
  await syncFile(name,canonical(receipt),true);
  if(process.platform!=='win32'){const d=await fs.open(ledger,'r');try{await d.sync();}finally{await d.close();}}
  const events=name+'.events';
  await syncFile(events,canonical({event:'started',at:receipt.startedAt})+'\n',true);
  return {name,events,receipt};
}
export async function finish(ledger,status,extra={}){
  const h=await fs.open(ledger.events,'a',0o600);
  try{await h.write(canonical({event:status,at:new Date().toISOString(),...extra})+'\n');await h.sync();}finally{await h.close();}
}
export function args(argv){
  const result={};for(let i=0;i<argv.length;i+=2){
    requireThat(/^--[a-z]+$/.test(argv[i]) && argv[i+1] && !argv[i+1].startsWith('--'),'CLI_ARGUMENT');
    const key=argv[i].slice(2);requireThat(['operation','context','trust','secrets','work','action','manifest','receipt','job'].includes(key) && !Object.hasOwn(result,key),'CLI_ARGUMENT');
    result[key]=argv[i+1];
  }return result;
}
export async function cli(main) {
  try { await main(args(process.argv.slice(2))); }
  catch(error){log('operation_failed',{code:error instanceof SafeError?error.code:'OPERATION_FAILED'});process.exitCode=1;}
}
