<p align="center">
  <img src="https://raw.githubusercontent.com/shou-taro/shirube/main/docs/images/logo.svg" width="88" alt="shirube" />
</p>

<h1 align="center">shirube</h1>

<p align="center">
  <strong>AI writes the SQL.<br />You still own the schema.</strong><br />
  <sub>標べ — a signpost for reading a database as a map.</sub>
</p>

<p align="center">
  <a href="https://github.com/shou-taro/shirube/actions/workflows/ci.yml"><img src="https://github.com/shou-taro/shirube/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://pypi.org/project/shirube/"><img src="https://img.shields.io/pypi/v/shirube" alt="PyPI" /></a>
  <img src="https://img.shields.io/badge/status-beta-a78bfa" alt="Status: beta" />
  <a href="https://github.com/shou-taro/shirube/blob/main/LICENSE"><img src="https://img.shields.io/badge/licence-AGPL--3.0-blue" alt="Licence: AGPL-3.0" /></a>
  <img src="https://img.shields.io/badge/PostgreSQL-ready-336791?logo=postgresql&logoColor=white" alt="PostgreSQL" />
</p>

> 🚧 **Status: Beta.** Both halves are here now — the explorer core *and* the AI
> navigator that shirube is ultimately built around. shirube is pre-1.0: things may
> still change.

<p align="center"><em>See the whole database as a map.</em></p>

<p align="center">
  <img src="https://raw.githubusercontent.com/shou-taro/shirube/main/docs/images/home.png" alt="shirube exploring a database: an ER diagram with a table's detail and its rows" width="960" />
</p>

## 🤖 Why shirube

You write less SQL by hand than you used to — an AI writes much of it for you. But that
SQL still runs against **your** schema, and someone still has to understand that schema:
to prompt the AI well, to check what it gave back, to reason about where the data
actually lives. That understanding used to come for free while you wrote the queries
yourself. It doesn't any more.

shirube is where that understanding lives — and it's just as useful in the classic case,
dropping into a project with hundreds of undocumented tables and needing to find your
footing fast.

> AI changed how we write SQL. shirube changes how we understand databases.

## 🧭 What shirube does

shirube turns a database into a map you can read. It opens on an interactive ER diagram
and gives you two ways to find your footing: **steer it yourself** — search for a table,
focus on it, follow its relationships outward — or **just ask**, and the AI navigator
answers on the map. Either way you see how everything connects without reading DDL or
writing a single query.

It is **not** another SQL IDE or database administration console — there is no query
editor, and nothing that ever writes. shirube is a tool for *understanding* a database.

## ✨ Features

Everything below works today, in the beta:

- 🔮 **AI navigator** — ask in plain language and get an answer on the map, lighting up the
  tables involved. Bring your own Claude or OpenAI key, or point it at a local model.
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

## 🔮 The AI navigator

Ask in plain language and get your answer *on the map*: the navigator reads your schema
metadata to guide you and lights up the tables involved, with every object name a link
that flies the map to it. It is a **navigator, not a SQL generator** — it never writes or
runs a query.

Use your own Claude or OpenAI key, or a local model such as Ollama. The request goes
straight from your machine to the model you chose — no shirube server in between, only
question-relevant schema metadata leaves, and a local model sends nothing off your machine
at all. The navigator is entirely optional; the explorer works fully without it.

## 🛡️ Safe by design

- 🔒 **Read-only** — every connection is opened read-only with a statement timeout. shirube
  cannot modify your database — no writes, no schema changes, ever.
- 💻 **Local-first** — it runs on your machine and binds to `127.0.0.1` only. Your database
  credentials and data never leave your computer.
- 📝 **Metadata-only logging** — the local log records errors and request timings, but
  never the values in your data.
- 🤖 **Your data, your provider** — the AI navigator talks straight from your machine to the
  model you chose; only question-relevant schema metadata is sent, and a local model sends
  nothing off your machine at all.

## 🚀 Getting started

You'll need a PostgreSQL database to point shirube at, and a way to run a Python
application without installing it permanently.

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

> 🔮 To use the AI navigator, add a provider in **Settings → AI navigator** — your own
> Claude or OpenAI key, or a local model. It's optional; the explorer works fully without
> it.

## 📚 Learn more

- **Full README and roadmap** —
  <https://github.com/shou-taro/shirube>
- **Contributing** —
  <https://github.com/shou-taro/shirube/blob/main/CONTRIBUTING.md>
- **Licence** — [GNU AGPL-3.0](https://github.com/shou-taro/shirube/blob/main/LICENSE)
