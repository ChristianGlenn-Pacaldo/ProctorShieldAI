#!/bin/sh
# No remote deletion, wildcard cleanup, Docker prune or secret expansion.
set -eu
exec node "$(dirname "$0")/cleanup-owned.mjs" "$@"
