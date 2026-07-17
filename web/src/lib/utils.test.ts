import { describe, expect, it } from 'vitest'

import { cn } from '@/lib/utils'

describe('cn', () => {
  it('resolves conflicting Tailwind utilities so the last one wins', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
  })

  it('drops falsy conditional classes', () => {
    expect(cn('a', false, undefined, null, 'c')).toBe('a c')
  })
})
