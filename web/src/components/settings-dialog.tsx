import {
  Check,
  Cpu,
  Globe,
  Info,
  Key,
  Monitor,
  Moon,
  Network,
  Palette,
  Ruler,
  Sparkles,
  Sun,
  X,
} from 'lucide-react'
import { type ComponentType, type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { IconInput } from '@/components/ui/icon-input'
import { UnderlineSelect } from '@/components/ui/underline-select'
import {
  AI_PRESET_ORDER,
  AI_PRESETS,
  type PresetSpec,
  presetForConfig,
  type ProviderPreset,
  saveProviderPreset,
} from '@/lib/ai-presets'
import {
  type AiProvider,
  type AiProviderInput,
  clearAiProvider,
  fetchAiProvider,
  fetchHealth,
  listAiProviderModels,
  saveAiProvider,
  testAiProvider,
} from '@/lib/api'
import { labelForDestinationId } from '@/lib/destinations'
import { useSettings } from '@/lib/settings'
import { useAnimatedHeight } from '@/lib/use-animated-height'
import { cn } from '@/lib/utils'

// How long the dialog's exit animation runs before it unmounts. Keep in step with the
// `shirube-*-out` class durations applied to the overlay below.
const DIALOG_EXIT_MS = 150

// Seed the context-window field: the saved window when re-showing the configured provider,
// otherwise the preset's default. Blank for a preset that hides the field (Claude).
function seedContextWindow(spec: PresetSpec, current: AiProvider | null): string {
  if (!spec.showContextWindow) {
    return ''
  }
  return String(current?.context_window ?? spec.contextWindowDefault)
}

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

/**
 * The AI-navigator provider settings: pick a provider from the list, then fill only the
 * fields that provider needs — a hosted one asks for an API key, a local one does not, and a
 * custom endpoint asks for its URL. One provider is active at a time; the "in use" line shows
 * which. A server-backed form that loads the current provider when the dialog opens and saves
 * on demand. The API key is write-only — stored in the OS keychain, never read back — so a
 * saved key shows as a note and a blank field keeps it.
 */
function AiProviderSection({
  open,
  approved,
  onRevoke,
}: {
  open: boolean
  approved: string[]
  onRevoke: (id: string) => void
}) {
  const { t } = useTranslation()
  const [provider, setProvider] = useState<AiProvider | null | undefined>(undefined)
  const [preset, setPreset] = useState<ProviderPreset>('claude')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [contextWindow, setContextWindow] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // Suggestions for the model field, fetched from the provider on demand. The list is only a
  // convenience over free-text entry, so a failure is swallowed and the field stays typeable.
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [modelsState, setModelsState] = useState<'idle' | 'loading' | 'error'>('idle')

  // Drop any fetched suggestions and reset the picker. Called whenever the provider, its base
  // URL or its key changes, so stale suggestions from a different endpoint are not shown.
  function resetModelOptions(): void {
    setModelOptions([])
    setModelsState('idle')
  }

  // Seed the form for a preset: the saved values when that preset is the configured provider,
  // otherwise the preset's defaults. Always clears the key field — the stored key is never
  // read back — and any transient error/saved state.
  function seedFields(nextPreset: ProviderPreset, current: AiProvider | null): void {
    const spec = AI_PRESETS[nextPreset]
    const fromSaved = current !== null && presetForConfig(current) === nextPreset
    setModel(fromSaved ? current.model : spec.modelDefault)
    setBaseUrl(fromSaved ? (current.base_url ?? '') : spec.baseUrlDefault)
    setContextWindow(seedContextWindow(spec, fromSaved ? current : null))
    setApiKey('')
    setError(null)
    setSaved(false)
    resetModelOptions()
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
        setContextWindow(seedContextWindow(spec, fromSaved ? current : null))
        setApiKey('')
        setError(null)
        setSaved(false)
        resetModelOptions()
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
  // Different providers show a different set of fields (a base URL, a context window, a key),
  // so switching one for another changes the section's height. Ease that change rather than
  // letting the fields below the picker jump.
  const fieldsRef = useAnimatedHeight<HTMLDivElement>(preset)
  const configured = provider != null
  // A stored key only counts as "kept on blank" for the provider it was saved against.
  const keyStored = provider != null && presetForConfig(provider) === preset && provider.has_api_key

  // Assemble the request body from the form. A key is sent only when one was typed (and the
  // provider takes one); a blank key keeps whatever is stored.
  function buildInput(): AiProviderInput {
    const resolvedBaseUrl = spec.showBaseUrl
      ? baseUrl.trim() === ''
        ? null
        : baseUrl.trim()
      : spec.baseUrlDefault || null
    const input: AiProviderInput = { kind: spec.kind, model, base_url: resolvedBaseUrl }
    if (spec.kind === 'openai_compatible') {
      // Size the history trimming to the model's window. When the field is shown (a local or
      // custom endpoint, whose window varies), send the typed value — a positive integer, or
      // null to fall back to the backend's conservative default. When it is hidden (hosted
      // OpenAI, uniformly large), send the preset's default automatically, like Claude.
      if (spec.showContextWindow) {
        const parsed = Number.parseInt(contextWindow.trim(), 10)
        input.context_window = Number.isFinite(parsed) && parsed > 0 ? parsed : null
      } else {
        input.context_window = spec.contextWindowDefault
      }
    }
    if (spec.key !== 'none' && apiKey !== '') {
      input.api_key = apiKey
    }
    return input
  }

  // Populate the model picker from the provider itself, on first focus of the field. Skipped
  // when a hosted provider has no key to authenticate with yet (nothing to list against); a
  // listing failure is swallowed so the field stays free-text, surfaced only as a quiet hint.
  async function fetchModels(): Promise<void> {
    if (modelsState === 'loading' || modelOptions.length > 0) {
      return
    }
    // A hosted provider cannot be listed without a key — typed now, or stored against it.
    if (spec.key === 'required' && apiKey === '' && !keyStored) {
      return
    }
    setModelsState('loading')
    try {
      setModelOptions(await listAiProviderModels(buildInput()))
      setModelsState('idle')
    } catch {
      setModelsState('error')
    }
  }

  // True when a hosted provider is missing its key; reports the miss and stops.
  function keyMissing(): boolean {
    if (spec.key === 'required' && apiKey === '' && !keyStored) {
      setError(t('settings.aiApiKeyMissing'))
      return true
    }
    return false
  }

  async function handleSave(): Promise<void> {
    if (keyMissing()) {
      return
    }
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const input = buildInput()
      // Verify the provider is reachable before storing it, so a wrong endpoint or key is
      // caught here rather than only when the navigator is first asked a question.
      await testAiProvider(input)
      const result = await saveAiProvider(input)
      // Remember the choice, so the form and the navigator both name the provider the way
      // the user picked it — a saved config alone cannot always tell the presets apart.
      saveProviderPreset(preset)
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

  // A stored key is never fetched back, so the field is blank; show masked dots as its
  // placeholder to signal a key *is* saved (leave blank to keep it, type to replace), rather
  // than looking empty. Not the real key — just a fixed-length mask.
  const keyPlaceholder = keyStored
    ? '••••••••'
    : spec.key === 'required'
      ? t('settings.aiApiKeyEnter')
      : t('settings.aiApiKeyOptionalPlaceholder')
  const keyHint = keyStored ? t('settings.aiApiKeySaved') : t('settings.aiApiKeyHint')

  return (
    <Section title={t('settings.ai')}>
      <p className="-mt-1 text-xs text-muted-foreground">{t('settings.aiHint')}</p>

      <Field label={t('settings.aiProviderLabel')}>
        {/* A lighter, underlined control (no box), matching the connection form's dropdowns. */}
        <UnderlineSelect
          value={preset}
          onChange={(event) => selectPreset(event.target.value as ProviderPreset)}
        >
          {AI_PRESET_ORDER.map((option) => (
            <option key={option} value={option}>
              {t(AI_PRESETS[option].labelKey)}
            </option>
          ))}
        </UnderlineSelect>
      </Field>

      {/* The fields vary by provider, so ease their combined height as the provider changes. */}
      <div ref={fieldsRef} className="flex flex-col gap-3">
        {spec.showBaseUrl ? (
          <Field label={t('settings.aiBaseUrl')} hint={t('settings.aiBaseUrlHint')}>
            <IconInput
              icon={Globe}
              value={baseUrl}
              onChange={(event) => {
                setBaseUrl(event.target.value)
                // A different endpoint offers different models — drop stale suggestions.
                resetModelOptions()
              }}
              placeholder={spec.baseUrlDefault || 'https://…'}
            />
          </Field>
        ) : null}

        <Field
          label={t('settings.aiModel')}
          hint={
            modelsState === 'loading'
              ? t('settings.aiModelLoading')
              : modelsState === 'error'
                ? t('settings.aiModelListFailed')
                : undefined
          }
        >
          <IconInput
            icon={Cpu}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            onFocus={() => void fetchModels()}
            placeholder={spec.modelPlaceholder}
            list="ai-model-options"
            autoComplete="off"
          />
          {/* Suggestions from the provider; the field stays free-text so any model still works. */}
          <datalist id="ai-model-options">
            {modelOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </Field>

        {spec.showContextWindow ? (
          <Field label={t('settings.aiContextWindow')} hint={t('settings.aiContextWindowHint')}>
            <IconInput
              icon={Ruler}
              type="number"
              inputMode="numeric"
              min={1}
              value={contextWindow}
              onChange={(event) => setContextWindow(event.target.value)}
              placeholder={String(spec.contextWindowDefault)}
            />
          </Field>
        ) : null}

        {spec.key !== 'none' ? (
          <Field label={t('settings.aiApiKey')} hint={keyHint}>
            <IconInput
              icon={Key}
              type="password"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value)
                // A new key may unlock a different account's models — drop stale suggestions.
                resetModelOptions()
              }}
              placeholder={keyPlaceholder}
              autoComplete="off"
            />
          </Field>
        ) : null}
      </div>

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

      {/* Approved destinations: the remote endpoints the user has agreed to send the schema
          to, each revocable here — the configurable side of the navigator's one-time consent. */}
      <div className="mt-1 border-t border-border/60 pt-4">
        <p className="text-sm">{t('settings.aiApproved')}</p>
        <p className="text-xs text-muted-foreground">{t('settings.aiApprovedHint')}</p>
        {approved.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{t('settings.aiApprovedEmpty')}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {approved.map((id) => (
              <li
                key={id}
                className="flex items-center justify-between gap-2 rounded-md border bg-background px-2.5 py-1.5"
              >
                <span className="min-w-0 truncate text-sm" title={labelForDestinationId(id)}>
                  {labelForDestinationId(id)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => onRevoke(id)}
                >
                  {t('settings.aiRevoke')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  )
}

// The dialog's left-hand navigation: one entry per settings group, shown one at a time so
// the panel stays short rather than one long scroll.
const SETTINGS_CATEGORIES = [
  { id: 'appearance', labelKey: 'settings.appearance', icon: Palette },
  { id: 'erMap', labelKey: 'settings.erMap', icon: Network },
  { id: 'ai', labelKey: 'settings.ai', icon: Sparkles },
  { id: 'about', labelKey: 'settings.about', icon: Info },
] as const

type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number]['id']

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  /** Which group to open on; defaults to the first. Lets a caller point at its own setting. */
  initialCategory?: SettingsCategory
  /** Destinations the user has agreed the navigator may send the schema to. */
  approved: string[]
  /** Revoke an approved destination by its identifier. */
  onRevoke: (id: string) => void
}

/**
 * The settings modal: appearance (theme), ER map defaults, the AI navigator provider and
 * approved destinations, and an About section. Opened from the top bar's gear. A light
 * overlay; Escape or a click outside closes it.
 */
export function SettingsDialog({
  open,
  onClose,
  approved,
  onRevoke,
  initialCategory,
}: SettingsDialogProps) {
  const { t } = useTranslation()
  const { settings, update } = useSettings()
  const [version, setVersion] = useState<string | null>(null)
  const [category, setCategory] = useState<SettingsCategory>('appearance')
  // The AI group is much taller than the others, so moving between groups changes the dialog's
  // height. Ease that change rather than letting the dialog jump as the panel swaps.
  const contentRef = useAnimatedHeight<HTMLDivElement>(category)
  const dialogRef = useRef<HTMLDivElement>(null)

  // Keep the dialog mounted for one beat after `open` goes false so it can play an exit
  // animation before it leaves, rather than vanishing. `rendered` trails `open`; `closing`
  // marks the beat in between, switching the overlay to its exit keyframes. Reopening mid-exit
  // cancels the pending unmount. Keep DIALOG_EXIT_MS in step with the class durations below.
  const [rendered, setRendered] = useState(open)
  const [closing, setClosing] = useState(false)
  useEffect(() => {
    if (open) {
      setRendered(true)
      setClosing(false)
      return
    }
    if (!rendered) {
      return
    }
    setClosing(true)
    const timer = setTimeout(() => {
      setClosing(false)
      setRendered(false)
    }, DIALOG_EXIT_MS)
    return () => clearTimeout(timer)
  }, [open, rendered])

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

  // Open on the group the caller asked for, so arriving from a setting's own control lands
  // on it rather than making the user hunt for it.
  useEffect(() => {
    if (open) {
      setCategory(initialCategory ?? 'appearance')
    }
  }, [open, initialCategory])

  // Read the running version when the dialog opens.
  useEffect(() => {
    if (!open) {
      return
    }
    fetchHealth()
      .then((health) => setVersion(health.version))
      .catch(() => setVersion(null))
  }, [open])

  if (!rendered) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className={cn(
          'absolute inset-0 bg-black/40',
          closing ? 'animate-[shirube-fade-out_150ms_ease-in_forwards]' : 'animate-fade-in',
        )}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.title')}
        tabIndex={-1}
        className={cn(
          'relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-card shadow-lg outline-none',
          closing ? 'animate-[shirube-dialog-out_150ms_ease-in_forwards]' : 'animate-dialog-in',
        )}
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

        <div className="flex min-h-0 flex-1">
          {/* Left-hand group navigation: click a group to show only its settings. */}
          <nav
            aria-label={t('settings.title')}
            className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r p-2"
          >
            {SETTINGS_CATEGORIES.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setCategory(item.id)}
                  aria-current={category === item.id ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                    category === item.id
                      ? 'bg-brand/10 font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {t(item.labelKey)}
                </button>
              )
            })}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto">
            {/* The floor lives on the animated wrapper, not the scroll pane, so a whole height
                change eases — a floor on the pane would clamp the shrink and skip part of it. */}
            <div ref={contentRef} className="min-h-[20rem]">
              {category === 'appearance' ? (
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
                <Row label={t('settings.language')}>
                  {/* Each language names itself in its own script, so these labels are not
                      translated — a reader recognises their own language whichever is active. */}
                  <Segmented
                    value={settings.language}
                    onChange={(language) => update({ language })}
                    options={[
                      { value: 'en', label: 'English' },
                      { value: 'ja', label: '日本語' },
                    ]}
                  />
                </Row>
              </Section>
            ) : null}

            {category === 'erMap' ? (
              <Section title={t('settings.erMap')}>
                <Row
                  label={t('settings.showViewDependencies')}
                  hint={t('settings.showViewDependenciesHint')}
                >
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
            ) : null}

            {category === 'ai' ? (
              <AiProviderSection open={open} approved={approved} onRevoke={onRevoke} />
            ) : null}

            {category === 'about' ? (
              <Section title={t('settings.about')}>
                <Row label={t('settings.version')}>
                  <span className="text-sm text-muted-foreground">{version ?? '—'}</span>
                </Row>
              </Section>
            ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
