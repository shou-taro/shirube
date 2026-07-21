<p align="center">
  <img src="docs/images/logo.svg" width="88" alt="shirube" />
</p>

<h1 align="center">shirube</h1>

<p align="center">
  <strong>You hand-write less SQL than ever.<br />You still own the schema.</strong><br />
  <sub>標べ (<em>shirube</em>) — Japanese for a signpost. It reads your database as a map.</sub>
</p>

<p align="center">
  <a href="https://github.com/shou-taro/shirube/actions/workflows/ci.yml"><img src="https://github.com/shou-taro/shirube/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://pypi.org/project/shirube/"><img src="https://img.shields.io/pypi/v/shirube" alt="PyPI" /></a>
  <img src="https://img.shields.io/badge/status-beta-a78bfa" alt="Status: beta" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-AGPL--3.0-blue" alt="Licence: AGPL-3.0" /></a>
  <img src="https://img.shields.io/badge/PostgreSQL-ready-336791?logo=postgresql&logoColor=white" alt="PostgreSQL" />
</p>

> 🚧 **Status: Beta.** Both halves are here now — the explorer core *and* the AI
> navigator that shirube is ultimately built around, usable today (see the
> [roadmap](#roadmap)). shirube is pre-1.0: things may still change.

<p align="center"><em>See the whole database as a map.</em></p>

<p align="center">
  <img src="docs/images/home.png" alt="shirube exploring a database: an ER diagram with a table's detail and its rows" width="960" />
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

shirube turns a database into a map you can read. It opens on an interactive ER diagram,
centred where it matters, and gives you two ways to find your footing:

- 🗺️ **Steer it yourself** — search for a table, focus on it, and follow its
  relationships outward, one hop at a time.
- 🔮 **Or just ask** — put a question in plain language and the AI navigator answers on
  the map, lighting the path to what you were after.

Either way you see how everything connects — without reading DDL or writing a single
query. These are the questions shirube is built to answer:

- **Where does this data live**, and which table owns this column?
- **How are these two tables related?** Where does this foreign key lead?
- **Which table should I even start from?**

It is **not** another SQL IDE or database administration console — there is no query
editor, and nothing that ever writes. shirube is a tool for *understanding* a database.

> The goal was never *"don't write SQL."*
> It's **"don't get lost."**

## ✨ Features

Everything below works today, in the beta:

- 🔮 **AI navigator.** Ask in plain language — *"which tables would I join to get a
  customer's orders?"* — and shirube answers on the map, lighting up the tables involved.
  Bring your own Claude or OpenAI key, or point it at a local model; it reads schema
  metadata to guide you and never writes a line of SQL. [More below.](#-the-ai-navigator)
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

## 🔮 The AI navigator

Ask in plain language; get your answer *on the map.* The navigator reads your schema and
walks you to what you asked about, explaining as it goes and lighting up the tables
involved — so the answer isn't a wall of text, it's a place you can see. Every object
name in its reply is a link: click one and the map flies straight to it.

- *"My AI wrote this JOIN through `invoice` — why does it go there?"*
- *"Where does a customer's email address come from?"*
- *"How is `invoice` related to `payment`?"*
- *"Which tables are involved in user authentication?"*

The AI is a **navigator, not a SQL generator**: it reads schema metadata to guide you,
and it never changes anything.

**You bring the model.** Use your own Claude or OpenAI key, or run a local model such as
[Ollama](https://ollama.com) — configured in **Settings → AI navigator**. The request
goes straight from your machine to the provider you chose; no shirube server sits in
between, only the schema metadata relevant to your question is ever sent, and a local
model sends nothing off your machine at all. The explorer works fully without any of
this — the navigator is entirely optional.

## 🛡️ Safe by design

shirube is meant never to feel dangerous.

- 🔒 **Read-only.** Every connection is opened read-only with a statement timeout. shirube
  cannot modify your database — no writes, no schema changes, ever.
- 💻 **Local-first.** It runs on your machine and binds to `127.0.0.1` only. Your database
  credentials and data never leave your computer; passwords live in the OS keychain.
- 📝 **Metadata-only logging.** The local log records what is needed to diagnose a problem
  (errors, request timings) but never the values in your data.
- 🤖 **Your data, your provider.** The AI navigator talks straight from your machine to
  the model you chose — nothing routes through a shirube server. Only the schema metadata
  relevant to your question is sent, and a local model sends nothing off your machine at
  all. The navigator reads metadata to guide you; it never runs or writes SQL.

## 🚀 Getting started

**You'll need** a PostgreSQL database to point shirube at, and a way to run a Python
application without installing it permanently. Most developers already have
[pipx](https://pipx.pypa.io/); if you prefer [uv](https://docs.astral.sh/uv/), that
works just as well.

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

To turn on the [AI navigator](#-the-ai-navigator), open **Settings → AI navigator** and
add a provider — your own Claude or OpenAI key, or a local model. It's optional; the
explorer works fully without it.

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

shirube's development runs in two phases.

- **Now — Explore & navigate (beta).** The ER diagram, table detail, relationship
  navigation, data preview and search — plus the AI navigator that answers plain-language
  questions on the map. Everything described above.
- **Later — broadening reach.** More databases beyond PostgreSQL (SQLite and MySQL), a
  fully localised interface, and maps you can shape yourself — saved layouts and your own
  relationship links.

## 🤝 Contributing

Running shirube from source, the project layout and the checks are documented in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## 📄 Licence

shirube is licensed under the
[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

As sole copyright holder, the project may additionally be offered under a commercial
licence in future (dual-licensing) for organisations that cannot use AGPL-3.0.
