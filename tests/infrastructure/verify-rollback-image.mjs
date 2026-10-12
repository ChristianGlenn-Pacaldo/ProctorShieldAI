/** Verification only. Never imports an application handler or connects to a database. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import vm from 'node:vm';
import net from 'node:net';
import dns from 'node:dns';
import childProcess from 'node:child_process';
import { createRequire, stripTypeScriptTypes, syncBuiltinESMExports } from 'node:module';

const SOURCE_SHA = '2f0df056f0a76c9d897625fd1edc5ac448405758';
const SOURCE_TREE = 'bb247cb4a8cdb40383ddcb69ef11e69f983060cd';
const mode = process.env.ROLLBACK_VERIFY_MODE || process.argv[2];
function check(condition, label) { if (!condition) throw new Error(label); }
function walk(root) {
  return fs.readdirSync(root, {withFileTypes:true}).flatMap(entry => {
    const name = path.join(root, entry.name);
    return entry.isDirectory() ? walk(name) : entry.isFile() ? [name] : [];
  });
}
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const schemaDigest = text => crypto.createHash('sha256').update(text.replace(/\/\/[^\r\n]*/g,'').replace(/\s/g,'')).digest('hex');
const emit = value => console.log(JSON.stringify(value));

function installNetworkGuard() {
  // Applied to the unmodified image's default node server.js command via NODE_OPTIONS.
  // Deny outbound socket/DNS and subprocess attempts; never print their arguments.
  const blocked = kind => () => {
    console.error('ROLLBACK_FORBIDDEN_OPERATION:' + kind);
    throw new Error('Offline verification blocked an unexpected operation');
  };
  net.Socket.prototype.connect = blocked('outbound-socket');
  const lookup = dns.lookup;
  dns.lookup = function(host, options, callback) {
    if (net.isIP(host)) return lookup.call(this, host, options, callback);
    return blocked('dns-lookup')();
  };
  for (const key of Object.keys(dns)) {
    if (key.startsWith('resolve') || key === 'reverse') dns[key] = blocked('dns-resolution');
  }
  for (const key of Object.keys(dns.promises)) {
    if (key.startsWith('resolve') || key === 'reverse' || key === 'lookup') dns.promises[key] = blocked('dns-promise');
  }
  for (const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) childProcess[key] = blocked('subprocess');
  syncBuiltinESMExports();
}

async function passwordChecks(helper, label) {
  const result = [];
  const ok = (condition, name) => { check(condition, label + ': ' + name); result.push(name); };
  const reject = async (operation, name) => {
    let rejected = false; try { await operation(); } catch { rejected = true; }
    ok(rejected, name);
  };
  check(typeof helper.hashPassword === 'function' && typeof helper.verifyPassword === 'function', label + ': reader exports');
  const values = [['ASCII71','A'.repeat(71)],['ASCII72','A'.repeat(72)],['Unicode71','é'.repeat(35)+'A'],['Unicode72','é'.repeat(36)]];
  for (const [name, input] of values) {
    const hash = await helper.hashPassword(input);
    ok(hash.length === 71, name + ' storage length');
    ok(hash.startsWith('psai:pw:v1:$2b$12$'), name + ' canonical cost12 format');
    ok(await helper.verifyPassword(input, hash), name + ' accepted');
    ok(!await helper.verifyPassword(input+'X', hash), name + ' suffix rejected');
    ok(!await helper.verifyPassword('WrongSyntheticPassword!42', hash), name + ' wrong input rejected');
  }
  for (const [name, input] of [['ASCII73','A'.repeat(73)],['Unicode73','é'.repeat(36)+'A'],['embedded NUL','Synthetic\0Password42'],['appended NUL','SyntheticPassword42\0']]) {
    ok(!helper.isStrictPasswordInput(input), name + ' input rejected');
    await reject(() => helper.hashPassword(input), name + ' setter rejected');
  }
  const strict = await helper.hashPassword('A'.repeat(72));
  ok(!await helper.verifyPassword('A'.repeat(72)+'\0', strict), 'strict appended NUL rejected');
  ok(!await helper.verifyPassword('A'.repeat(71)+'\0', strict), 'strict embedded NUL rejected');
  // The genuine bcrypt payload is the exact suffix emitted by this helper.
  const legacy = strict.slice('psai:pw:v1:'.length);
  ok(await helper.verifyPassword('A'.repeat(73), legacy), 'legacy overlong login retained');
  ok(await helper.verifyPassword('A'.repeat(72)+'DifferentSuffix', legacy), 'legacy truncation compatibility retained');
  ok(await helper.verifyPassword('A'.repeat(72), legacy), 'legacy 72 byte prefix retained');
  ok(!await helper.verifyPassword('B'.repeat(72), legacy), 'legacy wrong input rejected');
  for (const [name, hash] of [['unknown version',strict.replace(':v1:',':v2:')],['extra bytes',strict+'X'],['short payload',strict.slice(0,-1)],['wrong cost',strict.replace('$12$','$11$')],['malformed legacy',legacy+'X'],['empty','']]) {
    ok(!await helper.verifyPassword('A'.repeat(72),hash), name + ' safely rejected');
  }
  // Synthetic secrets are deliberately never returned or logged.
  return {status:'PASS',assertions:result.length,checks:result};
}

function loadCompiledReader(root) {
  // Load genuine Turbopack registration arrays, not application route modules.
  // Preserve compiled helper/bcrypt factory bytes; adapt only the export/import transport.
  const require = createRequire(path.join(root,'package.json'));
  const factories = new Map();
  const files = walk(path.join(root,'.next/server/chunks')).filter(file => file.endsWith('.js'));
  const candidates = [];
  for (const file of files) {
    const text = fs.readFileSync(file,'utf8');
    if (!text.startsWith('module.exports=[')) continue;
    const registration = require(file);
    check(Array.isArray(registration), 'Turbopack registration array required');
    let ids = [];
    for (const entry of registration) {
      if (typeof entry === 'number' || typeof entry === 'string') ids.push(entry);
      else if (typeof entry === 'function') {
        for (const id of ids) factories.set(id,entry);
        if (entry.toString().includes('psai:pw:v1:') && entry.toString().includes('verifyPassword')) candidates.push({ids:[...ids],factory:entry,file});
        ids=[];
      } else throw new Error('Unexpected Turbopack registration format');
    }
  }
  check(candidates.length > 0,'Compiled version-aware reader absent');
  const loaded = new Map();
  const native = new Set();
  function load(id) {
    if (loaded.has(id)) return loaded.get(id);
    const factory = factories.get(id); check(factory,'Compiled reader dependency missing');
    const exports = {}; loaded.set(id,exports);
    const cjsModule = {exports};
    const context = {
      i:load,
      s(entries, alternateId) {
        const target = alternateId === undefined ? exports : (loaded.get(alternateId) || {});
        if (alternateId !== undefined) loaded.set(alternateId,target);
        for (let offset=0;offset<entries.length;offset+=3) {
          const [name,kind,value] = entries.slice(offset,offset+3);
          check(kind === 0,'Unsupported compiled export encoding');
          Object.defineProperty(target,name,{enumerable:true,get:()=>value});
        }
      },
      x(name) {
        check(['node:crypto','crypto','bcryptjs'].includes(name),'Unexpected compiled reader native import');
        native.add(name);return require(name);
      },
      v(value) { loaded.set(id, value?.default ? value : Object.assign({default:value},value)); },
      n(value) { loaded.set(id,Object.assign({default:value},value)); },
    };
    factory(context,cjsModule,cjsModule.exports);
    if(cjsModule.exports!==exports) loaded.set(id,Object.assign({default:cjsModule.exports},cjsModule.exports));
    return loaded.get(id);
  }
  const selected=candidates[0];
  const namespace=load(selected.ids[0]);
  check(typeof namespace.verifyPassword==='function','Compiled helper namespace missing reader');
  return {helper:namespace,proof:{file:path.relative(root,selected.file),sha256:digest(selected.file),moduleIds:selected.ids,nativeImports:[...native],source:'Actual final-image compiled factory; no reader/bcrypt replacement'}};
}

async function inspectImage() {
  const root='/app';
  check(fs.readFileSync('/etc/os-release','utf8').includes('ID=alpine'),'Runtime must be Alpine');
  check(process.getuid()===1001,'Runtime must use UID1001');
  check(!Object.keys(process.env).some(name=>/^(DATABASE_URL|REDIS_URL|PGHOST|PGPASSWORD|PGSERVICE|NEXTAUTH_SECRET|GITHUB_TOKEN|GH_TOKEN|S3_SECRET_KEY|SMTP_PASSWORD)$/.test(name)),'Forbidden credential/connection environment');
  check(fs.existsSync(root+'/server.js') && fs.existsSync(root+'/.next/static'),'Standalone server/static missing');
  const manifest=JSON.parse(fs.readFileSync('/review/source-manifest.json','utf8'));
  check(manifest.sourceSHA===SOURCE_SHA && manifest.sourceTree===SOURCE_TREE,'Immutable source manifest mismatch');
  for (const asset of manifest.assets) check(digest(path.join(root,asset.path))===asset.sha256,'Official asset mismatch');
  check(digest('/review/password-hash.ts')===manifest.passwordHelperSHA256,'Exact source helper mismatch');
  const require=createRequire(root+'/package.json');
  // Turbopack inlines many libraries. Only actual externals need node_modules entries.
  const dependencies=['next','react','react-dom','@prisma/client','pg','google-auth-library','@aws-sdk/client-s3'];
  const resolved=dependencies.map(name=>({name,path:path.relative(root,require.resolve(name))}));
  const traces=walk(path.join(root,'.next/server')).filter(file=>file.endsWith('.nft.json'));
  check(traces.length>0,'Standalone dependency traces absent');
  let traceEntries=0;
  for(const trace of traces) {
    for(const entry of JSON.parse(fs.readFileSync(trace,'utf8')).files) {
      const target=path.resolve(path.dirname(trace),entry);
      check(target.startsWith(root+'/') && fs.existsSync(target),'Standalone trace dependency missing');
      traceEntries++;
    }
  }
  const generated=require.resolve('.prisma/client/default');
  const generatedIndex=fs.readFileSync(path.join(path.dirname(generated),'index.js'),'utf8');
  const inlineSchema=generatedIndex.match(/"inlineSchema":\s*("(?:\\.|[^"\\])*")/);
  check(inlineSchema && schemaDigest(JSON.parse(inlineSchema[1]))===manifest.prismaSchemaNormalizedSHA256,'Generated Prisma inline schema differs from source');
  const files=walk(root);
  check(!files.some(file=>/\/\.env(?:$|\.(?!example$))/.test(file)),'Unexpected environment file in image');
  const connectionLiterals=[];
  for (const file of files.filter(file=>/\.(?:js|json|mjs|cjs|prisma)$/.test(file))) {
    const text=fs.readFileSync(file,'utf8');
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=]{32}|\bAKIA[0-9A-Z]{16}\b/.test(text)) connectionLiterals.push(path.relative(root,file));
  }
  check(connectionLiterals.length===0,'Credential signature found in runtime text');
  const compiled=loadCompiledReader(root);
  const compiledTests=await passwordChecks(compiled.helper,'actual compiled reader');
  let sourceTests={status:'NOT_APPLICABLE',assertions:0,reason:'bcrypt is compiler-inlined; actual compiled reader and bcrypt are exercised directly, without installing a duplicate runtime dependency'};
  let bcrypt;
  try { bcrypt=require('bcryptjs'); } catch(error) { check(error.code==='MODULE_NOT_FOUND','Unexpected standalone bcrypt loading error'); }
  if(bcrypt) {
    const context=vm.createContext({});
    const dependency=new vm.SyntheticModule(['default'],function(){this.setExport('default',bcrypt);},{context});
    const original=new vm.SourceTextModule(stripTypeScriptTypes(fs.readFileSync('/review/password-hash.ts','utf8')),{context});
    await original.link(name=>{check(name==='bcryptjs','Unexpected source dependency');return dependency;});
    await original.evaluate();
    sourceTests=await passwordChecks(original.namespace,'exact source reader');
  }
  emit({status:'PASS',sourceSHA:SOURCE_SHA,sourceTree:SOURCE_TREE,alpine:fs.readFileSync('/etc/os-release','utf8').split('\n').find(line=>line.startsWith('PRETTY_NAME=')),node:process.version,uid:process.getuid(),resolvedDependencies:resolved,traceFilesVerified:traces.length,traceEntriesVerified:traceEntries,generatedPrismaSchemaVerified:true,officialAssetsVerified:manifest.assets.length,credentialSignatureFindings:0,compiledReader:compiled.proof,compiledTests,sourceTests,liveDatabaseVerified:false,deployableStagingImage:false});
}

async function publicSmoke() {
  check(!process.env.DATABASE_URL && !process.env.REDIS_URL,'Smoke must not have database credentials');
  const manifest=JSON.parse(fs.readFileSync('/review/source-manifest.json','utf8'));
  let response;
  for (let attempt=0;attempt<45;attempt++) {
    try { response=await fetch('http://127.0.0.1:3000/'); break; }
    catch { await new Promise(resolve=>setTimeout(resolve,1000)); }
  }
  check(response?.status===200,'Offline homepage did not start successfully');
  const html=await response.text();
  check(html.includes('ProctorShieldAI'),'Homepage branding missing');
  const requests=[{path:'/',status:response.status}];
  for (const asset of manifest.assets) {
    const url='/'+asset.path.replace(/^public\//,'');
    const media=await fetch('http://127.0.0.1:3000'+url);
    check(media.status===200,'Public asset response failed');
    check(crypto.createHash('sha256').update(Buffer.from(await media.arrayBuffer())).digest('hex')===asset.sha256,'Served official asset mismatch');
    requests.push({path:url,status:media.status});
  }
  emit({status:'PASS',requests,network:'Only localhost inside network-none container',authRequests:0,healthRequests:0,databaseRequests:0});
}

function execute(args,cwd,options={}) {
  const cp=childProcess.spawnSync(args[0],args.slice(1),{cwd,encoding:'utf8',timeout:options.timeout||60_000,maxBuffer:20*1024*1024,env:options.env||process.env});
  if(cp.status!==0) {
    const line=cp.stdout.split('\n').findLast(text=>text.startsWith('{"status":"FAIL"'));
    if(line) console.error(line);
    throw new Error(options.label||'Verification subprocess failed');
  }
  return (options.combine ? cp.stdout+'\n'+cp.stderr : cp.stdout).trim();
}
function verifySource(candidate,out) {
  const git=(...args)=>execute(['git',...args],candidate);
  check(git('rev-parse','HEAD')===SOURCE_SHA,'Candidate SHA mismatch');
  check(git('rev-parse','HEAD^{tree}')===SOURCE_TREE,'Candidate tree mismatch');
  check(!git('status','--porcelain'),'Application source checkout must be pristine');
  check(!git('ls-files').split('\n').some(name=>/(^|\/)\.env($|\.(?!example$))|\.(?:dump|bak|p12|pfx|pem|key)$/.test(name)),'Private context file detected');
  const paths=['public/images/proctorshieldai-logo-transparent.png','public/images/proctorshieldai-shield-transparent.png','public/videos/original-google-flow-intro.mp4'];
  const expected=['4fd4f338f01cfa1ddf0c0aa96613af4abebde3f1d4168650ef067af10d3800f3','96265c440c83e31d72401bea4045eb47f421011265974fdcf359769375af457a','4262e37aa65b869e543f26833a6569f9d4e391690138b6909846b2f7a5205a82'];
  const assets=paths.map((name,i)=>{const sha=digest(path.join(candidate,name));check(sha===expected[i],'Source official asset checksum mismatch');return{path:name,sha256:sha};});
  const result={sourceSHA:SOURCE_SHA,sourceTree:SOURCE_TREE,passwordHelperSHA256:digest(path.join(candidate,'src/lib/password-hash.ts')),prismaSchemaSHA256:digest(path.join(candidate,'prisma/schema.prisma')),prismaSchemaNormalizedSHA256:schemaDigest(fs.readFileSync(path.join(candidate,'prisma/schema.prisma'),'utf8')),assets,syntheticConfiguration:true};
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'source-manifest.json'),JSON.stringify(result,null,2));
  fs.copyFileSync(path.join(candidate,'src/lib/password-hash.ts'),path.join(out,'password-hash.ts'));
  emit({status:'PASS',sourceSHA:SOURCE_SHA,sourceTree:SOURCE_TREE,assetsVerified:assets.length});
}

async function verifyRuntime(image,out,harness) {
  const docker=(...args)=>execute(['docker',...args],undefined,{label:'Docker verification failed',timeout:180_000,combine:args[0]==='logs'});
  const info=JSON.parse(docker('image','inspect',image))[0];
  check(info.Config.User==='nextjs','Image user changed');
  check(info.Config.Labels?.['org.opencontainers.image.revision']===SOURCE_SHA,'Image revision label mismatch');
  check(JSON.stringify(info.Config.Cmd)===JSON.stringify(['node','server.js']),'Unexpected startup command');
  const allowed=new Set(['PATH','NODE_VERSION','YARN_VERSION','NODE_ENV','NEXT_TELEMETRY_DISABLED','PORT','HOSTNAME','NEXT_PUBLIC_GOOGLE_CLIENT_ID','NEXT_PUBLIC_PUSHER_KEY','NEXT_PUBLIC_PUSHER_CLUSTER','NEXT_PUBLIC_APP_URL']);
  check((info.Config.Env||[]).every(entry=>allowed.has(entry.split('=')[0])),'Unexpected image environment');
  const evidence={id:info.Id,repoDigests:info.RepoDigests||[],architecture:info.Architecture,os:info.Os,size:info.Size,user:info.Config.User,entrypoint:info.Config.Entrypoint,cmd:info.Config.Cmd,environmentNames:(info.Config.Env||[]).map(entry=>entry.split('=')[0]),sourceSHA:SOURCE_SHA,deployableStagingImage:false};
  fs.writeFileSync(path.join(out,'image-inspection.json'),JSON.stringify(evidence,null,2));
  const review=fs.mkdtempSync(path.join(os.tmpdir(),'rollback-review-'));
  for (const name of ['source-manifest.json','password-hash.ts']) fs.copyFileSync(path.join(out,name),path.join(review,name));
  fs.copyFileSync(harness,path.join(review,'verify-rollback-image.mjs'));
  const mount=`type=bind,src=${review},dst=/review,readonly`;
  const security=['--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','768m','--cpus','2','--mount',mount];
  const imageCheck=docker('run','--rm',...security,'--entrypoint','node',image,'--experimental-vm-modules','/review/verify-rollback-image.mjs','inspect');
  const parsed=JSON.parse(imageCheck);check(parsed.status==='PASS','Image reader checks failed');
  fs.writeFileSync(path.join(out,'image-runtime-checks.json'),JSON.stringify(parsed,null,2));
  const name='psai-rollback-'+crypto.randomBytes(5).toString('hex');let created=false;
  try {
    docker('create','--name',name,...security,'--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--env','NODE_OPTIONS=--import=/review/verify-rollback-image.mjs','--env','ROLLBACK_VERIFY_MODE=guard',image);created=true;
    docker('start',name);
    const smoke=JSON.parse(docker('exec','--env','NODE_OPTIONS=','--env','ROLLBACK_VERIFY_MODE=smoke',name,'node','/review/verify-rollback-image.mjs'));
    const logs=docker('logs',name);
    check(!/ROLLBACK_FORBIDDEN_OPERATION|WrongSyntheticPassword|DifferentSuffix|SyntheticPassword42|A{71}|é{35}/.test(logs),'Unexpected operation or synthetic secret in server logs');
    const container=JSON.parse(docker('inspect',name))[0];
    check(container.HostConfig.NetworkMode==='none' && container.HostConfig.ReadonlyRootfs,'Runtime isolation missing');
    check(!container.HostConfig.PortBindings || Object.keys(container.HostConfig.PortBindings).length===0,'Unexpected published port');
    check(container.State.Running,'Server stopped unexpectedly');
    fs.writeFileSync(path.join(out,'public-smoke.json'),JSON.stringify(smoke,null,2));
    fs.writeFileSync(path.join(out,'sanitized-startup.log'),logs+'\n');
    fs.writeFileSync(path.join(out,'isolation-evidence.json'),JSON.stringify({status:'PASS',networkMode:'none',readOnlyRoot:true,publishedPorts:0,defaultCommand:container.Config.Cmd,capDrop:container.HostConfig.CapDrop,securityOpt:container.HostConfig.SecurityOpt,subprocessAndNetworkGuard:true,forbiddenOperations:0,liveSecretsSupplied:false,databaseConnections:0,operatorCommands:0,migrationCommands:0,syntheticPasswordLogMatches:0},null,2));
  } catch(error) {
    if(created) {
      const logs=docker('logs',name);
      if(!/WrongSyntheticPassword|DifferentSuffix|SyntheticPassword42|A{71}|é{35}/.test(logs)) fs.writeFileSync(path.join(out,'sanitized-startup-failure.log'),logs+'\n');
    }
    throw error;
  } finally { if(created) docker('rm','--force',name);fs.rmSync(review,{recursive:true,force:true}); }
  emit({status:'PASS',imageID:info.Id,compiledReaderAssertions:parsed.compiledTests.assertions,sourceReaderAssertions:parsed.sourceTests.assertions,deployableStagingImage:false});
}

if(mode==='guard') installNetworkGuard();
else {
  try {
    if(mode==='source') verifySource(process.argv[3],process.argv[4]);
    else if(mode==='runtime') await verifyRuntime(process.argv[3],process.argv[4],path.resolve(process.argv[1]));
    else if(mode==='inspect') await inspectImage();
    else if(mode==='smoke') await publicSmoke();
    else if(mode==='local-compiled') {
      const reader=loadCompiledReader(path.resolve(process.argv[3]));
      emit({proof:reader.proof,result:await passwordChecks(reader.helper,'local compiled loader precheck')});
    } else throw new Error('Unknown verification mode');
  } catch(error) {
    // Never serialize arbitrary dependency errors, URLs, source, inputs or hashes.
    const message=error instanceof Error ? error.message : 'Verification failed';
    console.error(JSON.stringify({status:'FAIL',mode,error:message.slice(0,180)}));
    process.exitCode=1;
  }
}
