#!/usr/bin/env bash
# Manage shirube's local development databases — one PostgreSQL container, run through
# Docker Compose, holding a handful of sample databases side by side. You load them here
# once; you switch between them inside shirube by picking the connection profile.
#
#   scripts/dev-db.sh list            List the sample databases and whether each is loaded.
#   scripts/dev-db.sh up              Start the container and load every sample database.
#   scripts/dev-db.sh up chinook lego Start the container and load only the named ones.
#   scripts/dev-db.sh down            Stop the container (data is kept).
#   scripts/dev-db.sh reset [names]   Wipe the data volume and reload (all, or the named).
#
# Each sample is loaded into its own database on the same server, so all of them share:
#   postgresql://postgres:postgres@127.0.0.1:5432/<name>
# Add each as a connection in shirube and switch between them there — no need to re-run
# this script to change database.
#
# See dev/compose.yaml.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dev="$root/dev"
cache="$dev/samples"
compose=(docker compose -f "$dev/compose.yaml")

# The sample databases shirube can load, in load order. Each is picked to exercise a
# distinct shape: pagila (partitions + views), chinook (clean multi-hop foreign keys),
# lego (many-to-many), employees (large — for load), adventureworks (several schemas).
ALL_DBS="pagila chinook lego employees adventureworks"

# db_sources <name> — print each source as "kind|url", one per line. Kinds:
#   sql   a plain SQL dump, piped into psql
#   dump  a pg_restore custom-format archive
db_sources() {
  local base="https://raw.githubusercontent.com/neondatabase-labs/postgres-sample-dbs/main"
  case "$1" in
    pagila)
      # pagila stays on its upstream repository, whose payment table is genuinely
      # partitioned — a shape shirube relies on for testing that Neon's flat copy lacks.
      echo "sql|https://raw.githubusercontent.com/devrimgunduz/pagila/master/pagila-schema.sql"
      echo "sql|https://raw.githubusercontent.com/devrimgunduz/pagila/master/pagila-data.sql"
      ;;
    chinook) echo "sql|$base/chinook.sql" ;;
    lego) echo "sql|$base/lego.sql" ;;
    # Despite its ".sql.gz" name, Neon's employees file is a pg_restore custom-format
    # archive (a PGDMP header, internally compressed), so it loads like adventureworks.
    employees) echo "dump|$base/employees.sql.gz" ;;
    adventureworks)
      echo "dump|https://github.com/Azure-Samples/postgresql-samples-databases/raw/main/postgresql-adventureworks/AdventureWorksPG.gz"
      ;;
    *) return 1 ;;
  esac
}

# db_blurb <name> — a one-line description for `list`.
db_blurb() {
  case "$1" in
    pagila) echo "DVD-rental shop — partitions, views, materialised views, foreign keys" ;;
    chinook) echo "Music store — 11 tables, clean multi-hop foreign keys" ;;
    lego) echo "LEGO sets — many-to-many inventories, parts and colours" ;;
    employees) echo "~3.9M rows — for exercising the tool under load (heavier to load)" ;;
    adventureworks) echo "Microsoft AdventureWorks — many tables across several schemas (heavier to load)" ;;
    *) echo "" ;;
  esac
}

# --- container helpers -------------------------------------------------------

db_running() {
  "${compose[@]}" ps --status running --services 2>/dev/null | grep -qx db
}

psql_q() {
  # A quiet, tuples-only query as the postgres superuser against the maintenance database.
  "${compose[@]}" exec -T db psql -U postgres -tAqc "$1" 2>/dev/null || true
}

db_exists() {
  [[ "$(psql_q "SELECT 1 FROM pg_database WHERE datname = '$1'")" == *1* ]]
}

fetch() {
  local url="$1" dest="$2"
  if [[ ! -f "$dest" ]]; then
    echo "    downloading $(basename "$dest")…"
    curl -fL --progress-bar "$url" -o "$dest"
  fi
}

# ensure_extensions <name> — install any contrib extensions a sample needs before it loads.
ensure_extensions() {
  local ext
  case "$1" in
    # AdventureWorks references these two; they ship with the postgres image.
    adventureworks) ext='CREATE EXTENSION IF NOT EXISTS tablefunc; CREATE EXTENSION IF NOT EXISTS "uuid-ossp";' ;;
    *) return 0 ;;
  esac
  "${compose[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d "$1" -q -c "$ext"
}

# load_sources <name> — fetch and apply every source for a database that already exists.
# Returns non-fatally on the first hard failure so load_one can clean up.
load_sources() {
  local name="$1" kind url file
  ensure_extensions "$name" || return 1
  while IFS='|' read -r kind url; do
    [[ -z "$kind" ]] && continue
    file="$cache/$name-$(basename "$url")"
    fetch "$url" "$file" || return 1
    case "$kind" in
      sql)
        "${compose[@]}" exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d "$name" -q <"$file" || return 1
        ;;
      dump)
        "${compose[@]}" cp "$file" "db:/tmp/$name.dump" || return 1
        # A custom-format restore can emit non-fatal notices (e.g. grants to roles, such as
        # Azure's, that do not exist here); let it finish rather than treating those as fatal.
        "${compose[@]}" exec -T db pg_restore -U postgres -d "$name" --no-owner "/tmp/$name.dump" \
          || echo "    (pg_restore reported non-fatal issues; continuing)"
        "${compose[@]}" exec -T db rm -f "/tmp/$name.dump" || return 1
        ;;
    esac
  done < <(db_sources "$name")
}

# load_one <name> — create the database and load its sources, skipping if already present.
# On a hard failure the half-built database is dropped, so a re-run starts cleanly.
load_one() {
  local name="$1"
  if db_exists "$name"; then
    echo "• $name — already loaded, skipping"
    return
  fi
  echo "• $name — loading…"
  "${compose[@]}" exec -T db createdb -U postgres "$name"
  if ! load_sources "$name"; then
    echo "  ✗ $name failed to load; removing the partial database" >&2
    "${compose[@]}" exec -T db dropdb -U postgres --if-exists "$name" >/dev/null 2>&1 || true
    return 1
  fi
  echo "  ✓ $name ready: postgresql://postgres:postgres@127.0.0.1:5432/$name"
}

# validate_names <names…> — fail early on an unknown database.
validate_names() {
  local name
  for name in "$@"; do
    if ! db_sources "$name" >/dev/null 2>&1; then
      echo "Unknown database: $name" >&2
      echo "Available: $ALL_DBS" >&2
      exit 1
    fi
  done
}

# --- commands ----------------------------------------------------------------

cmd_up() {
  local targets=("$@")
  if [[ ${#targets[@]} -eq 0 ]]; then
    read -ra targets <<<"$ALL_DBS"
  fi
  validate_names "${targets[@]}"
  mkdir -p "$cache"
  "${compose[@]}" up -d --wait
  local name
  for name in "${targets[@]}"; do
    load_one "$name"
  done
}

cmd_list() {
  local running=0
  db_running && running=1
  echo "Sample databases (load with: scripts/dev-db.sh up [name…]):"
  local name status
  for name in $ALL_DBS; do
    if [[ $running -eq 0 ]]; then
      status="container down"
    elif db_exists "$name"; then
      status="loaded"
    else
      status="not loaded"
    fi
    printf "  %-16s [%-13s] %s\n" "$name" "$status" "$(db_blurb "$name")"
  done
}

cmd_reset() {
  "${compose[@]}" down -v
  cmd_up "$@"
}

usage() {
  sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

sub="${1:-up}"
[[ $# -gt 0 ]] && shift
case "$sub" in
  up) cmd_up "$@" ;;
  down) "${compose[@]}" down ;;
  reset) cmd_reset "$@" ;;
  list | ls) cmd_list ;;
  -h | --help | help) usage ;;
  *)
    echo "Usage: $0 {up|down|reset|list} [name…]" >&2
    exit 1
    ;;
esac
