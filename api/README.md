# shirube

**AI writes the SQL. You still own the schema.**

*標べ — a signpost for reading a database as a map.*

[![CI](https://github.com/shou-taro/shirube/actions/workflows/ci.yml/badge.svg)](https://github.com/shou-taro/shirube/actions/workflows/ci.yml)
&nbsp;![Status: beta](https://img.shields.io/badge/status-beta-a78bfa)
&nbsp;[![Licence: AGPL-3.0](https://img.shields.io/badge/licence-AGPL--3.0-blue)](https://github.com/shou-taro/shirube/blob/main/LICENSE)
&nbsp;![PostgreSQL](https://img.shields.io/badge/PostgreSQL-ready-336791?logo=postgresql&logoColor=white)

> 🚧 **Status: Beta.** The explorer core is here and usable today. The AI navigator — the
> feature shirube is ultimately built around — is the next milestone. shirube is pre-1.0:
> things may still change.

![shirube exploring a database: an ER diagram with a table's detail and its rows](https://raw.githubusercontent.com/shou-taro/shirube/main/docs/images/home.png)

## Why shirube

You write less SQL by hand than you used to — an AI writes much of it for you. But that
SQL still runs against **your** schema, and someone still has to understand that schema:
to prompt the AI well, to check what it gave back, to reason about where the data
actually lives. That understanding used to come for free while you wrote the queries
yourself. It doesn't any more.

shirube is where that understanding lives — and it's just as useful in the classic case,
dropping into a project with hundreds of undocumented tables and needing to find your
footing fast.

> AI changed how we write SQL. shirube changes how we understand databases.

## What shirube does

shirube opens on an interactive ER diagram and lets you explore a database like a map:
search for a table, focus on it, and follow its relationships outward — so you can see
how everything connects without reading DDL or writing a single query.

It is **not** another SQL IDE or database administration console — there is no query
editor, and nothing that ever writes. shirube is a tool for *understanding* a database.

## Features

Everything below works today, in the beta:

- 🗺️ **ER diagram home** — auto-generated and centred on the most-connected table; see a
  table and its immediate neighbours, and travel outward one hop at a time.
- 📋 **Table detail** — columns with their types, primary keys and nullability, plus
  relationships split into *references* and *referenced by*.
- 🔗 **Relationship navigation** — click a related table to glide the map over to it.
- 👁️ **Data preview** — read a table or view's actual rows in a drawer, with click-to-sort
  columns, simple filters and paging.
- ⚡ **Instant search** — jump straight to any table or column.
- 🔐 **Saved connections** — passwords kept in your operating system's keychain, never in
  a config file.
- 🌗 **Light and dark themes.**

## Safe by design

- 🔒 **Read-only** — every connection is opened read-only with a statement timeout. shirube
  cannot modify your database — no writes, no schema changes, ever.
- 💻 **Local-first** — it runs on your machine and binds to `127.0.0.1` only. Your database
  credentials and data never leave your computer.
- 📝 **Metadata-only logging** — the local log records errors and request timings, but
  never the values in your data.

## Getting started

You'll need a PostgreSQL database to point shirube at, and a way to run a Python
application without installing it permanently.

> The beta is tested on **macOS** and **Windows**. Linux support is planned.

```bash
pipx run shirube   # with pipx
# or
uvx shirube        # with uv
```

Either command starts a small local server and opens shirube in your browser. Add a
connection with your PostgreSQL details, and shirube inspects the schema and opens the ER
diagram.

> 💡 shirube connects with whatever credentials you give it. A read-only role with
> `CONNECT` and `SELECT` is all it needs — and all it should have.

## Learn more

- **Full README, roadmap and the AI-navigator preview** —
  <https://github.com/shou-taro/shirube>
- **Contributing** —
  <https://github.com/shou-taro/shirube/blob/main/CONTRIBUTING.md>
- **Licence** — [GNU AGPL-3.0](https://github.com/shou-taro/shirube/blob/main/LICENSE)
