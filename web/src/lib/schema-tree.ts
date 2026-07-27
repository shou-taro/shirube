import type { Relationship, SchemaObject } from '@/lib/api'

/** One schema and the objects that live in it, for a collapsible tree section. */
export interface SchemaGroup {
  schema: string
  objects: SchemaObject[]
}

/**
 * Group objects by schema, schemas sorted alphabetically; object order is left as the
 * backend's (already alphabetical). Shared by the browse tree and the relationship picker.
 */
export function groupBySchema(objects: SchemaObject[]): SchemaGroup[] {
  const bySchema = new Map<string, SchemaObject[]>()
  for (const object of objects) {
    const list = bySchema.get(object.schema)
    if (list) {
      list.push(object)
    } else {
      bySchema.set(object.schema, [object])
    }
  }
  return [...bySchema.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([schema, grouped]) => ({ schema, objects: grouped }))
}

/**
 * For each object, the foreign-key target name keyed by the referencing column — so a
 * column can be marked "→ customer". Built from the foreign-key relationships; a composite
 * key keeps its first target per column.
 */
export function buildForeignKeys(
  objects: SchemaObject[],
  relationships: Relationship[],
): Map<string, Map<string, string>> {
  const nameById = new Map(objects.map((object) => [object.id, object.name]))
  const byObject = new Map<string, Map<string, string>>()
  for (const relationship of relationships) {
    if (relationship.kind !== 'foreign_key') {
      continue
    }
    let columns = byObject.get(relationship.source)
    if (!columns) {
      columns = new Map()
      byObject.set(relationship.source, columns)
    }
    const target = nameById.get(relationship.target) ?? relationship.target
    for (const column of relationship.source_columns) {
      if (!columns.has(column)) {
        columns.set(column, target)
      }
    }
  }
  return byObject
}
