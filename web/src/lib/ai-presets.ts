/**
 * The AI provider presets the user picks from, shared by the settings form and the
 * navigator pane.
 *
 * The backend stores only what it needs to make the call — the adapter kind, the model and
 * the base URL — so several presets map to the same `openai_compatible` kind and differ only
 * in their defaults and which fields they need. That means a saved config alone cannot always
 * say which preset produced it (an Ollama pointed at a non-default host looks like any other
 * OpenAI-compatible endpoint), so the choice is remembered here too, and the UI names the
 * provider the way the user chose it.
 */

import type { AiProviderKind } from '@/lib/api'
import { AI_PRESET_KEY } from '@/lib/storage'

/** The parts of a saved provider that identify which preset it came from. */
interface SavedProvider {
  kind: AiProviderKind
  base_url: string | null
}

/** A provider the user can pick from the list. */
export type ProviderPreset = 'claude' | 'openai' | 'ollama' | 'custom'

export interface PresetSpec {
  /** The backend adapter kind this preset saves as. */
  kind: AiProviderKind
  labelKey: string
  /** Name for the navigator's status line; falls back to `labelKey` when the same. */
  shortLabelKey?: string
  /** Prefilled model, and the placeholder shown when it is blank. */
  modelDefault: string
  modelPlaceholder: string
  /** Endpoint used when the base-URL field is hidden, and the value seeded when shown. */
  baseUrlDefault: string
  /** Whether the base-URL field is shown (hidden ones use `baseUrlDefault` silently). */
  showBaseUrl: boolean
  /** How the API key is treated: hosted providers require one, a local runner needs none. */
  key: 'required' | 'optional' | 'none'
  /**
   * Whether the context-window field is shown. Claude's window is known to be large, so it
   * is hidden there; the OpenAI-compatible presets show it because their window varies from a
   * large hosted model to a small local one.
   */
  showContextWindow: boolean
  /** The context window seeded when the field is shown — the model's typical window. */
  contextWindowDefault: number
}

// Claude is the Anthropic-native adapter; the rest all speak the OpenAI-compatible shape but
// differ in defaults and needs — OpenAI is hosted (fixed endpoint, key required), Ollama is a
// local runner (no key), and a custom endpoint asks for its own URL.
export const AI_PRESETS: Record<ProviderPreset, PresetSpec> = {
  claude: {
    kind: 'anthropic',
    labelKey: 'settings.aiPresetClaude',
    modelDefault: 'claude-opus-4-8',
    modelPlaceholder: 'claude-opus-4-8',
    baseUrlDefault: '',
    showBaseUrl: false,
    key: 'required',
    showContextWindow: false,
    contextWindowDefault: 0,
  },
  openai: {
    kind: 'openai_compatible',
    labelKey: 'settings.aiPresetOpenai',
    modelDefault: '',
    modelPlaceholder: 'gpt-4o',
    baseUrlDefault: 'https://api.openai.com/v1',
    showBaseUrl: false,
    key: 'required',
    // Hosted OpenAI's usual models all have a large window, so — like Claude — it needs no
    // field; the default below is sent automatically.
    showContextWindow: false,
    contextWindowDefault: 128000,
  },
  ollama: {
    kind: 'openai_compatible',
    labelKey: 'settings.aiPresetOllama',
    shortLabelKey: 'settings.aiPresetOllamaShort',
    modelDefault: '',
    modelPlaceholder: 'llama3.1',
    baseUrlDefault: 'http://localhost:11434/v1',
    showBaseUrl: true,
    key: 'none',
    showContextWindow: true,
    contextWindowDefault: 4096,
  },
  custom: {
    kind: 'openai_compatible',
    labelKey: 'settings.aiPresetCustom',
    modelDefault: '',
    modelPlaceholder: '',
    baseUrlDefault: '',
    showBaseUrl: true,
    key: 'optional',
    showContextWindow: true,
    contextWindowDefault: 4096,
  },
}

export const AI_PRESET_ORDER: ProviderPreset[] = ['claude', 'openai', 'ollama', 'custom']

/** Remember which preset the user picked when saving. */
export function saveProviderPreset(preset: ProviderPreset): void {
  localStorage.setItem(AI_PRESET_KEY, preset)
}

/** The remembered preset, or null when nothing has been saved (or the value is unknown). */
function loadProviderPreset(): ProviderPreset | null {
  const stored = localStorage.getItem(AI_PRESET_KEY)
  return stored !== null && stored in AI_PRESETS ? (stored as ProviderPreset) : null
}

/**
 * Infer the preset from a saved config alone, used when nothing was remembered.
 *
 * Anthropic is always Claude; the two providers with fixed endpoints are recognised by them;
 * anything else is a custom OpenAI-compatible endpoint.
 */
function inferPreset(config: SavedProvider): ProviderPreset {
  if (config.kind === 'anthropic') {
    return 'claude'
  }
  if (config.base_url === AI_PRESETS.openai.baseUrlDefault) {
    return 'openai'
  }
  if (config.base_url === AI_PRESETS.ollama.baseUrlDefault) {
    return 'ollama'
  }
  return 'custom'
}

/**
 * The preset a saved config should be shown as: what the user picked, when that is still
 * consistent with the config, and otherwise whatever the config itself implies.
 *
 * The consistency check matters because the provider can be changed without the remembered
 * preset being updated — the stored kind always wins over a stale memory.
 */
export function presetForConfig(config: SavedProvider): ProviderPreset {
  const remembered = loadProviderPreset()
  if (remembered !== null && AI_PRESETS[remembered].kind === config.kind) {
    return remembered
  }
  return inferPreset(config)
}

/** The i18n key naming a preset in the navigator's status line. */
export function statusLabelKey(preset: ProviderPreset): string {
  const spec = AI_PRESETS[preset]
  return spec.shortLabelKey ?? spec.labelKey
}
