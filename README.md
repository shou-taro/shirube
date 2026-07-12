# Shirube

**しるべ** — a guide, a signpost.

**AI-native database explorer.** Shirube helps developers navigate and understand
relational databases through visual exploration and AI guidance, rather than by
writing SQL by hand.

> Navigate and understand your database with AI.

## Status

Early development. The design is being finalised — see [`docs/vision.md`](docs/vision.md)
and [`docs/decisions.md`](docs/decisions.md) for the product vision and the reasoning
behind each design decision.

## What it is

- Starts from an interactive ER diagram, not a SQL editor.
- Explore tables, columns, sample data and relationships visually.
- Ask an AI navigator where data lives and how tables connect.
- Read-only and safe by design.

Shirube is **not** a SQL IDE or a database administration tool. It is a tool for
*understanding* a database — for developers joining an existing project with hundreds
of tables and little documentation.

## Tech stack

- **Frontend:** React, TypeScript, shadcn/ui, React Flow (Vite)
- **Backend:** FastAPI, SQLAlchemy
- **Database:** PostgreSQL (MySQL and SQL Server planned)
- **AI:** pluggable providers behind a common interface (OpenAI-compatible, Ollama)

## Licence

To be decided.
