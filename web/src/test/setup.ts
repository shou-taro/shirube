/**
 * Vitest setup, run once before each test file.
 *
 * Registers jest-dom's matchers, unmounts anything a test rendered, and fills in a couple
 * of browser APIs jsdom does not implement (matchMedia) so components that read them can
 * be rendered under test.
 */

import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// React Testing Library does not auto-clean without globals, so do it explicitly.
afterEach(() => {
  cleanup()
})

// A minimal, working in-memory Storage. jsdom's localStorage is shadowed by Node's
// experimental Web Storage global, which is inert here, so provide our own.
class MemoryStorage implements Storage {
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }
}

vi.stubGlobal('localStorage', new MemoryStorage())

// jsdom has no matchMedia; return a stub that never matches and ignores listeners, which
// is enough for the theme logic (it falls back to the "light" branch under test).
vi.stubGlobal(
  'matchMedia',
  vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
)
