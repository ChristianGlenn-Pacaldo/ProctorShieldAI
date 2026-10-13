import { requireThat,safeKey,canonical } from './security.mjs';
export function validateManifest(m,config){
  const op=config.op;
  requireThat(m && m.format===1 && m.setId===op.setId && m.environmentId===op.environmentId &&
    m.appCommit===op.appCommit && Number.isFinite(Date.parse(m.completedAt)), 'MANIFEST_IDENTITY');
  requireThat(canonical(m.migrations)===canonical(op.database.migrations),'MIGRATIONS_MISMATCH');
  requireThat(m.database?.objectKey==='sets/'+op.setId+'/database.bin','DATABASE_MAPPING');
  requireThat(Array.isArray(m.evidence) && m.evidence.length<=op.maxObjects,'MANIFEST_EVIDENCE');
  const names=new Set();let total=0;
  const validateMeta=(x,max)=>{
    for(const key of ['plainSha256','cipherSha256'])requireThat(/^[a-f0-9]{64}$/.test(x[key]),'MANIFEST_HASH');
    requireThat(Number.isSafeInteger(x.plainBytes) && x.plainBytes>=0 && x.plainBytes<=max &&
      x.cipherBytes===x.plainBytes+28,'MANIFEST_LENGTH');
    total+=x.plainBytes;requireThat(total<=op.totalMaxBytes,'MANIFEST_TOTAL');
  };
  validateMeta(m.database,op.totalMaxBytes);
  m.evidence.forEach((x,i)=>{
    safeKey(x.key);requireThat(!names.has(x.key),'MANIFEST_DUPLICATE');names.add(x.key);
    requireThat(x.objectKey==='sets/'+op.setId+'/evidence/'+i+'.bin','EVIDENCE_MAPPING');
    requireThat(typeof x.contentType==='string' && x.contentType.length<=200 && !/[\r\n]/.test(x.contentType),'CONTENT_TYPE');
    validateMeta(x,op.evidenceMaxBytes);
  });
  requireThat(m.attestation && canonical(Object.keys(m.attestation.tableDigests||{}).sort())===canonical([...op.database.tables].sort()),'MANIFEST_ATTESTATION');
  for(const v of Object.values(m.attestation.tableDigests))requireThat(v && /^[a-f0-9]{64}$/.test(v.hmac) &&
    Number.isSafeInteger(v.bytes) && v.bytes>=0 && /^\d+$/.test(v.rows),'MANIFEST_TABLE_DIGEST');
  const s=m.attestation.schema;
  requireThat(s && Array.isArray(s.columns) && Array.isArray(s.constraints) && Array.isArray(s.indexes) &&
    (s.sequences===null || Array.isArray(s.sequences)),'MANIFEST_SCHEMA');
  return m;
}
