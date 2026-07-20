/**
 * Recognising the schema objects the navigator names in its answers.
 *
 * The navigator is told to use exact names, and it writes them as code spans — `public.store`,
 * or sometimes just `store`. Matching those against the loaded schema is what turns an answer
 * into something navigable: a name the map knows becomes a link to it.
 *
 * A bare name is only accepted when exactly one object carries it, so `store` in a database
 * with both `public.store` and `archive.store` stays plain text rather than guessing.
 */

import type { SchemaObject } from '@/lib/api'

/** Resolve the text of a code span to a schema object id, or null when it names none. */
export type ObjectResolver = (text: string) => string | null

/** Build a resolver over the loaded schema. */
export function buildObjectResolver(objects: SchemaObject[]): ObjectResolver {
  // Qualified ids are unambiguous; bare names are kept only while they stay unique.
  const byId = new Map<string, string>()
  const byName = new Map<string, string | null>()

  for (const object of objects) {
    byId.set(object.id.toLowerCase(), object.id)
    const name = object.name.toLowerCase()
    // A second object with the same bare name makes it ambiguous — mark it unusable.
    byName.set(name, byName.has(name) ? null : object.id)
  }

  const lookUp = (needle: string): string | null =>
    needle === '' ? null : (byId.get(needle) ?? byName.get(needle) ?? null)

  return (text: string): string | null => {
    const needle = text.trim().toLowerCase()
    // A reference may name the column as well as the object, in either of the two forms the
    // navigator uses — `public.customer(customer_id)` and `public.customer.customer_id`. The
    // object is what the map can travel to, so each is tried with the column removed.
    const parenthesised = /^(.+?)\s*\([^()]*\)$/.exec(needle)?.[1].trim()
    // Dropping the last dotted part turns `public.customer.customer_id` into the object, and
    // equally `payment.staff_id` — a bare table with its column. This is only reached once
    // the whole string has failed, so a real `schema.table` has already matched as itself.
    const dotted = needle.includes('.') ? needle.slice(0, needle.lastIndexOf('.')) : null

    for (const candidate of [needle, parenthesised, dotted]) {
      const found = candidate === undefined || candidate === null ? null : lookUp(candidate)
      if (found !== null) {
        return found
      }
    }
    return null
  }
}
