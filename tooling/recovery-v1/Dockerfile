FROM node@sha256:51b1100cc2a83d370c6a60952e3f2989c8a43159d0e38586e090f3b3326efefd AS node
FROM postgres@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c
LABEL org.opencontainers.image.title="ProctorShieldAI synthetic recovery tooling"
LABEL psai.usage="NOT FOR LIVE DATA OR STAGING DEPLOYMENT"
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /opt/npm
ENV PATH="/usr/local/bin:/usr/lib/postgresql/18/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin"
WORKDIR /opt/recovery
COPY package.json package-lock.json ./
RUN node /opt/npm/bin/npm-cli.js ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && groupadd --gid 1001 recovery && useradd --uid 1001 --gid 1001 --no-create-home recovery \
 && mkdir -p /work && chown 1001:1001 /work \
 && node --version && pg_dump --version && pg_restore --version && psql --version
COPY --chown=1001:1001 lib ./lib
COPY --chown=1001:1001 tests ./tests
COPY --chown=1001:1001 backup-once.mjs recover-once.mjs gate-control.mjs verify-operation.mjs cleanup-owned.mjs cleanup-owned.sh ./
USER 1001:1001
WORKDIR /work
ENTRYPOINT ["node"]
CMD ["/opt/recovery/verify-operation.mjs"]
