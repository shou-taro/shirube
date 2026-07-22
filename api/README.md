<p align="center">
  <img src="https://raw.githubusercontent.com/shou-taro/shirube/main/docs/images/logo.svg" width="88" alt="shirube" />
</p>

<h1 align="center">shirube</h1>

<p align="center">
  <strong>You hand-write less SQL than ever.<br />You still own the schema.</strong><br />
  <sub>標べ (<em>shirube</em>) — Japanese for a signpost. It reads your database as a map.</sub>
</p>

<p align="center">
  <a href="https://github.com/shou-taro/shirube/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/shou-taro/shirube/ci.yml?branch=main&label=CI" alt="CI" /></a>
  <a href="https://pypi.org/project/shirube/"><img src="https://img.shields.io/pypi/v/shirube" alt="PyPI" /></a>
  <a href="https://pypi.org/project/shirube/"><img src="https://img.shields.io/pypi/pyversions/shirube" alt="Python versions" /></a>
  <a href="https://github.com/astral-sh/ruff"><img src="https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/v2.json" alt="Ruff" /></a>
  <a href="https://github.com/shou-taro/shirube/blob/main/LICENSE"><img src="https://img.shields.io/badge/licence-AGPL--3.0-blue" alt="Licence: AGPL-3.0" /></a>
  <img src="https://img.shields.io/badge/PostgreSQL-ready-336791?logo=postgresql&logoColor=white" alt="PostgreSQL" />
</p>

> 🚧 **Status: Beta.** Both the explorer and the AI navigator work today. shirube is
> pre-1.0, so things may still change.

<p align="center"><em>Ask a question — see the answer on the map.</em></p>

<p align="center">
  <img src="https://raw.githubusercontent.com/shou-taro/shirube/main/docs/images/home.png" alt="shirube: the AI navigator explaining how a rental links to a film, beside the ER map, a table's detail, and a filtered data preview" width="960" />
</p>

## 🤖 Why shirube

You hand-write less SQL than you used to — tables become models and methods in your code,
and in the AI-coding era much of even that code is written for you. But the schema is still
there underneath, and it is still yours to understand: to judge whether the code an AI
wrote is right — which tables it reads, which columns it touches, which relationships it
follows — and to ask the tools for the right thing in the first place.

A plain list of tables is a poor place to see that. Open them one at a time and you get
columns, not connections — not what a table references, what references it, or which hops
lead to the data you are after. Relationships are the very thing you need to follow, and a
list is where they hide, so shirube lets you read a database as a map instead — just as
useful when you drop into a project with hundreds of undocumented tables and need your
footing fast.

> AI changed who writes the SQL. shirube changes how we understand databases.

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

Use your own Claude or OpenAI key, or a local model such as Ollama, configured in
**Settings → AI navigator**. Whichever you pick, the request goes straight from your
machine to that model — never through a shirube server (see **Safe by design** below). The
navigator is entirely optional; the explorer works fully without it.

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
