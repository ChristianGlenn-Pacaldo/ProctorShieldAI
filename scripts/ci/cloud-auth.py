"""Prepared cloud-only synthetic authentication test provisioning. No deployment."""
from pathlib import Path
import importlib.util,json,os,platform,secrets,subprocess,sys,tempfile,time
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('cloud_base',Path(__file__).with_name('cloud-verification.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)

def inspect_runtime(name,network,kind):
    raw=base.run('inspect-'+kind,['docker','inspect',name],print_log=False)
    item=json.loads(raw)[0];host=item['HostConfig']
    base.require(item['Config']['Labels'].get('proctorshield.ci.instance')==base.INSTANCE,'Unexpected container ownership')
    base.require(host['NetworkMode']==network and not host.get('PortBindings') and not host.get('Privileged') and not host.get('CapAdd'),'Unsafe container networking/capabilities')
    base.require(host['Memory']>0 and host.get('PidsLimit',0)>0,'Runtime resource caps missing')
    destinations={'postgres':{'/run/psai/owner-password','/etc/psai/pg_hba.conf','/etc/psai/pg_ident.conf','/docker-entrypoint-initdb.d/001-auth.sql','/var/lib/postgresql'},
        'redis':{'/run/psai/redis.conf','/data'},'worker':{'/run/psai/auth-config.json','/run/psai/ca.pem','/run/psai/tls-key.pem','/run/psai/tls-cert.pem','/run/psai/google-key.pem','/tmp'}}[kind]
    base.require(all(m['Destination'] in destinations and (m['Type']=='tmpfs' or m.get('RW') is False) for m in item.get('Mounts',[])),'Unexpected or writable private/source mount')
    if kind!='postgres':base.require(host['ReadonlyRootfs'],'Writable application/cache image forbidden')
    (base.RESULTS/('auth-container-'+kind+'.json')).write_text(json.dumps({'id':item['Id'],'image':item['Image'],'network':network,'memoryLimit':host['Memory'],'privileged':False,'publishedPorts':False,'owned':True},indent=2))
    return item['Id']

def prepare_private(directory):
    p=Path(directory);p.chmod(0o700)
    secret={key:secrets.token_hex(32) for key in ['owner','database','redis','session','control','email','pusher']}
    base.SECRETS.extend(secret.values())
    owner=p/'owner-password';owner.write_text(secret['owner']);owner.chmod(0o644)
    hba=p/'pg_hba.conf';hba.write_text('local all psai_provisioner peer map=psai_owner\nlocal all all reject\n'
        'host proctorshield_auth_v1_test psai_auth_test 127.0.0.1/32 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::/0 reject\n')
    ident=p/'pg_ident.conf';ident.write_text('psai_owner postgres psai_provisioner\n')
    init=p/'001-auth.sql';init.write_text(f"CREATE ROLE psai_auth_test LOGIN PASSWORD '{secret['database']}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;\n"
        f"CREATE DATABASE proctorshield_auth_v1_test OWNER psai_auth_test;\nREVOKE ALL ON DATABASE proctorshield_auth_v1_test FROM PUBLIC;\n"
        f"COMMENT ON DATABASE proctorshield_auth_v1_test IS 'proctorshield:disposable:{base.INSTANCE}';\n"
        '\\connect proctorshield_auth_v1_test\nREVOKE ALL ON SCHEMA public FROM PUBLIC;\nGRANT ALL ON SCHEMA public TO psai_auth_test;\n'
        '\\connect postgres\nREVOKE CONNECT ON DATABASE postgres FROM PUBLIC;\nREVOKE CONNECT ON DATABASE template1 FROM PUBLIC;\n')
    redis=p/'redis.conf';redis.write_text('bind 127.0.0.1\nport 56379\nprotected-mode yes\nappendonly no\nsave ""\nrequirepass '+secret['redis']+'\n')
    config=p/'auth-config.json';config.write_text(json.dumps({'PSAI_ISOLATED_TESTS_APPROVED':'true','PSAI_TEST_INSTANCE_ID':base.INSTANCE,
        'RUN_AUTHENTICATED_E2E':'true','E2E_BASE_URL':'https://127.0.0.1:3443',
        'E2E_DATABASE_URL':'postgresql://psai_auth_test:'+secret['database']+'@127.0.0.1:55432/proctorshield_auth_v1_test',
        'E2E_REDIS_URL':'redis://:'+secret['redis']+'@127.0.0.1:56379/0','NEXTAUTH_SECRET':secret['session'],
        'controlToken':secret['control'],'mailApiKey':'re_'+secret['email'],'pusherSecret':secret['pusher']}))
    config.chmod(0o444)
    ca=p/'ca.pem';key=p/'ca-key.pem';csr=p/'server.csr';tlskey=p/'tls-key.pem';cert=p/'tls-cert.pem'
    ext=p/'tls-extensions';ext.write_text('subjectAltName=DNS:localhost,IP:127.0.0.1,DNS:www.googleapis.com,DNS:api.resend.com,DNS:api-mt1.pusher.com\nextendedKeyUsage=serverAuth\n')
    commands=[['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(ca),'-days','1','-subj','/CN=ProctorShieldAI disposable test CA'],
        ['openssl','req','-newkey','rsa:2048','-nodes','-keyout',str(tlskey),'-out',str(csr),'-subj','/CN=localhost'],
        ['openssl','x509','-req','-in',str(csr),'-CA',str(ca),'-CAkey',str(key),'-CAcreateserial','-out',str(cert),'-days','1','-extfile',str(ext)],
        ['openssl','genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048','-out',str(p/'google-key.pem')]]
    for command in commands:
        cp=subprocess.run(command,capture_output=True,timeout=30)
        base.require(cp.returncode==0,'Disposable test certificate generation failed')
    for item in [tlskey,cert,ca,p/'google-key.pem']:item.chmod(0o444)
    # The CA signing key is not mounted into any runtime container.
    return p

def run():
    base.require(platform.system()=='Linux' and os.environ.get('GITHUB_ACTIONS')=='true','Only an ephemeral GitHub Linux runner may provision')
    base.require(os.environ.get('GITHUB_REPOSITORY')=='ChristianGlenn-Pacaldo/ProctorShieldAI','Unexpected repository')
    base.require(os.environ.get('GITHUB_REF','').startswith('refs/heads/codex/cloud-auth-verification-'),'Unexpected authentication verification branch')
    base.require(not any(p.name!='.env.example' for p in ROOT.glob('.env*')),'Environment files forbidden')
    base.require(not any(value and (name.upper().startswith('PG') or name in ['DATABASE_URL','DIRECT_URL','REDIS_URL']) for name,value in os.environ.items()),'Inherited connection settings forbidden')
    base.RESULTS.mkdir(exist_ok=True);base.resource_guard()
    pg=base.image_ref('postgres:18.6-bookworm');node=base.image_ref('node:24-bookworm-slim');redisimage=base.image_ref('redis:8.2-bookworm')
    with tempfile.TemporaryDirectory(prefix='psai-auth-build-') as build:
        pinned=Path(build)/'Dockerfile';pinned.write_text((ROOT/'scripts/ci/Dockerfile.auth-worker').read_text().replace('FROM node:24-bookworm-slim','FROM '+node))
        image='psai-auth-worker:'+base.INSTANCE
        base.run('auth-image-build',['docker','build','--label',base.LABEL,'--build-arg','PSAI_SOURCE_SHA='+os.environ['GITHUB_SHA'],'-f',str(pinned),'-t',image,'.'],timeout=1800)
    base.resource_guard()
    pgname='psai-auth-pg-'+base.INSTANCE;redisname='psai-auth-redis-'+base.INSTANCE;worker='psai-auth-worker-'+base.INSTANCE
    with tempfile.TemporaryDirectory(prefix='psai-auth-private-',dir=os.environ.get('RUNNER_TEMP')) as directory:
        p=prepare_private(directory)
        mount=lambda name,target:['--mount',f'type=bind,src={p/name},dst={target},readonly']
        base.OWNED.append(pgname)
        base.run('auth-postgres-start',['docker','run','-d','--name',pgname,'--label',base.LABEL,'--network','none','--memory','768m','--cpus','2','--pids-limit','128',
            '--shm-size','128m','--tmpfs','/var/lib/postgresql:rw,size=512m',
            '--add-host','www.googleapis.com:127.0.0.1','--add-host','api.resend.com:127.0.0.1','--add-host','api-mt1.pusher.com:127.0.0.1',
            '-e','POSTGRES_USER=psai_provisioner','-e','POSTGRES_DB=postgres','-e','POSTGRES_PASSWORD_FILE=/run/psai/owner-password',
            *mount('owner-password','/run/psai/owner-password'),*mount('pg_hba.conf','/etc/psai/pg_hba.conf'),*mount('pg_ident.conf','/etc/psai/pg_ident.conf'),
            *mount('001-auth.sql','/docker-entrypoint-initdb.d/001-auth.sql'),pg,'-p','55432','-c','listen_addresses=127.0.0.1',
            '-c','hba_file=/etc/psai/pg_hba.conf','-c','ident_file=/etc/psai/pg_ident.conf','-c','shared_buffers=64MB','-c','max_connections=20','-c','log_statement=none'],print_log=False)
        pgid=inspect_runtime(pgname,'none','postgres')
        ready=False
        for _ in range(60):
            cp=subprocess.run(['docker','exec','--user','postgres',pgname,'pg_isready','-h','127.0.0.1','-p','55432'],capture_output=True,timeout=10)
            if cp.returncode==0:ready=True;break
            time.sleep(1)
        base.require(ready,'Disposable PostgreSQL unavailable')
        base.OWNED.append(redisname)
        base.run('auth-redis-start',['docker','run','-d','--name',redisname,'--label',base.LABEL,'--network','container:'+pgid,
            '--memory','256m','--cpus','1','--pids-limit','64','--read-only','--tmpfs','/data:rw,size=64m',
            *mount('redis.conf','/run/psai/redis.conf'),redisimage,'redis-server','/run/psai/redis.conf'],print_log=False)
        inspect_runtime(redisname,'container:'+pgid,'redis')
        base.OWNED.append(worker)
        mounts=[]
        for name in ['auth-config.json','ca.pem','tls-key.pem','tls-cert.pem','google-key.pem']:mounts+=mount(name,'/run/psai/'+name)
        base.run('auth-worker-create',['docker','create','--name',worker,'--label',base.LABEL,'--network','container:'+pgid,
            '--memory','6g','--cpus','3','--pids-limit','768','--read-only','--shm-size','256m','--tmpfs','/tmp:rw,size=1g',
            '--cap-drop','ALL','--security-opt','no-new-privileges:true',*mounts,image],print_log=False)
        inspect_runtime(worker,'container:'+pgid,'worker')
        try:base.run('actual-authentication-worker',['docker','start','-a',worker],timeout=1200)
        finally:
            target=base.RESULTS/'authentication';target.mkdir(exist_ok=True)
            cp=subprocess.run(['docker','cp',worker+':/tmp/psai-results/.',str(target)],capture_output=True,text=True,timeout=30)
            base.require(cp.returncode==0,'Authentication results unavailable; do not claim PASS')
        report=json.loads((target/'authentication-results.json').read_text())
        base.require(report['overall']=='passed' and report['counts']['passed']>0,'Actual authenticated cases failed')
        base.require(all(report['counts'][name]==0 for name in ['failed','timedOut','skipped','interrupted']),'Failed or skipped authenticated cases')
        workerstate=json.loads(base.run('auth-worker-state',['docker','inspect',worker],print_log=False))[0]['State']
        base.require(workerstate['ExitCode']==0 and not workerstate['OOMKilled'],'Authentication worker failed or exhausted memory')
        (base.RESULTS/'cloud-auth-result.json').write_text(json.dumps({'status':'PASS','sourceSHA':os.environ.get('GITHUB_SHA'),'syntheticOnly':True,'externalProviders':'UNVERIFIED'},indent=2))

if __name__=='__main__':
    try:run()
    except Exception as error:
        print('Cloud authentication blocked/failed: '+base.redact(str(error)),file=sys.stderr);sys.exitCode=1
    finally:base.cleanup()
    sys.exit(getattr(sys,'exitCode',0))
