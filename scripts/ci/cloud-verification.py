"""Cloud-only release checks. Never connects to Railway or a laptop database."""
from pathlib import Path
import json, os, platform, re, secrets, shutil, subprocess, sys, tempfile, time, uuid

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / '.ci-results'
SECRETS = []
OWNED = []
INSTANCE = str(uuid.uuid4())
LABEL = 'proctorshield.ci.instance=' + INSTANCE


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def redact(text):
    for value in sorted(SECRETS, key=len, reverse=True):
        text = text.replace(value, '[SYNTHETIC-SECRET-REDACTED]')
    return re.sub(r'(postgresql://[^:/\s]+:)[^@\s]+@', r'\1[REDACTED]@', text)


def run(name, args, timeout=1200, env=None, input=None, print_log=True):
    print('Starting ' + name, flush=True)
    start = time.monotonic()
    cp = subprocess.run(args, cwd=ROOT, env=env, input=input, capture_output=True, text=True, timeout=timeout)
    output = redact(cp.stdout + cp.stderr)
    (RESULTS / (name + '.log')).write_text(output)
    (RESULTS / (name + '.json')).write_text(json.dumps({'exitCode': cp.returncode, 'seconds': round(time.monotonic()-start, 2)}, indent=2))
    if print_log:
        print(output[-18000:], flush=True)
    require(cp.returncode == 0, name + ' failed; see sanitized log')
    return cp.stdout


def resource_guard():
    data = Path('/proc/meminfo').read_text()
    free = int(re.search(r'^MemAvailable:\s+(\d+) kB$', data, re.M)[1]) // 1024
    disk = shutil.disk_usage(ROOT).free // (1024**3)
    print(json.dumps({'availableRAM_MB': free, 'availableDisk_GiB': disk}), flush=True)
    require(free >= 2500 and disk >= 3, 'Cloud resource guard failed')


def image_ref(image):
    run('pull-' + image.split(':')[0], ['docker', 'pull', image], print_log=False)
    digest = run('digest-' + image.split(':')[0], ['docker', 'image', 'inspect', '--format', '{{index .RepoDigests 0}}', image], print_log=False).strip()
    require(re.fullmatch(r'[a-z0-9./_-]+@sha256:[0-9a-f]{64}', digest) is not None, 'Pinned image identity unavailable')
    print('Resolved immutable image ' + digest, flush=True)
    return digest


def verify_test_summary(log):
    # Node 24 can report TAP (#) or its default text reporter (ℹ).
    # Both must prove actual cases ran and none failed, skipped or cancelled.
    counts = {}
    for key in ['tests','pass','fail','skipped','cancelled']:
        values = re.findall(r'^(?:#|ℹ)\s+' + key + r'\s+(\d+)\s*$', log, re.M)
        require(len(values) == 1, 'Missing or ambiguous PostgreSQL test summary: ' + key)
        counts[key] = int(values[0])
    require(counts['tests'] > 0 and counts['pass'] == counts['tests'], 'Incomplete PostgreSQL test execution')
    require(all(counts[key] == 0 for key in ['fail','skipped','cancelled']), 'Failed, skipped or cancelled PostgreSQL tests are not passing')
    return counts


def inspect_owned(container, expected_network):
    raw = run('inspect-' + container, ['docker', 'inspect', container], print_log=False)
    obj = json.loads(raw)[0]
    host = obj['HostConfig']
    require(obj['Config']['Labels'].get('proctorshield.ci.instance') == INSTANCE, 'Container ownership mismatch')
    require(host['NetworkMode'] == expected_network and not host.get('PortBindings') and not host.get('Privileged'), 'Unsafe container network or privilege')
    require(not host.get('CapAdd') and host['Memory'] > 0, 'Missing resource or capability restriction')
    require(all('/var/run/docker.sock' != m['Destination'] and m['Destination'].startswith(('/run/psai/', '/etc/psai/', '/docker-entrypoint-initdb.d/', '/var/lib/postgresql')) for m in obj.get('Mounts', [])), 'Unexpected runtime mount')
    safe = {'id':obj['Id'], 'network':host['NetworkMode'], 'memoryLimit':host['Memory'], 'cpuLimit':host.get('NanoCpus'), 'publishedPorts':False, 'privileged':False, 'image':obj['Image']}
    (RESULTS / ('container-' + container + '.json')).write_text(json.dumps(safe, indent=2))
    return obj['Id']


def postgres():
    resource_guard()
    pgimage = image_ref('postgres:18.6-bookworm')
    nodeimage = image_ref('node:24-bookworm-slim')
    workerfile = ROOT / 'scripts/ci/Dockerfile.postgres-worker'
    with tempfile.TemporaryDirectory(prefix='psai-build-') as builddir:
        pinned = Path(builddir) / 'Dockerfile'
        pinned.write_text(workerfile.read_text().replace('FROM node:24-bookworm-slim', 'FROM ' + nodeimage))
        workerimage = 'psai-ci-worker:' + INSTANCE
        run('build-postgres-worker', ['docker', 'build', '--label', LABEL, '-f', str(pinned), '-t', workerimage, '.'])
    resource_guard()
    pgname, workername = 'psai-ci-pg-' + INSTANCE, 'psai-ci-worker-' + INSTANCE
    with tempfile.TemporaryDirectory(prefix='psai-private-', dir=os.environ.get('RUNNER_TEMP')) as private:
        private = Path(private)
        # Traversable directory is limited to this disposable cloud runner; files are read-only mounts.
        private.chmod(0o755)
        passwords = {key:secrets.token_hex(32) for key in ['provisioner', 'arena', 'paymongo']}
        for password in passwords.values():
            SECRETS.append(password)
            print('::add-mask::' + password, flush=True)
        owner_secret = private / 'provisioner-password'
        owner_secret.write_text(passwords['provisioner']); owner_secret.chmod(0o644)
        hba = private / 'pg_hba.conf'
        hba.write_text('local all psai_provisioner peer map=psai_owner\nlocal all all reject\n'
            'host proctorshield_arena_atomic_test psai_arena_test 127.0.0.1/32 scram-sha-256\n'
            'host proctorshield_paymongo_atomic_test psai_paymongo_test 127.0.0.1/32 scram-sha-256\n'
            'host all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n')
        ident = private / 'pg_ident.conf'; ident.write_text('psai_owner postgres psai_provisioner\n')
        sql = []
        for kind in ['arena', 'paymongo']:
            role, database = 'psai_' + kind + '_test', 'proctorshield_' + kind + '_atomic_test'
            sql += [f"CREATE ROLE {role} LOGIN PASSWORD '{passwords[kind]}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;",
                f'CREATE DATABASE {database} OWNER {role};', f'REVOKE ALL ON DATABASE {database} FROM PUBLIC;',
                f"COMMENT ON DATABASE {database} IS 'proctorshield:disposable:{INSTANCE}';", f'\\connect {database}',
                'REVOKE ALL ON SCHEMA public FROM PUBLIC;', f'GRANT USAGE ON SCHEMA public TO {role};', '\\connect postgres']
        sql += ['REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;', 'REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;']
        init = private / '001-fixtures.sql'; init.write_text('\n'.join(sql) + '\n')
        settings = {'PSAI_ISOLATED_TESTS_APPROVED':'true', 'PSAI_TEST_INSTANCE_ID':INSTANCE}
        for kind, prefix in [('arena','ARENA'),('paymongo','PAYMONGO')]:
            settings[prefix + '_CONCURRENCY_TEST_DATABASE_APPROVED'] = 'true'
            settings[prefix + '_CONCURRENCY_TEST_DATABASE_URL'] = f"postgresql://psai_{kind}_test:{passwords[kind]}@127.0.0.1:55432/proctorshield_{kind}_atomic_test"
        config = private / 'test-config.json'; config.write_text(json.dumps(settings)); config.chmod(0o444)
        mount = lambda source, destination: ['--mount', f'type=bind,src={source},dst={destination},readonly']
        OWNED.append(pgname)
        command = ['docker','run','-d','--name',pgname,'--label',LABEL,'--network','none','--memory','768m','--cpus','2',
            '--pids-limit','128','--shm-size','128m','--tmpfs','/var/lib/postgresql:rw,size=512m',
            '-e','POSTGRES_USER=psai_provisioner','-e','POSTGRES_DB=postgres','-e','POSTGRES_PASSWORD_FILE=/run/psai/provisioner-password',
            *mount(owner_secret, '/run/psai/provisioner-password'), *mount(hba, '/etc/psai/pg_hba.conf'),
            *mount(ident, '/etc/psai/pg_ident.conf'), *mount(init, '/docker-entrypoint-initdb.d/001-fixtures.sql'), pgimage,
            '-c','listen_addresses=127.0.0.1','-p','55432','-c','hba_file=/etc/psai/pg_hba.conf','-c','ident_file=/etc/psai/pg_ident.conf',
            '-c','shared_buffers=64MB','-c','work_mem=4MB','-c','max_connections=16','-c','log_statement=none']
        run('start-owned-postgres', command, print_log=False)
        pgid = inspect_owned(pgname, 'none')
        ready = False
        for _ in range(60):
            cp = subprocess.run(['docker','exec','--user','postgres',pgname,'pg_isready','-h','127.0.0.1','-p','55432'], capture_output=True, timeout=10)
            if cp.returncode == 0:
                # This statement is local provisioning inspection, not a remote database connection.
                cp = subprocess.run(['docker','exec','--user','postgres',pgname,'psql','-U','psai_provisioner','-d','postgres','-p','55432','-Atc',
                    "SELECT count(*) FROM pg_database WHERE datname IN ('proctorshield_arena_atomic_test','proctorshield_paymongo_atomic_test')"], capture_output=True, text=True, timeout=10)
                if cp.returncode == 0 and cp.stdout.strip() == '2': ready = True; break
            time.sleep(1)
        require(ready, 'Fresh PostgreSQL initialization failed')
        OWNED.append(workername)
        run('create-owned-worker', ['docker','create','--name',workername,'--label',LABEL,'--network','container:'+pgid,
            '--memory','2g','--cpus','2','--pids-limit','256','--read-only','--tmpfs','/tmp:rw,size=128m',
            '--cap-drop','ALL','--security-opt','no-new-privileges:true', *mount(config,'/run/psai/test-config.json'), workerimage], print_log=False)
        inspect_owned(workername, 'container:'+pgid)
        log = run('actual-postgresql-tests', ['docker','start','-a',workername], timeout=900)
        counts = verify_test_summary(log)
        (RESULTS / 'postgres-test-counts.json').write_text(json.dumps(counts, indent=2))
        state = json.loads(run('worker-final-state', ['docker','inspect',workername], print_log=False))[0]['State']
        require(state['ExitCode'] == 0 and not state.get('OOMKilled'), 'Worker failed or exhausted memory')
        print('Four PostgreSQL suites ran against actual isolated PostgreSQL; provider transports remain simulated.', flush=True)


def migration_image():
    resource_guard()
    nodeimage = image_ref('node:24-alpine')
    with tempfile.TemporaryDirectory(prefix='psai-image-') as temporary:
        dockerfile = Path(temporary) / 'Dockerfile'
        dockerfile.write_text((ROOT / 'Dockerfile.migrate').read_text().replace('FROM node:24-alpine', 'FROM ' + nodeimage))
        image = 'psai-ci-migration:' + INSTANCE
        run('build-migration-image', ['docker','build','--label',LABEL,'-f',str(dockerfile),'-t',image,'.'])
    config = json.loads(run('migration-image-config', ['docker','image','inspect',image], print_log=False))[0]['Config']
    require(config['Cmd'] == ['sleep','infinity'] and config['WorkingDir'] == '/app', 'Unexpected migration image default')
    code = """const fs=require('node:fs'); const assert=require('node:assert/strict');
    for(const p of ['scripts/bootstrap.ts','scripts/railway-staging-migrate.mjs','src/lib/prisma.ts','src/lib/password-hash.ts','prisma.config.ts','prisma/schema.prisma','package-lock.json']) assert.ok(fs.existsSync(p),p);
    for(const p of ['bcryptjs','pg','@prisma/client','@prisma/adapter-pg','dotenv','tsx']) require.resolve(p);
    const h=await import('./src/lib/password-hash.ts');const bcrypt=require('bcryptjs');const password='SyntheticOnly12!';
    const strict=await h.hashPassword(password);assert.ok(strict.startsWith('psai:pw:v1:$2b$12$'));assert.equal(await h.verifyPassword(password,strict),true);
    const legacy=await bcrypt.hash(password,12);assert.equal(await h.verifyPassword(password,legacy),true);
    for(const bad of ['a'.repeat(73),password+'\\0']) await assert.rejects(h.hashPassword(bad));
    assert.equal(await h.verifyPassword(password,'psai:pw:v2:'+legacy),false);console.log('Migration packaging and strict/legacy password helper PASS; no database or operator executed.');"""
    name = 'psai-ci-image-' + INSTANCE
    OWNED.append(name)
    run('migration-image-runtime', ['docker','run','--name',name,'--label',LABEL,'--network','none','--read-only','--tmpfs','/tmp:rw,size=64m',
        '--memory','512m','--cpus','2','--pids-limit','64','--cap-drop','ALL','--security-opt','no-new-privileges:true',
        image,'node','--input-type=commonjs','-e','(async()=>{'+code+'})().catch(()=>{console.error("Image check failed");process.exitCode=1})'], timeout=120)
    inspect_owned(name, 'none')


def checks():
    excluded = {'arena-expiry-postgres.test.ts','arena-postgres-concurrency.test.ts','arena-realtime-postgres.test.ts','paymongo-postgres-concurrency.test.ts'}
    files = sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'tests').glob('*.test.ts') if p.name not in excluded)
    (RESULTS / 'safe-suite-selection.json').write_text(json.dumps({'files':files,'excluded':sorted(excluded)}, indent=2))
    run('safe-regressions', ['node','--test','--test-concurrency=1',*files])
    run('typescript', ['node','node_modules/typescript/bin/tsc','--noEmit','--incremental','false'])
    run('eslint', ['npm','run','lint','--','--quiet'])
    run('whitespace', ['git','diff','--check', 'HEAD^', 'HEAD'])
    run('production-audit', ['npm','audit','--omit=dev','--audit-level=high'], timeout=180)


def build():
    resource_guard()
    env = dict(os.environ, NEXT_TELEMETRY_DISABLED='1')
    run('production-build', ['npm','run','build'], env=env)


def browser():
    resource_guard()
    signing = secrets.token_hex(32)
    SECRETS.append(signing)
    print('::add-mask::' + signing, flush=True)
    env = dict(os.environ, CI='true', NEXTAUTH_SECRET=signing)
    # Explicit public-only selection: actual database/auth/provider cases are not silently counted as passing.
    run('public-browser-smoke', ['node','node_modules/@playwright/test/cli.js','test','e2e/security-flows.spec.ts',
        '--grep','public homepage and student login render|security headers are present|protected dashboards redirect|student authentication tabs|student and teacher password recovery links'], env=env, timeout=600)


def cleanup():
    for name in reversed(OWNED):
        cp = subprocess.run(['docker','inspect','--format','{{index .Config.Labels "proctorshield.ci.instance"}}',name], capture_output=True, text=True, timeout=15)
        if cp.returncode == 0 and cp.stdout.strip() == INSTANCE:
            subprocess.run(['docker','rm','-f',name], capture_output=True, timeout=30)


def main():
    require(platform.system() == 'Linux' and os.environ.get('GITHUB_ACTIONS') == 'true', 'This harness runs only on an ephemeral GitHub-hosted Linux runner')
    require(os.environ.get('GITHUB_REPOSITORY') == 'ChristianGlenn-Pacaldo/ProctorShieldAI', 'Unexpected repository')
    require(not any(p.name != '.env.example' for p in ROOT.glob('.env*')), 'Active environment files forbidden')
    require(not any(value and (re.match(r'^PG',key,re.I) or key in ['DATABASE_URL','DIRECT_URL','REDIS_URL']) for key,value in os.environ.items()), 'Inherited database/cache configuration forbidden')
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / 'source.json').write_text(json.dumps({'commit':os.environ.get('GITHUB_SHA'),'ref':os.environ.get('GITHUB_REF'),'instance':INSTANCE}, indent=2))
    mode = sys.argv[1]
    require(mode in ['checks','build','browser','postgres','image'], 'Unexpected mode')
    status = 'FAIL'
    try:
        {'checks':checks,'build':build,'browser':browser,'postgres':postgres,'image':migration_image}[mode]()
        status = 'PASS'
    finally:
        cleanup()
        (RESULTS / (mode + '-result.json')).write_text(json.dumps({'status':status,'mode':mode,'realDatabase':mode=='postgres'}, indent=2))


if __name__ == '__main__':
    try: main()
    except Exception as exc:
        print('Cloud verification failed: ' + redact(str(exc)), file=sys.stderr)
        sys.exit(1)
