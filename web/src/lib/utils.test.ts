import { describe, expect, it } from 'vitest'

import { cn, fileName } from '@/lib/utils'

describe('cn', () => {
  it('resolves conflicting Tailwind utilities so the last one wins', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })

  it('drops falsy conditional classes', () => {
    expect(cn('a', false, undefined, null, 'c')).toBe('a c')
  })
})

describe('fileName', () => {
  it('returns the trailing segment of a POSIX path', () => {
    expect(fileName('/Users/me/Library/shirube/samples/chinook.sqlite')).toBe('chinook.sqlite')
  })

  it('handles Windows separators', () => {
    expect(fileName('C:\\Users\\me\\data\\app.db')).toBe('app.db')
  })

  it('returns the whole string when there is no separator', () => {
    expect(fileName('chinook.sqlite')).toBe('chinook.sqlite')
  })

  it('falls back to the input when the path ends in a separator', () => {
    expect(fileName('/data/samples/')).toBe('/data/samples/')
  })
})
