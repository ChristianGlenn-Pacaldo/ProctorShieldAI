import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import test from "node:test";
import { Client } from "pg";
import { assertIsolatedNetwork, assertNoTestEnvFiles, authenticatedTestEnvironment, isolatedBrowserOrigin, isolatedPostgresConfig, verifyIsolatedDatabaseIdentity, type TestDatabaseKind } from "./helpers/isolated-test-environment.ts";

const instance = "2ac08227-4677-4bdb-b1a0-cb916e0345ef";
const policy = { arena: ["ARENA_CONCURRENCY_TEST_DATABASE_URL", "ARENA_CONCURRENCY_TEST_DATABASE_APPROVED", "proctorshield_arena_atomic_test", "psai_arena_test"],
  paymongo: ["PAYMONGO_CONCURRENCY_TEST_DATABASE_URL", "PAYMONGO_CONCURRENCY_TEST_DATABASE_APPROVED", "proctorshield_paymongo_atomic_test", "psai_paymongo_test"],
  auth: ["E2E_DATABASE_URL", "RUN_AUTHENTICATED_E2E", "proctorshield_auth_v1_test", "psai_auth_test"] } as const;
function fixture(kind: TestDatabaseKind = "arena"): Record<string,string> {
  const [variable,approval,database,user] = policy[kind];
  return { [variable]: `postgresql://${user}:SyntheticPassword123@127.0.0.1:55432/${database}`, [approval]: "true", PSAI_ISOLATED_TESTS_APPROVED: "true", PSAI_TEST_INSTANCE_ID: instance };
}

for (const kind of ["arena","paymongo","auth"] as const) {
  test(`${kind}: explicit config matches pg's effective target without connecting`, () => {
    const config = isolatedPostgresConfig(kind, fixture(kind));
    assert.equal(config.connection.host,"127.0.0.1"); assert.equal(config.connection.port,55432);
    assert.equal(config.connection.database,policy[kind][2]); assert.equal(config.connection.user,policy[kind][3]);
    assert.equal(config.connection.ssl,false); assert.equal("connectionString" in config.connection,false);
    const client = new Client(config.connection) as unknown as { connectionParameters: { host:string;port:number;database:string;user:string } };
    assert.equal(client.connectionParameters.host,"127.0.0.1"); assert.equal(client.connectionParameters.database,policy[kind][2]);
    assert.equal(client.connectionParameters.port,55432); assert.equal(client.connectionParameters.user,policy[kind][3]);
  });
  for (const mutation of ["no-url","no-approval","no-global-approval","no-instance","external","query-host","query-hostaddr","query-db","query-options","fragment","default-port","wrong-db","superuser","empty-password","nul-password","bad-protocol","encoded-path","unix-socket","multiple-hosts"] as const) {
    test(`${kind}: rejects ${mutation} before any connection`, () => {
      const env=fixture(kind), [variable,approval]=policy[kind];
      const url=new URL(env[variable]);
      switch(mutation) {
        case "no-url": delete env[variable]; break;
        case "no-approval": delete env[approval]; break;
        case "no-global-approval": delete env.PSAI_ISOLATED_TESTS_APPROVED; break;
        case "no-instance": delete env.PSAI_TEST_INSTANCE_ID; break;
        case "external": url.hostname="database.invalid"; break;
        case "query-host": url.search="?host=database.invalid"; break;
        case "query-hostaddr": url.search="?hostaddr=203.0.113.10"; break;
        case "query-db": url.search="?dbname=postgres"; break;
        case "query-options": url.search="?options=-c%20search_path%3Dpublic"; break;
        case "fragment": url.hash="override"; break;
        case "default-port": url.port="5432"; break;
        case "wrong-db": url.pathname="/postgres"; break;
        case "superuser": url.username="postgres"; break;
        case "empty-password": url.password=""; break;
        case "nul-password": url.password="SyntheticPassword123%00"; break;
        case "bad-protocol": env[variable]=env[variable].replace("postgresql:","http:"); break;
        case "encoded-path": url.pathname=url.pathname.replace("_","%5f"); break;
        case "unix-socket": url.search="?host=%2Ftmp"; break;
        case "multiple-hosts": env[variable]=env[variable].replace("127.0.0.1:55432","127.0.0.1,database.invalid:55432"); break;
      }
      if (!["no-url","multiple-hosts","bad-protocol"].includes(mutation)) env[variable]=url.toString();
      assert.throws(()=>isolatedPostgresConfig(kind,env));
    });
  }
}
for (const name of ["PGHOST","PGHOSTADDR","PGPORT","PGDATABASE","PGUSER","PGPASSWORD","PGSERVICE","PGSERVICEFILE","PGOPTIONS","PGSSLMODE","PGPASSFILE","DATABASE_URL","DIRECT_URL"]) {
  test(`rejects inherited ${name} instead of allowing driver fallback`,()=>assert.throws(()=>isolatedPostgresConfig("arena",{...fixture(),[name]:"synthetic-unsafe-override"})));
}
test("localhost is pinned to an IP and IPv6 loopback stays explicit",()=>{
  const env=fixture(); env.ARENA_CONCURRENCY_TEST_DATABASE_URL=env.ARENA_CONCURRENCY_TEST_DATABASE_URL.replace("127.0.0.1","localhost");
  assert.equal(isolatedPostgresConfig("arena",env).connection.host,"127.0.0.1");
  env.ARENA_CONCURRENCY_TEST_DATABASE_URL=env.ARENA_CONCURRENCY_TEST_DATABASE_URL.replace("localhost","[::1]");
  assert.equal(isolatedPostgresConfig("arena",env).connection.host,"::1");
});
const runtime = () => ({platform:"linux",interfaces:{lo:[{address:"127.0.0.1",netmask:"255.0.0.0",family:"IPv4" as const,mac:"00:00:00:00:00:00",internal:true,cidr:"127.0.0.1/8"}]},ipv4Routes:()=>"Iface Destination\n",ipv6Routes:()=>""});
test("loopback-only Linux namespace passes offline interface/route checks",()=>assert.doesNotThrow(()=>assertIsolatedNetwork(runtime())));
test("Windows host is blocked regardless of asserted approval",()=>assert.throws(()=>assertIsolatedNetwork({...runtime(),platform:"win32"})));
test("a Docker bridge interface is not accepted as complete network isolation",()=>{
  const value=runtime(); value.interfaces.lo[0]={...value.interfaces.lo[0],address:"172.18.0.2",internal:false};
  assert.throws(()=>assertIsolatedNetwork(value));
});
test("outbound routes and unreadable route inventory fail closed",()=>{
  assert.throws(()=>assertIsolatedNetwork({...runtime(),ipv4Routes:()=>"Iface Destination\neth0 00000000"}));
  assert.throws(()=>assertIsolatedNetwork({...runtime(),ipv6Routes:()=>"00000000 eth0"}));
  assert.throws(()=>assertIsolatedNetwork({...runtime(),ipv4Routes:()=>{throw new Error("unavailable");}}));
});
const identity=()=>({databaseName:policy.arena[2],userName:policy.arena[3],marker:`proctorshield:disposable:${instance}`,serverAddress:"127.0.0.1",serverPort:55432,isTemplate:false,isSuperuser:false,canCreateDatabase:false,canCreateRole:false,bypassRls:false,canReplicate:false});
test("identity verification issues only the read-only identity query before mutation",async()=>{
  const calls:string[]=[];
  await verifyIsolatedDatabaseIdentity({query:async sql=>{calls.push(sql);return {rows:[identity()]};}},isolatedPostgresConfig("arena",fixture()));
  assert.equal(calls.length,1); assert.match(calls[0],/^SELECT/); assert.doesNotMatch(calls[0],/\b(?:CREATE|INSERT|UPDATE|DELETE|DROP)\b/);
});
for (const key of ["databaseName","userName","marker","serverAddress","serverPort","isTemplate","isSuperuser","canCreateDatabase","canCreateRole","bypassRls","canReplicate"] as const) {
  test(`unverified server identity ${key} blocks mutations`,async()=>{
    const row:Record<string,unknown>=identity(); row[key]=typeof row[key]==="boolean"?true:"wrong";
    await assert.rejects(verifyIsolatedDatabaseIdentity({query:async()=>({rows:[row]})},isolatedPostgresConfig("arena",fixture())));
  });
}
test("identity outage and missing/multiple rows fail closed without echoing driver details",async()=>{
  for(const rows of [[],[identity(),identity()]]) await assert.rejects(verifyIsolatedDatabaseIdentity({query:async()=>({rows})},isolatedPostgresConfig("arena",fixture())));
  await assert.rejects(verifyIsolatedDatabaseIdentity({query:async()=>{throw new Error("private credential detail");}},isolatedPostgresConfig("arena",fixture())),/^Error: Disposable database identity could not be verified$/);
});
test("authenticated environment requires dedicated Redis, HTTPS and no provider inheritance",()=>{
  const env={...fixture("auth"),NEXTAUTH_SECRET:"synthetic-unit-secret-only-32-characters",E2E_REDIS_URL:"redis://:SyntheticPassword123@127.0.0.1:56379/0"};
  assert.equal(authenticatedTestEnvironment(env).origin,"https://localhost:3443");
  for(const extra of [{E2E_REDIS_URL:"redis://:SyntheticPassword123@cache.invalid:56379/0"},{E2E_BASE_URL:"http://localhost:3100"},{E2E_REUSE_SERVER:"true"},{PUSHER_SECRET:"synthetic"},{REDIS_URL:"redis://cache.invalid"}]) assert.throws(()=>authenticatedTestEnvironment({...env,...extra}));
});
test("browser origin cannot point at remote systems or insecure native HTTP",()=>{
  for(const url of ["https://application.invalid:3443","http://127.0.0.1:3443","https://localhost:3443/?target=remote","https://localhost:3443/path","https://user:pass@localhost:3443","https://localhost:443"]) assert.throws(()=>isolatedBrowserOrigin(url));
});
test("all four opted-in suites validate identity before creating their private schemas",()=>{
  for(const name of ["arena-postgres-concurrency","arena-expiry-postgres","arena-realtime-postgres","paymongo-postgres-concurrency"]) {
    const source=fs.readFileSync(`tests/${name}.test.ts`,"utf8");
    assert.ok(source.indexOf("isolatedPostgresConfig(")<source.indexOf("new Client("));
    assert.ok(source.indexOf("assertIsolatedNetwork();")<source.indexOf("new Client("));
    assert.ok(source.indexOf("verifyIsolatedDatabaseIdentity(admin, config)")<source.indexOf("CREATE SCHEMA"));
    assert.doesNotMatch(source,/connectionString: configured/); assert.match(source,/DROP SCHEMA.*CASCADE/);
  }
});

test("project environment files fail closed without reading secret values",()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"psai-env-guard-"));
  try {
    fs.writeFileSync(path.join(directory,".env.example"),"SYNTHETIC_ONLY=example");
    assert.doesNotThrow(()=>assertNoTestEnvFiles(directory));
    for(const name of [".env",".env.local",".env.production"]) {
      fs.writeFileSync(path.join(directory,name),"SYNTHETIC_ONLY=blocked");
      assert.throws(()=>assertNoTestEnvFiles(directory),/must not load/);
      fs.unlinkSync(path.join(directory,name));
    }
  } finally {
    // Only these known, owned files and the exact temporary directory are removed.
    fs.unlinkSync(path.join(directory,".env.example")); fs.rmdirSync(directory);
  }
});

for(const script of ["scripts/run-isolated-postgres-tests.mjs","scripts/check-e2e-database.mjs"]) {
  for(const scenario of ["missing-approval","query-override","unisolated-network"]) {
    test(`${script}: ${scenario} blocks before Pool creation or worker spawn`,async()=>{
      const env:Record<string,string>={...fixture("arena"),...fixture("paymongo"),...fixture("auth"),NEXTAUTH_SECRET:"synthetic-unit-secret-only-32-characters",E2E_REDIS_URL:"redis://:SyntheticPassword123@127.0.0.1:56379/0"};
      if(scenario==="missing-approval") env.PSAI_ISOLATED_TESTS_APPROVED="false";
      if(scenario==="query-override") {
        env.ARENA_CONCURRENCY_TEST_DATABASE_URL+="?host=database.invalid";
        env.E2E_DATABASE_URL+="?host=database.invalid";
      }
      let effects=0; const messages:string[]=[];
      const processMock={env,execPath:"node",cwd:()=>process.cwd(),exitCode:0,stderr:{write:(value:string)=>messages.push(value)}};
      const source=fs.readFileSync(script,"utf8").replaceAll("import.meta.url",JSON.stringify("file:///isolated/scripts/runner.mjs"));
      const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
      await vm.runInNewContext(code,{
        exports:{},process:processMock,console:{log:(value:string)=>messages.push(value)},
        require:(name:string)=>{
          if(name==="node:child_process") return {spawnSync:()=>{effects++;throw new Error("Unexpected worker spawn");}};
          if(name==="node:url") return {fileURLToPath:()=>"/isolated/scripts/runner.mjs"};
          if(name==="node:path") return path;
          if(name==="pg") return {Pool:class {constructor(){effects++;throw new Error("Unexpected database pool");}}};
          if(name.includes("isolated-test-environment")) return {
            assertNoTestEnvFiles:()=>{},
            isolatedPostgresConfig:(kind:TestDatabaseKind)=>isolatedPostgresConfig(kind,env),
            authenticatedTestEnvironment:()=>authenticatedTestEnvironment(env),
            assertIsolatedNetwork:()=>assertIsolatedNetwork({...runtime(),platform:scenario==="unisolated-network"?"win32":"linux"}),
            verifyIsolatedDatabaseIdentity,
          };
          throw new Error("Unexpected harness import");
        },
      });
      assert.equal(effects,0); assert.equal(processMock.exitCode,1);
      assert.ok(messages.length>0); assert.doesNotMatch(messages.join(""),/SyntheticPassword123|postgresql:\/\//);
    });
  }
}
