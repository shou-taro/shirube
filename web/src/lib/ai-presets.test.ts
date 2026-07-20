import { afterEach, describe, expect, it } from 'vitest'

import { presetForConfig, saveProviderPreset, statusLabelKey } from '@/lib/ai-presets'

afterEach(() => {
  localStorage.clear()
})

describe('presetForConfig', () => {
  it('reads Anthropic as Claude', () => {
    expect(presetForConfig({ kind: 'anthropic', base_url: null })).toBe('claude')
  })

  it('recognises the fixed OpenAI and Ollama endpoints', () => {
    expect(presetForConfig({ kind: 'openai_compatible', base_url: 'https://api.openai.com/v1' })).toBe(
      'openai',
    )
    expect(
      presetForConfig({ kind: 'openai_compatible', base_url: 'http://localhost:11434/v1' }),
    ).toBe('ollama')
  })

  it('treats any other OpenAI-compatible endpoint as custom', () => {
    expect(presetForConfig({ kind: 'openai_compatible', base_url: 'https://gateway.example/v1' })).toBe(
      'custom',
    )
  })

  it('prefers the remembered preset when it agrees with the stored kind', () => {
    // A custom-URL Ollama is indistinguishable from "custom" by config alone, so the
    // remembered choice is what tells them apart.
    saveProviderPreset('ollama')
    expect(
      presetForConfig({ kind: 'openai_compatible', base_url: 'https://mac.ts.net:8443/v1' }),
    ).toBe('ollama')
  })

  it('ignores a remembered preset whose kind no longer matches', () => {
    // The provider was switched to Claude; a stale "ollama" memory must not win.
    saveProviderPreset('ollama')
    expect(presetForConfig({ kind: 'anthropic', base_url: null })).toBe('claude')
  })

  it('ignores an unknown stored preset value', () => {
    localStorage.setItem('shirube.aiProviderPreset', 'bogus')
    expect(presetForConfig({ kind: 'anthropic', base_url: null })).toBe('claude')
  })
})

describe('statusLabelKey', () => {
  it('uses the short label where one exists, else the full label', () => {
    expect(statusLabelKey('ollama')).toBe('settings.aiPresetOllamaShort')
    expect(statusLabelKey('claude')).toBe('settings.aiPresetClaude')
  })
})
