/**
 * Builders for schema-graph test fixtures.
 *
 * Keeps the tests readable — a graph is spelled out as a few objects and relationships
 * rather than repeating the full API shapes inline.
 */

import type { Column, Relationship, SchemaGraph, SchemaObject } from '@/lib/api'

/** A schema object with `columns` generic columns (the first is the primary key). */
export function makeObject(
  id: string,
  columns = 0,
  kind: SchemaObject['kind'] = 'table',
): SchemaObject {
  const dot = id.indexOf('.')
  const schema = dot === -1 ? 'public' : id.slice(0, dot)
  const name = dot === -1 ? id : id.slice(dot + 1)
  return {
    id,
    schema,
    name,
    kind,
    columns: Array.from(
      { length: columns },
      (_, i): Column => ({
        name: `c${i}`,
        data_type: 'text',
        nullable: true,
        is_primary_key: i === 0,
      }),
    ),
  }
}

/** A foreign key from `source` to `target`. */
export function makeFk(source: string, target: string, name = `${source}_${target}_fkey`): Relationship {
  return {
    constraint_name: name,
    source,
    source_columns: ['fk'],
    target,
    target_columns: ['id'],
    kind: 'foreign_key',
  }
}

/** A view dependency: `source` (a view) reads from `target`. */
export function makeViewDep(source: string, target: string, name = `${source}__${target}`): Relationship {
  return {
    constraint_name: name,
    source,
    source_columns: [],
    target,
    target_columns: [],
    kind: 'view_dependency',
  }
}

export function makeGraph(objects: SchemaObject[], relationships: Relationship[] = []): SchemaGraph {
  return { objects, relationships }
}
