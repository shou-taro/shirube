#!/usr/bin/env bash
# Manage shirube's local development databases — one PostgreSQL container, run through
# Docker Compose, holding a handful of sample databases side by side. You load them here
# once; you switch between them inside shirube by picking the connection profile.
#
#   scripts/dev-db.sh list            List the sample databases and whether each is loaded.
#   scripts/dev-db.sh up              Start the container and pick databases from a menu
#                                     (loads all when not run in a terminal, e.g. in CI).
#   scripts/dev-db.sh up chinook lego Start the container and load only the named ones.
#   scripts/dev-db.sh down            Stop the container (data is kept).
#   scripts/dev-db.sh reset [names]   Wipe the data volume and reload (menu, or the named).
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

# choose_databases — an arrow-key checklist for picking which databases to load. The menu
# is drawn on the terminal; the chosen names are printed to stdout, one per line, so the
# caller can capture them. Returns non-zero if the user cancels. Requires the container to
# be running (it marks already-loaded databases). Keys: ↑/↓ or j/k move, space toggles,
# a toggles all, enter confirms, q or esc cancels.
choose_databases() {
  local options=() name
  read -ra options <<<"$ALL_DBS"
  local n=${#options[@]} cursor=0 i key rest
  local -a checked

  # One round-trip to learn what's already loaded, then default the selection to the rest.
  local loaded
  loaded="$(psql_q "SELECT datname FROM pg_database")"
  is_loaded() { printf '%s\n' "$loaded" | grep -qx "$1"; }
  for ((i = 0; i < n; i++)); do
    if is_loaded "${options[i]}"; then checked[i]=0; else checked[i]=1; fi
  done

  printf '\e[?25l' >/dev/tty # hide the cursor while the menu is live
  trap 'printf "\e[?25h" >/dev/tty' RETURN

  # Draw the title and key hints once, above the redrawn area. The hint line is long enough
  # to wrap on a narrow terminal; keeping it out of the redraw loop means a wrap can't push
  # the menu down a row on every keypress. Only the short option rows are redrawn in place.
  printf 'Select databases to load\n' >/dev/tty
  printf '↑/↓ move · space toggle · a all · enter confirm · q cancel\n' >/dev/tty

  local first=1
  while true; do
    [[ $first -eq 0 ]] && printf '\e[%dA' "$n" >/dev/tty
    first=0
    for ((i = 0; i < n; i++)); do
      local pointer='  ' mark=' ' tag=''
      [[ $i -eq $cursor ]] && pointer='❯ '
      [[ ${checked[i]} -eq 1 ]] && mark='x'
      is_loaded "${options[i]}" && tag='  [loaded]'
      printf '\r\e[K%s[%s] %-16s%s\n' "$pointer" "$mark" "${options[i]}" "$tag" >/dev/tty
    done

    IFS= read -rsn1 key </dev/tty
    case "$key" in
      $'\e')
        # An escape sequence (arrow key) delivers its bytes together; a bare esc does not,
        # so a short wait distinguishes "arrow" from "cancel".
        read -rsn2 -t 1 rest </dev/tty || rest=''
        case "$rest" in
          '[A') ((cursor = (cursor - 1 + n) % n)) ;;
          '[B') ((cursor = (cursor + 1) % n)) ;;
          '') return 1 ;;
        esac
        ;;
      k | K) ((cursor = (cursor - 1 + n) % n)) ;;
      j | J) ((cursor = (cursor + 1) % n)) ;;
      ' ') checked[cursor]=$((1 - checked[cursor])) ;;
      a | A)
        local all_on=1
        for ((i = 0; i < n; i++)); do [[ ${checked[i]} -eq 0 ]] && all_on=0; done
        for ((i = 0; i < n; i++)); do checked[i]=$((1 - all_on)); done
        ;;
      q | Q) return 1 ;;
      '' | $'\r') break ;; # enter (empty when the newline is the read delimiter)
    esac
  done

  for ((i = 0; i < n; i++)); do
    [[ ${checked[i]} -eq 1 ]] && echo "${options[i]}"
  done
  # Return success explicitly: without this the function's status would be that of the last
  # test above, which is false whenever the last database is unselected (read as a cancel).
  return 0
}

# --- commands ----------------------------------------------------------------

cmd_up() {
  local targets=("$@") interactive=0
  if [[ ${#targets[@]} -eq 0 ]]; then
    # No names: pick from a menu when run interactively, else load everything (so CI and
    # piped invocations don't stall waiting on a terminal).
    if [[ -t 0 && -t 1 ]]; then
      interactive=1
    else
      read -ra targets <<<"$ALL_DBS"
    fi
  fi
  [[ ${#targets[@]} -gt 0 ]] && validate_names "${targets[@]}"
  mkdir -p "$cache"
  "${compose[@]}" up -d --wait

  if [[ $interactive -eq 1 ]]; then
    local chosen
    if ! chosen="$(choose_databases)"; then
      echo "Cancelled — nothing loaded." >&2
      return 0
    fi
    targets=($chosen) # names are single words, so word-splitting is safe here
    if [[ ${#targets[@]} -eq 0 ]]; then
      echo "Nothing selected — nothing loaded." >&2
      return 0
    fi
  fi

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
  sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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
