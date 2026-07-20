/**
 * Keeping each connection's navigator conversation.
 *
 * A conversation is about one database, so it is stored per profile: switching connections
 * and coming back finds the thread where it was left, rather than an empty pane. It stays on
 * this machine, alongside the other things the app remembers — the questions asked and the
 * schema metadata in the answers never leave it.
 *
 * Only whole turns are kept, and only the most recent ones, so a long-running conversation
 * cannot grow without bound in a store meant for small values.
 */

import { CHAT_HISTORY_PREFIX } from '@/lib/storage'

/** How many turns to keep. Older ones are dropped, oldest first. */
export const MAX_STORED_TURNS = 40

/** Token counts a provider reported for one answer. */
export interface StoredUsage {
  input: number | null
  output: number | null
}

/** One stored turn of the conversation. */
export interface StoredTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** The look-up tools the assistant used, for the "checked the schema" marker. */
  tools: string[]
  /** A user-safe error that ended the turn, if any. */
  error: string | null
  /** Token usage for the answer, when the provider reported it. */
  usage: StoredUsage | null
}

function keyFor(profileId: string): string {
  return `${CHAT_HISTORY_PREFIX}${profileId}`
}

function isTurn(value: unknown): value is StoredTurn {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const turn = value as Partial<StoredTurn>
  return (
    typeof turn.id === 'string' &&
    (turn.role === 'user' || turn.role === 'assistant') &&
    typeof turn.content === 'string'
  )
}

/**
 * Read a profile's conversation, or an empty one when there is none.
 *
 * Anything unreadable or not shaped like a turn is dropped rather than thrown: a corrupt
 * store should cost the history, never the pane.
 */
export function loadChatHistory(profileId: string): StoredTurn[] {
  try {
    const raw = localStorage.getItem(keyFor(profileId))
    if (raw === null) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(isTurn).map((turn) => ({
      ...turn,
      tools: Array.isArray(turn.tools) ? turn.tools.filter((t) => typeof t === 'string') : [],
      error: typeof turn.error === 'string' ? turn.error : null,
      usage: turn.usage ?? null,
    }))
  } catch {
    return []
  }
}

/**
 * Store a profile's conversation, keeping only the most recent turns.
 *
 * A full store (quota exceeded) is ignored: losing the saved history is a far smaller
 * failure than breaking the answer the user is reading.
 */
export function saveChatHistory(profileId: string, turns: StoredTurn[]): void {
  try {
    if (turns.length === 0) {
      localStorage.removeItem(keyFor(profileId))
      return
    }
    localStorage.setItem(keyFor(profileId), JSON.stringify(turns.slice(-MAX_STORED_TURNS)))
  } catch {
    // Ignored deliberately — see the docstring.
  }
}

/** Forget a profile's conversation. */
export function clearChatHistory(profileId: string): void {
  try {
    localStorage.removeItem(keyFor(profileId))
  } catch {
    // Ignored deliberately — nothing useful to do if the store refuses.
  }
}
