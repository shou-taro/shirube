import { Client } from 'pg'

import { DB, SCHEMA } from './config'

/**
 * Seed a small, deterministic schema before the run.
 *
 * A couple of tables joined by a foreign key, plus a view, is enough for the map to have
 * a shape to draw and rows to preview — and being fixed, the test can assert on exact
 * names. Dropped and recreated each run so it never drifts.
 */
async function globalSetup(): Promise<void> {
  const client = new Client({ connectionString: DB.connectionString })
  await client.connect()
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
    await client.query(`CREATE SCHEMA "${SCHEMA}"`)
    await client.query(
      `CREATE TABLE "${SCHEMA}".authors (id integer PRIMARY KEY, name text NOT NULL)`,
    )
    await client.query(
      `CREATE TABLE "${SCHEMA}".books (
         id integer PRIMARY KEY,
         title text NOT NULL,
         author_id integer REFERENCES "${SCHEMA}".authors(id)
       )`,
    )
    await client.query(`CREATE VIEW "${SCHEMA}".book_list AS SELECT id, title FROM "${SCHEMA}".books`)
    await client.query(
      `INSERT INTO "${SCHEMA}".authors (id, name) VALUES (1, 'Ursula K. Le Guin'), (2, 'Ted Chiang')`,
    )
    await client.query(
      `INSERT INTO "${SCHEMA}".books (id, title, author_id) VALUES
         (1, 'A Wizard of Earthsea', 1),
         (2, 'The Left Hand of Darkness', 1),
         (3, 'Exhalation', 2)`,
    )
  } finally {
    await client.end()
  }
}

export default globalSetup
