# Shirube — Product Vision

## Name

**Shirube** — from the Japanese *しるべ* (a guide, a signpost, a landmark).
An AI guide that leads developers through complex relational databases.

> Navigate and understand your database with AI.

## What Shirube is (and is not)

Shirube is an **AI-native database explorer**. It helps developers *understand* a
relational database through visual navigation and AI guidance.

Shirube is **not**:

- a SQL IDE,
- a database administration (DBA) console,
- "yet another" SQL editor.

Most tools start with **Connection → Table list → SQL editor**.
Shirube starts with **Connection → ER diagram → AI → Data exploration**.
The ER diagram is the home screen; the database is explored visually.

## Philosophy

The goal is **not** "don't write SQL". The real goal is **"don't get lost."**

Shirube helps answer questions like:

- Where is this data?
- Which table owns this column?
- How are these tables related?
- Which table stores sales?
- Where does this foreign key lead?
- Which table should I start from?

SQL becomes optional.

## Target users

Primarily **developers joining an existing project**: hundreds of tables, an unknown
schema, poor documentation, and no idea where the data lives. Shirube aims to cut
onboarding time dramatically.

## Product principles

- The ER diagram is the centre of the experience.
- Relationships are first-class citizens.
- The graph should feel like **Google Maps for databases** — you never see the whole
  world at once; you search, focus, and pan outward.
- The AI is a **navigator**, not a SQL generator. It assists understanding and
  navigation, and it never executes changes automatically.
- Shirube is **read-only and safe by design**. It should never feel dangerous.

## Main user flow

```
Connect database
  → Generate ER diagram (centred on the most-connected table)
  → Click a table
      → View columns, relationships, and sample data (left panel)
  → Ask the AI navigator
  → Follow relationships to related tables
  → Explore the database visually
```

## MVP scope

**Included**

- PostgreSQL connection (read-only)
- Schema inspection
- Automatic ER diagram (search + neighbourhood expansion)
- Table viewer (columns, relationships, sample data)
- Relationship navigation
- Manual relationship editing (stored locally; the database is never modified)
- Table and column search
- AI explanations and navigation

**Explicitly excluded from the MVP**

- UPDATE / DELETE
- CREATE / ALTER TABLE, migrations
- A general SQL editor

## Roadmap

**Phase 1 — Explore**
ER diagram, table viewer, AI explanation, navigation.

**Phase 2 — Analyse**
GUI filters, aggregation, saved views, AI-suggested relationships, semantic search.

**Phase 3 — Manage**
Safe editing, GUI updates, GUI view builder, team features (shared/self-hosted).

## Technical direction

- **Frontend:** React, TypeScript, shadcn/ui, React Flow — built with Vite as a
  single-page application.
- **Backend:** FastAPI, SQLAlchemy. In distribution the backend serves the pre-built
  SPA, so Shirube runs as a single process on a single origin.
- **Database:** PostgreSQL first; MySQL and SQL Server later, behind a database
  adapter.
- **AI:** a provider abstraction — OpenAI-compatible APIs and Ollama first, other
  providers later.

## Architecture

```
React SPA
  → REST API (FastAPI)
    → Application core
      → Database adapter
        → PostgreSQL
```

The AI sits behind a provider interface, isolated from the rest of the application.

## Distribution & runtime

- **Local-first.** Shirube runs on the developer's own machine; database credentials
  and data never leave it.
- **Primary entry point:** a single command (`uvx shirube` / `pipx install shirube`)
  that starts a local server and opens the browser. Works whether the target database
  is local or remote.
- **Secondary entry point:** Docker Compose, for isolation and for bringing up a
  bundled sample database so newcomers can try Shirube without a database of their own.
- The local server binds to `127.0.0.1` only, so no authentication layer is needed in
  the MVP. Multi-user, self-hosted deployment is a Phase 3 concern.

## Open-source strategy

**OSS first, commercial later.** The open-source product includes the ER diagram,
database exploration, and AI provider support (OpenAI-compatible and Ollama).
Possible commercial directions: hosted AI, team collaboration, shared knowledge,
enterprise features, and cloud.

## Product identity

Shirube is not about replacing SQL. It is about replacing **confusion**. Instead of
memorising tables, developers navigate the database like a map: ER diagrams become
interactive, the AI becomes the guide, and the database becomes understandable.
