/** GitHub-only verification. Connects exclusively to an owned disposable PostgreSQL fixture. */
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
function check(condition, label) { if (!condition) { const error=new Error(label); error.safe=true; throw error; } }
function walk(root) {
  return fs.readdirSync(root, {withFileTypes:true}).flatMap(entry => {
    const name = path.join(root, entry.name);
    return entry.isDirectory() ? walk(name) : entry.isFile() ? [name] : [];
  });
}
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const schemaDigest = text => crypto.createHash('sha256').update(text.replace(/\/\/[^\r\n]*/g,'').replace(/\s/g,'')).digest('hex');
const emit = value => console.log(JSON.stringify(value));

function installNetworkGuard(allowDatabase=false) {
  const blocked = kind => () => {
    console.error('ROLLBACK_FORBIDDEN_OPERATION:' + kind);
    const error=new Error('Runtime safety guard rejected an operation');
    error.code='PSAI_RUNTIME_BLOCKED';error.safe=true;throw error;
  };
  const connect=net.Socket.prototype.connect;
  net.Socket.prototype.connect=function(...args) {
    if(allowDatabase && allowedDestination(args)) return connect.apply(this,args);
    return blocked('outbound-socket')();
  };
  const lookup=dns.lookup;
  dns.lookup=function(host,...args) {
    if(allowDatabase && host==='127.0.0.1') return lookup.call(this,host,...args);
    return blocked('dns-lookup')();
  };
  for(const key of Object.keys(dns)) if(key.startsWith('resolve') || key==='reverse') dns[key]=blocked('dns-resolution');
  for(const key of Object.keys(dns.promises)) if(key.startsWith('resolve') || key==='reverse' || key==='lookup') dns.promises[key]=blocked('dns-promise');
  for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) childProcess[key]=blocked('subprocess');
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
  const dependencies=['next','react','react-dom','@prisma/client','pg'];
  const resolved=dependencies.map(name=>({name,path:path.relative(root,require.resolve(name))}));
  const optionalRootEntries=['google-auth-library','@aws-sdk/client-s3','bcryptjs','jsonwebtoken','ioredis','@prisma/adapter-pg','nodemailer','pusher'].map(name=>{
    try { return {name,rootEntry:path.relative(root,require.resolve(name))}; }
    catch(error) { check(error.code==='MODULE_NOT_FOUND','Unexpected package entry resolution error');return {name,rootEntry:null,note:'Root entry pruned/bundled; required files are validated against all actual traces below'}; }
  });
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
  emit({status:'PASS',sourceSHA:SOURCE_SHA,sourceTree:SOURCE_TREE,alpine:fs.readFileSync('/etc/os-release','utf8').split('\n').find(line=>line.startsWith('PRETTY_NAME=')),node:process.version,uid:process.getuid(),resolvedDependencies:resolved,optionalRootEntries,traceFilesVerified:traces.length,traceEntriesVerified:traceEntries,generatedPrismaSchemaVerified:true,officialAssetsVerified:manifest.assets.length,credentialSignatureFindings:0,compiledReader:compiled.proof,compiledTests,sourceTests,liveDatabaseVerified:false,deployableStagingImage:false});
}

async function publicSmoke() {
  check(!process.env.DATABASE_URL && !process.env.REDIS_URL,'Smoke must not have database credentials');
  const manifest=JSON.parse(fs.readFileSync('/review/source-manifest.json','utf8'));
  let response;
  for (let attempt=0;attempt<45;attempt++) {
    try { response=await fetch('http://127.0.0.1:3000/'); break; }
    catch { await new Promise(resolve=>setTimeout(resolve,1000)); }
  }
  check(response?.status===200,'Owned production homepage did not start successfully');
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
  emit({status:'PASS',requests,network:'Owned loopback-only namespace; observer HTTP only',authRequests:0,healthRequests:0,databaseRequests:0});
}

function execute(args,cwd,options={}) {
  const cp=childProcess.spawnSync(args[0],args.slice(1),{cwd,encoding:'utf8',timeout:options.timeout||60_000,maxBuffer:20*1024*1024,env:options.env||process.env});
  if(cp.status!==0) {
    // Forward only structured, controlled harness failures; never dependency stderr.
    const lines=cp.stdout.split('\n').concat(cp.stderr.split('\n'));
    for(const line of lines) if(line.startsWith('{"status":"FAIL"')) {
      try { const value=JSON.parse(line); if(value.safe===true) console.error(JSON.stringify(value)); } catch { /* Withhold untrusted diagnostic. */ }
    }
    check(false,options.label||'Controlled verification subprocess failed');
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
  const migrations=fs.readdirSync(path.join(candidate,'prisma/migrations')).sort().flatMap(name=>{const relative='prisma/migrations/'+name+'/migration.sql';return fs.existsSync(path.join(candidate,relative)) ? [{path:relative,sha256:digest(path.join(candidate,relative))}] : [];});
  check(migrations.length===10,'Unexpected migration inventory');
  const result={dockerfileSHA256:digest(path.join(candidate,'Dockerfile')),migrations,sourceSHA:SOURCE_SHA,sourceTree:SOURCE_TREE,passwordHelperSHA256:digest(path.join(candidate,'src/lib/password-hash.ts')),prismaSchemaSHA256:digest(path.join(candidate,'prisma/schema.prisma')),prismaSchemaNormalizedSHA256:schemaDigest(fs.readFileSync(path.join(candidate,'prisma/schema.prisma'),'utf8')),assets,syntheticConfiguration:true};
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'source-manifest.json'),JSON.stringify(result,null,2));
  fs.copyFileSync(path.join(candidate,'src/lib/password-hash.ts'),path.join(out,'password-hash.ts'));
  emit({status:'PASS',sourceSHA:SOURCE_SHA,sourceTree:SOURCE_TREE,assetsVerified:assets.length});
}

const BRANCH = 'refs/heads/codex/cloud-production-runtime-verification-20261013';
const DB = 'proctorshield_runtime_image_test';
const DB_PORT = 55432;
const OWNER = 'psai_runtime_owner';
const APP = 'psai_runtime_app';
const OWNERSHIP = 'proctorshield.runtime.instance';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = (out, name, value) => fs.writeFileSync(path.join(out,name), typeof value==='string' ? value : JSON.stringify(value,null,2));

function normalizeDestination(args) {
  // Node may pass an already-normalized [options, callback] pair to Socket.connect.
  if (Array.isArray(args[0])) return normalizeDestination(args[0]);
  const first=args[0];
  if (first && typeof first==='object') {
    if (first.path || first.fd !== undefined || first.socket || first.lookup) return null;
    return {host:first.host,port:String(first.port)};
  }
  if (typeof first==='number' || (typeof first==='string' && /^\d+$/.test(first))) {
    return {port:String(first),host:typeof args[1]==='string' ? args[1] : undefined};
  }
  return null;
}
function allowedDestination(args) {
  const target=normalizeDestination(args);
  return !!target && target.host==='127.0.0.1' && target.port===String(DB_PORT);
}
function guardedDatabaseConfig() {
  const value=JSON.parse(fs.readFileSync('/private/config.json','utf8'));
  check(/^[0-9a-f]{24}$/.test(value.instance),'Invalid synthetic instance');
  for (const key of ['ownerPassword','appPassword']) check(/^[0-9a-f]{64}$/.test(value[key]),'Invalid generated password');
  return value;
}
function databaseUrl(user,password) {
  check([OWNER,APP].includes(user) && /^[0-9a-f]{64}$/.test(password),'Unsafe synthetic credentials');
  const url=new URL(`postgresql://${user}:${password}@127.0.0.1:${DB_PORT}/${DB}`);
  check(url.hostname==='127.0.0.1' && url.port===String(DB_PORT) && url.pathname==='/'+DB && !url.search && !url.hash,'Unsafe destination');
  return url.toString();
}
async function withDatabase(user, operation) {
  const config=guardedDatabaseConfig();
  installNetworkGuard(true);
  const require=createRequire('/app/package.json');
  const {Client}=require('pg');
  const client=new Client({connectionString:databaseUrl(user,user===OWNER ? config.ownerPassword : config.appPassword),connectionTimeoutMillis:5000,query_timeout:15000});
  try {
    await client.connect();
    const {rows:[identity]}=await client.query(`SELECT current_database() AS database, current_user AS username,
      inet_server_addr()::text AS address, inet_server_port() AS port,
      current_setting('server_version_num')::int AS version,
      shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()`);
    check(identity.database===DB && identity.username===user && identity.address==='127.0.0.1' && identity.port===DB_PORT && Math.floor(identity.version/10000)===18 && identity.marker==='proctorshield:disposable:'+config.instance,'Effective database identity mismatch');
    const {rows:[role]}=await client.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user');
    check(Object.values(role).every(value=>value===false),'Unexpected database privileges');
    return await operation(client,{...identity,markerVerified:true},config);
  } finally { await client.end(); }
}
async function schemaSnapshot(client) {
  const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row=>row.tablename);
  check(tables.length===22 && tables.includes('settings') && tables.includes('users'),'Unexpected application table inventory');
  const counts={};
  for(const table of tables) {
    check(/^[a-z_]+$/.test(table),'Unsafe table identifier');
    counts[table]=(await client.query(`SELECT count(*)::int AS count FROM public."${table}"`)).rows[0].count;
  }
  check(Object.values(counts).every(count=>count===0),'Synthetic application tables must stay empty');
  const columns=(await client.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;
  const indexes=(await client.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")).rows;
  const constraints=(await client.query("SELECT c.relname AS tablename,k.conname,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,k.conname")).rows;
  check(columns.some(row=>row.table_name==='users' && row.column_name==='password' && row.data_type==='text'),'Password storage mismatch');
  check(columns.some(row=>row.table_name==='users' && row.column_name==='session_version' && row.data_type==='integer'),'Session version missing');
  return {counts,catalogSHA256:crypto.createHash('sha256').update(JSON.stringify({columns,indexes,constraints})).digest('hex'),tables:tables.length,indexes:indexes.length,constraints:constraints.length};
}
async function initializeDatabase() {
  return withDatabase(OWNER,async(client,identity)=>{
    check((await client.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'")).rows[0].count===0,'Database not fresh; schema initialization refused');
    const manifest=JSON.parse(fs.readFileSync('/review/source-manifest.json','utf8'));
    check(manifest.sourceSHA===SOURCE_SHA && manifest.migrations.length===10,'Migration manifest mismatch');
    for(const migration of manifest.migrations) {
      check(/^prisma\/migrations\/[0-9a-z_]+\/migration\.sql$/.test(migration.path),'Unsafe migration path');
      const file=path.join('/review',migration.path);
      check(digest(file)===migration.sha256,'Migration bytes mismatch');
      await client.query(fs.readFileSync(file,'utf8'));
    }
    await client.query(`GRANT CONNECT ON DATABASE ${DB} TO ${APP}; GRANT USAGE ON SCHEMA public TO ${APP}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${APP}; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP}`);
    const snapshot=await schemaSnapshot(client);
    emit({status:'PASS',identity,migrationsApplied:manifest.migrations.length,initialization:'Exact SQL fixture only; not Prisma deployment history',snapshot});
  });
}
async function databaseObservation(user) {
  return withDatabase(user,async(client,identity)=>{
    const snapshot=user===OWNER ? await schemaSnapshot(client) : undefined;
    emit({status:'PASS',identity,...(snapshot?{snapshot}:{})});
  });
}
async function namespaceEvidence() {
  const devices=fs.readFileSync('/proc/net/dev','utf8').split('\n').slice(2).filter(line=>line.includes(':')).map(line=>line.split(':')[0].trim());
  check(JSON.stringify(devices)===JSON.stringify(['lo']),'Non-loopback interface detected');
  const routes=fs.readFileSync('/proc/net/route','utf8').trim().split('\n').slice(1);
  check(routes.length===0,'Unexpected IPv4 route');
  const nativeFailure=await new Promise(resolve=>{
    const socket=new net.Socket();
    socket.once('error',error=>{socket.destroy();resolve(error.code);});
    socket.once('connect',()=>{socket.destroy();resolve('CONNECTED');});
    socket.setTimeout(2000,()=>{socket.destroy();resolve('TIMEOUT');});
    socket.connect(9,'192.0.2.1'); // Documentation-only address; no route can leave this namespace.
  });
  check(nativeFailure==='ENETUNREACH','Native egress isolation not proven');
  emit({status:'PASS',namespace:fs.readlinkSync('/proc/self/ns/net'),devices,ipv4Routes:0,nativeEgressResult:nativeFailure,publishedPorts:0});
}
function guardControls() {
  const positive=[[DB_PORT,'127.0.0.1'],[{port:DB_PORT,host:'127.0.0.1'}],[[{port:DB_PORT,host:'127.0.0.1'},null]]];
  for(const args of positive) check(allowedDestination(args),'Approved connect signature rejected');
  installNetworkGuard(true);
  let passed=0;
  const controls=[()=>new net.Socket().connect(55433,'127.0.0.1'),()=>new net.Socket().connect(443,'192.0.2.1'),()=>new net.Socket().connect(DB_PORT,'example.invalid'),()=>new net.Socket().connect('/tmp/unapproved.sock'),()=>dns.lookup('example.invalid',()=>{}),()=>childProcess.spawn('not-executed',[])];
  for(const operation of controls) {
    let rejected=false;
    try { operation(); } catch(error) { rejected=error.code==='PSAI_RUNTIME_BLOCKED'; }
    check(rejected,'Safety negative control failed');passed++;
  }
  for(const args of [[DB_PORT],[{port:DB_PORT,host:'localhost'}],[{port:DB_PORT,host:'127.0.0.1',path:'/tmp/socket'}],[{port:DB_PORT,host:'127.0.0.1',lookup:()=>{}}]]) check(!allowedDestination(args),'Ambiguous connection accepted');
  emit({status:'PASS',negativeControls:passed,positiveNormalizationChecks:positive.length,malformedControls:4,realExternalConnections:0});
}
function resourceGuard() {
  const available=Number(fs.readFileSync('/proc/meminfo','utf8').match(/^MemAvailable:\s+(\d+)/m)?.[1])*1024;
  const disk=fs.statfsSync(process.cwd());
  check(available>=2500*1024**2 && Number(disk.bavail)*Number(disk.bsize)>=6*1024**3,'Cloud RAM/disk guard failed');
}
async function verifyRuntime(image,out,harness,candidate) {
  check(process.platform==='linux' && process.env.GITHUB_ACTIONS==='true' && process.env.GITHUB_REPOSITORY==='ChristianGlenn-Pacaldo/ProctorShieldAI' && process.env.GITHUB_REF===BRANCH && process.env.PSAI_ISOLATED_TESTS_APPROVED==='true','Approved GitHub-only runtime required');
  check(!Object.entries(process.env).some(([key,value])=>value && (/^PG/i.test(key) || ['DATABASE_URL','DIRECT_URL','REDIS_URL','NODE_TEST_CONTEXT','FRONTEND_ONLY','JEST_WORKER_ID','VITEST','NEXT_PHASE'].includes(key))),'Inherited connection/lifecycle settings forbidden');
  resourceGuard();
  const docker=(...args)=>execute(['docker',...args],undefined,{label:'Docker verification operation failed',timeout:180_000,combine:args[0]==='logs'});
  const info=JSON.parse(docker('image','inspect',image))[0];
  check(info.Config.User==='nextjs' && info.Config.Labels?.['org.opencontainers.image.revision']===SOURCE_SHA && JSON.stringify(info.Config.Cmd)===JSON.stringify(['node','server.js']),'Immutable image/startup mismatch');
  const allowed=new Set(['PATH','NODE_VERSION','YARN_VERSION','NODE_ENV','NEXT_TELEMETRY_DISABLED','PORT','HOSTNAME','NEXT_PUBLIC_GOOGLE_CLIENT_ID','NEXT_PUBLIC_PUSHER_KEY','NEXT_PUBLIC_PUSHER_CLUSTER','NEXT_PUBLIC_APP_URL']);
  check((info.Config.Env||[]).every(entry=>allowed.has(entry.split('=')[0])),'Unexpected image environment');
  save(out,'image-inspection.json',{id:info.Id,repoDigests:info.RepoDigests||[],size:info.Size,architecture:info.Architecture,os:info.Os,cmd:info.Config.Cmd,entrypoint:info.Config.Entrypoint,user:info.Config.User,sourceSHA:SOURCE_SHA,deployableStagingImage:false});
  const review=fs.mkdtempSync(path.join(os.tmpdir(),'runtime58-review-'));fs.chmodSync(review,0o755);
  const privateDir=fs.mkdtempSync(path.join(os.tmpdir(),'runtime58-private-'));fs.chmodSync(privateDir,0o700);
  const instance=crypto.randomBytes(12).toString('hex');
  const config={instance,ownerPassword:crypto.randomBytes(32).toString('hex'),appPassword:crypto.randomBytes(32).toString('hex'),provisionerPassword:crypto.randomBytes(32).toString('hex')};
  const appUrl=databaseUrl(APP,config.appPassword);
  const secrets=[config.ownerPassword,config.appPassword,config.provisionerPassword,appUrl,databaseUrl(OWNER,config.ownerPassword)];
  // stderr is processed by Actions but excluded from tee's retained JSON output.
  for(const secret of secrets) console.error('::add-mask::'+secret);
  const safeText=text=>!secrets.some(secret=>text.includes(secret)) && !/WrongSyntheticPassword|DifferentSuffix|SyntheticPassword42|A{71}|é{35}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}/.test(text);
  const writePrivate=(name,value,mode=0o644)=>{const file=path.join(privateDir,name);fs.writeFileSync(file,value,{mode});return file;};
  let envFile;
  const mount=(file,target)=>['--mount',`type=bind,src=${path.join(privateDir,file)},dst=${target},readonly`];
  const reviewMount=['--mount',`type=bind,src=${review},dst=/review,readonly`];
  const caps=['--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--memory','768m','--cpus','2',...reviewMount];
  const owned=[];let pgid,appid;const result={sourceSHA:SOURCE_SHA,status:'FAIL',deployableStagingImage:false};
  function inspectOwned(id,network,app=false) {
    const item=JSON.parse(docker('inspect',id))[0];const host=item.HostConfig;
    check(item.Id===id && item.Config.Labels?.[OWNERSHIP]===instance && host.NetworkMode===network && !host.Privileged && !host.CapAdd && !Object.keys(host.PortBindings||{}).length,'Container ownership/isolation mismatch');
    check(host.Memory>0 && host.PidsLimit>0 && !(item.Mounts||[]).some(mount=>mount.Type==='volume'),'Missing resource limits or persistent volume');
    if(app) check(host.ReadonlyRootfs && JSON.stringify(item.Config.Cmd)===JSON.stringify(['node','server.js']) && host.CapDrop.includes('ALL'),'App protection/startup changed');
    return item;
  }
  const helper=(mode,network='none',privateConfig=false)=>{
    const id=docker('create','--label',OWNERSHIP+'='+instance,'--network',network,...caps,...(privateConfig?mount('config.json','/private/config.json'):[]),'--entrypoint','node',image,'--experimental-vm-modules','/review/verify-rollback-image.mjs',mode);
    check(/^[0-9a-f]{64}$/.test(id),'Invalid helper identity');owned.push(id);inspectOwned(id,network);
    const raw=docker('start','--attach',id);docker('rm',id);owned.splice(owned.indexOf(id),1);
    check(safeText(raw),'Sensitive helper output refused');const value=JSON.parse(raw);check(value.status==='PASS','Helper gate failed');return value;
  };
  try {
  for(const name of ['source-manifest.json','password-hash.ts']) fs.copyFileSync(path.join(out,name),path.join(review,name));
  fs.copyFileSync(harness,path.join(review,'verify-rollback-image.mjs'));
  const manifest=JSON.parse(fs.readFileSync(path.join(review,'source-manifest.json'),'utf8'));
  check(execute(['git','rev-parse','HEAD'],candidate)===SOURCE_SHA && !execute(['git','status','--porcelain'],candidate),'Schema source not pristine');
  for(const migration of manifest.migrations) {
    const original=path.join(candidate,migration.path),target=path.join(review,migration.path);
    check(digest(original)===migration.sha256,'Candidate migration changed');fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(original,target);
  }
  writePrivate('config.json',JSON.stringify({instance,ownerPassword:config.ownerPassword,appPassword:config.appPassword}));
  writePrivate('owner-password',config.provisionerPassword);
  writePrivate('pg_ident.conf','psai_owner postgres psai_provisioner\n');
  writePrivate('pg_hba.conf',`local all psai_provisioner peer map=psai_owner\nlocal all all reject\nhost ${DB} ${OWNER} 127.0.0.1/32 scram-sha-256\nhost ${DB} ${APP} 127.0.0.1/32 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n`);
  writePrivate('001-init.sql',`CREATE ROLE ${OWNER} LOGIN PASSWORD '${config.ownerPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE ${APP} LOGIN PASSWORD '${config.appPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE ${APP} SET log_statement='all';
CREATE DATABASE ${DB} OWNER ${OWNER};
REVOKE ALL ON DATABASE ${DB} FROM PUBLIC;
COMMENT ON DATABASE ${DB} IS 'proctorshield:disposable:${instance}';
\\connect ${DB}
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO ${OWNER};
\\connect postgres
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
`);
  envFile=writePrivate('app.env',`DATABASE_URL=${appUrl}\nNODE_OPTIONS=--import=/review/verify-rollback-image.mjs\nROLLBACK_VERIFY_MODE=guard\nROLLBACK_ALLOW_DATABASE=true\n`,0o600);
    const imageCheck=helper('inspect');save(out,'image-runtime-checks.json',imageCheck);result.passwordReader='PASS';
    const pgReference=process.env.PSAI_POSTGRES_IMAGE;
    check(/^postgres@sha256:[0-9a-f]{64}$/.test(pgReference||''),'Digest-pinned PostgreSQL required');
    const pgname='psai-runtime-pg-'+instance;
    pgid=docker('create','--name',pgname,'--label',OWNERSHIP+'='+instance,'--network','none','--memory','768m','--cpus','2','--pids-limit','128','--shm-size','128m','--tmpfs','/var/lib/postgresql:rw,size=512m',
      '--env','POSTGRES_USER=psai_provisioner','--env','POSTGRES_DB=postgres','--env','POSTGRES_PASSWORD_FILE=/run/psai/owner-password',
      ...mount('owner-password','/run/psai/owner-password'),...mount('pg_ident.conf','/etc/psai/pg_ident.conf'),...mount('pg_hba.conf','/etc/psai/pg_hba.conf'),...mount('001-init.sql','/docker-entrypoint-initdb.d/001-init.sql'),
      pgReference,'-p',String(DB_PORT),'-c','listen_addresses=127.0.0.1','-c','hba_file=/etc/psai/pg_hba.conf','-c','ident_file=/etc/psai/pg_ident.conf','-c','shared_buffers=64MB','-c','max_connections=20','-c','log_statement=none','-c','log_line_prefix=PSAI_PG|%u|%d|%p|');
    check(/^[0-9a-f]{64}$/.test(pgid),'Invalid owned container ID');owned.push(pgid);inspectOwned(pgid,'none');docker('start',pgid);
    let ready=false;
    for(let i=0;i<60;i++) {
      const state=inspectOwned(pgid,'none');check(state.State.Running,'Disposable PostgreSQL stopped');
      // Test only the owned local Unix provisioner. No TCP fallback identity.
      const probe=childProcess.spawnSync('docker',['exec','--user','postgres',pgid,'pg_isready','-h','/var/run/postgresql','-p',String(DB_PORT),'-U','psai_provisioner','-d',DB],{encoding:'utf8',timeout:5000});
      if(probe.status===0){ready=true;break;}await delay(1000);
    }
    check(ready,'Disposable PostgreSQL did not initialize');
    const network='container:'+pgid;
    const ns=helper('namespace',network);
    const pgNamespace=docker('exec',pgid,'readlink','/proc/self/ns/net');check(ns.namespace===pgNamespace,'Namespace identity mismatch');
    save(out,'network-isolation.json',{...ns,pgContainerID:pgid,pgImage:pgReference,pgNetwork:'none',appNetwork:network,liveServices:false});
    save(out,'guard-controls.json',helper('guard-controls',network));
    const initial=helper('db-init',network,true);save(out,'database-initialization.json',initial);
    const appIdentity=helper('db-app-identity',network,true);save(out,'database-app-identity.json',appIdentity);
    // Start only after network, destination, schema and effective app identity gates pass.
    appid=docker('create','--name','psai-runtime-app-'+instance,'--label',OWNERSHIP+'='+instance,'--network',network,...caps,'--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--env-file',envFile,image);
    check(/^[0-9a-f]{64}$/.test(appid),'Invalid app container ID');owned.push(appid);
    inspectOwned(appid,network,true);docker('start',appid);
    const appNamespace=docker('exec',appid,'readlink','/proc/self/ns/net');check(appNamespace===pgNamespace,'Actual app namespace mismatch');
    const smoke=helper('smoke',network);save(out,'public-smoke.json',smoke);result.publicHTTP='PASS';
    let sweeps=[];let logs='';const start=Date.now();
    while(Date.now()-start<100_000) {
      const state=inspectOwned(appid,network,true);check(state.State.Running && !state.State.OOMKilled && state.RestartCount===0,'App runtime instability');
      logs=docker('logs','--timestamps',appid);check(safeText(logs),'Sensitive application log refused');
      check(!/ROLLBACK_FORBIDDEN_OPERATION|Arena recovery scan failed|Arena recovery candidate failed|prisma:error/.test(logs),'Production runtime safety/recovery failed');
      const plain=logs.replace(/^\d{4}-\d\d-\d\dT\S+\s/gm,'');
      sweeps=[...plain.matchAll(/Arena recovery sweep completed\s*\{([^}]+)\}/g)].map(match=>{
        const counters=Object.fromEntries([...match[1].matchAll(/(scanned|attempted|finalized|attacksResolved|failed|paused):\s*(\d+)/g)].map(entry=>[entry[1],Number(entry[2])]));
        check(Object.keys(counters).length===6 && Object.values(counters).every(value=>value===0),'Arena nonempty/unsafe result');return counters;
      });
      if(sweeps.length>=3)break;await delay(2000);
    }
    check(sweeps.length>=3 && /Ready in/.test(logs),'Three actual production sweeps not proven');
    const sweepTimes=logs.split('\n').filter(line=>line.includes('Arena recovery sweep completed')).map(line=>line.split(' ')[0]);
    check(Date.parse(sweepTimes[2])-Date.parse(sweepTimes[0])>=59_000,'Natural recovery timer cycles not proven');
    save(out,'arena-sweeps.json',{status:'PASS',count:sweeps.length,sweeps,timestamps:sweepTimes,bypasses:[],normalProductionStartup:true});
    save(out,'sanitized-startup.log',logs+'\n');result.productionStartup='PASS';result.arenaRecovery='PASS';
    const final=helper('db-observe',network,true);save(out,'database-after-runtime.json',final);
    check(JSON.stringify(final.snapshot)===JSON.stringify(initial.snapshot),'Application data/schema changed');
    const pglogs=docker('logs',pgid);check(safeText(pglogs),'Sensitive PostgreSQL diagnostic refused');
    const appStatements=pglogs.split('\n').filter(line=>line.includes('PSAI_PG|'+APP+'|') && /(?:statement:|execute [^:]*:)/.test(line));
    const settingsReads=appStatements.filter(line=>/SELECT\b/.test(line) && /"public"\."settings"/.test(line));
    check(settingsReads.length>=3,'Actual PG recovery queries not observed');
    for(const line of appStatements) {
      const sql=line.replace(/^.*?(?:statement:|execute [^:]*:)\s*/,'');
      check(/^SELECT\b/i.test(sql) && !/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP|CALL|COPY)\b/i.test(sql),'Unexpected app SQL mutation');
      check(/"public"\."settings"|current_database\(\)|FROM pg_roles|FROM pg_tables|information_schema\.columns|FROM pg_indexes|FROM pg_constraint|^SELECT count\(\*\)::int AS count FROM public\./.test(sql),'Unexpected application query');
    }
    save(out,'database-mutation-check.json',{status:'PASS',tableCountsUnchanged:true,catalogUnchanged:true,settingsReadStatements:settingsReads.length,appStatementCount:appStatements.length,mutatingAppStatements:0});
    const pgBeforeShutdown=pglogs.length;
    const shutdownStarted=Date.now();docker('stop','--time','40',appid);
    const stopped=inspectOwned(appid,network,true);
    check(!stopped.State.Running && !stopped.State.OOMKilled && [0,143].includes(stopped.State.ExitCode),'Graceful application shutdown failed');
    await delay(2000);
    const afterStop=docker('logs',pgid).slice(pgBeforeShutdown);
    check(!afterStop.split('\n').some(line=>line.includes('PSAI_PG|'+APP+'|') && /statement:|execute [^:]*:/.test(line)),'Worker queries continued after shutdown');
    save(out,'shutdown.json',{status:'PASS',signal:'SIGTERM',exitCode:stopped.State.ExitCode,oomKilled:false,forcedSIGKILL:false,durationMs:Date.now()-shutdownStarted,postExitAppStatements:0});
    result.controlledShutdown='PASS';result.status='PASS';
  } finally {
    // Capture bounded sanitized failure evidence before removing only recorded owned IDs.
    for(const [id,name] of [[appid,'application'],[pgid,'postgres']]) if(id) {
      const cp=childProcess.spawnSync('docker',['logs','--tail','250',id],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
      const text=cp.stdout+'\n'+cp.stderr;
      if(safeText(text)) save(out,'sanitized-'+name+'-final.log',text);else result.sanitation='FAIL';
    }
    const removed=[];
    for(const id of [...owned].reverse()) {
      const item=JSON.parse(docker('inspect',id))[0];check(item.Config.Labels?.[OWNERSHIP]===instance,'Cleanup ownership mismatch');
      docker('rm','--force',id);removed.push(id);
      const probe=childProcess.spawnSync('docker',['inspect',id],{encoding:'utf8',timeout:10000});check(probe.status!==0,'Owned container remained after removal');
    }
    fs.rmSync(review,{recursive:true,force:true});fs.rmSync(privateDir,{recursive:true,force:true});
    save(out,'cleanup.json',{status:'PASS',removedContainerIDs:removed,onlyOwnedResources:true,privateFilesRemoved:!fs.existsSync(privateDir),persistentVolumes:0,existingDatabaseCleanup:false});
    for(const file of walk(out).filter(file=>!file.endsWith('password-hash.ts'))) check(safeText(fs.readFileSync(file,'utf8')),'Artifact secret check failed');
    check(result.sanitation!=='FAIL','Sensitive log detected; verification fails');
    save(out,'runtime-result.json',result);
  }
  emit({...result,imageID:info.Id});
}

if(mode==='guard') installNetworkGuard(process.env.ROLLBACK_ALLOW_DATABASE==='true');
else {
  try {
    if(mode==='source') verifySource(process.argv[3],process.argv[4]);
    else if(mode==='runtime') await verifyRuntime(process.argv[3],process.argv[4],path.resolve(process.argv[1]),process.argv[5]);
    else if(mode==='inspect') await inspectImage();
    else if(mode==='smoke') await publicSmoke();
    else if(mode==='guard-controls') guardControls();
    else if(mode==='namespace') await namespaceEvidence();
    else if(mode==='db-init') await initializeDatabase();
    else if(mode==='db-app-identity') await databaseObservation(APP);
    else if(mode==='db-observe') await databaseObservation(OWNER);
    else if(mode==='local-compiled') {
      const reader=loadCompiledReader(path.resolve(process.argv[3]));
      emit({proof:reader.proof,result:await passwordChecks(reader.helper,'local compiled loader precheck')});
    } else throw new Error('Unknown verification mode');
  } catch(error) {
    // Never serialize arbitrary dependency errors, URLs, source, inputs or hashes.
    const message=error?.safe===true ? error.message : 'Unexpected dependency failure; raw details withheld';
    console.error(JSON.stringify({status:'FAIL',safe:true,mode,error:message.slice(0,180)}));
    process.exitCode=1;
  }
}
