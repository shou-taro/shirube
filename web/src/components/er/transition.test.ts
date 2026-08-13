import { describe, expect, it } from 'vitest'

import { withLeaving } from './transition'

interface Item {
  id: string
  data?: Record<string, unknown>
}

const item = (id: string, data?: Record<string, unknown>): Item => ({ id, data })

describe('withLeaving', () => {
  it('keeps every target item as-is, ahead of the leaving ones', () => {
    const target = [item('a'), item('b')]
    const current = [item('a'), item('gone')]

    const merged = withLeaving(target, current)

    // The target items come first, unchanged (not flagged as leaving).
    expect(merged.slice(0, 2)).toEqual(target)
    expect(merged[0].data?.leaving).toBeUndefined()
  })

  it('carries over items the target no longer holds, flagged as leaving', () => {
    const target = [item('a')]
    const current = [item('a'), item('gone', { enterDelay: 40 })]

    const merged = withLeaving(target, current)

    // Only the departing item is appended, flagged, keeping the rest of its data.
    expect(merged).toHaveLength(2)
    expect(merged[1]).toEqual({ id: 'gone', data: { enterDelay: 40, leaving: true } })
  })

  it('does not resurrect an item that is back in the target', () => {
    // 'a' was leaving last render but is centred again now: it must appear once, as the
    // fresh target item, without a stale leaving flag.
    const target = [item('a'), item('b')]
    const current = [item('a', { leaving: true }), item('b')]

    const merged = withLeaving(target, current)

    expect(merged).toEqual(target)
    expect(merged.every((entry) => entry.data?.leaving !== true)).toBe(true)
  })

  it('flags nothing when the view is unchanged', () => {
    const target = [item('a'), item('b')]

    const merged = withLeaving(target, [...target])

    expect(merged).toEqual(target)
  })
})
