import { describe, expect, it } from 'vitest'

import type { SchemaObject } from '@/lib/api'
import { buildObjectResolver } from '@/lib/schema-refs'

function object(schema: string, name: string): SchemaObject {
  return { id: `${schema}.${name}`, schema, name, kind: 'table', columns: [] }
}

const RESOLVE = buildObjectResolver([
  object('public', 'rental'),
  object('public', 'staff'),
  // The same bare name in two schemas — ambiguous on its own.
  object('public', 'store'),
  object('archive', 'store'),
])

describe('buildObjectResolver', () => {
  it('resolves a qualified name', () => {
    expect(RESOLVE('public.rental')).toBe('public.rental')
    expect(RESOLVE('archive.store')).toBe('archive.store')
  })

  it('resolves a bare name when only one object carries it', () => {
    expect(RESOLVE('rental')).toBe('public.rental')
    expect(RESOLVE('staff')).toBe('public.staff')
  })

  it('refuses a bare name shared by more than one object', () => {
    // Guessing between public.store and archive.store would send the map somewhere random.
    expect(RESOLVE('store')).toBeNull()
    // Qualifying it still works.
    expect(RESOLVE('public.store')).toBe('public.store')
  })

  it('ignores surrounding whitespace and case', () => {
    expect(RESOLVE('  Public.Rental  ')).toBe('public.rental')
  })

  it('resolves a foreign key written with its column', () => {
    // Both forms the navigator uses; the object is what the map travels to.
    expect(RESOLVE('public.rental(rental_id)')).toBe('public.rental')
    expect(RESOLVE('rental (rental_id)')).toBe('public.rental')
    expect(RESOLVE('public.rental.rental_id')).toBe('public.rental')
    // A bare table with its column, which is how a "referenced by" list reads.
    expect(RESOLVE('rental.rental_id')).toBe('public.rental')
    // An ambiguous bare name stays ambiguous with a column attached.
    expect(RESOLVE('store(store_id)')).toBeNull()
    expect(RESOLVE('store.store_id')).toBeNull()
  })

  it('prefers a real qualified object over reading it as table.column', () => {
    // `archive.store` is an object; it must not be stripped down to `archive`.
    expect(RESOLVE('archive.store')).toBe('archive.store')
  })

  it('returns null for anything the schema does not name', () => {
    expect(RESOLVE('film_actor')).toBeNull()
    expect(RESOLVE('SELECT 1')).toBeNull()
    expect(RESOLVE('')).toBeNull()
    expect(RESOLVE('   ')).toBeNull()
  })
})
