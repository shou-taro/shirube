import { afterEach, describe, expect, it } from 'vitest'

import {
  clearChatHistory,
  loadChatHistory,
  MAX_STORED_TURNS,
  saveChatHistory,
  type StoredTurn,
} from '@/lib/chat-history'

function turn(id: string, content = 'hi'): StoredTurn {
  return { id, role: 'user', content, tools: [], error: null, usage: null }
}

afterEach(() => {
  localStorage.clear()
})

describe('round trip', () => {
  it('stores and reads back a profile’s conversation', () => {
    const turns = [
      turn('1', 'Where do stores live?'),
      {
        id: '2',
        role: 'assistant' as const,
        content: 'In public.store.',
        tools: ['search_objects'],
        error: null,
        usage: { input: 120, output: 18 },
      },
    ]

    saveChatHistory('p1', turns)

    expect(loadChatHistory('p1')).toEqual(turns)
  })

  it('keeps each profile’s conversation apart', () => {
    saveChatHistory('p1', [turn('1', 'first')])
    saveChatHistory('p2', [turn('2', 'second')])

    expect(loadChatHistory('p1')[0].content).toBe('first')
    expect(loadChatHistory('p2')[0].content).toBe('second')
  })

  it('reads an empty conversation for a profile with none', () => {
    expect(loadChatHistory('unknown')).toEqual([])
  })
})

describe('bounds and robustness', () => {
  it('keeps only the most recent turns', () => {
    const many = Array.from({ length: MAX_STORED_TURNS + 10 }, (_, i) => turn(String(i)))

    saveChatHistory('p1', many)

    const stored = loadChatHistory('p1')
    expect(stored).toHaveLength(MAX_STORED_TURNS)
    // The oldest are the ones dropped.
    expect(stored[0].id).toBe('10')
    expect(stored.at(-1)?.id).toBe(String(MAX_STORED_TURNS + 9))
  })

  it('drops entries that are not shaped like a turn', () => {
    localStorage.setItem(
      'shirube.chat.p1',
      JSON.stringify([turn('1'), { id: 5 }, null, 'nope', { role: 'user' }]),
    )

    expect(loadChatHistory('p1')).toHaveLength(1)
  })

  it('reads an empty conversation when the stored value is not JSON', () => {
    localStorage.setItem('shirube.chat.p1', 'not json')

    expect(loadChatHistory('p1')).toEqual([])
  })

  it('removes the entry when the conversation is emptied', () => {
    saveChatHistory('p1', [turn('1')])
    saveChatHistory('p1', [])

    expect(localStorage.getItem('shirube.chat.p1')).toBeNull()
  })

  it('forgets one profile’s conversation, leaving others', () => {
    saveChatHistory('p1', [turn('1')])
    saveChatHistory('p2', [turn('2')])

    clearChatHistory('p1')

    expect(loadChatHistory('p1')).toEqual([])
    expect(loadChatHistory('p2')).toHaveLength(1)
  })
})
