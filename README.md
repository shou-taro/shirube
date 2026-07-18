<p align="center">
  <img src="docs/images/logo.svg" width="88" alt="shirube" />
</p>

<h1 align="center">shirube</h1>

<p align="center">
  <strong>AI writes the SQL.<br />You still own the schema.</strong><br />
  <sub>標べ — a signpost for reading a database as a map.</sub>
</p>

<p align="center">
  <a href="https://github.com/shou-taro/shirube/actions/workflows/ci.yml"><img src="https://github.com/shou-taro/shirube/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/status-beta-a78bfa" alt="Status: beta" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-AGPL--3.0-blue" alt="Licence: AGPL-3.0" /></a>
  <img src="https://img.shields.io/badge/PostgreSQL-ready-336791?logo=postgresql&logoColor=white" alt="PostgreSQL" />
</p>

> 🚧 **Status: Beta.** The explorer core is here and usable today. The AI navigator — the
> feature shirube is ultimately built around — is the next milestone (see the
> [roadmap](#roadmap)). shirube is pre-1.0: things may still change.

<p align="center"><em>See the whole database as a map.</em></p>

<p align="center">
  <img src="docs/images/home.png" alt="shirube exploring a database: an ER diagram with a table's detail and its rows" width="960" />
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

shirube opens on an interactive ER diagram and lets you explore a database like a map:
search for a table, focus on it, and follow its relationships outward — so you can see
how everything connects without reading DDL or writing a single query. It answers the
questions you actually have about a schema:

- **Where does this data live**, and which table owns this column?
- **How are these two tables related?** Where does this foreign key lead?
- **Which table should I even start from?**

It is **not** another SQL IDE or database administration console — there is no query
editor, and nothing that ever writes. shirube is a tool for *understanding* a database.

> The goal was never *"don't write SQL."*
> It's **"don't get lost."**

## ✨ Features

Everything below works today, in the beta:

- 🗺️ **ER diagram home.** shirube generates the diagram automatically and centres it on
  the most-connected table. You see a table and its immediate neighbours — not a wall of
  hundreds — and travel outward one hop at a time.
- 📋 **Table detail.** Columns with their types, primary keys and nullability, plus
  relationships split into *references* and *referenced by* — including the tables a view
  reads from.
- 🔗 **Relationship navigation.** Click a related table to glide the map over to it, and
  keep following the connections.
- 👁️ **Data preview.** Read a table or view's actual rows in a drawer beneath the map,
  with click-to-sort columns, simple column filters, and paging.
- ⚡ **Instant search.** Press <kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> to jump straight to any
  table or column.
- 🔐 **Saved connections.** Manage several PostgreSQL profiles; passwords are kept in your
  operating system's keychain, never in a config file.
- 🌗 **Light and dark themes.**

## 🔮 The AI navigator — coming next

> Not built yet. This is the next milestone (see the [roadmap](#roadmap)).

Today you steer the map yourself. Next, you'll be able to ask in plain language, and
shirube will lead you there — highlighting the answer directly on the map:

- *"My AI wrote this JOIN through `invoice` — why does it go there?"*
- *"Where does a customer's email address come from?"*
- *"How is `invoice` related to `payment`?"*
- *"Which tables are involved in user authentication?"*

The AI is a **navigator, not a SQL generator**: it reads schema metadata to guide you,
and it never changes anything.

## 🛡️ Safe by design

shirube is meant never to feel dangerous.

- 🔒 **Read-only.** Every connection is opened read-only with a statement timeout. shirube
  cannot modify your database — no writes, no schema changes, ever.
- 💻 **Local-first.** It runs on your machine and binds to `127.0.0.1` only. Your database
  credentials and data never leave your computer; passwords live in the OS keychain.
- 📝 **Metadata-only logging.** The local log records what is needed to diagnose a problem
  (errors, request timings) but never the values in your data.

## 🚀 Getting started

**You'll need** a PostgreSQL database to point shirube at, and a way to run a Python
application without installing it permanently. Most developers already have
[pipx](https://pipx.pypa.io/); if you prefer [uv](https://docs.astral.sh/uv/), that
works just as well.

> The beta is tested on **macOS** and **Windows**. Linux support is planned (see the
> [roadmap](#roadmap)).

```bash
pipx run shirube   # with pipx
# or
uvx shirube        # with uv
```

Either command starts a small local server and opens shirube in your browser. From
there:

1. 🔌 Add a connection with your PostgreSQL details.
2. 🗺️ shirube inspects the schema and opens the ER diagram.
3. 🔍 Search for a table, or just start following its relationships outward.

Your database can be local or remote.

> 💡 shirube connects with whatever credentials you give it. A read-only role with
> `CONNECT` and `SELECT` is all it needs — and all it should have.

### 🧪 Try it with a sample database

No PostgreSQL to hand? You can take shirube for a spin against a sample database
([pagila](https://github.com/devrimgunduz/pagila)). This needs **Docker** and a clone of
this repository.

```bash
git clone https://github.com/shou-taro/shirube.git
cd shirube
./scripts/dev-db.sh up
```

That brings up `postgresql://postgres:postgres@127.0.0.1:5432/pagila`. Add it as a
connection in shirube and start exploring.

## 🛣️ Roadmap

shirube's development runs in three phases.

- **Now — Explore (beta).** The ER diagram, table detail, relationship navigation, data
  preview and search described above.
- **Next — the AI navigator.** Plain-language questions answered on the map, as described
  above — a *navigator*, not a SQL generator. The headline feature still to land.
- **Later — broadening reach.** More databases beyond PostgreSQL (SQLite and MySQL),
  Linux support, a fully localised interface, and maps you can shape yourself — saved
  layouts and your own relationship links.

## 🤝 Contributing

Running shirube from source, the project layout and the checks are documented in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## 📄 Licence

shirube is licensed under the
[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

As sole copyright holder, the project may additionally be offered under a commercial
licence in future (dual-licensing) for organisations that cannot use AGPL-3.0.
