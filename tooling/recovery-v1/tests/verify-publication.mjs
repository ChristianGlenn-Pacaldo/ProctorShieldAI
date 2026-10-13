import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const base='2f0df056f0a76c9d897625fd1edc5ac448405758';
assert.equal(process.env.GITHUB_REF,'refs/heads/codex/recovery-tooling-synthetic-20261013');
const git=args=>execFileSync('git',['-C','../..',...args],{encoding:'utf8'}).trim();
git(['merge-base','--is-ancestor',base,'HEAD']);
const expected=JSON.parse(await fs.readFile('publication-files.json','utf8')).files.sort();
const actual=git(['diff','--name-status',base,'HEAD']).split('\n').map(x=>{
  const [status,name]=x.split('\t');assert.equal(status,'A');return name;
}).sort();
assert.deepEqual(actual,expected);
assert.ok(expected.every(x=>x.startsWith('tooling/recovery-v1/')||x==='.github/workflows/recovery-tooling-synthetic.yml'));
console.log('APPROVED_ADDITIVE_SCOPE_PASS');
