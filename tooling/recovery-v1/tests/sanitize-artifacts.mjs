import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const names=['unit-results.json','integration-results.json','cloud-runtime-sanitized.json','build-provenance.json',
  'runtime-restrictions.json','cleanup.json','failure.json'];
await fs.mkdir('sanitized-artifacts',{recursive:true});
let copied=0;
for(const name of names){
  let raw;try{raw=await fs.readFile(path.join('evidence',name),'utf8');}catch(e){if(e.code==='ENOENT')continue;throw e;}
  assert.ok(raw.length<256*1024);JSON.parse(raw);
  // No raw output, keys, signed envelopes, URLs with credentials or synthetic password values.
  assert.ok(!/PRIVATE KEY|postgres(?:ql)?:\/\/|signature"|SYNTHETIC_ONLY|synthetic-(?:database|recovery)-password|(?:gh[pousr]_)[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}/.test(raw));
  await fs.writeFile(path.join('sanitized-artifacts',name),raw);copied++;
}
assert.ok(copied>0);
await fs.writeFile('sanitized-artifacts/NOT-FOR-LIVE-DATA.txt','NOT FOR LIVE DATA OR STAGING DEPLOYMENT. Synthetic verification only. No archive or image export.\n');
