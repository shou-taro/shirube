#!/usr/bin/env bash
# Manage shirube's local development database — PostgreSQL preloaded with pagila, run
# through Docker Compose. See dev/compose.yaml.
#
#   scripts/dev-db.sh up      Fetch pagila (first run) and start the database.
#   scripts/dev-db.sh down    Stop the database (data is kept).
#   scripts/dev-db.sh reset   Wipe the data volume and reload pagila from scratch.
#
# Connection: postgresql://postgres:postgres@127.0.0.1:5432/pagila
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dev="$root/dev"
pagila="$dev/pagila"
compose=(docker compose -f "$dev/compose.yaml")

# pagila's canonical schema and data, from the upstream repository. Numbered so
# Postgres' init runs the schema before the data.
schema_url="https://raw.githubusercontent.com/devrimgunduz/pagila/master/pagila-schema.sql"
data_url="https://raw.githubusercontent.com/devrimgunduz/pagila/master/pagila-data.sql"

fetch_pagila() {
  mkdir -p "$pagila"
  if [[ ! -f "$pagila/01-schema.sql" ]]; then
    echo "Downloading pagila schema…"
    curl -fsSL "$schema_url" -o "$pagila/01-schema.sql"
  fi
  if [[ ! -f "$pagila/02-data.sql" ]]; then
    echo "Downloading pagila data…"
    curl -fsSL "$data_url" -o "$pagila/02-data.sql"
  fi
}

case "${1:-up}" in
  up)
    fetch_pagila
    "${compose[@]}" up -d --wait
    echo "Database ready: postgresql://postgres:postgres@127.0.0.1:5432/pagila"
    ;;
  down)
    "${compose[@]}" down
    ;;
  reset)
    "${compose[@]}" down -v
    fetch_pagila
    "${compose[@]}" up -d --wait
    echo "Database reset: postgresql://postgres:postgres@127.0.0.1:5432/pagila"
    ;;
  *)
    echo "Usage: $0 {up|down|reset}" >&2
    exit 1
    ;;
esac
