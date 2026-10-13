# ProctorShieldAI external recovery tooling — synthetic review candidate

**NOT FOR LIVE DATA OR STAGING DEPLOYMENT.** No application changes, existing Ops identity bypass, live credentials or existing environment files are used.

This workspace implements the five external runbook contracts plus supporting modules. Cloud image/runtime tests have been prepared but require separate approval before Git publication or execution. A successful local simulator test is not PostgreSQL, Docker, Railway, R2, escrow or actual recovery evidence.

## Tools and explicit input contract

Every tool requires `--operation`, `--context`, `--trust`, `--secrets`, and `--work`. Paths are explicit; no DATABASE_URL, provider credential chain, implicit linked Railway project or environment-file fallback is allowed.

```sh
node verify-operation.mjs --operation /approval/operation.json --context /approval/runtime.json --trust /approval/trust.json --secrets /run/secrets --work /work
node gate-control.mjs --operation /approval/operation.json --context /approval/runtime.json --trust /approval/trust.json --secrets /run/secrets --work /work --action pause
node gate-control.mjs --operation /approval/operation.json --context /approval/runtime.json --trust /approval/trust.json --secrets /run/secrets --work /work --action drain
node backup-once.mjs --operation /approval/operation.json --context /approval/runtime.json --trust /approval/trust.json --secrets /run/secrets --work /work
node gate-control.mjs --operation /approval/operation.json --context /approval/runtime.json --trust /approval/trust.json --secrets /run/secrets --work /work --action watchdog --job /approval/owned-job.json
node recover-once.mjs --operation /approval/recovery.json --context /approval/recovery-runtime.json --trust /approval/trust.json --secrets /run/recovery-secrets --work /work --receipt /approval/independent-completion.json
sh cleanup-owned.sh --operation /approval/operation.json --context /approval/runtime.json --trust /approval/trust.json --secrets /run/secrets --work /work --job /approval/owned-job.json
```

These are invocation contracts, not permission to run against live services. The host supervisor starts the independent watchdog before backup, with a signed exact container receipt. `resume` is an explicitly supervised operation after proving the job stopped; the backup worker never blindly removes a freeze. Cleanup verifies that exact signed container is stopped and only removes its own scratch directories, retaining ledgers and remote objects.

## Authority, runtime and ownership

Approval and runtime envelopes are independently Ed25519-signed canonical JSON. Separate trusted public keys/fingerprints must be provisioned by the approved operator into a read-only trust mount. The approval binds unique operation/set IDs, action scope, timestamps, immutable application SHA, final image manifest digest, runner, endpoints/buckets, explicit PG18 database identity/table/migration allowlists, capacity and deadline. Runtime attestation additionally binds the local Docker image configuration ID, no restarts, network/storage/deadline proofs and realm. Job receipts bind that image ID and digest to an exact container ID, runner, operation hash and bounded deadline.

Synthetic fixtures generate disposable signing keys. **They do not establish independent real-world operator approval, key custody or measured host attestation.** A trusted host controller is required; signatures alone do not protect against a compromised host, privileged Docker administrator or replaced trust anchors.

Exclusive durable ledger creation and fsync reject replay, even after failure. `restart=no` is an additional safeguard, not an exactly-once claim. Ambiguous publication failures preserve possible completion markers and all partial remote sets; no retry or remote deletion occurs. SIGTERM/SIGINT/deadlines cancel owned child process groups, and cleanup waits for them. Linux process-group and Docker watchdog tests are pending cloud verification.

## Format compatibility

`lib/backup-crypto.mjs` is copied byte-for-byte from immutable application commit `2f0df056f0a76c9d897625fd1edc5ac448405758`. AES-256-GCM remains 12-byte nonce + ciphertext + 16-byte tag. Existing format-1 identity/migration/database/evidence/completion fields and per-set object paths are retained.

An authenticated manifest extension adds frozen schema/sequence fingerprints and keyed whole-table digests/row counts. Recovery requires these extra attestations and an independently approved manifest checksum; it does not claim to recover older manifests lacking them. **No mutable latest.json or restore-status.json is written.** Existing Ops `--status` will therefore not discover these synthetic sets. Publishing a live latest pointer, historical-set recovery policy and restore-status publication need separate reviewed compatibility decisions; this omission is deliberate and reported, not silently presented as full Ops interoperability.

All current evidence-prefix objects, including unreferenced objects, are exported. Active database references must exist. Before/after listings, ETags, table HMACs, schema and gate ownership are compared. Source credentials are read-only; destination writes are conditional, verified through GET readback and never deleted. Restore uses a separate empty database and storage target checked before any restore, single-transaction pg_restore, exact schema/count/HMAC reconciliation and every evidence-object checksum/content-type readback. A failed restore may leave a partially reconstructed disposable target and is never retried automatically.

## Local and prepared cloud verification

Local: `npm ci --ignore-scripts --no-audit --no-fund` then `npm test`. This runs lightweight synthetic HTTP storage/gate fixtures and crypto/process tests only. Linux-only tests are honestly skipped on Windows.

Prepared cloud workflow: `.github/workflows/recovery-tooling-synthetic.yml`, exact proposed branch `codex/recovery-tooling-synthetic-20261013`, from immutable candidate `2f0df056f0a76c9d897625fd1edc5ac448405758`. The exact additive paths are recorded in `publication-files.json`. No PR, main change, registry publication, image export, Railway deployment or application regression rerun is proposed. Existing baseline workflows do not match this new branch.

GitHub-hosted Linux builds pinned Node/PG18 bases and locked SDK dependencies, proves UID1001/client availability, runs all Linux unit tests, six actual PG18 backup/restore/failure scenarios and four actual Docker watchdog/cleanup scenarios. Two fresh PostgreSQL clusters use an internal bridge, synthetic passwords, tmpfs and no published ports. Tooling uses TCP relays to those clusters; only loopback S3/gate simulators are used. No live R2/MinIO provider is represented as tested. Runtime containers are non-root/read-only, capability-restricted, restart=no, bounded, and never receive the Docker socket. The trusted host controller alone owns Docker lifecycle operations.

Evidence upload is allowlisted sanitized JSON with seven-day retention. No database archive, evidence media, key file, credentials, private approval envelope, raw container/test/build logs or image is uploaded. Exact owned containers/anonymous volumes/internal network are removed in finally; no Docker prune, object deletion or existing resource cleanup is allowed. Runner loss/SIGKILL can interrupt finally; the disposable GitHub VM is not a durable live-operation watchdog. Cloud cost/availability/quota approval remains required.

## Outstanding live prerequisites

Live mode unconditionally fails closed with `LIVE_GATE_INTEGRATION_UNVERIFIED` before any connection. The real staging gate lacks the tested owned-lease/generation/CAS contract. No fake Ops service identity is supplied, and the existing backup helper is never invoked under impersonated IDs.

Live readiness additionally requires a separately approved private runner, final built/retained image digest and provenance, actual no-retry host supervisor and host-loss recovery, readonly trust/approval mounts, scoped secret broker delivery, independent encryption-key escrow challenge, genuine provider destination ownership/privacy/conditional-write behavior/capacity, measured egress restrictions, verified source tunnel, approved maintenance/drain/retention coordination, archival definition review and a separate empty private restore target. Real schema checks are not rerun by this task.

Until these are satisfied, **NO-GO for live backup, freeze, restore or staging deployment.**
