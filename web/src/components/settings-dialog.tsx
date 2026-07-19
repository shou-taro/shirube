import { Check, Monitor, Moon, Sun, X } from 'lucide-react'
import { type ComponentType, type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  type AiProvider,
  type AiProviderInput,
  type AiProviderKind,
  clearAiProvider,
  fetchAiProvider,
  fetchHealth,
  saveAiProvider,
} from '@/lib/api'
import { useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'

/** A labelled block within the dialog. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-border/60 px-5 py-4 first:border-t-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}

/** A label with optional hint on the left, and its control on the right. */
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** A small segmented control: one option highlighted, the rest quiet. Options may carry
 *  an icon, shown before the label. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string; icon?: ComponentType<{ className?: string }> }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex rounded-md border bg-background p-0.5">
      {options.map((option) => {
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium',
              option.value === value
                ? 'bg-brand text-brand-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {Icon ? <Icon className="size-3.5" /> : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** A pill toggle for a boolean setting. */
function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        checked ? 'bg-brand' : 'bg-input',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-4 rounded-full bg-card shadow-sm transition-all',
          checked ? 'left-[1.125rem]' : 'left-0.5',
        )}
      />
    </button>
  )
}

/** A labelled text field stacked vertically, for the provider form. The hint sits outside
 *  the label so it does not become part of the control's accessible name. */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className="text-sm">{label}</span>
        {children}
      </label>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

/** A provider the user can pick from the list. Several map to the same backend adapter
 *  (`openai_compatible`) but differ in their defaults and which fields they need. */
type ProviderPreset = 'claude' | 'openai' | 'ollama' | 'custom'

interface PresetSpec {
  /** The backend adapter kind this preset saves as. */
  kind: AiProviderKind
  labelKey: string
  /** Prefilled model, and the placeholder shown when it is blank. */
  modelDefault: string
  modelPlaceholder: string
  /** Endpoint used when the base-URL field is hidden, and the value seeded when shown. */
  baseUrlDefault: string
  /** Whether the base-URL field is shown (hidden ones use ``baseUrlDefault`` silently). */
  showBaseUrl: boolean
  /** How the API key is treated: hosted providers require one, a local runner needs none. */
  key: 'required' | 'optional' | 'none'
}

// The provider presets, in the order shown in the list. Claude is the Anthropic-native
// adapter; the rest all speak the OpenAI-compatible shape but differ in defaults and needs —
// OpenAI is hosted (fixed endpoint, key required), Ollama is local (no key), and a custom
// endpoint asks for its own URL.
const AI_PRESETS: Record<ProviderPreset, PresetSpec> = {
  claude: {
    kind: 'anthropic',
    labelKey: 'settings.aiPresetClaude',
    modelDefault: 'claude-opus-4-8',
    modelPlaceholder: 'claude-opus-4-8',
    baseUrlDefault: '',
    showBaseUrl: false,
    key: 'required',
  },
  openai: {
    kind: 'openai_compatible',
    labelKey: 'settings.aiPresetOpenai',
    modelDefault: '',
    modelPlaceholder: 'gpt-4o',
    baseUrlDefault: 'https://api.openai.com/v1',
    showBaseUrl: false,
    key: 'required',
  },
  ollama: {
    kind: 'openai_compatible',
    labelKey: 'settings.aiPresetOllama',
    modelDefault: '',
    modelPlaceholder: 'llama3.1',
    baseUrlDefault: 'http://localhost:11434/v1',
    showBaseUrl: true,
    key: 'none',
  },
  custom: {
    kind: 'openai_compatible',
    labelKey: 'settings.aiPresetCustom',
    modelDefault: '',
    modelPlaceholder: '',
    baseUrlDefault: '',
    showBaseUrl: true,
    key: 'optional',
  },
}

const AI_PRESET_ORDER: ProviderPreset[] = ['claude', 'openai', 'ollama', 'custom']

/**
 * Map a saved config back to the preset that produced it, so the form reopens on the right
 * one. OpenAI and Ollama are told apart by their default endpoints; any other
 * OpenAI-compatible URL is treated as a custom endpoint.
 */
function presetForConfig(config: AiProvider): ProviderPreset {
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
 * The AI-navigator provider settings: pick a provider from the list, then fill only the
 * fields that provider needs — a hosted one asks for an API key, a local one does not, and a
 * custom endpoint asks for its URL. One provider is active at a time; the "in use" line shows
 * which. A server-backed form that loads the current provider when the dialog opens and saves
 * on demand. The API key is write-only — stored in the OS keychain, never read back — so a
 * saved key shows as a note and a blank field keeps it.
 */
function AiProviderSection({ open }: { open: boolean }) {
  const { t } = useTranslation()
  const [provider, setProvider] = useState<AiProvider | null | undefined>(undefined)
  const [preset, setPreset] = useState<ProviderPreset>('claude')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Seed the form for a preset: the saved values when that preset is the configured provider,
  // otherwise the preset's defaults. Always clears the key field — the stored key is never
  // read back — and any transient error/saved state.
  function seedFields(nextPreset: ProviderPreset, current: AiProvider | null): void {
    const spec = AI_PRESETS[nextPreset]
    const fromSaved = current !== null && presetForConfig(current) === nextPreset
    setModel(fromSaved ? current.model : spec.modelDefault)
    setBaseUrl(fromSaved ? (current.base_url ?? '') : spec.baseUrlDefault)
    setApiKey('')
    setError(null)
    setSaved(false)
  }

  // Load the configured provider each time the dialog opens, selecting its preset (or Claude
  // by default) and seeding the form.
  useEffect(() => {
    if (!open) {
      return
    }
    let active = true
    fetchAiProvider()
      .then((current) => {
        if (!active) {
          return
        }
        setProvider(current)
        const nextPreset = current ? presetForConfig(current) : 'claude'
        setPreset(nextPreset)
        const spec = AI_PRESETS[nextPreset]
        const fromSaved = current != null && presetForConfig(current) === nextPreset
        setModel(fromSaved ? current.model : spec.modelDefault)
        setBaseUrl(fromSaved ? (current.base_url ?? '') : spec.baseUrlDefault)
        setApiKey('')
        setError(null)
        setSaved(false)
      })
      .catch(() => {
        if (active) {
          setProvider(null)
        }
      })
    return () => {
      active = false
    }
  }, [open])

  function selectPreset(next: ProviderPreset): void {
    setPreset(next)
    seedFields(next, provider ?? null)
  }

  const spec = AI_PRESETS[preset]
  const savedPreset = provider != null ? presetForConfig(provider) : null
  const configured = savedPreset !== null
  // A stored key only counts as "kept on blank" for the provider it was saved against.
  const keyStored = provider != null && presetForConfig(provider) === preset && provider.has_api_key

  async function handleSave(): Promise<void> {
    // A hosted provider needs a key; guard here so the miss is caught before the request.
    if (spec.key === 'required' && apiKey === '' && !keyStored) {
      setError(t('settings.aiApiKeyMissing'))
      return
    }
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const resolvedBaseUrl = spec.showBaseUrl
        ? baseUrl.trim() === ''
          ? null
          : baseUrl.trim()
        : spec.baseUrlDefault || null
      const input: AiProviderInput = { kind: spec.kind, model, base_url: resolvedBaseUrl }
      // Send a key only when one was typed (and the provider takes one); blank keeps the
      // stored key.
      if (spec.key !== 'none' && apiKey !== '') {
        input.api_key = apiKey
      }
      const result = await saveAiProvider(input)
      setProvider(result)
      setApiKey('')
      setSaved(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await clearAiProvider()
      setProvider(null)
      seedFields(preset, null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }

  const keyPlaceholder = keyStored
    ? ''
    : spec.key === 'required'
      ? t('settings.aiApiKeyEnter')
      : t('settings.aiApiKeyOptionalPlaceholder')
  const keyHint = keyStored ? t('settings.aiApiKeySaved') : t('settings.aiApiKeyHint')

  return (
    <Section title={t('settings.ai')}>
      <p className="-mt-1 text-xs text-muted-foreground">{t('settings.aiHint')}</p>

      <div
        className={cn(
          'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
          configured ? 'bg-brand/5' : 'bg-muted/40 text-muted-foreground',
        )}
      >
        {savedPreset !== null ? (
          <>
            <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
            <span>
              {t('settings.aiInUse', { provider: t(AI_PRESETS[savedPreset].labelKey) })}
            </span>
          </>
        ) : (
          <span>{t('settings.aiNotSetUp')}</span>
        )}
      </div>

      <Field label={t('settings.aiProviderLabel')}>
        <select
          value={preset}
          onChange={(event) => selectPreset(event.target.value as ProviderPreset)}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {AI_PRESET_ORDER.map((option) => (
            <option key={option} value={option}>
              {t(AI_PRESETS[option].labelKey)}
            </option>
          ))}
        </select>
      </Field>

      {spec.showBaseUrl ? (
        <Field label={t('settings.aiBaseUrl')} hint={t('settings.aiBaseUrlHint')}>
          <Input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={spec.baseUrlDefault || 'https://…'}
          />
        </Field>
      ) : null}

      <Field label={t('settings.aiModel')}>
        <Input
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder={spec.modelPlaceholder}
        />
      </Field>

      {spec.key !== 'none' ? (
        <Field label={t('settings.aiApiKey')} hint={keyHint}>
          <Input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={keyPlaceholder}
            autoComplete="off"
          />
        </Field>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center gap-2">
        <Button variant="brand" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? t('settings.aiSaving') : t('settings.aiSave')}
        </Button>
        {configured ? (
          <Button variant="ghost" size="sm" onClick={handleRemove} disabled={saving}>
            {t('settings.aiRemove')}
          </Button>
        ) : null}
        {saved ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3.5" />
            {t('settings.aiSaved')}
          </span>
        ) : null}
      </div>
    </Section>
  )
}

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * The settings modal: appearance (theme), ER map defaults and an About section. Opened
 * from the top bar's gear. A light overlay; Escape or a click outside closes it.
 */
export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { t } = useTranslation()
  const { settings, update } = useSettings()
  const [version, setVersion] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Manage focus while the modal is open: move focus in, keep Tab inside it, close on
  // Escape, and hand focus back to whatever opened it on close. Without this, focus stays
  // behind the overlay and Tab walks the page underneath.
  useEffect(() => {
    if (!open) {
      return
    }
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusable = (): HTMLElement[] => {
      const dialog = dialogRef.current
      if (dialog === null) {
        return []
      }
      return Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute('disabled'))
    }
    // Move focus into the dialog (the first control, or the dialog itself as a fallback).
    ;(focusable()[0] ?? dialogRef.current)?.focus()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') {
        return
      }
      const items = focusable()
      if (items.length === 0) {
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      // Wrap at the ends so Tab / Shift+Tab cycle within the dialog rather than escaping.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  // Read the running version when the dialog opens.
  useEffect(() => {
    if (!open) {
      return
    }
    fetchHealth()
      .then((health) => setVersion(health.version))
      .catch(() => setVersion(null))
  }, [open])

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        tabIndex={-1}
        className="relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-xl border bg-card shadow-lg outline-none"
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-medium">{t('settings.title')}</h2>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onClose}
            aria-label={t('settings.close')}
          >
            <X className="size-4" />
          </Button>
        </div>

        <Section title={t('settings.appearance')}>
          <Row label={t('settings.theme')}>
            <Segmented
              value={settings.theme}
              onChange={(theme) => update({ theme })}
              options={[
                { value: 'system', label: t('settings.themeSystem'), icon: Monitor },
                { value: 'light', label: t('settings.themeLight'), icon: Sun },
                { value: 'dark', label: t('settings.themeDark'), icon: Moon },
              ]}
            />
          </Row>
        </Section>

        <Section title={t('settings.erMap')}>
          <Row label={t('settings.showViewDependencies')} hint={t('settings.showViewDependenciesHint')}>
            <Switch
              checked={settings.showViewDependencies}
              onChange={(showViewDependencies) => update({ showViewDependencies })}
              label={t('settings.showViewDependencies')}
            />
          </Row>
          <Row label={t('settings.defaultView')} hint={t('settings.defaultViewHint')}>
            <Segmented
              value={settings.defaultView}
              onChange={(defaultView) => update({ defaultView })}
              options={[
                { value: 'neighbourhood', label: t('settings.viewNeighbourhood') },
                { value: 'all', label: t('settings.viewAll') },
              ]}
            />
          </Row>
        </Section>

        <AiProviderSection open={open} />

        <Section title={t('settings.about')}>
          <Row label={t('settings.version')}>
            <span className="text-sm text-muted-foreground">{version ?? '—'}</span>
          </Row>
        </Section>
      </div>
    </div>
  )
}
